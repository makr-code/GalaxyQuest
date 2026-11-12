const { test, expect } = require('@playwright/test');
const model = require('../../js/rendering/colony-surface-plan.js');

test('facility coverage filters thin structures and matches the twelve-sided tank footprint', async ({ page }) => {
  await page.route('**/facility-pattern-probe', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Facility shader probe</title>',
  }));
  await page.goto('/facility-pattern-probe');
  const result = await page.evaluate(async patterns => {
    const adapter = await navigator.gpu?.requestAdapter({ forceFallbackAdapter: true })
      || await navigator.gpu?.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    device.pushErrorScope('validation');
    await import('/js/rendering/colony-facility-geometry.js');
    const solids = window.GQColonyFacilityGeometry.createFacilityRenderer(device, 'rgba32float', patterns);
    const module = device.createShaderModule({ code: `${patterns}
struct Params { parcel: vec4<f32>, detail: vec4<f32> };
@group(0) @binding(0) var<uniform> params: Params;
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let point = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[index];
  return vec4<f32>(point,0,1);
}
@fragment fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(gqFacilityDistance(params.parcel.xy,params.parcel.zw,params.detail.x),
    gqFacilityCoverage(params.parcel.xy,params.parcel.zw,params.detail.x,params.detail.y),
    gqFacilityLamp(params.parcel.xy,params.parcel.zw,params.detail.x,params.detail.y),1);
}` });
    const pipeline = device.createRenderPipeline({ layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: 'rgba32float' }] } });
    const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const target = device.createTexture({ size: [1, 1], format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const output = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: params } },
    ] });
    const sample = async (x, y, w, d, shape, pixel) => {
      device.queue.writeBuffer(params, 0, new Float32Array([x, y, w, d, shape, pixel, 0, 0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(3); pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: output, bytesPerRow: 256 }, [1, 1]);
      device.queue.submit([encoder.finish()]);
      await output.mapAsync(GPUMapMode.READ);
      const data = Array.from(new Float32Array(output.getMappedRange()).slice(0, 4));
      output.unmap();
      return data;
    };
    const angle = Math.PI / 12;
    const values = {
      thinNear: await sample(0, 0, 0.8, 160, 0, 0.1),
      thinFar: await sample(0, 0, 0.8, 160, 0, 100),
      unresolved: await sample(0, 0, 100, 150, 0, 10000),
      vertex: await sample(18, 0, 36, 36, 1, 0.1),
      edge: await sample(18 * Math.cos(angle) ** 2, 18 * Math.cos(angle) * Math.sin(angle), 36, 36, 1, 0.1),
      outsidePolygon: await sample(18 * Math.cos(angle), 18 * Math.sin(angle), 36, 36, 1, 0.1),
      lightNear: await sample(48, 0, 100, 100, 0, 0.1),
      lightFar: await sample(48, 0, 100, 100, 0, 100),
    };
    const validation = await device.popErrorScope();
    solids.dispose();
    [params, target, output].forEach(resource => resource.destroy());
    device.destroy();
    return { values, validation: validation?.message || null };
  }, model.FACILITY_PATTERN_WGSL);
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(result).not.toBeNull();
  test.skip(!result, 'No WebGPU adapter available locally');
  expect(result.validation).toBeNull();
  const v = result.values;
  expect(Object.values(v).flat().every(Number.isFinite)).toBe(true);
  expect(v.thinNear[1]).toBeCloseTo(1, 5);
  expect(v.thinFar[1]).toBeLessThan(0.004);
  expect(v.unresolved[1]).toBe(0);
  expect(Math.abs(v.vertex[0])).toBeLessThan(0.001);
  expect(Math.abs(v.edge[0])).toBeLessThan(0.001);
  expect(v.outsidePolygon[0]).toBeGreaterThan(0.5);
  expect(v.lightNear[2]).toBeCloseTo(1, 5);
  expect(v.lightFar[2]).toBe(0);
});

