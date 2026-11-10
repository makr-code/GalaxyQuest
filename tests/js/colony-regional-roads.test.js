import { describe, expect, it, vi } from 'vitest';

const model = require('../../js/rendering/colony-surface-plan.js');
const geometry = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
const manifest = { seed: 35, biome: 'terran', radius_km: 6371, amplitude_km: 8, sea_level_km: 0 };
const site = (id, longitude, latitude = 0) => ({
  id, height: 1, direction: [Math.sin(longitude) * Math.cos(latitude), Math.sin(latitude), Math.cos(longitude) * Math.cos(latitude)],
});
const sites = [site('primary', -0.5), site('satellite', 0.5), site('third', 1.3, 0.4)];
const dry = () => ({ height: 1, slope: 0.01, blocked: false });
const arc = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.reduce((sum, n, axis) => sum + n * b[axis], 0))));
function checkSegments(network, sample) {
  for (const route of network.routes) {
    for (let index = 1; index < route.points.length; index++) {
      const a = route.points[index - 1], b = route.points[index], angle = arc(a, b);
      expect(angle).toBeLessThanOrEqual(1.4);
      const steps = Math.ceil(angle / 0.006);
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const point = a.map((n, axis) => (n * Math.sin(angle * (1 - t)) + b[axis] * Math.sin(angle * t)) / Math.sin(angle));
        expect(Math.hypot(...point)).toBeCloseTo(1, 10);
        const terrain = sample(point);
        expect(terrain.height).toBeGreaterThan(0);
        expect(terrain.slope).toBeLessThanOrEqual(0.35);
        expect(terrain.blocked).toBe(false);
      }
    }
  }
}

