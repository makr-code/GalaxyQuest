import { describe, expect, it } from 'vitest';

const world = require('../../js/engine/zoom/levels/PlanetLivingWorld.js');
const epoch = world.ROTATION_EPOCH;
const body = { body_id: 12, seed: 35, rotation_period_hours: 24, axial_tilt_deg: 23.44,
  rotation_axis_node_deg: 31, rotation_phase_deg: 0, rotation_epoch_unix_seconds: epoch,
  star_direction: [1,0,0] };
const close = (a,b) => a.forEach((value,i) => expect(value).toBeCloseTo(b[i],9));

describe('Analytic body rotation in physical seconds', () => {
  it('uses the seed and explicit metadata, not owner, camera, quality or settlement state', () => {
    const manifest = { seed: 35, radius_km: 6371 };
    const a = world.rotationDescriptor({ colony: { id: 8, owner_id: 1, population: 100 } },manifest);
    const b = world.rotationDescriptor({ colony: { id: 9, owner_id: 2, population: 10000 },
      reduced_motion: true, vfx_quality: 'off' },manifest);
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a.periodHours).toBeGreaterThanOrEqual(12);
    expect(a.periodHours).toBeLessThanOrEqual(60);
    expect(world.rotationDescriptor({ seed: 36 })).not.toEqual(world.rotationDescriptor({ seed: 35 }));
    expect(world.rotationDescriptor({ planet: body }).periodHours).toBe(24);
    expect(world.rotationDescriptor({ focusPlanet: { __slot: { generated_planet: body } } }).periodHours).toBe(24);
  });

  it('completes precisely one physical day, with continuous phase at the epoch and period wrap', () => {
    const first = world.bodyOrientation(body,null,epoch);
    const quarter = world.bodyOrientation(body,null,epoch + 21600);
    expect(quarter.angle).toBeCloseTo(Math.PI / 2,10);
    first.basis.forEach((column,i) => close(column,world.bodyOrientation(body,null,epoch + 86400).basis[i]));
    expect(world.bodyOrientation(body,null,epoch - 21600).angle).toBeCloseTo(Math.PI * 1.5,10);
    close(world.bodyOrientation(body,null,epoch + 86400 - 0.001).basis[0],
      world.bodyOrientation(body,null,epoch - 0.001).basis[0]);
    expect(world.bodyOrientation(body,null,epoch + 3600).angle).toBeCloseTo(Math.PI / 12,10);
  });

  it('supports retrograde and stationary bodies without accumulating frame deltas', () => {
    expect(world.bodyOrientation({ ...body, rotation_period_hours: -24 },null,epoch + 21600).angle)
      .toBeCloseTo(Math.PI * 1.5,10);
    expect(world.bodyOrientation({ ...body, rotation_period_hours: 0 },null,epoch + 1e9).angle).toBe(0);
    const late = world.bodyOrientation(body,null,epoch + 43200);
    world.bodyOrientation(body,null,epoch + 1);
    expect(world.bodyOrientation(body,null,epoch + 43200)).toEqual(late);
    expect(world.bodyOrientation({ ...body, reduced_motion: true, vfx_enabled: false },null,epoch + 43200))
      .toEqual(late);
  });

  it('keeps tilted axes orthonormal, right handed and invertible at poles and arbitrary phases', () => {
    for (const tilt of [0,23.44,90,177,180]) {
      for (const phase of [0,0.5,Math.PI,Math.PI * 2]) {
        const basis = world.rotationBasis(phase,tilt * Math.PI / 180,1.3);
        for (let i = 0; i < 3; i++) {
          expect(Math.hypot(...basis[i])).toBeCloseTo(1,12);
          for (let j = 0; j < i; j++) expect(basis[i].reduce((sum,n,k) => sum + n * basis[j][k],0)).toBeCloseTo(0,12);
        }
        const [x,y,z] = basis;
        close([x[1] * y[2] - x[2] * y[1],x[2] * y[0] - x[0] * y[2],x[0] * y[1] - x[1] * y[0]],z);
        close(world.unrotateVector(basis,world.rotateVector(basis,[1.3,-4.2,0.7])),[1.3,-4.2,0.7]);
      }
    }
  });

  it('separates optional presentation orientation from the physical descriptor and phase', () => {
    const a = world.bodyOrientation(body,null,epoch + 100);
    const b = world.bodyOrientation(body,null,epoch + 100,0.5);
    expect(a.angle).toBe(b.angle);
    expect(a.descriptor).toEqual(b.descriptor);
    expect(a.sun).toEqual(b.sun);
    expect(a.basis).not.toEqual(b.basis);
  });

  it('produces day/night in body coordinates while holding the sun fixed in world coordinates', () => {
    const data = { ...body, axial_tilt_deg: 0, rotation_axis_node_deg: 0 };
    close(world.bodyOrientation(data,null,epoch).canonicalSun,[1,0,0]);
    close(world.bodyOrientation(data,null,epoch + 43200).canonicalSun,[-1,0,0]);
    close(world.bodyOrientation(data,null,epoch + 43200).sun,[1,0,0]);
  });

  it('uses explicit ephemerides for sun direction, but never invents an epoch for catalogue phase', () => {
    const orbit = { ...body, star_direction: undefined, orbital_period_days: 4, polar_theta_rad: 0,
      orbital_epoch_unix_seconds: epoch };
    close(world.bodyOrientation(orbit,null,epoch).sun,[-1,0,0]);
    close(world.bodyOrientation(orbit,null,epoch + 86400).sun,[0,0,-1]);
    const staticOrbit = { ...orbit, orbital_epoch_unix_seconds: undefined };
    expect(world.bodyOrientation(staticOrbit,null,epoch + 86400).sunSource).toBe('catalogue-phase');
    close(world.bodyOrientation(staticOrbit,null,epoch + 86400).sun,[-1,0,0]);
    const eccentric = { ...orbit, orbital_eccentricity: 0.9 };
    const first = world.bodyOrientation(eccentric,null,epoch + 172800);
    close(first.sun,[1,0,0]);
    expect(first.sunSource).toBe('ephemeris');
    expect(world.bodyOrientation({ seed: 35 },null,epoch).sunSource).toBe('reference');
  });

  it('locks only explicitly declared circular ephemerides and keeps the same face toward the parent', () => {
    const locked = { seed: 35, tidal_locked: true, orbital_period_days: 4, polar_theta_rad: 0.3,
      orbital_epoch_unix_seconds: epoch, orbital_inclination_deg: 19, orbital_ascending_node_deg: 38 };
    for (const t of [0,10000,86400,1e9]) {
      const state = world.bodyOrientation(locked,null,epoch + t);
      expect(state.descriptor.tidalLocked).toBe(true);
      expect(state.descriptor.periodHours).toBe(96);
      close(state.canonicalSun,[1,0,0]);
    }
    expect(() => world.rotationDescriptor({ ...locked, orbital_eccentricity: 0.1 })).toThrow('circular');
    expect(() => world.rotationDescriptor({ ...locked, orbital_epoch_unix_seconds: undefined })).toThrow('epoch');
    expect(() => world.rotationDescriptor({ ...locked, axial_tilt_deg: 0 })).toThrow('conflicts');
    expect(world.rotationDescriptor({ body_type: 'moon', seed: 35 }).tidalLocked).toBe(false);
  });

  it('bounds seed-based periods above breakup when physical mass and radius are available', () => {
    const dense = { seed: 35, mass_earth: 1, diameter_km: 12742 };
    const descriptor = world.rotationDescriptor(dense);
    expect(descriptor.periodHours).toBeGreaterThan(1.4);
    expect(() => world.rotationDescriptor({ ...dense, rotation_period_hours: 1 })).toThrow('breakup');
    expect(world.rotationDescriptor({ ...dense, rotation_period_hours: 0 }).periodHours).toBe(0);
  });

  it.each([
    { rotation_period_hours: NaN }, { rotation_period_hours: Infinity }, { rotation_period_hours: '' },
    { axial_tilt_deg: -1 }, { axial_tilt_deg: 181 }, { rotation_epoch_unix_seconds: 'bad' },
    { rotation_axis_node_deg: Infinity }, { tidal_locked: 1 },
  ])('rejects malformed explicit spin fields rather than silently substituting seed defaults: %j', data => {
    expect(() => world.rotationDescriptor(data)).toThrow();
  });

  it('rejects invalid star vectors and time values explicitly', () => {
    for (const direction of [[0,0,0],[1,2],['1',0,0],[NaN,0,1]]) {
      expect(() => world.bodyOrientation({ ...body, star_direction: direction },null,epoch)).toThrow('star_direction');
    }
    expect(() => world.bodyOrientation(body,null,NaN)).toThrow('rotation time');
  });
});
