const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

test('colony city uses the live galaxy device, canvas and frame loop', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://localhost/colony-city-test', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<html><body style="margin:0"><div id="host" style="position:relative;width:1000px;height:700px"><canvas id="galaxy" style="width:100%;height:100%"></canvas></div></body></html>',
  }));
  let requests = 0;
  await page.route('**/api/auth.php?action=csrf', (route) => route.fulfill({
    json: { success: true, token: 'terrain-test-csrf' },
  }));
  await page.route('**/api/terrain.php?*', (route) => route.fulfill({
    status: 503, json: { success: false, error: 'Terrain rollout not installed in preview fixture' },
  }));
  await page.route('**/api/colony_economy.php?*', (route) => {
    requests++;
    return route.fulfill({ json: {
      success: true,
      colony: { id: 7, name: 'New Dawn', population: 40000, happiness: 73 },
      economy: { settled_at: '2026-11-02 06:00:00', shortages: { food: 12 }, production: { food: 24 } },
      pop_classes: { colonist: 40000 },
      buildings: [],
      slots: ['habitat', 'factory', 'fusion_reactor', 'farm', 'research_lab'].map((type, i) => ({
        slot_x: i % 3 + 1, slot_y: Math.floor(i / 3) + 1, building_type: type, level: i + 1,
      })),
    } });
  });
  await page.goto('http://localhost/colony-city-test');
  const available = await page.evaluate(async () => !!navigator.gpu && !!await navigator.gpu.requestAdapter());
  test.skip(!available, 'No WebGPU adapter available');
  for (const file of [
    'js/runtime/galaxy-chunk-utils.js',
    'js/rendering/body-material.js',
    'js/rendering/colony-surface-plan.js',
    'js/rendering/Galaxy3DRendererWebGPU.js',
    'js/engine/zoom/IZoomLevelRenderer.js',
    'js/engine/zoom/RendererRegistry.js',
    'js/engine/zoom/CameraFlightPath.js',
    'js/engine/zoom/SeamlessZoomOrchestrator.js',
    'js/engine/zoom/levels/GalaxyLevelWebGPU.js',
    'js/engine/zoom/levels/SystemLevelWebGPU.js',
    'js/rendering/planet-textures.js',
    'js/engine/zoom/levels/PlanetLivingWorld.js',
    'js/engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js',
    'js/engine/zoom/levels/PlanetApproachLevelWebGPU.js',
    'js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js',
  ]) await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });

  const initial = await page.evaluate(async () => {
    const canvas = document.querySelector('#galaxy');
    const renderer = new window.GQGalaxy3DRendererWebGPU(document.querySelector('#host'), { externalCanvas: canvas });
    const { SeamlessZoomOrchestrator } = window.GQSeamlessZoomOrchestrator;
    const orchestrator = new SeamlessZoomOrchestrator(canvas, { backend: renderer, requireSharedBackend: true });
    orchestrator.register(0, { webgpu: window.GQGalaxyLevelWebGPU.GalaxyLevelWebGPU });
    orchestrator.register(1, { webgpu: window.GQSystemLevelWebGPU.SystemLevelWebGPU });
    orchestrator.register(2, { webgpu: window.GQPlanetApproachLevelWebGPU.PlanetApproachLevelWebGPU });
    orchestrator.register(3, { webgpu: window.GQColonySurfaceLevelWebGPU.ColonySurfaceLevelWebGPU });
    await orchestrator.initialize();
    if (!renderer.device) throw new Error('Native renderer did not expose its shared GPU device');
    const validationErrors = [];
    renderer.device.addEventListener('uncapturederror', (event) => validationErrors.push(event.error.message));
    await orchestrator.zoomTo(0, null);
    const canvases = document.querySelectorAll('canvas').length;
    renderer.device.pushErrorScope('validation');
    await orchestrator.zoomTo(2, { colony_id: 7, name: 'New Dawn' }, { flyDuration: 100 });
    window.cityTest = { orchestrator, renderer, validationErrors };
    return { canvases, backend: renderer.backendType };
  });
  expect(initial.backend).toBe('webgpu');
  expect(requests).toBe(0);
  await page.getByRole('button', { name: /Land on colony/ }).click();
  await expect(page.getByRole('region', { name: 'Colony surface simulation' })).toContainText('Colony shortage: food');
  await expect.poll(() => page.evaluate(() => window.cityTest.orchestrator._active._camera.progress)).toBe(1);
  const rendered = await page.evaluate(async () => {
    const { renderer, orchestrator } = window.cityTest;
    await renderer.device.queue.onSubmittedWorkDone();
    const scoped = await renderer.device.popErrorScope();
    const city = orchestrator._active;
    return {
      scoped: scoped?.message || null,
      errors: window.cityTest.validationErrors,
      shared: city._device === renderer.device && city._context === renderer.context && city._canvas === renderer.renderer.domElement,
      canvases: document.querySelectorAll('canvas').length,
      hooks: renderer._frameHooks.size,
      independentRaf: orchestrator._rafId,
      buildings: city._slots.length,
      people: city._people.length,
      frames: renderer._frameTick,
    };
  });
  expect(rendered).toMatchObject({
    scoped: null, errors: [], shared: true, canvases: initial.canvases, hooks: 1, independentRaf: 0, buildings: 5, people: 96,
  });
  expect(rendered.frames).toBeGreaterThan(2);
  const terrainBuffers = await page.evaluate(() => {
    const city = window.cityTest.orchestrator._active;
    const buffer = city._terrainBuffer;
    const span = city._camera.span;
    city.setSceneData({ ...city._sceneData });
    city._setCameraSpan(span);
    city.render(0);
    return { reused: city._terrainBuffer === buffer, vertices: city._terrainVertexCount, bytes: buffer.size };
  });
  expect(terrainBuffers).toMatchObject({ reused: true, vertices: 79872 });
  expect(terrainBuffers.bytes).toBeLessThan(2.5 * 1024 * 1024);
  const adaptiveDetail = await page.evaluate(() => {
    const { orchestrator, renderer } = window.cityTest;
    const city = orchestrator._active;
    const hooks = [...renderer._frameHooks];
    renderer._frameHooks.clear();
    const span = city._camera.span;
    const original = city._terrainBuffer;
    try {
      city._setCameraSpan(9);
      city.render(0);
      const near = { lod: city._terrainLod, vertices: city._terrainVertexCount };
      city._setCameraSpan(city._entrySpan);
      city.render(0);
      const far = { lod: city._terrainLod, vertices: city._terrainVertexCount };
      city._setCameraSpan(span);
      city.render(0);
      return {
        near, far, reused: city._terrainBuffer === original, cacheBytes: city._terrainCacheBytes,
        hooks: hooks.length, independentRaf: orchestrator._rafId,
      };
    } finally {
      for (const hook of hooks) renderer._frameHooks.add(hook);
    }
  });
  expect(adaptiveDetail).toMatchObject({
    near: { lod: 3, vertices: 161280 }, far: { lod: 0, vertices: 6144 },
    reused: true, hooks: 1, independentRaf: 0,
  });
  expect(adaptiveDetail.cacheBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  await page.locator('#host').screenshot({ path: testInfo.outputPath('colony-view.png') });
  const clouds = await page.evaluate(() => {
    const { orchestrator, renderer } = window.cityTest;
    const city = orchestrator._active;
    window.cityTest.cloudHooks = [...renderer._frameHooks];
    window.cityTest.atmosphereStrength = city._bodySurface.atmosphere.strength;
    renderer._frameHooks.clear();
    let peak = { fogOpacity: 0, progress: 0 };
    for (let frame = 0; frame <= 30; frame++) {
      city._camera.progress = frame / 30;
      city._zoomMultiplier = 1;
      city.render(0);
      if (city._atmosphereState.fogOpacity > peak.fogOpacity) {
        peak = { ...city._atmosphereState, progress: frame / 30 };
      }
    }
    const landed = { ...city._atmosphereState };
    city._camera.progress = peak.progress;
    city._zoomMultiplier = 1;
    city.render(0);
    return { peak, landed };
  });
  let brightnessIncrease;
  try {
    const cloudImage = await page.locator('#host').screenshot({ path: testInfo.outputPath('colony-cloud-crossing.png') });
    await page.evaluate(() => {
      const city = window.cityTest.orchestrator._active;
      city._bodySurface.atmosphere.strength = 0;
      city.render(0);
    });
    const clearImage = await page.locator('#host').screenshot();
    brightnessIncrease = await page.evaluate(async ({ cloudy, clear }) => {
      const average = async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const sample = new OffscreenCanvas(32, 32);
        const context = sample.getContext('2d');
        context.drawImage(bitmap, 0, 0, 32, 32);
        bitmap.close();
        const { data } = context.getImageData(0, 0, 32, 32);
        let total = 0;
        for (let i = 0; i < data.length; i += 4) total += (data[i] + data[i + 1] + data[i + 2]) / 3;
        return total / (32 * 32);
      };
      return await average(cloudy) - await average(clear);
    }, { cloudy: cloudImage.toString('base64'), clear: clearImage.toString('base64') });
  } finally {
    await page.evaluate(() => {
      const { orchestrator, renderer, cloudHooks, atmosphereStrength } = window.cityTest;
      const city = orchestrator._active;
      city._bodySurface.atmosphere.strength = atmosphereStrength;
      city._camera.progress = 1;
      city._zoomMultiplier = 1;
      city.render(0);
      for (const hook of cloudHooks) renderer._frameHooks.add(hook);
    });
  }
  expect(clouds.peak.fogOpacity).toBeGreaterThan(0.5);
  expect(clouds.landed.belowClouds).toBe(true);
  expect(clouds.landed.fogOpacity).toBeLessThan(0.05);
  expect(brightnessIncrease).toBeGreaterThan(20);
  const point = await page.evaluate(() => {
    const city = window.cityTest.orchestrator._active;
    const slot = city._slots.at(-1);
    const radius = city._bodySurface.radius;
    const distance = Math.hypot(slot.x, slot.z);
    const angle = distance / radius;
    const scale = distance > 0.0001 ? Math.sin(angle) / distance : 0;
    const point = [slot.x * scale * (radius + 1), Math.cos(angle) * (radius + 1) - radius, slot.z * scale * (radius + 1)];
    const matrix = city._viewProjection;
    const w = matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15];
    const x = (matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12]) / w;
    const y = (matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13]) / w;
    const rect = city._canvas.getBoundingClientRect();
    return { x: rect.left + (x + 1) * rect.width / 2, y: rect.top + (1 - y) * rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('region', { name: 'Colony surface simulation' })).toContainText('research lab · Level 5');
  await page.evaluate(() => {
    const city = window.cityTest.orchestrator._active;
    window.cityTest.surface = city;
    window.cityTest.cityPose = { target: { ...city._camera.target }, span: city._camera.span };
    window.cityTest.resources = [city._instanceBuffer, city._cameraBuffer, city._depthTexture];
  });
  await page.getByRole('button', { name: 'Focus building' }).click();
  await expect.poll(() => page.evaluate(() => {
    const city = window.cityTest.orchestrator._active;
    return city._cameraFocus === null && Math.abs(city._camera.span - 9) < 0.001;
  })).toBe(true);
  expect(await page.evaluate(() => {
    const city = window.cityTest.orchestrator._active;
    return {
      targetMatchesSelection: city._camera.target.x === city._selected.x && city._camera.target.z === city._selected.z,
      hooks: window.cityTest.renderer._frameHooks.size,
      raf: window.cityTest.orchestrator._rafId,
      depth: window.cityTest.orchestrator._activeLevel,
      sameSurface: city === window.cityTest.surface,
      sameResources: window.cityTest.resources.every((resource, index) =>
        resource === [city._instanceBuffer, city._cameraBuffer, city._depthTexture][index]),
      separateBuildingScene: window.cityTest.orchestrator._registry._instances.has(5),
    };
  })).toEqual({
    targetMatchesSelection: true, hooks: 1, raf: 0, depth: 5,
    sameSurface: true, sameResources: true, separateBuildingScene: false,
  });
  await page.getByRole('button', { name: 'Back to colony' }).click();
  await expect.poll(() => page.evaluate(() => {
    const { orchestrator, cityPose } = window.cityTest;
    const city = orchestrator._active;
    return orchestrator._activeLevel === 3 && city._cameraFocus === null
      && Math.abs(city._camera.span - cityPose.span) < 0.001
      && city._camera.target.x === cityPose.target.x && city._camera.target.z === cityPose.target.z;
  })).toBe(true);
  await page.mouse.move(750, 500);
  for (let step = 0; step < 15; step++) {
    if (await page.evaluate(() => window.cityTest.orchestrator._activeLevel === 5)) break;
    await page.mouse.wheel(0, -150);
    await page.waitForTimeout(50);
  }
  await expect.poll(() => page.evaluate(() => window.cityTest.orchestrator._activeLevel)).toBe(5);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.cityTest.orchestrator._activeLevel)).toBe(3);
  await expect.poll(() => page.evaluate(() => window.cityTest.orchestrator._active._cameraFocus)).toBeNull();
  const galaxyPan = await page.evaluate(() => ({ ...window.cityTest.renderer._view }));
  await page.mouse.move(750, 500);
  await page.mouse.down();
  await page.mouse.move(800, 530, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => ({ ...window.cityTest.renderer._view }))).toEqual(galaxyPan);
  expect(requests).toBe(1);
  expect(await page.evaluate(() => window.cityTest.validationErrors)).toEqual([]);
  await page.evaluate(() => {
    const { orchestrator, renderer } = window.cityTest;
    window.cityTest.terrainHooks = [...renderer._frameHooks];
    renderer._frameHooks.clear();
    window.cityTest.terrainScene = orchestrator._active._sceneData;
  });
  const biomePixels = {};
  try {
    for (const kind of ['ocean', 'ice_dwarf', 'desert', 'volcanic']) {
      await page.evaluate((planetClass) => {
        const { orchestrator, terrainScene } = window.cityTest;
        const city = orchestrator._active;
        city.setSceneData({
          ...terrainScene,
          focusPlanet: { id: 7, planet_class: planetClass, atmosphere_type: 'none' },
        });
        city._camera.progress = 1;
        city._camera.target = { x: 0, z: 0 };
        city._setCameraSpan(city._citySpan * 2);
        city.render(0);
      }, kind);
      const image = await page.locator('#host').screenshot({ path: testInfo.outputPath(`colony-terrain-${kind}.png`) });
      biomePixels[kind] = await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const sample = new OffscreenCanvas(32, 32);
        const context = sample.getContext('2d');
        context.drawImage(bitmap, 400, 0, 600, 700, 0, 0, 32, 32);
        bitmap.close();
        const { data } = context.getImageData(0, 0, 32, 32);
        const rgb = [0, 0, 0];
        for (let i = 0; i < data.length; i += 4) {
          for (let channel = 0; channel < 3; channel++) rgb[channel] += data[i + channel] / (32 * 32);
        }
        return rgb;
      }, image.toString('base64'));
    }
  } finally {
    await page.evaluate(() => {
      const { orchestrator, renderer, terrainHooks, terrainScene } = window.cityTest;
      orchestrator._active.setSceneData(terrainScene);
      for (const hook of terrainHooks) renderer._frameHooks.add(hook);
    });
  }
  expect(biomePixels.ocean[2] - biomePixels.ocean[0]).toBeGreaterThan(10);
  expect(biomePixels.ice_dwarf[2]).toBeGreaterThan(biomePixels.ocean[2] + 30);
  expect(biomePixels.desert[0] - biomePixels.desert[2]).toBeGreaterThan(15);
  expect(biomePixels.volcanic[0] - biomePixels.volcanic[2]).toBeGreaterThan(15);
  expect(await page.evaluate(() => window.cityTest.validationErrors)).toEqual([]);
  await page.getByRole('button', { name: 'Back to orbit' }).click();
  await expect(page.getByRole('region', { name: 'Colony surface simulation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.cityTest.renderer._zoomSceneActive)).toBe(false);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.cityTest.orchestrator.dispose());
});
