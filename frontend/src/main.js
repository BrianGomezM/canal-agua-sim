import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

const API = 'ws://127.0.0.1:8000/ws/sim';

// Same palette for the nine cell types as in the report's mesh figure.
const TYPE_COLORS = {
  1: 0xffffff, 2: 0xffb347, 3: 0xb48be0, 4: 0x9fc5e8, 5: 0xb6d7a8,
  6: 0x3c78d8, 7: 0x34a853, 8: 0xffe066, 9: 0xff66cc,
};
// Substitution made in the cell equation for each type (report, "Tipos de ecuación").
const TYPE_RULES = {
  1: 'ninguna (tiene las 4 vecinas)',
  2: 'W = 1 (vx), W = 0 (vy)',
  3: 'E = W',
  4: 'S = 0',
  5: 'N = 0',
  6: 'W = 1 (vx), W = 0 (vy); S = 0',
  7: 'W = 1 (vx), W = 0 (vy); N = 0',
  8: 'E = W; S = 0',
  9: 'E = W; N = 0',
};
const RAMP = ['#1b2a5c', '#2a7fb8', '#3fb8a0', '#e6d94c', '#f2542d'];
const DIVERGING = ['#2a5db0', '#9fc5e8', '#f4f4f4', '#f0a98a', '#c0392b'];
const WATER_RAMP = ['#5fb4d6', '#3e9ccb', '#2a86bd', '#1f6fae', '#17599a']; // slow -> fast, all water-like
const RELIEF_HEAT = 14;    // height (scene units) of a cell at full speed when "relieve" is on
const BASE_CANAL = 2.5;    // level of the fluid surface where the fluid has arrived
const WET_LO = 0.02, WET_HI = 0.03; // |V| [m/s] below WET_LO the flow has not reached a point; above WET_HI it has
const WAVE_AMP = 1.4;      // height of the waves at full speed when "relieve" is on (exaggerated)
const FLOW_SCALE = 12;     // time acceleration of the surface ripples: 1 m/s moves them 12 m per second
const HEAT_BG = 0x0b1522;
const CANAL_BG = 0xeef3f7;

