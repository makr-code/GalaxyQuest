const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const model = require('../../js/rendering/colony-surface-plan.js');
const material = require('../../js/rendering/body-material.js');

test.beforeEach(async ({ page }) => {
  await page.route('http://localhost:8080/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><div style="position:relative;width:512px;height:384px"><canvas width="512" height="384" style="width:512px;height:384px"></canvas></div>' });
    if (!/^\/js\/[\w/.-]+\.js$/.test(pathname) || pathname.includes('..')) return route.abort();
    return route.fulfill({ contentType: 'application/javascript',
      body: await fs.readFile(path.join(__dirname, '../..', pathname.slice(1)), 'utf8') });
  });
  await page.goto('http://localhost:8080/');
});

test('shared cloud turbulence deforms, loops and filters without temporal or spatial seams', async ({ page }) => {
  const { COLONY_SKY_WGSL } = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
  const shader = `${material.CLOUD_WGSL}
struct Parameters { state: vec4<f32>, shift: vec4<f32> };
@group(0) @binding(0) var<uniform> parameters: Parameters;
struct Out { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> Out {
  let point = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[index];
  var out: Out;
  out.position = vec4<f32>(point,0,1); out.uv = point;
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let point = vec3<f32>(in.uv * 8.0,0.7) + parameters.shift.xyz;
  let density = gqCloudNoise(point,parameters.state.x,parameters.state.y,parameters.state.z);
  return vec4<f32>(density,gqCloudCoverage(density,parameters.state.w),0,1);
}`;
  const result = await page.evaluate(async ({ code, sky }) => {
    const adapter = await navigator.gpu?.requestAdapter({ forceFallbackAdapter: true })
      || await navigator.gpu?.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const errors = [];
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code });
    const pipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: 'rgba32float' }] },
    });
    const parameters = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: parameters } },
    ] });
    const target = device.createTexture({
      size: [64,16], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({ size: 16384, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    async function render(seconds, seed = 35, footprint = 0.01, coverage = 0.65, shift = [0,0,0]) {
      device.queue.writeBuffer(parameters, 0, new Float32Array([seconds % 120,seed,footprint,coverage,...shift,0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: target.createView(), loadOp: 'clear', storeOp: 'store',
      }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(3); pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 1024 }, [64,16]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const data = Array.from(new Float32Array(readback.getMappedRange()));
      readback.unmap();
      return data;
    }
    const phase = 25 * Math.PI * 2 / 120;
    const translation = [Math.cos(phase) - 1,Math.sin(phase),Math.sin(phase + 0.7) - Math.sin(0.7)]
      .map(value => value * 0.8);
    const frames = {
      first: await render(5), later: await render(25), repeat: await render(5), loop: await render(125),
      translatedOnly: await render(0,35,0.01,0.65,translation),
      reseeded: await render(5,36), coarse: await render(5,35,2), coarseLater: await render(25,35,2),
      clear: await render(5,35,0.01,0),
      beforeLoop: await render(119.999), afterLoop: await render(0.001),
      leftSeam: await render(5,35,0.01,0.65,[-12,0,-0.00001]),
      rightSeam: await render(5,35,0.01,0.65,[-12,0,0.00001]),
    };
    const veilModule = device.createShaderModule({ code: sky });
    const veilPipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module: veilModule, entryPoint: 'vs_main' },
      fragment: { module: veilModule, entryPoint: 'fs_veil', targets: [{ format: 'rgba32float' }] },
    });
    const camera = device.createBuffer({ size: 544, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const veilBindings = device.createBindGroup({ layout: veilPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: camera } },
    ] });
    async function renderVeil(seconds, opacity = 0.8) {
      const state = new Float32Array(136);
      state[16] = 1;
      state[19] = seconds % 120;
      state[27] = opacity;
      state.set([0.4,0.65,0.9,1],40);
      state[44] = 30;
      state[55] = 35;
      device.queue.writeBuffer(camera, 0, state);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: target.createView(), loadOp: 'clear', storeOp: 'store',
      }] });
      pass.setPipeline(veilPipeline); pass.setBindGroup(0, veilBindings); pass.draw(3); pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 1024 }, [64,16]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const pixels = Array.from(new Float32Array(readback.getMappedRange()));
      readback.unmap();
      return pixels;
    }
    const veil = { first: await renderVeil(5), later: await renderVeil(25),
      repeat: await renderVeil(5), loop: await renderVeil(125), disabled: await renderVeil(5,0) };
    const validation = await device.popErrorScope();
    [parameters,target,readback,camera].forEach(resource => resource.destroy());
    device.destroy();
    return { frames, veil, errors, validation: validation?.message || null };
  }, { code: shader, sky: COLONY_SKY_WGSL });
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(result, 'GPU validation must not be skipped').not.toBeNull();
  test.skip(!result, 'No WebGPU adapter available locally');
  expect(result.errors).toEqual([]);
  expect(result.validation).toBeNull();
  const f = result.frames;
  expect(f.first).toEqual(f.repeat);
  expect(f.first).toEqual(f.loop);
  expect(f.coarse).toEqual(f.coarseLater);
  const changed = (a,b) => a.filter((v,i) => i % 4 === 0 && Math.abs(v - b[i]) > 0.01).length;
  expect(changed(f.first,f.later)).toBeGreaterThan(300);
  expect(changed(f.first,f.reseeded)).toBeGreaterThan(300);
  expect(changed(f.later,f.translatedOnly)).toBeGreaterThan(300);
  for (const frame of Object.values(f)) {
    expect(frame.every(Number.isFinite)).toBe(true);
    expect(Math.min(...frame)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...frame)).toBeLessThanOrEqual(1);
  }
  expect(f.coarse.filter((_v,i) => i % 4 === 0).every(v => v === 0.5)).toBe(true);
  expect(f.clear.filter((_v,i) => i % 4 === 1).every(v => v === 0)).toBe(true);
  expect(Math.max(...f.beforeLoop.map((value,i) => Math.abs(value - f.afterLoop[i])))).toBeLessThan(0.002);
  expect(Math.max(...f.leftSeam.map((value,i) => Math.abs(value - f.rightSeam[i])))).toBeLessThan(0.001);
  const v = result.veil;
  expect(v.first).toEqual(v.repeat);
  expect(v.first).toEqual(v.loop);
  expect(v.disabled.filter((_value,i) => i % 4 === 3).every(value => value === 0)).toBe(true);
  expect(v.first.filter((value,i) => i % 4 === 3 && Math.abs(value - v.later[i]) > 0.005).length)
    .toBeGreaterThan(100);
  const alpha = v.first.filter((_value,i) => i % 4 === 3);
  expect(Math.min(...alpha)).toBeGreaterThanOrEqual(0.64);
  expect(Math.max(...alpha)).toBeLessThanOrEqual(0.8);
});

