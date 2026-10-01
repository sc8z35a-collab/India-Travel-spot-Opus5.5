/* DepthHero — OWNER: Agent B (Photo & Cinema)
   Cinema-grade 3D photo relief. Every pixel is still the original photograph — only its geometry
   (Depth Anything V2 depth map) and the *light around it* are synthesised:
     • 800×480-segment depth mesh with gradient-aware edge relaxation (no "rubber" stretched seams)
     • depth-of-field: golden-angle 16-tap gather + mip bias, rack-focus pulls on load / region change
     • depth-occluded volumetric god rays (screen-space radial scatter, only the far bright sky emits)
     • sun starburst + chromatic lens-flare ghosts, procedural lens dirt that lights up with bloom
     • aerial perspective + flowing fbm mist + low river/lake mist band, per-region heat shimmer
     • cloud shadows drifting over the far landscape, subtle split-tone grade toward the region accent
     • per-region atmosphere particles: dust motes (Delhi), marigold & rose petals (Jaipur),
       rising diya embers (Varanasi), fireflies (Kerala), fine snow (Ladakh) — cross-faded on dissolve
     • film-burn dissolve seam: white-hot core → accent → charred ember rim (HDR → bloom)
     • hexagonal aperture bokeh with chromatic fringe
   ?qa=1 (SwiftShader) keeps the same look with fewer taps / vertices / particles. */
import { THREE, DATA, ROOT, reduced, QA, DPR, html, Gov, clamp, lerp, ease, easeIO, col, Input,
         ShaderPass, makeRenderer, makeComposer, loadTex, photoUrl } from "./core.js?v=394b047315";

/* ---------------- per-region cinematography ---------------- */
// sun: screen-uv of the light source behind the far plane · focus: depth (0 far … 1 near) kept sharp
// ap: aperture (max CoC as fraction of frame) · fog/mist: aerial veil strengths · mistY: horizon band
// shimmer: heat haze on the far plane · fx: particle mode · rays: god-ray gain
const LOOK = {
  "delhi-agra": { sun: [0.58, 0.93], haze: "#ffd3a1", fog: 0.34, mist: 0.30, mistY: 0.50, shimmer: 1.0, focus: 0.10, ap: 0.0042, fx: 0, rays: 1.00, grade: [0.06, 0.05, 0.08] },
  jaipur:       { sun: [0.20, 0.97], haze: "#ffc6b4", fog: 0.14, mist: 0.10, mistY: 0.40, shimmer: 0.6, focus: 0.22, ap: 0.0036, fx: 1, rays: 0.70, grade: [0.05, 0.03, 0.06] },
  varanasi:     { sun: [0.70, 0.92], haze: "#ffb874", fog: 0.28, mist: 0.36, mistY: 0.56, shimmer: 0.8, focus: 0.35, ap: 0.0040, fx: 2, rays: 1.05, grade: [0.07, 0.04, 0.03] },
  kerala:       { sun: [0.80, 0.99], haze: "#e2f3dc", fog: 0.22, mist: 0.30, mistY: 0.48, shimmer: 0.3, focus: 0.16, ap: 0.0034, fx: 3, rays: 0.75, grade: [0.03, 0.06, 0.05] },
  ladakh:       { sun: [0.13, 1.02], haze: "#d4e8ff", fog: 0.06, mist: 0.05, mistY: 0.55, shimmer: 0.0, focus: 0.55, ap: 0.0030, fx: 4, rays: 0.55, grade: [0.03, 0.05, 0.08] },
};
const DEFAULT_LOOK = LOOK["delhi-agra"];
const lookFor = (photoId) => {
  const r = DATA.regions.find((x) => x.heroId === photoId) || DATA.regions.find((x) => x.id === DATA.current);
  return (r && LOOK[r.id]) || DEFAULT_LOOK;
};

/* ---------------- depth relief ---------------- */
const HERO_VS = `
  uniform sampler2D uDepA, uDepB; uniform vec2 uCovA, uCovB, uDTex; uniform float uP, uStr, uTime, uShimA, uShimB;
  varying vec2 vUv; varying float vDA, vDB, vM, vEdge;
  vec2 cuv(vec2 uv, vec2 s){ return (uv - .5) * s + .5; }
  float dep(sampler2D t, vec2 uv){ return texture2D(t, uv).r; }
  // gradient-aware relaxation: where depth jumps (object silhouettes) pull the vertex toward the
  // neighbourhood minimum so triangles don't stretch into a rubber curtain
  float relaxed(sampler2D t, vec2 uv, out float g){
    vec2 o = uDTex * 2.5;
    float c = dep(t, uv), l = dep(t, uv - vec2(o.x, 0.)), r = dep(t, uv + vec2(o.x, 0.)),
          d = dep(t, uv - vec2(0., o.y)), u = dep(t, uv + vec2(0., o.y));
    g = abs(r - l) + abs(u - d);
    float lo = min(min(l, r), min(u, d));
    return mix(c, mix(c, lo, .65), smoothstep(.05, .22, g));
  }
  void main(){
    vUv = uv;
    float ga, gb;
    float da = relaxed(uDepA, cuv(uv, uCovA), ga);
    float db = relaxed(uDepB, cuv(uv, uCovB), gb);
    float T = mix(-.25, 1.25, uP);
    float m = 1. - smoothstep(T - .12, T + .12, db);
    vDA = da; vDB = db; vM = m; vEdge = mix(ga, gb, m);
    float z = mix(da, db, m) * uStr;
    z += sin(m * 3.14159) * .16 * uStr;                                   // wave bulge travelling to the viewer
    float far = 1. - mix(da, db, m);
    z += sin(uv.x * 9. + uTime * .6) * sin(uv.y * 7. - uTime * .45) * .006 * uStr * (.4 + far * mix(uShimA, uShimB, m));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, z, 1.);
  }`;