const app = document.querySelector('#app');
app.innerHTML = `
<div class="panel">
  <h1>Canal 2D — Navier–Stokes</h1>
  <div class="subtitle">Ecuaciones 4.60 y 4.61 · diferencias finitas centradas · relajación sucesiva</div>

  <div class="section">
    <div class="row">
      <button id="pause">Pausar</button>
      <button id="step">Paso</button>
      <button id="reset">Reiniciar</button>
    </div>
    <div class="help" id="meshInfo" style="margin-top:8px"></div>

    <label>Factor de relajación ω: <b id="omegaV">0.80</b></label>
    <input id="omega" type="range" min="0.1" max="1.9" step="0.05" value="0.8">
    <div class="help" id="omegaHelp"></div>

    <label>Tolerancia (máx. cambio por barrido)</label>
    <select id="tol">
      <option value="1e-3">1e-3</option>
      <option value="1e-4">1e-4</option>
      <option value="1e-5">1e-5</option>
      <option value="1e-6" selected>1e-6</option>
      <option value="1e-8">1e-8</option>
      <option value="1e-10">1e-10</option>
    </select>

    <label>Valor inicial de vx (al reiniciar)</label>
    <select id="initial">
      <option value="0" selected>0 — el flujo entra al canal</option>
      <option value="1">1 — el del informe (todo el canal)</option>
    </select>

    <label>Velocidad de la animación: <b id="sweepsV">40</b> iteraciones/s</label>
    <input id="sweeps" type="range" min="5" max="240" step="5" value="40">
    <div class="help">Al arrancar se ve cómo converge el método (iteraciones); no es el paso del tiempo,
      porque el modelo es estacionario. Cuando converge, el campo ya no cambia.</div>
  </div>

  <div class="section">
    <label>Estilo de vista</label>
    <select id="style">
      <option value="heat" selected>Mapa de calor</option>
      <option value="canal">Canal 3D (fluido)</option>
    </select>
    <label>Mostrar</label>
    <select id="view">
      <option value="speed">Velocidad |V|</option>
      <option value="vx">Componente vx</option>
      <option value="vy">Componente vy</option>
      <option value="type">Tipo de celda (9 tipos)</option>
    </select>
    <div class="legend"><div id="legendBar" class="legend-bar"></div>
      <div class="legend-labels"><span id="legendMin">0</span><span id="legendMax">1</span></div></div>
    <div class="row" style="margin-top:8px; flex-wrap:wrap">
      <label class="check"><input type="checkbox" id="vectors" checked> Vectores</label>
      <label class="check"><input type="checkbox" id="relief"> Relieve</label>
      <label class="check"><input type="checkbox" id="grid"> Malla</label>
    </div>
    <div class="help" id="styleHelp"></div>
  </div>

  <div class="section">
    <div class="badge" id="status">Conectando...</div>
    <div class="metric">
      <div><span>Iteración</span><strong id="iter">0</strong></div>
      <div><span>Máx. cambio (residuo)</span><strong id="resid">—</strong></div>
      <div><span>Malla</span><strong id="meshDims">—</strong></div>
      <div><span>Incógnitas</span><strong id="unknowns">—</strong></div>
      <div><span>Paso h</span><strong id="hval">—</strong></div>
      <div><span>Re de celda (|v| = 1)</span><strong id="reh">—</strong></div>
    </div>
  </div>

  <div class="section">
    <b style="font-size:12px">Los 9 tipos de ecuación</b>
    <table class="types" id="typeTable"></table>
  </div>

  <div class="section">
    <b style="font-size:12px">Puntero de consulta</b>
    <div class="help">Pase el cursor sobre una celda del canal: se marca en amarillo y aquí aparecen sus datos.</div>
    <div class="metric">
      <div><span>celda (i, j)</span><strong id="pc">—</strong></div>
      <div><span>tipo</span><strong id="pt">—</strong></div>
      <div><span>x</span><strong id="px">—</strong></div>
      <div><span>y</span><strong id="py">—</strong></div>
      <div><span>vx</span><strong id="pu">—</strong></div>
      <div><span>vy</span><strong id="pv">—</strong></div>
      <div><span>|V|</span><strong id="ps">—</strong></div>
    </div>
  </div>

  <div class="section help">
    <b>Modelo:</b> flujo estacionario, incompresible y bidimensional en un canal de 400 × 40 m, sin
    obstáculos, con presión constante (∂P = 0), ν = 1 m²/s. Entrada: vx = 1, vy = 0. Piso y techo:
    v = 0. Salida: ∂v/∂x = 0 (E = W). Cada celda se calcula con sus cuatro vecinas (ecuaciones del
    informe); el sistema no lineal se resuelve iterando hasta que el cambio sea menor que la
    tolerancia. La continuidad (4.59) no se impone en esta etapa, y con presión constante el flujo
    se frena y llega a cero antes de la salida.
  </div>
</div>
<div id="tooltip"></div>
`;

const el = id => document.getElementById(id);

// ---------- colour ramps as lookup tables (no allocations while drawing) ----------
function gradient(stops, t) {
  const n = stops.length - 1;
  const x = Math.min(1, Math.max(0, t)) * n;
  const a = Math.min(n - 1, Math.floor(x));
  return new THREE.Color(stops[a]).lerp(new THREE.Color(stops[a + 1]), x - a);
}
const LUT_SIZE = 256;
function makeLUT(stops) {
  const lin = new Float32Array(LUT_SIZE * 3), srgb = new Uint8Array(LUT_SIZE * 3);
  for (let k = 0; k < LUT_SIZE; k++) {
    const c = gradient(stops, k / (LUT_SIZE - 1));
    lin.set([c.r, c.g, c.b], 3 * k);
    const hex = c.getHex(); // sRGB
    srgb.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255], 3 * k);
  }
  return { lin, srgb };
}
const LUTS = { heat: makeLUT(RAMP), diverging: makeLUT(DIVERGING), water: makeLUT(WATER_RAMP) };

