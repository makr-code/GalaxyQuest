import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveBodyMaterial, materialUniforms, materialLod, terrainBoundaries, srgbToLinear, linearToSrgb } =
  require('../../js/rendering/body-material.js');

describe('Shared body material contract', () => {
  it('packs a bounded water loop into existing padding without changing the material layout', () => {
    const material = resolveBodyMaterial({ seed: 35 });
    const first = materialUniforms(material, 1000, [0, 0, 0], { seconds: 5, enabled: true });
    const loop = materialUniforms(material, 1000, [0, 0, 0], { seconds: 125, enabled: true });
    expect(first).toEqual(loop);
    expect(first.byteLength).toBe(112);
    expect(first[23]).toBe(5);
    expect(new Int32Array(first.buffer)[27]).toBe(1);
    expect(new Int32Array(materialUniforms(material, 1000).buffer)[27]).toBe(0);
    for (const water of [{ seconds: -1, enabled: true }, { seconds: NaN, enabled: true },
      { seconds: Infinity, enabled: true }, { seconds: 1, enabled: 1 }]) {
      expect(() => materialUniforms(material, 1000, [0, 0, 0], water)).toThrow('Invalid water animation state');
    }
  });

  it('passes canonical geometric normals to the shared terrain surface in orbit and city', () => {
    const { COLONY_BODY_WGSL } = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
    const { PLANET_APPROACH_WGSL } = require('../../js/engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js');
    for (const shader of [COLONY_BODY_WGSL, PLANET_APPROACH_WGSL]) {
      expect(shader).toMatch(/gqTerrainSurface\(gqSurface\([^\n]+canonicalNormal,0\.0\),masks,canonicalNormal\)/);
      expect(shader.indexOf('gqTerrainSurface(')).toBeLessThan(shader.indexOf('gqLivingSurface('));
      expect(shader.indexOf('gqWaterSurface(')).toBeGreaterThan(shader.indexOf('gqTerrainSurface('));
      expect(shader.indexOf('gqWaterSurface(')).toBeLessThan(shader.indexOf('gqLivingSurface('));
      expect(shader.indexOf('gqLavaSurface(')).toBeGreaterThan(shader.indexOf('gqTerrainSurface('));
      expect(shader.indexOf('gqLavaSurface(')).toBeLessThan(shader.indexOf('gqLivingSurface('));
      expect(shader).toMatch(/gqLavaSurface\(surface,masks\.z \* \(1\.0 - in\.(color|region)\.a\),/);
    }
  });

  it('shares seeded spherical cloud turbulence between the persistent orbital and city shaders', () => {
    const { CLOUD_WGSL } = require('../../js/rendering/body-material.js');
    const { COLONY_SKY_WGSL } = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
    const { PLANET_APPROACH_WGSL } = require('../../js/engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js');
    expect(COLONY_SKY_WGSL).toContain(CLOUD_WGSL);
    expect(COLONY_SKY_WGSL).toContain('camera.transition.w,camera.frame0.w');
    expect(PLANET_APPROACH_WGSL).toContain('normalize(in.bodyPoint) * 12.0');
    expect(PLANET_APPROACH_WGSL).not.toContain('noise(in.uv');
    expect(PLANET_APPROACH_WGSL).toContain('gqCloudNoise(cloudPoint,cloudTime,gqMaterial.scale.x,cloudFootprint)');
    expect(COLONY_SKY_WGSL.indexOf('dpdx(noisePoint)')).toBeLessThan(COLONY_SKY_WGSL.indexOf('discard;'));
  });

  it('encodes signed sea and snow boundaries without interpolating material categories', () => {
    expect(terrainBoundaries('terran', -0.5, 8, 1)).toEqual([-1.5, -4.9, 1, 1]);
    expect(terrainBoundaries('terran', 2, 8, 1)[0]).toBe(1);
    expect(terrainBoundaries('ocean', 2, 8, 1).slice(2)).toEqual([1, 0]);
    expect(terrainBoundaries('lava', -1, 8).slice(2)).toEqual([3, 0]);
    expect(terrainBoundaries('ice', -2, 8)).toEqual([-2, 1, 0, 1]);
    expect(terrainBoundaries('rock', -2, 8).slice(2)).toEqual([0, 0]);
    expect(() => terrainBoundaries('terran', NaN, 8)).toThrow('Invalid');
    expect(() => terrainBoundaries('terran', 0, -1)).toThrow('Invalid');
  });
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
    expect(first.byteLength).toBe(112);
    expect(first.slice(20, 24)).toEqual(shifted.slice(20, 24));
    const cells = new Int32Array(first.buffer).slice(24, 27);
    expect(Array.from(new Int32Array(shifted.buffer).slice(24, 27))).toEqual(Array.from(cells, (n) => n + 1));
    for (const [axis, anchor] of [6371000.125, -6371000.5, 0].entries()) {
      expect(cells[axis] * 128 + first[20 + axis]).toBe(anchor);
    }
    expect(first.slice(16, 20)).toEqual(shifted.slice(16, 20));
    expect([...first.slice(0, 24)].every(Number.isFinite)).toBe(true);
    expect(() => materialUniforms(material, 1, [NaN, 0, 0])).toThrow();
    expect(() => materialUniforms(material, 1, [1e15, 0, 0])).toThrow('coordinate range');
  });
});
