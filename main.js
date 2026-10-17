import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- setup ----------
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'), CAM = params.get('cam');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || params.has('touch');
if (isTouch) { document.body.classList.add('touch'); $('keysHelp').textContent = 'Joystick steers · THRUST to fly · BOOST · ROLL / FLIP for tricks'; }
const LOW = isTouch;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = LOW ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
view.prepend(renderer.domElement);

// ---------- quality tiers (auto fallback when FPS < 45) ----------
// 0: dpr 1, no bloom/MSAA/shadow map · 1: dpr 1.5 + bloom + 512 shadow (≈ previous cost) · 2: + 4x MSAA, 1024 shadow · 3: dpr 2 (cap)
const TIERS = [
  { dpr: 1, msaa: 0, bloom: false, shadow: 0 },
  { dpr: 1.5, msaa: 0, bloom: true, shadow: 512 },
  { dpr: 1.5, msaa: 4, bloom: true, shadow: 1024 },
  { dpr: 2, msaa: 4, bloom: true, shadow: 1024 },
];
if (params.has('qs')) { const [d, m, b, sh] = params.get('qs').split(',').map(Number); TIERS[3] = { dpr: d, msaa: m, bloom: !!b, shadow: sh }; params.set('q', '3'); } // debug override
const qLocked = params.has('q');
let qi = qLocked ? clamp(Math.round(+params.get('q')) || 0, 0, 3) : (LOW ? 2 : 3);
let msaaOK = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));

const FOG = new THREE.Color('#1c232e');
const scene = new THREE.Scene();
scene.background = FOG;
scene.fog = new THREE.Fog(FOG, 140, 420);
const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 600);
const hemi = new THREE.HemisphereLight(0xe8ecf5, 0x2c2f36, 0.6); scene.add(hemi);
const SUN_DIR = new THREE.Vector3(-0.45, 1, 0.55).normalize();
const sun = new THREE.DirectionalLight(0xfff3e6, 1.7);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -5.5, right: 5.5, top: 5.5, bottom: -5.5, near: 1, far: 150 });
sun.shadow.intensity = 0.7; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight(0x9db4ff, 0.55); rim.position.set(0.6, 0.35, -1); scene.add(rim);

