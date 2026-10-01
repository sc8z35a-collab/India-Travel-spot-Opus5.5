"""Dump every console message / page error / failed request of one page (dev helper, owner A).
    python3 -m pipeline.console_dump index.html [wait_ms]"""
import functools, http.server, socketserver, sys, threading
from playwright.sync_api import sync_playwright
from .agents.base import DIST
path = sys.argv[1] if len(sys.argv) > 1 else "index.html"; wait = int(sys.argv[2]) if len(sys.argv) > 2 else 6000
class _Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(_Q, directory=str(DIST)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_context(viewport={"width": 915, "height": 412}, is_mobile=True, has_touch=True).new_page(); pg.set_default_timeout(120000)
    pg.on("console", lambda m: print(f"[{m.type}] {m.text[:400]}"))
    pg.on("pageerror", lambda e: print(f"[pageerror] {e}"))
    pg.on("requestfailed", lambda r: print(f"[reqfail] {r.url}"))
    pg.on("response", lambda r: r.status >= 400 and print(f"[{r.status}] {r.url}"))
    pg.goto(f"http://127.0.0.1:{srv.server_address[1]}/{path}?qa=1", wait_until="load"); pg.wait_for_timeout(wait)
    print("classes:", pg.evaluate("document.documentElement.className"))
    b.close()
srv.shutdown()
