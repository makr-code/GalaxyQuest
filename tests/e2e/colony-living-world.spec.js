const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-vulkan=swiftshader',
      '--enable-features=Vulkan', '--disable-vulkan-fallback-to-gl-for-testing',
      '--disable-dawn-features=disallow_unsafe_apis'],
  },
});

test('colony renders coherent PBR rows and GPU-resident particles across re-entry', async ({ page }) => {
  await page.route('http://localhost:8080/**', async (route) => {
    const relative = new URL(route.request().url()).pathname.slice(1);
    if (!relative) return route.fulfill({ contentType: 'text/html', body: '<canvas width="512" height="384"></canvas>' });
    if (!/^js\/[\w/.-]+\.js$/.test(relative) || relative.includes('..')) return route.abort();
    return route.fulfill({
      contentType: 'application/javascript',
      body: await fs.readFile(path.join(__dirname, '../..', relative), 'utf8'),
    });
  });
  await page.goto('http://localhost:8080/');
  await page.addScriptTag({ url: '/js/engine/zoom/IZoomLevelRenderer.js' });
  await page.addScriptTag({ url: '/js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js' });
  const result = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) return { unavailable: true };
    const device = await adapter.requestDevice();
    const uploads = [];
    const writeTexture = device.queue.writeTexture.bind(device.queue);
    device.queue.writeTexture = (...args) => { uploads.push(args); return writeTexture(...args); };
    const errors = [];
    device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
    device.pushErrorScope('validation');
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    context.configure({
      device, format: navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const level = new window.GQColonySurfaceLevelWebGPU.ColonySurfaceLevelWebGPU();
    await level.initialize(canvas, { device, context });
    const slots = ['habitat', 'factory', 'reactor', 'research'].flatMap((type, row) =>
      Array.from({ length: 4 }, (_, column) => ({ type, x: (column - 1.5) * 4, z: (row - 1.5) * 5 })));
    await level.enter(2, { slots, vfx_quality: 'high' });
    await level._materialRefresh;
    const firstPool = level._particlePools[0];
    const initialY = firstPool.system.dataBuffer[1];
    for (let frame = 0; frame < 60; frame++) level.render(1 / 60);
    await device.queue.onSubmittedWorkDone();
    const staging = device.createBuffer({ size: 64, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    let encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(firstPool.system.storageBuffer, 0, staging, 0, 64);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const simulatedY = new Float32Array(staging.getMappedRange())[1];
    staging.unmap(); staging.destroy();
    const smoke = level._particlePools.some((pool) => pool.smoke);
    const additive = level._particlePools.some((pool) => !pool.smoke);
    const cpuY = firstPool.system.dataBuffer[1];
    const count = level._buildingVfxStats.particles;
    // Freeze effects while comparing each PBR map's actual pixel contribution.
    level.setSceneData({ slots, vfx_enabled: false });
    level.render(1 / 60);
    const pixels = device.createBuffer({ size: 512 * 384 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: context.getCurrentTexture() },
      { buffer: pixels, bytesPerRow: 2048 }, [512, 384]);
    device.queue.submit([encoder.finish()]);
    await pixels.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(pixels.getMappedRange());
    const originalPixels = bytes.slice();
    const colors = new Set();
    const occupiedBands = new Set();
    for (let y = 0; y < 384; y++) {
      for (let x = 0; x < 512; x++) {
        const offset = (y * 512 + x) * 4;
        if (Math.max(bytes[offset], bytes[offset + 1], bytes[offset + 2]) > 75) {
          colors.add(`${bytes[offset] >> 4}:${bytes[offset + 1] >> 4}:${bytes[offset + 2] >> 4}`);
          occupiedBands.add(Math.floor(y / 24));
        }
      }
    }
    pixels.unmap();
    const originals = uploads.slice(0, 20);
    const neutral = [[128,128,128,255], [128,128,255,255], [255,255,255,255], [0,0,0,255], [0,0,0,255]];
    const mapDifferences = [];
    for (let map = 0; map < 5; map++) {
      const sourceUploads = originals.filter((upload) => upload[0].texture === level._materialTextures[map]);
      const replacement = new Uint8Array(64 * 64 * 4);
      for (let offset = 0; offset < replacement.length; offset += 4) replacement.set(neutral[map], offset);
      sourceUploads.forEach((upload) => writeTexture(upload[0], replacement, upload[2], upload[3]));
      level.render(0);
      encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: context.getCurrentTexture() },
        { buffer: pixels, bytesPerRow: 2048 }, [512, 384]);
      device.queue.submit([encoder.finish()]);
      await pixels.mapAsync(GPUMapMode.READ);
      const changed = new Uint8Array(pixels.getMappedRange());
      let differences = 0;
      for (let offset = 0; offset < changed.length; offset += 4) {
        if (Math.abs(changed[offset] - originalPixels[offset])
          + Math.abs(changed[offset + 1] - originalPixels[offset + 1])
          + Math.abs(changed[offset + 2] - originalPixels[offset + 2]) > 3) differences++;
      }
      mapDifferences.push(differences);
      pixels.unmap();
      sourceUploads.forEach((upload) => writeTexture(...upload));
    }
    level.setSceneData({ slots: slots.map((slot) => ({ ...slot, active: false })), vfx_enabled: false });
    level.render(0);
    encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: context.getCurrentTexture() },
      { buffer: pixels, bytesPerRow: 2048 }, [512, 384]);
    device.queue.submit([encoder.finish()]);
    await pixels.mapAsync(GPUMapMode.READ);
    const inactivePixels = new Uint8Array(pixels.getMappedRange());
    let stateDifferences = 0;
    for (let offset = 0; offset < inactivePixels.length; offset += 4) {
      if (Math.abs(inactivePixels[offset] - originalPixels[offset])
        + Math.abs(inactivePixels[offset + 1] - originalPixels[offset + 1])
        + Math.abs(inactivePixels[offset + 2] - originalPixels[offset + 2]) > 3) stateDifferences++;
    }
    pixels.unmap();
    level.setSceneData({ slots: slots.map((slot) => ({ ...slot, upgrade_end: 'pending' })), vfx_quality: 'high' });
    for (let frame = 0; frame < 20; frame++) level.render(1 / 60);
    const captureBurstPixels = async () => {
      level.render(0); // Keep GPU particle state identical between the two captures.
      const captureEncoder = device.createCommandEncoder();
      captureEncoder.copyTextureToBuffer({ texture: context.getCurrentTexture() },
        { buffer: pixels, bytesPerRow: 2048 }, [512, 384]);
      device.queue.submit([captureEncoder.finish()]);
      await pixels.mapAsync(GPUMapMode.READ);
      const captured = new Uint8Array(pixels.getMappedRange()).slice();
      pixels.unmap();
      return captured;
    };
    const burstPixels = await captureBurstPixels();
    level._sceneData.reduced_flash = true;
    const reducedPixels = await captureBurstPixels();
    let burstDifferences = 0;
    for (let offset = 0; offset < burstPixels.length; offset += 4) {
      if (Math.abs(burstPixels[offset] - reducedPixels[offset])
        + Math.abs(burstPixels[offset + 1] - reducedPixels[offset + 1])
        + Math.abs(burstPixels[offset + 2] - reducedPixels[offset + 2]) > 3) burstDifferences++;
    }
    pixels.destroy();
    level.setSceneData({ slots, vfx_quality: 'high' });
    await level.exit(0);
    const released = level._particlePools.length === 0 && level._materialTextures.length === 0;
    await level.enter(0);
    level.render(1 / 60);
    await device.queue.onSubmittedWorkDone();
    const reentered = level._slotCount;
    level.dispose(); level.dispose();
    const scoped = await device.popErrorScope();
    if (scoped) errors.push(scoped.message);
    device.destroy();
    return { errors, initialY, simulatedY, cpuY, colors: colors.size, bands: occupiedBands.size,
      count, smoke, additive, released, reentered, mapDifferences, burstDifferences, stateDifferences };
  });
  test.skip(result.unavailable, 'WebGPU adapter unavailable');
  expect(result.errors).toEqual([]);
  expect(result.simulatedY).toBeGreaterThan(result.initialY);
  expect(result.cpuY).toBe(result.initialY);
  expect(result.colors).toBeGreaterThan(20);
  for (const differences of result.mapDifferences) expect(differences).toBeGreaterThan(10);
  expect(result.burstDifferences).toBeGreaterThan(20);
  expect(result.stateDifferences).toBeGreaterThan(10);
  expect(result.bands).toBeGreaterThan(5);
  expect(result.count).toBeLessThanOrEqual(900);
  expect(result.smoke && result.additive && result.released).toBe(true);
  expect(result.reentered).toBe(16);
  await page.reload();
  await page.addScriptTag({ url: '/js/engine/zoom/IZoomLevelRenderer.js' });
  await page.addScriptTag({ url: '/js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js' });
  const cached = await page.evaluate(async () => {
    await import('/js/engine/assets/WorldAssetDescriptor.js');
    await import('/js/engine/assets/CoherentMaterialGenerator.js');
    const generator = window.CoherentMaterialGenerator;
    const original = generator.generate;
    let syntheses = 0;
    generator.generate = (...args) => {
      syntheses++;
      const result = original.call(generator, ...args);
      result.maps.albedo.data.fill(0); // Deliberately different immediate fallback.
      return result;
    };
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });
    const level = new window.GQColonySurfaceLevelWebGPU.ColonySurfaceLevelWebGPU();
    await level.initialize(canvas, { device, context });
    const immediateFallback = level._materialSets[0].maps.albedo.data.every((byte) => byte === 0);
    await level._materialRefresh;
    const sets = level._materialSets.length;
    const bytes = level._materialSets[0].maps.albedo.data.length;
    const cachedRestored = level._materialSets[0].maps.albedo.data.some((byte) => byte !== 0);
    level.dispose(); device.destroy();
    return { syntheses, sets, bytes, immediateFallback, cachedRestored };
  });
  expect(cached).toEqual({ syntheses: 4, sets: 4, bytes: 64 * 64 * 4,
    immediateFallback: true, cachedRestored: true });
});