// studio-style environment for car paint reflections (procedural, prefiltered once with PMREM)
function makeEnv() {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y;
      vec3 c = mix(vec3(0.05,0.06,0.075), vec3(0.16,0.18,0.22), smoothstep(-0.3,0.05,h));
      c = mix(c, vec3(0.035,0.04,0.055), smoothstep(0.1,0.9,h)); c += vec3(0.22,0.2,0.2)*exp(-abs(h-0.02)*22.0);
      gl_FragColor = vec4(c,1.0); }`
  })));
  const panel = (w, h, x, y, z, k, col = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(34, 14, 0, 30, 4, 3.2);          // overhead softbox
  panel(40, 3, 0, 9, -36, 2.2);           // front strip
  panel(3, 18, 36, 8, 6, 1.6, 0xdfe8ff);  // side strips
  panel(3, 18, -36, 8, -6, 1.6, 0xdfe8ff);
  panel(30, 2.5, 0, 6, 36, 1.4, 0xffe2c4); // warm rear strip
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.03).texture; pm.dispose();
  return tex;
}
scene.environment = makeEnv();

// sky dome (gradient + horizon city glow) and distant skyline
const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  uniforms: { cTop: { value: new THREE.Color('#06090e') }, cHor: { value: FOG.clone() }, cGlow: { value: new THREE.Color('#4a4a58') } },
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 cTop; uniform vec3 cHor; uniform vec3 cGlow; varying vec3 vD;
    void main(){ float h = vD.y; vec3 c = mix(cHor, cTop, smoothstep(0.0, 0.6, h)); c += cGlow * exp(-max(h,0.0)*10.0) * 0.55;
      c = mix(c, cHor, smoothstep(0.0, -0.15, h)); gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
}));
sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
function skylineTex() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 128; const g = c.getContext('2d');
  for (let layer = 0; layer < 2; layer++) {
    let x = -20;
    while (x < 2048) {
      const w = 12 + Math.random() * 44, h = (layer ? 10 : 22) + Math.random() * Math.random() * (layer ? 60 : 100);
      g.fillStyle = layer ? '#141922' : '#1a202a'; g.fillRect(x, 128 - h, w, h);
      if (layer) for (let wy = 128 - h + 4; wy < 124; wy += 5) for (let wx = x + 3; wx < x + w - 3; wx += 4)
        if (Math.random() < 0.13) { g.fillStyle = Math.random() < 0.7 ? 'rgba(255,214,160,0.75)' : 'rgba(190,215,255,0.7)'; g.fillRect(wx, wy, 2, 2); }
      x += w + (Math.random() < 0.25 ? Math.random() * 14 : 0);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); return t;
}
const skyline = new THREE.Mesh(new THREE.CylinderGeometry(390, 390, 60, 48, 1, true),
  new THREE.MeshBasicMaterial({ map: skylineTex(), transparent: true, side: THREE.BackSide, fog: false, depthWrite: false, color: 0xb8c0cc }));
skyline.renderOrder = -5; skyline.frustumCulled = false; scene.add(skyline);

// post: MSAA HDR target -> bloom -> tone map/sRGB
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.3, 2.4);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- geometry helpers ----------
// every vertex carries colour + aRMC (roughness, metalness, clearcoat) so one draw call can hold paint, glass, rubber and chrome
const C3 = hex => { const k = new THREE.Color(hex); return [k.r, k.g, k.b]; };
const MAT = {
  paint: { c: C3('#eceef1'), r: 0.3, m: 0.0, cc: 1 },
  steel: { c: C3('#bfc3c8'), r: 0.38, m: 0.8, cc: 0 },
  glass: { c: C3('#05070a'), r: 0.16, m: 0.0, cc: 0 },
  trim: { c: C3('#101215'), r: 0.55, m: 0.0, cc: 0 },
  under: { c: C3('#5d636d'), r: 0.6, m: 0.0, cc: 0 }, // light underside keeps tumbling traffic readable at night
  gloss: { c: C3('#0b0c0e'), r: 0.22, m: 0.3, cc: 0.6 },
  tire: { c: C3('#0b0c0d'), r: 0.92, m: 0.0, cc: 0 },
  rim: { c: C3('#c4c8ce'), r: 0.3, m: 0.85, cc: 0.4 },
  aero: { c: C3('#3a3e45'), r: 0.35, m: 0.6, cc: 0.3 },
  chrome: { c: C3('#d2d5da'), r: 0.16, m: 1.0, cc: 0 },
  pole: { c: C3('#4a5059'), r: 0.6, m: 0.3, cc: 0 },
  housing: { c: C3('#1d2026'), r: 0.6, m: 0.2, cc: 0 },
};
const emis = c => ({ c, r: 1, m: 0, cc: 0 });
function part(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  for (const k of ['uv', 'uv1', 'uv2']) if (geo.attributes[k]) geo.deleteAttribute(k);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (rx) geo.rotateX(rx); if (ry) geo.rotateY(ry); if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  if (mat) {
    const M = Array.isArray(mat) ? emis(mat) : typeof mat === 'string' ? { c: C3(mat), r: 0.55, m: 0, cc: 0 } : mat;
    const n = geo.attributes.position.count, a = new Float32Array(n * 3), b = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a.set(M.c, i * 3); b[i * 3] = M.r; b[i * 3 + 1] = M.m; b[i * 3 + 2] = M.cc; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    geo.setAttribute('aRMC', new THREE.BufferAttribute(b, 3));
  }
  return geo;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function wedge(pts, width) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  g.translate(0, 0, -width / 2); g.rotateY(-Math.PI / 2); return g;
}
// smooth (Hermite) curve through keyframes
function curve(zs, vs) {
  const n = zs.length;
  const m = k => k <= 0 ? (vs[1] - vs[0]) / (zs[1] - zs[0]) : k >= n - 1 ? (vs[n - 1] - vs[n - 2]) / (zs[n - 1] - zs[n - 2]) : (vs[k + 1] - vs[k - 1]) / (zs[k + 1] - zs[k - 1]);
  return z => {
    if (z <= zs[0]) return vs[0]; if (z >= zs[n - 1]) return vs[n - 1];
    let i = 0; while (z > zs[i + 1]) i++;
    const h = zs[i + 1] - zs[i], t = (z - zs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * vs[i] + (t3 - 2 * t2 + t) * h * m(i) + (-2 * t3 + 3 * t2) * vs[i + 1] + (t3 - t2) * h * m(i + 1);
  };
}
// loft: rings of right-half points [x, y, mat] from bottom-centre to top-centre, mirrored and stitched along z.
// Two consecutive identical points make a hard crease (or a material seam).
function loft(rings, capF, capR) {
  const half = rings[0].p.length, F = 2 * half - 2, pos = [], col = [], rmc = [], idx = [];
  const put = (x, y, z, m) => { pos.push(x, y, z); col.push(m.c[0], m.c[1], m.c[2]); rmc.push(m.r, m.m, m.cc); };
  const full = p => { const o = p.slice(); for (let k = half - 2; k >= 1; k--) o.push([-p[k][0], p[k][1], p[k][2]]); return o; };
  for (const r of rings) for (const q of full(r.p)) put(q[0], q[1], r.z, q[2]);
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < F; k++) {
    const a = i * F + k, b = i * F + (k + 1) % F, c = (i + 1) * F + k, d = (i + 1) * F + (k + 1) % F;
    idx.push(a, b, c, b, d, c);
  }
  const cap = (r, m, front) => {
    const q = full(r.p), base = pos.length / 3; let cx = 0, cy = 0;
    q.forEach(p => { cy += p[1]; }); cy /= q.length;
    put(cx, cy, r.z, m); q.forEach(p => put(p[0], p[1], r.z, m));
    for (let k = 0; k < F; k++) { const a = base + 1 + k, b = base + 1 + (k + 1) % F; if (front) idx.push(base, b, a); else idx.push(base, a, b); }
  };
  if (capF) cap(rings[0], capF, true);
  if (capR) cap(rings[rings.length - 1], capR, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aRMC', new THREE.Float32BufferAttribute(rmc, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function zSamples(z0, z1, step, extra = []) {
  const s = []; for (let z = z0; z < z1 - 1e-4; z += step) s.push(z); s.push(z1);
  return [...s, ...extra.filter(z => z > z0 && z < z1)].sort((a, b) => a - b).filter((z, i, a) => i === 0 || z - a[i - 1] > 1e-3);
}
// body shell (paint over black sill, wheel arches cut in) + teardrop glass canopy
function carShell(S, step, cseg, paint = MAT.paint, lod = false) {
  const T_ = MAT.trim, U_ = MAT.under, P_ = paint, G_ = MAT.glass;
  const extra = S.wz.flatMap(w => [w - S.ra - 0.004, w - S.ra + 0.004, w + S.ra - 0.004, w + S.ra + 0.004]);
  const rings = zSamples(S.z0, S.z1, step, extra).map(z => {
    const hw = S.hw(z), yb = S.yb(z), ys = S.ys(z), cr = S.cr(z), yt = S.yt(z), sill = yb + 0.13;
    let ya = -1; for (const w of S.wz) { const d = Math.abs(z - w); if (d < S.ra) ya = Math.max(ya, S.wr + Math.sqrt(S.ra * S.ra - d * d)); }
    let p;
    if (ya > sill) {
      const yA = Math.min(ya, ys - 0.035);
      p = [[0, yb, U_], [S.xin, yb, U_], [S.xin, yA, T_], [hw - 0.03, yA, T_], [hw - 0.03, yA, P_], [hw, clamp(yb + 0.32, yA + 0.012, ys - 0.02), P_]];
    } else p = [[0, yb, U_], [hw * 0.86, yb, U_], [hw - 0.03, yb + 0.06, T_], [hw - 0.03, sill, T_], [hw - 0.03, sill, P_], [hw + 0.005, clamp(yb + 0.32, sill + 0.02, ys - 0.03), P_]];
    p.push([hw - 0.02, ys, P_]); if (!lod) p.push([hw - 0.02, ys, P_]);
    p.push([hw * 0.78, ys + cr, P_], [hw * 0.42, yt + (ys + cr - yt) * 0.35, P_], [0, yt, P_]);
    return { z, p };
  });
  const C = S.canopy, cz = zSamples(C.zf, C.zr, step);
  const hC = t => t < C.peak ? C.H * Math.pow(Math.sin(t / C.peak * Math.PI / 2), C.fe || 0.9)
    : C.hR + (C.H - C.hR) * Math.pow(Math.cos((t - C.peak) / (1 - C.peak) * Math.PI / 2), C.re || 1);
  const crings = cz.map(z => {
    const t = (z - C.zf) / (C.zr - C.zf), base = S.ys(z) + S.cr(z) - 0.012, w = Math.min(C.w(t), S.hw(z) * 0.78 - 0.004), h = Math.max(0.004, hC(t));
    const p = [[0, base - 0.09, G_], [w, base - 0.09, G_], [w, base, G_]];
    for (let k = 1; k <= cseg; k++) { const a = k / cseg * Math.PI / 2; p.push([w * Math.pow(Math.cos(a), 2 / C.n), base + h * Math.pow(Math.sin(a), 2 / C.n), G_]); }
    p[p.length - 1][0] = 0;
    return { z, p };
  });
  return [part(loft(rings, S.capF || T_, S.capR || P_), null), part(loft(crings, G_, G_), null)];
}
function wheel(arr, r, w, x, y, z, seg, disc, spokes) {
  // tyre: rounded lathe profile (axle along x), aero disc, optional double spokes, hub
  const hw = w / 2, rr = r * 0.7;
  const prof = [[rr, -hw], [r - 0.045, -hw], [r - 0.012, -hw + 0.03], [r, -hw * 0.45], [r, hw * 0.45], [r - 0.012, hw - 0.03], [r - 0.045, hw], [rr, hw]].map(([a, b]) => new THREE.Vector2(a, b));
  const out = x >= 0 ? 1 : -1;
  arr.push(part(new THREE.LatheGeometry(prof, seg), MAT.tire, x, y, z, 0, 0, -Math.PI / 2));
  arr.push(part(new THREE.CylinderGeometry(rr, rr, w - 0.05, seg), disc, x, y, z, 0, 0, Math.PI / 2));
  if (spokes) for (let i = 0; i < 6; i++) for (const o of [-0.13, 0.13]) {
    const a = i * Math.PI / 3 + o, rc = (0.06 + rr - 0.015) / 2;
    arr.push(part(box(0.02, rr - 0.075, 0.032), MAT.gloss, x + out * (hw - 0.03), y + Math.cos(a) * rc, z + Math.sin(a) * rc, a));
  }
  arr.push(part(new THREE.CylinderGeometry(r * 0.2, r * 0.2, w - 0.03, 12), MAT.gloss, x, y, z, 0, 0, Math.PI / 2));
}
function wheels(arr, r, x, z, w, disc, seg = 10) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    arr.push(part(new THREE.CylinderGeometry(r, r, w, seg, 1, true), MAT.tire, sx * x, r, sz * z, 0, 0, Math.PI / 2));
    arr.push(part(new THREE.CylinderGeometry(r * 0.68, r * 0.68, w - 0.02, seg), disc, sx * x, r, sz * z, 0, 0, Math.PI / 2));
  }
}

// ---- 2026 Tesla Roadster: low wide wedge, fender crests over a dipped hood, teardrop dark-glass canopy, black sills
const RD = {
  z0: -2.22, z1: 2.22,
  hw: curve([-2.22, -2.12, -1.9, -1.6, -1.3, -0.9, -0.4, 0.2, 0.8, 1.2, 1.6, 1.95, 2.15, 2.22], [0.76, 0.87, 0.94, 0.97, 0.98, 0.97, 0.95, 0.95, 0.97, 0.99, 0.99, 0.97, 0.93, 0.9]),
  yb: curve([-2.22, -2.0, -1.7, 1.7, 2.0, 2.22], [0.3, 0.25, 0.21, 0.21, 0.25, 0.3]),
  ys: curve([-2.22, -1.9, -1.6, -1.4, -1.0, -0.6, 0.0, 0.6, 1.0, 1.4, 1.8, 2.1, 2.22], [0.52, 0.64, 0.74, 0.78, 0.79, 0.77, 0.75, 0.77, 0.83, 0.87, 0.89, 0.89, 0.87]),
  cr: curve([-2.22, -1.7, -1.3, -0.9, -0.5, 0.6, 1.1, 1.5, 1.9, 2.22], [0.0, 0.03, 0.04, 0.03, 0.0, 0.0, 0.03, 0.03, 0.0, 0.0]),
  yt: curve([-2.22, -1.9, -1.5, -1.0, -0.8, 1.8, 2.05, 2.15, 2.22], [0.5, 0.57, 0.66, 0.74, 0.76, 0.88, 0.9, 0.92, 0.9]),
  wz: [-1.4, 1.4], wr: 0.35, ra: 0.41, xin: 0.62,
  canopy: { zf: -0.95, zr: 1.95, H: 0.41, peak: 0.44, hR: 0.0, w: curve([0, 0.4, 0.75, 1], [0.73, 0.75, 0.6, 0.16]), n: 4.2, fe: 0.8, re: 0.85 },
};
const MY = {
  z0: -2.3, z1: 2.3,
  hw: curve([-2.3, -2.2, -1.9, -1.5, -1.0, 0, 1.0, 1.6, 2.0, 2.22, 2.3], [0.8, 0.89, 0.94, 0.96, 0.96, 0.95, 0.96, 0.96, 0.94, 0.89, 0.86]),
  yb: curve([-2.3, -2.0, -1.7, 1.7, 2.0, 2.3], [0.38, 0.3, 0.26, 0.26, 0.3, 0.38]),
  ys: curve([-2.3, -2.0, -1.6, -1.2, -0.6, 0.4, 1.2, 1.7, 2.1, 2.3], [0.66, 0.8, 0.9, 0.95, 0.97, 0.98, 1.01, 1.04, 1.05, 1.02]),
  cr: curve([-2.3, -1.8, -1.4, -1.0, -0.6, 0.8, 1.3, 1.7, 2.1, 2.3], [0, 0.03, 0.04, 0.02, 0, 0, 0.02, 0.03, 0, 0]),
  yt: curve([-2.3, -2.0, -1.6, -1.2, 2.0, 2.2, 2.3], [0.64, 0.8, 0.9, 0.95, 1.04, 1.07, 1.05]),
  wz: [-1.45, 1.45], wr: 0.38, ra: 0.44, xin: 0.6,
  canopy: { zf: -1.2, zr: 2.18, H: 0.6, peak: 0.36, hR: 0.06, w: curve([0, 0.4, 0.85, 1], [0.7, 0.72, 0.66, 0.56]), n: 3.2, re: 0.55 },
};
const RED = [1.25, 0.004, 0.004], HEAD = [2.6, 2.7, 3.0], AMBER = [3, 1.2, 0.15];
function buildModels() {
  const M = [];
  // Model Y
  let b = carShell(MY, 0.3, 3, MAT.paint, true), l = [];
  wheels(b, 0.38, 0.82, 1.45, 0.26, MAT.aero);
  l.push(part(box(1.62, 0.05, 0.04), RED, 0, 0.99, 2.3));
  l.push(part(box(1.36, 0.035, 0.04), HEAD, 0, 0.63, -2.3));
  M.push({ body: mergeGeometries(b), lights: mergeGeometries(l), jets: [[-.93, 1.45], [.93, 1.45], [-.93, -1.45], [.93, -1.45]] });
  // Cybertruck (faceted stainless wedge, glass band, black arch flares)
  b = []; l = [];
  b.push(part(wedge([[-2.9, 0.5], [-2.9, 1.08], [-0.6, 1.95], [2.9, 1.36], [2.9, 0.5]], 2.0), MAT.steel));
  b.push(part(box(2.03, 0.05, 2.36), MAT.glass, 0, 1.53, -1.75, Math.atan2(0.87, 2.3)));
  b.push(part(box(2.02, 0.3, 2.0), MAT.glass, 0, 1.36, -0.55));
  b.push(part(box(2.04, 0.2, 5.82), MAT.under, 0, 0.5, 0));
  const fl = new THREE.Shape(); fl.moveTo(-0.82, 0.38); fl.lineTo(-0.62, 1.02); fl.lineTo(0.62, 1.02); fl.lineTo(0.82, 0.38); fl.lineTo(0.53, 0.38);
  fl.absarc(0, 0.46, 0.535, -0.15, Math.PI + 0.15, false); fl.lineTo(-0.82, 0.38);
  const flg = new THREE.ExtrudeGeometry(fl, { depth: 0.14, bevelEnabled: false, curveSegments: 5 }); flg.translate(0, 0, -0.07); flg.rotateY(-Math.PI / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.push(part(flg.clone(), MAT.trim, sx * 1.02, 0, sz * 1.9));
  wheels(b, 0.46, 0.93, 1.9, 0.3, MAT.steel);
  l.push(part(box(2.0, 0.07, 0.07), RED, 0, 1.3, 2.93));
  l.push(part(box(2.0, 0.05, 0.05), HEAD, 0, 1.06, -2.93));
  M.push({ body: mergeGeometries(b), lights: mergeGeometries(l), jets: [[-1, 1.9], [1, 1.9], [-1, -1.9], [1, -1.9]] });
  // Roadster (traffic LOD)
  b = carShell(RD, 0.3, 3, MAT.paint, true); l = [];
  wheels(b, 0.35, 0.83, 1.4, 0.27, MAT.rim);
  b.push(part(box(1.6, 0.2, 0.24), MAT.trim, 0, 0.38, 2.11));
  l.push(part(box(1.74, 0.035, 0.03), RED, 0, 0.835, 2.215));
  l.push(part(box(1.44, 0.024, 0.03), HEAD, 0, 0.505, -2.215));
  M.push({ body: mergeGeometries(b), lights: mergeGeometries(l), jets: [[-.94, 1.4], [.94, 1.4], [-.94, -1.4], [.94, -1.4]] });
  return M;
}
const MODELS = buildModels();
// per-vertex roughness / metalness / clearcoat
function rmcMaterial(mat) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRMC;\nvarying vec3 vRMC;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRMC = aRMC;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRMC;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRMC.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRMC.y;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= vRMC.z;\n#endif');
  };
  mat.customProgramCacheKey = () => 'rmc';
  return mat;
}
const bodyMat = rmcMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, envMapIntensity: 0.9 }));
const playerMat = rmcMaterial(new THREE.MeshPhysicalMaterial({ vertexColors: true, clearcoat: 1, clearcoatRoughness: 0.18, envMapIntensity: 1.1 }));
const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });

// soft radial texture (blob shadows, lamp pools)
function radialTex(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); stops.forEach(([o, s]) => gr.addColorStop(o, s));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
const blobTex = radialTex([[0, 'rgba(0,0,0,1)'], [0.5, 'rgba(0,0,0,0.75)'], [1, 'rgba(0,0,0,0)']]);
const poolTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);

// ---------- city grid (FSD style) ----------
const TILE = 100, RW = 10.8;
function buildTile() {
  const L = [], B = [], G = [], PL = [];
  const W = [0.85, 0.88, 0.92], Y = [0.95, 0.72, 0.16], h = 0.02;
  const line = (x, z, w, d, c = W) => L.push(part(box(w, h, d), c, x, 0.03, z));
  for (const s of [-1, 1]) {
    for (const zc of [30.5, -30.5]) line(s * RW, zc, 0.22, 39);
    line(s * 0.18, 30.5, 0.12, 39, Y); line(s * 0.18, -30.5, 0.12, 39, Y);
    for (const lx of [3.6, 7.2]) for (let z = 12; z < 50; z += 8) { line(s * lx, z + 1.5, 0.16, 3); line(s * lx, -z - 1.5, 0.16, 3); }
    for (const zc of [11, -11]) line(s * 45.4, zc, 69.2, 0.22);
    for (let x = 13; x < 80; x += 7) { line(s * (x + 1.5), 0, 3, 0.16); line(s * (x + 1.5), 5.5, 2, 0.12); line(s * (x + 1.5), -5.5, 2, 0.12); }
    // turn-guide dashes through intersection
    for (let z = -10; z < 10; z += 2.4) line(s * 3.6, z + 0.6, 0.1, 1.1, [0.55, 0.58, 0.62]);
    for (const sz of [-1, 1]) {
      B.push(part(box(67, 0.12, 37), '#2c323b', s * 46.5, 0.06, sz * 31.5));
      // curbs
      B.push(part(box(67, 0.17, 0.32), '#545c68', s * 46.5, 0.085, sz * 13.16), part(box(67, 0.17, 0.32), '#545c68', s * 46.5, 0.085, sz * 49.84));
      B.push(part(box(0.32, 0.17, 37), '#545c68', s * 13.16, 0.085, sz * 31.5));
      // traffic lights: pole, housing, red / amber / green lamps
      B.push(part(new THREE.CylinderGeometry(0.1, 0.12, 5.4, 8), MAT.pole, s * 12.5, 2.7, sz * 12.5));
      B.push(part(box(0.5, 1.3, 0.5), MAT.housing, s * 12.5, 5.6, sz * 12.5));
      G.push(part(box(0.34, 0.3, 0.56), [1.3, 0.01, 0.01], s * 12.5, 6.0, sz * 12.5));
      G.push(part(box(0.34, 0.3, 0.56), [0.45, 0.24, 0.02], s * 12.5, 5.6, sz * 12.5));
      G.push(part(box(0.34, 0.3, 0.56), [0.02, 0.32, 0.12], s * 12.5, 5.2, sz * 12.5));
      // street lamps along the avenue + light pools on the asphalt
      for (const zc of [24, 40]) {
        const z = sz * zc;
        B.push(part(new THREE.CylinderGeometry(0.07, 0.09, 7.2, 6), MAT.pole, s * 11.9, 3.6, z));
        B.push(part(box(1.7, 0.08, 0.12), MAT.pole, s * 11.15, 7.15, z));
        G.push(part(box(0.75, 0.07, 0.3), [3.2, 2.9, 2.4], s * 10.55, 7.07, z));
        const pg = new THREE.PlaneGeometry(9, 9); pg.rotateX(-Math.PI / 2); pg.translate(s * 9.6, 0.05, z); PL.push(pg);
      }
    }
  }
  line(5.4, 12.6, 10.8, 0.45); line(-5.4, -12.6, 10.8, 0.45);
  for (let x = -9.5; x <= 9.5; x += 1.6) { line(x, 15.5, 0.7, 3); line(x, -15.5, 0.7, 3); }
  return { lines: mergeGeometries(L), blocks: mergeGeometries(B), glow: mergeGeometries(G), pools: mergeGeometries(PL) };
}
const tileGeo = buildTile();
const lineMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const blockMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: new THREE.Color(0.2, 0.17, 0.12), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
const tiles = [];
for (let i = 0; i < 5; i++) {
  const g = new THREE.Group();
  const ln = new THREE.Mesh(tileGeo.lines, lineMat), bl = new THREE.Mesh(tileGeo.blocks, blockMat);
  ln.receiveShadow = bl.receiveShadow = true;
  g.add(ln, bl, new THREE.Mesh(tileGeo.glow, glowMat), new THREE.Mesh(tileGeo.pools, poolMat));
  scene.add(g); tiles.push(g);
}
function asphaltTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const d = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) { const n = (Math.random() - 0.5) * 14 + (Math.random() < 0.02 ? 10 : 0); d.data[i * 4] = 38 + n; d.data[i * 4 + 1] = 44 + n; d.data[i * 4 + 2] = 54 + n; d.data[i * 4 + 3] = 255; }
  g.putImageData(d, 0, 0);
  for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.025)`; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 40, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return t;
}
const GT = 12, groundTex = asphaltTex(); groundTex.repeat.set(1400 / GT, 1400 / GT);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ map: groundTex }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// ---------- instanced traffic ----------
const POOL = LOW ? 26 : 34;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const PALETTE = [[1, 1, 1], [1, 1, 1], [0.86, 0.88, 0.91], [0.97, 0.95, 0.9], [0.78, 0.8, 0.84], [0.9, 0.93, 1.0]].map(c => new THREE.Color(...c));
const carMeshes = MODELS.map(m => {
  const body = new THREE.InstancedMesh(m.body, bodyMat, POOL);
  const lights = new THREE.InstancedMesh(m.lights, lightMat, POOL);
  lights.instanceMatrix = body.instanceMatrix;
  body.frustumCulled = lights.frustumCulled = false;
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < POOL; i++) { body.setMatrixAt(i, ZERO); body.setColorAt(i, PALETTE[Math.floor(Math.random() * PALETTE.length)]); }
  scene.add(body, lights);
  return body;
});
const cars = [];
for (let t = 0; t < 3; t++) for (let i = 0; i < POOL; i++)
  cars.push({ t, i, active: false, ground: false, pos: new THREE.Vector3(), rot: new THREE.Euler(), quat: new THREE.Quaternion(), m: new THREE.Matrix4() });
