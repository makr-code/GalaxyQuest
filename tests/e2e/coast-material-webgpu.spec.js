const { test, expect } = require('@playwright/test');
const material = require('../../js/rendering/body-material.js');

test('signed terrain boundaries produce pixel-wide coasts at the true sea level without phantom ice', async ({ page }) => {
  await page.route('http://localhost:8080/coast-material', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><canvas></canvas>',
  }));
  await page.goto('http://localhost:8080/coast-material');
  const shader = material.shader(`
struct Parameters { levels: vec4<f32>, slope: vec4<f32> };
@group(0) @binding(0) var<uniform> parameters: Parameters;
struct Out { @builtin(position) position: vec4<f32>, @location(0) boundaries: vec4<f32> };
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> Out {
  let point = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[index];
  let uv = point * 0.5 + 0.5;
  var out: Out;
  out.position = vec4<f32>(point,0,1);
  out.boundaries = vec4<f32>((uv - parameters.levels.xy) * parameters.slope.xy + parameters.slope.zw,
    parameters.levels.zw);
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  return vec4<f32>(gqTerrainMasks(in.boundaries),1);
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
    const parameters = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: parameters } }] });
    const texture = device.createTexture({
      size: [128, 64], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({ size: 512 * 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    async function render(sea, snow, liquid = 1, frozen = 0, slope = [1, 1, 0, 0]) {
      device.queue.writeBuffer(parameters, 0, new Float32Array([sea, snow, liquid, frozen, ...slope]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: texture.createView(), loadOp: 'clear', storeOp: 'store',
      }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: 512 }, [128, 64]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const pixels = Array.from(new Uint8Array(readback.getMappedRange()));
      readback.unmap();
      return pixels;
    }
    const coasts = [];
    for (const sea of [0.25, 0.503, 0.75]) coasts.push(await render(sea, 2));
    const repeat = await render(0.503, 2);
    const mixed = await render(0.503, 0.5, 1, 1);
    const lava = await render(0.503, 2, 3);
    const rock = await render(0.503, 0.5, 0, 0);
    const flat = await render(0, 0, 1, 1, [0, 0, 0, 0]);
    const submerged = await render(0, 0, 1, 1, [0, 0, -1, 1]);
    const snow = await render(0, 0, 1, 1, [0, 0, 1, 1]);
    const validation = await device.popErrorScope();
    [parameters, texture, readback].forEach(resource => resource.destroy());
    device.destroy();
    return { errors, validation: validation?.message || null, coasts, repeat, mixed, lava, rock, flat, submerged, snow };
  }, shader);
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(result, 'Actual GPU coast test must run').not.toBeNull();
  test.skip(!result, 'No WebGPU adapter available locally');
  expect(result.errors).toEqual([]);
  expect(result.validation).toBeNull();
  expect(result.repeat).toEqual(result.coasts[1]);
  for (const [index, sea] of [0.25, 0.503, 0.75].entries()) {
    const row = Array.from({ length: 128 }, (_, x) => result.coasts[index][(32 * 128 + x) * 4]);
    expect(row.filter(n => n > 0 && n < 255).length).toBeLessThanOrEqual(2);
    expect(Math.abs(row.filter(n => n >= 128).length - sea * 128)).toBeLessThan(1);
    expect(row[0]).toBe(255);
    expect(row[127]).toBe(0);
    expect(result.coasts[index].every((n, i) => i % 4 === 1 || i % 4 === 2 ? n === 0 : true)).toBe(true);
  }
  for (let pixel = 0; pixel < 128 * 64; pixel++) {
    const offset = pixel * 4;
    expect(result.mixed[offset] + result.mixed[offset + 1]).toBeLessThanOrEqual(256);
    expect(result.lava[offset + 2]).toBe(result.coasts[1][offset]);
    expect(result.lava[offset]).toBe(0);
    expect(result.lava[offset + 1]).toBe(0);
  }
  expect(result.rock.every((n, i) => i % 4 === 3 ? n === 255 : n === 0)).toBe(true);
  expect(result.flat).toEqual(result.rock);
  expect(result.submerged.every((n, i) => n === (i % 4 === 0 || i % 4 === 3 ? 255 : 0))).toBe(true);
  expect(result.snow.every((n, i) => n === (i % 4 === 1 || i % 4 === 3 ? 255 : 0))).toBe(true);
});

test('water waves and lava glow loop with filtered detail and isolated material responses', async ({ page }) => {
  await page.route('http://localhost:8080/coast-material', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><canvas></canvas>',
  }));
  await page.goto('http://localhost:8080/coast-material');
  const shader = material.shader(`
@group(0) @binding(0) var<uniform> masks: vec4<f32>;
struct Out { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> Out {
  let point = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[index];
  var out: Out;
  out.position = vec4<f32>(point,0,1);
  out.uv = point * 0.5 + 0.5;
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let normal = normalize(vec3<f32>(0.2,0.3,1));
  let meters = vec3<f32>(in.uv.x * 4.0 * masks.w,0.3,0.37)
    - gqMaterial.anchor.xyz - vec3<f32>(gqMaterial.origin.xyz) * 128.0;
  let base = gqSurface(vec3<f32>(in.uv.x,0.4,1),meters,normal,0.0);
  let terrain = gqTerrainSurface(base,masks.xyz,normal);
  let water = gqWaterSurface(terrain,masks.x,meters,normal);
  let surface = gqLavaSurface(water,masks.z,meters,normal);
  if (in.position.y < 1.0) { return vec4<f32>(surface.normal,surface.roughness); }
  if (in.position.y < 2.0) { return vec4<f32>(surface.albedo,surface.metallic); }
  return vec4<f32>(surface.emission,length(surface.normal));
}`);
  const uniforms = Array.from(material.materialUniforms(
    material.resolveBodyMaterial({}, { biome: 'terran', seed: 35, radius_km: 6371 }), 1000));
  const result = await page.evaluate(async ({ shader, uniforms }) => {
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
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: 'rgba32float' }] },
    });
    const masks = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const materialBuffer = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(materialBuffer, 0, new Float32Array(uniforms));
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: masks } },
      { binding: 2, resource: { buffer: materialBuffer } },
    ] });
    const texture = device.createTexture({
      size: [16, 3], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({ size: 768, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    async function render(values, seconds = 0, enabled = false, scale = 1, pixels = 1000, anchor = [0, 0, 0], seed = uniforms[12]) {
      const state = new Float32Array(uniforms);
      state[23] = seconds % 120;
      state[14] = pixels;
      state[12] = seed;
      anchor.forEach((value, axis) => {
        new Int32Array(state.buffer)[24 + axis] = Math.floor(value / 128);
        state[20 + axis] = value - Math.floor(value / 128) * 128;
      });
      new Int32Array(state.buffer)[27] = enabled ? 1 : 0;
      device.queue.writeBuffer(materialBuffer, 0, state);
      device.queue.writeBuffer(masks, 0, new Float32Array([...values, scale]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: texture.createView(), loadOp: 'clear', storeOp: 'store',
      }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: 256 }, [16, 3]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const valuesRead = Array.from(new Float32Array(readback.getMappedRange()));
      readback.unmap();
      return valuesRead;
    }
    const dry = await render([0, 0, 0]);
    const water = await render([1, 0, 0]);
    const edge = await render([0.5, 0, 0]);
    const ice = await render([0, 1, 0]);
    const lava = await render([0, 0, 1]);
    const repeat = await render([1, 0, 0]);
    const moving = await render([1, 0, 0], 5, true);
    const later = await render([1, 0, 0], 15, true);
    const loop = await render([1, 0, 0], 125, true);
    const frozen = await render([1, 0, 0], 15, true);
    const disabled = await render([1, 0, 0], 15, false);
    const distant = await render([1, 0, 0], 15, true, 1, 100);
    const unresolved = await render([1, 0, 0], 15, true, 100);
    const dryMoving = await render([0, 0, 0], 15, true);
    const iceMoving = await render([0, 1, 0], 15, true);
    const lavaMoving = await render([0, 0, 1], 5, true);
    const lavaLater = await render([0, 0, 1], 25, true);
    const lavaRepeat = await render([0, 0, 1], 5, true);
    const lavaLoop = await render([0, 0, 1], 125, true);
    const lavaDisabled = await render([0, 0, 1], 25);
    const lavaDistant = await render([0, 0, 1], 25, true, 1, 24);
    const lavaDistantStill = await render([0, 0, 1], 25, false, 1, 24);
    const lavaUnresolved = await render([0, 0, 1], 25, true, 100);
    const lavaUnresolvedStill = await render([0, 0, 1], 25, false, 100);
    const lavaBeforeLoop = await render([0, 0, 1], 119.999, true);
    const lavaAfterLoop = await render([0, 0, 1], 0.001, true);
    const lavaAnchored = await render([0, 0, 1], 5, true, 1, 1000, [128, -256, 384]);
    const lavaReseeded = await render([0, 0, 1], 5, true, 1, 1000, [0, 0, 0], 0.8125);
    const lavaEdge = await render([0, 0, 0.5], 5, true);
    const lavaEdgeStill = await render([0, 0, 0.5]);
    const beforeLoop = await render([1, 0, 0], 119.999, true);
    const afterLoop = await render([1, 0, 0], 0.001, true);
    const anchored = await render([1, 0, 0], 5, true, 1, 1000, [128, -256, 384]);
    const otherSeed = await render([1, 0, 0], 5, true, 1, 1000, [0, 0, 0], 0.8125);
    const validation = await device.popErrorScope();
    [masks, materialBuffer, readback, texture].forEach(resource => resource.destroy());
    device.destroy();
    return { dry, water, edge, ice, lava, repeat, moving, later, loop, frozen, disabled,
      distant, unresolved, dryMoving, iceMoving, lavaMoving, beforeLoop, afterLoop,
      anchored, otherSeed, lavaLater, lavaRepeat, lavaLoop, lavaDisabled, lavaDistant, lavaDistantStill,
      lavaUnresolved, lavaUnresolvedStill, lavaBeforeLoop, lavaAfterLoop, lavaAnchored, lavaReseeded,
      lavaEdge, lavaEdgeStill, validation: validation?.message || null, errors };
  }, { shader, uniforms });
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(result).not.toBeNull();
  test.skip(!result, 'No WebGPU adapter available locally');
  expect(result.errors).toEqual([]);
  expect(result.validation).toBeNull();
  expect(result.repeat).toEqual(result.water);
  expect(result.moving).toEqual(result.loop);
  expect(result.later).toEqual(result.frozen);
  expect(result.disabled).toEqual(result.water);
  for (const filtered of [result.distant, result.unresolved]) {
    filtered.forEach((value, index) => expect(value).toBeCloseTo(result.water[index], 6));
  }
  expect(result.dryMoving).toEqual(result.dry);
  expect(result.iceMoving).toEqual(result.ice);
  expect(result.lavaMoving).toEqual(result.lavaRepeat);
  expect(result.lavaMoving).toEqual(result.lavaLoop);
  expect(result.lavaDisabled).toEqual(result.lava);
  expect(result.lavaDistant).toEqual(result.lavaDistantStill);
  expect(result.lavaUnresolved).toEqual(result.lavaUnresolvedStill);
  result.lavaBeforeLoop.forEach((value, index) => expect(Math.abs(value - result.lavaAfterLoop[index])).toBeLessThan(0.001));
  result.lavaAnchored.forEach((value, index) => expect(value).toBeCloseTo(result.lavaMoving[index], 5));
  expect(result.lavaReseeded.slice(128)).not.toEqual(result.lavaMoving.slice(128));
  for (const animated of [result.lavaMoving, result.lavaLater]) {
    expect(animated.slice(0, 128)).toEqual(result.lava.slice(0, 128));
    for (let pixel = 0; pixel < 16; pixel++) {
      const offset = 128 + pixel * 4;
      expect(animated[offset]).toBeGreaterThanOrEqual(0.82);
      expect(animated[offset]).toBeLessThanOrEqual(1.18);
      expect(animated[offset + 1]).toBeCloseTo(animated[offset] * 0.08, 6);
      expect(animated[offset + 2]).toBeCloseTo(animated[offset] * 0.005, 6);
      expect(animated[offset + 3]).toBe(result.lava[offset + 3]);
      for (let axis = 0; axis < 3; axis++) {
        expect(result.lavaEdge[offset + axis] - result.lavaEdgeStill[offset + axis])
          .toBeCloseTo((result.lavaMoving[offset + axis] - result.lava[offset + axis]) * 0.5, 6);
      }
    }
  }
  expect(Math.max(...result.lavaMoving.slice(128).map((value, index) =>
    Math.abs(value - result.lavaLater[128 + index])))).toBeGreaterThan(0.01);
  const lavaGlow = result.lavaMoving.slice(128).filter((_value, index) => index % 4 === 0);
  expect(Math.max(...lavaGlow) - Math.min(...lavaGlow)).toBeGreaterThan(0.005);
  result.beforeLoop.forEach((value, index) => expect(Math.abs(value - result.afterLoop[index])).toBeLessThan(0.001));
  result.anchored.forEach((value, index) => expect(value).toBeCloseTo(result.moving[index], 5));
  expect(result.otherSeed.slice(0, 64)).not.toEqual(result.moving.slice(0, 64));
  let movement = 0;
  const normal = [0.2, 0.3, 1].map(value => value / Math.hypot(0.2, 0.3, 1));
  let dryPerturbation = 0;
  for (let pixel = 0; pixel < 16; pixel++) {
    const offset = pixel * 4;
    for (let axis = 0; axis < 3; axis++) {
      movement = Math.max(movement,Math.abs(result.moving[offset + axis] - result.later[offset + axis]));
      expect(Math.abs(result.moving[offset + axis] - normal[axis])).toBeLessThan(0.15);
      expect(Math.abs(result.later[offset + axis] - normal[axis])).toBeLessThan(0.15);
    }
    expect(result.moving[offset + 3]).toBe(result.water[offset + 3]);
    expect(result.moving.slice(64 + offset,64 + offset + 4)).toEqual(result.water.slice(64 + offset,64 + offset + 4));
    result.moving.slice(128 + offset,128 + offset + 4)
      .forEach((value, index) => expect(value).toBeCloseTo(result.water[128 + offset + index], 6));
    const edge = normal.map((value, axis) => (value + result.dry[offset + axis]) * 0.5);
    const edgeLength = Math.hypot(...edge);
    for (let axis = 0; axis < 3; axis++) {
      dryPerturbation = Math.max(dryPerturbation, Math.abs(result.dry[offset + axis] - normal[axis]));
      expect(result.water[offset + axis]).toBeCloseTo(normal[axis], 6);
      expect(result.edge[offset + axis]).toBeCloseTo(edge[axis] / edgeLength, 6);
      expect(result.ice[offset + axis]).toBeCloseTo(result.dry[offset + axis], 6);
      expect(result.lava[offset + axis]).toBeCloseTo(result.dry[offset + axis], 6);
      expect(result.water[64 + offset + axis]).toBeCloseTo(material.srgbToLinear([0.07, 0.28, 0.44][axis]), 6);
      expect(result.edge[64 + offset + axis]).toBeCloseTo(
        (result.dry[64 + offset + axis] + result.water[64 + offset + axis]) * 0.5, 6);
      expect(result.ice[64 + offset + axis]).toBeCloseTo(material.srgbToLinear([0.72, 0.85, 0.91][axis]), 6);
      expect(result.lava[128 + offset + axis]).toBeCloseTo([1, 0.08, 0.005][axis], 6);
      expect(result.water[128 + offset + axis]).toBe(0);
      expect(result.ice[128 + offset + axis]).toBe(0);
    }
    expect(result.water[offset + 3]).toBeCloseTo(0.16, 6);
    expect(result.ice[offset + 3]).toBeCloseTo(0.38, 6);
    expect(result.lava[offset + 3]).toBeCloseTo(result.dry[offset + 3], 6);
    expect(result.edge[offset + 3]).toBeCloseTo((result.dry[offset + 3] + 0.16) * 0.5, 6);
    for (const kind of ['dry', 'water', 'edge', 'ice', 'lava']) {
      expect(result[kind][128 + offset + 3]).toBeCloseTo(1, 6);
      expect(result[kind][64 + offset + 3]).toBe(0);
    }
  }
  expect(dryPerturbation).toBeGreaterThan(0.001);
  expect(movement).toBeGreaterThan(0.005);
});
