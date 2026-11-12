import { afterEach, describe, expect, it, vi } from 'vitest';

const model = require('../../js/rendering/colony-surface-plan.js');
const living = require('../../js/engine/zoom/levels/PlanetLivingWorld.js');
const direction = (longitude, latitude = 0) => [
  Math.sin(longitude) * Math.cos(latitude), Math.sin(latitude), Math.cos(longitude) * Math.cos(latitude),
];
const manifest = { body_id: 12, seed: 35, biome: 'terran', radius_km: 6371, amplitude_km: 8, sea_level_km: 0 };
const points = [direction(0), direction(0.3), direction(0.3, 0.6)];
const route = { id: 'bent-land-route', from: 'satellite', to: 'primary', activation: 1, points };
const sites = [{ id: 'primary', direction: points.at(-1), height: 1 },
  { id: 'satellite', direction: points[0], height: 1 }];
const network = { routes: [route], disconnected: [] };
const scene = (type = 'farm', overrides = {}) => ({
  colony: { population: 2000 }, buildings: [{ type, level: 8 }], ...overrides,
});
const plan = data => model.plan(data, manifest, sites, network);
const arc = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.reduce((sum, n, i) => sum + n * b[i], 0))));
const trafficValues = buffer => Array.from({ length: buffer[model.ROAD_OFFSET] }, (_, index) =>
  buffer.slice(model.ROAD_OFFSET + 4 + index * model.ROAD_FLOATS + 12,
    model.ROAD_OFFSET + 4 + index * model.ROAD_FLOATS + 16));