test('industrial smoke has soft alpha edges without additive glow and preserves other particle profiles', async ({ page }) => {
  const { COLONY_VFX_WGSL } = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
  const result = await page.evaluate(async code => {
    const adapter = await navigator.gpu?.requestAdapter({ forceFallbackAdapter: true })
      || await navigator.gpu?.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const errors = [];
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main', buffers: [{
        arrayStride: 40, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x4' },
          { shaderLocation: 2, offset: 28, format: 'float32x3' },
        ],
      }] },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: 'rgba8unorm', blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      } }] },
    });
    const vertices = device.createBuffer({ size: 240, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const target = device.createTexture({
      size: [64, 64], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({ size: 16384, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    async function render(smoke, opacity = 0.5) {
      const data = [[-1,-1],[1,-1],[-1,1],[-1,1],[1,-1],[1,1]]
        .flatMap(([x,y]) => [x,y,0.5,0.34,0.36,0.38,opacity,x,y,smoke ? 1 : 0]);
      device.queue.writeBuffer(vertices, 0, new Float32Array(data));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: target.createView(), loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
      }] });
      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, vertices);
      pass.draw(6);
      pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, [64,64]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const pixels = Array.from(new Uint8Array(readback.getMappedRange()));
      readback.unmap();
      return pixels;
    }
    const smoke = await render(true), repeat = await render(true);
    const hidden = await render(true, 0), other = await render(false);
    const validation = await device.popErrorScope();
    [vertices, target, readback].forEach(resource => resource.destroy());
    device.destroy();
    return { smoke, repeat, hidden, other, errors, validation: validation?.message || null };
  }, COLONY_VFX_WGSL);
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(result, 'GPU validation must not be skipped').not.toBeNull();
  test.skip(!result, 'No WebGPU adapter available locally');
  expect(result.errors).toEqual([]);
  expect(result.validation).toBeNull();
  expect(result.repeat).toEqual(result.smoke);
  const pixel = (data, x, y) => data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4);
  expect(pixel(result.smoke, 0, 0)).toEqual([204,204,204,255]);
  expect(pixel(result.smoke, 32, 32)).toEqual(pixel(result.other, 32, 32));
  expect(Math.abs(pixel(result.smoke, 32, 32)[0] - (0.8 * 0.5 + 0.34 * 0.5) * 255)).toBeLessThan(1);
  expect(pixel(result.smoke, 32, 32)[0]).toBeLessThan(pixel(result.smoke, 50, 32)[0]);
  expect(pixel(result.smoke, 50, 32)[0]).toBeLessThan(204);
  expect(pixel(result.other, 0, 0)).toEqual(pixel(result.other, 32, 32));
  expect(new Set(result.hidden.filter((_v, i) => i % 4 !== 3))).toEqual(new Set([204]));
});

