import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { HeroBattleTactics } from '../../js/rendering/hero-battle-tactics.js';

describe('hero tactical presentation plans', () => {
  it('has seeded independent wing plans containing all four strategies and bounded continuous offsets', () => {
    const tactics = new HeroBattleTactics(42, 24);
    expect(tactics.snapshot()).toEqual(new HeroBattleTactics(42, 24).snapshot());
    expect(tactics.snapshot()).not.toEqual(new HeroBattleTactics(43, 24).snapshot());
    for (const wing of tactics.plans) expect(new Set(wing.slice(0, 4).map(plan => plan.strategy)).size).toBe(4);
    for (const wing of tactics.plans) {
      expect(wing.every((plan, index) => !index || plan.strategy !== wing[index - 1].strategy)).toBe(true);
    }
    for (const shipClass of ['carrier', 'battlecruiser', 'corvette', 'fighter']) {
      for (let index = 0; index < 24; index++) {
        for (const boundary of [4, 8, 12, 16, 20, 24, 28, 32]) {
          const before = tactics.displacement(index, boundary - 1e-5, shipClass);
          const after = tactics.displacement(index, boundary + 1e-5, shipClass);
          expect(before.distanceTo(after)).toBeLessThan(1e-6);
          expect(after.length()).toBeLessThan(8);
        }
      }
    }
    expect(() => new HeroBattleTactics(-1, 24)).toThrow(TypeError);
    expect(() => new HeroBattleTactics(42, 7)).toThrow(TypeError);
    expect(() => tactics.decision(24, 0)).toThrow(TypeError);
    expect(() => tactics.decision(0, NaN)).toThrow(TypeError);
  });
  it('focuses surviving opposing capitals, protects carriers and never targets allies or wrecks', () => {
    const tactics = new HeroBattleTactics(42, 8);
    const entities = Array.from({ length: 8 }, (_, index) => ({
      heroDestroyed: false, position: new Vector3(index, 0, 0),
      heroStatus: { role: index % 4 === 0 ? 'carrier' : index % 4 === 1 ? 'standoff' : 'interceptor' },
    }));
    const focus = tactics.plans[0].find(plan => plan.strategy === 'focus-fire').at;
    const escort = tactics.plans[0].find(plan => plan.strategy === 'escort').at;
    for (let index = 0; index < 4; index++) expect([4, 5, 6]).toContain(tactics.target(index, escort, entities));
    const targets = [0, 1, 2, 3].map(index => tactics.target(index, focus, entities));
    expect(new Set(targets).size).toBe(1);
    expect([4, 5]).toContain(targets[0]);
    entities[targets[0]].heroDestroyed = true;
    expect(tactics.target(0, focus, entities)).not.toBe(targets[0]);
    for (let time = 0; time <= 30; time += 4) {
      for (let index = 0; index < 8; index++) {
        const target = tactics.target(index, time, entities);
        expect(target < 4).not.toBe(index < 4);
        expect(entities[target].heroDestroyed).toBe(false);
      }
    }
    entities.slice(4).forEach(entity => { entity.heroDestroyed = true; });
    expect(tactics.target(0, focus, entities)).toBe(-1);
  });
});
