/* DepthHero — OWNER: Agent B */
import { THREE, $, $$, DATA, ROOT, reduced, QA, DPR_MAX, DPR, html, Gov, clamp, lerp, ease, easeIO, col, GL_OK, Input, FINAL_SHADER, onRestore, makeRenderer, makeComposer, GPU, loadTex, photoUrl } from "./core.js?v=bc9b3fbf97";
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
    // volumetric god rays fanning down from a sun behind the far plane (only far/bright pixels scatter)
    vec2 sun = vec2(.78, 1.02);
    vec2 dv = vUv - sun; float ang = atan(dv.y, dv.x);
    float rays = pow(.5 + .5 * sin(ang * 38. + uTime * .05) * sin(ang * 17. - uTime * .03), 3.);
    float fall = exp(-length(dv) * 2.4);
    c += mix(uHaze, acc, .35) * rays * fall * (1. - d) * .10;
    // warm bloom halo around the sun position
    c += uHaze * pow(max(0., 1. - length((vUv - sun) * vec2(1., 1.4)) * 1.8), 3.) * .10;
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
    gl_PointSize = clamp(aSize * uScale / max(-mv.z, .05), 0., 256.);   // near/behind camera: no negative or giant sprites
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
    this.final.uniforms.uFlare.value = 1;
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
    if (!this.ready) first = true;                        // the first photo failed (offline) → the next one is a fresh start
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
    const breathe = reduced ? 0 : Math.sin(this.t * 0.16) * 0.025;
    const cam = this.camera;
    const drift = reduced ? 0 : 1;                  // prefers-reduced-motion: no idle camera drift
    cam.position.set(Input.tx * H * 0.075 * drift + Math.sin(this.t * 0.11) * H * 0.012 * drift,
                     -Input.ty * H * 0.05 * drift + Math.cos(this.t * 0.09) * H * 0.008 * drift - s * H * 0.12,
                     this.D * (1 - breathe - s * 0.22));
    cam.lookAt(0, -s * H * 0.08, this.u.uStr.value * 0.42);
    this.u.uStr.value = H * (0.24 + s * 0.1);
    this.composer.render(dt);
  }
}

export { DepthHero };
