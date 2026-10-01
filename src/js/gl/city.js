/* ScoreCity — OWNER: Agent D
   ============================ 3D SCORE CITY (showroom edition) ============================
   8 axes × 5 regions, height = score. A jewellery-showroom vitrine:
     • columns   — dispersive glass prisms (MeshPhysical transmission · IOR 1.52 · dispersion ·
                   faint iridescence · accent-tinted attenuation) with an emissive "filament" core,
                   a gold-engraved score on the top face and a brass foot ring
     • plinth    — black Marquina-type marble (ambientCG, CC0: colour + normal + roughness),
                   Makrana-white border band, gold inlay grid, pietra-dura floral frieze on the sides
                   (procedurally painted: carnelian / lapis / malachite stones set in white marble)
     • floor     — the plinth top is polished: a Reflector adds blurred, fresnel-weighted mirror
                   reflections of the columns on top of the shadowed marble
     • light     — Poly Haven HDRI studio IBL (CC0) · PCF soft key shadow · cool rim ·
                   a moving spotlight + volumetric light curtain on the selected axis row ·
                   fake caustics (coloured, shimmering) where each glass column focuses the key light
     • life      — rising sparks from the selected row, dust motes in the curtain, count-up plaques,
                   staggered growth on first view, tap a column → `city:pick` {region, axis}
   ?qa=1 (SwiftShader) keeps the same composition but swaps transmission / reflector / HDRI for
   cheap stand-ins so CI still renders in seconds.                                             */
import { THREE, $, DATA, ROOT, reduced, QA, DPR, Gov, clamp, lerp, ease, col, Input, makeRenderer, makeComposer, loadTex } from "./core.js";
import { RoundedBoxGeometry } from "../vendor/three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "../vendor/three/addons/environments/RoomEnvironment.js";
import { RGBELoader } from "../vendor/three/addons/loaders/RGBELoader.js";
import { Reflector } from "../vendor/three/addons/objects/Reflector.js";

const TEX = `${ROOT}assets/tex/`;
const GOLD = "#e9c27a";

