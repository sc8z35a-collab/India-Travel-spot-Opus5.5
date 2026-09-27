#!/usr/bin/env python3
"""Mobile visual QA: capture iPhone-class screenshots of every page section.

    python3 pipeline/mobile_shots.py [base_url] [out_dir]

Emulates a 390x844 touch device (DPR 2), scrolls through the page so lazy
images / reveal animations fire, then saves viewport-sized slices plus a
report of horizontal overflow and console errors.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else ".cache/shots")
PAGES = sys.argv[3].split(",") if len(sys.argv) > 3 else ["index.html"]
OUT.mkdir(parents=True, exist_ok=True)

OVERFLOW_JS = """() => {
  const W = document.documentElement.clientWidth, bad = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > W + 1 || r.left < -1)) {
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { clipped = true; break; }
        p = p.parentElement;
      }
      if (!clipped && getComputedStyle(el).position !== 'fixed') bad.push((el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    }
  });
  return {scrollW: document.documentElement.scrollWidth, W, bad: bad.slice(0, 15)};
}"""

SMALL_TAP_JS = """() => {
  const out = [];
  document.querySelectorAll('a, button, input, [role=tab], [tabindex="0"]').forEach(el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (!r.width || s.visibility === 'hidden' || s.display === 'none') return;
    if (el.closest('.credit, .credit-list, .sources, .footer, .gallery-credits, .hero-credit')) return;
    if (r.height < 36 && r.width < 36) out.push((el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  return out.slice(0, 20);
}"""


def main() -> None:
    report = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                            is_mobile=True, has_touch=True,
                            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
        for page_path in PAGES:
            pg = ctx.new_page()
            errors = []
            pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto(BASE + page_path, wait_until="networkidle")
            pg.wait_for_timeout(2500)
            h = pg.evaluate("document.documentElement.scrollHeight")
            y, i = 0, 0
            slug = page_path.replace("/index.html", "").replace(".html", "").replace("/", "_") or "index"
            while y < h and i < 60:
                pg.evaluate(f"window.scrollTo(0,{y})")
                pg.wait_for_timeout(900)
                pg.screenshot(path=str(OUT / f"{slug}_{i:02d}.jpg"), type="jpeg", quality=60)
                y += 800
                i += 1
                h = pg.evaluate("document.documentElement.scrollHeight")
            report[page_path] = {"height": h, "shots": i, "errors": errors,
                                 "overflow": pg.evaluate(OVERFLOW_JS), "small_taps": pg.evaluate(SMALL_TAP_JS)}
            pg.close()
        b.close()
    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
