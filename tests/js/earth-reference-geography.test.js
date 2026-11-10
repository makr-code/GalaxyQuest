import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EARTH_REFERENCE, createEarthGeography, geographicVector, earthReferenceBasis, referencePolygons,
  triangulateGeography } from '../../js/rendering/earth-reference-geography.js';

const load = name => {
  const bytes = readFileSync(resolve('tools', 'data', 'earth', `ne_110m_${name}.geojson`));
  return { bytes, data: JSON.parse(bytes.toString()) };
};
const land = load('land'), lakes = load('lakes');
const geography = createEarthGeography(land.data, lakes.data);

describe('real Earth reference geography', () => {
  it('pins local public-domain source bytes rather than generating Earth-like noise', () => {
    expect(createHash('sha256').update(land.bytes).digest('hex'))
      .toBe('9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9');
    expect(createHash('sha256').update(lakes.bytes).digest('hex'))
      .toBe('eb02ecc86c82004fccbf979058bfabbbd6c2d07968c7844d38eb1c9152d2ffc9');
    expect(geography.land).toHaveLength(127);
    expect(geography.lakes).toHaveLength(24);
  });

  it.each([
    ['Sahara', 15, 25, 'desert'],
    ['Amazon', -60, -5, 'tropical'],
    ['Europe', 15, 50, 'temperate'],
    ['Australia', 130, -25, 'desert'],
    ['Greenland', -42, 74, 'ice'],
    ['Antarctica', 20, -85, 'ice'],
    ['Antarctic seam west', -179.9, -85, 'ice'],
    ['Antarctic seam east', 179.9, -85, 'ice'],
    ['North Atlantic', -35, 40, 'water'],
    ['Pacific west', -179.9, 0, 'water'],
    ['Pacific east', 179.9, 0, 'water'],
    ['Arctic Ocean', 0, 89.9, 'water'],
    ['Lake Superior', -87, 47.5, 'water'],
    ['Lake Victoria', 33, -1, 'water'],
  ])('classifies %s from shared polygons and explicit schematic climate masks', (_name, lon, lat, zone) => {
    expect(geography.sample(lon, lat)).toEqual({ water: zone === 'water', zone });
    expect(geography.sample(lon + 360, lat)).toEqual(geography.sample(lon, lat));
  });

  it('has a plausible measured land fraction, including polar land and inland water', () => {
    let total = 0, area = 0;
    for (let lat = -89; lat < 90; lat += 2) for (let lon = -179; lon < 180; lon += 2) {
      const weight = Math.cos(lat * Math.PI / 180);
      total += weight;
      if (!geography.sample(lon, lat).water) area += weight;
    }
    expect(area / total).toBeGreaterThan(0.28);
    expect(area / total).toBeLessThan(0.31);
  });

  it('uses the renderer geographic axes without mirrored longitudes', () => {
    expect(geographicVector(0, 0)[0]).toBe(1);
    expect(geographicVector(90, 0)[2]).toBeCloseTo(-1);
    expect(geographicVector(0, 90)[1]).toBeCloseTo(1);
    const quarterTurn = earthReferenceBasis([[0, 0, 1], [0, 1, 0], [-1, 0, 0]]);
    expect(quarterTurn[0][2]).toBe(-1);
    expect(EARTH_REFERENCE.rotation_period_hours).toBeCloseTo(23.93447, 5);
    expect(EARTH_REFERENCE.axial_tilt_deg).toBeCloseTo(23.43928);
  });

  it('tessellates actual land without changing polygon area or geographic coast endpoints', () => {
    const triangles = triangulateGeography(geography.land);
    expect(triangles.length).toBeGreaterThan(10000);
    expect(triangles.length).toBeLessThan(180000);
    let maxEdge = 0, triangleArea = 0;
    for (const [a, b, c] of triangles) {
      triangleArea += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      for (const [p, q] of [[a, b], [b, c], [c, a]]) maxEdge = Math.max(maxEdge, Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
    const ringArea = ring => Math.abs(ring.slice(1).reduce((sum, p, i) =>
      sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0)) / 2;
    const polygonArea = geography.land.reduce((sum, rings) =>
      sum + ringArea(rings[0]) - rings.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0), 0);
    expect(maxEdge).toBeLessThanOrEqual(3.000001);
    expect(triangleArea).toBeCloseTo(polygonArea, 5);
    const vertices = new Set(triangles.flat().map(point => point.join(',')));
    const missing = geography.land.flat(1).flat(1).filter(point => !vertices.has(point.join(',')));
    // Earcut may omit duplicate or collinear vertices but must preserve area.
    expect(missing.length).toBeLessThan(30);
  });

  it('preserves holes and rejects malformed reference data and input', () => {
    const rings = [[[0, 0], [8, 0], [8, 8], [0, 8], [0, 0]],
      [[2, 2], [6, 2], [6, 6], [2, 6], [2, 2]]];
    const triangles = triangulateGeography([rings]);
    for (const triangle of triangles) {
      const [x, y] = triangle.reduce((sum, p) => [sum[0] + p[0] / 3, sum[1] + p[1] / 3], [0, 0]);
      expect(x > 2 && x < 6 && y > 2 && y < 6).toBe(false);
    }
    expect(() => referencePolygons({ type: 'FeatureCollection', features: [{ geometry: { type: 'Point' } }] })).toThrow();
    expect(() => geography.sample(0, 91)).toThrow(RangeError);
    expect(() => geography.sample(NaN, 0)).toThrow(RangeError);
    expect(() => triangulateGeography([], 0)).toThrow(RangeError);
  });
});