test('economic land use, water masking and night lights produce distinct, deterministic pixels', async ({ page }) => {
  const shader = material.shader(model.WGSL + `
struct Parameters { surface: vec4<f32>, view: vec4<f32> };
@group(0) @binding(0) var<uniform> parameters: Parameters;
struct Out { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> Out {
  let point = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[index];
  var out: Out;
  out.position = vec4<f32>(point,0,1);
  out.uv = point;
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let point = normalize(vec3<f32>(in.uv * parameters.view.z + parameters.view.xy,1));
  let normal = normalize(mix(point,vec3<f32>(1,0,0),parameters.surface.w));
  let surface = gqSurface(point,point * gqMaterial.scale.y,normal,0.0);
  let light = vec3<f32>(0,0,parameters.surface.y);
  let result = gqLivingSurface(surface,point,normal,light,parameters.surface.x,parameters.surface.z);
  return vec4<f32>(gqSrgb(result.albedo + result.emission),1);
}`);
  const geography = { body_id: 12, seed: 35, biome: 'terran', radius_km: 6 };
  const sites = [{ id: 'pixel-fixture', direction: [0, 0, 1], height: 1 }];
  const plans = ['farm', 'metal_mine', 'factory'].map(type => model.plan({
    colony: { population: 40000 }, buildings: [{ type, level: 8 }],
  }, geography, sites));
  const roadSites = [{ id: 'west', direction: [-0.3, 0, Math.sqrt(0.91)], height: 1 },
    { id: 'east', direction: [0.3, 0, Math.sqrt(0.91)], height: 1 }];
  const roads = model.roadNetwork(geography, roadSites, () => ({ height: 1, slope: 0 }));
  const roadPlan = model.plan({ population: 2000, buildings: [{ type: 'factory', level: 8 }] }, geography, roadSites, roads);
  const farmRoadPlan = model.plan({ population: 2000, buildings: [{ type: 'farm', level: 8 }] }, geography, roadSites, roads);
  const urbanRoadPlan = structuredClone(roadPlan);
  urbanRoadPlan.settlements[0] = { ...urbanRoadPlan.settlements[0], direction: [0, 0, 1], radius: 0.08, landRadius: 0.08 };
  const ruinPlan = model.plan({ colony: { population: 0 },
    body_development: { body_id: 12, version: 1, founded_count: 6, peak_population: 40000 } }, geography, sites);
  const ruinedRoadPlan = { ...roadPlan, roads: roadPlan.roads.map(road => ({ ...road, ruined: true })) };
  const regional = model.plan({ population: 4000,
    buildings: [{ type: 'farm', level: 4 }, { type: 'mine', level: 4 }, { type: 'factory', level: 4 }] },
  { ...geography, amplitude_km: 8 }, [
    { id: 'plain', direction: [0.6, 0.8, 0], height: 2, slope: 0 },
    { id: 'lowland', direction: [Math.sqrt(0.91), 0.3, 0], height: 1, slope: 0.005 },
    { id: 'highland', direction: [0, 0, -1], height: 7, slope: 0.3 },
  ]);
  // Isolate each real regional mix at an identical footprint to measure local, not global, sector selection.
  const regionalPlans = regional.settlements.map(site => model.uniforms({ ...regional,
    settlements: [{ ...site, direction: [0, 0, 1], radius: plans[0].settlements[0].radius, landRadius: 0.18 }] }));
  const trafficPolicy = { motion: true, visible: true };
  const centerTime = Array.from({ length: 1200 }, (_, i) => ({
    time: i / 10, distance: Math.abs(model.trafficPosition(roadPlan.roads[0], geography.seed, i / 10).direction[0]),
  })).sort((a, b) => a.distance - b.distance)[0].time;
  const miningRoadPlan = model.plan({ population: 2000, buildings: [{ type: 'mine', level: 8 }] }, geography, roadSites, roads);
  const traffic = {
    start: model.uniforms(roadPlan, centerTime, trafficPolicy),
    later: model.uniforms(roadPlan, centerTime + 6, trafficPolicy),
    farm: model.uniforms(farmRoadPlan, centerTime, trafficPolicy),
    mine: model.uniforms(miningRoadPlan, centerTime, trafficPolicy),
    farmBase: model.uniforms(farmRoadPlan), mineBase: model.uniforms(miningRoadPlan),
    reduced: model.uniforms(roadPlan, centerTime, { ...trafficPolicy, motion: false }),
    hidden: model.uniforms(roadPlan, centerTime, { ...trafficPolicy, visible: false }),
    ruined: model.uniforms(ruinedRoadPlan, centerTime, trafficPolicy),
    urban: model.uniforms(urbanRoadPlan, centerTime, trafficPolicy),
  };
  const result = await page.evaluate(async ({ shader, plans, roadPlan, farmRoadPlan, urbanRoadPlan,
    ruinPlan, ruinedRoadPlan, regionalPlans, traffic, roadOffset, base, size }) => {
    const adapter = await navigator.gpu?.requestAdapter({ forceFallbackAdapter: true })
      || await navigator.gpu?.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const errors = [];
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code: shader });
    const pipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: 'rgba8unorm' }] },
    });
    const parameters = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const materialBuffer = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const surfaceBuffer = device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: parameters } },
      { binding: 2, resource: { buffer: materialBuffer } },
      { binding: 3, resource: { buffer: surfaceBuffer } },
    ] });
    const target = device.createTexture({
      size: [64, 64], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({ size: 64 * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    device.queue.writeBuffer(materialBuffer, 0, new Float32Array(base));
    async function render(plan, mask = 0, light = 1, region = 0, slope = 0, seconds = 0, wind = false, view = [0, 0, 0.13]) {
      const state = new Float32Array(base);
      state[23] = seconds % 120;
      new Int32Array(state.buffer)[27] = wind ? 1 : 0;
      device.queue.writeBuffer(materialBuffer, 0, state);
      device.queue.writeBuffer(surfaceBuffer, 0, new Float32Array(plan));
      device.queue.writeBuffer(parameters, 0, new Float32Array([mask, light, region, slope, ...view, 0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindings);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, [64, 64]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const pixels = Array.from(new Uint8Array(readback.getMappedRange()));
      readback.unmap();
      return pixels;
    }
    const empty = Array(size / 4).fill(0);
    const uninhabited = await render(empty);
    const farm = await render(plans[0]), repeat = await render(plans[0]);
    const mine = await render(plans[1]), industry = await render(plans[2]);
    const water = await render(plans[0], 1), region = await render(plans[0], 0, 1, 1);
    const night = await render(plans[0], 0, -1);
    const inactive = [...plans[0]];
    inactive[1] = 0;
    const unpoweredNight = await render(inactive, 0, -1);
    const road = await render(roadPlan);
    const roadRepeat = await render(roadPlan);
    const farmRoad = await render(farmRoadPlan);
    const noRoad = [...roadPlan];
    noRoad[roadOffset] = 0;
    const withoutRoad = await render(noRoad);
    const roadWater = await render(roadPlan, 1), noRoadWater = await render(noRoad, 1);
    const roadRegion = await render(roadPlan, 0, 1, 1), noRoadRegion = await render(noRoad, 0, 1, 1);
    const roadSteep = await render(roadPlan, 0, 1, 0, 1), noRoadSteep = await render(noRoad, 0, 1, 0, 1);
    const roadNight = await render(roadPlan, 0, -1);
    const roadOff = [...roadPlan];
    roadOff[1] = 0;
    const roadUnpowered = await render(roadOff, 0, -1);
    const urbanRoad = await render(urbanRoadPlan);
    const noUrbanRoad = [...urbanRoadPlan];
    noUrbanRoad[roadOffset] = 0;
    const urbanWithoutRoad = await render(noUrbanRoad);
    const ruins = await render(ruinPlan), ruinsNight = await render(ruinPlan, 0, -1);
    const ruinedRoad = await render(ruinedRoadPlan), ruinedRoadNight = await render(ruinedRoadPlan, 0, -1);
    const regionalPixels = [];
    for (const plan of regionalPlans) regionalPixels.push(await render(plan));
    const protectedSectors = [];
    for (const plan of plans) {
      protectedSectors.push({
        water: await render(plan, 1), lava: await render(plan, 3),
        ice: await render(plan, 4), region: await render(plan, 0, 1, 1),
        steep: await render(plan, 0, 1, 0, 1),
      });
    }
    const trafficPixels = {};
    for (const [key, plan] of Object.entries(traffic)) trafficPixels[key] = await render(plan);
    trafficPixels.repeat = await render(traffic.start);
    trafficPixels.water = await render(traffic.start, 1);
    trafficPixels.region = await render(traffic.start, 0, 1, 1);
    trafficPixels.steep = await render(traffic.start, 0, 1, 0, 1);
    trafficPixels.night = await render(traffic.start, 0, -1);
    const stoppedTraffic = [...traffic.start];
    stoppedTraffic[1] = 0;
    trafficPixels.unpowered = await render(stoppedTraffic, 0, -1);
    const center = pixels => pixels.filter((_n, index) => {
      const pixel = Math.floor(index / 4), x = pixel % 64, y = Math.floor(pixel / 64);
      return x >= 28 && x < 36 && y >= 28 && y < 36;
    });
    const closedFarm = [...plans[0]];
    closedFarm[2] = 0;
    const close = [0.05, 0.02, 0.003];
    const windPixels = {
      farm: await render(plans[0], 0, 1, 0, 0, 5, true, close),
      later: await render(plans[0], 0, 1, 0, 0, 9, true, close),
      repeat: await render(plans[0], 0, 1, 0, 0, 5, true, close),
      loop: await render(plans[0], 0, 1, 0, 0, 125, true, close),
      disabled: await render(plans[0], 0, 1, 0, 0, 9, false, close),
      still: await render(plans[0], 0, 1, 0, 0, 0, false, close),
      mine: await render(plans[1], 0, 1, 0, 0, 5, true, close),
      mineStill: await render(plans[1], 0, 1, 0, 0, 0, false, close),
      industry: await render(plans[2], 0, 1, 0, 0, 5, true, close),
      industryStill: await render(plans[2], 0, 1, 0, 0, 0, false, close),
      water: await render(plans[0], 1, 1, 0, 0, 5, true, close),
      lava: await render(plans[0], 3, 1, 0, 0, 5, true, close),
      ice: await render(plans[0], 4, 1, 0, 0, 5, true, close),
      region: await render(plans[0], 0, 1, 1, 0, 5, true, close),
      steep: await render(plans[0], 0, 1, 0, 1, 5, true, close),
      steepStill: await render(empty, 0, 1, 0, 1, 0, false, close),
      uninhabited: await render(empty, 0, 1, 0, 0, 0, false, close),
      closed: await render(closedFarm, 0, 1, 0, 0, 5, true, close),
      closedStill: await render(closedFarm, 0, 1, 0, 0, 0, false, close),
      ruins: await render(ruinPlan, 0, 1, 0, 0, 5, true, close),
      ruinsStill: await render(ruinPlan, 0, 1, 0, 0, 0, false, close),
      distant: await render(plans[0], 0, 1, 0, 0, 5, true),
      urban: await render(plans[0], 0, 1, 0, 0, 5, true, [0, 0, 0.003]),
      urbanStill: await render(plans[0], 0, 1, 0, 0, 0, false, [0, 0, 0.003]),
    };
    const validation = await device.popErrorScope();
    [parameters, materialBuffer, surfaceBuffer, target, readback].forEach(resource => resource.destroy());
    device.destroy();
    return { errors, validation: validation?.message || null, uninhabited, farm, repeat, mine, industry,
      water, region, night, unpoweredNight, road, roadRepeat, farmRoad, withoutRoad,
      roadWater, noRoadWater, roadRegion, noRoadRegion, roadSteep, noRoadSteep, roadNight, roadUnpowered,
      urbanCore: center(urbanRoad), urbanCoreWithoutRoad: center(urbanWithoutRoad), ruins, ruinsNight,
      ruinedRoad, ruinedRoadNight, regionalPixels, protectedSectors, trafficPixels,
      urbanTrafficCore: center(trafficPixels.urban), windPixels };
  }, {
    shader, plans: plans.map(plan => Array.from(model.uniforms(plan))), size: model.UNIFORM_BYTES,
    roadPlan: Array.from(model.uniforms(roadPlan)), roadOffset: model.ROAD_OFFSET,
    farmRoadPlan: Array.from(model.uniforms(farmRoadPlan)),
    urbanRoadPlan: Array.from(model.uniforms(urbanRoadPlan)),
    ruinPlan: Array.from(model.uniforms(ruinPlan)), ruinedRoadPlan: Array.from(model.uniforms(ruinedRoadPlan)),
    regionalPlans: regionalPlans.map(plan => Array.from(plan)),
    traffic: Object.fromEntries(Object.entries(traffic).map(([key, plan]) => [key, Array.from(plan)])),
    base: Array.from(material.materialUniforms(material.resolveBodyMaterial({}, geography), 1000)),
  });
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(result, 'GPU validation must not be skipped').not.toBeNull();
  test.skip(!result, 'No WebGPU adapter available locally');
  expect(result.errors).toEqual([]);
  expect(result.validation).toBeNull();
  expect(result.repeat).toEqual(result.farm);
  expect(result.windPixels.repeat).toEqual(result.windPixels.farm);
  expect(result.windPixels.loop).toEqual(result.windPixels.farm);
  expect(result.windPixels.disabled).toEqual(result.windPixels.still);
  expect(result.windPixels.mine).toEqual(result.windPixels.mineStill);
  expect(result.windPixels.industry).toEqual(result.windPixels.industryStill);
  expect(result.windPixels.closed).toEqual(result.windPixels.closedStill);
  expect(result.windPixels.ruins).toEqual(result.windPixels.ruinsStill);
  expect(result.windPixels.distant).toEqual(result.farm);
  expect(result.windPixels.urban).toEqual(result.windPixels.urbanStill);
  for (const key of ['water', 'lava', 'ice', 'region', 'steep']) {
    expect(result.windPixels[key], `wind exclusion: ${key}`)
      .toEqual(key === 'steep' ? result.windPixels.steepStill : result.windPixels.uninhabited);
  }
  expect(result.windPixels.farm.filter((value, i) => Math.abs(value - result.windPixels.later[i]) > 1).length)
    .toBeGreaterThan(30);
  expect(result.water).toEqual(result.uninhabited);
  expect(result.region).toEqual(result.uninhabited);
  for (const sector of result.protectedSectors) {
    for (const pixels of Object.values(sector)) expect(pixels).toEqual(result.uninhabited);
  }
  const changedPixels = (a, b) => a.filter((n, i) => i % 4 !== 3 && Math.abs(n - b[i]) > 5).length;
  expect(changedPixels(result.farm, result.mine)).toBeGreaterThan(300);
  expect(changedPixels(result.farm, result.industry)).toBeGreaterThan(300);
  expect(changedPixels(result.mine, result.industry)).toBeGreaterThan(300);
  expect(changedPixels(result.night, result.farm)).toBeGreaterThan(100);
  expect(result.unpoweredNight).toEqual(result.farm);
  expect(result.road).toEqual(result.roadRepeat);
  expect(changedPixels(result.road, result.withoutRoad)).toBeGreaterThan(30);
  expect(changedPixels(result.road, result.farmRoad)).toBeGreaterThan(30);
  expect(result.roadWater).toEqual(result.noRoadWater);
  expect(result.roadRegion).toEqual(result.noRoadRegion);
  expect(result.roadSteep).toEqual(result.noRoadSteep);
  expect(changedPixels(result.roadNight, result.road)).toBeGreaterThan(30);
  expect(result.roadUnpowered).toEqual(result.road);
  expect(result.urbanCore).toEqual(result.urbanCoreWithoutRoad);
  expect(result.ruins).toEqual(result.ruinsNight);
  expect(changedPixels(result.ruins, result.farm)).toBeGreaterThan(30);
  expect(result.ruinedRoad).toEqual(result.ruinedRoadNight);
  expect(changedPixels(result.regionalPixels[0], result.regionalPixels[1])).toBeGreaterThan(300);
  expect(changedPixels(result.regionalPixels[1], result.regionalPixels[2])).toBeGreaterThan(300);
  expect(changedPixels(result.regionalPixels[0], result.regionalPixels[2])).toBeGreaterThan(300);
  expect(result.trafficPixels.repeat).toEqual(result.trafficPixels.start);
  expect(changedPixels(result.trafficPixels.start, result.road)).toBeGreaterThan(5);
  expect(changedPixels(result.trafficPixels.start, result.trafficPixels.later)).toBeGreaterThan(10);
  expect(changedPixels(result.trafficPixels.farm, result.trafficPixels.farmBase)).toBeGreaterThan(5);
  expect(changedPixels(result.trafficPixels.mine, result.trafficPixels.mineBase)).toBeGreaterThan(5);
  expect(changedPixels(result.trafficPixels.farm, result.trafficPixels.mine)).toBeGreaterThan(5);
  expect(result.trafficPixels.reduced).toEqual(result.road);
  expect(result.trafficPixels.hidden).toEqual(result.road);
  expect(result.trafficPixels.ruined).toEqual(result.ruinedRoad);
  expect(result.trafficPixels.water).toEqual(result.roadWater);
  expect(result.trafficPixels.region).toEqual(result.roadRegion);
  expect(result.trafficPixels.steep).toEqual(result.roadSteep);
  expect(result.trafficPixels.unpowered).toEqual(result.road);
  expect(changedPixels(result.trafficPixels.night, result.roadNight)).toBeGreaterThan(5);
  expect(result.urbanTrafficCore).toEqual(result.urbanCore);
});

test('economic landscape patterns expose filtered fields, quarry benches and industrial roofs with distinct roughness', async ({ page }) => {
  const shader = material.shader(model.WGSL + `
@group(0) @binding(0) var<uniform> parameters: vec4<f32>;
@group(0) @binding(1) var<uniform> wind: vec4<f32>;
struct Out { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> Out {
  let point = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[index];
  var out: Out;
  out.position = vec4<f32>(point,0,1);
  out.uv = point * 0.5 + 0.5;
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let landscape = gqWindLandscape(
    gqEconomicLandscape(in.uv * 2.0,parameters.y,u32(parameters.z)),
    in.uv * 2.0,parameters.y,u32(parameters.z),wind.x,wind.y);
  if (parameters.w > 0.5) {
    return vec4<f32>(vec3<f32>(landscape.roughness[u32(parameters.x)]),1);
  }
  var color = landscape.farm;
  if (parameters.x > 0.5) { color = landscape.quarry; }
  if (parameters.x > 1.5) { color = landscape.industry; }
  return vec4<f32>(gqSrgb(color),1);
}`);
  const result = await page.evaluate(async shader => {
    const adapter = await navigator.gpu?.requestAdapter({ forceFallbackAdapter: true })
      || await navigator.gpu?.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const errors = [];
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code: shader });
    const pipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: 'rgba8unorm' }] },
    });
    const parameters = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const wind = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: parameters } },
      { binding: 1, resource: { buffer: wind } },
    ] });
    const target = device.createTexture({
      size: [128, 128], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({ size: 128 * 512, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    async function render(sector, footprint, seed = 35, roughness = false, seconds = 0, enabled = false) {
      device.queue.writeBuffer(parameters, 0, new Float32Array([sector, footprint, seed, roughness ? 1 : 0]));
      device.queue.writeBuffer(wind, 0, new Float32Array([seconds % 120, enabled ? 1 : 0, 0, 0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindings);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 512 }, [128, 128]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const pixels = Array.from(new Uint8Array(readback.getMappedRange()));
      readback.unmap();
      return pixels;
    }
    const sectors = [];
    for (let sector = 0; sector < 3; sector++) {
      sectors.push({
        fine: await render(sector, 0.01), repeat: await render(sector, 0.01),
        reseeded: await render(sector, 0.01, 36), coarse: await render(sector, 1),
        coarser: await render(sector, 4), roughness: await render(sector, 0.01, 35, true),
        coarseRoughness: await render(sector, 1, 35, true),
        wind: await render(sector, 0.01, 35, false, 5, true),
        later: await render(sector, 0.01, 35, false, 9, true),
        repeatWind: await render(sector, 0.01, 35, false, 5, true),
        loop: await render(sector, 0.01, 35, false, 125, true),
        disabled: await render(sector, 0.01, 35, false, 9),
        filteredWind: await render(sector, 0.1, 35, false, 5, true),
        filteredStill: await render(sector, 0.1),
        windRoughness: await render(sector, 0.01, 35, true, 5, true),
        beforeLoop: await render(sector, 0.01, 35, false, 119.999, true),
        afterLoop: await render(sector, 0.01, 35, false, 0.001, true),
      });
    }
    const validation = await device.popErrorScope();
    [parameters, wind, target, readback].forEach(resource => resource.destroy());
    device.destroy();
    return { errors, validation: validation?.message || null, sectors };
  }, shader);
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(result, 'GPU validation must not be skipped').not.toBeNull();
  test.skip(!result, 'No WebGPU adapter available locally');
  expect(result.errors).toEqual([]);
  expect(result.validation).toBeNull();
  const channels = pixels => pixels.filter((_n, i) => i % 4 !== 3);
  const changed = (a, b) => a.filter((n, i) => i % 4 !== 3 && Math.abs(n - b[i]) > 5).length;
  for (const [index, sector] of result.sectors.entries()) {
    expect(sector.repeatWind).toEqual(sector.wind);
    expect(sector.loop).toEqual(sector.wind);
    expect(sector.disabled).toEqual(sector.fine);
    expect(sector.filteredWind).toEqual(sector.filteredStill);
    expect(sector.windRoughness).toEqual(sector.roughness);
    expect(Math.max(...sector.beforeLoop.map((value, i) => Math.abs(value - sector.afterLoop[i])))).toBeLessThanOrEqual(1);
    if (index === 0) {
      expect(sector.wind.filter((value, i) => Math.abs(value - sector.later[i]) > 2).length).toBeGreaterThan(500);
      expect(Math.max(...sector.wind.map((value, i) => Math.abs(value - sector.fine[i])))).toBeLessThanOrEqual(10);
      for (let y = 0; y < 128; y++) {
        expect(sector.wind.slice(y * 512,y * 512 + 4)).toEqual(sector.fine.slice(y * 512,y * 512 + 4));
      }
    } else {
      expect(sector.wind).toEqual(sector.fine);
      expect(sector.later).toEqual(sector.fine);
    }
    expect(sector.repeat).toEqual(sector.fine);
    expect(changed(sector.fine, sector.reseeded)).toBeGreaterThan(500);
    expect(changed(sector.fine, sector.coarse)).toBeGreaterThan(3000);
    expect(sector.coarse).toEqual(sector.coarser);
    const coarse = channels(sector.coarse);
    expect(new Set(coarse.filter((_n, i) => i % 3 === 0)).size).toBe(1);
    const roughness = sector.roughness.filter((_n, i) => i % 4 === 0);
    expect(Math.max(...roughness) - Math.min(...roughness)).toBeGreaterThan(index === 2 ? 80 : 20);
    expect(new Set(sector.coarseRoughness.filter((_n, i) => i % 4 === 0)).size).toBe(1);
  }
  expect(changed(result.sectors[0].fine, result.sectors[1].fine)).toBeGreaterThan(10000);
  expect(changed(result.sectors[1].fine, result.sectors[2].fine)).toBeGreaterThan(10000);
  const sample = (pixels, x, y, channel = 0) => pixels[(y * 128 + x) * 4 + channel];
  const [farm, quarry, industry] = result.sectors;
  expect(sample(farm.fine, 31, 95, 1) - sample(farm.fine, 0, 95, 1)).toBeGreaterThan(10);
  expect(sample(quarry.roughness, 31, 95) - sample(quarry.roughness, 0, 95)).toBeGreaterThan(20);
  expect(sample(industry.roughness, 31, 111) - sample(industry.roughness, 15, 111)).toBeGreaterThan(80);
  expect(sample(industry.fine, 15, 111) - sample(industry.fine, 31, 111)).toBeGreaterThan(20);
});

test('production orbit and managed city share anchors and release their owned GPU resources', async ({ page }, testInfo) => {
  const result = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter({ forceFallbackAdapter: true })
      || await navigator.gpu?.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const resources = [];
    for (const method of ['createBuffer', 'createTexture']) {
      const create = device[method].bind(device);
      device[method] = descriptor => {
        const resource = create(descriptor);
        const entry = { label: descriptor.label, destroys: 0 };
        resources.push(entry);
        const destroy = resource.destroy.bind(resource);
        resource.destroy = () => { entry.destroys++; destroy(); };
        return resource;
      };
    }
    const errors = [];
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    device.pushErrorScope('validation');
    await import('/js/engine/zoom/IZoomLevelRenderer.js');
    await import('/js/rendering/body-material.js');
    await import('/js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
    await import('/js/engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js');
    const { ColonySurfaceLevelWebGPU } = window.GQColonySurfaceLevelWebGPU;
    const { PersistentBodyPlanetApproachRenderer } = window.GQPersistentBodyPlanetApproach;
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
    const backend = { device, context, externalCameraControls: true };
    const data = {
      reduced_motion: true, colony: { name: 'Living surface fixture', population: 40000, diameter_km: 12742 },
      buildings: [{ type: 'farm', level: 4 }, { type: 'metal_mine', level: 2 }, { type: 'factory', level: 2 }],
      bodyTerrainManifest: {
        body_id: 12, generator_version: 1, projection: 'cube-sphere', seed: 35, biome: 'terran',
        radius_km: 6371, amplitude_km: 8, height_min_km: -16, height_max_km: 16, sea_level_km: -8,
        max_lod: 14, resolution: 17, tile_encoding: 'uint16-json',
      },
    };
    const orbit = new PersistentBodyPlanetApproachRenderer();
    const city = new ColonySurfaceLevelWebGPU();
    await orbit.initialize(canvas, backend);
    await city.initialize(canvas, backend);
    await orbit.enter(1, data);
    orbit.render(0.016, { position: { x: 0, y: 0, z: 3 } });
    await orbit.exit(3);
    await city.enter(2, data);
    city.render(0.016);
    const samePlan = JSON.stringify(orbit._surfacePlan) === JSON.stringify(city._surfacePlan);
    const sharedRoads = orbit._surfacePlan.roads.length > 0
      && JSON.stringify(orbit._surfaceRoads) === JSON.stringify(city._surfaceRoads);
    const primaryAligned = JSON.stringify(city._bodySurface.terrain.shape.frame[1])
      === JSON.stringify(orbit._surfacePlan.settlements[0].direction);
    const anchors = city._surfacePlan.settlements.map(site => ({ id: site.id, direction: site.direction }));
    const keys = city._slots.map(slot => slot.key);
    const primary = city._activeSettlement.id;
    const satelliteVisits = [];
    for (const index of [1, 2, 4, 1]) {
      const site = city._surfacePlan.settlements[index];
      const selector = city._hud.querySelector('[data-city-settlement]');
      selector.value = site.id;
      selector.dispatchEvent(new Event('change'));
      city.render(0.016);
      satelliteVisits.push({
        selected: city._activeSettlement.id === site.id,
        aligned: JSON.stringify(city._bodySurface.terrain.shape.frame[1]) === JSON.stringify(site.direction),
        decorative: city._city.decorative === true,
        parts: city._city.parts.length,
        slots: city._slots.length, people: city._people.length,
        progress: city._camera.progress,
        inventory: city._sceneData.buildings === data.buildings,
        vertices: city._terrainVertexCount,
      });
    }
    const selectedSatellite = city._activeSettlement.id;
    city.setSceneData({ ...city._sceneData, colony: { ...data.colony, population: 1000000, owner_id: 999 } });
    city.render(0.016);
    const growth = city._surfacePlan.settlements.length > anchors.length;
    const stable = JSON.stringify(city._surfacePlan.settlements.slice(0, anchors.length)
      .map(site => ({ id: site.id, direction: site.direction }))) === JSON.stringify(anchors);
    const satellitePreserved = city._activeSettlement.id === selectedSatellite && city._slots.length === 0;
    city.selectSettlement(primary);
    city.render(0.016);
    const buildingsPreserved = JSON.stringify(city._slots.map(slot => slot.key)) === JSON.stringify(keys)
      && city._slots.length === data.buildings.length;
    city.selectSettlement(anchors[1].id);
    city.render(0.016);
    await device.queue.onSubmittedWorkDone();
    const validation = await device.popErrorScope();
    window.satelliteVisualFixture = { orbit, city, device, resources };
    return { errors, validation: validation?.message || null, samePlan, sharedRoads, primaryAligned, growth, stable, buildingsPreserved,
      satelliteVisits, satellitePreserved, settlements: anchors.length, allocations: resources.length };
  });
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(result, 'GPU validation must not be skipped').not.toBeNull();
  test.skip(!result, 'No WebGPU adapter available locally');
  try {
    await page.getByText('Kolonieoberfläche', { exact: true }).click();
    const selector = page.getByLabel('Siedlungsstandort');
    await expect(selector).toBeEnabled();
    const satelliteId = await page.evaluate(() => window.satelliteVisualFixture.city._surfacePlan.settlements[2].id);
    await selector.selectOption(satelliteId);
    await expect(selector.locator('option:checked')).toContainText('Agriculture');
    await page.evaluate(() => window.satelliteVisualFixture.city.render(0.016));
    await expect(page.getByRole('region', { name: 'Colony surface simulation' })).toContainText('no additional production');
    const inspection = page.getByRole('region', { name: 'Selected settlement region', exact: true });
    await expect(inspection).toContainText('Satellite 2 — regional inspection');
    await expect(inspection).toContainText('Visual land-use mix');
    await expect(inspection).toContainText('no regional totals are simulated');
    await expect(inspection).toContainText('Disabled by reduced-motion or VFX settings');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      const { city } = window.satelliteVisualFixture;
      city.setSceneData({ ...city._sceneData, reduced_motion: false });
      city.render(0.016);
    });
    await expect(inspection).toContainText('Decorative convoy markers only');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.satelliteVisualFixture.city.render(0.016));
    await expect(inspection).toContainText('Disabled by reduced-motion or VFX settings');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.getByRole('button', { name: 'Focus building', exact: true })).toBeDisabled();
    await page.getByText('Kolonieoberfläche', { exact: true }).click();
    await page.evaluate(() => window.satelliteVisualFixture.city.render(0.016));
    await page.locator('canvas').screenshot({ path: testInfo.outputPath('satellite-city.png') });
    await page.evaluate(() => {
      const { city } = window.satelliteVisualFixture;
      city.setSceneData({ ...city._sceneData, colony: { ...city._sceneData.colony, population: 1000 },
        body_development: { body_id: 12, version: 1, founded_count: 10, peak_population: 1000000 } });
      city.render(0.016);
    });
    await page.getByText('Kolonieoberfläche', { exact: true }).click();
    await selector.selectOption({ label: 'Satellite 2 (ruins)' });
    await page.evaluate(() => window.satelliteVisualFixture.city.render(0.016));
    await expect(page.getByRole('region', { name: 'Colony surface simulation' })).toContainText('Abandoned settlement ruins');
    await expect(inspection).toContainText('Ruins — no inhabitants or production');
    await expect(inspection).toContainText('No active economic land use');
    await expect(inspection).toContainText('(abandoned route)');
    await expect(inspection).not.toContainText('Decorative convoy markers only');
    expect(await page.evaluate(() => {
      const { city } = window.satelliteVisualFixture;
      return city._activeSettlement.ruined && city._city.ruined && city._slots.length === 0 && city._people.length === 0;
    })).toBe(true);
    await page.getByText('Kolonieoberfläche', { exact: true }).click();
    await page.locator('canvas').screenshot({ path: testInfo.outputPath('satellite-ruins.png') });
  } finally {
    result.destroyedOnce = await page.evaluate(async () => {
      const { orbit, city, device, resources } = window.satelliteVisualFixture;
      orbit.dispose();
      city.dispose();
      const destroyedOnce = resources.every(resource => resource.destroys === 1);
      const probe = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(probe, 0, new Uint32Array([1]));
      await device.queue.onSubmittedWorkDone();
      probe.destroy();
      device.destroy();
      delete window.satelliteVisualFixture;
      return destroyedOnce;
    });
  }
  expect(result).toMatchObject({
    errors: [], validation: null, samePlan: true, sharedRoads: true, primaryAligned: true, growth: true, stable: true,
    buildingsPreserved: true, destroyedOnce: true, satellitePreserved: true, settlements: 6,
  });
  expect(result.satelliteVisits).toHaveLength(4);
  for (const visit of result.satelliteVisits) {
    expect(visit).toMatchObject({
      selected: true, aligned: true, decorative: true, slots: 0, people: 0, inventory: true, progress: 1,
    });
    expect(visit.parts).toBeGreaterThan(100);
    expect(visit.parts).toBeLessThan(512);
    expect(visit.vertices).toBeGreaterThan(0);
  }
  expect(result.allocations).toBeGreaterThan(10);
});

