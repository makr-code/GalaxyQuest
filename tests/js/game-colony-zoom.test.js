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
    resetView() {}
    rotateView() {}
    panView() {}
    zoomBy() {}
    selectAt() {}
    nudgeZoom() {}
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
    resetView() {}
    rotateView() {}
    panView() {}
    zoomBy() {}
    selectAt() {}
    nudgeZoom() {}
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

  it.each(['back', 'returnTo'])('keeps the refreshed economy and population when %s returns to orbit', async action => {
    runtime = await createGameColonyZoom(options);
    await runtime.surface(async () => ({ colony: { id: 7, population: 1000 } }));
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const updated = { colony: { id: 7, population: 40000 }, buildings: [{ type: 'farm', level: 8 }] };
    zoom._active._sceneData = updated;
    const planet = zoom._registry.resolve(2, zoom._backend);
    const enter = vi.spyOn(planet, 'enter');
    if (action === 'back') {
      runtime.back();
      await vi.waitFor(() => expect(zoom._activeLevel).toBe(2));
    } else await runtime.returnTo('planet');
    expect(enter).toHaveBeenLastCalledWith(3, updated);
  });

  it('carries a picked orbit site and its manifest through the authorized surface loader', async () => {
    options.onSettlement = vi.fn();
    runtime = await createGameColonyZoom(options);
    await runtime.approach({ colony: { id: 7 } });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const orbit = zoom._active;
    orbit._surfacePlan = { settlements: [{ id: 'satellite-2' }] };
    orbit._terrainManifest = { seed: 35, radius_km: 6371 };
    orbit.pickSettlement = vi.fn(() => 'satellite-2');
    expect(runtime.pickSettlement(60, 90)).toBe('satellite-2');
    expect(orbit.pickSettlement).toHaveBeenCalledWith(60, 90);
    zoom._backend.onSettlementSelect('satellite-2');
    expect(options.onSettlement).toHaveBeenCalledExactlyOnceWith('satellite-2');
    const city = zoom._registry.resolve(3, zoom._backend);
    const enter = vi.spyOn(city, 'enter');
    const buildings = [{ type: 'farm', level: 8 }];
    const load = vi.fn(async () => ({ colony: { id: 7, population: 40000 }, buildings }));
    await runtime.surface(load, 'satellite-2');
    expect(load).toHaveBeenCalledOnce();
    expect(enter).toHaveBeenLastCalledWith(2, {
      colony: { id: 7, population: 40000 }, buildings, settlement_id: 'satellite-2',
      bodyTerrainManifest: orbit._terrainManifest,
    });
    expect(runtime.pickSettlement(60, 90)).toBeNull();
    expect(zoom._backend.onSettlementSelect('satellite-2')).toBe(false);
  });

  it('rejects an orbital site that deactivated while its authorized snapshot was loading', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.approach({ colony: { id: 7 } });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    zoom._active._surfacePlan = { settlements: [{ id: 'primary' }] };
    await expect(runtime.surface(async () => ({ colony: { id: 7 } }), 'retired')).rejects.toThrow('no longer active');
    expect(zoom._activeLevel).toBe(2);
  });

  it('disables additional marker navigation while the authorized surface read is pending and restores it after failure', async () => {
    options.onSettlement = vi.fn();
    runtime = await createGameColonyZoom(options);
    await runtime.approach({ colony: { id: 7 } });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    zoom._active.pickSettlement = vi.fn(() => 'satellite');
    let reject;
    const pending = runtime.surface(() => new Promise((_resolve, fail) => { reject = fail; }), 'satellite');
    expect(zoom._backend.canSelectSettlement()).toBe(false);
    expect(runtime.pickSettlement(60, 90)).toBeNull();
    expect(zoom._backend.onSettlementSelect('satellite')).toBe(false);
    expect(options.onSettlement).not.toHaveBeenCalled();
    const failure = new Error('Authorized building read failed');
    const rejected = expect(pending).rejects.toBe(failure);
    reject(failure);
    await rejected;
    expect(zoom._backend.canSelectSettlement()).toBe(true);
    expect(runtime.pickSettlement(60, 90)).toBe('satellite');
  });

  it('ignores a stale picked-site load after leaving the orbit', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.approach({ colony: { id: 7 } });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    zoom._active._surfacePlan = { settlements: [{ id: 'satellite' }] };
    let finish;
    const pending = runtime.surface(() => new Promise(resolve => { finish = resolve; }), 'satellite');
    runtime.back();
    await vi.waitFor(() => expect(zoom._activeLevel).toBe(1));
    finish({ colony: { id: 7 } });
    expect(await pending).toBe(false);
    expect(zoom._activeLevel).toBe(1);
  });

  it.each(['back', 'returnTo'])('cancels a pending surface load after %s navigation', async action => {
    runtime = await createGameColonyZoom(options);
    await runtime.approach({ planet: { id: 1 } });
    let finish;
    const pending = runtime.surface(() => new Promise(resolve => { finish = resolve; }));
    if (action === 'back') {
      runtime.back();
      await vi.waitFor(() => expect(window.__GQ_ZOOM_ORCHESTRATOR._activeLevel).toBe(1));
    } else {
      expect(await runtime.returnTo('planet')).toBe(true);
    }
    options.onLevel.mockClear();
    finish({ colony: { id: 7 } });
    expect(await pending).toBe(false);
    expect(window.__GQ_ZOOM_ORCHESTRATOR._activeLevel).toBe(action === 'back' ? 1 : 2);
    expect(options.onLevel).not.toHaveBeenCalled();
  });

  it('refuses an overlapping approach without losing the accepted flight or return payload', async () => {
    runtime = await createGameColonyZoom(options);
    const original = { planet: { id: 1 } };
    const pending = runtime.approach(original, { position: { x: 0, y: 0, z: 20 } });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    await vi.waitFor(() => expect(zoom._flight.isFlying).toBe(true));
    expect(await runtime.approach({ planet: { id: 2 } })).toBe(false);
    const surface = runtime.surface(async () => ({ colony: { id: 7 } }));
    await Promise.resolve();
    expect(zoom._activeLevel).toBe(2);
    for (let frame = 0; frame < 100; frame++) hooks.forEach(hook => hook(0.05));
    expect(await pending).toBe(false);
    expect(await surface).toBe(true);
    const planet = zoom._registry.resolve(2, zoom._backend);
    const enter = vi.spyOn(planet, 'enter');
    await runtime.returnTo('planet');
    expect(enter).toHaveBeenLastCalledWith(3, { colony: { id: 7 } });
  });

  it('keeps an accepted approach successful after an ignored overlapping approach', async () => {
    runtime = await createGameColonyZoom(options);
    const pending = runtime.approach({ planet: { id: 1 } }, { position: { x: 0, y: 0, z: 20 } });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    await vi.waitFor(() => expect(zoom._flight.isFlying).toBe(true));
    expect(await runtime.approach({ planet: { id: 2 } })).toBe(false);
    for (let frame = 0; frame < 100; frame++) hooks.forEach(hook => hook(0.05));
    expect(await pending).toBe(true);
  });

  it('does not enter the surface after its prerequisite planet entry was cancelled', async () => {
    runtime = await createGameColonyZoom(options);
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const planet = zoom._registry.resolve(2, zoom._backend);
    let finish;
    planet.enter = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const pending = runtime.surface(async () => ({ colony: { id: 7 } }));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    zoom.register(2, { webgpu: class {
      async initialize() {}
      async enter() {}
      dispose() {}
    } });
    finish();
    expect(await pending).toBe(false);
    expect(zoom._active).toBeNull();
    expect(options.onLevel).not.toHaveBeenCalled();
  });

  it('keeps only the latest surface response and ignores refused downward navigation', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.approach({});
    let finishOld;
    let finishNew;
    const old = runtime.surface(() => new Promise(resolve => { finishOld = resolve; }));
    const latest = runtime.surface(() => new Promise(resolve => { finishNew = resolve; }));
    expect(await runtime.returnTo('colony')).toBe(false);
    finishNew({ colony: { id: 8 } });
    expect(await latest).toBe(true);
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const active = zoom._active;
    const enter = vi.spyOn(active, 'enter');
    finishOld({ colony: { id: 7 } });
    expect(await old).toBe(false);
    expect(zoom._active).toBe(active);
    expect(enter).not.toHaveBeenCalled();
    const planet = zoom._registry.resolve(2, zoom._backend);
    const returnEntry = vi.spyOn(planet, 'enter');
    await runtime.returnTo('planet');
    expect(returnEntry).toHaveBeenLastCalledWith(3, { colony: { id: 8 } });
  });

  it('does not overwrite return data when a surface load resolves during an unrelated departure', async () => {
    runtime = await createGameColonyZoom(options);
    const original = { colony: { id: 7 } };
    await runtime.surface(async () => original);
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    let finishLoad;
    let finishExit;
    const pending = runtime.surface(() => new Promise(resolve => { finishLoad = resolve; }));
    vi.spyOn(zoom._active, 'exit').mockImplementationOnce(() => new Promise(resolve => { finishExit = resolve; }));
    const departure = zoom.zoomTo(2, original, { skipCameraFlight: true });
    await vi.waitFor(() => expect(finishExit).toBeTypeOf('function'));
    finishLoad({ colony: { id: 8 } });
    expect(await pending).toBe(false);
    finishExit();
    await departure;
    await runtime.surface(async () => original);
    const planet = zoom._registry.resolve(2, zoom._backend);
    const enter = vi.spyOn(planet, 'enter');
    await runtime.returnTo('planet');
    expect(enter).toHaveBeenLastCalledWith(3, original);
  });

  it('propagates loader failures without losing the usable planet view', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.approach({});
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const active = zoom._active;
    const failure = new Error('Colony data failed');
    await expect(runtime.surface(async () => { throw failure; })).rejects.toBe(failure);
    expect(zoom._active).toBe(active);
    expect(zoom._activeLevel).toBe(2);
    await expect(runtime.surface(async () => ({ colony: { id: 7 } }))).resolves.toBe(true);
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

  it('does not forward controls or colony refresh while the active renderer is exiting', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.surface(async () => ({ colony: { id: 7 } }));
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const surface = zoom._active;
    const controls = ['resetView', 'rotateView', 'panView', 'zoomBy', 'selectAt', 'nudgeZoom']
      .map(name => vi.spyOn(surface, name));
    let finish;
    vi.spyOn(surface, 'exit').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const transition = zoom.zoomTo(2, {}, { skipCameraFlight: true });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    runtime.reset();
    runtime.rotateView(1, 2);
    runtime.panView(1, 2);
    runtime.zoomBy(0.1);
    runtime.selectAt(1, 2);
    runtime.nudgeZoom('in');
    runtime.refreshColony(7);
    controls.forEach(control => expect(control).not.toHaveBeenCalled());
    expect(state.refresh).not.toHaveBeenCalled();
    finish();
    await transition;
    expect(zoom._activeLevel).toBe(2);
  });

  it('does not mutate or query a renderer after its registration is replaced', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.surface(async () => ({ colony: { id: 7 } }));
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const retired = zoom._active;
    const controls = ['resetView', 'rotateView', 'panView', 'zoomBy', 'selectAt', 'nudgeZoom']
      .map(name => vi.spyOn(retired, name));
    zoom.register(3, { webgpu: class {
      async initialize() {}
      async enter() {}
      async exit() {}
      render() {}
      dispose() {}
    } });
    runtime.reset();
    runtime.rotateView(1, 2);
    runtime.panView(1, 2);
    runtime.zoomBy(0.1);
    runtime.selectAt(1, 2);
    runtime.nudgeZoom('in');
    runtime.refreshColony(7);
    controls.forEach(control => expect(control).not.toHaveBeenCalled());
    expect(state.refresh).not.toHaveBeenCalled();
    expect(zoom._active).toBeNull();
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

  it('clears the published zoom runtime even if a renderer cannot be disposed', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.approach({});
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const failure = new Error('Planet resource cleanup failed');
    zoom._active.dispose = vi.fn(() => { throw failure; });

    expect(() => runtime.dispose()).toThrow(AggregateError);
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    expect(() => runtime.dispose()).not.toThrow();
    expect(zoom._active).toBeNull();
  });

  it('reports rendering and cleanup errors together without retaining the global or hook', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.approach({});
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const cleanupFailure = new Error('Planet resource cleanup failed');
    zoom._active.dispose = vi.fn(() => { throw cleanupFailure; });
    state.renderError = new Error('Planet rendering failed');

    hooks.forEach((hook) => hook(0.016));

    expect(options.onReturn).toHaveBeenCalledOnce();
    expect(options.onError).toHaveBeenCalledOnce();
    const reported = options.onError.mock.calls[0][0];
    expect(reported).toBeInstanceOf(AggregateError);
    expect(reported.errors[0]).toBe(state.renderError);
    expect(reported.errors[1]).toBeInstanceOf(AggregateError);
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
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

  it('reports rendering, disposal and system-return failures after all cleanup attempts', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.approach({});
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const renderingFailure = new Error('Rendering failed');
    const cleanupFailure = new Error('Cleanup failed');
    const returnFailure = new Error('System return failed');
    zoom._active.dispose = vi.fn(() => { throw cleanupFailure; });
    options.onReturn.mockImplementationOnce(() => { throw returnFailure; });
    state.renderError = renderingFailure;
    const hook = [...hooks][0];
    expect(() => hook(0.016)).not.toThrow();
    expect(options.onError).toHaveBeenCalledOnce();
    const reported = options.onError.mock.calls[0][0];
    const flatten = error => error instanceof AggregateError ? error.errors.flatMap(flatten) : [error];
    expect(flatten(reported)).toEqual([renderingFailure, cleanupFailure, returnFailure]);
    expect(options.onReturn).toHaveBeenCalledOnce();
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    hook(0.016);
    expect(options.onError).toHaveBeenCalledOnce();
  });

  it('preserves the rendering error if the final error reporter also throws', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.approach({});
    const renderingFailure = new Error('Rendering failed');
    const reportingFailure = new Error('Error notification failed');
    state.renderError = renderingFailure;
    options.onError.mockImplementationOnce(() => { throw reportingFailure; });
    const hook = [...hooks][0];
    let failure;
    try { hook(0.016); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([renderingFailure, reportingFailure]);
    expect(options.onReturn).toHaveBeenCalledOnce();
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
  });

  it('settles pending flight and surface work after a rendering failure even when system return fails', async () => {
    runtime = await createGameColonyZoom(options);
    const approach = runtime.approach({}, { position: { x: 0, y: 0, z: 20 } });
    await vi.waitFor(() => expect(window.__GQ_ZOOM_ORCHESTRATOR._flight.isFlying).toBe(true));
    const surface = runtime.surface(async () => ({ colony: { id: 7 } }));
    await Promise.resolve();
    const renderingFailure = new Error('In-flight rendering failed');
    const returnFailure = new Error('System return failed');
    state.renderError = renderingFailure;
    options.onReturn.mockImplementationOnce(() => { throw returnFailure; });
    [...hooks][0](0.016);
    expect(await Promise.all([approach, surface])).toEqual([false, false]);
    expect(options.onError).toHaveBeenCalledOnce();
    expect(options.onError.mock.calls[0][0]).toMatchObject({ errors: [renderingFailure, returnFailure] });
    expect(options.onLevel).not.toHaveBeenCalled();
    expect(hooks.size).toBe(0);
  });

  it('does not publish a zoom runtime when lazy imports were cancelled', async () => {
    controller.abort();
    await expect(createGameColonyZoom(options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
  });

  it('closes an initialized runtime when its owner signal aborts', async () => {
    runtime = await createGameColonyZoom(options);
    await runtime.surface(async () => ({ colony: { id: 7 } }));
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    controller.abort();
    expect(zoom._disposed).toBe(true);
    expect(zoom._active).toBeNull();
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    expect(await runtime.approach({})).toBe(false);
    const load = vi.fn();
    expect(await runtime.surface(load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(options.onReturn).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('settles an owner-aborted flight and surface without another frame', async () => {
    runtime = await createGameColonyZoom(options);
    const approach = runtime.approach({}, { position: { x: 0, y: 0, z: 20 } });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    await vi.waitFor(() => expect(zoom._flight.isFlying).toBe(true));
    const surface = runtime.surface(async () => ({ colony: { id: 7 } }));
    await Promise.resolve();
    controller.abort();
    expect(await Promise.all([approach, surface])).toEqual([false, false]);
    expect(hooks.size).toBe(0);
    expect(options.onLevel).not.toHaveBeenCalled();
  });

  it('removes its abort listener on manual disposal and reports abort cleanup failures', async () => {
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    runtime = await createGameColonyZoom(options);
    await runtime.approach({});
    const failure = new Error('Abort cleanup failed');
    window.__GQ_ZOOM_ORCHESTRATOR._active.dispose = vi.fn(() => { throw failure; });
    controller.abort();
    expect(options.onError).toHaveBeenCalledOnce();
    const flatten = error => error instanceof AggregateError ? error.errors.flatMap(flatten) : [error];
    expect(flatten(options.onError.mock.calls[0][0])).toContain(failure);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    runtime.dispose();
    expect(options.onError).toHaveBeenCalledOnce();
  });

  it('does not retain an owner abort listener after manual disposal', async () => {
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    runtime = await createGameColonyZoom(options);
    const listener = add.mock.calls.find(([type]) => type === 'abort')?.[1];
    expect(listener).toBeTypeOf('function');
    runtime.dispose();
    expect(remove).toHaveBeenCalledWith('abort', listener);
    controller.abort();
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('cancels during backend initialization without publishing a runtime or frame hook', async () => {
    let finish;
    backend.init = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = createGameColonyZoom(options);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort();
    finish();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('removes its abort listener when backend initialization fails and permits a fresh runtime', async () => {
    const failure = new Error('Backend init failed');
    backend.init = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await expect(createGameColonyZoom(options)).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(hooks.size).toBe(0);
    expect(window.__GQ_ZOOM_ORCHESTRATOR).toBeUndefined();
    runtime = await createGameColonyZoom(options);
    await expect(runtime.approach({})).resolves.toBe(true);
    controller.abort();
    expect(hooks.size).toBe(0);
  });
});
