import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../../js/rendering/colony-orbitals.js');
const solids = require('../../js/rendering/colony-facility-geometry.js');
const patterns = require('../../js/rendering/colony-surface-plan.js').FACILITY_PATTERN_WGSL;
const living = require('../../js/engine/zoom/levels/PlanetLivingWorld.js');
const radius = 6371008.8;
const manifest = { radius_km: radius / 1000, seed: 2026 };
const body = { mass_earth: 1, diameter_km: radius / 500, rotation_period_hours: 23.9344696,
  rotation_epoch_unix_seconds: 946728000, rotation_phase_deg: 0, axial_tilt_deg: 0, rotation_axis_node_deg: 0 };
const rotation = living.rotationDescriptor(body);
const stock = level => model.TYPES.map(type => ({ type, level }));
const plan = (level = 1, seed = 2026, overrides = {}) => model.plan({
  colony: { ...body, ...overrides }, orbital_facilities: stock(level),
}, { ...manifest, seed }, living.rotationDescriptor({ ...body, ...overrides }));
const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const close = (p, object = p.objects[0]) => {
  const center = model.position(p, object, rotation.epoch).center;
  return model.geometry(p, rotation.epoch, identity, [1, 0, 0], center.map(n => n * 1.00001), 1000);
};

describe('Bounded physical orbital visualization', () => {
  it('derives an equatorial synchronous orbit from mass and sidereal rotation, not a decorative altitude', () => {
    const p = plan();
    expect(p.orbit.mode).toBe('synchronous');
    expect(p.orbit.radiusMeters).toBeCloseTo(42164169.6, -1);
    expect(p.orbit.altitudeMeters).toBeCloseTo(35793160.8, -1);
    expect(p.orbit.periodSeconds).toBeCloseTo(body.rotation_period_hours * 3600, 6);
    const retrograde = plan(1, 2026, { rotation_period_hours: -23.9344696 });
    expect(retrograde.orbit.radiusMeters).toBe(p.orbit.radiusMeters);
    expect(retrograde.orbit.spinSign).toBe(-1);
    const first = model.position(p, p.objects[0], rotation.epoch);
    const next = model.position(p, p.objects[0], rotation.epoch + 9000);
    expect(first).toEqual(next);
    expect(first.center[1]).toBe(0);
    const initialWorld = living.rotateVector(living.bodyOrientation(body, manifest, rotation.epoch).basis, first.center);
    const laterWorld = living.rotateVector(living.bodyOrientation(body, manifest, rotation.epoch + p.orbit.periodSeconds / 4).basis, next.center);
    expect(initialWorld.reduce((sum, n, i) => sum + n * laterWorld[i], 0)).toBeCloseTo(0, 5);
  });

  it('uses explicit unavailable states for missing physics and real Keplerian fallback for unsuitable synchronous orbits', () => {
    expect(plan(1, 2026, { mass_earth: null }).orbit).toEqual({ available: false, reason: 'missing-mass' });
    expect(plan(1, 2026, { mass_earth: null }).objects).toEqual([]);
    expect(() => plan(1, 2026, { mass_earth: NaN })).toThrow(/mass/);
    const stopped = plan(1, 2026, { rotation_period_hours: 0 });
    expect(stopped.orbit.mode).toBe('keplerian');
    expect(stopped.orbit.radiusMeters).toBeGreaterThan(radius + 200000);
    expect(stopped.orbit.periodSeconds).toBeCloseTo(2 * Math.PI * Math.sqrt(stopped.orbit.radiusMeters ** 3 / model.EARTH_MU), 6);
    const first = model.position(stopped, stopped.objects[0], rotation.epoch);
    const quarter = model.position(stopped, stopped.objects[0], rotation.epoch + stopped.orbit.periodSeconds / 4);
    expect(first.center.reduce((sum, n, i) => sum + n * quarter.center[i], 0)).toBeCloseTo(0, 5);
    const tightHill = plan(1, 2026, { hill_radius_km: radius / 1000 * 2 });
    expect(tightHill.orbit).toEqual({ available: false, reason: 'no-clear-orbit' });
    expect(plan(1, 2026, { rotation_period_hours: 100000 }).orbit.mode).toBe('keplerian');
    const deformed = model.orbitDescriptor(body, radius, rotation, 1.8);
    expect(deformed.radiusMeters).toBeGreaterThan(radius * 1.8);
    expect(model.plan({}, null, rotation).orbit.reason).toBe('missing-radius');
  });

  it('consumes authorized completed orbital summaries and never turns star installations or queues into planet objects', () => {
    const data = { focusPlanet: { __slot: { generated_planet: body,
      player_planet: { orbital_facilities: stock(1) } } } };
    expect(model.orbitalStock(data)).toEqual({ shipyard: 1, missile_silo: 1, solar_satellite: 1 });
    expect(model.orbitalStock({ ...data, orbital_facilities: [] })).toEqual({ shipyard: 0, missile_silo: 0, solar_satellite: 0 });
    expect(model.orbitalStock({ buildings: [...stock(3), { type: 'stargate', level: 10 },
      { type: 'relay_station', level: 99 }, { type: 'shipyard', level: 100, meta: { zone: 'star_orbit' } }],
    upgrade_queue: stock(100) })).toEqual({ shipyard: 3, missile_silo: 3, solar_satellite: 0 });
    expect(() => model.orbitalStock({ orbital_facilities: [{ type: 'shipyard', level: -1 }] })).toThrow(/level/);
    expect(() => model.orbitalStock({ orbital_facilities: [{ type: 'shipyard', level: 1.5 }] })).toThrow(/integers/);
    expect(() => model.orbitalStock({ orbital_facilities: {} })).toThrow(/array/);
    expect(model.plan(data, manifest, rotation).objects).toHaveLength(3);
    expect(plan(0).objects).toEqual([]);
  });

  it('adds stable stock representatives without scaling existing meshes or moving old slots', () => {
    const young = plan(), grown = plan(999);
    expect(plan()).toEqual(young);
    expect(plan(1, 2027).objects).not.toEqual(young.objects);
    expect(grown.objects).toHaveLength(model.MAX_OBJECTS);
    for (const object of young.objects) expect(grown.objects.find(other => other.id === object.id)).toEqual(object);
    const spans = young.objects.map(object => Math.max(...object.parts.flatMap(p => p.size)));
    expect(new Set(spans).size).toBe(3);
    for (const object of young.objects) {
      for (const part of object.parts) expect(part.size.every(n => n > 0 && n <= 370)).toBe(true);
    }
    const output = model.geometry(grown, rotation.epoch, identity, [1, 0, 0], [0, 0, 0], 1e9);
    expect(output.parts.length).toBeLessThanOrEqual(model.MAX_PARTS);
    expect(output.instances.byteLength).toBeLessThanOrEqual(model.MAX_PARTS * 96);
    expect(output.instances.every(Number.isFinite)).toBe(true);
  });

  it('keeps real metre dimensions, culls subpixel objects and animates only bounded cosmetic service shuttles', () => {
    const p = plan(), object = p.objects[0], frame = model.position(p, object, rotation.epoch);
    expect(model.geometry(p, rotation.epoch, identity, [1, 0, 0], [0, 0, 4], 1000).parts).toEqual([]);
    const eye = frame.center.map(n => n * 1.00001);
    const before = close(p);
    const shuttle = before.parts.find(part => part.id === 'service-shuttle');
    const after = model.geometry(p, rotation.epoch + 30, identity, [1, 0, 0], eye, 1000);
    expect(after.parts.find(part => part.id === 'service-shuttle').position).not.toEqual(shuttle.position);
    for (const part of before.parts.filter(part => part.id !== 'service-shuttle')) {
      expect(after.parts.find(other => other.id === part.id && other.objectId === part.objectId)).toEqual(part);
    }
    const paused = time => model.geometry(p, time, identity, [1, 0, 0], eye, 1000, false);
    expect(paused(rotation.epoch)).toEqual(paused(rotation.epoch + 30));
    const hullIndex = before.parts.findIndex(part => part.id === 'habitat');
    expect(before.instances[hullIndex * 24 + 3] * radius).toBeCloseTo(80, 4);
    expect(before.instances[hullIndex * 24 + 11] * radius).toBeCloseTo(65, 4);
    expect(plan(1, 2026, { powered: false }).objects.every(o => o.active === false)).toBe(true);
    expect(close(plan(1, 2026, { powered: false })).parts.some(part => part.id === 'service-shuttle')).toBe(false);
    const sun = frame.up.map(n => -n);
    expect(model.geometry(p, rotation.epoch, identity, sun, eye, 1000).parts.every(part => part.eclipsed)).toBe(true);
  });

  it('reuses the instance buffer for moving traffic and destroys owned GPU resources exactly once', () => {
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 });
    const buffers = [];
    const device = {
      createShaderModule: () => ({}), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
      createBindGroup: () => ({}), queue: { writeBuffer: vi.fn() },
      createBuffer(descriptor) {
        const buffer = { ...descriptor, destroy: vi.fn() };
        buffers.push(buffer);
        return buffer;
      },
    };
    try {
      const renderer = solids.createFacilityRenderer(device, 'rgba8unorm', patterns, 'colony_orbitals');
      const output = close(plan());
      for (let i = 0; i < 10; i++) renderer.update(output);
      expect(buffers).toHaveLength(2);
      renderer.update({ parts: [], instances: new Float32Array() });
      renderer.dispose(); renderer.dispose();
      expect(buffers.every(buffer => buffer.label.startsWith('colony_orbitals'))).toBe(true);
      for (const buffer of buffers) expect(buffer.destroy).toHaveBeenCalledTimes(1);
      expect(() => renderer.update(output)).toThrow(/disposed/);
    } finally { vi.unstubAllGlobals(); }
  });
});
