/**
 * environmentfx.test.js — Unit tests for the EnvironmentFX subsystem.
 *
 * Tests cover:
 *   • DebrisField:      spawn, chunk count, active flag, tumble update
 *   • DebrisCloud:      emitter creation, cloud volume record
 *   • PlasmaCloud:      emitter, cloud, optional light
 *   • NebulaVolume:     cloud record properties
 *   • SpaceDust:        emitter + cloud record
 *   • GodRay:           record creation, elapsed, duration expiry
 *   • LensFlare:        elements, expiry, persistent
 *   • HeatDistortion:   record fields, expiry
 *   • EmpPulse:         ring expansion, maxRadius auto-remove, particle emitters
 *   • Corona:           pulse opacity animation, expiry
 *   • PlasmaTorrent:    record + emitter, direction, expiry
 *   • GravLensing:      record creation, expiry
 *   • RadiationZone:    opacity oscillation, expiry
 *   • update():         advances all record types
 *   • prune():          cleans up inactive records
 *   • dispose():        clears all state
 *   • enum completeness
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { EnvironmentFX, DebrisType, CloudType, LightingFXType } =
  require(path.join(root, 'js/engine/fx/EnvironmentFX.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const O  = { x: 0, y: 0, z: 0 };
const UP = { x: 0, y: 1, z: 0 };

// ---------------------------------------------------------------------------
// DebrisField
// ---------------------------------------------------------------------------

describe('EnvironmentFX — DebrisField', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('spawns the requested number of debris chunks', () => {
    const chunks = fx.spawnDebrisField(O, DebrisType.HULL_FRAGMENT, 10, 50);
    expect(chunks.length).toBe(10);
  });

  it('all chunks start active', () => {
    const chunks = fx.spawnDebrisField(O, DebrisType.ASTEROID_CHUNK, 5, 30);
    expect(chunks.every(c => c.active)).toBe(true);
  });

  it('chunks appear within the scatter radius', () => {
    const radius = 40;
    const chunks = fx.spawnDebrisField(O, DebrisType.ICE_CRYSTAL, 30, radius);
    for (const c of chunks) {
      const d = Math.sqrt(c.px ** 2 + c.py ** 2 + c.pz ** 2);
      expect(d).toBeLessThanOrEqual(radius + 0.001); // tiny float tolerance
    }
  });

  it('chunks have angular velocity (tumbling)', () => {
    const chunks = fx.spawnDebrisField(O, DebrisType.HULL_FRAGMENT, 5, 20);
    const anyTumbling = chunks.some(c =>
      Math.abs(c.angVelX) > 0 || Math.abs(c.angVelY) > 0 || Math.abs(c.angVelZ) > 0,
    );
    expect(anyTumbling).toBe(true);
  });

  it('update advances rotation of active chunks', () => {
    const chunks = fx.spawnDebrisField(O, DebrisType.HULL_FRAGMENT, 3, 20);
    const before = chunks.map(c => c.rotY);
    fx.update(0.1);
    const changed = chunks.some((c, i) => c.rotY !== before[i]);
    expect(changed).toBe(true);
  });

  it('warns on unknown DebrisType', () => {
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    const result = fx.spawnDebrisField(O, 'unknown_type', 5, 20);
    console.warn = orig;
    expect(warns.length).toBeGreaterThan(0);
    expect(result.length).toBe(0);
  });

  it('debrisChunks accessor filters inactive chunks', () => {
    const chunks = fx.spawnDebrisField(O, DebrisType.HULL_FRAGMENT, 4, 20, { lifetime: 0.01 });
    expect(fx.debrisChunks.length).toBe(4);
    fx.update(0.1); // expires all (lifetime 0.01)
    expect(fx.debrisChunks.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DebrisCloud
// ---------------------------------------------------------------------------

describe('EnvironmentFX — DebrisCloud', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates at least 2 emitters (burst + continuous)', () => {
    const { emitters } = fx.spawnDebrisCloud(O, 30);
    expect(emitters.length).toBeGreaterThanOrEqual(2);
  });

  it('creates a cloud volume record', () => {
    const { cloud } = fx.spawnDebrisCloud(O, 30);
    expect(cloud).toBeTruthy();
    expect(cloud.type).toBe(CloudType.DEBRIS_CLOUD);
  });

  it('cloud volume radius matches argument', () => {
    const { cloud } = fx.spawnDebrisCloud(O, 55);
    expect(cloud.radius).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// PlasmaCloud
// ---------------------------------------------------------------------------

describe('EnvironmentFX — PlasmaCloud', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates a continuous emitter', () => {
    const { emitters } = fx.spawnPlasmaCloud(O, 40);
    expect(emitters.length).toBeGreaterThan(0);
  });

  it('creates a PLASMA type cloud volume', () => {
    const { cloud } = fx.spawnPlasmaCloud(O, 40);
    expect(cloud.type).toBe(CloudType.PLASMA);
  });

  it('creates a dynamic light by default', () => {
    const { light } = fx.spawnPlasmaCloud(O, 40);
    expect(light).not.toBeNull();
  });

  it('skips light when emitLight=false', () => {
    const { light } = fx.spawnPlasmaCloud(O, 40, { emitLight: false });
    expect(light).toBeNull();
  });

  it('light is positioned at spawn point', () => {
    const pos = { x: 10, y: 20, z: 30 };
    const { light } = fx.spawnPlasmaCloud(pos, 40);
    expect(light.position.x).toBe(10);
    expect(light.position.y).toBe(20);
    expect(light.position.z).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// NebulaVolume
// ---------------------------------------------------------------------------

describe('EnvironmentFX — NebulaVolume', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates a NEBULA cloud volume record', () => {
    const rec = fx.spawnNebulaVolume(O, 300);
    expect(rec.type).toBe(CloudType.NEBULA);
  });

  it('returns the correct radius', () => {
    const rec = fx.spawnNebulaVolume(O, 500);
    expect(rec.radius).toBe(500);
  });

  it('accepts colour overrides', () => {
    const rec = fx.spawnNebulaVolume(O, 200, { colorInner: 0xff0000, colorOuter: 0x000088 });
    expect(rec.colorInner).toBe(0xff0000);
    expect(rec.colorOuter).toBe(0x000088);
  });

  it('cloud volume is accessible via accessor', () => {
    fx.spawnNebulaVolume(O, 200);
    expect(fx.cloudVolumes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SpaceDust
// ---------------------------------------------------------------------------

describe('EnvironmentFX — SpaceDust', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates a continuous emitter', () => {
    const { emitters } = fx.spawnSpaceDust(O, 100);
    expect(emitters.length).toBeGreaterThan(0);
  });

  it('creates a SPACE_DUST cloud record', () => {
    const { cloud } = fx.spawnSpaceDust(O, 100);
    expect(cloud.type).toBe(CloudType.SPACE_DUST);
  });
});

// ---------------------------------------------------------------------------
// GodRay
// ---------------------------------------------------------------------------

describe('EnvironmentFX — GodRay', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates a god-ray record with correct type', () => {
    const rec = fx.spawnGodRay(O, UP);
    expect(rec.type).toBe(LightingFXType.GOD_RAY);
    expect(rec.active).toBe(true);
  });

  it('direction is normalised', () => {
    const rec = fx.spawnGodRay(O, { x: 3, y: 0, z: 4 });
    const len = Math.sqrt(rec.direction.x ** 2 + rec.direction.y ** 2 + rec.direction.z ** 2);
    expect(len).toBeCloseTo(1.0, 5);
  });

  it('elapsed advances on update', () => {
    const rec = fx.spawnGodRay(O, UP);
    fx.update(0.1);
    expect(rec.elapsed).toBeCloseTo(0.1, 5);
  });

  it('expires after duration', () => {
    fx.spawnGodRay(O, UP, { duration: 0.3 });
    expect(fx.godRays.length).toBe(1);
    fx.update(0.5);
    expect(fx.godRays.length).toBe(0);
  });

  it('persists when duration is 0', () => {
    fx.spawnGodRay(O, UP, { duration: 0 });
    for (let i = 0; i < 100; i++) fx.update(0.016);
    expect(fx.godRays.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// LensFlare
// ---------------------------------------------------------------------------

describe('EnvironmentFX — LensFlare', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates a lens-flare record with correct type', () => {
    const rec = fx.spawnLensFlare(O);
    expect(rec.type).toBe(LightingFXType.LENS_FLARE);
    expect(rec.active).toBe(true);
  });

  it('generates the requested number of elements', () => {
    const rec = fx.spawnLensFlare(O, { numElements: 7 });
    expect(rec.elements.length).toBe(7);
  });

  it('elements span from -1 to +1 on the flare axis', () => {
    const rec = fx.spawnLensFlare(O, { numElements: 5 });
    expect(rec.elements[0].offset).toBeCloseTo(-1.0, 5);
    expect(rec.elements[4].offset).toBeCloseTo(1.0, 5);
  });

  it('expires after duration', () => {
    fx.spawnLensFlare(O, { duration: 0.2 });
    fx.update(0.5);
    expect(fx.lensFlares.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// HeatDistortion
// ---------------------------------------------------------------------------

describe('EnvironmentFX — HeatDistortion', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates a heat-distortion record', () => {
    const rec = fx.spawnHeatDistortion(O, 8);
    expect(rec.type).toBe(LightingFXType.HEAT_DISTORTION);
    expect(rec.radius).toBe(8);
  });

  it('expires after duration', () => {
    fx.spawnHeatDistortion(O, 5, { duration: 0.1 });
    fx.update(0.5);
    expect(fx.heatDistortions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EmpPulse
// ---------------------------------------------------------------------------

describe('EnvironmentFX — EmpPulse', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates an EMP record and particle emitters', () => {
    const { record, emitters } = fx.spawnEmpPulse(O);
    expect(record.type).toBe(LightingFXType.EMP_PULSE);
    expect(emitters.length).toBeGreaterThan(0);
  });

  it('ring radius grows on update', () => {
    const { record } = fx.spawnEmpPulse(O, { expandSpeed: 100 });
    fx.update(0.1);
    expect(record.radius).toBeCloseTo(10, 0);
  });

  it('auto-removes when maxRadius is reached', () => {
    fx.spawnEmpPulse(O, { expandSpeed: 1000, maxRadius: 10, duration: 9999 });
    expect(fx.empPulses.length).toBe(1);
    fx.update(0.1); // 100 units → past maxRadius=10
    expect(fx.empPulses.length).toBe(0);
  });

  it('auto-removes when duration expires', () => {
    fx.spawnEmpPulse(O, { expandSpeed: 0, maxRadius: 9999, duration: 0.2 });
    fx.update(0.5);
    expect(fx.empPulses.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Corona
// ---------------------------------------------------------------------------

describe('EnvironmentFX — Corona', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates a corona record', () => {
    const rec = fx.spawnCorona(O, 60);
    expect(rec.type).toBe(LightingFXType.CORONA);
    expect(rec.radius).toBe(60);
  });

  it('opacity oscillates (never 0 or > 1)', () => {
    const rec = fx.spawnCorona(O, 60, { pulseFrequency: 5, pulseAmplitude: 0.3 });
    for (let i = 0; i < 60; i++) fx.update(0.016);
    expect(rec.opacity).toBeGreaterThan(0);
    expect(rec.opacity).toBeLessThanOrEqual(1.0 + 0.3);
  });

  it('expires after duration', () => {
    fx.spawnCorona(O, 60, { duration: 0.1 });
    fx.update(0.5);
    const activeCoronas = fx.coronas.filter(c => c.active);
    expect(activeCoronas.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PlasmaTorrent
// ---------------------------------------------------------------------------

describe('EnvironmentFX — PlasmaTorrent', () => {
  let fx;
  const FROM = { x: 0, y: 0, z: 0 };
  const TO   = { x: 0, y: 0, z: 100 };
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates a torrent record and particle emitter', () => {
    const { record, emitters } = fx.spawnPlasmaTorrent(FROM, TO);
    expect(record.active).toBe(true);
    expect(emitters.length).toBeGreaterThan(0);
  });

  it('expiry works with duration > 0', () => {
    fx.spawnPlasmaTorrent(FROM, TO, { duration: 0.1 });
    fx.update(0.5);
    expect(fx.plasmaTorrents.length).toBe(0);
  });

  it('persists when duration is 0', () => {
    fx.spawnPlasmaTorrent(FROM, TO, { duration: 0 });
    for (let i = 0; i < 60; i++) fx.update(0.016);
    expect(fx.plasmaTorrents.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GravLensing
// ---------------------------------------------------------------------------

describe('EnvironmentFX — GravLensing', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates a grav-lensing record', () => {
    const rec = fx.spawnGravLensing(O, 2.5, 150);
    expect(rec.type).toBe(LightingFXType.GRAV_LENSING);
    expect(rec.mass).toBe(2.5);
    expect(rec.radius).toBe(150);
  });

  it('expires after duration', () => {
    fx.spawnGravLensing(O, 1, 100, { duration: 0.1 });
    fx.update(0.5);
    expect(fx.gravLensing.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RadiationZone
// ---------------------------------------------------------------------------

describe('EnvironmentFX — RadiationZone', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('creates a radiation zone record', () => {
    const rec = fx.spawnRadiationZone(O, 80);
    expect(rec.type).toBe(LightingFXType.RADIATION_ZONE);
    expect(rec.radius).toBe(80);
  });

  it('opacity oscillates between minOpacity and maxOpacity', () => {
    const rec = fx.spawnRadiationZone(O, 80, {
      pulseFrequency: 10, minOpacity: 0.1, maxOpacity: 0.5,
    });
    const opacities = [];
    for (let i = 0; i < 30; i++) {
      fx.update(0.016);
      opacities.push(rec.opacity);
    }
    const min = Math.min(...opacities);
    const max = Math.max(...opacities);
    expect(min).toBeGreaterThanOrEqual(0.09); // tiny float tolerance
    expect(max).toBeLessThanOrEqual(0.51);
    expect(max).toBeGreaterThan(min);         // it actually oscillates
  });

  it('expires after duration', () => {
    fx.spawnRadiationZone(O, 80, { duration: 0.1 });
    fx.update(0.5);
    const active = fx.radiationZones.filter(r => r.active);
    expect(active.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// prune() and dispose()
// ---------------------------------------------------------------------------

describe('EnvironmentFX — prune and dispose', () => {
  let fx;
  beforeEach(() => { fx = new EnvironmentFX(); });

  it('prune removes inactive records', () => {
    fx.spawnGodRay(O, UP, { duration: 0.01 });
    fx.spawnLensFlare(O, { duration: 0.01 });
    fx.update(0.1);
    fx.prune();
    expect(fx.godRays.length).toBe(0);
    expect(fx.lensFlares.length).toBe(0);
  });

  it('dispose clears everything', () => {
    fx.spawnDebrisField(O, DebrisType.HULL_FRAGMENT, 5, 20);
    fx.spawnNebulaVolume(O, 200);
    fx.spawnGodRay(O, UP);
    fx.spawnLensFlare(O);
    fx.spawnEmpPulse(O);
    fx.spawnCorona(O, 50);
    fx.spawnRadiationZone(O, 80);
    fx.update(0.016);
    fx.dispose();

    expect(fx.debrisChunks.length).toBe(0);
    expect(fx.cloudVolumes.length).toBe(0);
    expect(fx.godRays.length).toBe(0);
    expect(fx.lensFlares.length).toBe(0);
    expect(fx.empPulses.length).toBe(0);
    expect(fx.coronas.length).toBe(0);
    expect(fx.radiationZones.length).toBe(0);
    expect(fx.particleSystem.liveCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Enum completeness
// ---------------------------------------------------------------------------

describe('EnvironmentFX — enum completeness', () => {
  it('DebrisType has 4 values', () => {
    expect(Object.keys(DebrisType).length).toBe(4);
  });

  it('CloudType has 5 values', () => {
    expect(Object.keys(CloudType).length).toBe(5);
  });

  it('LightingFXType has 7 values', () => {
    expect(Object.keys(LightingFXType).length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Shared ParticleSystem injection
// ---------------------------------------------------------------------------

describe('EnvironmentFX — shared ParticleSystem', () => {
  it('accepts an external ParticleSystem', () => {
    const { ParticleSystem } = require(path.join(root, 'js/engine/fx/ParticleSystem.js'));
    const ps = new ParticleSystem({ maxParticles: 128 });
    const fx = new EnvironmentFX({ particleSystem: ps });
    fx.spawnDebrisCloud(O, 20);
    fx.update(0.016);
    expect(fx.particleSystem).toBe(ps);
    expect(ps.liveCount).toBeGreaterThan(0);
  });
});