// ---------- fluid surface shaders ----------
// The velocity texture holds (vx, vy, |V|, wetness) per cell. The surface is flat at a base level
// where the computed flow has arrived (wetness = 1) and dry elsewhere. A ripple pattern is carried
// by the local velocity (two-phase "flow map"), so the surface visibly flows where the computed
// velocity is non-zero and is calm where it is zero. With "relieve" on, the ripples also lift the
// surface: waves that are taller where the flow is faster.
const FLUID_COMMON = `
  uniform float uTime;
  uniform float uFlow;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float ripple(vec2 p) { return 0.6 * noise(p * 0.16) + 0.4 * noise(p * 0.42 + 17.0); }

  // Ripple pattern carried by the velocity vel [m/s] at the world point p = (x, z).
  float flowPattern(vec2 p, vec2 vel) {
    float period = 1.4;
    float t1 = fract(uTime / period), t2 = fract(uTime / period + 0.5);
    float w1 = 1.0 - abs(2.0 * t1 - 1.0), w2 = 1.0 - abs(2.0 * t2 - 1.0);
    return w1 * ripple(p - vel * (t1 * period * uFlow))
         + w2 * ripple(p - vel * (t2 * period * uFlow) + 5.31);
  }
`;
const FLUID_VERT = `
  ${FLUID_COMMON}
  uniform sampler2D uVel;
  uniform vec2 uSize;      // channel length and width [m]
  uniform vec2 uTexSize;   // cells along x and y
  uniform float uRelief;   // 1 = waves lift the surface
  uniform float uWaveAmp;  // wave height at full speed
  uniform float uBase;     // level of the surface where the fluid has arrived
  uniform float uInlet;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;

  // Base level of the surface: 0 (floor) where the flow has not arrived, uBase where it has.
  float surfaceAt(vec2 uv) { return smoothstep(0.0, 1.0, texture2D(uVel, uv).w) * uBase; }

  void main() {
    vUv = uv;
    vec4 v = texture2D(uVel, uv);
    vec3 pos = position;
    float moving = smoothstep(0.0, 0.12, v.z / uInlet);   // calm where the flow stops
    float wave = uRelief * uWaveAmp * moving * (flowPattern(pos.xz, vec2(v.x, -v.y)) - 0.5);
    pos.y += 0.15 + surfaceAt(uv) + smoothstep(0.0, 1.0, v.w) * wave;
    vec2 du = vec2(1.0 / uTexSize.x, 0.0);
    vec2 dv = vec2(0.0, 1.0 / uTexSize.y);
    float hx = surfaceAt(uv + du) - surfaceAt(uv - du);
    float hy = surfaceAt(uv + dv) - surfaceAt(uv - dv);
    vec3 dpdu = vec3(uSize.x * 2.0 * du.x, hx, 0.0);
    vec3 dpdv = vec3(0.0, hy, -uSize.y * 2.0 * dv.y);   // v grows towards -z
    vNormal = normalize(cross(dpdu, dpdv));
    vWorld = (modelMatrix * vec4(pos, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;
const FLUID_FRAG = `
  ${FLUID_COMMON}
  uniform sampler2D uVel;
  uniform sampler2D uColor;
  uniform float uInlet;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;

  void main() {
    vec4 v = texture2D(uVel, vUv);
    if (v.w < 0.02) discard;                    // dry: the computed flow has not reached this point
    vec2 vel = vec2(v.x, -v.y);                 // world (x, z); z = width/2 - y
    vec2 p = vWorld.xz;
    float n = flowPattern(p, vel);
    float gx = flowPattern(p + vec2(0.7, 0.0), vel) - n;   // forward differences: 3 evaluations
    float gz = flowPattern(p + vec2(0.0, 0.7), vel) - n;
    float moving = smoothstep(0.0, 0.12, v.z / uInlet);   // calm where the flow stops
    vec3 N = normalize(vNormal + moving * vec3(-gx, 0.0, -gz) * 4.4);
    vec3 L = normalize(vec3(0.4, 1.0, 0.5));
    float diff = 0.6 + 0.4 * max(dot(N, L), 0.0);
    vec3 base = texture2D(uColor, vUv).rgb;
    vec3 col = base * diff + moving * (n - 0.5) * 0.14;
    float glint = pow(max(dot(reflect(-L, N), normalize(cameraPosition - vWorld)), 0.0), 40.0);
    col += moving * 0.4 * glint;
    col = mix(vec3(0.95, 0.98, 1.0), col, smoothstep(0.02, 0.5, v.w));   // thin foam line at the front
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// ---------- three.js scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(HEAT_BG);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.05));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(60, 140, 90);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;

const CHANNEL_SPAN = 460;                                       // channel length + inlet/outlet arrows [m]
const HEAT_DIR = new THREE.Vector3(0, 0.9, 0.44).normalize();   // camera direction from the target
const CANAL_DIR = new THREE.Vector3(0.45, 0.5, 0.75).normalize();

let style = 'heat';      // 'heat' | 'canal'
let mesh = null;         // last "mesh" message
let latest = null;       // last "state" message data
let cells = null;        // heat: InstancedMesh, one box per cell, index = j * nx + i
let arrows = null;       // InstancedMesh, one arrow per cell (both styles)
let frame = null;        // heat: walls and inlet/outlet arrows
let canal = null;        // canal: group with floor, walls and the fluid surface
let water = null;        // canal: the fluid surface mesh
let gridLines = null;    // cell borders
let hover = null;        // marker of the cell under the pointer
let colorTex = null, velTex = null;
// Velocity shown = eased towards the last solver state, so cells rise/fall smoothly.
let tgtVx = null, tgtVy = null, curVx = null, curVy = null;
let dirty = true;
let flowTime = 0;
let running = true;
let socket = null;
let lastSend = 0;
const dummy = new THREE.Object3D();

// The control panel covers the left of the screen: shift the rendered image to the right by
// half of the panel width and back the camera off until the whole channel fits in the free area.
function fitView() {
  const panel = document.querySelector('.panel');
  const panelW = panel ? panel.offsetWidth + 16 : 0;
  camera.aspect = innerWidth / innerHeight;
  camera.setViewOffset(innerWidth, innerHeight, -panelW / 2, 0, innerWidth, innerHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  const freeW = Math.max(200, innerWidth - panelW - 32);
  const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
  const dist = (innerWidth * CHANNEL_SPAN) / (freeW * 2 * halfTan) * (style === 'canal' ? 1.2 : 1);
  camera.position.copy(controls.target).addScaledVector(style === 'canal' ? CANAL_DIR : HEAT_DIR, dist);
}
fitView();

function cellCenter(i, j) {
  // World x follows i; world z = width/2 - y, so the ceiling (large y) is at the far side.
  return [
    -mesh.length / 2 + (i + 0.5) * mesh.h,
    mesh.width / 2 - (j + 0.5) * mesh.h,
  ];
}

function disposeObject(o) {
  if (!o) return;
  scene.remove(o);
  o.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
}

function buildScene() {
  for (const o of [cells, arrows, frame, canal, gridLines, hover]) disposeObject(o);
  colorTex?.dispose();
  velTex?.dispose();
  const { nx, ny, h } = mesh;
  const n = nx * ny;

  // --- heat map: one box per cell ---
  cells = new THREE.InstancedMesh(
    new THREE.BoxGeometry(h * 0.94, 1, h * 0.94),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), n);
  cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cells.setColorAt(0, new THREE.Color(0xffffff)); // allocates instanceColor
  cells.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(cells);

  frame = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5f7387, roughness: 0.7 });
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(mesh.length + 2, 3, 1.2), wallMat);
    wall.position.set(0, 1.5, s * (mesh.width / 2 + 0.9));
    frame.add(wall);
  }
  for (const x of [-mesh.length / 2 - 14, mesh.length / 2 + 14]) {
    for (const z of [-mesh.width * 0.3, 0, mesh.width * 0.3]) {
      frame.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(x - 8, 2, z), 14, 0x5bb8ec, 5, 3));
    }
  }
  scene.add(frame);

  // --- velocity vectors (used by both styles) ---
  const arrowGeo = new THREE.ConeGeometry(h * 0.16, h * 0.7, 8);
  arrowGeo.rotateZ(-Math.PI / 2); // cone tip along +x
  arrows = new THREE.InstancedMesh(arrowGeo, new THREE.MeshStandardMaterial({ color: 0x0b1522, roughness: 0.5 }), n);
  arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(arrows);

  // --- clean 3D channel: floor, walls (channel floor and ceiling) and the fluid surface ---
  canal = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(mesh.length, 1, mesh.width),
    new THREE.MeshStandardMaterial({ color: 0xd3d6d0, roughness: 0.9 }));
  floor.position.y = -0.5;
  canal.add(floor);
  const canalWall = new THREE.MeshStandardMaterial({ color: 0x8296a6, roughness: 0.7 });
  const wallH = BASE_CANAL + WAVE_AMP + 1.5;
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(mesh.length + 2, wallH, 1.2), canalWall);
    wall.position.set(0, wallH / 2, s * (mesh.width / 2 + 0.6));
    canal.add(wall);
  }
  colorTex = new THREE.DataTexture(new Uint8Array(n * 4), nx, ny, THREE.RGBAFormat, THREE.UnsignedByteType);
  velTex = new THREE.DataTexture(new Uint16Array(n * 4), nx, ny, THREE.RGBAFormat, THREE.HalfFloatType);
  for (const t of [colorTex, velTex]) { t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; }
  colorTex.colorSpace = THREE.SRGBColorSpace;
  water = new THREE.Mesh(
    new THREE.PlaneGeometry(mesh.length, mesh.width, Math.min(400, nx * 4), Math.min(160, ny * 4)).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      vertexShader: FLUID_VERT,
      fragmentShader: FLUID_FRAG,
      uniforms: {
        uVel: { value: velTex }, uColor: { value: colorTex }, uTime: { value: 0 },
        uSize: { value: new THREE.Vector2(mesh.length, mesh.width) },
        uTexSize: { value: new THREE.Vector2(nx, ny) },
        uRelief: { value: 0 }, uWaveAmp: { value: WAVE_AMP }, uBase: { value: BASE_CANAL },
        uInlet: { value: mesh.inlet_vx }, uFlow: { value: FLOW_SCALE },
      },
    }));
  canal.add(water);
  scene.add(canal);

  // --- mesh lines (borders of the nx x ny cells) ---
  const gp = [];
  for (let i = 0; i <= nx; i++) {
    const x = -mesh.length / 2 + i * h;
    gp.push(x, 0, mesh.width / 2, x, 0, -mesh.width / 2);
  }
  for (let j = 0; j <= ny; j++) {
    const z = mesh.width / 2 - j * h;
    gp.push(-mesh.length / 2, 0, z, mesh.length / 2, 0, z);
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  gridLines = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4 }));
  scene.add(gridLines);

  // --- marker of the cell under the pointer: yellow fill and outline, always on top ---
  hover = new THREE.Group();
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(h, h).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.45, depthTest: false }));
  const r = h / 2;
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([[-r, 0, -r], [r, 0, -r], [r, 0, r], [-r, 0, r]].map(p => new THREE.Vector3(...p))),
    new THREE.LineBasicMaterial({ color: 0xffb000, depthTest: false }));
  fill.renderOrder = outline.renderOrder = 20;
  hover.add(fill, outline);
  hover.visible = false;
  scene.add(hover);

  tgtVx = new Float32Array(n); tgtVy = new Float32Array(n);
  curVx = new Float32Array(n); curVy = new Float32Array(n);

  el('meshDims').textContent = `${nx} × ${ny}`;
  el('unknowns').textContent = mesh.unknowns.toLocaleString('es');
  el('hval').textContent = `${h} m`;
  el('reh').textContent = (h * mesh.inlet_vx / mesh.nu).toFixed(1);
  el('meshInfo').innerHTML = `<b>Malla fija del informe:</b> ${nx} × ${ny} celdas de ${h} m (canal de ${mesh.length} × ${mesh.width} m), `
    + `${nx * ny} celdas × 2 componentes = ${mesh.unknowns.toLocaleString('es')} incógnitas.`;

  const rows = Object.entries(mesh.type_names).map(([t, name]) =>
    `<tr><td><span class="sw" style="background:#${TYPE_COLORS[t].toString(16).padStart(6, '0')}"></span></td>`
    + `<td>${t}</td><td>${name}</td><td class="num">${mesh.type_counts[t] ?? 0}</td></tr>`);
  el('typeTable').innerHTML = rows.join('');
  updateOmegaHelp();
  applyStyle(true);
}