function timeAt(progress) {
  const start = model.trafficPosition(route, manifest.seed, 0).progress;
  const ascending = model.trafficPosition(route, manifest.seed, 0.001).progress > start;
  const phase = ascending ? start / 2 : 1 - start / 2;
  return ((progress / 2 - phase + 1) % 1) * model.TRAFFIC_PERIOD;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Bounded decorative regional transport', () => {
  it('follows every bend at constant angular speed instead of taking a shortcut between cities', () => {
    for (let progress = 0; progress <= 1; progress += 0.05) {
      const position = model.trafficPosition(route, manifest.seed, timeAt(progress));
      expect(position.progress).toBeCloseTo(progress, 10);
      expect(Math.hypot(...position.direction)).toBeCloseTo(1, 10);
      const onSegment = points.slice(1).some((b, index) =>
        Math.abs(arc(points[index], position.direction) + arc(position.direction, b) - arc(points[index], b)) < 1e-6);
      expect(onSegment).toBe(true);
    }
    const junction = model.trafficPosition(route, manifest.seed, timeAt(1 / 3)).direction;
    junction.forEach((n, axis) => expect(n).toBeCloseTo(points[1][axis], 10));
    const before = model.trafficPosition(route, manifest.seed, timeAt(1 / 3 - 0.001)).direction;
    const after = model.trafficPosition(route, manifest.seed, timeAt(1 / 3 + 0.001)).direction;
    expect(arc(before, junction)).toBeCloseTo(arc(junction, after), 8);
    expect(arc(before, junction)).toBeCloseTo(0.9 * 0.001, 8);
  });

  it('is deterministic, seeded, periodic and independent of segment subdivision or frame rate', () => {
    const original = structuredClone(route);
    const subdivided = { ...route, points: [points[0], direction(0.15), ...points.slice(1)] };
    for (const time of [0, 1, 15, 60, 119.999, 3600001]) {
      const position = model.trafficPosition(route, 35, time);
      expect(model.trafficPosition(structuredClone(route), 35, time)).toEqual(position);
      expect(model.trafficPosition(route, 35, time + model.TRAFFIC_PERIOD).progress).toBeCloseTo(position.progress, 10);
      const split = model.trafficPosition(subdivided, 35, time);
      split.direction.forEach((n, axis) => expect(n).toBeCloseTo(position.direction[axis], 10));
    }
    expect(model.trafficPosition(route, 36, 0)).not.toEqual(model.trafficPosition(route, 35, 0));
    const beginning = model.trafficPosition(route, 35, timeAt(0));
    const end = model.trafficPosition(route, 35, timeAt(1));
    beginning.direction.forEach((n, axis) => expect(n).toBeCloseTo(points[0][axis], 10));
    end.direction.forEach((n, axis) => expect(n).toBeCloseTo(points.at(-1)[axis], 10));
    const turn = timeAt(1);
    const before = model.trafficPosition(route, 35, turn - 0.01);
    const after = model.trafficPosition(route, 35, turn + 0.01);
    before.direction.forEach((n, axis) => expect(n).toBeCloseTo(after.direction[axis], 10));
    expect(route).toEqual(original);
  });

  it.each([['farm', 1], ['mine', 2], ['factory', 3]])('packs %s convoys identically along all route segments', (sector, style) => {
    const data = scene(sector);
    const surface = plan(data);
    const original = structuredClone(surface);
    const first = model.uniforms(surface, 10, living.policy(data));
    const later = model.uniforms(surface, 20, living.policy(data));
    const values = trafficValues(first);
    expect(values).toHaveLength(2);
    expect(values[0]).toEqual(values[1]);
    expect(values[0][3]).toBe(style);
    expect(Math.hypot(...values[0].slice(0, 3))).toBeCloseTo(1, 6);
    expect(trafficValues(later)[0]).not.toEqual(values[0]);
    expect(first.byteLength).toBe(26112);
    expect([...first].every(Number.isFinite)).toBe(true);
    expect(surface).toEqual(original);
    expect(surface).not.toHaveProperty('production');
  });

  it('disables traffic for absent capacity, inhabitants, activity and every existing motion/visibility policy', () => {
    const disabled = [
      scene('farm', { reduced_motion: true }), scene('farm', { vfx_enabled: false }),
      scene('farm', { vfx_quality: 'off' }), scene('farm', { visible: false }),
      scene('farm', { planet_visible: false }), scene('farm', { buildings: [] }),
      ...[{ powered: false }, { active: false }, { activity: 0 }, { damage: 1 }, { population: 0 }]
        .map(overrides => scene('farm', { colony: { population: 2000, ...overrides } })),
    ];
    for (const data of disabled) {
      expect(trafficValues(model.uniforms(plan(data), 10, living.policy(data))).every(values => values.every(n => n === 0))).toBe(true);
    }
    const data = scene();
    expect(trafficValues(model.uniforms(plan(data), 10)).every(values => values[3] === 0)).toBe(true);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    expect(trafficValues(model.uniforms(plan(data), 10, living.policy(data))).every(values => values[3] === 0)).toBe(true);
    vi.unstubAllGlobals();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    expect(trafficValues(model.uniforms(plan(data), 10, living.policy(data))).every(values => values[3] === 0)).toBe(true);
  });

  it('has no transport on retained ruins or missing land routes and restores deterministic traffic on recovery', () => {
    const data = scene();
    const active = model.uniforms(plan(data), 10, living.policy(data));
    const declined = scene('farm', { colony: { population: 1000 },
      body_development: { body_id: 12, version: 1, founded_count: 2, peak_population: 2000 } });
    expect(trafficValues(model.uniforms(plan(declined), 10, living.policy(declined))).every(values => values[3] === 0)).toBe(true);
    expect(model.uniforms(plan(data), 10, living.policy(data))).toEqual(active);
    const isolated = model.plan(data, manifest, sites, { routes: [], disconnected: [{ id: 'satellite', reason: 'no-land-route' }] });
    expect(trafficValues(model.uniforms(isolated, 10, living.policy(data)))).toEqual([]);
  });

  it('rejects invalid time and invalid routes explicitly', () => {
    for (const time of [NaN, Infinity, -1]) {
      expect(() => model.trafficPosition(route, 35, time)).toThrow('time');
      expect(() => model.uniforms(plan(scene()), time)).toThrow('time');
    }
    for (const invalid of [[], [points[0]], [points[0], points[0]],
      [points[0], [NaN, 0, 1]], [points[0], [0, 0, 2]], [points[0], direction(2)]]) {
      expect(() => model.trafficPosition({ ...route, points: invalid }, 35, 0)).toThrow('Invalid');
    }
    expect(() => model.trafficPosition({ ...route, points: Array(66).fill(points[0]) }, 35, 0)).toThrow('budget');
  });
});
