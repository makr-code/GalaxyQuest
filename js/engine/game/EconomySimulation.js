/**
 * EconomySimulation.js  — Multi-Tier Economy, Processing Chains & Market Simulation
 *
 * Inspired by:
 *   Victoria 3        (Paradox, 2022)  — Pop-consumption needs, dynamic market prices,
 *                                        production methods, economic policy laws
 *   X4: Foundations   (Egosoft, 2018)  — Station modules as economic nodes,
 *                                        supply/demand price formation, NPC traders
 *   Stellaris         (Paradox, 2016)  — Planetary districts, faction economy
 *
 * Provides:
 *   - GoodType enum: Tier-2 intermediates (steel_alloy, focus_crystals, …) and
 *       Tier-3 finished goods (consumer_goods, luxury_goods, …)
 *   - ProcessingMethod enum: standard | efficient | premium per processing building
 *   - PROCESSING_RECIPES: input→output recipes per GoodType and ProcessingMethod
 *   - GOOD_BASE_PRICE: base market prices per GoodType and primary resource
 *   - POP_CONSUMPTION_RATE: per-pop-per-tick consumption of T3 goods
 *   - GoodStock: per-colony inventory of processed goods
 *   - GalacticMarket: dynamic price model (supply/demand), buy/sell, market events
 *   - EconomyPolicy: tax rates and global economic policy per player
 *   - EconomySimulation: tick-based processing, pop consumption, market interaction
 *       Emits: 'economy:produced', 'economy:consumed', 'economy:shortage',
 *              'economy:market:price_change', 'economy:policy:changed'
 *
 * Usage:
 *   const eco = new EconomySimulation(engine.events);
 *
 *   // Register a colony's processing capability
 *   eco.registerColony('colony-1', {
 *     buildings: { metallurgy: 2, crystal_grinder: 1 },
 *     stockpile: { metal: 1000, crystal: 500, rare_earth: 200 },
 *     population: 8,
 *   });
 *
 *   // Each game turn:
 *   const result = eco.tick(1);
 *
 *   // Market interaction:
 *   const market = eco.market;
 *   const price  = market.getPrice('steel_alloy');
 *   market.sell('colony-1', 'steel_alloy', 50);
 *   market.buy('colony-1',  'consumer_goods', 20);
 *
 *   // Economic policy:
 *   eco.policy.setGlobalPolicy(EconomicPolicy.MERCANTILISM);
 *   eco.policy.setTax('income', 0.20);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Tier-2 intermediate goods and Tier-3 finished goods.
 * Tier-2: produced from primary resources in processing buildings.
 * Tier-3: produced from Tier-2 goods in advanced factories; consumed by pops.
 * @enum {string}
 */
const GoodType = Object.freeze({
  // ── Tier 2 — Intermediates ────────────────────────────────────────────────
  STEEL_ALLOY:         'steel_alloy',          // 2 metal + energy → 1
  FOCUS_CRYSTALS:      'focus_crystals',        // 3 crystal + 1 rare_earth → 1
  REACTOR_FUEL:        'reactor_fuel',          // 2 deuterium + 1 rare_earth → 1
  BIOCOMPOST:          'biocompost',            // 2 food + energy → 1
  ELECTRONICS_COMPONENTS: 'electronics_components', // 1 crystal + 1 rare_earth → 1

  // ── Tier 3 — Finished Goods ───────────────────────────────────────────────
  CONSUMER_GOODS:      'consumer_goods',        // 1 steel + 1 electronics → 1
  LUXURY_GOODS:        'luxury_goods',          // 1 focus_crystals + 1 biocompost → 1
  MILITARY_EQUIPMENT:  'military_equipment',    // 2 steel + 1 focus_crystals → 1
  RESEARCH_KITS:       'research_kits',         // 1 focus_crystals + 1 electronics → 1
  COLONIZATION_PACKS:  'colonization_packs',    // 1 steel + 1 biocompost + 1 reactor_fuel → 1
});

/** Tier designation for each GoodType. */
const GOOD_TIER = Object.freeze({
  [GoodType.STEEL_ALLOY]:            2,
  [GoodType.FOCUS_CRYSTALS]:         2,
  [GoodType.REACTOR_FUEL]:           2,
  [GoodType.BIOCOMPOST]:             2,
  [GoodType.ELECTRONICS_COMPONENTS]: 2,
  [GoodType.CONSUMER_GOODS]:         3,
  [GoodType.LUXURY_GOODS]:           3,
  [GoodType.MILITARY_EQUIPMENT]:     3,
  [GoodType.RESEARCH_KITS]:          3,
  [GoodType.COLONIZATION_PACKS]:     3,
});

/**
 * Processing methods available for processing buildings.
 * Each method changes the input/output ratio (Victoria 3 — production methods).
 * @enum {string}
 */
const ProcessingMethod = Object.freeze({
  STANDARD:  'standard',   // base input/output ratio
  EFFICIENT: 'efficient',  // more input, more output per unit
  PREMIUM:   'premium',    // requires research unlock, highest yield
});

/**
 * Processing building types (new buildings added by the economy system).
 * These extend the existing BuildingType enum from ColonySimulation.
 * @enum {string}
 */
const ProcessingBuilding = Object.freeze({
  METALLURGY:       'metallurgy',        // produces STEEL_ALLOY
  CRYSTAL_GRINDER:  'crystal_grinder',   // produces FOCUS_CRYSTALS
  REFINERY:         'refinery',          // produces REACTOR_FUEL
  BIOREACTOR:       'bioreactor',        // produces BIOCOMPOST
  ELECTRONICS_FAB:  'electronics_fab',   // produces ELECTRONICS_COMPONENTS
  CONSUMER_FACTORY: 'consumer_factory',  // produces CONSUMER_GOODS
  LUXURY_WORKSHOP:  'luxury_workshop',   // produces LUXURY_GOODS
  ARMS_FACTORY:     'arms_factory',      // produces MILITARY_EQUIPMENT
  RESEARCH_LAB_ADV: 'research_lab_adv',  // produces RESEARCH_KITS
  COLONY_SUPPLIES:  'colony_supplies',   // produces COLONIZATION_PACKS
});

/**
 * Global economic policy options (Victoria 3 — economic law inspiration).
 * @enum {string}
 */
const EconomicPolicy = Object.freeze({
  FREE_MARKET:  'free_market',  // +15% credits, +10% trade speed
  SUBSIDIES:    'subsidies',    // −20% factory build costs, −10% credits income
  MERCANTILISM: 'mercantilism', // +20% export earnings, imports +20% costlier
  AUTARKY:      'autarky',      // no import dependency, no import possible
  WAR_ECONOMY:  'war_economy',  // +30% military production, −20% consumer goods, −10% happiness
});

// ---------------------------------------------------------------------------
// Processing Recipes
// ---------------------------------------------------------------------------

