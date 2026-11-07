const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test('colony zoom frees every owned GPU buffer and texture across six native lifecycles', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://localhost:8080/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><div><canvas width="512" height="384" style="width:512px;height:384px"></canvas></div>' });
    if (!/^\/js\/[\w/.-]+\.js$/.test(pathname) || pathname.includes('..')) return route.abort();
    return route.fulfill({ contentType: 'application/javascript',
      body: await fs.readFile(path.join(__dirname, '../..', pathname.slice(1)), 'utf8') });
  });
  await page.goto('http://localhost:8080/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const available = await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter()));
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') {
    expect(available, 'GPU CI must provide a WebGPU adapter; lifecycle coverage must not be skipped').toBe(true);
  }
  test.skip(!available, 'No WebGPU adapter available locally');

  const result = await page.evaluate(async () => {
    const { createGameColonyZoom } = await import('/js/rendering/game-colony-zoom.js');
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
    const resources = [];
    for (const method of ['createBuffer', 'createTexture']) {
      const create = device[method].bind(device);
      device[method] = descriptor => {
        const resource = create(descriptor);
        const entry = { kind: method, label: descriptor.label || '', destroys: 0 };
        resources.push(entry);
        const destroy = resource.destroy.bind(resource);
        resource.destroy = () => { entry.destroys++; destroy(); };
        return resource;
      };
    }
    let deviceDisposals = 0;
    const destroyDevice = device.destroy.bind(device);
    device.destroy = () => { deviceDisposals++; destroyDevice(); };
    const validationErrors = [];
    device.addEventListener('uncapturederror', event => validationErrors.push(event.error.message));
    const hooks = new Set();
    const backend = {
      device, context, externalCameraControls: true,
      getCapabilities: () => ({ webgpu: true }),
      addFrameHook(hook) { hooks.add(hook); return () => hooks.delete(hook); },
      setZoomSceneActive() {},
    };
    const scene = {
      reduced_motion: true,
      colony: { name: 'GPU lifecycle fixture', diameter_km: 12, population: 0, body_type: 'asteroid' },
      bodyTerrainManifest: { body_id: 12, radius_km: 6,
        shape: { version: 1, axes: [1.45, 0.8, 0.95], deformation: 0.22 } },
      slots: [{ x: 0, z: 0, type: 'habitat', level: 2 }],
    };
    const cycles = [];
    for (let cycle = 0; cycle < 6; cycle++) {
      device.pushErrorScope('validation');
      const start = resources.length;
      const controller = new AbortController();
      const runtime = await createGameColonyZoom({
        renderer: { getSharedZoomBackend: () => backend }, canvas,
        getCameraState: () => ({ position: { x: 0, y: 0, z: 3 }, target: { x: 0, y: 0, z: 0 } }),
        onLevel() {}, onReturn() {}, onError(error) { throw error; }, signal: controller.signal,
      });
      await runtime.approach(scene);
      for (const hook of hooks) hook(0.016);
      await runtime.surface(async () => scene);
      for (const hook of hooks) hook(0.016);
      const active = window.__GQ_ZOOM_ORCHESTRATOR;
      const shared = active._active._device === device && active._active._context === context;
      const surface = active._active;
      await runtime.returnTo('planet');
      const surfaceReleased = !surface._depthTexture && !surface._terrainBuffer;
      let finishLoad;
      const pending = runtime.surface(() => new Promise(resolve => { finishLoad = resolve; }));
      await runtime.returnTo('planet');
      const beforeStaleLoad = resources.length;
      finishLoad(scene);
      const cancelledLoad = await pending === false && active._activeLevel === 2
        && resources.length === beforeStaleLoad;
      for (const hook of hooks) hook(0.016);
      await runtime.surface(async () => scene);
      for (const hook of hooks) hook(0.016);
      await device.queue.onSubmittedWorkDone();
      const allocated = resources.slice(start);
      const buffers = allocated.filter(resource => resource.kind === 'createBuffer').length;
      const textures = allocated.filter(resource => resource.kind === 'createTexture').length;
      if (cycle % 2) controller.abort();
      runtime.dispose();
      runtime.dispose();
      await device.queue.onSubmittedWorkDone();
      const validation = await device.popErrorScope();
      cycles.push({
        shared, surfaceReleased, cancelledLoad, buffers, textures, hooks: hooks.size,
        live: allocated.filter(resource => resource.destroys === 0),
        duplicateDestroys: allocated.filter(resource => resource.destroys > 1),
        globalCleared: !window.__GQ_ZOOM_ORCHESTRATOR,
        controls: document.querySelectorAll('button,[role="region"]').length,
        validation: validation?.message || null,
      });
      const probe = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(probe, 0, new Uint32Array([cycle]));
      await device.queue.onSubmittedWorkDone();
      probe.destroy();
    }
    const borrowedDeviceDisposals = deviceDisposals;
    context.unconfigure();
    destroyDevice();
    return { cycles, validationErrors, borrowedDeviceDisposals };
  });
  for (const cycle of result.cycles) {
    expect(cycle.buffers).toBeGreaterThanOrEqual(6);
    expect(cycle.textures).toBeGreaterThanOrEqual(2);
    expect(cycle).toMatchObject({
      shared: true, surfaceReleased: true, cancelledLoad: true, hooks: 0, live: [], duplicateDestroys: [],
      globalCleared: true, controls: 0, validation: null,
    });
  }
  expect(result.borrowedDeviceDisposals).toBe(0);
  expect(result.validationErrors).toEqual([]);
  expect(errors).toEqual([]);
});
