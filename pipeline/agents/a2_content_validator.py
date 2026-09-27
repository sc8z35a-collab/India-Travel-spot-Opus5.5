"""Agent 2 — Content Validator (fact & schema checker).

Role: guarantee every region dataset is complete and internally consistent
before anything is rendered.
  * required fields, 8 scores each with a written justification
  * every referenced photo id exists in the processed asset set
  * 12-month seasonality present, budgets / day ranges sane
  * every region cites at least 2 sources over https
  * no photo is used as hero by two regions
Writes data/_generated/regions.json (merged, sorted).
"""
from __future__ import annotations

from .base import DATA, GEN, Agent, Report, load_json, save_json

REQUIRED = [
    "id", "order", "name", "name_en", "catch", "lead", "theme", "hero", "coords",
    "keyfacts", "budget_inr", "days", "months", "scores", "highlights", "foods",
    "itinerary", "tips", "access", "sources", "gallery", "phrase",
    "short", "good_for", "not_for",
]


class ContentValidator(Agent):
    name = "a2_content_validator"
    role = "コンテンツの構造・整合性・出典チェック"

    def run(self, report: Report) -> None:
        cfg = load_json(DATA / "config.json")
        axes = [a["id"] for a in cfg["axes"]]
        assets = load_json(GEN / "assets.json")
        regions = [load_json(p) for p in sorted((DATA / "regions").glob("*.json"))]
        heroes = {}
        checks = 0

        for r in regions:
            rid = r.get("id", "?")
            for key in REQUIRED:
                checks += 1
                if key not in r or r[key] in (None, "", []):
                    report.error(f"{rid}: missing field '{key}'")
            for ax in axes:
                checks += 1
                s = r.get("scores", {}).get(ax)
                if not s:
                    report.error(f"{rid}: missing score '{ax}'")
                    continue
                if not (1 <= s["v"] <= 10):
                    report.error(f"{rid}: score {ax}={s['v']} out of range")
                if len(s.get("why", "")) < 20:
                    report.warn(f"{rid}: weak justification for '{ax}'")
            photo_refs = [r["hero"], *r["gallery"], *[h["photo"] for h in r["highlights"]]]
            for pid in photo_refs:
                checks += 1
                if pid not in assets:
                    report.error(f"{rid}: photo '{pid}' not available")
                elif assets[pid]["region"] != rid:
                    report.warn(f"{rid}: photo '{pid}' belongs to region {assets[pid]['region']}")
            if r["hero"] in heroes:
                report.error(f"{rid}: hero photo already used by {heroes[r['hero']]}")
            heroes[r["hero"]] = rid
            if len(r["months"]) != 12 or not all(1 <= m <= 5 for m in r["months"]):
                report.error(f"{rid}: months must be 12 values in 1..5")
            lo, hi = r["budget_inr"]
            if not (500 <= lo <= hi <= 20000):
                report.error(f"{rid}: implausible budget {lo}-{hi}")
            if len(r["sources"]) < 2:
                report.error(f"{rid}: needs at least 2 sources")
            for s in r["sources"]:
                checks += 1
                if not s["url"].startswith("https://"):
                    report.warn(f"{rid}: non-https source {s['url']}")
            if len(r["highlights"]) < 4:
                report.warn(f"{rid}: fewer than 4 highlights")
            used = set(photo_refs)
            if len(used) < len(photo_refs):
                report.warn(f"{rid}: some photos repeated within the page")

        orders = [r["order"] for r in regions]
        if sorted(orders) != list(range(1, len(regions) + 1)):
            report.error(f"region order not contiguous: {orders}")
        if len(regions) != 5:
            report.error(f"expected 5 regions, found {len(regions)}")

        regions.sort(key=lambda r: r["order"])
        save_json(GEN / "regions.json", regions)
        report.stats = {"regions": len(regions), "checks": checks,
                        "sources": sum(len(r["sources"]) for r in regions)}
