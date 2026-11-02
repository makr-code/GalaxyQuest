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
      version: 'planet-pipeline-2',
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
      clouds: descriptor.clouds, ice_caps: descriptor.ice,
      banding: descriptor.banding, craters: descriptor.craters, glow: descriptor.glow,
      // These only locate candidate lights. No city/economy state enters the maps.
      city_density: 0.65, city_grid: 0.6,
    }, { size: width, separateClouds: true });
    const { height } = raw;
    const surface = new Uint8Array(raw.albedo);
    const cloud = new Uint8Array(raw.cloud);
    const night = new Uint8Array(surface.length);
    const ocean = rgb(descriptor.oceanColor);
    for (let y = 0; y < height; y++) {
      const latitude = Math.abs(y / (height - 1) - 0.5) * Math.PI;
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const relief = (raw.bump[offset] - 45) / 210;
        const ice = descriptor.ice > 0 && latitude > (1 - descriptor.ice) * 1.08;
        const water = !ice && descriptor.ocean > 0 && relief < descriptor.ocean * 0.85;
        if (water) {
          for (let channel = 0; channel < 3; channel++) {
            surface[offset + channel] = Math.round(ocean[channel] * (0.65 + relief * 0.5) * 255);
          }
        }
        surface[offset + 3] = water ? 255 : 0;
        const glow = descriptor.variant === 'lava' ? raw.emissive[offset] * 2.5
          : water || ice ? 0 : raw.city[offset] * 4;
        night.set([Math.min(255, glow), Math.min(255, glow * 0.72), Math.min(255, glow * 0.3), 255], offset);
      }
    }
    const result = { width, height, surface, cloud, night, key };
    cache.set(key, result);
    while (cache.size > 8) cache.delete(cache.keys().next().value);
    return result;
  }

  const delta = dt => typeof dt === 'number' && Number.isFinite(dt) ? Math.max(0, Math.min(0.05, dt)) : 0;
  const api = { describe, maps, policy, state, palette, source, rgb, delta, cache };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GQPlanetLivingWorld = api;
})(typeof window !== 'undefined' ? window : globalThis);
