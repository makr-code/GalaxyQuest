const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

test('colony city uses the live galaxy device, canvas and frame loop', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://localhost/colony-city-test', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<html><body style="margin:0"><div id="host" style="position:relative;width:1000px;height:700px"><canvas id="galaxy" style="width:100%;height:100%"></canvas></div></body></html>',
  }));
  let requests = 0;
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
    'js/rendering/Galaxy3DRendererWebGPU.js',
    'js/engine/zoom/IZoomLevelRenderer.js',
    'js/engine/zoom/RendererRegistry.js',
    'js/engine/zoom/CameraFlightPath.js',
    'js/engine/zoom/SeamlessZoomOrchestrator.js',
    'js/engine/zoom/levels/GalaxyLevelWebGPU.js',
    'js/engine/zoom/levels/SystemLevelWebGPU.js',
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
  const point = await page.evaluate(() => {
    const city = window.cityTest.orchestrator._active;
    const slot = city._slots.at(-1);
    const matrix = city._viewProjection;
    const w = matrix[3] * slot.x + matrix[7] + matrix[11] * slot.z + matrix[15];
    const x = (matrix[0] * slot.x + matrix[4] + matrix[8] * slot.z + matrix[12]) / w;
    const y = (matrix[1] * slot.x + matrix[5] + matrix[9] * slot.z + matrix[13]) / w;
    const rect = city._canvas.getBoundingClientRect();
    return { x: rect.left + (x + 1) * rect.width / 2, y: rect.top + (1 - y) * rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('region', { name: 'Colony surface simulation' })).toContainText('research lab · Level 5');
  const galaxyPan = await page.evaluate(() => ({ ...window.cityTest.renderer._view }));
  await page.mouse.move(750, 500);
  await page.mouse.down();
  await page.mouse.move(800, 530, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => ({ ...window.cityTest.renderer._view }))).toEqual(galaxyPan);
  expect(requests).toBe(1);
  await page.getByRole('button', { name: 'Back to orbit' }).click();
  await expect(page.getByRole('region', { name: 'Colony surface simulation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.cityTest.renderer._zoomSceneActive)).toBe(false);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.cityTest.orchestrator.dispose());
});
