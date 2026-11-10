const { test, expect } = require('@playwright/test');

test('Earth WebGPU inspector aligns real coasts, mesh, texture, climate and controls', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  await page.selectOption('[name="backend"]', 'reference');
  await expect(page.locator('#reference-viewport canvas').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const ref = window.GQEarthReference;
    const { Vector3, RenderTarget } = await import('/node_modules/three/build/three.webgpu.js');
    const { geographicVector, ZONE_COLORS } = await import('/js/rendering/earth-reference-geography.js');
    ref.renderer.setAnimationLoop(null);
    ref.device.pushErrorScope('validation');
    const context = ref.textureCanvas.getContext('2d');
    const locations = [[15, 25], [-60, -5], [15, 50], [130, -25], [-42, 74], [20, -85],
      [-35, 40], [-179.9, 0], [179.9, 0], [33, -1], [-87, 47.5]];
    const mismatches = [];
    for (const [lon, lat] of locations) {
      const sample = ref.geography.sample(lon, lat);
      const pixel = context.getImageData(Math.floor((lon + 180) / 360 * 2048), Math.floor((90 - lat) / 180 * 1024), 1, 1).data;
      const expected = ZONE_COLORS[sample.zone].slice(1).match(/../g).map(value => parseInt(value, 16));
      if (expected.some((value, i) => Math.abs(value - pixel[i]) > 1)) mismatches.push({ lon, lat, sample, pixel: [...pixel] });
    }
    const target = new RenderTarget(256, 256);
    const capture = async () => {
      ref.renderer.setRenderTarget(target);
      ref.render();
      const bytes = await ref.renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 256);
      ref.renderer.setRenderTarget(null);
      return [...bytes];
    };
    const baseline = await capture();
    const differences = [];
    for (const name of ['coasts', 'atmosphere', 'lighting', 'grid', 'wireframe']) {
      const control = document.querySelector(`[name="${name}"]`);
      control.checked = !control.checked;
      control.dispatchEvent(new Event('change', { bubbles: true }));
      const bytes = await capture();
      let changed = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        if (Math.abs(bytes[i] - baseline[i]) + Math.abs(bytes[i + 1] - baseline[i + 1]) + Math.abs(bytes[i + 2] - baseline[i + 2]) > 6) changed++;
      }
      differences.push({ name, changed });
      control.checked = !control.checked;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const coastlineDistances = [];
    const vertices = ref.land.geometry.getAttribute('position');
    // Every sampled mesh vertex must address the same longitude/latitude texel.
    const uvs = ref.land.geometry.getAttribute('uv');
    for (let i = 0; i < vertices.count; i += 91) {
      const p = new Vector3().fromBufferAttribute(vertices, i);
      const q = new Vector3(...geographicVector(uvs.getX(i) * 360 - 180, uvs.getY(i) * 180 - 90, 1.004));
      coastlineDistances.push(p.distanceTo(q));
    }
    const change = (name, value) => {
      const control = document.querySelector(`[name="${name}"]`);
      if (control.type === 'checkbox') control.checked = value; else control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const name of ['coasts', 'atmosphere', 'lighting']) change(name, false);
    const maskComparisons = [];
    for (const view of ['africa', 'americas', 'asia', 'pacific', 'north', 'south']) {
      change('view', view);
      change('representation', 'geometry');
      const geometric = await capture();
      change('representation', 'texture');
      const textured = await capture();
      const classify = bytes => Array.from({ length: 256 * 256 }, (_, i) => {
        const [r, g, b] = bytes.slice(i * 4, i * 4 + 3);
        if (r + g + b < 12) return -1;
        return b > g * 1.25 && b > r * 1.4 ? 0 : 1;
      });
      const a = classify(geometric), b = classify(textured);
      let compared = 0, mismatched = 0, landPixels = 0;
      for (let y = 2; y < 254; y++) for (let x = 2; x < 254; x++) {
        const i = y * 256 + x;
        // Exclude the silhouette and a two-pixel raster coast footprint.
        if (a[i] < 0 || b[i] < 0) continue;
        let boundary = false;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (a[i + dy * 256 + dx] !== a[i] || b[i + dy * 256 + dx] !== b[i]) boundary = true;
        }
        if (boundary) continue;
        compared++;
        if (a[i] === 1) landPixels++;
        if (a[i] !== b[i]) mismatched++;
      }
      maskComparisons.push({ view, compared, mismatched, landPixels });
    }
    change('view', 'africa');
    ref.render();
    const projected = [[20, 15], [21, 15], [20, 16]].map(coordinate =>
      ref.body.localToWorld(new Vector3(...geographicVector(...coordinate))).project(ref.camera).toArray());
    change('representation', 'combined');
    for (const name of ['coasts', 'atmosphere', 'lighting']) change(name, true);
    target.dispose();
    ref.render();
    const validation = await ref.device.popErrorScope();
    return { mismatches, differences, maxUVError: Math.max(...coastlineDistances),
      maskComparisons, projected, vertices: vertices.count, backend: ref.renderer.backend.isWebGPUBackend,
      validation: validation?.message || null };
  });
  expect(result.backend).toBe(true);
  expect(result.mismatches).toEqual([]);
  expect(result.maxUVError).toBeLessThan(0.000001);
  expect(result.vertices).toBeGreaterThan(30000);
  expect(result.validation).toBeNull();
  for (const comparison of result.maskComparisons) {
    expect(comparison.compared, `${comparison.view}: measure enough rendered surface`).toBeGreaterThan(8000);
    expect(comparison.mismatched / comparison.compared, `${comparison.view}: geometric and textured land must agree`).toBeLessThan(0.005);
  }
  expect(result.maskComparisons.find(item => item.view === 'africa').landPixels).toBeGreaterThan(1000);
  expect(result.projected[1][0], 'geographic east must appear to the right, not mirrored').toBeGreaterThan(result.projected[0][0]);
  expect(result.projected[2][1], 'geographic north must appear above south').toBeGreaterThan(result.projected[0][1]);
  for (const { name, changed } of result.differences) expect(changed, `${name} must alter actual GPU pixels`).toBeGreaterThan(30);
  await page.selectOption('[name="representation"]', 'geometry');
  expect(await page.evaluate(() => {
    const ref = window.GQEarthReference;
    return { land: ref.land.visible, texture: ref.textureSphere.visible, hasMap: Boolean(ref.land.material.map) };
  })).toEqual({ land: true, texture: false, hasMap: false });
  await page.selectOption('[name="representation"]', 'texture');
  expect(await page.evaluate(() => {
    const ref = window.GQEarthReference;
    return { land: ref.land.visible, lakes: ref.lakes.visible, texture: ref.textureSphere.visible };
  })).toEqual({ land: false, lakes: false, texture: true });
  await page.selectOption('[name="representation"]', 'combined');
  for (const name of ['americas', 'asia', 'pacific', 'north', 'south', 'africa']) {
    await page.selectOption('[name="view"]', name);
    expect(await page.evaluate(() => {
      const ref = window.GQEarthReference;
      ref.render();
      return ref.camera.position.length();
    })).toBeCloseTo(3.8);
  }
  const frozen = await page.evaluate(() => window.GQEarthReference.time);
  await page.check('[name="rotation"]');
  expect(await page.evaluate(async () => {
    const ref = window.GQEarthReference;
    await new Promise(resolve => setTimeout(resolve, 80));
    ref.render();
    return ref.time;
  })).toBeGreaterThan(frozen);
  await page.uncheck('[name="rotation"]');
  await page.click('[name="reset"]');
  expect(await page.evaluate(() => window.GQEarthReference.time)).toBe(frozen);
  await page.screenshot({ path: test.info().outputPath('earth-africa.png') });
  await page.evaluate(() => {
    window.GQEarthReference.dispose();
    window.GQEarthReference.dispose();
  });
  await expect(page.locator('#reference-viewport canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});
