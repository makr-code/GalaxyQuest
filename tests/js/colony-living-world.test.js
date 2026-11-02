import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const {
  ColonySurfaceLevelWebGPU, normalizeCitySlots, buildCityGeometry,
} = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
const { ColonySurfaceLevelThreeJS } = require('../../js/engine/zoom/levels/ColonySurfaceLevelThreeJS.js');
const { GPUParticleSystem } = require('../../js/engine/fx/GPUParticleSystem.js');

function nativeBackend() {
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
  const resources = [];
  const order = [];
  const pass = {
    setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn(),
    dispatchWorkgroups: vi.fn(),
  };
  const encoder = {
    beginComputePass: vi.fn(() => { order.push('compute'); return pass; }),
    beginRenderPass: vi.fn(() => { order.push('render'); return pass; }),
    finish: vi.fn(() => ({})),
  };
  const device = {
    createShaderModule: vi.fn((descriptor) => descriptor),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createComputePipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createBindGroup: vi.fn((descriptor) => descriptor),
    createSampler: vi.fn(() => ({})),
    createBuffer: vi.fn(({ size }) => {
      const buffer = { size, destroy: vi.fn() };
      resources.push(buffer); return buffer;
    }),
    createTexture: vi.fn(() => {
      const texture = { destroy: vi.fn(), createView: () => ({}) };
      resources.push(texture); return texture;
    }),
    createCommandEncoder: vi.fn(() => encoder),
    queue: { writeBuffer: vi.fn(), writeTexture: vi.fn(), submit: vi.fn() },
    destroy: vi.fn(),
  };
  return { device, resources, order, pass,
    context: { getCurrentTexture: () => ({ createView: () => ({}) }), unconfigure: vi.fn() } };
}

const slots = [
  { x: -3, z: -6, type: 'factory' }, { x: 3, z: 6, type: 'reactor' },
];

function stateSlots() {
  return [
    { active: false }, { powered: false }, { vfx_enabled: false },
    { appearance: { effects: { state: { activity: 0 } } } },
    { effects: { state: { activity: 0 } } },
    { effects: { state: { activity: 0.5, damage: 0.5 } } }, {},
  ].map((state, index) => ({ id: index + 10, x: index * 3, z: 0, type: 'factory', ...state }));
}

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete window.THREE; delete window.__GQ_COLONY_VFX_STATS;
});

