const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

const scripts = [
  'js/runtime/audio.js',
  'js/engine/zoom/IZoomLevelRenderer.js',
  'js/engine/zoom/RendererRegistry.js',
  'js/engine/zoom/CameraFlightPath.js',
  'js/engine/zoom/SeamlessZoomOrchestrator.js',
  'js/engine/zoom/levels/GalaxyLevelWebGPU.js',
  'js/engine/zoom/levels/SystemLevelWebGPU.js',
];

test.beforeEach(async ({ page }) => {
  const sources = new Map(await Promise.all(scripts.map(async file => [
    `/${file}`, await fs.readFile(path.join(__dirname, '../..', file), 'utf8'),
  ])));
  const wav = Buffer.alloc(44 + 160000);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);

  await page.route('http://localhost:8080/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') {
      return route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><title>Lifecycle regression</title><div><canvas></canvas></div>' });
    }
    if (sources.has(pathname)) {
      return route.fulfill({ contentType: 'application/javascript', body: sources.get(pathname) });
    }
    if (pathname === '/clip.wav') return route.fulfill({ contentType: 'audio/wav', body: wav });
    return route.abort();
  });
  await page.goto('http://localhost:8080/');
  for (const file of scripts) await page.addScriptTag({ url: `/${file}` });
  await page.evaluate(() => {
    const pendingTimeouts = new Set();
    const pendingFrames = new Set();
    const setTimeout = window.setTimeout.bind(window);
    const clearTimeout = window.clearTimeout.bind(window);
    const requestFrame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      const id = setTimeout(() => {
        pendingTimeouts.delete(id);
        callback(...args);
      }, delay);
      pendingTimeouts.add(id);
      return id;
    };
    window.clearTimeout = id => { pendingTimeouts.delete(id); clearTimeout(id); };
    window.requestAnimationFrame = callback => {
      const id = requestFrame(timestamp => {
        pendingFrames.delete(id);
        callback(timestamp);
      });
      pendingFrames.add(id);
      return id;
    };
    window.cancelAnimationFrame = id => { pendingFrames.delete(id); cancelFrame(id); };
    window.lifecycleResources = { pendingTimeouts, pendingFrames, media: [], oscillators: [] };
  });
});

async function remainingNativeListeners(page, collection) {
  const session = await page.context().newCDPSession(page);
  try {
    const { result } = await session.send('Runtime.evaluate', {
      expression: `window.lifecycleResources.${collection}`,
    });
    const { result: properties } = await session.send('Runtime.getProperties', {
      objectId: result.objectId, ownProperties: true,
    });
    const counts = await Promise.all(properties.filter(property => /^\d+$/.test(property.name))
      .map(async property => {
        const { listeners } = await session.send('DOMDebugger.getEventListeners', {
          objectId: property.value.objectId,
        });
        return listeners.length;
      }));
    return counts.reduce((total, count) => total + count, 0);
  } finally {
    await session.detach();
  }
}

test('real audio releases media, native listeners, timers and contexts across eight lifecycles', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const cycles = await page.evaluate(async () => {
    const snapshots = [];
    for (let cycle = 0; cycle < 8; cycle++) {
      const manager = new window.GQAudioManager({ storageKey: 'lifecycle-audio' });
      await manager.setMusicTrack('/clip.wav', true);
      manager._playSfx('/clip.wav');
      const teaser = manager.playTeaser('/clip.wav', { duck: false });
      const tts = manager.playTtsAudio('/clip.wav');
      const external = new Audio('/clip.wav');
      await external.play();
      manager.trackTtsAudio(external);
      manager.trackTtsAudio(external);
      const media = [manager._musicA, manager._musicB, ...manager._transientAudioCleanup.keys()];
      window.lifecycleResources.media.push(...media, external);
      manager._playTone(300, 2);
      const context = manager._audioContext;
      window.lifecycleResources.oscillators.push(...manager._activeToneOscillators.keys());
      manager._scheduleTimeout(() => { throw new Error('Disposed SFX timer fired'); }, 60000);
      manager.duckMusic(60000);
      const fade = manager._fadeMusicTo(0, 60000);
      const active = {
        musicPlaying: !manager._music.paused,
        externalPlaying: !external.paused,
        clips: Number(Boolean(teaser)) + Number(Boolean(tts)),
        context: context.state,
        timers: window.lifecycleResources.pendingTimeouts.size,
        frames: window.lifecycleResources.pendingFrames.size,
      };
      await manager.dispose();
      await manager.dispose();
      snapshots.push({
        active,
        fade: await fade,
        mediaStopped: media.every(audio => audio.paused),
        sourcesRemoved: media.every(audio => !audio.hasAttribute('src')),
        externalPlaying: !external.paused,
        context: context.state,
        timers: window.lifecycleResources.pendingTimeouts.size,
        frames: window.lifecycleResources.pendingFrames.size,
      });
      external.pause();
      external.removeAttribute('src');
      external.load();
    }
    return snapshots;
  });
  for (const cycle of cycles) {
    expect(cycle.active).toMatchObject({ musicPlaying: true, externalPlaying: true, clips: 2, context: 'running' });
    expect(cycle.active.timers).toBeGreaterThanOrEqual(2);
    expect(cycle.active.frames).toBeGreaterThanOrEqual(1);
    expect(cycle).toMatchObject({
      fade: false, mediaStopped: true, sourcesRemoved: true,
      externalPlaying: true, context: 'closed', timers: 0, frames: 0,
    });
  }
  expect(await remainingNativeListeners(page, 'media')).toBe(0);
  expect(await remainingNativeListeners(page, 'oscillators')).toBe(0);
  expect(errors).toEqual([]);
});