/**
 * PROCESSING_RECIPES defines how each GoodType is produced.
 * Each good has a recipe per ProcessingMethod.
 *
 * Recipe shape:
 *   { inputs: { [resource|good]: number }, outputs: number, building: ProcessingBuilding,
 *     energyCost: number, researchPrereq: string|null }
 *
 * Inputs may reference primary resources (metal, crystal, deuterium, rare_earth, food)
 * or other goods by their GoodType key (for Tier-3 recipes).
 *
 * @type {Readonly<Record<string, Record<string, {inputs: Object, outputs: number,
 *         building: string, energyCost: number, researchPrereq: string|null}>>>}
 */
const PROCESSING_RECIPES = Object.freeze({
  // ── Tier 2 ────────────────────────────────────────────────────────────────

  [GoodType.STEEL_ALLOY]: {
    [ProcessingMethod.STANDARD]:  { building: ProcessingBuilding.METALLURGY,      inputs: { metal: 2            }, outputs: 1,   energyCost: 1,   researchPrereq: 'economy.metallurgy_i'   },
    [ProcessingMethod.EFFICIENT]: { building: ProcessingBuilding.METALLURGY,      inputs: { metal: 3            }, outputs: 2,   energyCost: 1.2, researchPrereq: 'economy.metallurgy_i'   },
    [ProcessingMethod.PREMIUM]:   { building: ProcessingBuilding.METALLURGY,      inputs: { metal: 2, rare_earth: 0.5 }, outputs: 2.5, energyCost: 1.5, researchPrereq: 'economy.metallurgy_ii'  },
  },

  [GoodType.FOCUS_CRYSTALS]: {
    [ProcessingMethod.STANDARD]:  { building: ProcessingBuilding.CRYSTAL_GRINDER, inputs: { crystal: 3, rare_earth: 1 }, outputs: 1,   energyCost: 0.8, researchPrereq: 'economy.refined_crystals' },
    [ProcessingMethod.EFFICIENT]: { building: ProcessingBuilding.CRYSTAL_GRINDER, inputs: { crystal: 4, rare_earth: 1 }, outputs: 1.5, energyCost: 1.0, researchPrereq: 'economy.refined_crystals' },
    [ProcessingMethod.PREMIUM]:   { building: ProcessingBuilding.CRYSTAL_GRINDER, inputs: { crystal: 3, rare_earth: 2 }, outputs: 2,   energyCost: 1.4, researchPrereq: 'economy.photon_optics'    },
  },

  [GoodType.REACTOR_FUEL]: {
    [ProcessingMethod.STANDARD]:  { building: ProcessingBuilding.REFINERY,        inputs: { deuterium: 2, rare_earth: 1 }, outputs: 1,   energyCost: 1.2, researchPrereq: 'economy.fuel_synthesis' },
    [ProcessingMethod.EFFICIENT]: { building: ProcessingBuilding.REFINERY,        inputs: { deuterium: 2, rare_earth: 0.8 }, outputs: 1.2, energyCost: 1.0, researchPrereq: 'economy.fuel_synthesis' },
    [ProcessingMethod.PREMIUM]:   { building: ProcessingBuilding.REFINERY,        inputs: { deuterium: 1.5, rare_earth: 0.5 }, outputs: 1, energyCost: 0.8,  researchPrereq: 'economy.fusion_catalyst' },
  },

  [GoodType.BIOCOMPOST]: {
    [ProcessingMethod.STANDARD]:  { building: ProcessingBuilding.BIOREACTOR,      inputs: { food: 2             }, outputs: 1,   energyCost: 0.5, researchPrereq: 'economy.bioeconomy' },
    [ProcessingMethod.EFFICIENT]: { building: ProcessingBuilding.BIOREACTOR,      inputs: { food: 2.5           }, outputs: 1.4, energyCost: 0.6, researchPrereq: 'economy.bioeconomy' },
    [ProcessingMethod.PREMIUM]:   { building: ProcessingBuilding.BIOREACTOR,      inputs: { food: 2             }, outputs: 1.8, energyCost: 0.8, researchPrereq: 'economy.advanced_bioscience' },
  },

  [GoodType.ELECTRONICS_COMPONENTS]: {
    [ProcessingMethod.STANDARD]:  { building: ProcessingBuilding.ELECTRONICS_FAB, inputs: { crystal: 1, rare_earth: 1 }, outputs: 1,   energyCost: 1.5, researchPrereq: 'economy.electronics_i'   },
    [ProcessingMethod.EFFICIENT]: { building: ProcessingBuilding.ELECTRONICS_FAB, inputs: { crystal: 1.2, rare_earth: 1 }, outputs: 1.4, energyCost: 1.8, researchPrereq: 'economy.electronics_i'   },
    [ProcessingMethod.PREMIUM]:   { building: ProcessingBuilding.ELECTRONICS_FAB, inputs: { crystal: 1, rare_earth: 0.8 }, outputs: 1.8, energyCost: 2.0, researchPrereq: 'economy.quantum_electronics' },
  },

  // ── Tier 3 ────────────────────────────────────────────────────────────────

  [GoodType.CONSUMER_GOODS]: {
    [ProcessingMethod.STANDARD]:  { building: ProcessingBuilding.CONSUMER_FACTORY, inputs: { steel_alloy: 1, electronics_components: 1 }, outputs: 1,   energyCost: 1.0, researchPrereq: 'economy.basic_manufacturing' },
    [ProcessingMethod.EFFICIENT]: { building: ProcessingBuilding.CONSUMER_FACTORY, inputs: { steel_alloy: 1.2, electronics_components: 1.2 }, outputs: 1.5, energyCost: 1.2, researchPrereq: 'economy.basic_manufacturing' },
    [ProcessingMethod.PREMIUM]:   { building: ProcessingBuilding.CONSUMER_FACTORY, inputs: { steel_alloy: 0.8, electronics_components: 1 }, outputs: 1.4, energyCost: 0.9, researchPrereq: 'economy.mass_production'    },
  },

  [GoodType.LUXURY_GOODS]: {
    [ProcessingMethod.STANDARD]:  { building: ProcessingBuilding.LUXURY_WORKSHOP,  inputs: { focus_crystals: 1, biocompost: 1 }, outputs: 1,   energyCost: 0.8, researchPrereq: 'economy.luxury_goods'  },
    [ProcessingMethod.EFFICIENT]: { building: ProcessingBuilding.LUXURY_WORKSHOP,  inputs: { focus_crystals: 1.2, biocompost: 1 }, outputs: 1.3, energyCost: 1.0, researchPrereq: 'economy.luxury_goods'  },
    [ProcessingMethod.PREMIUM]:   { building: ProcessingBuilding.LUXURY_WORKSHOP,  inputs: { focus_crystals: 1, biocompost: 0.8 }, outputs: 1.5, energyCost: 1.1, researchPrereq: 'economy.artisan_crafts' },
  },

  [GoodType.MILITARY_EQUIPMENT]: {
    [ProcessingMethod.STANDARD]:  { building: ProcessingBuilding.ARMS_FACTORY,     inputs: { steel_alloy: 2, focus_crystals: 1 }, outputs: 1,   energyCost: 2.0, researchPrereq: 'economy.military_industrial' },
    [ProcessingMethod.EFFICIENT]: { building: ProcessingBuilding.ARMS_FACTORY,     inputs: { steel_alloy: 2.5, focus_crystals: 1 }, outputs: 1.4, energyCost: 2.2, researchPrereq: 'economy.military_industrial' },
    [ProcessingMethod.PREMIUM]:   { building: ProcessingBuilding.ARMS_FACTORY,     inputs: { steel_alloy: 2, focus_crystals: 0.8 }, outputs: 1.6, energyCost: 1.8, researchPrereq: 'economy.advanced_weapons_mfg'  },
  },

  [GoodType.RESEARCH_KITS]: {
    [ProcessingMethod.STANDARD]:  { building: ProcessingBuilding.RESEARCH_LAB_ADV, inputs: { focus_crystals: 1, electronics_components: 1 }, outputs: 1,   energyCost: 1.5, researchPrereq: 'economy.research_economy' },
    [ProcessingMethod.EFFICIENT]: { building: ProcessingBuilding.RESEARCH_LAB_ADV, inputs: { focus_crystals: 1.2, electronics_components: 1.2 }, outputs: 1.4, energyCost: 1.8, researchPrereq: 'economy.research_economy' },
    [ProcessingMethod.PREMIUM]:   { building: ProcessingBuilding.RESEARCH_LAB_ADV, inputs: { focus_crystals: 1, electronics_components: 1 }, outputs: 1.8, energyCost: 2.0, researchPrereq: 'economy.advanced_r_and_d'  },
  },

  [GoodType.COLONIZATION_PACKS]: {
    [ProcessingMethod.STANDARD]:  { building: ProcessingBuilding.COLONY_SUPPLIES,  inputs: { steel_alloy: 1, biocompost: 1, reactor_fuel: 1 }, outputs: 1,   energyCost: 2.5, researchPrereq: 'economy.logistics_network' },
    [ProcessingMethod.EFFICIENT]: { building: ProcessingBuilding.COLONY_SUPPLIES,  inputs: { steel_alloy: 1.2, biocompost: 1, reactor_fuel: 1 }, outputs: 1.3, energyCost: 2.8, researchPrereq: 'economy.logistics_network' },
    [ProcessingMethod.PREMIUM]:   { building: ProcessingBuilding.COLONY_SUPPLIES,  inputs: { steel_alloy: 0.8, biocompost: 0.8, reactor_fuel: 0.8 }, outputs: 1.2, energyCost: 2.0, researchPrereq: 'economy.post_scarcity' },
  },
});

