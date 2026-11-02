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
};
@group(0) @binding(0) var<uniform> u: Uniforms;
struct Out {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
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
  out.position = u.viewProjection * vec4<f32>(normal,1);
  out.normal = normal;
  out.uv = uv;
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let normal = normalize(in.normal);
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
      if (event.type === 'wheel' && event.deltaY >= 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this._navigation?.surface?.(this._sceneData);
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
      backButton.textContent = 'Back to system';
      backButton.addEventListener('click', () => this._navigation?.back?.());
      this._hint.append(landButton, backButton);
      this._canvas.parentElement.appendChild(this._hint);
    }
  }

  async exit() {
    this._active = false;
    this._inputCleanups.splice(0).forEach((cleanup) => cleanup());
    this._hint?.remove();
    this._hint = null;
  }

  render(dt, cameraState) {
    if (!this._active || !this._pipeline) return;
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
    this._uniformBuffer = this._device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this._bindGroup = this._device.createBindGroup({
      layout: this._pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._uniformBuffer } }],
    });
  }

  _drawFrame(cameraState, opacity = 1) {
    const aspect = this._canvas.width / Math.max(1, this._canvas.height);
    const z = Math.abs(Number(cameraState?.position?.z) || 15);
    const distance = 2.8 + Math.min(2, z / 50);
    const near = 0.1;
    const far = 20;
    const projection = new Float32Array([
      1.73 / aspect,0,0,0, 0,1.73,0,0, 0,0,far / (near - far),-1,
      0,0,(far * near - far * distance) / (near - far),distance,
    ]);
    const uniforms = new Float32Array(28);
    uniforms.set(projection);
    uniforms.set([...this._visualPalette.base,1],16);
    uniforms.set([...this._visualPalette.atmo,1],20);
    uniforms.set([this._rotation,this._time,opacity,0],24);
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
  module.exports = { PlanetApproachLevelWebGPU, PLANET_APPROACH_WGSL };
} else {
  window.GQPlanetApproachLevelWebGPU = { PlanetApproachLevelWebGPU };
}
