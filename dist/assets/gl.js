/* INDIA — 5 JOURNEYS · WebGL engine (three.js r169)
   Target: landscape, full-screen, flagship Android. No graphics compromise:
     • DepthHero   — real photos displaced by a neural depth map (Depth Anything V2)
                     into true 3D relief; gyro/touch parallax; depth-ordered
                     dissolve between regions; volumetric dust + bokeh; bloom,
                     chromatic aberration, film grain.
     • TerrainMap  — the Indian subcontinent from real elevation data, 260k-vertex
                     displaced mesh, per-vertex normals, sun lighting, sea glints,
                     glowing border, flowing flight arcs (incl. Tokyo → Delhi),
                     light-beam pins with HTML labels, camera fly-to.
     • Ambient     — full-page low-res nebula + parallax star field behind content.
   Everything degrades gracefully: without WebGL the static <picture>/SVG stays. */
import * as THREE from "three";
import { EffectComposer } from "./vendor/three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "./vendor/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./vendor/three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "./vendor/three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "./vendor/three/addons/postprocessing/OutputPass.js";

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const DATA = JSON.parse($("#site-data").textContent);
const ROOT = DATA.root || "";
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
// ?qa=1 → CI software-GPU mode (SwiftShader): same scenes, lower pixel load. Real phones never use it.
const QA = /[?&]qa=1/.test(location.search);
// Render at the phone's real density (flagships are 3–3.5×) — capped at 3 — and let a frame-time
// governor step it down (3 → 2.5 → 2 → 1.6) only if a device genuinely can't hold ~50 fps.
const DPR_MAX = QA ? 1 : Math.min(window.devicePixelRatio || 1, 3);
let DPR = DPR_MAX;
const Gov = {
  steps: [3, 2.5, 2, 1.6].filter((v) => v <= DPR_MAX + 0.01), i: 0, acc: 0, n: 0, cool: 0, listeners: new Set(),
  init() { if (!this.steps.length || this.steps[0] < DPR_MAX - 0.01) this.steps.unshift(DPR_MAX); DPR = this.steps[0]; },
  sample(dt, active) {
    if (QA || !active) { this.acc = this.n = 0; return; }
    if (this.cool > 0) { this.cool -= dt; return; }
    this.acc += dt; this.n++;
    if (this.n < 90) return;
    const avg = this.acc / this.n; this.acc = this.n = 0;
    if (avg > 1 / 48 && this.i < this.steps.length - 1) this.set(this.i + 1);          // too slow → drop a step
    else if (avg < 1 / 58 && this.i > 0) this.set(this.i - 1);                          // headroom → climb back
  },
  set(i) { this.i = i; DPR = this.steps[i]; this.cool = 2.5; this.listeners.forEach((f) => f(DPR)); html.dataset.dpr = DPR; },
};
const html = document.documentElement;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - Math.pow(1 - t, 3);
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const col = (hex) => new THREE.Color(hex);
Gov.init();

function glSupported() {
  try {
    const c = document.createElement("canvas"), g = c.getContext("webgl2");
    if (!g) return false;
    g.getExtension("WEBGL_lose_context")?.loseContext();   // release the probe context (browsers cap live contexts)
    return true;
  } catch { return false; }
}
const GL_OK = glSupported();
// the static fallback is an expected path — no uncaught exception in the console
html.classList.add(GL_OK ? "gl-on" : "gl-off");