// ---------------------------------------------------------------------------
// Market constants
// ---------------------------------------------------------------------------

/**
 * Base market prices in Credits per unit.
 * Used as the anchor for dynamic price calculation.
 * @type {Readonly<Record<string, number>>}
 */
const GOOD_BASE_PRICE = Object.freeze({
  // Primary resources (reference — these are already tradeable)
  metal:       10,
  crystal:     15,
  deuterium:   20,
  rare_earth:  50,
  food:         8,

  // Tier 2
  [GoodType.STEEL_ALLOY]:            35,
  [GoodType.FOCUS_CRYSTALS]:         60,
  [GoodType.REACTOR_FUEL]:           55,
  [GoodType.BIOCOMPOST]:             25,
  [GoodType.ELECTRONICS_COMPONENTS]: 70,

  // Tier 3
  [GoodType.CONSUMER_GOODS]:        80,
  [GoodType.LUXURY_GOODS]:         200,
  [GoodType.MILITARY_EQUIPMENT]:   150,
  [GoodType.RESEARCH_KITS]:        130,
  [GoodType.COLONIZATION_PACKS]:   250,
});

/** Minimum price multiplier — price can fall at most to 30% of base. */
const PRICE_MULT_MIN = 0.30;
/** Maximum price multiplier — price can rise at most to 350% of base. */
const PRICE_MULT_MAX = 3.50;
/** Exponent used in the supply/demand price formula. */
const PRICE_ELASTICITY = 0.4;

// ---------------------------------------------------------------------------
// Pop consumption
// ---------------------------------------------------------------------------

/**
 * Per-pop-per-tick consumption of Tier-3 goods.
 * These represent the living standard needs of a colony's population.
 * Victoria 3 inspiration: needs pyramid (basic → comfort → luxury).
 * @type {Readonly<Record<string, number>>}
 */
const POP_CONSUMPTION_RATE = Object.freeze({
  [GoodType.CONSUMER_GOODS]: 0.20,  // comfort needs — affects happiness & credits
  [GoodType.LUXURY_GOODS]:   0.05,  // luxury needs — affects max happiness & loyalty
});

/**
 * Happiness modifiers applied when pop consumption targets are (not) met.
 * @type {Readonly<Record<string, {bonus: number, penalty: number}>>}
 */
const CONSUMPTION_HAPPINESS = Object.freeze({
  [GoodType.CONSUMER_GOODS]: { bonus: 10, penalty: -10 },
  [GoodType.LUXURY_GOODS]:   { bonus: 20, penalty:   0 },  // luxury shortage → no penalty
});

/**
 * Credits production modifier when consumer_goods are missing (Victoria 3: lack of
 * consumer goods reduces workforce output).
 */
const CONSUMER_GOODS_SHORTAGE_CREDIT_MULT = 0.80; // −20% credits

// ---------------------------------------------------------------------------
// Economic policy constants
// ---------------------------------------------------------------------------

/**
 * Modifiers applied by each global EconomicPolicy.
 * @type {Readonly<Record<string, Object>>}
 */
const POLICY_EFFECTS = Object.freeze({
  [EconomicPolicy.FREE_MARKET]:  { credits_mult: 1.15, trade_speed: 1.10, build_cost_mult: 1.00, import_cost_mult: 1.00, military_prod_mult: 1.00, consumer_goods_mult: 1.00, happiness_mod: 0   },
  [EconomicPolicy.SUBSIDIES]:    { credits_mult: 0.90, trade_speed: 1.00, build_cost_mult: 0.80, import_cost_mult: 1.00, military_prod_mult: 1.00, consumer_goods_mult: 1.00, happiness_mod: 0   },
  [EconomicPolicy.MERCANTILISM]: { credits_mult: 1.10, trade_speed: 1.00, build_cost_mult: 1.00, import_cost_mult: 1.20, military_prod_mult: 1.00, consumer_goods_mult: 1.00, happiness_mod: 0   },
  [EconomicPolicy.AUTARKY]:      { credits_mult: 1.00, trade_speed: 1.00, build_cost_mult: 1.00, import_cost_mult: null, military_prod_mult: 1.00, consumer_goods_mult: 1.00, happiness_mod: 0   },
  [EconomicPolicy.WAR_ECONOMY]:  { credits_mult: 1.00, trade_speed: 1.00, build_cost_mult: 1.00, import_cost_mult: 1.00, military_prod_mult: 1.30, consumer_goods_mult: 0.80, happiness_mod: -10 },
});

