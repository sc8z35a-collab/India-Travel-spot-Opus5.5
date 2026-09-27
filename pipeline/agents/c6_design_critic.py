"""Task — Design Critic (owned by agent ⑥ QA Lead).

Consumes the landscape screenshots produced by a9 and scores each screen:
  * rule mode : luminance histogram (crushed blacks / blown highlights),
                visual busyness (edge density), dead-space ratio, colourfulness
                (Hasler–Süsstrunk), WebGL liveness reported by a9.
  * LLM mode  : additionally sends the numeric profile + a9 findings to the
                LLM art-director persona for prioritised design notes.
Writes reports/design_review.json. Warnings only — never blocks a build.
"""
from __future__ import annotations

import json

import numpy as np
from PIL import Image, ImageFilter

from .. import llm
from .base import REPORTS, Agent, Report, load_json, save_json


def profile(path) -> dict:
    im = Image.open(path).convert("RGB")
    im.thumbnail((640, 640))
    a = np.asarray(im, np.float32)
    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    rg, yb = a[..., 0] - a[..., 1], 0.5 * (a[..., 0] + a[..., 1]) - a[..., 2]
    colorful = float(np.hypot(rg.std(), yb.std()) + 0.3 * np.hypot(rg.mean(), yb.mean()))
    edges = np.asarray(im.convert("L").filter(ImageFilter.FIND_EDGES), np.float32)
    # dead space: 32px blocks with ~no variance
    g = lum[: lum.shape[0] // 32 * 32, : lum.shape[1] // 32 * 32]
    blocks = g.reshape(g.shape[0] // 32, 32, g.shape[1] // 32, 32).std(axis=(1, 3))
    return {"mean_lum": round(float(lum.mean()), 1), "crushed": round(float((lum < 6).mean()), 3),
            "blown": round(float((lum > 250).mean()), 3), "colorfulness": round(colorful, 1),
            "edge_density": round(float((edges > 40).mean()), 3), "dead_space": round(float((blocks < 2).mean()), 3)}


class DesignCritic(Agent):
    name = "c6_design_critic"
    role = "横画面スクリーンショットの画質・構図講評（LLMアートディレクター＋画像計測）"

    def run(self, report: Report) -> None:
        shots = sorted((REPORTS / "mobile").glob("*.jpg"))
        a9 = load_json(REPORTS / "a9_mobile_qa.json") if (REPORTS / "a9_mobile_qa.json").exists() else {}
        out = {"mode": "rule", "screens": {}}
        for s in shots:
            p = profile(s)
            notes = []
            if p["dead_space"] > 0.55:
                notes.append("余白（無地ブロック）が多い — 背景に奥行き要素を")
            if p["crushed"] > 0.35:
                notes.append("黒つぶれが多い — 露出/トーンマップを持ち上げる")
            if p["blown"] > 0.08:
                notes.append("白飛び — ブルーム強度を下げる")
            if p["colorfulness"] < 18:
                notes.append("色が単調 — 地域アクセント色を強める")
            out["screens"][s.stem] = {**p, "notes": notes}
            for n in notes:
                report.warn(f"{s.stem}: {n}")
        if llm.available() and out["screens"]:
            out["mode"] = "llm+rule"
            try:
                out["art_director"] = llm.chat(
                    "You are the art director of an award-winning immersive WebGL travel site viewed ONLY on "
                    "landscape full-screen Android flagships. Reply in Japanese with max 8 prioritised, concrete notes.",
                    json.dumps({"screens": out["screens"], "qa": a9.get("stats", {}).get("summary", {})},
                               ensure_ascii=False)[:12000])
            except Exception as e:  # noqa: BLE001
                out["art_director"] = f"error: {e}"[:200]
        save_json(REPORTS / "design_review.json", out)
        report.stats = {"mode": out["mode"], "screens": len(out["screens"]),
                        "avg_colorfulness": round(float(np.mean([v["colorfulness"] for v in out["screens"].values()])), 1)
                        if out["screens"] else 0}
