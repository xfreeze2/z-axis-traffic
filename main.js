import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- setup ----------
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || params.has('touch');
if (isTouch) { document.body.classList.add('touch'); $('keysHelp').textContent = 'Joystick steers · THRUST to fly · BOOST · ROLL / FLIP for tricks'; }
const LOW = isTouch;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: !LOW, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, LOW ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
view.prepend(renderer.domElement);

const BG = new THREE.Color('#1b212b');
const scene = new THREE.Scene();
scene.background = BG;
scene.fog = new THREE.Fog(BG, 140, 420);
const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 600);
scene.add(new THREE.HemisphereLight(0xe4ebff, 0x3a3f48, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.15); sun.position.set(-0.5, 1, 0.6); scene.add(sun);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.3, 2.4);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- geometry helpers ----------
function part(geo, col, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  if (rx) geo.rotateX(rx); if (ry) geo.rotateY(ry); if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  const c = Array.isArray(col) ? col : (() => { const k = new THREE.Color(col); return [k.r, k.g, k.b]; })();
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(c, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function wedge(pts, width) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  g.translate(0, 0, -width / 2); g.rotateY(-Math.PI / 2); return g;
}
const WHITE = '#eceef2', GLASS = '#0c0e13', TIRE = '#121418', RIM = '#8d939b', TRIM = '#2a2e35';
const RED = [5, 0.25, 0.22], HEAD = [2.2, 2.3, 2.5];
function wheels(arr, r, x, z, w = 0.26) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    arr.push(part(new THREE.CylinderGeometry(r, r, w, 16), TIRE, sx * x, r, sz * z, 0, 0, Math.PI / 2));
    arr.push(part(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w + 0.02, 10), RIM, sx * x, r, sz * z, 0, 0, Math.PI / 2));
  }
}
function buildModels() {
  const M = [];
  // Model Y
  let b = [], l = [];
  b.push(part(box(1.92, 0.62, 4.6), WHITE, 0, 0.66, 0));
  b.push(part(box(1.86, 0.3, 1.1), WHITE, 0, 1.08, -1.6, 0.18));
  b.push(part(box(1.7, 0.58, 2.6), GLASS, 0, 1.24, 0.3));
  b.push(part(box(1.52, 0.1, 1.8), WHITE, 0, 1.55, 0.35));
  b.push(part(box(1.86, 0.32, 0.75), WHITE, 0, 1.06, 1.95, -0.2));
  b.push(part(box(1.94, 0.18, 4.62), TRIM, 0, 0.42, 0));
  wheels(b, 0.38, 0.93, 1.45);
  l.push(part(box(1.78, 0.08, 0.06), RED, 0, 1.08, 2.32));
  l.push(part(box(1.6, 0.05, 0.05), HEAD, 0, 0.92, -2.32));
  M.push({ body: mergeGeometries(b), lights: mergeGeometries(l), jets: [[-.93, 1.45], [.93, 1.45], [-.93, -1.45], [.93, -1.45]] });
  // Cybertruck
  b = []; l = [];
  b.push(part(wedge([[-2.9, 0.5], [-2.9, 1.08], [-0.6, 1.95], [2.9, 1.36], [2.9, 0.5]], 2.0), WHITE));
  b.push(part(box(2.03, 0.05, 2.36), GLASS, 0, 1.53, -1.75, Math.atan2(0.87, 2.3)));
  b.push(part(box(2.02, 0.3, 2.0), GLASS, 0, 1.36, -0.55));
  b.push(part(box(2.04, 0.2, 5.82), TRIM, 0, 0.5, 0));
  wheels(b, 0.46, 1.0, 1.9, 0.3);
  l.push(part(box(2.0, 0.07, 0.07), RED, 0, 1.3, 2.93));
  l.push(part(box(2.0, 0.05, 0.05), HEAD, 0, 1.05, -2.93));
  M.push({ body: mergeGeometries(b), lights: mergeGeometries(l), jets: [[-1, 1.9], [1, 1.9], [-1, -1.9], [1, -1.9]] });
  // Roadster
  b = []; l = [];
  b.push(part(wedge([[-2.2, 0.28], [-2.2, 0.6], [-0.7, 0.85], [0.4, 1.18], [1.4, 1.05], [2.2, 0.88], [2.2, 0.28]], 1.92), WHITE));
  b.push(part(box(1.45, 0.38, 1.45), GLASS, 0, 1.07, 0.3));
  b.push(part(box(1.96, 0.14, 4.42), TRIM, 0, 0.3, 0));
  wheels(b, 0.35, 0.94, 1.4);
  l.push(part(box(1.82, 0.07, 0.06), RED, 0, 0.82, 2.22));
  l.push(part(box(1.5, 0.05, 0.05), HEAD, 0, 0.6, -2.22));
  M.push({ body: mergeGeometries(b), lights: mergeGeometries(l), jets: [[-.94, 1.4], [.94, 1.4], [-.94, -1.4], [.94, -1.4]] });
  return M;
}
const MODELS = buildModels();
const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.05 });
const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });

// ---------- city grid (FSD style) ----------
const TILE = 100, RW = 10.8;
function buildTile() {
  const L = [], B = [];
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
      B.push(part(box(67, 0.12, 37), '#2e343d', s * 46.5, 0.06, sz * 31.5));
      // traffic lights
      B.push(part(box(0.18, 5.4, 0.18), '#4a5059', s * 12.5, 2.7, sz * 12.5));
      B.push(part(box(0.5, 1.3, 0.5), '#20242a', s * 12.5, 5.6, sz * 12.5));
      L.push(part(box(0.54, 0.34, 0.54), [4, 0.22, 0.2], s * 12.5, 6.0, sz * 12.5));
    }
  }
  line(5.4, 12.6, 10.8, 0.45); line(-5.4, -12.6, 10.8, 0.45);
  for (let x = -9.5; x <= 9.5; x += 1.6) { line(x, 15.5, 0.7, 3); line(x, -15.5, 0.7, 3); }
  return { lines: mergeGeometries(L), blocks: mergeGeometries(B) };
}
const tileGeo = buildTile();
const lineMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const blockMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const tiles = [];
for (let i = 0; i < 5; i++) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(tileGeo.lines, lineMat), new THREE.Mesh(tileGeo.blocks, blockMat));
  scene.add(g); tiles.push(g);
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshBasicMaterial({ color: '#272d37' }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);

// ---------- instanced traffic ----------
const POOL = LOW ? 26 : 34;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const carMeshes = MODELS.map(m => {
  const body = new THREE.InstancedMesh(m.body, bodyMat, POOL);
  const lights = new THREE.InstancedMesh(m.lights, lightMat, POOL);
  lights.instanceMatrix = body.instanceMatrix;
  body.frustumCulled = lights.frustumCulled = false;
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < POOL; i++) body.setMatrixAt(i, ZERO);
  scene.add(body, lights);
  return body;
});
const cars = [];
for (let t = 0; t < 3; t++) for (let i = 0; i < POOL; i++)
  cars.push({ t, i, active: false, ground: false, pos: new THREE.Vector3(), rot: new THREE.Euler(), quat: new THREE.Quaternion(), m: new THREE.Matrix4() });