/** Default EconomyPolicy tax rates. */
const DEFAULT_TAX_RATES = Object.freeze({
  income:     0.15,  // 15%
  production: 0.10,  // 10%
  trade:      0.05,  //  5%
});

// ---------------------------------------------------------------------------
// Market events
// ---------------------------------------------------------------------------

/**
 * Pre-defined market event templates.
 * Applied by GalacticMarket.addEvent(); expire after `defaultDurationTicks`.
 * @type {Readonly<Array<{code: string, label: string, affectedGood: string|null,
 *        priceMult: number, demandMult: number, defaultDurationTicks: number}>>}
 */
const MARKET_EVENT_TEMPLATES = Object.freeze([
  { code: 'plague',         label: 'Seuche',             affectedGood: 'food',                          priceMult: 2.0,  demandMult: 2.0,  defaultDurationTicks: 48 },
  { code: 'piracy_wave',    label: 'Piraterie-Welle',    affectedGood: null,                            priceMult: 1.3,  demandMult: 1.0,  defaultDurationTicks: 24 }, // raises all trade costs
  { code: 'tech_boom',      label: 'Technologieschub',   affectedGood: GoodType.RESEARCH_KITS,          priceMult: 0.80, demandMult: 1.5,  defaultDurationTicks: 48 },
  { code: 'shortage',       label: 'Ressourcen-Knappheit', affectedGood: null,                          priceMult: 2.0,  demandMult: 1.0,  defaultDurationTicks: 12 }, // random good
  { code: 'trade_boom',     label: 'Handelsboom',        affectedGood: null,                            priceMult: 1.0,  demandMult: 1.3,  defaultDurationTicks: 24 }, // raises demand across board
  { code: 'galactic_war',   label: 'Galaktischer Krieg', affectedGood: GoodType.MILITARY_EQUIPMENT,     priceMult: 3.0,  demandMult: 3.0,  defaultDurationTicks: 999 }, // duration controlled externally
  { code: 'harvest_season', label: 'Erntesaison',        affectedGood: 'food',                          priceMult: 0.50, demandMult: 0.8,  defaultDurationTicks: 24 },
]);

// ---------------------------------------------------------------------------
// GoodStock
// ---------------------------------------------------------------------------

/**
 * Inventory of processed goods for a single colony.
 * Tracks quantity and capacity per GoodType.
 *
 * Default capacities (from ECONOMY_DESIGN.md §2.4):
 *   Tier-2 goods: 5,000 per type
 *   Tier-3 goods: 2,000 per type
 */
class GoodStock {
  /**
   * @param {Object} [initialStock]  Plain object { [GoodType]: number }
   * @param {Object} [capacities]    Plain object { [GoodType]: number } — overrides defaults
   */
  constructor(initialStock = {}, capacities = {}) {
    /** @type {Map<string, number>} */
    this._stock    = new Map();
    /** @type {Map<string, number>} */
    this._capacity = new Map();

    for (const good of Object.values(GoodType)) {
      const defaultCap = GOOD_TIER[good] === 2 ? 5000 : 2000;
      this._capacity.set(good, capacities[good] ?? defaultCap);
      this._stock.set(good, Math.min(initialStock[good] ?? 0, this._capacity.get(good)));
    }
  }

  /**
   * Get the current quantity of a good.
   * @param {string} good  GoodType
   * @returns {number}
   */
  get(good) { return this._stock.get(good) ?? 0; }

  /**
   * Get the storage capacity for a good.
   * @param {string} good  GoodType
   * @returns {number}
   */
  capacity(good) { return this._capacity.get(good) ?? 0; }

  /**
   * Add quantity to a good (capped at capacity).
   * @param {string} good
   * @param {number} amount
   * @returns {number}  Actual amount added (may be less if capacity is full)
   */
  add(good, amount) {
    const current  = this._stock.get(good) ?? 0;
    const cap      = this._capacity.get(good) ?? 0;
    const added    = Math.min(amount, cap - current);
    this._stock.set(good, current + added);
    return added;
  }

  /**
   * Consume quantity from a good (clamped to available).
   * @param {string} good
   * @param {number} amount
   * @returns {number}  Actual amount consumed
   */
  consume(good, amount) {
    const current  = this._stock.get(good) ?? 0;
    const consumed = Math.min(amount, current);
    this._stock.set(good, current - consumed);
    return consumed;
  }

  /**
   * Check if there is at least `amount` of a good available.
   * @param {string} good
   * @param {number} amount
   * @returns {boolean}
   */
  has(good, amount) { return (this._stock.get(good) ?? 0) >= amount; }

  /**
   * Serialize to a plain JSON-compatible object.
   * @returns {Object}
   */
  serialize() {
    const stock = {};
    for (const [good, qty] of this._stock) stock[good] = qty;
    const capacities = {};
    for (const [good, cap] of this._capacity) capacities[good] = cap;
    return { stock, capacities };
  }

  /**
   * @param {Object} json
   * @returns {GoodStock}
   */
  static deserialize(json) {
    return new GoodStock(json.stock ?? {}, json.capacities ?? {});
  }
}

// ---------------------------------------------------------------------------
// GalacticMarket
// ---------------------------------------------------------------------------

/**
 * Dynamic market for processed goods and primary resources.
 *
 * Price model (X4/Victoria 3 hybrid):
 *   price(t) = baseprice × clamp((demand / max(1, supply))^PRICE_ELASTICITY,
 *              PRICE_MULT_MIN, PRICE_MULT_MAX)
 *
 * Active market events can additionally modify the effective price and demand.
 *
 * EventBus events emitted:
 *   'economy:market:price_change'   — when a price changes by ≥5%
 *   'economy:market:event_start'    — when a market event becomes active
 *   'economy:market:event_end'      — when a market event expires
 */
class GalacticMarket {
  /**
   * @param {import('../EventBus').EventBus} [bus]
   */
  constructor(bus) {
    this._bus = bus ?? null;
    /** @type {Map<string, {supply: number, demand: number, priceMult: number}>} */
    this._data = new Map();
    /** @type {Array<{code: string, label: string, affectedGood: string|null,
     *                priceMult: number, demandMult: number, remainingTicks: number}>} */
    this._events = [];

    // Initialize with defaults for all goods and primary resources
    const allGoods = [
      ...Object.values(GoodType),
      'metal', 'crystal', 'deuterium', 'rare_earth', 'food',
    ];
    for (const g of allGoods) {
      this._data.set(g, { supply: 100, demand: 100, priceMult: 1.0 });
    }
  }

  // ---------------------------------------------------------------------------
  // Price calculation
  // ---------------------------------------------------------------------------

