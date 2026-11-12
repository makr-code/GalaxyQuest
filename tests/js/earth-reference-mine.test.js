import { describe, expect, it } from 'vitest';
import { buildMineMesh, mineProfile, MINE_REFERENCE } from '../../js/rendering/earth-reference-mine.js';
import { buildReliefMesh, inspectReliefMesh } from '../../js/rendering/earth-reference-relief.js';
import { geographicVector, EARTH_REFERENCE } from '../../js/rendering/earth-reference-geography.js';

describe('Metre-scale terraced open-pit reference', () => {
  const relief = { sample: () => 100 };
  it('has a bounded floor, eight benches, flat shelves and continuous slopes', () => {
    expect(mineProfile(0, 0).depthMeters).toBe(240);
    expect(mineProfile(3000, 0).depthMeters).toBe(0);
    expect(mineProfile(0, 2500).depthMeters).toBe(0);
    const depths = Array.from({ length: 2201 }, (_, x) => mineProfile(x, 0).depthMeters);
    expect(Math.max(...depths)).toBe(240);
    const flat = depths.filter((n, i) => i > 0 && n > 0 && n < 240 && n === depths[i - 1]);
    expect(flat.length).toBeGreaterThan(500);
    expect(new Set(flat).size).toBe(7);
    let maximumStep = 0;
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]).toBeLessThanOrEqual(depths[i - 1]);
      maximumStep = Math.max(maximumStep, depths[i - 1] - depths[i]);
    }
    expect(maximumStep).toBeLessThan(1.5);
    expect(mineProfile(1200, 0, 2026)).toEqual(mineProfile(1200, 0, 2026));
    expect(depths).not.toEqual(Array.from({ length: 2201 }, (_, x) => mineProfile(x, 0, 2027).depthMeters));
    expect(() => mineProfile(NaN, 0)).toThrow(/Invalid mine/);
  });

  it.each([1, 10])('excavates actual triangles by 240 metres at %sx terrain exaggeration without changing the opposite hemisphere', exaggeration => {
    const settings = { exaggeration, seaLevel: 0, ocean: true };
    const source = buildReliefMesh(relief, 32, settings);
    const original = source.slice();
    const mine = buildMineMesh(source, relief, settings);
    expect(source).toEqual(original);
    expect(mine.available).toBe(true);
    expect(mine.trianglesAdded).toBeGreaterThan(1000);
    expect(mine.vertices.byteLength).toBeLessThan(32 * 1024 * 1024);
    expect(mine.vertices.every(Number.isFinite)).toBe(true);
    const up = geographicVector(MINE_REFERENCE.longitude, MINE_REFERENCE.latitude);
    const inspect = vertices => inspectReliefMesh(vertices, up.map(n => n * 2), up.map(n => -n), relief, settings);
    expect((inspect(source).meshElevation - inspect(mine.vertices).meshElevation) * exaggeration).toBeCloseTo(240, -1);
    const opposite = up.map(n => -n);
    const other = vertices => inspectReliefMesh(vertices, opposite.map(n => n * 2), up, relief, settings);
    expect(other(mine.vertices).meshElevation).toBeCloseTo(other(source).meshElevation, 5);
    expect((1 - mine.centreRadius) * EARTH_REFERENCE.radiusKm * 1000).toBeGreaterThan(0);
    const wet = { sample: () => -100 };
    const wetMesh = buildReliefMesh(wet, 32, settings);
    expect(buildMineMesh(wetMesh, wet, settings)).toMatchObject({ vertices: wetMesh, available: false, trianglesAdded: 0 });
  });
});
