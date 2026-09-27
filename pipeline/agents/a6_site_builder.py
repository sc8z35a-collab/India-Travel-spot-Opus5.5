"""Agent 6 — Site Builder.

Role: render every page from the templates + generated data, copy static
assets, inline structured data (JSON-LD), sitemap/robots, favicon and a
per-page JSON payload for the front-end.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import shutil

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .base import DATA, DIST, GEN, SRC, TEMPLATES, Agent, Report, load_json

NAV = [
    {"id": "regions", "label": "5地域"},
    {"id": "finder", "label": "診断"},
    {"id": "compare", "label": "比較"},
    {"id": "season", "label": "季節"},
    {"id": "prep", "label": "準備"},
]

# Region-page in-page tabs (mobile bottom bar)
RNAV = [
    {"id": "evaluation", "label": "評価"},
    {"id": "highlights", "label": "見どころ"},
    {"id": "itinerary", "label": "日程"},
    {"id": "food", "label": "食"},
    {"id": "access", "label": "注意"},
]

FAVICON = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    '<rect width="64" height="64" rx="14" fill="#0d0b0a"/>'
    '<g fill="none" stroke="#e8a24a" stroke-width="2.4">'
    + "".join(f'<ellipse cx="32" cy="18" rx="4" ry="13" transform="rotate({i*45} 32 32)"/>' for i in range(8))
    + '</g><circle cx="32" cy="32" r="5" fill="#e8a24a"/></svg>'
)


class SiteBuilder(Agent):
    name = "a6_site_builder"
    role = "テンプレートからHTML生成・静的アセット配置・構造化データ/サイトマップ出力"

    def run(self, report: Report) -> None:
        cfg = load_json(DATA / "config.json")
        assets = load_json(GEN / "assets.json")
        for a in assets.values():  # normalise attribution keys (templates run with StrictUndefined)
            for k in ("author", "license", "license_url", "title"):
                a.setdefault(k, "")
            if not a["license"]:
                report.error(f"{a['id']}: missing license")
        regions = load_json(GEN / "regions.json")
        analysis = load_json(GEN / "analysis.json")
        charts = load_json(GEN / "charts.json")
        mp = load_json(GEN / "map.json")
        depth = load_json(GEN / "depth.json") if (GEN / "depth.json").exists() else {}
        terrain = load_json(GEN / "terrain.json") if (GEN / "terrain.json").exists() else None
        if not depth:
            report.warn("no depth maps — WebGL hero will fall back to flat photos")

        # ---- static assets -------------------------------------------------
        (DIST / "assets" / "vendor").mkdir(parents=True, exist_ok=True)
        css = (SRC / "css" / "site.css").read_text(encoding="utf-8") + "\n" + \
            (SRC / "css" / "mobile.css").read_text(encoding="utf-8") + "\n" + \
            (SRC / "css" / "landscape.css").read_text(encoding="utf-8") + "\n" + \
            (SRC / "css" / "polish.css").read_text(encoding="utf-8")
        js = (SRC / "js" / "site.js").read_text(encoding="utf-8")
        (DIST / "assets" / "site.css").write_text(css, encoding="utf-8")
        (DIST / "assets" / "site.js").write_text(js, encoding="utf-8")
        for f in (SRC / "vendor").glob("*.js"):
            shutil.copy(f, DIST / "assets" / "vendor" / f.name)
        shutil.copytree(SRC / "vendor" / "three", DIST / "assets" / "vendor" / "three", dirs_exist_ok=True)
        gl = (SRC / "js" / "gl.js").read_text(encoding="utf-8")
        (DIST / "assets" / "gl.js").write_text(gl, encoding="utf-8")
        (DIST / "manifest.webmanifest").write_text(json.dumps({
            "id": "./", "name": cfg["site"]["title"], "short_name": "IN/5", "lang": "ja", "dir": "ltr",
            "description": cfg["site"]["description"], "start_url": "./", "scope": "./",
            "display": "fullscreen", "display_override": ["fullscreen", "standalone"],
            "orientation": "landscape", "background_color": "#0d0b0a", "theme_color": "#0d0b0a",
            "icons": [{"src": "og/icon-192.png", "sizes": "192x192", "type": "image/png"},
                      {"src": "og/icon-512.png", "sizes": "512x512", "type": "image/png"},
                      {"src": "og/icon-maskable-512.png", "sizes": "512x512", "type": "image/png",
                       "purpose": "maskable"}]},
            ensure_ascii=False), encoding="utf-8")
        (DIST / "favicon.svg").write_text(FAVICON, encoding="utf-8")
        (DIST / ".nojekyll").write_text("")
        build_id = hashlib.sha1((css + js + gl).encode()).hexdigest()[:10]

        env = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=True,
                          undefined=StrictUndefined, trim_blocks=True, lstrip_blocks=True)
        region_map = {r["id"]: r for r in regions}
        persona_map = {p["id"]: p for p in cfg["personas"]}
        from .a5_chart_designer import ramp

        season_ramp = [ramp(v, 1, 5) for v in range(1, 6)]
        min_daily = int(min(v["daily_jpy"][0] for v in analysis["regions"].values()))
        used_ids = sorted({r["hero"] for r in regions}
                          | {g for r in regions for g in r["gallery"]}
                          | {h["photo"] for r in regions for h in r["highlights"]})
        credit_list = [assets[i] for i in used_ids]

        front = {
            "axes": cfg["axes"], "personas": cfg["personas"],
            "analysis": analysis, "radar": charts["radar_js"],
            "regions": [{"id": r["id"], "name": r["name"], "short": r["short"], "en": r["name_en"], "catch": r["catch"],
                         "order": r["order"], "state": r["state"], "facts": r["keyfacts"],
                         "balanced": analysis["regions"][r["id"]]["balanced"],
                         "accent": r["theme"]["accent"], "months": r["months"],
                         "scores": {k: v["v"] for k, v in r["scores"].items()},
                         "hero": assets[r["hero"]]["path"], "heroId": r["hero"], "url": f"{r['id']}/index.html"}
                        for r in regions],
            "holidays": cfg["holidays"], "h2h": analysis["h2h"],
            "depth": {k: v["path"] for k, v in depth.items()},
            "terrain": {"pins": terrain["pins"], "delhi": terrain["delhi"]} if terrain else None,
            "assets": {k: {"path": v["path"], "variants": v["variants"], "jpg": v.get("jpg", v["variants"]),
                           "alt": v["alt"], "avif": v["avif"], "w": v["width"], "h": v["height"],
                           "color": v["color"], "link": v["link"],
                           "credit": f"{v.get('author') or v['source']} · {v.get('license', '')}".rstrip(" ·")}
                       for k, v in assets.items() if k in used_ids},
        }

        common = dict(
            site=cfg["site"], currency=cfg["currency"], axes=cfg["axes"], personas=cfg["personas"],
            holidays=cfg["holidays"],
            holiday_months=sorted({m for h in cfg["holidays"].values() for m in h["months"]}), facts=cfg["global_facts"], assets=assets, regions=regions,
            region_map=region_map, persona_map=persona_map, analysis=analysis, charts=charts, map=mp,
            nav=NAV, year=dt.date.today().year, build_id=build_id, season_ramp=season_ramp,
            min_daily_jpy=min_daily, credit_list=credit_list, rnav=RNAV,
            axes_map={a["id"]: a for a in cfg["axes"]}, terrain=terrain,
            robust_order=sorted(regions, key=lambda r: -analysis["regions"][r["id"]]["robust"]["win"]),
        )

        pages = 0
        # ---- index ---------------------------------------------------------
        ld_index = {
            "@context": "https://schema.org", "@type": "ItemList",
            "name": cfg["site"]["title_ja"],
            "itemListElement": [
                {"@type": "ListItem", "position": r["order"],
                 "item": {"@type": "TouristDestination", "name": r["name"], "alternateName": r["name_en"],
                          "description": r["lead"], "url": cfg["site"]["base_url"] + r["id"] + "/",
                          "geo": {"@type": "GeoCoordinates", "latitude": r["coords"]["lat"],
                                  "longitude": r["coords"]["lon"]}}}
                for r in regions],
        }
        html = env.get_template("index.html").render(
            **common, root="", page_data=json.dumps({**front, "root": ""}, ensure_ascii=False),
            jsonld=json.dumps(ld_index, ensure_ascii=False))
        (DIST / "index.html").write_text(html, encoding="utf-8")
        pages += 1

        # ---- region pages --------------------------------------------------
        for i, r in enumerate(regions):
            nxt = regions[(i + 1) % len(regions)]
            ld = {"@context": "https://schema.org", "@type": "TouristDestination", "name": r["name"],
                  "alternateName": r["name_en"], "description": r["lead"],
                  "touristType": [p["label"] for p in cfg["personas"]
                                  if analysis["personas"][p["id"]]["rank"][r["id"]] <= 2],
                  "geo": {"@type": "GeoCoordinates", "latitude": r["coords"]["lat"], "longitude": r["coords"]["lon"]},
                  "image": cfg["site"]["base_url"] + assets[r["hero"]]["path"] + "/%d.jpg" % max(
                      [w for w in assets[r["hero"]].get("jpg", assets[r["hero"]]["variants"]) if w <= 1280]
                      or assets[r["hero"]].get("jpg", assets[r["hero"]]["variants"])[:1])}
            out = DIST / r["id"]
            out.mkdir(parents=True, exist_ok=True)
            html = env.get_template("region.html").render(
                **common, r=r, next_region=nxt, root="../",
                page_data=json.dumps({**front, "root": "../", "current": r["id"]}, ensure_ascii=False),
                jsonld=json.dumps(ld, ensure_ascii=False))
            (out / "index.html").write_text(html, encoding="utf-8")
            pages += 1

        # ---- sitemap / robots ---------------------------------------------
        base = cfg["site"]["base_url"]
        urls = [base] + [f"{base}{r['id']}/" for r in regions]
        today = cfg["site"].get("checked") or dt.date.today().isoformat()
        sm = ['<?xml version="1.0" encoding="UTF-8"?>',
              '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
        sm += [f"<url><loc>{u}</loc><lastmod>{today}</lastmod></url>" for u in urls]
        sm.append("</urlset>")
        (DIST / "sitemap.xml").write_text("\n".join(sm), encoding="utf-8")
        (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {base}sitemap.xml\n")

        report.stats = {"pages": pages, "build_id": build_id, "css_kb": round(len(css) / 1024, 1),
                        "js_kb": round(len(js) / 1024, 1), "gl_kb": round(len(gl) / 1024, 1), "depth_maps": len(depth), "photos_credited": len(credit_list)}