describe('Seeded visual regional roads', () => {
  it('connects each new site to an earlier site with deterministic bounded geodesic segments', () => {
    const network = model.roadNetwork(manifest, sites, dry);
    expect(network.routes).toHaveLength(2);
    expect(network.disconnected).toEqual([]);
    expect(model.roadNetwork(structuredClone(manifest), structuredClone(sites), dry)).toEqual(network);
    for (const route of network.routes) {
      const from = sites.findIndex(site => site.id === route.from);
      const to = sites.findIndex(site => site.id === route.to);
      expect(to).toBeLessThan(from);
      expect(route.activation).toBe(from);
      expect(route.points[0]).toEqual(sites[from].direction);
      expect(route.points.at(-1)).toEqual(sites[to].direction);
    }
    checkSegments(network, dry);
  });

  it('takes a land detour instead of crossing water, steep ground or a forbidden region', () => {
    for (const obstacle of ['water', 'slope', 'region']) {
      const sample = direction => {
        const blocked = Math.abs(direction[0]) < 0.13 && Math.abs(direction[1]) < 0.22 && direction[2] > 0.5;
        return { height: blocked && obstacle === 'water' ? -1 : 1,
          slope: blocked && obstacle === 'slope' ? 0.8 : 0.01, blocked: blocked && obstacle === 'region' };
      };
      const network = model.roadNetwork(manifest, sites.slice(0, 2), sample);
      expect(network.routes).toHaveLength(1);
      expect(network.routes[0].points.some(point => Math.abs(point[1]) > 0.22)).toBe(true);
      checkSegments(network, sample);
    }
  });

  it('reports isolated sites rather than inventing bridges and exposes the active status in the read model', () => {
    const sample = direction => ({ height: Math.abs(direction[0]) < 0.2 ? -1 : 1, slope: 0, blocked: false });
    const network = model.roadNetwork(manifest, sites.slice(0, 2), sample);
    expect(network.routes).toEqual([]);
    expect(network.disconnected).toEqual([{ id: 'satellite', reason: 'no-land-route' }]);
    expect(model.plan({ population: 2000 }, manifest, sites, network).roadStatus.disconnected).toEqual(network.disconnected);
    expect(model.plan({ population: 100 }, manifest, sites, network).roadStatus.disconnected).toEqual([]);
  });

  it('keeps the existing route prefix stable during growth, conquest, economic changes and decline', () => {
    const network = model.roadNetwork(manifest, sites, dry);
    expect(model.roadNetwork(manifest, sites.slice(0, 2), dry).routes).toEqual(network.routes.slice(0, 1));
    const small = model.plan({ population: 2000 }, manifest, sites, network);
    const grown = model.plan({ colony: { population: 1e6, owner_id: 999 }, buildings: [{ type: 'factory', level: 8 }] }, manifest, sites, network);
    expect(small.roads[0]).toMatchObject({
      id: grown.roads[0].id, from: grown.roads[0].from, to: grown.roads[0].to,
      activation: grown.roads[0].activation, points: grown.roads[0].points,
    });
    expect(small.roads[0].freight).toBe(0);
    expect(grown.roads[0].freight).toBe(1);
    expect(grown.roads).toHaveLength(2);
    expect(model.plan({ population: 1000 }, manifest, sites, network).roads).toEqual([]);
    expect(model.plan({ population: 0 }, manifest, sites, network).roads).toEqual([]);
    expect(network.routes).toHaveLength(2);
  });

  it('bounds actual canonical terrain routing and shares identical orbit/surface geometry', () => {
    const landWorld = { ...manifest, sea_level_km: -8 };
    const candidates = geometry.livingSurfaceCandidates(landWorld, model);
    const sample = vi.fn(direction => geometry.livingSurfaceSample(landWorld, direction, true));
    const network = model.roadNetwork(landWorld, candidates, sample);
    expect(network.routes.length + network.disconnected.length).toBe(candidates.length - 1);
    expect(network.routes.length).toBeGreaterThan(0);
    expect(network.routes.reduce((sum, route) => sum + route.points.length - 1, 0)).toBeLessThanOrEqual(model.MAX_ROAD_SEGMENTS);
    expect(sample.mock.calls.length).toBeLessThan(80000);
    expect(geometry.livingSurfaceRoads(landWorld, model, candidates)).toEqual(network);
    for (const route of network.routes) {
      expect(route.points.every(point => point.every(Number.isFinite))).toBe(true);
    }
  });

  it('packs aligned road endpoints/planes and clears unused entries without altering inventories', () => {
    const data = { population: 4000, buildings: [{ type: 'farm', level: 8 }] };
    const original = structuredClone({ data, manifest, sites });
    const plan = model.plan(data, manifest, sites, model.roadNetwork(manifest, sites, dry));
    const buffer = model.uniforms(plan);
    const count = plan.roads.reduce((sum, route) => sum + route.points.length - 1, 0);
    expect(buffer[model.ROAD_OFFSET]).toBe(count);
    expect(buffer.byteLength).toBe(6640);
    expect([...buffer].every(Number.isFinite)).toBe(true);
    expect(buffer.slice(model.ROAD_OFFSET + 4, model.ROAD_OFFSET + 7)).toEqual(new Float32Array(plan.roads[0].points[0]));
    expect(Math.hypot(...buffer.slice(model.ROAD_OFFSET + 12, model.ROAD_OFFSET + 15))).toBeCloseTo(1, 6);
    expect([...buffer.slice(model.ROAD_OFFSET + 4 + count * model.ROAD_FLOATS)].every(n => n === 0)).toBe(true);
    expect(model.uniforms(null)).toEqual(new Float32Array(model.UNIFORM_BYTES / 4));
    expect({ data, manifest, sites }).toEqual(original);
    expect(plan).not.toHaveProperty('buildings');
    expect(plan).not.toHaveProperty('production');
  });

  it('does not draw radial roads across concave bodies or gas and rejects invalid sampler results', () => {
    const sample = vi.fn(dry);
    expect(model.roadNetwork({ ...manifest, solid: {} }, sites, sample)).toEqual({ routes: [], disconnected: [], unsupported: true });
    expect(model.roadNetwork({ ...manifest, biome: 'gas' }, sites, sample).routes).toEqual([]);
    expect(sample).not.toHaveBeenCalled();
    expect(() => model.roadNetwork(manifest, sites, () => ({ height: NaN, slope: 0 }))).toThrow('Non-finite');
    expect(() => model.roadNetwork({ ...manifest, radius_km: 0 }, sites, sample)).toThrow('Invalid');
    expect(() => model.roadNetwork(manifest, sites, null)).toThrow('sampler');
  });

  it('rejects invalid or oversized segment payloads instead of silently truncating roads', () => {
    const plan = model.plan({ population: 4000 }, manifest, sites);
    const points = [sites[0].direction, sites[1].direction];
    expect(() => model.uniforms({ ...plan, roads: [{ points: [points[0], points[0]] }] })).toThrow('Invalid');
    expect(() => model.uniforms({ ...plan, roads: Array.from({ length: 65 }, () => ({ points })) })).toThrow('budget');
  });
});
