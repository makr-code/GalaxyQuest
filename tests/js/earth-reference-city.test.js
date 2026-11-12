import { describe, expect, it } from 'vitest';
import { metricCityLots, metricCityGeometry } from '../../js/rendering/earth-reference-city.js';
import { buildReliefMesh } from '../../js/rendering/earth-reference-relief.js';

describe('Metric Earth reference city', () => {
  it('uses fixed metre parcels and realistic building dimensions without population rescaling', () => {
    const young = metricCityLots(2026, 100000, 'residential');
    const mature = metricCityLots(2026, 1000000, 'residential');
    expect(mature).toEqual(metricCityLots(2026, 1000000, 'residential'));
    expect(mature.length).toBeGreaterThan(young.length);
    for (const lot of young) expect(mature.find(b => b.id === lot.id)).toEqual(lot);
    expect(mature.length).toBeLessThanOrEqual(576);
    expect(mature.every(b => b.heightMeters >= 9 && b.heightMeters <= 42
      && b.widthMeters < 60 && b.depthMeters < 60)).toBe(true);
    expect(metricCityLots(2026, 0, 'mixed')).toEqual([]);
    expect(metricCityLots(2027, 1000000, 'residential')).not.toEqual(mature);
  });

  it('converts actual metres to Earth radii and anchors foundations to the rendered triangles', () => {
    const relief = { sample: () => 100 };
    const settings = { exaggeration: 1, seaLevel: 0, ocean: true };
    const mesh = buildReliefMesh(relief, 32, settings, false);
    const lot = metricCityLots(2026, 1000000, 'industry')[0];
    const geometry = metricCityGeometry([lot], 13.405, 52.52, mesh, relief, settings);
    expect(geometry.buildings).toHaveLength(1);
    expect(geometry.instances[3] * geometry.radiusMeters).toBeCloseTo(lot.widthMeters, 4);
    expect(geometry.instances[7] * geometry.radiusMeters).toBeCloseTo(lot.depthMeters, 4);
    expect(geometry.instances[11] * geometry.radiusMeters).toBeGreaterThan(lot.heightMeters);
    const b = geometry.buildings[0];
    const top = Math.hypot(...b.position) + geometry.instances[11] / 2;
    expect((top - b.foundationRadius) * geometry.radiusMeters).toBeCloseTo(lot.heightMeters, 3);
    expect(b.foundationRadius).toBeLessThan(1 + 100 / geometry.radiusMeters);
    expect(metricCityGeometry([lot], 13.405, 52.52,
      buildReliefMesh({ sample: () => -100 }, 32, settings, false),
      { sample: () => -100 }, settings).buildings).toEqual([]);
  });
});
