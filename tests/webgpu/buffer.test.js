/**
 * tests/webgpu/buffer.test.js
 *
 * Tests for WebGPUBuffer helpers and BufferType / BufferUsage constants.
 * Runs entirely in Node (no real GPU) using mocked GPUDevice.
 */

import { describe, it, expect, vi } from 'vitest';
import { WebGPUBuffer, BufferType, BufferUsage } from '../../js/engine/webgpu/WebGPUBuffer.js';

// ---------------------------------------------------------------------------
// Mock GPUDevice
// ---------------------------------------------------------------------------

function makeMockDevice() {
  return {
    _buffers: [],
    createBuffer({ size, usage, mappedAtCreation }) {
      const ab   = new ArrayBuffer(size);
      const buf  = {
        size,
        usage,
        _data: ab,
        getMappedRange: () => ab,
        unmap:   vi.fn(),
        destroy: vi.fn(),
        _destroyed: false,
      };
      Object.defineProperty(buf, '_destroyed', { writable: true, value: false });
      buf.destroy = vi.fn(() => { buf._destroyed = true; });
      this._buffers.push(buf);
      return buf;
    },
    queue: { writeBuffer: vi.fn() },
  };
}

// ---------------------------------------------------------------------------

describe('BufferType and BufferUsage constants', () => {
  it('are frozen', () => {
    expect(Object.isFrozen(BufferType)).toBe(true);
    expect(Object.isFrozen(BufferUsage)).toBe(true);
  });

  it('expose expected keys', () => {
    expect(BufferType.VERTEX).toBe('vertex');
    expect(BufferType.INDEX).toBe('index');
    expect(BufferType.UNIFORM).toBe('uniform');
    expect(BufferType.STORAGE).toBe('storage');
    expect(BufferUsage.STATIC).toBe('static');
    expect(BufferUsage.DYNAMIC).toBe('dynamic');
  });
});

describe('WebGPUBuffer', () => {
  it('creates a buffer from a Float32Array', () => {
    const device = makeMockDevice();
    const data   = new Float32Array([1, 2, 3, 4]);
    const buf    = new WebGPUBuffer(device, BufferType.VERTEX, data, BufferUsage.STATIC);

    expect(buf.gpuBuffer).toBeDefined();
    expect(buf.size).toBe(16); // 4 floats × 4 bytes, already 4-aligned
  });

  it('aligns size to 4 bytes', () => {
    const device = makeMockDevice();
    const data   = new Uint8Array([1, 2, 3]); // 3 bytes → should align to 4
    const buf    = new WebGPUBuffer(device, BufferType.UNIFORM, data);
    expect(buf.size % 4).toBe(0);
  });

  it('creates a buffer from a byte size number', () => {
    const device = makeMockDevice();
    const buf    = new WebGPUBuffer(device, BufferType.STORAGE, 100);
    expect(buf.size).toBeGreaterThanOrEqual(100);
    expect(buf.size % 4).toBe(0);
  });

  it('update() calls device.queue.writeBuffer', () => {
    const device = makeMockDevice();
    const buf    = new WebGPUBuffer(device, BufferType.VERTEX, new Float32Array(4), BufferUsage.DYNAMIC);
    const newData = new Float32Array([9, 8, 7, 6]);
    buf.update(newData);
    expect(device.queue.writeBuffer).toHaveBeenCalledOnce();
  });

  it('destroy() destroys the underlying GPU buffer', () => {
    const device = makeMockDevice();
    const buf    = new WebGPUBuffer(device, BufferType.INDEX, new Uint16Array([0, 1, 2]));
    buf.destroy();
    expect(buf.gpuBuffer._destroyed).toBe(true);
  });
});
