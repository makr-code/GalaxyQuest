/**
 * ColonySurfaceLevelWebGPU.js
 *
 * IZoomLevelRenderer — Colony Surface zoom level (Level 3), WebGPU backend.
 *
 * Depth-tested instanced city geometry on the galaxy's device, canvas and loop.
 * Server snapshots are authoritative; pedestrians and particles are cosmetic.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

function parseHexColor(hex, fallback) {
  const normalized = String(hex || '').trim();
  return /^#?[0-9a-f]{6}$/i.test(normalized)
    ? `#${normalized.replace(/^#/, '')}`
    : fallback;
}

function hexToRgbFloat(hex) {
  const normalized = parseHexColor(hex, '#7db7ee').replace('#', '');
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

/** Color, position, scale and reserved metadata: four vec4 values per cuboid. */
const BYTES_PER_SLOT = 64;

const COLONY_CITY_WGSL = `
struct Camera { viewProjection: mat4x4<f32>, transition: vec4<f32>, surface: vec4<f32> };
struct Instance { color: vec4<f32>, position: vec4<f32>, scale: vec4<f32>, extra: vec4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
struct Out { @builtin(position) position: vec4<f32>, @location(0) color: vec4<f32> };
fn surfacePoint(local: vec3<f32>) -> vec3<f32> {
  let radius = max(camera.transition.y, 0.001);
  let horizontal = local.xz;
  let distance = length(horizontal);
  let angle = distance / radius;
  var normal = vec3<f32>(0, 1, 0);
  if (distance > 0.0001) {
    let tangent = horizontal / distance;
    normal = vec3<f32>(tangent.x * sin(angle), cos(angle), tangent.y * sin(angle));
  }
  return normal * (radius + local.y) + vec3<f32>(0, -radius, 0);
}
@vertex fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Out {
  let corners = array<vec3<f32>, 8>(
    vec3<f32>(-0.5,0,-0.5), vec3<f32>(0.5,0,-0.5),
    vec3<f32>(0.5,0,0.5), vec3<f32>(-0.5,0,0.5),
    vec3<f32>(-0.5,1,-0.5), vec3<f32>(0.5,1,-0.5),
    vec3<f32>(0.5,1,0.5), vec3<f32>(-0.5,1,0.5));
  let indices = array<u32, 36>(
    0,1,5,0,5,4, 1,2,6,1,6,5, 2,3,7,2,7,6,
    3,0,4,3,4,7, 4,5,6,4,6,7, 0,3,2,0,2,1);
  let shade = array<f32, 6>(0.72,0.87,0.65,0.78,1.15,0.45);
  let instance = instances[index];
  let local = instance.position.xyz + corners[indices[vertex]] * instance.scale.xyz;
  let world = surfacePoint(local);
  var out: Out;
  out.position = camera.viewProjection * vec4<f32>(world,1);
  out.color = vec4<f32>(instance.color.rgb * shade[vertex / 6u], instance.color.a * camera.transition.x);
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> { return in.color; }
`;

const COLONY_BODY_WGSL = `
struct Camera { viewProjection: mat4x4<f32>, transition: vec4<f32>, surface: vec4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
struct Out {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
};
@vertex fn vs_main(@builtin(vertex_index) vertex: u32) -> Out {
  let cell = vertex / 6u;
  let corner = array<vec2<f32>, 6>(
    vec2<f32>(0,0), vec2<f32>(1,0), vec2<f32>(0,1),
    vec2<f32>(0,1), vec2<f32>(1,0), vec2<f32>(1,1));
  let uv = (vec2<f32>(f32(cell / 64u), f32(cell % 64u)) + corner[vertex % 6u]) / vec2<f32>(32,64);
  let latitude = uv.x * 3.14159265 - 1.57079633;
  let longitude = uv.y * 6.2831853 + camera.transition.w * 0.02;
  let normal = vec3<f32>(cos(latitude) * cos(longitude), sin(latitude), cos(latitude) * sin(longitude));
  let radius = camera.transition.y;
  var out: Out;
  out.position = camera.viewProjection * vec4<f32>(normal * radius + vec3<f32>(0,-radius,0), 1);
  out.normal = normal;
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let normal = normalize(in.normal);
  let terrain = sin(normal.x * 19.0 + sin(normal.z * 13.0)) * cos(normal.z * 17.0 + normal.y * 9.0) * 0.5 + 0.5;
  let light = 0.28 + 0.72 * max(0.0, dot(normal, normalize(vec3<f32>(-0.7,0.8,1.0))));
  let surface = mix(camera.surface.rgb * 0.52, camera.surface.rgb * 1.3, terrain);
  return vec4<f32>(surface * light, 1.0);
}
`;

const COLONY_VFX_WGSL = `
struct Out { @builtin(position) position: vec4<f32>, @location(0) color: vec4<f32> };
@vertex fn vs_main(@location(0) position: vec3<f32>, @location(1) color: vec4<f32>) -> Out {
  var out: Out; out.position = vec4<f32>(position,1); out.color = color; return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> { return in.color; }
`;

const bounded = (value, min, max, fallback = min) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

function multiplyMatrix(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
  }
  return out;
}

function projectCityPoint(matrix, x, y, z) {
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  return [0, 1, 2].map((row) =>
    (matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row]) / w);
}

function mapColonySurfacePoint(radius, x, y, z) {
  const safeRadius = Math.max(0.001, Number(radius) || 0.001);
  const distance = Math.hypot(x, z);
  const angle = distance / safeRadius;
  if (distance < 0.0001) return [0, y, 0];
  const tangentScale = Math.sin(angle) / distance;
  const normal = [x * tangentScale, Math.cos(angle), z * tangentScale];
  return [
    normal[0] * (safeRadius + y),
    normal[1] * (safeRadius + y) - safeRadius,
    normal[2] * (safeRadius + y),
  ];
}

function projectColonySurfacePoint(matrix, radius, x, y, z) {
  const point = mapColonySurfacePoint(radius, x, y, z);
  return projectCityPoint(matrix, point[0], point[1], point[2]);
}

function resolveBodySurface(data, cityWidth, cityDepth) {
  const colony = data?.colony || {};
  const body = data?.focusPlanet || data?.planet || colony?.body || colony;
  const layout = data?.layout || colony?.layout || {};
  const diameter = Number(
    body?.diameter_km ?? body?.diameter ?? body?.planet_diameter
      ?? layout?.planet_scale?.diameter ?? 0
  );
  const citySpan = Math.max(cityWidth, cityDepth, 1);
  const physicalRadius = Number.isFinite(diameter) && diameter > 0 ? diameter / 20 : citySpan * 6;
  const radius = bounded(physicalRadius, citySpan * 1.5, citySpan * 80, citySpan * 6);
  const kind = String(body?.planet_class || body?.planet_type || body?.body_type || '').toLowerCase();
  const tint = /ice|frost|tundra/.test(kind) ? [0.35, 0.58, 0.72]
    : /lava|volcan|molten/.test(kind) ? [0.66, 0.29, 0.18]
      : /desert|arid|barren/.test(kind) ? [0.64, 0.48, 0.29]
        : /gas|jovian/.test(kind) ? [0.43, 0.42, 0.66]
          : /moon|comet|asteroid/.test(kind) ? [0.48, 0.51, 0.49]
            : [0.25, 0.42, 0.29];
  return { radius, kind: kind || 'planet', tint };
}

