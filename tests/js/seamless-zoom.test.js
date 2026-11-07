/**
 * seamless-zoom.test.js
 *
 * Unit tests for the Seamless Zoom Engine:
 *   RendererRegistry
 *     • resolve() returns WebGPU class when backend = WebGPU
 *     • resolve() returns ThreeJS class as fallback
 *   SeamlessZoomOrchestrator
 *     • zoomTo() calls exit() on the old level
 *     • zoomTo() calls enter() on the new level
 *     • double-zoomTo() during a running transition is ignored (guard)
 *     • ZOOM_LEVEL.PLANET_APPROACH triggers CameraFlightPath.flyTo()
 *     • ZOOM_LEVEL.OBJECT_APPROACH triggers CameraFlightPath.flyTo()
 *     • other levels do NOT trigger CameraFlightPath.flyTo()
 *   CameraFlightPath
 *     • flyTo() returns a Promise that resolves when t reaches 1
 *     • tick() returns t progressing from 0 toward 1
 *     • implements the camera-driver interface (has update(ctx) method)
 *   ApproachTargetType
 *     • enum contains all 5 expected target types
 *     • ObjectApproachLevelThreeJS — enter() records targetType from payload
 *     • ObjectApproachLevelWebGPU  — enter() records targetType from payload
 *     • meshDescriptorFor() returns correct shape per type
 *
 * Uses a MockRenderer — no real GPU or DOM required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { RendererRegistry }         = require(path.join(root, 'js/engine/zoom/RendererRegistry.js'));
const { SeamlessZoomOrchestrator, ZOOM_LEVEL, ApproachTargetType, SPATIAL_DEPTH } =
  require(path.join(root, 'js/engine/zoom/SeamlessZoomOrchestrator.js'));
const { CameraFlightPath }         = require(path.join(root, 'js/engine/zoom/CameraFlightPath.js'));
const { RendererFactory } = require(path.join(root, 'js/engine/core/RendererFactory.js'));
const { ObjectApproachLevelThreeJS } =
  require(path.join(root, 'js/engine/zoom/levels/ObjectApproachLevelThreeJS.js'));
const { ObjectApproachLevelWebGPU, meshDescriptorFor } =
  require(path.join(root, 'js/engine/zoom/levels/ObjectApproachLevelWebGPU.js'));

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal IZoomLevelRenderer mock whose async methods resolve
 * immediately and record calls via vi.fn() spies.
 */
