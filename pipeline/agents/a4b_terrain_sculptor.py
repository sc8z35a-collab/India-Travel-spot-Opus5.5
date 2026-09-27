"""Task — Terrain Sculptor (owned by agent ② World Builder).

Role: build a real 3D relief of the Indian subcontinent for the WebGL map.
  * Elevation: AWS Terrain Tiles (Mapzen "terrarium" encoding, derived from
    SRTM / GMTED / ETOPO — public domain / open data), zoom 5.
  * Projected to the same equirectangular frame as the 2D map
    (cos(22°) correction) and resampled to a square heightmap.
  * A land mask is rasterised from the Natural Earth outline so India glows
    and neighbouring land is dimmed.
  * A hypsometric colour texture (plains → deserts → Deccan → Himalaya snow)
    with hill-shading is baked offline so the phone GPU only has to displace
    and light.

Outputs dist/assets/terrain/height.png  (16-bit-in-RG PNG, 1024²)
        dist/assets/terrain/color.jpg   (2048², baked hillshade)
        dist/assets/terrain/mask.png
        data/_generated/terrain.json    (bounds, pin UVs, max elevation)
"""
from __future__ import annotations

import io
import math
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFilter

from .base import CACHE, DIST, GEN, Agent, Report, load_json, save_json

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
Z = 5
# geographic window (lon/lat) — India + Himalaya + Sri Lanka
LON0, LON1 = 66.0, 99.0
LAT0, LAT1 = 5.0, 38.0
COSLAT = math.cos(math.radians(22))
HN = 1024          # heightmap resolution
CN = 2048          # colour texture resolution


def _tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