function cityCameraMatrix(aspect, span, progress = 1, target = { x: 0, z: 0 }, surfaceRadius = 0) {
  const t = bounded(progress, 0, 1);
  const eased = t * t * (3 - 2 * t);
  const yaw = Math.PI / 4;
  const pitch = (65 + (35.264 - 65) * eased) * Math.PI / 180;
  const distance = span * (2.6 - eased * 0.6);
  let right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  let back = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  let up = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)];
  const tx = Number(target.x) || 0;
  const tz = Number(target.z) || 0;
  let targetPosition = [tx, 0, tz];
  if (surfaceRadius > 0) {
    targetPosition = mapColonySurfacePoint(surfaceRadius, tx, 0, tz);
    const normal = [
      targetPosition[0] / surfaceRadius,
      (targetPosition[1] + surfaceRadius) / surfaceRadius,
      targetPosition[2] / surfaceRadius,
    ];
    let east = [1 - normal[0] * normal[0], -normal[0] * normal[1], -normal[0] * normal[2]];
    const eastLength = Math.hypot(...east);
    if (eastLength < 1e-8) east = [0, 0, 1];
    else east = east.map((value) => value / eastLength);
    let north = [
      east[1] * normal[2] - east[2] * normal[1],
      east[2] * normal[0] - east[0] * normal[2],
      east[0] * normal[1] - east[1] * normal[0],
    ];
    const northLength = Math.hypot(...north);
    north = north.map((value) => value / Math.max(1e-8, northLength));
    const orient = (vector) => [
      east[0] * vector[0] + normal[0] * vector[1] + north[0] * vector[2],
      east[1] * vector[0] + normal[1] * vector[1] + north[1] * vector[2],
      east[2] * vector[0] + normal[2] * vector[1] + north[2] * vector[2],
    ];
    right = orient(right);
    up = orient(up);
    back = orient(back);
  }
  const view = new Float32Array([
    right[0], up[0], back[0], 0, right[1], up[1], back[1], 0,
    right[2], up[2], back[2], 0,
    -right.reduce((sum, value, axis) => sum + value * targetPosition[axis], 0),
    -up.reduce((sum, value, axis) => sum + value * targetPosition[axis], 0),
    -distance - back.reduce((sum, value, axis) => sum + value * targetPosition[axis], 0),
    1,
  ]);
  const near = 0.1;
  const far = span * 10;
  const half = span * 0.5;
  const ortho = new Float32Array([
    1 / (half * aspect), 0, 0, 0, 0, 1 / half, 0, 0,
    0, 0, 1 / (near - far), 0, 0, 0, near / (near - far), 1,
  ]);
  // Scale the perspective matrix's homogeneous coordinates before blending:
  // both projections agree at the target, avoiding a discontinuous scale jump.
  const perspective = new Float32Array([
    1 / (half * aspect), 0, 0, 0, 0, 1 / half, 0, 0,
    0, 0, far / ((near - far) * distance), -1 / distance,
    0, 0, far * near / ((near - far) * distance), 0,
  ]);
  const projection = perspective.map((v, i) => v * (1 - eased) + ortho[i] * eased);
  return multiplyMatrix(projection, view);
}

function normalizeCitySlots(data) {
  const buildings = Array.isArray(data?.buildings) ? data.buildings : [];
  const saved = Array.isArray(data?.slots) ? data.slots.filter(Boolean).slice(0, 256) : [];
  const cols = bounded(data?.layout?.grid?.cols, 1, 32, 6);
  const rows = bounded(data?.layout?.grid?.rows, 1, 32, 4);
  const source = saved.length ? saved : buildings.filter((entry) => (Number(entry.level) > 0 || entry.upgrade_end) && entry.meta?.zone !== 'orbital')
    .slice(0, 256).map((entry, index) => ({ ...entry, slot_x: index % cols, slot_y: Math.floor(index / cols) }));
  const persisted = source.some((slot) => slot.slot_x != null);
  const centerX = (Math.min(0, ...source.map((s) => bounded(s.slot_x, -31, 31))) + Math.max(cols - 1, ...source.map((s) => bounded(s.slot_x, -31, 31)))) / 2;
  const centerZ = (Math.min(0, ...source.map((s) => bounded(s.slot_y, -31, 31))) + Math.max(rows - 1, ...source.map((s) => bounded(s.slot_y, -31, 31)))) / 2;
  return source.slice(0, 256).map((slot, index) => {
    const type = String(slot.type || slot.building_type || '');
    const building = buildings.find((entry) => entry.type === type);
    return {
      ...building, ...slot, type,
      owner_color: slot.owner_color || data?.colony?.owner_color || data?.colony?.colony_owner_color || data?.colony?.faction_color || '',
      level: bounded(slot.level ?? building?.level, 0, 100, 1),
      x: persisted ? (bounded(slot.slot_x, -31, 31) - centerX) * 3.1 : bounded(slot.x, -100, 100),
      z: persisted ? (bounded(slot.slot_y, -31, 31) - centerZ) * 3.1 : bounded(slot.z, -100, 100),
      key: `${type}:${slot.slot_x ?? slot.x ?? index}:${slot.slot_y ?? slot.z ?? 0}`,
    };
  }).filter((slot) => slot.type && (slot.level > 0 || slot.upgrade_end));
}

function cityEconomyStatus(data) {
  const economy = data?.economy;
  if (!economy) return { text: 'Economy unavailable — building snapshot only', warning: false };
  const energy = Number(economy.energy_balance ?? economy.energy?.balance ?? economy.energy?.net);
  const bottlenecks = Array.isArray(economy.shortages) ? economy.shortages
    : Object.entries(economy.shortages || {}).filter(([, value]) => Number(value) > 0).map(([key]) => key);
  const warning = (Number.isFinite(energy) && energy < 0) || bottlenecks.length > 0;
  return {
    warning,
    text: bottlenecks.length ? `Colony shortage: ${bottlenecks.map((b) => typeof b === 'string' ? b : b.resource || b.type || 'production').join(', ')}`
      : Number.isFinite(energy) ? `Energy balance: ${energy.toFixed(1)}${energy < 0 ? ' — production constrained' : ''}`
        : 'Authoritative economy snapshot loaded',
  };
}

