/* TerrainMap — OWNER: Agent C */
import { THREE, $, $$, DATA, ROOT, reduced, QA, DPR_MAX, DPR, html, Gov, clamp, lerp, ease, easeIO, col, GL_OK, Input, FINAL_SHADER, onRestore, makeRenderer, makeComposer, GPU, loadTex, photoUrl } from "./core.js?v=24fe1e9eaa";
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
    this.az = 0; this.azT = 0; this.focus = null; this.fly = null; this.pending = undefined;
    // taps that arrive while the terrain is still downloading are remembered and replayed once it is built
    this.onEarlyFocus = (e) => { if (!this.ready) this.pending = e.detail; };
    this.onEarlyClose = () => { if (!this.ready) this.pending = undefined; };
    document.addEventListener("map:focus", this.onEarlyFocus);
    document.addEventListener("sheet:close", this.onEarlyClose);
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
    this.build().catch((e) => {
      console.warn("[gl] terrain failed", e);
      // no terrain (offline / 404) → hand the stage back to the static SVG map instead of an empty black canvas
      canvas.remove(); this.visible = false; this.host.classList.remove("gl-ready"); html.classList.remove("gl-map-on");
    });
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
          vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = clamp((1.5 + aSeed * 3.) * uPR * 6. / max(-mv.z, .05), 0., 64.); gl_Position = projectionMatrix * mv;
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
    document.removeEventListener("map:focus", this.onEarlyFocus);
    document.removeEventListener("sheet:close", this.onEarlyClose);
    if (this.pending && this.pins[this.pending]) this.flyTo(this.pending);
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
        const v = q.clone().project(this.camera); if (v.z > 1 || v.z < -1) continue;
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
      if (tap && e && e.type === "pointerup" && this.ready && e.target === this.canvas) {
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
    if (this.pins) Object.values(this.pins).forEach((p) => { p.lw = p.lh = 0; });   // re-measure label pills (fonts / rotation)
    this.fitAll();
  }
  frame(dt, now) {
    if (!this.visible || !this.ready) return;
    this.t += dt; this.u.uTime.value = this.t; this.final.uniforms.uTime.value = this.t;
    if (this.fly) this.fly(now);
    const r = this.host.getBoundingClientRect();
    const p = clamp(1 - (r.top + r.height * 0.5) / innerHeight, 0, 1);  // 0 entering → 1 leaving
    const polar = lerp(0.22, 0.7, ease(clamp(p * 1.6, 0, 1))) - (this.focus ? 0.05 : 0);
    this.az = lerp(this.az, this.azT + (reduced ? 0 : Input.tx * 0.12 + Math.sin(this.t * 0.07) * 0.06), 1 - Math.exp(-dt * 4));
    this.target.lerp(this.tgt, 1 - Math.exp(-dt * 6));
    const pol = polar - (reduced ? 0 : Input.ty * 0.05);
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
    // labels behind the camera are hidden — they must not push visible labels around
    for (let i = L.length - 1; i >= 0; i--) if (L[i].z >= 1) { L[i].pin.label.style.visibility = "hidden"; L.splice(i, 1); }
    L.sort((a, b) => a.y0 - b.y0);
    L.forEach((l) => (l.y = l.y0));
    for (let it = 0; it < 4; it++) for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const ox = Math.min(a.x + a.pin.lw, b.x + b.pin.lw) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.pin.lh / 2, b.y + b.pin.lh / 2) - Math.max(a.y - a.pin.lh / 2, b.y - b.pin.lh / 2);
      if (ox > -6 && oy > -4) { const push = (oy + 4) / 2; a.y -= push; b.y += push; }
    }
    L.forEach(({ pin, id, x, y, y0, z }) => {
      const cy = clamp(y, 24, Math.max(24, this.h - 24)), cx = clamp(x, 8, Math.max(8, this.w - pin.lw - 8));
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

export { TerrainMap };