describe('Living colony native render path', () => {
  it('defers GPU city resources until entry and keeps the shared device across re-entry', async () => {
    const backend = nativeBackend();
    const level = new ColonySurfaceLevelWebGPU();
    await level.initialize(document.createElement('canvas'), backend);
    const initializedBuffers = backend.device.createBuffer.mock.calls.length;
    level.setSceneData({ slots });
    expect(level._city.parts.length).toBeGreaterThan(0);
    expect(level._slotCount).toBe(0);
    expect(backend.device.createBuffer).toHaveBeenCalledTimes(initializedBuffers);
    await level.enter(2, { slots });
    expect(level._slotCount).toBeGreaterThan(0);
    expect(level._instanceBindGroup).not.toBeNull();
    const instanceBuffer = level._instanceBuffer;
    await level.exit(0);
    expect(instanceBuffer.destroy).toHaveBeenCalledOnce();
    const allocations = backend.device.createBuffer.mock.calls.length;
    level.setSceneData({ slots });
    level.render(0.016);
    expect(backend.device.createBuffer).toHaveBeenCalledTimes(allocations);
    await level.enter(0);
    expect(level._slotCount).toBeGreaterThan(0);
    level.dispose(); level.dispose();
    backend.resources.forEach((resource) => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
    expect(backend.context.unconfigure).not.toHaveBeenCalled();
  });

  it('caps emitters and particles and respects visibility and reduced-motion settings', () => {
    const level = new ColonySurfaceLevelWebGPU();
    const many = Array.from({ length: 2000 }, (_, i) => ({ x: i % 20, z: Math.floor(i / 20), type: 'factory' }));
    level.setSceneData({ slots: many, vfx_quality: 'high' });
    expect(level._buildingVfxStats.emitters).toBeLessThanOrEqual(36);
    expect(level._buildingVfxStats.particles).toBeLessThanOrEqual(900);
    for (const options of [{ reduced_motion: true }, { visible: false }, { vfx_enabled: false }]) {
      level.setSceneData({ slots, ...options });
      expect(level._buildingVfxParticles).toEqual([]);
      expect(level._buildingVfxStats.particles).toBe(0);
    }
    level.setSceneData({ slots: slots.map((slot) => ({ ...slot, visible: false })) });
    expect(level._buildingVfxStats.emitters).toBe(0);
    level.dispose();
  });

  it('honors explicit slot activity, profiles effects, and tracks upgrade bursts', () => {
    const level = new ColonySurfaceLevelWebGPU();
    level.setSceneData({ slots: stateSlots() });
    expect(level._buildingVfxStats.emitters).toBe(2);
    expect(level._buildingVfxStats.profileCounts.industry).toBe(2);
    const upgrading = slots.map((slot) => ({ ...slot, upgrade_end: 'pending' }));
    level.setSceneData({ slots });
    level.setSceneData({ slots: upgrading });
    expect(level._buildingVfxStats.burstActive).toBe(true);
    for (const [profile, expected] of [['construction', 'construction'], ['industrial', 'industry'], ['energy', 'power']]) {
      expect(level._slotVfxProfile({ appearance: { effects: { profile } } }).profileName).toBe(expected);
    }
    level.dispose();
  });

  it('normalizes invalid building coordinates before constructing city geometry', () => {
    const normalized = normalizeCitySlots({
      slots: [
        { type: 'factory', x: '8', z: 4, level: 1 },
        { type: 'reactor', x: Infinity, z: NaN, level: 1 },
      ],
    });
    expect(normalized.map(({ x, z }) => [x, z])).toEqual([[8, 4], [0, 0]]);
    expect(normalized.every(({ x, z }) => Number.isFinite(x) && Number.isFinite(z))).toBe(true);
    const city = buildCityGeometry(normalized, {});
    expect(city.parts.every((part) => Object.values(part).flat().every(Number.isFinite))).toBe(true);
  });

  it('recycles GPU particle allocations using lifetime bookkeeping without CPU position simulation', () => {
    const { device } = nativeBackend();
    const system = new GPUParticleSystem({ device, maxParticles: 1 });
    expect(system.spawn({ py: 2, vy: 5, lifetime: 0.1 })).toBe(0);
    expect(system.spawn({})).toBe(-1);
    system.update(0.2);
    expect(system.liveCount).toBe(0);
    expect(system.dataBuffer[1]).toBe(2);
    expect(system.spawn({ py: 3, lifetime: 1 })).toBe(0);
    system.dispose(); system.dispose();
    expect(system.spawn({})).toBe(-1);
  });

  it('validates particle capacity and safely releases optional staging readbacks', async () => {
    const backend = nativeBackend();
    for (const [value, expected] of [[NaN, 4096], [Infinity, 4096], [-3, 1], [1.9, 1], [1e9, 65536]]) {
      const pool = new GPUParticleSystem({ maxParticles: value });
      expect(pool.maxParticles).toBe(expected);
      pool.dispose();
    }
    const system = new GPUParticleSystem({ device: backend.device, maxParticles: 2, gravity: Infinity, drag: NaN });
    expect(system._gravity).toBe(0);
    expect(system._drag).toBe(0.04);
    system.spawn({
      px: Infinity, py: NaN, pz: -Infinity, vx: NaN, vy: Infinity, vz: -Infinity,
      lifetime: Infinity, size: NaN, colorHex: Infinity,
    });
    expect([...system.dataBuffer].every(Number.isFinite)).toBe(true);
    const before = system.dataBuffer.slice();
    for (const dt of [Infinity, NaN, -Infinity, -1]) system.update(dt);
    expect(system.dataBuffer).toEqual(before);
    system.dispose();

    vi.stubGlobal('GPUMapMode', { READ: 1 });
    const staging = {
      mapAsync: vi.fn(async () => { throw new Error('device lost'); }),
      unmap: vi.fn(), destroy: vi.fn(),
    };
    const readbackSystem = new GPUParticleSystem({ device: backend.device, maxParticles: 1 });
    backend.device.createBuffer.mockReturnValueOnce(staging);
    backend.device.createCommandEncoder.mockReturnValueOnce({
      copyBufferToBuffer: vi.fn(), finish: () => ({}),
    });
    await expect(readbackSystem.syncFromGPU()).rejects.toThrow('device lost');
    expect(staging.unmap).not.toHaveBeenCalled();
    expect(staging.destroy).toHaveBeenCalledOnce();
    readbackSystem.dispose();
  });

  it('does not restore disposed particles when a pending optional readback completes', async () => {
    const { device } = nativeBackend();
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    let finishMapping;
    const staging = {
      mapAsync: vi.fn(() => new Promise((resolve) => { finishMapping = resolve; })),
      getMappedRange: vi.fn(() => new Float32Array(16).fill(42).buffer),
      unmap: vi.fn(), destroy: vi.fn(),
    };
    const system = new GPUParticleSystem({ device, maxParticles: 1 });
    device.createBuffer.mockReturnValueOnce(staging);
    device.createCommandEncoder.mockReturnValueOnce({
      copyBufferToBuffer: vi.fn(), finish: () => ({}),
    });
    const readback = system.syncFromGPU();
    system.dispose();
    finishMapping();
    await readback;
    expect(staging.getMappedRange).not.toHaveBeenCalled();
    expect(staging.unmap).toHaveBeenCalledOnce();
    expect(staging.destroy).toHaveBeenCalledOnce();
    expect([...system.dataBuffer].every((value) => value === 0)).toBe(true);
  });
});

describe('Living colony Three.js fallback', () => {
  it('honors explicit inactive states and carries bounded per-instance emissive activity into the shader', async () => {
    const renderer = { setPixelRatio() {}, setSize() {}, dispose() {}, render() {} };
    window.THREE = { ...THREE, WebGLRenderer: function () { return renderer; } };
    const level = new ColonySurfaceLevelThreeJS();
    await level.initialize(document.createElement('canvas'), {});
    level.setSceneData({ slots: stateSlots() });
    expect([...level._instanced.geometry.getAttribute('emissiveActivity').array.slice(0, 7)])
      .toEqual([0, 0, 0, 0, 0, 0.25, 1]);
    expect(level._buildingVfxStats.emitters).toBe(2);
    const shader = { vertexShader: '#include <uv_vertex>', fragmentShader: '#include <emissivemap_fragment>' };
    level._instanced.material.onBeforeCompile(shader);
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= vEmissiveActivity');
    for (const [profile, expected] of [['construction', 'construction'], ['industrial', 'industry'], ['energy', 'power']]) {
      expect(level._slotVfxProfile({ appearance: { effects: { profile } } }).profileName).toBe(expected);
    }
    level.dispose();
  });

  it('binds linear scalar/normal maps and sRGB color maps with no fabricated AO', async () => {
    const renderer = { setPixelRatio() {}, setSize() {}, dispose() {}, render() {} };
    window.THREE = { ...THREE, WebGLRenderer: function () { return renderer; } };
    const level = new ColonySurfaceLevelThreeJS();
    await level.initialize(document.createElement('canvas'), {});
    level.setSceneData({ slots });
    const material = level._instanced.material;
    expect(material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.emissiveMap.colorSpace).toBe(THREE.SRGBColorSpace);
    for (const map of [material.normalMap, material.roughnessMap, material.metalnessMap]) {
      expect(map.colorSpace).toBe(THREE.NoColorSpace);
      expect(map.image.width).toBe(256);
    }
    expect(material.aoMap).toBeNull();
    expect([...level._instanced.geometry.getAttribute('materialVariant').array.slice(0, 2)]).toEqual([1, 2]);
    expect(level._instancedLo.material.normalMap).toBe(material.normalMap);
    const textures = [...level._ownedTextures].map((texture) => vi.spyOn(texture, 'dispose'));
    expect(level._buildingVfxEmitters[0].material.blending).toBe(THREE.NormalBlending);
    expect(level._buildingVfxEmitters[1].material.blending).toBe(THREE.AdditiveBlending);
    await level.exit(0); level.dispose();
    textures.forEach((texture) => expect(texture).toHaveBeenCalledOnce());
  });
});