function buildCityGeometry(slots, data) {
  const parts = [];
  const add = (x, y, z, sx, sy, sz, color) => {
    if (parts.length < 8192) parts.push({ x, y, z, sx, sy, sz, color });
  };
  const width = Math.max(bounded(data?.layout?.grid?.cols, 1, 32, 6) * 3.1, ...slots.map((s) => Math.abs(s.x) * 2 + 3.1));
  const depth = Math.max(bounded(data?.layout?.grid?.rows, 1, 32, 4) * 3.1, ...slots.map((s) => Math.abs(s.z) * 2 + 3.1));
  const cols = Math.round(width / 3.1);
  const rows = Math.round(depth / 3.1);
  add(0, 0.12, 0, width + 2, 0.2, depth + 2, [0.12, 0.23, 0.19]);
  // Roads lie between plots, so cosmetic traffic never walks through buildings.
  for (let x = -cols / 2; x <= cols / 2; x++) add(x * 3.1, 0.07, 0, 0.52, 0.03, depth, [0.16, 0.20, 0.24]);
  for (let z = -rows / 2; z <= rows / 2; z++) add(0, 0.07, z * 3.1, width, 0.03, 0.52, [0.16, 0.20, 0.24]);
  const status = cityEconomyStatus(data);
  slots.forEach((s) => {
    const text = `${s.type} ${s.category || ''}`.toLowerCase();
    const height = 0.8 + Math.min(7, s.level) * 0.22;
    const warning = status.warning || /blocked|paused|shortage/.test(String(s.status || ''));
    const color = s.upgrade_end ? [0.9, 0.57, 0.22] : warning ? [0.65, 0.32, 0.27] : hexToRgbFloat(s.owner_color || '#74aebc');
    add(s.x, 0.02, s.z, 2.45, 0.12, 2.45, warning ? [0.68, 0.30, 0.16] : [0.28, 0.36, 0.37]);
    if (/farm|agri|food|hydropon/.test(text)) {
      for (let i = 0; i < 4; i++) add(s.x - 0.8 + i * 0.53, 0.15, s.z, 0.35, 0.32, 1.9, [0.24, 0.62, 0.34]);
    } else if (/power|reactor|fusion|energy|solar/.test(text)) {
      add(s.x, 0.15, s.z, 1.1, height, 1.1, color);
      add(s.x, height + 0.15, s.z, 1.55, 0.18, 1.55, [0.3, 0.85, 0.92]);
      add(s.x + 0.85, 0.3, s.z, 0.4, 0.08, 1.9, [0.12, 0.31, 0.68]);
    } else if (/mine|factory|refinery|forge|smelt|storage/.test(text)) {
      add(s.x, 0.15, s.z, 2, height * 0.65, 1.7, color);
      for (let i = 0; i < 2; i++) add(s.x - 0.6 + i * 1.2, 0.15, s.z - 0.5, 0.35, height + 0.6, 0.35, [0.45, 0.49, 0.5]);
      add(s.x, height * 0.65 + 0.15, s.z + 0.15, 2.1, 0.16, 1.6, [0.52, 0.57, 0.6]);
    } else {
      const science = /lab|research|science|academy/.test(text);
      add(s.x, 0.15, s.z, science ? 1.35 : 1.8, height, science ? 1.35 : 1.8, color);
      add(s.x, height + 0.15, s.z, science ? 0.7 : 1.9, science ? 0.65 : 0.12, science ? 0.7 : 1.9, [0.57, 0.76, 0.83]);
      for (let floor = 0; floor < Math.min(4, s.level + 1); floor++) {
        add(s.x, 0.4 + floor * 0.22, s.z + 0.91, 1.4, 0.09, 0.025, warning ? [0.7, 0.4, 0.16] : [0.76, 0.95, 0.92]);
      }
    }
    // A visible status beacon distinguishes construction and economic stress.
    add(s.x + 0.95, 0.16, s.z + 0.95, 0.16, 0.45, 0.16, s.upgrade_end ? [1, 0.76, 0.18] : warning ? [1, 0.24, 0.12] : [0.25, 0.95, 0.6]);
  });
  return { parts, width, depth };
}

function cityPedestrians(population, slots, popClasses = {}) {
  const count = slots.length ? Math.min(96, Math.floor(Math.sqrt(bounded(population, 0, 1e12)) / 2)) : 0;
  const classes = Object.entries(popClasses || {}).filter(([, value]) => Number(value) > 0).sort(([a], [b]) => a.localeCompare(b));
  const total = classes.reduce((sum, [, value]) => sum + Number(value), 0);
  return Array.from({ length: count }, (_, index) => {
    const home = slots[index % slots.length];
    let remaining = (index + 0.5) / count * total;
    const role = classes.find(([, value]) => { remaining -= Number(value); return remaining <= 0; })?.[0] || 'colonist';
    return { x: home.x, z: home.z + 1.55, role, phase: ((index * 0.61803398875) % 1) * 4, speed: 0.2 + (index % 5) * 0.025 };
  });
}

