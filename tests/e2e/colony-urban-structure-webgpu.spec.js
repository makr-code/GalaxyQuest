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
struct Params { state: vec4<f32>, patches: vec4<f32> };
@group(0) @binding(0) var<uniform> parameters: Params;
struct Out { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> Out {
  let p = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[i];
  var out: Out; out.position = vec4<f32>(p,0,1); out.uv = p; return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let p = normalize(vec3<f32>(in.uv * select(0.22,0.08,parameters.patches.x == 3.0),1));
  if (parameters.patches.x < -2.0) {
    let sample = gqUrbanStructure(in.uv * parameters.patches.y,0.024,0.001,
      parameters.patches.z,u32(parameters.patches.w),gqLiving.sites[0].civic,0.0);
    if (parameters.patches.x < -3.0) {
      let normal = gqUrbanNormal(vec3<f32>(0,0,1),vec3<f32>(sample.slope,0),1.0);
      return vec4<f32>(normal,1);
    }
    return sample.material;
  }
  if (parameters.patches.x < -1.0) {
    let sample = gqUrbanStructure(in.uv * parameters.patches.y,0.024,0.001,
      parameters.patches.z,u32(parameters.patches.w),vec4<f32>(0.3,0.35,0,0.35),0.0);
    return vec4<f32>(sample.emission,1);
  }
  if (parameters.patches.x < 0.0) {
    let structure = gqUrbanStructure(in.uv * 0.012,parameters.patches.y,0.001,
      parameters.patches.z,293u,vec4<f32>(0,0,parameters.patches.w,0),0.0);
    return vec4<f32>(structure.structure,1);
  }
  if (parameters.patches.x > 0.0 && parameters.patches.x < 2.0) {
    let site = gqLiving.sites[0];
    let value = gqUrbanInfill(select(p,-p,parameters.patches.w < 0.0),site.center.xyz,site.connection.xyz,
      parameters.patches.y,site.land.w,parameters.patches.z,u32(site.east.w));
    return vec4<f32>(value,0,0,1);
  }
  var surface = gqSurface(p,p,p,0.0);
  surface.albedo = vec3<f32>(0.0); surface.emission = vec3<f32>(0.0);
  let result = gqLivingSurface(surface,p,p,vec3<f32>(0,0,parameters.state.x),
    parameters.state.y,parameters.state.z);
  if (parameters.patches.x == 2.0) { return vec4<f32>(result.albedo,result.roughness); }
  if (parameters.patches.x == 3.0) { return vec4<f32>(result.normal - surface.normal,1); }
  return vec4<f32>(result.emission,1.0);
}`);
  const future = plan(6000000000, 'trade_center');
  const satelliteManifest = { ...manifest, radius_km: 1000 };
  const capital = { id: 'capital', direction: [0, 0, 1], height: 1 };
  const localSites = [{ ...capital, urbanCandidates: model.urbanCandidates(satelliteManifest, capital,
    () => ({ height: 1, slope: 0 })) }];
  const satellitePlan = population => model.plan({ colony: { population } }, satelliteManifest, localSites);
  const satelliteLate = satellitePlan(100000000);
  const satelliteAbandoned = structuredClone(satelliteLate);
  satelliteAbandoned.settlements[0].children.forEach(child => { child.ruined = true; });
  const payload = {
    shader, size: model.UNIFORM_BYTES, base: Array.from(material.materialUniforms(material.resolveBodyMaterial({}, manifest), 1000)),
    early: Array.from(model.uniforms(plan(120000000, 'trade_center'))),
    future: Array.from(model.uniforms(future)),
    science: Array.from(model.uniforms(plan(6000000000, 'research_lab'))),
    farm: Array.from(model.uniforms(plan(6000000000, 'farm'))),
    industry: Array.from(model.uniforms(plan(6000000000, 'factory'))),
    mixed: Array.from(model.uniforms(model.plan({ colony: { population: 6000000000 },
      buildings: ['factory', 'trade_center', 'research_lab'].map(type => ({ type, level: 8 })) }, manifest, sites))),
    off: Array.from(model.uniforms(plan(6000000000, 'trade_center', false))),
    reseeded: Array.from(model.uniforms({ ...future, seed: 2027 })),
    satelliteEarly: Array.from(model.uniforms(satellitePlan(100000))),
    satelliteLate: Array.from(model.uniforms(satelliteLate)),
    satelliteAbandoned: Array.from(model.uniforms(satelliteAbandoned)),
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
    const parameters = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(materialBuffer, 0, new Float32Array(data.base));
    const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: parameters } }, { binding: 2, resource: { buffer: materialBuffer } },
      { binding: 3, resource: { buffer } },
    ] });
    const target = device.createTexture({ size: [128, 128], format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 128 * 128 * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const capture = async (plan, light = -1, mask = 0, region = 0, patches = [0, 0, 0, 0]) => {
      device.queue.writeBuffer(buffer, 0, new Float32Array(plan));
      device.queue.writeBuffer(parameters, 0, new Float32Array([light, mask, region, 0, ...patches]));
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
    for (const name of ['early', 'future', 'science', 'farm', 'industry', 'mixed', 'off', 'reseeded',
      'satelliteEarly', 'satelliteLate', 'satelliteRuins']) frames[name] = await capture(data[name]);
    frames.repeat = await capture(data.future);
    frames.day = await capture(data.future, 1);
    frames.water = await capture(data.future, -1, 1);
    frames.region = await capture(data.future, -1, 0, 1);
    for (const [name, width] of [['zero', 0], ['start', 0.001], ['middle', 0.004], ['late', 0.009]]) {
      frames[`patch_${name}`] = await capture(data.future, -1, 0, 0, [1, width, 0.0003, 0]);
    }
    frames.patch_repeat = await capture(data.future, -1, 0, 0, [1, 0.004, 0.0003, 0]);
    frames.patch_reseeded = await capture(data.reseeded, -1, 0, 0, [1, 0.004, 0.0003, 0]);
    frames.patch_nearby = await capture(data.future, -1, 0, 0, [1, 0.004001, 0.0003, 0]);
    frames.patch_coarse = await capture(data.future, -1, 0, 0, [1, 0.009, 0.02, 0]);
    frames.patch_backside = await capture(data.future, -1, 0, 0, [1, 0.009, 0.0003, -1]);
    const samePoint = [...data.future], remote = [...data.future];
    samePoint.splice(8 + 20, 3, ...samePoint.slice(8, 11));
    remote.splice(8 + 20, 3, 1, 0, 0);
    frames.patch_degenerate = await capture(samePoint, -1, 0, 0, [1, 0.009, 0.0003, 0]);
    frames.patch_remote = await capture(remote, -1, 0, 0, [1, 0.009, 0.0003, 0]);
    for (const [name, radius] of [['young', 0.006], ['growing', 0.012], ['mature', 0.024]]) {
      frames[`density_${name}`] = await capture(data.future, -1, 0, 0, [-1, radius, 0.0001, 0]);
    }
    frames.density_repeat = await capture(data.future, -1, 0, 0, [-1, 0.024, 0.0001, 0]);
    frames.density_nearby = await capture(data.future, -1, 0, 0, [-1, 0.024001, 0.0001, 0]);
    frames.density_agriculture = await capture(data.future, -1, 0, 0, [-1, 0.024, 0.0001, 1]);
    frames.density_coarse = await capture(data.future, -1, 0, 0, [-1, 0.024, 0.02, 0]);
    frames.quarters = await capture(data.future, -1, 0, 0, [-2, 0.012, 0.0001, 293]);
    frames.quarters_repeat = await capture(data.future, -1, 0, 0, [-2, 0.012, 0.0001, 293]);
    frames.quarters_reseeded = await capture(data.future, -1, 0, 0, [-2, 0.012, 0.0001, 294]);
    frames.quarters_coarse = await capture(data.future, -1, 0, 0, [-2, 0.012, 0.02, 293]);
    for (const name of ['mixed', 'science', 'industry', 'future', 'off', 'satelliteLate',
      'satelliteAbandoned', 'satelliteRuins']) {
      frames[`material_${name}`] = await capture(data[name], 1, 0, 0, [2, 0, 0, 0]);
    }
    frames.material_repeat = await capture(data.mixed, 1, 0, 0, [2, 0, 0, 0]);
    frames.material_night = await capture(data.future, -1, 0, 0, [2, 0, 0, 0]);
    frames.material_water = await capture(data.mixed, 1, 1, 0, [2, 0, 0, 0]);
    frames.material_region = await capture(data.mixed, 1, 0, 1, [2, 0, 0, 0]);
    for (const name of ['mixed', 'science', 'industry']) {
      frames[`roof_${name}`] = await capture(data[name], 1, 0, 0, [-3, 0.012, 0.0001, 293]);
    }
    frames.roof_coarse = await capture(data.mixed, 1, 0, 0, [-3, 0.012, 0.02, 293]);
    frames.roof_coarser = await capture(data.mixed, 1, 0, 0, [-3, 0.012, 0.04, 293]);
    for (const name of ['mixed', 'science', 'industry']) {
      frames[`normal_${name}`] = await capture(data[name], 1, 0, 0, [-4, 0.012, 0.0001, 293]);
    }
    frames.normal_repeat = await capture(data.industry, 1, 0, 0, [-4, 0.012, 0.0001, 293]);
    frames.normal_coarse = await capture(data.industry, 1, 0, 0, [-4, 0.012, 0.002, 293]);
    frames.normal_transition = await capture(data.industry, 1, 0, 0, [-4, 0.012, 0.0005, 293]);
    frames.normal_nearby = await capture(data.industry, 1, 0, 0, [-4, 0.012, 0.000501, 293]);
    for (const name of ['future', 'off', 'satelliteLate', 'satelliteAbandoned']) {
      frames[`normal_surface_${name}`] = await capture(data[name], 1, 0, 0, [3, 0, 0, 0]);
    }
    frames.normal_surface_water = await capture(data.future, 1, 1, 0, [3, 0, 0, 0]);
    frames.normal_surface_region = await capture(data.future, 1, 0, 1, [3, 0, 0, 0]);
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
  expect(frames.patch_middle).toEqual(frames.patch_repeat);
  expect(frames.patch_middle).not.toEqual(frames.patch_reseeded);
  expect(lit(frames.patch_zero)).toBe(0);
  for (const name of ['patch_backside', 'patch_degenerate', 'patch_remote']) {
    expect(lit(frames[name])).toBe(0);
    expect(frames[name].every(Number.isFinite)).toBe(true);
  }
  const stages = ['zero', 'start', 'middle', 'late'].map(stage => frames[`patch_${stage}`]);
  for (let stage = 1; stage < stages.length; stage++) {
    expect(lit(stages[stage])).toBeGreaterThan(lit(stages[stage - 1]));
    let maximumLoss = 0;
    for (let i = 0; i < stages[stage].length; i += 4) {
      maximumLoss = Math.max(maximumLoss, stages[stage - 1][i] - stages[stage][i]);
    }
    expect(maximumLoss).toBeLessThanOrEqual(1e-6);
  }
  const change = frames.patch_middle.reduce((maximum, n, i) =>
    i % 4 === 0 ? Math.max(maximum, Math.abs(n - frames.patch_nearby[i])) : maximum, 0);
  expect(change).toBeLessThan(0.005);
  const midBand = [];
  for (let y = 62; y <= 65; y++) for (let x = 48; x <= 79; x++) midBand.push(frames.patch_middle[(y * 128 + x) * 4]);
  expect(midBand.filter(n => n < 0.01).length).toBeGreaterThan(5);
  expect(midBand.filter(n => n > 0.1).length).toBeGreaterThan(5);
  for (const frame of [...stages, frames.patch_coarse]) {
    expect(frame.every(Number.isFinite)).toBe(true);
    expect(Math.max(...frame)).toBeLessThanOrEqual(1);
    expect(Math.min(...frame)).toBeGreaterThanOrEqual(0);
  }
  const densityStages = ['young', 'growing', 'mature'].map(stage => frames[`density_${stage}`]);
  // Fixed parcels in the pre-existing young core: measure densification, not new outer area.
  const coreSum = (frame, channel) => {
    let sum = 0;
    for (let y = 52; y < 76; y++) for (let x = 52; x < 76; x++) sum += frame[(y * 128 + x) * 4 + channel];
    return sum;
  };
  expect(coreSum(frames.density_mature, 1)).toBeGreaterThan(coreSum(frames.density_young, 1) * 1.15);
  expect(coreSum(frames.density_mature, 1)).toBeGreaterThan(coreSum(frames.density_agriculture, 1));
  expect(frames.density_mature).toEqual(frames.density_repeat);
  const densityChange = frames.density_mature.reduce((maximum, n, i) =>
    Math.max(maximum, Math.abs(n - frames.density_nearby[i])), 0);
  expect(densityChange).toBeLessThan(0.005);
  for (let stage = 1; stage < densityStages.length; stage++) {
    let maximumLoss = 0;
    for (let i = 0; i < densityStages[stage].length; i++) {
      if (i % 4 < 2) maximumLoss = Math.max(maximumLoss, densityStages[stage - 1][i] - densityStages[stage][i]);
    }
    expect(maximumLoss).toBeLessThanOrEqual(1e-6);
  }
  expect(frames.density_coarse.every(Number.isFinite)).toBe(true);
  expect(Math.min(...frames.density_coarse)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...frames.density_coarse)).toBeLessThanOrEqual(1);
  expect(frames.quarters).toEqual(frames.quarters_repeat);
  expect(frames.quarters).not.toEqual(frames.quarters_reseeded);
  const ratios = frame => {
    const values = [];
    for (let i = 0; i < frame.length; i += 4) {
      if (frame[i] > 0.01) values.push(frame[i + 2] / frame[i]);
    }
    return values;
  };
  const localHues = ratios(frames.quarters);
  expect(localHues.length).toBeGreaterThan(100);
  expect(Math.max(...localHues) - Math.min(...localHues)).toBeGreaterThan(0.08);
  const productionHues = ratios(frames.mixed);
  expect(productionHues.length).toBeGreaterThan(100);
  expect(Math.max(...productionHues) - Math.min(...productionHues)).toBeGreaterThan(0.08);
  const filteredHues = ratios(frames.quarters_coarse);
  expect(filteredHues.length).toBeGreaterThan(100);
  expect(Math.max(...filteredHues) - Math.min(...filteredHues)).toBeLessThan(1e-5);
  expect(frames.quarters_coarse.every(Number.isFinite)).toBe(true);
  expect(frames.material_mixed).toEqual(frames.material_repeat);
  expect(frames.material_future).toEqual(frames.material_off);
  expect(frames.material_future).toEqual(frames.material_night);
  expect(frames.material_science).not.toEqual(frames.material_industry);
  expect(sum(frames.material_satelliteLate, 0)).toBeGreaterThan(sum(frames.material_satelliteAbandoned, 0));
  expect(sum(frames.material_satelliteLate, 3)).toBeLessThan(sum(frames.material_satelliteAbandoned, 3));
  expect(frames.roof_coarse).toEqual(frames.roof_coarser);
  expect(sum(frames.roof_science, 0)).toBeGreaterThan(sum(frames.roof_industry, 0) * 1.3);
  const channelValues = (frame, channel) => frame.filter((_n, i) => i % 4 === channel);
  const roofRoughness = channelValues(frames.roof_industry, 3);
  expect(Math.max(...roofRoughness) - Math.min(...roofRoughness)).toBeGreaterThan(0.1);
  for (const channel of [0, 1, 2, 3]) {
    const coarse = channelValues(frames.roof_coarse, channel);
    expect(Math.max(...coarse) - Math.min(...coarse)).toBeLessThan(1e-6);
  }
  for (const name of ['material_water', 'material_region']) {
    expect(Math.max(...frames[name].filter((_n, i) => i % 4 < 3))).toBe(0);
  }
  for (const [name, frame] of Object.entries(frames)) {
    if (!name.startsWith('material_') && !name.startsWith('roof_')) continue;
    expect(frame.every(Number.isFinite)).toBe(true);
    expect(Math.min(...frame)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...frame)).toBeLessThanOrEqual(1);
  }
  expect(frames.normal_industry).toEqual(frames.normal_repeat);
  const normalEnergy = frame => frame.reduce((total, n, i) => total + (i % 4 < 2 ? n * n : 0), 0);
  expect(normalEnergy(frames.normal_industry)).toBeGreaterThan(normalEnergy(frames.normal_science) * 1.5);
  expect(normalEnergy(frames.normal_industry)).toBeGreaterThan(normalEnergy(frames.normal_transition));
  expect(normalEnergy(frames.normal_coarse)).toBe(0);
  const normalChange = frames.normal_transition.reduce((maximum, n, i) =>
    Math.max(maximum, Math.abs(n - frames.normal_nearby[i])), 0);
  expect(normalChange).toBeLessThan(0.001);
  for (const name of ['normal_mixed', 'normal_science', 'normal_industry', 'normal_coarse']) {
    let lengthError = 0, minZ = 1;
    for (let i = 0; i < frames[name].length; i += 4) {
      lengthError = Math.max(lengthError, Math.abs(Math.hypot(...frames[name].slice(i, i + 3)) - 1));
      minZ = Math.min(minZ, frames[name][i + 2]);
    }
    expect(lengthError).toBeLessThan(1e-6);
    expect(minZ).toBeGreaterThan(0.98);
  }
  expect(frames.normal_surface_future).toEqual(frames.normal_surface_off);
  for (const name of ['normal_surface_water', 'normal_surface_region']) {
    expect(Math.max(...frames[name].filter((_n, i) => i % 4 < 3).map(Math.abs))).toBeLessThan(1e-6);
  }
  expect(normalEnergy(frames.normal_surface_satelliteLate)).toBeGreaterThan(
    normalEnergy(frames.normal_surface_satelliteAbandoned));
});
