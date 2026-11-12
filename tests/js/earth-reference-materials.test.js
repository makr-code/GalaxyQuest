import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { DataUtils } from 'three';
import { EARTH_REFERENCE } from '../../js/rendering/earth-reference-geography.js';
import { createEarthRelief, paintReliefTexture } from '../../js/rendering/earth-reference-relief.js';
import { earthMaterialPoint, buildEarthMaterialMap, earthMaterialMipChain,
  earthSurfaceColor, earthAppearanceSettings, earthSunDirection } from '../../js/rendering/earth-reference-materials.js';
import { cloudShellRadius } from '../../js/rendering/earth-reference-clouds.js';

const bytes = readFileSync(resolve('tools', 'data', 'earth', 'etopo1-ice-30arcmin.i16'));
const buffer = new ArrayBuffer(bytes.length);
new Uint8Array(buffer).set(bytes);
const relief = createEarthRelief(buffer);
const settings = { exaggeration: 10, seaLevel: 0, ocean: true };
const appearance = { bump: '10', phase: '0', materialView: 'shaded', palette: 'height', gloss: true, sky: true,
  cloudMode: 'shell', cloudAltitude: '12', cloudShadows: true, solarAtmosphere: true, cityLights: true,
  sunAzimuth: '54.462322208', sunElevation: '16.204' };

