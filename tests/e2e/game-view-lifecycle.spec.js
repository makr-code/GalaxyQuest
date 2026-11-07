const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.route('http://localhost:8080/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html>
        <script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
        <div><canvas tabindex="0" style="width:800px;height:600px"></canvas></div>` });
    }
    if (!/^\/(?:js\/[\w/.-]+|node_modules\/three\/(?:build\/three\.(?:module|core)|examples\/jsm\/[\w/.-]+))\.js$/.test(pathname)
        || pathname.includes('..')) return route.abort();
    return route.fulfill({ contentType: 'application/javascript',
      body: await fs.readFile(path.join(__dirname, '../..', pathname.slice(1)), 'utf8') });
  });
  await page.goto('http://localhost:8080/');
});

test('colony bridge cancels stale loads after back navigation and permits fresh entry', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [file, name] of [
    ['PersistentBodyPlanetApproachRenderer', 'PersistentBodyPlanetApproachRenderer'],
    ['ColonySurfaceLevelWebGPU', 'ColonySurfaceLevelWebGPU'],
  ]) {
    await page.route(`**/js/engine/zoom/levels/${file}.js`, route => route.fulfill({
      contentType: 'application/javascript', body: `export class ${name} {
        async initialize() {} async enter() {} async exit() {} render() {} dispose() {}
      }`,
    }));
  }
  const result = await page.evaluate(async () => {
    const { createGameColonyZoom } = await import('/js/rendering/game-colony-zoom.js');
    const hooks = new Set();
    const backend = {
      getCapabilities: () => ({ webgpu: true }),
      addFrameHook(hook) { hooks.add(hook); return () => hooks.delete(hook); },
      setZoomSceneActive() {},
    };
    const controller = new AbortController();
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas: document.querySelector('canvas'),
      getCameraState: () => ({ position: { x: 0, y: 0, z: 15 } }),
      onLevel() {}, onReturn() {}, onError(error) { throw error; }, signal: controller.signal,
    });
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    await runtime.approach({});
    let finish;
    const pending = runtime.surface(() => new Promise(resolve => { finish = resolve; }));
    runtime.back();
    for (let step = 0; step < 20 && zoom._transition; step++) await Promise.resolve();
    const returnedLevel = zoom._activeLevel;
    finish({ colony: { id: 7 } });
    const stale = await pending;
    const unchanged = zoom._activeLevel === returnedLevel;
    const fresh = await runtime.surface(async () => ({ colony: { id: 8 } }));
    const level = zoom._activeLevel;
    controller.abort();
    const ownerClosed = zoom._disposed && zoom._active === null;
    window.lifecycleOwnerSignal = controller.signal;
    runtime.dispose();
    return { returnedLevel, stale, unchanged, fresh, level, hooks: hooks.size,
      ownerClosed, globalCleared: !window.__GQ_ZOOM_ORCHESTRATOR };
  });
  expect(result).toEqual({ returnedLevel: 1, stale: false, unchanged: true, fresh: true,
    level: 3, hooks: 0, ownerClosed: true, globalCleared: true });
  expect(errors).toEqual([]);
  const session = await page.context().newCDPSession(page);
  try {
    const { result } = await session.send('Runtime.evaluate', { expression: 'window.lifecycleOwnerSignal' });
    const { listeners } = await session.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    expect(listeners).toEqual([]);
  } finally { await session.detach(); }
});

test('fleet endpoint frame observers remain inert after transient removal failure and destroy', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = await page.evaluate(async () => {
    const { createGameGalaxyRenderer } = await import('/js/rendering/game-galaxy-renderer.js');
    const { PerspectiveSpaceFlight } = await import('/js/rendering/perspective-space-flight.js');
    const canvas = document.querySelector('canvas');
    const space = new PerspectiveSpaceFlight({ aspect: 800 / 600 });
    const hooks = new Set();
    let removes = 0;
    const renderer = {
      renderer: { domElement: canvas }, getSpaceView: () => space,
      setFlightScene: () => true, setFlightSelection() {}, setFlightHover() {},
      setSpatialLabelCallbacks() {}, setStars() {}, setSpatialLabelStars() {},
      cancelCameraFlight() {}, setGalaxyFleets() {}, getRenderStats: () => ({}),
      getSharedZoomBackend: () => ({
        addFrameHook(hook) {
          hooks.add(hook);
          return () => {
            if (++removes === 1) throw new Error('injected transient remover failure');
            hooks.delete(hook);
          };
        },
      }),
    };
    window.GQAuthGalaxyBackgroundControl = {
      acquireGameView: async () => renderer, getVisualStars: () => [], returnToMenu() {},
    };
    const adapter = await createGameGalaxyRenderer(canvas.parentElement, { onError() {} });
    const projections = [];
    const remove = adapter.observeFleetEndpoints(() => [], points => projections.push(points));
    const observer = [...hooks][0];
    projections.length = 0;
    let removeFailed = false;
    try { remove(); } catch { removeFailed = true; }
    observer();
    const afterFailedRemove = projections.length;
    let destroyFailed = false;
    try { adapter.destroy(); } catch { destroyFailed = true; }
    observer();
    const afterDestroy = projections.length;
    adapter.destroy();
    space.dispose();
    return { removeFailed, afterFailedRemove, destroyFailed, afterDestroy, hooks: hooks.size };
  });
  expect(result).toEqual({ removeFailed: true, afterFailedRemove: 0, destroyFailed: false,
    afterDestroy: 0, hooks: 0 });
  expect(errors).toEqual([]);
});

test('in-game galaxy adapter releases native input and frame hooks across repeated mounts and teardown failures', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const results = await page.evaluate(async () => {
    const { createGameGalaxyRenderer } = await import('/js/rendering/game-galaxy-renderer.js');
    const { PerspectiveSpaceFlight } = await import('/js/rendering/perspective-space-flight.js');
    const canvas = document.querySelector('canvas');
    const space = new PerspectiveSpaceFlight({ aspect: 800 / 600 });
    const hooks = new Set();
    let returns = 0;
    let backendDisposals = 0;
    let labelCallbacks;
    const raw = {
      renderer: { domElement: canvas }, getSpaceView: () => space,
      setFlightScene: scene => scene.sceneGraph ? space.setSystem(scene) : true,
      setFlightSelection() {}, setFlightHover() {},
      setSpatialLabelCallbacks(callbacks) { labelCallbacks = callbacks; },
      setStars() {}, setSpatialLabelStars() {},
      cancelCameraFlight: () => space.stop(),
      setGalaxyFleets: fleets => space.setGalaxyFleets(fleets),
      getRenderStats: () => ({ backend: 'webgpu' }),
      getSharedZoomBackend: () => ({
        addFrameHook(hook) { hooks.add(hook); return () => hooks.delete(hook); },
      }),
      dispose() { backendDisposals++; },
    };
    window.GQAuthGalaxyBackgroundControl = {
      acquireGameView: async () => raw, getVisualStars: () => [], returnToMenu() { returns++; },
    };
    const star = { galaxy_index: 1, system_index: 10, x_ly: 23000, y_ly: 14000, z_ly: 100 };
    const payload = { galaxy: 1, system: 10, planets: [
      { position: 3, player_planet: { position: 3, name: 'Home', diameter_km: 12000, semi_major_axis_au: 1 } },
    ] };
    const snapshots = [];
    for (let cycle = 0; cycle < 8; cycle++) {
      let disposedZoom = 0;
      const failCleanup = cycle === 7;
      const reported = [];
      let failureReported;
      const failureReady = new Promise(resolve => { failureReported = resolve; });
      const adapter = await createGameGalaxyRenderer(canvas.parentElement, {
        onError(error) { reported.push(error.message); failureReported(); },
        loadColonyData: async () => ({ colony: { id: 1 } }),
        createZoomRuntime: async ({ onLevel }) => {
          let activeLevel = null;
          return {
            approach: async () => { activeLevel = 2; onLevel('planet'); },
            surface: async () => { activeLevel = null; throw new Error('Injected entry failure'); },
            getStats: () => ({ level: activeLevel }),
            dispose() {
              disposedZoom++;
              if (failCleanup) throw new Error('Injected zoom cleanup failure');
            },
          };
        },
      });
      adapter.setStars([star]);
      adapter.fitCameraToStars();
      adapter.enterSystemView(star, payload);
      adapter.focusPlanet(3);
      await Promise.resolve();
      await Promise.resolve();
      let recoveredLevel = null;
      if (cycle === 0) {
        adapter.focusColony(3);
        await failureReady;
        recoveredLevel = adapter.getRenderStats().cameraControl.level;
        adapter.focusPlanet(3);
        await Promise.resolve();
        await Promise.resolve();
      }
      const removeObserver = adapter.observeFleetEndpoints(() => [], () => {});
      const activeHooks = hooks.size;
      let failure = null;
      try { adapter.destroy(); } catch (error) { failure = error.message; }
      adapter.destroy();
      removeObserver();
      snapshots.push({ activeHooks, hooks: hooks.size, disposedZoom, failure,
        labelCallbacksCleared: labelCallbacks === null, returns, reported, recoveredLevel });
    }
    window.lifecycleCanvas = canvas;
    space.dispose();
    return { snapshots, backendDisposals };
  });
  for (const [index, cycle] of results.snapshots.entries()) {
    expect(cycle).toMatchObject({
      activeHooks: 1, hooks: 0, disposedZoom: index === 0 ? 2 : 1,
      labelCallbacksCleared: true, returns: index + 1,
    });
    if (index === 7) expect(cycle.failure).toBeTruthy();
    else expect(cycle.failure).toBeNull();
    expect(cycle.reported).toEqual(index === 0 ? ['Injected entry failure'] : []);
    expect(cycle.recoveredLevel).toBe(index === 0 ? 'system' : null);
  }
  const session = await page.context().newCDPSession(page);
  try {
    const { result } = await session.send('Runtime.evaluate', { expression: 'window.lifecycleCanvas' });
    const { listeners } = await session.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    expect(listeners).toEqual([]);
  } finally {
    await session.detach();
  }
  expect(results.backendDisposals).toBe(0);
  expect(errors).toEqual([]);
});
