/* Ambient — OWNER: Agent B */
import { THREE, $, $$, DATA, ROOT, reduced, QA, DPR_MAX, DPR, html, Gov, clamp, lerp, ease, easeIO, col, GL_OK, Input, FINAL_SHADER, onRestore, makeRenderer, makeComposer, GPU, loadTex, photoUrl } from "./core.js?v=16df232f5e";
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
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
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
    window.visualViewport?.addEventListener("resize", () => this.resize());
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

export { Ambient };
