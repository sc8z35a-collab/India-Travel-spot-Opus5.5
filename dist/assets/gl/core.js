/* INDIA — 5 JOURNEYS · WebGL core (shared by every scene module)
   OWNER: Agent A (lead). Change the exported API only after posting in collab/BOARD.md. */
import * as THREE from "three";
import { EffectComposer } from "../vendor/three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "../vendor/three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "../vendor/three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "../vendor/three/addons/postprocessing/SMAAPass.js";
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
let DPR = DPR_MAX;   // live binding: importers always read the governor's current value
const html = document.documentElement;
const Gov = {
  steps: [3, 2.5, 2, 1.6].filter((v) => v <= DPR_MAX + 0.01), i: 0, acc: 0, n: 0, cool: 0, listeners: new Set(),
  init() { if (!this.steps.length || this.steps[0] < DPR_MAX - 0.01) this.steps.unshift(DPR_MAX); DPR = this.steps[0]; },
  sample(dt, active) {
    if (QA || !active) { this.acc = this.n = 0; return; }
    if (this.cool > 0) { this.cool -= dt; return; }
    if (dt >= 0.05) return;                                   // hitches (GC, tab switch) are not sustained load
    this.acc += dt; this.n++;
    if (this.n < 90) return;
    const avg = this.acc / this.n; this.acc = this.n = 0;
    if (avg > 1 / 48 && this.i < this.steps.length - 1) this.set(this.i + 1);          // too slow → drop a step
    else if (avg < 1 / 58 && this.i > 0) this.set(this.i - 1);                          // headroom → climb back
  },
  set(i) { this.i = i; DPR = this.steps[i]; this.cool = 2.5; this.listeners.forEach((f) => f(DPR)); html.dataset.dpr = DPR; },
};
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
      // normalise to 0/90/180/270 (legacy window.orientation reports -90 for angle 270)
      const a = (((screen.orientation?.angle ?? window.orientation ?? 0) % 360) + 360) % 360;
      let x, y;
      if (a === 90) { x = e.beta; y = e.gamma; }
      else if (a === 270) { x = -e.beta; y = -e.gamma; }
      else if (a === 180) { x = -e.gamma; y = -e.beta; }
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

/* ============================ shared post chain ============================
   Final grade (runs after OutputPass, i.e. on display-referred sRGB):
     spectral chromatic aberration (5 wavelength taps, radial) · anamorphic streak ·
     halation (warm bleed around highlights, as on film) · lens dirt lit by the
     surrounding highlights · vignette · luminance-weighted animated grain ·
     triangular-PDF dither (kills 8-bit banding in the dark gradients).            */