const HERO_FS = `
  uniform sampler2D uTexA, uTexB; uniform vec2 uCovA, uCovB, uTexelA, uTexelB, uSunA, uSunB;
  uniform float uP, uTime, uFade, uFocusA, uFocusB, uApA, uApB, uFogA, uFogB, uMistA, uMistB, uMistYA, uMistYB,
                uShimA, uShimB, uTaps, uScroll, uAspect;
  uniform vec3 uAccA, uAccB, uHazeA, uHazeB, uGradeA, uGradeB;
  varying vec2 vUv; varying float vDA, vDB, vM, vEdge;
  vec2 cuv(vec2 uv, vec2 s){ return (uv - .5) * s + .5; }
  float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a * n(p); p = p * 2.07 + vec2(1.7, 9.2); a *= .5; } return v; }
  // golden-angle disc gather: 16 taps on a Vogel spiral + mip bias → creamy, ring-free bokeh
  vec3 dof(sampler2D t, vec2 uv, vec2 texel, float coc){
    if (coc < .0004) return texture2D(t, uv).rgb;
    float bias = clamp(log2(coc / max(texel.x, 1e-6)) - 2.2, 0., 4.);
    vec3 acc = vec3(0.); float wsum = 0.;
    float rot = h(uv * 913.) * 6.2831;                                   // per-pixel rotation hides the pattern
    for (int i = 0; i < 16; i++) {
      if (float(i) >= uTaps) break;
      float fi = float(i) + .5;
      float r = sqrt(fi / uTaps) * coc;
      float a = fi * 2.39996323 + rot;
      vec2 o = vec2(cos(a), sin(a) * uAspect) * r;
      vec3 s = texture2D(t, uv + o, bias).rgb;
      float w = 1. + dot(s, vec3(.3, .59, .11)) * 2.2;                     // highlights bloom out like real bokeh
      acc += s * w; wsum += w;
    }
    return acc / wsum;
  }
  vec3 shade(sampler2D t, vec2 cov, vec2 texel, float d, float focus, float ap, float shim){
    vec2 uv = cuv(vUv, cov);
    float far = 1. - d;
    // heat haze: only the hot far plane wobbles
    uv += vec2(n(vUv * vec2(40., 18.) + vec2(0., uTime * 1.3)) - .5, n(vUv * vec2(22., 46.) - vec2(uTime * .9, 0.)) - .5)
          * .0016 * shim * far * far;
    float coc = abs(d - focus) * ap * (1. + uScroll * 2.2);
    coc += smoothstep(.05, .3, vEdge) * ap * .25;                          // soften relaxed silhouettes
    return dof(t, uv, texel, coc);
  }
  void main(){
    float T = mix(-.25, 1.25, uP);
    float nz = (n(vUv * 7.) - .5) * .22 + (n(vUv * 31.) - .5) * .06;
    float m = 1. - smoothstep(T - .05, T + .05, vDB + nz);
    vec3 a = vec3(0.), b = vec3(0.);
    if (m < .999) a = shade(uTexA, uCovA, uTexelA, vDA, uFocusA, uApA, uShimA);
    if (m > .001) b = shade(uTexB, uCovB, uTexelB, vDB, uFocusB, uApB, uShimB);
    vec3 c = mix(a, b, m);
    float d = mix(vDA, vDB, m), far = 1. - d;
    vec3 acc = mix(uAccA, uAccB, m), haze = mix(uHazeA, uHazeB, m), grade = mix(uGradeA, uGradeB, m);
    float fog = mix(uFogA, uFogB, m), mist = mix(uMistA, uMistB, m), mistY = mix(uMistYA, uMistYB, m);
    vec2 sun = mix(uSunA, uSunB, m);
    float lum = dot(c, vec3(.2126, .7152, .0722));

    // cloud shadows drifting across the far landscape (not the sky: only mid-luminance far pixels)
    float cs = fbm(vUv * vec2(2.2, 4.) + vec2(uTime * .012, uTime * .004));
    c *= 1. - smoothstep(.45, .75, cs) * .12 * smoothstep(.15, .6, far) * (1. - smoothstep(.62, .9, lum));

    // aerial perspective + flowing fbm mist (thicker toward the far plane)
    vec2 fq = vUv * vec2(3., 6.) + vec2(uTime * .018, uTime * .004);
    float flow = fbm(fq + fbm(fq * 1.6 - uTime * .01) * 1.2);
    vec3 fogCol = mix(haze, acc, .18) * (.82 + .3 * flow);
    float veil = fog * pow(far, 1.6) * (.55 + .9 * flow);
    // low mist band hugging the horizon / water line
    float band = exp(-pow((vUv.y - mistY) * 7.5, 2.)) * mist * (.4 + 1.1 * fbm(vUv * vec2(5., 14.) + vec2(uTime * .03, 0.)));
    veil += band * smoothstep(.05, .5, far);
    c = mix(c, fogCol, clamp(veil, 0., .72));
    // near planes keep contrast, far planes go soft
    c = (c - .18) * mix(1.0, 1.09, d) + .18;

    // sun glow wrapping the far edges (light bleeding around silhouettes)
    vec2 sv = (vUv - sun) * vec2(uAspect, 1.);
    float sd = length(sv);
    c += haze * pow(max(0., 1. - sd * 1.25), 3.) * .16 * (.3 + far);
    // soft god-light sweep across the far plane
    float sweep = (1. - smoothstep(0., .35, abs(vUv.x - fract(uTime * .035) * 1.6 + .3))) * far * smoothstep(.2, 1., vUv.y);
    c += acc * sweep * .07;

    // split-tone grade: cool shadows, accent-warm highlights (a few %)
    float L = dot(c, vec3(.299, .587, .114));
    c += mix(-grade * vec3(1., .4, -.6) * .6, grade * (acc - .4), smoothstep(.15, .8, L)) * .5;

    // film-burn dissolve seam: white-hot core → accent → charred ember rim (HDR → bloom)
    float dActive = step(.001, uP) * step(uP, .999);
    float edge = m * (1. - m) * 4.;
    float flick = .75 + .5 * n(vUv * 60. + uTime * 8.);
    vec3 burn = mix(acc * vec3(1.2, .55, .25), vec3(1.6, 1.35, 1.05), smoothstep(.55, 1., edge));
    c += burn * pow(edge, 2.2) * 3.4 * flick * dActive;
    c *= 1. - smoothstep(.02, .3, m) * (1. - smoothstep(.3, .6, m)) * .55 * dActive;   // char just behind the seam

    // god-ray emitter mask in alpha: bright, far, upper pixels (read by the RAYS pass, then discarded)
    float emit = smoothstep(.55, .95, lum) * pow(far, 2.5) * smoothstep(.25, .75, vUv.y);
    gl_FragColor = vec4(c * uFade, emit * uFade);
  }`;

