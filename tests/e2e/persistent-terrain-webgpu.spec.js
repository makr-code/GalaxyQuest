const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

for (const scenario of [
  { kind: 'planet', diameter: 12742, shape: { version: 1, axes: [1, 1, 1], deformation: 0 } },
  { kind: 'comet', diameter: 12, shape: { version: 1, axes: [1.45, 0.8, 0.95], deformation: 0.22 } },
  { kind: 'comet', sheltered: true, diameter: 12, shape: { version: 1, axes: [1.45, 0.8, 0.95], deformation: 0.22 } },
  { kind: 'asteroid', diameter: 20, shape: { version: 1, axes: [1.8, 0.65, 0.9], deformation: 0.3 } },
]) {
test(`persistent colony terrain ${scenario.kind}${scenario.sheltered ? ' valley dome' : ''} streams bounded cube tiles on the shared WebGPU device`, async ({ page }, testInfo) => {
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
    body_id: 12, generator_version: 1, projection: 'cube-sphere', seed: 35,
    biome: scenario.kind === 'comet' ? 'ice' : scenario.kind === 'asteroid' ? 'rock' : 'terran',
    radius_km: scenario.diameter / 2, amplitude_km: Math.min(8, scenario.diameter * 0.01),
    height_min_km: -Math.min(8, scenario.diameter * 0.01), height_max_km: Math.min(8, scenario.diameter * 0.01),
    sea_level_km: 0, shape: scenario.shape,
    max_lod: Math.min(16, Math.ceil(Math.log2(scenario.diameter / 2 * Math.PI / 2 / 0.008))),
    resolution: 17, tile_encoding: 'uint16-json',
    ...(scenario.sheltered ? { settlement: {
      version: 1, kind: 'valley-dome', direction: [1, 0, 0], floor_height_km: -0.06, dome_height_ratio: 0.55,
    } } : {}),
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
            const seed = (manifest.seed % 100000) / 1000;
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
    'js/engine/zoom/levels/PlanetApproachLevelWebGPU.js',
    'js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js',
  ]) await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });

  await page.evaluate(async ({ diameter, kind, sheltered }) => {
    const canvas = document.querySelector('#galaxy');
    const renderer = new window.GQGalaxy3DRendererWebGPU(document.querySelector('#host'), { externalCanvas: canvas });
    const { SeamlessZoomOrchestrator } = window.GQSeamlessZoomOrchestrator;
    const orchestrator = new SeamlessZoomOrchestrator(canvas, { backend: renderer, requireSharedBackend: true });
    orchestrator.register(2, { webgpu: window.GQPlanetApproachLevelWebGPU.PlanetApproachLevelWebGPU });
    orchestrator.register(3, { webgpu: window.GQColonySurfaceLevelWebGPU.ColonySurfaceLevelWebGPU });
    await orchestrator.initialize();
    const validationErrors = [];
    renderer.device.addEventListener('uncapturederror', (event) => validationErrors.push(event.error.message));
    renderer.device.pushErrorScope('validation');
    renderer.enterSystemView({ x: 0, y: 0, name: 'Shape test star' }, { planets: [
      { player_planet: { id: 21, body_type: 'planet', planet_class: 'terran', shape: { version: 1, axes: [1, 1, 1], deformation: 0 } } },
      { generated_planet: { id: 22, body_type: 'comet', planet_class: 'ice', payload_json: JSON.stringify({ shape: { version: 1, axes: [1.45, 0.8, 0.95], deformation: 0.22 } }) } },
      { generated_planet: { id: 23, body_type: 'asteroid', planet_class: 'rock' } },
    ] });
    const systemShapes = renderer._systemPlanetEntries.map((entry) => entry.shape);
    if (JSON.stringify(systemShapes) !== JSON.stringify([
      { version: 1, axes: [1, 1, 1], deformation: 0 },
      { version: 1, axes: [1.45, 0.8, 0.95], deformation: 0.22 },
      { version: 1, axes: [1.45, 0.8, 0.95], deformation: 0.22 },
    ])) throw new Error(`System body shape mismatch: ${JSON.stringify(systemShapes)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    renderer.exitSystemView();
    const systemError = await renderer.device.popErrorScope();
    if (systemError) throw new Error(`System body shape WebGPU validation failed: ${systemError.message}`);
    renderer.device.pushErrorScope('validation');
    const scene = {
      colony: { id: 7, body_id: 12, name: 'Persistent terrain', diameter_km: diameter, body_type: kind, population: 100 },
      slots: sheltered ? Array.from({ length: 12 }, (_, index) => ({
        slot_x: index % 4, slot_y: Math.floor(index / 4), building_type: 'habitat', level: index % 3 + 1,
      })) : [{ x: 0, z: 0, type: 'habitat', level: 2 }],
    };
    window.terrainTest = { renderer, orchestrator, validationErrors, scene, systemShapes };
    await orchestrator.zoomTo(2, scene, { skipCameraFlight: true });
  }, scenario);
  await expect.poll(() => page.evaluate(() => window.terrainTest.orchestrator._active._terrainManifest?.shape)).toEqual(scenario.shape);
  expect(batches).toBe(0);
  await page.evaluate(async () => {
    const { orchestrator, scene } = window.terrainTest;
    await orchestrator.zoomTo(3, scene);
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
      shape: city._bodySurface.terrain.shape,
      target: city._cameraEye,
      radius: city._bodySurface.radius,
      radiusMeters: city._bodySurface.radius * window.GQColonySurfaceLevelWebGPU.COLONY_METERS_PER_UNIT,
      centerRadius: window.GQColonySurfaceLevelWebGPU.bodyCenterRadius(city._bodySurface.radius, city._bodySurface.terrain.shape),
      shelter: city._bodySurface.terrain.shelter,
      frame: city._bodySurface.terrain.shape?.frame,
      dome: !!city._domePipeline,
    };
  });
  expect(result).toMatchObject({ reused: true, sameDevice: true, hooks: 1, raf: 0, scopedError: null, errors: [] });
  expect(result.vertices).toBeGreaterThan(6 * 1920);
  expect(result.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(result.shape).toMatchObject(scenario.shape);
  expect(result.radiusMeters).toBeCloseTo(scenario.diameter * 500, 6);
  if (scenario.sheltered) {
    expect(result.shelter.floor).toBeLessThan(0);
    expect(result.shelter.radius).toBeGreaterThan(0);
    expect(result.dome).toBe(true);
    expect(result.frame[1]).toEqual(manifest.settlement.direction);
  } else expect(result.shelter).toBeNull();
  const [ex, ey, ez] = [result.target[0], result.target[1] + result.centerRadius, result.target[2]];
  const length = Math.hypot(ex, ey, ez);
  const direction = [ex, ey, ez].map((n) => n / length);
  const [nx, ny, nz] = result.frame
    ? direction.map((_, index) => result.frame.reduce((sum, axis, component) => sum + axis[index] * direction[component], 0))
    : direction;
  const factor = (1 + scenario.shape.deformation * (0.6 * (nx * nx - ny * ny) + 0.4 * nx * nz))
    / Math.hypot(nx / scenario.shape.axes[0], ny / scenario.shape.axes[1], nz / scenario.shape.axes[2]);
  expect(length).toBeGreaterThan(result.radius * factor);
  expect(requests).toBe(stableRequests);
  if (scenario.sheltered) {
    const changedPixels = await page.evaluate(() => {
      const city = window.terrainTest.orchestrator._active;
      const copy = document.createElement('canvas');
      copy.width = city._canvas.width;
      copy.height = city._canvas.height;
      const context = copy.getContext('2d');
      const read = () => {
        context.drawImage(city._canvas, 0, 0);
        return context.getImageData(0, 0, copy.width, copy.height).data;
      };
      city.render(0);
      const withDome = read();
      const pipeline = city._domePipeline;
      try {
        city._domePipeline = null;
        city.render(0);
        const without = read();
        let changed = 0;
        for (let index = 0; index < withDome.length; index += 4) {
          if (Math.abs(withDome[index] - without[index])
              + Math.abs(withDome[index + 1] - without[index + 1])
              + Math.abs(withDome[index + 2] - without[index + 2]) > 12) changed++;
        }
        return changed;
      } finally {
        city._domePipeline = pipeline;
        city.render(0);
      }
    });
    expect(changedPixels).toBeGreaterThan(1000);
  }
  await page.locator('#host').screenshot({ path: testInfo.outputPath(`${scenario.kind}${scenario.sheltered ? '-valley' : ''}-perspective-colony.png`) });
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
}