function range(view) {
  const ref = mesh ? mesh.inlet_vx : 1;
  return view === 'vy' ? [-0.1 * ref, 0.1 * ref] : [0, ref];
}

function currentLUT(view) {
  return view === 'vy' ? LUTS.diverging : (style === 'canal' ? LUTS.water : LUTS.heat);
}

function updateLegend() {
  const view = el('view').value;
  const stops = view === 'vy' ? DIVERGING : (style === 'canal' ? WATER_RAMP : RAMP);
  const [lo, hi] = range(view);
  el('legendBar').style.background = `linear-gradient(to right, ${stops.join(',')})`;
  el('legendBar').style.display = view === 'type' ? 'none' : 'block';
  el('legendMin').textContent = view === 'type' ? '' : `${lo.toFixed(2)} m/s`;
  el('legendMax').textContent = view === 'type' ? '' : `${hi.toFixed(2)} m/s`;
}

// Show/hide the objects of each style and refresh what depends on the controls.
function applyStyle(refit = false) {
  const heat = style === 'heat';
  scene.background.setHex(heat ? HEAT_BG : CANAL_BG);
  if (cells) cells.visible = heat;
  if (frame) frame.visible = heat;
  if (canal) canal.visible = !heat;
  if (arrows) arrows.visible = el('vectors').checked && el('view').value !== 'type';
  if (gridLines) {
    gridLines.visible = el('grid').checked;
    gridLines.position.y = heat ? 0.95 : BASE_CANAL + 0.35;
    gridLines.material.color.setHex(heat ? 0xffffff : 0x0b2a4a);
  }
  el('styleHelp').textContent = heat
    ? 'Una caja por celda de la malla. Relieve: la altura crece con |V| y las cajas suben y bajan a medida que converge el método.'
    : 'El canal empieza vacío: el agua aparece donde el flujo calculado llega (|V| ≥ 0.03 m/s), con un frente que avanza desde la entrada, y queda seco donde el flujo se detiene (con este modelo, pasados ≈ 220 m). Las ondas se desplazan con la velocidad calculada (tiempo acelerado ×12). Relieve: oleaje que se desplaza, más alto donde el flujo es más rápido y en calma donde v = 0 (exagerado).';
  updateLegend();
  if (refit) fitView();
  dirty = true;
}

