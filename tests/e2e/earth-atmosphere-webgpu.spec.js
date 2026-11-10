const { test, expect } = require('@playwright/test');

test('solar atmosphere has blue daylight, warm twilight and no deep-night halo with isolated diagnostics', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const ref = window.GQEarthReference, { production, device } = ref;
    const { Vector3 } = await import('/node_modules/three/build/three.webgpu.js');
    ref.renderer.setAnimationLoop(null);
    device.pushErrorScope('validation');
    const change = (name, value) => {
      const control = document.querySelector(`[name="${name}"]`);
      if (control.type === 'checkbox') control.checked = value; else control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const name of ['motion', 'rotation', 'clouds', 'sky']) change(name, false);
    change('sunAzimuth', '0');
    change('sunElevation', '0');
    change('exaggeration', '1');
    const { canvas } = production;
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
      const data = new Uint8Array(pixels.getMappedRange()).slice();
      pixels.unmap();
      return data;
    };
    const difference = (a, b) => {
      let n = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = y * bytesPerRow + x * 4;
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) n++;
      }
      return n;
    };
    change('atmosphere', false);
    const off = await capture();
    const mesh = production.orbit._solidBuffer;
    change('atmosphere', true);
    const solar = await capture();
    const nightSurface = [];
    const buckets = Object.fromEntries(['day', 'twilight', 'night'].map(key => [key, { count: 0, rgb: [0, 0, 0] }]));
    const eye = ref.camera.position, ray = new Vector3(), closest = new Vector3();
    const bgra = navigator.gpu.getPreferredCanvasFormat().startsWith('bgra');
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = y * bytesPerRow + x * 4;
      ray.set((x + 0.5) / canvas.width * 2 - 1, 1 - (y + 0.5) / canvas.height * 2, 1)
        .unproject(ref.camera).sub(eye).normalize();
      const along = -eye.dot(ray);
      if (along <= 0) continue;
      closest.copy(eye).addScaledVector(ray, along);
      const radius = closest.length();
      if (radius > 0.94 && radius < 0.98 && off[i] + off[i + 1] + off[i + 2] > 0) {
        const hit = eye.clone().addScaledVector(ray, along - Math.sqrt(1 - radius * radius));
        if (hit.x > 0.3) nightSurface.push(i);
      }
      if (off[i] + off[i + 1] + off[i + 2] !== 0) continue;
      if (radius < 1.005 || radius > 1.015) continue;
      const mu = closest.x / radius;
      const key = mu > 0.4 ? 'day' : mu < -0.25 ? 'night' : Math.abs(mu) < 0.03 ? 'twilight' : null;
      if (!key) continue;
      const bucket = buckets[key];
      bucket.count++;
      const rgb = Array.from(solar.subarray(i, i + 3));
      if (bgra) rgb.reverse();
      rgb.forEach((value, channel) => { bucket.rgb[channel] += value; });
    }
    change('solarAtmosphere', false);
    const legacy = await capture();
    change('solarAtmosphere', true);
    const restored = await capture();
    change('sunAzimuth', '180');
    const opposite = await capture();
    change('atmosphere', false);
    const hidden = await capture();
    change('atmosphere', true);
    change('solarAtmosphere', false);
    const nightLegacy = await capture();
    const patchError = data => nightSurface.reduce((sum, i) => sum + Math.abs(data[i] - hidden[i])
      + Math.abs(data[i + 1] - hidden[i + 1]) + Math.abs(data[i + 2] - hidden[i + 2]), 0);
    const nightSolarError = patchError(opposite), nightLegacyError = patchError(nightLegacy);
    change('atmosphere', false);
    const hiddenLegacy = await capture();
    change('atmosphere', true);
    change('materialView', 'roughness');
    const diagnostic = await capture();
    change('solarAtmosphere', true);
    const diagnosticSolar = await capture();
    const meshUnchanged = mesh === production.orbit._solidBuffer;
    change('backend', 'reference');
    const disabled = document.querySelector('[name="solarAtmosphere"]').disabled;
    const validation = await device.popErrorScope();
    pixels.destroy();
    ref.dispose();
    return { buckets, nightSurfaceCount: nightSurface.length, nightSolarError, nightLegacyError,
      legacy: difference(solar, legacy), restore: difference(solar, restored),
      sun: difference(solar, opposite), off: difference(hidden, hiddenLegacy),
      diagnostic: difference(diagnostic, diagnosticSolar), meshUnchanged, disabled,
      validation: validation?.message || null };
  });
  for (const bucket of Object.values(result.buckets)) expect(bucket.count).toBeGreaterThan(10);
  expect(result.buckets.day.rgb[2]).toBeGreaterThan(result.buckets.day.rgb[0] * 4);
  expect(result.buckets.twilight.rgb[0]).toBeGreaterThan(result.buckets.twilight.rgb[2] * 4);
  expect(result.buckets.night.rgb).toEqual([0, 0, 0]);
  expect(result.nightSurfaceCount).toBeGreaterThan(30);
  expect(result.nightSolarError).toBe(0);
  expect(result.nightLegacyError).toBeGreaterThan(100);
  expect(result.legacy).toBeGreaterThan(100);
  expect(result.sun).toBeGreaterThan(100);
  expect(result.restore).toBe(0);
  expect(result.off).toBe(0);
  expect(result.diagnostic).toBe(0);
  expect(result.meshUnchanged && result.disabled).toBe(true);
  expect(result.validation).toBeNull();
  expect(errors).toEqual([]);
});