class ColonySurfaceLevelWebGPU extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas         = null;
    this._backend        = null;
    this._sceneData      = null;
    this._device         = null;
    this._context        = null;
    this._meshPipeline   = null;
    this._bodyPipeline   = null;
    this._bodyBindGroup  = null;
    this._vfxPipeline    = null;
    this._instanceBuffer = null;
    this._instanceBindGroup = null;
    this._buildingVfxBuffer = null;
    this._buildingVfxVertexCount = 0;
    this._buildingVfxParticles = [];
    this._buildingVfxTime = 0;
    this._buildingVfxBurstUntil = 0;
    this._slotUpgradeState = new Map();
    this._buildingVfxStats = {
      backend: 'webgpu',
      quality: 'medium',
      emitters: 0,
      particles: 0,
      profileCounts: {},
      burstActive: false,
    };
    this._slotCount      = 0;
    this._slots = [];
    this._city = null;
    this._bodySurface = { radius: 150, kind: 'planet', tint: [0.25, 0.42, 0.29] };
    this._citySpan = 25;
    this._entrySpan = 100;
    this._minCameraSpan = 3.5;
    this._zoomMultiplier = 1;
    this._people = [];
    this._cameraBuffer = null;
    this._depthTexture = null;
    this._camera = { span: 25, target: { x: 0, z: 0 }, progress: 0 };
    this._viewProjection = cityCameraMatrix(1, 25);
    this._elapsed = 0;
    this._active = false;
    this._inputCleanups = [];
    this._requestGeneration = 0;
    this._request = null;
    this._hud = null;
    this._selected = null;
    this._visualPalette  = {
      owner: [0.49, 0.72, 0.93],
      clear: [0.05, 0.06, 0.04],
    };
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    this._device = backend?.device || null;
    this._context = backend?.context || null;
    if (!this._device || !this._context) {
      throw new Error('ColonySurfaceLevelWebGPU requires the shared WebGPU device and canvas context');
    }
    await this._buildPipelines();
    if (this._sceneData) this.setSceneData(this._sceneData);
  }

  setSceneData(data) {
    if (Number(this._sceneData?.colony?.id || 0) !== Number(data?.colony?.id || 0)) {
      this._requestGeneration++;
      this._request?.abort();
      this._request = null;
      this._snapshotLoaded = false;
      this._snapshotState = '';
      this._camera.target = { x: 0, z: 0 };
    }
    this._sceneData = data || null;
    this._applySceneDataVisuals(data);
    this._slots = normalizeCitySlots(data);
    this._city = buildCityGeometry(this._slots, data);
    this._citySpan = Math.max(this._city.width, this._city.depth) * 1.35;
    this._bodySurface = resolveBodySurface(data, this._city.width, this._city.depth);
    this._entrySpan = Math.max(this._citySpan * 4, this._bodySurface.radius * 3);
    const tallestPart = Math.max(0, ...this._city.parts.map((part) => part.y + part.sy));
    this._minCameraSpan = Math.max(3.5, (tallestPart + 0.35) / (2 * Math.sin(35.264 * Math.PI / 180)));
    this._zoomMultiplier = 1;
    this._people = cityPedestrians(data?.colony?.population, this._slots, data?.pop_classes);
    this._camera.span = this._entrySpan;
    this._selected = null;
    this._uploadSlots();
    this._rebuildBuildingVfx(this._slots);
    this._updateHud();
  }

  render(dt) {
    if (!this._active || !this._device || !this._context) return;
    const seconds = bounded(Number(dt) > 1 ? Number(dt) / 1000 : dt, 0, 0.1, 0.016);
    this._elapsed += seconds;
    this._camera.progress = Math.min(1, this._camera.progress + seconds / 1.2);
    this._camera.span = this._transitionBaseSpan() * this._zoomMultiplier;
    const aspect = Math.max(0.1, this._canvas.width / Math.max(1, this._canvas.height));
    this._viewProjection = cityCameraMatrix(
      aspect, this._camera.span / Math.min(1, aspect), this._camera.progress,
      this._camera.target, this._bodySurface.radius
    );
    this._backdropRendered = this._camera.progress < 1
      && !!this._planetBackdrop?.renderBackdrop(seconds, this._backdropPose, 1 - this._camera.progress);
    const uniforms = new Float32Array(24);
    uniforms.set(this._viewProjection);
    uniforms[16] = this._backdropRendered ? this._camera.progress : 1;
    uniforms[17] = this._bodySurface.radius;
    uniforms[19] = this._elapsed;
    uniforms.set([...this._bodySurface.tint, 1], 20);
    this._device.queue.writeBuffer(this._cameraBuffer, 0, uniforms);
    this._uploadPeople();
    this._updateBuildingVfxBuffer(seconds);
    this._drawFrame();
  }

  async enter(prevLevel, transitionPayload) {
    if (this._active) await this.exit();
    this._active = true;
    this._camera.progress = 0;
    this._camera.target = { x: 0, z: 0 };
    let data = transitionPayload || this._sceneData;
    const planetColony = transitionPayload?.__slot?.player_planet || transitionPayload?.planet?.__slot?.player_planet || transitionPayload?.planet || transitionPayload;
    if (!transitionPayload?.colony && Number(planetColony?.colony_id) > 0) {
      data = { colony: { ...planetColony, id: Number(planetColony.colony_id) }, slots: [] };
    }
    this._snapshotState = '';
    this._snapshotLoaded = false;
    this.setSceneData(data);
    this._mountControls();
    this._loadSnapshot();
  }

  async exit() {
    this._active = false;
    this._requestGeneration++;
    this._request?.abort();
    this._request = null;
    this._inputCleanups.splice(0).forEach((cleanup) => cleanup());
    this._hud?.remove();
    this._hud = null;
    this._selected = null;
    this._people = [];
    this._buildingVfxParticles = [];
    this._buildingVfxVertexCount = 0;
    this._instanceBuffer?.destroy();
    this._instanceBuffer = null;
    this._instanceBindGroup = null;
    this._buildingVfxBuffer?.destroy();
    this._buildingVfxBuffer = null;
    this._slotCount = 0;
    this._planetBackdrop = null;
    this._backdropPose = null;
    this._depthTexture?.destroy();
    this._depthTexture = null;
  }

  dispose() {
    this.exit();
    this._cameraBuffer?.destroy();
    this._cameraBuffer = null;
    if (this._instanceBuffer) {
      try { this._instanceBuffer.destroy(); } catch (_) {}
      this._instanceBuffer = null;
    }
    if (this._buildingVfxBuffer) {
      try { this._buildingVfxBuffer.destroy(); } catch (_) {}
      this._buildingVfxBuffer = null;
    }
    this._meshPipeline = null;
    this._bodyPipeline = null;
    this._bodyBindGroup = null;
    this._vfxPipeline = null;
    this._instanceBindGroup = null;
    this._buildingVfxVertexCount = 0;
    this._buildingVfxParticles = [];
    this._buildingVfxTime = 0;
    this._buildingVfxBurstUntil = 0;
    this._slotUpgradeState = new Map();
    this._buildingVfxStats = {
      backend: 'webgpu',
      quality: 'medium',
      emitters: 0,
      particles: 0,
      profileCounts: {},
      burstActive: false,
    };
    this._device = null;
    this._context = null;
    this._canvas  = null;
    this._backend = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async _buildPipelines() {
    if (!this._device) return;
    const format = (globalThis.navigator?.gpu?.getPreferredCanvasFormat)
      ? navigator.gpu.getPreferredCanvasFormat()
      : 'bgra8unorm';
    const meshShader = this._device.createShaderModule({ label: 'colony_city', code: COLONY_CITY_WGSL });
    this._meshPipeline = this._device.createRenderPipeline({
      label: 'colony_city',
      layout: 'auto',
      vertex: { module: meshShader, entryPoint: 'vs_main' },
      fragment: { module: meshShader, entryPoint: 'fs_main', targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    const bodyShader = this._device.createShaderModule({ label: 'colony_body_surface', code: COLONY_BODY_WGSL });
    this._bodyPipeline = this._device.createRenderPipeline({
      label: 'colony_body_surface',
      layout: 'auto',
      vertex: { module: bodyShader, entryPoint: 'vs_main' },
      fragment: { module: bodyShader, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this._cameraBuffer = this._device.createBuffer({
      size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const vfxShader = this._device.createShaderModule({ label: 'colony_vfx', code: COLONY_VFX_WGSL });
    this._vfxPipeline = this._device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: vfxShader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 28,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x4' },
          ],
        }],
      },
      fragment: { module: vfxShader, entryPoint: 'fs_main', targets: [{ format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      } }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });
  }

  _packPart(data, index, part) {
    const base = index * 16;
    data.set([...part.color, 1, part.x, part.y, part.z, 1, part.sx, part.sy, part.sz, 0, 0, 0, 0, 0], base);
  }

  _uploadSlots() {
    if (!this._device) return;
    const count = (this._city?.parts.length || 0) + this._people.length * 2 + 1;
    const size   = count * BYTES_PER_SLOT;
    this._instanceBuffer?.destroy();
    this._instanceBuffer = this._device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const data = new Float32Array(count * 16);
    this._city?.parts.forEach((part, i) => this._packPart(data, i, part));
    this._device.queue.writeBuffer(this._instanceBuffer, 0, data.buffer, 0, data.byteLength);
    this._instanceBindGroup = this._device.createBindGroup({
      layout: this._meshPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._cameraBuffer } },
        { binding: 1, resource: { buffer: this._instanceBuffer } },
      ],
    });
    this._bodyBindGroup = this._device.createBindGroup({
      layout: this._bodyPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._cameraBuffer } }],
    });
    this._slotCount = count;
  }

  _uploadPeople() {
    if (!this._instanceBuffer || !this._city) return;
    const data = new Float32Array((this._people.length * 2 + 1) * 16);
    this._people.forEach((person, i) => {
      // Deterministic triangular wave along a road; time is bounded and has no economic effect.
      const phase = (this._elapsed * person.speed + person.phase) % 4;
      const x = person.x + (phase < 2 ? phase : 4 - phase) - 1;
      const color = /scient|research/.test(person.role) ? [0.45,0.78,1] : /soldier|military/.test(person.role) ? [0.35,0.6,0.38] : [0.85,0.57 + (i % 3) * 0.12,0.3];
      this._packPart(data, i * 2, { x, y: 0.08, z: person.z, sx: 0.12, sy: 0.28, sz: 0.12, color });
      this._packPart(data, i * 2 + 1, { x, y: 0.36, z: person.z, sx: 0.13, sy: 0.13, sz: 0.13, color: [0.9, 0.77, 0.65] });
    });
    const slot = this._selected;
    this._packPart(data, this._people.length * 2, {
      x: slot?.x || 0, y: 0.155, z: slot?.z || 0,
      sx: slot ? 2.6 : 0, sy: 0.035, sz: slot ? 2.6 : 0, color: [0.2, 0.87, 1],
    });
    this._device.queue.writeBuffer(this._instanceBuffer, this._city.parts.length * BYTES_PER_SLOT, data);
  }

  setNavigationHandlers(handlers) {
    this._navigation = handlers;
  }

  setTransitionSource(source, pose) {
    this._planetBackdrop = typeof source?.renderBackdrop === 'function' ? source : null;
    this._backdropPose = pose;
  }

  _transitionBaseSpan() {
    const t = bounded(this._camera.progress, 0, 1);
    const eased = t * t * (3 - 2 * t);
    return this._entrySpan + (this._citySpan - this._entrySpan) * eased;
  }

  _setCameraSpan(span) {
    const currentSpan = Math.max(0.001, this._camera.span);
    this._zoomMultiplier *= span / currentSpan;
    this._camera.span = span;
  }

  async _loadSnapshot() {
    if (!this._active || globalThis.document?.hidden) return;
    const id = Number(this._sceneData?.colony?.id || 0);
    if (!Number.isSafeInteger(id) || id < 1) return;
    this._request?.abort();
    const request = new AbortController();
    this._request = request;
    const generation = ++this._requestGeneration;
    this._snapshotState = 'Loading authoritative economy…';
    this._updateHud();
    try {
      const response = await fetch(`api/colony_economy.php?action=snapshot&colony_id=${id}`, {
        credentials: 'same-origin', cache: 'no-store', signal: request.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = await response.json();
      if (!snapshot.success || !snapshot.economy || Number(snapshot.colony?.id) !== id) {
        throw new Error(snapshot.error || 'Economy rollout not enabled');
      }
      if (!this._active || generation !== this._requestGeneration) return;
      this._snapshotState = `Server snapshot · ${snapshot.economy.settled_at || 'just loaded'}`;
      const target = { ...this._camera.target };
      const span = this._camera.span;
      const preserveCamera = this._snapshotLoaded;
      this._snapshotLoaded = true;
      this.setSceneData({ ...this._sceneData, ...snapshot, colony: { ...this._sceneData.colony, ...snapshot.colony } });
      if (preserveCamera) {
        this._camera.target = target;
        this._camera.span = span;
        this._zoomMultiplier = span / Math.max(0.001, this._citySpan);
      }
    } catch (error) {
      if (!this._active || generation !== this._requestGeneration || error.name === 'AbortError') return;
      this._snapshotState = 'Economy unavailable (requires on-demand rollout); showing saved buildings';
      // Older deployments can still supply real building levels via the existing endpoint.
      if (!this._slots.length && globalThis.window?.API?.buildings) {
        try {
          const buildings = await window.API.buildings(id);
          if (!this._active || generation !== this._requestGeneration) return;
          const mapped = window.GQRuntimeColonySurfaceSlotMapping?.buildColonySurfaceVfxSlots(this._sceneData.colony, buildings);
          if (buildings.success && mapped) this.setSceneData({ ...this._sceneData, layout: buildings.layout, slots: mapped.slots });
        } catch (_) { /* Preserve the last confirmed scene when offline. */ }
      }
    } finally {
      if (generation === this._requestGeneration) {
        this._request = null;
        this._updateHud();
      }
    }
  }

  _mountControls() {
    const canvas = this._canvas;
    if (!canvas?.addEventListener) return;
    const listen = (target, name, fn, options) => {
      target.addEventListener(name, fn, options);
      this._inputCleanups.push(() => target.removeEventListener(name, fn, options));
    };
    const capture = { capture: true };
    let drag = null;
    const stop = (event) => { event.stopImmediatePropagation(); };
    listen(canvas, 'pointerdown', (event) => {
      stop(event);
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { x: event.clientX, y: event.clientY, moved: false };
      canvas.setPointerCapture?.(event.pointerId);
    }, capture);
    listen(canvas, 'pointermove', (event) => {
      stop(event);
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3 || drag.moved) {
        drag.moved = true;
        const scale = this._camera.span / Math.max(100, canvas.getBoundingClientRect().height);
        this._camera.target.x -= (dx + dy * 1.4) * scale * 0.707;
        this._camera.target.z += (dx - dy * 1.4) * scale * 0.707;
        this._camera.target.x = bounded(this._camera.target.x, -100, 100);
        this._camera.target.z = bounded(this._camera.target.z, -100, 100);
      }
      drag.x = event.clientX;
      drag.y = event.clientY;
    }, capture);
    listen(canvas, 'pointerup', (event) => {
      stop(event);
      if (drag && !drag.moved) this._selectAt(event.clientX, event.clientY);
      drag = null;
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }, capture);
    listen(canvas, 'pointercancel', () => { drag = null; }, capture);
    listen(canvas, 'click', stop, capture);
    for (const name of ['mousedown', 'mousemove', 'mouseup']) listen(canvas, name, stop, capture);
    listen(canvas, 'dblclick', (event) => {
      stop(event);
      if (this._selected) {
        this._camera.target = { x: this._selected.x, z: this._selected.z };
        this._camera.progress = 1;
        this._camera.span = this._citySpan;
        this._zoomMultiplier = 1;
        this._setCameraSpan(9);
      }
    }, capture);
    listen(canvas, 'wheel', (event) => {
      event.preventDefault();
      stop(event);
      const direction = bounded(event.deltaY, -150, 150);
      const nextSpan = this._camera.span * Math.exp(direction * 0.002);
      if (direction > 0 && nextSpan >= this._entrySpan * 0.98) {
        this._navigation?.back?.();
        return;
      }
      this._setCameraSpan(bounded(nextSpan, this._minCameraSpan, this._entrySpan, this._citySpan));
    }, { capture: true, passive: false });
    listen(window, 'keydown', (event) => {
      if (/input|textarea|select/i.test(event.target?.tagName) || event.target?.isContentEditable) return;
      const key = event.key;
      if (!['Escape', '+', '=', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
      stop(event);
      event.preventDefault();
      if (key === 'Escape') this._navigation?.back?.();
      if (key === '+' || key === '=') {
        this._setCameraSpan(Math.max(this._minCameraSpan, this._camera.span * 0.9));
      }
      if (key === '-') {
        const nextSpan = this._camera.span * 1.1;
        if (nextSpan >= this._entrySpan * 0.98) this._navigation?.back?.();
        else this._setCameraSpan(nextSpan);
      }
      if (key === 'ArrowLeft') this._camera.target.x -= 0.8;
      if (key === 'ArrowRight') this._camera.target.x += 0.8;
      if (key === 'ArrowUp') this._camera.target.z -= 0.8;
      if (key === 'ArrowDown') this._camera.target.z += 0.8;
    }, capture);
    if (!canvas.parentElement) return;
    const hud = document.createElement('section');
    hud.setAttribute('aria-label', 'Colony surface simulation');
    Object.assign(hud.style, {
      position: 'absolute', top: '72px', left: '12px', zIndex: '20', maxWidth: '360px',
      background: 'rgba(7,20,30,.93)', color: '#d9f3ff', padding: '12px',
      border: '1px solid #4b7f96', borderRadius: '8px', pointerEvents: 'auto', font: '13px sans-serif',
    });
    const summary = document.createElement('div');
    summary.dataset.citySummary = '';
    hud.appendChild(summary);
    const selection = document.createElement('p');
    selection.dataset.citySelection = '';
    hud.appendChild(selection);
    const hint = document.createElement('p');
    hint.textContent = 'Drag to pan · Wheel / + − to zoom · Double-click building to focus · Esc to leave. Green: online · Amber: construction · Red: colony shortage. People are cosmetic.';
    hud.appendChild(hint);
    for (const [label, action] of [
      ['Back to orbit', () => this._navigation?.back?.()],
      ['Refresh snapshot', () => this._loadSnapshot()],
      [typeof this._sceneData?.onOpenBuildings === 'function' ? 'Buildings' : 'Focus building', () => {
        this._navigation?.slotClick?.(this._selected);
        if (typeof this._sceneData?.onOpenBuildings === 'function') this._sceneData.onOpenBuildings(this._selected);
        else if (this._selected) {
          this._camera.target = { x: this._selected.x, z: this._selected.z };
          this._camera.progress = 1;
          this._camera.span = this._citySpan;
          this._zoomMultiplier = 1;
          this._setCameraSpan(9);
        }
      }],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary btn-sm';
      button.textContent = label;
      listen(button, 'click', action);
      hud.appendChild(button);
    }
    canvas.parentElement.appendChild(hud);
    this._hud = hud;
    this._updateHud();
  }

  _updateHud() {
    if (!this._hud) return;
    const colony = this._sceneData?.colony || {};
    const status = cityEconomyStatus(this._sceneData);
    const population = Number(colony.population);
    const happiness = Number(colony.happiness);
    const classes = Object.entries(this._sceneData?.pop_classes || {}).map(([key, count]) => `${key}: ${Number(count) || 0}`).join(' · ');
    const rates = ['production','consumption'].map((kind) => {
      const values = Object.entries(this._sceneData?.economy?.[kind] || {})
        .filter(([, value]) => Number.isFinite(Number(value))).slice(0,6)
        .map(([resource, value]) => `${resource} ${Number(value).toFixed(1)}`).join(', ');
      return values ? `${kind}: ${values}` : '';
    }).filter(Boolean).join(' · ');
    this._hud.querySelector('[data-city-summary]').textContent = [
      colony.name || 'Colony surface', `${this._slots.length} buildings`,
      Number.isFinite(population) ? `Population ${population.toLocaleString()}` : 'Population unavailable',
      Number.isFinite(happiness) ? `Happiness ${happiness.toFixed(0)}%` : '',
      classes, status.text, rates, this._snapshotState || 'Saved building state',
    ].filter(Boolean).join(' · ');
    this._hud.querySelector('[data-city-selection]').textContent = this._selected
      ? `${this._selected.type.replace(/_/g, ' ')} · Level ${this._selected.level}${this._selected.upgrade_end ? ' · Construction in progress' : ''}`
      : 'Click a building to inspect its saved level.';
  }

  _selectAt(clientX, clientY) {
    const rect = this._canvas.getBoundingClientRect();
    const px = (clientX - rect.left) / Math.max(1, rect.width) * 2 - 1;
    const py = 1 - (clientY - rect.top) / Math.max(1, rect.height) * 2;
    let selected = null;
    let nearest = Infinity;
    const triangles = [0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7,4,5,6,4,6,7];
    this._slots.forEach((slot) => {
      const height = 1.6 + Math.min(7, slot.level) * 0.22;
      const corners = [
        [-1.22,0,-1.22], [1.22,0,-1.22], [1.22,0,1.22], [-1.22,0,1.22],
        [-1.22,height,-1.22], [1.22,height,-1.22], [1.22,height,1.22], [-1.22,height,1.22],
      ].map(([x,y,z]) => projectColonySurfacePoint(
        this._viewProjection, this._bodySurface.radius, slot.x + x, y + 0.13, slot.z + z
      ));
      for (let i = 0; i < triangles.length; i += 3) {
        const [a,b,c] = triangles.slice(i, i + 3).map((idx) => corners[idx]);
        const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(det) < 1e-10) continue;
        const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det;
        const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det;
        const w = 1 - u - v;
        const depth = u * a[2] + v * b[2] + w * c[2];
        if (u >= 0 && v >= 0 && w >= 0 && depth >= 0 && depth <= 1 && depth < nearest) {
          nearest = depth;
          selected = slot;
        }
      }
    });
    this._selected = selected;
    this._updateHud();
    if (selected) this._navigation?.slotClick?.({ ...selected, colonyId: this._sceneData?.colony?.id });
    return selected;
  }

  _resolveBuildingVfxQuality(slotCount) {
    const requested = String(this._sceneData?.vfx_quality || this._sceneData?.quality || '').toLowerCase();
    if (requested === 'low' || requested === 'medium' || requested === 'high') return requested;
    if (slotCount > 280) return 'low';
    if (slotCount > 120) return 'medium';
    return 'high';
  }

  _slotKey(slot, index) {
    const sx = Number(slot?.x || 0).toFixed(2);
    const sz = Number(slot?.z || 0).toFixed(2);
    const type = String(slot?.type || slot?.building_type || slot?.category || 'generic');
    return `${index}:${sx}:${sz}:${type}`;
  }

  _ingestUpgradeTransitions(slots) {
    const source = Array.isArray(slots) ? slots : [];
    const next = new Map();
    let detectedTransition = false;
    for (let i = 0; i < source.length; i += 1) {
      const slot = source[i] || {};
      const key = this._slotKey(slot, i);
      const active = !!slot?.upgrade_end;
      next.set(key, active);
      const previous = this._slotUpgradeState.get(key);
      if (typeof previous === 'boolean' && previous !== active) {
        detectedTransition = true;
      }
    }
    this._slotUpgradeState = next;
    if (detectedTransition) {
      this._buildingVfxBurstUntil = Math.max(this._buildingVfxBurstUntil, this._buildingVfxTime + 1.6);
    }
  }

  _slotVfxProfile(slot) {
    const explicitProfile = String(slot?.vfx_profile || slot?.fx_profile || '').toLowerCase();
    const explicitIntensity = Math.max(0.4, Math.min(2.2, Number(slot?.vfx_intensity || slot?.fx_intensity || 1) || 1));
    if (explicitProfile) {
      if (explicitProfile === 'construction' || explicitProfile === 'upgrade') {
        return { profileName: 'construction', particleMul: 1.35 * explicitIntensity, sizeMul: 1.12, opacityAdd: 0.12, driftMul: 1.25, tint: [1.0, 0.70, 0.42] };
      }
      if (explicitProfile === 'industry' || explicitProfile === 'smelter' || explicitProfile === 'refinery') {
        return { profileName: 'industry', particleMul: 1.2 * explicitIntensity, sizeMul: 1.06, opacityAdd: 0.08, driftMul: 1.16, tint: [1.0, 0.79, 0.47] };
      }
      if (explicitProfile === 'power' || explicitProfile === 'reactor') {
        return { profileName: 'power', particleMul: 1.05 * explicitIntensity, sizeMul: 1.0, opacityAdd: 0.06, driftMul: 1.08, tint: [0.54, 0.84, 1.0] };
      }
      if (explicitProfile === 'research' || explicitProfile === 'science') {
        return { profileName: 'research', particleMul: 0.95 * explicitIntensity, sizeMul: 0.92, opacityAdd: 0.05, driftMul: 0.92, tint: [0.62, 0.82, 1.0] };
      }
      if (explicitProfile === 'quiet' || explicitProfile === 'minimal') {
        return { profileName: 'quiet', particleMul: 0.6 * explicitIntensity, sizeMul: 0.82, opacityAdd: -0.05, driftMul: 0.7, tint: null };
      }
    }

    const text = [
      slot?.type,
      slot?.building_type,
      slot?.category,
      slot?.state,
      slot?.status,
      slot?.activity,
    ].map((v) => String(v || '').toLowerCase()).join(' ');
    const busy = !!slot?.upgrade_end
      || /construction|building|upgrade|running|queued|active/.test(text);
    const industrial = /mine|factory|refinery|smelter|forge|industry/.test(text);
    const research = /lab|research|science/.test(text);
    const power = /power|reactor|fusion|energy/.test(text);

    if (busy) {
      return { profileName: 'construction', particleMul: 1.35 * explicitIntensity, sizeMul: 1.12, opacityAdd: 0.12, driftMul: 1.25, tint: [1.0, 0.70, 0.42] };
    }
    if (industrial) {
      return { profileName: 'industry', particleMul: 1.2 * explicitIntensity, sizeMul: 1.06, opacityAdd: 0.08, driftMul: 1.16, tint: [1.0, 0.79, 0.47] };
    }
    if (power) {
      return { profileName: 'power', particleMul: 1.05 * explicitIntensity, sizeMul: 1.0, opacityAdd: 0.06, driftMul: 1.08, tint: [0.54, 0.84, 1.0] };
    }
    if (research) {
      return { profileName: 'research', particleMul: 0.95 * explicitIntensity, sizeMul: 0.92, opacityAdd: 0.05, driftMul: 0.92, tint: [0.62, 0.82, 1.0] };
    }
    return { profileName: 'auto', particleMul: 1 * explicitIntensity, sizeMul: 1, opacityAdd: 0, driftMul: 1, tint: null };
  }

  _rebuildBuildingVfx(slots) {
    const source = Array.isArray(slots) ? slots : [];
    this._ingestUpgradeTransitions(source);
    this._buildingVfxParticles = [];
    this._buildingVfxVertexCount = 0;
    if (!source.length) return;

    const quality = this._resolveBuildingVfxQuality(source.length);
    const qualityMap = {
      low: { emitters: 10, particlesPerEmitter: 8, size: 0.11, opacity: 0.16 },
      medium: { emitters: 20, particlesPerEmitter: 10, size: 0.12, opacity: 0.2 },
      high: { emitters: 36, particlesPerEmitter: 14, size: 0.14, opacity: 0.24 },
    };
    const cfg = qualityMap[quality] || qualityMap.medium;
    const profileCounts = {};
    const maxParticles = 900;
    const maxEmittersByCap = Math.max(1, Math.floor(maxParticles / Math.max(1, cfg.particlesPerEmitter)));
    const emitterCount = Math.min(source.length, cfg.emitters, maxEmittersByCap);
    const stride = Math.max(1, Math.floor(source.length / emitterCount));
    let remainingParticles = maxParticles;

    for (let e = 0; e < emitterCount; e += 1) {
      if (remainingParticles <= 0) break;
      const slot = source[Math.min(source.length - 1, e * stride)] || {};
      const profile = this._slotVfxProfile(slot);
      const profileName = String(profile.profileName || 'auto');
      profileCounts[profileName] = (profileCounts[profileName] || 0) + 1;
      const rgb = hexToRgbFloat(slot.owner_color || slot.colony_owner_color || slot.faction_color || '');
      const particleCount = Math.max(3, Math.min(remainingParticles, Math.round(cfg.particlesPerEmitter * profile.particleMul)));
      for (let i = 0; i < particleCount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.1 + Math.random() * 0.85;
        const tint = profile.tint || rgb;
        this._buildingVfxParticles.push({
          x: Number(slot.x || 0) + Math.cos(angle) * radius,
          y: 1.1 + Math.min(7, Number(slot.level) || 1) * 0.22 + Math.random() * 1.7,
          z: Number(slot.z || 0) + Math.sin(angle) * radius,
          size: cfg.size * profile.sizeMul * (0.8 + Math.random() * 0.6),
          r: tint[0],
          g: tint[1],
          b: tint[2],
          baseOpacity: Math.max(0.05, Math.min(0.6, cfg.opacity + profile.opacityAdd)),
          pulsePhase: Math.random() * Math.PI * 2,
          drift: (0.14 + Math.random() * 0.22) * profile.driftMul,
        });
      }
      remainingParticles -= particleCount;
    }

    this._buildingVfxVertexCount = this._buildingVfxParticles.length * 6;
    this._ensureBuildingVfxBufferCapacity(this._buildingVfxVertexCount);
    this._buildingVfxStats = {
      backend: 'webgpu',
      quality,
      emitters: emitterCount,
      particles: this._buildingVfxParticles.length,
      profileCounts,
      burstActive: this._buildingVfxBurstUntil > this._buildingVfxTime,
    };
  }

  _ensureBuildingVfxBufferCapacity(vertexCount) {
    if (!this._device) return;
    const bytesNeeded = Math.max(0, Number(vertexCount || 0)) * 28;
    if (!bytesNeeded) return;
    const existing = this._buildingVfxBuffer?.size || 0;
    if (existing >= bytesNeeded) return;
    if (this._buildingVfxBuffer) {
      try { this._buildingVfxBuffer.destroy(); } catch (_) {}
      this._buildingVfxBuffer = null;
    }
    this._buildingVfxBuffer = this._device.createBuffer({
      size: bytesNeeded,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  _updateBuildingVfxBuffer(dt) {
    if (!this._device || !this._buildingVfxVertexCount || !this._buildingVfxBuffer) return;
    const particles = this._buildingVfxParticles;
    if (!particles.length) return;
    this._buildingVfxTime += Math.max(0, Number(dt) || 0.016);
    const t = this._buildingVfxTime;
    const burstT = this._buildingVfxBurstUntil > t
      ? Math.max(0, Math.min(1, (this._buildingVfxBurstUntil - t) / 1.6))
      : 0;
    const out = new Float32Array(this._buildingVfxVertexCount * 7);
    let vp = 0;
    particles.forEach((p, index) => {
      const pulse = 0.5 + 0.5 * Math.sin(t * (1.15 + index * 0.001) + p.pulsePhase);
      const driftY = Math.sin(t * p.drift + p.pulsePhase) * 0.22;
      const center = projectColonySurfacePoint(
        this._viewProjection, this._bodySurface.radius, p.x, p.y + driftY, p.z
      );
      const cx = center[0];
      const cy = center[1];
      const hs = Math.max(0.001, p.size / this._camera.span * (1 + burstT * 0.18));
      const aspect = Math.max(0.1, this._canvas.width / Math.max(1, this._canvas.height));
      const a = Math.max(0.05, Math.min(0.78, p.baseOpacity + pulse * 0.16 + burstT * 0.22));
      const verts = [
        [cx - hs / aspect, cy - hs], [cx + hs / aspect, cy - hs], [cx - hs / aspect, cy + hs],
        [cx - hs / aspect, cy + hs], [cx + hs / aspect, cy - hs], [cx + hs / aspect, cy + hs],
      ];
      for (let i = 0; i < 6; i += 1) {
        out[vp + 0] = verts[i][0];
        out[vp + 1] = verts[i][1];
        out[vp + 2] = center[2];
        out[vp + 3] = p.r;
        out[vp + 4] = p.g;
        out[vp + 5] = p.b;
        out[vp + 6] = a;
        vp += 7;
      }
    });
    this._device.queue.writeBuffer(this._buildingVfxBuffer, 0, out.buffer, 0, out.byteLength);
    if (this._buildingVfxStats) {
      this._buildingVfxStats.burstActive = burstT > 0.001;
    }
    if (typeof window !== 'undefined') {
      window.__GQ_COLONY_VFX_STATS = Object.assign({}, this._buildingVfxStats || {}, {
        ts: Date.now(),
      });
    }
  }

  _drawFrame() {
    if (!this._device || !this._context || !this._meshPipeline) return;
    const width = Math.max(1, this._canvas.width);
    const height = Math.max(1, this._canvas.height);
    if (!this._depthTexture || this._depthTexture.width !== width || this._depthTexture.height !== height) {
      this._depthTexture?.destroy();
      this._depthTexture = this._device.createTexture({
        label: 'colony_depth', size: [width, height], format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    const encoder = this._device.createCommandEncoder();
    const view = this._context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: this._visualPalette.clear[0], g: this._visualPalette.clear[1], b: this._visualPalette.clear[2], a: 1 },
        loadOp: this._backdropRendered ? 'load' : 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this._depthTexture.createView(), depthClearValue: 1,
        depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });
    if (this._bodyPipeline && this._bodyBindGroup) {
      pass.setPipeline(this._bodyPipeline);
      pass.setBindGroup(0, this._bodyBindGroup);
      pass.draw(32 * 64 * 6, 1, 0, 0);
    }
    if (this._instanceBindGroup && this._slotCount > 0) {
      pass.setPipeline(this._meshPipeline);
      pass.setBindGroup(0, this._instanceBindGroup);
      pass.draw(36, this._slotCount, 0, 0);
    }
    if (this._vfxPipeline && this._buildingVfxBuffer && this._buildingVfxVertexCount > 0) {
      pass.setPipeline(this._vfxPipeline);
      pass.setVertexBuffer(0, this._buildingVfxBuffer);
      pass.draw(this._buildingVfxVertexCount, 1, 0, 0);
    }
    pass.end();
    this._device.queue.submit([encoder.finish()]);
  }

  _resolveVisualSource(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.colony && typeof data.colony === 'object') return data.colony;
    if (Array.isArray(data.slots) && data.slots.length) return data.slots[0];
    return data;
  }

  _applySceneDataVisuals(data) {
    const source = this._resolveVisualSource(data);
    const ownerColor = parseHexColor(
      source?.colony_owner_color || source?.owner_color || source?.faction_color || '',
      '#7db7ee'
    );
    const isOwned = !!String(source?.colony_owner_color || source?.owner_color || source?.faction_color || '').trim();
    this._visualPalette = {
      owner: hexToRgbFloat(ownerColor),
      clear: isOwned ? [0.04, 0.07, 0.05] : [0.05, 0.06, 0.04],
    };
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ColonySurfaceLevelWebGPU, COLONY_CITY_WGSL, COLONY_BODY_WGSL, COLONY_VFX_WGSL,
    normalizeCitySlots, buildCityGeometry, cityCameraMatrix, projectCityPoint,
    mapColonySurfacePoint, projectColonySurfacePoint, resolveBodySurface,
    cityPedestrians, cityEconomyStatus,
  };
} else {
  window.GQColonySurfaceLevelWebGPU = { ColonySurfaceLevelWebGPU };
}
