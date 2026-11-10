import { describe, expect, it } from 'vitest';

const model = require('../../js/rendering/colony-surface-plan.js');
const geometry = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
const manifest = { body_id: 12, seed: 35, biome: 'terran', radius_km: 6371, amplitude_km: 8, sea_level_km: -8 };
const history = { body_id: 12, version: 1, founded_count: 6, peak_population: 40000, initialized_at: 1000, observed_at: 1000 };
const sites = geometry.livingSurfaceCandidates(manifest, model);
const network = geometry.livingSurfaceRoads(manifest, model, sites);
const scene = (population, development = history) => ({
  colony: { id: 8, population }, body_development: development, buildings: [{ type: 'farm', level: 8 }],
});

describe('Persistent body settlement history read model', () => {
  it('retains the historical prefix as ruins while current population controls activity', () => {
    const plan = model.plan(scene(1000), manifest, sites, network);
    expect(plan.settlements).toHaveLength(6);
    expect(plan.settlements.map(site => site.ruined)).toEqual([false, true, true, true, true, true]);
    expect(plan.settlements.map(site => site.id)).toEqual(sites.slice(0, 6).map(site => site.id));
    expect(plan.settlements[1].weights).toEqual([0, 0, 0]);
    expect(plan.roads.length).toBeGreaterThan(0);
    expect(plan.roads.every(road => road.ruined)).toBe(true);
    expect(model.uniforms(plan)[model.ROAD_OFFSET + 11]).toBe(1);
    expect(model.uniforms(plan)[8 + model.SITE_FLOATS + 6]).toBe(1);
  });

  it('reactivates the same sites and roads on recovery without growing the persisted state in the browser', () => {
    const copy = structuredClone(history);
    const small = model.plan(scene(1000), manifest, sites, network);
    const recovered = model.plan(scene(40000), manifest, sites, network);
    expect(recovered.settlements.every(site => !site.ruined)).toBe(true);
    expect(recovered.roads.every(road => !road.ruined)).toBe(true);
    expect(recovered.settlements.map(site => site.id)).toEqual(small.settlements.map(site => site.id));
    expect(recovered.roads.map(road => road.points)).toEqual(small.roads.map(road => road.points));
    expect(history).toEqual(copy);
  });

  it('keeps bounded, weathered decorative geometry on ruined sites with no inventory or production', () => {
    const abandoned = model.plan(scene(1000), manifest, sites, network);
    const ruined = model.satelliteGeometry(abandoned, sites[1].id, 'terran');
    expect(ruined.ruined).toBe(true);
    expect(ruined.parts.length).toBeLessThan(512);
    expect(ruined.parts.every(part => [part.x, part.y, part.z, part.sx, part.sy, part.sz, ...part.color].every(Number.isFinite))).toBe(true);
    expect(ruined).not.toHaveProperty('buildings');
    expect(ruined).not.toHaveProperty('production');
    expect(model.satelliteGeometry(abandoned, sites[1].id, 'terran')).toEqual(ruined);
    const active = model.plan(scene(40000), manifest, sites, network);
    expect(model.satelliteGeometry(active, sites[1].id, 'terran')).not.toEqual(ruined);
    const empty = model.plan({ colony: { population: 0 }, body_development: history }, manifest, sites);
    expect(empty.settlements.every(site => site.ruined)).toBe(true);
    expect(model.satelliteGeometry(empty, sites[0].id, 'terran').ruined).toBe(true);
  });

  it('preserves body history across colony IDs and owners but rejects cross-body, corrupt and stale snapshots', () => {
    const first = model.plan(scene(1000), manifest, sites, network);
    expect(model.plan({ ...scene(1000), colony: { id: 999, owner_id: 777, population: 1000 } }, manifest, sites, network)).toEqual(first);
    for (const invalid of [{ ...history, body_id: 999 }, { ...history, version: 2 },
      { ...history, founded_count: 13 }, { ...history, founded_count: 2 }, { ...history, peak_population: 1 }]) {
      expect(() => model.plan(scene(1000, invalid), manifest, sites)).toThrow('body development');
    }
    expect(model.plan(scene(1000, null), manifest, sites).settlements).toHaveLength(1);
  });
});
