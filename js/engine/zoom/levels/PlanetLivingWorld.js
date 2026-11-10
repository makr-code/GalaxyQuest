(function (root) {
  'use strict';

  // Planet maps are deliberately not rock PBR maps. Only public terrain enters this
  // bounded CPU cache; settlement activity and ownership remain per-view uniforms.
  const cache = new Map();
  const Pipeline = typeof require !== 'undefined'
    ? require('../../../rendering/planet-textures.js') : root.GQPlanetTexturePipeline;
  const finite = (value, fallback, min = 0, max = 1) => {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number)
      ? Math.max(min, Math.min(max, number)) : fallback;
  };
  const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const bodyOf = slot => record(slot.player_planet) || record(slot.generated_planet)
    || record(slot.body) || slot;
  const source = data => {
    const selected = data?.focusPlanet || data?.planet || data?.colony || data?.target || data || {};
    const slot = record(selected.__slot) || record(selected.slot) || selected;
    const body = bodyOf(slot);
    return { ...body, ...slot, ...selected, position: slot.position ?? selected.position ?? body.position };
  };
  const color = (value, fallback) => /^#?[0-9a-f]{6}$/i.test(String(value || '').trim())
    ? `#${String(value).trim().replace('#', '')}` : fallback;
  const rgb = value => [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const hash = value => {
    let result = 2166136261;
    for (const character of String(value).slice(0, 128)) result = Math.imul(result ^ character.charCodeAt(0), 16777619) >>> 0;
    return result;
  };
  const TAU = Math.PI * 2;
  const ROTATION_EPOCH = 946728000; // J2000, Unix seconds.
  const wrap = angle => ((angle % TAU) + TAU) % TAU;
  const radians = degrees => degrees * Math.PI / 180;
  function rotationNumber(body, key, fallback, min, max) {
    if (body[key] == null) return fallback;
    const value = typeof body[key] === 'string' && body[key].trim() ? Number(body[key]) : body[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`Invalid body rotation field: ${key}`);
    }
    return value;
  }

  function rotationDescriptor(data, manifest = null) {
    const body = { ...data?.colony, ...source(data) };
    const terrain = manifest || data?.bodyTerrainManifest || data?.body_terrain_manifest || {};
    const seed = terrain.seed ?? body.terrain_seed ?? body.seed ?? body.body_id ?? body.planet_id ?? body.id ?? 'planet';
    const random = key => hash(`${seed}:rotation-v1:${key}`) / 4294967296;
    const kind = `${body.body_type || ''} ${terrain.biome || body.planet_class || body.planet_type || ''}`;
    const giant = /gas|jovian|giant/i.test(kind);
    let period = giant ? 8 + random('period') * 12 : 12 + random('period') * 48;
    const mass = rotationNumber(body, 'mass_earth', null, 0.000000001, 1e9);
    const radius = terrain.radius_km ?? (body.diameter_km == null ? null
      : rotationNumber(body, 'diameter_km', null, 0.000001, 1e9) / 2);
    let breakup = 0;
    if (mass !== null && radius !== null) {
      if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Invalid rotation body radius');
      breakup = TAU * Math.sqrt((radius * 1000) ** 3 / (3.986004418e14 * mass)) / 3600;
      period = Math.max(period,breakup * 1.25);
    }
    period = rotationNumber(body, 'rotation_period_hours', period, -1e9, 1e9);
    if (period !== 0 && Math.abs(period) < Math.max(0.000001,breakup)) {
      throw new RangeError('Body rotation period is below centrifugal breakup limit');
    }
    const descriptor = {
      version: 1, periodHours: period,
      tilt: radians(rotationNumber(body, 'axial_tilt_deg', random('tilt') * (giant ? 30 : 45), 0, 180)),
      node: radians(rotationNumber(body, 'rotation_axis_node_deg', random('node') * 360, -1e9, 1e9)),
      phase: radians(rotationNumber(body, 'rotation_phase_deg', random('phase') * 360, -1e9, 1e9)),
      epoch: rotationNumber(body, 'rotation_epoch_unix_seconds', ROTATION_EPOCH, -1e12, 1e12),
      explicit: body.rotation_period_hours != null, tidalLocked: false,
    };
    if (body.tidal_locked != null && typeof body.tidal_locked !== 'boolean') {
      throw new TypeError('tidal_locked must be a boolean');
    }
    if (body.tidal_locked === true) {
      const orbit = rotationOrbit(body);
      if (!orbit || body.orbital_epoch_unix_seconds == null || orbit.eccentricity !== 0) {
        throw new RangeError('Tidal locking requires an explicit epoch and a circular orbital ephemeris');
      }
      if (['rotation_period_hours','axial_tilt_deg','rotation_axis_node_deg','rotation_epoch_unix_seconds']
        .some(key => body[key] != null)) throw new RangeError('Tidal lock conflicts with explicit free-spin parameters');
      descriptor.periodHours = orbit.period / 3600;
      descriptor.tilt = orbit.inclination;
      descriptor.node = orbit.node;
      descriptor.phase = orbit.phase + Math.PI + radians(rotationNumber(body,'rotation_phase_deg',0,-1e9,1e9));
      descriptor.epoch = orbit.epoch;
      descriptor.tidalLocked = true;
    }
    return Object.freeze(descriptor);
  }

  function rotationOrbit(body) {
    if (body.orbital_period_days == null || body.polar_theta_rad == null) return null;
    return {
      period: rotationNumber(body,'orbital_period_days',null,0.000001,1e9) * 86400,
      phase: rotationNumber(body,'polar_theta_rad',null,-1e9,1e9),
      eccentricity: rotationNumber(body,'orbital_eccentricity',0,0,0.99),
      inclination: radians(rotationNumber(body,'orbital_inclination_deg',0,0,180)),
      node: radians(rotationNumber(body,'orbital_ascending_node_deg',0,-1e9,1e9)),
      epoch: rotationNumber(body,'orbital_epoch_unix_seconds',ROTATION_EPOCH,-1e12,1e12),
    };
  }

  function rotationBasis(angle, tilt = 0, node = 0) {
    const c = Math.cos(angle), s = Math.sin(angle), t = Math.cos(tilt), u = Math.sin(tilt);
    const n = Math.cos(node), m = Math.sin(node);
    // Columns map body X/Y/Z into the renderer's XZ orbital plane (Y up).
    return [[c * t * n - s * m,c * u,c * t * m + s * n],
      [-u * n,t,-u * m],[-s * t * n - c * m,-s * u,-s * t * m + c * n]];
  }
  const rotateVector = (basis, vector) => [0,1,2].map(axis =>
    basis[0][axis] * vector[0] + basis[1][axis] * vector[1] + basis[2][axis] * vector[2]);
  const unrotateVector = (basis, vector) => basis.map(column => column.reduce((sum,n,i) => sum + n * vector[i],0));

  function bodyOrientation(data, manifest = null, unixSeconds = Date.now() / 1000, presentationAngle = 0) {
    if (!Number.isFinite(unixSeconds) || !Number.isFinite(presentationAngle)) throw new RangeError('Invalid rotation time or presentation angle');
    const descriptor = rotationDescriptor(data,manifest);
    const period = descriptor.periodHours * 3600;
    const turns = period === 0 ? 0 : ((unixSeconds - descriptor.epoch) % period) / period;
    const angle = wrap(descriptor.phase + turns * TAU);
    const basis = rotationBasis(angle + presentationAngle,descriptor.tilt,descriptor.node);
    const body = { ...data?.colony, ...source(data) };
    let sun = [-0.7,0.8,1];
    let sunSource = 'reference';
    if (body.star_direction != null) {
      if (!Array.isArray(body.star_direction) || body.star_direction.length !== 3
          || !body.star_direction.every(Number.isFinite) || Math.hypot(...body.star_direction) < 1e-12) {
        throw new TypeError('Invalid body star_direction');
      }
      sun = body.star_direction;
      sunSource = 'explicit';
    } else {
      const orbit = rotationOrbit(body);
      if (orbit) {
        let anomaly = orbit.phase;
        if (body.orbital_epoch_unix_seconds != null) {
          const e = orbit.eccentricity;
          const initialE = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(anomaly / 2),Math.sqrt(1 + e) * Math.cos(anomaly / 2));
          const mean = wrap(initialE - e * Math.sin(initialE) + ((unixSeconds - orbit.epoch) % orbit.period) / orbit.period * TAU);
          let eccentric = e < 0.8 ? mean : Math.PI;
          for (let i = 0; i < 16; i++) eccentric -= (eccentric - e * Math.sin(eccentric) - mean) / (1 - e * Math.cos(eccentric));
          anomaly = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(eccentric / 2),Math.sqrt(1 - e) * Math.cos(eccentric / 2));
          sunSource = 'ephemeris';
        } else sunSource = 'catalogue-phase';
        sun = rotateVector(rotationBasis(anomaly,orbit.inclination,orbit.node),[-1,0,0]);
      }
    }
    const length = Math.hypot(...sun);
    sun = sun.map(n => n / length);
    return { descriptor, angle, basis, sun, canonicalSun: unrotateVector(basis,sun), sunSource };
  }

  function describe(data) {
    const planet = source(data);
    const body = bodyOf(planet);
    const manifest = data?.systemPayload?.planet_texture_manifest || data?.planet_texture_manifest;
    const existing = manifest?.planets?.[String(planet.position ?? body.position ?? planet.slot_index ?? '')];
    const terrain = planet.appearance?.terrain || planet.terrain || planet.texture_descriptor
      || body.texture_descriptor || existing || body.appearance?.terrain || body.appearance || body;
    const kind = String(terrain.variant || body.planet_class || planet.planet_class || terrain.biome || '').toLowerCase();
    const variant = /gas|jovian/.test(kind) ? 'gas' : /ice|icy|frozen|arctic/.test(kind) ? 'ice'
      : /ocean|water/.test(kind) ? 'ocean' : /lava|volcan|molten/.test(kind) ? 'lava'
        : /desert|arid/.test(kind) ? 'desert' : /terra|earth|temperate|continental/.test(kind) ? 'terrestrial'
          : kind ? 'rocky' : 'terrestrial';
    const seed = terrain.seed ?? body.seed ?? planet.seed ?? planet.planet_id ?? body.id
      ?? planet.id ?? body.position ?? planet.position ?? 0;
    const land = color(terrain.palette?.land || terrain.palette?.base,
      variant === 'lava' ? '#522719' : variant === 'rocky' ? '#8c8173'
        : ['gas', 'desert'].includes(variant) ? '#bd9e75' : '#688253');
    const descriptor = {
      version: 'planet-pipeline-4',
      seed: typeof seed === 'number' && Number.isFinite(seed) ? seed >>> 0 : hash(seed),
      variant,
      ocean: finite(terrain.ocean ?? terrain.water, variant === 'ocean' ? 0.9 : variant === 'terrestrial' ? 0.56 : 0),
      clouds: finite(terrain.clouds, ['terrestrial', 'ocean'].includes(variant) ? 0.52 : 0),
      atmosphere: finite(terrain.atmosphere, ['terrestrial', 'ocean', 'gas'].includes(variant) ? 0.8 : 0.12),
      ice: finite(terrain.ice_caps, variant === 'ice' ? 0.95 : variant === 'terrestrial' ? 0.18 : 0),
      banding: finite(terrain.banding, variant === 'gas' ? 0.7 : 0.16),
      craters: finite(terrain.craters, variant === 'rocky' ? 0.45 : 0),
      glow: finite(terrain.glow, variant === 'lava' ? 0.3 : 0),
      land,
      secondary: color(terrain.palette?.secondary, land),
      accent: color(terrain.palette?.accent, variant === 'lava' ? '#ff6622' : '#b2bd9a'),
      iceColor: color(terrain.palette?.ice, '#dce8f2'),
      oceanColor: color(terrain.palette?.ocean || (variant === 'ocean' ? terrain.palette?.secondary : null), '#124978'),
    };
    return Object.freeze(descriptor);
  }

  function policy(data) {
    const planet = source(data);
    const options = { ...planet, ...data };
    const quality = ['off', 'low', 'medium', 'high'].includes(options.vfx_quality)
      ? options.vfx_quality : 'medium';
    const media = query => typeof root?.matchMedia === 'function' && root.matchMedia(query).matches;
    const enabled = options.vfx_enabled !== false && quality !== 'off';
    return {
      quality, enabled, size: quality === 'high' ? 256 : quality === 'low' ? 64 : 128,
      visible: options.visible !== false && options.planet_visible !== false
        && !(typeof document !== 'undefined' && document.hidden),
      motion: enabled && options.reduced_motion !== true && !media('(prefers-reduced-motion: reduce)'),
      reducedFlash: options.reduced_flash === true || media('(prefers-reduced-flash: reduce)'),
    };
  }

  function state(data) {
    const planet = source(data);
    const effects = planet.appearance?.effects?.state || planet.effects?.state || {};
    const activity = finite(effects.activity ?? planet.activity, 1);
    const damage = finite(effects.damage ?? planet.damage, 0);
    const explicit = finite(planet.night_lights ?? planet.city_lights ?? effects.night_lights, 0);
    return planet.powered === false || planet.active === false ? 0 : explicit * activity * (1 - damage);
  }

  function palette(data) {
    const planet = source(data);
    const owner = planet.colony_owner_color || planet.owner_color || planet.faction_color;
    const isOwned = !!String(owner || '').trim();
    const isPlayer = Number(planet.colony_is_player || planet.is_player || 0) === 1;
    return {
      ownerColor: color(owner, '#7db7ee'), isOwned, isPlayer,
      surfaceColor: '#ffffff', cloudColor: '#f4fbff', atmosphereColor: '#55aaff',
      ringColor: isPlayer ? '#7dffb2' : color(owner, '#7db7ee'), clearColor: '#040814',
      base: [0.2, 0.45, 0.8], atmo: [0.33, 0.67, 1], clear: [0.016, 0.031, 0.078],
    };
  }

  function maps(descriptor, size = 128) {
    const width = [64, 128, 256].includes(size) ? size : 128;
    const key = JSON.stringify([descriptor, width]);
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key); cache.set(key, hit);
      return hit;
    }
    const raw = Pipeline.generateRawMaps({
      seed: descriptor.seed, variant: descriptor.variant === 'terrestrial' ? 'rocky' : descriptor.variant,
      palette: { base: descriptor.land, secondary: descriptor.secondary,
        accent: descriptor.accent, ice: descriptor.iceColor },
      clouds: descriptor.clouds, ice_caps: 0,
      banding: descriptor.banding, craters: descriptor.craters, glow: descriptor.glow,
      // These only locate candidate lights. No city/economy state enters the maps.
      city_density: 0.65, city_grid: 0.6,
    }, { size: width, separateClouds: true });
    const { height } = raw;
    const surface = new Uint8Array(raw.albedo);
    const land = new Uint8Array(raw.albedo);
    const geographyWidth = width * 4, geographyHeight = height * 4;
    const geography = new Uint8Array(geographyWidth * geographyHeight * 4);
    for (let y = 0; y < geographyHeight; y++) {
      for (let x = 0; x < geographyWidth; x++) {
        const offset = (y * geographyWidth + x) * 4;
        const relief = Math.round(Pipeline.terrainRelief(descriptor.seed,
          (x + 0.5) / geographyWidth, (y + 0.5) / geographyHeight) * 65535);
        // Linear RG filtering commutes with this weighted 16-bit decode.
        geography[offset] = relief >>> 8;
        geography[offset + 1] = relief & 255;
        geography[offset + 3] = 255;
      }
    }
    const cloud = new Uint8Array(raw.cloud);
    const night = new Uint8Array(surface.length);
    const ocean = rgb(descriptor.oceanColor);
    const iceColor = rgb(descriptor.iceColor).map(channel => Math.round(channel * 255));
    for (let y = 0; y < height; y++) {
      const latitude = Math.abs((y + 0.5) / height - 0.5) * Math.PI;
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const relief = Pipeline.terrainRelief(descriptor.seed, (x + 0.5) / width, (y + 0.5) / height);
        const ice = descriptor.ice > 0 && latitude > (1 - descriptor.ice) * 1.08;
        const water = !ice && descriptor.ocean > 0 && relief < descriptor.ocean * 0.85;
        if (water) {
          for (let channel = 0; channel < 3; channel++) {
            surface[offset + channel] = Math.round(ocean[channel] * (0.65 + relief * 0.5) * 255);
          }
        }
        if (ice) surface.set(iceColor, offset);
        surface[offset + 3] = water ? 255 : 0;
        const glow = descriptor.variant === 'lava' ? raw.emissive[offset] * 2.5
          : raw.city[offset] * 4;
        night.set([Math.min(255, glow), Math.min(255, glow * 0.72), Math.min(255, glow * 0.3), 255], offset);
      }
    }
    const result = { width, height, geographyWidth, geographyHeight, surface, land, geography, cloud, night, key };
    cache.set(key, result);
    while (cache.size > 8) cache.delete(cache.keys().next().value);
    return result;
  }

  const delta = dt => typeof dt === 'number' && Number.isFinite(dt) ? Math.max(0, Math.min(0.05, dt)) : 0;
  const api = { describe, maps, policy, state, palette, source, rgb, delta, cache,
    ROTATION_EPOCH, rotationDescriptor, rotationBasis, rotateVector, unrotateVector, bodyOrientation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GQPlanetLivingWorld = api;
})(typeof window !== 'undefined' ? window : globalThis);
