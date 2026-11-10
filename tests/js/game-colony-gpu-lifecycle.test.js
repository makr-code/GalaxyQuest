import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGameColonyZoom } from '../../js/rendering/game-colony-zoom.js';
import { PersistentBodyPlanetApproachRenderer } from '../../js/engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js';
import { ColonySurfaceLevelWebGPU } from '../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js';

afterEach(() => {
  document.body.innerHTML = '';
  delete window.__GQ_ZOOM_ORCHESTRATOR;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function trackedBackend() {
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, VERTEX: 4, UNIFORM: 8 });
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 4 });
  const resources = [];
  const createResource = descriptor => {
    const resource = { ...descriptor, destroy: vi.fn(),
      createView: () => ({}), width: descriptor.size?.[0], height: descriptor.size?.[1] };
    resources.push(resource);
    return resource;
  };
  const pass = { setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, draw: vi.fn(), end() {} };
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(createResource),
    createTexture: vi.fn(createResource),
    createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }),
    queue: { writeBuffer: vi.fn(), submit: vi.fn() },
    destroy: vi.fn(),
  };
  const hooks = new Set();
  const backend = {
    device, context: { getCurrentTexture: () => ({ createView: () => ({}) }), unconfigure: vi.fn() },
    externalCameraControls: true, getCapabilities: () => ({ webgpu: true }),
    addFrameHook(hook) { hooks.add(hook); return () => hooks.delete(hook); },
    setZoomSceneActive: vi.fn(),
  };
  return { backend, resources, hooks, pass };
}

