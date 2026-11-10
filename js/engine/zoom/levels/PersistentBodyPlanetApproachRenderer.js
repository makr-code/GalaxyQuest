/**
 * Planet approach on the shared galaxy WebGPU device, canvas and frame loop.
 * The incoming flight state drives projection; double-click/scroll enters the city.
 * License: MIT — makr-code/GalaxyQuest
 */
'use strict';

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

const PLANET_APPROACH_WGSL = `
struct Uniforms {
  viewProjection: mat4x4<f32>,
  base: vec4<f32>,
  atmosphere: vec4<f32>,
  animation: vec4<f32>,
  shape: vec4<f32>,
  eye: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
struct Out {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) world: vec3<f32>,
  @location(3) bodyPoint: vec3<f32>,
  @location(4) region: vec4<f32>,
  @location(5) material: f32,
  @location(6) boundaries: vec4<f32>,
};
@vertex fn vs_main(@builtin(vertex_index) vertex: u32) -> Out {
  let cell = vertex / 6u;
  let corner = array<vec2<f32>, 6>(
    vec2<f32>(0,0), vec2<f32>(1,0), vec2<f32>(0,1),
    vec2<f32>(0,1), vec2<f32>(1,0), vec2<f32>(1,1));
  let uv = (vec2<f32>(f32(cell / 64u), f32(cell % 64u)) + corner[vertex % 6u]) / vec2<f32>(32,64);
  let latitude = uv.x * 3.14159265 - 1.57079633;
  let longitude = uv.y * 6.2831853 + u.animation.x;
  let normal = vec3<f32>(cos(latitude) * cos(longitude), sin(latitude), cos(latitude) * sin(longitude));
  var out: Out;
  let canonical = vec3<f32>(cos(latitude) * cos(uv.y * 6.2831853),sin(latitude),cos(latitude) * sin(uv.y * 6.2831853));
  let wave = 0.6 * (canonical.x * canonical.x - canonical.y * canonical.y) + 0.4 * canonical.x * canonical.z;
  let factor = (1.0 + u.shape.w * wave) / length(canonical / max(u.shape.xyz,vec3<f32>(0.5)));
  out.world = normal * factor;
  out.bodyPoint = canonical * factor;
  out.position = u.viewProjection * vec4<f32>(out.world,1);
  out.normal = normal;
  out.uv = uv;
  out.region = vec4<f32>(0);
  out.material = -1.0;
  out.boundaries = vec4<f32>(1,-1,0,0);
  return out;
}
@fragment fn fs_main(in: Out, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  let face = cross(dpdx(in.world),dpdy(in.world));
  let geometric = face / max(length(face),0.00001);
  let radialNormal = select(-geometric,geometric,dot(geometric,in.normal) >= 0.0);
  let normal = select(radialNormal,select(geometric,-geometric,front),u.animation.w > 0.5);
  let c = cos(u.animation.x);
  let s = sin(u.animation.x);
  let canonicalNormal = vec3<f32>(normal.x * c + normal.z * s,normal.y,-normal.x * s + normal.z * c);
  let worldView = normalize(u.eye.xyz - in.world);
  let view = vec3<f32>(worldView.x * c + worldView.z * s,worldView.y,-worldView.x * s + worldView.z * c);
  let masks = gqTerrainMasks(in.boundaries);
  let material = gqTerrainMaterial(masks);
  var surface = gqTerrainSurface(gqSurface(in.bodyPoint,in.bodyPoint * gqMaterial.scale.y,canonicalNormal,0.0),masks,canonicalNormal);
  surface = gqWaterSurface(surface,masks.x * (1.0 - in.region.a),in.bodyPoint * gqMaterial.scale.y,canonicalNormal);
  surface = gqLavaSurface(surface,masks.z * (1.0 - in.region.a),in.bodyPoint * gqMaterial.scale.y,canonicalNormal);
  surface.albedo = mix(surface.albedo,gqLinear(in.region.rgb),in.region.a);
  let cloudPoint = normalize(in.bodyPoint) * 12.0;
  let cloudFootprint = max(length(dpdx(cloudPoint)),length(dpdy(cloudPoint)));
  let cloudTime = select(0.0,gqMaterial.anchor.w,gqMaterial.origin.w == 1);
  let cloud = gqCloudCoverage(gqCloudNoise(cloudPoint,cloudTime,gqMaterial.scale.x,cloudFootprint),u.atmosphere.w)
    * u.eye.w * (1.0 - u.animation.w);
  let light = normalize(vec3<f32>(-0.7,0.8,1));
  let canonicalLight = vec3<f32>(light.x * c + light.z * s,light.y,-light.x * s + light.z * c);
  surface = gqLivingSurface(surface,in.bodyPoint,canonicalNormal,canonicalLight,material,in.region.a);
  var color = surface.albedo * 0.3 + surface.emission + gqDirect(surface,view,canonicalLight,vec3<f32>(2.8));
  color = mix(color,vec3<f32>(0.8),cloud * 0.17);
  let rim = pow(1.0 - abs(normal.z),3.0);
  return vec4<f32>(gqFinish(mix(color,gqLinear(u.atmosphere.rgb),rim * 0.3 * (1.0 - u.animation.w))) * u.animation.z,1);
}
@vertex fn vs_mesh(@location(0) point: vec3<f32>, @location(1) region: vec4<f32>,
    @location(2) material: f32, @location(3) boundaries: vec4<f32>) -> Out {
  let c = cos(u.animation.x);
  let s = sin(u.animation.x);
  let world = vec3<f32>(point.x * c - point.z * s,point.y,point.x * s + point.z * c);
  var out: Out;
  out.world = world;
  out.bodyPoint = point;
  out.position = u.viewProjection * vec4<f32>(world,1);
  out.normal = normalize(world);
  out.uv = vec2<f32>(atan2(point.z,point.x) / 6.2831853,asin(clamp(normalize(point).y,-1.0,1.0)) / 3.14159265);
  out.region = region;
  out.material = material;
  out.boundaries = boundaries;
  return out;
}
`;

