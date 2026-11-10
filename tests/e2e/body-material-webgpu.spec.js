const { test, expect } = require('@playwright/test');
const { resolveBodyMaterial, materialUniforms, linearToSrgb, shader } = require('../../js/rendering/body-material.js');

test('procedural PBR filters physical detail and converges to a linear-derived point color', async ({ page }) => {
  await page.route('http://localhost/body-material-test', (route) => route.fulfill({
    contentType: 'text/html', body: '<html><body></body></html>',
  }));
  await page.goto('http://localhost/body-material-test');
  const available = await page.evaluate(async () => !!navigator.gpu
    && !!(await navigator.gpu.requestAdapter({ forceFallbackAdapter: true }) || await navigator.gpu.requestAdapter()));
  test.skip(!available, 'No WebGPU adapter available');
  const source = shader(`
@group(0) @binding(0) var<uniform> parameters: vec4<f32>;
struct Out { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> Out {
  let point = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[index];
  var out: Out;
  out.position = vec4<f32>(point,0,1);
  out.uv = point;
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let point = vec3<f32>(in.uv * 0.03,1);
  let meters = vec3<f32>(in.uv * parameters.z + parameters.xy,0);
  let surface = gqSurface(point,meters,vec3<f32>(0,0,1),-1.0);
  if (parameters.w > 0.5 && parameters.w < 1.5) { return vec4<f32>(surface.normal * 0.5 + 0.5,surface.roughness); }
  var direct = gqDirect(surface,vec3<f32>(0,0,1),normalize(vec3<f32>(-0.7,0.8,1)),vec3<f32>(2.8));
  if (parameters.w > 1.5) {
    direct = gqDirectF0(surface,vec3<f32>(0,0,1),normalize(vec3<f32>(-0.7,0.8,1)),vec3<f32>(2.8),
      vec3<f32>(select(0.04,0.02,parameters.w > 2.5)));
  }
  let color = surface.albedo * 0.3 + direct;
  return vec4<f32>(gqFinish(color),1);
}
`);
  const material = resolveBodyMaterial({}, { biome: 'ice', seed: 35, radius_km: 6 });
  const result = await page.evaluate(async ({ source, material, uniforms }) => {
    const adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true }) || await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const errors = [];
    device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code: source });
    const pipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    const materialBuffer = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const parameters = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bindings = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: parameters } }, { binding: 2, resource: { buffer: materialBuffer } },
      ],
    });
    const target = device.createTexture({
      size: [64, 64], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({ size: 64 * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const render = async (pixels, span = 2, diagnostic = 0, offset = 0, normals = material.normalStrength, origin = 0) => {
      const data = new Float32Array(uniforms);
      data[14] = pixels;
      data[15] = normals;
      new Int32Array(data.buffer).set([origin, origin, 0], 24);
      device.queue.writeBuffer(materialBuffer, 0, data);
      device.queue.writeBuffer(parameters, 0, new Float32Array([offset, offset, span, diagnostic]));
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
      const bytes = new Uint8Array(readback.getMappedRange()).slice();
      readback.unmap();
      return Array.from(bytes);
    };
    const point = await render(1), pointBoundary = await render(2), transition = await render(2.01);
    const near = await render(1000), repeat = await render(1000), distant = await render(1000, 2, 0, 128);
    const defaultF0 = await render(1000, 2, 2), waterF0 = await render(1000, 2, 3);
    const rebased = await render(1000, 2, 0, 128, material.normalStrength, -1);
    const positiveRebase = await render(1000, 2, 0, -128, material.normalStrength, 1);
    const planetaryOrigin = await render(1000, 2, 0, 0, material.normalStrength, -49774);
    const planetaryRebase = await render(1000, 2, 0, 128, material.normalStrength, -49775);
    const normals = await render(1000, 2, 1), flat = await render(1000, 2, 1, 0, 0);
    const minified = await render(1000, 4096, 1), minifiedFlat = await render(1000, 4096, 1, 0, 0);
    const scoped = await device.popErrorScope();
    for (const resource of [materialBuffer, parameters, readback, target]) resource.destroy();
    device.destroy();
    return { point, pointBoundary, transition, near, repeat, defaultF0, waterF0, distant, rebased, positiveRebase, planetaryOrigin, planetaryRebase, normals, flat, minified, minifiedFlat, errors, scoped: scoped?.message || null };
  }, { source, material, uniforms: Array.from(materialUniforms(material, 1)) });
  expect(result.errors).toEqual([]);
  expect(result.scoped).toBeNull();
  const expected = material.mean.map((n) => Math.round(linearToSrgb(n * 0.8) * 255));
  for (let index = 0; index < result.point.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) expect(Math.abs(result.point[index + channel] - expected[channel])).toBeLessThanOrEqual(1);
  }
  const maxDifference = (a, b) => a.reduce((max, n, index) => Math.max(max, Math.abs(n - b[index])), 0);
  expect(result.pointBoundary).toEqual(result.point);
  expect(maxDifference(result.transition, result.point)).toBeLessThanOrEqual(1);
  expect(result.repeat).toEqual(result.near);
  expect(result.defaultF0).toEqual(result.near);
  expect(maxDifference(result.waterF0, result.near)).toBeGreaterThan(0);
  expect(maxDifference(result.distant, result.near)).toBeGreaterThan(10);
  expect(maxDifference(result.rebased, result.near)).toBeLessThanOrEqual(2);
  expect(maxDifference(result.positiveRebase, result.near)).toBeLessThanOrEqual(2);
  expect(maxDifference(result.planetaryRebase, result.planetaryOrigin)).toBeLessThanOrEqual(2);
  expect(maxDifference(result.near, result.point)).toBeGreaterThan(10);
  expect(maxDifference(result.normals, result.flat)).toBeGreaterThan(10);
  expect(result.minified).toEqual(result.minifiedFlat);
});
