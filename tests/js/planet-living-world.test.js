import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const world = require('../../js/engine/zoom/levels/PlanetLivingWorld.js');
const Pipeline = require('../../js/rendering/planet-textures.js');
const { PlanetApproachLevelWebGPU } = require('../../js/engine/zoom/levels/PlanetApproachLevelWebGPU.js');
const { PlanetApproachLevelThreeJS } = require('../../js/engine/zoom/levels/PlanetApproachLevelThreeJS.js');

afterEach(() => {
  world.cache.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.THREE;
});

function gpu() {
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 64, COPY_DST: 8 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2 });
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const buffers = [], textures = [];
  const device = {
    destroy: vi.fn(),
    queue: { writeTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn() },
    createShaderModule: vi.fn(() => ({ getCompilationInfo: async () => ({ messages: [] }) })),
    createRenderPipelineAsync: vi.fn(async () => ({ getBindGroupLayout: () => ({}) })),
    createBuffer: vi.fn(() => {
      const buffer = { destroy: vi.fn() }; buffers.push(buffer); return buffer;
    }),
    createTexture: vi.fn(() => {
      const texture = { destroy: vi.fn(), createView: () => ({}) }; textures.push(texture); return texture;
    }),
    createSampler: vi.fn(() => ({})), createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({ beginRenderPass: () => pass, finish: () => ({}) })),
  };
  const context = { getConfiguration: () => ({ format: 'rgba8unorm' }),
    getCurrentTexture: () => ({ createView: () => ({}) }), unconfigure: vi.fn() };
  return { device, context, pass, buffers, textures };
}

