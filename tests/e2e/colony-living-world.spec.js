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
    level.render(1 / 60);
    const pixels = device.createBuffer({ size: 512 * 384 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: context.getCurrentTexture() },
      { buffer: pixels, bytesPerRow: 2048 }, [512, 384]);
    device.queue.submit([encoder.finish()]);
    await pixels.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(pixels.getMappedRange());
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
    pixels.unmap(); pixels.destroy();
    const smoke = level._particlePools.some((pool) => pool.smoke);
    const additive = level._particlePools.some((pool) => !pool.smoke);
    const cpuY = firstPool.system.dataBuffer[1];
    const count = level._buildingVfxStats.particles;
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
      count, smoke, additive, released, reentered };
  });
  test.skip(result.unavailable, 'WebGPU adapter unavailable');
  expect(result.errors).toEqual([]);
  expect(result.simulatedY).toBeGreaterThan(result.initialY);
  expect(result.cpuY).toBe(result.initialY);
  expect(result.colors).toBeGreaterThan(20);
  expect(result.bands).toBeGreaterThan(5);
  expect(result.count).toBeLessThanOrEqual(900);
  expect(result.smoke && result.additive && result.released).toBe(true);
  expect(result.reentered).toBe(16);
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
    const calls = level._renderer.info.render.calls;
    await level.exit(0);
    await level.enter(0);
    level.render(0.016);
    const count = level._instanced.count;
    level.dispose(); level.dispose();
    return { colors: colors.size, blending, calls, count };
  });
  expect(errors).toEqual([]);
  expect(result.colors).toBeGreaterThan(20);
  expect(result.calls).toBeGreaterThan(1);
  expect(new Set(result.blending).size).toBe(2);
  expect(result.count).toBe(4);
});