  /**
   * Compute the current market price for a good.
   * Applies active market events on top of the supply/demand formula.
   *
   * @param {string} good
   * @returns {number}  Credits per unit
   */
  getPrice(good) {
    const base    = GOOD_BASE_PRICE[good] ?? 10;
    const d       = this._data.get(good);
    if (!d) return base;

    let mult = Math.pow(d.demand / Math.max(1, d.supply), PRICE_ELASTICITY);
    mult     = Math.min(PRICE_MULT_MAX, Math.max(PRICE_MULT_MIN, mult));

    // Apply active event multipliers
    for (const ev of this._events) {
      if (ev.affectedGood === null || ev.affectedGood === good) {
        mult *= ev.priceMult;
      }
    }

    return Math.round(base * mult * 100) / 100;
  }

  /**
   * Get a snapshot of supply, demand, and computed price for a good.
   * @param {string} good
   * @returns {{supply: number, demand: number, price: number, priceMult: number}}
   */
  getInfo(good) {
    const d = this._data.get(good) ?? { supply: 100, demand: 100, priceMult: 1.0 };
    return { supply: d.supply, demand: d.demand, price: this.getPrice(good), priceMult: d.priceMult };
  }

  /**
   * Update supply and demand for a good and recalculate its price multiplier.
   * Emits 'economy:market:price_change' if the price changes by ≥5%.
   *
   * @param {string} good
   * @param {{supply?: number, demand?: number}} delta  Additive changes
   */
  updateSupplyDemand(good, { supply = 0, demand = 0 }) {
    let d = this._data.get(good);
    if (!d) {
      d = { supply: 100, demand: 100, priceMult: 1.0 };
      this._data.set(good, d);
    }
    const oldPrice  = this.getPrice(good);
    d.supply        = Math.max(0, d.supply + supply);
    d.demand        = Math.max(0, d.demand + demand);
    const newPrice  = this.getPrice(good);
    const changePct = Math.abs((newPrice - oldPrice) / Math.max(1, oldPrice));
    if (changePct >= 0.05) {
      this._bus?.emit('economy:market:price_change', { good, oldPrice, newPrice, changePct });
    }
  }

  /**
   * Simulate a sell order — increases supply on the market.
   * Returns total credits earned (quantity × price, minus trade tax if provided).
   *
   * @param {string} colonyId  For event context
   * @param {string} good
   * @param {number} quantity
   * @param {number} [tradeTaxRate=0]  Fraction of revenue taken as tax (0–1)
   * @returns {number}  Credits earned
   */
  sell(colonyId, good, quantity, tradeTaxRate = 0) {
    const price    = this.getPrice(good);
    const gross    = price * quantity;
    const net      = gross * (1 - tradeTaxRate);
    this.updateSupplyDemand(good, { supply: quantity });
    return Math.round(net * 100) / 100;
  }

  /**
   * Simulate a buy order — increases demand on the market.
   * Returns total credits spent (quantity × price × trade tax if applicable).
   *
   * @param {string} colonyId  For event context
   * @param {string} good
   * @param {number} quantity
   * @param {number} [tradeTaxRate=0]  Fraction of cost added as import tax (0–1)
   * @returns {number}  Credits spent
   */
  buy(colonyId, good, quantity, tradeTaxRate = 0) {
    const price  = this.getPrice(good);
    const gross  = price * quantity;
    const total  = gross * (1 + tradeTaxRate);
    this.updateSupplyDemand(good, { demand: quantity });
    return Math.round(total * 100) / 100;
  }

  // ---------------------------------------------------------------------------
  // Market events
  // ---------------------------------------------------------------------------

  /**
   * Add a market event (from MARKET_EVENT_TEMPLATES or a custom definition).
   *
   * @param {Object} event
   * @param {string} event.code
   * @param {string} event.label
   * @param {string|null} event.affectedGood
   * @param {number} event.priceMult
   * @param {number} event.demandMult
   * @param {number} event.durationTicks
   */
  addEvent(event) {
    const ev = {
      code:         event.code,
      label:        event.label,
      affectedGood: event.affectedGood ?? null,
      priceMult:    event.priceMult    ?? 1.0,
      demandMult:   event.demandMult   ?? 1.0,
      remainingTicks: event.durationTicks ?? 24,
    };
    this._events.push(ev);
    this._bus?.emit('economy:market:event_start', { event: ev });
  }

  /**
   * Advance market events by dt ticks; remove expired ones.
   * @param {number} [dt=1]
   */
  tickEvents(dt = 1) {
    this._events = this._events.filter((ev) => {
      ev.remainingTicks -= dt;
      if (ev.remainingTicks <= 0) {
        this._bus?.emit('economy:market:event_end', { event: ev });
        return false;
      }
      return true;
    });
  }

  /** @returns {ReadonlyArray} Active market events */
  get activeEvents() { return [...this._events]; }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * @returns {Object}
   */
  serialize() {
    const data = {};
    for (const [good, d] of this._data) data[good] = { ...d };
    return { data, events: this._events.map(e => ({ ...e })) };
  }

  /**
   * @param {Object} json
   * @param {import('../EventBus').EventBus} [bus]
   * @returns {GalacticMarket}
   */
  static deserialize(json, bus) {
    const m = new GalacticMarket(bus);
    for (const [good, d] of Object.entries(json.data ?? {})) {
      m._data.set(good, { supply: d.supply ?? 100, demand: d.demand ?? 100, priceMult: d.priceMult ?? 1.0 });
    }
    m._events = (json.events ?? []).map(e => ({ ...e }));
    return m;
  }
}

// ---------------------------------------------------------------------------
// EconomyPolicy
// ---------------------------------------------------------------------------

/**
 * Per-player economic policy: tax rates and global policy selection.
 *
 * Affects:
 *   - Credits income multiplier (income tax)
 *   - Resource output multiplier (production tax)
 *   - Import/export costs (trade tax)
 *   - Building costs (subsidies policy)
 *   - Military production rate (war economy policy)
 *
 * EventBus events emitted:
 *   'economy:policy:changed'  — when policy or tax rates are updated
 */
class EconomyPolicy {
  /**
   * @param {import('../EventBus').EventBus} [bus]
   */
  constructor(bus) {
    this._bus            = bus ?? null;
    this._globalPolicy   = EconomicPolicy.FREE_MARKET;
    this._taxes          = { ...DEFAULT_TAX_RATES };
    this._subsidies      = { agriculture: false, research: false, military: false };
  }

  // ---------------------------------------------------------------------------
  // Global policy
  // ---------------------------------------------------------------------------

  /** @returns {string}  Current EconomicPolicy */
  get globalPolicy() { return this._globalPolicy; }

