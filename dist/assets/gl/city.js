/* ScoreCity — OWNER: Agent D */
import { THREE, $, $$, DATA, ROOT, reduced, QA, DPR_MAX, DPR, html, Gov, clamp, lerp, ease, easeIO, col, GL_OK, Input, FINAL_SHADER, onRestore, makeRenderer, makeComposer, GPU, loadTex, photoUrl } from "./core.js?v=4321c4183e";
import { RoundedBoxGeometry } from "../vendor/three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "../vendor/three/addons/environments/RoomEnvironment.js";
/* ============================ 3D SCORE CITY ============================
   8 axes × 5 regions as physically-lit rounded glass-ceramic columns (height = score)
   on a dark marble plinth with real soft shadows, image-based lighting (RoomEnvironment),
   glowing caps and bloom. Selecting an axis chip lifts that row into the light. */
function textSprite(text, { size = 44, color = "#f4ede3", font = "700 {s}px 'Zen Kaku Gothic New', sans-serif", pad = 10 } = {}) {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  const f = font.replace("{s}", size); g.font = f;
  const w = Math.ceil(g.measureText(text).width) + pad * 2, h = size + pad * 2;
  c.width = w; c.height = h; g.font = f; g.textBaseline = "middle"; g.textAlign = "center";
  g.shadowColor = "rgba(0,0,0,.8)"; g.shadowBlur = 8; g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  s.userData.aspect = w / h; return s;
}
class ScoreCity {
  constructor(host) {
    this.host = host; this.visible = false; this.ready = false; this.t = 0; this.az = -0.55; this.azT = -0.55; this.sel = DATA.axes[0].id; this.grow = 0;
    const canvas = document.createElement("canvas"); canvas.className = "gl-canvas gl-city"; canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas); this.canvas = canvas;
    this.renderer = makeRenderer(canvas);
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.scene.background = col("#0c0908");
    this.scene.fog = new THREE.Fog(0x0c0908, 14, 30);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    this.scene.environmentIntensity = 0.28;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    Object.assign(this, makeComposer(this.renderer, this.scene, this.camera, { bloom: [0.35, 0.45, 0.92] }));
    this.final.uniforms.uVig.value = 0.45; this.final.uniforms.uCA.value = 0.5; this.final.uniforms.uGrain.value = 0.02;
    this.build();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    Gov.listeners.add(() => this.resize());
    new IntersectionObserver((es) => es.forEach((e) => { this.visible = e.isIntersecting; if (e.isIntersecting && !this.t0) this.t0 = performance.now(); }), { threshold: 0.15 }).observe(host);
    document.addEventListener("axis:select", (e) => (this.sel = e.detail));
    this.bindDrag();
    this.ready = true;
  }
  build() {
    const A = DATA.axes, Rg = DATA.regions, sx = 1.0, sz = 1.25;
    this.cols = [];
    const x0 = -(A.length - 1) * sx / 2, z0 = -(Rg.length - 1) * sz / 2;
    // marble plinth with a warm rim light
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(A.length * sx + 1.2, 0.3, Rg.length * sz + 1.1, 4, 0.12),
      new THREE.MeshPhysicalMaterial({ color: 0x0d0a08, roughness: 0.35, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.25 }));
    plinth.position.y = -0.15; plinth.receiveShadow = true; this.scene.add(plinth);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(A.length * sx + 1.24, 0.02, Rg.length * sz + 1.14),
      new THREE.MeshBasicMaterial({ color: col("#e8a24a").multiplyScalar(1.1), toneMapped: false }));
    rim.position.y = -0.005; this.scene.add(rim);
    // grid inlay lines on the plinth
    const lineM = new THREE.LineBasicMaterial({ color: 0x8a6030, transparent: true, opacity: 0.35 });
    const pts = [];
    for (let i = 0; i <= A.length; i++) { const x = x0 - sx / 2 + i * sx; pts.push(x, 0.003, z0 - sz / 2, x, 0.003, z0 + (Rg.length - 0.5) * sz); }
    for (let j = 0; j <= Rg.length; j++) { const z = z0 - sz / 2 + j * sz; pts.push(x0 - sx / 2, 0.003, z, x0 + (A.length - 0.5) * sx, 0.003, z); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.scene.add(new THREE.LineSegments(lg, lineM));
    const geo = new RoundedBoxGeometry(0.5, 1, 0.5, 4, 0.07); geo.translate(0, 0.5, 0);
    const capG = new THREE.CylinderGeometry(0.2, 0.2, 0.03, 24);
    Rg.forEach((r, j) => {
      const c = col(r.accent);
      A.forEach((a, i) => {
        const v = r.scores[a.id], h = v * 0.24;
        const m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12,
          sheen: 0.25, sheenColor: c.clone().lerp(new THREE.Color(1, 1, 1), 0.3), emissive: c, emissiveIntensity: 0.04 });
        const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.position.set(x0 + i * sx, 0, z0 + j * sz); mesh.scale.set(1, 0.001, 1);
        const cap = new THREE.Mesh(capG, new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(2.6), toneMapped: false, transparent: true, opacity: 0 }));
        cap.position.set(mesh.position.x, 0, mesh.position.z);
        this.scene.add(mesh, cap);
        this.cols.push({ mesh, cap, h, v, axis: a.id, i, j, lead: v === Math.max(...Rg.map((x) => x.scores[a.id])) });
      });
      const lab = textSprite(r.short, { size: 44, color: r.accent });
      lab.position.set(x0 - sx * 0.95, 0.25, z0 + j * sz); lab.scale.set(0.34 * lab.userData.aspect, 0.34, 1); this.scene.add(lab);
    });
    this.axisLabels = A.map((a, i) => {
      const s = textSprite(a.short, { size: 40, color: "#f4ede3" });
      s.position.set(x0 + i * sx, 0.22, z0 + (Rg.length - 0.1) * sz + 0.2); s.scale.set(0.3 * s.userData.aspect, 0.3, 1); this.scene.add(s); return s;
    });
    // key light with soft shadows + warm fill + cool rim
    const key = new THREE.DirectionalLight(0xffe2bd, 1.7); key.position.set(-5, 9, 6); key.castShadow = true;
    key.shadow.mapSize.set(QA ? 512 : 2048, QA ? 512 : 2048); key.shadow.radius = 5; key.shadow.bias = -0.0004;
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
    this.scene.add(key, new THREE.HemisphereLight(0xffd9a8, 0x100806, 0.18));
    const rimL = new THREE.DirectionalLight(0x7aa7ff, 1.1); rimL.position.set(6, 4, -7); this.scene.add(rimL);
    this.spot = new THREE.PointLight(0xffc27a, 0, 6, 1.6); this.scene.add(this.spot);
    this.span = { w: A.length * sx, d: Rg.length * sz };
  }
  bindDrag() {
    this.canvas.style.touchAction = "pan-y";
    let g = null;
    this.canvas.addEventListener("pointerdown", (e) => { if (e.isPrimary) g = { x: e.clientX, y: e.clientY, a: this.azT, h: null, id: e.pointerId }; });
    addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (g.h === null && Math.hypot(dx, dy) > 8) g.h = Math.abs(dx) > Math.abs(dy);
      if (g.h) this.azT = clamp(g.a - dx / this.w * 2.4, -1.3, 1.3);
    }, { passive: true });
    const end = (e) => { if (g && e.pointerId === g.id) g = null; };
    addEventListener("pointerup", end, { passive: true }); addEventListener("pointercancel", end, { passive: true });
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(DPR); this.composer.setPixelRatio(DPR);
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.final.uniforms.uRes.value.set(w * DPR, h * DPR);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    this.R = clamp(Math.max((this.span.w + 2.4) / (2 * Math.tan(fov / 2) * this.camera.aspect), (this.span.d + 2.6) / (2 * Math.tan(fov / 2))) * 0.95, 7, 22);
  }
  frame(dt) {
    if (!this.visible || !this.ready) return;
    this.t += dt; this.final.uniforms.uTime.value = this.t;
    const since = this.t0 ? (performance.now() - this.t0) / 1000 : 0;
    this.az = lerp(this.az, this.azT + (reduced ? 0 : Math.sin(this.t * 0.15) * 0.08 + Input.tx * 0.1), 1 - Math.exp(-dt * 4));
    const pol = 1.02 - (reduced ? 0 : Input.ty * 0.04);
    this.camera.position.set(Math.sin(this.az) * Math.sin(pol) * this.R, Math.cos(pol) * this.R + 0.4, Math.cos(this.az) * Math.sin(pol) * this.R);
    this.camera.lookAt(0, 0.6, 0.2);
    let sx = 0, sz = 0, n = 0;
    this.cols.forEach((c) => {
      const k = reduced ? 1 : ease(clamp((since - 0.1 - c.i * 0.07 - c.j * 0.05) / 1.1, 0, 1));
      const on = c.axis === this.sel;
      c.lift = lerp(c.lift ?? 0, on ? 1 : 0, 1 - Math.exp(-dt * 6));
      const hh = Math.max(0.001, c.h * k);
      c.mesh.scale.y = hh;
      c.mesh.material.emissiveIntensity = 0.03 + c.lift * 0.32 + (c.lead ? 0.05 : 0);
      c.mesh.material.opacity = 1;
      c.cap.position.y = hh + 0.03 + c.lift * 0.05;
      c.cap.material.opacity = k * (0.25 + c.lift * 0.75);
      c.cap.scale.setScalar(1 + c.lift * 0.4 + (c.lead && on ? Math.sin(this.t * 4) * 0.08 : 0));
      if (on) { sx += c.mesh.position.x; sz += c.mesh.position.z; n++; }
    });
    this.axisLabels.forEach((s, i) => { const on = DATA.axes[i].id === this.sel; s.material.opacity = on ? 1 : 0.45; s.scale.y = on ? 0.36 : 0.3; s.scale.x = s.scale.y * s.userData.aspect; });
    if (n) { this.spot.position.set(sx / n, 4.2, sz / n); this.spot.intensity = lerp(this.spot.intensity, 2.2, 1 - Math.exp(-dt * 3)); }
    this.composer.render(dt);
  }
}

export { ScoreCity, textSprite };
