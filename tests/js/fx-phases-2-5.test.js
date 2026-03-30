/**
 * fx-phases-2-5.test.js — Unit tests for GPUParticleSystem, BeamEffect, VoxelDebris.
 *
 * Covers:
 *   GPUParticleSystem  — spawn, CPU simulate, pool exhaustion, dispose, FIELD constants
 *   BeamEffect         — addBeam, alpha fade, expiry, pool overflow, GPU stub, dispose
 *   VoxelDebris        — spawnExplosion, update, alpha fade, forEach, pool capacity, dispose
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { GPUParticleSystem, FLOATS_PER_PARTICLE } =
  require(path.join(root, 'js/engine/fx/GPUParticleSystem.js'));
const { BeamEffect, FLOATS_PER_BEAM } =
  require(path.join(root, 'js/engine/fx/BeamEffect.js'));
const { VoxelDebris } =
  require(path.join(root, 'js/engine/fx/VoxelDebris.js'));

// ---------------------------------------------------------------------------
// GPUParticleSystem
// ---------------------------------------------------------------------------

describe('GPUParticleSystem — CPU path', () => {
  let gps;

  beforeEach(() => { gps = new GPUParticleSystem({ maxParticles: 64 }); });

  it('starts with zero live particles', () => {
    expect(gps.liveCount).toBe(0);
  });

  it('spawns a particle and reports liveCount after update', () => {
    gps.spawn({ px: 0, py: 0, pz: 0, vx: 1, vy: 0, vz: 0, lifetime: 2.0 });
    gps.update(0.016);
    expect(gps.liveCount).toBe(1);
  });

  it('particle moves in the direction of its velocity', () => {
    gps.spawn({ px: 0, py: 0, pz: 0, vx: 10, vy: 0, vz: 0, lifetime: 5.0 });
    gps.update(0.1);

    let moved = false;
    gps.forEach((slot, d) => {
      const base = slot * FLOATS_PER_PARTICLE;
      if (d[base + GPUParticleSystem.FIELD.PX] > 0) moved = true;
    });
    expect(moved).toBe(true);
  });

  it('particle dies after its lifetime', () => {
    gps.spawn({ px: 0, py: 0, pz: 0, lifetime: 0.1 });
    gps.update(0.016);
    gps.update(0.2);
    expect(gps.liveCount).toBe(0);
  });

  it('forEach visits all live particles', () => {
    for (let i = 0; i < 5; i++) {
      gps.spawn({ px: i, py: 0, pz: 0, lifetime: 2.0 });
    }
    gps.update(0.016);
    let count = 0;
    gps.forEach(() => count++);
    expect(count).toBe(5);
  });

  it('does not exceed pool capacity', () => {
    // Spawn more than pool size
    for (let i = 0; i < 80; i++) {
      gps.spawn({ px: i, py: 0, pz: 0, lifetime: 99 });
    }
    gps.update(0.016);
    expect(gps.liveCount).toBeLessThanOrEqual(64);
  });

  it('returns -1 when pool is exhausted', () => {
    for (let i = 0; i < 64; i++) {
      gps.spawn({ px: 0, py: 0, pz: 0, lifetime: 99 });
    }
    const result = gps.spawn({ px: 0, py: 0, pz: 0, lifetime: 99 });
    expect(result).toBe(-1);
  });

  it('dispose clears all particles', () => {
    gps.spawn({ px: 0, py: 0, pz: 0, lifetime: 5 });
    gps.update(0.016);
    gps.dispose();
    expect(gps.liveCount).toBe(0);
    gps.update(0.016);  // should not throw
    expect(gps.liveCount).toBe(0);
  });

  it('gpuEnabled is false without a device', () => {
    expect(gps.gpuEnabled).toBe(false);
  });

  it('FIELD constants are defined', () => {
    const F = GPUParticleSystem.FIELD;
    expect(typeof F.PX).toBe('number');
    expect(typeof F.VX).toBe('number');
    expect(typeof F.ACTIVE).toBe('number');
    expect(F.FLOATS_PER_PARTICLE).toBe(FLOATS_PER_PARTICLE);
  });

  it('FLOATS_PER_PARTICLE is 16', () => {
    expect(FLOATS_PER_PARTICLE).toBe(16);
  });

  it('dataBuffer length matches maxParticles × FLOATS_PER_PARTICLE', () => {
    expect(gps.dataBuffer.length).toBe(64 * FLOATS_PER_PARTICLE);
  });

  it('gravity pulls particles downward', () => {
    const gravGps = new GPUParticleSystem({ maxParticles: 4, gravity: 9.8 });
    gravGps.spawn({ px: 0, py: 10, pz: 0, vx: 0, vy: 0, vz: 0, lifetime: 5.0 });
    gravGps.update(0.5);

    let fell = false;
    gravGps.forEach((slot, d) => {
      const b = slot * FLOATS_PER_PARTICLE;
      if (d[b + GPUParticleSystem.FIELD.VY] < 0) fell = true;
    });
    expect(fell).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BeamEffect
// ---------------------------------------------------------------------------

describe('BeamEffect', () => {
  const BEAM = {
    id: 1,
    from: { x: 0, y: 0, z: 0 },
    to:   { x: 0, y: 0, z: 100 },
    color: 0x44aaff,
    coreColor: 0xffffff,
    glowRadius: 0.4,
    duration: 0.1,
  };

  let be;

  beforeEach(() => { be = new BeamEffect({ maxBeams: 16 }); });

  it('starts with zero live beams', () => {
    expect(be.liveCount).toBe(0);
  });

  it('addBeam increments liveCount', () => {
    be.addBeam(BEAM);
    expect(be.liveCount).toBe(1);
  });

  it('addBeam writes from/to into instanceBuffer', () => {
    be.addBeam(BEAM);
    const F = BeamEffect.FIELD;
    const d = be.instanceBuffer;
    expect(d[F.FROM_X]).toBe(BEAM.from.x);
    expect(d[F.FROM_Y]).toBe(BEAM.from.y);
    expect(d[F.FROM_Z]).toBe(BEAM.from.z);
    expect(d[F.TO_Z]).toBe(BEAM.to.z);
  });

  it('alpha starts at 1', () => {
    be.addBeam(BEAM);
    const F = BeamEffect.FIELD;
    expect(be.instanceBuffer[F.ALPHA]).toBe(1);
  });

  it('beam is removed after duration', () => {
    be.addBeam(BEAM);
    expect(be.liveCount).toBe(1);
    be.update(0.2);  // beam duration is 0.1 s
    expect(be.liveCount).toBe(0);
  });

  it('alpha fades in the last 20 % of duration', () => {
    const b = { ...BEAM, duration: 1.0 };
    be.addBeam(b);
    be.update(0.85);  // 85 % through — in fade range
    const F = BeamEffect.FIELD;
    // alpha should be < 1 (fading) but > 0
    expect(be.instanceBuffer[F.ALPHA]).toBeGreaterThan(0);
    expect(be.instanceBuffer[F.ALPHA]).toBeLessThan(1);
  });

  it('pool overflow warns and returns -1', () => {
    const warns = [];
    const orig  = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));

    for (let i = 0; i < 17; i++) {
      be.addBeam({ ...BEAM, id: i + 1 });
    }
    console.warn = orig;
    expect(warns.length).toBeGreaterThan(0);
  });

  it('reuses freed slots after expiry', () => {
    for (let i = 0; i < 16; i++) {
      be.addBeam({ ...BEAM, id: i + 1, duration: 0.05 });
    }
    be.update(0.1);  // expire all
    expect(be.liveCount).toBe(0);
    // Should be able to add again
    const slot = be.addBeam(BEAM);
    expect(slot).toBeGreaterThanOrEqual(0);
  });

  it('gpuEnabled is false without a device', () => {
    expect(be.gpuEnabled).toBe(false);
  });

  it('FLOATS_PER_BEAM is 16', () => {
    expect(FLOATS_PER_BEAM).toBe(16);
  });

  it('instanceBuffer length matches maxBeams × FLOATS_PER_BEAM', () => {
    expect(be.instanceBuffer.length).toBe(16 * FLOATS_PER_BEAM);
  });

  it('dispose clears all beams', () => {
    be.addBeam(BEAM);
    be.dispose();
    expect(be.liveCount).toBe(0);
    be.update(0.016);  // should not throw
  });

  it('FIELD constants cover all named fields', () => {
    const F = BeamEffect.FIELD;
    expect(typeof F.FROM_X).toBe('number');
    expect(typeof F.TO_Z).toBe('number');
    expect(typeof F.CORE_R).toBe('number');
    expect(typeof F.GLOW_RADIUS).toBe('number');
    expect(typeof F.ALPHA).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// VoxelDebris
// ---------------------------------------------------------------------------

describe('VoxelDebris', () => {
  let vd;

  beforeEach(() => {
    vd = new VoxelDebris({ maxChunks: 64, chunksPerExplosion: 8 });
  });

  it('starts with zero live chunks', () => {
    expect(vd.liveCount).toBe(0);
  });

  it('spawnExplosion returns chunk count ≤ chunksPerExplosion', () => {
    const n = vd.spawnExplosion({ x: 0, y: 0, z: 0 });
    expect(n).toBe(8);
    expect(vd.liveCount).toBe(8);
  });

  it('chunks have outward velocity after spawn', () => {
    vd.spawnExplosion({ x: 0, y: 0, z: 0 });
    let hasVelocity = false;
    vd.forEach(c => {
      const speed = Math.sqrt(c.vx * c.vx + c.vy * c.vy + c.vz * c.vz);
      if (speed > 0) hasVelocity = true;
    });
    expect(hasVelocity).toBe(true);
  });

  it('chunks move after update', () => {
    vd.spawnExplosion({ x: 0, y: 0, z: 0 });
    // Record positions before update
    const before = [];
    vd.forEach(c => before.push({ px: c.px, py: c.py, pz: c.pz }));

    vd.update(0.1);

    const after = [];
    vd.forEach(c => after.push({ px: c.px, py: c.py, pz: c.pz }));

    // At least one chunk should have moved
    const moved = before.some((b, i) =>
      Math.abs((after[i]?.px ?? b.px) - b.px) > 0 ||
      Math.abs((after[i]?.py ?? b.py) - b.py) > 0 ||
      Math.abs((after[i]?.pz ?? b.pz) - b.pz) > 0
    );
    expect(moved).toBe(true);
  });

  it('chunks expire after their lifetime', () => {
    vd.spawnExplosion({ x: 0, y: 0, z: 0 }, { lifetime: 0.1, lifetimeVariance: 0 });
    vd.update(0.5);
    expect(vd.liveCount).toBe(0);
  });

  it('alpha fades in the last 30 % of lifetime', () => {
    vd.spawnExplosion({ x: 0, y: 0, z: 0 }, { lifetime: 1.0, lifetimeVariance: 0, count: 1 });
    vd.update(0.75);  // 75 % through — in fade zone

    let alphaFaded = false;
    vd.forEach(c => {
      if (c.alpha < 1) alphaFaded = true;
    });
    expect(alphaFaded).toBe(true);
  });

  it('forEach visits all live chunks', () => {
    vd.spawnExplosion({ x: 0, y: 0, z: 0 }, { count: 5 });
    let count = 0;
    vd.forEach(() => count++);
    expect(count).toBe(5);
  });

  it('does not exceed pool capacity', () => {
    // Emit many explosions to overflow the pool
    for (let i = 0; i < 20; i++) {
      vd.spawnExplosion({ x: i, y: 0, z: 0 });
    }
    vd.update(0.016);
    expect(vd.liveCount).toBeLessThanOrEqual(64);
  });

  it('chunkGeometry is a Geometry box', () => {
    expect(vd.chunkGeometry).toBeDefined();
    expect(vd.chunkGeometry.positions).not.toBeNull();
    expect(vd.chunkGeometry.indices).not.toBeNull();
  });

  it('each chunk references the shared geometry', () => {
    vd.spawnExplosion({ x: 0, y: 0, z: 0 }, { count: 3 });
    vd.forEach(c => {
      expect(c.geometry).toBe(vd.chunkGeometry);
    });
  });

  it('scale modifier affects chunk size', () => {
    const vdSmall = new VoxelDebris({ maxChunks: 4, chunksPerExplosion: 1 });
    const vdBig   = new VoxelDebris({ maxChunks: 4, chunksPerExplosion: 1 });
    vdSmall.spawnExplosion({ x: 0, y: 0, z: 0 }, { scale: 0.1, count: 1 });
    vdBig.spawnExplosion({ x: 0, y: 0, z: 0 },   { scale: 5,   count: 1 });

    let smallScale, bigScale;
    vdSmall.forEach(c => { smallScale = c.scale; });
    vdBig.forEach(c => { bigScale = c.scale; });

    expect(bigScale).toBeGreaterThan(smallScale);
  });

  it('dispose clears all chunks', () => {
    vd.spawnExplosion({ x: 0, y: 0, z: 0 });
    vd.dispose();
    expect(vd.liveCount).toBe(0);
    vd.update(0.016);  // should not throw
  });
});
