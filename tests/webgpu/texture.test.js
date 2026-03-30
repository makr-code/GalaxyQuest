/**
 * tests/webgpu/texture.test.js
 *
 * Tests for WebGPUTexture — construction, views, data upload, cubemap.
 * Uses a mocked GPUDevice (no real GPU required).
 */

import { describe, it, expect, vi } from 'vitest';
import { WebGPUTexture } from '../../js/engine/webgpu/WebGPUTexture.js';

// ---------------------------------------------------------------------------
// Mock GPUDevice
// ---------------------------------------------------------------------------

function makeSampler()  { return { _type: 'sampler' }; }
function makeView(opts) { return { _type: 'view', opts }; }
function makeTexture(spec) {
  const t = {
    ...spec,
    _destroyed: false,
    destroy: vi.fn(function() { this._destroyed = true; }),
    createView: vi.fn((opts = {}) => makeView(opts)),
  };
  return t;
}

function makeMockDevice() {
  return {
    createTexture:  vi.fn((spec) => makeTexture(spec)),
    createSampler:  vi.fn(() => makeSampler()),
    queue: {
      copyExternalImageToTexture: vi.fn(),
      writeTexture:               vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------

describe('WebGPUTexture', () => {
  it('creates a 2D texture with correct dimensions', () => {
    const device = makeMockDevice();
    const tex = new WebGPUTexture(device, { width: 256, height: 256 });
    expect(tex.width).toBe(256);
    expect(tex.height).toBe(256);
    expect(tex.isCubemap).toBe(false);
    expect(device.createTexture).toHaveBeenCalledOnce();
  });

  it('creates a sampler', () => {
    const device = makeMockDevice();
    const tex = new WebGPUTexture(device, { width: 128, height: 128 });
    expect(tex.sampler).toBeDefined();
    expect(device.createSampler).toHaveBeenCalledOnce();
  });

  it('sets depth=6 for cubemap', () => {
    const device = makeMockDevice();
    const tex = new WebGPUTexture(device, { width: 64, height: 64, cubemap: true });
    expect(tex.depth).toBe(6);
    expect(tex.isCubemap).toBe(true);
  });

  it('createView passes cubemap dimension for cubemap texture', () => {
    const device = makeMockDevice();
    const tex  = new WebGPUTexture(device, { width: 64, height: 64, cubemap: true });
    const view = tex.createView();
    expect(view.opts.dimension).toBe('cube');
  });

  it('uploadData calls queue.writeTexture', () => {
    const device = makeMockDevice();
    const tex  = new WebGPUTexture(device, { width: 4, height: 4 });
    const data = new Uint8Array(4 * 4 * 4);
    tex.uploadData(data);
    expect(device.queue.writeTexture).toHaveBeenCalledOnce();
  });

  it('destroy() calls GPU texture destroy', () => {
    const device = makeMockDevice();
    const tex = new WebGPUTexture(device, { width: 16, height: 16 });
    tex.destroy();
    expect(tex.gpuTexture._destroyed).toBe(true);
  });

  it('mipLevelCount > 1 when mipMaps=true', () => {
    const device = makeMockDevice();
    new WebGPUTexture(device, { width: 256, height: 256, mipMaps: true });
    const callArg = device.createTexture.mock.calls[0][0];
    expect(callArg.mipLevelCount).toBeGreaterThan(1);
  });
});