class TerrainSculptor(Agent):
    name = "a4b_terrain_sculptor"
    role = "実標高データ(SRTM系)からインド亜大陸の3D地形(高さ・陰影・マスク)を生成"

    def tile(self, x, y):
        p = CACHE / "terrain" / f"{Z}_{x}_{y}.png"
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            r = requests.get(TILE_URL.format(z=Z, x=x, y=y), timeout=60)
            r.raise_for_status()
            p.write_bytes(r.content)
        im = np.asarray(Image.open(p).convert("RGB"), np.float32)
        return (im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256) - 32768

    def mosaic(self):
        x0, y0 = _tile_xy(LON0, LAT1, Z)
        x1, y1 = _tile_xy(LON1, LAT0, Z)
        xs, ys = range(int(x0), int(x1) + 1), range(int(y0), int(y1) + 1)
        with ThreadPoolExecutor(8) as pool:
            tiles = {k: v for k, v in zip([(x, y) for y in ys for x in xs],
                                           pool.map(lambda t: self.tile(*t), [(x, y) for y in ys for x in xs]))}
        big = np.vstack([np.hstack([tiles[(x, y)] for x in xs]) for y in ys])
        return big, xs.start, ys.start

    def run(self, report: Report) -> None:
        big, tx0, ty0 = self.mosaic()
        # sample the mercator mosaic on our equirectangular grid
        W = (LON1 - LON0) * COSLAT
        H = LAT1 - LAT0
        side = max(W, H)
        cx, cy = (LON0 * COSLAT + LON1 * COSLAT) / 2, (LAT0 + LAT1) / 2
        u = np.linspace(-side / 2, side / 2, HN)
        v = np.linspace(side / 2, -side / 2, HN)
        UU, VV = np.meshgrid(u, v)
        lon = (UU + cx) / COSLAT
        lat = VV + cy
        n = 2 ** Z
        px = ((lon + 180) / 360 * n - tx0) * 256
        py = ((1 - np.arcsinh(np.tan(np.radians(np.clip(lat, -85, 85)))) / math.pi) / 2 * n - ty0) * 256
        px = np.clip(px, 0, big.shape[1] - 1.001)
        py = np.clip(py, 0, big.shape[0] - 1.001)
        ix, iy = px.astype(int), py.astype(int)
        fx, fy = px - ix, py - iy
        e = (big[iy, ix] * (1 - fx) * (1 - fy) + big[iy, ix + 1] * fx * (1 - fy)
             + big[iy + 1, ix] * (1 - fx) * fy + big[iy + 1, ix + 1] * fx * fy)

        # ---- land mask of India from Natural Earth -----------------------
        geo = load_json(CACHE / "ne_50m_countries.geojson")
        india = next(f for f in geo["features"] if f["properties"].get("ADM0_A3") == "IND")
        g = india["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]

        def to_px(lo, la, N):
            return ((lo * COSLAT - cx + side / 2) / side * N, (cy + side / 2 - la) / side * N)

        mask = Image.new("L", (CN, CN), 0)
        dr = ImageDraw.Draw(mask)
        for poly in polys:
            dr.polygon([to_px(lo, la, CN) for lo, la in poly[0]], fill=255)
        mask_soft = mask.filter(ImageFilter.GaussianBlur(3))

        # ---- height PNG (metres, 0..9000 → 16-bit packed in R,G) ----------
        e = np.clip(e, -200, 9000)
        land = np.maximum(e, 0)
        emax = float(land.max())
        q = np.clip(land / 9000 * 65535, 0, 65535).astype(np.uint16)
        rg = np.zeros((HN, HN, 3), np.uint8)
        rg[..., 0] = q >> 8
        rg[..., 1] = q & 255
        rg[..., 2] = (e < 0) * 255  # sea flag
        out = DIST / "assets" / "terrain"
        out.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rg, "RGB").save(out / "height.png", optimize=True)

        # ---- baked colour: hypsometric tint × hillshade -------------------
        eh = np.asarray(Image.fromarray(land.astype(np.float32), "F").resize((CN, CN), Image.BICUBIC))
        sea = np.asarray(Image.fromarray((e < 0).astype(np.uint8) * 255).resize((CN, CN), Image.BILINEAR)) > 127
        eh = eh.astype(np.float32)
        gy, gx = [g.astype(np.float32) for g in np.gradient(eh * np.float32(0.012))]
        az, alt = math.radians(315), math.radians(38)
        slope = np.arctan(np.hypot(gx, gy)).astype(np.float32)
        aspect = np.arctan2(-gx, gy).astype(np.float32)
        del gx, gy
        shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
        shade = np.clip(shade, 0, 1).astype(np.float32)
        del slope, aspect
        stops = np.array([0, 150, 400, 900, 1800, 3200, 4600, 5600, 9000], np.float32)
        cols = np.array([[46, 58, 34], [84, 86, 44], [126, 108, 62], [150, 118, 72], [132, 96, 66],
                         [112, 90, 80], [150, 142, 138], [228, 228, 234], [252, 252, 255]], np.float32)
        tint = np.stack([np.interp(eh, stops, cols[:, c]).astype(np.float32) for c in range(3)], -1)
        m = np.asarray(mask_soft, np.float32)[..., None] / 255
        rgb = tint * (0.35 + 0.95 * shade[..., None])
        rgb = rgb * (0.32 + 0.68 * m)                           # neighbours dimmed
        ocean = np.array([8, 14, 22], np.float32)
        depthy = np.clip(-np.asarray(Image.fromarray(e.astype(np.float32), "F").resize((CN, CN))) / 4000, 0, 1)[..., None]
        rgb = np.where(sea[..., None], ocean * (1 - 0.5 * depthy) + np.array([4, 10, 16]) * shade[..., None], rgb)
        Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(out / "color.jpg", quality=90, optimize=True,
                                                                     progressive=True)
        # border glow line (saffron) as separate mask → shader emissive
        edge = mask.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
        Image.merge("RGB", (mask_soft.resize((1024, 1024)), edge.resize((1024, 1024)),
                            Image.new("L", (1024, 1024)))).save(out / "mask.png", optimize=True)

        regions = load_json(GEN / "regions.json")
        pins = []
        for r in regions:
            x, y = to_px(r["coords"]["lon"], r["coords"]["lat"], 1.0)
            ix_, iy_ = int(x * (HN - 1)), int(y * (HN - 1))
            pins.append({"id": r["id"], "u": round(x, 4), "v": round(y, 4), "elev": round(float(land[iy_, ix_]), 1)})
        save_json(GEN / "terrain.json", {"side_deg": side, "max_elev": emax, "height_scale_m": 9000,
                                          "pins": pins, "delhi": [round(c, 4) for c in to_px(77.21, 28.61, 1.0)],
                                          "tokyo_dir": [1, -0.35],
                                          "source": "AWS Terrain Tiles (SRTM/GMTED/ETOPO, open data) + Natural Earth"})
        report.stats = {"height_px": HN, "color_px": CN, "max_elev_m": round(emax), "pins": len(pins),
                        "tiles": int(big.size / 65536)}
        if emax < 6000:
            report.error(f"Himalaya missing? max elevation {emax:.0f} m")