describe('Actual in-game planet and colony GPU resource ownership', () => {
  it.each([false, true])('accepts a borrowed authored surface (appearance=%s) without changing the default shader', async appearance => {
    document.body.innerHTML = '<div><canvas width="512" height="384"></canvas></div>';
    const canvas = document.querySelector('canvas');
    const { backend, resources, pass } = trackedBackend();
    const vertices = new Float32Array([
      1, 0, 0, 0, 0, 0, 0, 0, 1, -1, 0, 0,
      0, 1, 0, 0, 0, 0, 0, 0, 1, -1, 0, 0,
      0, 0, 1, 0, 0, 0, 0, 0, 1, -1, 0, 0,
    ]);
    let mesh = { key: 'authored:0', vertices };
    backend.geographicSurface = { albedoView: {}, sampler: {}, optionsBuffer: {},
      mesh: vi.fn(() => mesh) };
    if (appearance) {
      backend.geographicSurface.appearance = { materialView: {}, optionsBuffer: {} };
      backend.geographicSurface.drawBackground = vi.fn();
      backend.geographicSurface.drawForeground = vi.fn();
    }
    let seconds = 946728000;
    backend.unixSeconds = () => seconds;
    const level = new PersistentBodyPlanetApproachRenderer();
    const matrix = Array.from({ length: 16 }, (_, i) => i % 5 === 0 ? 1 : 0);
    const camera = { position: { x: 0, y: 0, z: 3 }, viewProjection: matrix, projectedScale: 2 };
    try {
      await level.initialize(canvas, backend);
      await level.enter(1, { reduced_motion: true, colony: { rotation_period_hours: 24,
        axial_tilt_deg: 0, rotation_phase_deg: 0, rotation_axis_node_deg: 0 } });
      level._drawFrame(camera);
      expect(level._solidVertexCount).toBe(3);
      expect(level._rotation).toBe(0);
      const buffer = level._solidBuffer;
      seconds += 21600;
      level._drawFrame(camera);
      expect(level._rotation).toBeCloseTo(Math.PI / 2);
      expect(level._solidBuffer).toBe(buffer);
      const uniforms = backend.device.queue.writeBuffer.mock.calls.filter(call => call[0] === level._uniformBuffer).at(-1)[2];
      expect(Array.from(uniforms.slice(0, 16))).toEqual(matrix);
      const code = backend.device.createShaderModule.mock.calls[0][0].code;
      expect(code).toContain('@binding(4) var authoredColor');
      expect(code).toContain('gqWaterSurface');
      expect(code).toContain('gqCloudNoise');
      expect(code.includes('@binding(7) var authoredMaterial')).toBe(appearance);
      expect(backend.device.createBindGroup.mock.calls[0][0].entries.map(entry => entry.binding))
        .toEqual(appearance ? [0, 2, 3, 4, 5, 6, 7, 8] : [0, 2, 3, 4, 5, 6]);
      const authoredPlan = level._surfaceModel.plan({ population: 1000 },
        { seed: 1, radius_km: 6371, biome: 'terran' },
        [{ id: 'authored', direction: [1, 0, 0], height: 1 }]);
      backend.geographicSurface.surfacePlan = vi.fn(() => authoredPlan);
      level._drawFrame(camera);
      expect(level._surfacePlan).toBe(authoredPlan);
      const living = backend.device.queue.writeBuffer.mock.calls.filter(call => call[0] === level._surfaceBuffer).at(-1)[2];
      expect(Array.from(living.slice(0, 2))).toEqual([1, 1]);
      backend.geographicSurface.surfacePlan.mockReturnValue(null);
      level._drawFrame(camera);
      expect(level._surfacePlan).toBeNull();
      expect(backend.device.queue.writeBuffer.mock.calls.filter(call => call[0] === level._surfaceBuffer).at(-1)[2]
        .every(value => value === 0)).toBe(true);
      if (appearance) {
        expect(backend.geographicSurface.drawBackground).toHaveBeenCalledWith(pass);
        expect(backend.geographicSurface.drawBackground.mock.invocationCallOrder[0])
          .toBeLessThan(pass.draw.mock.invocationCallOrder[0]);
        expect(backend.geographicSurface.drawForeground.mock.invocationCallOrder[0])
          .toBeGreaterThan(pass.draw.mock.invocationCallOrder[0]);
        expect(backend.geographicSurface.drawForeground).toHaveBeenCalledWith(pass,
          expect.objectContaining({ uniforms: expect.any(Float32Array), phase: expect.any(Number),
            material: expect.objectContaining({ biome: 'terran' }), effectsEnabled: true }));
      }
      mesh = { key: 'authored:1', vertices };
      level._drawFrame(camera);
      expect(buffer.destroy).toHaveBeenCalledOnce();
      expect(() => level._drawFrame({ ...camera, viewProjection: [NaN] })).toThrow(/view projection/);
      expect(() => level._drawFrame({ ...camera, projectedScale: 0 })).toThrow(/projected scale/);
      mesh = { key: 'invalid', vertices: new Float32Array([NaN]) };
      expect(() => level._drawFrame(camera)).toThrow(/48-byte triangle/);
    } finally { level.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
    const { PLANET_APPROACH_WGSL } = require('../../js/engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js');
    expect(PLANET_APPROACH_WGSL).not.toContain('authoredColor');
    expect(PLANET_APPROACH_WGSL).toContain('let ambient = 0.3;');
    expect(PLANET_APPROACH_WGSL).not.toContain('directDay');
  });

  it('refines the real orbital mesh only when a hysteresis boundary is crossed and releases the previous buffer', async () => {
    document.body.innerHTML = '<div><canvas width="1024" height="768"></canvas></div>';
    const canvas = document.querySelector('canvas');
    const { backend, resources } = trackedBackend();
    const level = new PersistentBodyPlanetApproachRenderer();
    const scene = { reduced_motion: true, bodyTerrainManifest: {
      body_id: 12, seed: 35, biome: 'terran', radius_km: 6371, amplitude_km: 8,
      sea_level_km: 0, generator_version: 1, projection: 'cube-sphere',
      height_min_km: -16, height_max_km: 16, max_lod: 14, resolution: 17, tile_encoding: 'uint16-json',
    } };
    try {
      await level.initialize(canvas, backend);
      await level.enter(1, scene);
      const draw = pixels => level._drawFrame({ position: { x: 0, y: 0, z: canvas.height * 1.73 / pixels } });
      draw(500);
      const coarse = level._solidBuffer;
      const coarseCount = level._solidVertexCount;
      draw(800);
      expect(level._solidBuffer).toBe(coarse);
      draw(900);
      const fine = level._solidBuffer;
      expect(fine).not.toBe(coarse);
      expect(coarse.destroy).toHaveBeenCalledOnce();
      expect(level._solidVertexCount).toBeGreaterThan(coarseCount * 4);
      expect(fine.size).toBeLessThanOrEqual(12 * 1024 * 1024);
      draw(700);
      expect(level._solidBuffer).toBe(fine);
      draw(600);
      expect(fine.destroy).toHaveBeenCalledOnce();
      expect(level._solidVertexCount).toBe(coarseCount);
    } finally { level.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });

  const levels = [
    ['planet', PersistentBodyPlanetApproachRenderer],
    ['colony', ColonySurfaceLevelWebGPU],
  ];

  it.each(levels)('uses absolute physical time and a separate optional presentation phase in %s', async (name,Renderer) => {
    vi.spyOn(document,'hidden','get').mockReturnValue(false);
    const world = require('../../js/engine/zoom/levels/PlanetLivingWorld.js');
    let seconds = world.ROTATION_EPOCH;
    vi.spyOn(Date,'now').mockImplementation(() => seconds * 1000);
    let reducedMotion = false;
    vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
    document.body.innerHTML = '<div><canvas width="512" height="384"></canvas></div>';
    const canvas = document.querySelector('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 384, right: 512, bottom: 384 });
    const { backend, resources } = trackedBackend();
    const level = new Renderer();
    const data = { colony: { body_id: 12, population: 4000, diameter_km: 12742,
      rotation_period_hours: 24, rotation_phase_deg: 0, axial_tilt_deg: 23.44, rotation_axis_node_deg: 0,
      star_direction: [1,0,0] }, slots: [] };
    try {
      await level.initialize(canvas,backend);
      await level.enter(1,data);
      level.render(0);
      const start = level._orientation;
      expect(start.angle).toBeCloseTo(0);
      const allocations = resources.length;
      seconds += 21600;
      level.render(0);
      expect(level._orientation.angle).toBeCloseTo(Math.PI / 2);
      expect(level._orientation.basis).not.toEqual(start.basis);
      expect(resources.length).toBe(allocations);
      const buffer = name === 'planet' ? level._uniformBuffer : level._cameraBuffer;
      const uploaded = backend.device.queue.writeBuffer.mock.calls.filter(call => call[0] === buffer).at(-1)[2];
      if (name === 'planet') {
        level._orientation.basis.forEach((column,i) =>
          column.forEach((value,k) => expect(uploaded[36 + i * 4 + k]).toBeCloseTo(value,6)));
        level.setPresentationRotation(true);
        level.render(0.1);
        expect(level._presentationAngle).toBeCloseTo(0.005);
      } else {
        const frame = level._bodySurface.terrain.shape?.frame || [[1,0,0],[0,1,0],[0,0,1]];
        const light = world.unrotateVector(frame,level._orientation.canonicalSun);
        light.forEach((value,i) => expect(uploaded[136 + i]).toBeCloseTo(value,6));
      }
      reducedMotion = true;
      const show = level._presentationAngle;
      seconds += 21600;
      level.render(0.1);
      expect(level._orientation.angle).toBeCloseTo(Math.PI);
      if (name === 'planet') {
        expect(level._presentationAngle).toBe(show);
        level.setPresentationRotation(false);
        level.render(0);
      }
      const basis = level._orientation.basis;
      await level.exit();
      await level.enter(1,data);
      level.render(0);
      expect(level._orientation.basis).toEqual(basis);
    } finally { level.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });

  it.each(levels)('updates decorative regional transport in the existing %s frame without new GPU resources', async (_name, Renderer) => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    let reducedMotion = false;
    vi.stubGlobal('matchMedia', query => ({ matches: reducedMotion && query === '(prefers-reduced-motion: reduce)' }));
    document.body.innerHTML = '<div><canvas width="512" height="384"></canvas></div>';
    const canvas = document.querySelector('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 384, right: 512, bottom: 384 });
    const { backend, resources } = trackedBackend();
    const level = new Renderer();
    const model = require('../../js/rendering/colony-surface-plan.js');
    const scene = {
      colony: { name: 'Regional transport', population: 4000, diameter_km: 12742 },
      buildings: [{ type: 'farm', level: 8 }], slots: [],
      bodyTerrainManifest: { body_id: 12, seed: 35, biome: 'terran', radius_km: 6371, amplitude_km: 8,
        sea_level_km: -8, generator_version: 1, projection: 'cube-sphere',
        height_min_km: -16, height_max_km: 16, max_lod: 14, resolution: 17, tile_encoding: 'uint16-json' },
    };
    const uploaded = () => backend.device.queue.writeBuffer.mock.calls.filter(call => call[0] === level._surfaceBuffer).at(-1)[2];
    const water = () => backend.device.queue.writeBuffer.mock.calls.filter(call => call[0] === level._materialBuffer).at(-1)[2];
    const clouds = () => backend.device.queue.writeBuffer.mock.calls
      .filter(call => call[0] === (_name === 'planet' ? level._uniformBuffer : level._cameraBuffer)).at(-1)[2];
    try {
      await level.initialize(canvas, backend);
      await level.enter(1, scene);
      level.render(0.1);
      const first = uploaded().slice();
      const firstWater = water()[23];
      if (_name === 'colony') {
        expect(clouds()[19]).toBe(water()[23]);
        expect(clouds()[55]).toBe(water()[12]);
      }
      expect(new Int32Array(water().buffer)[27]).toBe(1);
      expect(first[model.ROAD_OFFSET]).toBeGreaterThan(0);
      expect(first[model.ROAD_OFFSET + 19]).toBe(1);
      const allocations = resources.length;
      level.render(0.1);
      expect(uploaded().slice(model.ROAD_OFFSET + 16, model.ROAD_OFFSET + 19))
        .not.toEqual(first.slice(model.ROAD_OFFSET + 16, model.ROAD_OFFSET + 19));
      expect(resources).toHaveLength(allocations);
      expect(water()[23]).toBeGreaterThan(firstWater);
      const waterTime = water()[23];
      reducedMotion = true;
      level.render(0.1);
      expect(water()[23]).toBe(waterTime);
      if (_name === 'colony') expect(clouds()[19]).toBe(waterTime);
      expect(new Int32Array(water().buffer)[27]).toBe(1);
      expect(uploaded()[model.ROAD_OFFSET + 19]).toBe(0);
      reducedMotion = false;
      level.render(0.1);
      expect(water()[23]).toBeGreaterThan(waterTime);
      expect(uploaded()[model.ROAD_OFFSET + 19]).toBe(1);
      level.setSceneData({ ...scene, visible: false });
      level.render(0.1);
      expect(uploaded()[model.ROAD_OFFSET + 19]).toBe(0);
      expect(new Int32Array(water().buffer)[27]).toBe(0);
      expect(clouds()[_name === 'planet' ? 35 : 46]).toBe(0);
      const hiddenTime = water()[23];
      level.render(0.1);
      expect(water()[23]).toBe(hiddenTime);
      level.setSceneData({ ...scene, reduced_flash: true });
      level.render(0.1);
      expect(new Int32Array(water().buffer)[27]).toBe(0);
      if (_name === 'colony') expect(clouds()[19]).toBe(0);
      level.setSceneData({ ...scene, vfx_quality: 'off' });
      level.render(0.1);
      expect(new Int32Array(water().buffer)[27]).toBe(0);
      expect(clouds()[_name === 'planet' ? 35 : 46]).toBe(0);
      level.setSceneData({ ...scene, colony: { ...scene.colony, has_atmosphere: false } });
      level.render(0.1);
      expect(clouds()[_name === 'planet' ? 35 : 43]).toBe(0);
      level.setSceneData({ ...scene, colony: { ...scene.colony, cloud_coverage: 0 } });
      level.render(0.1);
      expect(clouds()[_name === 'planet' ? 23 : 46]).toBe(0);
      level.setSceneData({ ...scene, reduced_motion: true });
      const explicitFreeze = level._waterTime;
      level.render(0.1);
      expect(level._waterTime).toBe(explicitFreeze);
      level.setSceneData(scene);
      level._waterTime = 119.95;
      level.render(0.1);
      expect(level._waterTime).toBeCloseTo(0.05, 8);
      if (_name === 'planet') {
        level.renderBackdrop(1000, null, 0.5);
        expect(level._waterTime).toBeCloseTo(0.15, 8);
        reducedMotion = true;
        level.renderBackdrop(0.1, null, 0.5);
        expect(level._waterTime).toBeCloseTo(0.15, 8);
      }
      await level.exit();
      const writes = backend.device.queue.writeBuffer.mock.calls.length;
      level.render(0.1);
      expect(backend.device.queue.writeBuffer).toHaveBeenCalledTimes(writes);
    } finally { level.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });

  it.each(['planet', 'colony', 'flight'])('releases real %s resources when the owner aborts', async view => {
    document.body.innerHTML = '<div><canvas></canvas></div>';
    const { backend, resources, hooks } = trackedBackend();
    const controller = new AbortController();
    const onError = vi.fn();
    const onReturn = vi.fn();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.querySelector('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 15 } }),
      onLevel: vi.fn(), onReturn, onError, signal: controller.signal,
    });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const scene = { reduced_motion: true, colony: { name: 'Owner cancellation' }, slots: [] };
    const pending = view === 'colony' ? runtime.surface(async () => scene)
      : runtime.approach(scene, view === 'flight' ? { position: { x: 0, y: 0, z: 100 } } : null);
    if (view === 'flight') await vi.waitFor(() => expect(zoom._flight.isFlying).toBe(true));
    else await pending;
    const retired = zoom._active;
    controller.abort();
    if (view === 'flight') await expect(pending).resolves.toBe(false);
    expect(retired._disposed).toBe(true);
    expect(zoom._active).toBeNull();
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    expect(document.querySelectorAll('button,[role="region"]')).toHaveLength(0);
    expect(resources.length).toBeGreaterThan(0);
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
    expect(onReturn).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it.each(['back', 'returnTo'])('does not allocate a stale real colony after %s cancels its load', async action => {
    const { backend, resources } = trackedBackend();
    const onLevel = vi.fn();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.createElement('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 15 } }),
      onLevel, onReturn: vi.fn(), onError: vi.fn(),
    });
    const scene = { reduced_motion: true, colony: { name: 'Deferred colony' }, slots: [] };
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    try {
      await runtime.approach(scene);
      let finish;
      const pending = runtime.surface(() => new Promise(resolve => { finish = resolve; }));
      if (action === 'back') {
        runtime.back();
        await vi.waitFor(() => expect(zoom._activeLevel).toBe(1));
      } else await runtime.returnTo('planet');
      const count = resources.length;
      onLevel.mockClear();
      finish(scene);
      expect(await pending).toBe(false);
      expect(resources).toHaveLength(count);
      expect(zoom._registry._instances.has(3)).toBe(false);
      expect(onLevel).not.toHaveBeenCalled();
      await expect(runtime.surface(async () => scene)).resolves.toBe(true);
      expect(zoom._activeLevel).toBe(3);
    } finally { runtime.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -1])('recovers real planet resources after invalid frame time %s', async dt => {
    const { backend, resources, hooks } = trackedBackend();
    const onError = vi.fn();
    const onReturn = vi.fn();
    const onLevel = vi.fn();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.createElement('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 15 } }),
      onLevel, onReturn, onError,
    });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const pending = runtime.approach({}, { position: { x: 0, y: 0, z: 100 } });
    const rejected = expect(pending).rejects.toThrow(TypeError);
    await vi.waitFor(() => expect(zoom._flight.isFlying).toBe(true));
    [...hooks][0](dt);
    await rejected;
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(TypeError);
    expect(onReturn).toHaveBeenCalledOnce();
    expect(onLevel).not.toHaveBeenCalled();
    expect(zoom._active).toBeNull();
    expect(zoom._disposed).toBe(true);
    expect(hooks.size).toBe(0);
    expect(resources.length).toBeGreaterThan(0);
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('cleans up real planet entry after invalid flight setup and permits retry', async () => {
    const { backend, resources } = trackedBackend();
    const onLevel = vi.fn();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.createElement('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 15 } }),
      onLevel, onReturn: vi.fn(), onError: vi.fn(),
    });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    try {
      await expect(zoom.zoomTo(2, {}, { cameraTo: { x: 0, y: 0, z: Infinity } })).rejects.toThrow(TypeError);
      expect(onLevel).not.toHaveBeenCalled();
      expect(zoom._active).toBeNull();
      expect(zoom._flight.isFlying).toBe(false);
      expect(zoom._flight._targetRef).toBeNull();
      expect(backend.setZoomSceneActive).toHaveBeenLastCalledWith(false);
      expect(resources.length).toBeGreaterThan(0);
      resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
      await expect(runtime.approach({})).resolves.toBe(true);
      expect(zoom._activeLevel).toBe(2);
    } finally { runtime.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });

  it.each(['atmosphere', 'blur', 'target'])('recovers real planet resources after a final-frame %s flight failure', async stage => {
    const { backend, resources, hooks } = trackedBackend();
    const onError = vi.fn();
    const onReturn = vi.fn();
    const onLevel = vi.fn();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.createElement('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 15 } }),
      onLevel, onReturn, onError,
    });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const failure = new Error(`${stage} frame failed`);
    let fail = false;
    const callback = () => { if (fail) throw failure; };
    const pending = zoom.zoomTo(2, {}, {
      flyDuration: 100,
      cameraTarget: () => {
        if (stage === 'target') callback();
        return { x: 0, y: 0, z: 0 };
      },
      onAtmosphereScale: stage === 'atmosphere' ? callback : null,
      onStarBlur: stage === 'blur' ? callback : null,
    });
    const rejected = expect(pending).rejects.toBe(failure);
    await vi.waitFor(() => expect(zoom._flight.isFlying).toBe(true));
    fail = true;
    [...hooks][0](1);
    await rejected;
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(onReturn).toHaveBeenCalledOnce();
    expect(onLevel).not.toHaveBeenCalled();
    expect(zoom._disposed).toBe(true);
    expect(zoom._active).toBeNull();
    expect(zoom._flight._targetRef).toBeNull();
    expect(zoom._flight._onAtmosphereScale).toBeNull();
    expect(zoom._flight._onStarBlur).toBeNull();
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it.each(['planet', 'flight', 'colony', 'building'])('releases an active real %s replacement and permits fresh entry', async view => {
    document.body.innerHTML = '<div><canvas></canvas></div>';
    const { backend, resources } = trackedBackend();
    const onLevel = vi.fn();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.querySelector('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 15 } }),
      onLevel, onReturn: vi.fn(), onError: vi.fn(),
    });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const scene = { reduced_motion: true, colony: { name: 'Active replacement' },
      slots: [{ x: 0, z: 0, type: 'habitat', level: 2 }] };
    const surface = view === 'colony' || view === 'building';
    if (surface) await runtime.approach(scene);
    const start = resources.length;
    const pending = view === 'flight'
      ? runtime.approach(scene, { position: { x: 0, y: 0, z: 100 } })
      : surface ? runtime.surface(async () => scene) : runtime.approach(scene);
    try {
      if (view === 'flight') await vi.waitFor(() => expect(zoom._flight.isFlying).toBe(true));
      else await pending;
      if (view === 'building') await zoom._active._navigation.building(zoom._active._slots[0]);
      const retired = zoom._active;
      const render = vi.spyOn(retired, 'render');
      const oldResources = resources.slice(start).filter(resource => resource.destroy.mock.calls.length === 0);
      expect(oldResources.length).toBeGreaterThan(0);
      onLevel.mockClear();
      zoom.register(surface ? 3 : 2, {
        webgpu: surface ? ColonySurfaceLevelWebGPU : PersistentBodyPlanetApproachRenderer,
      });
      expect(zoom._active).toBeNull();
      expect(retired._disposed).toBe(true);
      if (surface) {
        expect(retired._hud).toBeNull();
        expect(retired._inputCleanups).toHaveLength(0);
      }
      zoom.tick(0.016);
      expect(render).not.toHaveBeenCalled();
      if (view === 'flight') await expect(pending).resolves.toBe(false);
      expect(onLevel).not.toHaveBeenCalled();
      oldResources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
      const restored = surface ? await runtime.surface(async () => scene) : await runtime.approach(scene);
      expect(restored).toBe(true);
      expect(zoom._active).not.toBe(retired);
      expect(zoom._activeLevel).toBe(surface ? 3 : 2);
    } finally { runtime.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });

  it('discards a replaced real planet initialization without leaking GPU buffers or entering the retired renderer', async () => {
    const { backend, resources } = trackedBackend();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.createElement('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel: vi.fn(), onReturn: vi.fn(), onError: vi.fn(),
    });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const retired = zoom._registry.resolve(2, zoom._backend);
    const initialize = retired.initialize.bind(retired);
    let finish;
    vi.spyOn(retired, 'initialize').mockImplementation(async (...args) => {
      await initialize(...args);
      await new Promise(resolve => { finish = resolve; });
    });
    const enter = vi.spyOn(retired, 'enter');
    const pending = zoom.zoomTo(2, {}, { skipCameraFlight: true });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const oldResources = resources.slice();
    zoom.register(2, { webgpu: PersistentBodyPlanetApproachRenderer });
    finish();
    try {
      await pending;
      expect(enter).not.toHaveBeenCalled();
      expect(zoom._active).toBeNull();
      oldResources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
      await runtime.approach({});
      expect(zoom._active).not.toBe(retired);
      expect(zoom._activeLevel).toBe(2);
    } finally { runtime.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });
  it('cancels a real surface transition cleanly when an exit callback closes the runtime', async () => {
    const { backend, resources, hooks } = trackedBackend();
    const onError = vi.fn();
    const onLevel = vi.fn();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.createElement('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel, onReturn: vi.fn(), onError,
    });
    const scene = { reduced_motion: true, colony: { name: 'Close during transition' }, slots: [] };
    await runtime.approach(scene);
    onLevel.mockClear();
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    zoom.on('exitLevel', () => runtime.dispose());
    await expect(runtime.surface(async () => scene)).resolves.toBe(false);
    expect(onLevel).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });
  it.each(['enter', 'leave'])('releases the real surface when a building %s notification fails', async direction => {
    document.body.innerHTML = '<div><canvas></canvas></div>';
    const { backend, resources } = trackedBackend();
    const failure = new Error('Building notification failed');
    let fail = false;
    const onError = vi.fn();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.querySelector('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel: () => { if (fail) throw failure; }, onReturn: vi.fn(), onError,
    });
    const scene = { reduced_motion: true, colony: { name: 'Building cleanup' },
      slots: [{ x: 0, z: 0, type: 'habitat', level: 2 }] };
    try {
      await runtime.approach(scene);
      const startIndex = resources.length;
      await runtime.surface(async () => scene);
      const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
      const surface = zoom._active;
      const slot = surface._slots[0];
      if (direction === 'leave') await surface._navigation.building(slot);
      fail = true;
      const start = resources.slice(startIndex);
      if (direction === 'enter') await surface._navigation.building(slot);
      else await surface._navigation.back();
      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0][0]).toMatchObject({ errors: [failure] });
      expect(zoom._active).toBeNull();
      expect(surface._disposed).toBe(true);
      expect(surface._hud).toBeNull();
      expect(surface._inputCleanups).toHaveLength(0);
      expect(zoom._registry._instances.has(3)).toBe(false);
      start.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
      fail = false;
      await expect(runtime.surface(async () => scene)).resolves.toBe(true);
      expect(zoom._active).not.toBe(surface);
    } finally { runtime.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });
  it('ignores retained surface handlers after re-entry while current building navigation stays usable', async () => {
    const { backend, resources } = trackedBackend();
    const onError = vi.fn();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.createElement('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel: vi.fn(), onReturn: vi.fn(), onError,
    });
    const scene = { reduced_motion: true, colony: { name: 'Navigation generations' },
      slots: [{ x: 0, z: 0, type: 'habitat', level: 2 }] };
    try {
      await runtime.surface(async () => scene);
      const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
      const surface = zoom._active;
      const old = surface._navigation;
      const selected = vi.fn();
      zoom.on('slotClick', selected);
      await runtime.returnTo('planet');
      await old.back();
      await old.surface(scene);
      await old.building({});
      old.slotClick({ id: 'old-view' });
      expect(zoom._activeLevel).toBe(2);
      expect(selected).not.toHaveBeenCalled();
      await runtime.surface(async () => scene);
      expect(zoom._active).toBe(surface);
      await old.back();
      expect(zoom._activeLevel).toBe(3);
      const current = surface._navigation;
      const slot = surface._slots[0];
      current.slotClick(slot);
      expect(selected).toHaveBeenCalledExactlyOnceWith(slot);
      const allocations = resources.length;
      await current.building(slot);
      expect(zoom._activeLevel).toBe(5);
      expect(zoom._active).toBe(surface);
      await current.back();
      expect(zoom._activeLevel).toBe(3);
      expect(resources).toHaveLength(allocations);
      expect(onError).not.toHaveBeenCalled();
    } finally { runtime.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });

  it('reports a renderer-triggered surface failure through the bridge without an unhandled rejection', async () => {
    const { backend, resources } = trackedBackend();
    const onError = vi.fn();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.createElement('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel: vi.fn(), onReturn: vi.fn(), onError,
    });
    const scene = { reduced_motion: true, colony: { name: 'Renderer navigation' }, slots: [] };
    await runtime.approach(scene);
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const failure = new Error('Surface navigation initialization failed');
    backend.device.createBindGroup.mockImplementationOnce(() => { throw failure; });
    try {
      await zoom._active._navigation.surface(scene);
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
      expect(zoom._activeLevel).toBe(2);
      await runtime.surface(async () => scene);
      const surface = zoom._active;
      vi.spyOn(surface, 'exit').mockRejectedValueOnce(failure);
      await surface._navigation.back();
      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenLastCalledWith(failure);
      expect(zoom._active).toBeNull();
      expect(backend.setZoomSceneActive).toHaveBeenLastCalledWith(false);
    } finally { runtime.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
  });
  it.each(levels)('retains reusable %s scene data on exit but releases it and callbacks on disposal', async (_name, Renderer) => {
    const { backend } = trackedBackend();
    const renderer = new Renderer();
    const scene = { reduced_motion: true, colony: { name: 'CPU ownership' },
      slots: [{ x: 0, z: 0, type: 'habitat', level: 2 }],
      onError: vi.fn(), bodyTerrainManifest: { body_id: 12, radius_km: 6,
        shape: { version: 1, axes: [1, 1, 1], deformation: 0 } } };
    await renderer.initialize(document.createElement('canvas'), backend);
    renderer.setNavigationHandlers({ back: vi.fn() });
    await renderer.enter(null, scene);
    await renderer.exit();
    expect(renderer._sceneData).toBe(scene);
    await renderer.enter(null, null);
    expect(renderer._sceneData).toBe(scene);
    renderer.dispose();
    expect(renderer._sceneData).toBeNull();
    expect(renderer._navigation).toBeNull();
    if (_name === 'planet') {
      expect(renderer._terrainManifest).toBeNull();
      expect(renderer._publishedTerrainManifest).toBeNull();
    } else {
      expect(renderer._slots).toEqual([]);
      expect(renderer._city).toBeNull();
      expect(renderer._bodySurface).toBeNull();
    }
    expect(() => renderer.setSceneData(scene)).toThrow('disposed');
    expect(() => renderer.setNavigationHandlers({ back: vi.fn() })).toThrow('disposed');
    expect(renderer._sceneData).toBeNull();
    expect(renderer._navigation).toBeNull();
    expect(() => renderer.dispose()).not.toThrow();
  });

  it('releases actual colony GPU resources before reporting a failed rendering recovery', async () => {
    document.body.innerHTML = '<div><canvas></canvas></div>';
    const { backend, resources, hooks } = trackedBackend();
    const renderingFailure = new Error('Colony draw failed');
    const returnFailure = new Error('System recovery failed');
    const onError = vi.fn();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.querySelector('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel: vi.fn(), onReturn: () => { throw returnFailure; }, onError,
    });
    await runtime.surface(async () => ({ reduced_motion: true, colony: { name: 'Failed draw' },
      slots: [{ x: 0, z: 0, type: 'habitat', level: 2 }] }));
    const surface = window.__GQ_ZOOM_ORCHESTRATOR._active;
    vi.spyOn(surface, 'render').mockImplementationOnce(() => { throw renderingFailure; });
    [...hooks][0](0.016);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatchObject({ errors: [renderingFailure, returnFailure] });
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(surface._hud).toBeNull();
    expect(surface._inputCleanups).toHaveLength(0);
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    expect(backend.device.destroy).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('releases colony resources and input after entry fails following HUD creation', async () => {
    document.body.innerHTML = '<div><canvas></canvas></div>';
    const { backend, resources } = trackedBackend();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.querySelector('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel: vi.fn(), onReturn: vi.fn(), onError: vi.fn(),
    });
    const scene = { reduced_motion: true, colony: { name: 'Entry retry' },
      slots: [{ x: 0, z: 0, type: 'habitat', level: 2 }] };
    await runtime.approach(scene);
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const surface = zoom._registry.resolve(3, zoom._backend);
    const original = surface._mountControls.bind(surface);
    const failure = new Error('HUD initialization failed');
    vi.spyOn(surface, '_mountControls').mockImplementationOnce(() => { original(); throw failure; });
    const start = resources.length;
    try {
      await expect(runtime.surface(async () => scene)).rejects.toBe(failure);
      expect(surface._hud).toBeNull();
      expect(surface._inputCleanups).toHaveLength(0);
      expect(surface._disposed).toBe(true);
      resources.slice(start).forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
      expect(zoom._active).toBeNull();
      expect(backend.setZoomSceneActive).toHaveBeenLastCalledWith(false);
      await expect(runtime.surface(async () => scene)).resolves.toBe(true);
      expect(zoom._active).not.toBe(surface);
    } finally { runtime.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });

  it.each(['planet', 'colony'])('releases a partially initialized %s renderer and retries with a fresh instance', async level => {
    const { backend, resources } = trackedBackend();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.createElement('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel: vi.fn(), onReturn: vi.fn(), onError: vi.fn(),
    });
    const scene = { reduced_motion: true, colony: { name: 'Initialization retry' }, slots: [] };
    if (level === 'colony') await runtime.approach(scene);
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const previous = zoom._active;
    const failure = new Error('GPU bind-group creation failed');
    const start = resources.length;
    backend.device.createBindGroup.mockImplementationOnce(() => { throw failure; });
    const enter = () => level === 'planet' ? runtime.approach(scene) : runtime.surface(async () => scene);
    try {
      await expect(enter()).rejects.toBe(failure);
      const failedResources = resources.slice(start);
      expect(failedResources.length).toBeGreaterThan(0);
      failedResources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
      expect(zoom._active).toBe(previous);
      expect(zoom._transition).toBe(false);
      expect(backend.device.destroy).not.toHaveBeenCalled();
      await expect(enter()).resolves.toBe(true);
      expect(zoom._active._disposed).toBe(false);
      failedResources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    } finally { runtime.dispose(); }
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
  });

  it.each(levels)('does not resume pending %s entry after disposal', async (_name, Renderer) => {
    const { backend, resources } = trackedBackend();
    const renderer = new Renderer();
    const scene = { reduced_motion: true, colony: { name: 'Cancelled entry' }, slots: [] };
    await renderer.initialize(document.createElement('canvas'), backend);
    await renderer.enter(null, scene);
    const applyScene = vi.spyOn(renderer, 'setSceneData');
    const pending = renderer.enter(null, scene);
    renderer.dispose();
    await pending;
    expect(applyScene).not.toHaveBeenCalled();
    expect(renderer._active).toBe(false);
    expect(renderer._inputCleanups).toHaveLength(0);
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
  });

  it.each(levels)('does not resume pending %s entry after a newer exit', async (_name, Renderer) => {
    const { backend } = trackedBackend();
    const renderer = new Renderer();
    const scene = { reduced_motion: true, colony: { name: 'Superseded entry' }, slots: [] };
    await renderer.initialize(document.createElement('canvas'), backend);
    await renderer.enter(null, scene);
    const applyScene = vi.spyOn(renderer, 'setSceneData');
    try {
      const pending = renderer.enter(null, scene);
      await renderer.exit();
      await pending;
      expect(applyScene).not.toHaveBeenCalled();
      expect(renderer._active).toBe(false);
    } finally { renderer.dispose(); }
  });

  it('does not restore colony scene resources when initialization resolves after disposal', async () => {
    const { backend, resources } = trackedBackend();
    const renderer = new ColonySurfaceLevelWebGPU();
    renderer._sceneData = { colony: { name: 'Cancelled initialization' }, slots: [] };
    const applyScene = vi.spyOn(renderer, 'setSceneData');
    const pending = renderer.initialize(document.createElement('canvas'), backend);
    renderer.dispose();
    await pending;
    expect(applyScene).not.toHaveBeenCalled();
    expect(renderer._device).toBeNull();
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
  });

  it('does not let an interrupted animated exit clear a newly entered colony view', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    document.body.innerHTML = '<div><canvas></canvas></div>';
    const { backend } = trackedBackend();
    const renderer = new ColonySurfaceLevelWebGPU();
    const scene = { colony: { name: 'Interrupted departure' },
      slots: [{ x: 0, z: 0, type: 'habitat', level: 2 }] };
    await renderer.initialize(document.querySelector('canvas'), backend);
    await renderer.enter(null, scene);
    renderer._camera.progress = 1;
    renderer.setTransitionSource({ renderBackdrop: vi.fn() }, null);
    const leaving = renderer.exit(2);
    expect(renderer._departure).not.toBeNull();
    try {
      await renderer.enter(null, scene);
      await leaving;
      expect(renderer._active).toBe(true);
      expect(renderer._hud).not.toBeNull();
      expect(renderer._instanceBuffer).not.toBeNull();
    } finally { renderer.dispose(); }
  });

  it.each(levels)('rejects new %s initialization and entry after terminal disposal', async (_name, Renderer) => {
    const { backend, resources } = trackedBackend();
    const renderer = new Renderer();
    renderer.dispose();
    await expect(renderer.initialize(document.createElement('canvas'), backend)).rejects.toThrow('disposed');
    await expect(renderer.enter(null, {})).rejects.toThrow('disposed');
    expect(resources).toHaveLength(0);
    expect(renderer._active).toBeFalsy();
  });

  it.each(levels)('keeps the latest of overlapping %s entries', async (_name, Renderer) => {
    const { backend } = trackedBackend();
    const renderer = new Renderer();
    const scene = name => ({ reduced_motion: true, colony: { name }, slots: [] });
    await renderer.initialize(document.createElement('canvas'), backend);
    await renderer.enter(null, scene('Initial view'));
    try {
      const first = renderer.enter(null, scene('Obsolete view'));
      const second = renderer.enter(null, scene('Latest view'));
      await Promise.all([first, second]);
      expect(renderer._active).toBe(true);
      expect(renderer._sceneData.colony.name).toBe('Latest view');
    } finally { renderer.dispose(); }
  });

  it('settles superseded animated exits without cancelling the latest departure', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { backend, resources } = trackedBackend();
    const renderer = new ColonySurfaceLevelWebGPU();
    await renderer.initialize(document.createElement('canvas'), backend);
    await renderer.enter(null, { colony: { name: 'Repeated departure' }, slots: [] });
    renderer._camera.progress = 1;
    renderer.setTransitionSource({ renderBackdrop: vi.fn() }, null);
    const first = renderer.exit(2);
    const second = renderer.exit(2);
    const latestDeparture = renderer._departure;
    try {
      await first;
      expect(renderer._departure).toBe(latestDeparture);
      expect(renderer._active).toBe(true);
    } finally { renderer.dispose(); }
    await second;
    expect(renderer._active).toBe(false);
    expect(renderer._departure).toBeNull();
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
  });

  it.each(['planet', 'colony'])('aggregates %s cleanup failures while attempting every resource exactly once', async level => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    document.body.innerHTML = '<div><canvas></canvas></div>';
    const { backend, resources, hooks } = trackedBackend();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.querySelector('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel: vi.fn(), onReturn: vi.fn(), onError: vi.fn(),
    });
    const scene = { reduced_motion: true, colony: { name: 'Cleanup fixture' }, slots: [] };
    if (level === 'planet') await runtime.approach(scene);
    else await runtime.surface(async () => scene);
    const renderer = window.__GQ_ZOOM_ORCHESTRATOR._active;
    const failures = [new Error('Stream cleanup failed'), new Error('Input cleanup failed'), new Error('Buffer cleanup failed')];
    renderer._terrainStream = { dispose: vi.fn(() => { throw failures[0]; }) };
    const successfulInputCleanup = vi.fn();
    renderer._inputCleanups.unshift(() => { throw failures[1]; }, successfulInputCleanup);
    const buffer = level === 'planet' ? renderer._uniformBuffer : renderer._cameraBuffer;
    buffer.destroy.mockImplementation(() => { throw failures[2]; });
    let thrown;
    try { runtime.dispose(); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(AggregateError);
    const flatten = error => error instanceof AggregateError ? error.errors.flatMap(flatten) : [error];
    expect(flatten(thrown)).toEqual(failures);
    expect(successfulInputCleanup).toHaveBeenCalledOnce();
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(renderer._device).toBeNull();
    expect(renderer._terrainStream).toBeNull();
    expect(renderer._sceneData).toBeNull();
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    expect(() => runtime.dispose()).not.toThrow();
    expect(() => renderer.dispose()).not.toThrow();
  });

  it('finishes animated surface exit cleanup immediately when an input cleanup fails', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    document.body.innerHTML = '<div><canvas></canvas></div>';
    const { backend } = trackedBackend();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.querySelector('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel: vi.fn(), onReturn: vi.fn(), onError: vi.fn(),
    });
    await runtime.surface(async () => ({ colony: { name: 'Animated cleanup fixture' }, slots: [] }));
    const surface = window.__GQ_ZOOM_ORCHESTRATOR._active;
    surface._camera.progress = 1;
    const failure = new Error('Input release failed');
    surface._inputCleanups.unshift(() => { throw failure; });
    try {
      await expect(surface.exit(2)).rejects.toMatchObject({ errors: [failure] });
      expect(surface._active).toBe(false);
      expect(surface._departure).toBeNull();
      expect(surface._instanceBuffer).toBeNull();
      expect(surface._hud).toBeNull();
    } finally { runtime.dispose(); }
  });

  it('clears every terrain cache entry even when one buffer cannot be destroyed', async () => {
    const { backend, resources } = trackedBackend();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.createElement('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel: vi.fn(), onReturn: vi.fn(), onError: vi.fn(),
    });
    await runtime.surface(async () => ({ colony: { name: 'Terrain cleanup fixture' }, slots: [] }));
    const surface = window.__GQ_ZOOM_ORCHESTRATOR._active;
    const first = backend.device.createBuffer({ size: 64 });
    const second = backend.device.createBuffer({ size: 64 });
    const failure = new Error('Terrain buffer destruction failed');
    first.destroy.mockImplementation(() => { throw failure; });
    surface._terrainCache.set('first', { buffer: first });
    surface._terrainCache.set('second', { buffer: second });
    expect(() => runtime.dispose()).toThrow(AggregateError);
    expect(surface._terrainCache.size).toBe(0);
    expect(surface._terrainCacheBytes).toBe(0);
    resources.forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
    expect(() => surface.dispose()).not.toThrow();
  });

  it('renders and disposes six full bridge lifecycles without leaking or destroying borrowed GPU resources', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    document.body.innerHTML = '<div><canvas width="512" height="384"></canvas></div>';
    const canvas = document.querySelector('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 384, right: 512, bottom: 384 });
    const { backend, resources, hooks, pass } = trackedBackend();
    const onError = vi.fn();
    const scene = { reduced_motion: true,
      colony: { name: 'GPU ownership fixture', diameter_km: 12, population: 0, body_type: 'asteroid' },
      bodyTerrainManifest: { body_id: 12, radius_km: 6,
        shape: { version: 1, axes: [1.45, 0.8, 0.95], deformation: 0.22 } },
      slots: [{ x: 0, z: 0, type: 'habitat', level: 2 }],
    };
    for (let cycle = 0; cycle < 6; cycle++) {
      const start = resources.length;
      const runtime = await createGameColonyZoom({
        renderer: { getSharedZoomBackend: () => backend }, canvas,
        getCameraState: () => ({ position: { x: 0, y: 0, z: 3 }, target: { x: 0, y: 0, z: 0 } }),
        onLevel: vi.fn(), onReturn: vi.fn(), onError,
      });
      try {
        expect(await runtime.approach(scene)).toBe(true);
        const planet = window.__GQ_ZOOM_ORCHESTRATOR._active;
        const draws = pass.draw.mock.calls.length;
        hooks.forEach(hook => hook(0.016));
        expect(pass.draw.mock.calls.length).toBeGreaterThan(draws);
        expect(await runtime.surface(async () => scene)).toBe(true);
        hooks.forEach(hook => hook(0.016));
        const surface = window.__GQ_ZOOM_ORCHESTRATOR._active;
        expect(surface._device).toBe(backend.device);
        expect(surface._terrainVertexCount).toBeGreaterThan(0);
        expect(surface._depthTexture).toBeTruthy();
        expect(planet._depthTexture).toBeNull();
        expect(await runtime.returnTo('planet')).toBe(true);
        expect(surface._depthTexture).toBeNull();
        expect(surface._terrainBuffer).toBeNull();
        hooks.forEach(hook => hook(0.016));
        expect(planet._depthTexture).toBeTruthy();
        expect(await runtime.surface(async () => scene)).toBe(true);
        hooks.forEach(hook => hook(0.016));
        const buffers = resources.slice(start);
        expect(buffers.length).toBeGreaterThanOrEqual(8);
        expect(buffers.some(resource => !resource.destroy.mock.calls.length)).toBe(true);
      } finally {
        runtime.dispose();
      }
      runtime.dispose();
      resources.slice(start).forEach(resource => expect(resource.destroy).toHaveBeenCalledOnce());
      expect(hooks.size).toBe(0);
      expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
      expect(document.querySelectorAll('button,[role="region"]')).toHaveLength(0);
      expect(backend.device.destroy).not.toHaveBeenCalled();
      expect(backend.context.unconfigure).not.toHaveBeenCalled();
    }
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(['dispose', 'returnToPlanet'])('releases a surface-owned pointer capture on %s in the middle of a drag', async action => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    document.body.innerHTML = '<div><canvas></canvas></div>';
    const canvas = document.querySelector('canvas');
    let captured = false;
    canvas.setPointerCapture = vi.fn(() => { captured = true; });
    canvas.hasPointerCapture = vi.fn(() => captured);
    canvas.releasePointerCapture = vi.fn(() => { captured = false; });
    const { backend } = trackedBackend();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas,
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 } }),
      onLevel: vi.fn(), onReturn: vi.fn(), onError: vi.fn(),
    });
    await runtime.surface(async () => ({ colony: { name: 'Capture fixture' }, slots: [] }));
    const event = new MouseEvent('pointerdown', { button: 0, bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: 17 });
    canvas.dispatchEvent(event);
    expect(captured).toBe(true);

    try {
      if (action === 'dispose') runtime.dispose();
      else expect(await runtime.returnTo('planet')).toBe(true);
      expect(canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(17);
      expect(captured).toBe(false);
    } finally {
      runtime.dispose();
    }
  });
});
