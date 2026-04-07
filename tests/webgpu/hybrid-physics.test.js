/**
 * tests/webgpu/hybrid-physics.test.js
 *
 * Tests for HybridPhysicsEngine:
 *   - createBody / removeBody delegated to CPU engine
 *   - step() picks CPU path when body count < gpuThreshold
 *   - step() picks GPU path when body count >= gpuThreshold and GPU available
 *   - mode='cpu' forces CPU even with GPU present and enough bodies
 *   - mode='gpu' forces GPU
 *   - GPU dirty flag re-uploads bodies on next step after createBody
 *   - syncReadback() delegates to _gpu.readback()
 *   - syncReadback() is no-op on CPU path
 *   - dispose() calls _gpu.dispose()
 *   - computeGravityAt() / stepBody() forwarded to CPU
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HybridPhysicsEngine } from '../../js/engine/webgpu/HybridPhysicsEngine.js';

// ---------------------------------------------------------------------------
// Mock engines
// ---------------------------------------------------------------------------

function makeCpu(bodies = new Map()) {
  return {
    G: 9.5e-4,
    softening: 180,
    maxAcceleration: 420,
    bodies,
    _nextId: 1,
    createBody: vi.fn(function (opts = {}) {
      const id = this._nextId++;
      const body = {
        id,
        mass: opts.mass ?? 1,
        position: opts.position ?? { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        thrust: { x: 0, y: 0, z: 0 },
        drag: 0.001,
        maxSpeed: 0,
        staticBody: false,
      };
      this.bodies.set(id, body);
      return body;
    }),
    removeBody: vi.fn(function (bodyOrId) {
      const id = typeof bodyOrId === 'number' ? bodyOrId : bodyOrId?.id;
      this.bodies.delete(id);
    }),
    computeGravityAt: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    stepBody: vi.fn((body) => body),
  };
}

function makeGpu() {
  return {
    init:          vi.fn(),
    uploadBodies:  vi.fn(),
    step:          vi.fn(),
    readback:      vi.fn(async () => {}),
    dispose:       vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('HybridPhysicsEngine construction', () => {
  it('uses injected CPU engine', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    expect(hpe._cpu).toBe(cpu);
  });

  it('uses injected GPU engine', () => {
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: makeCpu(), _gpuEngine: gpu });
    expect(hpe._gpu).toBe(gpu);
  });

  it('defaults gpuThreshold to 32', () => {
    const hpe = new HybridPhysicsEngine({ _cpuEngine: makeCpu() });
    expect(hpe._gpuThreshold).toBe(32);
  });

  it('respects custom gpuThreshold', () => {
    const hpe = new HybridPhysicsEngine({ _cpuEngine: makeCpu(), gpuThreshold: 10 });
    expect(hpe._gpuThreshold).toBe(10);
  });

  it('mode defaults to "auto"', () => {
    const hpe = new HybridPhysicsEngine({ _cpuEngine: makeCpu() });
    expect(hpe.mode).toBe('auto');
  });

  it('lastBackend is null initially', () => {
    const hpe = new HybridPhysicsEngine({ _cpuEngine: makeCpu() });
    expect(hpe.lastBackend).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Body management
// ---------------------------------------------------------------------------

describe('HybridPhysicsEngine body management', () => {
  it('createBody delegates to CPU engine', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    hpe.createBody({ mass: 5 });
    expect(cpu.createBody).toHaveBeenCalledWith({ mass: 5 });
  });

  it('createBody returns body and adds to bodies Map', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    const body = hpe.createBody({ mass: 2 });
    expect(hpe.bodies.has(body.id)).toBe(true);
  });

  it('createBody sets _gpuDirty=true', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    hpe._gpuDirty = false;
    hpe.createBody({});
    expect(hpe._gpuDirty).toBe(true);
  });

  it('removeBody delegates to CPU engine', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    const body = hpe.createBody({});
    hpe.removeBody(body.id);
    expect(cpu.removeBody).toHaveBeenCalledWith(body.id);
  });

  it('removeBody sets _gpuDirty=true', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    hpe._gpuDirty = false;
    hpe.removeBody(99);
    expect(hpe._gpuDirty).toBe(true);
  });

  it('.bodies getter returns cpu.bodies', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    expect(hpe.bodies).toBe(cpu.bodies);
  });
});

// ---------------------------------------------------------------------------
// step() — CPU path
// ---------------------------------------------------------------------------

describe('HybridPhysicsEngine.step() — CPU path', () => {
  it('uses CPU when no GPU is present', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    // Add 50 bodies (above default threshold) — still CPU because no GPU
    for (let i = 0; i < 50; i++) cpu.createBody({});
    hpe.step(0.016);
    expect(hpe.lastBackend).toBe('cpu');
  });

  it('uses CPU when body count < gpuThreshold (auto mode)', () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu, gpuThreshold: 10 });
    for (let i = 0; i < 5; i++) cpu.createBody({});
    hpe.step(0.016);
    expect(hpe.lastBackend).toBe('cpu');
    expect(gpu.step).not.toHaveBeenCalled();
  });

  it('uses CPU when mode="cpu" even with enough bodies and GPU', () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu, gpuThreshold: 1 });
    for (let i = 0; i < 5; i++) cpu.createBody({});
    hpe.mode = 'cpu';
    hpe.step(0.016);
    expect(hpe.lastBackend).toBe('cpu');
    expect(gpu.step).not.toHaveBeenCalled();
  });

  it('CPU path calls stepBody for each body', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    const b1 = hpe.createBody({});
    const b2 = hpe.createBody({});
    hpe.step(0.016);
    // stepBody called twice (once per body)
    expect(cpu.stepBody).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// step() — GPU path
// ---------------------------------------------------------------------------

describe('HybridPhysicsEngine.step() — GPU path', () => {
  it('uses GPU when body count >= gpuThreshold (auto mode)', () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu, gpuThreshold: 5 });
    for (let i = 0; i < 5; i++) cpu.createBody({});
    hpe.step(0.016);
    expect(hpe.lastBackend).toBe('gpu');
    expect(gpu.step).toHaveBeenCalledWith(0.016);
  });

  it('uses GPU when mode="gpu" regardless of body count', () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu, gpuThreshold: 1000 });
    cpu.createBody({});
    hpe.mode = 'gpu';
    hpe.step(0.016);
    expect(hpe.lastBackend).toBe('gpu');
  });

  it('calls gpu.init() exactly once on first GPU step', () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu, gpuThreshold: 1 });
    cpu.createBody({});
    hpe.step(0.016);
    hpe.step(0.016);
    expect(gpu.init).toHaveBeenCalledOnce();
  });

  it('uploads bodies on first GPU step (_gpuDirty=true)', () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu, gpuThreshold: 1 });
    cpu.createBody({});
    expect(hpe._gpuDirty).toBe(true);
    hpe.step(0.016);
    expect(gpu.uploadBodies).toHaveBeenCalledOnce();
    expect(hpe._gpuDirty).toBe(false);
  });

  it('does NOT re-upload on subsequent steps if no body change', () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu, gpuThreshold: 1 });
    cpu.createBody({});
    hpe.step(0.016);
    hpe.step(0.016);
    expect(gpu.uploadBodies).toHaveBeenCalledOnce(); // only on first step
  });

  it('re-uploads after createBody (dirty flag)', () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu, gpuThreshold: 1 });
    cpu.createBody({});
    hpe.step(0.016); // clears dirty, uploads once
    hpe.createBody({}); // marks dirty again
    hpe.step(0.016);
    expect(gpu.uploadBodies).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// syncReadback()
// ---------------------------------------------------------------------------

describe('HybridPhysicsEngine.syncReadback()', () => {
  it('calls gpu.readback() on GPU path', async () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu, gpuThreshold: 1 });
    cpu.createBody({});
    hpe.step(0.016);
    await hpe.syncReadback();
    expect(gpu.readback).toHaveBeenCalledWith(cpu.bodies);
  });

  it('does NOT call gpu.readback() after CPU step', async () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu, gpuThreshold: 100 });
    cpu.createBody({});
    hpe.step(0.016); // only 1 body — CPU path
    await hpe.syncReadback();
    expect(gpu.readback).not.toHaveBeenCalled();
  });

  it('is a no-op when no GPU engine is present', async () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    cpu.createBody({});
    hpe.step(0.016);
    await expect(hpe.syncReadback()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Forwarded helpers
// ---------------------------------------------------------------------------

describe('HybridPhysicsEngine forwarded helpers', () => {
  it('computeGravityAt delegates to CPU', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    const pos = { x: 1, y: 2, z: 3 };
    hpe.computeGravityAt(pos, []);
    expect(cpu.computeGravityAt).toHaveBeenCalledWith(pos, []);
  });

  it('stepBody delegates to CPU', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    const body = { id: 1 };
    hpe.stepBody(body, 0.016, { gravitySources: [] });
    expect(cpu.stepBody).toHaveBeenCalledWith(body, 0.016, { gravitySources: [] });
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('HybridPhysicsEngine.dispose()', () => {
  it('calls gpu.dispose()', () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu });
    hpe.dispose();
    expect(gpu.dispose).toHaveBeenCalledOnce();
  });

  it('sets _gpu and _cpu to null', () => {
    const cpu = makeCpu();
    const gpu = makeGpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu, _gpuEngine: gpu });
    hpe.dispose();
    expect(hpe._gpu).toBeNull();
    expect(hpe._cpu).toBeNull();
  });

  it('dispose without GPU does not throw', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    expect(() => hpe.dispose()).not.toThrow();
  });

  it('sets lastBackend to null after dispose', () => {
    const cpu = makeCpu();
    const hpe = new HybridPhysicsEngine({ _cpuEngine: cpu });
    hpe.lastBackend = 'cpu';
    hpe.dispose();
    expect(hpe.lastBackend).toBeNull();
  });
});