/* ---------------- canvas helpers (labels, plaques, engraving, icons) ---------------- */
function canvasTex(c, { srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
function textSprite(text, { size = 44, color = "#f4ede3", font = "700 {s}px 'Zen Kaku Gothic New', sans-serif", pad = 10 } = {}) {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  const f = font.replace("{s}", size); g.font = f;
  const w = Math.ceil(g.measureText(text).width) + pad * 2, h = size + pad * 2;
  c.width = w; c.height = h; g.font = f; g.textBaseline = "middle"; g.textAlign = "center";
  g.shadowColor = "rgba(0,0,0,.8)"; g.shadowBlur = 8; g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 2);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(c, { aniso: 4 }), transparent: true, depthWrite: false, toneMapped: false }));
  s.userData.aspect = w / h; return s;
}
const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
function goldGrad(g, y0, y1) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, "#fff4d0"); gr.addColorStop(.28, "#f2c879"); gr.addColorStop(.5, "#a8701f"); gr.addColorStop(.62, "#d9a84f"); gr.addColorStop(1, "#7a4c12");
  return gr;
}
// draw one of the page's <symbol id="ax-…"> icons into a 2D context (Path2D understands SVG path data)
function drawSymbol(g, id, x, y, s, color) {
  const sym = document.getElementById(id); if (!sym) return;
  g.save(); g.translate(x, y); g.scale(s / 24, s / 24);
  g.strokeStyle = color; g.fillStyle = color; g.lineCap = "round"; g.lineJoin = "round";
  sym.querySelectorAll("path,circle").forEach((el) => {
    let p;
    if (el.tagName === "circle") { p = new Path2D(); p.arc(+el.getAttribute("cx"), +el.getAttribute("cy"), +el.getAttribute("r"), 0, Math.PI * 2); }
    else p = new Path2D(el.getAttribute("d"));
    g.globalAlpha = +(el.getAttribute("opacity") || 1);
    const fill = el.getAttribute("fill"), sw = el.getAttribute("stroke-width");
    if (fill && fill !== "none") g.fill(p);
    if (el.getAttribute("stroke") || sw) { g.lineWidth = +(sw || 1.6); g.stroke(p); }
    if (!fill && !sw && el.tagName === "path") g.fill(p);
  });
  g.restore();
}
// region plaque: enamel pill with a gold bezel and the region colour as a gem
function plaque(text, accent) {
  const H = 96, f = "700 46px 'Zen Kaku Gothic New', sans-serif";
  const c = document.createElement("canvas"), g = c.getContext("2d"); g.font = f;
  const W = Math.ceil(g.measureText(text).width) + 120; c.width = W; c.height = H + 16;
  g.shadowColor = "rgba(0,0,0,.7)"; g.shadowBlur = 12; g.shadowOffsetY = 4;
  rr(g, 6, 6, W - 12, H, H / 2); g.fillStyle = goldGrad(g, 6, H + 6); g.fill();
  g.shadowColor = "transparent";
  rr(g, 10, 10, W - 20, H - 8, (H - 8) / 2); const bg = g.createLinearGradient(0, 10, 0, H); bg.addColorStop(0, "#2b211a"); bg.addColorStop(1, "#0f0b08"); g.fillStyle = bg; g.fill();
  rr(g, 12, 12, W - 24, (H - 8) * .45, (H - 8) * .4); g.fillStyle = "rgba(255,255,255,.07)"; g.fill();
  const cx = 52, cy = 6 + H / 2, gem = g.createRadialGradient(cx - 6, cy - 8, 2, cx, cy, 20);
  gem.addColorStop(0, "#fff"); gem.addColorStop(.25, accent); gem.addColorStop(1, "#000");
  g.beginPath(); g.arc(cx, cy, 19, 0, 6.2832); g.fillStyle = goldGrad(g, cy - 19, cy + 19); g.fill();
  g.beginPath(); g.arc(cx, cy, 15, 0, 6.2832); g.fillStyle = gem; g.fill();
  g.font = f; g.textBaseline = "middle"; g.fillStyle = "#f6eee2"; g.fillText(text, 84, cy + 3);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(c), transparent: true, depthWrite: false, toneMapped: false }));
  s.userData.aspect = c.width / c.height; return s;
}
// axis label: embossed gold icon over the short name
function axisTag(a) {
  const W = 220, H = 150, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const halo = g.createRadialGradient(W / 2, 46, 4, W / 2, 46, 60); halo.addColorStop(0, "rgba(233,194,122,.28)"); halo.addColorStop(1, "rgba(233,194,122,0)");
  g.fillStyle = halo; g.fillRect(0, 0, W, H);
  g.shadowColor = "rgba(0,0,0,.85)"; g.shadowBlur = 8; g.shadowOffsetY = 3;
  drawSymbol(g, `ax-${a.id}`, W / 2 - 30, 16, 60, "#f2cf8a");
  g.font = "700 40px 'Zen Kaku Gothic New', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "#f6eee2"; g.fillText(a.short, W / 2, 118);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(c), transparent: true, depthWrite: false, toneMapped: false }));
  s.userData.aspect = W / H; return s;
}
// score engraved in gold on the column's top face (+ fine guilloché ring)
function engraving(v) {
  const N = 256, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  g.strokeStyle = "rgba(242,207,138,.55)"; g.lineWidth = 3; g.beginPath(); g.arc(N / 2, N / 2, N * .42, 0, 6.2832); g.stroke();
  g.lineWidth = 1.2; for (let i = 0; i < 48; i++) { const a = i / 48 * 6.2832; g.beginPath(); g.moveTo(N / 2 + Math.cos(a) * N * .36, N / 2 + Math.sin(a) * N * .36); g.lineTo(N / 2 + Math.cos(a) * N * (i % 4 ? .39 : .41), N / 2 + Math.sin(a) * N * (i % 4 ? .39 : .41)); g.stroke(); }
  g.font = "600 150px 'Cormorant Garamond', serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = "rgba(0,0,0,.9)"; g.shadowBlur = 4; g.shadowOffsetY = 3;
  g.fillStyle = goldGrad(g, 50, 200); g.fillText(String(v), N / 2, N / 2 + 8);
  return canvasTex(c);
}
// pietra-dura frieze: inlaid hardstone flowers on white Makrana marble (procedural, deterministic)
function pietraDura(marbleImg) {
  const W = 2048, H = 128, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  if (marbleImg) { for (let x = 0; x < W; x += H * 4) g.drawImage(marbleImg, 0, 0, marbleImg.width, marbleImg.width / 4, x, 0, H * 4, H); }
  else { g.fillStyle = "#e8e2d8"; g.fillRect(0, 0, W, H); }
  g.fillStyle = "rgba(0,0,0,.06)"; g.fillRect(0, 0, W, H);
  const band = (y) => { g.fillStyle = goldGrad(g, y - 3, y + 3); g.fillRect(0, y - 3, W, 6); g.fillStyle = "rgba(60,30,8,.6)"; g.fillRect(0, y + 3, W, 1); };
  band(10); band(H - 10);
  const stones = { carnelian: ["#e2563b", "#8f1d12"], lapis: ["#3d63c9", "#16245e"], malachite: ["#3fae6c", "#0f4a2a"], amber: ["#f2b544", "#9a5a10"], onyx: ["#2a2420", "#000"] };
  const stone = (path, [a, b], cx, cy, r) => {
    const gr = g.createRadialGradient(cx - r * .3, cy - r * .35, r * .1, cx, cy, r * 1.2); gr.addColorStop(0, a); gr.addColorStop(1, b);
    g.fillStyle = gr; g.fill(path); g.strokeStyle = "rgba(40,22,10,.75)"; g.lineWidth = 1.4; g.stroke(path);
  };
  const step = 128;
  for (let x0 = 0; x0 < W; x0 += step) {
    const cx = x0 + step / 2, cy = H / 2;
    // the vine connecting motifs
    g.strokeStyle = "#2f6b3e"; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, cy + 14); g.bezierCurveTo(x0 + 30, cy - 18, x0 + 98, cy + 30, x0 + step, cy + 14); g.stroke();
    // leaves
    [[-38, 10, -0.6], [36, 16, 0.7], [-20, 24, 2.3], [24, -18, -2.2]].forEach(([dx, dy, a]) => {
      const p = new Path2D(); g.save(); const lx = cx + dx, ly = cy + dy;
      p.ellipse(lx, ly, 13, 5.5, a, 0, Math.PI * 2); stone(p, stones.malachite, lx, ly, 13); g.restore();
    });
    // flower: 6 petals alternating carnelian / amber, lapis heart
    const kind = (x0 / step) % 2 ? stones.carnelian : stones.lapis;
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2, px = cx + Math.cos(a) * 15, py = cy - 6 + Math.sin(a) * 15;
      const p = new Path2D(); p.ellipse(px, py, 12, 7, a, 0, Math.PI * 2); stone(p, k % 2 ? stones.amber : kind, px, py, 12);
    }
    const ctr = new Path2D(); ctr.arc(cx, cy - 6, 7, 0, Math.PI * 2); stone(ctr, stones.onyx, cx, cy - 6, 7);
    g.fillStyle = "rgba(255,255,255,.75)"; g.beginPath(); g.arc(cx - 2, cy - 9, 2, 0, 6.28); g.fill();
  }
  const t = canvasTex(c); t.wrapS = THREE.RepeatWrapping; return t;
}
// soft radial blob (contact AO / glow sprites)
function blobTex(inner = "rgba(0,0,0,1)", outer = "rgba(0,0,0,0)") {
  const N = 128, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, N, N); return canvasTex(c, { srgb: false, aniso: 1 });
}

