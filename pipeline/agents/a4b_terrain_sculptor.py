"""Task — Terrain Sculptor (OWNER: Agent C · World & Map).

Role: build a satellite-grade 3D relief of the Indian subcontinent for the WebGL map.
  * Elevation  : AWS Terrain Tiles (Mapzen "terrarium", SRTM / GMTED / ETOPO — open data),
                 zoom 7 (~1.2 km/px), land AND bathymetry, resampled to a 2048² heightmap.
  * Colour     : NASA Blue Marble Next Generation (public domain) via NASA GIBS WMS,
                 4096² — real surface reflectance (deserts, forests, Himalayan snow).
  * Night      : NASA Black Marble (VIIRS, public domain) via GIBS → city lights.
  * Water      : sea depth from ETOPO + Natural Earth lakes (Pangong Tso …) + a signed
                 coast-distance field (shallows, surf bands).
  * Rivers     : Natural Earth 10 m river centre-lines (Ganga, Yamuna, Indus, Brahmaputra …),
                 oriented downstream by elevation → glowing ribbons in the shader.
Projection: the same equirectangular frame as the 2D map (cos 22° correction) — a square
window `side` degrees tall centred on (82.5°E, 21.5°N).  EPSG:4326 WMS output with a
lon span of side/cos22 maps 1:1 onto it.

Outputs dist/assets/terrain/height.png  (2048², 16-bit height in R,G; B = water flag)
        dist/assets/terrain/color.jpg   (4096², satellite colour, graded)
        dist/assets/terrain/mask.png    (2048², R India mask, G border line)
        dist/assets/terrain/aux.png     (2048², R night lights, G water depth, B coast distance)
        dist/assets/terrain/extra.json  (projection, rivers, lakes, graticule)
        data/_generated/terrain.json    (bounds, pin UVs, max elevation)
Memory: processed in row strips in float32 (the sandbox has ~1 GB shared by 4 agents).
"""
from __future__ import annotations

import gc
import io
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFilter

from .base import CACHE, DIST, GEN, Agent, Report, load_json, save_json

Image.MAX_IMAGE_PIXELS = None
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
GIBS = ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
        "&LAYERS={layer}&STYLES=&CRS=EPSG:4326&BBOX={s},{w},{n},{e}&WIDTH={W}&HEIGHT={H}&FORMAT=image/jpeg")
NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
UA = {"User-Agent": "india-5-journeys/1.0 (student travel site; terrain build)"}
Z = 7
LON0, LON1 = 66.0, 99.0
LAT0, LAT1 = 5.0, 38.0
COSLAT = math.cos(math.radians(22))
HN = 2048          # heightmap resolution
CN = 4096          # satellite colour resolution
AN = 2048          # aux / mask resolution
RIVERS = {"Ganges", "Ganga", "Yamuna", "Indus", "Brahmaputra", "Godavari", "Krishna", "Narmada", "Kaveri",
          "Cauvery", "Mahanadi", "Chambal", "Ghaghara", "Gandak", "Kosi", "Sutlej", "Chenab", "Jhelum", "Ravi",
          "Beas", "Son", "Tapti", "Betwa", "Tungabhadra", "Shyok", "Zanskar", "Periyar", "Gomti", "Jamuna", "Padma",
          "Meghna", "Hooghly", "Bhagirathi", "Alaknanda", "Tsangpo", "Yarlung Zangbo", "Ramganga", "Sharda",
          "Penner", "Sabarmati", "Luni", "Mahi", "Bhima", "Wainganga", "Pranhita", "Indravati"}


def _tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def _get(url, path, timeout=180, tries=5):
    if path.exists() and path.stat().st_size > 0:
        return path.read_bytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    for k in range(tries):
        try:
            r = requests.get(url, timeout=timeout, headers=UA)
            r.raise_for_status()
            path.write_bytes(r.content)
            return r.content
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(2 ** k)


def _rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    d = b - a
    nrm = math.hypot(*d) or 1e-12
    P = np.array(pts[1:-1])
    dist = np.abs(d[1] * P[:, 0] - d[0] * P[:, 1] + b[0] * a[1] - b[1] * a[0]) / nrm
    i = int(dist.argmax())
    if dist[i] > eps:
        return _rdp(pts[: i + 2], eps)[:-1] + _rdp(pts[i + 1:], eps)
    return [pts[0], pts[-1]]


