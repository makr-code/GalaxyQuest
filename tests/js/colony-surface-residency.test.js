import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const { ColonySurfaceLevelWebGPU } = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
const { ColonySurfaceLevelThreeJS } = require('../../js/engine/zoom/levels/ColonySurfaceLevelThreeJS.js');
const { SeamlessZoomOrchestrator } = require('../../js/engine/zoom/SeamlessZoomOrchestrator.js');

function sceneData(x = 3, upgrade = null) {
  return {
    colony: { id: 8, owner_color: '#33aa66', colony_is_player: 1 },
    layout: { grid: { cols: 6, rows: 4 } },
    selectedSlot: 2,
    vfx_quality: 'low',
    slots: [{ id: 2, x, z: -4, type: 'factory', upgrade_end: upgrade }],
  };
}

function gpuBackend() {
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, VERTEX: 4 });
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 4 });
  const buffers = [];
  const pass = {
    setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), draw: vi.fn(), end: vi.fn(),
  };
  const encoder = { beginRenderPass: vi.fn(() => pass), finish: vi.fn(() => ({})) };
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(({ size }) => {
      const buffer = { size, destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
    createTexture: vi.fn(({ size }) => ({
      width: size[0], height: size[1], createView: () => ({}), destroy: vi.fn(),
    })),
    createCommandEncoder: vi.fn(() => encoder),
    queue: { writeBuffer: vi.fn(), submit: vi.fn() },
    destroy: vi.fn(),
  };
  return {
    device, context: {
      getCurrentTexture: () => ({ createView: () => ({}) }), unconfigure: vi.fn(),
    }, buffers,
    getCapabilities: () => ({ webgpu: true }), dispose: vi.fn(),
  };
}

function threeRenderer() {
  const renderer = {
    setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(),
  };
  const ctor = vi.fn(function () { return renderer; });
  window.THREE = { ...THREE, WebGLRenderer: ctor };
  return { renderer, ctor };
}

function resourceSpies(scene) {
  const resources = new Set();
  scene.traverse((object) => {
    if (object.geometry) resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) resources.add(material);
    }
    if (object.isInstancedMesh) resources.add(object);
  });
  return [...resources].map((resource) => vi.spyOn(resource, 'dispose'));
}

