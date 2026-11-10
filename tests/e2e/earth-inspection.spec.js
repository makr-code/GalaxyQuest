const { test, expect } = require('@playwright/test');

test('screen picking follows tilted production mesh, exposes data error and ignores orbit drags', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  await page.selectOption('[name="view"]', 'himalaya');
  await page.uncheck('[name="motion"]');
  await page.uncheck('[name="clouds"]');
  const point = await page.evaluate(async () => {
    const ref = window.GQEarthReference;
    const { Vector3 } = await import('/node_modules/three/build/three.webgpu.js');
    const { geographicVector } = await import('/js/rendering/earth-reference-geography.js');
    const { reliefPoint } = await import('/js/rendering/earth-reference-relief.js');
    ref.render();
    const radius = reliefPoint(ref.relief, 87, 30, ref.production.reliefOptions).radius;
    const world = ref.body.localToWorld(new Vector3(...geographicVector(87, 30, radius))).project(ref.camera);
    const rect = ref.production.canvas.getBoundingClientRect();
    return { x: rect.left + (world.x + 1) / 2 * rect.width, y: rect.top + (1 - world.y) / 2 * rect.height };
  });

  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#point-inspection')).toBeVisible();
  await expect(page.locator('#point-inspection')).toContainText('ETOPO:');
  const inspection = await page.evaluate(() => window.GQEarthReference.inspection);
  expect(Math.abs(inspection.longitude - 87)).toBeLessThan(0.2);
  expect(Math.abs(inspection.latitude - 30)).toBeLessThan(0.2);
  expect(inspection.elevation).toBeGreaterThan(4500);
  expect(inspection.textureOnly).toBe(false);
  expect(Number.isFinite(inspection.meshError)).toBe(true);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 40, point.y + 20, { steps: 4 });
  await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.GQEarthReference.inspection)).toEqual(inspection);
  await page.selectOption('[name="exaggeration"]', '40');
  await expect(page.locator('#point-inspection')).toBeHidden();
  await page.selectOption('[name="representation"]', 'texture');
  await page.selectOption('[name="view"]', 'himalaya');
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#point-inspection')).toContainText('kein Mesh-Hoehenvergleich');
  expect(await page.evaluate(() => window.GQEarthReference.inspection.meshError)).toBeNull();
  await page.mouse.click(850, 10);
  await expect(page.locator('#point-inspection')).toContainText('Kein Oberflaechentreffer');
  await page.selectOption('[name="backend"]', 'reference');
  await expect(page.locator('#point-inspection')).toBeHidden();
  expect(await page.evaluate(() => {
    try { window.GQEarthReference.inspectPoint(0, 0); } catch (error) { return error.message; }
  })).toContain('requires the production');
  await page.evaluate(() => window.GQEarthReference.dispose());
  expect(errors).toEqual([]);
});

test('fixed inspection meshes reduce Tibet error, stay bounded and return safely to automatic LOD', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  await page.selectOption('[name="view"]', 'himalaya');
  await page.selectOption('[name="exaggeration"]', '20');
  await page.uncheck('[name="motion"]');
  const result = await page.evaluate(async () => {
    const ref = window.GQEarthReference;
    const { Vector3 } = await import('/node_modules/three/build/three.webgpu.js');
    const { geographicVector } = await import('/js/rendering/earth-reference-geography.js');
    ref.renderer.setAnimationLoop(null);
    ref.device.pushErrorScope('validation');
    const change = (name, value) => {
      const control = document.querySelector(`[name="${name}"]`);
      control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
      ref.render();
    };
    const sample = () => {
      const world = ref.body.localToWorld(new Vector3(...geographicVector(87, 30))).project(ref.camera);
      const rect = ref.production.canvas.getBoundingClientRect();
      return ref.inspectPoint(rect.left + (world.x + 1) / 2 * rect.width,
        rect.top + (1 - world.y) / 2 * rect.height);
    };
    change('detail', '64');
    const coarse = sample();
    const coarseBuffer = ref.production.orbit._solidBuffer;
    change('detail', '180');
    const cleared = ref.inspection === null && document.querySelector('#point-inspection').hidden;
    const fine = sample();
    const fineReadout = document.querySelector('#point-inspection').textContent;
    const detailCount = ref.production.orbit._solidVertexCount;
    const replaced = ref.production.orbit._solidBuffer !== coarseBuffer;
    ref.camera.position.multiplyScalar(0.75);
    ref.render();
    const fixedWhileZooming = ref.production.rows;
    const cacheBytes = ref.production.cacheBytes;
    change('detail', 'auto');
    const autoRows = ref.production.rows;
    change('detail', '180');
    change('source', 'coasts');
    const coastRows = ref.production.rows;
    const disabled = document.querySelector('[name="detail"]').disabled;
    change('source', 'relief');
    const restoredDetail = ref.production.rows;
    const validation = await ref.device.popErrorScope();
    ref.dispose();
    return { coarse, fine, fineReadout, cleared, detailCount, replaced, fixedWhileZooming,
      cacheBytes, autoRows, coastRows, disabled, restoredDetail, validation: validation?.message || null };
  });
  expect(result.coarse.rows).toBe(64);
  expect(Math.abs(result.coarse.meshError)).toBeGreaterThan(400);
  expect(result.fine.rows).toBe(180);
  expect(Math.abs(result.fine.meshError)).toBeLessThan(0.1);
  expect(result.fineReadout).toContain('Abweichung: 0 m');
  expect(result.fine.longitude).toBeCloseTo(result.coarse.longitude, 4);
  expect(result.fine.latitude).toBeCloseTo(result.coarse.latitude, 4);
  expect(result.detailCount).toBe(180 * 360 * 6);
  expect(result.cleared && result.replaced && result.disabled).toBe(true);
  expect(result.fixedWhileZooming).toBe(180);
  expect([32, 64, 128]).toContain(result.autoRows);
  expect([32, 64, 128]).toContain(result.coastRows);
  expect(result.restoredDetail).toBe(180);
  expect(result.cacheBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  expect(result.validation).toBeNull();
  expect(errors).toEqual([]);
});
