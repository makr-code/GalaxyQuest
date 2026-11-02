/**
 * Native planet approach. Analytic ray/sphere intersections avoid tessellation
 * seams and invalid clip coordinates; shared local maps supply seeded terrain.
 * Lambert/water highlights, cloud shell and atmosphere are not full planet PBR.
 */
'use strict';

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js') : window.GQIZoomLevelRenderer;

class PlanetLivingWorldApproachRenderer extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas = this._backend = this._sceneData = null;
    this._device = this._context = this._pipeline = null;
    this._uniformBuffer = this._bindGroup = null;
    this._textures = [];
    this._rotation = this._cloudRotation = 0;
    this._unloaded = false;
    this._resourceEpoch = 0;
    this._visualPalette = { base: [0.2, 0.45, 0.8], atmo: [0.33, 0.67, 1], clear: [0.016, 0.031, 0.078] };
  }

  async initialize(canvas, backend) {
    this._releaseOwned();
    this._unloaded = false;
    const epoch = this._resourceEpoch;
    this._canvas = canvas;
    this._backend = backend;
    this._device = backend?.device || null;
    this._context = backend?.context || null;
    if (!this._device || !this._context) {
      throw new Error('PlanetApproachLevelWebGPU requires the shared WebGPU device and canvas context');
    }
    const device = this._device;
    const world = await this._loadWorld();
    if (!this._isCurrent(epoch, device)) return;
    this._world = world;
    await this._buildPipeline(epoch);
    if (!this._isCurrent(epoch, device)) return;
    this._applySceneDataVisuals(this._sceneData);
  }

  async _loadWorld() {
    if (typeof require !== 'undefined') return require('./PlanetLivingWorld.js');
    if (window.GQPlanetLivingWorld) return window.GQPlanetLivingWorld;
    await import('../../../rendering/planet-textures.js');
    await import('./PlanetLivingWorld.js');
    return window.GQPlanetLivingWorld;
  }

  _isCurrent(epoch, device) {
    return epoch === this._resourceEpoch && this._device === device && !!device && !this._unloaded;
  }

  setSceneData(data) {
    this._sceneData = data || null;
    this._applySceneDataVisuals(data);
  }

  render(dt, cameraState) {
    if (this._unloaded || !this._pipeline) return;
    const policy = this._world.policy(this._sceneData);
    if (!policy.visible) return;
    if (policy.motion) {
      const seconds = this._world.delta(dt);
      this._rotation = (this._rotation + seconds * 0.05) % (Math.PI * 2);
      this._cloudRotation = (this._cloudRotation + seconds * 0.073) % (Math.PI * 2);
    }
    this._refreshMaps(policy);
    this._drawFrame(cameraState, policy);
  }

  async enter(prevLevel, transitionPayload) {
    const epoch = ++this._resourceEpoch;
    const device = this._device;
    this._unloaded = false;
    this._rotation = this._cloudRotation = 0;
    if (transitionPayload) this._sceneData = transitionPayload;
    if (!this._world) {
      const world = await this._loadWorld();
      if (!this._isCurrent(epoch, device)) return;
      this._world = world;
    }
    if (!this._isCurrent(epoch, device)) return;
    if (!this._pipeline) await this._buildPipeline(epoch);
    if (!this._isCurrent(epoch, device)) return;
    this._applySceneDataVisuals(this._sceneData);
  }

  async exit() {
    this._unloaded = true;
    this._releaseOwned();
  }

  _releaseOwned() {
    this._resourceEpoch++;
    this._textures.forEach(texture => texture.destroy());
    this._textures = [];
    this._uniformBuffer?.destroy();
    this._uniformBuffer = this._bindGroup = this._pipeline = null;
    this._mapKey = null;
  }

  dispose() {
    this._unloaded = true;
    this._releaseOwned();
    this._device = this._context = this._canvas = this._backend = null;
  }

  async _buildPipeline(epoch = this._resourceEpoch) {
    const device = this._device;
    if (!this._isCurrent(epoch, device)) return;
    const context = this._context;
    const module = device.createShaderModule({ code: /* wgsl */`
      struct Uniforms {
        camera: vec4f, aim: vec4f, motion: vec4f, effects: vec4f, owner: vec4f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;
      @group(0) @binding(1) var mapSampler: sampler;
      @group(0) @binding(2) var surfaceMap: texture_2d<f32>;
      @group(0) @binding(3) var cloudMap: texture_2d<f32>;
      @group(0) @binding(4) var nightMap: texture_2d<f32>;
      struct Vertex { @builtin(position) position: vec4f, @location(0) screen: vec2f };
      @vertex fn vs_main(@builtin(vertex_index) index: u32) -> Vertex {
        let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u)) * 2.0 - 1.0;
        var out: Vertex;
        out.position = vec4f(p, 0.0, 1.0); out.screen = p; return out;
      }
      fn intersect(origin: vec3f, ray: vec3f, radius: f32) -> f32 {
        let b = dot(origin, ray);
        let d = b * b - dot(origin, origin) + radius * radius;
        if (d < 0.0) { return -1.0; }
        let near = -b - sqrt(d);
        if (near > 0.0) { return near; }
        return -1.0;
      }
      fn uv(normal: vec3f, rotation: f32) -> vec2f {
        return vec2f(fract(0.5 - atan2(normal.z, normal.x) / 6.2831853 - rotation / 6.2831853),
          0.5 - asin(clamp(normal.y, -1.0, 1.0)) / 3.14159265);
      }
      fn srgbToLinear(color: vec3f) -> vec3f {
        return select(pow((color + 0.055) / 1.055, vec3f(2.4)), color / 12.92,
          color <= vec3f(0.04045));
      }
      fn linearToSrgb(color: vec3f) -> vec3f {
        let value = max(color, vec3f(0.0));
        return select(1.055 * pow(value, vec3f(1.0 / 2.4)) - 0.055, value * 12.92,
          value <= vec3f(0.0031308));
      }
      @fragment fn fs_main(in: Vertex) -> @location(0) vec4f {
        let origin = u.camera.xyz;
        let forward = normalize(u.aim.xyz - origin);
        var upAxis = vec3f(0.0, 1.0, 0.0);
        if (abs(forward.y) > 0.99) { upAxis = vec3f(0.0, 0.0, 1.0); }
        let right = normalize(cross(forward, upAxis));
        let up = cross(right, forward);
        let ray = normalize(forward + 0.57735027 * (in.screen.x * u.camera.w * right + in.screen.y * up));
        let sun = normalize(vec3f(-0.75, 0.4, 0.38));
        var col = srgbToLinear(vec3f(0.016, 0.031, 0.078));
        let hit = intersect(origin, ray, 5.0);
        if (hit > 0.0) {
          let normal = normalize(origin + ray * hit);
          let coords = uv(normal, u.motion.x);
          let surface = textureSampleLevel(surfaceMap, mapSampler, coords, 0.0);
          let daylight = max(0.0, dot(normal, sun));
          let night = 1.0 - smoothstep(-0.15, 0.2, dot(normal, sun));
          col = surface.rgb * (0.045 + daylight * 1.3);
          let halfVector = normalize(sun - ray);
          col += vec3f(0.55, 0.72, 0.85) * pow(max(0.0, dot(normal, halfVector)), 60.0)
            * surface.a * daylight;
          let emission = textureSampleLevel(nightMap, mapSampler, coords, 0.0).rgb;
          col += emission * (night * u.effects.z + u.effects.w);
          col += vec3f(0.12, 0.35, 0.65) * pow(1.0 - max(0.0, dot(normal, -ray)), 4.0)
            * u.effects.y * (0.15 + daylight);
        }
        let cloudHit = intersect(origin, ray, 5.12);
        if (cloudHit > 0.0 && u.effects.x > 0.0) {
          let normal = normalize(origin + ray * cloudHit);
          let clouds = textureSampleLevel(cloudMap, mapSampler, uv(normal, u.motion.y), 0.0).a;
          let light = 0.08 + max(0.0, dot(normal, sun)) * 1.1;
          col = mix(col, vec3f(light), clouds * 0.8);
        }
        let atmoHit = intersect(origin, ray, 5.4);
        if (atmoHit > 0.0 && hit < 0.0) {
          let normal = normalize(origin + ray * atmoHit);
          let rim = pow(max(0.0, 1.0 - dot(normal, -ray)), 2.0);
          col += vec3f(0.12, 0.35, 0.65) * rim * u.effects.y * 0.5;
        }
        let impact = length(cross(origin, ray));
        if (dot(origin, ray) < 0.0 && impact > 6.08 && impact < 6.22 && u.owner.w > 0.0) {
          col = mix(col, srgbToLinear(u.owner.rgb), 0.85);
        }
        // Reinhard in linear light, then exactly one encoding for the unorm canvas.
        return vec4f(linearToSrgb(col / (col + vec3f(1.0))), 1.0);
      }
    ` });
    let compilation;
    try {
      compilation = await module.getCompilationInfo?.();
    } catch (error) {
      if (!this._isCurrent(epoch, device)) return;
      throw error;
    }
    if (!this._isCurrent(epoch, device)) return;
    const errors = compilation?.messages.filter(message => message.type === 'error') || [];
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const config = {
      layout: 'auto', vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{
        format: context.getConfiguration?.()?.format || navigator.gpu.getPreferredCanvasFormat(),
      }] }, primitive: { topology: 'triangle-list' },
    };
    let pipeline;
    try {
      pipeline = device.createRenderPipelineAsync
        ? await device.createRenderPipelineAsync(config) : device.createRenderPipeline(config);
    } catch (error) {
      if (!this._isCurrent(epoch, device)) return;
      throw error;
    }
    if (!this._isCurrent(epoch, device)) return;
    this._pipeline = pipeline;
    this._uniformBuffer = device.createBuffer({
      size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  _applySceneDataVisuals(data) {
    if (!this._world) return;
    this._visualPalette = this._world.palette(data);
    this._descriptor = this._world.describe(data);
    if (this._pipeline && !this._unloaded) this._refreshMaps(this._world.policy(data));
  }

  _refreshMaps(policy) {
    const descriptor = this._descriptor || this._world.describe(this._sceneData);
    const key = JSON.stringify([descriptor, policy.size]);
    if (key === this._mapKey) return;
    const maps = this._world.maps(descriptor, policy.size);
    this._textures.forEach(texture => texture.destroy());
    this._textures = ['surface', 'cloud', 'night'].map(name => {
      const texture = this._device.createTexture({
        size: [maps.width, maps.height], format: name === 'cloud' ? 'rgba8unorm' : 'rgba8unorm-srgb',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this._device.queue.writeTexture({ texture }, maps[name],
        { bytesPerRow: maps.width * 4 }, [maps.width, maps.height]);
      return texture;
    });
    this._bindGroup = this._device.createBindGroup({
      layout: this._pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: this._device.createSampler({
          magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge',
        }) },
        ...this._textures.map((texture, index) => ({ binding: index + 2, resource: texture.createView() })),
      ],
    });
    this._mapKey = key;
  }

  _drawFrame(cameraState, policy) {
    const position = cameraState?.position;
    const target = cameraState?.target;
    const safe = (value, fallback) => Number.isFinite(value) ? Math.max(-1e6, Math.min(1e6, value)) : fallback;
    const camera = [safe(position?.x, 0), safe(position?.y, 0), safe(position?.z, 20)];
    if (Math.hypot(...camera) < 5.5) camera.splice(0, 3, 0, 0, 20);
    const aim = [safe(target?.x, 0), safe(target?.y, 0), safe(target?.z, 0)];
    if (Math.hypot(...aim.map((value, i) => value - camera[i])) < 0.001) aim.splice(0, 3, 0, 0, 0);
    const owner = this._world.rgb(this._visualPalette.ringColor);
    this._device.queue.writeBuffer(this._uniformBuffer, 0, new Float32Array([
      ...camera, Math.max(1, this._canvas.width) / Math.max(1, this._canvas.height),
      ...aim, 0, this._rotation, this._cloudRotation, 0, 0,
      policy.enabled ? 1 : 0, policy.enabled ? this._descriptor.atmosphere : 0,
      policy.enabled ? this._world.state(this._sceneData) : 0,
      policy.enabled && this._descriptor.variant === 'lava' ? 0.6 : 0,
      ...owner, this._visualPalette.isOwned ? 1 : 0,
    ]));
    const encoder = this._device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: this._context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
      clearValue: { r: 0.016, g: 0.031, b: 0.078, a: 1 },
    }] });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.draw(3);
    pass.end();
    this._device.queue.submit([encoder.finish()]);
  }
}

