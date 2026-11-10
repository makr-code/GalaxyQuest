const { test, expect } = require('@playwright/test');

test('colony renderer lights reference cities at night while daylight and dark terrain remain distinct', async ({ page }) => {
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
    device.pushErrorScope('validation');
    const change = (name, value) => {
      const control = document.querySelector(`[name="${name}"]`);
      if (control.type === 'checkbox') control.checked = value; else control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const name of ['motion', 'rotation', 'clouds', 'atmosphere', 'sky']) change(name, false);
    change('exaggeration', '1');
    change('bump', '0');
    change('view', 'africa');
    change('sunElevation', '0');
    change('sunAzimuth', '180');
    const { canvas } = production, bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256;
    const pixels = device.createBuffer({ size: bytesPerRow * canvas.height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
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
    const sample = (data, lon, lat, radius = 2) => {
      const p = ref.body.localToWorld(new Vector3(...geographicVector(lon, lat))).project(ref.camera);
      const x = Math.round((p.x + 1) * canvas.width / 2), y = Math.round((1 - p.y) * canvas.height / 2);
      let sum = 0, peak = 0;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const i = (y + dy) * bytesPerRow + (x + dx) * 4;
        const value = data[i] + data[i + 1] + data[i + 2];
        sum += value;
        peak = Math.max(peak, value);
      }
      return { sum, peak };
    };
    const difference = (a, b) => {
      let changed = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = y * bytesPerRow + x * 4;
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) changed++;
      }
      return changed;
    };
    change('cityLights', false);
    const dark = await capture();
    const mesh = production.orbit._solidBuffer;
    change('cityLights', true);
    const night = await capture();
    const berlinOff = sample(dark, 13.405, 52.52), berlinOn = sample(night, 13.405, 52.52);
    const desertNight = sample(dark, 20, 15);
    const colonyPlan = production.orbit._surfacePlan;
    change('cityLights', false);
    const restored = await capture();
    change('sunAzimuth', '0');
    const day = await capture();
    const desertDay = sample(day, 20, 15);
    change('cityLights', true);
    const dayLights = await capture();
    const berlinDay = sample(day, 13.405, 52.52), berlinDayOn = sample(dayLights, 13.405, 52.52);
    const meshUnchanged = mesh === production.orbit._solidBuffer;
    change('sunAzimuth', '180');
    change('materialView', 'albedo');
    const diagnostic = await capture();
    change('cityLights', false);
    const diagnosticOff = await capture();
    change('materialView', 'shaded');
    change('lighting', false);
    const unlit = await capture();
    change('cityLights', true);
    const unlitOn = await capture();
    change('representation', 'geometry');
    ref.render();
    const noGeometryPlan = production.orbit._surfacePlan === null;
    change('source', 'coasts');
    const vectorDisabled = document.querySelector('[name="cityLights"]').disabled;
    ref.render();
    const noVectorPlan = production.orbit._surfacePlan === null;
    change('backend', 'reference');
    const baselineDisabled = document.querySelector('[name="cityLights"]').disabled;
    const validation = await device.popErrorScope();
    pixels.destroy();
    ref.dispose();
    return { berlinOff, berlinOn, desertNight, desertDay, lights: difference(dark, night),
      restoration: difference(dark, restored), berlinDay, berlinDayOn,
      diagnostic: difference(diagnostic, diagnosticOff), meshUnchanged, vectorDisabled, baselineDisabled, noVectorPlan,
      unlit: difference(unlit, unlitOn), noGeometryPlan,
      count: colonyPlan.settlements.length, powered: colonyPlan.state.lights,
      validation: validation?.message || null };
  });

  expect(result.count).toBe(12);
  expect(result.powered).toBe(1);
  expect(result.berlinOn.peak).toBeGreaterThan(result.berlinOff.peak + 100);
  expect(result.lights).toBeGreaterThan(10);
  expect(result.desertDay.sum).toBeGreaterThan(result.desertNight.sum * 15);
  expect(result.restoration).toBe(0);
  expect(result.berlinDayOn).toEqual(result.berlinDay);
  expect(result.diagnostic).toBe(0);
  expect(result.unlit).toBe(0);
  expect(result.meshUnchanged && result.vectorDisabled && result.baselineDisabled && result.noVectorPlan && result.noGeometryPlan).toBe(true);
  expect(result.validation).toBeNull();
  expect(errors).toEqual([]);
});

