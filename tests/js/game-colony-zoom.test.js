import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameColonyZoom } from '../../js/rendering/game-colony-zoom.js';

const state = vi.hoisted(() => ({ renderError: null, refresh: vi.fn() }));
vi.mock('../../js/engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js', () => ({
  default: undefined,
  PersistentBodyPlanetApproachRenderer: class {
    async initialize() {}
    async enter() {}
    async exit() {}
    render() { if (state.renderError) throw state.renderError; }
    dispose() {}
  },
}));
vi.mock('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js', () => ({
  default: undefined,
  ColonySurfaceLevelWebGPU: class {
    refreshSnapshot(id) { return state.refresh(id); }
    async initialize() {}
    async enter() {}
    async exit() {}
    render() {}
    dispose() {}
  },
}));

describe('Authenticated shared colony zoom bridge', () => {
  let runtime;
  let options;
  let backend;
  let hooks;
  let controller;
  beforeEach(() => {
    state.renderError = null;
    state.refresh.mockClear();
    hooks = new Set();
    controller = new AbortController();
    backend = {
      device: {}, context: {}, getCapabilities: () => ({ webgpu: true }),
      addFrameHook: (hook) => { hooks.add(hook); return () => hooks.delete(hook); },
      setZoomSceneActive: vi.fn(),
    };
    options = {
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.createElement('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 }, target: { x: 0, y: 0, z: 0 } }),
      onLevel: vi.fn(), onReturn: vi.fn(), onError: vi.fn(), signal: controller.signal,
    };
  });
  afterEach(() => { runtime?.dispose(); runtime = null; });

  it('uses the existing canvas, device and one removable frame hook, without another RAF', async () => {
    runtime = await createGameColonyZoom(options);
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    expect(zoom._canvas).toBe(options.canvas);
    expect(zoom._backend.device).toBe(backend.device);
    expect(zoom._backend.context).toBe(backend.context);
    expect(zoom._rafId).toBe(0);
    expect(hooks.size).toBe(1);
    await runtime.surface(async () => ({ colony: { id: 7 } }));
    expect(options.onLevel).toHaveBeenLastCalledWith('colony');
    runtime.dispose();
    expect(hooks.size).toBe(0);
    expect(backend.setZoomSceneActive).toHaveBeenLastCalledWith(false);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
  });

  it('does not resurrect a disposed surface after its data request completes', async () => {
    runtime = await createGameColonyZoom(options);
    let finish;
    const pending = runtime.surface(() => new Promise((resolve) => { finish = resolve; }));
    runtime.dispose();
    finish({ colony: { id: 7 } });
    expect(await pending).toBe(false);
    expect(options.onLevel).not.toHaveBeenCalled();
    expect(hooks.size).toBe(0);
  });

  it('only forwards refreshes to an already active full colony surface', async () => {
    runtime = await createGameColonyZoom(options);
    runtime.refreshColony(7);
    expect(state.refresh).not.toHaveBeenCalled();
    await runtime.surface(async () => ({ colony: { id: 7 } }));
    await runtime.refreshColony(7);
    expect(state.refresh).toHaveBeenCalledExactlyOnceWith(7);
    runtime.dispose();
    runtime.refreshColony(7);
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it('uses the existing reverse surface transition for ancestor navigation and refuses downward navigation', async () => {
    runtime = await createGameColonyZoom(options);
    expect(await runtime.returnTo('colony')).toBe(false);
    await runtime.surface(async () => ({ colony: { id: 7 } }));
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const surface = zoom._active;
    const exit = vi.spyOn(surface, 'exit');
    expect(await runtime.returnTo('planet')).toBe(true);
    expect(exit).toHaveBeenCalledExactlyOnceWith(2);
    expect(zoom._activeLevel).toBe(2);
    expect(hooks.size).toBe(1);
    expect(await runtime.returnTo('colony')).toBe(false);
    runtime.dispose();
    expect(await runtime.returnTo('planet')).toBe(false);
  });
  it('forwards touch zoom and selection only to the current native renderer', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.surface(async () => ({ colony: { id: 7 } }));
    const surface = window.__GQ_ZOOM_ORCHESTRATOR._active;
    surface.zoomBy = vi.fn();
    surface.selectAt = vi.fn();
    runtime.zoomBy(0.1);
    runtime.selectAt(50, 80);
    expect(surface.zoomBy).toHaveBeenCalledExactlyOnceWith(0.1);
    expect(surface.selectAt).toHaveBeenCalledExactlyOnceWith(50, 80);
    runtime.dispose();
    runtime.zoomBy(0.2);
    runtime.selectAt(60, 90);
    expect(surface.zoomBy).toHaveBeenCalledTimes(1);
    expect(surface.selectAt).toHaveBeenCalledTimes(1);
  });
  it('unwinds live building detail before awaiting surface departure and suppresses repeated requests', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.surface(async () => ({ colony: { id: 7 } }));
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const surface = zoom._active;
    surface.enterBuilding = vi.fn();
    surface.leaveBuilding = vi.fn();
    await zoom.zoomTo(5, { type: 'metal_mine' });
    let finishDeparture;
    surface.exit = vi.fn(() => new Promise((resolve) => { finishDeparture = resolve; }));
    const pending = runtime.returnTo('planet');
    await vi.waitFor(() => expect(surface.exit).toHaveBeenCalledExactlyOnceWith(2));
    expect(surface.leaveBuilding).toHaveBeenCalledOnce();
    expect(await runtime.returnTo('planet')).toBe(false);
    finishDeparture();
    expect(await pending).toBe(true);
    expect(options.onLevel.mock.calls.slice(-3).map(([level]) => level)).toEqual(['building', 'colony', 'planet']);
  });

  it('waits for the existing planet flight before entering the requested surface', async () => {
    runtime = await createGameColonyZoom(options);
    const approach = runtime.approach({}, { position: { x: 0, y: 0, z: 20 } });
    await vi.waitFor(() => expect(window.__GQ_ZOOM_ORCHESTRATOR._flight.isFlying).toBe(true));
    const surface = runtime.surface(async () => ({ colony: { id: 7 } }));
    for (let frame = 0; frame < 100; frame++) hooks.forEach((hook) => hook(0.05));
    await approach;
    expect(await surface).toBe(true);
    expect(options.onLevel).toHaveBeenLastCalledWith('colony');
  });

  it('releases the zoom scene, global and frame hook after an explicit rendering error', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.approach({});
    state.renderError = new Error('Surface GPU failure');
    hooks.forEach((hook) => hook(0.016));
    expect(options.onError).toHaveBeenCalledWith(state.renderError);
    expect(options.onReturn).toHaveBeenCalledOnce();
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    expect(backend.setZoomSceneActive).toHaveBeenLastCalledWith(false);
  });

  it('settles flight and pending surface entry on disposal without requiring another frame', async () => {
    runtime = await createGameColonyZoom(options);
    const approach = runtime.approach({}, { position: { x: 0, y: 0, z: 20 } });
    await vi.waitFor(() => expect(window.__GQ_ZOOM_ORCHESTRATOR._flight.isFlying).toBe(true));
    const surface = runtime.surface(async () => ({ colony: { id: 7 } }));
    await Promise.resolve();
    runtime.dispose();
    expect(await Promise.all([approach, surface])).toEqual([false, false]);
    expect(hooks.size).toBe(0);
    expect(options.onLevel).not.toHaveBeenCalled();
  });

  it('does not publish a zoom runtime when lazy imports were cancelled', async () => {
    controller.abort();
    await expect(createGameColonyZoom(options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
  });
});