function hasPersistentBodyData(data) {
  const source = data?.focusPlanet || data?.planet || data?.colony || data?.target || data || {};
  const manifest = data?.bodyTerrainManifest || data?.body_terrain_manifest
    || data?.terrainManifest || data?.terrain_manifest
    || source?.bodyTerrainManifest || source?.body_terrain_manifest || source?.terrain_manifest;
  const shape = manifest?.shape || source?.shape;
  const nonSpherical = shape && (
    Number(shape.deformation) > 0
    || (Array.isArray(shape.axes) && shape.axes.some((axis) => Math.abs(Number(axis) - 1) > 1e-6))
  );
  const regions = manifest?.regions || source?.regions;
  const colonyId = Number(data?.colony?.id || source?.colony_id
    || source?.__slot?.player_planet?.colony_id || 0);
  return !!(manifest || source?.solid || regions?.features?.length || nonSpherical
    || (Number.isSafeInteger(colonyId) && colonyId > 0));
}

class PlanetApproachLevelWebGPU extends PlanetLivingWorldApproachRenderer {
  constructor() {
    super();
    this._persistentRenderer = null;
    this._persistentActive = false;
    this._navigation = null;
  }

  setNavigationHandlers(handlers) {
    this._navigation = handlers;
    this._persistentRenderer?.setNavigationHandlers(handlers);
  }

