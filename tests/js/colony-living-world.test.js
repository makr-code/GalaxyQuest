import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const { ColonySurfaceLevelWebGPU } = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
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

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete window.THREE; delete window.__GQ_COLONY_VFX_STATS;
});

describe('Living colony native render path', () => {
  it('uploads five coherent map arrays, dispatches before drawing, and reads storage directly', async () => {
    const backend = nativeBackend();
    const level = new ColonySurfaceLevelWebGPU();
    await level.initialize(document.createElement('canvas'), backend);
    level.setSceneData({ slots });
    expect(backend.device.queue.writeTexture).toHaveBeenCalledTimes(20);
    expect(level._materialTextures).toHaveLength(5);
    expect(level._particlePools.map((pool) => pool.smoke)).toEqual([true, false]);
    const readback = vi.spyOn(GPUParticleSystem.prototype, 'syncFromGPU');
    const writes = backend.device.queue.writeBuffer.mock.calls.length;
    level.render(0.016);
    expect(backend.order).toEqual(['compute', 'compute', 'render']);
    expect(readback).not.toHaveBeenCalled();
    expect(backend.device.queue.writeBuffer.mock.calls.length - writes).toBe(3); // camera + two simulation uniforms
    expect(backend.pass.draw).toHaveBeenCalledWith(36, 2, 0, 0);
    for (const pool of level._particlePools) {
      expect(pool.bindGroup.entries[0].resource.buffer).toBe(pool.system.storageBuffer);
    }
    level.dispose(); level.dispose();
    backend.resources.forEach((resource) => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
    expect(backend.context.unconfigure).not.toHaveBeenCalled();
  });

  it('reconstructs native textures and pools after repeated exits, including empty scenes', async () => {
    const backend = nativeBackend();
    const level = new ColonySurfaceLevelWebGPU();
    await level.initialize(document.createElement('canvas'), backend);
    await level.enter(2, { slots });
    for (let cycle = 0; cycle < 2; cycle++) {
      level.render(0.016);
      await level.exit(0);
      await level.exit(0);
      expect(level._particlePools).toEqual([]);
      expect(level._materialTextures).toEqual([]);
      await level.enter(0);
      expect(level._particlePools).toHaveLength(2);
    }
    level.setSceneData({ slots: [] });
    expect(level._particlePools).toEqual([]);
    level.dispose();
    backend.resources.forEach((resource) => expect(resource.destroy).toHaveBeenCalledOnce());
  });

  it('caps instances, emitters and particles and respects visibility and reduced motion', async () => {
    const backend = nativeBackend();
    const level = new ColonySurfaceLevelWebGPU();
    await level.initialize(document.createElement('canvas'), backend);
    const many = Array.from({ length: 2000 }, (_, i) => ({ x: i % 20, z: Math.floor(i / 20), type: 'factory' }));
    level.setSceneData({ slots: many, vfx_quality: 'high' });
    expect(level._slotCount).toBe(512);
    expect(level._buildingVfxStats.emitters).toBeLessThanOrEqual(36);
    expect(level._buildingVfxStats.particles).toBeLessThanOrEqual(900);
    for (const options of [{ reduced_motion: true }, { visible: false }, { vfx_enabled: false }]) {
      level.setSceneData({ slots, ...options });
      expect(level._particlePools).toEqual([]);
      expect(level._buildingVfxStats.particles).toBe(0);
    }
    level.setSceneData({ slots: slots.map((slot) => ({ ...slot, visible: false })) });
    expect(level._buildingVfxStats.emitters).toBe(0);
    level.dispose();
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
});

describe('Living colony Three.js fallback', () => {
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