function makeMockLevel() {
  return {
    _initialised: false,   // matches the orchestrator's internal flag
    initialize: vi.fn().mockResolvedValue(undefined),
    setSceneData: vi.fn(),
    render: vi.fn(),
    enter: vi.fn().mockResolvedValue(undefined),
    exit:  vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
}

/**
 * Mock IGraphicsRenderer backend.
 * @param {'webgpu'|'webgl2'} type
 */
function makeMockBackend(type = 'webgpu') {
  const caps = { webgpu: type === 'webgpu', webgl2: true };
  return {
    getCapabilities: () => caps,
    constructor: { name: type === 'webgpu' ? 'WebGPURenderer' : 'WebGLRenderer' },
  };
}

// Mock level classes (constructors that return the same mock instance so we
// can inspect calls on it).
function makeLevelClass(instance) {
  return class MockLevel {
    constructor() { Object.assign(this, instance); }
  };
}

// ---------------------------------------------------------------------------
// RendererRegistry
// ---------------------------------------------------------------------------

describe('RendererRegistry — resolve()', () => {
  let registry;
  let webgpuInstance, threejsInstance;
  let WebGPUClass, ThreeJSClass;

  beforeEach(() => {
    registry        = new RendererRegistry();
    webgpuInstance  = makeMockLevel();
    threejsInstance = makeMockLevel();
    WebGPUClass     = makeLevelClass(webgpuInstance);
    ThreeJSClass    = makeLevelClass(threejsInstance);
    registry.register(ZOOM_LEVEL.GALAXY, { webgpu: WebGPUClass, threejs: ThreeJSClass });
  });

  it('returns a WebGPU class instance when backend reports webgpu=true', () => {
    const backend  = makeMockBackend('webgpu');
    const resolved = registry.resolve(ZOOM_LEVEL.GALAXY, backend);
    expect(resolved).toBeInstanceOf(WebGPUClass);
  });

  it('returns a ThreeJS class instance as fallback when backend reports webgpu=false', () => {
    const backend  = makeMockBackend('webgl2');
    const resolved = registry.resolve(ZOOM_LEVEL.GALAXY, backend);
    expect(resolved).toBeInstanceOf(ThreeJSClass);
  });

  it('supports a WebGPU-only level without requiring a Three.js implementation', () => {
    const webgpuOnlyRegistry = new RendererRegistry();
    webgpuOnlyRegistry.register(ZOOM_LEVEL.SYSTEM, { webgpu: WebGPUClass });

    expect(webgpuOnlyRegistry.resolve(ZOOM_LEVEL.SYSTEM, makeMockBackend('webgpu')))
      .toBeInstanceOf(WebGPUClass);
    const fallbackRegistry = new RendererRegistry();
    fallbackRegistry.register(ZOOM_LEVEL.SYSTEM, { webgpu: WebGPUClass });
    expect(() => fallbackRegistry.resolve(ZOOM_LEVEL.SYSTEM, makeMockBackend('webgl2')))
      .toThrow(/no non-WebGPU renderer registered/i);
  });

  it('requires at least one renderer implementation per level', () => {
    expect(() => registry.register(ZOOM_LEVEL.SYSTEM, {}))
      .toThrow(/at least one renderer constructor/i);
  });

  it('returns the same (cached) instance on repeated calls for the same level', () => {
    const backend = makeMockBackend('webgpu');
    const first   = registry.resolve(ZOOM_LEVEL.GALAXY, backend);
    const second  = registry.resolve(ZOOM_LEVEL.GALAXY, backend);
    expect(first).toBe(second);
  });

  it('throws when level is not registered', () => {
    const backend = makeMockBackend('webgpu');
    expect(() => registry.resolve(ZOOM_LEVEL.SYSTEM, backend)).toThrow();
  });

  it('disposes a cached renderer before replacing its registered implementation', () => {
    const backend = makeMockBackend('webgpu');
    const previous = registry.resolve(ZOOM_LEVEL.GALAXY, backend);
    const replacement = makeMockLevel();
    const ReplacementClass = makeLevelClass(replacement);

    registry.register(ZOOM_LEVEL.GALAXY, { webgpu: ReplacementClass });

    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(registry.resolve(ZOOM_LEVEL.GALAXY, backend)).toBeInstanceOf(ReplacementClass);
  });

  it('releases a failed instance without removing its registration or a later replacement', () => {
    const backend = makeMockBackend('webgpu');
    const failed = registry.resolve(ZOOM_LEVEL.GALAXY, backend);
    registry.release(ZOOM_LEVEL.GALAXY, failed);
    expect(failed.dispose).toHaveBeenCalledOnce();
    const replacement = registry.resolve(ZOOM_LEVEL.GALAXY, backend);
    expect(replacement).not.toBe(failed);
    registry.release(ZOOM_LEVEL.GALAXY, failed);
    expect(registry.resolve(ZOOM_LEVEL.GALAXY, backend)).toBe(replacement);
    expect(failed.dispose).toHaveBeenCalledOnce();
  });

  it('attempts every renderer dispose and reports failures after clearing the registry', () => {
    const broken = makeMockLevel();
    broken.dispose.mockImplementation(() => { throw new Error('renderer disposal failed'); });
    const healthy = makeMockLevel();
    const BrokenClass = makeLevelClass(broken);
    const HealthyClass = makeLevelClass(healthy);
    registry.register(ZOOM_LEVEL.GALAXY, { webgpu: BrokenClass });
    registry.register(ZOOM_LEVEL.SYSTEM, { webgpu: HealthyClass });
    registry.resolve(ZOOM_LEVEL.GALAXY, makeMockBackend('webgpu'));
    registry.resolve(ZOOM_LEVEL.SYSTEM, makeMockBackend('webgpu'));

    expect(() => registry.clear()).toThrow(AggregateError);
    expect(broken.dispose).toHaveBeenCalledOnce();
    expect(healthy.dispose).toHaveBeenCalledOnce();
    expect(() => registry.resolve(ZOOM_LEVEL.GALAXY, makeMockBackend('webgpu'))).toThrow(/no entry registered/);
  });
});

// ---------------------------------------------------------------------------
// SeamlessZoomOrchestrator — transition lifecycle
// ---------------------------------------------------------------------------

describe('SeamlessZoomOrchestrator — zoomTo() lifecycle', () => {
  let orchestrator;
  let levelA, levelB;
  let ClassA, ClassB;
  let mockBackend;

  beforeEach(() => {
    mockBackend = makeMockBackend('webgl2');

    levelA = makeMockLevel();
    levelB = makeMockLevel();
    ClassA = makeLevelClass(levelA);
    ClassB = makeLevelClass(levelB);

    // Inject mock backend so RendererFactory is never called.
    orchestrator = new SeamlessZoomOrchestrator(null, { _backend: mockBackend });
    orchestrator.register(ZOOM_LEVEL.GALAXY, { webgpu: ClassA, threejs: ClassA });
    orchestrator.register(ZOOM_LEVEL.SYSTEM, { webgpu: ClassB, threejs: ClassB });
  });

  it('calls exit() on the previously active level during zoomTo()', async () => {
    // Activate Level 0 first.
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null);
    expect(levelA.exit.mock.calls.length).toBe(0);

    // Now transition to Level 1.
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, null);
    expect(levelA.exit.mock.calls.length).toBe(1);
    expect(levelA.exit.mock.calls[0][0]).toBe(ZOOM_LEVEL.SYSTEM);
  });

  it('calls enter() on the new level during zoomTo()', async () => {
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null);
    expect(levelA.enter.mock.calls.length).toBe(1);
  });

  it('passes the payload to enter()', async () => {
    const payload = { star: { id: 42 } };
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, payload);
    expect(levelA.enter.mock.calls[0][1]).toBe(payload);
  });

  it.each(['settled', 'flying'])('detaches an active %s renderer when its registration is replaced', async stage => {
    await orchestrator.initialize();
    mockBackend.setZoomSceneActive = vi.fn();
    orchestrator.register(ZOOM_LEVEL.PLANET_APPROACH, { threejs: ClassB });
    const entered = vi.fn();
    orchestrator.on('enterLevel', entered);
    const pending = orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {}, {
      skipCameraFlight: stage === 'settled', flyDuration: 10000,
    });
    await vi.waitFor(() => expect(orchestrator._activeLevel).toBe(ZOOM_LEVEL.PLANET_APPROACH));
    if (stage === 'settled') await pending;
    entered.mockClear();
    levelB.render.mockClear();
    const replacement = makeMockLevel();
    orchestrator.register(ZOOM_LEVEL.PLANET_APPROACH, { threejs: makeLevelClass(replacement) });
    expect(orchestrator._active).toBeNull();
    expect(orchestrator._activeLevel).toBeNull();
    expect(orchestrator._lastCameraState).toBeNull();
    expect(orchestrator._planetCameraState).toBeNull();
    expect(orchestrator._flight.isFlying).toBe(false);
    expect(mockBackend.setZoomSceneActive).toHaveBeenLastCalledWith(false);
    orchestrator.tick(0.016);
    expect(levelB.render).not.toHaveBeenCalled();
    await pending;
    expect(entered).not.toHaveBeenCalled();
    await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {}, { skipCameraFlight: true });
    expect(replacement.enter).toHaveBeenCalledOnce();
    orchestrator.dispose();
  });

  it('detaches a replaced active renderer even if disposal and backend reset fail', async () => {
    await orchestrator.initialize();
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    const disposal = new Error('Retired disposal failed');
    const reset = new Error('Backend reset failed');
    levelB.dispose.mockImplementationOnce(() => { throw disposal; });
    mockBackend.setZoomSceneActive = vi.fn(() => { throw reset; });
    const replacement = makeMockLevel();
    expect(() => orchestrator.register(ZOOM_LEVEL.SYSTEM, { threejs: makeLevelClass(replacement) }))
      .toThrow(expect.objectContaining({ errors: [disposal, reset] }));
    expect(orchestrator._active).toBeNull();
    orchestrator.tick(0.016);
    expect(levelB.render).not.toHaveBeenCalled();
    mockBackend.setZoomSceneActive.mockImplementation(() => {});
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    expect(replacement.enter).toHaveBeenCalledOnce();
    orchestrator.dispose();
  });

  it('preserves an active view when its replacement registration is invalid', async () => {
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    const active = orchestrator._active;
    expect(() => orchestrator.register(ZOOM_LEVEL.SYSTEM, {})).toThrow(TypeError);
    expect(orchestrator._active).toBe(active);
    orchestrator.tick(0.016);
    expect(levelB.render).toHaveBeenCalledOnce();
    expect(levelB.dispose).not.toHaveBeenCalled();
    orchestrator.dispose();
  });

  it.each(['transition-source', 'navigation-binding', 'backend-activation'])(
    'cancels reentrant replacement from %s before starting a camera flight', async stage => {
      await orchestrator.initialize();
      const replacement = makeMockLevel();
      const replace = () => orchestrator.register(ZOOM_LEVEL.PLANET_APPROACH, {
        threejs: makeLevelClass(replacement),
      });
      if (stage === 'transition-source') levelB.setTransitionSource = vi.fn(replace);
      if (stage === 'navigation-binding') levelB.setNavigationHandlers = vi.fn(replace);
      mockBackend.setZoomSceneActive = vi.fn(active => {
        if (active && stage === 'backend-activation') replace();
      });
      orchestrator.register(ZOOM_LEVEL.PLANET_APPROACH, { threejs: ClassB });
      const flight = vi.spyOn(orchestrator._flight, 'flyTo');
      const entered = vi.fn();
      orchestrator.on('enterLevel', entered);
      await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {});
      expect(flight).not.toHaveBeenCalled();
      expect(entered).not.toHaveBeenCalled();
      expect(orchestrator._active).toBeNull();
      expect(mockBackend.setZoomSceneActive).toHaveBeenLastCalledWith(false);
      expect(levelB.enter).toHaveBeenCalledTimes(stage === 'backend-activation' ? 1 : 0);
      expect(replacement.dispose).not.toHaveBeenCalled();
      mockBackend.setZoomSceneActive.mockImplementation(() => {});
      await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {}, { skipCameraFlight: true });
      expect(replacement.enter).toHaveBeenCalledOnce();
      expect(orchestrator._active).not.toBeNull();
      orchestrator.dispose();
    },
  );

  it('blocks reentrant rendering and retained navigation during active replacement disposal', async () => {
    await orchestrator.initialize();
    let navigation;
    levelB.setNavigationHandlers = vi.fn(handlers => { navigation = handlers; });
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    const selected = vi.fn();
    orchestrator.on('slotClick', selected);
    levelB.dispose.mockImplementationOnce(() => {
      orchestrator.tick(0.016);
      navigation.slotClick({});
    });
    orchestrator.register(ZOOM_LEVEL.SYSTEM, { threejs: makeLevelClass(makeMockLevel()) });
    expect(levelB.render).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
    navigation.slotClick({});
    expect(selected).not.toHaveBeenCalled();
    orchestrator.dispose();
  });

  it.each(['flight', 'camera-state'])('does not restore retired camera data after replacement from a %s callback', async stage => {
    orchestrator._backend = mockBackend;
    orchestrator.register(ZOOM_LEVEL.PLANET_APPROACH, { threejs: ClassB });
    const replace = () => orchestrator.register(ZOOM_LEVEL.PLANET_APPROACH, {
      threejs: makeLevelClass(makeMockLevel()),
    });
    const pending = orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {}, {
      skipCameraFlight: stage !== 'flight', flyDuration: 10000,
      onAtmosphereScale: stage === 'flight' ? replace : null,
    });
    await vi.waitFor(() => expect(orchestrator._activeLevel).toBe(ZOOM_LEVEL.PLANET_APPROACH));
    if (stage === 'camera-state') {
      await pending;
      orchestrator._opts.getCameraState = () => { replace(); return { t: 1 }; };
    }
    levelB.render.mockClear();
    orchestrator.tick(0.016);
    await pending;
    expect(orchestrator._active).toBeNull();
    expect(orchestrator._lastCameraState).toBeNull();
    expect(orchestrator._planetCameraState).toBeNull();
    expect(levelB.render).not.toHaveBeenCalled();
    orchestrator.dispose();
  });

  it.each(['camera', 'exit-event'])('does not republish building depth after replacement from %s', async stage => {
    await orchestrator.initialize();
    const surface = makeMockLevel();
    surface.enterBuilding = vi.fn();
    orchestrator.register(ZOOM_LEVEL.COLONY_SURFACE, { threejs: makeLevelClass(surface) });
    await orchestrator.zoomTo(ZOOM_LEVEL.COLONY_SURFACE, {});
    const replacement = makeMockLevel();
    const replace = () => orchestrator.register(ZOOM_LEVEL.COLONY_SURFACE, { threejs: makeLevelClass(replacement) });
    if (stage === 'camera') surface.enterBuilding.mockImplementationOnce(replace);
    else orchestrator.on('exitLevel', replace);
    const entered = vi.fn();
    orchestrator.on('enterLevel', entered);
    await orchestrator.zoomTo(ZOOM_LEVEL.COLONY_BUILDING, {});
    expect(orchestrator._active).toBeNull();
    expect(orchestrator._activeLevel).toBeNull();
    expect(entered).not.toHaveBeenCalled();
    expect(surface.dispose).toHaveBeenCalledOnce();
    expect(replacement.dispose).not.toHaveBeenCalled();
    orchestrator.dispose();
  });

  it.each(['zoomTo', 'setSceneData'])('discards an initialization replaced during %s without touching the replacement', async method => {
    await orchestrator.initialize();
    let finish;
    levelB.initialize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = orchestrator[method](ZOOM_LEVEL.SYSTEM, {});
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const replacement = makeMockLevel();
    orchestrator.register(ZOOM_LEVEL.SYSTEM, { threejs: makeLevelClass(replacement) });
    const current = orchestrator._registry.resolve(ZOOM_LEVEL.SYSTEM, mockBackend);
    finish();
    const accepted = await pending;
    if (method === 'setSceneData') expect(accepted).toBe(false);
    expect(levelB.enter).not.toHaveBeenCalled();
    expect(levelB.setSceneData).not.toHaveBeenCalled();
    expect(orchestrator._active).toBeNull();
    expect(replacement.dispose).not.toHaveBeenCalled();
    expect(orchestrator._registry.resolve(ZOOM_LEVEL.SYSTEM, mockBackend)).toBe(current);
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    expect(orchestrator._active).toBe(current);
    orchestrator.dispose();
  });

  it('does not publish an entered renderer replaced while its entry was pending', async () => {
    await orchestrator.initialize();
    let finish;
    levelB.enter.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const entered = vi.fn();
    orchestrator.on('enterLevel', entered);
    const pending = orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const replacement = makeMockLevel();
    orchestrator.register(ZOOM_LEVEL.SYSTEM, { threejs: makeLevelClass(replacement) });
    finish();
    await pending;
    expect(orchestrator._active).toBeNull();
    expect(entered).not.toHaveBeenCalled();
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    expect(entered).toHaveBeenCalledOnce();
    expect(replacement.enter).toHaveBeenCalledOnce();
    orchestrator.dispose();
  });

  it('does not enter an incoming renderer replaced while the old view is exiting', async () => {
    await orchestrator.initialize();
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    let finish;
    levelA.exit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const replacement = makeMockLevel();
    orchestrator.register(ZOOM_LEVEL.SYSTEM, { threejs: makeLevelClass(replacement) });
    finish();
    await pending;
    expect(levelB.enter).not.toHaveBeenCalled();
    expect(orchestrator._active).toBeNull();
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    expect(replacement.enter).toHaveBeenCalledOnce();
    orchestrator.dispose();
  });

  it.each(['initialize', 'enter'])('cleans up a retired %s rejection without evicting its replacement', async stage => {
    await orchestrator.initialize();
    let reject;
    levelB[stage].mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const pending = stage === 'initialize'
      ? orchestrator.setSceneData(ZOOM_LEVEL.SYSTEM, {})
      : orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
    const replacement = makeMockLevel();
    orchestrator.register(ZOOM_LEVEL.SYSTEM, { threejs: makeLevelClass(replacement) });
    await orchestrator.setSceneData(ZOOM_LEVEL.SYSTEM, { name: 'Current' });
    const failure = new Error(`Retired ${stage} failed`);
    reject(failure);
    await expect(pending).rejects.toBe(failure);
    expect(levelB.dispose).toHaveBeenCalledTimes(2);
    expect(replacement.dispose).not.toHaveBeenCalled();
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    expect(replacement.initialize).toHaveBeenCalledOnce();
    orchestrator.dispose();
  });

  it.each(['exit-event', 'transition-source', 'navigation-binding', 'backend-activation'])(
    'stops a full transition when %s disposes the orchestrator', async stage => {
      await orchestrator.initialize();
      await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
      const source = vi.fn();
      const navigation = vi.fn();
      levelB.setTransitionSource = source;
      levelB.setNavigationHandlers = navigation;
      orchestrator.register(ZOOM_LEVEL.PLANET_APPROACH, { threejs: makeLevelClass(levelB) });
      if (stage === 'exit-event') orchestrator.on('exitLevel', () => orchestrator.dispose());
      if (stage === 'transition-source') source.mockImplementationOnce(() => orchestrator.dispose());
      if (stage === 'navigation-binding') navigation.mockImplementationOnce(() => orchestrator.dispose());
      mockBackend.setZoomSceneActive = vi.fn(active => {
        if (active && stage === 'backend-activation') orchestrator.dispose();
      });
      const flight = vi.spyOn(orchestrator._flight, 'flyTo');
      await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {});
      expect(flight).not.toHaveBeenCalled();
      expect(orchestrator._disposed).toBe(true);
      expect(orchestrator._active).toBeNull();
      expect(orchestrator._activeLevel).toBeNull();
      expect(orchestrator._transition).toBe(false);
      expect(levelB.dispose).toHaveBeenCalledOnce();
      expect(levelB.enter).toHaveBeenCalledTimes(stage === 'backend-activation' ? 1 : 0);
      if (stage === 'exit-event') expect(source).not.toHaveBeenCalled();
      if (stage === 'exit-event' || stage === 'transition-source') expect(navigation).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['enter', 'camera'], ['enter', 'exit-event'], ['enter', 'enter-event'],
    ['leave', 'camera'], ['leave', 'exit-event'], ['leave', 'enter-event'],
  ])('cleans up shared surface after building %s fails in %s', async (direction, stage) => {
    await orchestrator.initialize();
    const surface = makeMockLevel();
    surface.enterBuilding = vi.fn();
    surface.leaveBuilding = vi.fn();
    orchestrator.register(ZOOM_LEVEL.COLONY_SURFACE, { threejs: makeLevelClass(surface) });
    await orchestrator.zoomTo(ZOOM_LEVEL.COLONY_SURFACE, {});
    if (direction === 'leave') await orchestrator.zoomTo(ZOOM_LEVEL.COLONY_BUILDING, {});
    const failure = new Error(`Building ${direction} ${stage} failed`);
    const fail = () => { throw failure; };
    if (stage === 'camera') surface[direction === 'enter' ? 'enterBuilding' : 'leaveBuilding'].mockImplementationOnce(fail);
    else orchestrator.on(stage === 'exit-event' ? 'exitLevel' : 'enterLevel', fail);
    const target = direction === 'enter' ? ZOOM_LEVEL.COLONY_BUILDING : ZOOM_LEVEL.COLONY_SURFACE;
    let thrown;
    try { await orchestrator.zoomTo(target, direction === 'enter' ? {} : null); } catch (error) { thrown = error; }
    const flatten = error => error instanceof AggregateError ? error.errors.flatMap(flatten) : [error];
    expect(flatten(thrown)).toEqual([failure]);
    expect(surface.dispose).toHaveBeenCalledOnce();
    expect(orchestrator._active).toBeNull();
    expect(orchestrator._activeLevel).toBeNull();
    expect(orchestrator._registry._instances.has(ZOOM_LEVEL.COLONY_SURFACE)).toBe(false);
    expect(orchestrator._transition).toBe(false);
    orchestrator.off('exitLevel', fail);
    orchestrator.off('enterLevel', fail);
    await orchestrator.zoomTo(ZOOM_LEVEL.COLONY_SURFACE, {});
    expect(surface.initialize).toHaveBeenCalledTimes(2);
    orchestrator.dispose();
  });

  it('does not republish building depth when an exit notification disposes the view', async () => {
    await orchestrator.initialize();
    const surface = makeMockLevel();
    surface.enterBuilding = vi.fn();
    orchestrator.register(ZOOM_LEVEL.COLONY_SURFACE, { threejs: makeLevelClass(surface) });
    await orchestrator.zoomTo(ZOOM_LEVEL.COLONY_SURFACE, {});
    const entered = vi.fn();
    orchestrator.on('exitLevel', () => orchestrator.dispose());
    orchestrator.on('enterLevel', entered);
    await orchestrator.zoomTo(ZOOM_LEVEL.COLONY_BUILDING, {});
    expect(entered).not.toHaveBeenCalled();
    expect(orchestrator._activeLevel).toBeNull();
    expect(surface.dispose).toHaveBeenCalledOnce();
  });

  it.each(['left', 'reentered', 'disposed', 'transitioning'])('ignores callbacks from an obsolete navigation binding when %s', async state => {
    let navigation;
    levelA.setNavigationHandlers = handlers => { navigation = handlers; };
    orchestrator.register(ZOOM_LEVEL.GALAXY, { threejs: makeLevelClass(levelA) });
    const selected = vi.fn();
    orchestrator.on('slotClick', selected);
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    const old = navigation;
    let finish;
    let pending;
    if (state === 'transitioning') {
      levelA.exit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      pending = orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    } else if (state === 'disposed') {
      orchestrator.dispose();
    } else {
      await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
      if (state === 'reentered') await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    }
    const zoom = vi.spyOn(orchestrator, 'zoomTo');
    try {
      old.slotClick({ id: 'stale' });
      await old.building({});
      await old.surface({});
      await old.back();
      expect(selected).not.toHaveBeenCalled();
      expect(zoom).not.toHaveBeenCalled();
      if (state === 'reentered') {
        navigation.slotClick({ id: 'current' });
        expect(selected).toHaveBeenCalledExactlyOnceWith({ id: 'current' });
      }
    } finally {
      if (finish) { finish(); await pending; }
      orchestrator.dispose();
    }
  });

  it('keeps current navigation usable when incoming initialization fails before exit', async () => {
    let navigation;
    levelA.setNavigationHandlers = handlers => { navigation = handlers; };
    orchestrator.register(ZOOM_LEVEL.GALAXY, { threejs: makeLevelClass(levelA) });
    const selected = vi.fn();
    orchestrator.on('slotClick', selected);
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    const failure = new Error('Incoming initialization failed');
    levelB.initialize.mockRejectedValueOnce(failure);
    await expect(orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {})).rejects.toBe(failure);
    navigation.slotClick({ id: 'still-active' });
    expect(selected).toHaveBeenCalledExactlyOnceWith({ id: 'still-active' });
    expect(orchestrator._activeLevel).toBe(ZOOM_LEVEL.GALAXY);
    orchestrator.dispose();
  });

  it('reports renderer-triggered building navigation failures through the configured error callback', async () => {
    const onError = vi.fn();
    orchestrator._opts.onError = onError;
    let navigation;
    levelA.setNavigationHandlers = handlers => { navigation = handlers; };
    ClassA = makeLevelClass(levelA);
    orchestrator.register(ZOOM_LEVEL.GALAXY, { threejs: ClassA });
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    await navigation.building({});
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toContain('no entry registered');
    expect(orchestrator._activeLevel).toBe(ZOOM_LEVEL.GALAXY);
    orchestrator.dispose();
  });

  it('retains the rejected navigation promise for callers without an error callback', async () => {
    let navigation;
    levelA.setNavigationHandlers = handlers => { navigation = handlers; };
    orchestrator.register(ZOOM_LEVEL.GALAXY, { threejs: makeLevelClass(levelA) });
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    await expect(navigation.building({})).rejects.toThrow('no entry registered');
    orchestrator.dispose();
  });

  it('preserves both navigation and notification errors when the error callback fails', async () => {
    const notificationError = new Error('Navigation error notification failed');
    orchestrator._opts.onError = () => { throw notificationError; };
    let navigation;
    levelA.setNavigationHandlers = handlers => { navigation = handlers; };
    orchestrator.register(ZOOM_LEVEL.GALAXY, { threejs: makeLevelClass(levelA) });
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    let failure;
    try { await navigation.building({}); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors[0].message).toContain('no entry registered');
    expect(failure.errors[1]).toBe(notificationError);
    orchestrator.dispose();
  });

  it('does not report a late navigation failure after disposal', async () => {
    const onError = vi.fn();
    orchestrator._opts.onError = onError;
    let navigation;
    let reject;
    levelA.setNavigationHandlers = handlers => { navigation = handlers; };
    orchestrator.register(ZOOM_LEVEL.GALAXY, { threejs: makeLevelClass(levelA) });
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    levelB.initialize.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const pending = navigation.back();
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
    orchestrator.dispose();
    reject(new Error('Obsolete navigation failure'));
    await pending;
    expect(onError).not.toHaveBeenCalled();
    expect(orchestrator._active).toBeNull();
  });

  it.each(['zoomTo', 'setSceneData'])('evicts failed initialization through %s and preserves both failure causes', async method => {
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null);
    const active = orchestrator._active;
    const initializationError = new Error('Initialization failed');
    const cleanupError = new Error('Partial cleanup failed');
    levelB.initialize.mockRejectedValueOnce(initializationError);
    levelB.dispose.mockImplementationOnce(() => { throw cleanupError; });
    const operation = () => orchestrator[method](ZOOM_LEVEL.SYSTEM, {});
    await expect(operation()).rejects.toMatchObject({ errors: [initializationError, cleanupError] });
    expect(orchestrator._active).toBe(active);
    expect(levelA.exit).not.toHaveBeenCalled();
    expect(levelB.dispose).toHaveBeenCalledOnce();
    expect(orchestrator._registry._instances.has(ZOOM_LEVEL.SYSTEM)).toBe(false);
    await operation();
    expect(levelB.initialize).toHaveBeenCalledTimes(2);
    orchestrator.dispose();
  });

  it('shares lazy initialization between scene-data updates and transitions', async () => {
    let finish;
    levelB.initialize.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await orchestrator.initialize();
    const data = orchestrator.setSceneData(ZOOM_LEVEL.SYSTEM, { name: 'Preloaded' });
    const entering = orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, { name: 'Entered' });
    expect(levelB.initialize).toHaveBeenCalledOnce();
    finish();
    await Promise.all([data, entering]);
    expect(levelB.enter).toHaveBeenCalledOnce();
    orchestrator.dispose();
  });

  it.each(['enter', 'exit'])('clears stale active state and permits retry after %s failure', async method => {
    await orchestrator.initialize();
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    const failed = method === 'enter' ? levelB : levelA;
    const error = new Error(`${method} failed`);
    failed[method].mockRejectedValueOnce(error);
    mockBackend.setZoomSceneActive = vi.fn();
    await expect(orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {})).rejects.toBe(error);
    expect(orchestrator._active).toBeNull();
    expect(orchestrator._activeLevel).toBeNull();
    expect(mockBackend.setZoomSceneActive).toHaveBeenLastCalledWith(false);
    expect(levelB.dispose).toHaveBeenCalledOnce();
    if (method === 'exit') expect(levelA.dispose).toHaveBeenCalledOnce();
    expect(orchestrator._transition).toBe(false);
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    expect(orchestrator._activeLevel).toBe(ZOOM_LEVEL.SYSTEM);
    orchestrator.dispose();
  });

  it('reports entry, disposal and backend reset failures together', async () => {
    await orchestrator.initialize();
    const errors = [new Error('Entry failed'), new Error('Disposal failed'), new Error('Backend reset failed')];
    levelB.enter.mockRejectedValueOnce(errors[0]);
    levelB.dispose.mockImplementationOnce(() => { throw errors[1]; });
    mockBackend.setZoomSceneActive = vi.fn(() => { throw errors[2]; });
    await expect(orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {})).rejects.toMatchObject({ errors });
    expect(orchestrator._active).toBeNull();
    expect(orchestrator._registry._instances.has(ZOOM_LEVEL.SYSTEM)).toBe(false);
    mockBackend.setZoomSceneActive.mockImplementation(() => {});
    orchestrator.dispose();
  });

  it('does not render an exited view while the incoming entry is pending', async () => {
    await orchestrator.initialize();
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    let finish;
    levelB.enter.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const entering = orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    orchestrator.tick(0.016);
    expect(levelA.render).not.toHaveBeenCalled();
    expect(levelB.render).not.toHaveBeenCalled();
    finish();
    await entering;
    expect(orchestrator._activeLevel).toBe(ZOOM_LEVEL.SYSTEM);
    orchestrator.dispose();
  });

  it('releases a failing same-level re-entry exactly once', async () => {
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    const failure = new Error('Re-entry failed');
    levelA.enter.mockRejectedValueOnce(failure);
    await expect(orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {})).rejects.toBe(failure);
    expect(levelA.dispose).toHaveBeenCalledOnce();
    expect(orchestrator._active).toBeNull();
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    expect(levelA.initialize).toHaveBeenCalledTimes(2);
    orchestrator.dispose();
  });

  it('releases an entered view and flight state when its camera flight fails', async () => {
    await orchestrator.initialize();
    orchestrator.register(ZOOM_LEVEL.PLANET_APPROACH, { webgpu: ClassB, threejs: ClassB });
    const failure = new Error('Camera flight failed');
    vi.spyOn(orchestrator._flight, 'flyTo').mockRejectedValueOnce(failure);
    const cleanup = vi.spyOn(orchestrator._flight, 'dispose');
    await expect(orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {})).rejects.toBe(failure);
    expect(levelB.dispose).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(orchestrator._active).toBeNull();
    expect(orchestrator._lastCameraState).toBeNull();
    await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {}, { skipCameraFlight: true });
    expect(orchestrator._activeLevel).toBe(ZOOM_LEVEL.PLANET_APPROACH);
    orchestrator.dispose();
  });

  it.each(['initialize', 'enter'])('does not reactivate a level disposed during async %s', async (method) => {
    let finish;
    levelA[method].mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    mockBackend.setZoomSceneActive = vi.fn();
    orchestrator._backend = mockBackend;
    const entered = vi.fn();
    orchestrator.on('enterLevel', entered);
    const pending = orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    orchestrator.dispose();
    finish();
    await pending;
    expect(entered).not.toHaveBeenCalled();
    expect(mockBackend.setZoomSceneActive).not.toHaveBeenCalledWith(true);
    expect(orchestrator._active).toBeNull();
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, null);
    expect(levelB.enter).not.toHaveBeenCalled();
  });

  it('shares a rejected initialization and disposes the failed instance only once', async () => {
    let reject;
    const failure = new Error('Shared initialization failed');
    levelB.initialize.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    await orchestrator.initialize();
    const data = orchestrator.setSceneData(ZOOM_LEVEL.SYSTEM, {});
    const entering = orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    const results = Promise.allSettled([data, entering]);
    reject(failure);
    expect(await results).toEqual([
      { status: 'rejected', reason: failure }, { status: 'rejected', reason: failure },
    ]);
    expect(levelB.initialize).toHaveBeenCalledOnce();
    expect(levelB.dispose).toHaveBeenCalledOnce();
    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    expect(levelB.initialize).toHaveBeenCalledTimes(2);
    orchestrator.dispose();
  });

  it('cleans up late resources when a pending initialization fails after teardown', async () => {
    let reject;
    let lateResource = null;
    const destroy = vi.fn();
    levelB.dispose.mockImplementation(() => {
      lateResource?.destroy();
      lateResource = null;
    });
    levelB.initialize.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const pending = orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, {});
    orchestrator.dispose();
    lateResource = { destroy };
    const failure = new Error('Late initialization failure');
    reject(failure);
    await expect(pending).rejects.toBe(failure);
    expect(levelB.dispose).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledOnce();
    expect(lateResource).toBeNull();
    expect(orchestrator._active).toBeNull();
  });
});

