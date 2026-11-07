// Gunmate client: three.js board, first-person capture duels, lobby and HUD.
// Online play talks to the Fly server over /ws; practice runs the same Room referee inside the page.
(function () {
'use strict';
const T = THREE, R = Rules, G = GRoom, ARMS = G.ARMS, SQ = G.S;
const $ = id => document.getElementById(id);
const TEST = /[?&]test\b/.test(location.search);
const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const PNAME = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
const store = {
  get(k, d) { try { const v = localStorage.getItem('gunmate.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('gunmate.' + k, JSON.stringify(v)); } catch (e) {} }
};
const prefs = Object.assign({ sens: 1, vol: 0.7, gfx: 'auto', name: '', seenHelp: false }, store.get('prefs', {}));
const savePrefs = () => store.set('prefs', prefs);

// ---------------- renderer and scene ----------------
const canvas = $('gl');
T.ColorManagement.legacyMode = false;
const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputEncoding = T.sRGBEncoding;
renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = prefs.gfx !== 'low'; renderer.shadowMap.type = T.PCFSoftShadowMap;
const scene = new T.Scene();
const HAZE = new T.Color('#C9A27A');
scene.fog = new T.Fog(HAZE, 60, 190);
const camera = new T.PerspectiveCamera(55, 1, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);
let W = 1, H = 1, lowGfx = prefs.gfx === 'low', slowT = 0;
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowGfx ? 1 : 2));
  renderer.setSize(W, H, false);
  camera.aspect = W / H; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();
function watchFrameRate(dt) {
  if (lowGfx || prefs.gfx !== 'auto' || TEST || document.hidden) return;
  slowT = dt > 0.03 ? slowT + dt : Math.max(0, slowT - dt * 0.5);
  if (slowT > 3) setLow(true);
}
function setLow(on) {
  lowGfx = on; renderer.shadowMap.enabled = !on;
  scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  resize();
}

// golden-hour sky
const SUN_DIR = new T.Vector3(-0.62, 0.36, -0.7).normalize();
const sky = new T.Mesh(new T.SphereGeometry(300, 32, 16), new T.ShaderMaterial({
  side: T.BackSide, depthWrite: false, fog: false, uniforms: { sun: { value: SUN_DIR } },
  vertexShader: 'varying vec3 vd; void main(){ vd = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `varying vec3 vd; uniform vec3 sun;
    void main(){ float h = clamp(vd.y, -0.1, 1.0);
      vec3 top = vec3(0.22,0.33,0.48), mid = vec3(0.72,0.56,0.46), hor = vec3(0.94,0.72,0.46);
      vec3 c = mix(hor, mid, smoothstep(0.0, 0.2, h)); c = mix(c, top, smoothstep(0.16, 0.75, h));
      float s = max(dot(normalize(vd), sun), 0.0);
      c += vec3(1.0,0.85,0.6) * (pow(s, 700.0) * 3.0 + pow(s, 10.0) * 0.4);
      gl_FragColor = vec4(c, 1.0); }`
}));
scene.add(sky);
{
  const pm = new T.PMREMGenerator(renderer), es = new T.Scene(); es.add(sky.clone());
  const g = new T.Mesh(new T.PlaneGeometry(600, 600), new T.MeshBasicMaterial({ color: '#8E7050' })); g.rotation.x = -Math.PI / 2; g.position.y = -1; es.add(g);
  scene.environment = pm.fromScene(es, 0.04).texture;
}
scene.add(new T.HemisphereLight('#A9BCD6', '#7A5C3E', 0.6));
const sun = new T.DirectionalLight('#FFD39A', 2.5);
sun.position.copy(SUN_DIR).multiplyScalar(60); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 10, far: 130 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun);

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
  if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep, rep); }
  return t;
}
// ground: dusty flagstone plaza fading into sand
const sandTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#C3A272'; g.fillRect(0, 0, w, h); const r = rng(11);
  for (let i = 0; i < 9000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(120,90,58,0.18)' : 'rgba(240,215,170,0.16)'; g.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5); }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(130,100,66,0.08)'; g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 50, 10 + r() * 30, r() * 3, 0, 6.29); g.fill(); }
}, 18);
const ground = new T.Mesh(new T.CircleGeometry(220, 48), new T.MeshStandardMaterial({ map: sandTex, roughness: 0.97, color: '#E8D2AE' }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.9; ground.receiveShadow = true; scene.add(ground);

// board tiles: polished sandstone and walnut, with a bronze-trimmed frame
const BOARD_H = 0.9;
function tileTex(light, seed) {
  return canvasTex(128, 128, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = light ? '#E2CDA2' : '#5E3F28'; g.fillRect(0, 0, w, h);
    if (light) for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(150,110,70,${0.06 + r() * 0.1})`; g.lineWidth = 0.6 + r() * 1.6; g.beginPath(); g.moveTo(r() * w, 0); g.bezierCurveTo(r() * w, h * 0.3, r() * w, h * 0.7, r() * w, h); g.stroke(); }
    else for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(${30 + r() * 20},${18 + r() * 10},10,0.4)`; g.lineWidth = 1 + r() * 2; const y = r() * h; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 6 - r() * 12, w * 0.6, y - 6 + r() * 12, w, y); g.stroke(); }
    g.strokeStyle = 'rgba(28,23,20,0.35)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  });
}
const tileMat = [
  new T.MeshStandardMaterial({ map: tileTex(false, 3), roughness: 0.55, metalness: 0.0 }),
  new T.MeshStandardMaterial({ map: tileTex(true, 9), roughness: 0.6, metalness: 0.0 })
];
const tileGeo = new T.BoxGeometry(SQ, BOARD_H, SQ);
const board = new T.Group(); scene.add(board);
for (let s = 0; s < 64; s++) {
  const p = G.sqPos(s), light = ((s & 7) + (s >> 3)) & 1;
  const m = new T.Mesh(tileGeo, tileMat[light]); m.position.set(p.x, -BOARD_H / 2, p.z); m.receiveShadow = true; board.add(m);
}
const bronze = new T.MeshStandardMaterial({ color: '#B0803A', metalness: 0.9, roughness: 0.35 });
const frameWood = new T.MeshStandardMaterial({ color: '#4A3020', roughness: 0.7 });
{
  const L = 8 * SQ, F = 2.2;
  for (const [x, z, w, d] of [[0, -(L / 2 + F / 2), L + 2 * F, F], [0, L / 2 + F / 2, L + 2 * F, F], [-(L / 2 + F / 2), 0, F, L], [L / 2 + F / 2, 0, F, L]]) {
    const m = new T.Mesh(new T.BoxGeometry(w, BOARD_H + 0.3, d), frameWood); m.position.set(x, -BOARD_H / 2 - 0.15 + 0.15, z); m.receiveShadow = m.castShadow = true; board.add(m);
    const t = new T.Mesh(new T.BoxGeometry(w + 0.02, 0.12, d + 0.02), bronze); t.position.set(x, 0.12, z); board.add(t);
  }
  // file and rank letters on the frame
  const lab = (txt, x, z, rot) => {
    const tex = canvasTex(64, 64, (g, w, h) => { g.font = 'bold 44px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#F1E4CA'; g.fillText(txt, w / 2, h / 2 + 2); });
    const m = new T.Mesh(new T.PlaneGeometry(1.5, 1.5), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set(x, 0.19, z); board.add(m); return m;
  };
  for (let i = 0; i < 8; i++) {
    const p = G.sqPos(i);
    lab('abcdefgh'[i], p.x, L / 2 + F / 2, 0); lab('abcdefgh'[i], p.x, -(L / 2 + F / 2), Math.PI);
    const q = G.sqPos(i * 8);
    lab(String(i + 1), -(L / 2 + F / 2), q.z, 0); lab(String(i + 1), L / 2 + F / 2, q.z, Math.PI);
  }
}
// plaza dressing: a ring of stone pillars with banners, and far mesas
{
  const stone = new T.MeshStandardMaterial({ color: '#B59C7A', roughness: 0.9 });
  const banner = [new T.MeshStandardMaterial({ color: '#A9312B', roughness: 0.8, side: T.DoubleSide }), new T.MeshStandardMaterial({ color: '#2E4E7C', roughness: 0.8, side: T.DoubleSide })];
  const pg = new T.CylinderGeometry(0.9, 1.1, 9, 10), cg = new T.BoxGeometry(2.6, 0.6, 2.6), bg = new T.PlaneGeometry(1.6, 4.2);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.26, x = Math.cos(a) * 36, z = Math.sin(a) * 36;
    const p = new T.Mesh(pg, stone); p.position.set(x, 3.6, z); p.castShadow = true; scene.add(p);
    const c = new T.Mesh(cg, stone); c.position.set(x, 8.3, z); scene.add(c);
    const b = new T.Mesh(bg, banner[i & 1]); b.position.set(x * 0.97, 5.2, z * 0.97); b.lookAt(0, 5.2, 0); scene.add(b);
  }
  const mesa = new T.MeshStandardMaterial({ color: '#A57A55', roughness: 1 });
  const r = rng(4);
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2, d = 120 + r() * 70, s = 12 + r() * 22;
    const m = new T.Mesh(new T.CylinderGeometry(s * 0.7, s, s * (0.5 + r() * 0.5), 7), mesa); m.position.set(Math.cos(a) * d, s * 0.2, Math.sin(a) * d); scene.add(m);
  }
}

// ---------------- pieces ----------------
const MAT = {
  w: { body: new T.MeshStandardMaterial({ color: '#EADCBE', roughness: 0.42, metalness: 0.0 }), trim: new T.MeshStandardMaterial({ color: '#D7A441', metalness: 1, roughness: 0.3 }),
    eye: new T.MeshStandardMaterial({ color: '#3A2A10', emissive: '#FFC35A', emissiveIntensity: 1.6 }) },
  b: { body: new T.MeshStandardMaterial({ color: '#2B2421', roughness: 0.3, metalness: 0.1 }), trim: new T.MeshStandardMaterial({ color: '#B4483A', metalness: 0.85, roughness: 0.35 }),
    eye: new T.MeshStandardMaterial({ color: '#300', emissive: '#FF4A2E', emissiveIntensity: 1.8 }) }
};
const gunMetal = new T.MeshStandardMaterial({ color: '#41464C', metalness: 0.9, roughness: 0.4 });
const gunWood = new T.MeshStandardMaterial({ color: '#7A5233', roughness: 0.7 });
// normalised lathe profiles: [radius fraction, height fraction]
const PROF = {
  p: [[1, 0], [1, .06], [.9, .1], [.95, .13], [.62, .2], [.4, .32], [.32, .55], [.62, .6], [.62, .63], [.3, .66], [0, .66]],
  n: [[1, 0], [1, .06], [.9, .1], [.95, .13], [.7, .2], [.62, .3], [.7, .33], [0, .33]],
  b: [[1, 0], [1, .05], [.88, .09], [.92, .12], [.6, .18], [.36, .3], [.28, .55], [.58, .6], [.58, .63], [.38, .66], [.5, .74], [.46, .84], [.3, .93], [.1, .98], [0, 1]],
  r: [[1, 0], [1, .06], [.9, .1], [.95, .13], [.75, .2], [.62, .3], [.6, .7], [.82, .74], [.82, .9], [0, .9]],
  q: [[1, 0], [1, .05], [.88, .09], [.92, .12], [.6, .18], [.36, .3], [.27, .6], [.55, .64], [.55, .67], [.34, .7], [.42, .76], [.62, .88], [.5, .9], [.2, .91], [0, .93]],
  k: [[1, 0], [1, .05], [.88, .09], [.92, .12], [.6, .18], [.37, .3], [.29, .6], [.56, .64], [.56, .67], [.36, .7], [.44, .76], [.56, .86], [.3, .88], [0, .88]]
};
const geoCache = {};
function lathe(t) {
  if (geoCache[t]) return geoCache[t];
  const A = ARMS[t];
  const pts = PROF[t].map(([r, y]) => new T.Vector2(Math.max(0.001, r * A.r), y * A.h));
  return (geoCache[t] = new T.LatheGeometry(pts, 28));
}
// original horse-head silhouette for the knight
function knightHead() {
  if (geoCache.nh) return geoCache.nh;
  const s = new T.Shape();
  const P = [[-.42, 0], [.38, 0], [.36, .25], [.22, .55], [.3, .78], [.62, .9], [.78, 1.02], [.72, 1.18], [.4, 1.3], [.2, 1.42], [.12, 1.56], [.02, 1.44], [-.2, 1.38], [-.42, 1.15], [-.5, .8], [-.52, .4]];
  s.moveTo(P[0][0], P[0][1]); for (const [x, y] of P.slice(1)) s.lineTo(x, y); s.closePath();
  const g = new T.ExtrudeGeometry(s, { depth: 0.62, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
  g.translate(0, 0, -0.31); g.rotateY(Math.PI / 2); // face -z
  return (geoCache.nh = g);
}
function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
// each arm, built from boxes and cylinders, pointing down -z
function buildGun(t) {
  const g = new T.Group();
  const cyl = (r, l, mat, x, y, z) => { const m = mesh(new T.CylinderGeometry(r, r, l, 10), mat, x, y, z); m.rotation.x = Math.PI / 2; g.add(m); return m; };
  const box = (w, h, d, mat, x, y, z) => { const m = mesh(new T.BoxGeometry(w, h, d), mat, x, y, z); g.add(m); return m; };
  if (t === 'p') { box(.12, .16, .7, gunMetal, 0, 0, -.1); cyl(.035, .5, gunMetal, 0, .03, -.65); box(.1, .14, .4, gunWood, 0, -.03, .35); box(.06, .2, .08, gunMetal, 0, -.15, -.05); }
  if (t === 'n') { box(.16, .15, .55, gunMetal, 0, 0, 0); cyl(.045, .75, gunMetal, -.045, .03, -.6); cyl(.045, .75, gunMetal, .045, .03, -.6); box(.12, .18, .45, gunWood, 0, -.04, .45); }
  if (t === 'b') { box(.1, .14, .9, gunWood, 0, 0, .05); cyl(.03, 1.0, gunMetal, 0, .04, -.85); cyl(.05, .38, gunMetal, 0, .16, -.05); box(.04, .08, .06, gunMetal, 0, .1, -.05); }
  if (t === 'r') { box(.24, .22, .6, gunMetal, 0, 0, 0); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cyl(.03, .7, gunMetal, Math.cos(a) * .08, .02 + Math.sin(a) * .08, -.6); } cyl(.15, .2, MAT.w.trim, 0, -.16, 0.05).rotation.set(0, 0, Math.PI / 2); box(.1, .1, .3, gunWood, 0, -.02, .42); }
  if (t === 'q') { box(.13, .17, .75, gunMetal, 0, 0, -.05); cyl(.035, .45, gunMetal, 0, .03, -.62); box(.08, .24, .12, gunMetal, 0, -.18, -.12).rotation.x = .25; box(.1, .14, .35, gunWood, 0, -.02, .42); box(.05, .06, .18, MAT.w.trim, 0, .12, -.1); }
  if (t === 'k') { box(.1, .14, .3, gunMetal, 0, 0, 0); cyl(.075, .16, MAT.w.trim, 0, .0, -.05); cyl(.035, .38, gunMetal, 0, .03, -.32); box(.08, .2, .1, gunWood, 0, -.15, .12).rotation.x = -.35; }
  g.userData.muzzle = new T.Vector3(0, .03, t === 'b' ? -1.35 : t === 'n' ? -1.0 : t === 'k' ? -0.52 : t === 'r' ? -.95 : -.88);
  return g;
}
function buildPiece(ch) {
  const c = R.colorOf(ch), t = R.typeOf(ch), A = ARMS[t], M = MAT[c];
  const root = new T.Group(), body = new T.Group(); root.add(body);
  body.add(mesh(lathe(t), M.body));
  const band = (y, r) => { const m = mesh(new T.TorusGeometry(r, 0.04, 6, 28), M.trim, 0, y); m.rotation.x = Math.PI / 2; body.add(m); };
  band(A.h * 0.12, A.r * 0.93);
  // visor: a glowing slit across the face
  const visor = (y, r, arc = 1.9) => { const v = new T.Mesh(new T.CylinderGeometry(r, r, 0.13, 20, 1, true, Math.PI - arc / 2, arc), M.eye); v.position.y = y; body.add(v); };
  if (t === 'p') { body.add(mesh(new T.SphereGeometry(A.h * 0.17, 20, 14), M.body, 0, A.h * 0.8)); visor(A.h * 0.8, A.h * 0.172); }
  if (t === 'n') { const hd = mesh(knightHead(), M.body, 0, A.h * 0.31); hd.scale.setScalar(A.h * 0.42); body.add(hd); for (const sx of [-1, 1]) { const e = new T.Mesh(new T.BoxGeometry(0.06, 0.08, 0.26), M.eye); e.position.set(sx * 0.3, A.h * 0.81, -0.12); body.add(e); } }
  if (t === 'b') { visor(A.h * 0.79, A.r * 0.47); const n = new T.Mesh(new T.BoxGeometry(0.05, 0.45, A.r * 0.9), M.trim); n.position.set(0, A.h * 0.88, 0); n.rotation.x = 0.5; body.add(n); body.add(mesh(new T.SphereGeometry(0.11, 10, 8), M.trim, 0, A.h + 0.05)); }
  if (t === 'r') { visor(A.h * 0.8, A.r * 0.83, 2.2); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; body.add(mesh(new T.BoxGeometry(0.34, 0.32, 0.34), M.body, Math.cos(a) * A.r * 0.68, A.h * 0.9 + 0.16, Math.sin(a) * A.r * 0.68)); } }
  if (t === 'q') { visor(A.h * 0.8, A.r * 0.5); for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; body.add(mesh(new T.SphereGeometry(0.09, 8, 6), M.trim, Math.cos(a) * A.r * 0.6, A.h * 0.89, Math.sin(a) * A.r * 0.6)); } body.add(mesh(new T.SphereGeometry(0.17, 12, 10), M.trim, 0, A.h * 0.97)); }
  if (t === 'k') { visor(A.h * 0.79, A.r * 0.5); body.add(mesh(new T.BoxGeometry(0.16, 0.62, 0.16), M.trim, 0, A.h * 0.88 + 0.31)); body.add(mesh(new T.BoxGeometry(0.46, 0.15, 0.16), M.trim, 0, A.h * 0.88 + 0.4)); }
  const gun = buildGun(t); gun.position.set(A.r * 0.95 + 0.12, A.h * 0.52, -0.2); gun.scale.setScalar(1.25); body.add(gun);
  root.userData = { ch, c, t, gun };
  return root;
}

// pieces on the board: square -> object
let objs = [];       // {g, ch, sq, anim, topple}
let boardSeq = -1;
function clearPieces() { for (const o of objs) scene.remove(o.g); objs = []; }
function placeAll(fen) {
  clearPieces();
  const st = R.fromFEN(fen);
  for (let s = 0; s < 64; s++) if (st.b[s]) addObj(st.b[s], s);
}
function addObj(ch, s, rise) {
  const g = buildPiece(ch), p = G.sqPos(s); g.position.set(p.x, rise ? -3 : 0, p.z);
  g.rotation.y = R.colorOf(ch) === 'w' ? 0 : Math.PI;
  scene.add(g);
  const o = { g, ch, sq: s, anim: rise ? { fx: p.x, fz: p.z, fy: -3, t: 0, dur: 0.6 } : null };
  objs.push(o); return o;
}
function objAt(s) { return objs.find(o => o.sq === s && !o.dead); }
function reconcile(fen, last) {
  const st = R.fromFEN(fen);
  const left = objs.filter(o => !o.dead), keep = new Set();
  const need = [];
  for (let s = 0; s < 64; s++) {
    if (!st.b[s]) continue;
    const o = left.find(o => o.sq === s && o.ch === st.b[s] && !keep.has(o));
    if (o) keep.add(o); else need.push(s);
  }
  for (const s of need) {
    const ch = st.b[s], to = G.sqPos(s);
    let best = null, bd = 1e9;
    for (const o of left) {
      if (keep.has(o) || o.ch !== ch || st.b[o.sq] === ch) continue;
      const d = Math.hypot(o.g.position.x - to.x, o.g.position.z - to.z) - (last && o.sq === last.from ? 100 : 0);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) { keep.add(best); moveObj(best, s); }
    else keep.add(addObj(ch, s, true));
  }
  for (const o of left) if (!keep.has(o)) killObj(o);
  // anything nudged during a duel walks home
  for (const o of keep) {
    const p = G.sqPos(o.sq);
    if (!o.anim && (Math.hypot(o.g.position.x - p.x, o.g.position.z - p.z) > 0.05 || Math.abs(o.g.position.y) > 0.05)) moveObj(o, o.sq);
    o.g.visible = true;
    const yaw = R.colorOf(o.ch) === 'w' ? 0 : Math.PI; o.yawTo = yaw;
  }
}
function moveObj(o, s) {
  const p = o.g.position;
  o.anim = { fx: p.x, fz: p.z, fy: p.y, t: 0, dur: 0.5, hop: R.typeOf(o.ch) === 'n' };
  o.sq = s;
}
function killObj(o) { if (!o.topple) o.topple = { t: 0, ax: Math.random() < 0.5 ? 1 : -1 }; o.dead = true; }
function updateObjs(dt) {
  for (const o of objs) {
    if (o.anim) {
      const a = o.anim; a.t += dt / a.dur; const k = Math.min(1, a.t), e = k * k * (3 - 2 * k), p = G.sqPos(o.sq);
      o.g.position.set(a.fx + (p.x - a.fx) * e, a.fy * (1 - e) + (a.hop ? Math.sin(k * Math.PI) * 3 : Math.sin(k * Math.PI) * 0.4), a.fz + (p.z - a.fz) * e);
      if (k >= 1) { o.anim = null; o.g.position.y = 0; sfx.clack(o.g.position); }
    }
    if (o.yawTo !== undefined && !o.duel) {
      let d = o.yawTo - o.g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      o.g.rotation.y += d * Math.min(1, dt * 6);
    }
    if (o.topple) {
      const tp = o.topple; tp.t += dt;
      o.g.children[0].rotation.x = Math.min(Math.PI / 2, tp.t * tp.t * 5) * tp.ax;
      if (tp.t > 1.2) o.g.position.y -= dt * 3;
      if (tp.t > 2.4) { scene.remove(o.g); o.gone = true; }
    }
  }
  objs = objs.filter(o => !o.gone);
}

// highlights
const markGeo = new T.CircleGeometry(0.55, 24), ringGeo = new T.RingGeometry(1.35, 1.75, 32), sqGeo = new T.PlaneGeometry(SQ * 0.98, SQ * 0.98);
const mk = (geo, color, op) => { const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 2; scene.add(m); return m; };
const dots = [], rings = [];
for (let s = 0; s < 64; s++) { dots.push(mk(markGeo, '#F2CF7E', 0.85)); rings.push(mk(ringGeo, '#E4685E', 0.9)); }
const hlFrom = mk(sqGeo, '#D7A441', 0.32), hlTo = mk(sqGeo, '#D7A441', 0.42), hlSel = mk(sqGeo, '#F6E2A8', 0.45), hlHover = mk(sqGeo, '#FFFFFF', 0.14), hlCheck = mk(sqGeo, '#E0402F', 0.55);
const putSq = (m, s, y = 0.02) => { if (s < 0 || s === undefined || s === null) { m.visible = false; return; } const p = G.sqPos(s); m.position.set(p.x, y, p.z); m.visible = true; };

// ---------------- sound (all synthesised) ----------------
const sfx = (() => {
  let ac = null, master = null, noise = null;
  const init = () => {
    if (ac) return; try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ac.createGain(); master.gain.value = prefs.vol; master.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  };
  const vol = pos => { if (!pos) return 1; const d = camera.position.distanceTo(pos); return Math.max(0.12, Math.min(1, 14 / (d + 6))); };
  function burst(v, dur, f, q, type = 'lowpass', f2) {
    if (!ac) return; const t = ac.currentTime;
    const s = ac.createBufferSource(); s.buffer = noise; s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
    const g = ac.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  function tone(v, dur, f, type = 'sine', f2, delay = 0) {
    if (!ac) return; const t = ac.currentTime + delay;
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  const GUN = {
    p: v => { burst(0.5 * v, 0.18, 2600, 0.8, 'lowpass', 400); tone(0.4 * v, 0.12, 140, 'sine', 50); },
    n: v => { burst(0.8 * v, 0.45, 1800, 0.6, 'lowpass', 200); tone(0.6 * v, 0.25, 90, 'sine', 35); },
    b: v => { burst(0.6 * v, 0.6, 5000, 0.5, 'lowpass', 300); burst(0.3 * v, 0.05, 6000, 1, 'highpass'); tone(0.5 * v, 0.3, 110, 'sine', 40); },
    r: v => { burst(0.35 * v, 0.09, 2200, 0.9, 'lowpass', 600); tone(0.25 * v, 0.06, 120, 'square', 60); },
    q: v => { burst(0.42 * v, 0.13, 3000, 0.8, 'lowpass', 500); tone(0.3 * v, 0.09, 150, 'sine', 55); },
    k: v => { burst(0.7 * v, 0.35, 2000, 0.7, 'lowpass', 250); tone(0.55 * v, 0.2, 100, 'sine', 40); }
  };
  return {
    init, setVol(v) { if (master) master.gain.value = v; },
    gun(t, pos) { init(); GUN[t] && GUN[t](vol(pos)); },
    clack(pos) { init(); burst(0.5 * vol(pos), 0.06, 1500, 3, 'bandpass'); tone(0.3 * vol(pos), 0.08, 420, 'triangle', 300); },
    hit(head) { tone(0.35, 0.08, head ? 1500 : 1100, 'square', head ? 1900 : 900); },
    hurt() { burst(0.6, 0.2, 500, 1, 'lowpass'); tone(0.4, 0.18, 120, 'sawtooth', 60); },
    ricochet(pos) { tone(0.08 * vol(pos), 0.15, 2500 + Math.random() * 2000, 'sine', 900); },
    bell() { init(); tone(0.3, 1.2, 880); tone(0.18, 1.2, 1320); tone(0.1, 1.4, 1760); },
    drum() { init(); for (let i = 0; i < 3; i++) { tone(0.6, 0.35, 70, 'sine', 40, i * 0.18); burst(0.3, 0.15, 900, 1, 'lowpass', 200); } tone(0.25, 0.9, 220, 'sawtooth', 440, 0.5); },
    go() { init(); tone(0.35, 0.5, 440, 'square', 880); tone(0.25, 0.6, 660, 'triangle'); },
    tick() { init(); tone(0.2, 0.05, 900, 'square'); },
    topple() { init(); burst(0.6, 0.8, 600, 0.7, 'lowpass', 80); tone(0.5, 0.6, 90, 'sine', 30); },
    win() { init(); [523, 659, 784, 1046].forEach((f, i) => tone(0.25, 0.7, f, 'triangle', null, i * 0.12)); },
    lose() { init(); [392, 349, 311, 262].forEach((f, i) => tone(0.22, 0.6, f, 'triangle', null, i * 0.16)); },
    jump() { init(); burst(0.15, 0.12, 700, 1, 'lowpass'); },
    land() { burst(0.2, 0.1, 400, 1, 'lowpass'); }
  };
})();
['pointerdown', 'keydown'].forEach(e => window.addEventListener(e, () => sfx.init(), { once: false, passive: true }));

// ---------------- UI helpers ----------------
function setTitle() {
  const word = 'GUNMATE', el = $('logo'); el.innerHTML = '';
  [...word].forEach((ch, i) => {
    const s = document.createElement('span'); s.textContent = ch; s.dataset.c = ch;
    s.style.setProperty('--r', ((i * 37) % 9 - 4) * 0.9 + 'deg'); s.style.setProperty('--y', ((i * 53) % 7 - 3) + 'px'); s.style.setProperty('--i', i);
    if (i >= 3) s.className = 'c';
    el.appendChild(s);
  });
}
setTitle();
let toastT = 0;
function toast(text, ms = 2600) { const t = $('toast'); t.textContent = text; t.classList.remove('hide'); t.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.classList.add('hide'), 300); }, ms); }
let bannerT = 0;
function banner(big, small, ms = 2200) {
  const b = $('banner'); b.innerHTML = ''; b.append(big); if (small) { const s = document.createElement('small'); s.textContent = small; b.append(s); }
  b.classList.remove('hide', 'pop'); void b.offsetWidth; b.classList.add('pop');
  clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.add('hide'), ms);
}
function show(id, on) { $(id).classList.toggle('hide', !on); }
function screen(which) { for (const id of ['menu', 'lobby', 'hud', 'duel']) show(id, id === which); }
const cleanName = s => String(s || '').replace(/[^\w \-'.]/g, '').trim().slice(0, 16);
$('name').value = prefs.name || '';
$('name').addEventListener('change', () => { prefs.name = cleanName($('name').value); $('name').value = prefs.name; savePrefs(); });
const myName = () => cleanName($('name').value) || 'Player';

// ---------------- connection: online socket or local practice room ----------------
let net = null;            // {send, close, solo}
let netRtt = 0, pingFn = null;
setInterval(() => { if (net && !net.solo && pingFn) pingFn(); }, 1500);
let me = null, roomInfo = null, S = null, Sat = 0, myToken = null;
try { myToken = sessionStorage.getItem('gunmate.token'); if (!myToken) { myToken = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('gunmate.token', myToken); } } catch (e) { myToken = Math.random().toString(36).slice(2); }
const SERVER = (new URLSearchParams(location.search)).get('server') || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');

function connect(first) {
  if (net && !net.solo) net.close(true);
  let ws, closedByUs = false, retry = 0, pending = [first];
  const open = () => {
    try { ws = new WebSocket(SERVER); } catch (e) { toast('Could not reach the server.'); return; }
    ws.onopen = () => { retry = 0; for (const m of pending) ws.send(JSON.stringify(m)); pending = []; ping(); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (er) { return; } onMsg(m); };
    ws.onclose = () => {
      if (closedByUs) return;
      if (roomInfo && retry < 30) { retry++; toast('Connection lost. Reconnecting…', 2500); pending = [{ t: 'join', code: roomInfo.code, name: myName(), token: myToken }]; setTimeout(open, Math.min(4000, 500 * retry)); }
      else if (!roomInfo) toast('Could not reach the server. Try again in a moment.');
    };
  };
  const ping = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', at: performance.now() })); };
  pingFn = ping;
  open();
  net = {
    solo: false,
    send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); },
    close(silent) { closedByUs = true; try { ws.close(); } catch (e) {} }
  };
}
// practice: the same referee runs here, a bot takes the other seat
let bot = null;
function startSolo(level, colour) {
  if (net && !net.solo) net.close(true);
  const room = new G.Room('PRACTICE');
  const deliver = m => setTimeout(() => onMsg(m), 0);
  bot = { level, room, seat: null, pending: null, duel: null };
  room.add('me', myName(), deliver, 'me');
  room.add('bot', ['Recruit', 'Veteran', 'Warlord'][level - 1] + ' bot', m => botMsg(m), 'bot');
  if (colour === 'r') colour = Math.random() < 0.5 ? 'w' : 'b';
  if (colour === 'b') room.handle('me', { t: 'swap' });
  room.handle('me', { t: 'settings', s: { clock: 0, inc: 0, duels: true } });
  netRtt = 0;
  net = { solo: true, send(m) { room.handle('me', m); }, close() { for (const k in room.timers) room.cancel(room.timers[k]); bot = null; } };
  room.handle('me', { t: 'start' });
}
function botMsg(m) {
  if (!bot) return;
  if (m.t === 'room') { const p = m.players.find(p => p.id === 'bot'); bot.seat = p && p.seat; }
  if (m.t === 'state') {
    bot.state = m;
    if (m.phase === 'play' && m.turn === bot.seat) {
      const key = m.fen; if (bot.pending === key) return; bot.pending = key;
      setTimeout(() => {
        if (!bot || !bot.state || bot.state.fen !== key || bot.state.phase !== 'play') return;
        const st = R.fromFEN(key); const mv = R.botMove(st, bot.level);
        if (mv) bot.room.handle('bot', { t: 'move', from: mv.from, to: mv.to, promo: mv.promo });
      }, TEST ? 50 : 700 + Math.random() * 900);
    }
    if (m.phase === 'over' && !bot.rematchAsked) { bot.rematchAsked = true; }
    if (m.phase !== 'over') bot.rematchAsked = false;
  }
}

// ---------------- messages ----------------
function seatName(c) { if (!roomInfo) return c === 'w' ? 'White' : 'Black'; const p = roomInfo.players.find(p => p.seat === c); return p ? p.name : (c === 'w' ? 'White' : 'Black'); }
function mySeat() { if (!roomInfo) return null; const p = roomInfo.players.find(p => p.id === me); return p ? p.seat : null; }
function onMsg(m) {
  switch (m.t) {
    case 'room': {
      roomInfo = m; me = m.you || me;
      if (!net.solo) { try { history.replaceState(null, '', '?room=' + m.code); } catch (e) {} }
      if (m.phase === 'lobby') { screen('lobby'); drawLobby(); }
      else if (m.phase === 'over') drawLobby();
      drawCards();
      break;
    }
    case 'state': onState(m); break;
    case 'error': toast(m.text); if (m.code === 'noroom') { try { history.replaceState(null, '', location.pathname); } catch (e) {} } break;
    case 'pong': { const r = performance.now() - m.at; netRtt = netRtt ? netRtt * 0.6 + r * 0.4 : r; if (net && !net.solo) net.send({ t: 'rtt', ms: Math.round(netRtt) }); break; }
    case 'p': onRemotePos(m); break;
    case 'shot': onRemoteShot(m); break;
    case 'hp': onHp(m); break;
    case 'duelEnd': onDuelEnd(m); break;
    case 'chat': addChat(m); break;
  }
}
function drawLobby() {
  if (!roomInfo) return;
  const info = roomInfo, host = info.host === me, seat = mySeat();
  $('lCode').textContent = info.code;
  for (const c of ['w', 'b']) {
    const p = info.players.find(p => p.seat === c);
    $(c === 'w' ? 'sW' : 'sB').textContent = p ? p.name + (p.id === me ? ' (you)' : '') + (p.on ? '' : ' …') : 'empty';
    const b = $(c === 'w' ? 'bSitW' : 'bSitB'); b.classList.toggle('hide', !!p && p.id !== me);
    b.textContent = p && p.id === me ? 'Stand up' : 'Sit here';
  }
  const specs = info.players.filter(p => !p.seat).map(p => p.name + (p.id === me ? ' (you)' : ''));
  $('lSpecs').textContent = specs.length ? 'Watching: ' + specs.join(', ') : '';
  $('sClock').value = info.settings.clock; $('sInc').value = info.settings.inc; $('sDuel').value = info.settings.duels ? '1' : '0';
  for (const id of ['sClock', 'sInc', 'sDuel']) $(id).disabled = !host;
  const both = info.players.some(p => p.seat === 'w') && info.players.some(p => p.seat === 'b');
  $('bStart').classList.toggle('hide', !host); $('bSwap').classList.toggle('hide', !host);
  $('bStart').disabled = !both;
  $('lNote').textContent = !both ? 'Waiting for a second player. Send them the link.' : host ? '' : 'Waiting for the host to start.';
  void seat;
}
$('bSitW').onclick = () => net.send({ t: 'sit', c: mySeat() === 'w' ? null : 'w' });
$('bSitB').onclick = () => net.send({ t: 'sit', c: mySeat() === 'b' ? null : 'b' });
const sendSettings = () => net.send({ t: 'settings', s: { clock: +$('sClock').value, inc: +$('sInc').value, duels: $('sDuel').value === '1' } });
for (const id of ['sClock', 'sInc', 'sDuel']) $(id).onchange = sendSettings;
$('bStart').onclick = () => net.send({ t: 'start' });
$('bSwap').onclick = () => net.send({ t: 'swap' });
$('bLeave').onclick = $('bBack').onclick = () => leaveTable();
$('bCopy').onclick = () => {
  const url = location.origin + location.pathname + '?room=' + roomInfo.code;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Invite link copied.'), () => toast(url, 6000));
};
function leaveTable() {
  if (net) net.close(); net = null; roomInfo = null; S = null; exitDuel(true);
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  clearPieces(); placeAll(R.START); boardSeq = -1; screen('menu'); camMode = 'menu';
}
$('bCreate').onclick = () => { prefs.name = myName(); savePrefs(); connect({ t: 'create', name: myName(), token: myToken }); };
$('bJoin').onclick = () => { const code = $('joinCode').value.trim().toUpperCase(); if (code.length < 4) { toast('Type the 5-letter table code.'); return; } prefs.name = myName(); savePrefs(); connect({ t: 'join', code, name: myName(), token: myToken }); };
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('bJoin').click(); });
$('bSolo').onclick = () => { prefs.name = myName(); savePrefs(); startSolo(+$('botLv').value, $('botCol').value); };
$('bHelp').onclick = () => show('help', true); $('bHelpX').onclick = () => { show('help', false); prefs.seenHelp = true; savePrefs(); };
$('bSet').onclick = () => { $('sens').value = prefs.sens; $('vol').value = prefs.vol; $('gfx').value = prefs.gfx; show('settings', true); };
$('bSetX').onclick = () => show('settings', false);
$('sens').oninput = () => { prefs.sens = +$('sens').value; savePrefs(); };
$('vol').oninput = () => { prefs.vol = +$('vol').value; sfx.setVol(prefs.vol); savePrefs(); };
$('gfx').onchange = () => { prefs.gfx = $('gfx').value; savePrefs(); setLow(prefs.gfx === 'low'); };
$('bResign').onclick = () => { if (confirm('Resign this game?')) net.send({ t: 'resign' }); };
$('bDraw').onclick = () => { net.send({ t: 'draw' }); toast('Draw offered.'); };
$('bAcc').onclick = () => net.send({ t: 'draw' });
$('bDec').onclick = () => net.send({ t: 'decline' });
$('bRe').onclick = () => {
  net.send({ t: 'rematch' });
  if (net.solo && bot) bot.room.handle('bot', { t: 'rematch' });
  $('bRe').disabled = true; $('oRe').textContent = 'Waiting for the other player…';
};
$('chatin').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const v = $('chatin').value.trim(); if (v) net.send({ t: 'chat', text: v }); $('chatin').value = ''; $('chatin').blur(); } });
function addChat(m) {
  const d = document.createElement('div'), b = document.createElement('b'); b.textContent = m.name + ': '; d.append(b, document.createTextNode(m.text));
  $('chatlog').append(d); $('chatlog').scrollTop = 1e9;
  if (duel) toast(m.name + ': ' + m.text);
}

// ---------------- game state ----------------
let pos = null, sel = -1, legal = [];
function onState(m) {
  const prev = S; S = m; Sat = performance.now();
  if (m.phase === 'lobby') return;
  pos = m.fen ? R.fromFEN(m.fen) : null;
  if (m.fen && boardSeq !== m.game) { placeAll(m.fen); boardSeq = m.game; if (duel) exitDuel(true); }
  if (m.phase === 'duel' && m.duel) {
    if (!duel || duel.id !== m.duel.id) {
      if (duel) exitDuel(true);
      if (m.fen) { reconcile(m.fen, m.last); for (const o of objs) if (o.anim && !o.dead) { const p = G.sqPos(o.sq); o.anim = null; o.g.position.set(p.x, 0, p.z); } }
      enterDuel(m.duel);
    }
  } else {
    if (duel && !duel.ending) exitDuel();
    if (duel && duel.ending) duel.pendingFen = m;
    else if (m.fen) reconcile(m.fen, m.last);
  }
  if (m.phase !== 'over') { show('over', false); $('bRe').disabled = false; }
  if (!duel) { screen('hud'); camMode = 'board'; }
  sel = -1; legal = [];
  drawCards(); drawMoves(); drawStatus(prev);
  if (m.phase === 'over' && (!prev || prev.phase !== 'over')) showOver();
  if (m.phase === 'over') $('oRe').textContent = (m.rematch || []).length && !(m.rematch || []).includes(mySeat()) ? 'Your opponent wants a rematch.' : $('bRe').disabled ? 'Waiting for the other player…' : '';
}
function drawCards() {
  if (!S || !roomInfo) return;
  const myC = mySeat() || 'w', top = R.other(myC);
  for (const [id, c] of [['pTop', top], ['pBot', myC]]) {
    const el = $(id);
    el.querySelector('.dot').style.background = c === 'w' ? '#EADCBE' : '#2B2421';
    el.querySelector('.nm').textContent = seatName(c);
    el.querySelector('.tk').textContent = (S.taken && S.taken[c] || []).slice().sort((a, b) => R.VAL[b] - R.VAL[a]).map(t => GLYPH[t]).join('');
    el.classList.toggle('turn', S.phase === 'play' && S.turn === c);
  }
  tickClocks();
}
function fmt(ms) { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); if (ms < 10000) return (ms / 1000).toFixed(1); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function tickClocks() {
  if (!S) return;
  const myC = mySeat() || 'w';
  for (const [id, c] of [['pTop', R.other(myC)], ['pBot', myC]]) {
    const el = $(id).querySelector('.clk');
    if (!S.clocks) { el.textContent = ''; el.style.display = 'none'; continue; }
    el.style.display = '';
    const run = S.clocks.running === c && S.phase === 'play';
    const left = S.clocks[c] - (run ? S.clocks.since + (performance.now() - Sat) : 0);
    el.textContent = fmt(left); el.classList.toggle('run', run); el.classList.toggle('low', left < 20000);
  }
}
function drawMoves() {
  const el = $('moves'); el.innerHTML = '';
  const sans = (S && S.sans) || [];
  for (let i = 0; i < sans.length; i += 2) {
    const n = document.createElement('span'); n.className = 'n'; n.textContent = (i / 2 + 1) + '.'; el.append(n);
    for (const k of [i, i + 1]) { const s = document.createElement('span'); s.textContent = sans[k] || ''; if ((sans[k] || '').includes('✗')) { s.className = 'x'; s.title = 'capture repelled'; } el.append(s); }
  }
  el.scrollTop = 1e9;
}
function drawStatus(prev) {
  const st = $('status'); st.classList.remove('check');
  if (!S || !pos) return;
  const my = mySeat();
  let txt = '';
  if (S.phase === 'over') txt = resultText();
  else if (S.phase === 'duel') txt = S.duel && S.duel.lastStand ? 'Last stand!' : 'Gunfight!';
  else {
    const who = S.turn === my ? 'Your move' : seatName(S.turn) + ' to move';
    txt = S.check ? 'Check! ' + who : who;
    if (S.check) st.classList.add('check');
  }
  st.textContent = txt;
  putSq(hlFrom, S.last ? S.last.from : -1); putSq(hlTo, S.last ? S.last.to : -1);
  putSq(hlCheck, S.check && S.phase !== 'over' ? R.kingSq(pos.b, S.turn) : (S.result && S.result.reason === 'checkmate' ? R.kingSq(pos.b, R.other(S.result.result)) : -1), 0.03);
  if (S.check && (!prev || !prev.check || prev.fen !== S.fen) && S.phase === 'play') sfx.bell();
  if (S.last && S.last.stand && prev && prev.phase === 'duel' && S.phase === 'play') toast('The king won its last stand. The checking piece fell.');
  else if (S.last && S.last.failed && prev && prev.sans && prev.sans.length < S.sans.length) toast(S.last.fell ? 'The attack was repelled. The attacker fell.' : 'The attack was repelled. The attacker holds its ground.');
  // offer
  const off = S.drawOffer && S.phase === 'play' && my && S.drawOffer !== my;
  show('offer', off); if (off) $('offerT').textContent = seatName(S.drawOffer) + ' offers a draw.';
  $('acts').classList.toggle('hide', !my || S.phase === 'over');
  $('bDraw').classList.toggle('hide', !!(net && net.solo));
}
function resultText() {
  const r = S.result; if (!r) return '';
  if (r.result === 'draw') return 'Draw';
  return seatName(r.result) + ' wins';
}
function showOver() {
  const r = S.result, my = mySeat();
  $('oBig').textContent = r.result === 'draw' ? 'Drawn!' : r.result === my ? 'Victory!' : my ? 'Defeated' : seatName(r.result) + ' wins';
  $('oSub').textContent = r.result === 'draw' ? 'Game over' : (r.result === 'w' ? 'White' : 'Black') + ' wins';
  $('oWhy').textContent = r.reason.charAt(0).toUpperCase() + r.reason.slice(1) + '.';
  $('bRe').classList.toggle('hide', !my); $('bRe').disabled = false;
  show('over', true);
  if (r.result === my) sfx.win(); else if (my) sfx.lose();
}

// ---------------- board camera and picking ----------------
let camMode = 'menu';
const orbit = { yaw: 0, pitch: 0.95, dist: 46, tYaw: 0 };
function boardCam(dt) {
  const my = mySeat();
  const base = my === 'b' ? Math.PI : 0;
  if (orbit.base !== base) { orbit.base = base; orbit.yaw = base; }
  const cy = orbit.yaw, cp = orbit.pitch, d = orbit.dist;
  const target = new T.Vector3(0, 0, 0);
  const want = new T.Vector3(Math.sin(cy) * Math.cos(cp) * d, Math.sin(cp) * d, Math.cos(cy) * Math.cos(cp) * d);
  camera.position.lerp(want, Math.min(1, dt * 6));
  const q = camera.quaternion.clone(); camera.lookAt(target); const q2 = camera.quaternion.clone(); camera.quaternion.copy(q).slerp(q2, Math.min(1, dt * 8));
  if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
}
let menuT = 0;
function menuCam(dt) {
  menuT += dt * 0.06;
  camera.position.set(Math.sin(menuT) * 40, 15, Math.cos(menuT) * 40);
  camera.lookAt(0, 1, 0);
}
const ray = new T.Raycaster(), ndc = new T.Vector2();
let drag = null;
canvas.addEventListener('pointerdown', e => {
  if (camMode !== 'board') return;
  drag = { x: e.clientX, y: e.clientY, moved: false, yaw: orbit.yaw, pitch: orbit.pitch, btn: e.button };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (camMode !== 'board') return;
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved) { orbit.yaw = drag.yaw - dx * 0.006; orbit.pitch = Math.max(0.35, Math.min(1.45, drag.pitch + dy * 0.005)); }
  } else { const s = pickSquare(e); putSq(hlHover, s, 0.025); }
});
canvas.addEventListener('pointerup', e => {
  if (camMode !== 'board' || !drag) return;
  const d = drag; drag = null;
  if (!d.moved && d.btn === 0) clickSquare(pickSquare(e));
});
canvas.addEventListener('wheel', e => { if (camMode === 'board') orbit.dist = Math.max(22, Math.min(80, orbit.dist * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: true });
canvas.addEventListener('contextmenu', e => e.preventDefault());
function pickSquare(e) {
  ndc.set((e.clientX / W) * 2 - 1, -(e.clientY / H) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  // pieces first (they stand up off the board), then the board plane
  const meshes = []; for (const o of objs) if (!o.dead) o.g.traverse(c => { if (c.isMesh) { c.userData.obj = o; meshes.push(c); } });
  const hit = ray.intersectObjects(meshes, false)[0];
  if (hit) return hit.object.userData.obj.sq;
  const o = ray.ray.origin, d = ray.ray.direction; if (d.y >= 0) return -1;
  const t = -o.y / d.y, x = o.x + d.x * t, z = o.z + d.z * t;
  const f = Math.floor(x / SQ + 4), r = Math.floor(4 - z / SQ);
  return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1;
}
function clickSquare(s) {
  if (!S || S.phase !== 'play' || !pos || s < 0) return;
  const my = mySeat(); if (!my) return;
  if (sel >= 0) {
    const ms = legal.filter(m => m.to === s);
    if (ms.length) {
      if (S.turn !== my) { toast('Wait for your turn.'); return; }
      if (ms[0].promo) { askPromo(ms[0]); return; }
      net.send({ t: 'move', from: sel, to: s }); clearSel(); return;
    }
  }
  const p = pos.b[s];
  if (p && R.colorOf(p) === my) {
    sel = s; sfx.tick();
    const st = R.fromFEN(S.fen);
    if (st.turn !== my) st.turn = my; // show where it could go even while waiting
    st.ep = st.turn === pos.turn ? pos.ep : -1;
    legal = R.legalMoves(st).filter(m => m.from === s);
    drawSel();
  } else clearSel();
}
function clearSel() { sel = -1; legal = []; drawSel(); }
function drawSel() {
  for (let s = 0; s < 64; s++) { dots[s].visible = false; rings[s].visible = false; }
  putSq(hlSel, sel, 0.028);
  for (const m of legal) { if (m.cap) putSq(rings[m.to], m.to, 0.05); else putSq(dots[m.to], m.to, 0.05); }
}
function askPromo(m) {
  const el = $('promo'); el.innerHTML = ''; show('promo', true);
  for (const t of 'qrbn') {
    const b = document.createElement('button'); b.className = 'btn gold'; b.textContent = GLYPH[t]; b.title = PNAME[t];
    b.onclick = () => { show('promo', false); net.send({ t: 'move', from: m.from, to: m.to, promo: t }); clearSel(); };
    el.append(b);
  }
}
window.addEventListener('keydown', e => { if (e.key === 'Escape') { show('promo', false); show('help', false); show('settings', false); } });

// ---------------- duels ----------------
let duel = null;
const keys = {};
window.addEventListener('keydown', e => { if (document.activeElement && document.activeElement.tagName === 'INPUT') return; keys[e.code] = true; if (duel && e.code === 'Space') { e.preventDefault(); wantJump = true; } });
window.addEventListener('keyup', e => { keys[e.code] = false; });
let wantJump = false, firing = false, scoped = false;
let locked = false;
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; if (duel && duel.mine) show('lockhint', !locked && !isTouch); });
const isTouch = matchMedia('(pointer: coarse)').matches;
function lockPointer() { try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
document.addEventListener('mousemove', e => {
  if (!duel || !duel.mine || !locked) return;
  const k = 0.0022 * prefs.sens * (scoped ? 0.35 : 1);
  duel.yaw -= e.movementX * k; duel.pitch = Math.max(-1.35, Math.min(1.35, duel.pitch - e.movementY * k));
});
canvas.addEventListener('mousedown', e => {
  if (!duel || !duel.mine) return;
  if (!locked && !isTouch) { lockPointer(); return; }
  if (e.button === 0) firing = true;
  if (e.button === 2 && duel.arm.scope) scoped = true;
});
window.addEventListener('mouseup', e => { if (e.button === 0) firing = false; if (e.button === 2) scoped = false; });
$('lockhint').onclick = () => lockPointer();
// touch: left half moves, right half looks
const touch = { move: null, look: null, mx: 0, my: 0 };
canvas.addEventListener('touchstart', e => {
  if (!duel || !duel.mine) return;
  for (const t of e.changedTouches) {
    if (t.clientX < W / 2 && !touch.move) touch.move = { id: t.identifier, x: t.clientX, y: t.clientY };
    else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
  }
}, { passive: true });
canvas.addEventListener('touchmove', e => {
  if (!duel || !duel.mine) return;
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) { touch.mx = Math.max(-1, Math.min(1, (t.clientX - touch.move.x) / 50)); touch.my = Math.max(-1, Math.min(1, (t.clientY - touch.move.y) / 50)); }
    if (touch.look && t.identifier === touch.look.id) { duel.yaw -= (t.clientX - touch.look.x) * 0.006 * prefs.sens; duel.pitch = Math.max(-1.3, Math.min(1.3, duel.pitch - (t.clientY - touch.look.y) * 0.006 * prefs.sens)); touch.look.x = t.clientX; touch.look.y = t.clientY; }
  }
}, { passive: true });
canvas.addEventListener('touchend', e => { for (const t of e.changedTouches) { if (touch.move && t.identifier === touch.move.id) { touch.move = null; touch.mx = touch.my = 0; } if (touch.look && t.identifier === touch.look.id) touch.look = null; } }, { passive: true });
$('tFire').addEventListener('touchstart', e => { e.preventDefault(); firing = true; }); $('tFire').addEventListener('touchend', e => { e.preventDefault(); firing = false; });
$('tJump').addEventListener('touchstart', e => { e.preventDefault(); wantJump = true; });

const LIM = 4 * SQ + 1.6;
function makeBody(c, t, sq) {
  const p = G.sqPos(sq);
  return { c, t, arm: ARMS[t], x: p.x, y: 0, z: p.z, vx: 0, vy: 0, vz: 0, ground: true, jumps: 0, yaw: 0, pitch: 0 };
}
function face(b, tx, tz) { b.yaw = Math.atan2(-(tx - b.x), -(tz - b.z)); }
function enterDuel(d) {
  if (duel) exitDuel(true);
  clearSel(); show('promo', false);
  const my = mySeat(), ac = d.att, dc = R.other(ac);
  const mine = my === ac || my === dc;
  const meC = mine ? my : ac, foeC = R.other(meC);
  duel = { id: d.id, d, mine, meC, foeC, startAt: performance.now() + (d.start - d.now) - netRtt / 2, endAt: performance.now() + (d.endAt - d.now) - netRtt / 2, hp: Object.assign({}, d.hp), max: d.max,
    lastShot: 0, sendT: 0, shake: 0, ending: false, kick: 0, bob: 0, tracers: [], fov: 72 };
  // bodies
  duel.self = makeBody(meC, d.type[meC], d.sq[meC]);
  duel.foe = makeBody(foeC, d.type[foeC], d.sq[foeC]);
  face(duel.self, duel.foe.x, duel.foe.z); face(duel.foe, duel.self.x, duel.self.z);
  duel.arm = ARMS[d.type[meC]];
  duel.selfObj = objAt(d.sq[meC]); duel.foeObj = objAt(d.sq[foeC]);
  for (const o of [duel.selfObj, duel.foeObj]) if (o) { o.duel = true; o.anim = null; }
  duel.foeT = { x: duel.foe.x, y: 0, z: duel.foe.z, yaw: duel.foe.yaw, mv: 0 };
  duel.selfT = { x: duel.self.x, y: 0, z: duel.self.z, yaw: duel.self.yaw, mv: 0 };
  // cover: every other piece
  duel.cover = objs.filter(o => !o.dead && o !== duel.selfObj && o !== duel.foeObj).map(o => { const a = ARMS[R.typeOf(o.ch)]; return { x: o.g.position.x, z: o.g.position.z, r: a.r * 0.95, h: a.h }; });
  // view
  duel.yaw = duel.self.yaw; duel.pitch = -0.04;
  if (mine) {
    if (duel.selfObj) duel.selfObj.g.visible = false;
    duel.view = buildGun(d.type[meC]); duel.view.traverse(c => { if (c.isMesh) { c.castShadow = false; c.material = c.material.clone(); c.material.depthTest = true; } c.renderOrder = 5; });
    duel.view.position.set(0.3, -0.3, -0.62); duel.view.scale.setScalar(0.42); camera.add(duel.view);
    duel.flash = new T.PointLight('#FFC870', 0, 8); duel.view.add(duel.flash); duel.flash.position.copy(duel.view.userData.muzzle);
    duel.flashMesh = new T.Mesh(new T.SphereGeometry(0.09, 8, 6), new T.MeshBasicMaterial({ color: '#FFE2A6', transparent: true, opacity: 0 })); duel.flashMesh.position.copy(duel.view.userData.muzzle); duel.view.add(duel.flashMesh);
    screen('duel'); show('touch', isTouch); camMode = 'duel';
    if (!isTouch) lockPointer();
    show('lockhint', !locked && !isTouch);
  } else { screen('hud'); camMode = 'watch'; }
  // bots in practice get a body too
  if (bot && net && net.solo) bot.duel = { b: duel.foe, think: 0, strafe: 1, nextShot: 0, aimYaw: duel.foe.yaw, aimPitch: 0, react: 0, sendT: 0 };
  // HUD text
  $('meN').textContent = 'You: ' + PNAME[d.type[meC]];
  $('foeN').textContent = seatName(foeC) + ': ' + PNAME[d.type[foeC]];
  $('weap').innerHTML = ''; $('weap').append(duel.arm.name); const sm = document.createElement('div'); sm.className = 'muted'; sm.textContent = duel.arm.scope ? 'right click to scope' : duel.arm.doubleJump ? 'double jump' : ''; $('weap').append(sm);
  drawHp(true);
  const attacker = PNAME[d.type[ac]], defender = PNAME[d.type[dc]];
  if (d.lastStand) banner('Last stand!', mine ? (dc === meC ? 'Checkmated! Win with your weak king to survive' : 'Topple the king to finish the game!') : 'The king fights for the game', 2600);
  else banner(attacker + ' vs ' + defender, d.type[meC] === 'k' && mine ? 'Your king is fighting. Lose and you lose the game!' : ac === meC && mine ? 'Topple them to take the square!' : mine ? 'Hold your square!' : seatName(ac) + ' attacks', 2400);
  sfx.drum();
  show('count', true);
  drawStatus();
}
function exitDuel(silent) {
  if (!duel) return;
  if (duel.view) camera.remove(duel.view);
  for (const tr of duel.tracers) scene.remove(tr.m);
  for (const o of objs) o.duel = false;
  if (duel.selfObj) duel.selfObj.g.visible = true;
  if (document.pointerLockElement) document.exitPointerLock();
  show('count', false); show('scope', false); show('lockhint', false); show('touch', false);
  firing = false; scoped = false;
  duel = null; if (bot) bot.duel = null;
  if (!silent) { screen('hud'); camMode = 'board'; }
}
function drawHp(instant) {
  if (!duel) return;
  const set = (sel, hp, max) => {
    const bar = document.querySelector(sel + ' .bar');
    const w = Math.max(0, hp / max * 100) + '%';
    bar.querySelector('i').style.width = w; if (instant) bar.querySelector('b').style.width = w; else setTimeout(() => { bar.querySelector('b').style.width = w; }, 30);
  };
  set('.hpbar.me', duel.hp[duel.meC], duel.max[duel.meC]); set('.hpbar.foe', duel.hp[duel.foeC], duel.max[duel.foeC]);
  $('meH').textContent = Math.ceil(duel.hp[duel.meC]); $('foeH').textContent = Math.ceil(duel.hp[duel.foeC]);
}
function onRemotePos(m) {
  if (!duel) return;
  const tgt = m.c === duel.foeC ? duel.foeT : m.c === duel.meC && !duel.mine ? duel.selfT : null;
  if (!tgt) return;
  tgt.x = m.x; tgt.y = m.y; tgt.z = m.z; tgt.vx = m.vx || 0; tgt.vy = m.vy || 0; tgt.vz = m.vz || 0; tgt.yaw = m.yaw; tgt.mv = m.mv; tgt.at = performance.now();
}
function hitFeedback(dmg, head) {
  if (!duel) return;
  const hm = $('hitmark'); hm.classList.toggle('head', !!head); hm.style.transition = 'none'; hm.style.opacity = 1; void hm.offsetWidth; hm.style.transition = 'opacity .35s'; hm.style.opacity = 0;
  sfx.hit(head);
  popDamage(dmg, head, duel.foeObj ? duel.foeObj.g.position.clone().add(new T.Vector3(0, duel.foe.arm.h * 0.9, 0)) : null);
}
function onHp(m) {
  if (!duel) return;
  duel.hp = m.hp; drawHp();
  if (duel.mine && m.by === duel.meC) {
    if (net && net.solo) hitFeedback(m.dmg, m.head); // online, the shooter already saw this the moment they fired
  } else if (duel.mine && m.by === duel.foeC) {
    const h = $('hurt'); h.style.transition = 'none'; h.style.opacity = 0.9; void h.offsetWidth; h.style.transition = 'opacity .6s'; h.style.opacity = 0;
    duel.shake = Math.min(1, duel.shake + m.dmg / 60); sfx.hurt();
  }
}
function popDamage(n, head, wp) {
  if (!wp) return;
  const v = wp.clone().project(camera); if (v.z > 1) return;
  const el = document.createElement('div'); el.className = 'dmg' + (head ? ' head' : ''); el.textContent = n;
  el.style.left = ((v.x + 1) / 2 * W + (Math.random() - 0.5) * 30) + 'px'; el.style.top = ((1 - v.y) / 2 * H) + 'px';
  $('fxl').append(el);
  requestAnimationFrame(() => { el.style.transform = 'translateY(-50px)'; el.style.opacity = 0; });
  setTimeout(() => el.remove(), 800);
}
function onDuelEnd(m) {
  if (!duel || duel.id !== m.id) return;
  duel.ending = true; duel.hp = m.hp; drawHp(); firing = false;
  const loserC = R.other(m.winner);
  const lo = loserC === duel.meC ? duel.selfObj : duel.foeObj;
  if (lo && !(loserC === duel.d.att && wouldHold())) { lo.g.visible = true; killObj(lo); lo.toppling = true; sfx.topple(); }
  const myWin = duel.mine && m.winner === duel.meC;
  const how = m.how === 'time' ? 'Time! More health left wins' : 'Toppled!';
  if (duel.d.lastStand) banner(m.attackerWon ? 'Checkmate!' : 'The king survives!', m.attackerWon ? how : 'The checking piece falls', 2400);
  else banner(m.attackerWon ? 'Captured!' : 'Repelled!', how, 2400);
  if (duel.mine) (myWin ? sfx.win : sfx.lose)();
  if (document.pointerLockElement) document.exitPointerLock();
  show('scope', false);
}
// attacker that may not fall (king, or pinned so its fall would expose the king)
function wouldHold() {
  if (!duel || !pos) return false;
  const d = duel.d; if (d.type[d.att] === 'k') return false;
  const b = pos.b.slice(); b[d.from] = '';
  return R.attacked(b, R.kingSq(b, d.att), R.other(d.att));
}

// movement for any duel body; covers are the other pieces, the other duelist is solid too
function stepBody(b, dt, ix, iz, jump, other) {
  const A = b.arm, sp = A.speed * (scoped && b === duel.self ? 0.5 : 1);
  const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw), rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
  let wx = fx * -iz + rx * ix, wz = fz * -iz + rz * ix; const l = Math.hypot(wx, wz); if (l > 1) { wx /= l; wz /= l; }
  const acc = b.ground ? 60 : 18;
  b.vx += (wx * sp - b.vx) * Math.min(1, acc * dt / sp); b.vz += (wz * sp - b.vz) * Math.min(1, acc * dt / sp);
  if (jump) {
    if (b.ground) { b.vy = 8.2; b.ground = false; b.jumps = 1; if (b === duel.self) sfx.jump(); }
    else if (A.doubleJump && b.jumps < 2) { b.vy = 8.6; b.jumps = 2; if (b === duel.self) sfx.jump(); }
  }
  b.vy -= 24 * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (b.y <= 0) { if (!b.ground && b.vy < -6 && b === duel.self) sfx.land(); b.y = 0; b.vy = 0; b.ground = true; b.jumps = 0; }
  const solids = duel.cover.concat(other ? [{ x: other.x, z: other.z, r: other.arm.r * 0.9, h: other.arm.h + other.y }] : []);
  for (const c of solids) {
    if (b.y > c.h - 0.05) continue;
    const dx = b.x - c.x, dz = b.z - c.z, d = Math.hypot(dx, dz), min = c.r + A.r * 0.8;
    if (d < min && d > 1e-4) { b.x = c.x + dx / d * min; b.z = c.z + dz / d * min; const vn = (b.vx * dx + b.vz * dz) / d; if (vn < 0) { b.vx -= vn * dx / d; b.vz -= vn * dz / d; } }
  }
  b.x = Math.max(-LIM, Math.min(LIM, b.x)); b.z = Math.max(-LIM, Math.min(LIM, b.z));
}
// ray against an upright cylinder; returns distance or Infinity
function rayCyl(o, d, cx, cz, r, y0, y1) {
  const ox = o.x - cx, oz = o.z - cz, a = d.x * d.x + d.z * d.z;
  let best = Infinity;
  if (a > 1e-8) {
    const bq = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r, disc = bq * bq - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-bq - s) / (2 * a), (-bq + s) / (2 * a)]) { if (t > 0) { const y = o.y + d.y * t; if (y >= y0 && y <= y1) { best = Math.min(best, t); break; } } }
    }
  }
  if (Math.abs(d.y) > 1e-6) { // top cap
    const t = (y1 - o.y) / d.y; if (t > 0) { const x = ox + d.x * t, z = oz + d.z * t; if (x * x + z * z <= r * r) best = Math.min(best, t); }
  }
  return best;
}
// one shot from body 'from' at body 'to'; returns {t, hit, head}
function traceShot(o, d, target, range) {
  let tMin = range, what = null;
  if (d.y < 0) { const t = -o.y / d.y; if (t < tMin) { tMin = t; what = 'ground'; } }
  for (const c of duel.cover) { const t = rayCyl(o, d, c.x, c.z, c.r, 0, c.h); if (t < tMin) { tMin = t; what = 'cover'; } }
  const A = target.arm, t = rayCyl(o, d, target.x, target.z, A.r, target.y, target.y + A.h);
  let head = false;
  if (t < tMin) { tMin = t; what = 'body'; head = (o.y + d.y * t - target.y) > A.h * G.HEAD; }
  return { t: tMin, what, head };
}
const tracerMat = new T.LineBasicMaterial({ color: '#FFE2A6', transparent: true, opacity: 0.9 });
function addTracer(a, b) {
  const g = new T.BufferGeometry().setFromPoints([a, b]); const m = new T.Line(g, tracerMat.clone()); scene.add(m);
  duel.tracers.push({ m, t: 0 });
  // impact puff
  const p = new T.Mesh(new T.SphereGeometry(0.12, 6, 4), new T.MeshBasicMaterial({ color: '#F6D9A0', transparent: true, opacity: 0.9 })); p.position.copy(b); scene.add(p); duel.tracers.push({ m: p, t: 0, puff: true });
}
function eyeOf(b) { return new T.Vector3(b.x, b.y + b.arm.h * 0.84, b.z); }
function dirOf(yaw, pitch) { return new T.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)); }
function spreadDir(base, s) {
  const d = base.clone(); d.x += (Math.random() - 0.5) * 2 * s; d.y += (Math.random() - 0.5) * 2 * s; d.z += (Math.random() - 0.5) * 2 * s; return d.normalize();
}
function fireMine(now) {
  const A = duel.arm;
  if (now - duel.lastShot < A.interval * 1000 || now < duel.startAt) return;
  duel.lastShot = now;
  const o = camera.getWorldPosition(new T.Vector3()), base = dirOf(duel.yaw, duel.pitch);
  let spread = A.spread; if (A.scope) spread = scoped ? 0.001 : 0.03; if (!duel.self.ground) spread *= 1.8;
  let hits = 0, heads = 0;
  const muz = duel.view.localToWorld(duel.view.userData.muzzle.clone());
  for (let i = 0; i < A.pellets; i++) {
    const d = spreadDir(base, spread), r = traceShot(o, d, duel.foe, A.range);
    if (r.what === 'body') { hits++; if (r.head) heads++; }
    if (i < 4) addTracer(muz, o.clone().addScaledVector(d, r.t));
  }
  net.send({ t: 'shot', o: [o.x, o.y, o.z], d: [base.x, base.y, base.z], hits, heads });
  if (hits && !(net && net.solo)) hitFeedback(Math.round(hits * A.dmg + heads * A.dmg * 0.6), heads > 0);
  sfx.gun(duel.d.type[duel.meC]);
  duel.kick = Math.min(1.5, duel.kick + (A.pellets > 1 ? 1 : A.dmg / 40));
  duel.pitch = Math.min(1.35, duel.pitch + (A.pellets > 1 ? 0.03 : A.dmg / 2000));
  duel.flashT = 0.05;
}
function onRemoteShot(m) {
  if (!duel) return;
  const b = m.c === duel.foeC ? duel.foe : duel.self;
  const o = new T.Vector3(m.o[0], m.o[1], m.o[2]), d = new T.Vector3(m.d[0], m.d[1], m.d[2]).normalize();
  const target = b === duel.foe ? duel.self : duel.foe;
  const r = traceShot(o, d, target, b.arm.range);
  const obj = b === duel.foe ? duel.foeObj : duel.selfObj;
  const from = obj ? obj.g.userData.gun.localToWorld(obj.g.userData.gun.userData.muzzle.clone()) : o;
  addTracer(from, o.clone().addScaledVector(d, r.t));
  sfx.gun(b.t, from);
}

// practice bot fighting in the duel
function botDuel(dt, now) {
  const bd = bot && bot.duel; if (!bd || !duel || duel.ending) return;
  const b = bd.b, me = duel.self, A = b.arm;
  const live = now >= duel.startAt;
  const eye = eyeOf(b), aimAt = new T.Vector3(me.x, me.y + me.arm.h * 0.6, me.z);
  const to = aimAt.clone().sub(eye), dist = to.length(); to.normalize();
  const los = traceShot(eye, to, me, 200).what === 'body';
  bd.think -= dt;
  if (bd.think <= 0) { bd.think = 0.5 + Math.random() * 0.8; bd.strafe = Math.random() < 0.5 ? -1 : 1; bd.hop = Math.random() < 0.15; }
  const want = { n: 5, p: 12, b: 22, r: 11, q: 13, k: 10 }[b.t];
  let ix = 0, iz = 0;
  if (live) {
    if (!los) { iz = -1; ix = bd.strafe * 0.7; } // push in and around cover
    else { iz = dist > want + 2 ? -1 : dist < want - 2 ? 0.8 : 0; ix = bd.strafe; }
  }
  // turn toward the player with a little lag
  const wantYaw = Math.atan2(-(me.x - b.x), -(me.z - b.z)), wantPitch = Math.asin(Math.max(-1, Math.min(1, to.y)));
  const turn = [3, 5, 8][bot.level - 1];
  let dy = wantYaw - bd.aimYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  bd.aimYaw += dy * Math.min(1, dt * turn); bd.aimPitch += (wantPitch - bd.aimPitch) * Math.min(1, dt * turn);
  b.yaw = bd.aimYaw;
  if (live && !los && Math.random() < dt * 0.6) bd.hop = true;
  stepBody(b, dt, ix, iz, bd.hop && b.ground, me); bd.hop = false;
  // fire
  if (los) bd.react += dt; else bd.react = 0;
  if (live && los && bd.react > [0.55, 0.35, 0.2][bot.level - 1] && now >= bd.nextShot && Math.abs(dy) < 0.25 && dist < A.range) {
    bd.nextShot = now + A.interval * 1000 * [2.1, 1.6, 1.25][bot.level - 1];
    const err = [0.085, 0.06, 0.04][bot.level - 1] * (1 + dist / 40) + (b.ground ? 0 : 0.03);
    const base = dirOf(bd.aimYaw, bd.aimPitch);
    let hits = 0, heads = 0;
    const jitter = spreadDir(base, err);
    for (let i = 0; i < A.pellets; i++) { const r = traceShot(eye, spreadDir(jitter, A.spread), me, A.range); if (r.what === 'body') { hits++; if (r.head) heads++; } }
    bot.room.handle('bot', { t: 'shot', o: [eye.x, eye.y, eye.z], d: [jitter.x, jitter.y, jitter.z], hits, heads });
  }
  bd.sendT -= dt;
  if (bd.sendT <= 0) { bd.sendT = 0.05; bot.room.handle('bot', { t: 'p', x: b.x, y: b.y, z: b.z, yaw: b.yaw, pitch: bd.aimPitch, mv: Math.hypot(b.vx, b.vz) > 0.5 }); }
}

function duelFrame(dt, now) {
  const dd = duel, A = dd.arm, live = now >= dd.startAt && !dd.ending;
  // countdown and timer
  const c = $('count');
  if (now < dd.startAt) {
    const n = Math.ceil((dd.startAt - now) / 1000);
    if (dd.lastCount !== n) { dd.lastCount = n; c.textContent = n; const s = document.createElement('small'); s.textContent = dd.mine ? (isTouch ? 'get ready' : locked ? 'get ready' : 'click to aim') : 'get ready'; c.append(s); sfx.tick(); }
  } else if (!dd.wentGo) { dd.wentGo = true; c.textContent = 'FIRE!'; sfx.go(); setTimeout(() => show('count', false), 600); }
  $('dtimer').textContent = dd.ending ? '' : fmt(Math.min(45000, dd.endAt - now));
  if (dd.mine) {
    const me = dd.self;
    let ix = 0, iz = 0;
    if (live) {
      if (keys.KeyW || keys.ArrowUp) iz -= 1; if (keys.KeyS || keys.ArrowDown) iz += 1;
      if (keys.KeyA || keys.ArrowLeft) ix -= 1; if (keys.KeyD || keys.ArrowRight) ix += 1;
      ix += touch.mx; iz += touch.my;
    }
    me.yaw = dd.yaw;
    stepBody(me, dt, ix, iz, live && wantJump, dd.foe); wantJump = false;
    // camera
    const moving = Math.hypot(me.vx, me.vz);
    dd.bob += dt * moving * 1.6;
    dd.kick *= Math.exp(-dt * 12); dd.shake *= Math.exp(-dt * 6);
    const sh = dd.shake * 0.08;
    if (dd.ending) {
      const mx = (me.x + dd.foe.x) / 2, mz = (me.z + dd.foe.z) / 2, fx = -Math.sin(dd.yaw), fz = -Math.cos(dd.yaw);
      camera.position.lerp(new T.Vector3(me.x - fx * 12, 10, me.z - fz * 12), Math.min(1, dt * 3));
      const q = camera.quaternion.clone(); camera.lookAt(mx, 1.5, mz); const q2 = camera.quaternion.clone(); camera.quaternion.copy(q).slerp(q2, Math.min(1, dt * 4));
      if (dd.view) dd.view.visible = false;
    } else {
    camera.position.set(me.x + (Math.random() - 0.5) * sh, me.y + A.h * 0.84 + (me.ground ? Math.sin(dd.bob * 2) * 0.05 : 0), me.z + (Math.random() - 0.5) * sh);
    camera.rotation.set(dd.pitch + dd.kick * 0.02, dd.yaw, 0);
    const wantFov = scoped ? 24 : 74;
    if (Math.abs(camera.fov - wantFov) > 0.1) { camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }
    show('scope', scoped && camera.fov < 40 && !dd.ending); if (dd.view && !dd.ending) dd.view.visible = !(scoped && camera.fov < 40);
    }
    if (dd.view && !dd.ending) { dd.view.position.set(0.3 + Math.sin(dd.bob) * 0.012, -0.3 + Math.abs(Math.cos(dd.bob)) * 0.012 - dd.kick * 0.02, -0.62 + dd.kick * 0.06); dd.view.rotation.x = dd.kick * 0.12; }
    if (dd.flashT > 0) { dd.flashT -= dt; dd.flash.intensity = 6; dd.flashMesh.material.opacity = 1; } else if (dd.flash) { dd.flash.intensity = 0; dd.flashMesh.material.opacity = 0; }
    if (live && firing && (locked || isTouch)) fireMine(now);
    dd.sendT -= dt;
    if (dd.sendT <= 0) { dd.sendT = 0.033; net.send({ t: 'p', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), vx: +me.vx.toFixed(2), vy: +me.vy.toFixed(2), vz: +me.vz.toFixed(2), yaw: +dd.yaw.toFixed(3), pitch: +dd.pitch.toFixed(3), mv: moving > 0.5 }); }
    if (dd.selfObj && !dd.selfObj.toppling) { dd.selfObj.g.position.set(me.x, me.y, me.z); dd.selfObj.g.rotation.y = me.yaw; }
  } else {
    // spectators: follow both from above
    const s = dd.selfT; dd.self.x += (s.x - dd.self.x) * Math.min(1, dt * 14); dd.self.y += (s.y - dd.self.y) * Math.min(1, dt * 14); dd.self.z += (s.z - dd.self.z) * Math.min(1, dt * 14); dd.self.yaw = s.yaw;
    if (dd.selfObj && !dd.selfObj.toppling) { dd.selfObj.g.position.set(dd.self.x, dd.self.y, dd.self.z); dd.selfObj.g.rotation.y = dd.self.yaw; }
    const mx = (dd.self.x + dd.foe.x) / 2, mz = (dd.self.z + dd.foe.z) / 2, sep = Math.hypot(dd.self.x - dd.foe.x, dd.self.z - dd.foe.z);
    const want = new T.Vector3(mx + 4, 10 + sep * 0.6, mz + 14 + sep * 0.5);
    camera.position.lerp(want, Math.min(1, dt * 3)); camera.lookAt(mx, 1.5, mz);
  }
  // the other duelist: from the network, or the local bot
  if (bot && bot.duel) botDuel(dt, now);
  else {
    // dead reckoning: show where the opponent is now, not where the last packet said they were
    const f = dd.foeT, b = dd.foe, k = 1 - Math.exp(-dt * 30);
    const age = f.at ? Math.min(0.2, (now - f.at) / 1000 + netRtt / 2000) : 0;
    const px = f.x + (f.vx || 0) * age, pz = f.z + (f.vz || 0) * age, py = Math.max(0, f.y + (f.vy || 0) * age);
    b.x += (px - b.x) * k; b.y += (py - b.y) * k; b.z += (pz - b.z) * k;
    let dy = f.yaw - b.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); b.yaw += dy * k; b.mv = f.mv;
  }
  if (dd.foeObj && !dd.foeObj.toppling) {
    const b = dd.foe; dd.hopT = (dd.hopT || 0) + dt * (b.mv || Math.hypot(b.vx, b.vz) > 0.5 ? 9 : 0);
    dd.foeObj.g.position.set(b.x, b.y + (b.y < 0.01 ? Math.abs(Math.sin(dd.hopT)) * 0.18 : 0), b.z); dd.foeObj.g.rotation.y = b.yaw;
  }
  for (const tr of dd.tracers) { tr.t += dt; const k = tr.t / (tr.puff ? 0.35 : 0.08); tr.m.material.opacity = Math.max(0, 0.9 * (1 - k)); if (tr.puff) tr.m.scale.setScalar(1 + tr.t * 6); if (k >= 1) { scene.remove(tr.m); tr.done = true; } }
  dd.tracers = dd.tracers.filter(t => !t.done);
  if (dd.ending && dd.pendingFen) { const m = dd.pendingFen; dd.pendingFen = null; dd.ending = false; exitDuel(); if (m.fen) reconcile(m.fen, m.last); }
}

// ---------------- main loop ----------------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  watchFrameRate((now - lastT) / 1000 || dt);
  if (duel) duelFrame(dt, now);
  else if (camMode === 'board' || camMode === 'watch') boardCam(dt);
  else menuCam(dt);
  updateObjs(dt);
  if (S && S.clocks) tickClocks();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
placeAll(R.START);
requestAnimationFrame(frame);

// open straight into a shared table link
const qRoom = (new URLSearchParams(location.search)).get('room');
if (qRoom) { $('joinCode').value = qRoom.toUpperCase(); if (prefs.name) setTimeout(() => $('bJoin').click(), 50); else { $('name').focus(); toast('Type your name, then press Join.', 5000); } }
if (!prefs.seenHelp && !qRoom && !TEST) show('help', true);

// test hooks for headless checks
window.GM = { get S() { return S; }, get duel() { return duel; }, get room() { return roomInfo; }, net: () => net, onMsg, startSolo, clickSquare, pickSquare, objs: () => objs, R, camera, keys,
  fire(on) { firing = on; }, setLocked(v) { locked = v; }, aim(yaw, pitch) { if (duel) { duel.yaw = yaw; duel.pitch = pitch; } } };
})();
