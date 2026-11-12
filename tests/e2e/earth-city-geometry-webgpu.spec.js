const { test, expect } = require('@playwright/test');

test('metric city buildings resolve at kilometre range, preserve scale and disappear in orbit', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__metricResources = [];
    const create = GPUDevice.prototype.createBuffer;
    GPUDevice.prototype.createBuffer = function (descriptor) {
      const buffer = create.call(this, descriptor);
      if (descriptor.label?.startsWith('earth_metric_city')) {
        const entry = { label: descriptor.label, destroyed: 0 };
        window.__metricResources.push(entry);
        const destroy = buffer.destroy.bind(buffer);
        buffer.destroy = () => { entry.destroyed++; destroy(); };
      }
      return buffer;
    };
  });
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  await page.locator('[name=visitCity]').click();
  const result = await page.evaluate(async () => {
    const ref = window.GQEarthReference, { production, device } = ref;
    ref.renderer.setAnimationLoop(null);
    device.pushErrorScope('validation');
    const change = (name, value) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (el.type === 'checkbox') el.checked = value; else el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    change('atmosphere', false);
    change('sky', false);
    const { canvas } = production, bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * canvas.height,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const capture = async (automaticClip = true) => {
      if (automaticClip) ref.render(); else production.render(0, ref.camera);
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
    const visible = await capture();
    const geometry = production.cityGeometry;
    change('cityGeometry', false);
    const terrain = await capture();
    change('cityGeometry', true);
    const repeat = await capture();
    const sameGeometry = production.cityGeometry === geometry;
    change('lighting', false);
    const unlit = await capture();
    change('sunAzimuth', '180');
    const unlitOtherSun = await capture();
    change('cityGeometry', false);
    const unlitTerrain = await capture();
    change('cityGeometry', true);
    change('lighting', true);
    const distanceMeters = ref.camera.position.length() * geometry.radiusMeters
      - geometry.buildings.reduce((sum, b) => sum + b.foundationRadius, 0) / geometry.buildings.length * geometry.radiusMeters;
    // Wheel zoom keeps the local inspection target; it does not call setView().
    ref.camera.position.multiplyScalar(3.8 / ref.camera.position.length());
    const zoomedOut = await capture();
    const zoomedNear = ref.camera.near;
    ref.camera.near = 0.01;
    ref.camera.updateProjectionMatrix();
    const correctDepth = await capture(false);
    ref.camera.near = 1 / geometry.radiusMeters;
    ref.camera.updateProjectionMatrix();
    const collapsedDepth = await capture(false);
    const recovered = await capture();
    change('view', 'africa');
    const orbitOn = await capture();
    change('cityGeometry', false);
    const orbitOff = await capture();
    const validation = await device.popErrorScope();
    buffer.destroy();
    ref.dispose();
    return { count: geometry.buildings.length, changed: difference(visible, terrain),
      repeat: difference(visible, repeat), orbit: difference(orbitOn, orbitOff), distanceMeters,
      sameGeometry, unlit: difference(unlit, unlitTerrain),
      zoomedNear, zoomedDepth: difference(zoomedOut, correctDepth),
      brokenDepth: difference(collapsedDepth, correctDepth), recovered: difference(recovered, correctDepth),
      unlitSun: difference(unlit, unlitOtherSun),
      widths: geometry.buildings.map(b => b.widthMeters), near: ref.camera.near,
      resources: window.__metricResources,
      validation: validation?.message || null };
  });
  expect(result.count).toBeGreaterThan(100);
  expect(result.count).toBeLessThanOrEqual(576);
  expect(result.changed).toBeGreaterThan(1000);
  expect(result.repeat).toBe(0);
  expect(result.sameGeometry).toBe(true);
  expect(result.unlit).toBeGreaterThan(1000);
  expect(result.unlitSun).toBe(0);
  expect(result.orbit).toBe(0);
  expect(result.distanceMeters).toBeCloseTo(2000, 3);
  expect(Math.max(...result.widths)).toBeLessThan(60);
  expect(result.near).toBe(0.01);
  expect(result.zoomedNear).toBeGreaterThan(0.001);
  expect(result.zoomedDepth).toBeLessThan(100);
  expect(result.brokenDepth).toBeGreaterThan(5000);
  expect(result.recovered).toBeLessThan(100);
  expect(result.validation).toBeNull();
  expect(result.resources.length).toBeGreaterThanOrEqual(2);
  for (const resource of result.resources) expect(resource.destroyed, resource.label).toBe(1);
  expect(errors).toEqual([]);
});