describe('SeamlessZoomOrchestrator — shared renderer frame loop', () => {
  it('reports every failing event listener after notifying the remaining listeners', () => {
    const orchestrator = new SeamlessZoomOrchestrator(null);
    const first = new Error('First listener failed');
    const second = new Error('Second listener failed');
    const healthy = vi.fn();
    orchestrator.on('slotClick', () => { throw first; });
    orchestrator.on('slotClick', healthy);
    orchestrator.on('slotClick', () => { throw second; });
    expect(() => orchestrator._emit('slotClick', { id: 7 })).toThrow(AggregateError);
    expect(healthy).toHaveBeenCalledExactlyOnceWith({ id: 7 });
    try { orchestrator._emit('slotClick', {}); } catch (error) {
      expect(error.errors).toEqual([first, second]);
    }
    orchestrator.dispose();
  });

  it('does not skip listeners when one removes itself during notification', () => {
    const orchestrator = new SeamlessZoomOrchestrator(null);
    const first = () => orchestrator.off('slotClick', first);
    const second = vi.fn();
    orchestrator.on('slotClick', first);
    orchestrator.on('slotClick', second);
    orchestrator._emit('slotClick', {});
    expect(second).toHaveBeenCalledOnce();
    orchestrator.dispose();
  });

  it('cleans up an entered view when an enter-level subscriber fails and permits retry', async () => {
    const level = makeMockLevel();
    const backend = makeMockBackend();
    backend.setZoomSceneActive = vi.fn();
    const orchestrator = new SeamlessZoomOrchestrator(null, { _backend: backend });
    orchestrator._backend = backend;
    orchestrator.register(0, { webgpu: makeLevelClass(level) });
    const failure = new Error('View notification failed');
    const listener = () => { throw failure; };
    const healthy = vi.fn();
    orchestrator.on('enterLevel', listener);
    orchestrator.on('enterLevel', healthy);
    await expect(orchestrator.zoomTo(0, {})).rejects.toMatchObject({ errors: [failure] });
    expect(healthy).toHaveBeenCalledOnce();
    expect(level.dispose).toHaveBeenCalledOnce();
    expect(orchestrator._active).toBeNull();
    expect(backend.setZoomSceneActive).toHaveBeenLastCalledWith(false);
    orchestrator.off('enterLevel', listener);
    await orchestrator.zoomTo(0, {});
    expect(orchestrator._activeLevel).toBe(0);
    orchestrator.dispose();
  });

  it.each([false, true])('stops its own RAF and reports rendering failures with cleanup failure=%s', async failCleanup => {
    let frame;
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 42; });
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    const backend = makeMockBackend();
    const level = makeMockLevel();
    const renderingFailure = new Error('Owned loop rendering failed');
    const cleanupFailure = new Error('View cleanup failed');
    level.render.mockImplementation(() => { throw renderingFailure; });
    if (failCleanup) level.dispose.mockImplementation(() => { throw cleanupFailure; });
    const orchestrator = new SeamlessZoomOrchestrator(null, { _backend: backend });
    orchestrator.register(0, { webgpu: makeLevelClass(level) });
    try {
      await orchestrator.initialize();
      await orchestrator.zoomTo(0, {});
      let thrown;
      try { frame(16); } catch (error) { thrown = error; }
      const flatten = error => error instanceof AggregateError ? error.errors.flatMap(flatten) : [error];
      expect(flatten(thrown)).toEqual(failCleanup ? [renderingFailure, cleanupFailure] : [renderingFailure]);
      expect(level.dispose).toHaveBeenCalledOnce();
      expect(orchestrator._disposed).toBe(true);
      expect(orchestrator._rafId).toBe(0);
      expect(raf).toHaveBeenCalledOnce();
      frame(32);
      expect(raf).toHaveBeenCalledOnce();
    } finally { orchestrator.dispose(); raf.mockRestore(); cancel.mockRestore(); }
  });

  it('does not schedule another RAF when a rendered view disposes the orchestrator', async () => {
    let frame;
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 42; });
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    const orchestrator = new SeamlessZoomOrchestrator(null, { _backend: makeMockBackend() });
    const level = makeMockLevel();
    level.render.mockImplementation(() => orchestrator.dispose());
    orchestrator.register(0, { webgpu: makeLevelClass(level) });
    try {
      await orchestrator.initialize();
      await orchestrator.zoomTo(0, {});
      frame(16);
      expect(raf).toHaveBeenCalledOnce();
      expect(orchestrator._rafId).toBe(0);
    } finally { orchestrator.dispose(); raf.mockRestore(); cancel.mockRestore(); }
  });

  it('does not retain or attach a borrowed backend when its init finishes after disposal', async () => {
    let finish;
    const backend = { init: vi.fn(() => new Promise(resolve => { finish = resolve; })),
      addFrameHook: vi.fn(), dispose: vi.fn() };
    const orchestrator = new SeamlessZoomOrchestrator(null, { backend });
    const pending = orchestrator.initialize();
    orchestrator.dispose();
    finish();
    await pending;
    expect(backend.addFrameHook).not.toHaveBeenCalled();
    expect(backend.dispose).not.toHaveBeenCalled();
    expect(orchestrator._backend).toBeNull();
    expect(orchestrator._opts).toEqual({});
  });

  it('permits retry after shared backend init fails without disposing the borrowed backend', async () => {
    const failure = new Error('Shared init failed');
    const remove = vi.fn();
    const backend = { init: vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined),
      addFrameHook: vi.fn(() => remove), dispose: vi.fn() };
    const orchestrator = new SeamlessZoomOrchestrator(null, { backend });
    await expect(orchestrator.initialize()).rejects.toBe(failure);
    await orchestrator.initialize();
    expect(backend.init).toHaveBeenCalledTimes(2);
    expect(backend.addFrameHook).toHaveBeenCalledOnce();
    orchestrator.dispose();
    expect(remove).toHaveBeenCalledOnce();
    expect(backend.dispose).not.toHaveBeenCalled();
  });

  it('surfaces late owned-backend disposal errors without retaining the backend', async () => {
    let finish;
    const factory = vi.spyOn(RendererFactory, 'create').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const failure = new Error('Late backend disposal failed');
    const backend = { dispose: vi.fn(() => { throw failure; }) };
    const orchestrator = new SeamlessZoomOrchestrator(null);
    try {
      const pending = orchestrator.initialize();
      orchestrator.dispose();
      finish(backend);
      await expect(pending).rejects.toBe(failure);
      expect(backend.dispose).toHaveBeenCalledOnce();
      expect(orchestrator._backend).toBeNull();
      expect(orchestrator._running).toBe(false);
    } finally { orchestrator.dispose(); factory.mockRestore(); }
  });

  it('shares backend initialization and installs only one hook across repeated calls', async () => {
    let finish;
    const remove = vi.fn();
    const backend = { init: vi.fn(() => new Promise(resolve => { finish = resolve; })),
      addFrameHook: vi.fn(() => remove), dispose: vi.fn() };
    const orchestrator = new SeamlessZoomOrchestrator(null, { backend });
    const first = orchestrator.initialize();
    const second = orchestrator.initialize();
    expect(backend.init).toHaveBeenCalledOnce();
    finish();
    await Promise.all([first, second]);
    await orchestrator.initialize();
    expect(backend.addFrameHook).toHaveBeenCalledOnce();
    orchestrator.dispose();
    expect(remove).toHaveBeenCalledOnce();
    expect(backend.dispose).not.toHaveBeenCalled();
    expect(orchestrator._backend).toBeNull();
  });

  it('disposes a late factory-owned backend without restarting RAF after teardown', async () => {
    let finish;
    const factory = vi.spyOn(RendererFactory, 'create').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    const backend = { dispose: vi.fn() };
    const orchestrator = new SeamlessZoomOrchestrator(null);
    try {
      const pending = orchestrator.initialize();
      orchestrator.dispose();
      finish(backend);
      await pending;
      expect(backend.dispose).toHaveBeenCalledOnce();
      expect(orchestrator._backend).toBeNull();
      expect(orchestrator._running).toBe(false);
      expect(raf).not.toHaveBeenCalled();
    } finally { orchestrator.dispose(); factory.mockRestore(); raf.mockRestore(); }
  });

  it('releases factory-owned backends on normal disposal but not injected ones', async () => {
    const backend = { dispose: vi.fn(), setZoomSceneActive: vi.fn() };
    const factory = vi.spyOn(RendererFactory, 'create').mockResolvedValueOnce(backend);
    const orchestrator = new SeamlessZoomOrchestrator(null);
    try {
      await orchestrator.initialize();
      orchestrator.dispose();
      expect(backend.dispose).toHaveBeenCalledOnce();
      expect(orchestrator._canvas).toBeNull();
      expect(orchestrator._backend).toBeNull();
      expect(orchestrator._opts).toEqual({});
      expect(orchestrator._activeLevel).toBeNull();
    } finally { orchestrator.dispose(); factory.mockRestore(); }
  });

  it('does not create a second renderer when a shared backend is required', async () => {
    const orchestrator = new SeamlessZoomOrchestrator(null, { requireSharedBackend: true });

    await expect(orchestrator.initialize()).rejects.toThrow(
      'requires the shared Galaxy WebGPU renderer',
    );
    expect(orchestrator._backend).toBeNull();
  });

  it('drives zoom levels from the shared renderer hook and removes it on dispose', async () => {
    const level = makeMockLevel();
    const LevelClass = makeLevelClass(level);
    const removeFrameHook = vi.fn();
    let frameHook;
    const backend = {
      backendType: 'webgpu',
      getCapabilities: () => ({ webgpu: true }),
      init: vi.fn().mockResolvedValue(undefined),
      addFrameHook: vi.fn((hook) => {
        frameHook = hook;
        return removeFrameHook;
      }),
    };
    const orchestrator = new SeamlessZoomOrchestrator(null, { backend });
    orchestrator.register(ZOOM_LEVEL.GALAXY, { webgpu: LevelClass });

    await orchestrator.initialize();
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null);
    frameHook(1 / 60);
    orchestrator.dispose();

    expect(backend.init).toHaveBeenCalledOnce();
    expect(backend.addFrameHook).toHaveBeenCalledOnce();
    expect(level.render).toHaveBeenCalledWith(1 / 60, expect.objectContaining({ position: expect.any(Object) }));
    expect(removeFrameHook).toHaveBeenCalledOnce();
  });

  it('finishes orchestrator cleanup and reports renderer disposal failures', async () => {
    const brokenLevel = makeMockLevel();
    brokenLevel.dispose.mockImplementation(() => { throw new Error('level dispose failed'); });
    const LevelClass = makeLevelClass(brokenLevel);
    const removeFrameHook = vi.fn();
    const backend = {
      backendType: 'webgpu',
      getCapabilities: () => ({ webgpu: true }),
      addFrameHook: () => removeFrameHook,
      setZoomSceneActive: vi.fn(),
    };
    const orchestrator = new SeamlessZoomOrchestrator(null, { backend });
    orchestrator.register(ZOOM_LEVEL.GALAXY, { webgpu: LevelClass });
    await orchestrator.initialize();
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null);

    expect(() => orchestrator.dispose()).toThrow(AggregateError);
    expect(removeFrameHook).toHaveBeenCalledOnce();
    expect(backend.setZoomSceneActive).toHaveBeenCalledWith(false);
    expect(orchestrator._active).toBeNull();
    expect(orchestrator._listeners.size).toBe(0);
    expect(() => orchestrator.dispose()).not.toThrow();
  });
});

