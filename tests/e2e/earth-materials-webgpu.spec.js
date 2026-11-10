const { test, expect } = require('@playwright/test');

test('authored material maps, bump, sky and cloud loop affect actual WebGPU pixels without changing the mesh', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.__earthMaterialResources = [];
    for (const method of ['createBuffer', 'createTexture']) {
      const create = GPUDevice.prototype[method];
      GPUDevice.prototype[method] = function (descriptor) {
        const resource = create.call(this, descriptor);
        if (descriptor.label?.startsWith('earth_')) {
          const entry = { label: descriptor.label, destroyed: 0 };
          window.__earthMaterialResources.push(entry);
          const destroy = resource.destroy.bind(resource);
          resource.destroy = () => { entry.destroyed++; destroy(); };
        }
        return resource;
      };
    }
  });
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const ref = window.GQEarthReference, { production, device } = ref;
    const { Vector3 } = await import('/node_modules/three/build/three.webgpu.js');
    const { geographicVector } = await import('/js/rendering/earth-reference-geography.js');
    const { reliefPoint } = await import('/js/rendering/earth-reference-relief.js');
    ref.renderer.setAnimationLoop(null);
    device.pushErrorScope('validation');
    const change = (name, value) => {
      const control = document.querySelector(`[name="${name}"]`);
      if (control.type === 'checkbox') control.checked = value; else control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const name of ['motion', 'rotation', 'clouds', 'atmosphere', 'sky']) change(name, false);
    const canvas = production.canvas;
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
    const at = (data, lon, lat) => {
      const radius = reliefPoint(ref.relief, lon, lat, production.reliefOptions).radius;
      const p = ref.body.localToWorld(new Vector3(...geographicVector(lon, lat, radius))).project(ref.camera);
      const x = Math.round((p.x + 1) * canvas.width / 2), y = Math.round((1 - p.y) * canvas.height / 2);
      const i = y * bytesPerRow + x * 4;
      const rgb = Array.from(data.slice(i, i + 3));
      return navigator.gpu.getPreferredCanvasFormat().startsWith('bgra') ? rgb.reverse() : rgb;
    };
    change('view', 'himalaya');
    change('bump', '0');
    const meshNormal = await capture();
    const mesh = production.orbit._solidBuffer, vertices = production.orbit._markerVertices;
    change('bump', '40');
    const bump = await capture();
    change('palette', 'surface');
    const albedo = await capture();
    const meshUnchanged = production.orbit._solidBuffer === mesh && production.orbit._markerVertices === vertices;
    change('gloss', false);
    const matte = await capture();
    change('gloss', true);
    const glossy = await capture();
    change('view', 'africa');
    change('materialView', 'roughness');
    const roughness = await capture();
    const roughWater = at(roughness, 0, 0), roughLand = at(roughness, 20, 25);
    change('materialView', 'specular');
    const specular = await capture();
    const specWater = at(specular, 0, 0), specLand = at(specular, 20, 25);
    change('materialView', 'normal');
    const normals = await capture();
    const waterNormal = at(normals, 0, 0);
    change('materialView', 'albedo');
    const unlit = await capture();
    change('lighting', false);
    const stillUnlit = await capture();
    change('materialView', 'shaded');
    change('lighting', true);
    const noSky = await capture();
    change('sky', true);
    const sky = await capture();
    change('sky', false);
    const restoredSky = await capture();
    change('atmosphere', true);
    const halo = await capture();
    change('clouds', true);
    change('phase', '120');
    change('phase', '0');
    const phase0 = await capture();
    change('phase', '30');
    const phase30 = await capture();
    change('phase', '120');
    const phase120 = await capture();
    const frozenPhase = production.orbit._waterTime;
    production.render(1, ref.camera);
    const frozen = production.orbit._waterTime === frozenPhase;
    change('motion', true);
    production.render(0.1, ref.camera);
    const animated = production.orbit._waterTime > frozenPhase;
    change('backend', 'reference');
    const baselineDisabled = ['bump', 'palette', 'materialView', 'gloss', 'sky', 'phase']
      .every(name => document.querySelector(`[name="${name}"]`).disabled);
    change('backend', 'production');
    change('source', 'coasts');
    const vectorDisabled = document.querySelector('[name="bump"]').disabled;
    const vector = await capture();
    const validation = await device.popErrorScope();
    pixels.destroy();
    return {
      bump: difference(meshNormal, bump), palette: difference(bump, albedo),
      gloss: difference(matte, glossy), sky: difference(noSky, sky),
      restoreSky: difference(noSky, restoredSky), halo: difference(noSky, halo),
      turbulence: difference(phase0, phase30), loop: difference(phase0, phase120),
      diagnosticUnlit: difference(unlit, stillUnlit), roughWater, roughLand, specWater, specLand, waterNormal,
      meshUnchanged, frozen, animated, baselineDisabled, vectorDisabled, vectorSize: vector.length,
      validation: validation?.message || null,
    };
  });
  for (const key of ['bump', 'palette', 'gloss', 'halo', 'turbulence']) expect(result[key], key).toBeGreaterThan(100);
  expect(result.sky).toBeGreaterThan(20);
  expect(result.restoreSky).toBe(0);
  expect(result.loop).toBe(0);
  expect(result.diagnosticUnlit).toBe(0);
  expect(result.roughWater[0]).toBeCloseTo(0.16 * 255, -1);
  expect(result.roughLand[0]).toBeCloseTo(0.88 * 255, -1);
  expect(result.specWater[0]).toBeCloseTo(0.02 * 255, 0);
  expect(result.specLand[0]).toBeCloseTo(0.04 * 255, 0);
  expect(result.waterNormal[0]).toBeGreaterThan(250);
  expect(result.waterNormal[1]).toBeGreaterThan(120);
  expect(result.waterNormal[1]).toBeLessThan(136);
  expect(result.meshUnchanged && result.frozen && result.animated && result.baselineDisabled && result.vectorDisabled).toBe(true);
  expect(result.validation).toBeNull();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => {
    const ref = window.GQEarthReference;
    const before = ref.production.orbit._waterTime;
    ref.production.render(1, ref.camera);
    return before === ref.production.orbit._waterTime;
  })).toBe(true);
  const resources = await page.evaluate(() => {
    window.GQEarthReference.production.dispose();
    window.GQEarthReference.production.dispose();
    window.GQEarthReference.dispose();
    return window.__earthMaterialResources;
  });
  expect(resources).toHaveLength(6);
  for (const resource of resources) expect(resource.destroyed, resource.label).toBe(1);
  expect(errors).toEqual([]);
});