  /**
   * Switch the global economic policy.
   * @param {string} policy  EconomicPolicy
   */
  setGlobalPolicy(policy) {
    if (!Object.values(EconomicPolicy).includes(policy)) {
      throw new RangeError(`[EconomyPolicy] Unknown policy: '${policy}'`);
    }
    this._globalPolicy = policy;
    this._bus?.emit('economy:policy:changed', { type: 'global_policy', policy });
  }

  /**
   * Get the effective policy effect modifiers for the current policy.
   * @returns {Object}
   */
  getEffects() { return { ...POLICY_EFFECTS[this._globalPolicy] }; }

  // ---------------------------------------------------------------------------
  // Tax rates
  // ---------------------------------------------------------------------------

  /**
   * Get current tax rate by type.
   * @param {'income'|'production'|'trade'} type
   * @returns {number}  0–1 fraction
   */
  getTax(type) { return this._taxes[type] ?? 0; }

  /**
   * Set a tax rate.
   * @param {'income'|'production'|'trade'} type
   * @param {number} rate  0–1 (clamped)
   */
  setTax(type, rate) {
    if (!['income', 'production', 'trade'].includes(type)) {
      throw new RangeError(`[EconomyPolicy] Unknown tax type: '${type}'`);
    }
    const maxRates = { income: 0.40, production: 0.30, trade: 0.25 };
    this._taxes[type] = Math.min(maxRates[type] ?? 0.40, Math.max(0, rate));
    this._bus?.emit('economy:policy:changed', { type: 'tax', taxType: type, rate: this._taxes[type] });
  }

  // ---------------------------------------------------------------------------
  // Subsidies
  // ---------------------------------------------------------------------------

  /**
   * Toggle a subsidy.
   * @param {'agriculture'|'research'|'military'} sector
   * @param {boolean} enabled
   */
  setSubsidy(sector, enabled) {
    if (!(sector in this._subsidies)) {
      throw new RangeError(`[EconomyPolicy] Unknown subsidy sector: '${sector}'`);
    }
    this._subsidies[sector] = Boolean(enabled);
    this._bus?.emit('economy:policy:changed', { type: 'subsidy', sector, enabled });
  }

  /** @returns {Object}  Current subsidies */
  get subsidies() { return { ...this._subsidies }; }

  // ---------------------------------------------------------------------------
  // Derived computations
  // ---------------------------------------------------------------------------

  /**
   * Compute the credits multiplier for the current policy + income tax.
   * @returns {number}
   */
  creditsMultiplier() {
    const base = POLICY_EFFECTS[this._globalPolicy].credits_mult ?? 1.0;
    return base * (1 - this._taxes.income);
  }

  /**
   * Compute the effective import cost multiplier (autarky blocks all imports).
   * @returns {number|null}  null = no imports allowed (autarky)
   */
  importCostMultiplier() {
    const eff = POLICY_EFFECTS[this._globalPolicy];
    if (eff.import_cost_mult === null) return null;
    return (eff.import_cost_mult ?? 1.0) * (1 + this._taxes.trade);
  }

  /**
   * Compute the effective export earnings multiplier.
   * @returns {number}
   */
  exportEarningsMultiplier() {
    const base = this._globalPolicy === EconomicPolicy.MERCANTILISM ? 1.20 : 1.0;
    return base * (1 - this._taxes.trade);
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /** @returns {Object} */
  serialize() {
    return {
      globalPolicy: this._globalPolicy,
      taxes:        { ...this._taxes },
      subsidies:    { ...this._subsidies },
    };
  }

  /**
   * @param {Object} json
   * @param {import('../EventBus').EventBus} [bus]
   * @returns {EconomyPolicy}
   */
  static deserialize(json, bus) {
    const p = new EconomyPolicy(bus);
    p._globalPolicy = json.globalPolicy ?? EconomicPolicy.FREE_MARKET;
    p._taxes        = { ...DEFAULT_TAX_RATES, ...(json.taxes ?? {}) };
    p._subsidies    = { agriculture: false, research: false, military: false, ...(json.subsidies ?? {}) };
    return p;
  }
}

// ---------------------------------------------------------------------------
// ColonyEconomyNode
// ---------------------------------------------------------------------------

/**
 * Represents a single colony's economic state within the simulation:
 *   - which processing buildings it has and at which level
 *   - which ProcessingMethod is active per building
 *   - its GoodStock inventory
 *   - a reference to the primary-resource stockpile (external, mutable)
 *
 * This class is internal to EconomySimulation and not exported directly.
 */
class ColonyEconomyNode {
  /**
   * @param {string} colonyId
   * @param {Object} opts
   * @param {Object} opts.buildings       { [ProcessingBuilding]: count }
   * @param {Object} opts.stockpile       Mutable primary-resource object
   *                                      { metal, crystal, deuterium, rare_earth, food, energy }
   * @param {number} opts.population      Current pop count (for consumption)
   * @param {GoodStock} [opts.goodStock]  Pre-existing stock (for deserialization)
   */
  constructor(colonyId, { buildings = {}, stockpile = {}, population = 0, goodStock } = {}) {
    this.id         = colonyId;
    this.buildings  = { ...buildings };   // { [ProcessingBuilding]: number (count) }
    this.stockpile  = stockpile;          // live reference to primary-resource stockpile
    this.population = population;
    this.stock      = goodStock ?? new GoodStock();
    /** @type {Object}  Active method per building: { [ProcessingBuilding]: ProcessingMethod } */
    this.methods    = {};
    for (const b of Object.keys(buildings)) {
      this.methods[b] = ProcessingMethod.STANDARD;
    }
    /** Happiness modifier accumulated this tick (applied externally). */
    this.happinessMod = 0;
    /** Credits delta accumulated this tick (applied externally). */
    this.creditsDelta = 0;
  }

  /**
   * Switch the active production method for a building.
   * @param {string} building  ProcessingBuilding
   * @param {string} method    ProcessingMethod
   * @param {Set<string>} [unlockedTechs]  Set of completed research IDs
   */
  setMethod(building, method, unlockedTechs = new Set()) {
    if (!Object.values(ProcessingMethod).includes(method)) {
      throw new RangeError(`[ColonyEconomyNode] Unknown method: '${method}'`);
    }
    // Find the good this building produces, check research prereq
    for (const good of Object.values(GoodType)) {
      const recipe = PROCESSING_RECIPES[good]?.[method];
      if (recipe?.building === building) {
        if (recipe.researchPrereq && !unlockedTechs.has(recipe.researchPrereq)) {
          throw new Error(`[ColonyEconomyNode] Research '${recipe.researchPrereq}' required for ${method} method`);
        }
        break;
      }
    }
    this.methods[building] = method;
  }