test('Three.js fallback renders the same coherent atlas and separates smoke blending', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('http://localhost:8080/**', async (route) => {
    const relative = new URL(route.request().url()).pathname.slice(1);
    if (!relative) return route.fulfill({ contentType: 'text/html', body: '<canvas width="512" height="384" style="width:512px;height:384px"></canvas>' });
    if (!/^(js\/|node_modules\/three\/build\/)[\w/.-]+\.js$/.test(relative) || relative.includes('..')) return route.abort();
    return route.fulfill({
      contentType: 'application/javascript',
      body: await fs.readFile(path.join(__dirname, '../..', relative), 'utf8'),
    });
  });
  await page.goto('http://localhost:8080/');
  await page.evaluate(async () => { window.THREE = await import('/node_modules/three/build/three.module.js'); });
  await page.addScriptTag({ url: '/js/engine/zoom/IZoomLevelRenderer.js' });
  await page.addScriptTag({ url: '/js/engine/zoom/levels/ColonySurfaceLevelThreeJS.js' });
  const result = await page.evaluate(async () => {
    const level = new window.GQColonySurfaceLevelThreeJS.ColonySurfaceLevelThreeJS();
    await level.initialize(document.querySelector('canvas'), {});
    await level.enter(2, { slots: [
      { x: -4, z: -5, type: 'factory' }, { x: 0, z: -5, type: 'reactor' },
      { x: 4, z: -5, type: 'research' }, { x: 0, z: 5, type: 'habitat' },
    ] });
    level.render(0.016);
    const gl = level._renderer.getContext();
    const bytes = new Uint8Array(512 * 384 * 4);
    gl.readPixels(0, 0, 512, 384, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    const colors = new Set();
    for (let i = 0; i < bytes.length; i += 4) {
      if (Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) > 75) {
        colors.add(`${bytes[i] >> 4}:${bytes[i + 1] >> 4}:${bytes[i + 2] >> 4}`);
      }
    }
    const blending = level._buildingVfxEmitters.map((emitter) => emitter.material.blending);
    level.setSceneData({ slots: level._sceneData.slots.map((slot) => ({ ...slot, active: false })) });
    level.render(0);
    const inactive = new Uint8Array(bytes.length);
    gl.readPixels(0, 0, 512, 384, gl.RGBA, gl.UNSIGNED_BYTE, inactive);
    let stateDifferences = 0;
    for (let offset = 0; offset < bytes.length; offset += 4) {
      if (Math.abs(bytes[offset] - inactive[offset])
        + Math.abs(bytes[offset + 1] - inactive[offset + 1])
        + Math.abs(bytes[offset + 2] - inactive[offset + 2]) > 3) stateDifferences++;
    }
    const calls = level._renderer.info.render.calls;
    await level.exit(0);
    await level.enter(0);
    level.render(0.016);
    const count = level._instanced.count;
    level.dispose(); level.dispose();
    return { colors: colors.size, blending, calls, count, stateDifferences };
  });
  expect(errors).toEqual([]);
  expect(result.colors).toBeGreaterThan(20);
  expect(result.calls).toBeGreaterThan(1);
  expect(new Set(result.blending).size).toBe(2);
  expect(result.count).toBe(4);
  expect(result.stateDifferences).toBeGreaterThan(10);
});