describe('Earth authored material maps', () => {
  it('uses physical cloud altitude independent of terrain exaggeration', () => {
    expect(cloudShellRadius(12)).toBeCloseTo(1 + 12 / 6371.0088, 12);
    expect(cloudShellRadius(200)).toBeLessThan(1.032);
    for (const value of [0, -1, 201, NaN, Infinity, '12', null]) {
      expect(() => cloudShellRadius(value)).toThrow(/altitude/);
    }
  });

  it('converts bounded world-space sun angles into one unit light direction', () => {
    expect(earthSunDirection('0', '0')).toEqual([1, 0, 0]);
    expect(earthSunDirection(90, 0)[2]).toBeCloseTo(1, 12);
    expect(earthSunDirection(20, 90)[1]).toBe(1);
    expect(Math.hypot(...earthSunDirection(-75, -45))).toBeCloseTo(1, 12);
    for (const args of [[null, 0], [true, 0], ['', 0], [181, 0], [0, -91], [0, NaN]]) {
      expect(() => earthSunDirection(...args)).toThrow(/sun angles/);
    }
  });

  it('derives signed east/north slopes in physical metres without geometry exaggeration', () => {
    const meters = EARTH_REFERENCE.radiusKm * 1000 * Math.PI / 180;
    const slope = { sample: (lon, lat) => 1000 + meters * (lon * 0.1 + lat * 0.2) };
    const a = earthMaterialPoint(slope, 0, 0, { ...settings, ocean: false });
    expect(a.eastSlope).toBeCloseTo(0.1, 8);
    expect(a.northSlope).toBeCloseTo(0.2, 8);
    expect(earthMaterialPoint(slope, 0, 0, { ...settings, ocean: false, exaggeration: 40 })).toEqual(a);
  });

  it('keeps seas level while exposed seafloor uses its own gradient and dry material', () => {
    const slope = { sample: (lon, lat) => -2000 + lon * 100 + lat * 200 };
    expect(earthMaterialPoint(slope, 0, 0, settings)).toEqual({
      eastSlope: 0, northSlope: 0, roughness: 0.16, specular: 0.02,
    });
    const bottom = earthMaterialPoint(slope, 0, 0, { ...settings, ocean: false });
    expect(bottom.eastSlope).toBeGreaterThan(0);
    expect(bottom.northSlope).toBeGreaterThan(bottom.eastSlope);
    expect(bottom.roughness).toBe(0.88);
    expect(bottom.specular).toBe(0.04);
    const flooded = earthMaterialPoint({ sample: () => 100 }, 0, 0, { ...settings, seaLevel: 500 });
    expect(flooded.roughness).toBe(0.16);
  });

  it('is periodic across the dateline and finite at both poles', () => {
    for (const lat of [-90, -89.9, -30, 0, 45, 89.9, 90]) {
      expect(earthMaterialPoint(relief, -180, lat, settings)).toEqual(earthMaterialPoint(relief, 180, lat, settings));
      expect(Object.values(earthMaterialPoint(relief, 25, lat, settings)).every(Number.isFinite)).toBe(true);
    }
    expect(earthMaterialPoint(relief, 0, -90, settings).eastSlope).toBe(0);
    expect(earthMaterialPoint(relief, 0, -90, settings).northSlope).toBeCloseTo(0, 12);
  });

  it('packs filterable linear half floats with the documented slope / roughness / F0 channels', () => {
    const data = buildEarthMaterialMap({ sample: () => -1000 }, 8, 4, settings);
    expect(data).toBeInstanceOf(Uint16Array);
    expect(data.length).toBe(8 * 4 * 4);
    const point = Array.from(data.slice(0, 4), DataUtils.fromHalfFloat);
    expect(point[0]).toBe(0);
    expect(point[1]).toBe(0);
    expect(point[2]).toBeCloseTo(0.16, 3);
    expect(point[3]).toBeCloseTo(0.02, 4);
    expect(() => buildEarthMaterialMap(relief, 0, 4, settings)).toThrow(/dimensions/);
    expect(() => buildEarthMaterialMap(relief, 8, 4, { ...settings, ocean: null })).toThrow(/settings/);
  });

  it('averages signed slopes and linear materials in bounded mip levels, including the final one-pixel row', () => {
    const original = new Uint16Array([
      0.1, -0.2, 0.16, 0.02, -0.1, 0.2, 0.88, 0.04,
      0.1, -0.2, 0.16, 0.02, -0.1, 0.2, 0.88, 0.04,
      0.1, -0.2, 0.16, 0.02, -0.1, 0.2, 0.88, 0.04,
      0.1, -0.2, 0.16, 0.02, -0.1, 0.2, 0.88, 0.04,
    ].map(DataUtils.toHalfFloat));
    const levels = earthMaterialMipChain(original, 4, 2);
    expect(levels.map(({ width, height }) => [width, height])).toEqual([[4, 2], [2, 1], [1, 1]]);
    expect(levels[0].data).toBe(original);
    const final = Array.from(levels.at(-1).data, DataUtils.fromHalfFloat);
    expect(final[0]).toBe(0);
    expect(final[1]).toBe(0);
    expect(final[2]).toBeCloseTo(0.52, 3);
    expect(final[3]).toBeCloseTo(0.03, 4);
    expect(() => earthMaterialMipChain(new Uint16Array(24), 3, 2)).toThrow(/power-of-two/);
  });

  it('keeps the DEM coast/height invariant while replacing only schematic albedo', () => {
    const context = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
    const height = paintReliefTexture(context, relief, 32, 16, settings);
    const surface = paintReliefTexture(context, relief, 32, 16, settings, earthSurfaceColor);
    expect(surface).not.toEqual(height);
    for (let i = 3; i < height.length; i += 4) expect(surface[i]).toBe(height[i]);
    expect(earthSurfaceColor(0, 0, -5000, true)).toEqual([22, 63, 104]);
    expect(earthSurfaceColor(20, 25, 100, false)).not.toEqual(earthSurfaceColor(20, 0, 100, false));
  });

  it('rejects invalid appearance controls rather than silently defaulting', () => {
    expect(earthAppearanceSettings(appearance)).toMatchObject({ bump: 10, mode: 0, phase: 0 });
    expect(earthAppearanceSettings(appearance).cityMaterials).toBe(false);
    expect(earthAppearanceSettings({ ...appearance, cityMaterials: true }).cityMaterials).toBe(true);
    for (const cityMaterials of [null, 0, 'true']) {
      expect(() => earthAppearanceSettings({ ...appearance, cityMaterials })).toThrow(/appearance/);
    }
    expect(earthAppearanceSettings({ ...appearance, materialView: 'specular', phase: '120' }).mode).toBe(4);
    for (const invalid of [{ bump: null }, { bump: true }, { bump: '100' }, { phase: '' },
      { phase: -1 }, { sky: null }, { gloss: 'true' }, { palette: 'satellite' }, { materialView: 'unknown' },
      { cloudAltitude: true }, { cloudAltitude: '999' }, { cloudMode: 'weather' }, { cloudShadows: 'true' },
      { solarAtmosphere: 'true' }]) {
      expect(() => earthAppearanceSettings({ ...appearance, ...invalid })).toThrow(/appearance/);
    }
    expect(() => earthAppearanceSettings({ ...appearance, sunAzimuth: null })).toThrow(/sun angles/);
  });
});
