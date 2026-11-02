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
  let canonical = vec3<f32>(cos(latitude) * cos(uv.y * 6.2831853),sin(latitude),cos(latitude) * sin(uv.y * 6.2831853));
  let wave = 0.6 * (canonical.x * canonical.x - canonical.y * canonical.y) + 0.4 * canonical.x * canonical.z;
  let factor = (1.0 + u.shape.w * wave) / length(canonical / max(u.shape.xyz,vec3<f32>(0.5)));
  out.world = normal * factor;
  out.bodyPoint = canonical * factor;
  out.position = u.viewProjection * vec4<f32>(out.world,1);
  out.normal = normal;
  out.uv = uv;
  out.region = vec4<f32>(0);
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
  var surface = gqSurface(in.bodyPoint,in.bodyPoint * gqMaterial.scale.y,canonicalNormal,-1.0);
  surface.albedo = mix(surface.albedo,gqLinear(in.region.rgb),in.region.a);
  let cloud = smoothstep(0.65,0.9,noise(in.uv * vec2<f32>(15,23) + vec2<f32>(u.animation.y * 0.02,0))) * (1.0 - u.animation.w);
  let light = normalize(vec3<f32>(-0.7,0.8,1));
  let canonicalLight = vec3<f32>(light.x * c + light.z * s,light.y,-light.x * s + light.z * c);
  var color = surface.albedo * 0.3 + surface.emission + gqDirect(surface,view,canonicalLight,vec3<f32>(2.8));
  color = mix(color,vec3<f32>(0.8),cloud * 0.17);
  let rim = pow(1.0 - abs(normal.z),3.0);
  return vec4<f32>(gqFinish(mix(color,gqLinear(u.atmosphere.rgb),rim * 0.3 * (1.0 - u.animation.w))) * u.animation.z,1);
}
@vertex fn vs_mesh(@location(0) point: vec3<f32>, @location(1) region: vec4<f32>) -> Out {
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
    this._solidBuffer?.destroy();
    this._solidBuffer = null;
    this._solidMeshKey = '';
    this._depthTexture?.destroy();
    this._depthTexture = null;
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
    const materialModel = typeof require !== 'undefined'
      ? require('../../../rendering/body-material.js') : window.GQBodyMaterial;
    if (!materialModel) throw new Error('Shared body material module is required');
    const module = this._device.createShaderModule({ label: 'planet_approach', code: materialModel.shader(PLANET_APPROACH_WGSL) });
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
        arrayStride: 28, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x4' },
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
    this._bindGroup = this._device.createBindGroup({
      layout: this._pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 2, resource: { buffer: this._materialBuffer } },
      ],
    });
    this._solidBindGroup = this._device.createBindGroup({
      layout: this._solidPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 2, resource: { buffer: this._materialBuffer } },
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
    const meshSurface = !!solid || hasRegions;
    const extent = solid ? geometry.bodySolidBound(solid)
      : Math.max(...(shape?.axes || [1, 1, 1])) * (1 + (shape?.deformation || 0));
    const distance = (2.8 + Math.min(2, cameraDistance / 50)) * extent;
    const near = 0.1;
    const far = Math.max(20, distance + extent * 2);
    const uniforms = new Float32Array(36);
    uniforms.set(planetViewProjection(cameraState, aspect, distance, near, far));
    uniforms.set([...this._visualPalette.base,1],16);
    uniforms.set([...this._visualPalette.atmo,1],20);
    uniforms.set([this._rotation,this._time,opacity,solid ? 1 : 0],24);
    uniforms.set([...(shape?.axes || [1, 1, 1]),shape?.deformation || 0],28);
    const back = normalizeVector([position.x - target.x, position.y - target.y, position.z - target.z], [0, 0, 1]);
    uniforms.set([back[0] * distance + target.x, back[1] * distance + target.y, back[2] * distance + target.z, 0],32);
    this._device.queue.writeBuffer(this._uniformBuffer,0,uniforms);
    const materialModel = typeof require !== 'undefined'
      ? require('../../../rendering/body-material.js') : window.GQBodyMaterial;
    const source = this._sceneData?.focusPlanet || this._sceneData?.planet || this._sceneData?.colony || this._sceneData || {};
    this._materialState = materialModel.resolveBodyMaterial(source, this._terrainManifest);
    this._materialPixels = this._canvas.height * 1.73 / distance;
    this._device.queue.writeBuffer(this._materialBuffer, 0,
      materialModel.materialUniforms(this._materialState, this._materialPixels));
    if (this._terrainManifest && this._publishedTerrainManifest !== this._terrainManifest) {
      this._backend?.setBodyTerrainManifest?.(this._terrainManifest);
      this._publishedTerrainManifest = this._terrainManifest;
    }
    if (meshSurface) {
      const key = JSON.stringify(this._terrainManifest);
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
          const mesh = geometry.buildTerrainRegionSphereMesh(this._terrainManifest);
          vertices = mesh.vertices;
          vertexCount = mesh.vertexCount;
        }
        this._solidBuffer?.destroy();
        this._solidBuffer = this._device.createBuffer({
          label: solid ? 'approach_composite_solid' : 'approach_geojson_regions', size: vertices.byteLength,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this._device.queue.writeBuffer(this._solidBuffer, 0, vertices);
        this._solidVertexCount = vertexCount;
        this._solidMeshKey = key;
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
    this._materialBuffer?.destroy();
    this._materialBuffer = null;
    this._pipeline = null;
    this._solidPipeline = null;
    this._solidBindGroup = null;
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
