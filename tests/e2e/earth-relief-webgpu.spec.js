const { test, expect } = require('@playwright/test');

test('ETOPO physical relief, exaggeration, sea datum and seafloor affect real production pixels', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  await expect(page.locator('[name="source"]')).toHaveValue('relief');
  const result = await page.evaluate(async () => {
    const ref = window.GQEarthReference, production = ref.production, device = ref.device;
    ref.renderer.setAnimationLoop(null);
    device.pushErrorScope('validation');
    const change = (name, value) => {
      const control = document.querySelector(`[name="${name}"]`);
      if (control.type === 'checkbox') control.checked = value; else control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const name of ['motion', 'rotation', 'clouds', 'atmosphere']) change(name, false);
    change('view', 'himalaya');
    const canvas = production.canvas;
    const bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256;
    const pixels = device.createBuffer({ size: bytesPerRow * canvas.height,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const capture = async () => {
      ref.render();
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: production.context.getCurrentTexture() },
        { buffer: pixels, bytesPerRow }, [canvas.width, canvas.height]);
      device.queue.submit([encoder.finish()]);
      await pixels.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(pixels.getMappedRange()).slice();
      pixels.unmap();
      return bytes;
    };
    const difference = (a, b) => {
      let changed = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = y * bytesPerRow + x * 4;
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) changed++;
      }
      return changed;
    };
    const radii = () => {
      const vertices = production.orbit._markerVertices;
      let min = Infinity, max = 0;
      for (let i = 0; i < vertices.length; i += 12) {
        const radius = Math.hypot(vertices[i], vertices[i + 1], vertices[i + 2]);
        min = Math.min(min, radius);
        max = Math.max(max, radius);
      }
      return { min, max };
    };
    change('exaggeration', '1');
    const physical = await capture(), physicalRadius = radii();
    const sourceHeight = ref.relief.sample(87, 30);
    change('exaggeration', '40');
    const enhanced = await capture(), enhancedRadius = radii();
    const heightAfter = ref.relief.sample(87, 30);
    const enhancedBuffer = production.orbit._solidBuffer;
    change('exaggeration', '1');
    const restored = await capture();
    const meshReplaced = production.orbit._solidBuffer !== enhancedBuffer;
    change('exaggeration', '20');
    change('seaLevel', '-500');
    const lowSea = await capture();
    change('seaLevel', '500');
    const highSea = await capture(), highSeaRadius = radii();
    change('seaLevel', '0');
    change('view', 'mariana');
    const ocean = await capture();
    change('ocean', false);
    const bottom = await capture(), bottomRadius = radii();
    const noWaterBoundaries = production.orbit._markerVertices.every((n, i) => i % 12 !== 10 || n === 0);
    const surfaceKey = production.surface.mesh(production.orbit._materialPixels).key;
    change('view', 'south');
    const south = await capture();
    change('view', 'north');
    const north = await capture();
    change('backend', 'reference');
    const disabledInBaseline = ['source', 'exaggeration', 'seaLevel', 'ocean']
      .every(name => document.querySelector(`[name="${name}"]`).disabled);
    change('backend', 'production');
    ref.render();
    const cacheBytes = production.cacheBytes;
    const validation = await device.popErrorScope();
    await device.queue.onSubmittedWorkDone();
    pixels.destroy();
    ref.dispose();
    return {
      sourceHeight, heightAfter, physicalRadius, enhancedRadius, highSeaRadius, bottomRadius,
      surfaceKey, noWaterBoundaries, disabledInBaseline, cacheBytes, meshReplaced,
      enhancement: difference(physical, enhanced), restoration: difference(physical, restored),
      seaLevel: difference(lowSea, highSea), bottom: difference(ocean, bottom),
      poles: difference(south, north), validation: validation?.message || null,
    };
  });
  expect(result.sourceHeight).toBe(5275);
  expect(result.heightAfter).toBe(result.sourceHeight);
  expect(result.physicalRadius.min).toBeGreaterThan(0.999999);
  expect(result.physicalRadius.max).toBeLessThan(1.002);
  expect(result.enhancedRadius.max - 1).toBeCloseTo((result.physicalRadius.max - 1) * 40, 4);
  expect(result.highSeaRadius.min).toBeGreaterThan(1.0015);
  expect(result.bottomRadius.min).toBeLessThan(0.98);
  expect(result.noWaterBoundaries).toBe(true);
  expect(result.surfaceKey).toContain('relief');
  expect(result.meshReplaced && result.disabledInBaseline).toBe(true);
  for (const key of ['enhancement', 'seaLevel', 'bottom', 'poles']) expect(result[key], key).toBeGreaterThan(500);
  expect(result.restoration).toBe(0);
  expect(result.cacheBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  expect(result.validation).toBeNull();
  expect(errors).toEqual([]);
});

test('corrupted ETOPO data fails visibly instead of displaying invented relief', async ({ page }) => {
  await page.route('**/etopo1-ice-30arcmin.i16', route =>
    route.fulfill({ contentType: 'application/octet-stream', body: Buffer.alloc(8) }));
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'error');
  await expect(page.locator('#reference-status')).toContainText('ETOPO reference checksum mismatch');
  await expect(page.locator('#reference-viewport canvas')).toHaveCount(0);
});