test('population timeline expands day cities and night light area with deterministic accessible playback', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/tools/earth-reference.html');
    await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
    const result = await page.evaluate(async () => {
      const ref = window.GQEarthReference, { production, device } = ref;
      ref.renderer.setAnimationLoop(null);
      device.pushErrorScope('validation');
      const change = (name, value, event = 'change') => {
        const control = document.querySelector(`[name="${name}"]`);
        if (control.type === 'checkbox') control.checked = value; else control.value = value;
        control.dispatchEvent(new Event(event, { bubbles: true }));
      };
      for (const name of ['motion', 'rotation', 'clouds', 'atmosphere', 'sky']) change(name, false);
      change('view', 'africa');
      change('bump', '0');
      change('sunElevation', '0');
      change('sunAzimuth', '180');
      const { canvas } = production, bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256;
      const pixels = device.createBuffer({ size: bytesPerRow * canvas.height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const capture = async () => {
        production.render(0, ref.camera);
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: production.context.getCurrentTexture() },
          { buffer: pixels, bytesPerRow }, [canvas.width, canvas.height]);
        device.queue.submit([encoder.finish()]);
        await pixels.mapAsync(GPUMapMode.READ);
        const data = new Uint8Array(pixels.getMappedRange()).slice();
        pixels.unmap();
        return data;
      };
      const area = (a, b) => {
        let count = 0;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          const i = y * bytesPerRow + x * 4;
          if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 20) count++;
        }
        return count;
      };
      const lightArea = async year => {
        change('developmentYear', year, 'input');
        change('cityLights', false);
        const off = await capture();
        change('cityLights', true);
        return area(off, await capture());
      };
      const earlyArea = await lightArea(0);
      const mesh = production.orbit._solidBuffer;
      const earlyPlan = production.orbit._surfacePlan;
      const lateArea = await lightArea(100);
      const latePlan = production.orbit._surfacePlan;
      const latePixels = await capture();
      const lateUniforms = Array.from(window.GQColonySurfacePlan.uniforms(latePlan));
      change('developmentYear', '25', 'input');
      change('developmentYear', '100', 'input');
      const reconstructedPixels = await capture();
      const reconstructed = JSON.stringify(lateUniforms)
        === JSON.stringify(Array.from(window.GQColonySurfacePlan.uniforms(production.orbit._surfacePlan)));
      change('sunAzimuth', '0');
      const dayLate = await capture();
      const dayRadii = production.orbit._surfacePlan.settlements.map(site => site.radius);
      change('developmentYear', '0', 'input');
      const dayEarly = await capture();
      change('developmentPlaying', true);
      production.render(0.1, ref.camera);
      const motionPaused = production.development.year;
      change('motion', true);
      production.render(0.1, ref.camera);
      const advanced = production.development.year;
      change('developmentYear', '0', 'input');
      for (let frame = 0; frame < 10; frame++) production.render(0.01, ref.camera);
      const fineFrames = production.development.year;
      // Synchronize the visible slider before checking pause/resume via other controls.
      ref.render();
      change('materialView', 'normal');
      const diagnosticYear = production.development.year;
      production.render(0.1, ref.camera);
      const diagnosticPaused = production.development.year === diagnosticYear;
      change('materialView', 'shaded');
      change('developmentYear', '199.99', 'input');
      production.render(0.1, ref.camera);
      const end = production.development.year;
      production.render(0.1, ref.camera);
      const ended = production.development.year;
      change('developmentYear', '50', 'input');
      const validation = await device.popErrorScope();
      const meshUnchanged = mesh === production.orbit._solidBuffer;
      pixels.destroy();
      return { earlyArea, lateArea, dayChanged: area(dayEarly, dayLate), dayRadii,
        earlyRadii: earlyPlan.settlements.map(site => site.radius), lateRadii: latePlan.settlements.map(site => site.radius),
        earlyCities: earlyPlan.urbanSettlements.length, lateCities: latePlan.urbanSettlements.length,
        reconstructed, exactPixels: latePixels.every((n, i) => n === reconstructedPixels[i]),
        fineFrames, motionPaused, advanced, diagnosticPaused, end, ended, meshUnchanged, validation: validation?.message || null };
    });
    expect(result.lateArea).toBeGreaterThan(Math.max(20, result.earlyArea * 8));
    expect(result.dayChanged).toBeGreaterThan(20);
    expect(result.dayRadii).toEqual(result.lateRadii);
    result.lateRadii.forEach((radius, index) => expect(radius).toBeGreaterThan(result.earlyRadii[index] * 7));
    expect(result.motionPaused).toBe(0);
    expect(result.advanced).toBeCloseTo(1 / 3, 8);
    expect(result.fineFrames).toBeCloseTo(result.advanced, 8);
    expect(result.lateCities).toBeGreaterThan(result.earlyCities);
    expect(result.lateCities).toBeGreaterThan(12);
    expect(result.reconstructed && result.exactPixels).toBe(true);
    expect(result.diagnosticPaused && result.meshUnchanged).toBe(true);
    expect(result.end).toBe(200);
    expect(result.ended).toBe(200);
    expect(result.validation).toBeNull();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const paused = await page.evaluate(() => {
      const ref = window.GQEarthReference;
      const before = ref.production.development.year;
      ref.production.render(0.1, ref.camera);
      const after = ref.production.development.year;
      ref.dispose();
      return { before, after };
    });
    expect(paused.after).toBe(paused.before);
    expect(errors).toEqual([]);
  });
