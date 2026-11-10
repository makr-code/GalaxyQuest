const { test, expect } = require('@playwright/test');
const model = require('../../js/rendering/colony-surface-plan.js');
const material = require('../../js/rendering/body-material.js');

test('urban night patterns have districts, dark gaps, sector signatures and growing conurbations', async ({ page }) => {
  await page.goto('/tools/earth-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true', { timeout: 60000 });
  const manifest = { body_id: 1, seed: 2026, radius_km: 6371, biome: 'terran' };
  const sites = [
    { id: 'west', direction: [-0.075, 0, Math.sqrt(1 - 0.075 ** 2)], height: 1 },
    { id: 'east', direction: [0.075, 0, Math.sqrt(1 - 0.075 ** 2)], height: 1 },
  ];
  const plan = (population, type, powered = true) => model.plan({
    colony: { population, powered }, buildings: type ? [{ type, level: 8 }] : [],
  }, manifest, sites);
  const shader = material.shader(model.WGSL + `
struct Params { state: vec4<f32> };
@group(0) @binding(0) var<uniform> parameters: Params;
struct Out { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> Out {
  let p = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[i];
  var out: Out; out.position = vec4<f32>(p,0,1); out.uv = p; return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let p = normalize(vec3<f32>(in.uv * 0.22,1));
  var surface = gqSurface(p,p,p,0.0);
  surface.albedo = vec3<f32>(0.0); surface.emission = vec3<f32>(0.0);
  let result = gqLivingSurface(surface,p,p,vec3<f32>(0,0,parameters.state.x),
    parameters.state.y,parameters.state.z);
  return vec4<f32>(result.emission,1.0);
}`);
  const future = plan(6000000000, 'trade_center');
  const satelliteManifest = { ...manifest, radius_km: 1000 };
  const capital = { id: 'capital', direction: [0, 0, 1], height: 1 };
  const localSites = [{ ...capital, urbanCandidates: model.urbanCandidates(satelliteManifest, capital,
    () => ({ height: 1, slope: 0 })) }];
  const satellitePlan = population => model.plan({ colony: { population } }, satelliteManifest, localSites);
  const satelliteLate = satellitePlan(100000000);
  const payload = {
    shader, size: model.UNIFORM_BYTES, base: Array.from(material.materialUniforms(material.resolveBodyMaterial({}, manifest), 1000)),
    early: Array.from(model.uniforms(plan(120000000, 'trade_center'))),
    future: Array.from(model.uniforms(future)),
    science: Array.from(model.uniforms(plan(6000000000, 'research_lab'))),
    farm: Array.from(model.uniforms(plan(6000000000, 'farm'))),
    industry: Array.from(model.uniforms(plan(6000000000, 'factory'))),
    off: Array.from(model.uniforms(plan(6000000000, 'trade_center', false))),
    reseeded: Array.from(model.uniforms({ ...future, seed: 2027 })),
    satelliteEarly: Array.from(model.uniforms(satellitePlan(100000))),
    satelliteLate: Array.from(model.uniforms(satelliteLate)),
    satelliteRuins: Array.from(model.uniforms(model.plan({ colony: { population: 100000 },
      body_development: { body_id: 1, version: 1, peak_population: 100000000, founded_count: 12 } },
    satelliteManifest, localSites))),
  };
  const result = await page.evaluate(async data => {
    window.GQEarthReference.renderer.setAnimationLoop(null);
    const adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true }) || await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code: data.shader });
    const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: 'rgba32float' }] } });
    const buffer = device.createBuffer({ size: data.size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const materialBuffer = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const parameters = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(materialBuffer, 0, new Float32Array(data.base));
    const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: parameters } }, { binding: 2, resource: { buffer: materialBuffer } },
      { binding: 3, resource: { buffer } },
    ] });
    const target = device.createTexture({ size: [128, 128], format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 128 * 128 * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const capture = async (plan, light = -1, mask = 0, region = 0) => {
      device.queue.writeBuffer(buffer, 0, new Float32Array(plan));
      device.queue.writeBuffer(parameters, 0, new Float32Array([light, mask, region, 0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(3); pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 2048 }, [128, 128]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const pixels = Array.from(new Float32Array(readback.getMappedRange()));
      readback.unmap();
      return pixels;
    };
    const frames = {};
    for (const name of ['early', 'future', 'science', 'farm', 'industry', 'off', 'reseeded',
      'satelliteEarly', 'satelliteLate', 'satelliteRuins']) frames[name] = await capture(data[name]);
    frames.repeat = await capture(data.future);
    frames.day = await capture(data.future, 1);
    frames.water = await capture(data.future, -1, 1);
    frames.region = await capture(data.future, -1, 0, 1);
    const validation = await device.popErrorScope();
    [buffer, materialBuffer, parameters, target, readback].forEach(resource => resource.destroy());
    device.destroy();
    window.GQEarthReference.dispose();
    return { frames, validation: validation?.message || null };
  }, payload);
  expect(result.validation).toBeNull();
  const { frames } = result;
  const lit = frame => frame.filter((n, i) => i % 4 === 0 && n > 0.02).length;
  expect(lit(frames.future)).toBeGreaterThan(lit(frames.early) * 10);
  expect(frames.repeat).toEqual(frames.future);
  for (const name of ['off', 'day', 'water', 'region']) expect(lit(frames[name])).toBe(0);
  const sum = (frame, channel) => frame.reduce((total, n, i) => total + (i % 4 === channel ? n : 0), 0);
  expect(sum(frames.science, 2)).toBeGreaterThan(sum(frames.science, 0) * 1.5);
  expect(sum(frames.industry, 0)).toBeGreaterThan(sum(frames.industry, 2) * 3);
  expect(frames.farm).not.toEqual(frames.industry);
  expect(frames.reseeded).not.toEqual(frames.future);
  const bridge = frame => {
    let count = 0;
    for (let y = 61; y <= 67; y++) for (let x = 60; x <= 68; x++) if (frame[(y * 128 + x) * 4] > 0.01) count++;
    return count;
  };
  expect(bridge(frames.early)).toBe(0);
  expect(bridge(frames.future)).toBeGreaterThan(10);
  // An interior annulus must retain unlit gaps and multiple luminous levels, not a flat disk.
  const annulus = [];
  for (let y = 49; y <= 79; y++) for (let x = 30; x <= 53; x++) {
    const d = Math.hypot(x - 42, y - 64);
    if (d > 6 && d < 14) annulus.push(frames.future[(y * 128 + x) * 4]);
  }
  expect(annulus.filter(n => n < 0.02).length).toBeGreaterThan(10);
  expect(annulus.filter(n => n > 0.08).length).toBeGreaterThan(10);
  expect(new Set(annulus.map(n => Math.round(n * 100))).size).toBeGreaterThan(8);
  const satellitePixels = frame => {
    let count = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const px = (2 * (x + 0.5) / 128 - 1) * 0.22, py = (1 - 2 * (y + 0.5) / 128) * 0.22;
      const radius = Math.hypot(px, py);
      if (radius > 0.045 && radius < 0.18 && frame[(y * 128 + x) * 4] > 0.01) count++;
    }
    return count;
  };
  expect(satelliteLate.urbanSettlements.length).toBeGreaterThan(1);
  expect(satellitePixels(frames.satelliteEarly)).toBe(0);
  expect(satellitePixels(frames.satelliteRuins)).toBe(0);
  expect(satellitePixels(frames.satelliteLate)).toBeGreaterThan(20);
});
