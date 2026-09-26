"""Agent 8 — QA Auditor.

Role: audit the built site like a strict reviewer before it ships.
  * HTML parses; exactly one <h1>; <title>, meta description, lang, OGP
  * every <img> has alt, width/height; every srcset file actually exists
  * every internal link / anchor resolves
  * external links open safely (rel=noopener)
  * heading order doesn't skip levels
  * page weight budget (HTML + above-the-fold hero)
  * no AI-generated imagery: all images must come from the curated asset set
Writes reports/a8_qa_auditor.json with a per-page score.
"""
from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urldefrag

from bs4 import BeautifulSoup

from .base import DIST, GEN, Agent, Report, load_json

HTML_BUDGET_KB = 220


class QaAuditor(Agent):
    name = "a8_qa_auditor"
    role = "完成サイトの品質監査（リンク切れ・画像・アクセシビリティ・SEO・容量）"

    def run(self, report: Report) -> None:
        assets = load_json(GEN / "assets.json")
        pages = sorted(DIST.glob("**/index.html"))
        ids_by_page: dict[Path, set] = {}
        soups = {}
        for p in pages:
            soup = BeautifulSoup(p.read_text(encoding="utf-8"), "html.parser")
            soups[p] = soup
            ids_by_page[p] = {el["id"] for el in soup.select("[id]")}

        per_page = {}
        total_checks = 0
        for p, soup in soups.items():
            rel = p.relative_to(DIST).as_posix()
            issues = []
            checks = 0

            def need(cond, msg):
                nonlocal checks
                checks += 1
                if not cond:
                    issues.append(msg)

            need(soup.html and soup.html.get("lang") == "ja", "missing lang=ja")
            need(soup.title and soup.title.string and len(soup.title.string) > 10, "missing/short <title>")
            md = soup.find("meta", attrs={"name": "description"})
            need(md and 50 <= len(md.get("content", "")) <= 200, "meta description length not 50-200")
            need(soup.find("meta", attrs={"property": "og:image"}) is not None, "missing og:image")
            need(len(soup.find_all("h1")) == 1, f"expected 1 h1, found {len(soup.find_all('h1'))}")

            # heading order
            last = 1
            for h in soup.find_all(re.compile(r"^h[1-6]$")):
                lvl = int(h.name[1])
                need(lvl <= last + 1, f"heading jump h{last}→h{lvl}: '{h.get_text(strip=True)[:30]}'")
                last = lvl

            # images
            for img in soup.find_all("img"):
                need(img.get("alt"), f"img without alt: {img.get('src')}")
                need(img.get("width") and img.get("height"), f"img without dimensions: {img.get('src')}")
                src = img.get("src", "")
                need(any(a["path"] in src for a in assets.values()), f"image not from curated set: {src}")
            for tag in soup.find_all(["img", "source"]):
                for part in (tag.get("srcset") or "").split(","):
                    url = part.strip().split(" ")[0]
                    if url:
                        need((p.parent / url).resolve().exists(), f"missing srcset file {url}")
                if tag.name == "img" and tag.get("src"):
                    need((p.parent / tag["src"]).resolve().exists(), f"missing img {tag['src']}")

            # links
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if href.startswith(("http://", "https://")):
                    if a.get("target") == "_blank":
                        need("noopener" in (a.get("rel") or []), f"external link without noopener: {href}")
                    continue
                if href.startswith(("mailto:", "tel:")):
                    continue
                path, frag = urldefrag(href)
                target = p if not path else (p.parent / path).resolve()
                need(target.exists(), f"broken link {href}")
                if frag and target.exists() and target in ids_by_page:
                    need(frag in ids_by_page[target], f"broken anchor {href}")

            # scripts / css exist
            for s in soup.find_all("script", src=True):
                need((p.parent / s["src"].split("?")[0]).resolve().exists(), f"missing script {s['src']}")
            for l in soup.find_all("link", rel="stylesheet"):
                href = l["href"]
                if not href.startswith("http"):
                    need((p.parent / href.split("?")[0]).resolve().exists(), f"missing css {href}")

            kb = p.stat().st_size / 1024
            need(kb < HTML_BUDGET_KB, f"HTML {kb:.0f}KB over budget {HTML_BUDGET_KB}KB")

            score = round(100 * (checks - len(issues)) / max(checks, 1), 1)
            per_page[rel] = {"checks": checks, "issues": issues[:30], "score": score, "html_kb": round(kb, 1)}
            total_checks += checks
            for i in issues[:10]:
                report.warn(f"{rel}: {i}")
            self.log(f"{rel:28s} {checks:5d} checks  score {score}%  {kb:.0f}KB")

        broken = [i for v in per_page.values() for i in v["issues"] if i.startswith(("broken", "missing"))]
        if broken:
            report.error(f"{len(broken)} broken references")
        report.stats = {"pages": len(pages), "checks": total_checks,
                        "issues": sum(len(v["issues"]) for v in per_page.values()), "per_page": per_page}