function planetColor(value, fallback) {
  const hex = /^#?[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).replace('#', '') : fallback;
  return [0,2,4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
}

function normalizeVector(vector, fallback) {
  const length = Math.hypot(...vector);
  return length > 1e-8 ? vector.map((value) => value / length) : fallback.slice();
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function multiplyMatrix(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
  }
  return out;
}

function planetViewProjection(cameraState, aspect, distance, near = 0.1, far = 20) {
  const target = [
    Number(cameraState?.target?.x) || 0,
    Number(cameraState?.target?.y) || 0,
    Number(cameraState?.target?.z) || 0,
  ];
  const requestedPosition = [
    Number(cameraState?.position?.x) || 0,
    Number(cameraState?.position?.y) || 0,
    Number(cameraState?.position?.z) || 0,
  ];
  const back = normalizeVector(
    requestedPosition.map((value, axis) => value - target[axis]),
    [0, 0, 1]
  );
  const referenceUp = Math.abs(back[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
  const right = normalizeVector(cross(referenceUp, back), [1, 0, 0]);
  const up = normalizeVector(cross(back, right), [0, 1, 0]);
  const eye = target.map((value, axis) => value + back[axis] * distance);
  const view = new Float32Array([
    right[0], up[0], back[0], 0,
    right[1], up[1], back[1], 0,
    right[2], up[2], back[2], 0,
    -right.reduce((sum, value, axis) => sum + value * eye[axis], 0),
    -up.reduce((sum, value, axis) => sum + value * eye[axis], 0),
    -back.reduce((sum, value, axis) => sum + value * eye[axis], 0),
    1,
  ]);
  const projection = new Float32Array([
    1.73 / aspect,0,0,0, 0,1.73,0,0, 0,0,far / (near - far),-1,
    0,0,(far * near) / (near - far),0,
  ]);
  return multiplyMatrix(projection, view);
}

function settlementOccluded(eye, point, vertices) {
  const ray = point.map((n, axis) => n - eye[axis]);
  const limit = 1 - 0.008 / Math.max(0.008, Math.hypot(...ray));
  // Segment/triangle intersections use the actual orbital mesh, including concave bodies.
  for (let offset = 0; offset < vertices.length; offset += 36) {
    const ax = vertices[offset], ay = vertices[offset + 1], az = vertices[offset + 2];
    const bx = vertices[offset + 12] - ax, by = vertices[offset + 13] - ay, bz = vertices[offset + 14] - az;
    const cx = vertices[offset + 24] - ax, cy = vertices[offset + 25] - ay, cz = vertices[offset + 26] - az;
    const px = ray[1] * cz - ray[2] * cy, py = ray[2] * cx - ray[0] * cz, pz = ray[0] * cy - ray[1] * cx;
    const determinant = bx * px + by * py + bz * pz;
    if (Math.abs(determinant) < 1e-12) continue;
    const tx = eye[0] - ax, ty = eye[1] - ay, tz = eye[2] - az;
    const u = (tx * px + ty * py + tz * pz) / determinant;
    if (u < 0 || u > 1) continue;
    const qx = ty * bz - tz * by, qy = tz * bx - tx * bz, qz = tx * by - ty * bx;
    const v = (ray[0] * qx + ray[1] * qy + ray[2] * qz) / determinant;
    if (v < 0 || u + v > 1) continue;
    const t = (cx * qx + cy * qy + cz * qz) / determinant;
    if (t > 0.000001 && t < limit) return true;
  }
  return false;
}

function projectSettlementMarkers(plan, manifest, frame, geometry) {
  if (!plan?.settlements.length || !frame.vertices?.length || frame.width <= 0 || frame.height <= 0) return [];
  const c = Math.cos(frame.rotation), s = Math.sin(frame.rotation);
  const eye = [frame.eye[0] * c + frame.eye[2] * s, frame.eye[1], -frame.eye[0] * s + frame.eye[2] * c];
  const markers = [];
  for (const [index, site] of plan.settlements.entries()) {
    const radius = (manifest.solid ? geometry.bodySolidRadius(site.direction, manifest.solid)
      : geometry.bodyShapeFactor(site.direction, manifest.shape)) + site.height / manifest.radius_km;
    const point = site.direction.map(n => n * radius);
    const world = [point[0] * c - point[2] * s, point[1], point[0] * s + point[2] * c];
    const clip = [0, 1, 2, 3].map(row => frame.matrix[row] * world[0] + frame.matrix[4 + row] * world[1]
      + frame.matrix[8 + row] * world[2] + frame.matrix[12 + row]);
    if (clip[3] <= 0 || clip[2] < 0 || clip[2] > clip[3]
        || Math.abs(clip[0]) > clip[3] || Math.abs(clip[1]) > clip[3]
        || settlementOccluded(eye, point, frame.vertices)) continue;
    markers.push({
      id: site.id, index, x: (clip[0] / clip[3] * 0.5 + 0.5) * frame.width,
      y: (0.5 - clip[1] / clip[3] * 0.5) * frame.height, depth: clip[2] / clip[3],
    });
  }
  return markers;
}

class PersistentBodyPlanetApproachRenderer extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas = null;
    this._backend = null;
    this._device = null;
    this._context = null;
    this._pipeline = null;
    this._uniformBuffer = null;
    this._sceneData = null;
    this._rotation = 0;
    this._time = 0;
    this._waterTime = 0;
    this._active = false;
    this._disposed = false;
    this._viewGeneration = 0;
    this._inputCleanups = [];
    this._hint = null;
    this._settlementMarkers = new Map();
    this._projectedSettlements = [];
    this._visualPalette = { base: [0.2,0.45,0.8], atmo: [0.55,0.75,1], clear: [0,0,0.02] };
  }

  async initialize(canvas, backend) {
    if (this._disposed) throw new Error('Cannot initialize a disposed planet approach renderer');
    this._canvas = canvas;
    this._backend = backend;
    this._device = backend?.device || null;
    this._context = backend?.context || null;
    if (!this._device || !this._context) throw new Error('PlanetApproachLevelWebGPU requires the shared WebGPU device and canvas context');
    await this._buildPipeline();
  }

  setSceneData(data) {
    if (this._disposed) throw new Error('Cannot update a disposed planet approach renderer');
    this._terrainStream?.dispose();
    this._terrainStream = null;
    this._sceneData = data || null;
    this._surfacePlanManifest = null;
    this._clearSettlementMarkers();
    const source = data?.focusPlanet || data?.planet || data?.colony || data?.target || data || {};
    this._terrainManifest = data?.bodyTerrainManifest || data?.body_terrain_manifest
      || data?.terrainManifest || source?.bodyTerrainManifest || source?.body_terrain_manifest
      || ((source.solid || source.shape || source.regions) ? {
        body_id: source.body_id || source.id,
        radius_km: source.radius_km,
        solid: source.solid,
        shape: source.shape,
        regions: source.regions,
      } : null);
    this._applySceneDataVisuals(data);
  }

  setNavigationHandlers(handlers) {
    if (this._disposed) throw new Error('Cannot bind navigation on a disposed planet approach renderer');
    this._navigation = handlers;
  }

  async enter(prevLevel, payload) {
    if (this._disposed) throw new Error('Cannot enter a disposed planet approach renderer');
    const sceneData = payload || this._sceneData;
    const leaving = this.exit();
    const generation = ++this._viewGeneration;
    await leaving;
    if (this._disposed || generation !== this._viewGeneration) return;
    this._active = true;
    this._rotation = 0;
    this._time = 0;
    this.setSceneData(sceneData);
    this._applySceneDataVisuals(this._sceneData);
    this._mountSettlementMarkers();
    if (this._backend?.externalCameraControls) return;
    if (!this._canvas?.addEventListener) return;
    const land = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'wheel' && event.deltaY >= 0) {
        this._navigation?.back?.();
      } else {
        this._navigation?.surface?.(this._sceneData);
      }
    };
    for (const name of ['dblclick', 'wheel']) {
      const options = { capture: true, passive: false };
      this._canvas.addEventListener(name, land, options);
      this._inputCleanups.push(() => this._canvas.removeEventListener(name, land, options));
    }
    if (this._canvas.parentElement) {
      this._hint = document.createElement('div');
      Object.assign(this._hint.style, { position: 'absolute', top: '72px', left: '12px', zIndex: '20' });
      const landButton = document.createElement('button');
      landButton.className = 'btn btn-secondary btn-sm';
      landButton.textContent = 'Land on colony · double-click or scroll in';
      landButton.addEventListener('click', land);
      const backButton = document.createElement('button');
      backButton.className = 'btn btn-secondary btn-sm';
      backButton.textContent = 'Back';
      backButton.addEventListener('click', () => this._navigation?.back?.());
      this._hint.append(landButton, backButton);
      this._canvas.parentElement.appendChild(this._hint);
    }
  }

  async exit() {
    const errors = this._releaseViewResources();
    if (errors.length) throw new AggregateError(errors, 'Planet approach exit failed');
  }

  _releaseViewResources() {
    this._viewGeneration++;
    const errors = [];
    const attempt = (cleanup) => {
      try { cleanup(); } catch (error) { errors.push(error); }
    };
    this._active = false;
    attempt(() => this._terrainStream?.dispose());
    this._terrainStream = null;
    this._inputCleanups.splice(0).forEach(attempt);
    attempt(() => this._hint?.remove());
    this._hint = null;
    attempt(() => this._clearSettlementMarkers());
    attempt(() => this._markerOverlay?.remove());
    this._markerOverlay = null;
    attempt(() => this._solidBuffer?.destroy());
    this._solidBuffer = null;
    this._solidMeshKey = '';
    this._sphereManifestKey = null;
    this._sphereRows = null;
    this._markerVertices = null;
    attempt(() => this._depthTexture?.destroy());
    this._depthTexture = null;
    return errors;
  }

  render(dt, cameraState) {
    if (!this._active || !this._pipeline) return;
    if (globalThis.document?.hidden) return;
    const rect = this._canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0
        || rect.top >= globalThis.innerHeight || rect.left >= globalThis.innerWidth) return;
    if (!this._terrainStream && !this._terrainManifest) {
      const source = this._sceneData?.focusPlanet || this._sceneData?.planet || this._sceneData;
      const colonyId = Number(this._sceneData?.colony?.id || source?.colony_id || source?.__slot?.player_planet?.colony_id);
      const Stream = typeof require !== 'undefined'
        ? require('./ColonySurfaceLevelWebGPU.js').CubeSphereTerrainStream
        : window.GQColonySurfaceLevelWebGPU?.CubeSphereTerrainStream;
      if (Stream && Number.isSafeInteger(colonyId) && colonyId > 0) {
        this._terrainStream = new Stream(colonyId, (status) => {
          if (this._terrainStream?.manifest) this._terrainManifest = this._terrainStream.manifest;
          if (this._hint) {
            let message = this._hint.querySelector('[data-body-shape-status]');
            if (!message) {
              message = document.createElement('span');
              message.dataset.bodyShapeStatus = '';
              this._hint.appendChild(message);
            }
            message.textContent = ` ${status}`;
          }
        });
        this._terrainStream.load();
      }
    }
    const seconds = Math.max(0, Math.min(0.1, dt > 1 ? dt / 1000 : Number(dt) || 0.016));
    this._rotation += seconds * 0.05;
    this._time += seconds;
    const waterPolicy = this._livingPolicy.policy(this._sceneData);
    if (waterPolicy.motion && waterPolicy.visible) this._waterTime = (this._waterTime + seconds) % 120;
    this._drawFrame(cameraState);
  }

  renderBackdrop(dt, cameraState, opacity) {
    if (!this._pipeline) return false;
    this._rotation += dt * 0.05;
    this._time += dt;
    const waterPolicy = this._livingPolicy.policy(this._sceneData);
    const seconds = Math.max(0, Math.min(0.1, dt > 1 ? dt / 1000 : Number(dt) || 0.016));
    if (waterPolicy.motion && waterPolicy.visible) this._waterTime = (this._waterTime + seconds) % 120;
    this._drawFrame(cameraState, opacity);
    return true;
  }

  _clearSettlementMarkers() {
    this._settlementMarkers.forEach(marker => {
      marker.removeEventListener('click', marker.visitSettlement);
      marker.remove();
    });
    this._settlementMarkers.clear();
    this._projectedSettlements = [];
  }

  _mountSettlementMarkers() {
    if (!this._canvas?.parentElement || this._markerOverlay) return;
    this._markerOverlay = document.createElement('div');
    this._markerOverlay.setAttribute('role', 'group');
    this._markerOverlay.setAttribute('aria-label', this._backend?.externalCameraControls ? 'Siedlungsstandorte' : 'Settlement sites');
    Object.assign(this._markerOverlay.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '19', overflow: 'hidden',
    });
    this._canvas.parentElement.appendChild(this._markerOverlay);
  }

  _updateSettlementMarkers(frame) {
    if (!this._markerOverlay) return;
    const sites = this._surfacePlan?.settlements || [];
    for (const [id, marker] of this._settlementMarkers) {
      if (!sites.some(site => site.id === id)) {
        marker.removeEventListener('click', marker.visitSettlement);
        marker.remove();
        this._settlementMarkers.delete(id);
      } else marker.hidden = true;
    }
    this._projectedSettlements = [];
    if (!this._active || frame.opacity < 1) return;
    const rect = this._canvas.getBoundingClientRect();
    const overlayRect = this._markerOverlay.getBoundingClientRect();
    const geometry = typeof require !== 'undefined'
      ? require('./ColonySurfaceLevelWebGPU.js') : window.GQColonySurfaceLevelWebGPU;
    this._projectedSettlements = projectSettlementMarkers(this._surfacePlan, this._terrainManifest,
      { ...frame, width: rect.width, height: rect.height, vertices: this._markerVertices }, geometry);
    const canVisit = this._backend?.canSelectSettlement?.() !== false
      && (!this._backend?.externalCameraControls || (typeof this._backend.onSettlementSelect === 'function'
        && Number.isSafeInteger(Number(this._sceneData?.colony?.id)) && Number(this._sceneData.colony.id) > 0));
    for (const site of this._projectedSettlements) {
      let marker = this._settlementMarkers.get(site.id);
      if (!marker) {
        marker = document.createElement('button');
        marker.type = 'button';
        marker.dataset.settlementId = site.id;
        marker.visitSettlement = event => {
          event.preventDefault();
          event.stopPropagation();
          this.visitSettlement(site.id);
        };
        marker.addEventListener('click', marker.visitSettlement);
        Object.assign(marker.style, {
          position: 'absolute', transform: 'translate(-50%,-50%)', pointerEvents: 'auto',
          width: '26px', height: '26px', padding: '0', borderRadius: '50%', border: '2px solid #7dffb2',
          background: 'rgba(7,20,30,.92)', color: '#d9f3ff', font: 'bold 12px sans-serif',
        });
        this._markerOverlay.appendChild(marker);
        this._settlementMarkers.set(site.id, marker);
      }
      const german = this._backend?.externalCameraControls;
      let name = site.index === 0 ? (german ? 'Hauptsiedlung' : 'Primary settlement')
        : `${german ? 'Satellitenstadt' : 'Satellite'} ${site.index}`;
      const ruined = !!sites[site.index]?.ruined;
      if (ruined) name += german ? ' (Ruinen)' : ' (ruins)';
      const specialization = this._surfaceModel?.specializationLabel(sites[site.index], german);
      if (specialization) name += ` — ${specialization}`;
      marker.style.borderColor = ruined ? '#ad9678' : '#7dffb2';
      marker.textContent = site.index === 0 ? 'H' : String(site.index);
      marker.title = name;
      marker.setAttribute('aria-label', canVisit ? `${name}${german ? ' besuchen' : ' — visit'}` : name);
      marker.setAttribute('aria-pressed', String(this._sceneData?.settlement_id === site.id));
      marker.disabled = !canVisit;
      marker.hidden = false;
      marker.style.left = `${site.x + rect.left - overlayRect.left}px`;
      marker.style.top = `${site.y + rect.top - overlayRect.top}px`;
      marker.style.zIndex = String(Math.round((1 - site.depth) * 1000));
    }
  }

  pickSettlement(clientX, clientY) {
    if (!this._active || this._disposed || globalThis.document?.hidden) return null;
    const rect = this._canvas.getBoundingClientRect();
    let nearest = null, distance = 14;
    for (const site of this._projectedSettlements) {
      const marker = this._settlementMarkers.get(site.id);
      if (!marker || marker.hidden || marker.disabled) continue;
      const pixels = Math.hypot(clientX - rect.left - site.x, clientY - rect.top - site.y);
      if (pixels < distance) { nearest = site.id; distance = pixels; }
    }
    return nearest;
  }

  visitSettlement(id) {
    if (!this._active || this._disposed) return false;
    const marker = this._settlementMarkers.get(id);
    if (!marker || marker.hidden || marker.disabled) return false;
    if (this._backend?.externalCameraControls) return this._backend.onSettlementSelect(id);
    return this._navigation?.surface?.({ ...this._sceneData, bodyTerrainManifest: this._terrainManifest, settlement_id: id });
  }

  async _buildPipeline() {
    const materialModel = typeof require !== 'undefined'
      ? require('../../../rendering/body-material.js') : window.GQBodyMaterial;
    if (!materialModel) throw new Error('Shared body material module is required');
    if (typeof require === 'undefined' && !window.GQColonySurfacePlan) await import('../../../rendering/colony-surface-plan.js');
    if (this._disposed) return;
    if (typeof require === 'undefined' && !window.GQPlanetLivingWorld) await import('./PlanetLivingWorld.js');
    if (this._disposed) return;
    this._livingPolicy = typeof require !== 'undefined' ? require('./PlanetLivingWorld.js') : window.GQPlanetLivingWorld;
    this._surfaceModel = typeof require !== 'undefined'
      ? require('../../../rendering/colony-surface-plan.js') : window.GQColonySurfacePlan;
    const module = this._device.createShaderModule({
      label: 'planet_approach', code: materialModel.shader(this._surfaceModel.WGSL + PLANET_APPROACH_WGSL),
    });
    const format = globalThis.navigator?.gpu?.getPreferredCanvasFormat?.() || 'bgra8unorm';
    this._pipeline = this._device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this._solidPipeline = this._device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_mesh', buffers: [{
        arrayStride: 48, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x4' },
          { shaderLocation: 2, offset: 28, format: 'float32' },
          { shaderLocation: 3, offset: 32, format: 'float32x4' },
        ],
      }] },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this._uniformBuffer = this._device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this._materialBuffer = this._device.createBuffer({
      label: 'approach_body_material', size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._surfaceBuffer = this._device.createBuffer({
      label: 'approach_living_surface', size: this._surfaceModel.UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._bindGroup = this._device.createBindGroup({
      layout: this._pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 2, resource: { buffer: this._materialBuffer } },
        { binding: 3, resource: { buffer: this._surfaceBuffer } },
      ],
    });
    this._solidBindGroup = this._device.createBindGroup({
      layout: this._solidPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 2, resource: { buffer: this._materialBuffer } },
        { binding: 3, resource: { buffer: this._surfaceBuffer } },
      ],
    });
  }

  _drawFrame(cameraState, opacity = 1) {
    const aspect = this._canvas.width / Math.max(1, this._canvas.height);
    const target = cameraState?.target || { x: 0, y: 0, z: 0 };
    const position = cameraState?.position || { x: 0, y: 0, z: 15 };
    const cameraDistance = Math.hypot(
      (Number(position.x) || 0) - (Number(target.x) || 0),
      (Number(position.y) || 0) - (Number(target.y) || 0),
      (Number(position.z) || 0) - (Number(target.z) || 0)
    );
    const shape = this._terrainManifest?.shape;
    const geometry = typeof require !== 'undefined'
      ? require('./ColonySurfaceLevelWebGPU.js') : window.GQColonySurfaceLevelWebGPU;
    const solid = this._terrainManifest?.solid;
    const hasRegions = !!this._terrainManifest?.regions?.features?.length;
    const hasGeography = Number.isSafeInteger(this._terrainManifest?.seed)
      && Number.isFinite(this._terrainManifest?.amplitude_km) && this._terrainManifest?.radius_km > 0;
    const meshSurface = !!solid || hasRegions || hasGeography;
    if (hasGeography && this._surfacePlanManifest !== this._terrainManifest) {
      if (this._surfaceSitesManifest !== this._terrainManifest) {
        this._surfaceSites = geometry.livingSurfaceCandidates(this._terrainManifest, this._surfaceModel);
        this._surfaceRoads = geometry.livingSurfaceRoads(this._terrainManifest, this._surfaceModel, this._surfaceSites);
        this._surfaceSitesManifest = this._terrainManifest;
      }
      this._surfacePlan = this._surfaceModel.plan(this._sceneData, this._terrainManifest, this._surfaceSites, this._surfaceRoads);
      this._surfacePlanManifest = this._terrainManifest;
    } else if (!hasGeography) this._surfacePlan = null;
    this._device.queue.writeBuffer(this._surfaceBuffer, 0,
      this._surfaceModel.uniforms(this._surfacePlan, this._time, this._livingPolicy.policy(this._sceneData)));
    const extent = solid ? geometry.bodySolidBound(solid)
      : Math.max(...(shape?.axes || [1, 1, 1])) * (1 + (shape?.deformation || 0));
    const distance = this._backend?.externalCameraControls
      ? Math.max(extent * 1.04, cameraDistance)
      : (2.8 + Math.min(2, cameraDistance / 50)) * extent;
    const near = 0.1;
    const far = Math.max(20, distance + extent * 2);
    const waterPolicy = this._livingPolicy.policy(this._sceneData);
    const atmosphere = geometry.resolveBodySurface(this._sceneData, 1, 1).atmosphere;
    const uniforms = new Float32Array(36);
    uniforms.set(planetViewProjection(cameraState, aspect, distance, near, far));
    uniforms.set([...this._visualPalette.base,1],16);
    uniforms.set([...this._visualPalette.atmo,atmosphere.coverage],20);
    uniforms.set([this._rotation,this._time,opacity,solid ? 1 : 0],24);
    uniforms.set([...(shape?.axes || [1, 1, 1]),shape?.deformation || 0],28);
    const back = normalizeVector([position.x - target.x, position.y - target.y, position.z - target.z], [0, 0, 1]);
    uniforms.set([back[0] * distance + target.x, back[1] * distance + target.y, back[2] * distance + target.z,
      waterPolicy.enabled && waterPolicy.visible ? atmosphere.strength : 0],32);
    this._device.queue.writeBuffer(this._uniformBuffer,0,uniforms);
    const materialModel = typeof require !== 'undefined'
      ? require('../../../rendering/body-material.js') : window.GQBodyMaterial;
    const source = this._sceneData?.focusPlanet || this._sceneData?.planet || this._sceneData?.colony || this._sceneData || {};
    this._materialState = materialModel.resolveBodyMaterial(source, this._terrainManifest);
    this._materialPixels = this._canvas.height * 1.73 / distance;
    this._device.queue.writeBuffer(this._materialBuffer, 0,
      materialModel.materialUniforms(this._materialState, this._materialPixels, [0, 0, 0],
        { seconds: this._waterTime, enabled: waterPolicy.enabled && waterPolicy.visible && !waterPolicy.reducedFlash }));
    if (this._terrainManifest && this._publishedTerrainManifest !== this._terrainManifest) {
      this._backend?.setBodyTerrainManifest?.(this._terrainManifest);
      this._publishedTerrainManifest = this._terrainManifest;
    }
    if (meshSurface) {
      const manifestKey = JSON.stringify(this._terrainManifest);
      const rows = solid ? null : geometry.terrainSphereResolution(this._materialPixels,
        manifestKey === this._sphereManifestKey ? this._sphereRows : null);
      const key = `${manifestKey}:${rows}`;
      if (key !== this._solidMeshKey) {
        let vertices, vertexCount;
        if (solid) {
          const mesh = geometry.buildCompositeBodyMesh(this._terrainManifest, 160);
          vertices = new Float32Array(mesh.vertexCount * 7);
          for (let index = 0; index < mesh.vertexCount; index++) {
            const point = Array.from(mesh.vertices.subarray(index * 3, index * 3 + 3));
            const region = geometry.terrainRegionVisual?.(this._terrainManifest.regions,
              point.map((value) => value / Math.max(1e-10, Math.hypot(...point))), this._terrainManifest.radius_km);
            vertices.set([...point, ...(region?.color || [0, 0, 0]), region?.weight || 0], index * 7);
          }
          vertexCount = mesh.vertexCount;
        } else {
          const mesh = geometry.buildTerrainRegionSphereMesh(this._terrainManifest, rows, rows * 2);
          vertices = mesh.vertices;
          vertexCount = mesh.vertexCount;
        }
        const materialVertices = new Float32Array(vertexCount * 12);
        const materialModel = typeof require !== 'undefined'
          ? require('../../../rendering/body-material.js') : window.GQBodyMaterial;
        for (let index = 0; index < vertexCount; index++) {
          const point = Array.from(vertices.subarray(index * 7, index * 7 + 3));
          const direction = normalizeVector(point, [0, 1, 0]);
          const height = hasGeography ? geometry.bodyGeologicalHeight(this._terrainManifest, direction) : 0;
          const biome = this._materialState.biome;
          const wet = ['terran', 'ocean', 'lava'].includes(biome) && height < (this._terrainManifest.sea_level_km ?? 0);
          const frozen = biome === 'ice' || (biome === 'terran' && height > this._terrainManifest.amplitude_km * 0.55);
          const material = wet ? (biome === 'lava' ? 3 : 1) : frozen ? 2 : 0;
          materialVertices.set(vertices.subarray(index * 7, index * 7 + 7), index * 12);
          materialVertices[index * 12 + 7] = material;
          materialVertices.set(hasGeography
            ? materialModel.terrainBoundaries(biome, height,
              this._terrainManifest.amplitude_km, this._terrainManifest.sea_level_km ?? 0)
            : [1, -1, 0, 0], index * 12 + 8);
        }
        vertices = materialVertices;
        this._markerVertices = vertices;
        this._solidBuffer?.destroy();
        this._solidBuffer = this._device.createBuffer({
          label: solid ? 'approach_composite_solid' : 'approach_geojson_regions', size: vertices.byteLength,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this._device.queue.writeBuffer(this._solidBuffer, 0, vertices);
        this._solidVertexCount = vertexCount;
        this._solidMeshKey = key;
        this._sphereManifestKey = manifestKey;
        this._sphereRows = rows;
      }
    }
    if (!this._depthTexture || this._depthTexture.width !== this._canvas.width || this._depthTexture.height !== this._canvas.height) {
      this._depthTexture?.destroy();
      this._depthTexture = this._device.createTexture({
        label: 'approach_depth', size: [this._canvas.width, this._canvas.height], format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    const encoder = this._device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this._context.getCurrentTexture().createView(),
        clearValue: { r: this._visualPalette.clear[0], g: this._visualPalette.clear[1], b: this._visualPalette.clear[2], a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this._depthTexture.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });
    pass.setPipeline(meshSurface ? this._solidPipeline : this._pipeline);
    pass.setBindGroup(0, meshSurface ? this._solidBindGroup : this._bindGroup);
    if (meshSurface) pass.setVertexBuffer(0, this._solidBuffer);
    pass.draw(meshSurface ? this._solidVertexCount : 32 * 64 * 6,1,0,0);
    pass.end();
    this._device.queue.submit([encoder.finish()]);
    this._updateSettlementMarkers({
      rotation: this._rotation, matrix: uniforms.subarray(0, 16), eye: Array.from(uniforms.subarray(32, 35)), opacity,
    });
  }

  _applySceneDataVisuals(data) {
    const source = data?.focusPlanet || data?.planet || data?.colony || data?.target || data || {};
    const owner = source.colony_owner_color || source.owner_color || source.faction_color;
    this._visualPalette = {
      base: planetColor(owner, '3373cc'),
      atmo: planetColor(Number(source.colony_is_player || source.is_player) === 1 ? '#7dffb2' : owner, '8cc4ff'),
      clear: owner ? [0.02,0.04,0.07] : [0,0,0.02],
    };
  }

  dispose() {
    this._disposed = true;
    const errors = this._releaseViewResources();
    const attempt = (cleanup) => {
      try { cleanup(); } catch (error) { errors.push(error); }
    };
    attempt(() => this._uniformBuffer?.destroy());
    this._uniformBuffer = null;
    attempt(() => this._materialBuffer?.destroy());
    this._materialBuffer = null;
    attempt(() => this._surfaceBuffer?.destroy());
    this._surfaceBuffer = null;
    this._surfacePlan = null;
    this._surfaceSites = null;
    this._surfaceRoads = null;
    this._surfaceSitesManifest = null;
    this._surfacePlanManifest = null;
    this._pipeline = null;
    this._solidPipeline = null;
    this._solidBindGroup = null;
    this._bindGroup = null;
    this._device = null;
    this._context = null;
    this._canvas = null;
    this._backend = null;
    this._sceneData = null;
    this._navigation = null;
    this._terrainManifest = null;
    this._publishedTerrainManifest = null;
    this._materialState = null;
    this._solidVertexCount = 0;
    if (errors.length) throw new AggregateError(errors, 'Planet approach disposal failed');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PersistentBodyPlanetApproachRenderer, PLANET_APPROACH_WGSL, planetViewProjection,
    settlementOccluded, projectSettlementMarkers,
  };
} else {
  window.GQPersistentBodyPlanetApproach = { PersistentBodyPlanetApproachRenderer };
}
