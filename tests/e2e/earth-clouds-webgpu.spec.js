const { test, expect } = require('@playwright/test');

test('projected cloud shadows attenuate only direct daylight and follow altitude without changing terrain', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const ref = window.GQEarthReference, { production, device } = ref;
    const { Vector3 } = await import('/node_modules/three/build/three.webgpu.js');
    const { geographicVector } = await import('/js/rendering/earth-reference-geography.js');
    ref.renderer.setAnimationLoop(null);
    // Isolate actual terrain shadow pixels from white-cloud blending.
    // The separate shell test covers the normal foreground rendering path.
    const foreground = production.surface.drawForeground;
    production.surface.drawForeground = () => {};
    device.pushErrorScope('validation');
    const change = (name, value) => {
      const control = document.querySelector(`[name="${name}"]`);
      if (control.type === 'checkbox') control.checked = value; else control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const name of ['motion', 'rotation', 'atmosphere', 'sky']) change(name, false);
    change('clouds', true);
    change('cloudMode', 'shell');
    change('exaggeration', '1');
    change('bump', '0');
    change('sunAzimuth', '0');
    change('sunElevation', '0');
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
      const bytes = new Uint8Array(pixels.getMappedRange()).slice();
      pixels.unmap();
      return bytes;
    };
    const difference = (a, b) => {
      let changed = 0, brighter = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = y * bytesPerRow + x * 4;
        const delta = b[i] + b[i + 1] + b[i + 2] - a[i] - a[i + 1] - a[i + 2];
        if (Math.abs(delta) > 6) changed++;
        if (delta > 2) brighter++;
      }
      return { changed, brighter };
    };
    const measure = async () => {
      change('cloudShadows', false);
      const off = await capture();
      change('cloudShadows', true);
      const on = await capture();
      return { off, on, ...difference(off, on) };
    };
    const low = await measure();
    const mesh = production.orbit._solidBuffer;
    change('cloudAltitude', '200');
    const high = await measure();
    const meshUnchanged = mesh === production.orbit._solidBuffer;
    change('phase', '30');
    const phase30 = await capture();
    change('phase', '120');
    const loop = await capture();
    change('lighting', false);
    const unlit = await measure();
    const linear = byte => {
      const value = byte / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const smooth = (a, b, x) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    // Independent scalar oracle for shared zero-phase noise, compared to the
    // direct-light transmission recovered from real shaded and unlit pixels.
    const hash = (cell, seed) => {
      let h = Math.imul(cell[0], 1597334677) ^ Math.imul(cell[1], 3812015801)
        ^ Math.imul(cell[2], 2798796415) ^ seed;
      h = Math.imul(h ^ (h >>> 16), 2246822519);
      h = Math.imul(h ^ (h >>> 13), 3266489917);
      return ((h ^ (h >>> 16)) & 16777215) / 16777215;
    };
    const field = (point, seed) => {
      const cell = point.map(Math.floor);
      const t = point.map((n, i) => { const f = n - cell[i]; return f * f * (3 - 2 * f); });
      let result = 0;
      for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        result += hash([cell[0] + x, cell[1] + y, cell[2] + z], seed)
          * (x ? t[0] : 1 - t[0]) * (y ? t[1] : 1 - t[1]) * (z ? t[2] : 1 - t[2]);
      }
      return result;
    };
    const density = (point, footprint) => {
      const seed = production.orbit._materialState.seed;
      const p = [point[0] + seed * 0.17 + 0.8, point[1] + seed * 0.31,
        point[2] + seed * 0.23 + Math.sin(0.7) * 0.8];
      const q = [p[0] + Math.sin(p[1] * 0.7) * 0.45,
        p[1] + Math.sin(p[2] * 0.8 + 1.3) * 0.45, p[2] + Math.cos(p[0] * 0.6) * 0.45];
      const weather = field(q.map(n => n * 0.45), seed >>> 0);
      const billows = field(q.map(n => n * 1.8), (seed + 101) >>> 0);
      const erosion = field(q.map(n => n * 5.4), (seed + 239) >>> 0);
      const front = 1 - Math.abs(Math.sin(q[0] * 0.65 + q[2] * 0.3 + weather * 5));
      const noise = Math.max(0, Math.min(1, 0.5
        + ((weather - 0.5) * 0.95 + (front - 0.5) * smooth(0.45, 0.75, weather) * 0.35)
          * (1 - smooth(0.5, 1.5, footprint))
        + (billows - 0.5) * 0.55 * (1 - smooth(0.15, 0.6, footprint))
        + (erosion - 0.5) * 0.22 * (1 - smooth(0.04, 0.2, footprint))));
      return smooth(0.35, 1.02, noise);
    };
    const sun = production.orbit._orientation.basis.map(column =>
      column.reduce((sum, n, i) => sum + n * production.appearance.sun[i], 0));
    const oracle = [];
    const rect = canvas.getBoundingClientRect();
    for (const [lon, lat] of [[0, 0], [20, 15], [20, 30], [40, 0], [45, 30], [-10, 25]]) {
      const world = ref.body.localToWorld(new Vector3(...geographicVector(lon, lat))).project(ref.camera);
      const x = Math.floor((world.x + 1) * canvas.width / 2), y = Math.floor((1 - world.y) * canvas.height / 2);
      const hit = ref.inspectPoint(rect.left + (x + 0.5) * rect.width / canvas.width,
        rect.top + (y + 0.5) * rect.height / canvas.height);
      const radius = 1 + hit.meshElevation / 6371008.8;
      const p = geographicVector(hit.longitude, hit.latitude, radius);
      const along = p.reduce((sum, n, i) => sum + n * sun[i], 0);
      const cloudRadius = 1 + 200 / 6371.0088;
      const distance = -along + Math.sqrt(along * along + cloudRadius ** 2 - radius ** 2);
      const projected = p.map((n, i) => n + sun[i] * distance);
      const cloudPoint = projected.map(n => n / Math.hypot(...projected) * 12);
      const neighbourCloudPoint = (px, py) => {
        const neighbour = ref.inspectPoint(rect.left + (px + 0.5) * rect.width / canvas.width,
          rect.top + (py + 0.5) * rect.height / canvas.height);
        const r = 1 + neighbour.meshElevation / 6371008.8;
        const position = geographicVector(neighbour.longitude, neighbour.latitude, r);
        const a = position.reduce((sum, n, i) => sum + n * sun[i], 0);
        const d = -a + Math.sqrt(a * a + cloudRadius ** 2 - r ** 2);
        const projectedNeighbour = position.map((n, i) => n + sun[i] * d);
        return projectedNeighbour.map(n => n / Math.hypot(...projectedNeighbour) * 12);
      };
      const footprint = Math.max(...[neighbourCloudPoint(x ^ 1, y), neighbourCloudPoint(x, y ^ 1)]
        .map(point => Math.hypot(...point.map((n, i) => n - cloudPoint[i]))));
      const expected = density(cloudPoint, footprint)
        * smooth(0, 0.12, along / radius);
      const i = y * bytesPerRow + x * 4;
      for (let channel = 0; channel < 3; channel++) {
        const clear = linear(high.off[i + channel]), shaded = linear(high.on[i + channel]);
        const ambient = linear(unlit.off[i + channel]) * 0.3;
        if (high.off[i + channel] > 220 || clear - ambient < 0.03) continue;
        const halfStep = byte => Math.max(linear(Math.min(255, byte + 0.5)) - linear(byte),
          linear(byte) - linear(Math.max(0, byte - 0.5)));
        const attenuation = expected * 0.55;
        const predicted = clear * (1 - attenuation) + ambient * attenuation;
        const quantization = halfStep(high.off[i + channel]) * (1 - attenuation)
          + halfStep(high.on[i + channel])
          + halfStep(unlit.off[i + channel]) * 0.3 * attenuation;
        oracle.push({ expected, error: Math.abs(predicted - shaded),
          tolerance: quantization + (clear - ambient) * 0.55 * 0.01 });
      }
    }
    change('lighting', true);
    change('materialView', 'roughness');
    const diagnostic = await measure();
    change('materialView', 'shaded');
    change('clouds', false);
    const noClouds = await measure();
    change('clouds', true);
    change('sunAzimuth', '180');
    const night = await measure();
    const point = ref.body.localToWorld(new Vector3(...geographicVector(20, 15))).project(ref.camera);
    const x = Math.round((point.x + 1) * canvas.width / 2), y = Math.round((1 - point.y) * canvas.height / 2);
    const patchDifference = (a, b, x, y) => {
      let sum = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const i = (y + dy) * bytesPerRow + (x + dx) * 4;
        sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      }
      return sum;
    };
    const nightCenter = patchDifference(night.off, night.on, x, y);
    change('sunAzimuth', '0');
    change('cloudAltitude', '12');
    change('view', 'himalaya');
    change('exaggeration', '40');
    change('detail', '180');
    const above = await measure();
    const tibet = ref.body.localToWorld(new Vector3(...geographicVector(87, 30))).project(ref.camera);
    const aboveCenter = patchDifference(above.off, above.on,
      Math.round((tibet.x + 1) * canvas.width / 2), Math.round((1 - tibet.y) * canvas.height / 2));
    change('cloudMode', 'surface');
    const disabledInSurface = document.querySelector('[name="cloudShadows"]').disabled;
    const surface = await measure();
    change('backend', 'reference');
    const disabledInBaseline = document.querySelector('[name="cloudShadows"]').disabled;
    production.surface.drawForeground = foreground;
    const validation = await device.popErrorScope();
    pixels.destroy();
    ref.dispose();
    return { low: low.changed, high: high.changed, brighter: low.brighter + high.brighter,
      altitude: difference(low.on, high.on).changed, clearAltitude: difference(low.off, high.off).changed,
      phase: difference(high.on, phase30).changed, loop: difference(high.on, loop).changed,
      unlit: unlit.changed, diagnostic: diagnostic.changed, noClouds: noClouds.changed,
      nightCenter, aboveCenter, oracle, surface: surface.changed, meshUnchanged, disabledInSurface, disabledInBaseline,
      validation: validation?.message || null };
  });
  for (const key of ['low', 'high', 'altitude', 'phase']) expect(result[key], key).toBeGreaterThan(100);
  for (const key of ['brighter', 'clearAltitude', 'loop', 'unlit', 'diagnostic', 'noClouds', 'nightCenter', 'aboveCenter', 'surface']) {
    expect(result[key], key).toBe(0);
  }
  expect(result.meshUnchanged && result.disabledInSurface && result.disabledInBaseline).toBe(true);
  expect(result.oracle.length).toBeGreaterThan(5);
  expect(result.oracle.some(sample => sample.expected > 0.05)).toBe(true);
  for (const sample of result.oracle) expect(sample.error).toBeLessThan(sample.tolerance);
  expect(result.validation).toBeNull();
  expect(errors).toEqual([]);
});