describe('SeamlessZoomOrchestrator — setSceneData()', () => {
  it('lazily initialises target level and forwards scene data', async () => {
    const backend = makeMockBackend('webgl2');
    const orch = new SeamlessZoomOrchestrator(null, { _backend: backend });

    const level = makeMockLevel();
    const LevelClass = makeLevelClass(level);
    orch.register(ZOOM_LEVEL.GALAXY, { webgpu: LevelClass, threejs: LevelClass });

    const payload = { stars: [{ id: 1 }] };
    const ok = await orch.setSceneData(ZOOM_LEVEL.GALAXY, payload);

    expect(ok).toBe(true);
    expect(level.initialize).toHaveBeenCalledTimes(1);
    expect(level.setSceneData).toHaveBeenCalledTimes(1);
    expect(level.setSceneData.mock.calls[0][0]).toBe(payload);
  });
});

// ---------------------------------------------------------------------------
// SeamlessZoomOrchestrator — double-zoomTo guard
// ---------------------------------------------------------------------------

describe('SeamlessZoomOrchestrator — double-zoomTo guard', () => {
  it('ignores a second zoomTo() call while a transition is in progress', async () => {
    let resolveEnter;

    // A latch that signals once enter() has actually been invoked so we can
    // safely call resolveEnter() without it being undefined.
    let enterInvoked;
    const enterInvokedPromise = new Promise(r => { enterInvoked = r; });

    const slowLevel = {
      _initialised: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      setSceneData: vi.fn(),
      render: vi.fn(),
      enter: vi.fn().mockImplementation(() => new Promise(r => {
        resolveEnter = r;
        enterInvoked();   // signal that enter() has been called
      })),
      exit:    vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    };
    const SlowClass = makeLevelClass(slowLevel);

    const mockBackend = makeMockBackend('webgl2');
    const orch = new SeamlessZoomOrchestrator(null, { _backend: mockBackend });
    orch.register(ZOOM_LEVEL.GALAXY, { webgpu: SlowClass, threejs: SlowClass });

    // Start a transition — it will hang waiting for resolveEnter.
    const p1 = orch.zoomTo(ZOOM_LEVEL.GALAXY, { first: true });

    // Attempt a second zoomTo() while the first is still running.
    const p2 = orch.zoomTo(ZOOM_LEVEL.GALAXY, { second: true });

    // Wait until enter() has actually been called before resolving it.
    await enterInvokedPromise;
    resolveEnter();
    await p1;
    await p2;

    // enter() must have been called exactly once (the guard blocked p2).
    expect(slowLevel.enter.mock.calls.length).toBe(1);
    expect(slowLevel.enter.mock.calls[0][1]).toEqual({ first: true });
  });
});

