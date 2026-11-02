import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveBodyMaterial, materialUniforms, materialLod, srgbToLinear, linearToSrgb } =
  require('../../js/rendering/body-material.js');

describe('Shared body material contract', () => {
  it('uses physical linear-space PBR presets without texture downloads', () => {
    for (const biome of ['terran', 'ocean', 'ice', 'desert', 'lava', 'rock', 'gas']) {
      const material = resolveBodyMaterial({}, { biome, seed: 35, radius_km: 6 });
      expect(material).toMatchObject({ version: 1, biome, radiusMeters: 6000, metallic: 0 });
      expect(material.roughness).toBeGreaterThanOrEqual(0.08);
      expect(material.roughness).toBeLessThanOrEqual(1);
      expect(material.base.every((n) => n >= 0 && n <= 1)).toBe(true);
      expect(material.mean).toEqual(material.base.map((n, axis) => (n + material.accent[axis]) / 2));
    }
    expect(resolveBodyMaterial({ body_type: 'comet' }).biome).toBe('ice');
    expect(resolveBodyMaterial({ body_type: 'asteroid' }).biome).toBe('rock');
    expect(resolveBodyMaterial({}, { biome: 'gas', seed: 0, radius_km: 1 }).normalStrength).toBe(0);
    expect(() => resolveBodyMaterial({}, { biome: 'unsupported', seed: 0, radius_km: 1 })).toThrow();
    expect(() => resolveBodyMaterial({ diameter: -1 })).toThrow();
  });

  it('round-trips the sRGB transfer function and mixes colors in linear space', () => {
    for (const n of [0, 0.003, 0.04, 0.1, 0.5, 0.8, 1]) {
      expect(linearToSrgb(srgbToLinear(n))).toBeCloseTo(n, 12);
    }
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404114, 7);
    expect(linearToSrgb((srgbToLinear(0) + srgbToLinear(1)) / 2)).toBeGreaterThan(0.73);
  });

  it('uses the same persisted identity across colony, approach and reordered system entries', () => {
    const manifest = { biome: 'ice', seed: 2620094747, radius_km: 6 };
    const colony = resolveBodyMaterial({ id: 7, body_id: 12, owner_color: '#00ff00' }, manifest);
    const approach = resolveBodyMaterial({ id: 22, body_id: 12, owner_color: '#ff0000' }, manifest);
    expect(colony).toEqual(approach);
    expect(resolveBodyMaterial({ id: 22, body_id: 12 })).toEqual(resolveBodyMaterial({ id: 99, body_id: 12 }));
    expect(resolveBodyMaterial({ body_id: 13 }).seed).not.toBe(resolveBodyMaterial({ body_id: 12 }).seed);
  });

  it('smoothly filters pixel-dependent detail levels down to one point color', () => {
    expect(materialLod(0)).toEqual({ macro: 0, meso: 0, micro: 0 });
    expect(materialLod(2)).toEqual({ macro: 0, meso: 0, micro: 0 });
    expect(materialLod(800)).toEqual({ macro: 1, meso: 1, micro: 1 });
    expect(materialLod(6).macro).toBeGreaterThan(0);
    expect(materialLod(6).macro).toBeLessThan(1);
    let previous = materialLod(0);
    for (let pixels = 1; pixels <= 1000; pixels++) {
      const next = materialLod(pixels);
      for (const key of ['macro', 'meso', 'micro']) {
        expect(next[key]).toBeGreaterThanOrEqual(previous[key]);
        expect(next[key] - previous[key]).toBeLessThan(0.15);
      }
      previous = next;
    }
    for (const n of [NaN, Infinity, -1]) expect(() => materialLod(n)).toThrow();
  });

  it('packs aligned uniforms and keeps physical detail phases stable at planetary distances', () => {
    const material = resolveBodyMaterial({}, { biome: 'rock', seed: 35, radius_km: 6371 });
    const first = materialUniforms(material, 1, [6371000.125, -6371000.5, 0]);
    const shifted = materialUniforms(material, 1000, [6371128.125, -6370872.5, 128]);
    expect(first.byteLength).toBe(96);
    expect(first.slice(20)).toEqual(shifted.slice(20));
    expect(first.slice(16, 20)).toEqual(shifted.slice(16, 20));
    expect([...first].every(Number.isFinite)).toBe(true);
    expect(() => materialUniforms(material, 1, [NaN, 0, 0])).toThrow();
  });
});