  /**
   * Run one processing tick for this colony.
   * For each processing building in this colony, attempt to produce the
   * corresponding good using the active production method.
   *
   * Returns a production report.
   *
   * @param {number} [dt=1]
   * @param {Set<string>} [unlockedTechs]
   * @returns {Array<{good: string, produced: number, inputsConsumed: Object}>}
   */
  processTick(dt = 1, unlockedTechs = new Set()) {
    const report = [];

    for (const [buildingType, count] of Object.entries(this.buildings)) {
      if (!count || count <= 0) continue;

      const method = this.methods[buildingType] ?? ProcessingMethod.STANDARD;

      // Find which good this building produces
      let targetGood = null;
      for (const good of Object.values(GoodType)) {
        const recipe = PROCESSING_RECIPES[good]?.[method];
        if (recipe?.building === buildingType) {
          targetGood = good;
          break;
        }
      }
      if (!targetGood) continue;

      // Check research prereq
      const recipe = PROCESSING_RECIPES[targetGood][method];
      if (recipe.researchPrereq && !unlockedTechs.has(recipe.researchPrereq)) continue;

      // Try to run `count` instances of this building
      let totalProduced    = 0;
      const inputsConsumed = {};

      for (let i = 0; i < count; i++) {
        // Check if all inputs are available
        let canProduce = true;
        for (const [resource, amount] of Object.entries(recipe.inputs)) {
          const needed = amount * dt;
          const available = GOOD_TIER[resource]
            ? this.stock.get(resource)
            : (this.stockpile[resource] ?? 0);
          if (available < needed) { canProduce = false; break; }
        }
        if (!canProduce) continue;

        // Consume inputs
        for (const [resource, amount] of Object.entries(recipe.inputs)) {
          const consumed = amount * dt;
          if (GOOD_TIER[resource]) {
            this.stock.consume(resource, consumed);
          } else {
            this.stockpile[resource] = Math.max(0, (this.stockpile[resource] ?? 0) - consumed);
          }
          inputsConsumed[resource] = (inputsConsumed[resource] ?? 0) + consumed;
        }

        // Produce output (capped by stock capacity)
        const produced = recipe.outputs * dt;
        totalProduced += this.stock.add(targetGood, produced);
      }

      if (totalProduced > 0 || Object.keys(inputsConsumed).length > 0) {
        report.push({ good: targetGood, produced: totalProduced, inputsConsumed });
      }
    }

    return report;
  }

  /**
   * Run pop-consumption tick for this colony.
   * Pops consume Tier-3 goods (consumer_goods, luxury_goods).
   * Calculates happiness and credits delta from consumption levels.
   *
   * @param {number} [dt=1]
   * @returns {{happinessMod: number, creditsDelta: number,
   *            consumed: Object, shortages: string[]}}
   */
  consumeTick(dt = 1) {
    let happinessMod  = 0;
    let creditsDelta  = 0;
    const consumed    = {};
    const shortages   = [];

    for (const [good, ratePerPop] of Object.entries(POP_CONSUMPTION_RATE)) {
      const needed     = ratePerPop * this.population * dt;
      const actual     = this.stock.consume(good, needed);
      consumed[good]   = actual;
      const coverage   = needed > 0 ? actual / needed : 1;
      const hapEff     = CONSUMPTION_HAPPINESS[good];

      if (coverage >= 0.99) {
        // Full satisfaction
        happinessMod += hapEff.bonus;
      } else if (coverage < 0.01) {
        // Complete shortage
        happinessMod += hapEff.penalty;
        shortages.push(good);
      } else {
        // Partial — linear interpolation
        const partialBonus = hapEff.bonus * coverage + hapEff.penalty * (1 - coverage);
        happinessMod += partialBonus;
        if (coverage < 0.5) shortages.push(good);
      }

      // Credit penalty for consumer goods shortage (Victoria 3: workforce suffers)
      if (good === GoodType.CONSUMER_GOODS && coverage < 0.99) {
        creditsDelta -= this.population * (1 - coverage) * 2;
      }
    }

    this.happinessMod = happinessMod;
    this.creditsDelta = creditsDelta;
    return { happinessMod, creditsDelta, consumed, shortages };
  }

  /** @returns {Object} */
  serialize() {
    return {
      id:         this.id,
      buildings:  { ...this.buildings },
      methods:    { ...this.methods },
      population: this.population,
      stock:      this.stock.serialize(),
    };
  }

  /**
   * Note: stockpile is not serialized here — it's an external reference.
   * @param {Object} json
   * @param {Object} stockpile  External primary-resource stockpile reference
   * @returns {ColonyEconomyNode}
   */
  static deserialize(json, stockpile) {
    const node = new ColonyEconomyNode(json.id, {
      buildings:  json.buildings  ?? {},
      stockpile,
      population: json.population ?? 0,
      goodStock:  GoodStock.deserialize(json.stock ?? {}),
    });
    node.methods = { ...json.methods };
    return node;
  }
}

// ---------------------------------------------------------------------------
// EconomySimulation
// ---------------------------------------------------------------------------

/**
 * Top-level economy simulation.
 *
 * Manages:
 *   - A set of ColonyEconomyNodes (one per colony)
 *   - A GalacticMarket instance (shared across all colonies)
 *   - An EconomyPolicy instance (per player/civilization)
 *
 * Tick sequence:
 *   1. Colony processing tick (convert primary resources → Tier 2/3 goods)
 *   2. Colony consumption tick (pops consume Tier-3 goods → happiness/credits delta)
 *   3. Market tick (supply/demand updated, events decremented)
 *   4. Emit aggregate events
 *
 * EventBus events emitted:
 *   'economy:produced'       — { colonyId, report: [{good, produced, inputsConsumed}] }
 *   'economy:consumed'       — { colonyId, consumed, shortages }
 *   'economy:shortage'       — { colonyId, good }  (per shortage)
 *   'economy:tick:complete'  — { tickNumber, totalProduced: Object, totalShortages: string[] }
 */
class EconomySimulation {
  /**
   * @param {import('../EventBus').EventBus} [bus]
   */
  constructor(bus) {
    this._bus     = bus ?? null;
    this._tick    = 0;
    /** @type {Map<string, ColonyEconomyNode>} */
    this._nodes   = new Map();
    this.market   = new GalacticMarket(bus);
    this.policy   = new EconomyPolicy(bus);
    /** @type {Set<string>}  Completed research IDs (for production method gating). */
    this._unlockedTechs = new Set();
  }

  // ---------------------------------------------------------------------------
  // Colony registration
  // ---------------------------------------------------------------------------

  /**
   * Register a colony with the economy simulation.
   * If the colony is already registered, its processing buildings and population
   * are updated without resetting the good stock.
   *
   * @param {string} colonyId
   * @param {Object} opts
   * @param {Object} opts.buildings   { [ProcessingBuilding]: count }
   * @param {Object} opts.stockpile   Live primary-resource object
   * @param {number} opts.population  Current pop count
   * @returns {ColonyEconomyNode}
   */
  registerColony(colonyId, { buildings = {}, stockpile = {}, population = 0 } = {}) {
    let node = this._nodes.get(colonyId);
    if (node) {
      // Update buildings and pop count, keep existing stock
      node.buildings  = { ...buildings };
      node.population = population;
      node.stockpile  = stockpile;
      // Ensure methods exist for any new buildings
      for (const b of Object.keys(buildings)) {
        if (!(b in node.methods)) node.methods[b] = ProcessingMethod.STANDARD;
      }
    } else {
      node = new ColonyEconomyNode(colonyId, { buildings, stockpile, population });
      this._nodes.set(colonyId, node);
    }
    return node;
  }

