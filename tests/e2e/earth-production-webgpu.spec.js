const { test, expect } = require('@playwright/test');

test('real production planet renderer uses Earth masks, shared clouds/materials, LOD and borrowed GPU lifetime', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  await expect(page.locator('[data-earth-production]')).toBeVisible();
  await expect(page.locator('[name="coasts"]')).toBeDisabled();
  await page.selectOption('[name="source"]', 'coasts');
  const result = await page.evaluate(async () => {
    const ref = window.GQEarthReference, production = ref.production, orbit = production.orbit, device = ref.device;
    ref.renderer.setAnimationLoop(null);
    device.pushErrorScope('validation');
    const change = (name, value) => {
      const control = document.querySelector(`[name="${name}"]`);
      if (control.type === 'checkbox') control.checked = value; else control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const name of ['motion', 'rotation', 'clouds', 'atmosphere', 'lighting']) change(name, false);
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
    const baseline = await capture();
    const comparisons = [];
    for (const view of ['africa', 'americas', 'asia', 'pacific', 'north', 'south']) {
      change('view', view);
      change('representation', 'geometry');
      const geometry = await capture();
      change('representation', 'texture');
      const texture = await capture();
      const classify = (bytes, i) => {
        const [r, g, b] = bytes.subarray(i, i + 3);
        if (r + g + b < 12) return -1;
        return b > g * 1.25 && b > r * 1.4 ? 0 : 1;
      };
      let compared = 0, mismatches = 0;
      for (let y = 3; y < canvas.height - 3; y += 2) for (let x = 3; x < canvas.width - 3; x += 2) {
        const i = y * bytesPerRow + x * 4;
        const a = classify(geometry, i), b = classify(texture, i);
        if (a < 0 || b < 0) continue;
        let boundary = false;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (classify(geometry, i + dy * bytesPerRow + dx * 4) !== a
            || classify(texture, i + dy * bytesPerRow + dx * 4) !== b) boundary = true;
        }
        if (boundary) continue;
        compared++;
        if (a !== b) mismatches++;
      }
      comparisons.push({ view, compared, mismatches });
    }
    change('view', 'africa');
    change('representation', 'combined');
    const restored = await capture();
    change('lighting', true);
    const lit = await capture();
    change('atmosphere', true);
    const atmosphere = await capture();
    change('clouds', true);
    const clouds = await capture();
    orbit._waterTime = 30;
    const movedClouds = await capture();
    const frozenPhase = orbit._waterTime;
    orbit.render(0.1, { position: ref.camera.position });
    const frozen = orbit._waterTime === frozenPhase;
    change('motion', true);
    const beforeMotion = orbit._waterTime;
    production.render(0.1, ref.camera);
    const animated = orbit._waterTime > beforeMotion;
    change('motion', false);
    const rows = production.rows;
    ref.camera.position.multiplyScalar(0.5);
    await capture();
    const nearRows = production.rows;
    // At Earth orbital distances, metre-scale water normals are intentionally
    // filtered out by the shared material, not exaggerated into global waves.
    const materialRadius = orbit._materialState.radiusMeters;
    const className = orbit.constructor.name;
    const surfaceIsReal = orbit._backend.geographicSurface === production.surface;
    const vertexCount = orbit._solidVertexCount;
    const cacheBytes = production.cacheBytes;
    const validation = await device.popErrorScope();
    await device.queue.onSubmittedWorkDone();
    pixels.destroy();
    production.dispose();
    production.dispose();
    const borrowed = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(borrowed, 0, new Float32Array(4));
    borrowed.destroy();
    ref.dispose();
    return {
      className, surfaceIsReal, vertexCount, cacheBytes, comparisons, rows, nearRows,
      materialRadius, frozen, animated, validation: validation?.message || null,
      restored: difference(baseline, restored), lighting: difference(restored, lit),
      atmosphere: difference(lit, atmosphere), clouds: difference(atmosphere, clouds),
      turbulence: difference(clouds, movedClouds),
    };
  });
  expect(result.className).toBe('PersistentBodyPlanetApproachRenderer');
  expect(result.surfaceIsReal).toBe(true);
  expect(result.vertexCount).toBeGreaterThan(30000);
  expect(result.cacheBytes).toBeLessThan(32 * 1024 * 1024);
  expect(result.materialRadius).toBeCloseTo(6371008.8);
  expect(result.restored).toBe(0);
  for (const key of ['lighting', 'atmosphere', 'clouds', 'turbulence']) expect(result[key], key).toBeGreaterThan(100);
  expect(result.animated && result.frozen).toBe(true);
  expect(result.nearRows).toBeGreaterThan(result.rows);
  for (const comparison of result.comparisons) {
    expect(comparison.compared, comparison.view).toBeGreaterThan(8000);
    expect(comparison.mismatches / comparison.compared, comparison.view).toBeLessThan(0.005);
  }
  expect(result.validation).toBeNull();
  expect(errors).toEqual([]);
  await expect(page.locator('#reference-viewport canvas')).toHaveCount(0);
});