afterEach(() => {
  delete window.THREE;
  delete window.__GQ_COLONY_VFX_STATS;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Colony surface GPU residency', () => {
  it('WebGPU evicts owned buffers, defers late updates, and reconstructs latest state across cycles', async () => {
    const backend = gpuBackend();
    const level = new ColonySurfaceLevelWebGPU();
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, bottom: 600, right: 800 });
    await level.initialize(canvas, backend);
    const initial = sceneData();
    level.setSceneData(initial);
    expect(level._slots).toHaveLength(1);
    expect(level._slotCount).toBe(0);
    await level.enter(2);
    expect(level._buildingVfxStats.profileCounts.industry).toBe(1);
    const pipelines = [level._meshPipeline, level._bodyPipeline, level._vfxPipeline];
    const sharedBuffers = [level._cameraBuffer, level._materialBuffer, level._surfaceBuffer];

    for (let cycle = 0; cycle < 3; cycle++) {
      level.setSceneData(sceneData(10 + cycle, cycle % 2 ? 'pending' : null));
      await level.exit(0);
      await level.exit(0);
      expect(level._instanceBuffer).toBeNull();
      expect(level._instanceBindGroup).toBeNull();
      expect(level._buildingVfxBuffer).toBeNull();
      expect(level._buildingVfxParticles).toEqual([]);
      expect(level._slotCount).toBe(0);
      expect(level._buildingVfxStats.particles).toBe(0);
      backend.buffers.filter((buffer) => !sharedBuffers.includes(buffer))
        .forEach((buffer) => expect(buffer.destroy).toHaveBeenCalledOnce());
      const allocated = backend.device.createBuffer.mock.calls.length;
      const latest = sceneData(10 + cycle, cycle % 2 ? null : 'pending');
      level.setSceneData(latest);
      level.render(0.1);
      expect(backend.device.createBuffer).toHaveBeenCalledTimes(allocated);
      expect(backend.device.createCommandEncoder).not.toHaveBeenCalled();
      expect(level._sceneData).toBe(latest);
      expect(level._slots).toHaveLength(1);

      await level.enter(0, { colony: latest.colony });
      expect(level._sceneData.layout).toBe(latest.layout);
      expect(level._sceneData.selectedSlot).toBe(2);
      expect(level._slotCount).toBeGreaterThan(0);
      expect(level._buildingVfxStats.particles).toBeGreaterThan(0);
      expect(level._buildingVfxStats.quality).toBe('low');
      expect(level._buildingVfxStats.burstActive).toBe(true);
      const upload = backend.device.queue.writeBuffer.mock.calls.at(-1);
      expect(new Float32Array(upload[2])[4]).toBeCloseTo(level._city.parts[0].x);
      expect([level._meshPipeline, level._bodyPipeline, level._vfxPipeline]).toEqual(pipelines);
      level.render(0.1);
      expect(backend.device.createCommandEncoder).toHaveBeenCalledOnce();
      backend.device.createCommandEncoder.mockClear();
    }
    level.dispose();
    level.dispose();
    await level.exit(0);
    backend.buffers.forEach((buffer) => expect(buffer.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
    expect(backend.context.unconfigure).not.toHaveBeenCalled();
    expect(backend.dispose).not.toHaveBeenCalled();
  });

  it('WebGPU supports payload-only entry and clearing a previously occupied colony', async () => {
    const backend = gpuBackend();
    const level = new ColonySurfaceLevelWebGPU();
    await level.initialize(document.createElement('canvas'), backend);
    await level.enter(2, sceneData());
    expect(level._slotCount).toBeGreaterThan(0);
    const slots = level._instanceBuffer;
    const vfx = level._buildingVfxBuffer;
    const populatedCount = level._slotCount;
    level.setSceneData({ slots: [] });
    expect(slots.destroy).toHaveBeenCalledOnce();
    expect(vfx.destroy).toHaveBeenCalledOnce();
    expect(level._instanceBuffer).not.toBeNull();
    expect(level._instanceBindGroup).not.toBeNull();
    expect(level._slotCount).toBe(level._city.parts.length);
    expect(level._slotCount).toBeLessThan(populatedCount);
    expect(level._buildingVfxBuffer).toBeNull();
    expect(level._buildingVfxStats.particles).toBe(0);
    level.dispose();
  });

  it('keeps initial headless VFX metrics compatible', () => {
    const level = new ColonySurfaceLevelWebGPU();
    level.setSceneData(sceneData());
    expect(level._buildingVfxStats.emitters).toBe(1);
    expect(level._buildingVfxStats.particles).toBeGreaterThan(0);
    level.dispose();
  });

  it('Three.js releases all scene/instance resources once and never recreates its renderer on re-entry', async () => {
    const { renderer, ctor } = threeRenderer();
    const backend = { dispose: vi.fn() };
    const level = new ColonySurfaceLevelThreeJS();
    const canvas = document.createElement('canvas');
    await level.initialize(canvas, backend);
    await level.enter(2, sceneData());
    const texture = { dispose: vi.fn() };
    level._instanced.material.map = texture;
    const camera = level._camera;
    const allSpies = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      level.setSceneData(sceneData(17 + cycle, cycle % 2 ? 'pending' : null));
      const scene = level._scene;
      const spies = resourceSpies(scene);
      allSpies.push(...spies);
      await level.exit(0);
      await level.exit(0);
      spies.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
      expect(scene.children).toEqual([]);
      expect(level._scene).toBeNull();
      expect(level._buildingVfxEmitters).toEqual([]);
      expect(level._slotCount).toBe(0);
      const latest = sceneData(17 + cycle, cycle % 2 ? null : 'pending');
      level.setSceneData(latest);
      level.render(0.1);
      expect(renderer.render).not.toHaveBeenCalled();
      expect(level._scene).toBeNull();
      await level.enter(0, { colony: latest.colony });
      expect(level._scene).not.toBe(scene);
      expect(level._camera).toBe(camera);
      expect(level._sceneData.layout).toBe(latest.layout);
      expect(level._sceneData.selectedSlot).toBe(2);
      const matrix = new THREE.Matrix4();
      level._instanced.getMatrixAt(0, matrix);
      expect(matrix.elements[12]).toBe(17 + cycle);
      expect(level._instancedLo.count).toBe(1);
      expect(level._ownershipRing.visible).toBe(true);
      expect(level._buildingVfxStats.burstActive).toBe(true);
      expect(level._buildingVfxStats.quality).toBe('low');
      expect(level._buildingVfxStats.particles).toBeGreaterThan(0);
      level.render(0.1);
      expect(renderer.render).toHaveBeenCalledOnce();
      renderer.render.mockClear();
    }
    allSpies.push(...resourceSpies(level._scene));
    level.dispose();
    level.dispose();
    await level.exit(0);
    allSpies.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
    expect(ctor).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(texture.dispose).not.toHaveBeenCalled();
    expect(backend.dispose).not.toHaveBeenCalled();
  });

  it('Three.js disposes replaced VFX once and clears instances and metrics for an empty update', async () => {
    threeRenderer();
    const level = new ColonySurfaceLevelThreeJS();
    await level.initialize(document.createElement('canvas'), {});
    level.setSceneData(sceneData());
    const emitter = level._buildingVfxEmitters[0];
    const geometry = vi.spyOn(emitter.geometry, 'dispose');
    const material = vi.spyOn(emitter.material, 'dispose');
    level.setSceneData({ slots: [] });
    expect(emitter.parent).toBeNull();
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    expect(level._instanced.count).toBe(0);
    expect(level._instancedLo.count).toBe(0);
    expect(level._buildingVfxStats.particles).toBe(0);
    await level.exit(0);
    level.dispose();
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });

  it('the orchestrator cached renderer unloads on zoom-out and restores late scene data on zoom-in', async () => {
    const backend = gpuBackend();
    const orchestrator = new SeamlessZoomOrchestrator(document.createElement('canvas'));
    orchestrator._backend = backend;
    class OtherLevel {
      async initialize() {}
      async enter() {}
      async exit() {}
    }
    orchestrator.register(0, { webgpu: OtherLevel });
    orchestrator.register(3, { webgpu: ColonySurfaceLevelWebGPU });
    await orchestrator.setSceneData(3, sceneData());
    await orchestrator.zoomTo(3);
    const colony = orchestrator._active;
    await orchestrator.zoomTo(0);
    const allocated = backend.device.createBuffer.mock.calls.length;
    await orchestrator.setSceneData(3, sceneData(25));
    expect(backend.device.createBuffer).toHaveBeenCalledTimes(allocated);
    await orchestrator.zoomTo(3);
    expect(orchestrator._active).toBe(colony);
    expect(colony._slotCount).toBeGreaterThan(0);
    const upload = backend.device.queue.writeBuffer.mock.calls.at(-1);
    expect(new Float32Array(upload[2])[4]).toBeCloseTo(colony._city.parts[0].x);
    colony.dispose();
  });
});
