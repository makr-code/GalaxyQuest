import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { EARTH_REFERENCE, geographicVector } from '../../js/rendering/earth-reference-geography.js';
import { RELIEF_GRID, createEarthRelief, reliefSettings, reliefPoint, elevationColor,
  paintReliefTexture, buildReliefMesh, inspectReliefMesh, reliefMeshRows } from '../../js/rendering/earth-reference-relief.js';

const bytes = readFileSync(resolve('tools', 'data', 'earth', 'etopo1-ice-30arcmin.i16'));
const buffer = new ArrayBuffer(bytes.byteLength);
new Uint8Array(buffer).set(bytes);
const relief = createEarthRelief(buffer);
const settings = { exaggeration: 1, seaLevel: 0, ocean: true };

describe('measured ETOPO Earth relief', () => {
  it('resolves bounded inspection details and reduces the measured Tibet error at the same coordinate', () => {
    expect(reliefMeshRows('auto')).toBeNull();
    for (const rows of [32, 64, 128, 180]) expect(reliefMeshRows(String(rows))).toBe(rows);
    for (const invalid of ['', null, true, '360', NaN]) expect(() => reliefMeshRows(invalid)).toThrow(/detail/);
    const options = { ...settings, exaggeration: 20 };
    const direction = geographicVector(87, 30);
    const origin = direction.map(n => n * 3);
    const ray = direction.map(n => -n);
    const coarse = inspectReliefMesh(buildReliefMesh(relief, 64, options), origin, ray, relief, options);
    const fineMesh = buildReliefMesh(relief, 180, options);
    expect(fineMesh.byteLength).toBe(180 * 360 * 6 * 48);
    expect(fineMesh.byteLength).toBeLessThan(32 * 1024 * 1024);
    const fine = inspectReliefMesh(fineMesh, origin, ray, relief, options);
    expect(fine.longitude).toBeCloseTo(coarse.longitude, 5);
    expect(fine.latitude).toBeCloseTo(coarse.latitude, 5);
    expect(Math.abs(coarse.meshError)).toBeGreaterThan(400);
    expect(Math.abs(fine.meshError)).toBeLessThan(0.1);
    expect(fine.elevation).toBeCloseTo(coarse.elevation, 2);
  });

  it('picks the nearest actual mesh triangle, separating source height from chord and LOD error', () => {
    const options = { ...settings, exaggeration: 20 };
    const vertices = buildReliefMesh(relief, 64, options);
    const hit = inspectReliefMesh(vertices, [3, 0, 0], [-1, 0, 0], relief, options);
    expect(hit.longitude).toBeCloseTo(0);
    expect(hit.latitude).toBeCloseTo(0);
    expect(hit.elevation).toBe(-4935);
    expect(hit.water).toBe(true);
    expect(hit.meshElevation).toBeCloseTo(0, 3);
    expect(hit.meshError).toBeCloseTo(0, 3);
    const bottom = inspectReliefMesh(buildReliefMesh(relief, 64, { ...options, ocean: false }),
      [3, 0, 0], [-1, 0, 0], relief, { ...options, ocean: false });
    expect(bottom.meshElevation).toBeCloseTo(-4935, 1);
    const texture = inspectReliefMesh(buildReliefMesh(relief, 32, options, true),
      [3, 0, 0], [-1, 0, 0], relief, options, true);
    expect(texture.meshError).toBeNull();
    expect(texture.textureOnly).toBe(true);
    expect(inspectReliefMesh(vertices, [3, 3, 0], [1, 0, 0], relief, options)).toBeNull();
    expect(() => inspectReliefMesh(vertices, [NaN, 0, 0], [1, 0, 0], relief, options)).toThrow(/ray/);
    expect(() => inspectReliefMesh(vertices, [3, 0, 0], [0, 0, 0], relief, options)).toThrow(/ray/);
  });

  it('pins real NOAA ice-surface source bytes in explicit little-endian metre units', () => {
    expect(bytes.byteLength).toBe(721 * 361 * 2);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(RELIEF_GRID.sha256);
  });

  it.each([
    ['Tibet', 87, 30, 5275],
    ['Mariana region', 142.5, 11.5, -8877],
    ['Atlantic', 0, 0, -4935],
    ['Central Europe', 20, 50, 252],
    ['Greenland ice surface', -42, 74, 2983],
  ])('samples verified raw metre value at %s', (_name, lon, lat, elevation) => {
    expect(relief.sample(lon, lat)).toBe(elevation);
    expect(relief.sample(lon + 360, lat)).toBe(elevation);
  });

  it('interpolates grid nodes bilinearly, never inferring metre height from colors', () => {
    const corners = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];
    const mean = corners.reduce((sum, coordinate) => sum + relief.sample(...coordinate) / 4, 0);
    expect(relief.sample(0.25, 0.25)).toBe(mean);
  });

  it('reconciles one-metre endpoint rounding and converges all longitudes at both poles', () => {
    for (const lat of [-90, -48.5, 0, 8, 89.5, 90]) {
      expect(relief.sample(-180, lat)).toBe(relief.sample(180, lat));
      expect(Math.abs(relief.sample(-180 + 1e-7, lat) - relief.sample(180 - 1e-7, lat))).toBeLessThan(0.01);
    }
    for (const lat of [-90, 90]) {
      expect(relief.sample(-120, lat)).toBe(relief.sample(120, lat));
    }
    expect(relief.sample(0, -90)).toBeGreaterThan(2700);
    expect(relief.sample(0, 90)).toBeLessThan(-4200);
  });

  it('keeps source metres independent of visual exaggeration and clamps the visible sea to its datum', () => {
    const physical = reliefPoint(relief, 87, 30, settings);
    const enhanced = reliefPoint(relief, 87, 30, { ...settings, exaggeration: 40 });
    expect(physical.elevation).toBe(5275);
    expect(enhanced.elevation).toBe(physical.elevation);
    expect(enhanced.radius - 1).toBeCloseTo((physical.radius - 1) * 40, 12);
    expect(physical.radius).toBeCloseTo(1 + 5275 / (EARTH_REFERENCE.radiusKm * 1000), 12);
    const sea = reliefPoint(relief, 0, 0, { ...settings, exaggeration: 40, seaLevel: 500 });
    expect(sea.elevation).toBe(-4935);
    expect(sea.displayedElevation).toBe(500);
    expect(sea.radius).toBeCloseTo(1 + 500 * 40 / 6371008.8, 12);
    expect(sea.water).toBe(true);
    const bottom = reliefPoint(relief, 0, 0, { ...settings, exaggeration: 40, ocean: false });
    expect(bottom.displayedElevation).toBe(-4935);
    expect(bottom.radius).toBeLessThan(1);
    expect(bottom.water).toBe(false);
    expect(reliefPoint(relief, 20, 50, { ...settings, seaLevel: 500 }).water).toBe(true);
    expect(reliefPoint(relief, 20, 50, { ...settings, seaLevel: -500 }).water).toBe(false);
  });

  it('uses the same sampling/sea settings for texture classification, without exaggerating height colors', () => {
    const context = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
    const a = paintReliefTexture(context, relief, 360, 180, settings);
    const b = paintReliefTexture(context, relief, 360, 180, { ...settings, exaggeration: 40 });
    expect(a).toEqual(b);
    let mismatches = 0;
    for (let y = 0; y < 180; y++) for (let x = 0; x < 360; x++) {
      const water = relief.sample((x + 0.5) / 360 * 360 - 180, 90 - (y + 0.5) / 180 * 180) < 0;
      if ((a[(y * 360 + x) * 4 + 3] === 0) !== water) mismatches++;
    }
    expect(mismatches).toBe(0);
    const countWater = data => {
      let total = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] === 0) total++;
      return total;
    };
    expect(countWater(paintReliefTexture(context, relief, 360, 180, { ...settings, seaLevel: 500 })))
      .toBeGreaterThan(countWater(a));
    expect(countWater(paintReliefTexture(context, relief, 360, 180, { ...settings, ocean: false }))).toBe(0);
    expect(elevationColor(-8000)).not.toEqual(elevationColor(5000));
  });

  it('builds finite depth-tested 48-byte triangles with physical relief, seafloor and no backwards faces', () => {
    const enhanced = { ...settings, exaggeration: 40, ocean: false };
    const vertices = buildReliefMesh(relief, 64, enhanced);
    expect(vertices.length).toBe(64 * 128 * 6 * 12);
    let maximumError = 0, minimumRadius = Infinity, maximumRadius = 0, backwards = 0;
    for (let i = 0; i < vertices.length; i += 12) {
      const [x, y, z] = vertices.subarray(i, i + 3), radius = Math.hypot(x, y, z);
      const lat = Math.asin(Math.max(-1, Math.min(1, y / radius))) * 180 / Math.PI;
      const lon = Math.atan2(-z, x) * 180 / Math.PI;
      maximumError = Math.max(maximumError, Math.abs(radius - reliefPoint(relief, lon, lat, enhanced).radius));
      minimumRadius = Math.min(minimumRadius, radius);
      maximumRadius = Math.max(maximumRadius, radius);
    }
    for (let i = 0; i < vertices.length; i += 36) {
      const [ax, ay, az] = vertices.subarray(i, i + 3);
      const bx = vertices[i + 12] - ax, by = vertices[i + 13] - ay, bz = vertices[i + 14] - az;
      const cx = vertices[i + 24] - ax, cy = vertices[i + 25] - ay, cz = vertices[i + 26] - az;
      if (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx) < -1e-10) backwards++;
    }
    expect(maximumError).toBeLessThan(0.000002);
    expect(minimumRadius).toBeLessThan(0.96);
    expect(maximumRadius).toBeGreaterThan(1.03);
    expect(backwards).toBe(0);
    expect(vertices.every(Number.isFinite)).toBe(true);
    const sphere = buildReliefMesh(relief, 32, settings, true);
    let sphereError = 0;
    for (let i = 0; i < sphere.length; i += 12) sphereError = Math.max(sphereError, Math.abs(Math.hypot(...sphere.subarray(i, i + 3)) - 1));
    expect(sphereError).toBeLessThan(1e-7);
  });

  it('rejects invalid data, coordinates, units and inspection settings explicitly', () => {
    expect(() => createEarthRelief(new ArrayBuffer(8))).toThrow(/complete/);
    const corrupt = buffer.slice(0);
    new DataView(corrupt).setInt16(2000, -32000, true);
    expect(() => createEarthRelief(corrupt)).toThrow(/height/);
    expect(() => relief.sample(0, 91)).toThrow(/longitude/);
    expect(() => relief.sample(NaN, 0)).toThrow(/longitude/);
    for (const input of [{ exaggeration: 0 }, { exaggeration: 41 }, { exaggeration: true },
      { seaLevel: 501 }, { seaLevel: null }, { seaLevel: '' }, { ocean: 1 }]) {
      expect(() => reliefSettings({ ...settings, ...input })).toThrow(/settings/);
    }
    expect(reliefSettings({ exaggeration: '10', seaLevel: '100', ocean: true }))
      .toEqual({ exaggeration: 10, seaLevel: 100, ocean: true });
    expect(() => buildReliefMesh(relief, 256, settings)).toThrow(/LOD/);
  });
});
