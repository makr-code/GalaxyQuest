const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

test('persistent colony terrain streams bounded cube tiles on the shared WebGPU device', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://localhost/persistent-terrain-test', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<html><body style="margin:0"><div id="host" style="position:relative;width:1000px;height:700px"><canvas id="galaxy" style="width:100%;height:100%"></canvas></div></body></html>',
  }));
  await page.route('**/api/colony_economy.php?*', (route) => route.fulfill({
    status: 503, json: { success: false, error: 'Economy not part of terrain fixture' },
  }));
  const manifest = {
    body_id: 12, generator_version: 1, projection: 'cube-sphere', seed: 35, biome: 'terran',
    radius_km: 6371, amplitude_km: 8, height_min_km: -8, height_max_km: 8, sea_level_km: 0,
    max_lod: 14, resolution: 17, tile_encoding: 'uint16-json',
  };
  let requests = 0, batches = 0, maxBatch = 0;
  const generated = new Map();
  await page.route('**/api/terrain.php?*', (route) => {
    requests++;
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('colony_id')).toBe('7');
    if (query.get('action') === 'manifest') return route.fulfill({ json: { success: true, manifest } });
    const addresses = JSON.parse(query.get('tiles'));
    batches++;
    maxBatch = Math.max(maxBatch, addresses.length);
    const tiles = addresses.map((address) => {
      const key = `${address.face}/${address.lod}/${address.x}/${address.y}`;
      if (!generated.has(key)) {
        generated.set(key, {
          ...address, body_id: 12, generator_version: 1, resolution: 17,
          heights: Array.from({ length: 289 }, (_, index) => {
            const u = (address.x + index % 17 / 16) / 2 ** address.lod * 2 - 1;
            const v = (address.y + Math.floor(index / 17) / 16) / 2 ** address.lod * 2 - 1;
            const point = [[1, v, -u], [-1, v, u], [u, 1, -v], [u, -1, v], [u, v, 1], [-u, v, -1]][address.face];
            const length = Math.hypot(...point);
            const [x, y, z] = point.map((n) => n / length);
            const seed = manifest.seed / 1000;
            const broad = Math.sin(x * 19 + seed + Math.sin(z * 11)) * Math.cos(z * 17 - seed + y * 9);
            const ridge = (1 - Math.abs(Math.sin(x * 41 + z * 29 + y * 31 + seed))) ** 3;
            const detail = Math.sin(x * 173 + y * 97 + seed) * Math.cos(z * 157 - y * 79);
            return Math.round((Math.max(-1, Math.min(1, broad * 0.6 + ridge * 0.32 + detail * 0.06 - 0.1)) + 1) / 2 * 65535);
          }),
        });
      }
      return generated.get(key);
    });
    return route.fulfill({ json: { success: true, tiles } });
  });
  await page.goto('http://localhost/persistent-terrain-test');
  const available = await page.evaluate(async () => !!navigator.gpu && !!await navigator.gpu.requestAdapter());
  test.skip(!available, 'No WebGPU adapter available');
  for (const file of [
    'js/runtime/galaxy-chunk-utils.js', 'js/rendering/Galaxy3DRendererWebGPU.js',
    'js/engine/zoom/IZoomLevelRenderer.js', 'js/engine/zoom/RendererRegistry.js',
    'js/engine/zoom/CameraFlightPath.js', 'js/engine/zoom/SeamlessZoomOrchestrator.js',
    'js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js',
  ]) await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });

  await page.evaluate(async () => {
    const canvas = document.querySelector('#galaxy');
    const renderer = new window.GQGalaxy3DRendererWebGPU(document.querySelector('#host'), { externalCanvas: canvas });
    const { SeamlessZoomOrchestrator } = window.GQSeamlessZoomOrchestrator;
    const orchestrator = new SeamlessZoomOrchestrator(canvas, { backend: renderer, requireSharedBackend: true });
    orchestrator.register(3, { webgpu: window.GQColonySurfaceLevelWebGPU.ColonySurfaceLevelWebGPU });
    await orchestrator.initialize();
    const validationErrors = [];
    renderer.device.addEventListener('uncapturederror', (event) => validationErrors.push(event.error.message));
    renderer.device.pushErrorScope('validation');
    window.terrainTest = { renderer, orchestrator, validationErrors };
    await orchestrator.zoomTo(3, {
      colony: { id: 7, body_id: 12, name: 'Persistent terrain', diameter_km: 12742, population: 100 },
      slots: [{ x: 0, z: 0, type: 'habitat', level: 2 }],
    });
  });
  const settled = async () => page.evaluate(() => {
    const city = window.terrainTest.orchestrator._active;
    const stream = city._terrainStream;
    return city._camera.progress === 1 && !!stream?.manifest && !stream.failed && !stream.request
      && stream.wanted.every((tile) => stream.tiles.has(`${tile.face}/${tile.lod}/${tile.x}/${tile.y}`))
      && city._terrainBuffer?.label === 'colony_persisted_cube_tiles';
  });
  await expect.poll(settled, { timeout: 30000 }).toBe(true);
  expect(batches).toBeGreaterThan(1);
  expect(maxBatch).toBeLessThanOrEqual(16);
  const stableRequests = requests;
  const result = await page.evaluate(async () => {
    const { renderer, orchestrator } = window.terrainTest;
    const city = orchestrator._active;
    const buffer = city._terrainBuffer;
    const span = city._camera.span;
    city.setSceneData({ ...city._sceneData });
    city._setCameraSpan(span);
    for (let frame = 0; frame < 100; frame++) city.render(0);
    await renderer.device.queue.onSubmittedWorkDone();
    return {
      reused: buffer === city._terrainBuffer, vertices: city._terrainVertexCount, bytes: city._terrainCacheBytes,
      sameDevice: city._device === renderer.device, hooks: renderer._frameHooks.size, raf: orchestrator._rafId,
      scopedError: (await renderer.device.popErrorScope())?.message || null,
      errors: window.terrainTest.validationErrors,
    };
  });
  expect(result).toMatchObject({ reused: true, sameDevice: true, hooks: 1, raf: 0, scopedError: null, errors: [] });
  expect(result.vertices).toBeGreaterThan(6 * 1920);
  expect(result.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(requests).toBe(stableRequests);
  await page.evaluate(() => {
    const city = window.terrainTest.orchestrator._active;
    city._setCameraSpan(city._entrySpan);
    city.render(0);
  });
  await expect.poll(() => page.evaluate(() => window.terrainTest.orchestrator._active._terrainVertexCount)).toBeLessThan(result.vertices);
  const exit = await page.evaluate(async () => {
    const city = window.terrainTest.orchestrator._active;
    const stream = city._terrainStream;
    await city.exit();
    return { disposed: stream.disposed, tiles: stream.tiles.size, bytes: city._terrainCacheBytes, buffer: city._terrainBuffer };
  });
  expect(exit).toEqual({ disposed: true, tiles: 0, bytes: 0, buffer: null });
  expect(errors).toEqual([]);
});