/* ---------------- shaders ---------------- */
// mirror layer on the polished plinth: blurred, fresnel-weighted, faded towards the plinth edge
const MIRROR_SHADER = {
  name: "CityMirror",
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uStr: { value: 0.55 }, uSize: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) } },
  vertexShader: `
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vL; varying vec3 vW;
    void main(){ vUv = textureMatrix * vec4(position, 1.); vL = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float uStr; uniform vec2 uTexel; varying vec4 vUv; varying vec2 vL; varying vec3 vW;
    void main(){
      vec2 p = vUv.xy / vUv.w; vec3 acc = vec3(0.); float wsum = 0.;
      for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {           // 25-tap blur: polished, not glass-perfect
        float w = exp(-float(i * i + j * j) / 4.); acc += texture2D(tDiffuse, p + vec2(float(i), float(j)) * uTexel * 2.2).rgb * w; wsum += w; }
      vec3 refl = acc / wsum;
      vec3 V = normalize(cameraPosition - vW); float fr = .06 + .94 * pow(1. - clamp(V.y, 0., 1.), 5.);
      vec2 e = min(vL, 1. - vL); float edge = smoothstep(0., .06, min(e.x, e.y));
      gl_FragColor = vec4(refl * color * (fr * 1.6 + .18) * uStr * edge, 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};
const CURTAIN_V = `varying vec3 vN; varying vec3 vW; varying float vY;
  void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vY = uv.y; gl_Position = projectionMatrix * viewMatrix * w; }`;
const CURTAIN_F = `uniform vec3 uCol; uniform float uA, uT; varying vec3 vN; varying vec3 vW; varying float vY;
  float hs(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(hs(i), hs(i + vec2(1, 0)), f.x), mix(hs(i + vec2(0, 1)), hs(i + vec2(1, 1)), f.x), f.y); }
  void main(){
    vec3 V = normalize(cameraPosition - vW); float face = abs(dot(normalize(vN), V));
    float body = pow(face, 1.6);                                   // soft edges: the cone has no hard silhouette
    float fall = smoothstep(0., .35, vY) * (1. - smoothstep(.75, 1., vY)) * (.35 + .65 * (1. - vY));
    float dust = .65 + .35 * n2(vec2(vW.x * 3. + vW.z * 1.7, vW.y * 2. - uT * .35)) * n2(vec2(vW.z * 2.3, vW.y * 4. + uT * .2));
    gl_FragColor = vec4(uCol * body * fall * dust * uA, 1.);
  }`;
const CAUSTIC_F = `uniform vec3 uCol; uniform float uT, uA; varying vec2 vUv;
  float c(vec2 p, float t){ float v = 0.; for (int i = 0; i < 4; i++) { float fi = float(i);
      p = vec2(p.x * 1.3 + sin(p.y * 1.7 + t * (.6 + fi * .13)), p.y * 1.3 + cos(p.x * 1.9 - t * (.5 + fi * .11))); v += 1. / (1. + 9. * abs(sin(p.x) * sin(p.y))); }
    return v / 4.; }
  void main(){ vec2 q = vUv - .5; float r = length(q * vec2(1., 1.6)); float m = 1. - smoothstep(.12, .5, r);
    float k = pow(c(q * 9., uT), 2.2);
    gl_FragColor = vec4(uCol * k * m * uA * 2.2, 1.); }`;
const SPARK_V = `attribute vec4 aSeed; uniform float uT, uRowX, uRise, uPx; uniform float uH[5]; uniform float uZ[5]; varying float vA;
  void main(){
    int j = int(aSeed.x); float h = 1.; float z = 0.;
    for (int k = 0; k < 5; k++) if (k == j) { h = uH[k]; z = uZ[k]; }
    float life = fract(uT * aSeed.y + aSeed.z);
    vec3 p = vec3(uRowX + (aSeed.w - .5) * .55 + sin(life * 9. + aSeed.z * 30.) * .04,
                  .05 + life * (h + 1.1),
                  z + (fract(aSeed.w * 7.31) - .5) * .55);
    vA = smoothstep(0., .12, life) * (1. - smoothstep(.55, 1., life)) * uRise;
    vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uPx * (1.2 + fract(aSeed.z * 13.) * 1.6) / -mv.z, 1., 18.);
  }`;
const SPARK_F = `uniform vec3 uCol; varying float vA;
  void main(){ vec2 d = gl_PointCoord - .5; float r = length(d); float a = (1. - smoothstep(0., .5, r)); a = a * a;
    gl_FragColor = vec4(uCol * a * vA * 3., 1.); }`;
const BACK_F = `varying vec3 vP; uniform vec3 uA, uB;
  void main(){ vec3 d = normalize(vP); float h = d.y; float g = exp(-pow(max(h + .05, 0.) * 3.2, 2.)) ;
    gl_FragColor = vec4(mix(uB, uA, g * (1. - smoothstep(-.4, -.05, -abs(d.x) * .2 - .1) * .2)), 1.); }`;

class ScoreCity {
  constructor(host) {
    this.host = host; this.visible = false; this.ready = false; this.t = 0; this.az = -0.55; this.azT = -0.55;
    this.sel = DATA.axes[0].id; this.selT = 0; this.picked = null; this.pickT = 0;
    const canvas = document.createElement("canvas"); canvas.className = "gl-canvas gl-city"; canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas); this.canvas = canvas;
    this.renderer = makeRenderer(canvas);
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.transmissionResolutionScale = QA ? 0.5 : 1;
    this.scene = new THREE.Scene(); this.scene.background = col("#0b0807");
    this.scene.fog = new THREE.Fog(0x0b0807, 16, 34);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;   // instant stand-in; HDRI replaces it
    this.scene.environmentIntensity = 0.32;
    if (!QA) {
      new RGBELoader().loadAsync(`${TEX}d-studio_1k.hdr`).then((hdr) => {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        const env = pm.fromEquirectangular(hdr).texture; hdr.dispose(); pm.dispose();
        this.scene.environment = env; this.scene.environmentIntensity = 0.55;
        this.scene.environmentRotation = new THREE.Euler(0, 1.9, 0);
      }).catch(() => pm.dispose());
    } else pm.dispose();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
    Object.assign(this, makeComposer(this.renderer, this.scene, this.camera, { bloom: [0.42, 0.5, 0.9], halation: 0.28 }));
    this.final.uniforms.uVig.value = 0.5; this.final.uniforms.uCA.value = 0.55; this.final.uniforms.uGrain.value = 0.022;
    this.build();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    Gov.listeners.add(() => this.resize());
    new IntersectionObserver((es) => es.forEach((e) => { this.visible = e.isIntersecting; if (e.isIntersecting && !this.t0) this.t0 = performance.now(); }), { threshold: 0.15 }).observe(host);
    document.addEventListener("axis:select", (e) => { if (e.detail !== this.sel) { this.sel = e.detail; this.selT = this.t; } });
    this.bindInput();
    this.ready = true;
  }

  build() {
    const A = DATA.axes, Rg = DATA.regions, sx = 1.0, sz = 1.25;
    this.sx = sx; this.sz = sz;
    const x0 = -(A.length - 1) * sx / 2, z0 = -(Rg.length - 1) * sz / 2; this.x0 = x0; this.z0 = z0;
    const PW = A.length * sx + 1.3, PD = Rg.length * sz + 1.2, PH = 0.42;
    this.span = { w: A.length * sx, d: Rg.length * sz };
    const S = this.scene;

    // ---------- backdrop: warm studio falloff ----------
    const back = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uA: { value: col("#2a1a10") }, uB: { value: col("#070505") } },
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }", fragmentShader: BACK_F }));
    S.add(back);
    // floor around the plinth (catches the plinth's own shadow)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(18, 64), new THREE.ShadowMaterial({ opacity: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -PH; floor.receiveShadow = true; S.add(floor);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(PW * 2.2, PD * 2.2), new THREE.MeshBasicMaterial({ map: blobTex("rgba(233,170,90,.22)", "rgba(0,0,0,0)"), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = -PH + 0.002; S.add(glow);

    // ---------- plinth: black marble + Makrana band + pietra-dura frieze + gold inlay ----------
    const marble = new THREE.MeshPhysicalMaterial({ color: 0x9a9088, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.9 });
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(PW, PH, PD, 6, 0.06), marble);
    plinth.position.y = -PH / 2; plinth.receiveShadow = true; plinth.castShadow = true; S.add(plinth);
    Promise.all([loadTex(`${TEX}d-marble-black.jpg`), loadTex(`${TEX}d-marble-black-n.jpg`, { srgb: false }), loadTex(`${TEX}d-marble-black-r.jpg`, { srgb: false })]).then(([m, n, r]) => {
      [m, n, r].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.6, 1.1); t.needsUpdate = true; });
      Object.assign(marble, { map: m, normalMap: n, roughnessMap: r, color: new THREE.Color(1, 1, 1) }); marble.normalScale.set(0.35, 0.35); marble.needsUpdate = true;
    }).catch(() => {});
    // pietra-dura frieze wrapping the plinth sides
    const friezeM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const fz = (w, d, ry, x, z, rep) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, PH * 0.62), friezeM.clone()); m.rotation.y = ry; m.position.set(x, -PH * 0.47, z); m.userData.rep = rep; m.receiveShadow = true; S.add(m); return m;
    };
    const friezes = [fz(PW - 0.1, 0, 0, 0, PD / 2 + 0.002, PW / 1.6), fz(PW - 0.1, 0, Math.PI, 0, -PD / 2 - 0.002, PW / 1.6),
      fz(PD - 0.1, 0, Math.PI / 2, PW / 2 + 0.002, 0, PD / 1.6), fz(PD - 0.1, 0, -Math.PI / 2, -PW / 2 - 0.002, 0, PD / 1.6)];
    const paintFrieze = (img) => { const t = pietraDura(img); friezes.forEach((m) => { const tt = t.clone(); tt.repeat.set(m.userData.rep, 1); tt.needsUpdate = true; m.material.map = tt; m.material.needsUpdate = true; }); };
    const wimg = new Image(); wimg.onload = () => paintFrieze(wimg); wimg.onerror = () => paintFrieze(null); wimg.src = `${TEX}d-marble-white.jpg`;
    // white marble border band on the top face
    const white = new THREE.MeshPhysicalMaterial({ color: 0xeee6da, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
    loadTex(`${TEX}d-marble-white.jpg`).then((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 0.3); t.needsUpdate = true; white.map = t; white.color.set(0xffffff); white.needsUpdate = true; }).catch(() => {});
    const bw = 0.22, by = 0.004;
    [[PW - 0.12, bw, 0, PD / 2 - 0.06 - bw / 2], [PW - 0.12, bw, 0, -PD / 2 + 0.06 + bw / 2], [bw, PD - 0.12 - bw * 2, PW / 2 - 0.06 - bw / 2, 0], [bw, PD - 0.12 - bw * 2, -PW / 2 + 0.06 + bw / 2, 0]].forEach(([w, d, x, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, by * 2, d), white); m.position.set(x, 0, z); m.receiveShadow = true; S.add(m);
    });
    // gold: rim around the plinth + inlay grid strips + corner rosettes
    const gold = new THREE.MeshStandardMaterial({ color: col(GOLD), metalness: 1, roughness: 0.22, envMapIntensity: 1.4 });
    const strip = (w, d, x, z, y = 0.006, hgt = 0.006) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), gold); m.position.set(x, y, z); m.receiveShadow = true; S.add(m); return m; };
    strip(PW - 0.1, 0.018, 0, PD / 2 - 0.06); strip(PW - 0.1, 0.018, 0, -PD / 2 + 0.06); strip(0.018, PD - 0.1, PW / 2 - 0.06, 0); strip(0.018, PD - 0.1, -PW / 2 + 0.06, 0);
    const ix0 = x0 - sx / 2, ix1 = x0 + (A.length - 0.5) * sx, iz0 = z0 - sz / 2, iz1 = z0 + (Rg.length - 0.5) * sz;
    for (let i = 0; i <= A.length; i++) strip(0.012, iz1 - iz0, ix0 + i * sx, (iz0 + iz1) / 2, 0.003, 0.004);
    for (let j = 0; j <= Rg.length; j++) strip(ix1 - ix0, 0.012, (ix0 + ix1) / 2, iz0 + j * sz, 0.003, 0.004);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 4), new THREE.MeshBasicMaterial({ color: col("#ffb35c").multiplyScalar(1.4), toneMapped: false }));
    rim.rotation.set(Math.PI / 2, 0, Math.PI / 4); rim.scale.set(PW / Math.SQRT2 + 0.01, PD / Math.SQRT2 + 0.01, 1); rim.position.y = -PH - 0.002; S.add(rim);
    const rose = new THREE.CylinderGeometry(0.09, 0.09, 0.01, 8);
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => { const m = new THREE.Mesh(rose, gold); m.position.set(a * (PW / 2 - 0.17), 0.006, b * (PD / 2 - 0.17)); S.add(m); });

    // ---------- polished mirror layer ----------
    if (!QA) {
      this.mirror = new Reflector(new THREE.PlaneGeometry(PW - 0.14, PD - 0.14), { textureWidth: 512, textureHeight: 512, color: 0xffffff, clipBias: 0.003, multisample: 4, shader: MIRROR_SHADER });
      this.mirror.rotation.x = -Math.PI / 2; this.mirror.position.y = 0.0015;
      Object.assign(this.mirror.material, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      S.add(this.mirror);
    }

    // ---------- columns ----------
    this.cols = [];
    const aoT = blobTex("rgba(0,0,0,.85)", "rgba(0,0,0,0)");
    const aoG = new THREE.PlaneGeometry(0.95, 0.95), ringG = new THREE.TorusGeometry(0.3, 0.012, 8, 48), footG = new RoundedBoxGeometry(0.58, 0.05, 0.58, 2, 0.02);
    const topG = new THREE.PlaneGeometry(0.42, 0.42), causticG = new THREE.PlaneGeometry(1.1, 1.1);
    const lead = Object.fromEntries(A.map((a) => [a.id, Math.max(...Rg.map((r) => r.scores[a.id]))]));
    Rg.forEach((r, j) => {
      const c = col(r.accent);
      A.forEach((a, i) => {
        const v = r.scores[a.id], h = v * 0.24, px = x0 + i * sx, pz = z0 + j * sz;
        const g = new RoundedBoxGeometry(0.46, h, 0.46, 5, 0.06); g.translate(0, h / 2, 0);
        const m = QA
          ? new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, emissive: c, emissiveIntensity: 0.06, transparent: true, opacity: 0.9 })
          : new THREE.MeshPhysicalMaterial({ color: c.clone().lerp(new THREE.Color(1, 1, 1), 0.55), roughness: 0.04, metalness: 0, transmission: 1, thickness: 0.46, ior: 1.52,
              dispersion: 0.35, attenuationColor: c, attenuationDistance: 0.55, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.03,
              iridescence: 0.25, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 420], emissive: c, emissiveIntensity: 0.0, envMapIntensity: 1.25 });
        const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = !QA ? false : true;
        mesh.position.set(px, 0, pz); mesh.scale.set(1, 0.001, 1);
        // luminous filament core, seen refracted through the glass
        const core = new THREE.Mesh(new THREE.BoxGeometry(0.1, Math.max(0.02, h - 0.14), 0.1).translate(0, (h - 0.14) / 2 + 0.07, 0),
          new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(1, 1, 1), 0.25).multiplyScalar(1.6), toneMapped: false }));
        mesh.add(core);
        const cap = new THREE.Mesh(topG, new THREE.MeshBasicMaterial({ map: engraving(v), transparent: true, depthWrite: false, toneMapped: false, opacity: 0, color: new THREE.Color(1.6, 1.4, 1.1) }));
        cap.rotation.order = "YXZ"; cap.rotation.x = -Math.PI / 2; cap.position.set(px, 0, pz);
        const foot = new THREE.Mesh(footG, gold); foot.position.set(px, 0.025, pz); foot.castShadow = true; foot.receiveShadow = true;
        const ao = new THREE.Mesh(aoG, new THREE.MeshBasicMaterial({ map: aoT, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true, color: 0xffffff }));
        ao.rotation.x = -Math.PI / 2; ao.position.set(px, 0.0025, pz);
        ao.material.blending = THREE.NormalBlending; ao.material.opacity = 0.75;
        const ring = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(3), toneMapped: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(px, 0.055, pz);
        // caustic: light focused by the glass, thrown away from the key light (+x, -z)
        const caus = new THREE.Mesh(causticG, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
          uniforms: { uCol: { value: c.clone().lerp(new THREE.Color(1, .95, .85), .35) }, uT: { value: Math.random() * 10 }, uA: { value: 0 } },
          vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }", fragmentShader: CAUSTIC_F }));
        caus.rotation.x = -Math.PI / 2; caus.rotation.z = 0.7; caus.position.set(px + 0.36, 0.004, pz - 0.3);
        caus.visible = !QA;
        S.add(mesh, cap, foot, ao, ring, caus);
        this.cols.push({ mesh, core, cap, ring, caus, h, v, axis: a.id, region: r.id, i, j, lead: v === lead[a.id], lift: 0 });
      });
      const lab = plaque(r.short, r.accent);
      lab.position.set(x0 - sx * 1.2, 0.3, z0 + j * sz); lab.scale.set(0.3 * lab.userData.aspect, 0.3, 1); S.add(lab);
    });
    this.axisLabels = A.map((a, i) => {
      const s = axisTag(a); s.position.set(x0 + i * sx, 0.36, z0 + (Rg.length - 0.1) * sz + 0.42); s.scale.set(0.62 * s.userData.aspect, 0.62, 1); S.add(s); return s;
    });
    // floating count-up plaques over the selected row
    this.vals = Rg.map(() => {
      const c = document.createElement("canvas"); c.width = 220; c.height = 120; const t = canvasTex(c, { aniso: 4 });
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
      s.scale.set(0.62, 0.34, 1); S.add(s); return { c, g: c.getContext("2d"), t, s, shown: -1 };
    });

    // ---------- lights ----------
    const key = new THREE.DirectionalLight(0xffe2bd, 2.1); key.position.set(-5, 9, 6); key.castShadow = true;
    key.shadow.mapSize.set(QA ? 512 : 4096, QA ? 512 : 4096); key.shadow.radius = 6; key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
    S.add(key, new THREE.HemisphereLight(0xffd9a8, 0x100806, 0.16));
    const rimL = new THREE.DirectionalLight(0x7aa7ff, 1.3); rimL.position.set(6, 4, -7); S.add(rimL);
    const warmB = new THREE.PointLight(0xff9a4a, 6, 14, 2); warmB.position.set(0, 1.2, -PD / 2 - 2.2); S.add(warmB);
    this.spot = new THREE.SpotLight(0xffd59a, 0, 16, 0.36, 0.75, 1.4); this.spot.position.set(x0, 7.5, 0.4);
    this.spot.castShadow = !QA; this.spot.shadow.mapSize.set(1024, 1024); this.spot.shadow.bias = -0.0004;
    this.spot.target.position.set(x0, 0, 0); S.add(this.spot, this.spot.target);
    // volumetric light curtain (elongated soft cone along the selected axis row)
    const cg = new THREE.CylinderGeometry(0.12, 0.62, 7.4, 48, 1, true); cg.translate(0, 3.7, 0);
    this.curtain = new THREE.Mesh(cg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uCol: { value: col("#ffcf8a") }, uA: { value: 0 }, uT: { value: 0 } }, vertexShader: CURTAIN_V, fragmentShader: CURTAIN_F }));
    this.curtain.scale.set(1, 1, (Rg.length * sz) / 1.1); this.curtain.position.set(x0, 0, 0); S.add(this.curtain);
    // rising sparks from the selected row
    const N = QA ? 160 : 900, seeds = new Float32Array(N * 4);
    for (let k = 0; k < N; k++) seeds.set([k % Rg.length, 0.12 + Math.random() * 0.25, Math.random(), Math.random()], k * 4);
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3)); sg.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    this.sparks = new THREE.Points(sg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uT: { value: 0 }, uRowX: { value: x0 }, uRise: { value: 0 }, uPx: { value: 40 }, uH: { value: new Array(5).fill(1) }, uZ: { value: Rg.map((_, j) => z0 + j * sz).concat([0, 0, 0, 0, 0]).slice(0, 5) }, uCol: { value: col("#ffd79a") } },
      vertexShader: SPARK_V, fragmentShader: SPARK_F }));
    this.sparks.frustumCulled = false; S.add(this.sparks);
  }

  bindInput() {
    this.canvas.style.touchAction = "pan-y";
    let g = null;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    this.canvas.addEventListener("pointerdown", (e) => { if (e.isPrimary) g = { x: e.clientX, y: e.clientY, a: this.azT, h: null, id: e.pointerId, t: performance.now() }; });
    addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (g.h === null && Math.hypot(dx, dy) > 8) g.h = Math.abs(dx) > Math.abs(dy);
      if (g.h) this.azT = clamp(g.a - dx / this.w * 2.4, -1.3, 1.3);
    }, { passive: true });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const tap = g.h === null && performance.now() - g.t < 450 && e.type === "pointerup"; g = null;
      if (!tap) return;
      const b = this.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects(this.cols.map((c) => c.mesh), false)[0];
      const c = hit && this.cols.find((x) => x.mesh === hit.object);
      if (!c) return;
      this.picked = c; this.pickT = this.t;
      document.dispatchEvent(new CustomEvent("city:pick", { detail: { region: c.region, axis: c.axis } }));
    };
    addEventListener("pointerup", end, { passive: true }); addEventListener("pointercancel", end, { passive: true });
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(DPR); this.composer.setPixelRatio(DPR);
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.final.uniforms.uRes.value.set(w * DPR, h * DPR);
    if (this.mirror) { const rt = this.mirror.getRenderTarget(); rt.setSize(Math.round(w * DPR * 0.6), Math.round(h * DPR * 0.6)); this.mirror.material.uniforms.uTexel.value.set(1 / (w * DPR * 0.6), 1 / (h * DPR * 0.6)); }
    this.sparks.material.uniforms.uPx.value = h * DPR * 0.11;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    this.R = clamp(Math.max((this.span.w + 2.8) / (2 * Math.tan(fov / 2) * this.camera.aspect), (this.span.d + 2.9) / (2 * Math.tan(fov / 2))) * 0.95, 7, 24);
  }

  drawVal(o, v, accent) {
    const g = o.g, W = 220, H = 120; g.clearRect(0, 0, W, H);
    g.shadowColor = "rgba(0,0,0,.75)"; g.shadowBlur = 10; g.shadowOffsetY = 3;
    rr(g, 30, 14, W - 60, 74, 37); g.fillStyle = goldGrad(g, 14, 88); g.fill(); g.shadowColor = "transparent";
    rr(g, 34, 18, W - 68, 66, 33); g.fillStyle = "#130d09"; g.fill();
    g.beginPath(); g.moveTo(W / 2 - 10, 88); g.lineTo(W / 2, 104); g.lineTo(W / 2 + 10, 88); g.fillStyle = "#c8913a"; g.fill();
    g.font = "600 52px 'Cormorant Garamond', serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = accent; g.fillText(v.toFixed(v < 10 && v % 1 ? 1 : 0), W / 2 - 8, 54);
    g.font = "500 22px 'Cormorant Garamond', serif"; g.fillStyle = "rgba(246,238,226,.65)"; g.fillText("/10", W / 2 + 40, 60);
    o.t.needsUpdate = true;
  }

  frame(dt) {
    if (!this.visible || !this.ready) return;
    this.t += dt; const T = this.t; this.final.uniforms.uTime.value = T;
    const since = this.t0 ? (performance.now() - this.t0) / 1000 : 0;
    this.az = lerp(this.az, this.azT + (reduced ? 0 : Math.sin(T * 0.15) * 0.08 + Input.tx * 0.1), 1 - Math.exp(-dt * 4));
    const pol = 1.0 - (reduced ? 0 : Input.ty * 0.04);
    this.camera.position.set(Math.sin(this.az) * Math.sin(pol) * this.R, Math.cos(pol) * this.R + 0.4, Math.cos(this.az) * Math.sin(pol) * this.R);
    this.camera.lookAt(0, 0.55, 0.15);
    const k1 = 1 - Math.exp(-dt * 6);
    let rowX = this.x0; const hs = [0, 0, 0, 0, 0];
    this.cols.forEach((c) => {
      const k = reduced ? 1 : ease(clamp((since - 0.1 - c.i * 0.07 - c.j * 0.05) / 1.2, 0, 1));
      const on = c.axis === this.sel, pk = this.picked === c;
      c.lift = lerp(c.lift, on ? 1 : 0, k1);
      c.mesh.scale.y = Math.max(0.001, k);
      c.mesh.position.y = c.lift * 0.06;
      const hh = c.h * k + c.lift * 0.06;
      c.core.material.color.copy(col(DATA.regions[c.j].accent)).lerp(new THREE.Color(1, 1, 1), 0.25).multiplyScalar(0.9 + c.lift * 2.6 + (c.lead ? 0.5 : 0) + (pk ? Math.max(0, 1.5 - (T - this.pickT)) * 2 : 0));
      if (c.mesh.material.emissiveIntensity !== undefined && QA) c.mesh.material.emissiveIntensity = 0.04 + c.lift * 0.35;
      c.cap.position.y = hh + 0.004; c.cap.rotation.y = this.az; c.cap.material.opacity = k * (0.55 + c.lift * 0.45);
      c.ring.material.opacity = (c.lift * 0.6 + (c.lead && on ? 0.4 + Math.sin(T * 4) * 0.2 : 0) + (pk ? Math.max(0, 1 - (T - this.pickT)) : 0)) * k;
      c.ring.scale.setScalar(1 + (pk ? (T - this.pickT) % 1.2 * 0.6 : 0) + c.lift * 0.08);
      c.caus.material.uniforms.uT.value += dt * 0.8; c.caus.material.uniforms.uA.value = k * (0.12 + c.lift * 0.3);
      if (on) { rowX = c.mesh.position.x; hs[c.j] = c.h; }
    });
    // spotlight + curtain glide to the selected row
    const kk = 1 - Math.exp(-dt * 3.2);
    this.curtain.position.x = lerp(this.curtain.position.x, rowX, kk);
    this.spot.position.x = this.curtain.position.x; this.spot.target.position.x = this.curtain.position.x;
    this.spot.intensity = lerp(this.spot.intensity, since > 1 ? 60 : 0, 1 - Math.exp(-dt * 2));
    const swap = clamp((T - this.selT) / 0.6, 0, 1);
    const cu = this.curtain.material.uniforms; cu.uT.value = T; cu.uA.value = lerp(cu.uA.value, since > 1 ? 0.075 * (0.55 + 0.45 * swap) : 0, kk);
    const su = this.sparks.material.uniforms; su.uT.value = T; su.uRowX.value = this.curtain.position.x; su.uH.value = hs;
    su.uRise.value = lerp(su.uRise.value, reduced ? 0 : (since > 1.2 ? 1 : 0) * swap, kk);
    this.axisLabels.forEach((s, i) => { const on = DATA.axes[i].id === this.sel; s.material.opacity = lerp(s.material.opacity, on ? 1 : 0.42, k1); const sc = on ? 0.72 : 0.6; s.scale.set(sc * s.userData.aspect, sc, 1); });
    // count-up plaques
    const cnt = reduced ? 1 : ease(clamp((T - this.selT) / 0.9, 0, 1));
    this.vals.forEach((o, j) => {
      const c = this.cols.find((x) => x.j === j && x.axis === this.sel); if (!c) return;
      const v = Math.round(c.v * cnt * 10) / 10;
      if (v !== o.shown) { o.shown = v; this.drawVal(o, cnt < 1 ? v : c.v, DATA.regions[j].accent); }
      o.s.position.set(c.mesh.position.x, c.h * c.mesh.scale.y + c.mesh.position.y + 0.32 + (reduced ? 0 : Math.sin(T * 1.6 + j) * 0.03), c.mesh.position.z);
      o.s.material.opacity = lerp(o.s.material.opacity, since > 1.2 ? 1 : 0, k1);
    });
    this.composer.render(dt);
  }
}

export { ScoreCity, textSprite };
