import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

const API = 'ws://127.0.0.1:8000/ws/sim';

const app = document.querySelector('#app');
app.innerHTML = `
<div class="panel">
  <h1>Canal de agua — Simulación numérica</h1>
  <div class="subtitle">Modelo 2D de aguas someras derivado de Navier–Stokes + diferencias finitas</div>

  <div class="section">
    <div class="row">
      <button id="toggleWater">Cerrar llave</button>
      <button id="reset">Reiniciar</button>
    </div>
  </div>

  <div class="section">
    <label>Presión de entrada (kPa): <b id="pressureV">15.0</b></label>
    <input id="pressure" type="range" min="0" max="50" step="0.5" value="15">

    <label>Tamaño de la llave / manguera (m): <b id="hoseV">1.5</b></label>
    <input id="hose" type="range" min="0.3" max="10" step="0.1" value="1.5">

    <label>Gravedad (m/s²): <b id="gravityV">9.81</b></label>
    <input id="gravity" type="range" min="0" max="20" step="0.01" value="9.81">
    <div class="help" id="gravityHelp"></div>

    <label>Viento en X (m/s): <b id="windV">0</b></label>
    <input id="wind" type="range" min="-20" max="20" step="0.5" value="0">

    <label>Viento en Y (m/s): <b id="windYV">0</b></label>
    <input id="windY" type="range" min="-20" max="20" step="0.5" value="0">
    <div class="row" style="align-items:center; gap:10px; margin-top:6px">
      <div class="compass"><div id="windArrow" class="compass-arrow"></div></div>
      <div class="help">Magnitud del viento: <b id="windMagV">0.0</b> m/s — partículas en el agua muestran la deriva.</div>
    </div>

    <label>Lluvia (mm/h): <b id="rainV">0</b></label>
    <input id="rain" type="range" min="0" max="400" step="5" value="0">

    <label>Sol / evaporación (0–1): <b id="sunV">0</b></label>
    <input id="sun" type="range" min="0" max="1" step="0.05" value="0">

    <label>Tipo de piso</label>
    <select id="floor">
      <option value="concrete">Concreto (n=0.013)</option>
      <option value="asphalt">Asfalto (n=0.016)</option>
      <option value="soil">Tierra (n=0.030)</option>
      <option value="gravel">Grava (n=0.035)</option>
      <option value="smooth">Superficie lisa (n=0.010)</option>
      <option value="wood">Madera (n=0.012)</option>
    </select>
  </div>

  <div class="section">
    <div class="badge">Dimensiones físicas: 400 × 40 m</div>
    <div class="badge">Malla computacional inicial: 160 × 16 celdas</div>
    <div class="badge" id="status">Conectando...</div>
    <div class="badge" id="overflowBadge" style="display:none">⚠ Desbordamiento por las paredes</div>
    <div class="metric">
      <div><span>Tiempo simulado</span><strong id="time">0.00 s</strong></div>
      <div><span>Δt estable</span><strong id="dt">0.000 s</strong></div>
      <div><span>Velocidad entrada</span><strong id="inlet">0.00 m/s</strong></div>
      <div><span>Caudal aprox.</span><strong id="flow">0.00 m³/s</strong></div>
      <div><span>Ancho de entrada</span><strong id="inletWidth">— m</strong></div>
      <div><span>Desborde</span><strong id="overflow">0.00 m³/s</strong></div>
    </div>
  </div>

  <div class="section">
    <b style="font-size:12px">Puntero de consulta</b>
    <div class="help">Mueve el cursor sobre el agua para consultar posición, profundidad, velocidad y presión hidrostática.</div>
    <div class="metric">
      <div><span>x</span><strong id="px">—</strong></div>
      <div><span>y</span><strong id="py">—</strong></div>
      <div><span>profundidad h</span><strong id="ph">—</strong></div>
      <div><span>velocidad |V|</span><strong id="ps">—</strong></div>
      <div><span>u</span><strong id="pu">—</strong></div>
      <div><span>v</span><strong id="pv">—</strong></div>
      <div><span>presión</span><strong id="pp">—</strong></div>
      <div><span>celda</span><strong id="pc">—</strong></div>
    </div>
  </div>

  <div class="section help">
    <b>Interpretación:</b> la presión de entrada se convierte en velocidad de la manguera
    mediante una relación tipo Bernoulli; el tamaño de la llave fija el ancho real de esa
    entrada (más celdas forzadas = más caudal). Gravedad, viento y lluvia son entradas exógenas.
    El tipo de piso modifica la resistencia mediante el coeficiente de Manning. El sol se
    modela aquí únicamente como una tasa de evaporación <i>exagerada</i> para que se note en
    la demo (la evaporación real es de mm/día, no de mm/s). El viento usa un coeficiente de
    arrastre superficial también exagerado por la misma razón — ver <code>README.md</code>.
    Si la profundidad supera la altura de las paredes, el agua se desborda de verdad
    (sale del balance de masa, no solo se recorta visualmente).
  </div>
</div>
<div id="tooltip"></div>
`;

