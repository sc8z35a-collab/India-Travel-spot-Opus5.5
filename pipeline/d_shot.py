"""Agent D's lean element screenshot helper (owner: D).

  python3 -m pipeline.d_shot <page> <selector>[@wait_ms] ... [--full] [--dpr 2] [--click "<sel>"]
    --full   : real-device path (no ?qa=1 → transmission glass, reflector, HDRI) — slow on SwiftShader
    --dpr N  : device scale factor (default 1)
Writes reports/mobile/d-<slug>-<i>.jpg (clipped to the element) and prints JSON {errors, shots}.
Always run under the shared lock:  flock -w 900 /tmp/webapp-heavy.lock python3 -m pipeline.d_shot ...
"""
import functools, http.server, socketserver, sys, threading, json
from playwright.sync_api import sync_playwright
from .agents.base import DIST, REPORTS
import fcntl as _fcntl, os as _os
_HEAVY = open("/tmp/webapp-heavy.lock", "w")
if not _os.environ.get("HEAVY_LOCK_HELD"):
    _fcntl.flock(_HEAVY, _fcntl.LOCK_EX); _os.environ["HEAVY_LOCK_HELD"] = "1"

args = sys.argv[1:]
full = "--full" in args
dpr = float(args[args.index("--dpr") + 1]) if "--dpr" in args else 1
clicks = [args[i + 1] for i, a in enumerate(args) if a == "--click"]
skip = {i + 1 for i, a in enumerate(args) if a in ("--dpr", "--click")}
pos = [a for i, a in enumerate(args) if not a.startswith("--") and i not in skip]
path, sels = pos[0], pos[1:]


class _Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(_Q, directory=str(DIST)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
out = REPORTS / "mobile"; out.mkdir(parents=True, exist_ok=True)
shots = []
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_context(viewport={"width": 915, "height": 412}, device_scale_factor=dpr, is_mobile=True, has_touch=True).new_page()
    pg.set_default_timeout(150000); errs = []
    pg.on("console", lambda m: m.type in ("error", "warning") and errs.append(m.text[:240]))
    pg.on("pageerror", lambda e: errs.append(str(e)[:240]))
    pg.goto(f"http://127.0.0.1:{srv.server_address[1]}/{path}{'' if full else '?qa=1'}", wait_until="domcontentloaded")
    pg.wait_for_timeout(2500)
    slug = path.replace("/index.html", "").replace(".html", "").replace("/", "-")
    for i, s in enumerate(sels):
        sel, _, w = s.partition("@")
        el = pg.locator(sel).first
        el.scroll_into_view_if_needed()
        for c in clicks:
            try: pg.locator(c).first.click(timeout=5000)
            except Exception as e: errs.append(f"click {c}: {e}"[:200])
        pg.wait_for_timeout(int(w or 4000))
        f = out / f"d-{slug}-{i}.jpg"
        try:
            el.screenshot(path=str(f), type="jpeg", quality=80, timeout=90000); shots.append(str(f))
        except Exception as e:
            errs.append(f"shot {sel}: {e}"[:200])
    print(json.dumps({"errors": errs[:10], "shots": shots}, ensure_ascii=False))
    b.close()
srv.shutdown()
