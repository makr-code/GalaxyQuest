const { test, expect } = require('@playwright/test');
const { PLANET_APPROACH_WGSL } = require('../../js/engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js');

test('production planet normals remain unit length from orbit to metre detail and degenerate derivatives stay finite', async ({ page }) => {
  await page.route('**/normal-scale-probe', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Planet normal scale probe</title>',
  }));
  await page.goto('/normal-scale-probe');
  const fragment = PLANET_APPROACH_WGSL.slice(PLANET_APPROACH_WGSL.indexOf('@fragment fn fs_main'),
    PLANET_APPROACH_WGSL.indexOf('  let inverse = transpose'));
  const result = await page.evaluate(async fragment => {
    const adapter = await navigator.gpu?.requestAdapter({ forceFallbackAdapter: true })
      || await navigator.gpu?.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    device.pushErrorScope('validation');
    const shader = device.createShaderModule({ code: `
struct Params { animation: vec4<f32>, scale: vec4<f32> };
@group(0) @binding(0) var<uniform> u: Params;
struct Out { @builtin(position) position: vec4<f32>, @location(0) world: vec3<f32>, @location(1) normal: vec3<f32> };
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> Out {
  let p = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[index];
  var out: Out;
  out.position = vec4<f32>(p,0,1);
  out.world = vec3<f32>(p.x,p.y,p.x * 0.4 - p.y * 0.2) * u.scale.x;
  out.normal = normalize(vec3<f32>(-0.4,0.2,1.0));
  return out;
}
${fragment}
  return vec4<f32>(normal,length(normal));
}` });
    const pipeline = device.createRenderPipeline({ layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs_main' },
      fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format: 'rgba32float' }] } });
    const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const texture = device.createTexture({ size: [8, 8], format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const output = device.createBuffer({ size: 256 * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: params } },
    ] });
    const samples = [];
    for (const scale of [0.1, 0.001, 0.00001, 0.0000001, 0]) {
      device.queue.writeBuffer(params, 0, new Float32Array([0, 0, 0, 0, scale, 0, 0, 0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(3); pass.end();
      encoder.copyTextureToBuffer({ texture }, { buffer: output, bytesPerRow: 256 }, [8, 8]);
      device.queue.submit([encoder.finish()]);
      await output.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(output.getMappedRange());
      samples.push(Array.from(data.slice(3 * 64 + 3 * 4, 3 * 64 + 3 * 4 + 4)));
      output.unmap();
    }
    const validation = await device.popErrorScope();
    [params, texture, output].forEach(resource => resource.destroy());
    device.destroy();
    return { samples, validation: validation?.message || null };
  }, fragment);
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(result).not.toBeNull();
  test.skip(!result, 'No WebGPU adapter available locally');
  expect(result.validation).toBeNull();
  const expected = [-0.4, 0.2, 1].map(n => n / Math.hypot(-0.4, 0.2, 1));
  for (const sample of result.samples) {
    expect(sample.every(Number.isFinite)).toBe(true);
    expect(sample[3]).toBeCloseTo(1, 5);
    for (let i = 0; i < 3; i++) expect(sample[i]).toBeCloseTo(expected[i], 5);
  }
});