test('orbital city markers rotate, occlude, resize and visit the picked satellite through the authorized loader', async ({ page }, testInfo) => {
  const initialized = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter({ forceFallbackAdapter: true })
      || await navigator.gpu?.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const resources = [];
    for (const method of ['createBuffer', 'createTexture']) {
      const create = device[method].bind(device);
      device[method] = descriptor => {
        const resource = create(descriptor);
        const entry = { destroys: 0 };
        resources.push(entry);
        const destroy = resource.destroy.bind(resource);
        resource.destroy = () => { entry.destroys++; destroy(); };
        return resource;
      };
    }
    const errors = [];
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    device.pushErrorScope('validation');
    const { createGameColonyZoom } = await import('/js/rendering/game-colony-zoom.js');
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
    const hooks = new Set();
    const backend = {
      device, context, externalCameraControls: true, getCapabilities: () => ({ webgpu: true }),
      addFrameHook(hook) { hooks.add(hook); return () => hooks.delete(hook); },
      setZoomSceneActive() {},
    };
    const data = {
      reduced_motion: true, colony: { id: 8, name: 'Orbital settlement fixture', population: 40000, diameter_km: 12742 },
      buildings: [{ type: 'farm', level: 4 }, { type: 'metal_mine', level: 2 }],
      bodyTerrainManifest: {
        body_id: 12, generator_version: 1, projection: 'cube-sphere', seed: 35, biome: 'terran',
        radius_km: 6371, amplitude_km: 8, height_min_km: -16, height_max_km: 16, sea_level_km: -8,
        max_lod: 14, resolution: 17, tile_encoding: 'uint16-json',
      },
    };
    let loads = 0;
    const runtime = await createGameColonyZoom({
      renderer: { getSharedZoomBackend: () => backend }, canvas,
      getCameraState: () => ({ position: { x: 0, y: 0, z: 3 }, target: { x: 0, y: 0, z: 0 } }),
      onLevel() {}, onReturn() {}, onError(error) { errors.push(error.message); },
      onSettlement(id) {
        window.orbitalFixture.pending = runtime.surface(async () => {
          loads++;
          return data;
        }, id);
      },
    });
    await runtime.approach(data);
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    const tick = () => [...hooks].forEach(hook => hook(0));
    tick();
    const orbit = zoom._active;
    const site = orbit._surfacePlan.settlements.find((site, index) => index > 0 && Math.abs(site.direction[1]) < 0.75);
    if (!site) throw new Error('The fixture has no low-latitude satellite');
    const rotation = Math.atan2(site.direction[0], site.direction[2]);
    orbit._rotation = rotation;
    tick();
    const button = orbit._settlementMarkers.get(site.id);
    const name = button?.getAttribute('aria-label');
    const visible = button && !button.hidden && !button.disabled;
    orbit._rotation += Math.PI;
    tick();
    const rearHidden = button.hidden && !orbit._projectedSettlements.some(marker => marker.id === site.id);
    orbit._rotation = rotation;
    canvas.width = 1280;
    canvas.height = 960;
    canvas.style.width = '640px';
    canvas.style.height = '480px';
    canvas.parentElement.style.width = '640px';
    canvas.parentElement.style.height = '480px';
    tick();
    const rect = button.getBoundingClientRect();
    const picksResized = runtime.pickSettlement(rect.left + rect.width / 2, rect.top + rect.height / 2) === site.id;
    window.orbitalFixture = { runtime, zoom, tick, device, resources, errors, site, button, data, loads: () => loads };
    return { name, visible, rearHidden, picksResized, roads: orbit._surfacePlan.roads.length };
  });
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(initialized, 'GPU validation must not be skipped').not.toBeNull();
  test.skip(!initialized, 'No WebGPU adapter available locally');
  let final;
  try {
    expect(initialized).toMatchObject({ visible: true, rearHidden: true, picksResized: true });
    expect(initialized.roads).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: initialized.name, exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('orbital-settlements.png') });
    await page.getByRole('button', { name: initialized.name, exact: true }).click();
    const landed = await page.evaluate(async () => {
      const fixture = window.orbitalFixture;
      await fixture.pending;
      const city = fixture.zoom._active;
      const aligned = JSON.stringify(city._bodySurface.terrain.shape.frame[1]) === JSON.stringify(fixture.site.direction);
      const result = {
        level: fixture.runtime.getStats().level, selected: city._activeSettlement.id === fixture.site.id,
        decorative: city._city.decorative, aligned, buildings: city._sceneData.buildings === fixture.data.buildings,
        slots: city._slots.length, loads: fixture.loads(), oldMarkersRemoved: !fixture.button.isConnected,
      };
      fixture.runtime.back();
      return result;
    });
    expect(landed).toEqual({ level: 3, selected: true, decorative: true, aligned: true,
      buildings: true, slots: 0, loads: 1, oldMarkersRemoved: true });
    await expect.poll(() => page.evaluate(() => window.orbitalFixture.runtime.getStats().level)).toBe(2);
    const returned = await page.evaluate(() => {
      const fixture = window.orbitalFixture;
      fixture.tick();
      fixture.button.click();
      return { loads: fixture.loads(), markers: fixture.zoom._active._projectedSettlements.length };
    });
    expect(returned.loads).toBe(1);
    expect(returned.markers).toBeGreaterThan(0);
  } finally {
    final = await page.evaluate(async () => {
      const fixture = window.orbitalFixture;
      await fixture.device.queue.onSubmittedWorkDone();
      const validation = await fixture.device.popErrorScope();
      fixture.runtime.dispose();
      const result = { validation: validation?.message || null, errors: fixture.errors,
        destroyedOnce: fixture.resources.every(resource => resource.destroys === 1),
        markersRemoved: !document.querySelector('[data-settlement-id]') };
      fixture.device.destroy();
      delete window.orbitalFixture;
      return result;
    });
  }
  expect(final).toEqual({ validation: null, errors: [], destroyedOnce: true, markersRemoved: true });
});

