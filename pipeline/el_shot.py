"""Element-level landscape screenshots (dev helper): python3 -m pipeline.el_shot page.html sel1 sel2 ..."""
import functools, http.server, socketserver, sys, threading, json
from playwright.sync_api import sync_playwright
from .agents.base import DIST, REPORTS
path = sys.argv[1]; sels = sys.argv[2:]
class _Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(_Q, directory=str(DIST)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
out = REPORTS / "mobile"; out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_context(viewport={"width": 915, "height": 412}, device_scale_factor=1, is_mobile=True, has_touch=True).new_page()
    pg.set_default_timeout(120000); errs = []
    pg.on("console", lambda m: m.type in ("error", "warning") and errs.append(m.text[:200]))
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(f"http://127.0.0.1:{srv.server_address[1]}/{path}?qa=1", wait_until="load"); pg.wait_for_timeout(4000)
    slug = path.replace("/index.html", "").replace(".html", "")
    for i, s in enumerate(sels):
        el = pg.locator(s).first
        el.scroll_into_view_if_needed(); pg.evaluate("window.scrollBy(0, -40)"); pg.wait_for_timeout(4500)
        pg.screenshot(path=str(out / f"e-{slug}-{i}.jpg"), type="jpeg", quality=72)
    print(json.dumps({"errors": errs[:8]}, ensure_ascii=False))
    b.close()
srv.shutdown()