test('cloud shell has visible altitude, terrain occlusion, directional sunlight and deterministic phase', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const ref = window.GQEarthReference, { production, device } = ref;
    const { Vector3, Ray, Sphere } = await import('/node_modules/three/build/three.webgpu.js');
    const { geographicVector } = await import('/js/rendering/earth-reference-geography.js');
    ref.renderer.setAnimationLoop(null);
    device.pushErrorScope('validation');
    const change = (name, value) => {
      const control = document.querySelector(`[name="${name}"]`);
      if (control.type === 'checkbox') control.checked = value; else control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const name of ['motion', 'rotation', 'clouds', 'atmosphere', 'sky']) change(name, false);
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
    const { createEarthClouds } = await import('/js/rendering/earth-reference-clouds.js');
    const flatClouds = createEarthClouds(device, production.context.getConfiguration().format,
      window.GQBodyMaterial.CLOUD_WGSL.replace('0.45 * (1.0 - exp(-occluder * 2.0))',
        '0.0 * (1.0 - exp(-occluder * 2.0))'));
    const foreground = production.surface.drawForeground;
    const flatForeground = (pass, frame) => flatClouds.draw(pass, frame, production.appearance.cloudAltitude,
      document.querySelector('[name="lighting"]').checked);
    const clear = await capture();
    const buffer = production.orbit._solidBuffer;
    change('clouds', true);
    change('cloudAltitude', '200');
    const high = await capture();
    production.surface.drawForeground = flatForeground;
    const flatHigh = await capture();
    production.surface.drawForeground = foreground;
    let reliefDarkened = 0, reliefBrightened = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = y * bytesPerRow + x * 4;
      const delta = high[i] + high[i + 1] + high[i + 2] - flatHigh[i] - flatHigh[i + 1] - flatHigh[i + 2];
      if (delta < -6) reliefDarkened++;
      if (delta > 2) reliefBrightened++;
    }
    let beyondLimb = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = y * bytesPerRow + x * 4;
      if (clear[i] + clear[i + 1] + clear[i + 2] === 0 && high[i] + high[i + 1] + high[i + 2] > 15) beyondLimb++;
    }
    change('cloudAltitude', '12');
    const low = await capture();
    change('cloudMode', 'surface');
    const surface = await capture();
    const altitudeDisabled = document.querySelector('[name="cloudAltitude"]').disabled;
    change('cloudMode', 'shell');
    const restoredLow = await capture();
    change('cloudAltitude', '200');
    change('sunAzimuth', '180');
    const dark = await capture();
    const shell = new Sphere(new Vector3(), 1 + 200 / 6371.0088);
    const ray = new Ray(), hit = new Vector3();
    ray.origin.copy(ref.camera.position);
    let litCloud = 0, darkCloud = 0, cloudSamples = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = y * bytesPerRow + x * 4;
      if (clear[i] + clear[i + 1] + clear[i + 2] === 0 && high[i] + high[i + 1] + high[i + 2] > 15) {
        ray.direction.set((x + 0.5) / canvas.width * 2 - 1, 1 - (y + 0.5) / canvas.height * 2, 1)
          .unproject(ref.camera).sub(ray.origin).normalize();
        if (!ray.intersectSphere(shell, hit) || hit.x / shell.radius < 0.3) continue;
        litCloud += high[i] + high[i + 1] + high[i + 2];
        darkCloud += dark[i] + dark[i + 1] + dark[i + 2];
        cloudSamples++;
      }
    }
    change('sunAzimuth', '0');
    const restoredSun = await capture();
    const consistentSun = production.appearance.sun.every((n, i) => Math.abs(n - production.orbit._orientation.sun[i]) < 1e-6);
    const meshUnchanged = buffer === production.orbit._solidBuffer;
    change('materialView', 'roughness');
    const diagnostic = await capture();
    change('clouds', false);
    const diagnosticClear = await capture();
    change('materialView', 'shaded');
    change('view', 'himalaya');
    change('cloudAltitude', '12');
    change('exaggeration', '1');
    change('detail', '180');
    change('lighting', false);
    const exposed = await capture();
    const point = ref.body.localToWorld(new Vector3(...geographicVector(87, 30))).project(ref.camera);
    const x = Math.round((point.x + 1) * canvas.width / 2), y = Math.round((1 - point.y) * canvas.height / 2);
    const pointDifference = (a, b) => {
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const i = (y + dy) * bytesPerRow + (x + dx) * 4;
        sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      }
      return sum;
    };
    change('clouds', true);
    let overlay, pointCloud = 0;
    // Choose a phase with an actual cloud above the test point, not a clear gap.
    for (const phase of ['0', '30', '60', '90']) {
      change('phase', phase);
      overlay = await capture();
      pointCloud = pointDifference(exposed, overlay);
      if (pointCloud > 20) break;
    }
    production.surface.drawForeground = flatForeground;
    const flatUnlit = await capture();
    production.surface.drawForeground = foreground;
    const unlitRelief = difference(overlay, flatUnlit);
    // The same cloud is hidden once 40x terrain protrudes through the sheet.
    // Unlit mode disables the approximate surface shadow, isolating depth.
    change('exaggeration', '40');
    const covered = await capture();
    change('clouds', false);
    const uncovered = await capture();
    const occlusionError = pointDifference(covered, uncovered);
    change('backend', 'reference');
    const disabled = ['cloudMode', 'cloudAltitude', 'sunAzimuth', 'sunElevation']
      .every(name => document.querySelector(`[name="${name}"]`).disabled);
    const validation = await device.popErrorScope();
    pixels.destroy();
    flatClouds.dispose();
    ref.dispose();
    return { beyondLimb, altitude: difference(low, high), modes: difference(low, surface),
      restoration: difference(low, restoredLow), sunlight: difference(high, dark),
      restoredSun: difference(high, restoredSun), diagnostic: difference(diagnostic, diagnosticClear),
      occlusionError, pointCloud, litCloud, darkCloud, cloudSamples, normalClouds: difference(exposed, overlay),
      consistentSun, meshUnchanged, altitudeDisabled, disabled, reliefDarkened, reliefBrightened, unlitRelief,
      validation: validation?.message || null };
  });
  expect(result.beyondLimb).toBeGreaterThan(30);
  expect(result.cloudSamples).toBeGreaterThan(20);
  expect(result.litCloud).toBeGreaterThan(result.darkCloud * 5);
  expect(result.pointCloud).toBeGreaterThan(20);
  expect(result.reliefDarkened).toBeGreaterThan(100);
  expect(result.reliefBrightened).toBe(0);
  expect(result.unlitRelief).toBe(0);
  for (const key of ['altitude', 'modes', 'sunlight', 'normalClouds']) expect(result[key], key).toBeGreaterThan(100);
  for (const key of ['restoration', 'restoredSun', 'diagnostic', 'occlusionError']) expect(result[key], key).toBe(0);
  expect(result.consistentSun && result.meshUnchanged && result.altitudeDisabled && result.disabled).toBe(true);
  expect(result.validation).toBeNull();
  expect(errors).toEqual([]);
});
