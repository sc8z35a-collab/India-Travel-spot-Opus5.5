"""Agent 7 — OG Designer.

Role: compose 1200x630 social-share (OGP) cards for the index and each
region from the real hero photos: cinematic crop, gradient grade, title
typography (Noto CJK if available) and photo credit.
"""
from __future__ import annotations

import glob
import math

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .base import DIST, GEN, Agent, Report, load_json

W, H = 1200, 630


def _font(size: int, bold: bool = True):
    pats = ["/usr/share/fonts/**/NotoSerifCJK*Bold*", "/usr/share/fonts/**/NotoSansCJK*Bold*",
            "/usr/share/fonts/**/*CJK*", "/usr/share/fonts/**/DejaVuSerif-Bold.ttf",
            "/usr/share/fonts/**/DejaVuSans-Bold.ttf"]
    for p in pats:
        hits = glob.glob(p, recursive=True)
        if hits:
            try:
                return ImageFont.truetype(hits[0], size)
            except Exception:  # noqa: BLE001
                continue
    return ImageFont.load_default()


def _cover(img: Image.Image) -> Image.Image:
    r = max(W / img.width, H / img.height)
    im = img.resize((round(img.width * r), round(img.height * r)), Image.LANCZOS)
    x = (im.width - W) // 2
    y = (im.height - H) // 2
    return im.crop((x, y, x + W, y + H))


def card(photo_path: str, title: str, sub: str, accent: str, credit: str, cjk_ok: bool) -> Image.Image:
    base = _cover(Image.open(photo_path).convert("RGB"))
    grad = Image.new("L", (W, H))
    gd = ImageDraw.Draw(grad)
    for y in range(H):
        gd.line([(0, y), (W, y)], fill=int(255 * min(1, max(0, (y - H * 0.25) / (H * 0.75))) ** 1.3))
    dark = Image.new("RGB", (W, H), (10, 8, 7))
    base = Image.composite(dark, base, grad)
    d = ImageDraw.Draw(base)
    d.rectangle([60, H - 250, 60 + 64, H - 246], fill=accent)
    d.text((60, H - 230), title, font=_font(92), fill=(255, 250, 240))
    d.text((62, H - 120), sub if cjk_ok else "", font=_font(34), fill=(235, 225, 210))
    d.text((W - 60, H - 40), credit, font=_font(16), fill=(200, 190, 180), anchor="rs")
    d.text((60, 50), "INDIA — 5 JOURNEYS", font=_font(22), fill=accent)
    return base


def icon(size: int, maskable: bool = False) -> Image.Image:
    """App icon: 8-petal saffron mandala on warm black (4x supersampled)."""
    S = size * 4
    im = Image.new("RGB", (S, S), (13, 11, 10))
    d = ImageDraw.Draw(im)
    c = S / 2
    sc = 0.62 if maskable else 0.86          # maskable safe zone = inner 80% circle
    R = S / 2 * sc
    if not maskable:
        d.ellipse([c - S * .49, c - S * .49, c + S * .49, c + S * .49], fill=(22, 18, 15))
    for i in range(8):
        a = math.pi * 2 * i / 8
        pts = []
        for t in range(0, 181, 6):
            u = math.radians(t)
            r = R * (0.34 + 0.66 * math.sin(u / 2))
            w = R * 0.21 * math.sin(u)
            x, y = r, w
            pts.append((c + x * math.cos(a) - y * math.sin(a), c + x * math.sin(a) + y * math.cos(a)))
        for t in range(180, -1, -6):
            u = math.radians(t)
            r = R * (0.34 + 0.66 * math.sin(u / 2))
            w = -R * 0.21 * math.sin(u)
            pts.append((c + r * math.cos(a) - w * math.sin(a), c + r * math.sin(a) + w * math.cos(a)))
        d.polygon(pts, fill=(232, 138, 44) if i % 2 == 0 else (201, 94, 42))
    d.ellipse([c - R * .30, c - R * .30, c + R * .30, c + R * .30], fill=(13, 11, 10))
    d.ellipse([c - R * .17, c - R * .17, c + R * .17, c + R * .17], fill=(244, 196, 98))
    return im.resize((size, size), Image.LANCZOS)


class OgDesigner(Agent):
    name = "a7_og_designer"
    role = "実写真から1200×630のOGP（SNS共有）画像を自動合成"

    def run(self, report: Report) -> None:
        assets = load_json(GEN / "assets.json")
        regions = load_json(GEN / "regions.json")
        f = _font(20)
        cjk_ok = "CJK" in getattr(f, "path", "")
        if not cjk_ok:
            report.warn("CJK font not found — Japanese subtitle omitted from OG cards")
        out = DIST / "og"
        out.mkdir(parents=True, exist_ok=True)

        def src(pid):
            a = assets[pid]
            return str(DIST / a["path"] / f"{a.get('jpg', a['variants'])[-1]}.jpg")

        def cr(pid):
            a = assets[pid]
            return f"Photo: {a.get('author') or a['source']} · {a.get('license', '')}".rstrip(" ·")

        first = regions[0]
        card(src(first["hero"]), "INDIA, five journeys.", "大学生のためのインド、5つの旅。",
             first["theme"]["accent"], cr(first["hero"]), cjk_ok
             ).save(out / "index.jpg", quality=86, optimize=True, progressive=True)
        for r in regions:
            card(src(r["hero"]), r["name_en"], f"{r['name']} — {r['catch']}", r["theme"]["accent"],
                 cr(r["hero"]), cjk_ok
                 ).save(out / f"{r['id']}.jpg", quality=86, optimize=True, progressive=True)
        icon(180).save(out / "touch-icon.png", optimize=True)
        icon(192).save(out / "icon-192.png", optimize=True)
        icon(512).save(out / "icon-512.png", optimize=True)
        icon(512, maskable=True).save(out / "icon-maskable-512.png", optimize=True)
        report.stats = {"cards": len(regions) + 1, "cjk_font": cjk_ok, "icons": 4}