// thruster jets (instanced, additive, bloomed)
const jetGeo = new THREE.ConeGeometry(0.2, 1, 10, 1, true); jetGeo.rotateX(Math.PI); jetGeo.translate(0, -0.5, 0);
const jetMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uT: { value: 0 } },
  vertexShader: `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);} `,
  fragmentShader: `varying float vY; void main(){ float a = pow(1.0 - vY, 2.2); vec3 c = mix(vec3(0.35,0.55,1.2), vec3(2.6,2.9,3.4), a*a*a); gl_FragColor = vec4(c*a, a); }`
});
const JETS = POOL * 3 * 4 + 4;
const jets = new THREE.InstancedMesh(jetGeo, jetMat, JETS);
jets.frustumCulled = false; jets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(jets);
// jet glow core (bright disc under each jet)
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
   float a = smoothstep(0.5,0.05,r)*vA; if(a<0.004) discard; vec3 c = mix(vec3(0.86,0.92,1.0), vec3(0.62,0.67,0.76), vK); gl_FragColor = vec4(c, a); }`
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
const orbMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.75, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.9, 2.6), wireframe: false }), ORBS);
const orbRing = new THREE.InstancedMesh(new THREE.TorusGeometry(1.25, 0.07, 6, 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.6, 2.2) }), ORBS);
orbMesh.frustumCulled = orbRing.frustumCulled = false;
scene.add(orbMesh, orbRing);
const orbs = Array.from({ length: ORBS }, () => ({ pos: new THREE.Vector3(), ph: Math.random() * 6 }));

// player
const player = new THREE.Group();
player.add(new THREE.Mesh(MODELS[2].body, bodyMat), new THREE.Mesh(MODELS[2].lights, lightMat));
scene.add(player);

// ---------- state ----------
let T = 0, state = 'title', attract = true;
const P = { x: 5.4, y: 0, z: 0, vx: 0, vy: 0, speed: 12, gas: 100, roll: 0, flip: 0, rollV: 0, flipV: 0, bank: 0, air: false, airT: 0, dead: false, deadT: 0, spin: new THREE.Vector3() };
let score = 0, combo = 0, comboT = 0, best = +(localStorage.getItem('zaxis-best') || 0);
let stats = { near: 0, tricks: 0, maxCombo: 0, air: 0 };
let gameT = 0, shake = 0, overT = 0, ticketCD = 0, speedOverT = 0, saidNoLimit = false, lastLandZ = 0, invuln = false;
const input = { steer: 0, throttle: 0, thrust: false, boost: false };
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
  speedOverT = 0; ticketCD = 4; saidNoLimit = false; invuln = att;
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
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
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
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
holdBtn($('bThrust'), 'thrust'); holdBtn($('bBoost'), 'boost');
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
  const maxV = air ? (input.boost && P.gas > 0 ? 52 : 34) : 22;
  const target = air ? lerp(24, maxV, 0.5 + input.throttle * 0.5) : lerp(4, maxV, 0.45 + input.throttle * 0.55);
  P.speed = lerp(P.speed, input.boost && P.gas > 0 && air ? 52 : target, dt * (input.throttle < 0 ? 2.5 : 1.2));
  if (input.boost && P.gas > 0 && air) { P.gas -= 26 * dt; shake = Math.max(shake, 0.12); }
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
  } else {
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
  jetIdx = 0;
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
        if (jetIdx < JETS - 4) jets.setMatrixAt(jetIdx++, jm);
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
  // player jets
  for (let k = jetIdx; k < JETS; k++) jets.setMatrixAt(k, ZERO);
  if ((P.thrusting || (P.air && P.vy > -2)) && !P.dead) {
    player.updateMatrix();
    const jl = MODELS[2].jets, pow = P.thrusting ? 1 : 0.45;
    for (let j = 0; j < 4; j++) {
      const len = (2.6 + Math.random()) * pow * (input.boost && P.air && P.gas > 0 ? 1.4 : 1);
      jo.makeTranslation(jl[j][0], 0.2, jl[j][1]); js.makeScale(1.1, len, 1.1);
      jm.multiplyMatrices(player.matrix, jo).multiply(js); jets.setMatrixAt(JETS - 4 + j, jm);
      if (P.thrusting && Math.random() < 0.7) {
        v3.set(jl[j][0], 0.2 - len * 0.7, jl[j][1]).applyMatrix4(player.matrix);
        emit(v3.x, v3.y, v3.z, rand(-1, 1), -4 + rand(-1, 1), rand(-1, 1) + 2, rand(0.9, 1.5));
      }
    }
  }
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
  renderer.setSize(w, h, false); composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h; camera.fov = w / h < 0.8 ? 72 : 58; camera.updateProjectionMatrix();
  smokeMat.uniforms.uPx.value = h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));
if (window.visualViewport) { visualViewport.addEventListener('resize', resize); visualViewport.addEventListener('scroll', () => window.scrollTo(0, 0)); }
resize();

// ---------- loop ----------
const camPos = new THREE.Vector3(5, 10, 18), camLook = new THREE.Vector3();
let last = performance.now(), fpsAcc = 0, fpsN = 0;
let FR = 0;
function frame(now) { FR++;
  requestAnimationFrame(frame);
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
  // world tiles follow
  const base = Math.round(P.z / TILE);
  tiles.forEach((t, i) => t.position.z = (base - 3 + i) * TILE);
  ground.position.set(P.x, 0, P.z);
  // camera (FSD-style high chase)
  const portrait = camera.aspect < 0.8;
  const back = portrait ? 19 : 12, up = (portrait ? 8 : 5.5) - (P.air ? 2 : 0);
  camPos.lerp(v3.set(P.x * 0.8, P.y + up + (P.air ? 1.5 : 0), P.z + back), Math.min(1, dt * 4));
  camLook.lerp(v3b.set(P.x * 0.85, P.y + (P.air ? 6.5 : 3.5), P.z - 30), Math.min(1, dt * 5));
  camera.position.copy(camPos);
  shake = Math.max(0, shake - dt * 1.6);
  if (shake > 0) camera.position.add(v3.set(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(shake * 0.5));
  camera.lookAt(camLook);
  if (P.air && input.boost && P.gas > 0) camera.fov = lerp(camera.fov, (portrait ? 72 : 58) + 8, dt * 3); else camera.fov = lerp(camera.fov, portrait ? 72 : 58, dt * 3);
  camera.updateProjectionMatrix();
  smokeMat.uniforms.uTime.value = T;
  if (sDirty) { aPos.needsUpdate = aVel.needsUpdate = aBirth.needsUpdate = aSize.needsUpdate = true; sDirty = false; }
  // audio
  if (AC && hissG) {
    const t = AC.currentTime, playing = state === 'play';
    hissG.gain.setTargetAtTime(playing ? (P.thrusting ? 0.22 : P.air ? 0.04 : 0) + (input.boost && P.air ? 0.12 : 0) : 0, t, 0.05);
    whine.frequency.setTargetAtTime(60 + P.speed * 5, t, 0.1); whineG.gain.setTargetAtTime(playing ? 0.025 : 0, t, 0.2);
  }
  updateHUD(dt);
  composer.render();
  // adaptive quality
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 2) { const fps = fpsN / fpsAcc; if (fps < 40 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.25)); resize(); } fpsAcc = 0; fpsN = 0; }
}
resetWorld(true);
// screenshot / test hooks
if (SHOT === 'air') { $('title').classList.remove('show'); state = 'play'; resetWorld(true); state = 'play'; $('touch').classList.add('on'); combo = 7; comboT = 999; score = 18420; gameT = 90; }
if (SHOT === 'over') { $('title').classList.remove('show'); resetWorld(true); state = 'play'; attract = false; invuln = false; score = 23870; stats = { near: 31, tricks: 9, maxCombo: 6, air: 74 }; setTimeout(() => gameOver('MID-AIR COLLISION'), 1500); }
camPos.set(P.x*0.8, P.y+5, P.z+12); camLook.set(P.x, P.y+6, P.z-30);
window.__forceOver = () => { if (state !== 'play') startGame(); score = 12345; stats.near = 12; gameOver('MID-AIR COLLISION'); };
window.__zaxis = { get state() { return state; }, get score() { return score; } };
requestAnimationFrame(frame);