  setSceneData(data) {
    super.setSceneData(data);
    this._persistentActive = hasPersistentBodyData(this._sceneData);
    this._persistentRenderer?.setSceneData(this._sceneData);
  }

  async _ensurePersistentRenderer() {
    if (!this._persistentRenderer) {
      const persistent = typeof require !== 'undefined'
        ? require('./PersistentBodyPlanetApproachRenderer.js')
        : window.GQPersistentBodyPlanetApproach || await import('./PersistentBodyPlanetApproachRenderer.js');
      const PersistentRenderer = persistent.PersistentBodyPlanetApproachRenderer
        || window.GQPersistentBodyPlanetApproach?.PersistentBodyPlanetApproachRenderer;
      if (!PersistentRenderer) throw new Error('Persistent body approach renderer is unavailable');
      this._persistentRenderer = new PersistentRenderer();
      await this._persistentRenderer.initialize(this._canvas, this._backend);
      this._persistentRenderer.setNavigationHandlers(this._navigation);
      this._persistentRenderer.setSceneData(this._sceneData);
    }
  }

  async enter(prevLevel, transitionPayload) {
    await super.enter(prevLevel, transitionPayload);
    this.setSceneData(transitionPayload || this._sceneData);
    if (!this._persistentActive) return;
    await this._ensurePersistentRenderer();
    await this._persistentRenderer.enter(prevLevel, transitionPayload);
  }

  render(dt, cameraState) {
    if (this._persistentActive && this._persistentRenderer) {
      this._persistentRenderer.render(dt, cameraState);
      return;
    }
    super.render(dt, cameraState);
  }

  renderBackdrop(dt, cameraState, opacity) {
    if (!this._persistentActive || !this._persistentRenderer) return false;
    return this._persistentRenderer.renderBackdrop(dt, cameraState, opacity);
  }

  async exit(nextLevel) {
    this._persistentActive = false;
    await this._persistentRenderer?.exit(nextLevel);
    await super.exit(nextLevel);
  }

  dispose() {
    this._persistentRenderer?.dispose();
    this._persistentRenderer = null;
    super.dispose();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  const persistent = require('./PersistentBodyPlanetApproachRenderer.js');
  module.exports = {
    PlanetApproachLevelWebGPU,
    PLANET_APPROACH_WGSL: persistent.PLANET_APPROACH_WGSL,
    planetViewProjection: persistent.planetViewProjection,
  };
} else {
  window.GQPlanetApproachLevelWebGPU = { PlanetApproachLevelWebGPU };
}