describe('seeded public planet maps', () => {
  it('is deterministic, sensitive to public terrain, excludes private state, and bounds the cache', () => {
    const data = { focusPlanet: { id: 22, terrain: { seed: 'terra', ocean: 0.4 } } };
    const descriptor = world.describe(data);
    const first = world.maps(descriptor, 64);
    const privateChange = world.describe({ focusPlanet: {
      ...data.focusPlanet, owner_color: '#ff0000', night_lights: 1, population: 9000,
      resources: { money: 123 }, effects: { state: { activity: 0.1 } },
    } });
    expect(privateChange).toEqual(descriptor);
    expect(world.maps(privateChange, 64)).toBe(first);
    const changed = world.maps(world.describe({ seed: 'other', ocean: 0.4 }), 64);
    expect(changed.surface).not.toEqual(first.surface);
    expect(world.maps(world.describe({ seed: 'terra', ocean: 0.9 }), 64).surface).not.toEqual(first.surface);
    world.cache.clear();
    expect(world.maps(descriptor, 64).surface).toEqual(first.surface);
    for (let seed = 0; seed < 20; seed++) world.maps(world.describe({ seed }), 64);
    expect(world.cache.size).toBe(8);
    expect(world.maps(descriptor, 1e9).surface.length).toBe(128 * 64 * 4);
    expect(JSON.stringify([...world.cache.keys()])).not.toContain('resources');
  });

  it('sanitizes parameters, has no invented city activity and clamps delta in seconds', () => {
    const descriptor = world.describe({ terrain: { clouds: NaN, ocean: Infinity, ice_caps: -5, seed: {} } });
    expect(descriptor.clouds).toBe(0.52);
    expect(descriptor.ocean).toBe(0.56);
    expect(descriptor.ice).toBe(0);
    expect(world.state({ owner_color: '#ff0000', population: 10000 })).toBe(0);
    expect(world.state({ night_lights: 1, effects: { state: { activity: 0.8, damage: 0.5 } } })).toBe(0.4);
    expect(world.state({ city_lights: 1, powered: false })).toBe(0);
    expect([NaN, Infinity, -1, 0, 0.016, 16, 100000].map(world.delta))
      .toEqual([0, 0, 0, 0, 0.016, 0.05, 0.05]);
    expect(world.policy({ vfx_quality: 'off' }).motion).toBe(false);
    expect(world.policy({ focusPlanet: { visible: false } }).visible).toBe(false);
    expect(world.policy({ reduced_motion: true }).motion).toBe(false);
    expect(world.palette({ owner_color: '#ff0000' }).surfaceColor).toBe('#ffffff');
  });

  it('projects existing public planet manifests without caching their city or owner fields', () => {
    const terrain = { seed: 777, variant: 'desert', atmosphere: 0.1, clouds: 0.2,
      palette: { base: '#aa8844' } };
    const descriptor = world.describe({
      focusPlanet: { position: 3, owner_color: '#ff0000' },
      systemPayload: { planet_texture_manifest: {
        planets: { 3: { ...terrain, city_density: 0.9, owner_id: 25 } },
      } },
    });
    expect(descriptor).toEqual(world.describe({ terrain }));
    expect(descriptor.land).toBe('#aa8844');
    expect(descriptor.variant).toBe('desert');
    expect(descriptor).not.toHaveProperty('city_density');
    expect(descriptor).not.toHaveProperty('owner_id');
  });

  it('resolves player/generated slots and the renderer selection __slot position exactly like the backend', () => {
    const player = { id: 8, planet_class: 'desert', seed: 777, owner_color: '#aa3355' };
    const generated = { id: 9, planet_class: 'ice_dwarf', seed: 555 };
    const slot = { position: 4, player_planet: player, generated_planet: generated };
    expect(world.describe({ focusPlanet: slot }).variant).toBe('desert');
    expect(world.describe({ focusPlanet: slot }).seed).toBe(777);
    expect(world.palette({ focusPlanet: slot }).ownerColor).toBe('#aa3355');
    expect(world.describe({ focusPlanet: { ...slot, player_planet: null } }).variant).toBe('ice');
    const scene = {
      focusPlanet: { ...player, position: undefined, __slot: slot },
      systemPayload: { planet_texture_manifest: { planets: {
        4: { seed: 1234, variant: 'lava', palette: { base: '#773311', secondary: '#994422',
          accent: '#ff8811', ice: '#ffffff' }, roughness: 0.8, metalness: 0.03,
        banding: 0.12, clouds: 0.3, craters: 0.15, ice_caps: 0.04, atmosphere: 0.25, glow: 0.4 },
      } } },
    };
    const descriptor = world.describe(scene);
    expect(descriptor).toMatchObject({ seed: 1234, variant: 'lava', land: '#773311',
      secondary: '#994422', accent: '#ff8811', iceColor: '#ffffff', banding: 0.12,
      clouds: 0.3, craters: 0.15, ice: 0.04, atmosphere: 0.25, glow: 0.4 });
    expect(world.state(scene)).toBe(0);
    expect(descriptor).not.toHaveProperty('owner_color');
  });

  it.each([
    ['terran', 'terrestrial'], ['terraform', 'terrestrial'], ['desert', 'desert'],
    ['gas_giant', 'gas'], ['ice_dwarf', 'ice'], ['oceanic', 'ocean'],
    ['volcanic', 'lava'], ['barren', 'rocky'], ['unknown_class', 'rocky'],
  ])('maps backend planet_class %s to %s without bespoke terrain fields', (planetClass, variant) => {
    const descriptor = world.describe({
      focusPlanet: { position: 4, generated_planet: { id: 25, seed: 777, planet_class: planetClass } },
    });
    expect(descriptor.variant).toBe(variant);
    expect(descriptor.seed).toBe(777);
    expect(world.state({ focusPlanet: { generated_planet: { planet_class: planetClass } } })).toBe(0);
    expect(world.maps(descriptor, 64).surface.some(byte => byte > 0)).toBe(true);
  });

  it('uses the existing pipeline raw generator as its primary path, with no DOM, THREE or server calls', () => {
    const dom = vi.spyOn(document, 'createElement').mockImplementation(() => { throw new Error('unexpected DOM'); });
    const server = vi.spyOn(Pipeline.prototype, '_attachServerTexture');
    const generate = vi.spyOn(Pipeline, 'generateRawMaps');
    const descriptor = world.describe({ planet_class: 'gas_giant', seed: 111 });
    const result = world.maps(descriptor, 64);
    expect(generate).toHaveBeenCalledOnce();
    expect(result.width).toBe(64);
    expect(result.height).toBe(32);
    expect(result.surface.length).toBe(64 * 32 * 4);
    expect(dom).not.toHaveBeenCalled();
    expect(server).not.toHaveBeenCalled();
    expect(generate.mock.calls[0][0]).not.toHaveProperty('owner_id');
  });

  it('preserves explicit raw seed zero, normalizes invalid seeds, and keeps nonzero legacy output', () => {
    const descriptor = { variant: 'rocky', clouds: 0.8,
      palette: { base: '#557744', secondary: '#778855' } };
    const generate = seed => Pipeline.generateRawMaps({ ...descriptor, seed }, { size: 64 });
    const zero = generate(0);
    expect(zero.albedo).toEqual(generate('0').albedo);
    expect(zero.albedo).not.toEqual(generate(undefined).albedo);
    expect(zero.albedo).not.toEqual(generate(12).albedo);
    expect(generate(NaN).albedo).toEqual(generate(undefined).albedo);
    expect(generate(Infinity).albedo).toEqual(generate(undefined).albedo);
    expect(Array.from(generate(12).albedo.slice(0, 16)))
      .toEqual([149, 167, 135, 255, 107, 130, 79, 255, 101, 127, 76, 255, 145, 162, 127, 255]);
  });

  it('preserves existing CanvasTexture output using the same raw map bytes and leaves legacy clouds baked by default', () => {
    const descriptor = { seed: 12, variant: 'rocky', clouds: 0.8,
      palette: { base: '#557744', secondary: '#778855' } };
    const pipeline = new Pipeline({ size: 128, serverTexturesEnabled: false });
    const raw = pipeline._generateRawMaps(descriptor, 0x9aa7b8);
    const separate = pipeline._generateRawMaps(descriptor, 0x9aa7b8, { separateClouds: true });
    expect(separate.albedo).not.toEqual(raw.albedo);
    expect(separate.cloud).toEqual(raw.cloud);
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      const canvas = {};
      canvas.getContext = () => ({
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: image => { canvas.data = image.data; },
      });
      return canvas;
    });
    vi.stubGlobal('THREE', { ...THREE, CanvasTexture: class {
      constructor(image) { this.image = image; }
    } });
    const bundle = pipeline._buildTextureBundle(descriptor, 0x9aa7b8);
    expect(bundle.map.image.data).toEqual(raw.albedo);
    expect(bundle.bumpMap.image.data).toEqual(raw.bump);
    expect(bundle.normalMap.image.data).toEqual(raw.normal);
    expect(bundle.emissiveMap.image.data).toEqual(raw.emissive);
    expect(bundle.cityMap.image.data).toEqual(raw.city);
    expect(bundle.cloudAlphaMap.image.data).toEqual(raw.cloud);
  });
});