/* ============================ INPUT (gyro + touch) ============================ */
const Input = {
  tx: 0, ty: 0, gx: 0, gy: 0, px: 0, py: 0, gyro: false, bx: null, by: null,
  init() {
    addEventListener("deviceorientation", (e) => {
      if (e.beta == null || e.gamma == null) return;
      const a = (screen.orientation && screen.orientation.angle) ?? (window.orientation || 0);
      let x, y;
      if (a === 90) { x = e.beta; y = e.gamma; }
      else if (a === 270 || a === -90) { x = -e.beta; y = -e.gamma; }
      else { x = e.gamma; y = e.beta; }
      if (this.bx === null || Math.abs(x - this.bx) > 70 || Math.abs(y - this.by) > 70) { this.bx = x; this.by = y; }
      this.bx += (x - this.bx) * 0.012; this.by += (y - this.by) * 0.012;   // slow re-centring → no drift
      this.gx = clamp((x - this.bx) / 18, -1, 1);
      this.gy = clamp((y - this.by) / 18, -1, 1);
      this.gyro = true;
    }, { passive: true });
    const pm = (cx, cy) => { this.px = clamp((cx / innerWidth) * 2 - 1, -1, 1); this.py = clamp((cy / innerHeight) * 2 - 1, -1, 1); };
    addEventListener("pointermove", (e) => pm(e.clientX, e.clientY), { passive: true });
    addEventListener("touchmove", (e) => e.touches[0] && pm(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    addEventListener("touchend", () => { if (this.gyro) { this.px *= 0.3; this.py *= 0.3; } }, { passive: true });
  },
  update(dt) {
    const k = 1 - Math.exp(-dt * 5);
    const x = clamp(this.gx + this.px * (this.gyro ? 0.35 : 1), -1, 1);
    const y = clamp(this.gy + this.py * (this.gyro ? 0.35 : 1), -1, 1);
    this.tx = lerp(this.tx, x, k); this.ty = lerp(this.ty, y, k);
  },
};
Input.init();

/* ============================ shared post chain ============================ */
const FINAL_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
              uVig: { value: 0.55 }, uCA: { value: 1.0 }, uGrain: { value: 0.035 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uCA, uGrain; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - .5; float r2 = dot(c, c);
      vec2 off = c * r2 * .018 * uCA;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1. - smoothstep(.12, .62, r2 * 1.35) * uVig;
      col += (h(vUv * uRes + fract(uTime * 7.3) * 91.) - .5) * uGrain;
      gl_FragColor = vec4(col, 1.);
    }`,
};

// a restored context has lost every texture/program → rebuild once (several canvases may fire)
let reloading = false;
function onRestore(canvas) {
  canvas.addEventListener("webglcontextrestored", () => {
    if (reloading) return; reloading = true;
    try { sessionStorage.setItem("gl-scroll", String(scrollY)); } catch { /* private mode */ }
    location.reload();
  });
}
function makeRenderer(canvas, { alpha = false } = {}) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha, powerPreference: "high-performance", stencil: false });
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    html.classList.add("gl-lost");                    // CSS reveals the static <picture>/SVG underneath
    console.warn("[gl] context lost — static fallback shown");
  });
  onRestore(canvas);
  r.setPixelRatio(DPR);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NeutralToneMapping;
  r.toneMappingExposure = 1.0;
  return r;
}

function makeComposer(renderer, scene, camera, { bloom = [0.5, 0.6, 0.88] } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x * DPR, size.y * DPR, { type: THREE.HalfFloatType, samples: QA ? 0 : (DPR >= 2.5 ? 2 : 4) });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), ...bloom);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  const final = new ShaderPass(FINAL_SHADER);
  composer.addPass(final);
  return { composer, bloomPass, final };
}

const loader = new THREE.TextureLoader();
const texCache = new Map();
function loadTex(url, { srgb = true } = {}) {
  if (texCache.has(url)) return texCache.get(url);
  const p = loader.loadAsync(url).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }, (e) => { texCache.delete(url); throw e; });   // a failed (offline) load must be retryable, not cached forever
  texCache.set(url, p);
  return p;
}
function photoUrl(id, cssW) {
  const a = DATA.assets[id]; const target = cssW * DPR_MAX * 1.02;
  const w = a.variants.find((v) => v >= target) || a.variants[a.variants.length - 1];
  return `${ROOT}${a.path}/${w}.webp`;
}

/* ============================ DEPTH HERO ============================ */
const HERO_VS = `
  uniform sampler2D uDepA, uDepB; uniform vec2 uCovA, uCovB; uniform float uP, uStr, uTime;
  varying vec2 vUv; varying float vDA, vDB, vM;
  vec2 cuv(vec2 uv, vec2 s){ return (uv - .5) * s + .5; }
  void main(){
    vUv = uv;
    float da = texture2D(uDepA, cuv(uv, uCovA)).r;
    float db = texture2D(uDepB, cuv(uv, uCovB)).r;
    float T = mix(-.25, 1.25, uP);
    float m = 1. - smoothstep(T - .12, T + .12, db);
    vDA = da; vDB = db; vM = m;
    float z = mix(da, db, m) * uStr;
    z += sin(m * 3.14159) * .16 * uStr;                     // wave bulge travelling to the viewer
    z += sin(uv.x * 9. + uTime * .6) * sin(uv.y * 7. - uTime * .45) * .006 * uStr; // heat shimmer
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, z, 1.);
  }`;
const HERO_FS = `
  uniform sampler2D uTexA, uTexB; uniform vec2 uCovA, uCovB; uniform float uP, uTime, uFade;
  uniform vec3 uAccA, uAccB, uHaze;
  varying vec2 vUv; varying float vDA, vDB, vM;
  vec2 cuv(vec2 uv, vec2 s){ return (uv - .5) * s + .5; }
  float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  void main(){
    vec3 a = texture2D(uTexA, cuv(vUv, uCovA)).rgb;
    vec3 b = texture2D(uTexB, cuv(vUv, uCovB)).rgb;
    float T = mix(-.25, 1.25, uP);
    float nz = (n(vUv * 7.) - .5) * .22 + (n(vUv * 31.) - .5) * .06;
    float m = 1. - smoothstep(T - .05, T + .05, vDB + nz);
    vec3 c = mix(a, b, m);
    float d = mix(vDA, vDB, m);
    vec3 acc = mix(uAccA, uAccB, m);
    // aerial perspective: far planes pick up warm haze, near planes get contrast
    c = mix(c, uHaze * (.6 + .4 * acc), (1. - d) * .10);
    c = (c - .18) * mix(1.0, 1.08, d) + .18;
    // luminous seam of the dissolve (HDR → bloom)
    float edge = m * (1. - m) * 4.;
    c += acc * pow(edge, 2.) * 3.2 * step(.001, uP) * step(uP, .999);
    // soft god-light sweeping across the far plane
    float sweep = (1. - smoothstep(0., .35, abs(vUv.x - fract(uTime * .035) * 1.6 + .3))) * (1. - d) * smoothstep(.2, 1., vUv.y);
    c += acc * sweep * .10;
    gl_FragColor = vec4(c * uFade, 1.);
  }`;
const DUST_VS = `
  attribute float aSeed, aSize; uniform float uTime, uScale, uH, uW, uZ0, uZ1, uBokeh;
  varying float vA, vS;
  void main(){
    vec3 p = position;
    float sp = mix(.012, .05, fract(aSeed * 13.7)) * uH;
    p.y = mod(p.y + uTime * sp + uH * .65, uH * 1.3) - uH * .65;
    p.x += sin(uTime * .25 + aSeed * 6.283) * .03 * uH;
    p.z += sin(uTime * .19 + aSeed * 11.) * .02 * uH;
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
    vA = (.45 + .55 * sin(uTime * (1.2 + aSeed * 2.) + aSeed * 40.)) ;
    vS = aSeed;
  }`;
const DUST_FS = `
  uniform vec3 uCol; uniform float uBokeh, uFade; varying float vA, vS;
  void main(){
    float d = length(gl_PointCoord - .5);
    float a = uBokeh > .5 ? (1. - smoothstep(.44, .5, d)) * (.25 + .75 * smoothstep(.25, .47, d)) * .22
                          : pow((1. - smoothstep(0., .5, d)), 1.6);
    if (a < .003) discard;
    vec3 c = mix(uCol, vec3(1., .93, .8), fract(vS * 7.1) * .6);
    gl_FragColor = vec4(c * a * vA * (uBokeh > .5 ? 1.2 : 2.4) * uFade, 1.);
  }`;

class DepthHero {
  constructor(host, items, { cycle = false } = {}) {
    this.host = host; this.items = items; this.cur = 0; this.queue = null; this.busy = false;
    this.visible = true; this.scroll = 0; this.t = 0; this.ready = false;
    const canvas = document.createElement("canvas");
    canvas.className = "gl-canvas gl-hero"; canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas);
    this.canvas = canvas;
    this.renderer = makeRenderer(canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 60);
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
    this.u = {
      uTexA: { value: black }, uTexB: { value: black }, uDepA: { value: black }, uDepB: { value: black },
      uCovA: { value: new THREE.Vector2(1, 1) }, uCovB: { value: new THREE.Vector2(1, 1) },
      uP: { value: 0 }, uStr: { value: 0.3 }, uTime: { value: 0 }, uFade: { value: 0 },
      uAccA: { value: col(items[0].accent) }, uAccB: { value: col(items[0].accent) }, uHaze: { value: col("#ffd7a8") },
    };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, QA ? 160 : 400, QA ? 96 : 240),
      new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: HERO_VS, fragmentShader: HERO_FS }));
    this.scene.add(this.mesh);
    this.dust = this.makeDust(1600, false);
    this.bokeh = this.makeDust(46, true);
    Object.assign(this, makeComposer(this.renderer, this.scene, this.camera, { bloom: [0.55, 0.7, 0.86] }));
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    Gov.listeners.add(() => this.resize());
    new IntersectionObserver((es) => es.forEach((e) => (this.visible = e.isIntersecting)), { threshold: 0 }).observe(host);
    this.show(0, true);
    this.cycle = cycle;
  }
  makeDust(n, bokeh) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), seed = new Float32Array(n), size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 1.3; pos[i * 3 + 1] = (Math.random() - 0.5) * 1.3;
      pos[i * 3 + 2] = bokeh ? 0.6 + Math.random() * 0.9 : Math.random() * 1.3;
      seed[i] = Math.random(); size[i] = bokeh ? 0.05 + Math.random() * 0.09 : 0.0025 + Math.pow(Math.random(), 3) * 0.009;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const u = { uTime: this.u.uTime, uScale: { value: 1 }, uH: { value: 1 }, uW: { value: 1 }, uZ0: { value: 0 }, uZ1: { value: 1 },
                uBokeh: { value: bokeh ? 1 : 0 }, uCol: { value: col(this.items[0].accent) }, uFade: this.u.uFade };
    const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true,
                                          depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.userData.base = pos.slice();
    this.scene.add(pts);
    return pts;
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight || innerHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(DPR);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(DPR);
    this.composer.setSize(w, h);
    this.final.uniforms.uRes.value.set(w * DPR, h * DPR);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.D = 3; const H = 2 * this.D * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.H = H; this.W = H * this.camera.aspect;
    this.mesh.scale.set(this.W * 1.16, H * 1.16, 1);
    this.u.uStr.value = H * 0.24;
    for (const [pts, zs] of [[this.dust, [0, 1.35]], [this.bokeh, [1.4, 2.3]]]) {
      const base = pts.userData.base, p = pts.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        p[i] = base[i] * this.W * 1.2; p[i + 1] = base[i + 1] * H;
        p[i + 2] = lerp(zs[0], zs[1], base[i + 2] / 1.5) * H * 0.3 * (pts === this.bokeh ? 3 : 1);
      }
      pts.geometry.attributes.position.needsUpdate = true;
      pts.material.uniforms.uScale.value = (h * DPR) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * this.H;
      pts.material.uniforms.uH.value = H;
    }
    this.aspect = w / h; this.updateCover(this.u.uCovA.value, this.coverA); this.updateCover(this.u.uCovB.value, this.coverB);
  }
  updateCover(v, ratio) {
    if (!ratio) return;
    const va = this.aspect;
    if (ratio > va) v.set(va / ratio, 1); else v.set(1, ratio / va);
  }
  async load(i) {
    const it = this.items[i];
    const [tex, dep] = await Promise.all([loadTex(photoUrl(it.id, this.host.clientWidth * 1.16)),
                                          loadTex(ROOT + it.depth, { srgb: false })]);
    return { tex, dep, it };
  }
  async show(i, first = false) {
    if (this.busy) { this.queue = i; return; }
    if (!first && this.ready && i === this.cur) return;   // re-showing the current photo must not replay the dissolve
    this.busy = true;
    try {
      const { tex, dep, it } = await this.load(i);
      if (first) {
        this.u.uTexA.value = this.u.uTexB.value = tex; this.u.uDepA.value = this.u.uDepB.value = dep;
        this.coverA = this.coverB = it.ratio; this.updateCover(this.u.uCovA.value, it.ratio); this.updateCover(this.u.uCovB.value, it.ratio);
        this.u.uAccA.value.set(it.accent); this.u.uAccB.value.set(it.accent);
        this.dust.material.uniforms.uCol.value.set(it.accent); this.bokeh.material.uniforms.uCol.value.set(it.accent);
        this.u.uP.value = 0; this.cur = i; this.ready = true;
        this.fadeIn = 0;
        html.classList.add("gl-hero-on");
        this.host.classList.add("gl-ready");
        // warm up the next photo in the background
        if (this.items.length > 1) this.load((i + 1) % this.items.length).catch(() => {});
      } else {
        this.u.uTexB.value = tex; this.u.uDepB.value = dep; this.coverB = it.ratio; this.updateCover(this.u.uCovB.value, it.ratio);
        this.u.uAccB.value.set(it.accent);
        const c0 = this.dust.material.uniforms.uCol.value.clone(), c1 = col(it.accent);
        await this.tween(reduced ? 0.01 : 2.2, (k) => {
          this.u.uP.value = easeIO(k);
          this.dust.material.uniforms.uCol.value.copy(c0).lerp(c1, k); this.bokeh.material.uniforms.uCol.value.copy(c0).lerp(c1, k);
        });
        this.u.uTexA.value = tex; this.u.uDepA.value = dep; this.coverA = it.ratio; this.updateCover(this.u.uCovA.value, it.ratio);
        this.u.uAccA.value.set(it.accent); this.u.uP.value = 0; this.cur = i;
        if (this.items.length > 1) this.load((i + 1) % this.items.length).catch(() => {});
      }
    } catch (e) {
      console.warn("[gl] hero texture failed", e);
      if (first) { html.classList.remove("gl-hero-on"); this.host.classList.remove("gl-ready"); this.ready = false; }
      else this.u.uP.value = 0;                          // never freeze half-way through a dissolve
    }
    this.busy = false;
    if (this.queue !== null && this.queue !== this.cur) { const q = this.queue; this.queue = null; this.show(q); }
    else this.queue = null;
  }
  tween(dur, fn) {
    return new Promise((res) => { const t0 = performance.now();
      // rAF is paused in background tabs: finish instantly there so `busy` can't get stuck until the tab returns
      const step = () => { const k = document.hidden ? 1 : Math.min(1, (performance.now() - t0) / 1000 / dur); fn(k); k < 1 ? requestAnimationFrame(step) : res(); };
      step(); });
  }
  frame(dt, t) {
    if (!this.visible || !this.ready) return;
    this.t += dt; this.u.uTime.value = this.t;
    this.final.uniforms.uTime.value = this.t;
    if (this.fadeIn < 1) { this.fadeIn = Math.min(1, this.fadeIn + dt / 1.4); this.u.uFade.value = ease(this.fadeIn); }
    const r = this.host.getBoundingClientRect();
    this.scroll = clamp(-r.top / Math.max(r.height, 1), 0, 1);
    const H = this.H, s = this.scroll;
    const breathe = Math.sin(this.t * 0.16) * 0.025;
    const cam = this.camera;
    cam.position.set(Input.tx * H * 0.075 + Math.sin(this.t * 0.11) * H * 0.012,
                     -Input.ty * H * 0.05 + Math.cos(this.t * 0.09) * H * 0.008 - s * H * 0.12,
                     this.D * (1 - breathe - s * 0.22));
    cam.lookAt(0, -s * H * 0.08, this.u.uStr.value * 0.42);
    this.u.uStr.value = H * (0.24 + s * 0.1);
    this.composer.render(dt);
  }
}

/* ============================ TERRAIN MAP ============================ */
const TERR_VS = `
  uniform sampler2D uH; uniform float uExag, uTexel, uSize;
  varying vec2 vUv; varying vec3 vN, vW; varying float vH, vSea;
  float hg(vec2 uv){ return pow(max(texture2D(uH, uv).r, 0.), .8) * uExag; }
  void main(){
    vUv = uv;
    float h = hg(uv); vH = h; vSea = texture2D(uH, uv).g;
    float e = uTexel * 1.5;
    float hl = hg(uv - vec2(e, 0.)), hr = hg(uv + vec2(e, 0.)), hd = hg(uv - vec2(0., e)), hu = hg(uv + vec2(0., e));
    vN = normalize(vec3(hl - hr, 2. * e * uSize, hu - hd));
    vec3 p = position; p.y += h - vSea * .012;
    vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const TERR_FS = `
  uniform sampler2D uCol, uMask, uH; uniform vec3 uSun, uFog, uSaff, uSky; uniform float uTime, uReveal, uExag;
  uniform vec2 uDelhi; uniform float uFogN, uFogF;
  varying vec2 vUv; varying vec3 vN, vW; varying float vH, vSea;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  void main(){
    vec3 base = texture2D(uCol, vUv).rgb;
    vec3 mk = texture2D(uMask, vUv).rgb;
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float dif = max(dot(N, uSun), 0.);
    float india = mk.r;
    vec3 c = base * (.42 + 1.25 * dif) * mix(.55, 1.18, india);
    c += uSky * .05 * (1. - dif);                                 // cool sky fill in shadows
    // snow sparkle on the Himalaya
    float snow = smoothstep(.55, .75, vH / uExag);
    c += vec3(1.) * snow * pow(h(floor(vW.xz * 400.) + floor(uTime * 3.)), 60.) * 3.;
    // ocean: animated normal + sun glint + fresnel
    if (vSea > .5) {
      vec2 q = vW.xz * 9.;
      vec3 Np = normalize(vec3(n(q + uTime * .25) - .5, 3.2, n(q.yx * 1.3 - uTime * .2) - .5));
      float spec = pow(max(dot(reflect(-uSun, Np), V), 0.), 140.);
      float fr = pow(1. - max(dot(V, vec3(0, 1, 0)), 0.), 4.);
      c = mix(c, vec3(.012, .03, .06), .35) + vec3(1., .82, .58) * spec * 2.2 + uSky * fr * .25;
    }
    // topographic contour lines (India only)
    float cl = abs(fract(vH * 16.) - .5);
    c += vec3(1., .8, .55) * (1. - smoothstep(0., .04, cl)) * .07 * india * (1. - vSea);
    // glowing national outline (HDR → bloom)
    c += uSaff * mk.g * (1.5 + .7 * sin(uTime * 1.3 + vUv.y * 24.));
    // radial reveal from Delhi
    float d = distance(vUv, uDelhi), R = uReveal * 1.15;
    float shown = (1. - smoothstep(R - .06, R + .01, d));
    float ring = (1. - smoothstep(0., .035, abs(d - R))) * (1. - smoothstep(.85, 1., uReveal));
    c = mix(c * .04, c, shown) + uSaff * ring * 3.;
    // fog + plane edge fade
    float fd = distance(cameraPosition, vW);
    float edge = smoothstep(0., .12, vUv.x) * (1. - smoothstep(.88, 1., vUv.x)) * smoothstep(0., .12, vUv.y) * (1. - smoothstep(.88, 1., vUv.y));
    c = mix(uFog, c, edge * (1. - smoothstep(uFogN, uFogF, fd)));
    gl_FragColor = vec4(c, 1.);
  }`;
const BEAM_VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }";
const BEAM_FS = `
  uniform vec3 uCol; uniform float uTime, uOn, uHot; varying vec2 vUv;
  void main(){
    float a = pow(1. - vUv.y, 1.6) * (.55 + .45 * sin(vUv.y * 30. - uTime * 6.));
    gl_FragColor = vec4(uCol * a * (1.2 + uHot * 2.) * uOn, 1.);
  }`;
const RING_FS = `
  uniform vec3 uCol; uniform float uTime, uOn, uHot, uPh; varying vec2 vUv;
  void main(){
    float r = length(vUv - .5) * 2.;
    float k = fract(uTime * .6 + uPh);
    float ring = (1. - smoothstep(0., .07, abs(r - k))) * (1. - k);
    float core = (1. - smoothstep(0., .22, r));
    gl_FragColor = vec4(uCol * (ring * 2.2 + core * 2.5) * (1. + uHot) * uOn, 1.);
  }`;
const ARC_FS = `
  uniform vec3 uCol; uniform float uTime, uOn, uSpeed; varying vec2 vUv;
  void main(){
    float f = fract(vUv.x * 2.5 - uTime * uSpeed);
    float head = smoothstep(.0, .6, f) * (1. - smoothstep(.92, 1., f));
    float grow = (1. - smoothstep(uOn - .04, uOn, vUv.x));
    float a = (.18 + head * 1.6) * grow;
    gl_FragColor = vec4(uCol * a, 1.);
  }`;

class TerrainMap {
  constructor(host, terr) {
    this.host = host; this.terr = terr; this.visible = false; this.t = 0; this.reveal = 0; this.revealing = false;
    this.az = 0; this.azT = 0; this.focus = null; this.fly = null;
    const canvas = document.createElement("canvas");
    canvas.className = "gl-canvas gl-map"; canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas); this.canvas = canvas;
    this.renderer = makeRenderer(canvas);
    this.scene = new THREE.Scene();
    this.fogCol = col("#07090d");
    this.scene.background = this.fogCol;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 80);
    this.home = { t: new THREE.Vector3(0.3, 0, 1.9), r: 11.6 };     // refined in fitAll() once pins exist
    this.target = this.home.t.clone(); this.tgt = this.target.clone();
    this.radius = this.home.r; this.polar = 0.9;
    Object.assign(this, makeComposer(this.renderer, this.scene, this.camera, { bloom: [0.85, 0.55, 0.78] }));
    this.final.uniforms.uVig.value = 0.7;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    Gov.listeners.add(() => this.resize());
    new IntersectionObserver((es) => es.forEach((e) => {
      this.visible = e.isIntersecting;
      if (e.isIntersecting && !this.revealing && this.ready) this.startReveal();
    }), { threshold: 0.2 }).observe(host);
    this.build().catch((e) => { console.warn("[gl] terrain failed", e); });
    this.bindDrag();
  }
  async build() {
    const base = ROOT + "assets/terrain/";
    const [hImg, colT, maskT] = await Promise.all([
      new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = base + "height.png"; }),
      loadTex(base + "color.jpg"), loadTex(base + "mask.png", { srgb: false }),
    ]);
    // decode 16-bit height (R,G) + sea flag (B) into a float RG texture
    const N = hImg.width, cv = document.createElement("canvas"); cv.width = cv.height = N;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(hImg, 0, 0);
    const px = cx.getImageData(0, 0, N, N).data, f = new Float32Array(N * N * 2);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 2) { f[j] = (px[i] * 256 + px[i + 1]) / 65535; f[j + 1] = px[i + 2] > 127 ? 1 : 0; }
    // flip rows so v=1 is north (matches TextureLoader flipY)
    const flipped = new Float32Array(f.length);
    for (let y = 0; y < N; y++) flipped.set(f.subarray((N - 1 - y) * N * 2, (N - y) * N * 2), y * N * 2);
    this.hdata = flipped; this.N = N;
    const hT = new THREE.DataTexture(flipped, N, N, THREE.RGFormat, THREE.FloatType);
    const lin = this.renderer.extensions.has("OES_texture_float_linear");
    hT.minFilter = hT.magFilter = lin ? THREE.LinearFilter : THREE.NearestFilter; hT.needsUpdate = true;

    const SIZE = 10, EX = 0.95;
    this.SIZE = SIZE; this.EX = EX;
    this.u = { uH: { value: hT }, uCol: { value: colT }, uMask: { value: maskT }, uExag: { value: EX }, uTexel: { value: 1 / N },
               uSize: { value: SIZE }, uSun: { value: new THREE.Vector3(-0.55, 0.62, -0.35).normalize() },
               uFog: { value: this.fogCol }, uSaff: { value: col("#ffae4a").multiplyScalar(1.0) }, uSky: { value: col("#6d8fc7") },
               uTime: { value: 0 }, uReveal: { value: 0 }, uDelhi: { value: new THREE.Vector2(this.terr.delhi[0], 1 - this.terr.delhi[1]) },
               uFogN: { value: 7 }, uFogF: { value: 17 } };
    const g = new THREE.PlaneGeometry(SIZE, SIZE, QA ? 180 : 560, QA ? 180 : 560); g.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: TERR_VS, fragmentShader: TERR_FS }));
    this.scene.add(this.ground);

    // pins: beams + pulse rings
    this.pins = {};
    const R = Object.fromEntries(DATA.regions.map((r) => [r.id, r]));
    const beamG = new THREE.CylinderGeometry(0.018, 0.05, 1.5, 20, 1, true); beamG.translate(0, 0.75, 0);
    const ringG = new THREE.PlaneGeometry(0.7, 0.7); ringG.rotateX(-Math.PI / 2);
    this.terr.pins.forEach((p, i) => {
      const pos = this.world(p.u, p.v);
      const c = col(R[p.id].accent);
      const mk = (geo, fs, extra = {}) => new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: { uCol: { value: c }, uTime: this.u.uTime, uOn: { value: 0 }, uHot: { value: 0 }, uPh: { value: i * 0.21 }, ...extra },
        vertexShader: BEAM_VS, fragmentShader: fs, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      const beam = mk(beamG, BEAM_FS), ring = mk(ringG, RING_FS);
      beam.position.copy(pos); ring.position.copy(pos).add(new THREE.Vector3(0, 0.01, 0));
      this.scene.add(beam, ring);
      this.pins[p.id] = { pos, beam, ring, top: pos.clone().add(new THREE.Vector3(0, 1.55, 0)), label: $(`.map3d-label[data-pin="${p.id}"]`, this.host) };
    });
    // flight arcs from Delhi (+ Tokyo → Delhi, entering from beyond the map)
    const delhi = this.pins["delhi-agra"].pos;
    this.arcs = [];
    const arc = (a, b, c, lift, speed, radius = 0.012) => {
      const mid = a.clone().lerp(b, 0.5); mid.y += lift;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, radius, 8, false), new THREE.ShaderMaterial({
        uniforms: { uCol: { value: c }, uTime: this.u.uTime, uOn: { value: 0 }, uSpeed: { value: speed } },
        vertexShader: BEAM_VS, fragmentShader: ARC_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.scene.add(m); this.arcs.push(m); return m;
    };
    Object.entries(this.pins).forEach(([id, p]) => {
      if (id === "delhi-agra") return;
      arc(delhi.clone().add(new THREE.Vector3(0, 0.03, 0)), p.pos.clone().add(new THREE.Vector3(0, 0.03, 0)), col(R[id].accent),
          0.35 + delhi.distanceTo(p.pos) * 0.28, 0.35);
    });
    const tokyo = new THREE.Vector3(8.5, 2.2, -6.5);
    this.tokyoArc = arc(tokyo, delhi.clone().add(new THREE.Vector3(0, 0.03, 0)), col("#fff1d6"), 2.4, 0.22, 0.02);
    this.tokyoLabel = $(".map3d-tokyo", this.host);
    this.tokyoAnchor = new THREE.QuadraticBezierCurve3(tokyo, tokyo.clone().lerp(delhi, 0.5).add(new THREE.Vector3(0, 2.4, 0)), delhi).getPoint(0.42);

    // star-like floating motes above the map for depth
    const n = 900, pg = new THREE.BufferGeometry(), pp = new Float32Array(n * 3), ps = new Float32Array(n);
    for (let i = 0; i < n; i++) { pp[i * 3] = (Math.random() - 0.5) * 14; pp[i * 3 + 1] = 0.3 + Math.random() * 3.5; pp[i * 3 + 2] = (Math.random() - 0.5) * 14; ps[i] = Math.random(); }
    pg.setAttribute("position", new THREE.BufferAttribute(pp, 3)); pg.setAttribute("aSeed", new THREE.BufferAttribute(ps, 1));
    this.motes = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: { uTime: this.u.uTime, uPR: { value: DPR }, uRev: this.u.uReveal },
      vertexShader: `attribute float aSeed; uniform float uTime, uPR; varying float vA;
        void main(){ vec3 p = position; p.y += sin(uTime * .3 + aSeed * 20.) * .12; p.x += sin(uTime * .1 + aSeed * 9.) * .2;
          vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (1.5 + aSeed * 3.) * uPR * 6. / -mv.z; gl_Position = projectionMatrix * mv;
          vA = .4 + .6 * sin(uTime * 2. + aSeed * 50.); }`,
      fragmentShader: `uniform float uRev; varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = (1. - smoothstep(0., .5, d));
          gl_FragColor = vec4(vec3(1., .78, .45) * a * vA * .9 * uRev, 1.); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.motes);

    this.ready = true;
    html.classList.add("gl-map-on");
    this.host.classList.add("gl-ready");
    if (this.visible) this.startReveal();
    // label taps → fly camera (site.js opens the sheet via [data-pin])
    // every entry point (3D label, list button, SVG pin, beam tap) goes through site.js → map:focus
    document.addEventListener("map:focus", (e) => this.pins[e.detail] && this.flyTo(e.detail));
    $(".map3d-reset", this.host)?.addEventListener("click", () => this.flyTo(null));
    document.addEventListener("sheet:close", (e) => { if (this.focus && (!e.detail || this.pins[e.detail])) this.flyTo(null); });
    this.fitAll();
  }
  // frame all five pins (Ladakh in the north … Kerala in the south) for the current aspect ratio
  fitAll() {
    if (!this.pins || !this.w) return;
    const pts = Object.values(this.pins).map((p) => p.pos);
    const box = new THREE.Box3().setFromPoints(pts);
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const fov = THREE.MathUtils.degToRad(this.camera.fov), aspect = this.w / this.h;
    const needV = (sz.z * 0.62 + 1.7) / (2 * Math.tan(fov / 2));           // vertical extent (foreshortened by the tilt)
    const needH = (sz.x + 2.6) / (2 * Math.tan(fov / 2) * aspect);
    this.home = { t: new THREE.Vector3(c.x, 0, c.z + 0.35), r: clamp(Math.max(needV, needH) * 1.08, 8, 15) };
    if (!this.focus && !this.fly) { this.tgt.copy(this.home.t); this.radius = this.home.r; }
  }
  // tap on a light beam / ring directly in the 3D scene
  pick(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    let best = null, bd = 0.09;                                            // NDC radius ≈ 40 px on a phone
    Object.entries(this.pins).forEach(([id, p]) => {
      for (const q of [p.pos, p.pos.clone().lerp(p.top, 0.5), p.top]) {
        const v = q.clone().project(this.camera); if (v.z > 1) continue;
        const d = Math.hypot((v.x - ndc.x) * (r.width / r.height), v.y - ndc.y);
        if (d < bd) { bd = d; best = id; }
      }
    });
    return best;
  }
  world(u, v) {
    const S = this.SIZE, N = this.N;
    const ix = clamp(Math.round(u * (N - 1)), 0, N - 1), iy = clamp(Math.round((1 - v) * (N - 1)), 0, N - 1);
    const h = Math.pow(this.hdata[(iy * N + ix) * 2], 0.8) * this.EX;
    return new THREE.Vector3((u - 0.5) * S, h, (v - 0.5) * S);
  }
  startReveal() {
    this.revealing = true;
    const t0 = performance.now(), dur = reduced ? 10 : 3200;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      this.u.uReveal.value = ease(k);
      Object.values(this.pins).forEach((p, i) => {
        const on = clamp((k - 0.35 - i * 0.07) / 0.25, 0, 1);
        p.beam.material.uniforms.uOn.value = on; p.ring.material.uniforms.uOn.value = on;
        p.label && p.label.classList.toggle("is-on", on > 0.5);
      });
      this.arcs.forEach((a, i) => (a.material.uniforms.uOn.value = clamp((k - 0.5 - i * 0.05) / 0.4, 0, 1) * 1.05));
      this.tokyoLabel && this.tokyoLabel.classList.toggle("is-on", k > 0.8);
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }
  flyTo(id) {
    this.focus = id;
    Object.entries(this.pins).forEach(([k, p]) => {
      const hot = k === id ? 1 : 0;
      p.beam.material.uniforms.uHot.value = hot; p.ring.material.uniforms.uHot.value = hot;
      p.label && p.label.classList.toggle("is-hot", !!hot);
    });
    const from = { t: this.tgt.clone(), r: this.radius, az: this.azT };
    const to = id ? { t: this.pins[id].pos.clone(), r: 3.4, az: this.azT } : { t: this.home.t.clone(), r: this.home.r, az: 0 };
    const t0 = performance.now(), dur = reduced ? 1 : 1500;
    this.fly = (now) => {
      const k = easeIO(Math.min(1, (now - t0) / dur));
      this.tgt.lerpVectors(from.t, to.t, k); this.radius = lerp(from.r, to.r, k); this.azT = lerp(from.az, to.az, k);
      if (k >= 1) this.fly = null;
    };
    this.host.classList.toggle("is-focused", !!id);
  }
  bindDrag() {
    // horizontal drag rotates; a vertical gesture is left to the page (touch-action: pan-y); a still tap picks a pin
    this.canvas.style.touchAction = "pan-y";
    let g = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;   // no second finger / right click
      g = { x: e.clientX, y: e.clientY, a0: this.azT, moved: false, id: e.pointerId };
    });
    addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) > 8) { g.moved = true; g.horiz = Math.abs(dx) > Math.abs(dy); }
      if (g.moved && g.horiz) {
        // a drag during a camera flight takes over — otherwise the flight keeps overwriting azT
        this.fly = null;
        this.azT = clamp(g.a0 - dx / innerWidth * 2.2, -0.9, 0.9); $(".map3d-hint", this.host)?.classList.add("is-used");
      }
    }, { passive: true });
    const up = (e) => {
      if (!g || (e && e.pointerId !== g.id)) return;
      const tap = !g.moved; g = null;
      if (tap && e && e.type === "pointerup" && this.ready) {
        const id = this.pick(e.clientX, e.clientY);
        if (id) document.dispatchEvent(new CustomEvent("map:pick", { detail: id }));
      }
    };
    addEventListener("pointerup", up, { passive: true });
    // the browser took the gesture (vertical page scroll) → forget it
    addEventListener("pointercancel", (e) => { if (g && e.pointerId === g.id) g = null; }, { passive: true });
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(DPR); this.composer.setPixelRatio(DPR);
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.final.uniforms.uRes.value.set(w * DPR, h * DPR);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.w = w; this.h = h;
    if (this.motes) this.motes.material.uniforms.uPR.value = DPR;   // point sprites follow the DPR governor
    this.fitAll();
  }
  frame(dt, now) {
    if (!this.visible || !this.ready) return;
    this.t += dt; this.u.uTime.value = this.t; this.final.uniforms.uTime.value = this.t;
    if (this.fly) this.fly(now);
    const r = this.host.getBoundingClientRect();
    const p = clamp(1 - (r.top + r.height * 0.5) / innerHeight, 0, 1);  // 0 entering → 1 leaving
    const polar = lerp(0.22, 0.7, ease(clamp(p * 1.6, 0, 1))) - (this.focus ? 0.05 : 0);
    this.az = lerp(this.az, this.azT + Input.tx * 0.12 + Math.sin(this.t * 0.07) * 0.06, 1 - Math.exp(-dt * 4));
    this.target.lerp(this.tgt, 1 - Math.exp(-dt * 6));
    const pol = polar - Input.ty * 0.05;
    const R = this.radius * (1 + (1 - p) * 0.12);
    this.camera.position.set(this.target.x + R * Math.sin(pol) * Math.sin(this.az),
                             this.target.y + R * Math.cos(pol),
                             this.target.z + R * Math.sin(pol) * Math.cos(this.az));
    this.camera.lookAt(this.target);
    // project HTML labels
    const v = new THREE.Vector3();
    // project, then push overlapping pills apart vertically (Delhi & Jaipur are ~250 km apart → they collided)
    const L = [];
    Object.entries(this.pins).forEach(([id, pin]) => {
      if (!pin.label) return;
      v.copy(pin.top).project(this.camera);
      if (!pin.lw) { pin.lw = pin.label.offsetWidth || 110; pin.lh = pin.label.offsetHeight || 34; }
      L.push({ pin, id, x: (v.x * 0.5 + 0.5) * this.w, y0: (-v.y * 0.5 + 0.5) * this.h, y: 0, z: v.z });
    });
    L.sort((a, b) => a.y0 - b.y0);
    L.forEach((l) => (l.y = l.y0));
    for (let it = 0; it < 4; it++) for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const ox = Math.min(a.x + a.pin.lw, b.x + b.pin.lw) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.pin.lh / 2, b.y + b.pin.lh / 2) - Math.max(a.y - a.pin.lh / 2, b.y - b.pin.lh / 2);
      if (ox > -6 && oy > -4) { const push = (oy + 4) / 2; a.y -= push; b.y += push; }
    }
    L.forEach(({ pin, id, x, y, y0, z }) => {
      const cy = clamp(y, 24, this.h - 24), cx = clamp(x, 8, this.w - pin.lw - 8);
      pin.label.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
      pin.label.style.setProperty("--lead", Math.max(0, y0 - cy).toFixed(0) + "px");
      pin.label.style.visibility = z < 1 ? "" : "hidden";
      pin.label.classList.toggle("is-dim", !!this.focus && this.focus !== id);
    });
    if (this.tokyoLabel) {
      v.copy(this.tokyoAnchor).project(this.camera);
      this.tokyoLabel.style.visibility = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 ? "" : "hidden";
      this.tokyoLabel.style.transform = `translate3d(${((v.x * 0.5 + 0.5) * this.w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * this.h).toFixed(1)}px, 0)`;
    }
    this.composer.render(dt);
  }
}

/* ============================ AMBIENT BACKGROUND ============================ */
class Ambient {
  constructor(accent) {
    const canvas = document.createElement("canvas");
    canvas.className = "gl-ambient"; canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "low-power" });
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); html.classList.add("gl-lost"); });
    onRestore(canvas);
    this.renderer.setPixelRatio(Math.min(DPR, 1) * 0.6);
    this.scene = new THREE.Scene(); this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.u = { uTime: { value: 0 }, uScroll: { value: 0 }, uAcc: { value: col(accent) }, uRes: { value: new THREE.Vector2() },
               uTilt: { value: new THREE.Vector2() } };
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: this.u,
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
      fragmentShader: `
        uniform float uTime, uScroll; uniform vec3 uAcc; uniform vec2 uRes, uTilt; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a * n(p); p *= 2.03; a *= .5; } return v; }
        vec3 stars(vec2 uv, float s, float par){
          vec2 g = (uv + vec2(uTilt.x, -uTilt.y) * par * .02 + vec2(0., uScroll * par)) * s;
          vec2 id = floor(g), f = fract(g) - .5; float r = h(id);
          float b = (1. - smoothstep(0., .06, length(f - (vec2(h(id + 3.), h(id + 7.)) - .5) * .7))) * step(.86, r);
          return vec3(1., .86, .66) * b * (.5 + .5 * sin(uTime * (1. + r * 3.) + r * 60.));
        }
        void main(){
          vec2 uv = vUv; uv.x *= uRes.x / uRes.y;
          vec2 q = uv * 1.6 + vec2(uTime * .012, -uScroll * .35);
          float f = fbm(q + fbm(q * 1.7 + uTime * .02) * 1.4);
          vec3 c = vec3(.028, .022, .02);
          c += uAcc * pow(f, 3.2) * .22;
          c += vec3(.2, .28, .5) * pow(fbm(q * .7 - 3.1), 4.) * .12;
          c += stars(uv, 34., .15) * .55 + stars(uv, 18., .35) * .8 + stars(uv, 9., .7) * .7;
          c *= 1. - .45 * length(vUv - .5);
          gl_FragColor = vec4(c, 1.);
        }` })));
    this.resize(); addEventListener("resize", () => this.resize());
    screen.orientation?.addEventListener?.("change", () => setTimeout(() => this.resize(), 120));
    this.acc = col(accent); this.accT = col(accent); this.last = 0;
    html.classList.add("gl-amb-on");
  }
  resize() { this.renderer.setSize(innerWidth, innerHeight, false); this.u.uRes.value.set(innerWidth, innerHeight); }
  frame(dt, now, covered) {
    if (covered || now - this.last < 1000 / 30) return;          // 30 fps is plenty for a background
    this.last = now;
    this.u.uTime.value += Math.min(dt * 2, 0.1);
    this.u.uScroll.value = scrollY / innerHeight * 0.25;
    this.u.uTilt.value.set(Input.tx, Input.ty);
    this.u.uAcc.value.lerp(this.accT, 0.06);
    this.renderer.render(this.scene, this.camera);
  }
}

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
  $$("main section, .card").forEach((s) => secIO.observe(s));
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
  if (html.classList.contains("gl-lost")) return;
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  Input.update(dt);
  // publish tilt to CSS for DOM-level 3D (cards, spots, headings)
  if (now - cssT > 32) { cssT = now; html.style.setProperty("--tx", Input.tx.toFixed(3)); html.style.setProperty("--ty", Input.ty.toFixed(3)); }
  for (const s of scenes) s.frame(dt, now);
  Gov.sample(dt, scenes.some((s) => s.visible && s.ready));
  if (ambient) ambient.frame(dt, now, (hero && hero.visible && hero.scroll < 0.9) || (terrain && terrain.visible));
  rafId = requestAnimationFrame(loop);
}
rafId = requestAnimationFrame(loop);
window.__gl = { hero, terrain, ambient, Input, Gov, get dpr() { return DPR; } };

// restore the reading position after a context-restore reload
try { const y = sessionStorage.getItem("gl-scroll"); if (y !== null) { sessionStorage.removeItem("gl-scroll"); scrollTo(0, +y); } } catch { /* ignore */ }