test('flight driver and invalid time failures settle promises before final-frame success', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { CameraFlightPath } = window.GQCameraFlightPath;
    const results = [];
    for (const stage of ['time', 'position', 'target', 'controls', 'lookAt']) {
      for (const duration of [16, 100]) {
        const flight = new CameraFlightPath();
        const failure = new Error(`${stage} driver failed`);
        const fail = () => { throw failure; };
        const camera = { position: {}, lookAt: fail };
        const controls = { target: { set() {} }, update() {} };
        if (stage === 'position') Object.defineProperty(camera.position, 'x', { set: fail });
        if (stage === 'target') controls.target.set = fail;
        if (stage === 'controls') controls.update = fail;
        const pending = flight.flyTo({ z: 100 }, { z: 15 }, duration)
          .then(() => false, error => stage === 'time' ? error instanceof TypeError : error === failure);
        let thrown = false;
        try {
          if (stage === 'time') flight.tick(NaN);
          else flight.update({ camera, controls: stage === 'lookAt' ? null : controls });
        } catch (error) {
          thrown = stage === 'time' ? error instanceof TypeError : error === failure;
        }
        const rejected = await pending;
        const released = !flight.isFlying && flight._targetRef === null;
        const retry = flight.flyTo({ z: 100 }, { z: 15 }, 16);
        const retryCamera = { position: {}, lookAt() {} };
        flight.update({ camera: retryCamera });
        await retry;
        results.push({ thrown, rejected, released, finalZ: retryCamera.position.z });
      }
    }
    return results;
  });
  expect(results).toHaveLength(10);
  for (const result of results) expect(result).toEqual({ thrown: true, rejected: true, released: true, finalZ: 15 });
});

test('invalid flight setup preserves the current flight and respects setup cancellation', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { CameraFlightPath } = window.GQCameraFlightPath;
    const results = [];
    for (const method of ['flyTo', 'flyToBuilding']) {
      const flight = new CameraFlightPath();
      const pending = flight.flyTo({ z: 100 }, { z: 15 }, 100);
      flight.tick(0.016);
      const progress = flight.t;
      let failures = 0;
      for (const opts of [{ target: { x: Infinity, y: 0, z: 0 } }, { collisionRadius: -1 }, { starBlur: NaN }]) {
        try { flight[method]({}, {}, 100, opts); } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          failures++;
        }
      }
      const preserved = flight.t === progress;
      const final = flight.tick(1);
      await pending;
      await flight[method]({}, {}, 100, {
        target: () => { flight.dispose(); return { x: 0, y: 0, z: 0 }; },
      });
      results.push({ failures, preserved, destination: final.position.z, idle: !flight.isFlying,
        targetReleased: flight._targetRef === null });
    }
    return results;
  });
  expect(results).toEqual(Array(2).fill({
    failures: 3, preserved: true, destination: 15, idle: true, targetReleased: true,
  }));
});