// contact shadows under ground traffic
const BLOB_SIZE = [[2.3, 5.2], [2.4, 6.4], [2.3, 5.0]];
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
const blobGeo = new THREE.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);
const blobs = new THREE.InstancedMesh(blobGeo, blobMat, POOL * 3);
blobs.frustumCulled = false; blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); blobs.renderOrder = 1;
for (let i = 0; i < POOL * 3; i++) blobs.setMatrixAt(i, ZERO);
scene.add(blobs);

// thruster jets (instanced, additive, bloomed): soft-edged flickering plume
const jetGeo = new THREE.ConeGeometry(0.2, 1, 12, 1, true); jetGeo.rotateX(Math.PI); jetGeo.translate(0, -0.5, 0);
const jetMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uT: { value: 0 } },
  vertexShader: `uniform float uT; varying float vY; varying float vF; varying float vE;
    void main(){ vY = uv.y; vec4 mv = modelViewMatrix*instanceMatrix*vec4(position,1.0);
      vec3 n = normalize(normalMatrix*mat3(instanceMatrix)*normal); vE = abs(dot(n, normalize(-mv.xyz)));
      vF = 0.82 + 0.18*sin(uT*47.0 + float(gl_InstanceID)*1.7 + uv.x*12.0);
      gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying float vY; varying float vF; varying float vE;
    void main(){ float a = pow(clamp(1.0 - vY, 0.0, 1.0), 2.2) * clamp(vF, 0.0, 1.0) * (0.35 + 0.65*pow(clamp(vE, 0.0, 1.0), 1.3)); // clamp: MSAA can extrapolate varyings
      vec3 c = mix(vec3(0.3,0.5,1.25), vec3(2.6,2.9,3.4), a*a*a); gl_FragColor = vec4(c*a, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
const JETS = POOL * 3 * 4 + 8;
const jets = new THREE.InstancedMesh(jetGeo, jetMat, JETS);
jets.frustumCulled = false; jets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(jets);
// jet nozzle glow sprites
const gPos = new Float32Array(JETS * 3), gI = new Float32Array(JETS);
const glowGeo = new THREE.BufferGeometry();
const aGPos = new THREE.BufferAttribute(gPos, 3).setUsage(THREE.DynamicDrawUsage), aGI = new THREE.BufferAttribute(gI, 1).setUsage(THREE.DynamicDrawUsage);
glowGeo.setAttribute('position', aGPos); glowGeo.setAttribute('aI', aGI);
const glowPtsMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: 500 } },
  vertexShader: `uniform float uPx; attribute float aI; varying float vI;
    void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; vI = aI;
      gl_PointSize = min(1.5*uPx/max(-mv.z,1.0), 140.0); }`,
  fragmentShader: `varying float vI; void main(){ vec2 d = gl_PointCoord-0.5; float r = dot(d,d)*4.0; if (r > 1.0) discard;
    vec3 c = vec3(0.35,0.55,1.3)*exp(-r*4.0)*vI + vec3(1.6)*exp(-r*30.0)*vI; gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`
});
const glowPts = new THREE.Points(glowGeo, glowPtsMat); glowPts.frustumCulled = false; scene.add(glowPts);
let gN = 0;
function addGlow(x, y, z, k) { if (gN >= JETS) return; gPos[gN * 3] = x; gPos[gN * 3 + 1] = y; gPos[gN * 3 + 2] = z; gI[gN] = k; gN++; }
// ---------- GPU smoke ----------
const NS = LOW ? 5000 : 12000, LIFE = 2.6;
const sPos = new Float32Array(NS * 3), sVel = new Float32Array(NS * 3), sBirth = new Float32Array(NS).fill(-999), sSize = new Float32Array(NS);
const smokeGeo = new THREE.BufferGeometry();
const aPos = new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage);
const aVel = new THREE.BufferAttribute(sVel, 3).setUsage(THREE.DynamicDrawUsage);
const aBirth = new THREE.BufferAttribute(sBirth, 1).setUsage(THREE.DynamicDrawUsage);
const aSize = new THREE.BufferAttribute(sSize, 1).setUsage(THREE.DynamicDrawUsage);
smokeGeo.setAttribute('position', aPos); smokeGeo.setAttribute('aVel', aVel); smokeGeo.setAttribute('aBirth', aBirth); smokeGeo.setAttribute('aSize', aSize);
const smokeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime: { value: 0 }, uPx: { value: 500 } },
  vertexShader: `uniform float uTime; uniform float uPx; attribute vec3 aVel; attribute float aBirth; attribute float aSize; varying float vA; varying float vK;
  void main(){ float age = uTime - aBirth; float k = clamp(age/${LIFE.toFixed(1)},0.0,1.0);
   vec3 p = position + aVel*(1.0-exp(-age*1.4))/1.4 + vec3(0.0, 0.45*age, 0.0);
   vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
   float alive = step(0.0,age)*step(age,${LIFE.toFixed(1)});
   gl_PointSize = min(alive*aSize*(0.7+k*3.2)*uPx/max(-mv.z,1.0), 180.0);
   vA = alive*(1.0-k)*(1.0-k)*smoothstep(0.0,0.06,age)*0.32*smoothstep(6.0,18.0,-mv.z); vK = k; }`,
  fragmentShader: `varying float vA; varying float vK; void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d);
   float a = smoothstep(0.5,0.05,r)*vA; if(a<0.004) discard; vec3 c = mix(vec3(0.86,0.92,1.0), vec3(0.62,0.67,0.76), vK); gl_FragColor = vec4(c, a);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
  }`
});
const smoke = new THREE.Points(smokeGeo, smokeMat); smoke.frustumCulled = false; scene.add(smoke);
let sHead = 0, sDirty = false;
function emit(x, y, z, vx, vy, vz, size) {
  const i = sHead; sHead = (sHead + 1) % NS;
  sPos[i * 3] = x; sPos[i * 3 + 1] = y; sPos[i * 3 + 2] = z;
  sVel[i * 3] = vx; sVel[i * 3 + 1] = vy; sVel[i * 3 + 2] = vz;
  sBirth[i] = T; sSize[i] = size; sDirty = true;
}

// orbs (charging pressure)
const ORBS = 10;
const orbMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.75, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.9, 2.6), wireframe: false }), ORBS);
const orbRing = new THREE.InstancedMesh(new THREE.TorusGeometry(1.25, 0.07, 8, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.6, 2.2) }), ORBS);
orbMesh.frustumCulled = orbRing.frustumCulled = false;
scene.add(orbMesh, orbRing);
const orbs = Array.from({ length: ORBS }, () => ({ pos: new THREE.Vector3(), ph: Math.random() * 6 }));

// ---------- player: detailed 2026 Roadster ----------
const PLAYER_REAR_NOZ = [[-0.42, 0.4], [-0.15, 0.4], [0.15, 0.4], [0.42, 0.4]];
function plateTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 84; const g = c.getContext('2d');
  g.fillStyle = '#ecebe6'; g.fillRect(0, 0, 256, 84); g.strokeStyle = '#b9b8b2'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 76);
  g.font = 'bold 54px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff'; g.fillText('RDSTR', 129, 46); g.fillStyle = '#8f8e89'; g.fillText('RDSTR', 128, 44);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function buildPlayer() {
  const g = new THREE.Group();
  const b = carShell(RD, 0.07, 7), l = [];
  // rear: black diffuser, four cold-gas nozzles, two fan vents
  b.push(part(box(1.62, 0.21, 0.26), MAT.trim, 0, 0.385, 2.115));
  for (const [x, y] of PLAYER_REAR_NOZ) {
    b.push(part(new THREE.CylinderGeometry(0.052, 0.056, 0.07, 16, 1, true), MAT.chrome, x, y, 2.255, Math.PI / 2));
    b.push(part(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12), MAT.tire, x, y, 2.245, Math.PI / 2));
  }
  for (const sx of [-1, 1]) {
    b.push(part(new THREE.TorusGeometry(0.085, 0.012, 6, 20), MAT.chrome, sx * 0.67, 0.39, 2.248));
    for (let k = 0; k < 5; k++) b.push(part(box(0.016, 0.075, 0.012), MAT.gloss, sx * 0.67 + Math.sin(k * 1.2566) * 0.04, 0.39 + Math.cos(k * 1.2566) * 0.04, 2.244, 0, 0, -k * 1.2566 + 0.5));
  }
  // front lower lip, side camera stalks
  b.push(part(box(1.4, 0.03, 0.16), MAT.gloss, 0, 0.29, -2.15));
  for (const sx of [-1, 1]) b.push(part(box(0.1, 0.035, 0.07), MAT.gloss, sx * 0.86, 0.84, -0.78));
  const body = new THREE.Mesh(mergeGeometries(b), playerMat); body.castShadow = true;
  // lights: slim full-width front bar, rear red light bar with corner wraps, amber side markers
  l.push(part(box(1.44, 0.022, 0.03), HEAD, 0, 0.505, -2.215));
  l.push(part(box(1.74, 0.034, 0.03), RED, 0, 0.835, 2.215));
  for (const sx of [-1, 1]) {
    l.push(part(box(0.03, 0.03, 0.2), RED, sx * 0.885, 0.835, 2.12, 0, sx * 0.35));
    l.push(part(box(0.02, 0.018, 0.13), AMBER, sx * 0.978, 0.71, -0.92));
  }
  l.push(part(box(0.26, 0.01, 0.02), [0.9, 0.9, 0.9], 0, 0.69, 2.226)); // plate lamp
  const lights = new THREE.Mesh(mergeGeometries(l), lightMat);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.145), new THREE.MeshStandardMaterial({ map: plateTex(), roughness: 0.5 }));
  plate.position.set(0, 0.6, 2.229);
  // wheels: lathe tyre, light aero disc, black double spokes (instanced x4, spin with speed)
  const wa = []; wheel(wa, 0.35, 0.27, 0, 0, 0, 28, MAT.rim, true);
  for (const q of wa) q.translate(0, 0, 0);
  const wGeo = mergeGeometries(wa); wGeo.translate(-0.0, 0, 0);
  const wheelsM = new THREE.InstancedMesh(wGeo, playerMat, 4); wheelsM.castShadow = true; wheelsM.frustumCulled = false;
  // soft red halo around the rear light bar (bloom would wash red to orange under ACES)
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.34), new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]), color: new THREE.Color(0.9, 0.02, 0.015), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  halo.position.set(0, 0.835, 2.235);
  g.add(body, lights, plate, wheelsM, halo);
  return { g, wheelsM };
}
const PW = buildPlayer();
const player = PW.g;
scene.add(player);
const WHEEL_POS = [[-0.83, 1.4], [0.83, 1.4], [-0.83, -1.4], [0.83, -1.4]];
let wheelSpin = 0;
const wm = new THREE.Matrix4(), wq = new THREE.Quaternion(), we = new THREE.Euler(), wp = new THREE.Vector3();
function updateWheels() {
  for (let k = 0; k < 4; k++) {
    const [x, z] = WHEEL_POS[k];
    // spokes are built on the +x face: mirror left wheels by yawing 180°
    we.set(x < 0 ? -wheelSpin : wheelSpin, x < 0 ? Math.PI : 0, 0, 'YXZ'); wq.setFromEuler(we);
    wm.compose(wp.set(x, 0.35, z), wq, ONE); PW.wheelsM.setMatrixAt(k, wm);
  }
  PW.wheelsM.instanceMatrix.needsUpdate = true;
}
const pBlob = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
pBlob.renderOrder = 1; scene.add(pBlob);

// ---------- state ----------
let T = 0, state = 'title', attract = true;
const P = { x: 5.4, y: 0, z: 0, vx: 0, vy: 0, speed: 12, gas: 100, roll: 0, flip: 0, rollV: 0, flipV: 0, bank: 0, air: false, airT: 0, dead: false, deadT: 0, spin: new THREE.Vector3() };
let score = 0, combo = 0, comboT = 0, best = +(localStorage.getItem('zaxis-best') || 0);
let stats = { near: 0, tricks: 0, maxCombo: 0, air: 0 };
let gameT = 0, shake = 0, overT = 0, ticketCD = 0, speedOverT = 0, saidNoLimit = false, lastLandZ = 0, invuln = false;
const input = { steer: 0, throttle: 0, thrust: false, boost: false };
// boost: works on the ground AND in the air, burns cold gas; empty tank locks it until released and refilled a bit
const BOOST_MULT = 1.8, BOOST_DRAIN = 24, BOOST_MIN_GAS = 15;
let boosting = false, boostLock = false, boostAmt = 0;
const keys = {};

function mult() { return 1 + Math.min(9, Math.floor(combo / 2)); }

function spawnFlyer(c, near) {
  c.active = true; c.ground = false;
  const d = Math.min(1, gameT / 150);
  c.x0 = P.x + rand(-24, 24);
  c.y0 = clamp(Math.max(P.y, 8) + rand(-6, 10), 3.5, 40);
  c.pos.set(c.x0, c.y0, P.z - (near ? rand(20, 200) : rand(150, 240)));
  c.oncoming = Math.random() < Math.min(0.45, gameT / 160);
  c.vz = c.oncoming ? rand(8, 16 + 12 * d) : -rand(3, 15);
  c.sa = Math.random() < 0.6 ? rand(1, 4 + 6 * d) : 0; c.sf = rand(0.3, 1.2); c.ba = rand(0, 2.5); c.bf = rand(0.4, 1.3); c.ph = rand(0, 6); c.age = 0;
  const k = Math.random();
  c.tumble = k < 0.42; c.rot.set(rand(-0.4, 0.4), c.oncoming ? Math.PI : 0, k > 0.75 ? Math.PI : rand(-0.5, 0.5));
  c.wx = c.tumble ? rand(-1.8, 1.8) : 0; c.wz = c.tumble ? rand(-2.2, 2.2) : 0; c.wy = c.tumble ? rand(-0.8, 0.8) : 0;
  c.minD = 99; c.counted = false;
}
function spawnGround(c, z) {
  c.active = true; c.ground = true;
  const lane = [1.8, 5.4, 9.0, -1.8, -5.4, -9.0][Math.floor(Math.random() * 6)];
  c.pos.set(lane, 0, z); c.oncoming = lane < 0;
  c.vz = c.oncoming ? rand(10, 16) : -(Math.random() < 0.6 ? rand(0, 3) : rand(5, 10));
  c.rot.set(0, c.oncoming ? Math.PI : 0, 0); c.tumble = false;
}
function freeCar() {
  const free = cars.filter(c => !c.active); return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}
function deactivate(c) { c.active = false; carMeshes[c.t].setMatrixAt(c.i, ZERO); }
function placeOrb(o, near) { o.pos.set(P.x + rand(-22, 22), clamp(Math.max(P.y, 6) + rand(-5, 10), 3, 36), P.z - (near ? rand(40, 250) : rand(220, 300))); }

function resetWorld(att) {
  attract = att; T = T; gameT = att ? 60 : 0;
  Object.assign(P, { x: 5.4, y: att ? 14 : 0, z: 0, vx: 0, vy: 0, speed: att ? 26 : 10, gas: 100, roll: 0, flip: 0, rollV: 0, flipV: 0, bank: 0, air: att, airT: 0, dead: false, deadT: 0 });
  score = 0; combo = 0; comboT = 0; stats = { near: 0, tricks: 0, maxCombo: 0, air: 0 };
  speedOverT = 0; ticketCD = 4; saidNoLimit = false; invuln = att; boosting = false; boostLock = false; boostAmt = 0;
  cars.forEach(deactivate);
  for (let i = 0; i < 16; i++) { const c = freeCar(); spawnGround(c, -20 - i * 13 + rand(-4, 4)); }
  for (let i = 0; i < (att ? 46 : 14); i++) spawnFlyer(freeCar(), true);
  orbs.forEach(o => placeOrb(o, true));
}

// ---------- audio ----------
let AC = null, hissG, whine, whineG, master;
function initAudio() {
  if (AC) { AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.7; master.connect(AC.destination);
    const nb = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    AC.noise = nb;
    const src = AC.createBufferSource(); src.buffer = nb; src.loop = true;
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.6;
    hissG = AC.createGain(); hissG.gain.value = 0; src.connect(bp).connect(hissG).connect(master); src.start();
    whine = AC.createOscillator(); whine.type = 'triangle'; whineG = AC.createGain(); whineG.gain.value = 0.0;
    whine.connect(whineG).connect(master); whine.start();
  } catch (e) { AC = null; }
}
function noiseBurst(dur, f0, f1, vol, type = 'bandpass') {
  if (!AC) return; const t = AC.currentTime;
  const s = AC.createBufferSource(); s.buffer = AC.noise;
  const f = AC.createBiquadFilter(); f.type = type; f.Q.value = 1.2; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function tone(freq, dur, vol, type = 'sine', delay = 0) {
  if (!AC) return; const t = AC.currentTime + delay;
  const o = AC.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
const sfx = {
  whoosh: () => noiseBurst(0.38, 500, 3200, 0.5),
  chime: () => { tone(1046, 0.4, 0.18); tone(1568, 0.5, 0.14, 'sine', 0.07); },
  trick: () => { tone(660, 0.15, 0.15, 'triangle'); tone(990, 0.3, 0.15, 'triangle', 0.08); },
  land: () => { noiseBurst(0.25, 300, 80, 0.5, 'lowpass'); tone(523, 0.3, 0.1, 'sine', 0.05); },
  ticket: () => { tone(880, 0.12, 0.15, 'square'); tone(660, 0.18, 0.15, 'square', 0.15); },
  crash: () => { noiseBurst(1.1, 1600, 60, 0.9, 'lowpass'); tone(70, 0.6, 0.4, 'sawtooth'); },
  lift: () => noiseBurst(0.6, 200, 2500, 0.4),
};

// ---------- UI ----------
const ui = { score: $('score'), mult: $('mult'), spd: $('spd'), spdlbl: $('spdlbl'), limit: $('limit'), limitv: $('limitv'), gas: $('gas'), alt: $('alt'), hold: $('hold') };
const gearEls = {}; document.querySelectorAll('#prnd span').forEach(s => gearEls[s.dataset.g] = s);
let lastGear = '';
function setGear(g) { if (g === lastGear) return; lastGear = g; for (const k in gearEls) gearEls[k].classList.toggle('on', k === g); }
function pop(text, cls = '') {
  const e = document.createElement('div'); e.className = 'pop ' + cls; e.textContent = text;
  e.style.top = (28 + Math.random() * 14) + '%'; $('pops').appendChild(e); setTimeout(() => e.remove(), 1150);
}
let ticketTO;
function showTicket(h, p, sign = '35') {
  const t = $('ticket');
  t.innerHTML = `<div class="sl">SPEED<br>LIMIT<b>${sign}</b></div><div><h3>${h}</h3><p>${p}</p></div>`;
  t.classList.add('show'); clearTimeout(ticketTO); ticketTO = setTimeout(() => t.classList.remove('show'), 2600);
}
$('bestT').textContent = best ? `BEST ${best.toLocaleString()}` : '';

function startGame() {
  initAudio();
  $('title').classList.remove('show'); $('over').classList.remove('show');
  $('touch').classList.add('on');
  resetWorld(false); state = 'play';
}
function gameOver(cause) {
  if (state !== 'play') return;
  state = 'dying'; P.dead = true; P.deadT = 0; overT = 0; shake = 1.4; sfx.crash();
  P.spin.set(rand(-6, 6), rand(-3, 3), rand(-8, 8));
  for (let i = 0; i < 160; i++) emit(P.x, P.y + 1, P.z, rand(-6, 6), rand(-1, 8), rand(-6, 6), rand(1.5, 3.5));
  $('cause').textContent = cause;
}
function showOver() {
  state = 'over';
  score = Math.floor(score);
  const nb = score > best; if (nb) { best = score; localStorage.setItem('zaxis-best', best); }
  $('finalScore').textContent = score.toLocaleString();
  $('bestO').textContent = nb ? 'NEW BEST!' : `BEST ${best.toLocaleString()}`;
  $('bestT').textContent = `BEST ${best.toLocaleString()}`;
  $('stats').innerHTML = `<div><b>${stats.near}</b>NEAR MISSES</div><div><b>${stats.tricks}</b>TRICKS</div><div><b>x${stats.maxCombo}</b>MAX COMBO</div><div><b>${stats.air.toFixed(0)}s</b>AIRTIME</div>`;
  const txt = `Traffic is a bit heavy in the Z-axis today. I scored ${score.toLocaleString()} in Z-Axis Traffic 🚗💨`;
  const url = location.href.split('?')[0];
  $('post').href = `https://x.com/intent/post?text=${encodeURIComponent(txt)}&url=${encodeURIComponent(url)}`;
  $('share').onclick = async () => {
    try { if (navigator.share) await navigator.share({ text: txt, url }); else { await navigator.clipboard.writeText(txt + ' ' + url); $('share').textContent = 'COPIED!'; } } catch (e) { }
  };
  $('share').textContent = 'SHARE';
  $('over').classList.add('show'); $('touch').classList.remove('on');
}
$('title').addEventListener('pointerup', startGame);
$('again').addEventListener('pointerup', e => { e.preventDefault(); startGame(); });

