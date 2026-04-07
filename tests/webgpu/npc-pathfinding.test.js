/**
 * tests/webgpu/npc-pathfinding.test.js
 *
 * Tests for NPCPathfindingCompute:
 *   - construction and init()
 *   - uploadAgents() buffer management (sizing, dirty rebuild)
 *   - disableAgent() single-slot write
 *   - step() dispatches GPU compute + starts async readback
 *   - readback() applies position/velocity, returns arrived IDs
 *   - dispose() destroys all GPU resources
 *   - edge cases: empty agents, disabled agents, zero dt
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NPCPathfindingCompute, AGENT_STRIDE, AGENT_BYTES, PATHFIND_WORKGROUP_SIZE } from
  '../../js/engine/webgpu/NPCPathfindingCompute.js';

// ---------------------------------------------------------------------------
// WebGPU globals required by NPCPathfindingCompute (not present in jsdom)
// ---------------------------------------------------------------------------

if (typeof globalThis.GPUBufferUsage === 'undefined') {
  globalThis.GPUBufferUsage = {
    STORAGE:  0x0080,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    MAP_READ: 0x0001,
    UNIFORM:  0x0040,
  };
}
if (typeof globalThis.GPUMapMode === 'undefined') {
  globalThis.GPUMapMode = { READ: 1, WRITE: 2 };
}

// ---------------------------------------------------------------------------
// Minimal GPUDevice mock (mirrors WebGPUPhysics tests pattern)
// ---------------------------------------------------------------------------

function makeBuffer(size, opts = {}) {
  const _data = new ArrayBuffer(Math.max(size, 4));
  return {
    size,
    usage: opts.usage ?? 0,
    destroy:        vi.fn(),
    getMappedRange: vi.fn((offset = 0, len = size) => _data.slice(offset, offset + len)),
    unmap:          vi.fn(),
    mapAsync:       vi.fn(async () => {}),
    _data,
  };
}

function makeDevice() {
  const bufs = [];
  return {
    _bufs: bufs,
    createBuffer: vi.fn((desc) => {
      const b = makeBuffer(desc.size, desc);
      bufs.push(b);
      return b;
    }),
    createShaderModule: vi.fn(() => ({ label: 'mock-shader' })),
    createComputePipeline: vi.fn(() => ({
      getBindGroupLayout: vi.fn(() => ({ label: 'mock-bgl' })),
    })),
    createBindGroup: vi.fn(() => ({ label: 'mock-bg' })),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => ({
        setPipeline:       vi.fn(),
        setBindGroup:      vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end:               vi.fn(),
      })),
      copyBufferToBuffer: vi.fn(),
      finish:             vi.fn(() => ({})),
    })),
    queue: {
      writeBuffer: vi.fn(),
      submit:      vi.fn(),
    },
  };
}

// Build a minimal agent Map
function makeAgents(n = 3, opts = {}) {
  const m = new Map();
  for (let i = 1; i <= n; i++) {
    m.set(i, {
      position:        { x: i * 10, y: 0, z: 0 },
      velocity:        { x: 0,       y: 0, z: 0 },
      target:          { x: 100,     y: 0, z: 0 },
      maxSpeed:        opts.maxSpeed         ?? 2,
      maxForce:        opts.maxForce         ?? 1,
      arrivalRadius:   opts.arrivalRadius    ?? 10,
      separationRadius:opts.separationRadius ?? 5,
      enabled:         opts.enabled          ?? true,
    });
  }
  return m;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('NPCPathfindingCompute constants', () => {
  it('AGENT_STRIDE is 16', () => expect(AGENT_STRIDE).toBe(16));
  it('AGENT_BYTES is 64', () => expect(AGENT_BYTES).toBe(64));
  it('PATHFIND_WORKGROUP_SIZE is 64', () => expect(PATHFIND_WORKGROUP_SIZE).toBe(64));
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('NPCPathfindingCompute construction', () => {
  it('constructs without throwing', () => {
    const dev = makeDevice();
    expect(() => new NPCPathfindingCompute(dev)).not.toThrow();
  });

  it('is not initialized before init()', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    expect(npc._initialized).toBe(false);
  });

  it('agentCount is 0 initially', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    expect(npc._agentCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// init()
// ---------------------------------------------------------------------------

describe('NPCPathfindingCompute.init()', () => {
  it('calls createShaderModule', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    expect(dev.createShaderModule).toHaveBeenCalledOnce();
  });

  it('calls createComputePipeline', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    expect(dev.createComputePipeline).toHaveBeenCalledOnce();
  });

  it('sets _initialized = true', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    expect(npc._initialized).toBe(true);
  });

  it('calling init() twice does not throw', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    expect(() => { npc.init(); npc.init(); }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// uploadAgents()
// ---------------------------------------------------------------------------

describe('NPCPathfindingCompute.uploadAgents()', () => {
  it('does nothing for empty Map', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(new Map());
    expect(npc._agentCount).toBe(0);
    expect(dev.createBuffer).not.toHaveBeenCalled();
  });

  it('sets _agentCount correctly', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(5));
    expect(npc._agentCount).toBe(5);
  });

  it('creates 4 GPU buffers (2 agent + 2 staging + 1 param) on first call', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(3));
    // 2 agent storage buffers + 2 staging buffers + 1 param uniform = 5 calls
    expect(dev.createBuffer.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('agent buffers are sized to agentCount × AGENT_BYTES', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(4));
    const expectedSize = 4 * AGENT_BYTES;
    const agentBufCall = dev.createBuffer.mock.calls.find(
      ([desc]) => desc.size === expectedSize,
    );
    expect(agentBufCall).toBeDefined();
  });

  it('writes to queue after upload', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(2));
    expect(dev.queue.writeBuffer).toHaveBeenCalled();
  });

  it('stores agent IDs in order', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    const agents = makeAgents(3);
    npc.uploadAgents(agents);
    expect(npc._agentIds).toEqual([1, 2, 3]);
  });

  it('rebuilds buffers when agent count changes', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(2));
    const callsBefore = dev.createBuffer.mock.calls.length;
    npc.uploadAgents(makeAgents(5)); // larger — must rebuild
    expect(dev.createBuffer.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('supports pos/vel field aliases (pos instead of position)', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    const agents = new Map();
    agents.set('a', {
      pos: { x: 1, y: 2, z: 3 },
      vel: { x: 0, y: 0, z: 0 },
      target: { x: 10, y: 0, z: 0 },
      maxSpeed: 1,
    });
    expect(() => npc.uploadAgents(agents)).not.toThrow();
  });

  it('handles disabled agents (enabled=false)', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    const agents = makeAgents(2, { enabled: false });
    expect(() => npc.uploadAgents(agents)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// step()
// ---------------------------------------------------------------------------

describe('NPCPathfindingCompute.step()', () => {
  it('does nothing when not initialized', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.uploadAgents(makeAgents(2));
    expect(() => npc.step(0.016)).not.toThrow();
    expect(dev.queue.submit).not.toHaveBeenCalled();
  });

  it('does nothing when agentCount is 0', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    expect(() => npc.step(0.016)).not.toThrow();
    expect(dev.queue.submit).not.toHaveBeenCalled();
  });

  it('calls createCommandEncoder after init + upload', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(3));
    npc.step(0.016);
    expect(dev.createCommandEncoder).toHaveBeenCalled();
  });

  it('submits to device.queue', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(3));
    npc.step(0.016);
    expect(dev.queue.submit).toHaveBeenCalledOnce();
  });

  it('creates a bind group each step', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(3));
    npc.step(0.016);
    expect(dev.createBindGroup).toHaveBeenCalled();
  });

  it('swaps pingIdx each step', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(3));
    const before = npc._pingIdx;
    npc.step(0.016);
    expect(npc._pingIdx).toBe(before ^ 1);
  });

  it('sets _pendingReadback promise after step', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(3));
    // Make staging buf mapAsync work
    npc._stagingBufs[0] = { mapAsync: vi.fn(async () => {}), size: 3 * AGENT_BYTES };
    npc._stagingBufs[1] = { mapAsync: vi.fn(async () => {}), size: 3 * AGENT_BYTES };
    npc.step(0.016);
    expect(npc._pendingReadback).toBeTruthy();
  });

  it('does not throw with dt=0', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(2));
    expect(() => npc.step(0)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// readback()
// ---------------------------------------------------------------------------

describe('NPCPathfindingCompute.readback()', () => {
  it('returns empty array when no pending readback', async () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(2));
    const result = await npc.readback(makeAgents(2));
    expect(result).toEqual([]);
  });

  it('returns empty array when agentCount is 0', async () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    const result = await npc.readback(new Map());
    expect(result).toEqual([]);
  });

  it('applies position updates from GPU data', async () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    const agents = makeAgents(1);
    npc.uploadAgents(agents);
    npc._agentIds = [1];
    npc._agentCount = 1;

    // Build fake GPU result: agent 1 moved to (50, 0, 0), still enabled
    const raw = new Float32Array(AGENT_STRIDE);
    raw[0] = 50;   // pos.x
    raw[1] = 0;    // pos.y
    raw[2] = 0;    // pos.z
    raw[4] = 1.0;  // vel.x
    raw[13] = 1;   // enabled

    const stagingBuf = makeBuffer(AGENT_BYTES);
    stagingBuf._data = raw.buffer;
    stagingBuf.getMappedRange = vi.fn(() => raw.buffer);
    npc._stagingBufs[0] = stagingBuf;
    npc._stagingBufs[1] = stagingBuf;
    npc._pendingReadback = Promise.resolve(0);

    const arrived = await npc.readback(agents);
    expect(agents.get(1).position.x).toBe(50);
    expect(arrived).toEqual([]);
  });

  it('reports arrived agents (enabled transitions to 0)', async () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    const agents = makeAgents(1);
    npc.uploadAgents(agents);
    npc._agentIds = [1];
    npc._agentCount = 1;

    // GPU result: agent arrived (enabled = 0, vel = 0)
    const raw = new Float32Array(AGENT_STRIDE);
    raw[0]  = 100;  // pos.x at target
    raw[13] = 0;    // enabled = 0 (arrived)

    const stagingBuf = makeBuffer(AGENT_BYTES);
    stagingBuf.getMappedRange = vi.fn(() => raw.buffer);
    npc._stagingBufs[0] = stagingBuf;
    npc._pendingReadback = Promise.resolve(0);

    const arrived = await npc.readback(agents);
    expect(arrived).toContain(1);
    expect(agents.get(1).enabled).toBe(false);
  });

  it('returns empty array when mapAsync was rejected (null stagingIdx)', async () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(2));
    npc._pendingReadback = Promise.resolve(null);
    const result = await npc.readback(makeAgents(2));
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// disableAgent()
// ---------------------------------------------------------------------------

describe('NPCPathfindingCompute.disableAgent()', () => {
  it('does nothing when agent ID not found', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(2));
    expect(() => npc.disableAgent(999)).not.toThrow();
  });

  it('writes zero float to the enabled slot of the active buffer', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(3));
    dev.queue.writeBuffer.mockClear();
    npc.disableAgent(2); // agent id=2 is at index 1
    const call = dev.queue.writeBuffer.mock.calls[0];
    expect(call).toBeDefined();
    // offset = index(1) * AGENT_BYTES + 13*4 = 64 + 52 = 116
    expect(call[1]).toBe(1 * AGENT_BYTES + 13 * 4);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('NPCPathfindingCompute.dispose()', () => {
  it('destroys all GPU buffers', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(3));
    // capture references before dispose
    const b0 = npc._agentBufs[0];
    const b1 = npc._agentBufs[1];
    const s0 = npc._stagingBufs[0];
    const s1 = npc._stagingBufs[1];
    const p  = npc._paramBuf;
    npc.dispose();
    expect(b0.destroy).toHaveBeenCalled();
    expect(b1.destroy).toHaveBeenCalled();
    expect(s0.destroy).toHaveBeenCalled();
    expect(s1.destroy).toHaveBeenCalled();
    expect(p.destroy).toHaveBeenCalled();
  });

  it('nullifies buffer references after dispose', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(2));
    npc.dispose();
    expect(npc._agentBufs[0]).toBeNull();
    expect(npc._agentBufs[1]).toBeNull();
    expect(npc._stagingBufs[0]).toBeNull();
    expect(npc._stagingBufs[1]).toBeNull();
    expect(npc._paramBuf).toBeNull();
  });

  it('clears agentIds after dispose', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(3));
    npc.dispose();
    expect(npc._agentIds).toEqual([]);
  });

  it('does not throw when called before uploadAgents()', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    expect(() => npc.dispose()).not.toThrow();
  });

  it('can be called twice without throwing', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(2));
    npc.dispose();
    expect(() => npc.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Integration: upload → step → readback cycle
// ---------------------------------------------------------------------------

describe('NPCPathfindingCompute full cycle', () => {
  it('completes upload → step → readback without errors', async () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    const agents = makeAgents(4);
    npc.uploadAgents(agents);

    // Patch staging buffers with working mapAsync mock
    for (let i = 0; i < 2; i++) {
      npc._stagingBufs[i] = {
        size:           4 * AGENT_BYTES,
        mapAsync:       vi.fn(async () => {}),
        getMappedRange: vi.fn(() => new Float32Array(4 * AGENT_STRIDE).buffer),
        unmap:          vi.fn(),
        destroy:        vi.fn(),
      };
    }

    npc.step(0.016);
    expect(npc._pendingReadback).toBeTruthy();

    const arrived = await npc.readback(agents);
    expect(Array.isArray(arrived)).toBe(true);
  });

  it('step() dispatches correct workgroup count for N agents', () => {
    const dev = makeDevice();
    const npc = new NPCPathfindingCompute(dev);
    npc.init();
    npc.uploadAgents(makeAgents(130)); // 130 agents → ceil(130/64) = 3 workgroups

    // Capture dispatchWorkgroups call
    let dispatchedX = null;
    dev.createCommandEncoder.mockImplementation(() => ({
      beginComputePass: vi.fn(() => ({
        setPipeline:        vi.fn(),
        setBindGroup:       vi.fn(),
        dispatchWorkgroups: vi.fn((x) => { dispatchedX = x; }),
        end:                vi.fn(),
      })),
      copyBufferToBuffer: vi.fn(),
      finish:             vi.fn(() => ({})),
    }));

    npc.step(0.016);
    expect(dispatchedX).toBe(Math.ceil(130 / PATHFIND_WORKGROUP_SIZE));
  });
});
