"""Agent 1 — Asset Curator.

Role: download every licensed photo listed in data/photos.json (preferring the
largest available original — ``hires`` — discovered by
``pipeline.tools.photo_sources``), validate licence metadata and produce a
responsive, high-fidelity image set:

  * widths 640 / 960 / 1280 / 1920 / 2560 (+3200 for heroes & gallery),
    never upscaled beyond the source
  * AVIF + WebP for every width; progressive JPEG fallback up to 1920
  * a tiny blurred base64 LQIP placeholder and dominant colour

Processing is incremental: each photo keeps a ``meta.json`` signature in its
output dir, so unchanged photos are skipped on rebuild.
Writes data/_generated/assets.json consumed by the builder.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import statistics
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from PIL import Image, ImageFilter, ImageOps

from .base import CACHE, DIST, GEN, DATA, Agent, Report, load_json, save_json

VERSION = 3
WIDTHS = [640, 960, 1280, 1920, 2560]
XL = 3200                 # extra width for full-bleed heroes / gallery lead
JPEG_MAX = 1920           # JPEG is only a legacy fallback
SOURCE_CAP = 3840         # decode cap (keeps memory sane on 6k originals)
MIN_SOURCE_WIDTH = 1500
HEADERS = {"User-Agent": "IndiaJourneysBuild/2.0 (static travel guide build; contact via GitHub)"}
Image.MAX_IMAGE_PIXELS = 400_000_000
PHOTO_CACHE = CACHE / "photos"
PHOTO_CACHE.mkdir(parents=True, exist_ok=True)


class _RateLimited(Exception):
    def __init__(self, msg: str, wait: float):
        super().__init__(msg)
        self.wait = wait


def _has_avif() -> bool:
    try:
        buf = io.BytesIO()
        Image.new("RGB", (8, 8)).save(buf, "AVIF")
        return True
    except Exception:  # noqa: BLE001
        return False


def _large_ids() -> set[str]:
    ids: set[str] = set()
    for f in sorted((DATA / "regions").glob("*.json")):
        r = json.loads(f.read_text(encoding="utf-8"))
        ids.add(r["hero"])
        ids.update(r.get("gallery", [])[:1])
    return ids


class AssetCurator(Agent):
    name = "a1_asset_curator"
    role = "写真の取得・検証・高解像度レスポンシブ最適化 (AVIF/WebP/JPEG, LQIP, 主色抽出, 帰属表示)"

    def fetch(self, url: str) -> bytes:
        key = hashlib.sha1(url.encode()).hexdigest()[:20]
        cached = PHOTO_CACHE / f"{key}.bin"
        if cached.exists() and cached.stat().st_size > 10_000:
            return cached.read_bytes()
        last = None
        tries = 2 if "wikimedia.org" in url else 4  # Commons blocks bursts for minutes; fail over fast
        for attempt in range(tries):
            try:
                r = requests.get(url, headers=HEADERS, timeout=120)
                if r.status_code in (429, 503) or (r.status_code == 403 and "Too Many" in r.reason):
                    wait = float(r.headers.get("Retry-After", 0) or 0) or 5 * 2 ** attempt
                    raise _RateLimited(f"rate limited ({r.status_code}), retry in {wait:.0f}s", wait)
                r.raise_for_status()
                if len(r.content) < 10_000:
                    raise RuntimeError(f"suspiciously small response ({len(r.content)} B)")
                cached.write_bytes(r.content)
                return r.content
            except _RateLimited as exc:
                last = exc
                time.sleep(min(exc.wait, 30))
            except Exception as exc:  # noqa: BLE001
                last = exc
                time.sleep(2)
        raise RuntimeError(f"{url}: {last}")

    def source(self, photo: dict) -> tuple[Image.Image, int, int, bool]:
        """Open the larger of hires/url. Returns (image capped, native w, native h)."""
        best, partial = None, False
        cands = [u for u in (photo.get("hires"), photo["url"]) if u]
        for u in list(cands):  # Commons thumb rate-limited → the original file is a fallback
            m = re.match(r"(https://upload\.wikimedia\.org/wikipedia/commons)/thumb(/\w/\w\w/[^/]+)/[^/]+$",
                         u.replace("thumb.wikimedia.org", "upload.wikimedia.org"))
            if m:
                cands.append(m.group(1) + m.group(2))
        for url in dict.fromkeys(cands):
            if best is not None and "/thumb/" not in url and "wikimedia" in url and best[1][0] >= 3000:
                continue  # already have a good thumb; skip the (huge) original
            try:
                raw = self.fetch(url)
                im = Image.open(io.BytesIO(raw))
                size = im.size
                if best is None or size[0] * size[1] > best[1][0] * best[1][1]:
                    best = (raw, size)
            except Exception as exc:  # noqa: BLE001
                partial = True  # a candidate failed → don't cache; retry on next build
                self.log(f"{photo['id']}: source failed {url[:80]} — {exc}")
        if best is None:
            raise RuntimeError("no downloadable source")
        im = Image.open(io.BytesIO(best[0]))
        if max(im.size) > SOURCE_CAP * 1.5 and im.format == "JPEG":
            im.draft("RGB", (SOURCE_CAP, SOURCE_CAP))
        im = ImageOps.exif_transpose(im).convert("RGB")
        nw, nh = im.size
        if nw > SOURCE_CAP:
            im = im.resize((SOURCE_CAP, round(nh * SOURCE_CAP / nw)), Image.LANCZOS)
        return im, nw, nh, partial

    def process(self, photo: dict, avif: bool, large: bool) -> dict:
        out_dir = DIST / "img" / photo["id"]
        out_dir.mkdir(parents=True, exist_ok=True)
        sig = hashlib.sha1(json.dumps([photo.get("hires"), photo["url"], avif, large, WIDTHS, XL,
                                       JPEG_MAX, VERSION]).encode()).hexdigest()
        meta_f = out_dir / "meta.json"
        if meta_f.exists():
            try:
                meta = json.loads(meta_f.read_text())
                if meta.get("sig") == sig and all((out_dir / f"{w}.webp").exists() for w in meta["variants"]):
                    return {**self.public(photo), **meta["data"], "cached": True}
            except Exception:  # noqa: BLE001
                pass

        old_src = None
        if meta_f.exists():
            try:
                old_src = json.loads(meta_f.read_text()).get("src")
            except Exception:  # noqa: BLE001
                pass
        used_fb = False
        try:
            img, nw, nh, partial = self.source(photo)
        except RuntimeError:
            fb = photo.get("fallback")
            if not fb:
                raise
            # primary (usually Wikimedia, rate-limited) unavailable → previous licensed photo, not cached
            self.log(f"{photo['id']}: using fallback source {fb['source']}")
            photo = {**photo, **fb, "hires": None}
            img, nw, nh, _ = self.source(photo)
            partial = used_fb = True
        src_key = [photo.get("hires"), photo["url"]]  # the source actually used (depth map follows it)
        w, h = img.size
        targets = WIDTHS + ([XL] if large else [])
        widths = [x for x in targets if x <= w]
        if not widths or (w < targets[-1] and w - widths[-1] > 200):
            widths.append(w)  # keep the native resolution too
        jpg = [x for x in widths if x <= JPEG_MAX] or [widths[0]]

        keep = {"meta.json", "depth.webp"}
        for tw in widths:
            th = round(h * tw / w)
            im = img if tw == w else img.resize((tw, th), Image.LANCZOS)
            base = out_dir / f"{tw}"
            big = tw > 1920
            im.save(f"{base}.webp", "WEBP", quality=80 if big else 84, method=6)
            keep.add(f"{tw}.webp")
            if avif:
                im.save(f"{base}.avif", "AVIF", quality=58 if big else 64, speed=6)
                keep.add(f"{tw}.avif")
            if tw in jpg:
                im.save(f"{base}.jpg", "JPEG", quality=85, optimize=True, progressive=True)
                keep.add(f"{tw}.jpg")
        for f in out_dir.iterdir():
            if f.name not in keep:
                f.unlink()
        depth = out_dir / "depth.webp"
        if depth.exists() and old_src not in (None, src_key):
            depth.unlink()  # different photo → depth map must be re-inferred
        elif depth.exists():
            os.utime(depth)  # sources unchanged in content → keep depth map fresh for a1b

        small = img.resize((24, max(1, round(24 * h / w))), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
        buf = io.BytesIO()
        small.save(buf, "WEBP", quality=40)
        dom = img.resize((1, 1), Image.BOX).getpixel((0, 0))
        data = {
            "width": w, "height": h, "source_width": nw, "source_height": nh,
            "ratio": round(w / h, 4), "variants": widths, "jpg": jpg, "avif": avif,
            "lqip": "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode(),
            "color": "#%02x%02x%02x" % dom, "path": f"img/{photo['id']}",
        }
        meta_f.write_text(json.dumps({"sig": "partial" if partial else sig, "src": src_key, "variants": widths, "data": data}))
        return {**self.public(photo), **data, "cached": False, "fallback_used": used_fb}

    @staticmethod
    def public(photo: dict) -> dict:
        return {k: v for k, v in photo.items() if k not in ("url", "hires", "fallback")}

    def run(self, report: Report) -> None:
        photos = load_json(DATA / "photos.json")["photos"]
        avif = _has_avif()
        if not avif:
            report.warn("AVIF encoder unavailable — falling back to WebP/JPEG only")
        ids = [p["id"] for p in photos]
        if len(ids) != len(set(ids)):
            report.error("duplicate photo ids in photos.json")
        for p in photos:
            if not p.get("license"):
                report.error(f"{p['id']}: missing license metadata (run python3 -m pipeline.tools.photo_sources)")
        large = _large_ids()

        results, failed = {}, []

        def job(p):
            try:
                return p["id"], self.process(p, avif, p["id"] in large), None
            except Exception as exc:  # noqa: BLE001
                return p["id"], None, str(exc)

        with ThreadPoolExecutor(max_workers=2) as pool:
            for pid, res, err in pool.map(job, photos):
                if err:
                    failed.append(pid)
                    report.warn(f"{pid}: download/process failed — {err}")
                    continue
                if res["source_width"] < MIN_SOURCE_WIDTH:
                    report.warn(f"{pid}: low source resolution {res['source_width']}px")
                if res.get("fallback_used"):
                    report.warn(f"{pid}: primary hi-res source unavailable — used fallback photo (retried next build)")
                results[pid] = {k: v for k, v in res.items() if k not in ("cached", "fallback_used")}
                self.log(f"{pid:24s} {res['source_width']}x{res['source_height']} → {res['variants']}"
                         f"{' (cached)' if res['cached'] else ''}")

        save_json(GEN / "assets.json", results)
        src = [r["source_width"] for r in results.values()] or [0]
        report.stats = {
            "requested": len(photos),
            "processed": len(results),
            "failed": failed,
            "avif": avif,
            "source_px_median": statistics.median(src),
            "source_px_min": min(src),
            "xl": sorted(large & set(results)),
            "files": sum(len(r["variants"]) * (2 if avif else 1) + len(r["jpg"]) for r in results.values()),
        }
        if len(results) < len(photos) * 0.8:
            report.error("more than 20% of photos failed")
