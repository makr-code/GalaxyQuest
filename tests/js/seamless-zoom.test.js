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
  });
});

// ---------------------------------------------------------------------------
// CameraFlightPath — Promise resolves when t reaches 1
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// CameraFlightPath — implements the camera-driver interface
// ---------------------------------------------------------------------------

describe('CameraFlightPath — driver interface', () => {
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