test('disposal during lazy surface-module loading cannot allocate late GPU resources', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/js/rendering/colony-surface-plan.js', async route => {
    requests++;
    await gate;
    await route.fulfill({ contentType: 'application/javascript',
      body: await fs.readFile(path.join(__dirname, '../../js/rendering/colony-surface-plan.js'), 'utf8') });
  });
  await page.evaluate(async () => {
    await import('/js/engine/zoom/IZoomLevelRenderer.js');
    await import('/js/rendering/body-material.js');
    await import('/js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
    await import('/js/engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js');
    const allocations = [];
    const backend = {
      device: {
        createShaderModule: () => ({}),
        createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
        createBuffer: descriptor => {
          const resource = { ...descriptor, destroys: 0, destroy() { this.destroys++; } };
          allocations.push(resource);
          return resource;
        },
      },
      context: {},
    };
    const levels = [
      new window.GQColonySurfaceLevelWebGPU.ColonySurfaceLevelWebGPU(),
      new window.GQPersistentBodyPlanetApproach.PersistentBodyPlanetApproachRenderer(),
    ];
    const pending = Promise.all(levels.map(level => level.initialize(document.querySelector('canvas'), backend)));
    window.lazySurfaceTest = { levels, pending, allocations };
  });
  try {
    await expect.poll(() => requests).toBe(1);
    const before = await page.evaluate(() => {
      window.lazySurfaceTest.levels.forEach(level => level.dispose());
      return window.lazySurfaceTest.allocations.length;
    });
    release();
    const after = await page.evaluate(async () => {
      const state = window.lazySurfaceTest;
      await state.pending;
      return { allocations: state.allocations.length, destroyedOnce: state.allocations.every(resource => resource.destroys === 1) };
    });
    expect(after).toEqual({ allocations: before, destroyedOnce: true });
  } finally { release(); }
});
