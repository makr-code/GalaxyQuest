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

async function setup(page, backend) {
  await page.route('http://localhost:8080/**', async route => {
    const relative = new URL(route.request().url()).pathname.slice(1);
    if (!relative) return route.fulfill({ contentType: 'text/html',
      body: '<canvas width="512" height="384" style="width:512px;height:384px"></canvas>' });
    if (!/^(js\/|node_modules\/three\/build\/)[\w/.-]+\.js$/.test(relative) || relative.includes('..')) return route.abort();
    return route.fulfill({ contentType: 'application/javascript',
      body: await fs.readFile(path.join(__dirname, '../..', relative), 'utf8') });
  });
  await page.goto('http://localhost:8080/');
  if (backend === 'ThreeJS') {
    await page.evaluate(async () => { window.THREE = await import('/node_modules/three/build/three.module.js'); });
  }
  await page.addScriptTag({ url: '/js/engine/zoom/IZoomLevelRenderer.js' });
  await page.addScriptTag({ url: `/js/engine/zoom/levels/PlanetApproachLevel${backend}.js` });
}

for (const backend of ['WebGPU', 'ThreeJS']) {
  test(`${backend}: seeded planet pixels, independent clouds, night state, controls and re-entry`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
    await setup(page, backend);
    const result = await page.evaluate(async backend => {
      const native = backend === 'WebGPU';
      const errors = [];
      const canvas = document.querySelector('canvas');
      let device, context, pixels;
      if (native) {
        const adapter = await navigator.gpu?.requestAdapter();
        if (!adapter) return { unavailable: true };
        device = await adapter.requestDevice();
        device.addEventListener('uncapturederror', event => errors.push(event.error.message));
        device.pushErrorScope('validation');
        context = canvas.getContext('webgpu');
        context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(),
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        pixels = device.createBuffer({ size: 512 * 384 * 4,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      }
      const Level = window[`GQPlanetApproachLevel${backend}`][`PlanetApproachLevel${backend}`];
      const level = new Level();
      // Actual backend slot/body + public manifest shape, not bespoke terrain.
      const terrain = { seed: 'earth-23', variant: 'terran', clouds: 0.8 };
      const initial = { position: 3, seed: 'earth-23',
        generated_planet: { id: 23, position: 3, planet_class: 'terran' },
        planet_texture_manifest: { planets: { 3: terrain } },
        night_lights: 1, vfx_quality: 'high' };
      level.setSceneData(initial);
      await level.initialize(canvas, native ? { device, context } : {});
      await level.enter(1);
      const capture = async () => {
        level.render(0);
        if (!native) {
          const gl = level._renderer.getContext();
          const bytes = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          return bytes;
        }
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: context.getCurrentTexture() },
          { buffer: pixels, bytesPerRow: 2048 }, [512, 384]);
        device.queue.submit([encoder.finish()]);
        await pixels.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(pixels.getMappedRange()).slice();
        pixels.unmap();
        return bytes;
      };
      const difference = (a, b) => {
        let count = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 5) count++;
        }
        return count;
      };
      const original = await capture();
      const colors = new Set();
      let bright = 0, dark = 0;
      for (let y = 130; y < 254; y++) {
        for (let x = 170; x < 342; x++) {
          const offset = (y * 512 + x) * 4;
          const maximum = Math.max(...original.slice(offset, offset + 3));
          if (maximum > 65) bright++;
          if (maximum < 45) dark++;
          colors.add(`${original[offset] >> 4}:${original[offset + 1] >> 4}:${original[offset + 2] >> 4}`);
        }
      }
      level.setSceneData({ ...initial, night_lights: 0 });
      const noCities = await capture();
      const nightDifference = difference(original, noCities);
      level.setSceneData({ ...initial, night_lights: 0, terrain: { ...terrain, clouds: 0 } });
      const noClouds = await capture();
      const cloudDifference = difference(noCities, noClouds);
      level.setSceneData({ ...initial, night_lights: 0,
        terrain: { ...terrain, clouds: 0, atmosphere: 0 } });
      const noAtmosphere = await capture();
      const atmosphereDifference = difference(noClouds, noAtmosphere);
      level.setSceneData(initial);
      // Cloud-shell movement alone must change pixels without moving the surface.
      level._cloudRotation = 0.35;
      const movedClouds = await capture();
      const cloudMotionDifference = difference(original, movedClouds);
      level._cloudRotation = 0;
      for (let frame = 0; frame < 20; frame++) level.render(0.05);
      const moving = await capture();
      const motionDifference = difference(original, moving);
      level._rotation = level._cloudRotation = 0;
      const originalMapKey = level._mapKey;
      level.setSceneData({ ...initial, owner_color: '#ff3300', reduced_motion: true, reduced_flash: true });
      const ownerMapUnchanged = originalMapKey === level._mapKey;
      const owned = await capture();
      const ownerDifference = difference(original, owned);
      const frozenRotation = level._rotation;
      for (let i = 0; i < 20; i++) level.render(0.016);
      const reducedMotion = frozenRotation === level._rotation;
      const frozen = await capture();
      const noFlashDifference = difference(owned, frozen);
      level.setSceneData({ ...initial, visible: false });
      level.render(10000);
      const hiddenFrozen = level._rotation === frozenRotation;
      level.setSceneData({ ...initial, vfx_quality: 'off' });
      const off = await capture();
      const offDifference = difference(original, off);
      level.setSceneData({ ...initial, terrain: { seed: 'other-world', clouds: 0.8 } });
      const other = await capture();
      const seedDifference = difference(original, other);
      level.setSceneData(initial);
      const restored = await capture();
      const deterministic = difference(original, restored);
      const textures = level._textures.slice();
      let freedTextures = 0;
      if (!native) textures.forEach(texture => texture.addEventListener('dispose', () => freedTextures++));
      await level.exit(0);
      const released = level._textures.length === 0 && (native ? level._uniformBuffer === null : level._renderer === null);
      await level.enter(0);
      const reentry = await capture();
      const reentryDifference = difference(original, reentry);
      level.dispose(); level.dispose();
      if (native) {
        await device.queue.onSubmittedWorkDone();
        const validation = await device.popErrorScope();
        if (validation) errors.push(validation.message);
        // The borrowed device/context must still work after planet disposal.
        const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(buffer, 0, new Float32Array(4));
        buffer.destroy(); pixels.destroy(); device.destroy();
      }
      return { errors, colors: colors.size, bright, dark, nightDifference, cloudDifference,
        atmosphereDifference, cloudMotionDifference, motionDifference, ownerDifference, ownerMapUnchanged, reducedMotion, hiddenFrozen,
        noFlashDifference, offDifference, seedDifference, deterministic, released, reentryDifference, freedTextures };
    }, backend);
    test.skip(result.unavailable, 'WebGPU adapter unavailable');
    expect(pageErrors).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.colors).toBeGreaterThan(20);
    expect(result.bright).toBeGreaterThan(100);
    expect(result.dark).toBeGreaterThan(100);
    expect(result.nightDifference).toBeGreaterThan(10);
    expect(result.cloudDifference).toBeGreaterThan(100);
    expect(result.atmosphereDifference).toBeGreaterThan(50);
    expect(result.cloudMotionDifference).toBeGreaterThan(100);
    expect(result.motionDifference).toBeGreaterThan(100);
    expect(result.ownerDifference).toBeGreaterThan(100);
    expect(result.ownerMapUnchanged && result.reducedMotion && result.hiddenFrozen && result.released).toBe(true);
    expect(result.noFlashDifference).toBe(0);
    expect(result.offDifference).toBeGreaterThan(100);
    expect(result.seedDifference).toBeGreaterThan(100);
    expect(result.deterministic).toBe(0);
    expect(result.reentryDifference).toBe(0);
    if (backend === 'ThreeJS') expect(result.freedTextures).toBe(3);
  });
}
