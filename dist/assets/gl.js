/* INDIA — 5 JOURNEYS · WebGL engine (three.js r169)
   Target: landscape, full-screen, flagship Android. No graphics compromise:
     • DepthHero   — real photos displaced by a neural depth map (Depth Anything V2)
                     into true 3D relief; gyro/touch parallax; depth-ordered
                     dissolve between regions; volumetric dust + bokeh; bloom,
                     chromatic aberration, film grain.
     • TerrainMap  — the Indian subcontinent from real elevation data, ~310k-vertex
                     displaced mesh, per-vertex normals, sun lighting, sea glints,
                     glowing border, flowing flight arcs (incl. Tokyo → Delhi),
                     light-beam pins with HTML labels, camera fly-to.
     • Ambient     — full-page low-res nebula + parallax star field behind content.
   Everything degrades gracefully: without WebGL the static <picture>/SVG stays.
   Module layout (each scene file has ONE owner — see collab/ROLES.md):
     gl/core.js     renderer, post chain, input, DPR governor, texture loader   (A)
     gl/hero.js     DepthHero                                                  (B)
     gl/ambient.js  Ambient nebula / stars                                     (B)
     gl/terrain.js  TerrainMap                                                 (C)
     gl/city.js     ScoreCity                                                  (D)
     gl.js          boot + render loop                                         (A) */
import { $, $$, DATA, reduced, DPR, html, Gov, GL_OK, Input } from "./gl/core.js?v=16df232f5e";
import { DepthHero } from "./gl/hero.js?v=16df232f5e";
import { TerrainMap } from "./gl/terrain.js?v=16df232f5e";
import { ScoreCity } from "./gl/city.js?v=16df232f5e";
import { Ambient } from "./gl/ambient.js?v=16df232f5e";

/* ============================ boot ============================ */
const scenes = [];
let ambient = null, hero = null, terrain = null;
if (GL_OK) try {
  const heroHost = $(".hero, .rp-hero");
  if (heroHost && DATA.depth) {
    const curR = DATA.current && DATA.regions.find((r) => r.id === DATA.current);
    const ids = curR ? [curR.heroId]
                             : DATA.regions.map((r) => r.heroId);
    const items = ids.filter((id) => DATA.depth[id] && DATA.assets[id]).map((id) => {
      const r = DATA.regions.find((x) => x.heroId === id);
      const a = DATA.assets[id];
      return { id, depth: DATA.depth[id], accent: r ? r.accent : "#e8a24a", ratio: a.w / a.h };
    });
    if (items.length) {
      hero = new DepthHero(heroHost, items);
      scenes.push(hero);
      // slide index → item index by photo id (regions without a depth map are skipped in `items`)
      document.addEventListener("hero:go", (e) => {
        const r = DATA.regions[e.detail]; const k = r ? items.findIndex((it) => it.id === r.heroId) : -1;
        if (k >= 0) hero.show(k);
      });
    }
  }
  const cityHost = $(".city3d");
  if (cityHost) { try { const city = new ScoreCity(cityHost); scenes.push(city); } catch (e) { console.warn("[gl] score city failed", e); cityHost.remove(); } }
  const mapHost = $(".map3d");
  if (mapHost && DATA.terrain) { terrain = new TerrainMap(mapHost, DATA.terrain); scenes.push(terrain); }
  const accent = DATA.regions.find((r) => r.id === DATA.current)?.accent || "#e8a24a";
  ambient = new Ambient(accent);
  // section accents drive the ambient nebula tint
  const secIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const a = getComputedStyle(e.target).getPropertyValue("--accent").trim();
    if (a.startsWith("#")) ambient.accT.set(a);
  }), { rootMargin: "-45% 0px -45% 0px" });
  // (horizontal deck cards all intersect at once — the last callback won, tinting the page with a random region)
  $$("main section").forEach((s) => secIO.observe(s));
} catch (e) {
  console.warn("[gl] init failed", e);
  html.classList.remove("gl-on", "gl-hero-on", "gl-map-on", "gl-amb-on");
  html.classList.add("gl-off");
  scenes.length = 0; ambient = null;
}

let last = performance.now(), cssT = 0, running = true;
let rafId = 0;
document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
  cancelAnimationFrame(rafId);                       // never run two loops after a hide/show cycle
  if (running && GL_OK) { last = performance.now(); rafId = requestAnimationFrame(loop); }
});
function loop(now) {
  if (!running || !GL_OK || (!scenes.length && !ambient)) return;
  if (html.classList.contains("gl-lost")) {
    html.style.setProperty("--tx", "0"); html.style.setProperty("--ty", "0");   // DOM tilt must not freeze off-centre
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  Input.update(dt);
  // publish tilt to CSS for DOM-level 3D (cards, spots, headings)
  if (!reduced && now - cssT > 32) { cssT = now; html.style.setProperty("--tx", Input.tx.toFixed(3)); html.style.setProperty("--ty", Input.ty.toFixed(3)); }
  for (const s of scenes) s.frame(dt, now);
  Gov.sample(dt, scenes.some((s) => s.visible && s.ready));
  if (ambient) ambient.frame(dt, now, (hero && hero.visible && hero.scroll < 0.9) || (terrain && terrain.visible));
  rafId = requestAnimationFrame(loop);
}
rafId = requestAnimationFrame(loop);
window.__gl = { hero, terrain, ambient, Input, Gov, get dpr() { return DPR; } };

// restore the reading position after a context-restore reload
try {
  const y = sessionStorage.getItem("gl-scroll");
  if (y !== null) {
    sessionStorage.removeItem("gl-scroll");
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const go = () => scrollTo(0, +y);
    document.readyState === "complete" ? go() : addEventListener("load", go, { once: true });
  }
} catch { /* ignore */ }
