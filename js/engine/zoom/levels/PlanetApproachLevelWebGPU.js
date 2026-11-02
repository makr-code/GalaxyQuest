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
};
@group(0) @binding(0) var<uniform> u: Uniforms;
struct Out {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) world: vec3<f32>,
};
fn noise(p: vec2<f32>) -> f32 {
  return sin(p.x * 2.7 + sin(p.y * 3.8)) * cos(p.y * 2.1 + sin(p.x * 1.7)) * 0.5 + 0.5;
}
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
  let wave = 0.6 * (normal.x * normal.x - normal.y * normal.y) + 0.4 * normal.x * normal.z;
  let factor = (1.0 + u.shape.w * wave) / length(normal / max(u.shape.xyz,vec3<f32>(0.5)));
  out.world = normal * factor;
  out.position = u.viewProjection * vec4<f32>(out.world,1);
  out.normal = normal;
  out.uv = uv;
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let face = cross(dpdx(in.world),dpdy(in.world));
  let geometric = face / max(length(face),0.00001);
  let normal = select(-geometric,geometric,dot(geometric,in.normal) >= 0.0);
  let terrain = noise(in.uv * vec2<f32>(9,17));
  let cloud = smoothstep(0.65,0.9,noise(in.uv * vec2<f32>(15,23) + vec2<f32>(u.animation.y * 0.02,0)));
  let light = 0.24 + 0.76 * max(0.0,dot(normal,normalize(vec3<f32>(-0.7,0.8,1))));
  let surface = mix(u.base.rgb * 0.55,u.base.rgb * 1.3,terrain) + cloud * 0.17;
  let rim = pow(1.0 - abs(normal.z),3.0);
  return vec4<f32>(mix(surface * light,u.atmosphere.rgb,rim * 0.7) * u.animation.z,1);
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

class PlanetApproachLevelWebGPU extends ZoomLevelRendererBase {
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
    this._active = false;
    this._inputCleanups = [];
    this._hint = null;
    this._visualPalette = { base: [0.2,0.45,0.8], atmo: [0.55,0.75,1], clear: [0,0,0.02] };
  }

  async initialize(canvas, backend) {
    this._canvas = canvas;
    this._backend = backend;
    this._device = backend?.device || null;
    this._context = backend?.context || null;
    if (!this._device || !this._context) throw new Error('PlanetApproachLevelWebGPU requires the shared WebGPU device and canvas context');
    await this._buildPipeline();
  }

  setSceneData(data) {
    this._terrainStream?.dispose();
    this._terrainStream = null;
    this._terrainManifest = null;
    this._sceneData = data;
    this._applySceneDataVisuals(data);
  }

  setNavigationHandlers(handlers) {
    this._navigation = handlers;
  }

  async enter(prevLevel, payload) {
    await this.exit();
    this._active = true;
    this._rotation = 0;
    this._time = 0;
    if (payload) this.setSceneData(payload);
    this._applySceneDataVisuals(this._sceneData);
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
    this._active = false;
    this._terrainStream?.dispose();
    this._terrainStream = null;
    this._inputCleanups.splice(0).forEach((cleanup) => cleanup());
    this._hint?.remove();
    this._hint = null;
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
    this._drawFrame(cameraState);
  }

  renderBackdrop(dt, cameraState, opacity) {
    if (!this._pipeline) return false;
    this._rotation += dt * 0.05;
    this._time += dt;
    this._drawFrame(cameraState, opacity);
    return true;
  }

  async _buildPipeline() {
    const module = this._device.createShaderModule({ label: 'planet_approach', code: PLANET_APPROACH_WGSL });
    const format = globalThis.navigator?.gpu?.getPreferredCanvasFormat?.() || 'bgra8unorm';
    this._pipeline = this._device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
    });
    this._uniformBuffer = this._device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this._bindGroup = this._device.createBindGroup({
      layout: this._pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._uniformBuffer } }],
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
    const extent = Math.max(...(shape?.axes || [1, 1, 1])) * (1 + (shape?.deformation || 0));
    const distance = (2.8 + Math.min(2, cameraDistance / 50)) * extent;
    const near = 0.1;
    const far = 20;
    const uniforms = new Float32Array(32);
    uniforms.set(planetViewProjection(cameraState, aspect, distance, near, far));
    uniforms.set([...this._visualPalette.base,1],16);
    uniforms.set([...this._visualPalette.atmo,1],20);
    uniforms.set([this._rotation,this._time,opacity,0],24);
    uniforms.set([...(shape?.axes || [1, 1, 1]),shape?.deformation || 0],28);
    this._device.queue.writeBuffer(this._uniformBuffer,0,uniforms);
    const encoder = this._device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this._context.getCurrentTexture().createView(),
        clearValue: { r: this._visualPalette.clear[0], g: this._visualPalette.clear[1], b: this._visualPalette.clear[2], a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0,this._bindGroup);
    pass.draw(32 * 64 * 6,1,0,0);
    pass.end();
    this._device.queue.submit([encoder.finish()]);
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
    this.exit();
    this._uniformBuffer?.destroy();
    this._uniformBuffer = null;
    this._pipeline = null;
    this._bindGroup = null;
    this._device = null;
    this._context = null;
    this._canvas = null;
    this._backend = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlanetApproachLevelWebGPU, PLANET_APPROACH_WGSL, planetViewProjection };
} else {
  window.GQPlanetApproachLevelWebGPU = { PlanetApproachLevelWebGPU };
}
