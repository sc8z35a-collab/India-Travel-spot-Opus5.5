"""Agent 4 — Cartographer.

Role: generate a hand-crafted feeling, fully vector map of India from real
Natural Earth boundary data (public domain), project it, simplify it and
place the 5 destinations on it. Output is inline-able SVG path data so the
page can animate the outline drawing on scroll.

Note on borders: Natural Earth depicts de-facto boundaries; the site shows
only a stylised silhouette for orientation and states this in the footer.
"""
from __future__ import annotations

import math

import requests

from .base import CACHE, GEN, Agent, Report, load_json, save_json

NE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
    "geojson/ne_50m_admin_0_countries.geojson"
)
VIEW_W, VIEW_H = 600, 680
PAD = 24


def _rdp(points, eps):
    """Ramer–Douglas–Peucker polyline simplification."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-9
    idx, dmax = 0, 0.0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm
        if d > dmax:
            idx, dmax = i, d
    if dmax > eps:
        left = _rdp(points[: idx + 1], eps)
        right = _rdp(points[idx:], eps)
        return left[:-1] + right
    return [points[0], points[-1]]


class Cartographer(Agent):
    name = "a4_cartographer"
    role = "実測国境データからインド地図SVGを生成し5地域をプロット"

    def load_geo(self):
        cached = CACHE / "ne_50m_countries.geojson"
        if not cached.exists():
            r = requests.get(NE_URL, timeout=120)
            r.raise_for_status()
            cached.write_bytes(r.content)
        import json

        return json.loads(cached.read_text())

    def run(self, report: Report) -> None:
        geo = self.load_geo()
        india = next(
            f for f in geo["features"]
            if f["properties"].get("ADM0_A3") == "IND" or f["properties"].get("ISO_A3") == "IND"
        )
        geom = india["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]

        # Equirectangular projection with cos(lat0) correction — good enough at this scale.
        lat0 = math.radians(22)
        rings = [poly[0] for poly in polys]
        allpts = [(lon * math.cos(lat0), lat) for ring in rings for lon, lat in ring]
        minx = min(p[0] for p in allpts); maxx = max(p[0] for p in allpts)
        miny = min(p[1] for p in allpts); maxy = max(p[1] for p in allpts)
        scale = min((VIEW_W - 2 * PAD) / (maxx - minx), (VIEW_H - 2 * PAD) / (maxy - miny))
        offx = (VIEW_W - (maxx - minx) * scale) / 2
        offy = (VIEW_H - (maxy - miny) * scale) / 2

        def proj(lon, lat):
            x = (lon * math.cos(lat0) - minx) * scale + offx
            y = (maxy - lat) * scale + offy
            return round(x, 1), round(y, 1)

        paths, kept, raw = [], 0, 0
        for ring in rings:
            pts = [proj(lon, lat) for lon, lat in ring]
            raw += len(pts)
            if len(pts) < 8:
                continue
            area = abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2
            if area < 6:  # drop specks (tiny islands) — keeps the silhouette clean
                continue
            # RDP degenerates on closed rings (first == last point): split the
            # ring at its farthest point from the start and simplify each half.
            far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
            simp = _rdp(pts[: far + 1], 0.6)[:-1] + _rdp(pts[far:], 0.6)
            kept += len(simp)
            d = "M" + "L".join(f"{x},{y}" for x, y in simp) + "Z"
            paths.append({"d": d, "area": area})
        paths.sort(key=lambda p: -p["area"])

        regions = load_json(GEN / "regions.json")
        pins = []
        for r in regions:
            x, y = proj(r["coords"]["lon"], r["coords"]["lat"])
            pins.append({"id": r["id"], "x": x, "y": y, "label": r["name"], "en": r["name_en"], "order": r["order"]})
        # Tokyo direction arrow anchor (off-map, north-east)
        save_json(GEN / "map.json", {"w": VIEW_W, "h": VIEW_H, "paths": [p["d"] for p in paths], "pins": pins,
                                     "delhi": proj(77.21, 28.61)})
        report.stats = {"rings": len(paths), "points_raw": raw, "points_kept": kept,
                        "reduction": f"{100 - kept * 100 // max(raw, 1)}%"}
        if kept < 150:
            report.error(f"map outline too coarse ({kept} points) — simplification failed")
        for p in pins:
            if not (0 < p["x"] < VIEW_W and 0 < p["y"] < VIEW_H):
                report.error(f"pin {p['id']} off map")
