import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../../js/rendering/colony-surface-plan.js');
const geometry = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
const manifest = {
  body_id: 12, generator_version: 1, projection: 'cube-sphere', seed: 35, biome: 'terran',
  radius_km: 6371, amplitude_km: 8, height_min_km: -16, height_max_km: 16, sea_level_km: 0,
  max_lod: 14, resolution: 17, tile_encoding: 'uint16-json',
};
const dot = (a, b) => a.reduce((sum, n, axis) => sum + n * b[axis], 0);
const scene = (population = 40000, buildings = []) => ({ colony: { id: 7, population }, buildings });
const regionalSites = [
  { id: 'plain-primary', direction: [0.6, 0.8, 0], height: 2, slope: 0 },
  { id: 'temperate-lowland', direction: [Math.sqrt(0.91), 0.3, 0], height: 1, slope: 0.005 },
  { id: 'rough-highland', direction: [0, 0, -1], height: 7, slope: 0.3 },
];
const mixedScene = (population = 4000) => scene(population,
  [{ type: 'farm', level: 4 }, { type: 'mine', level: 4 }, { type: 'factory', level: 4 }]);

describe('Deterministic living colony surface', () => {
  it('keeps economic parcel scale and seeds stable across growth, economics and ownership without reallocating uniforms', () => {
    const sites = geometry.livingSurfaceCandidates(manifest, model);
    const small = model.plan(mixedScene(4000), manifest, sites);
    const large = model.plan({ ...mixedScene(1000000), colony: { population: 1000000, owner_id: 999 } }, manifest, sites);
    const smallUniforms = model.uniforms(small);
    const largeUniforms = model.uniforms(large);
    for (const [index, site] of small.settlements.entries()) {
      expect(site.parcelScale).toBeCloseTo(12 / manifest.radius_km, 12);
      expect(large.settlements[index].parcelScale).toBe(site.parcelScale);
      expect(smallUniforms[8 + index * model.SITE_FLOATS + 7]).toBe(largeUniforms[8 + index * model.SITE_FLOATS + 7]);
      expect(smallUniforms[8 + index * model.SITE_FLOATS + 11]).toBe(largeUniforms[8 + index * model.SITE_FLOATS + 11]);
    }
    const seeds = small.settlements.map((_site, index) => smallUniforms[8 + index * model.SITE_FLOATS + 11]);
    expect(new Set(seeds).size).toBe(seeds.length);
    const industrial = model.plan(scene(4000, [{ type: 'factory', level: 8 }]), manifest, sites);
    expect(industrial.settlements.map(site => site.parcelScale)).toEqual(small.settlements.map(site => site.parcelScale));
    for (const radius of [0.1, 100000]) {
      const bounded = model.plan(mixedScene(), { ...manifest, radius_km: radius }, sites);
      expect(bounded.settlements[0].parcelScale).toBeGreaterThanOrEqual(0.0002);
      expect(bounded.settlements[0].parcelScale).toBeLessThanOrEqual(0.006);
    }
    expect(smallUniforms.byteLength).toBe(26112);
  });

  it('derives urban lighting districts from completed ground trade/science buildings and keeps production capacities separate', () => {
    const data = scene(120000000, [
      { type: 'farm', level: 4 }, { type: 'factory', level: 4 },
      { type: 'trade_center', level: 4 }, { type: 'research_lab', level: 4 },
      { type: 'research_lab', level: 100, meta: { zone: 'orbital' } },
      { type: 'trade_center', level: 0 },
    ]);
    const plan = model.plan(data, manifest, regionalSites);
    expect(plan.state.civic).toEqual([0.25, 0.25]);
    expect(plan.state.weights).toEqual([0.5, 0, 0.5]);
    expect(plan.state.capacity).toBe(8);
    const bytes = model.uniforms(plan);
    expect(Array.from(bytes.slice(24, 26))).toEqual([0.25, 0.25]);
    expect(model.development(scene(1)).civic).toEqual([0, 0]);
    expect(model.development(scene(1, [{ type: 'research_lab', level: 8 }])).civic).toEqual([0, 1]);
    expect(model.development(scene(1, [{ type: 'trade_center', level: 8 }])).civic).toEqual([1, 0]);
  });

  it('grows nearby centres into conurbations, not remote, uninhabited or ruined sites', () => {
    const sites = [
      { id: 'a', direction: [0, 0, 1], height: 1 },
      { id: 'b', direction: [0.1, 0, Math.sqrt(0.99)], height: 1 },
      { id: 'remote', direction: [1, 0, 0], height: 1 },
    ];
    const early = model.plan(scene(12000000), manifest, sites);
    const late = model.plan(scene(120000000000), manifest, sites);
    expect(early.settlements.every(site => site.conurbation.width === 0)).toBe(true);
    expect(late.settlements[0].conurbation.width).toBeGreaterThan(0);
    expect(late.settlements[0].conurbation.direction).toEqual(sites[1].direction);
    expect(late.settlements[2].conurbation.width).toBe(0);
    const midpoint = model.plan(scene(12000000000), manifest, sites);
    expect(late.settlements[0].conurbation.width).toBeGreaterThanOrEqual(midpoint.settlements[0].conurbation.width);
    expect(late.settlements[0].radius).toBeGreaterThan(0.025);
    expect(model.plan(scene(0), manifest, sites).settlements).toEqual([]);
    const declined = model.plan({ ...scene(1000), body_development: {
      body_id: 12, version: 1, founded_count: 12, peak_population: 120000000000,
    } }, manifest, sites);
    expect(declined.settlements.every(site => site.conurbation.width === 0)).toBe(true);
    expect(model.uniforms(late)[8 + 23]).toBeCloseTo(late.settlements[0].conurbation.width);
  });

  it('allocates regional sectors by terrain while conserving every completed sector capacity', () => {
    const data = mixedScene();
    const original = structuredClone({ data, manifest, regionalSites });
    const plan = model.plan(data, manifest, regionalSites);
    expect(plan.settlements.map(site => model.specializationLabel(site))).toEqual(['Industry', 'Agriculture', 'Mining']);
    expect(plan.settlements.map(site => model.specializationLabel(site, true))).toEqual(['Industrie', 'Landwirtschaft', 'Bergbau']);
    for (let sector = 0; sector < 3; sector++) {
      expect(plan.settlements.reduce((sum, site) => sum + site.sectorCapacity[sector], 0)).toBeCloseTo(4, 12);
    }
    expect(plan.settlements.reduce((sum, site) => sum + site.capacity, 0)).toBeCloseTo(12, 12);
    for (const [index, site] of plan.settlements.entries()) {
      expect(site.weights.reduce((sum, n) => sum + n, 0)).toBeCloseTo(1, 12);
      expect(site.direction).toEqual(regionalSites[index].direction);
      expect(site.id).toBe(regionalSites[index].id);
      const buffer = model.uniforms(plan);
      expect(buffer.slice(8 + index * model.SITE_FLOATS + 12, 8 + index * model.SITE_FLOATS + 15))
        .toEqual(new Float32Array(site.weights));
      expect(buffer[8 + index * model.SITE_FLOATS + 15]).toBeCloseTo(site.capacity, 6);
    }
    expect({ data, manifest, regionalSites }).toEqual(original);
    expect(model.plan(structuredClone(data), manifest, structuredClone(regionalSites))).toEqual(plan);
  });

  it('produces distinct agricultural, extraction and industrial regions on canonical seeded terrain', () => {
    const sites = geometry.livingSurfaceCandidates(manifest, model);
    const plan = model.plan(mixedScene(1000000), manifest, sites);
    const labels = new Set(plan.settlements.map(site => model.specializationLabel(site)));
    expect(labels.has('Agriculture')).toBe(true);
    expect(labels.has('Mining')).toBe(true);
    expect(labels.has('Industry')).toBe(true);
    for (const site of plan.settlements) {
      expect(site.slope).toBeGreaterThanOrEqual(0);
      expect(site.slope).toBeLessThanOrEqual(0.35);
      expect(site.weights.every(n => Number.isFinite(n) && n >= 0 && n <= 1)).toBe(true);
    }
    for (let sector = 0; sector < 3; sector++) {
      expect(plan.settlements.reduce((sum, site) => sum + site.sectorCapacity[sector], 0)).toBeCloseTo(4, 12);
    }
  });

  it('redistributes only active visual regions across decline, recovery and economic snapshots', () => {
    const history = { body_id: 12, version: 1, peak_population: 4000, founded_count: 3 };
    const grown = model.plan({ ...mixedScene(), body_development: history }, manifest, regionalSites);
    const declined = model.plan({ ...mixedScene(1000), body_development: history }, manifest, regionalSites);
    expect(declined.settlements[0].sectorCapacity).toEqual([4, 4, 4]);
    for (const site of declined.settlements.slice(1)) {
      expect(site.capacity).toBe(0);
      expect(site.sectorCapacity).toEqual([0, 0, 0]);
      expect(site.weights).toEqual([0, 0, 0]);
      expect(model.specializationLabel(site)).toBe('');
    }
    expect(model.plan({ ...mixedScene(), body_development: history }, manifest, regionalSites)).toEqual(grown);
    const changed = model.plan(scene(4000, [{ type: 'mine', level: 12 }]), manifest, regionalSites);
    expect(changed.settlements.every(site => site.weights[0] === 0 && site.weights[1] === 1 && site.weights[2] === 0)).toBe(true);
    expect(changed.settlements.map(site => site.direction)).toEqual(grown.settlements.map(site => site.direction));
    const empty = model.plan(scene(4000), manifest, regionalSites);
    expect(empty.settlements.every(site => site.capacity === 0 && site.weights.every(n => n === 0))).toBe(true);
    expect(model.specializationLabel(empty.settlements[0])).toBe('');
    expect(model.plan(mixedScene(), manifest, []).settlements).toEqual([]);
  });

  it('uses the regional mix for economic architecture without changing residential lots', () => {
    const plan = model.plan(mixedScene(), manifest, regionalSites);
    const farm = model.satelliteGeometry(plan, regionalSites[1].id, 'terran');
    const industrialPlan = structuredClone(plan);
    industrialPlan.settlements[1].weights = [0, 0, 1];
    const industry = model.satelliteGeometry(industrialPlan, regionalSites[1].id, 'terran');
    expect(farm.parts).not.toEqual(industry.parts);
    expect(farm.parts.slice(0, 36)).toEqual(industry.parts.slice(0, 36));
    expect(farm.occupiedLots).toBe(industry.occupiedLots);
    expect(plan.state.weights).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('colors regional freight corridors from their endpoint economies, not the global mix', () => {
    const midpoint = regionalSites[2].direction.map((n, axis) => n + regionalSites[0].direction[axis]);
    const midpointLength = Math.hypot(...midpoint);
    const network = { routes: [
      { id: 'farm-link', from: regionalSites[1].id, to: regionalSites[0].id, activation: 1,
        points: [regionalSites[1].direction, regionalSites[0].direction] },
      { id: 'mine-link', from: regionalSites[2].id, to: regionalSites[0].id, activation: 2,
        points: [regionalSites[2].direction, midpoint.map(n => n / midpointLength), regionalSites[0].direction] },
    ], disconnected: [] };
    const plan = model.plan(mixedScene(), manifest, regionalSites, network);
    expect(plan.roads[1].freight).toBeGreaterThan(plan.roads[0].freight);
    const buffer = model.uniforms(plan);
    expect(buffer[model.ROAD_OFFSET + 15]).toBeCloseTo(plan.roads[0].freight, 6);
    expect(buffer[model.ROAD_OFFSET + 4 + model.ROAD_FLOATS + 11]).toBeCloseTo(plan.roads[1].freight, 6);
    expect(() => model.plan(mixedScene(), manifest, regionalSites, {
      ...network, routes: [{ ...network.routes[0], from: 'missing' }],
    })).toThrow('endpoint');
  });

  it('uses the public terrain seed and geodesic separation across both hemispheres', () => {
    const sites = geometry.livingSurfaceCandidates(manifest, model);
    expect(sites).toHaveLength(model.MAX_SETTLEMENTS);
    expect(geometry.livingSurfaceCandidates(structuredClone(manifest), model)).toEqual(sites);
    expect(geometry.livingSurfaceCandidates({ ...manifest, seed: 36 }, model)).not.toEqual(sites);
    expect(sites.some((site) => site.direction[0] < -0.3)).toBe(true);
    expect(sites.some((site) => site.direction[0] > 0.3)).toBe(true);
    for (const [index, site] of sites.entries()) {
      expect(Math.hypot(...site.direction)).toBeCloseTo(1, 12);
      expect(site.height).toBeGreaterThan(0);
      expect(Math.abs(site.direction[1])).toBeLessThanOrEqual(0.88);
      expect(site.height).toBeLessThanOrEqual(manifest.amplitude_km * 0.55);
      for (const other of sites.slice(0, index)) expect(dot(site.direction, other.direction)).toBeLessThan(0.88);
    }
    expect(Math.min(...sites.slice(1, 4).map((site) => dot(site.direction, sites[0].direction)))).toBeLessThan(-0.2);
  });

  it('preserves active anchors and IDs through growth, conquest, specialization and reload', () => {
    const sites = geometry.livingSurfaceCandidates(manifest, model);
    const small = model.plan(scene(2000), manifest, sites);
    const grown = model.plan({ ...scene(1000000, [{ type: 'farm', level: 8 }]),
      camera: { x: 123 }, colony: { population: 1000000, owner_id: 99 } }, manifest, sites);
    expect(grown.settlements.length).toBeGreaterThan(small.settlements.length);
    for (const [index, site] of small.settlements.entries()) {
      expect(grown.settlements[index].direction).toEqual(site.direction);
      expect(grown.settlements[index].id).toBe(site.id);
    }
    expect(model.plan(scene(2000), manifest, geometry.livingSurfaceCandidates(manifest, model))).toEqual(small);
    expect(model.plan(scene(1e30), manifest, sites).settlements).toHaveLength(model.MAX_SETTLEMENTS);
  });

  it('uses only built surface capacity, distinguishes mining/industry, and does not invent a specialization', () => {
    expect(model.development(scene()).weights).toEqual([0, 0, 0]);
    const data = scene(40000, [
      { type: 'hydroponics', level: 4 },
      { type: 'metal_mine', level: 2 },
      { type: 'refinery', level: 2 },
      { type: 'factory', level: 0, upgrade_end: 'future' },
      { type: 'farm', level: 500, meta: { zone: 'orbital' } },
    ]);
    expect(model.development(data).weights).toEqual([0.5, 0.25, 0.25]);
    expect(model.development(data).capacity).toBe(8);
    expect(model.development({ ...data, economy: { production: { food: 1e9 } } }).weights).toEqual([0.5, 0.25, 0.25]);
    expect(model.development(scene(0)).count).toBe(0);
    expect(model.development(scene(0, [{ type: 'habitat', level: 1 }])).count).toBe(1);
    expect(model.development({ slots: [{ type: 'habitat', level: 1 }] }).count).toBe(1);
  });

  it('resolves nested selection payloads without using ownership as an occupation signal', () => {
    const data = { focusPlanet: { __slot: { player_planet: { population: 8000, powered: false } } } };
    expect(model.development(data)).toMatchObject({ population: 8000, lights: 0, count: 4 });
    expect(model.development({ focusPlanet: { id: 7, owner_id: 1 } }).count).toBe(0);
    expect(model.development({ population: 8000 }).count).toBe(4);
    expect(model.development({ colony: { population: 8000, activity: 0.8, damage: 0.5 } }).lights).toBeCloseTo(0.4);
  });

  it('rejects oceans, steep slopes and forbidden region samples without inventing a fallback site', () => {
    for (const sample of [
      () => ({ height: -1, slope: 0 }),
      () => ({ height: 1, slope: 0.5 }),
      () => ({ height: 1, slope: 0, blocked: true }),
    ]) expect(model.candidates(manifest, sample)).toEqual([]);
    expect(() => model.candidates(manifest, () => ({ height: NaN, slope: 0 }))).toThrow('Non-finite');
    expect(() => model.candidates({ ...manifest, radius_km: 0 }, vi.fn())).toThrow('Invalid');
    expect(() => model.candidates(manifest, null)).toThrow('sampler');
    const unavailable = model.plan(scene(), manifest, []);
    expect(unavailable.unavailable).toBe(true);
    expect(unavailable.settlements).toEqual([]);
    const gas = { ...manifest, biome: 'gas' };
    expect(model.candidates(gas, vi.fn())).toEqual([]);
  });

  it('respects explicit water regions even when their terrain height is positive', () => {
    const regions = { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: { material: 'water', height_offset_km: 0, transition_km: 1 },
      geometry: { type: 'Polygon', coordinates: [[[-60, -50], [60, -50], [60, 50], [-60, 50], [-60, -50]]] },
    }] };
    const sites = geometry.livingSurfaceCandidates({ ...manifest, regions }, model);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(geometry.terrainRegionCoverages(regions, site.direction, manifest.radius_km)[0]).toBeLessThanOrEqual(0.1);
    }
  });

  it.each(['ice', 'rock', 'desert', 'lava'])('does not paint open farms on %s worlds', (biome) => {
    const geography = { ...manifest, biome };
    const sites = model.candidates(geography, () => ({ height: 1, slope: 0.01 }));
    const plan = model.plan(scene(10000, [{ type: 'hydroponics', level: 5 }]), geography, sites);
    expect(plan.outdoorAgriculture).toBe(false);
    expect(model.uniforms(plan)[2]).toBe(0);
  });

  it('keeps persisted valley sites primary and aligns the managed city with the exact canonical anchor', () => {
    const valley = { ...manifest, biome: 'ice', settlement: {
      version: 1, kind: 'valley-dome', direction: [1, 0, 0], floor_height_km: -2, dome_height_ratio: 0.55,
    } };
    expect(geometry.livingSurfaceCandidates(valley, model)[0].direction).toEqual([1, 0, 0]);
    const site = geometry.livingSurfaceCandidates(manifest, model)[0];
    const terrain = geometry.resolveBodySurface(scene(), 20, 12).terrain;
    geometry.applyTerrainSettlement(terrain, manifest, site);
    expect(geometry.bodyFrameDirection([0, 1, 0], terrain.shape.frame)).toEqual(site.direction);
    expect(terrain.groundHeight / terrain.radius * manifest.radius_km).toBeCloseTo(site.height);
    expect(terrain.shelter).toBeNull();
    geometry.applyTerrainSettlement(terrain, valley, site);
    expect(geometry.bodyFrameDirection([0, 1, 0], terrain.shape.frame)).toEqual([1, 0, 0]);
    expect(terrain.shelter).not.toBeNull();
  });

  it('packs a bounded, finite WGSL uniform without mutating public geography or gameplay', () => {
    const data = scene(1000000, [{ type: 'factory', level: 3 }]);
    const original = structuredClone({ data, manifest });
    const plan = model.plan(data, manifest, geometry.livingSurfaceCandidates(manifest, model));
    const bytes = model.uniforms(plan);
    expect(bytes.byteLength).toBe(model.UNIFORM_BYTES);
    expect([...bytes].every(Number.isFinite)).toBe(true);
    expect(bytes[0]).toBe(plan.settlements.length);
    expect(bytes.slice(8, 11)).toEqual(new Float32Array(plan.settlements[0].direction));
    expect(bytes[11]).toBeCloseTo(plan.settlements[0].radius);
    expect(bytes[12]).toBeCloseTo(plan.settlements[0].landRadius);
    expect(model.uniforms(null)).toEqual(new Float32Array(model.UNIFORM_BYTES / 4));
    expect({ data, manifest }).toEqual(original);
  });

  it('builds bounded deterministic satellite architecture with no authoritative building slots', () => {
    const sites = geometry.livingSurfaceCandidates(manifest, model);
    const plan = model.plan(scene(40000, [{ type: 'farm', level: 8 }]), manifest, sites);
    const original = structuredClone(plan);
    const city = model.satelliteGeometry(plan, sites[1].id, 'terran');
    expect(model.satelliteGeometry(plan, sites[1].id, 'terran')).toEqual(city);
    expect(model.satelliteGeometry(plan, sites[2].id, 'terran')).not.toEqual(city);
    expect(city.decorative).toBe(true);
    expect(city).not.toHaveProperty('slots');
    expect(city).not.toHaveProperty('buildings');
    expect(city.parts.length).toBeGreaterThan(100);
    expect(city.parts.length).toBeLessThan(512);
    expect(city.occupiedLots).toBeLessThanOrEqual(64);
    for (const part of city.parts) {
      expect([part.x, part.y, part.z, part.sx, part.sy, part.sz, ...part.color].every(Number.isFinite)).toBe(true);
      expect(Math.abs(part.x) + part.sx / 2).toBeLessThanOrEqual(city.width / 2 + 0.3);
      expect(Math.abs(part.z) + part.sz / 2).toBeLessThanOrEqual(city.depth / 2 + 0.3);
      expect(Math.min(part.sx, part.sy, part.sz)).toBeGreaterThan(0);
    }
    expect(plan).toEqual(original);
    expect(() => model.satelliteGeometry(plan, sites[0].id, 'terran')).toThrow('active satellite');
    expect(() => model.satelliteGeometry(plan, 'unavailable', 'terran')).toThrow('active satellite');
  });

  it('adds lots during population growth without moving or changing existing houses', () => {
    const sites = geometry.livingSurfaceCandidates(manifest, model);
    const small = model.plan(scene(4000), manifest, sites);
    const large = model.plan(scene(1000000), manifest, sites);
    const city = model.satelliteGeometry(small, sites[1].id, 'terran');
    const grown = model.satelliteGeometry(large, sites[1].id, 'terran');
    expect(grown.occupiedLots).toBeGreaterThan(city.occupiedLots);
    expect(grown.parts.slice(0, city.parts.length)).toEqual(city.parts);
    const conquered = model.plan({ ...scene(4000), colony: { population: 4000, owner_id: 999 } }, manifest, sites);
    expect(model.satelliteGeometry(conquered, sites[1].id, 'terran')).toEqual(city);
  });

  it('shows different economic modules and protected agriculture without multiplying capacity', () => {
    const sites = geometry.livingSurfaceCandidates(manifest, model);
    const plans = ['farm', 'mine', 'factory'].map(type => model.plan(scene(40000, [{ type, level: 8 }]), manifest, sites));
    const cities = plans.map(plan => model.satelliteGeometry(plan, sites[1].id, 'terran'));
    expect(cities[0]).not.toEqual(cities[1]);
    expect(cities[1]).not.toEqual(cities[2]);
    expect(cities[0]).not.toEqual(cities[2]);
    const closed = model.satelliteGeometry({ ...plans[0], outdoorAgriculture: false }, sites[1].id, 'ice');
    expect(closed.parts.some(part => part.color.join(',') === '0.3,0.53,0.18')).toBe(false);
    expect(closed.parts.some(part => part.color.join(',') === '0.42,0.65,0.66')).toBe(true);
    plans.forEach(plan => expect(plan.state.capacity).toBe(8));
  });

  it('keeps the valley primary while satellite frames use their own terrain and pressure shelters', () => {
    const valley = { ...manifest, biome: 'ice', settlement: {
      version: 1, kind: 'valley-dome', direction: [1, 0, 0], floor_height_km: -2, dome_height_ratio: 0.55,
    } };
    const sites = geometry.livingSurfaceCandidates(valley, model);
    const terrain = geometry.resolveBodySurface(scene(), 24.8, 24.8).terrain;
    geometry.applyTerrainSettlement(terrain, valley, sites[1], true);
    expect(geometry.bodyFrameDirection([0, 1, 0], terrain.shape.frame)).toEqual(sites[1].direction);
    expect(terrain.shelter).not.toBeNull();
    expect(terrain.groundHeight / terrain.radius * valley.radius_km).toBeCloseTo(sites[1].height);
    const plan = model.plan(scene(40000), valley, sites);
    expect(geometry.colonyDomeHeight(terrain.shelter,
      model.satelliteGeometry(plan, sites[1].id, 'ice').parts)).toBeGreaterThan(0);
    geometry.applyTerrainSettlement(terrain, valley, sites[0]);
    expect(geometry.bodyFrameDirection([0, 1, 0], terrain.shape.frame)).toEqual([1, 0, 0]);
  });
});
