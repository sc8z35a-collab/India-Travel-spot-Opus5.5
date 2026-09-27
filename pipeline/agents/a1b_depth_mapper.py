"""Task — Depth Mapper (owned by agent ① Asset & Depth Director).

Role: run a monocular depth-estimation network (Depth Anything V2 small,
Apache-2.0, ONNX int8) on every curated real photo and emit a per-photo
depth map. The front-end WebGL engine displaces a densely tessellated mesh
with this map, turning each flat photograph into a true 3D relief that
reacts to the phone's gyroscope and touch (no AI-generated imagery — the
pixels are still the original photographs; only their geometry is inferred).

Outputs  dist/img/<id>/depth.webp  (1024px wide, 8-bit, edge-softened)
         data/_generated/depth.json
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from .base import CACHE, DIST, GEN, Agent, Report, load_json, save_json

MODEL_URL = ("https://huggingface.co/onnx-community/depth-anything-v2-small/"
             "resolve/main/onnx/model_quantized.onnx")
MODEL = CACHE / "models" / "depth_anything_v2_small_q.onnx"
NET_H = 518          # network input height (multiple of 14)
OUT_W = 1024         # depth map width shipped to the browser
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def ensure_model() -> Path:
    if MODEL.exists() and MODEL.stat().st_size > 20_000_000:
        return MODEL
    import requests

    MODEL.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(MODEL_URL, stream=True, timeout=300) as r:
        r.raise_for_status()
        tmp = MODEL.with_suffix(".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.rename(MODEL)
    return MODEL


class DepthMapper(Agent):
    name = "a1b_depth_mapper"
    role = "単眼深度推定(Depth Anything V2)で実写真ごとに深度マップを生成し、WebGLで立体化"

    def source(self, a: dict) -> Path:
        base = DIST / a["path"]
        for w in (1280, 1024, *sorted(a["variants"], reverse=True)):
            p = base / f"{w}.jpg"
            if p.exists():
                return p
        raise FileNotFoundError(base)

    def infer(self, sess, img: Image.Image) -> np.ndarray:
        W, H = img.size
        w = max(14, int(round(W / H * NET_H / 14)) * 14)
        x = np.asarray(img.resize((w, NET_H), Image.BICUBIC), np.float32) / 255.0
        x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
        d = sess.run(None, {sess.get_inputs()[0].name: x})[0]
        d = d.reshape(d.shape[-2], d.shape[-1])
        lo, hi = np.percentile(d, 1), np.percentile(d, 99.5)
        return np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1)

    def run(self, report: Report) -> None:
        import onnxruntime as ort

        assets = load_json(GEN / "assets.json")
        regions = load_json(GEN / "regions.json") if (GEN / "regions.json").exists() else []
        # priority order: heroes first, then highlights, then everything else
        wanted = [r["hero"] for r in regions] + [h["photo"] for r in regions for h in r.get("highlights", [])]
        order = list(dict.fromkeys([*wanted, *assets.keys()]))
        prev = load_json(GEN / "depth.json") if (GEN / "depth.json").exists() else {}

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, (os.cpu_count() or 2))
        opts.enable_cpu_mem_arena = False          # keep RSS low on small sandboxes
        opts.enable_mem_pattern = False
        sess = ort.InferenceSession(str(ensure_model()), opts, providers=["CPUExecutionProvider"])
        out, made, reused = {}, 0, 0
        for pid in order:
            a = assets.get(pid)
            if not a:
                continue
            dst = DIST / a["path"] / "depth.webp"
            src = self.source(a)
            if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime and pid in prev:
                out[pid] = prev[pid]
                reused += 1
                continue
            img = Image.open(src).convert("RGB")
            img.thumbnail((1024, 1024))
            d = self.infer(sess, img)
            # gentle tone curve: expand the mid-ground, keep the far plane flat
            d = np.power(d, 0.85)
            dm = Image.fromarray((d * 255).astype(np.uint8), "L")
            h = int(round(OUT_W / a["ratio"]))
            dm = dm.resize((OUT_W, h), Image.BICUBIC)
            # soften depth discontinuities → no stretched "rubber" triangles on edges
            dm = dm.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(3.2))
            dm.save(dst, "WEBP", quality=88, method=6)
            arr = np.asarray(dm, np.float32) / 255
            out[pid] = {"path": f"{a['path']}/depth.webp", "mean": round(float(arr.mean()), 3),
                        "near": round(float(np.percentile(arr, 95)), 3)}
            made += 1
            self.log(f"{pid:28s} depth {dm.size[0]}x{dm.size[1]}  mean={out[pid]['mean']}")
        save_json(GEN / "depth.json", out)
        missing = [r["hero"] for r in regions if r["hero"] not in out]
        for m in missing:
            report.error(f"hero photo without depth map: {m}")
        report.stats = {"depth_maps": len(out), "generated": made, "reused": reused,
                        "model": "Depth Anything V2 Small (ONNX int8, Apache-2.0)"}
