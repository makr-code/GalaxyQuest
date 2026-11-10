const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: process.platform === 'win32' ? ['--enable-unsafe-webgpu', '--use-angle=d3d11'] : ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-vulkan=swiftshader',
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
        const adapter = await navigator.gpu?.requestAdapter({ forceFallbackAdapter: true })
          || await navigator.gpu?.requestAdapter();
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
    if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(result.unavailable).not.toBe(true);
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
    if (backend === 'ThreeJS') expect(result.freedTextures).toBe(4);
  });
}

for (const backend of ['WebGPU', 'ThreeJS']) {
test(`${backend}: map coast thresholds retain pixel-wide boundaries and sub-8-bit elevation precision`, async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
  await setup(page, backend);
  const result = await page.evaluate(async backend => {
    const native = backend === 'WebGPU';
    const adapter = native ? await navigator.gpu?.requestAdapter({ forceFallbackAdapter: true })
      || await navigator.gpu?.requestAdapter() : null;
    if (native && !adapter) return null;
    const device = native ? await adapter.requestDevice() : null;
    const errors = [];
    if (native) {
      device.addEventListener('uncapturederror', event => errors.push(event.error.message));
      device.pushErrorScope('validation');
      const createShaderModule = device.createShaderModule.bind(device);
      device.createShaderModule = descriptor => createShaderModule({ ...descriptor,
        code: descriptor.code.replace('return vec4f(linearToSrgb(col / (col + vec3f(1.0))), 1.0);',
          'return vec4f(select(0.0,water,hit > 0.0),ice,clamp(col.r,0.0,1.0) * 0.000001,1.0);'),
      });
    }
    await import('/js/rendering/planet-textures.js');
    await import('/js/engine/zoom/levels/PlanetLivingWorld.js');
    const world = window.GQPlanetLivingWorld;
    const originalMaps = world.maps;
    let ramp = { base: 0, scale: 1 };
    world.maps = descriptor => {
      const maps = originalMaps(descriptor, 64);
      const geography = maps.geography.slice();
      for (let y = 0; y < maps.geographyHeight; y++) {
        for (let x = 0; x < maps.geographyWidth; x++) {
          const value = Math.round((ramp.base + ramp.scale * (x + 0.5) / maps.geographyWidth) * 65535);
          const offset = (y * maps.geographyWidth + x) * 4;
          geography[offset] = value >>> 8;
          geography[offset + 1] = value & 255;
        }
      }
      return { ...maps, geography };
    };
    const canvas = document.querySelector('canvas');
    const context = native ? canvas.getContext('webgpu') : null;
    if (native) context.configure({ device, format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const Level = window[`GQPlanetApproachLevel${backend}`][`PlanetApproachLevel${backend}`];
    const level = new Level();
    const readback = native ? device.createBuffer({ size: 512 * 384 * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;
    await level.initialize(canvas, native ? { device, context } : {});
    const rows = [];
    const cases = [0.2, 0.3, 0.4].map(sea => ({ sea, base: 0, scale: 1 }))
      .concat([0.4999, 0.49995, 0.5].map(sea => ({ sea, base: 0.4998, scale: 0.0005 })));
    for (const scenario of cases) {
      const { sea } = scenario;
      ramp = scenario;
      await level.enter(1, { reduced_motion: true, terrain: { seed: 35, ocean: sea / 0.85, ice_caps: 0, clouds: 0, atmosphere: 0 } });
      if (!native) {
        level._scene.background = new window.THREE.Color(0x000000);
        const material = level._planetMesh.material;
        const compile = material.onBeforeCompile;
        material.onBeforeCompile = shader => {
          compile(shader);
          shader.fragmentShader = shader.fragmentShader.replace('#include <colorspace_fragment>',
            '#include <colorspace_fragment>\ngl_FragColor = vec4(gqWater,gqFrozen,0.0,1.0);');
        };
        material.needsUpdate = true;
      }
      level.render(0);
      let pixels;
      if (native) {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: context.getCurrentTexture() },
          { buffer: readback, bytesPerRow: 2048 }, [512, 384]);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        pixels = new Uint8Array(readback.getMappedRange());
      } else {
        const gl = level._renderer.getContext();
        pixels = new Uint8Array(512 * 384 * 4);
        gl.readPixels(0, 0, 512, 384, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      }
      rows.push(Array.from({ length: 512 }, (_, x) => pixels[(192 * 512 + x) * 4]));
      if (native) readback.unmap();
      await level.exit();
    }
    const validation = native ? await device.popErrorScope() : null;
    level.dispose();
    readback?.destroy();
    device?.destroy();
    return { rows, cases, errors, validation: validation?.message || null };
  }, backend);
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(result).not.toBeNull();
  test.skip(!result, 'WebGPU adapter unavailable');
  expect(result.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(result.validation).toBeNull();
  const lengths = [];
  for (const [index, row] of result.rows.entries()) {
    // Exclude the Three.js mesh's multisampled silhouette from the coastline measurement.
    const interior = backend === 'ThreeJS' ? row.slice(176, 336) : row;
    expect(interior.filter(value => value > 0 && value < 255).length).toBeLessThanOrEqual(2);
    const length = row.filter(value => value >= 128).length;
    expect(length).toBeGreaterThan(5);
    let expected = 0;
    for (let x = 0; x < 512; x++) {
      const direction = [0.57735027 * ((x + 0.5) / 512 * 2 - 1) * 512 / 384,
        0.57735027 * (1 - 192.5 / 384 * 2), -1];
      const magnitude = Math.hypot(...direction);
      const ray = direction.map(value => value / magnitude);
      const b = 20 * ray[2], discriminant = b * b - 375;
      if (discriminant < 0) continue;
      const hit = -b - Math.sqrt(discriminant);
      const u = 0.5 - Math.atan2(20 + ray[2] * hit,ray[0] * hit) / (Math.PI * 2);
      const coordinate = u * 256 - 0.5, first = Math.floor(coordinate), fraction = coordinate - first;
      const { base, scale, sea } = result.cases[index];
      const value = column => Math.round((base + scale * ((((column % 256 + 256) % 256) + 0.5) / 256)) * 65535) / 65535;
      const relief = value(first) * (1 - fraction) + value(first + 1) * fraction;
      if (relief < sea) expected++;
    }
    expect(Math.abs(length - expected)).toBeLessThanOrEqual(backend === 'WebGPU' ? 1 : 3);
    lengths.push(length);
  }
  expect(lengths[1]).toBeGreaterThan(lengths[0]);
  expect(lengths[2]).toBeGreaterThan(lengths[1]);
  expect(lengths[4]).toBeGreaterThan(lengths[3]);
  expect(lengths[5]).toBeGreaterThan(lengths[4]);
});
}