  /**
   * Remove a colony from the simulation.
   * @param {string} colonyId
   */
  unregisterColony(colonyId) {
    this._nodes.delete(colonyId);
  }

  /**
   * Get the economy node for a colony.
   * @param {string} colonyId
   * @returns {ColonyEconomyNode|undefined}
   */
  getColony(colonyId) { return this._nodes.get(colonyId); }

  // ---------------------------------------------------------------------------
  // Research unlock
  // ---------------------------------------------------------------------------

  /**
   * Mark a technology as researched (unlocks production methods and recipes).
   * @param {string} techId
   */
  unlockTech(techId) {
    this._unlockedTechs.add(techId);
  }

  // ---------------------------------------------------------------------------
  // Production method configuration
  // ---------------------------------------------------------------------------

  /**
   * Set the production method for a building in a colony.
   * @param {string} colonyId
   * @param {string} building   ProcessingBuilding
   * @param {string} method     ProcessingMethod
   */
  setProductionMethod(colonyId, building, method) {
    const node = this._nodes.get(colonyId);
    if (!node) throw new ReferenceError(`[EconomySimulation] Unknown colony: '${colonyId}'`);
    node.setMethod(building, method, this._unlockedTechs);
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Advance the economy by dt turns.
   * @param {number} [dt=1]
   * @returns {{produced: Object, consumed: Object, shortages: string[], tick: number}}
   */
  tick(dt = 1) {
    this._tick += dt;
    const allProduced   = {};
    const allConsumed   = {};
    const allShortages  = [];

    for (const node of this._nodes.values()) {
      // 1. Processing
      const prodReport = node.processTick(dt, this._unlockedTechs);
      if (prodReport.length > 0) {
        this._bus?.emit('economy:produced', { colonyId: node.id, report: prodReport });
        for (const { good, produced } of prodReport) {
          allProduced[good] = (allProduced[good] ?? 0) + produced;
          // Add to market supply
          this.market.updateSupplyDemand(good, { supply: produced * 0.1 }); // 10% spills to market
        }
      }

      // 2. Consumption
      const { happinessMod, creditsDelta, consumed, shortages } = node.consumeTick(dt);
      if (Object.keys(consumed).length > 0) {
        this._bus?.emit('economy:consumed', {
          colonyId: node.id, consumed, shortages, happinessMod, creditsDelta,
        });
        for (const [good, amt] of Object.entries(consumed)) {
          allConsumed[good] = (allConsumed[good] ?? 0) + amt;
          this.market.updateSupplyDemand(good, { demand: amt * 0.05 }); // 5% demand signal
        }
      }
      for (const good of shortages) {
        allShortages.push(good);
        this._bus?.emit('economy:shortage', { colonyId: node.id, good });
      }
    }

    // 3. Market event tick
    this.market.tickEvents(dt);

    // 4. Summary event
    this._bus?.emit('economy:tick:complete', {
      tickNumber:     this._tick,
      totalProduced:  allProduced,
      totalConsumed:  allConsumed,
      totalShortages: allShortages,
    });

    return { produced: allProduced, consumed: allConsumed, shortages: allShortages, tick: this._tick };
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /**
   * Build a summary of the current economy across all colonies.
   * @returns {Object}
   */
  summary() {
    const goods  = {};
    for (const good of Object.values(GoodType)) {
      goods[good] = { stock: 0, price: this.market.getPrice(good) };
    }
    for (const node of this._nodes.values()) {
      for (const good of Object.values(GoodType)) {
        goods[good].stock += node.stock.get(good);
      }
    }
    return {
      tick:         this._tick,
      colonies:     this._nodes.size,
      goods,
      policy:       this.policy.getEffects(),
      activeEvents: this.market.activeEvents,
    };
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Serialize the simulation state (without external stockpile references).
   * @returns {Object}
   */
  serialize() {
    const nodes = {};
    for (const [id, node] of this._nodes) nodes[id] = node.serialize();
    return {
      tick:           this._tick,
      nodes,
      market:         this.market.serialize(),
      policy:         this.policy.serialize(),
      unlockedTechs:  [...this._unlockedTechs],
    };
  }

  /**
   * Reconstruct an EconomySimulation.
   * Note: stockpile references must be re-wired externally after deserialization.
   *
   * @param {Object} json
   * @param {import('../EventBus').EventBus} [bus]
   * @param {Object} [stockpiles]  { [colonyId]: primaryResourceObject }
   * @returns {EconomySimulation}
   */
  static deserialize(json, bus, stockpiles = {}) {
    const sim    = new EconomySimulation(bus);
    sim._tick    = json.tick ?? 0;
    sim.market   = GalacticMarket.deserialize(json.market ?? {}, bus);
    sim.policy   = EconomyPolicy.deserialize(json.policy  ?? {}, bus);
    for (const tech of json.unlockedTechs ?? []) sim._unlockedTechs.add(tech);
    for (const [id, nodeJson] of Object.entries(json.nodes ?? {})) {
      const node = ColonyEconomyNode.deserialize(nodeJson, stockpiles[id] ?? {});
      sim._nodes.set(id, node);
    }
    return sim;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EconomySimulation, ColonyEconomyNode, GalacticMarket, EconomyPolicy, GoodStock,
    GoodType, GOOD_TIER, ProcessingMethod, ProcessingBuilding, EconomicPolicy,
    PROCESSING_RECIPES, GOOD_BASE_PRICE, POP_CONSUMPTION_RATE, CONSUMPTION_HAPPINESS,
    CONSUMER_GOODS_SHORTAGE_CREDIT_MULT, POLICY_EFFECTS, DEFAULT_TAX_RATES,
    MARKET_EVENT_TEMPLATES,
    PRICE_MULT_MIN, PRICE_MULT_MAX, PRICE_ELASTICITY,
  };
} else {
  window.GQEconomy = {
    EconomySimulation, ColonyEconomyNode, GalacticMarket, EconomyPolicy, GoodStock,
    GoodType, GOOD_TIER, ProcessingMethod, ProcessingBuilding, EconomicPolicy,
    PROCESSING_RECIPES, GOOD_BASE_PRICE, POP_CONSUMPTION_RATE, CONSUMPTION_HAPPINESS,
    CONSUMER_GOODS_SHORTAGE_CREDIT_MULT, POLICY_EFFECTS, DEFAULT_TAX_RATES,
    MARKET_EVENT_TEMPLATES,
    PRICE_MULT_MIN, PRICE_MULT_MAX, PRICE_ELASTICITY,
  };
}