// ---------------------------------------------------------------------------
// SeamlessZoomOrchestrator — PLANET_APPROACH triggers CameraFlightPath.flyTo()
// ---------------------------------------------------------------------------

describe('SeamlessZoomOrchestrator — PLANET_APPROACH triggers flyTo()', () => {
  it('calls CameraFlightPath.flyTo() only for PLANET_APPROACH', async () => {
    const mockBackend = makeMockBackend('webgl2');
    const orch = new SeamlessZoomOrchestrator(null, { _backend: mockBackend });

    const normalLevel = makeMockLevel();
    const planetLevel = makeMockLevel();
    const NormalClass = makeLevelClass(normalLevel);
    const PlanetClass = makeLevelClass(planetLevel);

    orch.register(ZOOM_LEVEL.GALAXY,          { webgpu: NormalClass, threejs: NormalClass });
    orch.register(ZOOM_LEVEL.PLANET_APPROACH, { webgpu: PlanetClass, threejs: PlanetClass });

    // Spy on the internal flight object.
    const flyToSpy = vi.spyOn(orch._flight, 'flyTo').mockResolvedValue(undefined);

    // Transitioning to GALAXY should NOT call flyTo().
    await orch.zoomTo(ZOOM_LEVEL.GALAXY, null);
    expect(flyToSpy).not.toHaveBeenCalled();

    // Transitioning to PLANET_APPROACH should call flyTo().
    await orch.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, { planet: { id: 7 } });
    expect(flyToSpy).toHaveBeenCalledOnce();
    expect(flyToSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        target: { x: 0, y: 0, z: 0 },
        colliders: [expect.objectContaining({ type: 'sphere', radius: 1 })],
        collisionRadius: 0.25,
      })
    );
  });

  it('uses the persistent body extent for approach collision and default small-body shapes', async () => {
    const mockBackend = makeMockBackend('webgl2');
    const orch = new SeamlessZoomOrchestrator(null, { _backend: mockBackend });
    const planetLevel = makeMockLevel();
    const PlanetClass = makeLevelClass(planetLevel);
    orch.register(ZOOM_LEVEL.PLANET_APPROACH, { webgpu: PlanetClass, threejs: PlanetClass });
    const flyToSpy = vi.spyOn(orch._flight, 'flyTo').mockResolvedValue(undefined);

    await orch.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {
      planet: { id: 8, payload_json: JSON.stringify({ shape: { version: 1, axes: [1.5, 1, 0.9], deformation: 0.2 } }) },
    });
    expect(flyToSpy.mock.calls[0][3].colliders[0].radius).toBeCloseTo(1.8);

    await orch.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, { planet: { id: 9, body_type: 'asteroid' } });
    expect(flyToSpy.mock.calls[1][3].colliders[0].radius).toBeCloseTo(1.769);

    await orch.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {
      planet: { id: 12, solid: {
        version: 1, blend: 0.18,
        lobes: [{ center: [1.5, 0, 0], axes: [0.85, 0.7, 0.65] }], cuts: [],
      } },
    });
    expect(flyToSpy.mock.calls[2][3].colliders[0].radius).toBeCloseTo(2.53);
  });

  it('rejects unsupported persisted shapes instead of silently using a sphere', async () => {
    const mockBackend = makeMockBackend('webgl2');
    const orch = new SeamlessZoomOrchestrator(null, { _backend: mockBackend });
    const planetLevel = makeMockLevel();
    const PlanetClass = makeLevelClass(planetLevel);
    orch.register(ZOOM_LEVEL.PLANET_APPROACH, { webgpu: PlanetClass, threejs: PlanetClass });

    await expect(orch.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {
      planet: { id: 10, shape: { version: 2, axes: [1, 1, 1], deformation: 0 } },
    })).rejects.toThrow('invalid persistent body shape');
  });
});

// ---------------------------------------------------------------------------
// CameraFlightPath — Promise resolves when t reaches 1
// ---------------------------------------------------------------------------

describe('CameraFlightPath — atomic flight setup', () => {
  const invalidCases = [
    ['collider', {}, {}, 100, { colliders: [{ type: 'sphere', radius: -1, center: { x: 0, y: 0, z: 0 } }] }],
    ['clearance', {}, {}, 100, { collisionRadius: -1 }],
    ['target', {}, {}, 100, { target: { x: NaN, y: 0, z: 0 } }],
    ['start', { x: Infinity, y: 0, z: 0 }, {}, 100, {}],
    ['NaN coordinate', { x: NaN }, {}, 100, {}],
    ['array coordinate', {}, [0, Infinity, 0], 100, {}],
    ['destination', {}, { x: 0, y: Infinity, z: 0 }, 100, {}],
    ['duration', {}, {}, Infinity, {}],
    ['NaN duration', {}, {}, NaN, {}],
    ['blur', {}, {}, 100, { starBlur: Infinity }],
    ['control-point overflow', { x: -1e308 }, { x: 1e308 }, 100, {}],
    ['options', {}, {}, 100, null],
  ];
  for (const method of ['flyTo', 'flyToBuilding']) {
    it.each(invalidCases)(`${method} preserves a pending flight on invalid %s`, async (_label, from, to, duration, opts) => {
      const flight = new CameraFlightPath();
      const control = new CameraFlightPath();
      const options = { target: { x: 1, y: 2, z: 3 }, onAtmosphereScale: vi.fn() };
      const first = flight.flyTo({ z: 100 }, { z: 15 }, 100, options);
      const expected = control.flyTo({ z: 100 }, { z: 15 }, 100, { target: options.target });
      flight.tick(0.016);
      control.tick(0.016);
      const progress = flight.t;
      expect(() => flight[method](from, to, duration, opts)).toThrow(TypeError);
      expect(flight.t).toBe(progress);
      expect(flight._targetRef).toBe(options.target);
      expect(flight._onAtmosphereScale).toBe(options.onAtmosphereScale);
      expect(flight.tick(1)).toEqual(control.tick(1));
      await Promise.all([first, expected]);
    });

    it(`${method} leaves a fresh flight idle when its target provider throws`, () => {
      const flight = new CameraFlightPath();
      const failure = new Error('Target setup failed');
      expect(() => flight[method]({}, {}, 100, { target: () => { throw failure; } })).toThrow(failure);
      expect(flight.isFlying).toBe(false);
      expect(flight._targetRef).toBeNull();
      expect(flight.tick(0.016)).toBeNull();
    });

    it(`${method} respects disposal from the setup target provider`, async () => {
      const flight = new CameraFlightPath();
      const pending = flight[method]({}, {}, 100, {
        target: () => { flight.dispose(); return { x: 0, y: 0, z: 0 }; },
      });
      expect(flight.isFlying).toBe(false);
      expect(flight._targetRef).toBeNull();
      await pending;
    });

    it(`${method} preserves a pending flight when a new target provider throws`, async () => {
      const flight = new CameraFlightPath();
      const pending = flight.flyTo({ z: 100 }, { z: 15 }, 100);
      const failure = new Error('Rejected target');
      flight.tick(0.016);
      const progress = flight.t;
      expect(() => flight[method]({}, {}, 100, { target: () => { throw failure; } })).toThrow(failure);
      expect(flight.t).toBe(progress);
      expect(flight.tick(1)).toMatchObject({ t: 1, position: { x: 0, y: 0, z: 15 } });
      await pending;
    });

    it(`${method} preserves a newer flight started by its target provider`, async () => {
      const flight = new CameraFlightPath();
      let inner;
      const outer = flight[method]({}, {}, 100, {
        target: () => {
          inner = flight.flyToBuilding({ z: 20 }, { z: 5 }, 100);
          return { x: 0, y: 0, z: 0 };
        },
      });
      await outer;
      expect(flight.tick(1)).toMatchObject({ t: 1, position: { x: 0, y: 0, z: 5 } });
      await inner;
    });

    it(`${method} keeps options and collider snapshots while a target object stays live`, async () => {
      const flight = new CameraFlightPath();
      const target = { x: 0, y: 0, z: 0 };
      const opts = { target, starBlur: 0.4,
        colliders: [{ type: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 2 }] };
      const pending = flight[method]({ z: 10 }, { z: -10 }, 100, opts);
      opts.starBlur = Infinity;
      opts.colliders[0].radius = 100;
      opts.target = { x: Infinity };
      target.x = 2;
      const state = flight.tick(1);
      expect(state.target).toEqual({ x: 2, y: 0, z: 0 });
      expect(state.position.z).toBeGreaterThan(2);
      await pending;
    });
  }
});

describe('CameraFlightPath — callback failures', () => {
  it.each(['atmosphere', 'blur', 'target'])('rejects a pending flight on %s failure, including its final frame', async stage => {
    for (const dt of [0.016, 1]) {
      const flight = new CameraFlightPath();
      const failure = new Error(`${stage} failed`);
      let fail = false;
      const callback = () => { if (fail) throw failure; };
      const pending = flight.flyTo({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 15 }, 100, {
        target: () => {
          if (stage === 'target') callback();
          return { x: 0, y: 0, z: 0 };
        },
        onAtmosphereScale: stage === 'atmosphere' ? callback : null,
        onStarBlur: stage === 'blur' ? callback : null,
      });
      const rejected = expect(pending).rejects.toBe(failure);
      fail = true;
      expect(() => flight.tick(dt)).toThrow(failure);
      await rejected;
      expect(flight.isFlying).toBe(false);
      expect(flight._targetRef).toBeNull();
      expect(flight._onAtmosphereScale).toBeNull();
      expect(flight._onStarBlur).toBeNull();
      expect(flight.tick(0.016)).toBeNull();
      const retry = flight.flyTo({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 15 }, 100);
      flight.tick(1);
      await retry;
    }
  });

  it('does not carry effect callbacks into a subsequent flight', async () => {
    const flight = new CameraFlightPath();
    const effect = vi.fn();
    const first = flight.flyTo({}, {}, 100, { onAtmosphereScale: effect, onStarBlur: effect });
    flight.tick(1);
    await first;
    effect.mockClear();
    const second = flight.flyTo({}, {}, 100);
    flight.tick(1);
    await second;
    expect(effect).not.toHaveBeenCalled();
  });

  it('stops effects when an earlier effect disposes the flight', async () => {
    const flight = new CameraFlightPath();
    const blur = vi.fn();
    const pending = flight.flyTo({}, {}, 100, {
      onAtmosphereScale: () => flight.dispose(), onStarBlur: blur,
    });
    expect(flight.tick(0.016)).toBeNull();
    await pending;
    expect(blur).not.toHaveBeenCalled();
  });

  it('does not apply an old frame or its blur callback to a reentrant replacement flight', async () => {
    const flight = new CameraFlightPath();
    let replacement;
    const blur = vi.fn();
    const first = flight.flyTo({}, {}, 100, {
      onAtmosphereScale: () => { replacement = flight.flyTo({}, {}, 100); },
      onStarBlur: blur,
    });
    const rejected = expect(first).rejects.toThrow('new flyTo started');
    expect(flight.tick(0.016)).toBeNull();
    await rejected;
    expect(blur).not.toHaveBeenCalled();
    expect(flight.isFlying).toBe(true);
    flight.tick(1);
    await replacement;
  });

  it('releases effect and target references after successful completion', async () => {
    const flight = new CameraFlightPath();
    const pending = flight.flyTo({}, {}, 100, {
      target: () => ({ x: 1, y: 2, z: 3 }), onAtmosphereScale: vi.fn(), onStarBlur: vi.fn(),
    });
    expect(flight.tick(1)).toMatchObject({ t: 1, target: { x: 1, y: 2, z: 3 } });
    await pending;
    expect(flight._targetRef).toBeNull();
    expect(flight._onAtmosphereScale).toBeNull();
    expect(flight._onStarBlur).toBeNull();
    expect(flight._opts).toEqual({});
    expect(flight._colliders).toEqual([]);
  });
});