class TerrainSculptor(Agent):
    name = "a4b_terrain_sculptor"
    role = "実標高(SRTM系)+NASA衛星画像からインド亜大陸の3D地形(高さ・色・夜景・水深・川)を生成"

    # ---------------------------------------------------------------- geometry
    def setup(self):
        self.W = (LON1 - LON0) * COSLAT
        self.side = max(self.W, LAT1 - LAT0)
        self.cx = (LON0 + LON1) / 2 * COSLAT
        self.cy = (LAT0 + LAT1) / 2
        # full geographic extent of the square window
        self.lonA = (self.cx - self.side / 2) / COSLAT
        self.lonB = (self.cx + self.side / 2) / COSLAT
        self.latA, self.latB = self.cy - self.side / 2, self.cy + self.side / 2

    def to_uv(self, lo, la):
        return ((lo * COSLAT - self.cx + self.side / 2) / self.side, (self.cy + self.side / 2 - la) / self.side)

    # ---------------------------------------------------------------- elevation
    def tile(self, x, y):
        raw = _get(TILE_URL.format(z=Z, x=x, y=y), CACHE / "terrain" / f"{Z}_{x}_{y}.png", timeout=60)
        im = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), np.float32)
        return im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768

    def elevation(self):
        x0, y0 = _tile_xy(self.lonA, self.latB, Z)
        x1, y1 = _tile_xy(self.lonB, self.latA, Z)
        xs, ys = range(int(x0), int(x1) + 1), range(int(y0), int(y1) + 1)
        big = np.zeros((len(ys) * 256, len(xs) * 256), np.float32)
        jobs = [(x, y) for y in ys for x in xs]
        with ThreadPoolExecutor(6) as pool:
            for (x, y), t in zip(jobs, pool.map(lambda t: self.tile(*t), jobs)):
                big[(y - ys.start) * 256:(y - ys.start + 1) * 256, (x - xs.start) * 256:(x - xs.start + 1) * 256] = t
        n = 2 ** Z
        out = np.zeros((HN, HN), np.float32)
        u = np.linspace(-self.side / 2, self.side / 2, HN, dtype=np.float64)
        lon = (u + self.cx) / COSLAT
        px = np.clip((lon + 180) / 360 * n * 256 - xs.start * 256, 0, big.shape[1] - 1.001)
        ix = px.astype(np.int32); fx = (px - ix).astype(np.float32)
        for r0 in range(0, HN, 256):
            v = np.linspace(self.side / 2, -self.side / 2, HN, dtype=np.float64)[r0:r0 + 256]
            lat = np.clip(v + self.cy, -85, 85)
            py = (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * n * 256 - ys.start * 256
            py = np.clip(py, 0, big.shape[0] - 1.001)
            iy = py.astype(np.int32)[:, None]; fy = (py - iy[:, 0]).astype(np.float32)[:, None]
            a = big[iy, ix]; b = big[iy, ix + 1]; c = big[iy + 1, ix]; d = big[iy + 1, ix + 1]
            out[r0:r0 + 256] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
        tiles = len(jobs)
        del big
        gc.collect()
        return out, tiles

    # ---------------------------------------------------------------- GIBS imagery
    def gibs(self, layer, W, H, name):
        url = GIBS.format(layer=layer, s=self.latA, w=self.lonA, n=self.latB, e=self.lonB, W=W, H=H)
        raw = _get(url, CACHE / "gibs" / f"{name}_{W}.jpg", timeout=300)
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        if im.size != (W, H):
            im = im.resize((W, H), Image.LANCZOS)
        return im

    # ---------------------------------------------------------------- vectors
    def ne(self, name):
        p = CACHE / f"ne_{name}.geojson"
        return json.loads(_get(NE + f"ne_{name}.geojson", p, timeout=300))

    def run(self, report: Report) -> None:
        self.setup()
        out = DIST / "assets" / "terrain"
        out.mkdir(parents=True, exist_ok=True)

        # ---- country mask ------------------------------------------------
        geo = json.loads(_get(NE + "ne_50m_admin_0_countries.geojson", CACHE / "ne_50m_countries.geojson", timeout=300))
        india = next(f for f in geo["features"] if f["properties"].get("ADM0_A3") == "IND")
        g = india["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        mask = Image.new("L", (AN, AN), 0)
        dr = ImageDraw.Draw(mask)
        for poly in polys:
            dr.polygon([(u * AN, v * AN) for u, v in (self.to_uv(lo, la) for lo, la in poly[0])], fill=255)
        mask_soft = mask.filter(ImageFilter.GaussianBlur(4))
        edge = mask.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.4))
        Image.merge("RGB", (mask_soft, edge, Image.new("L", (AN, AN)))).save(out / "mask.png", optimize=True)

        # ---- lakes (Natural Earth 10 m) → water ---------------------------
        lakes_img = Image.new("L", (HN, HN), 0)
        lakes_meta = []
        try:
            lk = self.ne("10m_lakes")
            ld = ImageDraw.Draw(lakes_img)
            for f in lk["features"]:
                gg = f["geometry"]
                if not gg:
                    continue
                pl = gg["coordinates"] if gg["type"] == "MultiPolygon" else [gg["coordinates"]]
                for p in pl:
                    ring = p[0]
                    los = [c[0] for c in ring]; las = [c[1] for c in ring]
                    if max(los) < self.lonA or min(los) > self.lonB or max(las) < self.latA or min(las) > self.latB:
                        continue
                    ld.polygon([(u * HN, v * HN) for u, v in (self.to_uv(lo, la) for lo, la in ring)], fill=255)
                    nm = f["properties"].get("name") or ""
                    if nm and (max(los) - min(los)) > 0.2:
                        lakes_meta.append(nm)
        except Exception as e:  # lakes are a refinement, never a blocker
            report.warn(f"lakes skipped: {e}")
        lakes = np.asarray(lakes_img, np.uint8) > 127
        del lakes_img

        # ---- elevation -----------------------------------------------------
        e, ntiles = self.elevation()
        e = np.clip(e, -6000, 9000)
        sea = e < 0
        water = sea | lakes
        land = np.where(sea, 0, np.maximum(e, 0)).astype(np.float32)
        emax = float(land.max())
        q = np.clip(land / 9000 * 65535, 0, 65535).astype(np.uint16)
        rg = np.zeros((HN, HN, 3), np.uint8)
        rg[..., 0] = q >> 8
        rg[..., 1] = q & 255
        rg[..., 2] = water * 255
        Image.fromarray(rg, "RGB").save(out / "height.png", optimize=True)
        del rg, q
        gc.collect()

        # ---- aux: night lights / water depth / coast distance ---------------
        from scipy.ndimage import distance_transform_edt
        wa = np.asarray(Image.fromarray(water.astype(np.uint8) * 255).resize((AN, AN), Image.BILINEAR)) > 127
        d_in = distance_transform_edt(wa).astype(np.float32)      # inside water: distance to land
        d_out = distance_transform_edt(~wa).astype(np.float32)    # on land: distance to water
        sd = np.where(wa, -d_in, d_out)
        coast = np.clip(128 + sd * (127 / 64), 0, 255).astype(np.uint8)     # 128 = shoreline, ±64 px range
        del d_in, d_out, sd
        depth_m = np.asarray(Image.fromarray(np.where(sea, -e, 0).astype(np.float32), "F").resize((AN, AN), Image.BILINEAR))
        lake_a = np.asarray(Image.fromarray(lakes.astype(np.uint8) * 255).resize((AN, AN), Image.BILINEAR)) > 127
        depth = np.where(wa, 1 + np.sqrt(np.clip(depth_m, 0, 5000) / 5000) * 254, 0)
        depth = np.where(lake_a & ~(depth_m > 0), 18, depth).astype(np.uint8)   # lakes: shallow turquoise
        del depth_m, lake_a
        try:
            night = np.asarray(self.gibs("VIIRS_Black_Marble", AN, AN, "black_marble").convert("L"), np.float32)
            lights = np.clip((night - 42) * 1.9, 0, 255)
            lights = np.where(wa, lights * 0.25, lights).astype(np.uint8)       # no lights on the sea
            del night
        except Exception as ex:
            report.warn(f"Black Marble unavailable: {ex}")
            lights = np.zeros((AN, AN), np.uint8)
        Image.merge("RGB", [Image.fromarray(a) for a in (lights, depth, coast)]).save(out / "aux.png", optimize=True)
        del lights, depth, coast, wa
        gc.collect()

        # ---- satellite colour (Blue Marble NG) -------------------------------
        sat_src = "NASA Blue Marble NG"
        try:
            sat = self.gibs("BlueMarble_NextGeneration", CN, CN, "bmng")
            a = np.array(sat, np.uint8)            # 48 MB; graded in float strips of 256 rows (~12 MB each)
            del sat
            for r0 in range(0, CN, 256):
                s = a[r0:r0 + 256].astype(np.float32) / 255.0
                lum = (s @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
                s = lum + (s - lum) * 1.18                       # gentle saturation lift
                s = np.clip(s, 0, 1) ** 0.94                     # open shadows a little
                s = s * np.array([1.03, 1.0, 0.95], np.float32)  # warm (Mughal night palette)
                a[r0:r0 + 256] = (np.clip(s, 0, 1) * 255 + 0.5).astype(np.uint8)
            Image.fromarray(a).save(out / "color.jpg", quality=92, optimize=True, progressive=True, subsampling=0)
            del a
        except Exception as ex:
            # fallback: hypsometric tint (previous look)
            report.warn(f"Blue Marble unavailable ({ex}) — hypsometric fallback")
            sat_src = "hypsometric tint"
            stops = np.array([0, 150, 400, 900, 1800, 3200, 4600, 5600, 9000], np.float32)
            cols = np.array([[46, 58, 34], [84, 86, 44], [126, 108, 62], [150, 118, 72], [132, 96, 66],
                             [112, 90, 80], [150, 142, 138], [228, 228, 234], [252, 252, 255]], np.float32)
            tint = np.stack([np.interp(land, stops, cols[:, c]) for c in range(3)], -1)
            tint = np.where(water[..., None], np.array([10, 22, 34], np.float32), tint)
            Image.fromarray(tint.astype(np.uint8)).resize((CN, CN), Image.BICUBIC).save(out / "color.jpg", quality=90)
        gc.collect()

        # ---- rivers (downstream-oriented polylines in UV) ---------------------
        rivers = []
        try:
            rv = self.ne("10m_rivers_lake_centerlines")
            for f in rv["features"]:
                pr = f["properties"]
                nm = pr.get("name_en") or pr.get("name") or ""
                rank = pr.get("scalerank", 9) or 9
                if not (nm in RIVERS or rank <= 4):
                    continue
                gg = f["geometry"]
                if not gg:
                    continue
                lines = gg["coordinates"] if gg["type"] == "MultiLineString" else [gg["coordinates"]]
                for ln in lines:
                    uv = [self.to_uv(c[0], c[1]) for c in ln]
                    uv = [(u, v) for u, v in uv if -0.02 <= u <= 1.02 and -0.02 <= v <= 1.02]
                    if len(uv) < 2:
                        continue
                    uv = _rdp(uv, 0.0006)
                    hs = [land[min(HN - 1, max(0, int(v * (HN - 1)))), min(HN - 1, max(0, int(u * (HN - 1))))] for u, v in (uv[0], uv[-1])]
                    if hs[0] < hs[1]:
                        uv = uv[::-1]                               # start upstream
                    rivers.append({"n": nm, "r": int(rank), "p": [round(c, 5) for pt in uv for c in pt]})
        except Exception as ex:
            report.warn(f"rivers skipped: {ex}")

        save_json(out / "extra.json", {
            "side": round(self.side, 6), "cx": round(self.cx, 6), "cy": round(self.cy, 6), "coslat": round(COSLAT, 8),
            "lon": [round(self.lonA, 4), round(self.lonB, 4)], "lat": [round(self.latA, 4), round(self.latB, 4)],
            "rivers": rivers, "lakes": sorted(set(lakes_meta))[:40],
            "tropic": round(self.to_uv(82.5, 23.4367)[1], 5),
            "sources": {"elevation": "AWS Terrain Tiles (SRTM/GMTED/ETOPO)", "color": sat_src,
                        "night": "NASA Black Marble (VIIRS)", "vectors": "Natural Earth"},
        })

        regions = load_json(GEN / "regions.json")
        pins = []
        for r in regions:
            x, y = self.to_uv(r["coords"]["lon"], r["coords"]["lat"])
            ix_, iy_ = int(x * (HN - 1)), int(y * (HN - 1))
            pins.append({"id": r["id"], "u": round(x, 4), "v": round(y, 4), "elev": round(float(land[iy_, ix_]), 1)})
        save_json(GEN / "terrain.json", {"side_deg": self.side, "max_elev": emax, "height_scale_m": 9000,
                                          "pins": pins, "delhi": [round(c, 4) for c in self.to_uv(77.21, 28.61)],
                                          "tokyo_dir": [1, -0.35],
                                          "source": "AWS Terrain Tiles (SRTM/GMTED/ETOPO, open data) + NASA Blue Marble / Black Marble (GIBS, public domain) + Natural Earth"})
        report.stats = {"height_px": HN, "color_px": CN, "aux_px": AN, "max_elev_m": round(emax), "pins": len(pins),
                        "tiles": ntiles, "rivers": len(rivers), "color": sat_src}
        if emax < 6000:
            report.error(f"Himalaya missing? max elevation {emax:.0f} m")