test('flight callback failures reject transitions and allow retry without leaking hooks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const results = await page.evaluate(async () => {
    const { SeamlessZoomOrchestrator, ZOOM_LEVEL } = window.GQSeamlessZoomOrchestrator;
    const results = [];
    for (const stage of ['atmosphere', 'blur', 'target']) {
      for (const dt of [0.016, 1]) {
        const hooks = new Set();
        let releases = 0;
        const zoom = new SeamlessZoomOrchestrator(document.querySelector('canvas'), {
          backend: {
            getCapabilities: () => ({ webgpu: true }),
            addFrameHook(hook) { hooks.add(hook); return () => hooks.delete(hook); },
            setZoomSceneActive() {},
          },
        });
        zoom.register(ZOOM_LEVEL.PLANET_APPROACH, { webgpu: class {
          async initialize() {}
          async enter() {}
          render() {}
          dispose() { releases++; }
        } });
        await zoom.initialize();
        let fail = false;
        const failure = new Error(`${stage} failed`);
        const effect = () => { if (fail) throw failure; };
        const pending = zoom.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {}, {
          flyDuration: 100,
          cameraTarget: () => {
            if (stage === 'target') effect();
            return { x: 0, y: 0, z: 0 };
          },
          onAtmosphereScale: stage === 'atmosphere' ? effect : null,
          onStarBlur: stage === 'blur' ? effect : null,
        }).then(() => false, error => error === failure);
        for (let step = 0; step < 10 && !zoom._flight.isFlying; step++) await Promise.resolve();
        if (!zoom._flight.isFlying) throw new Error('Flight did not start');
        fail = true;
        let thrown = false;
        try { [...hooks][0](dt); } catch (error) { thrown = error === failure; }
        const rejected = await pending;
        const cleared = zoom._active === null && zoom._flight._targetRef === null;
        await zoom.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {}, { skipCameraFlight: true });
        const retried = zoom._activeLevel === ZOOM_LEVEL.PLANET_APPROACH;
        zoom.dispose();
        results.push({ thrown, rejected, cleared, retried, releases, hooks: hooks.size,
          frames: window.lifecycleResources.pendingFrames.size });
      }
    }
    return results;
  });
  expect(results).toHaveLength(6);
  for (const result of results) expect(result).toEqual({
    thrown: true, rejected: true, cleared: true, retried: true, releases: 2, hooks: 0, frames: 0,
  });
  expect(errors).toEqual([]);
});

test('zoom wrappers preserve a borrowed backend and remove hooks and RAFs across sixteen lifecycles', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { SeamlessZoomOrchestrator, ZOOM_LEVEL } = window.GQSeamlessZoomOrchestrator;
    const hooks = new Set();
    let backendDisposals = 0;
    const backend = {
      backendType: 'webgpu',
      getCapabilities: () => ({ webgpu: true }),
      init: async () => {},
      setStars() {},
      enterSystemView() {},
      exitSystemView() {},
      setZoomSceneActive() {},
      addFrameHook(callback) { hooks.add(callback); return () => hooks.delete(callback); },
      dispose() { backendDisposals++; },
    };
    const snapshots = [];
    for (let cycle = 0; cycle < 16; cycle++) {
      const orchestrator = new SeamlessZoomOrchestrator(document.querySelector('canvas'),
        cycle % 2 ? { backend } : { _backend: backend });
      orchestrator.register(ZOOM_LEVEL.GALAXY, { webgpu: window.GQGalaxyLevelWebGPU.GalaxyLevelWebGPU });
      orchestrator.register(ZOOM_LEVEL.SYSTEM, { webgpu: window.GQSystemLevelWebGPU.SystemLevelWebGPU });
      await orchestrator.initialize();
      for (let transition = 0; transition < 3; transition++) {
        await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null);
        await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, { star: { id: 1 } });
      }
      const active = { hooks: hooks.size, frames: window.lifecycleResources.pendingFrames.size };
      let replacement = null;
      if (cycle % 4 >= 2) {
        const retired = orchestrator._active;
        let retiredRenders = 0;
        retired.render = () => { retiredRenders++; };
        orchestrator.register(ZOOM_LEVEL.SYSTEM, { webgpu: window.GQSystemLevelWebGPU.SystemLevelWebGPU });
        orchestrator.tick(0.016);
        replacement = { detached: orchestrator._active === null, released: retired._backend === null,
          retiredRenders };
        await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, { star: { id: 2 } });
        replacement.fresh = orchestrator._active !== retired && orchestrator._activeLevel === ZOOM_LEVEL.SYSTEM;
      }
      if (cycle % 4 < 2) {
        orchestrator.on('exitLevel', () => orchestrator.dispose());
        await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null);
      }
      orchestrator.dispose();
      orchestrator.dispose();
      snapshots.push({ active, replacement, hooks: hooks.size, frames: window.lifecycleResources.pendingFrames.size,
        registry: orchestrator._registry._instances.size, listeners: orchestrator._listeners.size,
        activeLevel: orchestrator._activeLevel });
    }
    return { snapshots, backendDisposals };
  });
  for (const [index, cycle] of result.snapshots.entries()) {
    expect(cycle.active).toEqual(index % 2 ? { hooks: 1, frames: 0 } : { hooks: 0, frames: 1 });
    expect(cycle).toMatchObject({ hooks: 0, frames: 0, registry: 0, listeners: 0, activeLevel: null });
    if (index % 4 >= 2) expect(cycle.replacement).toEqual({ detached: true, released: true, retiredRenders: 0, fresh: true });
  }
  expect(result.backendDisposals).toBe(0);
});