describe('CameraFlightPath — flyTo() resolves when complete', () => {
  it('resolves the returned Promise after the full duration', async () => {
    const flight = new CameraFlightPath();
    const from = { x: 0, y: 0, z: 100 };
    const to   = { x: 0, y: 5, z: 15 };

    const done = vi.fn();
    const p = flight.flyTo(from, to, 100).then(done);

    // Drive the clock forward past the full duration.
    let remaining = 200; // ms — more than durationMs=100
    while (remaining > 0) {
      const dt = Math.min(16, remaining);
      flight.tick(dt);
      remaining -= dt;
    }

    await p;
    expect(done).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CameraFlightPath — tick() returns t progressing 0 → 1
// ---------------------------------------------------------------------------

describe('CameraFlightPath — tick() t progression', () => {
  it('starts at t=0 and ends at t=1', async () => {
    const flight = new CameraFlightPath();
    // Use 500ms duration and 16ms ticks (both > 1 so tick() treats them as ms).
    flight.flyTo({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 10 }, 500).catch(() => {});

    // First tick — flight should be in progress, t > 0 but < 1.
    const s0 = flight.tick(16);
    expect(s0).not.toBeNull();
    expect(s0.t).toBeGreaterThanOrEqual(0);
    expect(s0.t).toBeLessThanOrEqual(1);

    // Drive well past the full duration.
    let tLast = 0;
    for (let i = 0; i < 50; i++) {
      const s = flight.tick(16);
      if (s) tLast = s.t;
    }
    expect(tLast).toBeCloseTo(1, 2);
  });

  it('returns null when idle (no flight active)', () => {
    const flight = new CameraFlightPath();
    expect(flight.tick(16)).toBeNull();
  });

  it('tracks a moving target object independently of the flight destination', () => {
    const flight = new CameraFlightPath();
    const target = { position: { x: 1, y: 2, z: 3 } };
    flight.flyTo({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 10 }, 500, { target }).catch(() => {});
    expect(flight.tick(32).target).toEqual({ x: 1, y: 2, z: 3 });
    target.position.x = 8;
    expect(flight.tick(32).target).toEqual({ x: 8, y: 2, z: 3 });
  });

  it('sweeps the camera clearance sphere against body and box colliders', () => {
    const flight = new CameraFlightPath();
    flight.flyTo({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -10 }, 100, {
      target: { x: 0, y: 0, z: 0 },
      collisionRadius: 0.5,
      colliders: [{ type: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 2 }],
    }).catch(() => {});
    const sphereHit = flight.tick(100);
    expect(Math.hypot(sphereHit.position.x, sphereHit.position.y, sphereHit.position.z)).toBeGreaterThanOrEqual(2.49);

    flight.flyTo({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -10 }, 100, {
      target: { x: 0, y: 0, z: 0 },
      collisionRadius: 0.5,
      colliders: [{ type: 'box', min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }],
    }).catch(() => {});
    const boxHit = flight.tick(100);
    expect(boxHit.position.z).toBeGreaterThanOrEqual(1.49);
  });

  it.each(['flyTo', 'flyToBuilding'])('blocks %s destinations inside the clearance sphere', async (method) => {
    const flight = new CameraFlightPath();
    const done = flight[method]({ x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: 1 }, 100, {
      collisionRadius: 0.5,
      colliders: [{ type: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 2 }],
    });
    const state = flight.tick(100);
    expect(state.position).toEqual({ x: 0, y: 0, z: 2.502 });
    await done;
  });

  it('prevents slow approaches from entering a body over successive frames', async () => {
    const flight = new CameraFlightPath();
    const done = flight.flyToBuilding({ x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: 1 }, 1000, {
      collisionRadius: 0.5,
      colliders: [{ type: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 2 }],
    });
    let previous = [0, 0, 4];
    for (let frame = 0; frame < 100; frame++) {
      const state = flight.tick(10);
      const current = Object.values(state.position);
      const direction = current.map((value, axis) => value - previous[axis]);
      const squaredLength = direction.reduce((sum, value) => sum + value * value, 0);
      const projection = squaredLength ? Math.max(0, Math.min(1,
        -previous.reduce((sum, value, axis) => sum + value * direction[axis], 0) / squaredLength)) : 0;
      const closest = previous.map((value, axis) => value + projection * direction[axis]);
      expect(Math.hypot(...closest)).toBeGreaterThanOrEqual(2.5 - 1e-9);
      previous = current;
    }
    await done;
  });

  it('can reverse a blocked flight back to its start without entering the body', async () => {
    const flight = new CameraFlightPath();
    const done = flight.flyToBuilding({ x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: 1 }, 1000, {
      collisionRadius: 0.5,
      colliders: [{ type: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 2 }],
    });
    flight.tick(800);
    flight.abort();
    let state;
    for (let frame = 0; frame < 100 && flight.isFlying; frame++) {
      state = flight.tick(16);
      expect(Math.hypot(...Object.values(state.position))).toBeGreaterThanOrEqual(2.5);
    }
    expect(state.position).toEqual({ x: 0, y: 0, z: 4 });
    expect(flight.isFlying).toBe(false);
    await done;
  });

  it.each([false, true])('stops at the nearest collider independently of order (reversed: %s)', async (reverse) => {
    const flight = new CameraFlightPath();
    const colliders = [
      { type: 'sphere', center: { x: 0, y: 0, z: 3 }, radius: 1 },
      { type: 'box', min: { x: -1, y: -1, z: 5.5 }, max: { x: 1, y: 1, z: 6.5 } },
    ];
    const done = flight.flyTo({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -10 }, 100, {
      colliders: reverse ? colliders.reverse() : colliders,
    });
    expect(flight.tick(100).position.z).toBeCloseTo(6.752);
    await done;
  });

  it.each([
    { type: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 2 },
    { type: 'box', min: { x: -2, y: -2, z: -2 }, max: { x: 2, y: 2, z: 2 } },
  ])('allows escape but not crossing from an initially overlapping $type', async (collider) => {
    const flight = new CameraFlightPath();
    for (const [destination, expected] of [[-5, 1], [5, 5]]) {
      const done = flight.flyToBuilding({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: destination }, 100, {
        colliders: [collider],
      });
      expect(flight.tick(100).position.z).toBe(expected);
      await done;
    }
  });

  it('allows movement away from a sphere boundary and unobstructed tangential paths', async () => {
    for (const [from, to] of [
      [{ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 5 }],
      [{ x: -4, y: 0, z: 2 }, { x: 4, y: 0, z: 2 }],
    ]) {
      const flight = new CameraFlightPath();
      const done = flight.flyToBuilding(from, to, 100, {
        collisionRadius: 0,
        colliders: [{ type: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 2 }],
      });
      expect(flight.tick(100).position).toEqual(to);
      await done;
    }
  });
});

// ---------------------------------------------------------------------------
// CameraFlightPath — implements the camera-driver interface
// ---------------------------------------------------------------------------

describe('CameraFlightPath — driver interface', () => {
  it.each([NaN, Infinity, -Infinity, -1, undefined, null, '16'])('rejects invalid frame time %s without leaving a pending flight', async dt => {
    const flight = new CameraFlightPath();
    const pending = flight.flyTo({ z: 100 }, { z: 15 }, 100);
    const rejected = expect(pending).rejects.toThrow(TypeError);
    expect(() => flight.tick(dt)).toThrow(TypeError);
    await rejected;
    expect(flight.isFlying).toBe(false);
    expect(flight._targetRef).toBeNull();
    expect(flight.tick(0.016)).toBeNull();
  });

  it('accepts a zero-length frame without advancing or completing the flight', async () => {
    const flight = new CameraFlightPath();
    const pending = flight.flyTo({ z: 100 }, { z: 15 }, 100);
    expect(flight.tick(0)).toMatchObject({ t: 0, position: { x: 0, y: 0, z: 100 } });
    expect(flight.isFlying).toBe(true);
    flight.tick(1);
    await pending;
  });

  for (const duration of [16, 100]) {
    it.each(['position', 'target', 'controls', 'lookAt', 'context'])(
      `rejects driver %s failures before committing success (duration ${duration})`, async stage => {
        const flight = new CameraFlightPath();
        const failure = new Error(`${stage} driver failed`);
        const fail = () => { throw failure; };
        const camera = { position: { x: 0, y: 0, z: 100 }, lookAt: vi.fn() };
        const controls = { target: { set: vi.fn() }, update: vi.fn() };
        const ctx = { camera, controls };
        if (stage === 'position') Object.defineProperty(camera.position, 'x', { set: fail });
        if (stage === 'target') controls.target.set = fail;
        if (stage === 'controls') controls.update = fail;
        if (stage === 'lookAt') { delete ctx.controls; camera.lookAt = fail; }
        if (stage === 'context') Object.defineProperty(ctx, 'camera', { get: fail });
        const pending = flight.flyTo({ z: 100 }, { z: 15 }, duration);
        const rejected = expect(pending).rejects.toBe(failure);
        expect(() => flight.update(ctx)).toThrow(failure);
        await rejected;
        expect(flight.isFlying).toBe(false);
        expect(flight._targetRef).toBeNull();
        const retry = flight.flyTo({ z: 100 }, { z: 15 }, 16);
        flight.update({ camera: { position: {}, lookAt: vi.fn() } });
        await retry;
      },
    );
  }

  it('stops driver publication if a position setter disposes the flight', async () => {
    const flight = new CameraFlightPath();
    const position = { y: 100, z: 100 };
    Object.defineProperty(position, 'x', { set: () => flight.dispose() });
    const lookAt = vi.fn();
    const pending = flight.flyTo({ z: 100 }, { z: 15 }, 100);
    flight.update({ camera: { position, lookAt } });
    await pending;
    expect(position.y).toBe(100);
    expect(position.z).toBe(100);
    expect(lookAt).not.toHaveBeenCalled();
    expect(flight.isFlying).toBe(false);
  });

  it('does not update old controls after a target setter starts a replacement flight', async () => {
    const flight = new CameraFlightPath();
    let replacement;
    const controls = {
      target: { set: () => { replacement = flight.flyToBuilding({ z: 20 }, { z: 5 }, 16); } },
      update: vi.fn(),
    };
    const pending = flight.flyTo({ z: 100 }, { z: 15 }, 16);
    const rejected = expect(pending).rejects.toThrow('new flyToBuilding started');
    flight.update({ camera: { position: {} }, controls });
    await rejected;
    expect(controls.update).not.toHaveBeenCalled();
    expect(flight.isFlying).toBe(true);
    flight.update({ camera: { position: {}, lookAt: vi.fn() } });
    await replacement;
    expect(flight.isFlying).toBe(false);
  });

  it('rejects a missing driver context explicitly', async () => {
    const flight = new CameraFlightPath();
    const pending = flight.flyTo({}, {}, 16);
    const rejected = expect(pending).rejects.toThrow('driver context is required');
    expect(() => flight.update()).toThrow('driver context is required');
    await rejected;
    expect(flight.isFlying).toBe(false);
  });

  it('has an update(ctx) method', () => {
    const flight = new CameraFlightPath();
    expect(typeof flight.update).toBe('function');
  });

  it('update(ctx) does not throw when idle', () => {
    const flight = new CameraFlightPath();
    expect(() => flight.update({ camera: { position: { x: 0, y: 0, z: 0 } } })).not.toThrow();
  });

  it('update(ctx) moves the camera position while flying', () => {
    const flight = new CameraFlightPath();
    flight.flyTo({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 10 }, 500).catch(() => {});

    const cam = { position: { x: 0, y: 0, z: 100 } };
    // Multiple update() calls simulate the driver being ticked by GalaxyCameraController.
    for (let i = 0; i < 5; i++) {
      flight.update({ camera: cam });
    }
    // Camera should have moved from its initial position.
    const moved =
      cam.position.x !== 0 ||
      cam.position.y !== 0 ||
      cam.position.z !== 100;
    expect(moved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ApproachTargetType — enum completeness
// ---------------------------------------------------------------------------

describe('ApproachTargetType — enum values', () => {
  it('exports all 5 expected target-type constants', () => {
    expect(ApproachTargetType).toBeDefined();
    expect(ApproachTargetType.FLEET).toBe('FLEET');
    expect(ApproachTargetType.VESSEL).toBe('VESSEL');
    expect(ApproachTargetType.VAGABOND).toBe('VAGABOND');
    expect(ApproachTargetType.SOLAR_INSTALLATION_SHIPYARD).toBe('SOLAR_INSTALLATION_SHIPYARD');
    expect(ApproachTargetType.SOLAR_INSTALLATION_STARGATE).toBe('SOLAR_INSTALLATION_STARGATE');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(ApproachTargetType)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ZOOM_LEVEL — includes OBJECT_APPROACH
// ---------------------------------------------------------------------------

describe('ZOOM_LEVEL — OBJECT_APPROACH constant', () => {
  it('is defined and equals 4', () => {
    expect(ZOOM_LEVEL.OBJECT_APPROACH).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// ObjectApproachLevelThreeJS
// ---------------------------------------------------------------------------

describe('ObjectApproachLevelThreeJS — interface compliance', () => {
  it('is constructable without arguments', () => {
    expect(() => new ObjectApproachLevelThreeJS()).not.toThrow();
  });

  it('implements all IZoomLevelRenderer methods', () => {
    const lvl = new ObjectApproachLevelThreeJS();
    expect(typeof lvl.initialize).toBe('function');
    expect(typeof lvl.setSceneData).toBe('function');
    expect(typeof lvl.render).toBe('function');
    expect(typeof lvl.enter).toBe('function');
    expect(typeof lvl.exit).toBe('function');
    expect(typeof lvl.dispose).toBe('function');
  });

  it('initialize() resolves without a real canvas/backend (no-op path)', async () => {
    const lvl = new ObjectApproachLevelThreeJS();
    await expect(lvl.initialize(null, null)).resolves.toBeUndefined();
  });

  it('enter() records the targetType from the payload', async () => {
    const lvl = new ObjectApproachLevelThreeJS();
    await lvl.initialize(null, null);
    await lvl.enter(null, { targetType: ApproachTargetType.FLEET });
    expect(lvl._targetType).toBe(ApproachTargetType.FLEET);
  });

  it('enter() handles missing payload gracefully', async () => {
    const lvl = new ObjectApproachLevelThreeJS();
    await lvl.initialize(null, null);
    await expect(lvl.enter(null, null)).resolves.toBeUndefined();
    expect(lvl._targetType).toBeNull();
  });

  it('exit() resolves without throwing', async () => {
    const lvl = new ObjectApproachLevelThreeJS();
    await lvl.initialize(null, null);
    await expect(lvl.exit(null)).resolves.toBeUndefined();
  });

  it('dispose() is safe to call multiple times', () => {
    const lvl = new ObjectApproachLevelThreeJS();
    expect(() => { lvl.dispose(); lvl.dispose(); }).not.toThrow();
  });

  it('render() is a no-op without an initialised renderer', () => {
    const lvl = new ObjectApproachLevelThreeJS();
    expect(() => lvl.render(16, null)).not.toThrow();
  });

  it('setSceneData() stores data without throwing', () => {
    const lvl = new ObjectApproachLevelThreeJS();
    expect(() => lvl.setSceneData({ fleet: { id: 1 } })).not.toThrow();
    expect(lvl._sceneData).toEqual({ fleet: { id: 1 } });
  });
});

// ---------------------------------------------------------------------------
// ObjectApproachLevelWebGPU
// ---------------------------------------------------------------------------

describe('ObjectApproachLevelWebGPU — interface compliance', () => {
  it('is constructable without arguments', () => {
    expect(() => new ObjectApproachLevelWebGPU()).not.toThrow();
  });

  it('implements all IZoomLevelRenderer methods', () => {
    const lvl = new ObjectApproachLevelWebGPU();
    expect(typeof lvl.initialize).toBe('function');
    expect(typeof lvl.setSceneData).toBe('function');
    expect(typeof lvl.render).toBe('function');
    expect(typeof lvl.enter).toBe('function');
    expect(typeof lvl.exit).toBe('function');
    expect(typeof lvl.dispose).toBe('function');
  });

  it('initialize() resolves without a real backend (stores refs)', async () => {
    const lvl = new ObjectApproachLevelWebGPU();
    const fakeBackend = {};
    await expect(lvl.initialize(null, fakeBackend)).resolves.toBeUndefined();
    expect(lvl._backend).toBe(fakeBackend);
  });

  it('enter() records targetType from payload', async () => {
    const lvl = new ObjectApproachLevelWebGPU();
    await lvl.initialize(null, null);
    await lvl.enter(null, { targetType: ApproachTargetType.SOLAR_INSTALLATION_STARGATE });
    expect(lvl._targetType).toBe(ApproachTargetType.SOLAR_INSTALLATION_STARGATE);
  });

  it('enter() calls backend.createMesh() when available', async () => {
    const fakeHandle = Symbol('mesh');
    const backend = { createMesh: vi.fn().mockResolvedValue(fakeHandle) };
    const lvl = new ObjectApproachLevelWebGPU();
    await lvl.initialize(null, backend);
    await lvl.enter(null, { targetType: ApproachTargetType.VESSEL });
    expect(backend.createMesh).toHaveBeenCalledOnce();
    expect(lvl._meshHandle).toBe(fakeHandle);
  });

  it('render() rotates and draws the mesh through the shared backend', async () => {
    const fakeHandle = Symbol('mesh');
    const backend = {
      createMesh: vi.fn().mockResolvedValue(fakeHandle),
      setMeshRotation: vi.fn(),
      renderMesh: vi.fn(),
    };
    const lvl = new ObjectApproachLevelWebGPU();
    await lvl.initialize(null, backend);
    await lvl.enter(null, { targetType: ApproachTargetType.VESSEL });
    lvl.render(16, null);

    expect(backend.setMeshRotation).toHaveBeenCalledWith(fakeHandle, { y: expect.any(Number) });
    expect(backend.renderMesh).toHaveBeenCalledWith(fakeHandle);
  });

  it('enter() reports when the shared backend cannot create meshes', async () => {
    const lvl = new ObjectApproachLevelWebGPU();
    await lvl.initialize(null, {});

    await expect(lvl.enter(null, { targetType: ApproachTargetType.VESSEL }))
      .rejects.toThrow('requires the shared WebGPU mesh renderer');
  });

  it('exit() calls backend.destroyMesh() when a handle exists', async () => {
    const fakeHandle = Symbol('mesh');
    const backend = {
      createMesh:  vi.fn().mockResolvedValue(fakeHandle),
      destroyMesh: vi.fn(),
    };
    const lvl = new ObjectApproachLevelWebGPU();
    await lvl.initialize(null, backend);
    await lvl.enter(null, { targetType: ApproachTargetType.FLEET });
    await lvl.exit(null);
    expect(backend.destroyMesh).toHaveBeenCalledWith(fakeHandle);
    expect(lvl._meshHandle).toBeNull();
  });

  it('dispose() is safe to call without a backend', () => {
    const lvl = new ObjectApproachLevelWebGPU();
    expect(() => { lvl.dispose(); lvl.dispose(); }).not.toThrow();
  });

  it('render() is a no-op without a backend', () => {
    const lvl = new ObjectApproachLevelWebGPU();
    expect(() => lvl.render(16, null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// meshDescriptorFor — shape mapping
// ---------------------------------------------------------------------------

describe('meshDescriptorFor — shape per ApproachTargetType', () => {
  const cases = [
    [ApproachTargetType.FLEET,                        'box'],
    [ApproachTargetType.VESSEL,                       'cylinder'],
    [ApproachTargetType.VAGABOND,                     'dodecahedron'],
    [ApproachTargetType.SOLAR_INSTALLATION_SHIPYARD,  'torus'],
    [ApproachTargetType.SOLAR_INSTALLATION_STARGATE,  'torus_large'],
  ];

  for (const [type, expectedShape] of cases) {
    it(`returns shape="${expectedShape}" for ${type}`, () => {
      const desc = meshDescriptorFor(type);
      expect(desc.shape).toBe(expectedShape);
      // All descriptors must include colour (3-element [0,1] float array),
      // metalness and roughness.
      expect(Array.isArray(desc.color)).toBe(true);
      expect(desc.color).toHaveLength(3);
      for (const c of desc.color) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      expect(typeof desc.metalness).toBe('number');
      expect(typeof desc.roughness).toBe('number');
    });
  }

  it('returns a fallback shape for unknown target types', () => {
    const desc = meshDescriptorFor('UNKNOWN_TYPE');
    expect(desc.shape).toBe('octahedron');
  });
});

// ---------------------------------------------------------------------------
// SeamlessZoomOrchestrator — OBJECT_APPROACH triggers CameraFlightPath.flyTo()
// ---------------------------------------------------------------------------

describe('SeamlessZoomOrchestrator — OBJECT_APPROACH triggers flyTo()', () => {
  it('calls CameraFlightPath.flyTo() for OBJECT_APPROACH', async () => {
    const mockBackend = makeMockBackend('webgl2');
    const orch = new SeamlessZoomOrchestrator(null, { _backend: mockBackend });

    const galaxyLevel = makeMockLevel();
    const objectLevel = makeMockLevel();
    const GalaxyClass = makeLevelClass(galaxyLevel);
    const ObjectClass = makeLevelClass(objectLevel);

    orch.register(ZOOM_LEVEL.GALAXY,          { webgpu: GalaxyClass, threejs: GalaxyClass });
    orch.register(ZOOM_LEVEL.OBJECT_APPROACH, { webgpu: ObjectClass, threejs: ObjectClass });

    const flyToSpy = vi.spyOn(orch._flight, 'flyTo').mockResolvedValue(undefined);

    // GALAXY should not trigger flyTo.
    await orch.zoomTo(ZOOM_LEVEL.GALAXY, null);
    expect(flyToSpy).not.toHaveBeenCalled();

    // OBJECT_APPROACH should trigger flyTo.
    await orch.zoomTo(ZOOM_LEVEL.OBJECT_APPROACH, {
      targetType: ApproachTargetType.FLEET,
      target: { id: 1 },
    });
    expect(flyToSpy).toHaveBeenCalledOnce();
  });

  it('passes the payload (including targetType) to enter() on OBJECT_APPROACH', async () => {
    const mockBackend = makeMockBackend('webgl2');
    const orch = new SeamlessZoomOrchestrator(null, { _backend: mockBackend });

    const objectLevel = makeMockLevel();
    const ObjectClass = makeLevelClass(objectLevel);
    orch.register(ZOOM_LEVEL.OBJECT_APPROACH, { webgpu: ObjectClass, threejs: ObjectClass });

    vi.spyOn(orch._flight, 'flyTo').mockResolvedValue(undefined);

    const payload = { targetType: ApproachTargetType.VESSEL, target: { id: 99 } };
    await orch.zoomTo(ZOOM_LEVEL.OBJECT_APPROACH, payload);

    expect(objectLevel.enter.mock.calls[0][1]).toBe(payload);
  });
});

// ---------------------------------------------------------------------------
// SeamlessZoomOrchestrator._requiresCameraFlight — static helper
// ---------------------------------------------------------------------------

describe('SeamlessZoomOrchestrator._requiresCameraFlight()', () => {
  it('returns true for PLANET_APPROACH', () => {
    expect(SeamlessZoomOrchestrator._requiresCameraFlight(ZOOM_LEVEL.PLANET_APPROACH)).toBe(true);
  });

  it('returns true for OBJECT_APPROACH', () => {
    expect(SeamlessZoomOrchestrator._requiresCameraFlight(ZOOM_LEVEL.OBJECT_APPROACH)).toBe(true);
  });

  it('returns false for GALAXY', () => {
    expect(SeamlessZoomOrchestrator._requiresCameraFlight(ZOOM_LEVEL.GALAXY)).toBe(false);
  });

  it('returns false for SYSTEM', () => {
    expect(SeamlessZoomOrchestrator._requiresCameraFlight(ZOOM_LEVEL.SYSTEM)).toBe(false);
  });

  it('returns false for COLONY_SURFACE', () => {
    expect(SeamlessZoomOrchestrator._requiresCameraFlight(ZOOM_LEVEL.COLONY_SURFACE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SPATIAL_DEPTH — enum completeness and values
// ---------------------------------------------------------------------------

describe('SPATIAL_DEPTH — enum completeness', () => {
  it('exports all 6 depth constants', () => {
    expect(SPATIAL_DEPTH).toBeDefined();
    expect(SPATIAL_DEPTH.GALAXY).toBe(0);
    expect(SPATIAL_DEPTH.GALAXY_REGION).toBe(1);
    expect(SPATIAL_DEPTH.STAR_SYSTEM).toBe(2);
    expect(SPATIAL_DEPTH.STELLAR_VICINITY).toBe(3);
    expect(SPATIAL_DEPTH.ORBITAL_SHELL).toBe(4);
    expect(SPATIAL_DEPTH.COLONY_BUILDING).toBe(5);
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(SPATIAL_DEPTH)).toBe(true);
  });

  it('depth values equal the corresponding ZOOM_LEVEL values', () => {
    expect(SPATIAL_DEPTH.GALAXY).toBe(ZOOM_LEVEL.GALAXY);
    expect(SPATIAL_DEPTH.GALAXY_REGION).toBe(ZOOM_LEVEL.SYSTEM);
    expect(SPATIAL_DEPTH.STAR_SYSTEM).toBe(ZOOM_LEVEL.PLANET_APPROACH);
    expect(SPATIAL_DEPTH.STELLAR_VICINITY).toBe(ZOOM_LEVEL.COLONY_SURFACE);
    expect(SPATIAL_DEPTH.ORBITAL_SHELL).toBe(ZOOM_LEVEL.OBJECT_APPROACH);
    expect(SPATIAL_DEPTH.COLONY_BUILDING).toBe(ZOOM_LEVEL.COLONY_BUILDING);
  });
});

// ---------------------------------------------------------------------------
// zoomToTarget() — hierarchy-depth routing
// ---------------------------------------------------------------------------

describe('zoomToTarget() — depth-based routing', () => {
  let orch;
  let mockBackend;

  beforeEach(() => {
    mockBackend = makeMockBackend('webgl2');
    orch = new SeamlessZoomOrchestrator(null, { _backend: mockBackend });

    // Register a level class for every depth (0–5).
    for (let depth = 0; depth <= 5; depth++) {
      const lvl = makeMockLevel();
      const Cls = makeLevelClass(lvl);
      orch.register(depth, { webgpu: Cls, threejs: Cls });
    }
  });

  it('routes to ZOOM_LEVEL.GALAXY (0) for a target with spatialDepth=0', async () => {
    const zoomSpy = vi.spyOn(orch, 'zoomTo');
    await orch.zoomToTarget({ spatialDepth: SPATIAL_DEPTH.GALAXY });
    expect(zoomSpy).toHaveBeenCalledWith(SPATIAL_DEPTH.GALAXY, expect.objectContaining({ spatialDepth: 0 }), {});
  });

  it('routes fleet-in-transit (STAR_SYSTEM depth=2) correctly', async () => {
    const fleet = { spatialDepth: SPATIAL_DEPTH.STAR_SYSTEM, type: 'Fleet', id: 1 };
    const zoomSpy = vi.spyOn(orch, 'zoomTo');
    vi.spyOn(orch._flight, 'flyTo').mockResolvedValue(undefined);
    await orch.zoomToTarget(fleet);
    expect(zoomSpy).toHaveBeenCalledWith(ZOOM_LEVEL.PLANET_APPROACH, fleet, {});
  });

  it('routes Stargate (STELLAR_VICINITY depth=3) correctly', async () => {
    const stargate = { spatialDepth: SPATIAL_DEPTH.STELLAR_VICINITY, type: 'Stargate', id: 2 };
    const zoomSpy = vi.spyOn(orch, 'zoomTo');
    await orch.zoomToTarget(stargate);
    expect(zoomSpy).toHaveBeenCalledWith(ZOOM_LEVEL.COLONY_SURFACE, stargate, {});
  });

  it('routes fleet-in-orbit (STELLAR_VICINITY depth=3) correctly', async () => {
    const fleet = { spatialDepth: SPATIAL_DEPTH.STELLAR_VICINITY, type: 'Fleet', id: 3 };
    const zoomSpy = vi.spyOn(orch, 'zoomTo');
    await orch.zoomToTarget(fleet);
    expect(zoomSpy).toHaveBeenCalledWith(ZOOM_LEVEL.COLONY_SURFACE, fleet, {});
  });

  it('routes Shipyard (ORBITAL_SHELL depth=4) correctly', async () => {
    const shipyard = { spatialDepth: SPATIAL_DEPTH.ORBITAL_SHELL, type: 'Shipyard', id: 4 };
    const zoomSpy = vi.spyOn(orch, 'zoomTo');
    vi.spyOn(orch._flight, 'flyTo').mockResolvedValue(undefined);
    await orch.zoomToTarget(shipyard);
    expect(zoomSpy).toHaveBeenCalledWith(ZOOM_LEVEL.OBJECT_APPROACH, shipyard, {});
  });

  it('forwards opts to zoomTo()', async () => {
    const target = { spatialDepth: SPATIAL_DEPTH.ORBITAL_SHELL };
    const opts = { cameraFrom: { x: 0, y: 0, z: 200 }, flyDuration: 1000 };
    const zoomSpy = vi.spyOn(orch, 'zoomTo');
    vi.spyOn(orch._flight, 'flyTo').mockResolvedValue(undefined);
    await orch.zoomToTarget(target, opts);
    expect(zoomSpy).toHaveBeenCalledWith(SPATIAL_DEPTH.ORBITAL_SHELL, target, opts);
  });

  it('object type is irrelevant — same spatialDepth always maps to same zoom level', async () => {
    // A Fleet and a Stargate at the same STELLAR_VICINITY depth must both land at ZOOM_LEVEL 3.
    const fleet   = { spatialDepth: SPATIAL_DEPTH.STELLAR_VICINITY, type: 'Fleet' };
    const stargate = { spatialDepth: SPATIAL_DEPTH.STELLAR_VICINITY, type: 'Stargate' };

    const zoomSpy = vi.spyOn(orch, 'zoomTo');
    await orch.zoomToTarget(fleet);
    await orch.zoomToTarget(stargate);

    expect(zoomSpy.mock.calls[0][0]).toBe(ZOOM_LEVEL.COLONY_SURFACE);
    expect(zoomSpy.mock.calls[1][0]).toBe(ZOOM_LEVEL.COLONY_SURFACE);
  });
});

// ---------------------------------------------------------------------------
// zoomToTarget() — error handling
// ---------------------------------------------------------------------------

describe('zoomToTarget() — error handling', () => {
  let orch;

  beforeEach(() => {
    orch = new SeamlessZoomOrchestrator(null, { _backend: makeMockBackend('webgl2') });
    // Register level 0 so the valid-depth test can complete.
    const lvl = makeMockLevel();
    orch.register(0, { webgpu: makeLevelClass(lvl), threejs: makeLevelClass(lvl) });
  });

  it('throws TypeError when target is null', () => {
    expect(() => orch.zoomToTarget(null)).toThrow(TypeError);
  });

  it('throws TypeError when target is undefined', () => {
    expect(() => orch.zoomToTarget(undefined)).toThrow(TypeError);
  });

  it('throws TypeError when target has no spatialDepth property', () => {
    expect(() => orch.zoomToTarget({ type: 'Fleet' })).toThrow(TypeError);
  });

  it('error message mentions spatialDepth', () => {
    expect(() => orch.zoomToTarget({})).toThrow(/spatialDepth/);
  });

  it('throws TypeError when spatialDepth is out of range (> 5)', () => {
    expect(() => orch.zoomToTarget({ spatialDepth: 6 })).toThrow(TypeError);
  });

  it('throws TypeError when spatialDepth is negative', () => {
    expect(() => orch.zoomToTarget({ spatialDepth: -1 })).toThrow(TypeError);
  });

  it('throws TypeError when spatialDepth is not a number (string)', () => {
    expect(() => orch.zoomToTarget({ spatialDepth: '2' })).toThrow(TypeError);
  });

  it('does NOT throw for spatialDepth=0 (valid boundary)', async () => {
    await expect(orch.zoomToTarget({ spatialDepth: 0 })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ZOOM_LEVEL.COLONY_BUILDING — new depth-5 level
// ---------------------------------------------------------------------------

describe('ZOOM_LEVEL.COLONY_BUILDING (depth 5)', () => {
  it('ZOOM_LEVEL.COLONY_BUILDING equals 5', () => {
    expect(ZOOM_LEVEL.COLONY_BUILDING).toBe(5);
  });

  it('SPATIAL_DEPTH.COLONY_BUILDING equals 5', () => {
    expect(SPATIAL_DEPTH.COLONY_BUILDING).toBe(5);
  });

  it('ApproachTargetType.BUILDING is exported', () => {
    expect(ApproachTargetType.BUILDING).toBe('BUILDING');
  });

  it('ZOOM_LEVEL is frozen and still includes all 6 levels', () => {
    expect(Object.isFrozen(ZOOM_LEVEL)).toBe(true);
    expect(Object.keys(ZOOM_LEVEL)).toHaveLength(6);
  });
});

describe('zoomToTarget() — COLONY_BUILDING routing', () => {
  let orch;

  beforeEach(() => {
    orch = new SeamlessZoomOrchestrator(null, { _backend: makeMockBackend('webgl2') });
    for (let depth = 0; depth <= 5; depth++) {
      const lvl = makeMockLevel();
      const Cls = makeLevelClass(lvl);
      orch.register(depth, { webgpu: Cls, threejs: Cls });
    }
  });

  it('routes building (COLONY_BUILDING depth=5) to ZOOM_LEVEL.COLONY_BUILDING', async () => {
    const building = { spatialDepth: SPATIAL_DEPTH.COLONY_BUILDING, type: 'PowerPlant', id: 42 };
    const zoomSpy = vi.spyOn(orch, 'zoomTo');
    vi.spyOn(orch._flight, 'flyTo').mockResolvedValue(undefined);
    await orch.zoomToTarget(building);
    expect(zoomSpy).toHaveBeenCalledWith(ZOOM_LEVEL.COLONY_BUILDING, building, {});
  });

  it('does NOT throw for spatialDepth=5 (valid boundary)', async () => {
    const building = { spatialDepth: 5 };
    vi.spyOn(orch._flight, 'flyTo').mockResolvedValue(undefined);
    await expect(orch.zoomToTarget(building)).resolves.toBeUndefined();
  });

  it('throws TypeError for spatialDepth=6 (out of range)', () => {
    expect(() => orch.zoomToTarget({ spatialDepth: 6 })).toThrow(TypeError);
  });

  it('forwards opts to zoomTo() for COLONY_BUILDING target', async () => {
    const building = { spatialDepth: SPATIAL_DEPTH.COLONY_BUILDING, id: 1 };
    const opts = { cameraFrom: { x: 0, y: 0, z: 5 }, flyDuration: 900 };
    const zoomSpy = vi.spyOn(orch, 'zoomTo');
    vi.spyOn(orch._flight, 'flyTo').mockResolvedValue(undefined);
    await orch.zoomToTarget(building, opts);
    expect(zoomSpy).toHaveBeenCalledWith(ZOOM_LEVEL.COLONY_BUILDING, building, opts);
  });

  it('_requiresCameraFlight returns true for COLONY_BUILDING', () => {
    expect(SeamlessZoomOrchestrator._requiresCameraFlight(ZOOM_LEVEL.COLONY_BUILDING)).toBe(true);
  });
});

describe('CameraFlightPath — flyToBuilding()', () => {
  it('resolves when tick reaches t=1', async () => {
    const flight = new CameraFlightPath();
    const promise = flight.flyToBuilding({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 100);

    // Advance enough to complete
    for (let i = 0; i < 10; i++) {
      flight.tick(20);
    }

    await expect(promise).resolves.toBeUndefined();
  });

  it('uses a short default duration of 900 ms', () => {
    const flight = new CameraFlightPath();
    flight.flyToBuilding({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    expect(flight._duration).toBe(900);
  });

  it('respects custom duration', () => {
    const flight = new CameraFlightPath();
    flight.flyToBuilding({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 400);
    expect(flight._duration).toBe(400);
  });

  it('tick() returns position progressing toward target', () => {
    const flight = new CameraFlightPath();
    flight.flyToBuilding({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 1000);
    const state = flight.tick(500);
    expect(state).not.toBeNull();
    expect(state.t).toBeGreaterThan(0);
    expect(state.t).toBeLessThanOrEqual(1);
  });

  it('does not set atmosphere or star-blur side-effect callbacks', () => {
    const flight = new CameraFlightPath();
    flight._onAtmosphereScale = vi.fn();
    flight._onStarBlur = vi.fn();
    flight.flyToBuilding({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 200);
    // flyToBuilding clears these callbacks
    expect(flight._onAtmosphereScale).toBeNull();
    expect(flight._onStarBlur).toBeNull();
  });
});
