const { test, expect } = require('@playwright/test');

test('terraced mine excavates the real Earth mesh at metre scale and restores terrain when disabled', async ({ page }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  await page.locator('[name=visitMine]').click();
  const result = await page.evaluate(async () => {
    const ref = window.GQEarthReference, { production, device } = ref;
    const { inspectReliefMesh } = await import('/js/rendering/earth-reference-relief.js');
    const { MINE_REFERENCE } = await import('/js/rendering/earth-reference-mine.js');
    const { geographicVector } = await import('/js/rendering/earth-reference-geography.js');
    ref.renderer.setAnimationLoop(null);
    device.pushErrorScope('validation');
    const change = (name, value) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (el.type === 'checkbox') el.checked = value; else el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const { canvas } = production, bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * canvas.height,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const capture = async () => {
      ref.render();
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: production.context.getCurrentTexture() },
        { buffer, bytesPerRow }, [canvas.width, canvas.height]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap();
      return pixels;
    };
    const difference = (a, b) => a.reduce((sum, n, i) => sum + (Math.abs(n - b[i]) > 5 ? 1 : 0), 0);
    change('sunAzimuth', '0');
    change('sunElevation', '45');
    const dug = await capture();
    const geometry = production.mineGeometry;
    const up = geographicVector(MINE_REFERENCE.longitude, MINE_REFERENCE.latitude);
    const inspect = vertices => inspectReliefMesh(vertices, up.map(n => n * 2), up.map(n => -n),
      ref.relief, production.reliefOptions);
    const dugHeight = inspect(geometry.vertices).meshElevation;
    const bytes = geometry.vertices.byteLength, triangles = geometry.trianglesAdded;
    const distanceMeters = (ref.camera.position.length() - geometry.centreRadius) * 6371008.8;
    change('mineGeometry', false);
    const original = await capture();
    const clean = production.surface.mesh(1000);
    const originalHeight = inspect(clean.vertices).meshElevation;
    change('mineGeometry', true);
    const repeated = await capture();
    const cacheBytes = production.cacheBytes;
    change('view', 'africa');
    await capture();
    const orbitDistance = ref.camera.position.length(), orbitNear = ref.camera.near;
    change('seaLevel', '500');
    await capture();
    const wetExcluded = production.mineGeometry.available === false;
    const validation = await device.popErrorScope();
    buffer.destroy();
    ref.dispose();
    return { difference: difference(dug, original), repeat: difference(dug, repeated), cacheBytes,
      depression: originalHeight - dugHeight, distanceMeters, triangles, bytes, wetExcluded,
      orbitDistance, orbitNear, validation: validation?.message || null };
  });
  expect(result.difference).toBeGreaterThan(10000);
  expect(result.repeat).toBe(0);
  expect(result.cacheBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  expect(result.depression).toBeCloseTo(240, -1);
  expect(result.distanceMeters).toBeCloseTo(5000, 3);
  expect(result.triangles).toBeGreaterThan(1000);
  expect(result.bytes).toBeLessThan(32 * 1024 * 1024);
  expect(result.wetExcluded).toBe(true);
  expect(result.orbitDistance).toBeGreaterThan(3);
  expect(result.orbitNear).toBe(0.01);
  expect(result.validation).toBeNull();
  expect(errors).toEqual([]);
});