test('facility classes share exact terrain footprints and bounded physical geometry, growth and night lighting', async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    window.__facilityResources = [];
    const create = GPUDevice.prototype.createBuffer;
    GPUDevice.prototype.createBuffer = function (descriptor) {
      const buffer = create.call(this, descriptor);
      if (descriptor.label?.startsWith('colony_metric_facilities')) {
        const resource = { label: descriptor.label, size: descriptor.size, destroyed: 0 };
        window.__facilityResources.push(resource);
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
      const el = document.querySelector(`[name="${name}"]`);
      if (el.type === 'checkbox') el.checked = value; else el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const visit = () => document.querySelector('[name=visitFacilities]').click();
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
    const brightness = pixels => pixels.reduce((sum, n, i) => sum + (i % 4 === 3 ? 0 : n), 0);
    visit();
    const all = await capture();
    const count = production.facilityPlan.length, parts = production.facilityGeometry.parts.length;
    const firstGeometry = production.facilityGeometry;
    const repeat = await capture(), cached = production.facilityGeometry === firstGeometry;
    const enable = production.surface.facilityGeometryEnabled;
    production.surface.facilityGeometryEnabled = () => false;
    const footprints = await capture();
    production.surface.facilityGeometryEnabled = enable;
    change('facilityGeometry', false);
    const terrain = await capture();
    change('facilityGeometry', true);
    const restored = await capture();
    change('facilityClass', 'hospital');
    visit();
    await capture();
    const initial = production.facilityGeometry.parts.map(part => ({ id: part.id,
      position: part.position, width: part.widthMeters, height: part.heightMeters }));
    change('facilityLevel', '7');
    await capture();
    const grown = production.facilityGeometry.parts;
    const stableGrowth = initial.every(part => grown.some(other => other.id === part.id
      && other.widthMeters === part.width && other.heightMeters === part.height
      && other.position.every((n, i) => n === part.position[i])));
    const maxHeight = Math.max(...grown.map(p => p.heightMeters + p.bottomMeters));
    const radius = production.facilityPlan[0].radiusMeters;
    const foundation = grown.find(p => p.id.endsWith(':0:main')).foundationRadius;
    const distanceMeters = (ref.camera.position.length() - foundation) * radius;
    change('facilityLevel', '1');
    const up = ref.camera.position.clone().normalize().toArray();
    const angles = [-180, -90, 0, 90, 180].flatMap(a => [-90, -45, 0, 45, 90].map(e => {
      const az = a * Math.PI / 180, el = e * Math.PI / 180;
      const sun = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
      return { a, e, cosine: sun.reduce((sum, n, i) => sum + n * up[i], 0) };
    })).sort((a, b) => a.cosine - b.cosine);
    change('sunAzimuth', `${angles[0].a}`); change('sunElevation', `${angles[0].e}`);
    const litNight = await capture();
    change('cityLights', false);
    const darkNight = await capture();
    change('sunAzimuth', `${angles.at(-1).a}`); change('sunElevation', `${angles.at(-1).e}`);
    const darkDay = await capture();
    change('cityLights', true);
    const litDay = await capture();
    change('view', 'africa');
    change('seaLevel', '500');
    await capture();
    const wetCount = production.facilityPlan.length;
    const validation = await device.popErrorScope();
    buffer.destroy();
    ref.dispose();
    return { count, parts, cached, repeat: difference(all, repeat), restore: difference(all, restored),
      geometryDifference: difference(all, footprints), footprintDifference: difference(footprints, terrain),
      stableGrowth, grownCount: grown.length, initialCount: initial.length, maxHeight, distanceMeters,
      nightDifference: difference(litNight, darkNight), nightBrightness: brightness(litNight) - brightness(darkNight),
      dayDifference: difference(litDay, darkDay), wetCount, resources: window.__facilityResources,
      validation: validation?.message || null };
  });
  expect(result.validation).toBeNull();
  expect(errors).toEqual([]);
  expect(result.count).toBe(16);
  expect(result.parts).toBeGreaterThan(60);
  expect(result.cached).toBe(true);
  expect(result.repeat).toBe(0);
  expect(result.restore).toBe(0);
  expect(result.geometryDifference).toBeGreaterThan(1000);
  expect(result.footprintDifference).toBeGreaterThan(1000);
  expect(result.stableGrowth).toBe(true);
  expect(result.grownCount).toBe(result.initialCount * 3);
  expect(result.maxHeight).toBeLessThan(50);
  expect(result.distanceMeters).toBeGreaterThan(990);
  expect(result.distanceMeters).toBeLessThan(1010);
  expect(result.nightDifference).toBeGreaterThan(100);
  expect(result.nightBrightness).toBeGreaterThan(1000);
  expect(result.dayDifference).toBe(0);
  expect(result.wetCount).toBe(0);
  expect(result.resources.length).toBeGreaterThan(1);
  for (const resource of result.resources) {
    expect(resource.size).toBeLessThanOrEqual(384 * 96);
    expect(resource.destroyed, resource.label).toBe(1);
  }
});
