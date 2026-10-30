import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveBloom } from '../../js/rendering/space-bloom.js';

describe('PerspectiveBloom', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts bright HDR pixels, blurs in both axes and composites to the canvas format', async () => {
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 4, COPY_DST: 8 });
    const textures = [];
    const pipelines = [];
    const passes = [];
    const device = {
      createShaderModule: vi.fn((descriptor) => ({ code: descriptor.code })),
      createRenderPipeline: vi.fn((descriptor) => {
        const pipeline = { descriptor, getBindGroupLayout: () => ({}) };
        pipelines.push(pipeline);
        return pipeline;
      }),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createTexture: vi.fn((descriptor) => {
        const texture = { descriptor, createView: vi.fn(() => ({ texture })), destroy: vi.fn() };
        textures.push(texture);
        return texture;
      }),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn((descriptor) => descriptor),
      queue: { writeBuffer: vi.fn() },
    };
    const encoder = { beginRenderPass: vi.fn((descriptor) => {
      const pass = { descriptor, setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
      passes.push(pass);
      return pass;
    }) };
    const bloom = new PerspectiveBloom();
    await bloom.initialize(device, 'bgra8unorm', 'threshold/blur WGSL', 'composite WGSL');
    bloom.resize(1280, 720);
    expect(bloom.sceneTexture.descriptor).toMatchObject({ size: [1280, 720], format: 'rgba16float' });
    expect(bloom.brightTexture.descriptor.size).toEqual([640, 360]);
    expect(pipelines.map((pipeline) => pipeline.descriptor.fragment.entryPoint))
      .toEqual(['fs_threshold', 'fs_blur', 'fs_main']);

    bloom.encode(encoder, { canvas: true });

    expect(passes).toHaveLength(4);
    expect(passes.map((pass) => pass.draw.mock.calls.length)).toEqual([1, 1, 1, 1]);
    expect(passes.at(-1).descriptor.colorAttachments[0].view).toEqual({ canvas: true });
    expect(device.queue.writeBuffer.mock.calls[3][2][0]).toBeCloseTo(0.48);
    expect(device.queue.writeBuffer.mock.calls[3][2][1]).toBe(1);
    expect(device.queue.writeBuffer.mock.calls[1][2][3]).toBe(1);
    expect(device.queue.writeBuffer.mock.calls[2 + 1][2][3]).toBe(0);

    bloom.resize(390, 844);
    expect(textures.slice(0, 3).every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(bloom.brightTexture.descriptor.size).toEqual([195, 422]);
    bloom.dispose();
    expect(textures.slice(3).every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('keeps the SDR fallback in canvas range without ACES remapping', async () => {
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 4, COPY_DST: 8 });
    const buffers = [];
    const device = {
      createShaderModule: () => ({}),
      createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
      createBuffer: () => { const buffer = { destroy: vi.fn() }; buffers.push(buffer); return buffer; },
      createTexture: () => ({ createView: () => ({}), destroy: vi.fn() }),
      createSampler: () => ({}), createBindGroup: () => ({}), queue: { writeBuffer: vi.fn() },
    };
    const bloom = new PerspectiveBloom();
    await bloom.initialize(device, 'bgra8unorm', 'threshold/blur WGSL', 'composite WGSL', 'bgra8unorm');
    expect(buffers[2]).toBeDefined();
    expect(device.queue.writeBuffer.mock.calls[3][2][1]).toBe(0);
    bloom.dispose();
  });
});
