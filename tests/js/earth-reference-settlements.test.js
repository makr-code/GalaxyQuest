import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EARTH_CITY_ANCHORS, earthDevelopment, earthSettlementPlan } from '../../js/rendering/earth-reference-settlements.js';
import { createEarthRelief } from '../../js/rendering/earth-reference-relief.js';
import { geographicVector } from '../../js/rendering/earth-reference-geography.js';
import '../../js/rendering/colony-surface-plan.js';

const bytes = readFileSync(resolve('tools', 'data', 'earth', 'etopo1-ice-30arcmin.i16'));
const buffer = new ArrayBuffer(bytes.byteLength);
new Uint8Array(buffer).set(bytes);
const relief = createEarthRelief(buffer);
const model = window.GQColonySurfacePlan;

describe('Earth inspection colony fixtures', () => {
  it('grows existing cities and founds additional cities without moving existing anchors', () => {
    expect(earthDevelopment('0')).toEqual({ year: 0, population: 12000000 });
    expect(earthDevelopment(50).population).toBe(120000000);
    expect(earthDevelopment(100).population).toBe(1200000000);
    expect(earthDevelopment(200).population).toBe(120000000000);
    for (const invalid of [-1, 201, NaN, Infinity, null, '', true]) {
      expect(() => earthDevelopment(invalid)).toThrow(/development year/);
    }
    const early = earthSettlementPlan(model, relief, 0, true, 0);
    const late = earthSettlementPlan(model, relief, 0, true, 100);
    const nearby = earthSettlementPlan(model, relief, 0, true, 0.01);
    expect(early.settlements).toHaveLength(12);
    early.settlements.forEach((site, index) => {
      expect(late.settlements[index].direction).toEqual(site.direction);
      expect(late.settlements[index].id).toBe(site.id);
      expect(late.settlements[index].radius).toBeGreaterThan(site.radius * 7);
      expect(nearby.settlements[index].radius).toBeGreaterThan(site.radius);
      expect(nearby.settlements[index].radius / site.radius).toBeLessThan(1.001);
    });

    expect(early.state.lights).toBe(late.state.lights);
    expect(late.urbanSettlements.length).toBeGreaterThan(early.urbanSettlements.length);
    expect(late.urbanSettlements.length).toBeGreaterThan(12);
    expect(late.urbanSettlements.reduce((sum, city) => sum + city.population, late.ruralPopulation))
      .toBeCloseTo(late.state.population, 4);
  });

  it('feeds colony profiles through real building snapshots and enables future metropolitan infill', () => {
      const early = earthSettlementPlan(model, relief, 0, true, 50, 'mixed');
      const future = earthSettlementPlan(model, relief, 0, true, 200, 'mixed');
      expect(early.settlements.every(site => site.conurbation.width === 0)).toBe(true);
      expect(future.settlements.some(site => site.conurbation.width > 0)).toBe(true);
      expect(future.state.civic).toEqual([0.25, 0.25]);
      expect(earthSettlementPlan(model, relief, 0, true, 100, 'agriculture').state.weights).toEqual([1, 0, 0]);
      expect(earthSettlementPlan(model, relief, 0, true, 100, 'industry').state.weights).toEqual([0, 0, 1]);
      expect(earthSettlementPlan(model, relief, 0, true, 100, 'science').state.civic).toEqual([0, 1]);
      expect(earthSettlementPlan(model, relief, 0, true, 100, 'trade').state.civic).toEqual([1, 0]);
      expect(() => earthSettlementPlan(model, relief, 0, true, 100, 'unknown')).toThrow(/economy profile/);
  });

  it('uses the real colony planner and deterministic dry-land city anchors in the Earth frame', () => {
    const plan = earthSettlementPlan(model, relief, 0, true);
    expect(plan.settlements).toHaveLength(12);
    expect(plan).toEqual(earthSettlementPlan(model, relief, 0, true));
    plan.settlements.forEach((site, index) => {
      const [name, lon, lat] = EARTH_CITY_ANCHORS[index];
      expect(site.id).toBe(`earth-inspection:${name}`);
      expect(site.direction).toEqual(geographicVector(lon, lat));
      expect(site.height).toBeGreaterThan(0);
      expect(site.height).toBe(relief.sample(lon, lat) / 1000);
      expect(site.radius).toBeGreaterThan(0);
      expect(site.weights).toEqual([0, 0, 0]);
    });
    expect(plan.roads).toEqual([]);
    expect(model.uniforms(plan)[0]).toBe(12);
  });

  it('changes only shared illumination state when power is switched and excludes flooded anchors', () => {
    const on = earthSettlementPlan(model, relief, 0, true);
    const off = earthSettlementPlan(model, relief, 0, false);
    expect(off.settlements).toEqual(on.settlements);
    expect(model.uniforms(on)[1]).toBe(1);
    expect(model.uniforms(off)[1]).toBe(0);
    const flooded = earthSettlementPlan(model, relief, 1000, true);
    expect(flooded.settlements.length).toBeLessThan(on.settlements.length);
    expect(flooded.settlements.every(site => site.height > 1)).toBe(true);
    expect(earthSettlementPlan(model, relief, 9000, true).settlements).toEqual([]);
  });
});