// ---------- iOS zoom / gesture guards ----------
const block = e => { if (e.cancelable) e.preventDefault(); };
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, block, { passive: false });
document.addEventListener('dblclick', block, { passive: false });
const isLink = t => t && t.closest && t.closest('a,#share');
let lastTouchEnd = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTouchEnd < 400 && !isLink(e.target)) block(e);
  lastTouchEnd = now;
}, { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1 || !e.target.closest('.overlay')) block(e); }, { passive: false });
for (const el of [renderer.domElement, $('touch'), $('stick'), ...document.querySelectorAll('.tb'), $('hud')])
  for (const ev of ['touchstart', 'touchmove', 'touchend']) el.addEventListener(ev, block, { passive: false });

// ---------- input ----------
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (state === 'title' && (e.code === 'Space' || e.code === 'Enter')) startGame();
  else if (state === 'over' && e.code === 'Enter') startGame();
  if (state === 'play') {
    if (e.code === 'KeyQ') trick('roll', -1); if (e.code === 'KeyE') trick('roll', 1); if (e.code === 'KeyF') trick('flip', 1);
  }
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('blur', () => { for (const k in keys) keys[k] = false; btn.thrust = btn.boost = false; });
const stick = { id: null, x: 0, y: 0 }, sEl = $('stick'), knob = $('knob');
function stickMove(e) {
  const r = sEl.getBoundingClientRect(), R = r.width / 2;
  let dx = e.clientX - r.left - R, dy = e.clientY - r.top - R; const l = Math.hypot(dx, dy);
  if (l > R) { dx *= R / l; dy *= R / l; }
  stick.x = dx / R; stick.y = dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`;
}
sEl.addEventListener('pointerdown', e => { stick.id = e.pointerId; sEl.setPointerCapture(e.pointerId); stickMove(e); initAudio(); });
sEl.addEventListener('pointermove', e => { if (e.pointerId === stick.id) stickMove(e); });
const stickEnd = e => { if (e.pointerId === stick.id) { stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; } };
sEl.addEventListener('pointerup', stickEnd); sEl.addEventListener('pointercancel', stickEnd);
const btn = { thrust: false, boost: false };
function holdBtn(el, k) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); btn[k] = true; el.classList.add('down'); el.setPointerCapture(e.pointerId); initAudio(); });
  const up = () => { btn[k] = false; el.classList.remove('down'); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  // touch fallback (iOS): the zoom guard preventDefaults touches on .tb, so drive the button from touch events too
  el.addEventListener('touchstart', () => { btn[k] = true; el.classList.add('down'); }, { passive: true });
  const tEnd = e => { if (!e.targetTouches || e.targetTouches.length === 0) up(); };
  el.addEventListener('touchend', tEnd, { passive: true }); el.addEventListener('touchcancel', tEnd, { passive: true });
}
holdBtn($('bThrust'), 'thrust'); holdBtn($('bBoost'), 'boost');
const bBoostEl = $('bBoost'), speedFx = $('speedfx');
$('bRoll').addEventListener('pointerdown', e => { e.preventDefault(); trick('roll', stick.x < 0 ? -1 : 1); });
$('bFlip').addEventListener('pointerdown', e => { e.preventDefault(); trick('flip', 1); });
addEventListener('contextmenu', e => e.preventDefault());

function trick(kind, dir) {
  if (!P.air || P.dead || P.y < 2.5) return;
  if (kind === 'roll' && P.rollV === 0) { P.rollV = dir * Math.PI * 2 / 0.6; P.rollTarget = P.roll + dir * Math.PI * 2; }
  if (kind === 'flip' && P.flipV === 0) { P.flipV = Math.PI * 2 / 0.75; P.flipTarget = P.flip + Math.PI * 2; }
}
function readInput() {
  if (attract) return autopilot();
  let s = 0, th = 0;
  if (keys.KeyA || keys.ArrowLeft) s -= 1; if (keys.KeyD || keys.ArrowRight) s += 1;
  if (keys.KeyW || keys.ArrowUp) th += 1; if (keys.KeyS || keys.ArrowDown) th -= 1;
  if (stick.id !== null) { s = stick.x; th = -stick.y; }
  input.steer = clamp(s, -1, 1); input.throttle = clamp(th, -1, 1);
  input.thrust = !!(keys.Space || btn.thrust); input.boost = !!(keys.ShiftLeft || keys.ShiftRight || btn.boost);
}
function autopilot() {
  let steer = Math.sin(T * 0.4) * 0.3, up = P.y < 14 + Math.sin(T * 0.3) * 4;
  for (const c of cars) {
    if (!c.active || c.ground) continue;
    const dz = P.z - c.pos.z;
    if (dz > 0 && dz < 40 && Math.abs(c.pos.x - P.x) < 4 && Math.abs(c.pos.y - P.y) < 3.5) { steer = c.pos.x > P.x ? -1 : 1; if (c.pos.y < P.y) up = true; }
  }
  input.steer = steer; input.throttle = 0.4; input.thrust = up && P.vy < 3; input.boost = false; P.gas = 100;
}

// ---------- update ----------
const tmpM = new THREE.Matrix4(), jm = new THREE.Matrix4(), jo = new THREE.Matrix4(), js = new THREE.Matrix4(), v3 = new THREE.Vector3(), v3b = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
const pq = new THREE.Quaternion(), pe = new THREE.Euler(0, 0, 0, 'YXZ');
let jetIdx = 0, emitP = 0.2;

function updatePlayer(dt) {
  if (P.dead) {
    P.deadT += dt; P.vy -= 18 * dt; P.y = Math.max(0.3, P.y + P.vy * dt); P.z -= P.speed * dt; P.speed *= 0.97;
    pe.x += P.spin.x * dt; pe.y += P.spin.y * dt; pe.z += P.spin.z * dt; pq.setFromEuler(pe);
    if (Math.random() < 0.6) emit(P.x, P.y + 0.8, P.z, rand(-1, 1), rand(1, 3), rand(-1, 1), rand(1.5, 3));
    return;
  }
  const air = P.air;
  const maxV = air ? 34 : 22;
  const target = air ? lerp(24, maxV, 0.5 + input.throttle * 0.5) : lerp(4, maxV, 0.45 + input.throttle * 0.55);
  // boost: previously only applied when airborne, so BOOST on the ground (where every run starts) did nothing
  if (!input.boost) boostLock = false;
  const wasBoosting = boosting;
  boosting = input.boost && !boostLock && P.gas > (wasBoosting ? 0 : BOOST_MIN_GAS);
  if (input.boost && !boosting && wasBoosting) boostLock = true; // tank ran dry: release to re-arm
  if (boosting && !wasBoosting) { P.speed = Math.max(P.speed, maxV * 0.9) + 6; sfx.whoosh(); } // instant kick
  boostAmt = lerp(boostAmt, boosting ? 1 : 0, Math.min(1, dt * (boosting ? 6 : 2.5)));
  if (boosting) {
    P.speed = lerp(P.speed, maxV * BOOST_MULT, Math.min(1, dt * 3.5));
    P.gas -= BOOST_DRAIN * dt; shake = Math.max(shake, 0.18);
  } else {
    P.speed = lerp(P.speed, target, dt * (input.throttle < 0 || P.speed > maxV + 1 ? 2.5 : 1.2));
  }
  P.vx = lerp(P.vx, input.steer * (air ? 15 : 9), dt * 5);
  P.x += P.vx * dt;
  if (!air) P.x = clamp(P.x, -RW + 1, RW - 1); else P.x = clamp(P.x, -45, 45);
  P.thrusting = input.thrust && P.gas > 0;
  if (P.thrusting) {
    if (!air) { P.air = true; P.airT = 0; sfx.lift(); if (!saidNoLimit && !attract) { saidNoLimit = true; showTicket('NO SPEED LIMIT IN THE Z-AXIS', 'Ticket cancelled. Enjoy the sky.', '∞'); } }
    P.vy += 30 * dt; P.gas -= 19 * dt;
  }
  if (P.air) {
    P.vy -= 12 * dt; P.vy *= 1 - 0.6 * dt; P.vy = clamp(P.vy, -22, 14);
    P.y += P.vy * dt; if (P.y > 44) { P.y = 44; P.vy = Math.min(P.vy, 0); }
    P.airT += dt; stats.air += attract ? 0 : dt;
    if (P.y <= 0) land();
  } else if (!boosting) {
    P.gas = Math.min(100, P.gas + 14 * dt);
  }
  P.gas = Math.max(0, P.gas);
  // tricks
  if (P.rollV) { P.roll += P.rollV * dt; if ((P.rollV > 0 && P.roll >= P.rollTarget) || (P.rollV < 0 && P.roll <= P.rollTarget)) { P.roll = 0; P.rollV = 0; trickDone('BARREL ROLL', 250); } }
  if (P.flipV) { P.flip += P.flipV * dt; if (P.flip >= P.flipTarget) { P.flip = 0; P.flipV = 0; trickDone('KICKFLIP', 350); } }
  P.z -= P.speed * dt;
  if (!attract) score += P.speed * dt * (P.air ? 0.6 : 0.25);
  P.bank = lerp(P.bank, -P.vx * 0.035, dt * 6);
  pe.set(clamp(P.vy * 0.03, -0.35, 0.35) - P.flip, -P.vx * 0.02, P.bank - P.roll, 'YXZ');
  pq.setFromEuler(pe);
}
function trickDone(name, pts) {
  if (attract) return;
  combo++; comboT = 3; stats.tricks++; stats.maxCombo = Math.max(stats.maxCombo, mult());
  const p = pts * mult(); score += p; pop(`${name} +${p}`, 'gold big'); sfx.trick();
}
function land() {
  const tricking = P.rollV || P.flipV;
  P.y = 0; P.air = false;
  if (tricking && !attract) { gameOver('BOTCHED LANDING'); return; }
  if (P.vy < -15 && !attract) { /* hard landing */ shake = 0.5; }
  P.vy = 0; P.x = clamp(P.x, -RW + 1, RW - 1);
  if (attract) return;
  const lanes = [1.8, 5.4, 9.0, -1.8, -5.4, -9.0];
  const off = Math.min(...lanes.map(l => Math.abs(l - P.x)));
  const bonus = Math.floor(100 + P.airT * 40);
  if (off < 0.8) { const p = (300 + bonus) * mult(); score += p; pop(`LANE PERFECT +${p}`, 'gold big'); tone(784, 0.25, 0.15); tone(1175, 0.4, 0.13, 'sine', 0.1); }
  else { score += bonus; pop(`LANDED +${bonus}`); }
  if (P.x < 0) pop('WRONG SIDE OF THE ROAD 😬');
  sfx.land(); shake = Math.max(shake, 0.35);
}
function nearMiss(c) {
  combo++; comboT = 3; stats.near++; stats.maxCombo = Math.max(stats.maxCombo, mult());
  const p = 50 * mult(); score += p;
  pop(c.minD < 1.5 ? `INSANE MISS +${p}` : `NEAR MISS +${p}`, c.minD < 1.5 ? 'gold' : '');
  sfx.whoosh(); shake = Math.max(shake, 0.28);
}

function updateCars(dt) {
  const d = Math.min(1, gameT / 150);
  let flyers = 0;
  jetIdx = 0; gN = 0;
  for (const c of cars) {
    if (!c.active) continue;
    c.pos.z += c.vz * dt;
    if (c.ground) {
      // jam behaviour: stop behind the car ahead
      c.pos.y = 0;
    } else {
      flyers++; c.age += dt;
      c.pos.x = c.x0 + Math.sin(c.age * c.sf + c.ph) * c.sa;
      c.pos.y = c.y0 + Math.sin(c.age * c.bf + c.ph) * c.ba;
      if (c.tumble) { c.rot.x += c.wx * dt; c.rot.z += c.wz * dt; c.rot.y += c.wy * dt; }
      else c.rot.z += (Math.cos(c.age * c.sf + c.ph) * c.sa * 0.06 * (c.oncoming ? -1 : 1) - c.rot.z * 0) * dt;
    }
    c.quat.setFromEuler(c.rot);
    c.m.compose(c.pos, c.quat, ONE);
    carMeshes[c.t].setMatrixAt(c.i, c.m);
    const dz = c.pos.z - P.z;
    if (dz > 25 || dz < -340) { deactivate(c); continue; }
    if (!c.ground) {
      // jets + smoke
      const jl = MODELS[c.t].jets;
      for (let j = 0; j < 4; j++) {
        const len = 4.2 + Math.random() * 1.2 + (c.t === 1 ? 0.8 : 0);
        jo.makeTranslation(jl[j][0], 0.25, jl[j][1]); js.makeScale(1, len, 1);
        jm.multiplyMatrices(c.m, jo).multiply(js);
        if (jetIdx < JETS - 8) { jets.setMatrixAt(jetIdx++, jm); if (dz > -200) addGlow(jm.elements[12], jm.elements[13], jm.elements[14], 0.8); }
        if (Math.random() < emitP) {
          v3.set(jl[j][0], 0.25 - len * 0.8, jl[j][1]).applyMatrix4(c.m);
          v3b.set(0, -1, 0).applyQuaternion(c.quat).multiplyScalar(5);
          emit(v3.x, v3.y, v3.z, v3b.x + rand(-.6, .6), v3b.y + rand(-.6, .6), v3b.z + c.vz * 0.3, rand(0.9, 1.6));
        }
      }
      // collisions & near misses
      if (!P.dead && state !== 'over') {
        const ex = (c.pos.x - P.x) / 1.7, ey = (c.pos.y + 0.8 - (P.y + 0.6)) / 1.15, ez = dz / 3.3;
        const e = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (Math.abs(dz) < 7) c.minD = Math.min(c.minD, Math.sqrt(ex * ex + ey * ey) );
        if (e < 1 && !invuln) gameOver('MID-AIR COLLISION');
        if (!c.counted && dz > 4 && c.minD < 2.6 && !attract) { c.counted = true; nearMiss(c); }
      }
    } else if (!P.dead && P.y < 1.4 && Math.abs(c.pos.x - P.x) < 1.85 && Math.abs(dz) < 4.4 && !invuln) {
      gameOver(Math.abs(P.speed) > 15 ? 'REAR-ENDED THE JAM' : 'BUMPER-TO-BUMPER');
    }
  }
  // ground jam: crawl & keep ground traffic dense ahead
  const groundCount = cars.filter(c => c.active && c.ground).length;
  if (groundCount < 16) { const c = freeCar(); if (c) spawnGround(c, P.z - rand(150, 300)); }
  const target = attract ? 46 : Math.min(POOL * 3 - 18, 12 + gameT * 0.55);
  if (flyers < target) { const c = freeCar(); if (c) spawnFlyer(c, false); }
  // contact shadows (visual only)
  for (let k = 0; k < cars.length; k++) {
    const c = cars[k];
    if (c.active && c.ground) { const s = BLOB_SIZE[c.t]; tmpM.makeRotationY(c.rot.y).scale(v3.set(s[0], 1, s[1])).setPosition(c.pos.x, 0.05, c.pos.z); blobs.setMatrixAt(k, tmpM); }
    else blobs.setMatrixAt(k, ZERO);
  }
  blobs.instanceMatrix.needsUpdate = true;
  // player jets (4 down-firing at the wheels, 4 rear nozzles while boosting)
  for (let k = jetIdx; k < JETS; k++) jets.setMatrixAt(k, ZERO);
  player.position.set(P.x, P.y, P.z); player.quaternion.copy(pq); player.updateMatrix(); // current-frame pose so jets don't trail the car
  if ((P.thrusting || (P.air && P.vy > -2)) && !P.dead) {
    const jl = MODELS[2].jets, pow = P.thrusting ? 1 : 0.45;
    for (let j = 0; j < 4; j++) {
      const len = (2.6 + Math.random()) * pow * (1 + 0.5 * boostAmt);
      jo.makeTranslation(jl[j][0], 0.2, jl[j][1]); js.makeScale(1.1, len, 1.1);
      jm.multiplyMatrices(player.matrix, jo).multiply(js); jets.setMatrixAt(JETS - 8 + j, jm);
      addGlow(jm.elements[12], jm.elements[13], jm.elements[14], 0.6 + 0.6 * pow);
      if (P.thrusting && Math.random() < 0.7) {
        v3.set(jl[j][0], 0.2 - len * 0.7, jl[j][1]).applyMatrix4(player.matrix);
        emit(v3.x, v3.y, v3.z, rand(-1, 1), -4 + rand(-1, 1), rand(-1, 1) + 2, rand(0.9, 1.5));
      }
    }
  }
  if (boostAmt > 0.05 && !P.dead) {
    for (let j = 0; j < 4; j++) {
      const [x, y] = PLAYER_REAR_NOZ[j], len = (1.3 + Math.random() * 0.7) * boostAmt;
      jo.makeTranslation(x, y, 2.29).multiply(tmpM.makeRotationX(-Math.PI / 2)); js.makeScale(0.42, len, 0.42);
      jm.multiplyMatrices(player.matrix, jo).multiply(js); jets.setMatrixAt(JETS - 4 + j, jm);
      addGlow(jm.elements[12], jm.elements[13], jm.elements[14] + 0.04, 0.9 * boostAmt);
    }
  }
  glowGeo.setDrawRange(0, gN); aGPos.needsUpdate = aGI.needsUpdate = true;
  jets.instanceMatrix.needsUpdate = true;
  carMeshes.forEach(m => m.instanceMatrix.needsUpdate = true);
  emitP = clamp((NS / LIFE) / 60 / Math.max(1, flyers * 4), 0.15, 0.6);
}
const om = new THREE.Matrix4(), oq = new THREE.Quaternion(), os = new THREE.Vector3(), oe = new THREE.Euler();
function updateOrbs(dt) {
  orbs.forEach((o, i) => {
    if (o.pos.z - P.z > 10) placeOrb(o, false);
    const dx = o.pos.x - P.x, dy = o.pos.y - (P.y + 0.6), dz = o.pos.z - P.z;
    if (!P.dead && !attract && dx * dx + dy * dy + dz * dz < 7.5) {
      P.gas = Math.min(100, P.gas + 35); score += 100 * mult(); pop(`+ CHARGE  +${100 * mult()}`); sfx.chime();
      for (let k = 0; k < 20; k++) emit(o.pos.x, o.pos.y, o.pos.z, rand(-4, 4), rand(-4, 4), rand(-4, 4), 0.8);
      placeOrb(o, false);
    }
    const s = 1 + Math.sin(T * 4 + o.ph) * 0.15;
    oe.set(T * 0.7 + o.ph, T + o.ph, 0); oq.setFromEuler(oe); os.set(s, s, s);
    om.compose(o.pos, oq, os); orbMesh.setMatrixAt(i, om);
    oe.set(Math.PI / 2 + Math.sin(T + o.ph) * 0.3, 0, T * 2); oq.setFromEuler(oe); os.set(1, 1, 1);
    om.compose(o.pos, oq, os); orbRing.setMatrixAt(i, om);
  });
  orbMesh.instanceMatrix.needsUpdate = orbRing.instanceMatrix.needsUpdate = true;
}

// ---------- HUD ----------
let hudCache = {};
function setText(k, el, v) { if (hudCache[k] !== v) { hudCache[k] = v; el.textContent = v; } }
function updateHUD(dt) {
  const mph = Math.round(P.speed * 2.237);
  setText('spd', ui.spd, String(state === 'title' ? 38 : mph));
  setText('score', ui.score, Math.floor(score).toLocaleString());
  setText('mult', ui.mult, combo > 1 ? `COMBO x${mult()}` : '');
  const air = P.air && state !== 'title';
  setGear(state === 'title' ? 'P' : air ? 'Z' : 'D');
  setText('lbl', ui.spdlbl, air ? 'Z-AXIS' : state === 'title' ? 'MAX' : 'MPH');
  setText('lim', ui.limitv, air ? '∞' : '35');
  ui.limit.classList.toggle('z', air);
  ui.limit.classList.toggle('over', !air && mph > 35 && state === 'play');
  ui.gas.style.height = P.gas.toFixed(0) + '%'; ui.gas.classList.toggle('low', P.gas < 20);
  ui.hold.classList.toggle('off', air);
  setText('alt', ui.alt, `ALT ${Math.round(P.y)} m`);
  // speed-limit joke
  if (state === 'play' && !P.air && !P.dead) {
    ticketCD -= dt;
    if (mph > 35) speedOverT += dt; else speedOverT = Math.max(0, speedOverT - dt);
    if (speedOverT > 1.2 && ticketCD <= 0) {
      ticketCD = 9; speedOverT = 0; score = Math.max(0, score - 50); sfx.ticket();
      showTicket('🚨 SPEEDING TICKET  −50', `${mph} in a 35. Tip: there's no speed limit in the Z-axis.`);
    }
  }
}

