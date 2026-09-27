"""Fast landscape WebGL smoke test for one page (dev helper, used by agent ⑥)."""
import functools, http.server, socketserver, sys, threading, json
from playwright.sync_api import sync_playwright
from .agents.base import DIST, REPORTS
path = sys.argv[1] if len(sys.argv) > 1 else "index.html"
secs = sys.argv[2].split(",") if len(sys.argv) > 2 else ["top"]
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST)); h.log_message = lambda *a: None
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
out = REPORTS / "mobile"; out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_context(viewport={"width": 915, "height": 412}, device_scale_factor=1, is_mobile=True, has_touch=True).new_page()
    pg.set_default_timeout(120000); errs = []
    pg.on("console", lambda m: m.type in ("error", "warning") and errs.append(m.text[:200]))
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(f"http://127.0.0.1:{srv.server_address[1]}/{path}?qa=1", wait_until="load"); pg.wait_for_timeout(6000)
    slug = path.replace("/index.html", "").replace(".html", "")
    for s in secs:
        if s != "top": pg.evaluate(f"document.querySelector('#{s}').scrollIntoView()"); pg.wait_for_timeout(5000)
        pg.screenshot(path=str(out / f"q-{slug}-{s}.jpg"), type="jpeg", quality=70)
    st = pg.evaluate("[...document.documentElement.classList].join(' ') + ' | scrollW=' + document.documentElement.scrollWidth")
    print(json.dumps({"classes": st, "errors": errs[:8]}, ensure_ascii=False))
    b.close()
srv.shutdown()