// Copies the solver state into the targets; the eased values are rendered from animate().
function paint(data) {
  if (!mesh || !tgtVx) return;
  const { nx, ny } = mesh;
  const clamp = v => Math.max(-1e3, Math.min(1e3, v)); // keeps a diverged run drawable
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      tgtVx[j * nx + i] = clamp(data.vx[j][i]);
      tgtVy[j * nx + i] = clamp(data.vy[j][i]);
    }
  }
}

// Draws the current (eased) field in the active style.
function renderField() {
  if (!mesh || !cells || !curVx) return;
  const { nx, ny } = mesh;
  const heat = style === 'heat';
  const view = el('view').value;
  const [lo, hi] = range(view);
  const relief = el('relief').checked;
  const lut = currentLUT(view);
  const inlet = mesh.inlet_vx;
  const texColor = heat ? null : colorTex.image.data;
  const texVel = heat ? null : velTex.image.data;
  const toHalf = THREE.DataUtils.toHalfFloat;
  const colorAttr = cells.instanceColor;

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const vx = curVx[k], vy = curVy[k], sp = Math.hypot(vx, vy);
      const s = Math.min(1, sp / inlet);
      const val = view === 'vx' ? vx : view === 'vy' ? vy : sp;
      const idx = Math.max(0, Math.min(LUT_SIZE - 1, Math.round((val - lo) / (hi - lo) * (LUT_SIZE - 1))));
      const top = heat ? (relief ? 0.4 + RELIEF_HEAT * s : 0.8) : BASE_CANAL; // the fluid surface is flat; waves are drawn by the shader
      const [x, z] = cellCenter(i, j);

      if (heat) {
        if (view === 'type') {
          const c = TYPE_COLORS[mesh.types[j][i]];
          colorAttr.setXYZ(k, ((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
        } else {
          colorAttr.setXYZ(k, lut.lin[3 * idx], lut.lin[3 * idx + 1], lut.lin[3 * idx + 2]);
        }
        dummy.position.set(x, top / 2, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, top, 1);
        dummy.updateMatrix();
        cells.setMatrixAt(k, dummy.matrix);
      } else {
        if (view === 'type') {
          const c = TYPE_COLORS[mesh.types[j][i]];
          texColor[4 * k] = (c >> 16) & 255; texColor[4 * k + 1] = (c >> 8) & 255; texColor[4 * k + 2] = c & 255;
        } else {
          texColor[4 * k] = lut.srgb[3 * idx]; texColor[4 * k + 1] = lut.srgb[3 * idx + 1]; texColor[4 * k + 2] = lut.srgb[3 * idx + 2];
        }
        texColor[4 * k + 3] = 255;
        texVel[4 * k] = toHalf(vx); texVel[4 * k + 1] = toHalf(vy); texVel[4 * k + 2] = toHalf(sp);
        texVel[4 * k + 3] = toHalf(Math.min(1, Math.max(0, (sp - WET_LO) / (WET_HI - WET_LO)))); // wetness: 1 where the flow has arrived
      }

      const shown = heat || sp >= WET_LO;  // no vectors over dry (not yet reached) cells
      dummy.position.set(x, top + 0.5, z);
      dummy.rotation.set(0, Math.atan2(vy, vx), 0);
      dummy.scale.setScalar(shown && s > 0.02 ? 0.25 + 0.75 * s : 0.0001);
      dummy.updateMatrix();
      arrows.setMatrixAt(k, dummy.matrix);
    }
  }
  arrows.instanceMatrix.needsUpdate = true;
  if (heat) {
    colorAttr.needsUpdate = true;
    cells.instanceMatrix.needsUpdate = true;
  } else {
    colorTex.needsUpdate = true;
    velTex.needsUpdate = true;
    water.material.uniforms.uRelief.value = relief ? 1 : 0;
  }
}

// Moves the shown velocities towards the solver state; re-renders only while something changes.
function easeField(dt) {
  if (!curVx) return;
  const a = 1 - Math.exp(-dt * 12);
  let moving = false;
  for (let k = 0; k < curVx.length; k++) {
    const dx = tgtVx[k] - curVx[k], dy = tgtVy[k] - curVy[k];
    if (Math.abs(dx) > 1e-5) { curVx[k] += dx * a; moving = true; }
    if (Math.abs(dy) > 1e-5) { curVy[k] += dy * a; moving = true; }
  }
  if (moving || dirty) { renderField(); dirty = false; }
}

function showState(data) {
  latest = data;
  paint(data);
  el('iter').textContent = data.iteration.toLocaleString('es');
  el('resid').textContent = data.residual === null ? '—' : data.residual.toExponential(2);
  const st = el('status');
  if (data.diverged) { st.textContent = 'Divergió: reduzca ω y reinicie'; st.className = 'badge bad'; }
  else if (data.converged) { st.textContent = `Convergió (residuo < ${data.tol.toExponential(0)})`; st.className = 'badge ok'; }
  else if (!running) { st.textContent = 'En pausa'; st.className = 'badge warning'; }
  else { st.textContent = 'Iterando…'; st.className = 'badge'; }
}

// ---------- controls ----------
function send(type, params = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, params }));
}