// ---------- resize ----------
function resize() {
  const vv = window.visualViewport, vh = vv ? vv.height * (vv.scale || 1) : innerHeight;
  document.documentElement.style.setProperty('--vh', Math.round(Math.min(vh, innerHeight || vh)) + 'px');
  if (vv && vv.scale > 1.01) window.scrollTo(0, 0);
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h; camera.fov = w / h < 0.8 ? 72 : 58; camera.updateProjectionMatrix();
  smokeMat.uniforms.uPx.value = glowPtsMat.uniforms.uPx.value = h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}
function applyQuality() {
  const t = TIERS[qi], ms = msaaOK ? t.msaa : 0;
  renderer.setPixelRatio(Math.min(devicePixelRatio, t.dpr));
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== ms) { rt.samples = ms; rt.dispose(); }
  const wantShadow = t.shadow > 0;
  if (sun.castShadow !== wantShadow) sun.castShadow = wantShadow;
  if (wantShadow && sun.shadow.mapSize.x !== t.shadow) { sun.shadow.mapSize.set(t.shadow, t.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  resize();
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));
if (window.visualViewport) { visualViewport.addEventListener('resize', resize); visualViewport.addEventListener('scroll', () => window.scrollTo(0, 0)); }
applyQuality();

// ---------- loop ----------
const camPos = new THREE.Vector3(5, 10, 18), camLook = new THREE.Vector3();
let last = performance.now();
// adaptive quality: measure real frame time; drop a tier when < 45 fps, step up once if solid 57+ and never dropped
let qT = 0, qN = 0, qGood = 0, qDropped = false, qWarm = 2.5, qChecked = false;
const CAMS = { front: [3.4, 1.3, -4.6], rear: [3.2, 1.5, 4.8], side: [5.6, 0.9, 0.2], top: [0, 7, 7], low: [-2.6, 0.55, -3.8] };
let FR = 0;
function frame(now) { FR++;
  requestAnimationFrame(frame);
  const rdt = (now - last) / 1000;
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (state === 'dying') dt *= 0.45;
  T += dt; if (state === 'play' || state === 'dying') gameT += dt;
  readInput();
  if (state !== 'over') { updatePlayer(dt); }
  updateCars(dt); updateOrbs(dt);
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
  if (state === 'dying') { overT += dt / 0.45; if (overT > 1.6) showOver(); }
  // attract: loop forever
  if (attract && state === 'title' && P.z < -5000) resetWorld(true);

  player.position.set(P.x, P.y, P.z); player.quaternion.copy(pq);
  if (!P.dead) wheelSpin -= P.speed * dt / 0.35;
  updateWheels();
  // world tiles follow
  const base = Math.round(P.z / TILE);
  tiles.forEach((t, i) => t.position.z = (base - 3 + i) * TILE);
  ground.position.set(P.x, 0, P.z);
  groundTex.offset.set((P.x / GT) % 1, (-P.z / GT) % 1);
  // sun shadow camera tracks the player (light-space box only needs to cover the car)
  sun.target.position.copy(player.position); sun.position.copy(player.position).addScaledVector(SUN_DIR, 70);
  // player contact shadow fades with altitude
  const hk = clamp(1 - P.y / 18, 0, 1);
  pBlob.position.set(P.x, 0.05, P.z); pBlob.rotation.y = -P.vx * 0.02; pBlob.scale.set(2.3 * (1 + P.y * 0.03), 1, 5.0 * (1 + P.y * 0.03)); pBlob.material.opacity = 0.7 * hk * hk * (sun.castShadow ? 0.5 : 1); pBlob.visible = hk > 0.01;
  // camera (FSD-style high chase)
  const portrait = camera.aspect < 0.8;
  const back = (portrait ? 19 : 12) + boostAmt * 3, up = (portrait ? 8 : 5.5) - (P.air ? 2 : 0);
  camPos.lerp(v3.set(P.x * 0.8, P.y + up + (P.air ? 1.5 : 0), P.z + back), Math.min(1, dt * 4));
  camLook.lerp(v3b.set(P.x * 0.85, P.y + (P.air ? 6.5 : 3.5), P.z - 30), Math.min(1, dt * 5));
  camera.position.copy(camPos);
  shake = Math.max(0, shake - dt * 1.6);
  if (shake > 0) camera.position.add(v3.set(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(shake * 0.5));
  camera.lookAt(camLook);
  camera.fov = lerp(camera.fov, (portrait ? 72 : 58) + 16 * boostAmt, Math.min(1, dt * 6));
  if (CAM && CAMS[CAM]) { const o = CAMS[CAM]; camera.position.set(P.x + o[0], P.y + o[1], P.z + o[2]); camera.lookAt(P.x, P.y + 0.5, P.z); camera.fov = 38; }
  speedFx.style.opacity = (boostAmt * (state === 'play' ? 1 : 0)).toFixed(2);
  bBoostEl.classList.toggle('empty', state === 'play' && (boostLock || (!boosting && P.gas <= BOOST_MIN_GAS)));
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position); skyline.position.set(camera.position.x, 22, camera.position.z);
  smokeMat.uniforms.uTime.value = T; jetMat.uniforms.uT.value = T;
  if (sDirty) { aPos.needsUpdate = aVel.needsUpdate = aBirth.needsUpdate = aSize.needsUpdate = true; sDirty = false; }
  // audio
  if (AC && hissG) {
    const t = AC.currentTime, playing = state === 'play';
    hissG.gain.setTargetAtTime(playing ? (P.thrusting ? 0.22 : P.air ? 0.04 : 0) + (boosting ? 0.14 : 0) : 0, t, 0.05);
    whine.frequency.setTargetAtTime(60 + P.speed * 5, t, 0.1); whineG.gain.setTargetAtTime(playing ? 0.025 : 0, t, 0.2);
  }
  updateHUD(dt);
  if (TIERS[qi].bloom) composer.render(); else renderer.render(scene, camera);
  // one-time safety: if the MSAA HDR target is not renderable on this GPU, fall back to non-MSAA
  if (!qChecked && FR > 2 && TIERS[qi].bloom) {
    qChecked = true;
    const gl = renderer.getContext(); renderer.setRenderTarget(composer.renderTarget1);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; renderer.setRenderTarget(null);
    if (!ok && msaaOK) { msaaOK = false; applyQuality(); }
  }
  // adaptive quality
  if (rdt > 0 && rdt < 1 && !document.hidden) { qT += rdt; qN++; }
  if (qWarm > 0) { qWarm -= rdt; qT = qN = 0; }
  else if (qT > 2) {
    const fps = qN / qT;
    if (!qLocked) {
      if (fps < 45 && qi > 0) { qi--; qDropped = true; applyQuality(); qWarm = 1.5; qGood = 0; }
      else if (fps > 57 && !qDropped && qi < 3) { qGood += qT; if (qGood > 4) { qi++; applyQuality(); qWarm = 1.5; qGood = 0; } }
      else qGood = 0;
    }
    lastFps = fps; qT = qN = 0;
  }
}
let lastFps = 0;
resetWorld(true);
// screenshot / test hooks
if (SHOT === 'air') { $('title').classList.remove('show'); state = 'play'; resetWorld(true); state = 'play'; $('touch').classList.add('on'); combo = 7; comboT = 999; score = 18420; gameT = 90; }
if (SHOT === 'over') { $('title').classList.remove('show'); resetWorld(true); state = 'play'; attract = false; invuln = false; score = 23870; stats = { near: 31, tricks: 9, maxCombo: 6, air: 74 }; setTimeout(() => gameOver('MID-AIR COLLISION'), 1500); }
if (CAM) { $('title').classList.remove('show'); resetWorld(false); state = 'play'; invuln = true; cars.forEach(c => { if (c.ground && Math.abs(c.pos.z - P.z) < 30) deactivate(c); }); }
camPos.set(P.x*0.8, P.y+5, P.z+12); camLook.set(P.x, P.y+6, P.z-30);
window.__forceOver = () => { if (state !== 'play') startGame(); score = 12345; stats.near = 12; gameOver('MID-AIR COLLISION'); };
window.__zaxis = { get state() { return state; }, get score() { return score; }, get speed() { return P.speed; }, get air() { return P.air; }, get gas() { return P.gas; }, get fov() { return camera.fov; }, get boosting() { return boosting; }, god(v) { invuln = !!v; },
  dbg: { scene, renderer, carMeshes, tiles, ground, sky, skyline, smoke, jets, glowPts, blobs, player, orbMesh, orbRing },
  q() { return { tier: qi, dpr: renderer.getPixelRatio(), msaa: composer.renderTarget1.samples, bloom: TIERS[qi].bloom, shadow: sun.castShadow ? sun.shadow.mapSize.x : 0, fps: +lastFps.toFixed(1) }; } };
requestAnimationFrame(frame);
