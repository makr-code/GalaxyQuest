/**
 * tests/webgpu/economy-compute.test.js
 *
 * Unit tests for EconomyComputeEngine.
 * All GPU calls are mocked — no real WebGPU device required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EconomyComputeEngine, ECONOMY_WGSL, COLONY_STRIDE, RESULT_STRIDE } from '../../js/engine/webgpu/EconomyComputeEngine.js';

// ---------------------------------------------------------------------------
// GPU device mock
// ---------------------------------------------------------------------------

function makeMockDevice() {
  const mockBuf = () => ({
    mapAsync:       vi.fn().mockResolvedValue(undefined),
    getMappedRange: vi.fn(() => new ArrayBuffer(4096)),
    unmap:          vi.fn(),
    destroy:        vi.fn(),
  });

  const mockPipeline = {
    getBindGroupLayout: vi.fn(() => ({})),
  };

  const passEnd = vi.fn();
  const passDispatch = vi.fn();
  const passSetPipeline = vi.fn();
  const passSetBindGroup = vi.fn();
  const mockPass = {
    setPipeline:       passSetPipeline,
    setBindGroup:      passSetBindGroup,
    dispatchWorkgroups: passDispatch,
    end:               passEnd,
  };

  const encoderFinish    = vi.fn(() => ({}));
  const encoderCopy      = vi.fn();
  const encoderBeginPass = vi.fn(() => mockPass);
  const mockEncoder      = {
    beginComputePass:      encoderBeginPass,
    copyBufferToBuffer:    encoderCopy,
    finish:                encoderFinish,
  };

  const queueWriteBuffer = vi.fn();
  const queueSubmit      = vi.fn();

  return {
    createShaderModule:          vi.fn(() => ({})),
    createComputePipelineAsync:  vi.fn().mockResolvedValue(mockPipeline),
    createBuffer:                vi.fn(mockBuf),
    createBindGroup:             vi.fn(() => ({})),
    createCommandEncoder:        vi.fn(() => mockEncoder),
    queue: {
      writeBuffer: queueWriteBuffer,
      submit:      queueSubmit,
    },
    _pass:    mockPass,
    _encoder: mockEncoder,
    _pipeline: mockPipeline,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeColony(overrides = {}) {
  return {
    buildings:  [2, 1, 0, 0, 3, 1, 0, 0],
    bonuses:    [1, 1, 1, 1, 1, 1, 1, 1],
    popClass:   [100, 80, 20, 10, 5, 3],
    stock:      [500, 300, 100, 50, 200, 80, 0, 0, 0, 0, 0, 0],
    population: 218,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('EconomyComputeEngine — constructor', () => {
  it('creates with default options', () => {
    const engine = new EconomyComputeEngine();
    expect(engine.isGpuAvailable).toBe(false);
    expect(engine.getResults()).toEqual([]);
  });

  it('isGpuAvailable is true when device is provided', () => {
    const engine = new EconomyComputeEngine({ device: makeMockDevice() });
    expect(engine.isGpuAvailable).toBe(true);
  });

  it('clamps maxColonies to at least 1', () => {
    const engine = new EconomyComputeEngine({ maxColonies: 0 });
    expect(engine._maxColonies).toBe(1);
  });

  it('clamps numGoods to at least 1', () => {
    const engine = new EconomyComputeEngine({ numGoods: -5 });
    expect(engine._numGoods).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// init()
// ---------------------------------------------------------------------------

describe('EconomyComputeEngine — init()', () => {
  it('init() is no-op without device', async () => {
    const engine = new EconomyComputeEngine();
    await expect(engine.init()).resolves.toBeUndefined();
    expect(engine._ready).toBe(false);
  });

  it('init() sets _ready=true with device', async () => {
    const device = makeMockDevice();
    const engine = new EconomyComputeEngine({ device });
    await engine.init();
    expect(engine._ready).toBe(true);
  });

  it('init() compiles shader module', async () => {
    const device = makeMockDevice();
    const engine = new EconomyComputeEngine({ device });
    await engine.init();
    expect(device.createShaderModule).toHaveBeenCalledWith({ code: ECONOMY_WGSL });
  });

  it('init() creates pipeline', async () => {
    const device = makeMockDevice();
    const engine = new EconomyComputeEngine({ device });
    await engine.init();
    expect(device.createComputePipelineAsync).toHaveBeenCalled();
  });

  it('init() creates 4 GPU buffers', async () => {
    const device = makeMockDevice();
    const engine = new EconomyComputeEngine({ device });
    await engine.init();
    // colonyBuf, goodBuf, resultBuf, readBuf + 3 pass uniform bufs = 7
    expect(device.createBuffer.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('init() creates 3 bind groups (one per pass)', async () => {
    const device = makeMockDevice();
    const engine = new EconomyComputeEngine({ device });
    await engine.init();
    expect(device.createBindGroup.mock.calls.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// setColonies()
// ---------------------------------------------------------------------------

describe('EconomyComputeEngine — setColonies()', () => {
  it('accepts an array of colonies', () => {
    const engine = new EconomyComputeEngine();
    const cols   = [makeColony(), makeColony()];
    engine.setColonies(cols);
    expect(engine._colonies).toHaveLength(2);
  });

  it('handles non-array gracefully', () => {
    const engine = new EconomyComputeEngine();
    engine.setColonies(null);
    expect(engine._colonies).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tick() — CPU fallback
// ---------------------------------------------------------------------------

describe('EconomyComputeEngine — tick() CPU fallback', () => {
  it('produces results for each colony when GPU not available', async () => {
    const engine = new EconomyComputeEngine();
    engine.setColonies([makeColony(), makeColony()]);
    await engine.tick(1.0);
    const results = engine.getResults();
    expect(results).toHaveLength(2);
  });

  it('each result has produced, consumed, priceDelta arrays of length 12', async () => {
    const engine = new EconomyComputeEngine();
    engine.setColonies([makeColony()]);
    await engine.tick(1.0);
    const [r] = engine.getResults();
    expect(r.produced).toHaveLength(12);
    expect(r.consumed).toHaveLength(12);
    expect(r.priceDelta).toHaveLength(12);
  });

  it('production > 0 for buildings with count > 0', async () => {
    const engine = new EconomyComputeEngine();
    engine.setColonies([makeColony({ buildings: [5, 0, 0, 0, 0, 0, 0, 0], bonuses: [1,1,1,1,1,1,1,1] })]);
    await engine.tick(1.0);
    const [r] = engine.getResults();
    // building 0 = METAL_FORGE, base 2.0 × 5 × 1.0 × 1.0 = 10
    expect(r.produced[0]).toBeCloseTo(10, 2);
  });

  it('production scales with dt', async () => {
    const engine = new EconomyComputeEngine();
    const col = makeColony({ buildings: [1,0,0,0,0,0,0,0], bonuses: [1,1,1,1,1,1,1,1] });
    engine.setColonies([col]);
    await engine.tick(2.0);
    const [r] = engine.getResults();
    // base 2.0 × 1 × 1 × 2 = 4
    expect(r.produced[0]).toBeCloseTo(4, 2);
  });

  it('consumption is capped by available stock', async () => {
    const engine = new EconomyComputeEngine();
    const stock = new Array(12).fill(0);
    stock[0] = 0.01; // tiny stock
    engine.setColonies([makeColony({ stock, popClass: [1000,0,0,0,0,0] })]);
    await engine.tick(1.0);
    const [r] = engine.getResults();
    // consumed cannot exceed available stock
    expect(r.consumed[0]).toBeLessThanOrEqual(0.01 + 1e-6);
  });

  it('priceDelta is negative when production exceeds consumption', async () => {
    const engine = new EconomyComputeEngine();
    const col = makeColony({
      buildings: [10, 0, 0, 0, 0, 0, 0, 0],
      bonuses:   [1, 1, 1, 1, 1, 1, 1, 1],
      popClass:  [0, 0, 0, 0, 0, 0],  // no pop → no consumption
      stock:     new Array(12).fill(1000),
    });
    engine.setColonies([col]);
    await engine.tick(1.0);
    const [r] = engine.getResults();
    // surplus production → falling price
    expect(r.priceDelta[0]).toBeLessThan(0);
  });

  it('priceDelta is zero when both production and consumption are zero', async () => {
    const engine = new EconomyComputeEngine();
    engine.setColonies([makeColony({
      buildings: new Array(8).fill(0),
      popClass:  new Array(6).fill(0),
    })]);
    await engine.tick(1.0);
    const [r] = engine.getResults();
    expect(r.priceDelta[0]).toBe(0);
  });

  it('returns empty results for zero colonies', async () => {
    const engine = new EconomyComputeEngine();
    engine.setColonies([]);
    await engine.tick(1.0);
    expect(engine.getResults()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tick() — GPU path (mocked device)
// ---------------------------------------------------------------------------

describe('EconomyComputeEngine — tick() GPU path', () => {
  let engine;
  let device;

  beforeEach(async () => {
    device = makeMockDevice();
    engine = new EconomyComputeEngine({ device, maxColonies: 4, numGoods: 4 });
    await engine.init();
  });

  it('tick() calls queue.writeBuffer for colony data', async () => {
    engine.setColonies([makeColony()]);
    await engine.tick(1.0);
    // At least colony buf + good buf writes
    expect(device.queue.writeBuffer.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('tick() encodes 3 compute passes', async () => {
    engine.setColonies([makeColony()]);
    await engine.tick(1.0);
    expect(device._encoder.beginComputePass.mock.calls.length).toBe(3);
  });

  it('tick() dispatches each pass once', async () => {
    engine.setColonies([makeColony()]);
    await engine.tick(1.0);
    expect(device._pass.dispatchWorkgroups.mock.calls.length).toBe(3);
  });

  it('tick() calls copyBufferToBuffer for readback', async () => {
    engine.setColonies([makeColony()]);
    await engine.tick(1.0);
    expect(device._encoder.copyBufferToBuffer).toHaveBeenCalled();
  });

  it('tick() submits command buffer', async () => {
    engine.setColonies([makeColony()]);
    await engine.tick(1.0);
    expect(device.queue.submit).toHaveBeenCalled();
  });

  it('tick() with empty colonies produces empty results', async () => {
    engine.setColonies([]);
    await engine.tick(1.0);
    expect(engine.getResults()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ECONOMY_WGSL shader string
// ---------------------------------------------------------------------------

describe('ECONOMY_WGSL shader source', () => {
  it('is a non-empty string', () => {
    expect(typeof ECONOMY_WGSL).toBe('string');
    expect(ECONOMY_WGSL.length).toBeGreaterThan(0);
  });

  it('declares @compute entry point', () => {
    expect(ECONOMY_WGSL).toMatch(/@compute/);
  });

  it('declares three storage bindings', () => {
    const storageMatches = (ECONOMY_WGSL.match(/@binding/g) ?? []).length;
    expect(storageMatches).toBeGreaterThanOrEqual(4); // 0,1,2,3
  });

  it('references passIdx', () => {
    expect(ECONOMY_WGSL).toMatch(/passIdx/);
  });

  it('workgroup_size is 64', () => {
    expect(ECONOMY_WGSL).toMatch(/@workgroup_size\(64\)/);
  });

  it('references PRICE_ELASTICITY', () => {
    expect(ECONOMY_WGSL).toMatch(/PRICE_ELASTICITY/);
  });
});

// ---------------------------------------------------------------------------
// COLONY_STRIDE / RESULT_STRIDE exports
// ---------------------------------------------------------------------------

describe('Stride constants', () => {
  it('COLONY_STRIDE is a positive number', () => {
    expect(typeof COLONY_STRIDE).toBe('number');
    expect(COLONY_STRIDE).toBeGreaterThan(0);
  });

  it('RESULT_STRIDE is a positive number', () => {
    expect(typeof RESULT_STRIDE).toBe('number');
    expect(RESULT_STRIDE).toBeGreaterThan(0);
  });
});
