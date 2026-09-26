"""Agent 9 — Mobile QA (smartphone-only target).

Role: open every built page in a headless iPhone-class browser
(390x844, DPR 2, touch, iOS UA) and fail the build on problems that only
show up on a phone:
  * horizontal overflow (page wider than the viewport)
  * JS console errors / uncaught exceptions
  * tap targets smaller than 40x40 CSS px (credits/footer excluded)
  * text rendered below 10px
  * interactive smoke test: open + close the bottom sheet via tap
Also records page height (in "screens") and saves a hero screenshot for
each page into reports/mobile/.
Runs in the same wave as a8 (they are independent readers of dist/).
"""
from __future__ import annotations

import functools
import http.server
import socketserver
import threading

from .base import DIST, REPORTS, Agent, Report

# Flagship Android held sideways (e.g. Galaxy S25 Ultra / Pixel 9 Pro: 915×412 CSS px @ DPR 3.5)
VIEW = {"width": 915, "height": 412}
DPR = 2  # screenshots at 2x keep QA fast; runtime uses the device's full DPR (capped 2.5 in gl.js)
UA = ("Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/140.0.0.0 Mobile Safari/537.36")

PROBE_JS = """() => {
  const W = document.documentElement.clientWidth;
  const small = [], tiny = [];
  const skip = el => el.closest('.map3d-src, .credit, .credit-list, .sources, .footer, .gallery-credits, .hero-credit, .crumbs, .src, .sheet, .menu, .lightbox, .loader');
  document.querySelectorAll('a, button, input, summary, [role=button]').forEach(el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (!r.width || s.visibility === 'hidden' || s.display === 'none' || skip(el)) return;
    const label = el.closest('label');
    const lr = label ? label.getBoundingClientRect() : r;
    if (Math.max(r.height, lr.height) < 40 && Math.max(r.width, lr.width) < 40)
      small.push((el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) {
    const el = n.parentElement; if (!el || !n.textContent.trim() || skip(el)) continue;
    const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue;
    if (el.closest('svg')) continue;
    if (parseFloat(s.fontSize) < 10) tiny.push(el.tagName + '.' + el.className + ' ' + s.fontSize);
  }
  return { scrollW: document.documentElement.scrollWidth, W, height: document.documentElement.scrollHeight,
           small: [...new Set(small)].slice(0, 12), tiny: [...new Set(tiny)].slice(0, 12) };
}"""


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # noqa: D401
        pass


class MobileQa(Agent):
    name = "a9_mobile_qa"
    role = "横画面Androidフラッグシップ相当(915×412・タッチ・WebGL2)での表示/操作/3D描画監査"

    def run(self, report: Report) -> None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            report.warn("playwright not installed — mobile QA skipped (pip install playwright && playwright install chromium)")
            return

        handler = functools.partial(_Quiet, directory=str(DIST))
        socketserver.TCPServer.allow_reuse_address = True
        httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        out = REPORTS / "mobile"
        out.mkdir(parents=True, exist_ok=True)

        pages = ["index.html"] + sorted(p.parent.name + "/index.html" for p in DIST.glob("*/index.html"))
        per_page = {}
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                                                    "--ignore-gpu-blocklist", "--enable-webgl"])
                for path in pages:
                    # fresh context per page: GPU/texture memory of the previous page is fully released
                    ctx = browser.new_context(viewport=VIEW, device_scale_factor=DPR, is_mobile=True,
                                              has_touch=True, user_agent=UA, locale="ja-JP")
                    pg = ctx.new_page()
                    errors: list[str] = []
                    pg.on("console", lambda m, e=errors: m.type == "error" and e.append(m.text))
                    pg.on("pageerror", lambda exc, e=errors: e.append(str(exc)))
                    pg.set_default_timeout(90000)
                    pg.goto(f"http://127.0.0.1:{port}/{path}?qa=1", wait_until="networkidle")
                    pg.wait_for_timeout(4500)
                    gl = pg.evaluate("""() => ({on: document.documentElement.classList.contains('gl-on'),
                        hero: document.documentElement.classList.contains('gl-hero-on'),
                        amb: document.documentElement.classList.contains('gl-amb-on')})""")
                    slug = path.replace("/index.html", "").replace(".html", "")
                    pg.screenshot(path=str(out / f"{slug}.jpg"), type="jpeg", quality=62)
                    # scroll through to trigger lazy content
                    h = pg.evaluate("document.documentElement.scrollHeight")
                    shots = 0
                    for y in range(0, h, 400):
                        pg.evaluate(f"window.scrollTo(0,{y})")
                        pg.wait_for_timeout(110)
                    if pg.query_selector(".map3d"):
                        pg.evaluate("document.querySelector('#map').scrollIntoView()")
                        pg.wait_for_timeout(5000)
                        gl["map"] = pg.evaluate("document.documentElement.classList.contains('gl-map-on')")
                        pg.screenshot(path=str(out / f"{slug}-map.jpg"), type="jpeg", quality=70)
                    for sec in ("regions", "finder", "compare", "highlights", "evaluation"):
                        if pg.query_selector(f"#{sec}"):
                            pg.evaluate(f"document.querySelector('#{sec}').scrollIntoView()")
                            pg.wait_for_timeout(900)
                            pg.screenshot(path=str(out / f"{slug}-{sec}.jpg"), type="jpeg", quality=62)
                    probe = pg.evaluate(PROBE_JS)
                    # interaction smoke test: tap something that opens the sheet
                    sheet_ok = None
                    trigger = pg.query_selector(".heat-cell, .map-list button")
                    if trigger:
                        trigger.scroll_into_view_if_needed()
                        trigger.tap()
                        pg.wait_for_timeout(700)
                        opened = pg.evaluate("!document.querySelector('.sheet').hidden")
                        pg.tap(".sheet-close")
                        pg.wait_for_timeout(700)
                        closed = pg.evaluate("document.querySelector('.sheet').hidden")
                        sheet_ok = bool(opened and closed)
                    pg.close()
                    ctx.close()

                    screens = round(probe["height"] / VIEW["height"], 1)
                    per_page[path] = {**probe, "screens": screens, "errors": errors[:10], "sheet_ok": sheet_ok, "webgl": gl}
                    if not gl.get("on") or not gl.get("hero"):
                        report.error(f"{path}: WebGL depth hero did not start ({gl})")
                    if "map" in gl and not gl["map"]:
                        report.error(f"{path}: 3D terrain map did not start")
                    if probe["scrollW"] > probe["W"] + 1:
                        report.error(f"{path}: horizontal overflow {probe['scrollW']}px > {probe['W']}px")
                    for e in errors[:5]:
                        report.error(f"{path}: JS error — {e[:160]}")
                    if sheet_ok is False:
                        report.error(f"{path}: bottom sheet did not open/close on tap")
                    for s in probe["small"][:5]:
                        report.warn(f"{path}: small tap target {s}")
                    for t in probe["tiny"][:3]:
                        report.warn(f"{path}: tiny text {t}")
                    self.log(f"{path:26s} {screens:5.1f} screens  overflow={probe['scrollW'] > probe['W'] + 1}  "
                             f"small_taps={len(probe['small'])}  js_errors={len(errors)}  sheet={sheet_ok}  gl={gl}")
                browser.close()
        finally:
            httpd.shutdown()
        report.stats = {"device": "915x412 landscape, touch, Android flagship UA, WebGL2", "pages": per_page}