describe('native planet living world', () => {
  it('binds maps/uniforms, updates locally without pipeline rebuild, freezes flags, frees only owned resources', async () => {
    const mock = gpu();
    const level = new PlanetApproachLevelWebGPU();
    level.setSceneData({ seed: 22, owner_color: '#ff0000', night_lights: 1 });
    await level.initialize({ width: 512, height: 384 }, mock);
    expect(mock.device.createTexture.mock.calls.map(([options]) => options.format))
      .toEqual(['rgba8unorm-srgb', 'rgba8unorm', 'rgba8unorm-srgb']);
    const shader = mock.device.createShaderModule.mock.calls[0][0].code;
    expect(shader).toContain('linearToSrgb(col / (col + vec3f(1.0)))');
    const key = level._mapKey;
    level.render(0.016);
    expect(mock.pass.draw).toHaveBeenLastCalledWith(3);
    expect(mock.pass.setBindGroup).toHaveBeenCalledWith(0, level._bindGroup);
    expect(level._cloudRotation).toBeGreaterThan(level._rotation);
    level.setSceneData({ seed: 22, owner_color: '#00ff00', night_lights: 0, reduced_motion: true });
    expect(level._mapKey).toBe(key);
    expect(mock.device.createRenderPipelineAsync).toHaveBeenCalledTimes(1);
    const rotation = level._rotation;
    level.render(10000); level.render(NaN);
    expect(level._rotation).toBe(rotation);
    level.setSceneData({ seed: 22, visible: false });
    const writes = mock.device.queue.writeBuffer.mock.calls.length;
    level.render(0.016);
    expect(mock.device.queue.writeBuffer).toHaveBeenCalledTimes(writes);
    await level.exit(0);
    mock.textures.forEach(texture => expect(texture.destroy).toHaveBeenCalledOnce());
    mock.buffers.forEach(buffer => expect(buffer.destroy).toHaveBeenCalledOnce());
    expect(level._textures).toHaveLength(0);
    await level.enter(0, { seed: 22, vfx_quality: 'low' });
    level.render(0.016);
    expect(level._textures).toHaveLength(3);
    level.dispose(); level.dispose();
    expect(mock.device.destroy).not.toHaveBeenCalled();
    expect(mock.context.unconfigure).not.toHaveBeenCalled();
  });

  it('surfaces compilation errors rather than silently accepting a blank frame', async () => {
    const mock = gpu();
    mock.device.createShaderModule.mockReturnValue({
      getCompilationInfo: async () => ({ messages: [{ type: 'error', message: 'invalid WGSL' }] }),
    });
    await expect(new PlanetApproachLevelWebGPU().initialize({}, mock)).rejects.toThrow('invalid WGSL');
  });

  it.each(['exit', 'dispose'])('does not resurrect owned resources when %s wins an asynchronous pipeline build', async action => {
    const mock = gpu();
    let finish;
    mock.device.createRenderPipelineAsync.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const level = new PlanetApproachLevelWebGPU();
    const initializing = level.initialize({ width: 512, height: 384 }, mock);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await level[action](0);
    finish({ getBindGroupLayout: () => ({}) });
    await initializing;
    expect(level._pipeline).toBeNull();
    expect(mock.device.createBuffer).not.toHaveBeenCalled();
    expect(level._textures).toHaveLength(0);
    level.dispose();
  });

  it.each(['exit', 'dispose'])('ignores deferred compilation after %s before further allocations', async action => {
    const mock = gpu();
    let finish;
    mock.device.createShaderModule.mockReturnValue({
      getCompilationInfo: () => new Promise(resolve => { finish = resolve; }),
    });
    const level = new PlanetApproachLevelWebGPU();
    const initializing = level.initialize({ width: 512, height: 384 }, mock);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await level[action]();
    finish({ messages: [] });
    await initializing;
    expect(mock.device.createRenderPipelineAsync).not.toHaveBeenCalled();
    expect(mock.device.createBuffer).not.toHaveBeenCalled();
    expect(level._pipeline).toBeNull();
    expect(level._textures).toHaveLength(0);
    expect(mock.device.destroy).not.toHaveBeenCalled();
    expect(mock.context.unconfigure).not.toHaveBeenCalled();
    level.dispose();
  });

  it.each(['exit', 'dispose'])('ignores a rejected pipeline superseded by %s', async action => {
    const mock = gpu();
    let fail;
    mock.device.createRenderPipelineAsync.mockImplementation(() => new Promise((resolve, reject) => { fail = reject; }));
    const level = new PlanetApproachLevelWebGPU();
    const initializing = level.initialize({ width: 512, height: 384 }, mock);
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'));
    await level[action]();
    fail(new Error('superseded compilation'));
    await expect(initializing).resolves.toBeUndefined();
    expect(level._uniformBuffer).toBeNull();
    expect(level._pipeline).toBeNull();
    expect(mock.device.destroy).not.toHaveBeenCalled();
    level.dispose();
  });

  it('lets enter supersede pending initialization without overwriting its live resources', async () => {
    const mock = gpu();
    const pending = [];
    mock.device.createRenderPipelineAsync.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const level = new PlanetApproachLevelWebGPU();
    const initializing = level.initialize({ width: 512, height: 384 }, mock);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const entering = level.enter(1, { seed: 'new-planet' });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    const activePipeline = { getBindGroupLayout: () => ({}) };
    pending[1](activePipeline);
    await entering;
    const activeBuffer = level._uniformBuffer;
    pending[0]({ getBindGroupLayout: () => ({}) });
    await initializing;
    expect(level._pipeline).toBe(activePipeline);
    expect(level._uniformBuffer).toBe(activeBuffer);
    expect(mock.buffers).toHaveLength(1);
    expect(mock.textures).toHaveLength(3);
    level.render(0.016);
    await level.exit(0);
    expect(activeBuffer.destroy).toHaveBeenCalledOnce();
    mock.textures.forEach(texture => expect(texture.destroy).toHaveBeenCalledOnce());
    expect(mock.device.destroy).not.toHaveBeenCalled();
    level.dispose();
  });

  it('releases previous owned resources when initialized again without touching the shared device', async () => {
    const mock = gpu();
    const level = new PlanetApproachLevelWebGPU();
    await level.initialize({ width: 512, height: 384 }, mock);
    const firstBuffer = level._uniformBuffer;
    const firstTextures = level._textures.slice();
    await level.initialize({ width: 256, height: 256 }, mock);
    expect(firstBuffer.destroy).toHaveBeenCalledOnce();
    firstTextures.forEach(texture => expect(texture.destroy).toHaveBeenCalledOnce());
    expect(level._uniformBuffer).not.toBe(firstBuffer);
    level.dispose();
    mock.buffers.forEach(buffer => expect(buffer.destroy).toHaveBeenCalledOnce());
    expect(mock.device.destroy).not.toHaveBeenCalled();
    expect(mock.context.unconfigure).not.toHaveBeenCalled();
  });
});