const FINAL_SHADER = {
  uniforms: { tDiffuse: { value: null }, tDirt: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
              uVig: { value: 0.55 }, uCA: { value: 1.0 }, uGrain: { value: 0.035 }, uFlare: { value: 0 },
              uDirt: { value: 0.0 }, uHal: { value: 0.35 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
  fragmentShader: `
    uniform sampler2D tDiffuse, tDirt; uniform float uTime, uVig, uCA, uGrain, uFlare, uDirt, uHal; uniform vec2 uRes; uniform vec3 uTint;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float luma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
    void main(){
      vec2 c = vUv - .5; float r2 = dot(c, c);
      // spectral CA: 5 taps from red (outer) to violet (inner), weights sum to 1 per channel
      vec2 off = c * r2 * .022 * uCA;
    #ifdef LITE
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
    #else
      vec3 col = texture2D(tDiffuse, vUv + off).rgb * vec3(.55, .05, 0.)
               + texture2D(tDiffuse, vUv + off * .5).rgb * vec3(.35, .30, 0.)
               + texture2D(tDiffuse, vUv).rgb * vec3(.10, .30, .10)
               + texture2D(tDiffuse, vUv - off * .5).rgb * vec3(0., .30, .35)
               + texture2D(tDiffuse, vUv - off).rgb * vec3(0., .05, .55);
    #endif
    #ifndef LITE
      if (uFlare > 0.) {                     // anamorphic streak: horizontal smear of the brightest pixels
        vec3 st = vec3(0.);
        for (int i = -6; i <= 6; i++) { if (i == 0) continue; float o = float(i) * .045; vec3 t = texture2D(tDiffuse, vec2(vUv.x + o, vUv.y)).rgb;
          st += max(t - .82, 0.) * (1. - abs(float(i)) / 7.); }
        col += st * vec3(.55, .7, 1.) * .5 * uFlare;
      }
      // wide 8-tap highlight estimate → halation + lens dirt (cheap stand-in for a blurred bloom buffer)
      vec3 glow = vec3(0.);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * .785398 + .3; vec2 d = vec2(cos(a), sin(a) * uRes.x / uRes.y) * .035;
        glow += max(texture2D(tDiffuse, vUv + d).rgb - .7, 0.) + max(texture2D(tDiffuse, vUv + d * 2.6).rgb - .7, 0.) * .6;
      }
      glow /= 12.8;
      col += glow * vec3(1., .42, .2) * uHal;                                     // film halation: red-orange bleed
      if (uDirt > 0.) {
        vec3 dirt = texture2D(tDirt, vUv * vec2(uRes.x / uRes.y, 1.) * .55).rgb;
        col += dirt * (luma(glow) * 3.2 + .015) * uDirt;
      }
    #endif
      col *= uTint;
      col *= 1. - smoothstep(.12, .62, r2 * 1.35) * uVig;
      // grain: strongest in the mid-tones (as on film), invisible in pure black / white
      float L = luma(col);
      float g = (h(vUv * uRes + fract(uTime * 7.3) * 91.) - .5) * uGrain * (.35 + 2.6 * L * (1. - L));
      col += g;
      // triangular dither (±1 LSB)
      col += (h(vUv * uRes + 17.31) + h(vUv * uRes - 9.7) - 1.) / 255.;
      gl_FragColor = vec4(col, 1.);
    }`,
};

// procedural lens-dirt plate (soft dust specks, smudges, a few hairline scratches) — generated once, shared
let DIRT = null;
function dirtTexture() {
  if (DIRT) return DIRT;
  const N = 512, c = document.createElement("canvas"); c.width = c.height = N;
  const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, N, N);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 220; i++) {                       // dust specks
    const x = rnd() * N, y = rnd() * N, r = 1 + Math.pow(rnd(), 3) * 26, a = .05 + rnd() * .22;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,244,228,${a})`); gr.addColorStop(.6, `rgba(255,236,210,${a * .35})`); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  for (let i = 0; i < 9; i++) {                         // greasy smudges
    const x = rnd() * N, y = rnd() * N, r = 40 + rnd() * 110;
    const gr = g.createRadialGradient(x, y, r * .2, x, y, r);
    gr.addColorStop(0, "rgba(255,240,220,.06)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.lineCap = "round";
  for (let i = 0; i < 14; i++) {                        // hairline scratches
    g.strokeStyle = `rgba(255,248,236,${.04 + rnd() * .08})`; g.lineWidth = .6 + rnd();
    const x = rnd() * N, y = rnd() * N, a = rnd() * 6.28, l = 20 + rnd() * 90;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + .4) * l * .5, y + Math.sin(a + .4) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  DIRT = new THREE.CanvasTexture(c); DIRT.wrapS = DIRT.wrapT = THREE.RepeatWrapping; DIRT.colorSpace = THREE.NoColorSpace;
  return DIRT;
}

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
  try { GPU.aniso = r.capabilities.getMaxAnisotropy() || 1; GPU.maxTex = r.capabilities.maxTextureSize || GPU.maxTex; } catch { /* keep defaults */ }
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NeutralToneMapping;
  r.toneMappingExposure = 1.0;
  return r;
}

function makeComposer(renderer, scene, camera, { bloom = [0.5, 0.6, 0.88], smaa = !QA, dirt = 0.0, halation = 0.35 } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x * DPR), Math.max(1, size.y * DPR), { type: THREE.HalfFloatType, samples: QA ? 0 : (DPR >= 2.5 ? 2 : 4) });
  const composer = new EffectComposer(renderer, rt);
  if (!QA) Gov.listeners.add((d) => { const s = d >= 2.5 ? 2 : 4; [composer.renderTarget1, composer.renderTarget2].forEach((t) => { if (t && t.samples !== s) { t.samples = s; t.dispose(); } }); });
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), ...bloom);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  // SMAA on the display-referred image (after tone mapping), before grain so grain is never "anti-aliased" away
  let smaaPass = null;
  if (smaa) { smaaPass = new SMAAPass(Math.max(1, size.x * DPR), Math.max(1, size.y * DPR)); composer.addPass(smaaPass); }
  const final = new ShaderPass(FINAL_SHADER);
  // ?qa=1 (SwiftShader / CPU): ~21 taps per pixel tripped the GPU watchdog → context lost. LITE = 3 taps.
  if (QA) { final.material.defines = { ...(final.material.defines || {}), LITE: 1 }; final.material.needsUpdate = true; }
  final.uniforms.tDirt.value = dirtTexture(); final.uniforms.uDirt.value = dirt; final.uniforms.uHal.value = halation;
  composer.addPass(final);
  return { composer, bloomPass, final, smaaPass };
}

const GPU = { aniso: 8, maxTex: 16384 };
const loader = new THREE.TextureLoader();
const texCache = new Map();
function loadTex(url, { srgb = true } = {}) {
  if (texCache.has(url)) return texCache.get(url);
  const p = loader.loadAsync(url).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = Math.min(8, GPU.aniso); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }, (e) => { texCache.delete(url); throw e; });   // a failed (offline) load must be retryable, not cached forever
  texCache.set(url, p);
  return p;
}
function photoUrl(id, cssW) {
  const a = DATA.assets[id]; const target = Math.max(cssW, innerWidth) * DPR_MAX * 1.02;   // 0-wide host before layout fetched the 640 px file
  const ok = a.variants.filter((v) => v <= GPU.maxTex);
  const vs = ok.length ? ok : a.variants;
  const w = vs.find((v) => v >= target) || vs[vs.length - 1];
  return `${ROOT}${a.path}/${w}.webp`;
}

export { THREE, $, $$, DATA, ROOT, reduced, QA, DPR_MAX, DPR, html, Gov, clamp, lerp, ease, easeIO, col,
         GL_OK, Input, FINAL_SHADER, dirtTexture, onRestore, makeRenderer, makeComposer, GPU, loadTex, photoUrl,
         EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass, SMAAPass };
