/**
 * tests/webgpu/resource-pool.test.js
 *
 * Tests for WebGPUResourcePool:
 *   - acquireBuffer returns pooled buffer on second call
 *   - releaseBuffer: pool evicts when maxPoolSize reached (destroy() is called)
 *   - acquireTexture / releaseTexture mirrors buffer behaviour
 *   - dispose destroys all pooled resources
 *   - size alignment (4-byte)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGPUResourcePool } from '../../js/engine/webgpu/WebGPUResourcePool.js';

// ---------------------------------------------------------------------------
// Mock GPU device
// ---------------------------------------------------------------------------

function makeDevice() {
  return {
    createBuffer:  vi.fn((desc) => ({
      _desc: desc, size: desc.size, destroy: vi.fn(),
    })),
    createTexture: vi.fn((desc) => ({
      _desc: desc, destroy: vi.fn(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Buffer pool
// ---------------------------------------------------------------------------

describe('WebGPUResourcePool — buffers', () => {
  let dev, pool;
  beforeEach(() => {
    dev  = makeDevice();
    pool = new WebGPUResourcePool(dev);
  });

  it('creates a new buffer when pool is empty', () => {
    const buf = pool.acquireBuffer(0x40, 64);
    expect(dev.createBuffer).toHaveBeenCalledOnce();
    expect(buf.size).toBe(64);
  });

  it('returns the same buffer object after release + re-acquire', () => {
    const buf1 = pool.acquireBuffer(0x40, 64);
    pool.releaseBuffer(buf1, 0x40, 64);
    const buf2 = pool.acquireBuffer(0x40, 64);
    expect(buf2).toBe(buf1);
    expect(dev.createBuffer).toHaveBeenCalledOnce(); // only one GPU alloc
  });

  it('aligns sizes to 4 bytes', () => {
    pool.acquireBuffer(0x40, 13);
    // aligned to 16 (next multiple of 4)
    expect(dev.createBuffer).toHaveBeenCalledWith({ size: 16, usage: 0x40 });
  });

  it('treats different sizes as different buckets', () => {
    const a = pool.acquireBuffer(0x40, 64);
    const b = pool.acquireBuffer(0x40, 128);
    expect(a).not.toBe(b);
    expect(dev.createBuffer).toHaveBeenCalledTimes(2);
  });

  it('calls destroy() when pool is full', () => {
    const tinyPool = new WebGPUResourcePool(dev, { maxPoolSize: 1 });
    const b1 = tinyPool.acquireBuffer(0x40, 64);
    const b2 = tinyPool.acquireBuffer(0x40, 64);
    tinyPool.releaseBuffer(b1, 0x40, 64); // fills the pool
    tinyPool.releaseBuffer(b2, 0x40, 64); // pool full → b2.destroy()
    expect(b2.destroy).toHaveBeenCalledOnce();
    expect(b1.destroy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Texture pool
// ---------------------------------------------------------------------------

describe('WebGPUResourcePool — textures', () => {
  let dev, pool;
  beforeEach(() => {
    dev  = makeDevice();
    pool = new WebGPUResourcePool(dev);
  });

  it('creates a new texture when pool is empty', () => {
    pool.acquireTexture('rgba8unorm', 512, 512, 0x10);
    expect(dev.createTexture).toHaveBeenCalledOnce();
  });

  it('returns the same texture after release + re-acquire', () => {
    const t1 = pool.acquireTexture('rgba8unorm', 512, 512, 0x10);
    pool.releaseTexture(t1, 'rgba8unorm', 512, 512, 0x10);
    const t2 = pool.acquireTexture('rgba8unorm', 512, 512, 0x10);
    expect(t2).toBe(t1);
    expect(dev.createTexture).toHaveBeenCalledOnce();
  });

  it('treats different dimensions as different buckets', () => {
    const t1 = pool.acquireTexture('rgba8unorm', 256, 256, 0x10);
    const t2 = pool.acquireTexture('rgba8unorm', 512, 512, 0x10);
    expect(t1).not.toBe(t2);
    expect(dev.createTexture).toHaveBeenCalledTimes(2);
  });

  it('calls destroy() when pool is full', () => {
    const tinyPool = new WebGPUResourcePool(dev, { maxPoolSize: 1 });
    const t1 = tinyPool.acquireTexture('rgba8unorm', 64, 64, 0x10);
    const t2 = tinyPool.acquireTexture('rgba8unorm', 64, 64, 0x10);
    tinyPool.releaseTexture(t1, 'rgba8unorm', 64, 64, 0x10);
    tinyPool.releaseTexture(t2, 'rgba8unorm', 64, 64, 0x10); // overflow
    expect(t2.destroy).toHaveBeenCalledOnce();
    expect(t1.destroy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('WebGPUResourcePool.dispose()', () => {
  it('destroys all pooled buffers and textures', () => {
    const dev  = makeDevice();
    const pool = new WebGPUResourcePool(dev);

    const buf = pool.acquireBuffer(0x40, 64);
    pool.releaseBuffer(buf, 0x40, 64);

    const tex = pool.acquireTexture('rgba8unorm', 64, 64, 0x10);
    pool.releaseTexture(tex, 'rgba8unorm', 64, 64, 0x10);

    pool.dispose();

    expect(buf.destroy).toHaveBeenCalled();
    expect(tex.destroy).toHaveBeenCalled();
    expect(pool._bufferPool.size).toBe(0);
    expect(pool._texturePool.size).toBe(0);
  });
});