describe.each([PlanetApproachLevelWebGPU, PlanetApproachLevelThreeJS])('%s lazy-module lifetime', Level => {
  it.each(['exit', 'dispose'])('does not start rendering after %s while the helper import is pending', async action => {
    const mock = gpu();
    const level = new Level();
    let finish;
    level._loadWorld = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const initializing = level.initialize({ width: 512, height: 384 }, mock);
    await level[action]();
    finish(world);
    await initializing;
    expect(level._pipeline || level._renderer).toBeFalsy();
    expect(mock.device.createShaderModule).not.toHaveBeenCalled();
    expect(mock.device.destroy).not.toHaveBeenCalled();
    level.dispose();
  });
});

describe('Three planet living world', () => {
  it('uses standard materials with seeded maps, state-only emission and complete exit/re-entry disposal', async () => {
    const render = vi.fn(), dispose = vi.fn();
    window.THREE = { ...THREE, WebGLRenderer: class {
      setPixelRatio() {}
      setSize() {}
      render = render;
      dispose = dispose;
    } };
    const level = new PlanetApproachLevelThreeJS();
    level.setSceneData({ seed: 123, night_lights: 1, owner_color: '#ff0000' });
    await level.initialize({ width: 512, height: 384 }, {});
    expect(level._planetMesh.material.isMeshStandardMaterial).toBe(true);
    expect(level._renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(level._renderer.toneMapping).toBe(THREE.ReinhardToneMapping);
    expect(level._textures.map(texture => texture.colorSpace))
      .toEqual([THREE.SRGBColorSpace, THREE.NoColorSpace, THREE.SRGBColorSpace]);
    expect(level._atmoMesh.material.fragmentShader).toContain('#include <colorspace_fragment>');
    expect(level._planetMesh.material.map.image.data).toBe(world.maps(level._descriptor).surface);
    const texture = level._planetMesh.material.map;
    const released = [];
    level._scene.traverse(object => {
      for (const resource of [object.geometry, object.material].filter(Boolean)) {
        const spy = vi.spyOn(resource, 'dispose'); released.push(spy);
      }
    });
    const textures = level._textures.map(value => vi.spyOn(value, 'dispose'));
    level.render(0.016);
    expect(level._ownershipRing.visible).toBe(true);
    expect(level._planetMesh.material.emissiveIntensity).toBe(1);
    level.setSceneData({ seed: 123, night_lights: 1, powered: false, reduced_motion: true });
    expect(level._planetMesh.material.map).toBe(texture);
    expect(level._planetMesh.material.emissiveIntensity).toBe(0);
    const rotation = level._rotation;
    level.render(1000);
    expect(level._rotation).toBe(rotation);
    level.setSceneData({ seed: 123, vfx_quality: 'off' });
    level.render(0.016);
    expect(level._cloudMesh.visible || level._atmoMesh.visible).toBe(false);
    level.setSceneData({ seed: 123, visible: false });
    const calls = render.mock.calls.length;
    level.render(0.016);
    expect(render).toHaveBeenCalledTimes(calls);
    await level.exit(0);
    [...released, ...textures].forEach(spy => expect(spy).toHaveBeenCalledOnce());
    expect(dispose).toHaveBeenCalledOnce();
    expect(level._scene).toBeNull();
    await level.enter(0, { seed: 123 });
    level.render(0.016);
    expect(level._planetMesh.material.map.image.data).toBe(texture.image.data);
    level.dispose(); level.dispose();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
