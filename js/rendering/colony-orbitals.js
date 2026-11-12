(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const EARTH_MU = 3.986004418e14;
  const MAX_OBJECTS = 12;
  const MAX_PARTS = 256;
  const TYPES = ['shipyard', 'missile_silo', 'solar_satellite'];
  const LABELS = { shipyard: 'Orbitalwerft', missile_silo: 'Verteidigungsstation', solar_satellite: 'Solarsatellit' };
  const hash = value => {
    let result = 2166136261;
    for (const c of String(value)) result = Math.imul(result ^ c.charCodeAt(0), 16777619) >>> 0;
    return result / 4294967296;
  };
  const rotate = (basis, p) => [0, 1, 2].map(i => basis.reduce((sum, axis, j) => sum + axis[i] * p[j], 0));
  const numeric = (value, name, min = 0) => {
    const n = typeof value === 'string' && value.trim() ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min) throw new RangeError(`Invalid orbital ${name}`);
    return n;
  };

  function bodySource(data) {
    const selected = data?.focusPlanet || data?.planet || data?.colony || data?.target || data || {};
    const slot = selected.__slot || selected.slot || selected;
    return { ...slot.generated_planet, ...slot.body, ...slot.player_planet, ...slot, ...selected, ...data?.colony };
  }

  function orbitalStock(data) {
    const body = bodySource(data);
    // An explicit authorized summary, including [], overrides any embedded public snapshot.
    const summary = data?.orbital_facilities ?? body.orbital_facilities;
    const levels = Object.fromEntries(TYPES.map(type => [type, 0]));
    const rows = summary ?? data?.buildings ?? [];
    if (!Array.isArray(rows)) throw new TypeError('Orbital stock must be an array');
    for (const row of rows) {
      if (!row || typeof row !== 'object') throw new TypeError('Invalid orbital stock row');
      if (!TYPES.includes(row.type) || row.meta?.zone === 'star_orbit' || row.meta?.zone === 'surface') continue;
      if (summary == null && row.type === 'solar_satellite') continue;
      const level = numeric(row.level, 'completed level');
      if (!Number.isInteger(level)) throw new RangeError('Orbital levels must be integers');
      levels[row.type] = Math.max(levels[row.type], level);
    }
    return levels;
  }

  function orbitDescriptor(body, radiusMeters, rotation, bound = 1) {
    numeric(radiusMeters, 'body radius', 1);
    numeric(bound, 'body bound', 1);
    if (body.mass_earth == null) return { available: false, reason: 'missing-mass' };
    const mu = EARTH_MU * numeric(body.mass_earth, 'body mass', 1e-12);
    const spin = numeric(Math.abs(rotation.periodHours), 'rotation period') * 3600;
    const minimum = radiusMeters * bound + Math.max(200000, radiusMeters * 0.08);
    const maximum = body.hill_radius_km == null ? radiusMeters * 32
      : Math.min(radiusMeters * 32, numeric(body.hill_radius_km, 'Hill radius', 0.001) * 1000 / 3);
    if (minimum >= maximum) return { available: false, reason: 'no-clear-orbit' };
    const synchronous = spin ? Math.cbrt(mu * (spin / TAU) ** 2) : 0;
    const stationary = !rotation.tidalLocked && synchronous > minimum && synchronous < maximum;
    const radius = stationary ? synchronous : minimum;
    return {
      available: true, mode: stationary ? 'synchronous' : 'keplerian',
      radiusMeters: radius, altitudeMeters: radius - radiusMeters, mu,
      periodSeconds: TAU * Math.sqrt(radius ** 3 / mu),
      spinSign: Math.sign(rotation.periodHours) || 1,
      epoch: rotation.epoch, rotationPeriod: rotation.periodHours * 3600,
    };
  }

  function components(type) {
    const parts = [];
    const add = (id, x, y, z, width, height, depth, shape = 0, color = [0.48, 0.54, 0.60], lamp = 0.6) =>
      parts.push({ id, offset: [x, y, z], size: [width, height, depth], shape, color, lamp });
    const panels = (offset, width, depth) => {
      for (const side of [-1, 1]) {
        add(`spar-${side}`, side * offset / 2, 0, 0, offset, 3, 3);
        add(`panel-${side}`, side * offset, 0, 0, width, 1, depth, 0, [0.025, 0.08, 0.22], 0);
      }
    };
    if (type === 'solar_satellite') {
      add('bus', 0, 0, 0, 8, 8, 12);
      panels(22, 30, 18);
      add('antenna', 0, 8, 0, 1, 10, 1);
    } else if (type === 'missile_silo') {
      add('hub', 0, 0, 0, 90, 45, 90, 1);
      panels(110, 90, 70);
      for (const side of [-1, 1]) {
        add(`habitat-${side}`, 0, 0, side * 85, 32, 32, 100);
        add(`launcher-${side}`, side * 30, 42, 0, 18, 45, 24, 1, [0.3, 0.34, 0.38]);
      }
      add('sensor', 0, 38, 0, 28, 8, 28, 1);
    } else {
      add('habitat', -170, 0, 0, 80, 65, 200);
      panels(280, 100, 160);
      for (const z of [-180, 180]) {
        add(`dock-rail-${z}`, 30, -85, z, 340, 12, 12);
        for (const x of [-120, 180]) {
          add(`gantry-${x}-${z}`, x, 0, z, 12, 180, 12);
        }
      }
      for (const x of [-120, 180]) add(`crossbeam-${x}`, x, 85, 0, 12, 12, 370);
      add('service-spine', 0, -85, 0, 320, 24, 32);
    }
    return parts;
  }

  function plan(data, manifest, rotation, bound = 1) {
    const body = bodySource(data), levels = orbitalStock(data);
    const diameter = body.diameter_km ?? body.diameter;
    const radiusMeters = manifest?.radius_km != null ? numeric(manifest.radius_km, 'body radius', 0.001) * 1000
      : diameter != null ? numeric(diameter, 'body diameter', 0.002) * 500 : null;
    if (!Object.values(levels).some(n => n > 0) || radiusMeters === null) {
      return { version: 1, radiusMeters, orbit: { available: false,
        reason: radiusMeters === null ? 'missing-radius' : 'no-stock' }, objects: [], levels };
    }
    const orbit = orbitDescriptor(body, radiusMeters, rotation, bound);
    const seed = manifest?.seed ?? body.terrain_seed ?? body.seed ?? body.body_id ?? body.id ?? 'planet';
    const active = body.powered !== false && body.active !== false;
    const objects = [];
    if (orbit.available) for (const [family, type] of TYPES.entries()) {
      const count = Math.min(4, levels[type]);
      for (let i = 0; i < count; i++) {
        const id = `${type}:${i}`;
        // Fixed family sectors keep old objects in place as stock grows.
        const phase = TAU * ((family + i / 4) / 3 + hash(`${seed}:orbit-v1:${id}`) / 24);
        objects.push({ id, type, label: LABELS[type], phase, parts: components(type), active });
      }
    }
    return { version: 1, radiusMeters, orbit, objects, levels };
  }

  function position(plan, object, seconds) {
    numeric(seconds, 'time', -1e12);
    const orbit = plan.orbit;
    let phase = object.phase;
    if (orbit.mode === 'keplerian') {
      const elapsed = seconds - orbit.epoch;
      const spin = orbit.rotationPeriod ? TAU * ((elapsed % orbit.rotationPeriod) / orbit.rotationPeriod) : 0;
      phase += TAU * ((elapsed % orbit.periodSeconds) / orbit.periodSeconds) * orbit.spinSign - spin;
    }
    const up = [Math.cos(phase), 0, Math.sin(phase)];
    return { center: up.map(n => n * orbit.radiusMeters / plan.radiusMeters),
      up, east: [-up[2], 0, up[0]], north: [0, 1, 0] };
  }

  function geometry(plan, seconds, basis, sun, eye, projectedPixels, motion = true, serviceSeconds = seconds) {
    const instances = [], parts = [];
    for (const object of plan.objects) {
      const frame = position(plan, object, seconds), world = rotate(basis, frame.center);
      const distance = Math.hypot(...world.map((v, i) => v - eye[i]));
      const span = Math.max(...object.parts.flatMap(p => p.size));
      if (span / plan.radiusMeters * projectedPixels / Math.max(distance, 1e-8) < 0.75) continue;
      const lightDot = world.reduce((sum, v, i) => sum + v * sun[i], 0);
      const shadowDistance = Math.hypot(...world.map((v, i) => v - lightDot * sun[i]));
      const eclipsed = lightDot < 0 && shadowDistance < 1;
      const add = part => {
        const p = frame.center.map((v, i) => v + (frame.east[i] * part.offset[0]
          + frame.up[i] * part.offset[1] + frame.north[i] * part.offset[2]) / plan.radiusMeters);
        instances.push(...p, part.size[0] / plan.radiusMeters, ...frame.east, part.size[2] / plan.radiusMeters,
          ...frame.north, part.size[1] / plan.radiusMeters, ...frame.up, part.shape,
          ...part.color.map(n => eclipsed ? n * 0.12 : n), 0.7,
          object.active ? part.lamp : 0, plan.radiusMeters, 0, 0);
        parts.push({ ...part, objectId: object.id, position: p, eclipsed });
      };
      object.parts.forEach(add);
      if (object.type === 'shipyard' && object.active) {
        const phase = motion ? TAU * (((serviceSeconds - plan.orbit.epoch) % 120) / 120) : 0;
        // A small local service loop, not an authoritative fleet or surface flight.
        add({ id: 'service-shuttle', offset: [30 + 220 * Math.sin(phase), 30 + 60 * Math.sin(phase * 2),
          100 + 180 * (1 - Math.cos(phase))], size: [12, 7, 24], shape: 0,
        color: [0.75, 0.65, 0.42], lamp: 0.4 });
      }
    }
    if (parts.length > MAX_PARTS) throw new RangeError('Orbital instance budget exceeded');
    return { parts, instances: new Float32Array(instances) };
  }

  const api = { EARTH_MU, MAX_OBJECTS, MAX_PARTS, TYPES, bodySource, orbitalStock, orbitDescriptor, components, plan, position, geometry };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GQColonyOrbitals = api;
})();
