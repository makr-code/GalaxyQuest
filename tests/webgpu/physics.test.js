/**
 * tests/webgpu/physics.test.js
 *
 * Tests for WebGPUPhysics double-buffered readback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGPUPhysics } from '../../js/engine/webgpu/WebGPUPhysics.js';

// ---------------------------------------------------------------------------
// Minimal GPU mock
// ---------------------------------------------------------------------------

function makeDevice() {
  const makeBuffer = (desc) => ({
    _desc: desc,
    size: desc.size,
    _mapped: null,
    _data: new Float32Array(desc.size / 4),
    mapAsync: vi.fn(async function () { this._mapped = true; }),
    getMappedRange: vi.fn(function (offset, len) {
      return this._data.buffer.slice(offset ?? 0, (offset ?? 0) + (len ?? this._data.byteLength));
    }),
    unmap: vi.fn(function () { this._mapped = false; }),
    destroy: vi.fn(),
  });

  const enc = {
    beginComputePass: vi.fn(() => ({
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      dispatchWorkgroups: vi.fn(),
      end: vi.fn(),
    })),
    copyBufferToBuffer: vi.fn(),
    finish: vi.fn(() => ({})),
  };

  return {
    createBuffer: vi.fn(makeBuffer),
    createBindGroup: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({
      getBindGroupLayout: vi.fn(() => ({})),
    })),
    createCommandEncoder: vi.fn(() => enc),
    queue: { submit: vi.fn(), writeBuffer: vi.fn() },
    lost: new Promise(() => {}),
    _enc: enc,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebGPUPhysics constructor', () => {
  it('initialises with two staging buffers after uploadBodies', () => {
    const dev     = makeDevice();
    const physics = new WebGPUPhysics(dev);
    physics.init();

    const bodies = new Map();
    bodies.set(0, { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mass: 1e15 });
    bodies.set(1, { position: { x: 100, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mass: 1e15 });
    physics.uploadBodies(bodies);

    expect(physics._stagingBufs[0]).not.toBeNull();
    expect(physics._stagingBufs[1]).not.toBeNull();
    expect(physics._stagingBufs[0]).not.toBe(physics._stagingBufs[1]);
  });
});

describe('WebGPUPhysics.step()', () => {
  it('copies to staging buffer and starts _pendingReadback Promise', () => {
    const dev     = makeDevice();
    const physics = new WebGPUPhysics(dev);
    physics.init();

    const bodies = new Map();
    bodies.set(0, { position: { x: 0, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, mass: 1e15 });
    physics.uploadBodies(bodies);

    physics.step(1 / 60);

    expect(dev._enc.copyBufferToBuffer).toHaveBeenCalled();
    expect(physics._pendingReadback).toBeInstanceOf(Promise);
  });

  it('alternates staging ping index each frame', () => {
    const dev     = makeDevice();
    const physics = new WebGPUPhysics(dev);
    physics.init();

    const bodies = new Map();
    bodies.set(0, { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mass: 1 });
    physics.uploadBodies(bodies);

    const pingBefore = physics._stagingPing;
    physics.step(1 / 60);
    const pingAfter  = physics._stagingPing;

    expect(pingAfter).toBe(pingBefore ^ 1);
  });
});

describe('WebGPUPhysics.readback()', () => {
  it('applies position data from staging buffer to bodies', async () => {
    const dev     = makeDevice();
    const physics = new WebGPUPhysics(dev);
    physics.init();

    const bodies = new Map();
    const b = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mass: 1e15 };
    bodies.set(0, b);
    physics.uploadBodies(bodies);

    // Manually write position data into staging buf so readback has something to read
    const staging = physics._stagingBufs[0];
    staging._data[0] = 42.5;  // px
    staging._data[1] = 10.0;  // py
    staging._data[2] = -5.0;  // pz

    // Force _pendingReadback to resolve with staging index 0
    physics._pendingReadback = Promise.resolve(0);

    await physics.readback(bodies);

    expect(b.position.x).toBeCloseTo(42.5);
    expect(b.position.y).toBeCloseTo(10.0);
    expect(b.position.z).toBeCloseTo(-5.0);
  });

  it('is a no-op when _pendingReadback is null', async () => {
    const dev     = makeDevice();
    const physics = new WebGPUPhysics(dev);
    physics.init();

    const bodies = new Map();
    const b = { position: { x: 99, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mass: 1 };
    bodies.set(0, b);
    physics.uploadBodies(bodies);

    physics._pendingReadback = null;
    await physics.readback(bodies);

    expect(b.position.x).toBe(99);
  });
});

describe('WebGPUPhysics.dispose()', () => {
  it('destroys both staging buffers', () => {
    const dev     = makeDevice();
    const physics = new WebGPUPhysics(dev);
    physics.init();

    const bodies = new Map();
    bodies.set(0, { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mass: 1 });
    physics.uploadBodies(bodies);

    const s0 = physics._stagingBufs[0];
    const s1 = physics._stagingBufs[1];

    physics.dispose();

    expect(s0.destroy).toHaveBeenCalled();
    expect(s1.destroy).toHaveBeenCalled();
    expect(physics._stagingBufs[0]).toBeNull();
    expect(physics._stagingBufs[1]).toBeNull();
  });
});