function currentParams() {
  return {
    omega: +el('omega').value, tol: +el('tol').value,
    initial_vx: +el('initial').value, sweeps_per_second: +el('sweeps').value,
  };
}

function updateOmegaHelp() {
  const om = +el('omega').value;
  el('omegaHelp').textContent = om >= 0.95
    ? 'Con esta malla (80 × 8, Re de celda = 5) el método no converge para ω ≥ 0.95 (diverge o el residuo no baja), incluido ω = 1 y la sobrerrelajación ω > 1.'
    : 'ω < 1: subrelajación. Con esta malla converge para ω ≤ 0.9 (lo más rápido cerca de 0.85).';
}
updateOmegaHelp();

el('omega').addEventListener('input', () => {
  el('omegaV').textContent = (+el('omega').value).toFixed(2);
  updateOmegaHelp();
  if (performance.now() - lastSend > 80) { send('params', { omega: +el('omega').value }); lastSend = performance.now(); }
});
el('omega').addEventListener('change', () => send('params', { omega: +el('omega').value }));
el('tol').addEventListener('change', () => send('params', { tol: +el('tol').value }));
el('sweeps').addEventListener('input', () => {
  el('sweepsV').textContent = el('sweeps').value;
  send('params', { sweeps_per_second: +el('sweeps').value });
});
function restart() { running = true; el('pause').textContent = 'Pausar'; latest = null; send('reset', currentParams()); }
el('initial').addEventListener('change', restart);
el('reset').onclick = restart;
el('pause').onclick = () => {
  running = !running;
  el('pause').textContent = running ? 'Pausar' : 'Reanudar';
  send(running ? 'resume' : 'pause');
};
el('step').onclick = () => { running = false; el('pause').textContent = 'Reanudar'; send('step'); };
el('style').addEventListener('change', () => { style = el('style').value; applyStyle(true); });
for (const id of ['view', 'vectors', 'relief', 'grid']) el(id).addEventListener('change', () => applyStyle(false));
updateLegend();

