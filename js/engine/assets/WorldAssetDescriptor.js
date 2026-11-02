(function (root) {
  'use strict';

  const VERSION = 'coherent-pbr-1';
  const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const finite = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;
  const choice = (value, values, fallback) => values.includes(value) ? value : fallback;
  const token = (value, fallback) => typeof value === 'string'
    ? value.slice(0, 48).toLowerCase().replace(/[^a-z0-9_-]/g, '') || fallback : fallback;
  const vector = (value, fallback, min, max) => fallback.map((n, i) =>
    finite(Array.isArray(value) ? value[i] : undefined, n, min, max));
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };

  class WorldAssetDescriptor {
    static hash(value) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      let a = 2166136261;
      let b = 2246822507;
      for (let i = 0; i < text.length; i++) {
        a = Math.imul(a ^ text.charCodeAt(i), 16777619) >>> 0;
        b = Math.imul(b ^ text.charCodeAt(i), 3266489909) >>> 0;
      }
      return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
    }

    static random(seed) {
      let state = typeof seed === 'number' && Number.isFinite(seed) ? seed >>> 0 : 0;
      return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
    }

    static normalize(input = {}) {
      const source = record(input);
      const geometry = record(source.geometry);
      const effects = record(source.effects);
      const state = record(effects.state);
      const seed = typeof source.seed === 'string'
        ? parseInt(this.hash(source.seed.slice(0, 128)).slice(0, 8), 16)
        : Math.trunc(finite(source.seed, 0, -4294967295, 4294967295)) >>> 0;
      const random = this.random(seed);
      const anchors = (Array.isArray(effects.anchors) ? effects.anchors.slice(0, 16) : []).map(value => {
        const anchor = record(value);
        const direction = vector(anchor.direction, [0, 1, 0], -1, 1);
        const length = Math.hypot(...direction);
        return {
          type: choice(anchor.type, ['exhaust', 'vent', 'window', 'beacon', 'energy'], 'vent'),
          position: vector(anchor.position, [0, 0, 0], -1000, 1000),
          direction: length > 0 ? direction.map(n => n / length) : [0, 1, 0],
          intensity: finite(anchor.intensity, 1, 0, 4),
        };
      });
      const color = Array.isArray(source.color)
        ? vector(source.color, [0.35, 0.43, 0.52], 0, 1)
        : typeof source.color === 'number' && Number.isFinite(source.color)
          ? [16, 8, 0].map(shift => ((Math.max(0, Math.min(0xffffff, source.color)) >>> shift) & 255) / 255)
          : [0.35, 0.43, 0.52];
      const descriptor = {
        schemaVersion: 1,
        generatorVersion: VERSION,
        seed,
        materialFamily: choice(source.materialFamily, ['rock', 'painted-metal', 'glass', 'emissive'], 'rock'),
        biome: token(source.biome, 'temperate'),
        faction: token(source.faction, 'neutral'),
        age: finite(source.age, 0.25, 0, 1),
        color,
        geometry: {
          kind: choice(geometry.kind, ['sphere', 'box', 'cylinder', 'mesh', 'rock'], 'mesh'),
          scale: vector(geometry.scale, [1, 1, 1], 0.001, 1000),
        },
        lods: (Array.isArray(source.lods) ? source.lods.slice(0, 4) : [{ distance: 0, detail: 1 }])
          .map(value => {
            const lod = record(value);
            return { distance: finite(lod.distance, 0, 0, 1000000), detail: finite(lod.detail, 1, 0, 1) };
          }).sort((a, b) => a.distance - b.distance),
        maps: {
          albedo: { format: 'rgba8unorm', colorSpace: 'srgb', channel: 'rgb' },
          normal: { format: 'rgba8unorm', colorSpace: 'linear', channel: 'rgb', convention: 'opengl' },
          roughness: { format: 'rgba8unorm', colorSpace: 'linear', channel: 'g' },
          metalness: { format: 'rgba8unorm', colorSpace: 'linear', channel: 'b' },
          emissive: { format: 'rgba8unorm', colorSpace: 'srgb', channel: 'rgb' },
        },
        effects: {
          profile: choice(effects.profile, ['none', 'engine', 'industrial', 'habitat', 'energy'], 'none'),
          anchors,
          state: { activity: finite(state.activity, 1, 0, 1), damage: finite(state.damage, 0, 0, 1) },
          variation: { phase: random() * Math.PI * 2, rate: 0.8 + random() * 0.4, scale: 0.85 + random() * 0.3 },
        },
        quality: choice(source.quality, ['low', 'medium', 'high'], 'medium'),
      };
      descriptor.id = `wa1-${this.hash(descriptor)}`;
      return freeze(descriptor);
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = WorldAssetDescriptor;
  if (root) root.WorldAssetDescriptor = WorldAssetDescriptor;
})(typeof window !== 'undefined' ? window : globalThis);
