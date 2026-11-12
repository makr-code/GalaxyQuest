import { describe, it, expect } from 'vitest';

const model = require('../../js/rendering/colony-surface-plan.js');
const geometry = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
const manifest = { body_id: 12, seed: 35, biome: 'terran', radius_km: 6371, amplitude_km: 8, sea_level_km: 0 };
const base = { id: 'regional-capital', direction: [0, 0, 1], height: 1 };
const land = () => ({ height: 1, slope: 0.01 });
const sites = [{ ...base, urbanCandidates: model.urbanCandidates(manifest, base, land) }];
const scene = population => ({ colony: { population }, buildings: [{ type: 'farm', level: 4 }, { type: 'trade_center', level: 4 }] });
const total = plan => plan.urbanSettlements.reduce((sum, city) => sum + city.population, plan.ruralPopulation + plan.unallocatedPopulation);

describe('Reconstructible cosmetic urban foundations', () => {
  it('creates a bounded versioned pool from geography alone and rejects blocked terrain', () => {
    expect(sites[0].urbanCandidates).toHaveLength(7);
    expect(model.urbanCandidates(manifest, base, land)).toEqual(sites[0].urbanCandidates);
    expect(model.URBAN_VERSION).toBe(1);
    expect(new Set(sites[0].urbanCandidates.map(city => city.id)).size).toBe(7);
    for (const city of sites[0].urbanCandidates) {
      expect(Math.hypot(...city.direction)).toBeCloseTo(1, 12);
      expect(city.direction).not.toEqual(base.direction);
      expect(city.height).toBeGreaterThan(0);
    }
    for (const terrain of [{ height: -1, slope: 0 }, { height: 1, slope: 0.4 }, { height: 1, slope: 0, blocked: true }]) {
      expect(model.urbanCandidates(manifest, base, () => terrain)).toEqual([]);
    }
    expect(() => model.urbanCandidates(manifest, base, () => ({ height: NaN, slope: 0 }))).toThrow(/terrain sample/);
    expect(model.urbanCandidates({ ...manifest, seed: 36 }, base, land)).not.toEqual(sites[0].urbanCandidates);
    const real = geometry.livingSurfaceCandidates(manifest, model);
    expect(real.some(site => site.urbanCandidates.length > 0)).toBe(true);
    expect(real.every(site => site.urbanCandidates.length <= 7)).toBe(true);
  });

  it('conserves the authoritative budget across rural allocation, old-city growth and new foundations', () => {
    const original = structuredClone(sites);
    let previous = model.plan(scene(0), manifest, sites);
    for (const population of [100, 1000, 100000, 1000000, 10000000, 100000000, 1000000000, 120000000000]) {
      const current = model.plan(scene(population), manifest, sites);
      expect(total(current)).toBeCloseTo(population, 3);
      expect(current.urbanSettlements.length).toBeGreaterThanOrEqual(previous.urbanSettlements.length);
      for (const old of previous.urbanSettlements) {
        const now = current.urbanSettlements.find(city => city.id === old.id);
        expect(now.direction).toEqual(old.direction);
        expect(now.population).toBeGreaterThanOrEqual(old.population);
      }
      expect(current.urbanSettlements.length).toBeLessThanOrEqual(8);
      previous = current;
    }
    expect(previous.urbanSettlements).toHaveLength(8);
    expect(sites).toEqual(original);
    const noLand = model.plan(scene(10000), manifest, []);
    expect(noLand.unallocatedPopulation).toBe(10000);
    expect(total(noLand)).toBe(10000);
  });

  it('births a small young city continuously without shrinking its parent or stealing prior inhabitants', () => {
    const rural = 0.45;
    const threshold = sites[0].urbanCandidates[0].foundingPopulation / (1 - rural);
    const before = model.plan(scene(threshold - 1), manifest, sites);
    const after = model.plan(scene(threshold + 1), manifest, sites);
    expect(before.urbanSettlements).toHaveLength(1);
    expect(after.urbanSettlements).toHaveLength(2);
    expect(after.urbanSettlements[1].population).toBeCloseTo(0.06 * (1 - rural), 6);
    expect(after.urbanSettlements[1].radius).toBeLessThan(after.settlements[0].radius / 100);
    expect(after.settlements[0].population).toBeGreaterThan(before.settlements[0].population);
    expect(total(after) - total(before)).toBeCloseTo(2, 6);
  });

  it('reconstructs identically after reload, sparse observations and ownership changes without wall-clock or frame state', () => {
    const data = scene(120000000);
    const direct = model.plan(data, manifest, sites);
    for (const population of [1000, 500000, 10000000, 1000000, 60000000]) model.plan(scene(population), manifest, sites);
    const reloaded = model.plan(JSON.parse(JSON.stringify(data)), JSON.parse(JSON.stringify(manifest)), JSON.parse(JSON.stringify(sites)));
    expect(reloaded).toEqual(direct);
    expect(model.uniforms(reloaded)).toEqual(model.uniforms(direct));
    expect(model.plan({ ...data, colony: { population: data.colony.population, owner_id: 999 },
      camera: { x: 2 }, time: 999999, reduced_motion: true }, manifest, sites)).toEqual(direct);
    expect(direct).not.toHaveProperty('last_update');
    expect(direct.urbanInfillVersion).toBe(model.URBAN_INFILL_VERSION);
    expect(model.URBAN_INFILL_VERSION).toBe(1);
    expect(direct.urbanStructureVersion).toBe(model.URBAN_STRUCTURE_VERSION);
    expect(model.URBAN_STRUCTURE_VERSION).toBe(5);
    expect(model.UNIFORM_BYTES).toBe(26112);
  });

  it('conserves population across regional founding thresholds instead of redistributing equal-sized cities', () => {
    const regions = geometry.livingSurfaceCandidates(manifest, model);
    for (const threshold of [2000, 4000, 8000, 16000, 2048000]) {
      const before = model.plan(scene(threshold - 1), manifest, regions);
      const after = model.plan(scene(threshold + 1), manifest, regions);
      expect(total(before)).toBeCloseTo(threshold - 1, 5);
      expect(total(after)).toBeCloseTo(threshold + 1, 5);
      expect(after.settlements[0].population).toBeGreaterThan(before.settlements[0].population);
      expect(after.settlements.at(-1).population).toBeLessThan(2);
    }
  });

  it('uses the existing peak watermark for reproducible abandoned satellite footprints and recovery', () => {
    const history = { body_id: 12, version: 1, peak_population: 120000000, founded_count: 12 };
    const peak = model.plan({ ...scene(120000000), body_development: history }, manifest, sites);
    const declined = model.plan({ ...scene(1000), body_development: history }, manifest, sites);
    expect(declined.urbanSettlements.map(city => city.id)).toEqual(peak.urbanSettlements.map(city => city.id));
    expect(declined.settlements[0].children.every(city => city.ruined && city.population === 0)).toBe(true);
    expect(total(declined)).toBeCloseTo(1000, 6);
    const bytes = model.uniforms(declined);
    expect(bytes[8 + 24 + 3]).toBeLessThan(0);
    expect(model.plan({ ...scene(120000000), body_development: history }, manifest, sites)).toEqual(peak);
    expect(history).toEqual({ body_id: 12, version: 1, peak_population: 120000000, founded_count: 12 });
    expect(peak.urbanVersion).toBe(model.URBAN_VERSION);
  });

  it('changes rural pressure with the actual building mix, not power, camera or locally invented growth', () => {
    const agrarian = model.plan(scene(120000000), manifest, sites);
    const industrial = model.plan({ colony: { population: 120000000 }, buildings: [{ type: 'factory', level: 8 }] }, manifest, sites);
    expect(agrarian.ruralPopulation).toBeGreaterThan(industrial.ruralPopulation);
    expect(total(agrarian)).toBeCloseTo(total(industrial), 5);
    const off = model.plan({ ...scene(120000000), colony: { population: 120000000, powered: false } }, manifest, sites);
    expect(off.urbanSettlements).toEqual(agrarian.urbanSettlements);
    expect(off.ruralPopulation).toBe(agrarian.ruralPopulation);
  });
});