function connect() {
  socket = new WebSocket(API);
  socket.onopen = () => {
    el('status').textContent = 'Conectado al solver Python';
    el('status').className = 'badge ok';
    running = true;
    el('pause').textContent = 'Pausar';
    send('reset', currentParams());
  };
  socket.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'mesh') { latest = null; mesh = msg.data; buildScene(); }
    else if (msg.type === 'state') showState(msg.data);
    else if (msg.type === 'error') {
      el('status').textContent = `Error: ${msg.message}`;
      el('status').className = 'badge bad';
    }
  };
  socket.onclose = () => {
    el('status').textContent = 'Desconectado — inicie el backend';
    el('status').className = 'badge warning';
    setTimeout(connect, 1500);
  };
}
connect();

// ---------- pointer inspector ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pickPoint = new THREE.Vector3();

function speedAt(i, j) {
  const k = j * mesh.nx + i;
  return Math.hypot(curVx[k], curVy[k]);
}

// Height of the drawn surface over cell (i, j).
function topAt(i, j) {
  if (style === 'heat') return el('relief').checked ? 0.4 + RELIEF_HEAT * Math.min(1, speedAt(i, j) / mesh.inlet_vx) : 0.8;
  return speedAt(i, j) >= WET_HI ? BASE_CANAL : 0.15;
}

