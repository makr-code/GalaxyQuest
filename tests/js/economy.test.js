/**
 * economy.test.js — Unit tests for EconomySimulation / GalacticMarket / EconomyPolicy / GoodStock
 *
 * Tests cover:
 *   • GoodStock:           add (capacity cap), consume, has, serialize/deserialize
 *   • GalacticMarket:      price formula, sell/buy supply-demand shift, market events
 *   • EconomyPolicy:       globalPolicy effects, tax rates, subsidies, serialization
 *   • ColonyEconomyNode:   processTick (T2 production), consumeTick (pop needs)
 *   • EconomySimulation:   registerColony, tick cycle, tech unlock gating,
 *                          setProductionMethod, summary, serialize/deserialize
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire }                     from 'node:module';
import { fileURLToPath }                     from 'node:url';
import path                                  from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const {
  EconomySimulation,
  GalacticMarket,
  EconomyPolicy,
  GoodStock,
  GoodType,
  GOOD_TIER,
  ProcessingMethod,
  ProcessingBuilding,
  EconomicPolicy,
  PROCESSING_RECIPES,
  GOOD_BASE_PRICE,
  POP_CONSUMPTION_RATE,
  POLICY_EFFECTS,
  DEFAULT_TAX_RATES,
  MARKET_EVENT_TEMPLATES,
  PRICE_MULT_MIN,
  PRICE_MULT_MAX,
  PopClass,
  POP_CLASS_ORDER,
  POP_CLASS_NEEDS,
  POP_CLASS_YIELD,
  POP_CLASS_MAX_FRACTION,
  CLASS_NEED_HAPPINESS,
  ADVANCEMENT_TICKS_REQUIRED,
  DESCENT_TICKS_REQUIRED,
} = require(path.join(root, 'js/engine/game/EconomySimulation.js'));

// ---------------------------------------------------------------------------
// GoodStock
// ---------------------------------------------------------------------------

describe('GoodStock — basic inventory', () => {
  it('initializes all GoodType keys to 0', () => {
    const s = new GoodStock();
    for (const g of Object.values(GoodType)) {
      expect(s.get(g)).toBe(0);
    }
  });

  it('initializes from provided values', () => {
    const s = new GoodStock({ [GoodType.STEEL_ALLOY]: 100 });
    expect(s.get(GoodType.STEEL_ALLOY)).toBe(100);
  });

  it('add() returns actual amount added', () => {
    const s = new GoodStock();
    const added = s.add(GoodType.STEEL_ALLOY, 50);
    expect(added).toBe(50);
    expect(s.get(GoodType.STEEL_ALLOY)).toBe(50);
  });

  it('add() is capped at capacity', () => {
    const s   = new GoodStock({}, { [GoodType.STEEL_ALLOY]: 10 });
    const r1  = s.add(GoodType.STEEL_ALLOY, 8);
    const r2  = s.add(GoodType.STEEL_ALLOY, 8);  // only 2 slots remaining
    expect(r1).toBe(8);
    expect(r2).toBe(2);
    expect(s.get(GoodType.STEEL_ALLOY)).toBe(10);
  });

  it('consume() returns actual amount consumed', () => {
    const s = new GoodStock({ [GoodType.CONSUMER_GOODS]: 30 });
    expect(s.consume(GoodType.CONSUMER_GOODS, 10)).toBe(10);
    expect(s.get(GoodType.CONSUMER_GOODS)).toBe(20);
  });

  it('consume() clamps to available stock', () => {
    const s = new GoodStock({ [GoodType.CONSUMER_GOODS]: 5 });
    expect(s.consume(GoodType.CONSUMER_GOODS, 100)).toBe(5);
    expect(s.get(GoodType.CONSUMER_GOODS)).toBe(0);
  });

  it('has() returns true when sufficient stock', () => {
    const s = new GoodStock({ [GoodType.LUXURY_GOODS]: 10 });
    expect(s.has(GoodType.LUXURY_GOODS, 10)).toBe(true);
    expect(s.has(GoodType.LUXURY_GOODS, 11)).toBe(false);
  });

  it('capacity() returns the configured capacity', () => {
    const s = new GoodStock({}, { [GoodType.STEEL_ALLOY]: 777 });
    expect(s.capacity(GoodType.STEEL_ALLOY)).toBe(777);
  });

  it('serialize/deserialize round-trips', () => {
    const s1 = new GoodStock({ [GoodType.FOCUS_CRYSTALS]: 42 }, { [GoodType.FOCUS_CRYSTALS]: 999 });
    const s2 = GoodStock.deserialize(s1.serialize());
    expect(s2.get(GoodType.FOCUS_CRYSTALS)).toBe(42);
    expect(s2.capacity(GoodType.FOCUS_CRYSTALS)).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// GoodType / Tier metadata
// ---------------------------------------------------------------------------

describe('GoodType tier metadata', () => {
  it('all Tier-2 goods have GOOD_TIER === 2', () => {
    const tier2 = [
      GoodType.STEEL_ALLOY, GoodType.FOCUS_CRYSTALS, GoodType.REACTOR_FUEL,
      GoodType.BIOCOMPOST, GoodType.ELECTRONICS_COMPONENTS,
    ];
    for (const g of tier2) expect(GOOD_TIER[g]).toBe(2);
  });

  it('all Tier-3 goods have GOOD_TIER === 3', () => {
    const tier3 = [
      GoodType.CONSUMER_GOODS, GoodType.LUXURY_GOODS, GoodType.MILITARY_EQUIPMENT,
      GoodType.RESEARCH_KITS, GoodType.COLONIZATION_PACKS,
    ];
    for (const g of tier3) expect(GOOD_TIER[g]).toBe(3);
  });

  it('every GoodType has a base price', () => {
    for (const g of Object.values(GoodType)) {
      expect(GOOD_BASE_PRICE[g]).toBeGreaterThan(0);
    }
  });

  it('every GoodType has a STANDARD recipe', () => {
    for (const g of Object.values(GoodType)) {
      expect(PROCESSING_RECIPES[g]).toBeDefined();
      expect(PROCESSING_RECIPES[g][ProcessingMethod.STANDARD]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// GalacticMarket — price formula
// ---------------------------------------------------------------------------

describe('GalacticMarket — price formula', () => {
  let market;

  beforeEach(() => { market = new GalacticMarket(); });

  it('returns base price when supply === demand', () => {
    // supply/demand initialized to 100/100 → multiplier = 1 → price = base
    const price = market.getPrice(GoodType.STEEL_ALLOY);
    expect(price).toBeCloseTo(GOOD_BASE_PRICE[GoodType.STEEL_ALLOY], 1);
  });

  it('price increases when demand exceeds supply', () => {
    market.updateSupplyDemand(GoodType.STEEL_ALLOY, { demand: 200 }); // demand 300, supply 100
    expect(market.getPrice(GoodType.STEEL_ALLOY)).toBeGreaterThan(GOOD_BASE_PRICE[GoodType.STEEL_ALLOY]);
  });

  it('price decreases when supply exceeds demand', () => {
    market.updateSupplyDemand(GoodType.STEEL_ALLOY, { supply: 500 }); // supply 600, demand 100
    expect(market.getPrice(GoodType.STEEL_ALLOY)).toBeLessThan(GOOD_BASE_PRICE[GoodType.STEEL_ALLOY]);
  });

  it('price is clamped to PRICE_MULT_MIN * base', () => {
    market.updateSupplyDemand(GoodType.STEEL_ALLOY, { supply: 1_000_000 });
    const min = GOOD_BASE_PRICE[GoodType.STEEL_ALLOY] * PRICE_MULT_MIN;
    expect(market.getPrice(GoodType.STEEL_ALLOY)).toBeGreaterThanOrEqual(min * 0.99);
  });

  it('price is clamped to PRICE_MULT_MAX * base', () => {
    market.updateSupplyDemand(GoodType.STEEL_ALLOY, { demand: 1_000_000 });
    const max = GOOD_BASE_PRICE[GoodType.STEEL_ALLOY] * PRICE_MULT_MAX;
    expect(market.getPrice(GoodType.STEEL_ALLOY)).toBeLessThanOrEqual(max * 1.01);
  });

  it('getInfo() returns supply, demand, price', () => {
    const info = market.getInfo(GoodType.CONSUMER_GOODS);
    expect(info).toHaveProperty('supply');
    expect(info).toHaveProperty('demand');
    expect(info).toHaveProperty('price');
    expect(info.price).toBeGreaterThan(0);
  });
});

describe('GalacticMarket — sell / buy', () => {
  let market;
  beforeEach(() => { market = new GalacticMarket(); });

  it('sell() increases supply and returns credits', () => {
    const credits = market.sell('colony-1', GoodType.STEEL_ALLOY, 10);
    expect(credits).toBeGreaterThan(0);
    expect(market.getInfo(GoodType.STEEL_ALLOY).supply).toBeGreaterThan(100);
  });

  it('sell() applies trade tax', () => {
    const gross = market.sell('c', GoodType.STEEL_ALLOY, 10, 0);
    const net   = market.sell('c', GoodType.STEEL_ALLOY, 10, 0.20);
    expect(net).toBeLessThan(gross);
  });

  it('buy() increases demand and returns cost', () => {
    const cost = market.buy('colony-1', GoodType.CONSUMER_GOODS, 5);
    expect(cost).toBeGreaterThan(0);
    expect(market.getInfo(GoodType.CONSUMER_GOODS).demand).toBeGreaterThan(100);
  });

  it('buy() applies import tax', () => {
    const base     = market.buy('c', GoodType.CONSUMER_GOODS, 5, 0);
    const withTax  = market.buy('c', GoodType.CONSUMER_GOODS, 5, 0.20);
    expect(withTax).toBeGreaterThan(base);
  });
});

describe('GalacticMarket — market events', () => {
  let market;
  beforeEach(() => { market = new GalacticMarket(); });

  it('addEvent() registers an event', () => {
    market.addEvent({ ...MARKET_EVENT_TEMPLATES[0], durationTicks: 10 });
    expect(market.activeEvents.length).toBe(1);
  });

  it('active event multiplier increases price', () => {
    const basePriceBefore = market.getPrice('food');
    market.addEvent({ code: 'plague', label: 'Seuche', affectedGood: 'food', priceMult: 2.0, demandMult: 2.0, durationTicks: 10 });
    expect(market.getPrice('food')).toBeGreaterThan(basePriceBefore);
  });

  it('tickEvents() decrements remaining ticks', () => {
    market.addEvent({ code: 'test', label: 'T', affectedGood: null, priceMult: 1.0, demandMult: 1.0, durationTicks: 3 });
    market.tickEvents(2);
    expect(market.activeEvents[0].remainingTicks).toBe(1);
  });

  it('tickEvents() removes expired events', () => {
    market.addEvent({ code: 'x', label: 'X', affectedGood: null, priceMult: 1.0, demandMult: 1.0, durationTicks: 1 });
    market.tickEvents(1);
    expect(market.activeEvents.length).toBe(0);
  });

  it('serialize/deserialize preserves events', () => {
    market.addEvent({ code: 'war', label: 'War', affectedGood: GoodType.MILITARY_EQUIPMENT, priceMult: 3.0, demandMult: 3.0, durationTicks: 100 });
    const m2 = GalacticMarket.deserialize(market.serialize());
    expect(m2.activeEvents.length).toBe(1);
    expect(m2.activeEvents[0].code).toBe('war');
  });
});

// ---------------------------------------------------------------------------
// EconomyPolicy
// ---------------------------------------------------------------------------

describe('EconomyPolicy — policy and taxes', () => {
  let policy;
  beforeEach(() => { policy = new EconomyPolicy(); });

  it('defaults to FREE_MARKET', () => {
    expect(policy.globalPolicy).toBe(EconomicPolicy.FREE_MARKET);
  });

  it('setGlobalPolicy() changes policy', () => {
    policy.setGlobalPolicy(EconomicPolicy.WAR_ECONOMY);
    expect(policy.globalPolicy).toBe(EconomicPolicy.WAR_ECONOMY);
  });

  it('setGlobalPolicy() throws on unknown policy', () => {
    expect(() => policy.setGlobalPolicy('banana')).toThrow();
  });

  it('getEffects() returns correct modifiers for FREE_MARKET', () => {
    const eff = policy.getEffects();
    expect(eff.credits_mult).toBe(1.15);
    expect(eff.trade_speed).toBe(1.10);
  });

  it('setTax() clamps to max allowed', () => {
    policy.setTax('income', 1.0);   // max is 0.40
    expect(policy.getTax('income')).toBe(0.40);
  });

  it('setTax() clamps negative to 0', () => {
    policy.setTax('trade', -0.5);
    expect(policy.getTax('trade')).toBe(0);
  });

  it('setTax() throws on unknown tax type', () => {
    expect(() => policy.setTax('vat', 0.1)).toThrow();
  });

  it('creditsMultiplier() reflects income tax', () => {
    policy.setTax('income', 0.20);
    const mult = policy.creditsMultiplier();
    expect(mult).toBeCloseTo(1.15 * 0.80, 5);
  });

  it('importCostMultiplier() returns null for AUTARKY', () => {
    policy.setGlobalPolicy(EconomicPolicy.AUTARKY);
    expect(policy.importCostMultiplier()).toBeNull();
  });

  it('setSubsidy() updates subsidies', () => {
    policy.setSubsidy('agriculture', true);
    expect(policy.subsidies.agriculture).toBe(true);
  });

  it('setSubsidy() throws on unknown sector', () => {
    expect(() => policy.setSubsidy('art', true)).toThrow();
  });

  it('serialize/deserialize round-trips', () => {
    policy.setGlobalPolicy(EconomicPolicy.MERCANTILISM);
    policy.setTax('income', 0.25);
    policy.setSubsidy('military', true);
    const p2 = EconomyPolicy.deserialize(policy.serialize());
    expect(p2.globalPolicy).toBe(EconomicPolicy.MERCANTILISM);
    expect(p2.getTax('income')).toBeCloseTo(0.25);
    expect(p2.subsidies.military).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EconomySimulation — colony registration
// ---------------------------------------------------------------------------

describe('EconomySimulation — colony registration', () => {
  let eco;
  beforeEach(() => { eco = new EconomySimulation(); });

  it('registerColony() creates a new node', () => {
    eco.registerColony('c1', { buildings: {}, stockpile: {}, population: 5 });
    expect(eco.getColony('c1')).toBeDefined();
  });

  it('registerColony() updates existing node without resetting stock', () => {
    eco.registerColony('c1', { buildings: { [ProcessingBuilding.METALLURGY]: 1 }, stockpile: { metal: 100 }, population: 5 });
    eco.getColony('c1').stock.add(GoodType.STEEL_ALLOY, 10);
    eco.registerColony('c1', { buildings: { [ProcessingBuilding.METALLURGY]: 2 }, stockpile: { metal: 200 }, population: 6 });
    // Stock should be preserved
    expect(eco.getColony('c1').stock.get(GoodType.STEEL_ALLOY)).toBe(10);
    // Buildings updated
    expect(eco.getColony('c1').buildings[ProcessingBuilding.METALLURGY]).toBe(2);
  });

  it('unregisterColony() removes the node', () => {
    eco.registerColony('c1', {});
    eco.unregisterColony('c1');
    expect(eco.getColony('c1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EconomySimulation — processing tick (Tier 2 production)
// ---------------------------------------------------------------------------

describe('EconomySimulation — Tier-2 processing', () => {
  let eco;
  let stockpile;

  beforeEach(() => {
    eco       = new EconomySimulation();
    stockpile = { metal: 1000, crystal: 500, deuterium: 300, rare_earth: 200, food: 400, energy: 100 };
    eco.registerColony('c1', {
      buildings:  { [ProcessingBuilding.METALLURGY]: 2 },
      stockpile,
      population: 5,
    });
    // Unlock the required research
    eco.unlockTech('economy.metallurgy_i');
  });

  it('produces STEEL_ALLOY from metal', () => {
    const result = eco.tick(1);
    expect(result.produced[GoodType.STEEL_ALLOY]).toBeGreaterThan(0);
  });

  it('consumes metal from the stockpile', () => {
    const metalBefore = stockpile.metal;
    eco.tick(1);
    expect(stockpile.metal).toBeLessThan(metalBefore);
  });

  it('does not produce if stockpile is empty', () => {
    stockpile.metal = 0;
    const result = eco.tick(1);
    expect(result.produced[GoodType.STEEL_ALLOY] ?? 0).toBe(0);
  });

  it('production is proportional to building count', () => {
    // 2 metallurgy buildings
    const result2 = eco.tick(1);
    const out2 = result2.produced[GoodType.STEEL_ALLOY] ?? 0;

    // 1 metallurgy building
    const eco1    = new EconomySimulation();
    const stock1  = { metal: 1000 };
    eco1.registerColony('c2', { buildings: { [ProcessingBuilding.METALLURGY]: 1 }, stockpile: stock1, population: 0 });
    eco1.unlockTech('economy.metallurgy_i');
    const result1 = eco1.tick(1);
    const out1    = result1.produced[GoodType.STEEL_ALLOY] ?? 0;

    expect(out2).toBeGreaterThanOrEqual(out1 * 1.9); // ~2× (may be limited by capacity)
  });

  it('PREMIUM method requires research unlock', () => {
    // premium requires economy.metallurgy_ii which is NOT unlocked
    expect(() => eco.setProductionMethod('c1', ProcessingBuilding.METALLURGY, ProcessingMethod.PREMIUM)).toThrow();
  });

  it('EFFICIENT method produces more than STANDARD per unit time', () => {
    // Both require metallurgy_i (already unlocked)
    const stockA = { metal: 2000 };
    const ecoA   = new EconomySimulation();
    ecoA.registerColony('cA', { buildings: { [ProcessingBuilding.METALLURGY]: 1 }, stockpile: stockA, population: 0 });
    ecoA.unlockTech('economy.metallurgy_i');
    ecoA.setProductionMethod('cA', ProcessingBuilding.METALLURGY, ProcessingMethod.EFFICIENT);
    const resultA = ecoA.tick(1);

    const stockS = { metal: 2000 };
    const ecoS   = new EconomySimulation();
    ecoS.registerColony('cS', { buildings: { [ProcessingBuilding.METALLURGY]: 1 }, stockpile: stockS, population: 0 });
    ecoS.unlockTech('economy.metallurgy_i');
    // standard is default
    const resultS = ecoS.tick(1);

    expect((resultA.produced[GoodType.STEEL_ALLOY] ?? 0)).toBeGreaterThan(resultS.produced[GoodType.STEEL_ALLOY] ?? 0);
  });
});

// ---------------------------------------------------------------------------
// EconomySimulation — Tier-3 production (consumer goods)
// ---------------------------------------------------------------------------

describe('EconomySimulation — Tier-3 production', () => {
  let eco;
  let node;

  beforeEach(() => {
    eco = new EconomySimulation();
    eco.unlockTech('economy.metallurgy_i');
    eco.unlockTech('economy.electronics_i');
    eco.unlockTech('economy.basic_manufacturing');

    const stockpile = { metal: 5000, crystal: 5000, rare_earth: 2000 };
    eco.registerColony('c1', {
      buildings: {
        [ProcessingBuilding.METALLURGY]:      2,
        [ProcessingBuilding.ELECTRONICS_FAB]: 2,
        [ProcessingBuilding.CONSUMER_FACTORY]: 2,
      },
      stockpile,
      population: 10,
    });
    node = eco.getColony('c1');
  });

  it('consumer factory produces CONSUMER_GOODS when Tier-2 inputs are available', () => {
    // Pre-seed Tier-2 stock
    node.stock.add(GoodType.STEEL_ALLOY, 50);
    node.stock.add(GoodType.ELECTRONICS_COMPONENTS, 50);

    const result = eco.tick(1);
    expect(result.produced[GoodType.CONSUMER_GOODS] ?? 0).toBeGreaterThan(0);
  });

  it('consumer factory does NOT produce without Tier-2 inputs (no T2 factories)', () => {
    // Only consumer factory registered, no T2 factories → no T2 inputs → 0 T3 output
    const ecoOnly = new EconomySimulation();
    ecoOnly.unlockTech('economy.basic_manufacturing');
    ecoOnly.registerColony('only', {
      buildings: { [ProcessingBuilding.CONSUMER_FACTORY]: 1 },
      stockpile: { metal: 5000, crystal: 5000, rare_earth: 2000 },
      population: 0,
    });
    const result = ecoOnly.tick(1);
    expect(result.produced[GoodType.CONSUMER_GOODS] ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EconomySimulation — pop consumption
// ---------------------------------------------------------------------------

describe('EconomySimulation — pop consumption', () => {
  let eco;
  let node;

  beforeEach(() => {
    eco = new EconomySimulation();
    eco.registerColony('c1', { buildings: {}, stockpile: {}, population: 10 });
    node = eco.getColony('c1');
  });

  it('pops consume consumer_goods if available', () => {
    node.stock.add(GoodType.CONSUMER_GOODS, 100);
    eco.tick(1);
    expect(node.stock.get(GoodType.CONSUMER_GOODS)).toBeLessThan(100);
  });

  it('happiness modifier is positive when all class needs are fully supplied', () => {
    // COLONIST class needs food (primary) + consumer_goods — supply both
    node.stockpile.food = 10000;
    node.stock.add(GoodType.CONSUMER_GOODS, 1000);
    node.stock.add(GoodType.LUXURY_GOODS, 1000);
    eco.tick(1);
    expect(node.happinessMod).toBeGreaterThan(0);
  });

  it('happiness modifier is negative when consumer_goods are absent', () => {
    // No consumer goods
    eco.tick(1);
    expect(node.happinessMod).toBeLessThan(0);
  });

  it('shortages are reported in tick result', () => {
    const result = eco.tick(1);
    expect(result.shortages).toContain(GoodType.CONSUMER_GOODS);
  });

  it('luxury goods shortage does not cause negative happiness when food and consumer_goods are met', () => {
    // COLONIST class: food + consumer_goods → both satisfied → positive happiness
    // Luxury goods are a CITIZEN need, not COLONIST → no effect on COLONIST happiness
    node.stockpile.food = 10000;
    node.stock.add(GoodType.CONSUMER_GOODS, 1000);
    // No luxury goods — pops are COLONIST so luxury is not in their needs
    eco.tick(1);
    expect(node.happinessMod).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// EconomySimulation — market interaction during tick
// ---------------------------------------------------------------------------

describe('EconomySimulation — market supply signal', () => {
  it('tick increases market supply for produced goods', () => {
    const eco       = new EconomySimulation();
    const stockpile = { metal: 5000 };
    eco.unlockTech('economy.metallurgy_i');
    eco.registerColony('c1', { buildings: { [ProcessingBuilding.METALLURGY]: 1 }, stockpile, population: 0 });

    const supplyBefore = eco.market.getInfo(GoodType.STEEL_ALLOY).supply;
    eco.tick(1);
    const supplyAfter  = eco.market.getInfo(GoodType.STEEL_ALLOY).supply;
    expect(supplyAfter).toBeGreaterThan(supplyBefore);
  });
});

// ---------------------------------------------------------------------------
// EconomySimulation — serialize / deserialize
// ---------------------------------------------------------------------------

describe('EconomySimulation — serialize/deserialize', () => {
  it('round-trips tick count', () => {
    const eco = new EconomySimulation();
    eco.registerColony('c1', { buildings: {}, stockpile: {}, population: 0 });
    eco.tick(5);
    const eco2 = EconomySimulation.deserialize(eco.serialize(), null, { c1: {} });
    expect(eco2._tick).toBe(5);
  });

  it('round-trips unlocked techs', () => {
    const eco = new EconomySimulation();
    eco.unlockTech('economy.metallurgy_i');
    eco.unlockTech('economy.electronics_i');
    const eco2 = EconomySimulation.deserialize(eco.serialize());
    expect(eco2._unlockedTechs.has('economy.metallurgy_i')).toBe(true);
    expect(eco2._unlockedTechs.has('economy.electronics_i')).toBe(true);
  });

  it('round-trips colony good stock', () => {
    const eco = new EconomySimulation();
    eco.registerColony('c1', { buildings: {}, stockpile: {}, population: 0 });
    eco.getColony('c1').stock.add(GoodType.FOCUS_CRYSTALS, 42);
    const eco2 = EconomySimulation.deserialize(eco.serialize(), null, { c1: {} });
    expect(eco2.getColony('c1').stock.get(GoodType.FOCUS_CRYSTALS)).toBe(42);
  });

  it('round-trips policy', () => {
    const eco = new EconomySimulation();
    eco.policy.setGlobalPolicy(EconomicPolicy.WAR_ECONOMY);
    eco.policy.setTax('income', 0.30);
    const eco2 = EconomySimulation.deserialize(eco.serialize());
    expect(eco2.policy.globalPolicy).toBe(EconomicPolicy.WAR_ECONOMY);
    expect(eco2.policy.getTax('income')).toBeCloseTo(0.30);
  });
});

// ---------------------------------------------------------------------------
// EconomySimulation — summary
// ---------------------------------------------------------------------------

describe('EconomySimulation — summary()', () => {
  it('returns aggregate stock across colonies', () => {
    const eco = new EconomySimulation();
    eco.registerColony('c1', { buildings: {}, stockpile: {}, population: 0 });
    eco.registerColony('c2', { buildings: {}, stockpile: {}, population: 0 });
    eco.getColony('c1').stock.add(GoodType.STEEL_ALLOY, 100);
    eco.getColony('c2').stock.add(GoodType.STEEL_ALLOY, 50);
    const s = eco.summary();
    expect(s.goods[GoodType.STEEL_ALLOY].stock).toBe(150);
    expect(s.colonies).toBe(2);
  });

  it('includes current market prices', () => {
    const eco = new EconomySimulation();
    const s   = eco.summary();
    for (const g of Object.values(GoodType)) {
      expect(s.goods[g].price).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// PROCESSING_RECIPES integrity checks
// ---------------------------------------------------------------------------

describe('PROCESSING_RECIPES — structural integrity', () => {
  it('every recipe has a building, inputs object, and numeric outputs', () => {
    for (const [good, methods] of Object.entries(PROCESSING_RECIPES)) {
      for (const [method, recipe] of Object.entries(methods)) {
        expect(recipe.building, `${good}.${method} missing building`).toBeDefined();
        expect(recipe.inputs,   `${good}.${method} missing inputs`).toBeDefined();
        expect(recipe.outputs,  `${good}.${method} outputs`).toBeGreaterThan(0);
        expect(recipe.energyCost, `${good}.${method} energyCost`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('Tier-3 recipes reference only Tier-2 goods or primary resources as inputs', () => {
    const tier3 = [
      GoodType.CONSUMER_GOODS, GoodType.LUXURY_GOODS, GoodType.MILITARY_EQUIPMENT,
      GoodType.RESEARCH_KITS, GoodType.COLONIZATION_PACKS,
    ];
    const primaryResources = new Set(['metal', 'crystal', 'deuterium', 'rare_earth', 'food', 'energy']);
    const tier2Goods       = new Set(Object.values(GoodType).filter(g => GOOD_TIER[g] === 2));

    for (const good of tier3) {
      for (const [method, recipe] of Object.entries(PROCESSING_RECIPES[good])) {
        for (const inputKey of Object.keys(recipe.inputs)) {
          const valid = primaryResources.has(inputKey) || tier2Goods.has(inputKey);
          expect(valid, `${good}.${method} input '${inputKey}' is not primary/Tier-2`).toBe(true);
        }
      }
    }
  });

  it('Tier-5 recipes reference only Tier-4 goods or lower as inputs', () => {
    const tier5 = [
      GoodType.VOID_CRYSTALS, GoodType.SYNTHETIC_CONSCIOUSNESS, GoodType.TEMPORAL_LUXURIES,
    ];
    const primaryResources = new Set(['metal', 'crystal', 'deuterium', 'rare_earth', 'food', 'energy', 'dark_matter']);
    const processedGoods   = new Set(Object.values(GoodType));

    for (const good of tier5) {
      for (const [method, recipe] of Object.entries(PROCESSING_RECIPES[good])) {
        for (const inputKey of Object.keys(recipe.inputs)) {
          const valid = primaryResources.has(inputKey) || processedGoods.has(inputKey);
          expect(valid, `${good}.${method} input '${inputKey}' is unknown`).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// PopClass system (Anno principle)
// ---------------------------------------------------------------------------

describe('PopClass — enum and ordering', () => {
  it('POP_CLASS_ORDER has 5 entries in ascending order', () => {
    expect(POP_CLASS_ORDER.length).toBe(5);
    expect(POP_CLASS_ORDER[0]).toBe(PopClass.COLONIST);
    expect(POP_CLASS_ORDER[4]).toBe(PopClass.TRANSCENDENT);
  });

  it('every class has POP_CLASS_NEEDS defined', () => {
    for (const cls of POP_CLASS_ORDER) {
      expect(POP_CLASS_NEEDS[cls]).toBeDefined();
      expect(Object.keys(POP_CLASS_NEEDS[cls]).length).toBeGreaterThan(0);
    }
  });

  it('every class has POP_CLASS_YIELD defined with positive multipliers', () => {
    for (const cls of POP_CLASS_ORDER) {
      const y = POP_CLASS_YIELD[cls];
      expect(y).toBeDefined();
      expect(y.production).toBeGreaterThan(0);
      expect(y.research).toBeGreaterThan(0);
      expect(y.credits).toBeGreaterThan(0);
    }
  });

  it('higher classes have higher yield multipliers', () => {
    const classes = POP_CLASS_ORDER;
    for (let i = 0; i < classes.length - 1; i++) {
      const lower  = POP_CLASS_YIELD[classes[i]];
      const higher = POP_CLASS_YIELD[classes[i + 1]];
      // At least one yield dimension increases
      expect(higher.production + higher.research + higher.credits)
        .toBeGreaterThan(lower.production + lower.research + lower.credits);
    }
  });

  it('higher classes have lower max fraction cap (rarity principle)', () => {
    const classes = POP_CLASS_ORDER;
    for (let i = 0; i < classes.length - 1; i++) {
      expect(POP_CLASS_MAX_FRACTION[classes[i + 1]])
        .toBeLessThanOrEqual(POP_CLASS_MAX_FRACTION[classes[i]]);
    }
  });

  it('CLASS_NEED_HAPPINESS bonus increases with class tier', () => {
    const classes = POP_CLASS_ORDER;
    for (let i = 0; i < classes.length - 1; i++) {
      expect(CLASS_NEED_HAPPINESS[classes[i + 1]].bonus)
        .toBeGreaterThan(CLASS_NEED_HAPPINESS[classes[i]].bonus);
    }
  });
});

describe('PopClass — needs require escalating Tier goods', () => {
  it('COLONIST needs include food and at most Tier-3 goods', () => {
    const allowed = new Set(['food', ...Object.values(GoodType).filter(g => GOOD_TIER[g] <= 3)]);
    for (const good of Object.keys(POP_CLASS_NEEDS[PopClass.COLONIST])) {
      expect(allowed.has(good), `COLONIST should not need ${good}`).toBe(true);
    }
  });

  it('SPECIALIST needs include at least one Tier-4 good', () => {
    const has4 = Object.keys(POP_CLASS_NEEDS[PopClass.SPECIALIST]).some(g => GOOD_TIER[g] === 4);
    expect(has4).toBe(true);
  });

  it('TRANSCENDENT needs include at least one Tier-5 good', () => {
    const has5 = Object.keys(POP_CLASS_NEEDS[PopClass.TRANSCENDENT]).some(g => GOOD_TIER[g] === 5);
    expect(has5).toBe(true);
  });
});

describe('ColonyEconomyNode — pop class initialization', () => {
  it('new colony starts with all pops as COLONIST', () => {
    const eco  = new EconomySimulation();
    const node = eco.registerColony('c1', { buildings: {}, stockpile: {}, population: 10 });
    expect(node.popClasses[PopClass.COLONIST]).toBe(10);
    expect(node.popClasses[PopClass.CITIZEN]      ?? 0).toBe(0);
    expect(node.popClasses[PopClass.TRANSCENDENT] ?? 0).toBe(0);
  });

  it('accepts explicit popClasses on registration', () => {
    const eco  = new EconomySimulation();
    const node = eco.registerColony('c1', {
      buildings: {}, stockpile: {}, population: 10,
      popClasses: { [PopClass.COLONIST]: 8, [PopClass.CITIZEN]: 2 },
    });
    expect(node.popClasses[PopClass.COLONIST]).toBe(8);
    expect(node.popClasses[PopClass.CITIZEN]).toBe(2);
  });
});

describe('ColonyEconomyNode — pop advancement (Anno principle)', () => {
  let eco, node;

  beforeEach(() => {
    eco  = new EconomySimulation();
    node = eco.registerColony('c1', {
      buildings:  {},
      stockpile:  { food: 999999 },
      population: 20,
    });
  });

  it('pops advance to CITIZEN after ADVANCEMENT_TICKS_REQUIRED satisfied ticks', () => {
    // Supply all COLONIST needs every tick
    for (let i = 0; i < ADVANCEMENT_TICKS_REQUIRED; i++) {
      node.stockpile.food  = 999999;
      node.stock.add(GoodType.CONSUMER_GOODS, 9999);
      node.consumeTick(1);
    }
    const result = node.advancePops();
    expect(result.advancements.length).toBeGreaterThan(0);
    expect(result.advancements[0].to).toBe(PopClass.CITIZEN);
    expect(node.popClasses[PopClass.CITIZEN]).toBeGreaterThan(0);
    expect(node.popClasses[PopClass.COLONIST]).toBeLessThan(20);
  });

  it('does not advance if satisfaction ticks < threshold', () => {
    for (let i = 0; i < ADVANCEMENT_TICKS_REQUIRED - 1; i++) {
      node.stockpile.food = 999999;
      node.stock.add(GoodType.CONSUMER_GOODS, 9999);
      node.consumeTick(1);
    }
    const result = node.advancePops();
    expect(result.advancements.length).toBe(0);
    expect(node.popClasses[PopClass.CITIZEN] ?? 0).toBe(0);
  });

  it('pops descend after DESCENT_TICKS_REQUIRED shortage ticks', () => {
    // Start with a CITIZEN pop
    node.popClasses[PopClass.COLONIST] = 19;
    node.popClasses[PopClass.CITIZEN]  = 1;
    node._satisfactionTicks = {};

    // CITIZEN needs consumer_goods + biocompost + luxury — give nothing
    for (let i = 0; i < DESCENT_TICKS_REQUIRED; i++) {
      node.consumeTick(1); // no stock → shortage
    }
    const result = node.advancePops();
    expect(result.descents.length).toBeGreaterThan(0);
    expect(result.descents[0].from).toBe(PopClass.CITIZEN);
    expect(result.descents[0].to).toBe(PopClass.COLONIST);
  });

  it('advancement respects POP_CLASS_MAX_FRACTION cap', () => {
    // 20 pops, CITIZEN cap is 80% = 16 pops max
    // Pre-fill CITIZEN to max
    node.popClasses[PopClass.COLONIST] = 4;
    node.popClasses[PopClass.CITIZEN]  = 16;
    // Force satisfaction ticks
    node._satisfactionTicks[PopClass.COLONIST] = ADVANCEMENT_TICKS_REQUIRED;

    const result = node.advancePops();
    // Max is 16, already at 16 → no advancement
    expect(result.advancements.length).toBe(0);
  });

  it('satisfaction ticks reset after advancement', () => {
    for (let i = 0; i < ADVANCEMENT_TICKS_REQUIRED; i++) {
      node.stockpile.food = 999999;
      node.stock.add(GoodType.CONSUMER_GOODS, 9999);
      node.consumeTick(1);
    }
    node.advancePops();
    expect(node._satisfactionTicks[PopClass.COLONIST] ?? 0).toBe(0);
  });
});

describe('ColonyEconomyNode — computeClassYield()', () => {
  it('all-COLONIST colony returns yield 1.0 for all dimensions', () => {
    const eco  = new EconomySimulation();
    const node = eco.registerColony('c1', { buildings: {}, stockpile: {}, population: 10 });
    const y = node.computeClassYield();
    expect(y.production).toBeCloseTo(1.0, 5);
    expect(y.research).toBeCloseTo(1.0, 5);
    expect(y.credits).toBeCloseTo(1.0, 5);
  });

  it('mixed population yields weighted average', () => {
    const eco  = new EconomySimulation();
    const node = eco.registerColony('c1', {
      buildings: {}, stockpile: {}, population: 10,
      popClasses: { [PopClass.COLONIST]: 5, [PopClass.CITIZEN]: 5 },
    });
    const y = node.computeClassYield();
    const expected = (POP_CLASS_YIELD[PopClass.COLONIST].production * 5
                    + POP_CLASS_YIELD[PopClass.CITIZEN].production  * 5) / 10;
    expect(y.production).toBeCloseTo(expected, 5);
  });

  it('higher-class colony has greater overall yield', () => {
    const eco = new EconomySimulation();
    const n1  = eco.registerColony('c1', {
      buildings: {}, stockpile: {}, population: 10,
      popClasses: { [PopClass.COLONIST]: 10 },
    });
    const n2  = eco.registerColony('c2', {
      buildings: {}, stockpile: {}, population: 10,
      popClasses: { [PopClass.ELITE]: 10 },
    });
    const y1 = n1.computeClassYield();
    const y2 = n2.computeClassYield();
    expect(y2.credits).toBeGreaterThan(y1.credits);
    expect(y2.research).toBeGreaterThan(y1.research);
  });
});

describe('EconomySimulation — summary includes popClassTotals', () => {
  it('summary reports aggregate pop class counts', () => {
    const eco = new EconomySimulation();
    eco.registerColony('c1', {
      buildings: {}, stockpile: {}, population: 10,
      popClasses: { [PopClass.COLONIST]: 8, [PopClass.CITIZEN]: 2 },
    });
    eco.registerColony('c2', {
      buildings: {}, stockpile: {}, population: 5,
      popClasses: { [PopClass.COLONIST]: 5 },
    });
    const s = eco.summary();
    expect(s.popClassTotals[PopClass.COLONIST]).toBe(13);
    expect(s.popClassTotals[PopClass.CITIZEN]).toBe(2);
  });
});

describe('EconomySimulation — serialize/deserialize preserves popClasses', () => {
  it('round-trips popClasses and advancement ticks', () => {
    const eco  = new EconomySimulation();
    const node = eco.registerColony('c1', {
      buildings:  {},
      stockpile:  { food: 999999 },
      population: 10,
      popClasses: { [PopClass.COLONIST]: 8, [PopClass.CITIZEN]: 2 },
    });
    node._satisfactionTicks[PopClass.CITIZEN] = 7;

    const eco2  = EconomySimulation.deserialize(eco.serialize(), null, { c1: { food: 0 } });
    const node2 = eco2.getColony('c1');
    expect(node2.popClasses[PopClass.COLONIST]).toBe(8);
    expect(node2.popClasses[PopClass.CITIZEN]).toBe(2);
    expect(node2._satisfactionTicks[PopClass.CITIZEN]).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// MARKET_EVENT_TEMPLATES
// ---------------------------------------------------------------------------

describe('MARKET_EVENT_TEMPLATES', () => {
  it('each template has required fields', () => {
    for (const tpl of MARKET_EVENT_TEMPLATES) {
      expect(tpl.code).toBeDefined();
      expect(tpl.label).toBeDefined();
      expect(tpl.priceMult).toBeGreaterThan(0);
      expect(tpl.demandMult).toBeGreaterThan(0);
      expect(tpl.defaultDurationTicks).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 2.3 — Policy Enforcement in Production (Issue B-2)
// ---------------------------------------------------------------------------

describe('EconomyPolicy — productionMultipliers()', () => {
  let policy;
  beforeEach(() => { policy = new EconomyPolicy(); });

  it('returns empty object for FREE_MARKET with no subsidies', () => {
    const mults = policy.productionMultipliers();
    expect(Object.keys(mults).length).toBe(0);
  });

  it('WAR_ECONOMY: military_equipment ×1.30, consumer_goods ×0.80', () => {
    policy.setGlobalPolicy(EconomicPolicy.WAR_ECONOMY);
    const mults = policy.productionMultipliers();
    expect(mults[GoodType.MILITARY_EQUIPMENT]).toBeCloseTo(1.30, 5);
    expect(mults[GoodType.CONSUMER_GOODS]).toBeCloseTo(0.80, 5);
  });

  it('AUTARKY: all GoodType values get ×1.10', () => {
    policy.setGlobalPolicy(EconomicPolicy.AUTARKY);
    const mults = policy.productionMultipliers();
    for (const good of Object.values(GoodType)) {
      expect(mults[good]).toBeCloseTo(1.10, 5);
    }
  });

  it('subsidy agriculture: biocompost ×1.20', () => {
    policy.setSubsidy('agriculture', true);
    const mults = policy.productionMultipliers();
    expect(mults[GoodType.BIOCOMPOST]).toBeCloseTo(1.20, 5);
  });

  it('subsidy research: research_kits ×1.20', () => {
    policy.setSubsidy('research', true);
    const mults = policy.productionMultipliers();
    expect(mults[GoodType.RESEARCH_KITS]).toBeCloseTo(1.20, 5);
  });

  it('subsidy military: military_equipment ×1.20', () => {
    policy.setSubsidy('military', true);
    const mults = policy.productionMultipliers();
    expect(mults[GoodType.MILITARY_EQUIPMENT]).toBeCloseTo(1.20, 5);
  });

  it('WAR_ECONOMY + military subsidy stacks: military_equipment ×1.56 (1.30×1.20)', () => {
    policy.setGlobalPolicy(EconomicPolicy.WAR_ECONOMY);
    policy.setSubsidy('military', true);
    const mults = policy.productionMultipliers();
    expect(mults[GoodType.MILITARY_EQUIPMENT]).toBeCloseTo(1.30 * 1.20, 5);
  });

  it('AUTARKY + agriculture subsidy stacks: biocompost ×1.32 (1.10×1.20)', () => {
    policy.setGlobalPolicy(EconomicPolicy.AUTARKY);
    policy.setSubsidy('agriculture', true);
    const mults = policy.productionMultipliers();
    expect(mults[GoodType.BIOCOMPOST]).toBeCloseTo(1.10 * 1.20, 5);
  });
});

describe('EconomySimulation — policy affects production output', () => {
  function makeMilitaryEco(policy) {
    const eco = new EconomySimulation();
    eco.policy.setGlobalPolicy(policy);
    eco.unlockTech('economy.military_industrial');
    const stockpile = { metal: 5000, crystal: 5000, rare_earth: 2000 };
    eco.registerColony('c1', {
      buildings: { [ProcessingBuilding.ARMS_FACTORY]: 1 },
      stockpile,
      population: 0,
    });
    const node = eco.getColony('c1');
    // Pre-seed Tier-2 inputs for arms factory (steel_alloy + focus_crystals)
    node.stock.add(GoodType.STEEL_ALLOY, 5000);
    node.stock.add(GoodType.FOCUS_CRYSTALS, 5000);
    return eco;
  }

  it('WAR_ECONOMY produces more military_equipment than FREE_MARKET', () => {
    const ecoWar  = makeMilitaryEco(EconomicPolicy.WAR_ECONOMY);
    const ecoFree = makeMilitaryEco(EconomicPolicy.FREE_MARKET);

    const resWar  = ecoWar.tick(1);
    const resFree = ecoFree.tick(1);

    const milWar  = resWar.produced[GoodType.MILITARY_EQUIPMENT]  ?? 0;
    const milFree = resFree.produced[GoodType.MILITARY_EQUIPMENT] ?? 0;

    expect(milWar).toBeGreaterThan(0);
    expect(milWar).toBeCloseTo(milFree * 1.30, 1);
  });

  it('WAR_ECONOMY produces less consumer_goods than FREE_MARKET', () => {
    function makeConsumerEco(policy) {
      const eco = new EconomySimulation();
      eco.policy.setGlobalPolicy(policy);
      eco.unlockTech('economy.basic_manufacturing');
      const stockpile = { metal: 5000, crystal: 5000, rare_earth: 2000 };
      eco.registerColony('c1', {
        buildings: { [ProcessingBuilding.CONSUMER_FACTORY]: 1 },
        stockpile,
        population: 0,
      });
      const node = eco.getColony('c1');
      node.stock.add(GoodType.STEEL_ALLOY, 5000);
      node.stock.add(GoodType.ELECTRONICS_COMPONENTS, 5000);
      return eco;
    }

    const ecoWar  = makeConsumerEco(EconomicPolicy.WAR_ECONOMY);
    const ecoFree = makeConsumerEco(EconomicPolicy.FREE_MARKET);

    const resWar  = ecoWar.tick(1);
    const resFree = ecoFree.tick(1);

    const cgWar  = resWar.produced[GoodType.CONSUMER_GOODS]  ?? 0;
    const cgFree = resFree.produced[GoodType.CONSUMER_GOODS] ?? 0;

    expect(cgFree).toBeGreaterThan(0);
    expect(cgWar).toBeCloseTo(cgFree * 0.80, 1);
  });

  it('AUTARKY produces more steel_alloy than FREE_MARKET (domestic +10%)', () => {
    function makeMetallurgyEco(policy) {
      const eco = new EconomySimulation();
      eco.policy.setGlobalPolicy(policy);
      eco.unlockTech('economy.metallurgy_i');
      const stockpile = { metal: 5000 };
      eco.registerColony('c1', {
        buildings: { [ProcessingBuilding.METALLURGY]: 1 },
        stockpile,
        population: 0,
      });
      return eco;
    }

    const ecoAut  = makeMetallurgyEco(EconomicPolicy.AUTARKY);
    const ecoFree = makeMetallurgyEco(EconomicPolicy.FREE_MARKET);

    const resAut  = ecoAut.tick(1);
    const resFree = ecoFree.tick(1);

    const saAut  = resAut.produced[GoodType.STEEL_ALLOY]  ?? 0;
    const saFree = resFree.produced[GoodType.STEEL_ALLOY] ?? 0;

    expect(saAut).toBeCloseTo(saFree * 1.10, 1);
  });

  it('military subsidy boosts military_equipment output by 20%', () => {
    const ecoSub  = makeMilitaryEco(EconomicPolicy.FREE_MARKET);
    ecoSub.policy.setSubsidy('military', true);
    const ecoBase = makeMilitaryEco(EconomicPolicy.FREE_MARKET);

    const resSub  = ecoSub.tick(1);
    const resBase = ecoBase.tick(1);

    const milSub  = resSub.produced[GoodType.MILITARY_EQUIPMENT]  ?? 0;
    const milBase = resBase.produced[GoodType.MILITARY_EQUIPMENT] ?? 0;

    expect(milSub).toBeCloseTo(milBase * 1.20, 1);
  });
});
