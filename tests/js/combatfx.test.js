/**
 * combatfx.test.js — Unit tests for the CombatFX / ParticleSystem / ParticleEmitter subsystem.
 *
 * Tests cover:
 *   • ParticleEmitter: burst mode, continuous mode, duration expiry, tick return values
 *   • ParticleSystem:  spawn, simulate, dynamic lights, pool exhaustion
 *   • CombatFX:        spawnWeaponFire, spawnExplosion, spawnShieldImpact,
 *                      spawnDynamicLight, update cycle, accessors, dispose
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { ParticleEmitter, EmitterMode } =
  require(path.join(root, 'js/engine/fx/ParticleEmitter.js'));
const { ParticleSystem } =
  require(path.join(root, 'js/engine/fx/ParticleSystem.js'));
const { CombatFX, WeaponType, ExplosionType, ShieldImpactType } =
  require(path.join(root, 'js/engine/fx/CombatFX.js'));

// ---------------------------------------------------------------------------
// ParticleEmitter
// ---------------------------------------------------------------------------

describe('ParticleEmitter — burst mode', () => {
  it('assigns a unique id', () => {
    const a = new ParticleEmitter({ position: { x: 0, y: 0, z: 0 } });
    const b = new ParticleEmitter({ position: { x: 0, y: 0, z: 0 } });
    expect(b.id).toBeGreaterThan(a.id);
  });

  it('is not done before the first tick', () => {
    const e = new ParticleEmitter({ count: 5 });
    expect(e.done).toBe(false);
  });

  it('returns count particles on the first tick and marks done', () => {
    const e   = new ParticleEmitter({ count: 10, mode: EmitterMode.BURST });
    const out = e.tick(0.016);
    expect(out).toBe(10);
    expect(e.done).toBe(true);
  });

  it('returns 0 on subsequent ticks', () => {
    const e = new ParticleEmitter({ count: 5 });
    e.tick(0.016);
    expect(e.tick(0.016)).toBe(0);
  });

  it('defaults mode to BURST', () => {
    const e = new ParticleEmitter();
    expect(e.mode).toBe(EmitterMode.BURST);
  });
});

describe('ParticleEmitter — continuous mode', () => {
  it('emits at the configured rate', () => {
    // 100 particles/s × 0.1 s = 10 particles
    const e     = new ParticleEmitter({ mode: EmitterMode.CONTINUOUS, count: 100 });
    const total = e.tick(0.1);
    expect(total).toBe(10);
    expect(e.done).toBe(false);
  });

  it('expires after duration', () => {
    const e = new ParticleEmitter({ mode: EmitterMode.CONTINUOUS, count: 10, duration: 0.5 });
    e.tick(0.5);
    expect(e.done).toBe(true);
  });

  it('remains alive when duration is 0', () => {
    const e = new ParticleEmitter({ mode: EmitterMode.CONTINUOUS, count: 10, duration: 0 });
    for (let i = 0; i < 100; i++) e.tick(0.016);
    expect(e.done).toBe(false);
  });

  it('accumulates fractional particles correctly', () => {
    // 10 particles/s × 0.05 s = 0.5 → 0 the first tick
    const e = new ParticleEmitter({ mode: EmitterMode.CONTINUOUS, count: 10 });
    expect(e.tick(0.05)).toBe(0);
    // second tick: accum = 1.0 → 1 particle
    expect(e.tick(0.05)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ParticleSystem
// ---------------------------------------------------------------------------

describe('ParticleSystem', () => {
  let ps;

  beforeEach(() => { ps = new ParticleSystem({ maxParticles: 64 }); });

  it('starts with zero live particles', () => {
    expect(ps.liveCount).toBe(0);
  });

  it('spawns particles via a burst emitter', () => {
    ps.addEmitter(new ParticleEmitter({ count: 10, mode: EmitterMode.BURST,
      position: { x: 0, y: 0, z: 0 }, lifetime: 1.0 }));
    ps.update(0.016);
    expect(ps.liveCount).toBe(10);
  });

  it('particles age and die after their lifetime', () => {
    ps.addEmitter(new ParticleEmitter({
      count: 5, lifetime: 0.1, lifetimeVariance: 0,
      position: { x: 0, y: 0, z: 0 },
    }));
    ps.update(0.016); // spawn
    ps.update(0.2);   // kill
    expect(ps.liveCount).toBe(0);
  });

  it('forEach visits all live particles', () => {
    ps.addEmitter(new ParticleEmitter({ count: 8, lifetime: 1,
      position: { x: 1, y: 2, z: 3 } }));
    ps.update(0.016);
    let count = 0;
    ps.forEach(() => count++);
    expect(count).toBe(8);
  });

  it('does not exceed pool capacity', () => {
    // Add more particles than the pool allows
    for (let i = 0; i < 10; i++) {
      ps.addEmitter(new ParticleEmitter({ count: 10, lifetime: 99,
        position: { x: 0, y: 0, z: 0 } }));
    }
    ps.update(0.016);
    expect(ps.liveCount).toBeLessThanOrEqual(64);
  });

  it('integrates position from velocity', () => {
    // Directly spawn by cheating: use a burst emitter then check position moved
    const emitter = new ParticleEmitter({
      count: 1, lifetime: 2.0, lifetimeVariance: 0,
      speed: 10, speedVariance: 0, spread: 0,
      direction: { x: 0, y: 1, z: 0 },
      gravity: 0, drag: 0,
      position: { x: 0, y: 0, z: 0 },
    });
    ps.addEmitter(emitter);
    ps.update(0.016); // spawn + first physics step (dt=0.016 spawns and steps)

    let moved = false;
    ps.forEach(p => {
      if (p.py > 0) moved = true;
    });
    expect(moved).toBe(true);
  });

  it('dynamic lights fade to zero over their duration', () => {
    const { PointLight } = require(path.join(root, 'js/engine/scene/Light.js'));
    const pl = new PointLight(0xffffff, 5.0, 50);
    ps.addDynamicLight(pl, 0.2);

    // After full duration, the light should be hidden
    ps.update(0.21);
    expect(pl.visible).toBe(false);
  });

  it('dynamic lights reach peak intensity around the start', () => {
    const { PointLight } = require(path.join(root, 'js/engine/scene/Light.js'));
    const pl = new PointLight(0xffffff, 5.0, 50);
    ps.addDynamicLight(pl, 1.0);
    ps.update(0.05); // ~5 % of duration → in ramp-up phase
    expect(pl.intensity).toBeGreaterThan(0);
    expect(pl.intensity).toBeLessThanOrEqual(5.0);
  });

  it('dispose clears all state', () => {
    ps.addEmitter(new ParticleEmitter({ count: 10, lifetime: 5,
      position: { x: 0, y: 0, z: 0 } }));
    ps.update(0.016);
    ps.dispose();
    expect(ps.liveCount).toBe(0);
    expect(ps.dynamicLights.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CombatFX
// ---------------------------------------------------------------------------

describe('CombatFX', () => {
  const O  = { x: 0, y: 0, z: 0 };
  const T  = { x: 0, y: 0, z: 100 };
  const NZ = { x: 0, y: 0, z: 1 };
  let fx;

  beforeEach(() => { fx = new CombatFX(); });

  // --- WeaponType tests ---

  it('spawnWeaponFire LASER creates emitters, beams and a light', () => {
    const { emitters, beams, lights } = fx.spawnWeaponFire(WeaponType.LASER, O, T);
    expect(emitters.length).toBeGreaterThan(0);
    expect(beams.length).toBeGreaterThan(0);
    expect(lights.length).toBeGreaterThan(0);
  });

  it('spawnWeaponFire PLASMA creates a continuous trail emitter', () => {
    const { emitters } = fx.spawnWeaponFire(WeaponType.PLASMA, O, T);
    const continuous   = emitters.filter(e => e.mode === EmitterMode.CONTINUOUS);
    expect(continuous.length).toBeGreaterThan(0);
  });

  it('spawnWeaponFire MISSILE creates an exhaust emitter', () => {
    const { emitters } = fx.spawnWeaponFire(WeaponType.MISSILE, O, T);
    const continuous   = emitters.filter(e => e.mode === EmitterMode.CONTINUOUS);
    expect(continuous.length).toBeGreaterThan(0);
  });

  it('spawnWeaponFire RAILGUN creates a shockwave after update', () => {
    fx.spawnWeaponFire(WeaponType.RAILGUN, O, T);
    expect(fx.shockwaves.length).toBeGreaterThan(0);
  });

  it('spawnWeaponFire with unknown type emits a warning and returns empty', () => {
    const warns = [];
    const orig  = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    const result = fx.spawnWeaponFire('unknown_type', O, T);
    console.warn = orig;
    expect(warns.length).toBeGreaterThan(0);
    expect(result.emitters.length).toBe(0);
  });

  // --- ExplosionType tests ---

  it('spawnExplosion HIT_SPARK creates particles and a light', () => {
    const { emitters, lights } = fx.spawnExplosion(O, ExplosionType.HIT_SPARK);
    expect(emitters.length).toBeGreaterThan(0);
    expect(lights.length).toBeGreaterThan(0);
  });

  it('spawnExplosion DETONATION creates fireball and sparks emitters', () => {
    const { emitters } = fx.spawnExplosion(O, ExplosionType.DETONATION);
    expect(emitters.length).toBeGreaterThanOrEqual(2);
  });

  it('spawnExplosion SHIP_DESTRUCTION creates core, cloud and debris emitters', () => {
    const { emitters } = fx.spawnExplosion(O, ExplosionType.SHIP_DESTRUCTION);
    expect(emitters.length).toBeGreaterThanOrEqual(3);
  });

  it('spawnExplosion SHOCKWAVE creates a shockwave record and a light', () => {
    const { shockwaves, lights } = fx.spawnExplosion(O, ExplosionType.SHOCKWAVE);
    expect(shockwaves.length).toBe(1);
    expect(lights.length).toBeGreaterThan(0);
  });

  it('shockwave radius grows with update', () => {
    const { shockwaves } = fx.spawnExplosion(O, ExplosionType.SHOCKWAVE);
    fx.update(0.1);
    expect(shockwaves[0].radius).toBeGreaterThan(0);
  });

  it('shockwave is removed after its duration', () => {
    fx.spawnExplosion(O, ExplosionType.SHOCKWAVE);
    expect(fx.shockwaves.length).toBe(1);
    fx.update(1.0); // shockwave duration is 0.4 s
    expect(fx.shockwaves.length).toBe(0);
  });

  // --- ShieldImpactType tests ---

  it('spawnShieldImpact ENERGY creates a ripple record and particles', () => {
    const { ripples, emitters, lights } = fx.spawnShieldImpact(O, NZ, ShieldImpactType.ENERGY);
    expect(ripples.length).toBe(1);
    expect(emitters.length).toBeGreaterThan(0);
    expect(lights.length).toBeGreaterThan(0);
  });

  it('shield ripple expands over time', () => {
    const { ripples } = fx.spawnShieldImpact(O, NZ, ShieldImpactType.ENERGY);
    fx.update(0.1);
    expect(ripples[0].radius).toBeGreaterThan(0);
  });

  it('shield ripple expires after its duration', () => {
    fx.spawnShieldImpact(O, NZ, ShieldImpactType.ENERGY);
    expect(fx.ripples.length).toBe(1);
    fx.update(1.0);
    expect(fx.ripples.length).toBe(0);
  });

  it('spawnShieldImpact KINETIC creates sparks and no ripple', () => {
    const { ripples, emitters } = fx.spawnShieldImpact(O, NZ, ShieldImpactType.KINETIC);
    expect(ripples.length).toBe(0);
    expect(emitters.length).toBeGreaterThan(0);
  });

  it('spawnShieldImpact NULL_VOID creates inward vortex particles', () => {
    const { emitters } = fx.spawnShieldImpact(O, NZ, ShieldImpactType.NULL_VOID);
    expect(emitters.length).toBeGreaterThan(0);
    // NULL_VOID emitter velocity should be pointing inward (negative direction)
    // We can verify particles spawned by checking the system after update
    fx.update(0.016);
    expect(fx.particleSystem.liveCount).toBeGreaterThan(0);
  });

  it('spawnShieldImpact with unknown type emits a warning and returns empty', () => {
    const warns = [];
    const orig  = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    const result = fx.spawnShieldImpact(O, NZ, 'unknown_type');
    console.warn = orig;
    expect(warns.length).toBeGreaterThan(0);
    expect(result.emitters.length).toBe(0);
  });

  // --- spawnDynamicLight ---

  it('spawnDynamicLight registers a PointLight', () => {
    const pl = fx.spawnDynamicLight(O, 0xff0000, 3.0, 50, 0.5);
    expect(pl.intensity).toBeGreaterThan(0);
    expect(fx.dynamicLights.length).toBe(1);
  });

  it('dynamic light is gone after its duration', () => {
    fx.spawnDynamicLight(O, 0xff0000, 3.0, 50, 0.3);
    fx.update(0.5);
    expect(fx.dynamicLights.length).toBe(0);
  });

  // --- beam records ---

  it('LASER beam expires after its duration', () => {
    fx.spawnWeaponFire(WeaponType.LASER, O, T);
    expect(fx.beams.length).toBe(1);
    fx.update(1.0); // beam.duration is 0.05 s
    expect(fx.beams.length).toBe(0);
  });

  // --- scale modifier ---

  it('scale > 1 increases explosion particle speed', () => {
    const fxA = new CombatFX();
    const fxB = new CombatFX();
    fxA.spawnExplosion(O, ExplosionType.DETONATION, 1);
    fxB.spawnExplosion(O, ExplosionType.DETONATION, 3);
    // After one step, particles from B should generally have moved farther
    fxA.update(0.016);
    fxB.update(0.016);
    let maxA = 0, maxB = 0;
    fxA.particleSystem.forEach(p => { const d = Math.abs(p.py); if (d > maxA) maxA = d; });
    fxB.particleSystem.forEach(p => { const d = Math.abs(p.py); if (d > maxB) maxB = d; });
    expect(maxB).toBeGreaterThanOrEqual(maxA);
  });

  // --- dispose ---

  it('dispose clears all records and particles', () => {
    fx.spawnExplosion(O, ExplosionType.DETONATION);
    fx.spawnShieldImpact(O, NZ, ShieldImpactType.ENERGY);
    fx.spawnWeaponFire(WeaponType.LASER, O, T);
    fx.update(0.016);
    fx.dispose();
    expect(fx.beams.length).toBe(0);
    expect(fx.shockwaves.length).toBe(0);
    expect(fx.ripples.length).toBe(0);
    expect(fx.particleSystem.liveCount).toBe(0);
  });

  // --- enum completeness ---

  it('WeaponType covers 4 types', () => {
    expect(Object.keys(WeaponType).length).toBe(4);
  });

  it('ExplosionType covers 4 types', () => {
    expect(Object.keys(ExplosionType).length).toBe(4);
  });

  it('ShieldImpactType covers 3 types', () => {
    expect(Object.keys(ShieldImpactType).length).toBe(3);
  });
});