// Cell whose column of the mesh the ray crosses at height y, or null if it is outside the channel.
function cellAtHeight(y) {
  pickPlane.constant = -y;
  if (!raycaster.ray.intersectPlane(pickPlane, pickPoint)) return null;
  const i = Math.floor((pickPoint.x + mesh.length / 2) / mesh.h);
  const j = Math.floor((mesh.width / 2 - pickPoint.z) / mesh.h);
  return i < 0 || j < 0 || i >= mesh.nx || j >= mesh.ny ? null : { i, j };
}

// Cell (i, j) under the pointer in the active style, or null.
function pickCell(e) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  if (style === 'canal') {
    // The fluid surface is drawn above the floor, so intersect the ray with that level (exact even
    // in an oblique view); over cells the flow has not reached, the visible surface is the floor.
    let cell = cellAtHeight(BASE_CANAL);
    if (cell && speedAt(cell.i, cell.j) < WET_HI) cell = cellAtHeight(0.15);
    return cell;
  }
  const hit = raycaster.intersectObject(cells, false)[0];
  if (hit && hit.instanceId !== undefined) return { i: hit.instanceId % mesh.nx, j: Math.floor(hit.instanceId / mesh.nx) };
  // The boxes leave a thin gap between cells: fall back to the mesh plane so the cell does not flicker.
  return cellAtHeight(0.8);
}

renderer.domElement.addEventListener('pointermove', e => {
  if (!cells || !latest || !mesh || !curVx) return;
  const tip = el('tooltip');
  const cell = pickCell(e);
  if (!cell) { tip.style.display = 'none'; hover.visible = false; return; }
  const { i, j } = cell;
  const vx = latest.vx[j][i], vy = latest.vy[j][i], sp = Math.hypot(vx, vy);
  const type = mesh.types[j][i];
  const [cx, cz] = cellCenter(i, j);
  hover.position.set(cx, topAt(i, j) + 0.8, cz);
  hover.visible = true;
  el('pc').textContent = `(${i}, ${j})`;
  el('pt').textContent = `${type} · ${mesh.type_names[type]}`;
  el('px').textContent = `${((i + 0.5) * mesh.h).toFixed(1)} m`;
  el('py').textContent = `${((j + 0.5) * mesh.h).toFixed(1)} m`;
  el('pu').textContent = vx.toFixed(4);
  el('pv').textContent = vy.toFixed(4);
  el('ps').textContent = sp.toFixed(4);
  tip.style.display = 'block';
  tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 230)}px`;
  tip.style.top = `${Math.min(e.clientY + 14, innerHeight - 150)}px`;
  tip.innerHTML = `<b>Celda (${i}, ${j})</b> · tipo ${type}: ${mesh.type_names[type]}<br>`
    + `centro: x = ${((i + 0.5) * mesh.h).toFixed(1)} m, y = ${((j + 0.5) * mesh.h).toFixed(1)} m<br>`
    + `sustitución: ${TYPE_RULES[type]}<br>`
    + `vx = ${vx.toFixed(4)} m/s · vy = ${vy.toFixed(4)} m/s<br>|V| = ${sp.toFixed(4)} m/s`;
});
renderer.domElement.addEventListener('pointerleave', () => { el('tooltip').style.display = 'none'; if (hover) hover.visible = false; });

addEventListener('resize', fitView);

let lastFrame = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  flowTime += dt;
  if (water) water.material.uniforms.uTime.value = flowTime;
  easeField(dt);
  controls.update();
  renderer.render(scene, camera);
}
animate();
