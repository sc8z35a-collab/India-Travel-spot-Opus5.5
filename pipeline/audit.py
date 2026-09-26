"""Landscape layout audit (dev helper, QA round L2).

Loads each page at 915×412 (DPR 2.6, touch), scrolls through every section and
reports: horizontal overflow, text clipped inside its box, fixed-UI overlap on
the side rail, images rendered with fewer source pixels than displayed
(upscaled), broken images and console errors.

    python3 -m pipeline.audit [--gl] [--shots] [page ...]
"""
from __future__ import annotations

import functools
import http.server
import json
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

from .agents.base import DIST, REPORTS

PROBE = r"""() => {
  const out = {overflow: [], clipped: [], rail: [], upscaled: [], broken: []};
  const W = innerWidth, doc = document.documentElement;
  if (doc.scrollWidth > W + 1) out.overflow.push('document scrollWidth=' + doc.scrollWidth);
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  document.querySelectorAll('h1,h2,h3,p,a,button,span,b,small,dt,dd,li,label').forEach((el) => {
    if (!vis(el) || el.closest('[hidden],.sheet,.menu,.lightbox,.loader,.rotate-gate,.deck,.spots,.marquee,[aria-hidden=true]')) return;
    const s = getComputedStyle(el);
    if (s.textOverflow === 'ellipsis') return;
    if ((s.overflow === 'hidden' || s.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && el.children.length === 0)
      out.clipped.push(name(el) + ' "' + el.textContent.trim().slice(0, 30) + '" ' + el.scrollWidth + '>' + el.clientWidth);
    const r = el.getBoundingClientRect();
    if (el.children.length === 0 && el.textContent.trim() && (r.right > W + 1) && !el.closest('.hero-slides'))
      out.overflow.push(name(el) + ' right=' + Math.round(r.right));
  });
  const fixed = [...document.querySelectorAll('.tabbar a, .nav-toggle, .fs-btn:not([hidden]), .nav-logo')].filter(vis).map((e) => [name(e), e.getBoundingClientRect()]);
  for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) {
    const a = fixed[i][1], b = fixed[j][1];
    if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) out.rail.push(fixed[i][0] + ' × ' + fixed[j][0]);
  }
  document.querySelectorAll('.pic img, .lb-stage img').forEach((img) => {
    const r = img.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || !r.width) return;
    if (img.complete && img.naturalWidth === 0) { out.broken.push(img.currentSrc || img.src); return; }
    if (!img.complete || !img.naturalWidth) return;
    // naturalWidth is density-corrected for srcset picks → use the real pixel width from the file name
    const m = (img.currentSrc || '').match(/\/(\d+)\.(?:avif|webp|jpg)/); const pw = m ? +m[1] : img.naturalWidth;
    const ph = pw * img.naturalHeight / img.naturalWidth;
    const fit = getComputedStyle(img).objectFit === 'cover' ? Math.max(r.width / pw, r.height / ph) : r.width / pw;
    const need = fit * devicePixelRatio;
    if (need > 1.25) out.upscaled.push((img.currentSrc || '').split('/').slice(-2).join('/') + ' x' + need.toFixed(2));
  });
  return out;
}"""


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    gl, shots = "--gl" in sys.argv, "--shots" in sys.argv
    pages = args or ["index.html", "delhi-agra/index.html", "jaipur/index.html", "varanasi/index.html",
                     "kerala/index.html", "ladakh/index.html"]
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):  # noqa: D401
            pass

    h = functools.partial(Quiet, directory=str(DIST))
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    out = REPORTS / "audit"
    out.mkdir(parents=True, exist_ok=True)
    total, result = 0, {}
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
                               if gl else ["--disable-webgl", "--disable-3d-apis"])
        for path in pages:
            ctx = b.new_context(viewport={"width": 915, "height": 412}, device_scale_factor=2.6 if not gl else 1,
                                is_mobile=True, has_touch=True)
            pg = ctx.new_page()
            pg.set_default_timeout(90000)
            errs: list[str] = []
            pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:160]))
            pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
            pg.on("requestfailed", lambda r: errs.append("FAILED " + r.url[-80:]))
            pg.on("response", lambda r: r.status >= 400 and errs.append(f"{r.status} {r.url[-80:]}"))
            pg.goto(f"http://127.0.0.1:{srv.server_address[1]}/{path}{'?qa=1' if gl else ''}", wait_until="load")
            pg.wait_for_timeout(3500 if not gl else 7000)
            ids = pg.evaluate("[...document.querySelectorAll('main > section[id], main section[id], .region > section[id], footer')].map(e => e.id || 'footer')")
            slug = path.replace("/index.html", "").replace(".html", "")
            agg: dict[str, set] = {k: set() for k in ("overflow", "clipped", "rail", "upscaled", "broken")}
            h_total = pg.evaluate("document.documentElement.scrollHeight")
            y, n = 0, 0
            while y < h_total:
                pg.evaluate(f"window.scrollTo(0, {y})")
                pg.wait_for_timeout(900 if not gl else 2500)
                r = pg.evaluate(PROBE)
                for k, v in r.items():
                    agg[k].update(v)
                if shots:
                    pg.screenshot(path=str(out / f"{slug}-{n:02d}.jpg"), type="jpeg", quality=60)
                y += 380
                n += 1
                h_total = pg.evaluate("document.documentElement.scrollHeight")
            res = {k: sorted(v)[:12] for k, v in agg.items() if v}
            if errs:
                res["errors"] = sorted(set(errs))[:10]
            result[slug] = res
            total += sum(len(v) for v in res.values())
            print(f"{slug:12s} screens={n:3d} " + json.dumps({k: len(v) for k, v in res.items()}, ensure_ascii=False))
            ctx.close()
        b.close()
    srv.shutdown()
    (out / "audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print("issues:", total, "→", out / "audit.json")


if __name__ == "__main__":
    main()
