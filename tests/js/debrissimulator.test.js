/**
 * debrissimulator.test.js — Unit tests for DebrisSimulator (Phase FX-6).
 *
 * Tests cover:
 *   • Construction: capacity, liveCount, gpuEnabled
 *   • addChunk:     slot allocation, liveCount increment, pool-full warning
 *   • removeChunk:  slot release, liveCount decrement, unknown-id no-op
 *   • CPU step:     linear motion, drag, angular velocity, lifetime expiry, angle wrap
 *   • dataBuffer:   Float32Array layout per-slot
 *   • readChunk:    position/rotation read-back
 *   • Angle wrapping: stays within [-π, π]
 *   • dispose:      clears all state
 *   • FLOATS_PER_CHUNK constant
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { DebrisSimulator, FLOATS_PER_CHUNK } =
  require(path.join(root, 'js/engine/fx/DebrisSimulator.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(overrides = {}) {
  return {
    id:       overrides.id       ?? 1,
    active:   overrides.active   ?? true,
    px: 0, py: 0, pz: 0,
    vx: overrides.vx ?? 0,
    vy: overrides.vy ?? 0,
    vz: overrides.vz ?? 0,
    rotX: overrides.rotX ?? 0,
    rotY: overrides.rotY ?? 0,
    rotZ: overrides.rotZ ?? 0,
    angVelX: overrides.angVelX ?? 0,
    angVelY: overrides.angVelY ?? 0,
    angVelZ: overrides.angVelZ ?? 0,
    scale:    overrides.scale    ?? 1,
    drag:     overrides.drag     ?? 0,
    lifetime: overrides.lifetime ?? 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FLOATS_PER_CHUNK constant
// ---------------------------------------------------------------------------

describe('DebrisSimulator — constants', () => {
  it('FLOATS_PER_CHUNK is 24', () => {
    expect(FLOATS_PER_CHUNK).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('DebrisSimulator — construction', () => {
  it('initialises with 0 live chunks', () => {
    const sim = new DebrisSimulator({ capacity: 8 });
    expect(sim.liveCount).toBe(0);
  });

  it('gpuEnabled is false without a device', () => {
    const sim = new DebrisSimulator();
    expect(sim.gpuEnabled).toBe(false);
  });

  it('allocates a Float32Array of the right size', () => {
    const sim = new DebrisSimulator({ capacity: 4 });
    expect(sim.dataBuffer.length).toBe(4 * FLOATS_PER_CHUNK);
  });
});

// ---------------------------------------------------------------------------
// addChunk / removeChunk
// ---------------------------------------------------------------------------

describe('DebrisSimulator — addChunk / removeChunk', () => {
  let sim;
  beforeEach(() => { sim = new DebrisSimulator({ capacity: 4 }); });

  it('addChunk returns a valid slot index', () => {
    const slot = sim.addChunk(makeChunk({ id: 1 }));
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(4);
  });

  it('liveCount increments on addChunk', () => {
    sim.addChunk(makeChunk({ id: 1 }));
    sim.addChunk(makeChunk({ id: 2 }));
    expect(sim.liveCount).toBe(2);
  });

  it('removeChunk decrements liveCount and frees the slot', () => {
    sim.addChunk(makeChunk({ id: 1 }));
    sim.removeChunk(1);
    expect(sim.liveCount).toBe(0);
  });

  it('freed slot is reused by the next addChunk', () => {
    sim.addChunk(makeChunk({ id: 1 }));
    sim.removeChunk(1);
    const slot = sim.addChunk(makeChunk({ id: 2 }));
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(sim.liveCount).toBe(1);
  });

  it('warns and returns -1 when pool is full', () => {
    const warns = [];
    const orig  = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    for (let i = 0; i < 4; i++) sim.addChunk(makeChunk({ id: i + 1 }));
    const result = sim.addChunk(makeChunk({ id: 99 }));
    console.warn = orig;
    expect(result).toBe(-1);
    expect(warns.length).toBeGreaterThan(0);
  });

  it('removeChunk on unknown id is a no-op', () => {
    sim.addChunk(makeChunk({ id: 1 }));
    expect(() => sim.removeChunk(9999)).not.toThrow();
    expect(sim.liveCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CPU step — linear motion
// ---------------------------------------------------------------------------

describe('DebrisSimulator — CPU linear motion', () => {
  let sim;
  beforeEach(() => { sim = new DebrisSimulator({ capacity: 4 }); });

  it('position advances by velocity × dt', () => {
    sim.addChunk(makeChunk({ id: 1, vx: 10, vy: 5, vz: -3 }));
    sim.update(1.0);
    const state = sim.readChunk(1);
    expect(state.px).toBeCloseTo(10, 4);
    expect(state.py).toBeCloseTo(5, 4);
    expect(state.pz).toBeCloseTo(-3, 4);
  });

  it('velocity decays with drag', () => {
    sim.addChunk(makeChunk({ id: 1, vx: 100, drag: 0.5 }));
    sim.update(0.1);
    const state = sim.readChunk(1);
    // After drag: vx *= max(0, 1 - 0.5 * 0.1) = 0.95
    expect(state.px).toBeCloseTo(100 * 0.95 * 0.1, 3);
  });

  it('zero drag leaves velocity unchanged', () => {
    sim.addChunk(makeChunk({ id: 1, vx: 20, drag: 0 }));
    sim.update(0.5);
    const state = sim.readChunk(1);
    expect(state.px).toBeCloseTo(10, 4);
  });
});

// ---------------------------------------------------------------------------
// CPU step — angular motion
// ---------------------------------------------------------------------------

describe('DebrisSimulator — CPU angular motion', () => {
  let sim;
  beforeEach(() => { sim = new DebrisSimulator({ capacity: 4, angDrag: 0 }); });

  it('rotation angle advances by angular velocity × dt', () => {
    sim.addChunk(makeChunk({ id: 1, angVelY: Math.PI }));
    sim.update(0.5);
    const state = sim.readChunk(1);
    expect(state.rotY).toBeCloseTo(Math.PI * 0.5, 5);
  });

  it('angular velocity is damped with angDrag', () => {
    const sim2 = new DebrisSimulator({ capacity: 4, angDrag: 1.0 });
    const slot = sim2.addChunk(makeChunk({ id: 1, angVelX: 10 }));
    sim2.update(0.5);
    const d = sim2.dataBuffer;
    const b = slot * FLOATS_PER_CHUNK;
    // angDamp = max(0, 1 - 1.0 * 0.5) = 0.5  → angVelX becomes 5
    expect(d[b + 9]).toBeCloseTo(5.0, 5);
  });
});

// ---------------------------------------------------------------------------
// CPU step — lifetime
// ---------------------------------------------------------------------------

describe('DebrisSimulator — CPU lifetime', () => {
  let sim;
  beforeEach(() => { sim = new DebrisSimulator({ capacity: 4 }); });

  it('chunk becomes inactive when lifetime expires', () => {
    sim.addChunk(makeChunk({ id: 1, lifetime: 0.1 }));
    sim.update(0.2);
    const state = sim.readChunk(1);
    expect(state).not.toBeNull();
    expect(state.active).toBe(false);
  });

  it('chunk stays active while lifetime > 0', () => {
    sim.addChunk(makeChunk({ id: 1, lifetime: 1.0 }));
    sim.update(0.5);
    const state = sim.readChunk(1);
    expect(state.active).toBe(true);
  });

  it('permanent chunk (lifetime=0) never expires', () => {
    sim.addChunk(makeChunk({ id: 1, lifetime: 0 }));
    for (let i = 0; i < 100; i++) sim.update(0.016);
    const state = sim.readChunk(1);
    expect(state.active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Angle wrapping
// ---------------------------------------------------------------------------

describe('DebrisSimulator — angle wrapping', () => {
  it('rotation angle stays within [-π, π]', () => {
    const sim = new DebrisSimulator({ capacity: 4, angDrag: 0 });
    // High angular velocity → angles will exceed 2π quickly
    sim.addChunk(makeChunk({ id: 1, angVelY: 100 }));
    for (let i = 0; i < 200; i++) sim.update(0.016);
    const state = sim.readChunk(1);
    expect(state.rotY).toBeGreaterThanOrEqual(-Math.PI - 1e-6);
    expect(state.rotY).toBeLessThanOrEqual(Math.PI + 1e-6);
  });
});

// ---------------------------------------------------------------------------
// readChunk — unknown id
// ---------------------------------------------------------------------------

describe('DebrisSimulator — readChunk', () => {
  it('returns null for unknown chunk id', () => {
    const sim = new DebrisSimulator();
    expect(sim.readChunk(42)).toBeNull();
  });

  it('returns correct scale', () => {
    const sim = new DebrisSimulator({ capacity: 4 });
    sim.addChunk(makeChunk({ id: 1, scale: 3.5 }));
    expect(sim.readChunk(1).scale).toBe(3.5);
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe('DebrisSimulator — dispose', () => {
  it('resets liveCount to 0', () => {
    const sim = new DebrisSimulator({ capacity: 4 });
    sim.addChunk(makeChunk({ id: 1 }));
    sim.addChunk(makeChunk({ id: 2 }));
    sim.dispose();
    expect(sim.liveCount).toBe(0);
  });

  it('disables GPU after dispose', () => {
    const sim = new DebrisSimulator();
    sim.dispose();
    expect(sim.gpuEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple chunks independence
// ---------------------------------------------------------------------------

describe('DebrisSimulator — multiple independent chunks', () => {
  it('each chunk integrates independently', () => {
    const sim = new DebrisSimulator({ capacity: 8 });
    sim.addChunk(makeChunk({ id: 1, vx: 1 }));
    sim.addChunk(makeChunk({ id: 2, vy: 2 }));
    sim.update(1.0);
    expect(sim.readChunk(1).px).toBeCloseTo(1, 4);
    expect(sim.readChunk(1).py).toBeCloseTo(0, 4);
    expect(sim.readChunk(2).px).toBeCloseTo(0, 4);
    expect(sim.readChunk(2).py).toBeCloseTo(2, 4);
  });
});
