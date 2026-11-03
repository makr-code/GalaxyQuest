import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  cubeSphereDirection, planCubeSphereTiles, validateTerrainManifest, CubeSphereTerrainStream,
  buildPersistedTerrainMesh, resolveBodySurface,
  validateBodyShape, bodyShapeFactor, bodyGroundPoint, bodySurfaceNormal, constrainBodyCamera,
  mapColonySurfacePoint, cityCameraPose, cityCameraMatrix, projectCityPoint,
  bodyFrameDirection, settlementFrame, applyTerrainSettlement, colonyDomeHeight, gradePersistentHeight,
  bodyCenterRadius, COLONY_METERS_PER_UNIT,
} = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');

const manifest = {
  body_id: 12, generator_version: 1, projection: 'cube-sphere', seed: 35, biome: 'terran',
  radius_km: 6371, amplitude_km: 8, height_min_km: -8, height_max_km: 8, sea_level_km: 0,
  max_lod: 14, resolution: 17, tile_encoding: 'uint16-json',
};
const roots = () => Array.from({ length: 6 }, (_, face) => ({ face, lod: 0, x: 0, y: 0 }));
const key = (tile) => `${tile.face}/${tile.lod}/${tile.x}/${tile.y}`;
const tile = (address, height = 45000) => ({
  ...address, body_id: 12, generator_version: 1, resolution: 17, heights: Array(289).fill(height),
});
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function fixtureFetch() {
  const fetcher = vi.fn(async (url, options = {}) => {
    const parsedUrl = new URL(url, 'http://localhost/');
    const query = parsedUrl.searchParams;
    if (parsedUrl.pathname.endsWith('/api/auth.php')) {
      return { ok: true, json: async () => ({ token: 'terrain-test-csrf' }) };
    }
    const payload = JSON.parse(options.body || '{}');
    return { ok: true, json: async () => query.get('action') === 'manifest'
      ? { success: true, manifest: { ...manifest } }
      : { success: true, tiles: payload.tiles.map((address) => tile(address)) } };
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

afterEach(() => vi.unstubAllGlobals());

describe('Persisted cube-sphere terrain', () => {
  it('uses physical body radii independently of colony dimensions and retains metre-scale precision', () => {
    for (const diameter of [0.2, 12, 3474, 12742, 139820]) {
      const small = resolveBodySurface({ colony: { diameter_km: diameter } }, 20, 12);
      const large = resolveBodySurface({ colony: { diameter_km: diameter } }, 100, 80);
      expect(small.radius * COLONY_METERS_PER_UNIT).toBeCloseTo(diameter * 500, 7);
      expect(large.radius).toBe(small.radius);
    }
    expect(0.41 * COLONY_METERS_PER_UNIT).toBeCloseTo(1.8);
    const estimated = resolveBodySurface({ colony: { body_type: 'comet' } }, 20, 12);
    expect(estimated.estimatedRadius).toBe(true);
    expect(estimated.radius).toBe(resolveBodySurface({ colony: { body_type: 'comet' } }, 100, 80).radius);
    const radius = 6371000 / COLONY_METERS_PER_UNIT;
    const point = bodyGroundPoint(radius, 100 / COLONY_METERS_PER_UNIT, 0);
    expect(point[0] * COLONY_METERS_PER_UNIT).toBeCloseTo(100, 5);
    expect(point[1] * COLONY_METERS_PER_UNIT).toBeCloseTo(-(100 ** 2) / (2 * 6371000), 6);
  });

  it('validates persisted valley sites and leaves legacy manifests unmodified', () => {
    const settlement = {
      version: 1, kind: 'valley-dome', direction: [1, 0, 0],
      floor_height_km: -2, dome_height_ratio: 0.55,
    };
    expect(validateTerrainManifest({ ...manifest, settlement }).settlement).toBe(settlement);
    for (const change of [{ version: 2 }, { kind: 'sphere' }, { direction: [1, 1, 0] },
      { direction: [NaN, 0, 0] }, { floor_height_km: -99 }, { dome_height_ratio: 0 }]) {
      expect(() => validateTerrainManifest({ ...manifest, settlement: { ...settlement, ...change } })).toThrow('valley settlement');
    }
    expect(validateTerrainManifest(manifest)).not.toHaveProperty('settlement');
  });

  it('rotates canonical terrain into the valley frame without changing the body shape', () => {
    const direction = cubeSphereDirection(0, 0.2, 0.4);
    const frame = settlementFrame(direction);
    const local = [0.2, 0.9, -0.1];
    const global = bodyFrameDirection(local, frame);
    bodyFrameDirection(global, frame, true).forEach((value, index) => expect(value).toBeCloseTo(local[index], 12));
    const shape = { version: 1, axes: [1.45, 0.8, 0.95], deformation: 0.22 };
    expect(bodyShapeFactor([0, 1, 0], { ...shape, frame })).toBeCloseTo(bodyShapeFactor(direction, shape), 12);
    for (const pole of [[0, 0, 1], [0, 0, -1]]) {
      expect(bodyFrameDirection([0, 1, 0], settlementFrame(pole))).toEqual(pole);
    }
  });

  it('grades a circular valley floor continuously and sizes the dome above every building corner', () => {
    const terrain = resolveBodySurface({ colony: { body_type: 'comet', diameter_km: 12 } }, 20, 12).terrain;
    const site = {
      ...manifest, radius_km: 6, amplitude_km: 0.12, height_min_km: -0.12, height_max_km: 0.12,
      biome: 'ice', shape: { version: 1, axes: [1.45, 0.8, 0.95], deformation: 0.22 },
      settlement: { version: 1, kind: 'valley-dome', direction: [1, 0, 0], floor_height_km: -0.06, dome_height_ratio: 0.55 },
    };
    applyTerrainSettlement(terrain, site);
    expect(terrain.radius * COLONY_METERS_PER_UNIT).toBeCloseTo(6000);
    const { shelter } = terrain;
    expect(gradePersistentHeight(site, terrain, 0, 0, 0.08)).toBe(shelter.floor);
    expect(gradePersistentHeight(site, terrain, shelter.radius, 0, 0.08)).toBe(shelter.floor);
    expect(gradePersistentHeight(site, terrain, shelter.radius * 1.4, 0, 0.08)).toBeCloseTo(0.08 / 6 * terrain.radius);
    const part = { x: 8, z: 3, y: 0.1, sx: 2, sy: 7, sz: 2 };
    const height = colonyDomeHeight(shelter, [part]);
    const cornerDistance = Math.hypot(part.x + part.sx / 2, part.z + part.sz / 2);
    expect(height * Math.sqrt(1 - (cornerDistance / shelter.radius) ** 2)).toBeGreaterThan(part.y + part.sy);
    expect(() => colonyDomeHeight(shelter, [{ ...part, x: shelter.radius }])).toThrow('footprint');
    const floor = mapColonySurfacePoint(terrain.radius, 0, 0, 0, terrain);
    expect(Math.hypot(floor[0], floor[1] + bodyCenterRadius(terrain.radius, terrain.shape), floor[2]))
      .toBeCloseTo(terrain.radius * bodyShapeFactor([0, 1, 0], terrain.shape) + shelter.floor);
    applyTerrainSettlement(terrain, manifest);
    expect(terrain.shelter).toBeNull();
    expect(terrain.shape).not.toHaveProperty('frame');
  });

  it('samples the same persisted floor in a rotated settlement and its rendered mesh', () => {
    const site = {
      ...manifest, biome: 'ice',
      shape: { version: 1, axes: [1.45, 0.8, 0.95], deformation: 0.22 },
      settlement: { version: 1, kind: 'valley-dome', direction: [1, 0, 0], floor_height_km: -2, dome_height_ratio: 0.55 },
    };
    const terrain = resolveBodySurface({ colony: {} }, 20, 12).terrain;
    applyTerrainSettlement(terrain, site);
    const stream = new CubeSphereTerrainStream(7, vi.fn());
    stream.manifest = site;
    roots().forEach((address) => stream.surfaceTiles.set(key(address), tile(address)));
    expect(stream.sample(0, 0, terrain)).toBeCloseTo(terrain.shelter.floor);
    const mesh = buildPersistedTerrainMesh(site, [...stream.surfaceTiles.values()], terrain);
    expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
    expect(mesh.vertexCount).toBe(6 * 1920);
    stream.dispose();
  });

  it('uses the backend face convention and identical border directions', () => {
    for (let i = 0; i <= 16; i++) {
      const v = i / 8 - 1;
      expect(cubeSphereDirection(0, -1, v)).toEqual(cubeSphereDirection(4, 1, v));
      expect(cubeSphereDirection(2, 1, v)).toEqual(cubeSphereDirection(0, v, 1));
      for (let face = 0; face < 6; face++) expect(Math.hypot(...cubeSphereDirection(face, v, 0))).toBeCloseTo(1);
    }
  });

  it('rejects unsupported, non-finite and out-of-budget manifests', () => {
    expect(validateTerrainManifest(manifest)).toBe(manifest);
    for (const change of [{ generator_version: 2 }, { max_lod: 50 }, { resolution: 33 },
      { radius_km: NaN }, { tile_encoding: 'png' }, { amplitude_km: 0 }, { biome: 'unknown' }]) {
      expect(() => validateTerrainManifest({ ...manifest, ...change })).toThrow();
    }
  });

  it('refines screen-space demand near the target without exceeding mesh or LOD budgets', () => {
    expect(planCubeSphereTiles(manifest, 40, [0, 1, 0])).toEqual(roots());
    const near = planCubeSphereTiles(manifest, 40000, [0, 1, 0]);
    expect(near.length).toBeLessThanOrEqual(96);
    expect(Math.max(...near.filter((t) => t.face === 2).map((t) => t.lod))).toBeGreaterThan(5);
    expect(near.every((t) => t.lod <= manifest.max_lod && t.x < 2 ** t.lod && t.y < 2 ** t.lod)).toBe(true);
    expect(near.filter((t) => t.face === 3)).toEqual([{ face: 3, lod: 0, x: 0, y: 0 }]);
    expect(planCubeSphereTiles({ ...manifest, max_lod: 1 }, 40000, [0, 1, 0]).every((t) => t.lod <= 1)).toBe(true);
    // Every leaf contributes its area once; no gaps or overlapping parents.
    for (let face = 0; face < 6; face++) {
      expect(near.filter((t) => t.face === face).reduce((sum, t) => sum + 1 / 4 ** t.lod, 0)).toBeCloseTo(1);
    }
  });

  it('loads one bounded batch at a time, then makes no requests for a stable view', async () => {
    const fetcher = fixtureFetch();
    const stream = new CubeSphereTerrainStream(7, vi.fn());
    await stream.load();
    expect(stream.tiles.size).toBe(0);
    let visible;
    for (let frame = 0; frame < 40; frame++) {
      visible = stream.update(8000, [0, 1, 0]);
      await flush();
    }
    expect(visible.length).toBeGreaterThan(6);
    expect(visible.length).toBeLessThanOrEqual(96);
    const requests = fetcher.mock.calls.length;
    for (let frame = 0; frame < 100; frame++) stream.update(8000, [0, 1, 0]);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(requests);
    for (const [url, options] of fetcher.mock.calls) {
      if (!new URL(url, 'http://localhost/').pathname.endsWith('/api/terrain.php')) continue;
      expect(options.method).toBe('POST');
      expect(options.headers['X-CSRF-Token']).toBe('terrain-test-csrf');
      if (new URL(url, 'http://localhost/').searchParams.get('action') === 'tiles') {
        expect(JSON.parse(options.body).tiles.length).toBeLessThanOrEqual(16);
      }
    }
    stream.dispose();
    expect(stream.tiles.size).toBe(0);
  });

  it('uses zoom and pan hysteresis instead of rebuilding the tile plan for small input jitter', () => {
    const stream = new CubeSphereTerrainStream(7, vi.fn());
    stream.manifest = manifest;
    stream.failed = true;
    stream.update(8000, [0, 1, 0]);
    const original = stream.wanted;
    stream.update(8200, [0.001, Math.sqrt(1 - 0.001 ** 2), 0]);
    expect(stream.wanted).toBe(original);
    stream.update(10000, [0, 1, 0]);
    expect(stream.wanted).not.toBe(original);
    const zoomed = stream.wanted;
    stream.update(10000, cubeSphereDirection(0, 0, 0));
    expect(stream.wanted).not.toBe(zoomed);
  });

  it('keeps a parent until every sibling is confirmed, even when some children are cached', () => {
    const stream = new CubeSphereTerrainStream(7, vi.fn());
    stream.manifest = manifest;
    stream.failed = true;
    roots().forEach((a) => stream.tiles.set(key(a), tile(a)));
    const partial = { face: 2, lod: 1, x: 0, y: 0 };
    stream.tiles.set(key(partial), tile(partial));
    let visible = stream.update(8000, [0, 1, 0]);
    expect(visible.filter((t) => t.face === 2)).toHaveLength(1);
    expect(visible.find((t) => t.face === 2).lod).toBe(0);
    for (const [x, y] of [[1, 0], [0, 1], [1, 1]]) {
      const child = { face: 2, lod: 1, x, y };
      stream.tiles.set(key(child), tile(child));
    }
    visible = stream.update(8000, [0, 1, 0]);
    expect(visible.filter((t) => t.face === 2)).toHaveLength(4);
    expect(visible.filter((t) => t.face === 2).every((t) => t.lod === 1)).toBe(true);
  });

  it('retains confirmed data and reports corrupt batches without retrying every frame', async () => {
    const fetcher = fixtureFetch();
    const status = vi.fn();
    const stream = new CubeSphereTerrainStream(7, status);
    await stream.load();
    stream.update(40, [0, 1, 0]);
    await flush();
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ success: true, tiles: [] }) });
    const before = [...stream.tiles.entries()];
    stream.update(4000, [0, 1, 0]);
    await flush();
    expect(stream.failed).toBe(true);
    expect([...stream.tiles.entries()]).toEqual(before);
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('retaining last confirmed surface'));
    const requests = fetcher.mock.calls.length;
    for (let frame = 0; frame < 50; frame++) stream.update(4000, [0, 1, 0]);
    expect(fetcher).toHaveBeenCalledTimes(requests);
  });

  it('rejects wrong bodies, invalid heights, duplicates and partial responses atomically', async () => {
    for (const change of [
      (tiles) => { tiles[0].body_id = 99; },
      (tiles) => { tiles[1].heights[0] = 65536; },
      (tiles) => { tiles[1] = tiles[0]; },
      (tiles) => { tiles.pop(); },
    ]) {
      fixtureFetch();
      const stream = new CubeSphereTerrainStream(7, vi.fn());
      await stream.load();
      fetch.mockImplementation(async (url, options = {}) => {
        if (new URL(url, 'http://localhost/').pathname.endsWith('/api/auth.php')) {
          return { ok: true, json: async () => ({ token: 'terrain-test-csrf' }) };
        }
        const tiles = JSON.parse(options.body).tiles.map((a) => tile(a));
        change(tiles);
        return { ok: true, json: async () => ({ success: true, tiles }) };
      });
      stream.update(40, [0, 1, 0]);
      await flush();
      expect(stream.failed).toBe(true);
      expect(stream.tiles.size).toBe(0);
    }
  });

  it('aborts pending work and discards late results after disposal', async () => {
    fixtureFetch();
    const status = vi.fn();
    const stream = new CubeSphereTerrainStream(7, status);
    await stream.load();
    let complete;
    fetch.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    stream.update(40, [0, 1, 0]);
    const signal = fetch.mock.calls.at(-1)[1].signal;
    stream.dispose();
    expect(signal.aborted).toBe(true);
    complete({ ok: true, json: async () => ({ success: true, tiles: roots().map((a) => tile(a)) }) });
    await flush();
    expect(stream.tiles.size).toBe(0);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('keeps the CPU cache bounded while moving between distant surface targets', async () => {
    fixtureFetch();
    const stream = new CubeSphereTerrainStream(7, vi.fn());
    await stream.load();
    for (let face = 0; face < 6; face++) {
      for (let frame = 0; frame < 20; frame++) {
        stream.update(18000, cubeSphereDirection(face, 0.3, -0.3));
        await flush();
      }
      expect(stream.tiles.size).toBeLessThanOrEqual(256);
    }
  });

  it('builds actual displaced triangles with skirts, water, city grading and physical units', () => {
    const terrain = resolveBodySurface({ colony: { diameter_km: 12742 } }, 20, 14).terrain;
    const tiles = roots().map((a) => tile(a, 65535));
    const mesh = buildPersistedTerrainMesh(manifest, tiles, terrain);
    expect(mesh.vertexCount).toBe(6 * 1920);
    expect(mesh.vertices.byteLength).toBeLessThan(8 * 1024 * 1024);
    expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
    const radiusAt = (offset) => Math.hypot(mesh.vertices[offset], mesh.vertices[offset + 1] + terrain.radius, mesh.vertices[offset + 2]);
    // Far-side global vertices are float32; permit at most half a metre of quantization.
    const radialTolerance = 0.5 / COLONY_METERS_PER_UNIT;
    expect(Math.abs(radiusAt(0) - terrain.radius - terrain.radius / manifest.radius_km * 8)).toBeLessThan(radialTolerance);
    const center = 2 * 1920 * 8 + (8 * 16 + 8) * 6 * 8;
    expect(radiusAt(center)).toBeCloseTo(terrain.radius, 4);
    const water = buildPersistedTerrainMesh(manifest, roots().map((a) => tile(a, 0)), terrain);
    expect(water.vertices[7]).toBe(1);
    expect(Math.abs(Math.hypot(water.vertices[0], water.vertices[1] + terrain.radius, water.vertices[2]) - terrain.radius))
      .toBeLessThan(radialTolerance);
    const regionManifest = {
      ...manifest,
      regions: { type: 'FeatureCollection', features: [{
        type: 'Feature', properties: { material: 'water', transition_km: 0.25 },
        geometry: { type: 'Polygon', coordinates: [[
          [-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20],
        ]] },
      }] },
    };
    const regionMesh = buildPersistedTerrainMesh(regionManifest, tiles, terrain);
    const regionalVertex = (8 * 16 + 8) * 6 * 8;
    expect(regionMesh.vertices[regionalVertex + 6]).toBe(1);
    expect(regionMesh.vertices[regionalVertex + 7]).toBe(2);
    const stream = new CubeSphereTerrainStream(7, vi.fn());
    stream.manifest = manifest;
    tiles.forEach((t) => stream.surfaceTiles.set(key(t), t));
    expect(stream.sample(0, 0, terrain)).toBeCloseTo(0);
    expect(stream.sample(100, 100, terrain)).toBeGreaterThan(0);
    const gas = buildPersistedTerrainMesh({ ...manifest, biome: 'gas' }, tiles, terrain);
    expect(Math.abs(Math.hypot(gas.vertices[0], gas.vertices[1] + terrain.radius, gas.vertices[2]) - terrain.radius))
      .toBeLessThan(radialTolerance);
  });

  it('uses the same persisted irregular shape for terrain, buildings, normals and camera target', () => {
    expect(mapColonySurfacePoint(0, 0, 1, 0)).toEqual([0, 1, 0]);
    const shape = { version: 1, axes: [1.45, 0.8, 0.95], deformation: 0.22 };
    const terrain = { ...resolveBodySurface({ colony: { body_type: 'comet', diameter_km: 12 } }, 20, 14).terrain, shape, heightSampler: () => 0 };
    const shaped = { ...manifest, shape, biome: 'ice' };
    expect(validateBodyShape(shape)).toBe(shape);
    expect(validateTerrainManifest(shaped)).toBe(shaped);
    const northFactor = 0.8 * (1 - 0.22 * 0.6);
    expect(bodyShapeFactor([0, 1, 0], shape)).toBeCloseTo(northFactor);
    const ground = mapColonySurfacePoint(terrain.radius, 0, 0, 0, terrain);
    expect(ground[1]).toBeCloseTo(terrain.radius * (northFactor - 1));
    const normal = bodySurfaceNormal(terrain.radius, 30, 20, shape);
    const foundation = mapColonySurfacePoint(terrain.radius, 30, 0, 20, terrain);
    const roof = mapColonySurfacePoint(terrain.radius, 30, 3, 20, terrain);
    roof.forEach((value, axis) => expect(value - foundation[axis]).toBeCloseTo(normal[axis] * 3));
    expect(Math.hypot(...normal)).toBeCloseTo(1);
    const northTile = tile({ face: 2, lod: 0, x: 0, y: 0 }, 65535);
    const mesh = buildPersistedTerrainMesh(shaped, [northTile], terrain);
    const center = (8 * 16 + 8) * 6 * 8;
    expect(mesh.vertices[center + 1]).toBeCloseTo(ground[1], 4);
    const pose = cityCameraPose(25, 1, { x: 0, z: 0 }, terrain.radius, terrain);
    pose.target.forEach((value, axis) => expect(value).toBeCloseTo(ground[axis]));
    const matrix = cityCameraMatrix(1.5, 25, 1, { x: 0, z: 0 }, terrain.radius, terrain);
    expect(projectCityPoint(matrix, ...ground)[0]).toBeCloseTo(0);
    expect(projectCityPoint(matrix, ...ground)[1]).toBeCloseTo(0);
    const stream = new CubeSphereTerrainStream(7, vi.fn());
    stream.manifest = shaped;
    stream.surfaceTiles.set(key(northTile), northTile);
    expect(stream.sample(0, 0, terrain)).toBeCloseTo(0);
    expect(bodyGroundPoint(terrain.radius, 30, 20, shape)).not.toEqual(bodyGroundPoint(terrain.radius, 30, 20));
    for (const invalid of [{ ...shape, axes: [3, 1, 1] }, { ...shape, version: 2 }, { ...shape, deformation: NaN }]) {
      expect(() => validateBodyShape(invalid)).toThrow();
    }
  });

  it('has real perspective at every landing stage instead of orthographic depth at the surface', () => {
    for (const progress of [0, 0.5, 1]) {
      const pose = cityCameraPose(25, progress);
      const matrix = cityCameraMatrix(1.5, 25, progress);
      const point = (depth) => pose.target.map((value, axis) => value + pose.right[axis] * 3 + pose.back[axis] * depth);
      const near = projectCityPoint(matrix, ...point(5));
      const far = projectCityPoint(matrix, ...point(-5));
      expect(Math.abs(near[0])).toBeGreaterThan(Math.abs(far[0]) * 1.1);
      expect(near[2]).toBeLessThan(far[2]);
    }
  });

  it('keeps the eye outside elongated bodies and stops swept moves before crossing a lobe', () => {
    const shape = { version: 1, axes: [2, 0.7, 0.9], deformation: 0.3 };
    const radius = 30;
    const terrain = { radius, shape, collisionRelief: 0.6 };
    const start = [100, -radius, 0], end = [-100, -radius, 0];
    const constrained = constrainBodyCamera(start, end, radius, terrain);
    expect(constrained[0]).toBeGreaterThan(radius * bodyShapeFactor([1, 0, 0], shape) + 0.6);
    expect(constrained[0]).toBeLessThan(start[0]);
    const corrected = constrainBodyCamera(null, [1, -radius, 0], radius, terrain);
    expect(corrected[0]).toBeGreaterThan(radius * bodyShapeFactor([1, 0, 0], shape) + 0.6);
    const clear = constrainBodyCamera([100, 100, 0], [-100, 100, 0], radius, terrain);
    expect(clear).toEqual([-100, 100, 0]);
    expect(constrainBodyCamera(null, [0, -radius, 0], radius, terrain).every(Number.isFinite)).toBe(true);
  });
});