const el = id => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const BG_COLOR = 0xeef3f7;
const WALL_HEIGHT = 1.8; // must match backend WALL_HEIGHT (model.py) -- the real overflow threshold
// The channel is 400 x 40 m but depth differences of interest are ~0.1-1.5 m
// -- at that horizontal:vertical ratio a real depth change is nearly
// imperceptible from a normal viewing angle. This scales the *rendered*
// height of both the water and the walls (never the physics, never the
// values shown in the inspector) so changes in pressure/gravity/rain are
// actually visible, the same way a terrain map exaggerates elevation. Walls
// are scaled by the same factor so "water about to spill over the wall"
// stays visually true to the real overflow condition.
const VERTICAL_EXAGGERATION = 3.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG_COLOR);
scene.fog = new THREE.Fog(BG_COLOR, 420, 950);

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 1500);
camera.position.set(230, 150, 280);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0xb7c4cf, 0.85));
const sunLight = new THREE.DirectionalLight(0xfff6e0, 1.4);
sunLight.position.set(80, 160, 100);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -230;
sunLight.shadow.camera.right = 230;
sunLight.shadow.camera.top = 230;
sunLight.shadow.camera.bottom = -230;
scene.add(sunLight);

// Channel floor: physical size 400 x 40 m, centered at origin.
// Each floor type gets a real base color plus a small procedural texture
// (canvas-generated, tiled) so the material reads as concrete/wood/gravel/etc
// instead of a flat color swatch.
const FLOOR_COLORS = {
  concrete: 0xb9c0c6,
  asphalt: 0x35373b,
  soil: 0x8a5a34,
  gravel: 0xa89a83,
  smooth: 0xd7e2e8,
  wood: 0xa9713f,
};
const FLOOR_ROUGHNESS = {
  concrete: .92, asphalt: .85, soil: .97, gravel: .95, smooth: .55, wood: .5,
};

function makeFloorTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const base = new THREE.Color(FLOOR_COLORS[kind] ?? FLOOR_COLORS.concrete);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, 256, 256);

  if (kind === 'wood') {
    // Horizontal planks with a hand-drawn wood grain.
    const plankH = 32;
    for (let y = 0; y < 256; y += plankH) {
      ctx.strokeStyle = 'rgba(35,18,6,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
      for (let i = 0; i < 14; i++) {
        const gy = y + 3 + Math.random() * (plankH - 6);
        ctx.strokeStyle = `rgba(60,32,12,${0.08 + Math.random() * 0.12})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, gy + (Math.random() - 0.5) * 5);
        ctx.stroke();
      }
    }
  } else {
    // Speckle/noise texture: density and contrast tuned per material.
    const density = { concrete: 1400, asphalt: 2600, soil: 1000, gravel: 2200, smooth: 250 }[kind] ?? 1200;
    const contrast = { concrete: 22, asphalt: 26, soil: 34, gravel: 55, smooth: 12 }[kind] ?? 20;
    for (let i = 0; i < density; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const shade = (Math.random() - 0.5) * contrast;
      ctx.fillStyle = shade > 0
        ? `rgba(255,255,255,${Math.min(0.3, shade / 40)})`
        : `rgba(0,0,0,${Math.min(0.3, -shade / 40)})`;
      const r = kind === 'gravel' ? 1 + Math.random() * 2.2 : 0.5 + Math.random() * 0.9;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(kind === 'wood' ? 16 : 14, kind === 'wood' ? 1.6 : 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const floorTextureCache = {};
function getFloorTexture(kind) {
  if (!floorTextureCache[kind]) floorTextureCache[kind] = makeFloorTexture(kind);
  return floorTextureCache[kind];
}

const floorGeo = new THREE.BoxGeometry(400, 1.0, 40);
const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.position.y = -0.5;
floor.receiveShadow = true;
scene.add(floor);

function setFloorColor(key) {
  floorMat.map = getFloorTexture(key);
  floorMat.roughness = FLOOR_ROUGHNESS[key] ?? 0.9;
  floorMat.needsUpdate = true;
}

// Side walls: drawn at WALL_HEIGHT * VERTICAL_EXAGGERATION so "water about
// to top the wall" on screen matches the real overflow condition (h >
// WALL_HEIGHT in the solver), even though the water's displayed height is
// itself exaggerated for visibility (see VERTICAL_EXAGGERATION above).
const WALL_TOP = WALL_HEIGHT * VERTICAL_EXAGGERATION;
for (const z of [-20.5, 20.5]) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(400, WALL_TOP + 0.5, 1),
    new THREE.MeshStandardMaterial({ color: 0x8296a6, roughness: .7 })
  );
  wall.position.set(0, (WALL_TOP - 0.5) / 2, z);
  wall.castShadow = true;
  scene.add(wall);
}

// Hose + valve share a parent group pivoted at the outlet, so the "hose
// size" slider can scale the whole assembly without moving the nozzle tip
// (which has to stay put — it is where the jet particles spawn). Positioned
// above the (exaggerated) wall height so it visibly pours in from above it.
const HOSE_Y = WALL_TOP + 1.2;
const faucetGroup = new THREE.Group();
faucetGroup.position.set(-200, HOSE_Y, 0);
scene.add(faucetGroup);

// Hose: short cylinder with visible outlet.
const hose = new THREE.Mesh(
  new THREE.CylinderGeometry(0.65, 0.65, 8, 24),
  new THREE.MeshStandardMaterial({ color: 0x222831, roughness: .7 })
);
hose.rotation.z = Math.PI / 2;
hose.position.set(-4, 0, 0);
faucetGroup.add(hose);

// --- Water valve (faucet): visually opens/closes with "toggleWater". ---
const valveGroup = new THREE.Group();
valveGroup.position.set(-10, 0, 0);
faucetGroup.add(valveGroup);

const BASE_HOSE_DIAMETER = 1.5; // matches backend Params.hose_diameter default
function setValveSize(diameterM) {
  const scale = Math.min(2.2, Math.max(0.4, diameterM / BASE_HOSE_DIAMETER));
  faucetGroup.scale.setScalar(scale);
}

const valveBody = new THREE.Mesh(
  new THREE.CylinderGeometry(1.1, 1.1, 1.6, 20),
  new THREE.MeshStandardMaterial({ color: 0x596471, metalness: .5, roughness: .4 })
);
valveBody.rotation.z = Math.PI / 2;
valveGroup.add(valveBody);

const wheelMat = new THREE.MeshStandardMaterial({ color: 0xb33b3b, metalness: .25, roughness: .5 });
const wheelPivot = new THREE.Group();
wheelPivot.position.x = -1.0;
valveGroup.add(wheelPivot);

const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.18, 12, 28), wheelMat);
wheelRim.rotation.y = Math.PI / 2;
wheelPivot.add(wheelRim);
for (let k = 0; k < 4; k++) {
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.18), wheelMat);
  spoke.rotation.x = k * Math.PI / 4;
  wheelPivot.add(spoke);
}

// Small indicator light next to the valve: green = open, red = closed.
const indicatorMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x1a8a4c, emissiveIntensity: .9 });
const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), indicatorMat);
indicator.position.set(0, 3.2, 0);
valveGroup.add(indicator);

let wheelTargetAngle = 0; // radians; spins a quarter turn per open/close.

function setValveVisual(isOpen) {
  wheelTargetAngle += isOpen ? Math.PI / 2 : -Math.PI / 2;
  indicatorMat.color.setHex(isOpen ? 0x2ecc71 : 0xe74c3c);
  indicatorMat.emissive.setHex(isOpen ? 0x1a8a4c : 0x9c2a1f);
}

// --- Water jet: small particle spray at the outlet, purely visual. ---
const JET_COUNT = 140;
const jetGeo = new THREE.BufferGeometry();
const jetPositions = new Float32Array(JET_COUNT * 3);
const jetState = new Float32Array(JET_COUNT * 4); // vx, vy, vz, age
for (let i = 0; i < JET_COUNT; i++) {
  jetState[i * 4 + 3] = 999; // start "dead", eligible to respawn once water is flowing
  jetPositions[i * 3 + 1] = -50; // park below the floor until first respawn
}
jetGeo.setAttribute('position', new THREE.BufferAttribute(jetPositions, 3));
const jetMat = new THREE.PointsMaterial({ color: 0x5bb8ec, size: 0.55, transparent: true, opacity: .85 });
const jet = new THREE.Points(jetGeo, jetMat);
scene.add(jet);
const OUTLET = new THREE.Vector3(-200, HOSE_Y, 0);

// FrontSide + depthWrite:false avoids the flicker/z-fighting that a
// dynamic, transparent, double-sided mesh otherwise shows: WebGL has no
// per-triangle sort for transparent objects, so overlapping front/back
// faces of the same wavy surface "fight" for which one wins the depth
// test, which reads as a random glinting/strobing artifact as the camera
// or the wave shape changes. Depth-based vertex colors (set per frame)
// give a more realistic look — shallow water reads lighter/greener,
// deeper water reads darker blue — without needing an environment map.
const waterMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, vertexColors: true, transparent: true, opacity: .90,
  roughness: .22, metalness: .0, clearcoat: .4, clearcoatRoughness: .3,
  side: THREE.FrontSide, depthWrite: false,
});
const SHALLOW_COLOR = new THREE.Color(0x6fc6e0);
const DEEP_COLOR = new THREE.Color(0x063a6e);
const WATER_Y_OFFSET = 0.015; // lifts the mesh clear of the dry floor (avoids z-fighting)
// Color used a per-frame max(h) as its reference before, so the gradient
// always spanned light-to-dark regardless of the *absolute* depth -- raising
// the pressure or gravity changed the real depth a lot (verified against the
// solver directly) but looked identical, because the color always
// re-normalized to whatever the current peak was. Anchoring the gradient to
// a fixed physical depth fixes that: shallow water now reads visibly lighter
// than a deep pool, and stays that way as parameters change.
const COLOR_REF_DEPTH = WALL_HEIGHT * 0.6;

let waterMesh = null;
let latest = null;
let socket = null;
let waterOn = true;
let lastSend = 0;
let overflowSpots = []; // [{x, side}] cells currently pinned at WALL_HEIGHT, refreshed each server update

// The numerical grid (data.nx x data.ny, ~2.5 m per cell) looks faceted and
// blocky if rendered directly at 400x40 m scale. This bilinearly upsamples
// the depth field onto a finer *visual* grid only — the physics still runs
// on the coarse solver grid; this interpolation is purely cosmetic, in the
// same spirit as decoupling the numerical mesh from the render mesh.
const VFX = 2, VFY = 4; // visual upsample factor per axis (y is coarser, needs more)

function upsampleGrid(h, nx, ny, fx, fy) {
  const nx2 = (nx - 1) * fx + 1;
  const ny2 = (ny - 1) * fy + 1;
  const out = new Float32Array(nx2 * ny2);
  for (let jj = 0; jj < ny2; jj++) {
    const gy = jj / fy;
    const j0 = Math.min(ny - 2, Math.floor(gy));
    const ty = gy - j0;
    for (let ii = 0; ii < nx2; ii++) {
      const gx = ii / fx;
      const i0 = Math.min(nx - 2, Math.floor(gx));
      const tx = gx - i0;
      const h00 = h[j0][i0], h10 = h[j0][i0 + 1];
      const h01 = h[j0 + 1][i0], h11 = h[j0 + 1][i0 + 1];
      const hx0 = h00 * (1 - tx) + h10 * tx;
      const hx1 = h01 * (1 - tx) + h11 * tx;
      out[jj * nx2 + ii] = hx0 * (1 - ty) + hx1 * ty;
    }
  }
  return { h: out, nx: nx2, ny: ny2 };
}

function buildWater(vg) {
  if (waterMesh) scene.remove(waterMesh);
  const { nx, ny } = vg;
  const positions = new Float32Array(nx * ny * 3);
  const colors = new Float32Array(nx * ny * 3);
  for (let j=0; j<ny; j++) {
    const z = -20 + (j/(ny-1))*40;
    for (let i=0; i<nx; i++) {
      const x = -200 + (i/(nx-1))*400;
      const k = j*nx+i;
      positions[3*k] = x;
      positions[3*k+1] = WATER_Y_OFFSET;
      positions[3*k+2] = z;
      colors[3*k] = colors[3*k+1] = colors[3*k+2] = 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex([]);
  waterMesh = new THREE.Mesh(geo, waterMat);
  waterMesh.receiveShadow = true;
  waterMesh.userData.nx = nx;
  waterMesh.userData.ny = ny;
  scene.add(waterMesh);
}

function updateWater(data) {
  latest = data;
  const vg = upsampleGrid(data.h, data.nx, data.ny, VFX, VFY);
  if (!waterMesh || waterMesh.userData.nx !== vg.nx || waterMesh.userData.ny !== vg.ny) {
    buildWater(vg);
  }
  const { nx, ny, h } = vg;
  const pos = waterMesh.geometry.attributes.position.array;
  const col = waterMesh.geometry.attributes.color.array;
  const indices = [];
  const tsec = data.t;

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const depth = h[k];
      // Cosmetic surface ripple, NOT part of the solver output: a couple of
      // travelling sine waves whose amplitude grows with local depth, so a
      // near-empty film stays flat and a deep pool visibly chops. Purely a
      // rendering detail layered on top of the physical height.
      const rippleAmp = Math.min(0.05, depth * 0.06);
      const ripple = depth > 0.01
        ? rippleAmp * (Math.sin(i * 0.35 + tsec * 2.2) + Math.sin(j * 0.6 - tsec * 1.6)) * 0.5
        : 0;
      pos[3 * k + 1] = (depth + ripple) * VERTICAL_EXAGGERATION + WATER_Y_OFFSET;
      const t = Math.min(1, depth / COLOR_REF_DEPTH);
      const c = SHALLOW_COLOR.clone().lerp(DEEP_COLOR, t);
      col[3 * k] = c.r; col[3 * k + 1] = c.g; col[3 * k + 2] = c.b;
    }
  }
  for (let j=0; j<ny-1; j++) {
    for (let i=0; i<nx-1; i++) {
      const a=j*nx+i, b=a+1, c=a+nx, d=c+1;
      // Only draw a quad's two triangles where at least one corner is wet,
      // so the dry floor shows through instead of a flat film at y=0.
      const wet = h[a] > 0.004 || h[b] > 0.004 || h[c] > 0.004 || h[d] > 0.004;
      if (wet) indices.push(a,c,b,b,c,d);
    }
  }
  waterMesh.geometry.setIndex(indices);
  waterMesh.geometry.attributes.position.needsUpdate = true;
  waterMesh.geometry.attributes.color.needsUpdate = true;
  waterMesh.geometry.computeVertexNormals();

  el('time').textContent = `${data.t.toFixed(2)} s`;
  el('dt').textContent = `${data.dt.toFixed(4)} s`;
  el('inlet').textContent = `${data.inlet_velocity.toFixed(2)} m/s`;
  el('flow').textContent = `${data.flow_rate_approx.toFixed(3)} m³/s`;
  el('inletWidth').textContent = `${data.inlet_width.toFixed(2)} m`;
  el('overflow').textContent = `${data.overflow_rate.toFixed(3)} m³/s`;
  el('overflowBadge').style.display = data.overflow_rate > 0.001 ? 'block' : 'none';

  // Find where the water is actually pinned at the wall height (the backend
  // clips h to WALL_HEIGHT exactly at overflowing cells), so the spill
  // particles fall from the real location instead of a generic spot.
  overflowSpots = [];
  if (data.overflow_rate > 0.001) {
    const ny = data.ny, nx = data.nx;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (data.h[j][i] >= data.wall_height - 0.02) {
          overflowSpots.push({
            x: -200 + (i / (nx - 1)) * 400,
            side: j < ny / 2 ? -1 : 1, // spill over the nearer wall
          });
        }
      }
    }
  }
}

function params() {
  return {
    pressure_kpa: +el('pressure').value,
    gravity: +el('gravity').value,
    wind_mps: +el('wind').value,
    wind_y_mps: +el('windY').value,
    rain_mm_h: +el('rain').value,
    sun: +el('sun').value,
    floor: el('floor').value,
    water_on: waterOn,
    hose_diameter: +el('hose').value,
  };
}

function send(type='params') {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, params: params() }));
}

function connect() {
  socket = new WebSocket(API);
  socket.onopen = () => {
    el('status').textContent = 'Conectado al solver Python';
    el('status').className = 'badge ok';
    send();
  };
  socket.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state') updateWater(msg.data);
  };
  socket.onclose = () => {
    el('status').textContent = 'Desconectado — inicia el backend';
    el('status').className = 'badge warning';
    setTimeout(connect, 1500);
  };
}
connect();

function updateWindCompass() {
  const wx = +el('wind').value, wy = +el('windY').value;
  const mag = Math.hypot(wx, wy);
  el('windMagV').textContent = mag.toFixed(1);
  const angleDeg = mag > 0.05 ? Math.atan2(wy, wx) * 180 / Math.PI : 0;
  const len = Math.min(17, 6 + mag * 0.6);
  const arrow = el('windArrow');
  arrow.style.height = `${len}px`;
  arrow.style.transform = `translate(-50%, -100%) rotate(${90 - angleDeg}deg) scaleY(${mag > 0.05 ? 1 : 0})`;
}

['pressure','gravity','wind','windY','rain','sun','hose'].forEach(id => {
  const input = el(id);
  const out = el(id+'V');
  input.addEventListener('input', () => {
    out.textContent = input.value;
    if (id === 'gravity') updateGravityHelp(+input.value);
    if (id === 'hose') setValveSize(+input.value);
    if (id === 'wind' || id === 'windY') updateWindCompass();
    if (id === 'sun') setSunVisual(+input.value);
    if (performance.now() - lastSend > 80) { send(); lastSend = performance.now(); }
  });
});
updateWindCompass();
el('floor').addEventListener('change', () => { setFloorColor(el('floor').value); send(); });
setFloorColor(el('floor').value);
setValveSize(+el('hose').value);

function updateGravityHelp(g) {
  const help = el('gravityHelp');
  if (g < 0.3) {
    help.textContent = 'g≈0: sin presión hidrostática (∝ g·h) el chorro no tiene fuerza para esparcirse lateralmente — el modelo de aguas someras pierde sentido físico en este límite, no es un error del solver.';
  } else if (g < 4) {
    help.textContent = 'Gravedad baja (tipo Luna/Marte): el agua se esparce y ondula más lento, columnas más altas antes de caer.';
  } else {
    help.textContent = '';
  }
}
updateGravityHelp(9.81);

el('toggleWater').onclick = () => {
  waterOn = !waterOn;
  el('toggleWater').textContent = waterOn ? 'Cerrar llave' : 'Abrir llave';
  el('toggleWater').classList.toggle('active', !waterOn);
  setValveVisual(waterOn);
  send();
};
el('reset').onclick = () => send('reset');

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Visual marker that follows the pointer on the water surface.
const marker = new THREE.Mesh(
  new THREE.SphereGeometry(0.9, 16, 16),
  new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x8a6200, emissiveIntensity: .6 })
);
marker.visible = false;
scene.add(marker);

renderer.domElement.addEventListener('pointermove', e => {
  if (!waterMesh || !latest) { marker.visible = false; return; }
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(waterMesh, false)[0];
  if (!hit) { marker.visible = false; el('tooltip').style.display = 'none'; return; }

  marker.visible = true;
  marker.position.set(hit.point.x, hit.point.y + 0.15, hit.point.z);

  const x = hit.point.x + 200;
  const y = hit.point.z + 20;
  const i = Math.max(0, Math.min(latest.nx-1, Math.round(x/latest.dx)));
  const j = Math.max(0, Math.min(latest.ny-1, Math.round(y/latest.dy)));
  const h = latest.h[j][i];
  const s = latest.speed[j][i];

  el('px').textContent = `${x.toFixed(1)} m`;
  el('py').textContent = `${y.toFixed(1)} m`;
  el('ph').textContent = `${h.toFixed(3)} m`;
  el('ps').textContent = `${s.toFixed(3)} m/s`;
  el('pu').textContent = `${latest.u[j][i].toFixed(3)} m/s`;
  el('pv').textContent = `${latest.v[j][i].toFixed(3)} m/s`;
  el('pp').textContent = `${latest.pressure_kpa[j][i].toFixed(3)} kPa`;
  el('pc').textContent = `(${i}, ${j})`;

  const tip = el('tooltip');
  tip.style.display = 'block';
  tip.style.left = `${Math.min(e.clientX+14, innerWidth-210)}px`;
  tip.style.top = `${Math.min(e.clientY+14, innerHeight-120)}px`;
  tip.innerHTML = `<b>Celda (${i}, ${j})</b><br>h = ${h.toFixed(3)} m<br>|V| = ${s.toFixed(3)} m/s<br>p ≈ ${latest.pressure_kpa[j][i].toFixed(3)} kPa`;
});
renderer.domElement.addEventListener('pointerleave', () => {
  el('tooltip').style.display = 'none';
  marker.visible = false;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Sun: a single billboard sprite (radial glow + baked rays), driven by
// the "sun" slider. Also drives the directional light intensity, so a
// brighter sun both looks brighter and evaporates faster (see model.py).
function makeSunTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const cx = 128, cy = 128;
  ctx.save();
  ctx.translate(cx, cy);
  for (let k = 0; k < 16; k++) {
    ctx.rotate(Math.PI * 2 / 16);
    const len = 85 + (k % 2 === 0 ? 35 : 0);
    const grad = ctx.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0, 'rgba(255,230,150,0.55)');
    grad.addColorStop(1, 'rgba(255,230,150,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.lineTo(0, -len);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 55);
  g.addColorStop(0, 'rgba(255,250,225,1)');
  g.addColorStop(0.5, 'rgba(255,226,150,0.65)');
  g.addColorStop(1, 'rgba(255,226,150,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 55, 0, Math.PI * 2); ctx.fill();
  return new THREE.CanvasTexture(c);
}
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeSunTexture(), transparent: true, depthWrite: false,
  depthTest: false, blending: THREE.AdditiveBlending, opacity: .4,
}));
sunSprite.renderOrder = 999;
const SUN_DIR = new THREE.Vector3(80, 160, 100).normalize();
sunSprite.position.copy(SUN_DIR.clone().multiplyScalar(420));
sunSprite.scale.setScalar(120);
scene.add(sunSprite);

function setSunVisual(sun) {
  sunLight.intensity = 0.5 + sun * 1.6;
  sunSprite.material.opacity = 0.3 + sun * 0.7;
  sunSprite.scale.setScalar(95 + sun * 75);
}
setSunVisual(0);

// --- Wind: debris/foam particles drifting across the water surface in the
// (wind_mps, wind_y_mps) direction. Purely cosmetic (the solver's own,
// physically-tied wind stress on u/v is much smaller — see model.py — this
// is what actually lets you *see* the wind, as requested).
const WIND_COUNT = 90;
const windGeo = new THREE.BufferGeometry();
const windPositions = new Float32Array(WIND_COUNT * 3);
const windAge = new Float32Array(WIND_COUNT);
const windVel = new Float32Array(WIND_COUNT * 2);
for (let i = 0; i < WIND_COUNT; i++) { windPositions[i * 3 + 1] = -50; windAge[i] = 999; }
windGeo.setAttribute('position', new THREE.BufferAttribute(windPositions, 3));
const windMat = new THREE.PointsMaterial({ color: 0xfbfdff, size: 0.9, transparent: true, opacity: .85 });
const windParticles = new THREE.Points(windGeo, windMat);
scene.add(windParticles);

function updateWindParticles(dtFrame) {
  const wx = +el('wind').value, wy = +el('windY').value;
  const mag = Math.hypot(wx, wy);
  const positions = windGeo.attributes.position.array;
  for (let i = 0; i < WIND_COUNT; i++) {
    windAge[i] += dtFrame;
    if (mag > 0.3 && windAge[i] > 2.0 + Math.random() * 2.5) {
      positions[i * 3] = -200 + Math.random() * 400;
      positions[i * 3 + 1] = 0.4 + Math.random() * 0.5;
      positions[i * 3 + 2] = -20 + Math.random() * 40;
      windVel[i * 2] = wx * 0.55;
      windVel[i * 2 + 1] = wy * 0.55;
      windAge[i] = 0;
    }
    positions[i * 3] += windVel[i * 2] * dtFrame;
    positions[i * 3 + 2] += windVel[i * 2 + 1] * dtFrame;
    if (Math.abs(positions[i * 3]) > 205 || Math.abs(positions[i * 3 + 2]) > 22) windAge[i] = 999;
  }
  windGeo.attributes.position.needsUpdate = true;
}

// --- Rain: falling particles, density scaled with the rain_mm_h slider.
const RAIN_COUNT = 600;
const rainGeo = new THREE.BufferGeometry();
const rainPositions = new Float32Array(RAIN_COUNT * 3);
const rainVelY = new Float32Array(RAIN_COUNT);
for (let i = 0; i < RAIN_COUNT; i++) rainPositions[i * 3 + 1] = -50;
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
const rainMat = new THREE.PointsMaterial({ color: 0x8fc9e6, size: 0.45, transparent: true, opacity: .55 });
const rainParticles = new THREE.Points(rainGeo, rainMat);
scene.add(rainParticles);
const RAIN_TOP = 70;

function updateRain(dtFrame) {
  const intensity = +el('rain').value; // mm/h, slider max 400
  const activeCount = Math.round(Math.min(1, intensity / 400) * RAIN_COUNT);
  const positions = rainGeo.attributes.position.array;
  for (let i = 0; i < RAIN_COUNT; i++) {
    if (i >= activeCount) { positions[i * 3 + 1] = -50; continue; }
    if (positions[i * 3 + 1] < 0 || positions[i * 3 + 1] > RAIN_TOP) {
      positions[i * 3] = -200 + Math.random() * 400;
      positions[i * 3 + 1] = RAIN_TOP * (0.3 + Math.random() * 0.7);
      positions[i * 3 + 2] = -20 + Math.random() * 40;
      rainVelY[i] = -(20 + Math.random() * 10);
    }
    positions[i * 3 + 1] += rainVelY[i] * dtFrame;
  }
  rainGeo.attributes.position.needsUpdate = true;
}

// --- Mist: faint rising particles over the wet area near the inlet, a
// visual cue for evaporation, spawned only when the sun is on.
const MIST_COUNT = 50;
const mistGeo = new THREE.BufferGeometry();
const mistPositions = new Float32Array(MIST_COUNT * 3);
const mistAge = new Float32Array(MIST_COUNT);
for (let i = 0; i < MIST_COUNT; i++) { mistPositions[i * 3 + 1] = -50; mistAge[i] = 999; }
mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
const mistMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, transparent: true, opacity: .25 });
const mistParticles = new THREE.Points(mistGeo, mistMat);
scene.add(mistParticles);

function updateMist(dtFrame) {
  const sun = +el('sun').value;
  const positions = mistGeo.attributes.position.array;
  const wetSpanX = latest ? Math.max(20, latest.t * 3) : 20; // mist follows the wedge as it advances
  for (let i = 0; i < MIST_COUNT; i++) {
    mistAge[i] += dtFrame;
    if (sun > 0.05 && mistAge[i] > 1.2 + Math.random() * 2) {
      positions[i * 3] = -198 + Math.random() * Math.min(380, wetSpanX);
      positions[i * 3 + 1] = 0.3;
      positions[i * 3 + 2] = -14 + Math.random() * 28;
      mistAge[i] = 0;
    }
    positions[i * 3 + 1] += 0.7 * dtFrame;
    positions[i * 3 + 2] += Math.sin(mistAge[i] * 2 + i) * 0.15 * dtFrame;
    if (mistAge[i] > 3.5) mistAge[i] = 999;
  }
  mistGeo.attributes.position.needsUpdate = true;
  mistMat.opacity = 0.12 + sun * 0.28;
}

// --- Overflow spill: water visibly falling over the wall wherever the
// solver actually pins a cell at WALL_HEIGHT (see overflowSpots, filled in
// updateWater from the live h field). This is the visual counterpart of the
// real mass removed in model.py's overflow handling, not an independent effect.
const SPILL_COUNT = 220;
const spillGeo = new THREE.BufferGeometry();
const spillPositions = new Float32Array(SPILL_COUNT * 3);
const spillVel = new Float32Array(SPILL_COUNT * 3);
const spillAge = new Float32Array(SPILL_COUNT);
for (let i = 0; i < SPILL_COUNT; i++) { spillPositions[i * 3 + 1] = -80; spillAge[i] = 999; }
spillGeo.setAttribute('position', new THREE.BufferAttribute(spillPositions, 3));
const spillMat = new THREE.PointsMaterial({ color: 0x2f8fc9, size: 0.65, transparent: true, opacity: .85 });
const spillParticles = new THREE.Points(spillGeo, spillMat);
scene.add(spillParticles);

function updateSpill(dtFrame) {
  const positions = spillGeo.attributes.position.array;
  for (let i = 0; i < SPILL_COUNT; i++) {
    spillAge[i] += dtFrame;
    if (overflowSpots.length && spillAge[i] > 0.04 + Math.random() * 0.12) {
      const spot = overflowSpots[Math.floor(Math.random() * overflowSpots.length)];
      positions[i * 3] = spot.x + (Math.random() - 0.5) * 2.5;
      positions[i * 3 + 1] = WALL_TOP - 0.2;
      positions[i * 3 + 2] = spot.side * 20.4;
      spillVel[i * 3] = (Math.random() - 0.5) * 0.4;
      spillVel[i * 3 + 1] = -0.5 - Math.random() * 0.8;
      spillVel[i * 3 + 2] = spot.side * (2.5 + Math.random() * 2.5);
      spillAge[i] = 0;
    }
    positions[i * 3] += spillVel[i * 3] * dtFrame;
    positions[i * 3 + 1] += spillVel[i * 3 + 1] * dtFrame;
    spillVel[i * 3 + 1] -= 9.81 * dtFrame; // falls under (real) gravity once outside the channel
    positions[i * 3 + 2] += spillVel[i * 3 + 2] * dtFrame;
    if (positions[i * 3 + 1] < -6) spillAge[i] = 999; // hit the ground outside -> eligible to respawn
  }
  spillGeo.attributes.position.needsUpdate = true;
}

let lastFrame = performance.now();

function updateJet(dtFrame) {
  const g = latest ? +el('gravity').value : 9.81;
  const speed = latest ? latest.inlet_velocity : 0;
  const positions = jetGeo.attributes.position.array;

  for (let i = 0; i < JET_COUNT; i++) {
    const s = i * 4;
    jetState[s + 3] += dtFrame; // age

    if (waterOn && speed > 0.05 && jetState[s + 3] > 0.9 + Math.random() * 0.4 * (i % 5)) {
      // Respawn at the outlet with velocity scaled from the inlet speed.
      positions[i * 3] = OUTLET.x;
      positions[i * 3 + 1] = OUTLET.y;
      positions[i * 3 + 2] = OUTLET.z;
      jetState[s] = Math.min(Math.max(speed, 1.0), 8) * (0.8 + Math.random() * 0.4);
      jetState[s + 1] = (Math.random() - 0.5) * 0.6;
      jetState[s + 2] = (Math.random() - 0.5) * 1.2;
      jetState[s + 3] = 0;
    }

    positions[i * 3] += jetState[s] * dtFrame;
    positions[i * 3 + 1] += jetState[s + 1] * dtFrame;
    jetState[s + 1] -= g * dtFrame;
    positions[i * 3 + 2] += jetState[s + 2] * dtFrame;

    if (positions[i * 3 + 1] < 0) jetState[s + 3] = 999; // mark dead, will respawn
  }
  jetGeo.attributes.position.needsUpdate = true;
}

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dtFrame = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  controls.update();

  wheelPivot.rotation.x += (wheelTargetAngle - wheelPivot.rotation.x) * 0.15;
  updateJet(dtFrame);
  updateWindParticles(dtFrame);
  updateRain(dtFrame);
  updateMist(dtFrame);
  updateSpill(dtFrame);

  renderer.render(scene, camera);
}
animate();