/* ---------------- screen-space volumetric rays + flare ---------------- */
const RAYS = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.6, 0.9) }, uStr: { value: 1 }, uCol: { value: new THREE.Color("#ffd3a1") },
              uTaps: { value: 64 }, uAspect: { value: 2 }, uTime: { value: 0 }, uFlare: { value: 1 }, uSunVis: { value: 1 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStr, uTaps, uAspect, uTime, uFlare, uSunVis; uniform vec3 uCol;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float ring(vec2 p, float r, float w){ return exp(-pow((length(p) - r) / w, 2.)); }
    float hexd(vec2 p){ p = abs(p); return max(p.x * .866 + p.y * .5, p.y); }
    void main(){
      vec4 src = texture2D(tDiffuse, vUv);
      vec2 dv = (uSun - vUv);
      float jit = h(vUv * 1024. + fract(uTime) * 37.);
      vec2 stp = dv / uTaps * .92;
      vec2 p = vUv + stp * jit;
      float dec = 1., sum = 0.;
      for (int i = 0; i < 64; i++) {
        if (float(i) >= uTaps) break;
        sum += texture2D(tDiffuse, p).a * dec;
        dec *= .972; p += stp;
      }
      sum /= uTaps * .38;
      vec3 c = src.rgb + uCol * sum * uStr * .55;
      // starburst + chromatic ghosts along the sun→centre axis
      vec2 sv = (vUv - uSun) * vec2(uAspect, 1.);
      float sd = length(sv), ang = atan(sv.y, sv.x);
      float star = pow(abs(cos(ang * 3. + .3)), 60.) + pow(abs(cos(ang * 3. + 1.35)), 90.) * .6;
      c += uCol * star * exp(-sd * 5.5) * .28 * uFlare * uSunVis;
      vec2 axis = vec2(.5) - uSun;
      for (int k = 0; k < 4; k++) {
        float fk = float(k);
        float t = .55 + fk * .42;
        vec2 gp = (vUv - (uSun + axis * t * 2.)) * vec2(uAspect, 1.);
        float r = .025 + fk * .018;
        float g = (1. - smoothstep(r * .82, r, hexd(gp))) * (.35 + .65 * smoothstep(r * .4, r, hexd(gp)));
        vec3 tint = fk == 1. ? vec3(.45, .7, 1.) : fk == 2. ? vec3(1., .55, .35) : vec3(.7, 1., .6);
        c += tint * g * .045 * uFlare * uSunVis;
      }
      c += vec3(1., .55, .35) * ring((vUv - .5 + (uSun - .5) * -.7) * vec2(uAspect, 1.), .34, .012) * .02 * uFlare * uSunVis;
      gl_FragColor = vec4(c, 1.);
    }`,
};

/* ---------------- lens dirt: bloom × procedural smudge map ---------------- */
function makeDirt() {
  const W = 1024, H = 512, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  let s = 1337; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 220; i++) {                               // soft smudges / water spots
    const x = rnd() * W, y = rnd() * H, r = 6 + Math.pow(rnd(), 2.2) * 90, a = 0.02 + rnd() * 0.08;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const ringy = rnd() < 0.35;
    gr.addColorStop(0, `rgba(255,255,255,${ringy ? a * 0.25 : a})`);
    gr.addColorStop(ringy ? 0.82 : 0.6, `rgba(255,255,255,${ringy ? a * 1.2 : a * 0.45})`);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  for (let i = 0; i < 900; i++) {                               // dust specks
    const x = rnd() * W, y = rnd() * H, r = 0.4 + rnd() * 1.6;
    g.fillStyle = `rgba(255,255,255,${0.08 + rnd() * 0.3})`; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  g.lineCap = "round";
  for (let i = 0; i < 26; i++) {                                // wipe streaks
    const x = rnd() * W, y = rnd() * H, l = 40 + rnd() * 220, an = -0.5 + rnd() * 0.4;
    g.strokeStyle = `rgba(255,255,255,${0.015 + rnd() * 0.035})`; g.lineWidth = 3 + rnd() * 14;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l * 0.5, y + l * an + 20 * (rnd() - 0.5), x + l, y + l * an * 0.7); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  return t;
}
function dirtyBloom(bloomPass, dirt) {
  const u = { tDiffuse: bloomPass.copyUniforms.tDiffuse, opacity: bloomPass.copyUniforms.opacity, tDirt: { value: dirt }, uDirt: { value: 2.4 } };
  bloomPass.blendMaterial = new THREE.ShaderMaterial({
    uniforms: u, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
    fragmentShader: `uniform sampler2D tDiffuse, tDirt; uniform float opacity, uDirt; varying vec2 vUv;
      void main(){ vec4 b = texture2D(tDiffuse, vUv); float d = texture2D(tDirt, vUv).r;
        gl_FragColor = vec4(b.rgb * (1. + d * uDirt) * opacity, 0.); }`,
  });
  return u;
}

/* ---------------- atmosphere particles (5 regional behaviours) ---------------- */
const FX_VS = `
  attribute vec3 aBase; attribute float aSeed, aSize;
  uniform float uTime, uScale, uH, uW, uZ0, uZ1, uMode, uFade, uAlpha;
  varying float vA, vS, vRot, vMode, vHot;
  float h1(float x){ return fract(sin(x * 91.17) * 43758.5453); }
  void main(){
    float s = aSeed, t = uTime;
    vec3 p = vec3(aBase.x * uW, aBase.y * uH, mix(uZ0, uZ1, aBase.z));
    float span = uH * 1.4;
    vA = 1.; vHot = 0.; vRot = 0.;
    if (uMode < .5) {                     // 0 · dust motes in raking light
      p.y = mod(p.y + t * mix(.006, .03, h1(s)) * uH + span * .5, span) - span * .5;
      p.x += sin(t * .21 + s * 6.283) * .035 * uH; p.z += sin(t * .17 + s * 11.) * .02 * uH;
      vA = .45 + .55 * sin(t * (1.1 + s * 2.) + s * 40.);
    } else if (uMode < 1.5) {             // 1 · marigold & rose petals tumbling down
      p.y = mod(p.y - t * mix(.05, .11, h1(s)) * uH + span * .5, span) - span * .5;
      p.x += sin(t * .7 + s * 31.) * .06 * uH + t * .02 * uH; p.x = mod(p.x + uW * .7, uW * 1.4) - uW * .7;
      p.z += cos(t * .5 + s * 17.) * .04 * uH;
      vRot = t * mix(-2., 2., h1(s + 3.)) + s * 6.283;
      vA = .8;
    } else if (uMode < 2.5) {             // 2 · diya embers rising, flickering, cooling as they climb
      float life = fract(t * mix(.05, .12, h1(s)) + s);
      p.y = mix(-.55, .7, life) * uH;
      p.x += sin(t * 1.3 + s * 21.) * .025 * uH * life + sin(life * 9. + s) * .02 * uH;
      p.z += cos(t * .9 + s * 7.) * .02 * uH;
      vHot = 1. - life;
      vA = smoothstep(0., .08, life) * (1. - smoothstep(.6, 1., life)) * (.6 + .4 * sin(t * 18. + s * 90.));
    } else if (uMode < 3.5) {             // 3 · fireflies: slow Lissajous wander, blinking
      p.x += sin(t * mix(.15, .4, h1(s)) + s * 13.) * .08 * uH;
      p.y += sin(t * mix(.12, .33, h1(s + 1.)) + s * 7.) * .05 * uH - .12 * uH;
      p.z += cos(t * .2 + s * 5.) * .05 * uH;
      float ph = fract(t * mix(.12, .3, h1(s + 2.)) + s);
      vA = smoothstep(0., .1, ph) * (1. - smoothstep(.18, .42, ph));
      vHot = 1.;
    } else {                              // 4 · fine high-altitude snow on a crosswind
      p.y = mod(p.y - t * mix(.025, .07, h1(s)) * uH + span * .5, span) - span * .5;
      p.x += sin(t * .9 + s * 23.) * .015 * uH + t * .045 * uH; p.x = mod(p.x + uW * .7, uW * 1.4) - uW * .7;
      vA = .75 + .25 * sin(t * 2. + s * 50.);
    }
    vS = s; vMode = uMode;
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    float sz = aSize * (uMode > 0.5 && uMode < 1.5 ? 2.6 : uMode > 3.5 ? 1.4 : uMode > 2.5 ? 1.3 : 1.);
    gl_PointSize = clamp(sz * uScale / max(-mv.z, .05), 0., 180.);
    vA *= uFade * uAlpha * smoothstep(.02, .25, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FX_FS = `
  uniform vec3 uCol; varying float vA, vS, vRot, vMode, vHot;
  void main(){
    vec2 q = gl_PointCoord - .5;
    float a; vec3 c;
    if (vMode < .5) {
      float d = length(q); a = pow(1. - smoothstep(0., .5, d), 1.8);
      c = mix(uCol, vec3(1., .92, .78), .55) * 2.2;
    } else if (vMode < 1.5) {
      float cr = cos(vRot), sr = sin(vRot); vec2 r = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
      float e = length(r * vec2(1., 2.1)) * 2.;                                   // elongated petal
      float notch = smoothstep(.0, .12, abs(r.x + .02) + max(0., -r.y) * .2 - .02);
      a = (1. - smoothstep(.72, 1., e)) * mix(.55, 1., notch);
      float k = fract(vS * 7.3);
      c = k < .45 ? vec3(1., .55, .08) : k < .75 ? vec3(.95, .25, .42) : k < .9 ? vec3(1., .78, .2) : vec3(.92, .1, .2);
      c *= .9 + .5 * (r.y + .5);                                                    // light falls on the upper side
      c *= 1.05;
    } else if (vMode < 2.5) {
      float d = length(q); a = pow(1. - smoothstep(0., .5, d), 2.6);
      c = mix(vec3(1., .32, .05), vec3(1.6, 1.15, .6), vHot) * (1.6 + 2.2 * vHot) * (1. - smoothstep(.05, .5, d) * .4);
    } else if (vMode < 3.5) {
      float d = length(q); a = exp(-d * d * 38.) + exp(-d * d * 7.) * .35;
      c = vec3(.75, 1.25, .35) * 2.6;
    } else {
      float d = length(q); a = (1. - smoothstep(.2, .5, d)) * (.6 + .4 * (1. - smoothstep(0., .25, d)));
      c = vec3(.92, .96, 1.05) * 1.25;
    }
    a *= vA;
    if (a < .003) discard;
    gl_FragColor = vec4(c * a, 1.);
  }`;
// hexagonal aperture bokeh with a chromatic rim (what a real 6-blade lens draws for out-of-focus lights)
const BOKEH_VS = `
  attribute vec3 aBase; attribute float aSeed, aSize; uniform float uTime, uScale, uH, uW, uZ0, uZ1, uFade;
  varying float vA, vS;
  void main(){
    vec3 p = vec3(aBase.x * uW, aBase.y * uH, mix(uZ0, uZ1, aBase.z));
    p.y += sin(uTime * .05 + aSeed * 30.) * .05 * uH; p.x += cos(uTime * .04 + aSeed * 17.) * .06 * uH;
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    gl_PointSize = clamp(aSize * uScale / max(-mv.z, .05), 0., 300.);
    gl_Position = projectionMatrix * mv;
    vA = (.5 + .5 * sin(uTime * (.3 + aSeed) + aSeed * 40.)) * uFade; vS = aSeed;
  }`;
const BOKEH_FS = `
  uniform vec3 uCol; varying float vA, vS;
  float hexd(vec2 p){ p = abs(p); return max(p.x * .866 + p.y * .5, p.y); }
  void main(){
    vec2 q = (gl_PointCoord - .5) * 2.;
    float d = hexd(q);
    float body = 1. - smoothstep(.86, .9, d);
    float rim = smoothstep(.62, .88, d) * body;
    float dR = hexd(q * 1.03), dB = hexd(q * .97);
    vec3 fringe = vec3(1. - smoothstep(.86, .9, dR), body, 1. - smoothstep(.86, .9, dB));
    float a = (body * .22 + rim * .55) * vA;
    if (a < .002) discard;
    vec3 c = mix(uCol, vec3(1., .94, .82), fract(vS * 7.1) * .55) * fringe;
    gl_FragColor = vec4(c * a * 1.25, 1.);
  }`;

// additive colour, alpha untouched → the god-ray emitter mask in alpha stays clean
function addBlend(m) {
  Object.assign(m, { transparent: true, depthWrite: false, depthTest: false, blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  return m;
}

class DepthHero {
  constructor(host, items, { cycle = false } = {}) {
    this.host = host; this.items = items.map((it) => ({ ...it, look: lookFor(it.id) }));
    this.cur = 0; this.queue = null; this.busy = false;
    this.visible = true; this.scroll = 0; this.t = 0; this.ready = false; this.fadeIn = 0;
    const canvas = document.createElement("canvas");
    canvas.className = "gl-canvas gl-hero"; canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas);
    this.canvas = canvas;
    this.renderer = makeRenderer(canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 60);
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
    const L = this.items[0].look, v2 = (a) => new THREE.Vector2(a[0], a[1]), v3 = (a) => new THREE.Vector3(...a);
    this.u = {
      uTexA: { value: black }, uTexB: { value: black }, uDepA: { value: black }, uDepB: { value: black },
      uCovA: { value: new THREE.Vector2(1, 1) }, uCovB: { value: new THREE.Vector2(1, 1) },
      uTexelA: { value: new THREE.Vector2(1 / 1920, 1 / 1440) }, uTexelB: { value: new THREE.Vector2(1 / 1920, 1 / 1440) },
      uDTex: { value: new THREE.Vector2(1 / 1024, 1 / 768) },
      uP: { value: 0 }, uStr: { value: 0.3 }, uTime: { value: 0 }, uFade: { value: 0 }, uScroll: { value: 0 }, uAspect: { value: 2 },
      uTaps: { value: QA ? 4 : 16 },
      uAccA: { value: col(items[0].accent) }, uAccB: { value: col(items[0].accent) },
      uHazeA: { value: col(L.haze) }, uHazeB: { value: col(L.haze) },
      uSunA: { value: v2(L.sun) }, uSunB: { value: v2(L.sun) },
      uGradeA: { value: v3(L.grade) }, uGradeB: { value: v3(L.grade) },
      uFocusA: { value: 1 }, uFocusB: { value: L.focus }, uApA: { value: L.ap }, uApB: { value: L.ap },
      uFogA: { value: L.fog }, uFogB: { value: L.fog }, uMistA: { value: L.mist }, uMistB: { value: L.mist },
      uMistYA: { value: L.mistY }, uMistYB: { value: L.mistY }, uShimA: { value: L.shimmer }, uShimB: { value: L.shimmer },
    };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, QA ? 160 : 800, QA ? 96 : 480),
      new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: HERO_VS, fragmentShader: HERO_FS }));
    this.scene.add(this.mesh);
    // two atmosphere systems: A = current region, B = incoming (cross-faded by the dissolve)
    this.fxA = this.makeFx(QA ? 260 : 1400, L.fx);
    this.fxB = this.makeFx(QA ? 260 : 1400, L.fx); this.fxB.material.uniforms.uAlpha.value = 0;
    this.dust = this.makeFx(QA ? 200 : 900, 0); this.dust.material.uniforms.uAlpha.value = 0.55;
    this.bokeh = this.makeBokeh(QA ? 18 : 54);
    Object.assign(this, makeComposer(this.renderer, this.scene, this.camera, { bloom: [0.6, 0.72, 0.84] }));
    this.final.uniforms.uFlare.value = 1;
    this.rays = new ShaderPass(RAYS);
    this.rays.uniforms.uTaps.value = QA ? 12 : 64;   // SwiftShader watchdog: keep QA taps tiny
    this.composer.insertPass(this.rays, 1);                       // RenderPass → RAYS → Bloom → Output → Final
    this.dirtU = dirtyBloom(this.bloomPass, makeDirt());
    this.focusT = { a: 1, b: L.focus, t0: performance.now(), dur: 2.6 };   // opening rack-focus pull
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    Gov.listeners.add(() => this.resize());
    new IntersectionObserver((es) => es.forEach((e) => (this.visible = e.isIntersecting)), { threshold: 0 }).observe(host);
    this.show(0, true);
    this.cycle = cycle;
  }
  geo(n, sizeFn, zFn) {
    const g = new THREE.BufferGeometry();
    const base = new Float32Array(n * 3), seed = new Float32Array(n), size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      base[i * 3] = Math.random() - 0.5; base[i * 3 + 1] = Math.random() - 0.5; base[i * 3 + 2] = zFn();
      seed[i] = Math.random(); size[i] = sizeFn();
    }
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));   // unused (VS reads aBase)
    g.setAttribute("aBase", new THREE.BufferAttribute(base, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    return g;
  }
  makeFx(n, mode) {
    const g = this.geo(n, () => 0.0022 + Math.pow(Math.random(), 3) * 0.0095, () => Math.pow(Math.random(), 0.8));
    const u = { uTime: this.u.uTime, uScale: { value: 1 }, uH: { value: 1 }, uW: { value: 1 }, uZ0: { value: 0 }, uZ1: { value: 1 },
                uMode: { value: mode }, uFade: this.u.uFade, uAlpha: { value: 1 }, uCol: { value: col(this.items[0].accent) } };
    const pts = new THREE.Points(g, addBlend(new THREE.ShaderMaterial({ uniforms: u, vertexShader: FX_VS, fragmentShader: FX_FS })));
    pts.frustumCulled = false; pts.renderOrder = 2;
    this.scene.add(pts);
    return pts;
  }
  makeBokeh(n) {
    const g = this.geo(n, () => 0.06 + Math.random() * 0.11, () => Math.random());
    const u = { uTime: this.u.uTime, uScale: { value: 1 }, uH: { value: 1 }, uW: { value: 1 }, uZ0: { value: 0 }, uZ1: { value: 1 },
                uFade: this.u.uFade, uCol: { value: col(this.items[0].accent) } };
    const pts = new THREE.Points(g, addBlend(new THREE.ShaderMaterial({ uniforms: u, vertexShader: BOKEH_VS, fragmentShader: BOKEH_FS })));
    pts.frustumCulled = false; pts.renderOrder = 3;
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
    this.u.uStr.value = H * 0.24; this.u.uAspect.value = w / h; this.rays.uniforms.uAspect.value = w / h;
    const scale = (h * DPR) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * H;
    for (const [pts, z0, z1] of [[this.fxA, 0.3, 1.9], [this.fxB, 0.3, 1.9], [this.dust, 0.1, 1.3], [this.bokeh, 1.7, 2.45]]) {
      const u = pts.material.uniforms;
      u.uScale.value = scale; u.uH.value = H; u.uW.value = this.W * 1.25; u.uZ0.value = z0; u.uZ1.value = z1;
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
  // write one side (A or B) of the look uniforms
  setLook(side, it, tex, dep) {
    const u = this.u, L = it.look;
    u["uTex" + side].value = tex; u["uDep" + side].value = dep;
    const img = tex.image; if (img && img.width) u["uTexel" + side].value.set(1 / img.width, 1 / img.height);
    u["uAcc" + side].value.set(it.accent); u["uHaze" + side].value.set(L.haze);
    u["uSun" + side].value.set(L.sun[0], L.sun[1]); u["uGrade" + side].value.set(...L.grade);
    u["uAp" + side].value = L.ap; u["uFog" + side].value = L.fog; u["uMist" + side].value = L.mist;
    u["uMistY" + side].value = L.mistY; u["uShim" + side].value = L.shimmer;
    if (side === "A") { this.coverA = it.ratio; this.updateCover(u.uCovA.value, it.ratio); }
    else { this.coverB = it.ratio; this.updateCover(u.uCovB.value, it.ratio); }
  }
  async show(i, first = false) {
    if (this.busy) { this.queue = i; return; }
    if (!first && this.ready && i === this.cur) return;   // re-showing the current photo must not replay the dissolve
    if (!this.ready) first = true;                        // the first photo failed (offline) → the next one is a fresh start
    this.busy = true;
    try {
      const { tex, dep, it } = await this.load(i);
      const L = it.look, fu = (p) => p.material.uniforms;
      if (first) {
        this.setLook("A", it, tex, dep); this.setLook("B", it, tex, dep);
        for (const p of [this.fxA, this.fxB, this.dust, this.bokeh]) fu(p).uCol.value.set(it.accent);
        fu(this.fxA).uMode.value = fu(this.fxB).uMode.value = L.fx; fu(this.fxA).uAlpha.value = 1; fu(this.fxB).uAlpha.value = 0;
        this.focusT = { a: reduced ? L.focus : 1, b: L.focus, t0: performance.now(), dur: 2.6 };
        this.u.uP.value = 0; this.cur = i; this.ready = true;
        this.fadeIn = 0;
        html.classList.add("gl-hero-on");
        this.host.classList.add("gl-ready");
        if (this.items.length > 1) this.load((i + 1) % this.items.length).catch(() => {});
      } else {
        this.setLook("B", it, tex, dep);
        fu(this.fxB).uMode.value = L.fx; fu(this.fxB).uCol.value.set(it.accent);
        const c0 = fu(this.dust).uCol.value.clone(), c1 = col(it.accent);
        const r0 = this.rays.uniforms.uCol.value.clone(), r1 = col(L.haze);
        const f0 = this.curFocus ?? this.items[this.cur].look.focus;
        this.focusT = null;
        await this.tween(reduced ? 0.01 : 2.4, (k) => {
          const e = easeIO(k);
          this.u.uP.value = e;
          fu(this.dust).uCol.value.copy(c0).lerp(c1, k); fu(this.bokeh).uCol.value.copy(c0).lerp(c1, k);
          fu(this.fxA).uAlpha.value = 1 - e; fu(this.fxB).uAlpha.value = e;
          this.rays.uniforms.uCol.value.copy(r0).lerp(r1, e);
          // rack focus: A drifts out to the foreground while B pulls in from it
          this.u.uFocusA.value = lerp(f0, 1, e); this.u.uFocusB.value = lerp(1, L.focus, ease(k));
        });
        this.setLook("A", it, tex, dep); this.u.uFocusA.value = L.focus; this.curFocus = L.focus;
        fu(this.fxA).uMode.value = L.fx; fu(this.fxA).uCol.value.set(it.accent); fu(this.fxA).uAlpha.value = 1; fu(this.fxB).uAlpha.value = 0;
        this.u.uP.value = 0; this.cur = i;
        if (this.items.length > 1) this.load((i + 1) % this.items.length).catch(() => {});
      }
    } catch (e) {
      console.warn("[gl] hero texture failed", e);
      if (first) { html.classList.remove("gl-hero-on"); this.host.classList.remove("gl-ready"); this.ready = false; }
      else { this.u.uP.value = 0; this.fxA.material.uniforms.uAlpha.value = 1; this.fxB.material.uniforms.uAlpha.value = 0; }
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
  frame(dt) {
    if (!this.visible || !this.ready) return;
    this.t += dt; this.u.uTime.value = this.t;
    this.final.uniforms.uTime.value = this.t; this.rays.uniforms.uTime.value = this.t;
    if (this.fadeIn < 1) { this.fadeIn = Math.min(1, this.fadeIn + dt / 1.4); this.u.uFade.value = ease(this.fadeIn); }
    if (this.focusT) {                                    // opening focus pull (foreground → subject)
      const k = clamp((performance.now() - this.focusT.t0) / 1000 / this.focusT.dur, 0, 1);
      const f = lerp(this.focusT.a, this.focusT.b, easeIO(k));
      this.u.uFocusA.value = this.u.uFocusB.value = f; this.curFocus = f;
      if (k >= 1) this.focusT = null;
    }
    const r = this.host.getBoundingClientRect();
    this.scroll = clamp(-r.top / Math.max(r.height, 1), 0, 1);
    this.u.uScroll.value = this.scroll;
    const H = this.H, s = this.scroll;
    const breathe = reduced ? 0 : Math.sin(this.t * 0.16) * 0.025;
    const cam = this.camera;
    const drift = reduced ? 0 : 1;                  // prefers-reduced-motion: no idle camera drift
    cam.position.set(Input.tx * H * 0.075 * drift + Math.sin(this.t * 0.11) * H * 0.012 * drift,
                     -Input.ty * H * 0.05 * drift + Math.cos(this.t * 0.09) * H * 0.008 * drift - s * H * 0.12,
                     this.D * (1 - breathe - s * 0.22));
    cam.lookAt(0, -s * H * 0.08, this.u.uStr.value * 0.42);
    this.u.uStr.value = H * (0.24 + s * 0.1);
    // rays/flare follow the sun of whichever photo dominates, and slide a little against the parallax
    const p = this.u.uP.value, sa = this.u.uSunA.value, sb = this.u.uSunB.value;
    const LA = this.items[this.cur].look;
    this.rays.uniforms.uSun.value.set(lerp(sa.x, sb.x, p) - Input.tx * 0.03, lerp(sa.y, sb.y, p) + Input.ty * 0.02 + s * 0.15);
    this.rays.uniforms.uStr.value = LA.rays * this.u.uFade.value * (1 - s * 0.6);
    this.rays.uniforms.uSunVis.value = this.u.uFade.value * (1 - s);
    if (!this.raysCol) { this.rays.uniforms.uCol.value.set(LA.haze); this.raysCol = true; }
    this.composer.render(dt);
  }
}

export { DepthHero };
