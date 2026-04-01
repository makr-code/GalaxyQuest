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
 *     • other levels do NOT trigger CameraFlightPath.flyTo()
 *   CameraFlightPath
 *     • flyTo() returns a Promise that resolves when t reaches 1
 *     • tick() returns t progressing from 0 toward 1
 *     • implements the camera-driver interface (has update(ctx) method)
 *
 * Uses a MockRenderer — no real GPU or DOM required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { RendererRegistry }         = require(path.join(root, 'js/rendering/RendererRegistry.js'));
const { SeamlessZoomOrchestrator, ZOOM_LEVEL } =
  require(path.join(root, 'js/rendering/SeamlessZoomOrchestrator.js'));
const { CameraFlightPath }         = require(path.join(root, 'js/rendering/CameraFlightPath.js'));

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
