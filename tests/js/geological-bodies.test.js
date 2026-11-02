import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  validateBodySolid, bodySolidDistance, bodySolidBound, bodySolidRadius,
  validateBodyGeology, bodyGeologicalHeight, buildCompositeBodyMesh, compositeSurfaceDistance,
  applyTerrainSettlement, resolveBodySurface, bodyCenterRadius, mapColonySurfacePoint, constrainBodyCamera,
} = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');

const solid = {
  version: 1, blend: 0.18,
  lobes: [
    { center: [-0.5, 0, 0], axes: [0.85, 0.7, 0.65] },
    { center: [0.65, 0.05, 0], axes: [0.6, 0.5, 0.5] },
  ],
  cuts: [{ center: [-0.55, 0.65, 0], radius: 0.2 }],
};
const manifest = {
  body_id: 12, generator_version: 1, projection: 'cube-sphere', seed: 35, biome: 'ice',
  radius_km: 6, amplitude_km: 0.12, height_min_km: -0.5, height_max_km: 0.5,
  resolution: 17, max_lod: 11, tile_encoding: 'uint16-json',
  shape: { version: 1, axes: [1, 1, 1], deformation: 0 }, solid,
  geology: { version: 1, erosion: 0.1, tectonics: 0, craters: [] },
};

describe('Persistent geological and composite bodies', () => {
  it('validates versioned bounded solids and rejects malformed geometry', () => {
    expect(validateBodySolid(solid)).toBe(solid);
    for (const change of [{ version: 2 }, { blend: 0 }, { lobes: [] }, { cuts: Array(9).fill(solid.cuts[0]) },
      { lobes: [{ center: [0, 0, NaN], axes: [1, 1, 1] }] },
      { lobes: [{ center: [0, 0, 0], axes: [0, 1, 1] }] }]) {
      expect(() => validateBodySolid({ ...solid, ...change })).toThrow('composite body solid');
    }
    expect(() => validateBodyGeology({ version: 1, erosion: 2, tectonics: 0, craters: [] })).toThrow('geology');
  });

  it('unites lobes through a neck, subtracts pits, and finds the true outer surface', () => {
    expect(bodySolidDistance([-0.5, 0, 0], solid)).toBeLessThan(0);
    expect(bodySolidDistance([0.65, 0, 0], solid)).toBeLessThan(0);
    expect(bodySolidDistance([0.15, 0, 0], solid)).toBeLessThan(0);
    expect(bodySolidDistance([-0.55, 0.65, 0], solid)).toBeGreaterThan(0);
    const uncut = { ...solid, cuts: [] };
    expect(bodySolidDistance([-0.55, 0.65, 0], uncut)).toBeLessThan(0);
    const bound = bodySolidBound(solid);
    expect(bodySolidDistance([bound, 0, 0], solid)).toBeGreaterThan(0);
    for (const direction of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const radius = bodySolidRadius(direction, solid);
      expect(Math.abs(bodySolidDistance(direction.map((n) => n * radius), solid))).toBeLessThan(1e-7);
    }
    const miss = { ...solid, lobes: [{ center: [2, 2, 2], axes: [0.1, 0.1, 0.1] }] };
    expect(() => bodySolidRadius([1, 0, 0], miss)).toThrow('no surface');
  });

  it('carves actual crater basins and rims, attenuates them with erosion and gates tectonics', () => {
    const crater = { direction: [0, 1, 0], angular_radius: 0.1, depth_km: 0.1 };
    const base = { ...manifest, solid: null, geology: { version: 1, erosion: 0, tectonics: 0, craters: [] } };
    const impact = { ...base, geology: { ...base.geology, craters: [crater] } };
    const center = bodyGeologicalHeight(impact, [0, 1, 0]) - bodyGeologicalHeight(base, [0, 1, 0]);
    expect(center).toBeCloseTo(-0.1, 6);
    const rimDirection = [Math.sin(0.1), Math.cos(0.1), 0];
    expect(bodyGeologicalHeight(impact, rimDirection) - bodyGeologicalHeight(base, rimDirection)).toBeCloseTo(0.025, 6);
    const erodedBase = { ...base, geology: { ...base.geology, erosion: 0.8 } };
    const eroded = { ...erodedBase, geology: { ...erodedBase.geology, craters: [crater] } };
    expect(Math.abs(bodyGeologicalHeight(eroded, [0, 1, 0]) - bodyGeologicalHeight(erodedBase, [0, 1, 0]))).toBeLessThan(Math.abs(center));
    const active = { ...base, geology: { ...base.geology, tectonics: 1 } };
    expect(bodyGeologicalHeight(active, rimDirection)).not.toBe(bodyGeologicalHeight(base, rimDirection));
    expect(bodyGeologicalHeight({ ...active, biome: 'gas' }, rimDirection)).toBe(0);
  });

  it('extracts a deterministic volumetric surface rather than overlapping sphere meshes', () => {
    const mesh = buildCompositeBodyMesh(manifest, 40);
    expect(mesh.vertexCount).toBeGreaterThan(1000);
    expect(mesh.vertexCount % 3).toBe(0);
    expect(mesh.vertices.byteLength / 3 * 7).toBeLessThan(8 * 1024 * 1024);
    expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
    let largestError = 0;
    for (let index = 0; index < mesh.vertices.length; index += 39) {
      largestError = Math.max(largestError, Math.abs(compositeSurfaceDistance(
        Array.from(mesh.vertices.subarray(index, index + 3)), manifest
      )));
    }
    expect(largestError).toBeLessThan(1e-5);
    expect(buildCompositeBodyMesh(manifest, 40).vertices).toEqual(mesh.vertices);
    const edges = new Map();
    for (let index = 0; index < mesh.vertices.length; index += 9) {
      const points = [0, 3, 6].map((offset) => Array.from(mesh.vertices.subarray(index + offset, index + offset + 3)).join(','));
      for (let edge = 0; edge < 3; edge++) {
        const key = [points[edge], points[(edge + 1) % 3]].sort().join('/');
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
    expect(new Set(edges.values())).toEqual(new Set([2]));
  }, 30000);

  it('uses the same solid surface for settlement placement and camera collision', () => {
    const terrain = resolveBodySurface({ colony: { diameter_km: 12 } }, 20, 12).terrain;
    const site = { ...manifest, settlement: {
      version: 1, kind: 'valley-dome', direction: [0, 1, 0], floor_height_km: -0.06, dome_height_ratio: 0.55,
    } };
    applyTerrainSettlement(terrain, site);
    const ground = mapColonySurfacePoint(terrain.radius, 0, 0, 0, terrain);
    const global = [ground[0], ground[1] + bodyCenterRadius(terrain.radius, terrain.shape), ground[2]]
      .map((n) => n / terrain.radius);
    expect(Math.abs(compositeSurfaceDistance(global, site, terrain))).toBeLessThan(1e-6);
    const camera = constrainBodyCamera(null, ground, terrain.radius, terrain);
    const point = [camera[0], camera[1] + bodyCenterRadius(terrain.radius, terrain.shape), camera[2]]
      .map((n) => n / terrain.radius);
    expect(compositeSurfaceDistance(point, site, terrain) * terrain.radius).toBeGreaterThan(0.34);
  });
});
