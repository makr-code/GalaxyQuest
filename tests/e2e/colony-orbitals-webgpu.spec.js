const { test, expect } = require('@playwright/test');

test('production orbital objects retain metre scale, render real pixels and reuse bounded GPU resources', async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    window.__orbitalResources = [];
    const create = GPUDevice.prototype.createBuffer;
    GPUDevice.prototype.createBuffer = function (descriptor) {
      const buffer = create.call(this, descriptor);
      if (descriptor.label?.startsWith('colony_orbitals')) {
        const resource = { label: descriptor.label, size: descriptor.size, destroyed: 0 };
        window.__orbitalResources.push(resource);
        const destroy = buffer.destroy.bind(buffer);
        buffer.destroy = () => { resource.destroyed++; destroy(); };
      }
      return buffer;
    };
  });
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const ref = window.GQEarthReference, { production, device } = ref;
    ref.renderer.setAnimationLoop(null);
    device.pushErrorScope('validation');
    const change = (name, value) => {
      const input = document.querySelector(`[name="${name}"]`);
      if (input.type === 'checkbox') input.checked = value; else input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const visit = () => document.querySelector('[name="visitOrbital"]').click();
    const { canvas } = production, bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * canvas.height,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const capture = async () => {
      ref.render();
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
    change('motion', false);
    visit();
    const yard = await capture(), repeated = await capture();
    const plan = production.orbitalPlan, geometry = production.orbitalGeometry;
    const habitat = geometry.parts.find(part => part.id === 'habitat');
    const hullIndex = geometry.parts.indexOf(habitat);
    const hullWidth = geometry.instances[hullIndex * 24 + 3] * plan.radiusMeters;
    change('orbitalGeometry', false);
    const absent = await capture();
    change('orbitalGeometry', true);
    const restored = await capture();
    const startResources = window.__orbitalResources.length;
    change('motion', true);
    production.orbit._waterTime = 0;
    const trafficStart = await capture();
    const shuttleStart = production.orbitalGeometry.parts.find(part => part.id === 'service-shuttle').position;
    production.orbit._waterTime = 30;
    const trafficMoved = await capture();
    const shuttleEnd = production.orbitalGeometry.parts.find(part => part.id === 'service-shuttle').position;
    change('motion', false);
    const paused = await capture();
    production.orbit._waterTime = 60;
    const still = await capture();
    const stableResources = window.__orbitalResources.length === startResources;
    change('orbitalClass', 'missile_silo');
    visit();
    const station = await capture();
    change('orbitalGeometry', false);
    const noStation = await capture();
    change('orbitalClass', 'solar_satellite');
    visit();
    const satellite = await capture();
    const bus = production.orbitalGeometry.parts.find(part => part.id === 'bus');
    const busIndex = production.orbitalGeometry.parts.indexOf(bus);
    const busWidth = production.orbitalGeometry.instances[busIndex * 24 + 3] * plan.radiusMeters;
    change('orbitalGeometry', false);
    const noSatellite = await capture();
    change('view', 'africa');
    change('orbitalGeometry', true);
    await capture();
    const globeCount = production.orbitalGeometry.parts.length;
    change('detail', '180');
    await capture();
    const object = production.orbitalPlan.objects[0];
    const local = window.GQColonyOrbitals.position(production.orbitalPlan, object, ref.time);
    const basis = production.orbit._orientation.basis;
    const world = [0, 1, 2].map(i => basis.reduce((sum, axis, j) => sum + axis[i] * local.center[j], 0));
    const length = Math.hypot(...world);
    ref.camera.position.set(...world.map(n => -n / length * 3));
    ref.camera.lookAt(...world);
    ref.camera.fov = 0.02;
    ref.camera.clearViewOffset();
    ref.camera.updateProjectionMatrix();
    const blocked = await capture();
    const occludedParts = production.orbitalGeometry.parts.length;
    change('orbitalGeometry', false);
    const planetOnly = await capture();
    const validation = await device.popErrorScope();
    buffer.destroy();
    ref.dispose();
    return {
      objectCount: plan.objects.length, altitude: plan.orbit.altitudeMeters, mode: plan.orbit.mode,
      yardParts: geometry.parts.length, hullWidth, busWidth, stableResources,
      repeat: difference(yard, repeated), restored: difference(yard, restored),
      yardDifference: difference(yard, absent), stationDifference: difference(station, noStation),
      satelliteDifference: difference(satellite, noSatellite), trafficDifference: difference(trafficStart, trafficMoved),
      shuttleMoved: shuttleStart.some((n, i) => n !== shuttleEnd[i]), pauseDifference: difference(paused, still),
      globeCount, occludedParts, occlusionDifference: difference(blocked, planetOnly),
      resources: window.__orbitalResources, validation: validation?.message || null,
    };
  });
  expect(result.validation).toBeNull();
  expect(errors).toEqual([]);
  expect(result.objectCount).toBe(5);
  expect(result.mode).toBe('synchronous');
  expect(result.altitude).toBeGreaterThan(35700000);
  expect(result.altitude).toBeLessThan(35900000);
  expect(result.hullWidth).toBeCloseTo(80, 3);
  expect(result.busWidth).toBeCloseTo(8, 3);
  expect(result.yardParts).toBeGreaterThan(10);
  expect(result.repeat).toBe(0);
  expect(result.restored).toBe(0);
  expect(result.yardDifference).toBeGreaterThan(1000);
  expect(result.stationDifference).toBeGreaterThan(500);
  expect(result.satelliteDifference).toBeGreaterThan(50);
  expect(result.shuttleMoved).toBe(true);
  expect(result.trafficDifference).toBeGreaterThan(10);
  expect(result.pauseDifference).toBe(0);
  expect(result.globeCount).toBe(0);
  expect(result.occludedParts).toBeGreaterThan(0);
  expect(result.occlusionDifference).toBe(0);
  expect(result.stableResources).toBe(true);
  expect(result.resources.length).toBeGreaterThanOrEqual(2);
  for (const resource of result.resources) {
    expect(resource.size).toBeLessThanOrEqual(256 * 96);
    expect(resource.destroyed).toBe(1);
  }
});
