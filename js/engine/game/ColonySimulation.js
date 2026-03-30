/**
 * ColonySimulation.js  — Colony Pop, Resource & Invasion Simulation
 *
 * Inspired by:
 *   Victoria 3        (Paradox, 2022)  — Pop growth, needs, jobs, goods
 *   Master of Orion   (SimTex, 1993)   — Farmer/Worker/Scientist allocation, ground combat
 *   Stellaris         (Paradox, 2016)  — Planetary districts + pop jobs, occupation
 *   Endless Space 2   (Amplitude, 2017) — FIDS (Food, Industry, Dust, Science)
 *   OGame             (Gameforge, 2002) — Ground troop invasion mechanics
 *
 * Provides:
 *   - A Colony data model with Pops (population units)
 *   - Pop job types: FARMER, WORKER, SCIENTIST, SOLDIER, RULER
 *   - Resource production per pop type per turn (including accumulated defence)
 *   - Pop growth formula (logistic + food surplus)
 *   - Colony happiness / stability affecting productivity
 *   - RULER governance: reduces unrest accumulation proportionally to ruler count
 *   - Colony types: STANDARD, AGRICULTURAL, INDUSTRIAL, RESEARCH, MILITARY, MOON
 *       Each type applies per-resource yield multipliers via setType().
 *       MOON colonies are restricted: max size 5, military buildings only.
 *   - Building types: FARM, MINE, FACTORY, LAB, BARRACKS, SPACEPORT, DARK_MATTER_MINE
 *   - Build queue with resource costs and build-time ticks
 *   - demolishBuilding(type) — removes one building, refunds 50% of its costs
 *   - Resource trade chains: Ore → Metal → Ship Parts
 *   - Hunger/Unrest escalation levels (0–1) with consequence callbacks
 *   - rename(newName) with a nameHistory log (array of { name, index } entries)
 *   - serialize() / deserialize() for save-game persistence
 *   - ColonySimulation.dissolve(id) — removes a colony, emits colony:dissolved
 *   - Invasion & Defense system:
 *       Colony.garrison — number of stationed ground troops (TROOP_DEFENSE_VALUE each)
 *       Colony.defensePower — stockpile.defence + garrison × TROOP_DEFENSE_VALUE
 *       Colony.garrisonTroops(n) / ungarrisonTroops(n)
 *       ColonySimulation.invade(colonyId, attackerTroops, opts?) → InvasionReport
 *         Outcomes: InvasionResult.SUCCESS / REPELLED / DRAW
 *         Constants: TROOP_ATTACK_VALUE, TROOP_DEFENSE_VALUE, DEFENSE_DPS_FACTOR,
 *                    MAX_INVASION_ROUNDS, INVASION_LOOT_FRACTION, INVASION_CONQUEST_PENALTIES
 *   - EventBus integration: emits 'colony:grow', 'colony:starve', 'colony:unrest',
 *       'colony:hunger:escalate', 'colony:unrest:escalate', 'colony:building:complete',
 *       'colony:dissolved', 'colony:invaded', 'colony:defended', 'colony:siege'
 *
 * Usage:
 *   const sim = new ColonySimulation(engine.events);
 *
 *   const ignis = sim.found({
 *     id:       'planet-ignis-prime',
 *     name:     'Ignis Prime',
 *     size:     12,          // max pop slots
 *     fertility: 0.8,        // food production modifier
 *     richness:  1.2,        // mineral/industry modifier
 *     startingPops: 3,
 *   });
 *
 *   ignis.setJobs({ FARMER: 1, WORKER: 1, SCIENTIST: 1 });
 *   ignis.enqueueBuilding(BuildingType.MINE);
 *
 *   // Each game turn:
 *   sim.tick(1);
 *
 *   // Persistence:
 *   const saved  = sim.serialize();
 *   const loaded = ColonySimulation.deserialize(saved, engine.events);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** @enum {string} Pop job types (Master of Orion / Stellaris inspiration) */
const PopJob = Object.freeze({
  FARMER:    'farmer',    // → food           (MoO: farmer)
  WORKER:    'worker',    // → production     (MoO: worker / Victoria 3: laborer)
  SCIENTIST: 'scientist', // → research       (MoO: scientist)
  SOLDIER:   'soldier',   // → defence        (MoO: marine)
  RULER:     'ruler',     // → governance     (Victoria 3: politician)
  UNEMPLOYED:'unemployed',// → negative happiness
});

/**
 * Base resource output per pop per turn.
 * Multiplied by colony modifiers (fertility, richness, stability).
 */
const BASE_YIELD = Object.freeze({
  [PopJob.FARMER]:     { food: 3,   production: 0, research: 0, credits: 0 },
  [PopJob.WORKER]:     { food: 0,   production: 4, research: 0, credits: 1 },
  [PopJob.SCIENTIST]:  { food: 0,   production: 0, research: 4, credits: 0 },
  [PopJob.SOLDIER]:    { food: 0,   production: 0, research: 0, credits: 0, defence: 3 },
  [PopJob.RULER]:      { food: 0,   production: 0, research: 1, credits: 3 },
  [PopJob.UNEMPLOYED]: { food: 0,   production: 0, research: 0, credits: 0 },
});

/** @enum {string} Building types */
const BuildingType = Object.freeze({
  FARM:             'farm',
  MINE:             'mine',
  FACTORY:          'factory',
  LAB:              'lab',
  BARRACKS:         'barracks',
  SPACEPORT:        'spaceport',
  /**
   * Dark Matter Mine — slow but steady dark-matter production.
   * Construction requires graviton_tech level 5 (enforced by caller).
   * @see BUILDING_COST.DARK_MATTER_MINE
   */
  DARK_MATTER_MINE: 'dark_matter_mine',
});

/** @enum {string} Colony specialisation types (Stellaris / ES2 inspiration) */
const ColonyType = Object.freeze({
  STANDARD:     'standard',     // balanced — no bonus or malus
  AGRICULTURAL: 'agricultural', // food ×1.5, production ×0.8
  INDUSTRIAL:   'industrial',   // production ×1.5, food ×0.8
  RESEARCH:     'research',     // research ×1.5, credits ×1.2
  MILITARY:     'military',     // defence ×2, production ×0.9
  MOON:         'moon',         // special: max size 5, military buildings only, defence ×1.5
});

/**
 * Per-resource yield multipliers for each colony type.
 * Applied in Colony.setType() and computeYield().
 * @type {Readonly<Record<string, Record<string, number>>>}
 */
const COLONY_TYPE_BONUS = Object.freeze({
  [ColonyType.STANDARD]:     { food: 1.0, production: 1.0, research: 1.0, credits: 1.0, defence: 1.0 },
  [ColonyType.AGRICULTURAL]: { food: 1.5, production: 0.8, research: 1.0, credits: 1.0, defence: 1.0 },
  [ColonyType.INDUSTRIAL]:   { food: 0.8, production: 1.5, research: 1.0, credits: 1.0, defence: 1.0 },
  [ColonyType.RESEARCH]:     { food: 1.0, production: 1.0, research: 1.5, credits: 1.2, defence: 1.0 },
  [ColonyType.MILITARY]:     { food: 1.0, production: 0.9, research: 1.0, credits: 1.0, defence: 2.0 },
  [ColonyType.MOON]:         { food: 0.5, production: 1.0, research: 1.0, credits: 1.0, defence: 1.5 },
});

/** Building types allowed on MOON colonies (military structures only). */
const MOON_ALLOWED_BUILDINGS = Object.freeze(new Set([
  BuildingType.BARRACKS,
  BuildingType.SPACEPORT,
  BuildingType.DARK_MATTER_MINE,
]));

/** Maximum pop slots for a MOON colony (smaller than a regular planet). */
const MOON_MAX_SIZE = 5;

/**
 * Build costs (resources deducted when enqueued) plus build-time in ticks.
 * @type {Readonly<Record<string, {buildTime: number, [resource: string]: number}>}
 */
const BUILDING_COST = Object.freeze({
  [BuildingType.FARM]:      { production: 20,              buildTime: 3  },
  [BuildingType.MINE]:      { production: 30,              buildTime: 4  },
  [BuildingType.FACTORY]:   { production: 50, ore: 10,     buildTime: 6  },
  [BuildingType.LAB]:       { production: 40, credits: 20, buildTime: 5  },
  [BuildingType.BARRACKS]:  { production: 35, credits: 10, buildTime: 4  },
  [BuildingType.SPACEPORT]: { production: 80, metal: 20,   buildTime: 10 },
  /** Requires graviton_tech level 5 — enforcement is the caller's responsibility */
  [BuildingType.DARK_MATTER_MINE]: { production: 100, credits: 50, buildTime: 15 },
});

/**
 * Passive resource yield per building per tick.
 * Applied in addition to pop-job yields.
 */
const BUILDING_YIELD = Object.freeze({
  [BuildingType.FARM]:      { food: 5 },
  [BuildingType.MINE]:      { ore: 4 },
  [BuildingType.LAB]:       { research: 5 },
  [BuildingType.BARRACKS]:  { defence: 4 },
  [BuildingType.SPACEPORT]: { credits: 8 },
  [BuildingType.DARK_MATTER_MINE]: { darkMatter: 1 },
  // FACTORY and SPACEPORT also participate in trade chains (see TRADE_CHAIN)
});

/**
 * Resource trade chains processed each tick.
 * Each entry converts `rate` units of `from` into `yieldAmt` units of `to`,
 * once per building of `building` type (limited by available stockpile).
 *
 * Chain: Ore → Metal (Factory) → Ship Parts (Spaceport)
 */
const TRADE_CHAIN = Object.freeze([
  { building: BuildingType.FACTORY,   from: 'ore',   rate: 2, to: 'metal',     yieldAmt: 1 },
  { building: BuildingType.SPACEPORT, from: 'metal', rate: 3, to: 'shipParts', yieldAmt: 1 },
]);

/** Hunger escalation thresholds (0–1). Stages: 0=fed, 1=mild, 2=moderate, 3=severe, 4=critical */
const HUNGER_THRESHOLDS = Object.freeze([0.25, 0.5, 0.75, 0.9]);

// ---------------------------------------------------------------------------
// Invasion & Defense constants / enums
// ---------------------------------------------------------------------------

/**
 * Each garrisoned troop contributes this amount to the colony's defensePower.
 * Troops are stationed ground forces (independent of SOLDIER pops).
 */
const TROOP_DEFENSE_VALUE = 50;

/**
 * Each attacking troop deals this amount of damage to the defender's defensePower
 * per invasion round (before simultaneous counter-damage is applied).
 */
const TROOP_ATTACK_VALUE = 15;

/**
 * Fraction of the current defenderPower converted to attacking-troop kills per round.
 * E.g. 0.20 means 20 % of the defender's strength kills attacking troops each round.
 * Each troop has 1 HP, so we floor the result to get whole troop casualties.
 */
const DEFENSE_DPS_FACTOR = 0.20;

/** Maximum invasion rounds before declaring a draw. */
const MAX_INVASION_ROUNDS = 5;

/**
 * Fraction of each stockpile resource looted on a successful invasion.
 * Defence stockpile is never looted (it is consumed defending).
 */
const INVASION_LOOT_FRACTION = 0.30;

/**
 * Post-invasion colony penalties applied to a conquered colony.
 * These represent the shock of occupation on the civilian population.
 */
const INVASION_CONQUEST_PENALTIES = Object.freeze({
  happiness:  0.3,   // happiness floors to this value
  unrest:     0.7,   // unrest spikes to this value
  stability:  0.4,   // stability floors to this value
});

/** @enum {string} Outcome of a ColonySimulation.invade() call. */
const InvasionResult = Object.freeze({
  SUCCESS:  'success',   // attacker captures the colony
  REPELLED: 'repelled',  // defenders hold; all attacking troops are eliminated
  DRAW:     'draw',      // neither side is eliminated within MAX_INVASION_ROUNDS
});

// ---------------------------------------------------------------------------
// InvasionReport
// ---------------------------------------------------------------------------

/**
 * Immutable result of a ColonySimulation.invade() call.
 *
 * Properties:
 *   result               — one of InvasionResult
 *   rounds               — number of rounds fought
 *   attackerTroopsBefore — troops sent by the attacker
 *   attackerTroopsAfter  — surviving attacker troops
 *   defenderPowerBefore  — colony defensePower at start
 *   defenderPowerAfter   — remaining defense power (0 on capture)
 *   loot                 — plain-object of looted resources (only on SUCCESS)
 */
class InvasionReport {
  /**
   * @param {Object} params
   * @param {string} params.result              InvasionResult
   * @param {number} params.rounds
   * @param {number} params.attackerTroopsBefore
   * @param {number} params.attackerTroopsAfter
   * @param {number} params.defenderPowerBefore
   * @param {number} params.defenderPowerAfter
   * @param {Object} params.loot                plain object { [resource]: amount }
   * @param {string} params.colonyId
   */
  constructor({ result, rounds, attackerTroopsBefore, attackerTroopsAfter,
                defenderPowerBefore, defenderPowerAfter, loot, colonyId }) {
    this.result               = result;
    this.rounds               = rounds;
    this.attackerTroopsBefore = attackerTroopsBefore;
    this.attackerTroopsAfter  = attackerTroopsAfter;
    this.attackerCasualties   = attackerTroopsBefore - attackerTroopsAfter;
    this.defenderPowerBefore  = defenderPowerBefore;
    this.defenderPowerAfter   = defenderPowerAfter;
    this.defenderPowerConsumed = defenderPowerBefore - defenderPowerAfter;
    /** Resources looted from the colony (only populated on InvasionResult.SUCCESS). */
    this.loot                 = loot;
    this.colonyId             = colonyId;
  }

  /**
   * Serialize to a plain JSON-compatible object.
   * @returns {Object}
   */
  serialize() {
    return {
      result:               this.result,
      rounds:               this.rounds,
      attackerTroopsBefore: this.attackerTroopsBefore,
      attackerTroopsAfter:  this.attackerTroopsAfter,
      attackerCasualties:   this.attackerCasualties,
      defenderPowerBefore:  this.defenderPowerBefore,
      defenderPowerAfter:   this.defenderPowerAfter,
      defenderPowerConsumed: this.defenderPowerConsumed,
      loot:                 { ...this.loot },
      colonyId:             this.colonyId,
    };
  }
}


/** Unrest escalation thresholds (0–1). Stages: 0=stable, 1=restless, 2=agitated, 3=rebellious, 4=revolt */
const UNREST_THRESHOLDS = Object.freeze([0.25, 0.5, 0.75, 0.9]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns which escalation stage [0..thresholds.length] a value falls into.
 * @param {number} value
 * @param {readonly number[]} thresholds  Ascending list of threshold values
 * @returns {number}
 */
function _escalationStage(value, thresholds) {
  let stage = 0;
  for (const t of thresholds) {
    if (value >= t) stage++;
    else break;
  }
  return stage;
}

// ---------------------------------------------------------------------------
// Colony
// ---------------------------------------------------------------------------

class Colony {
  /**
   * @param {Object} def
   * @param {string} def.id
   * @param {string} def.name
   * @param {number} def.size            Max pop slots (planet size 1–25)
   * @param {number} [def.fertility=1]   Food yield multiplier
   * @param {number} [def.richness=1]    Production/mineral multiplier
   * @param {number} [def.startingPops=1]
   * @param {string} [def.type]          One of ColonyType (default: STANDARD)
   */
  constructor(def) {
    this.id         = def.id;
    this.name       = def.name;
    this.size       = def.size       ?? 10;
    this.fertility  = def.fertility  ?? 1.0;
    this.richness   = def.richness   ?? 1.0;

    /** Colony specialisation type — affects per-resource yield multipliers. */
    this.type       = def.type ?? ColonyType.STANDARD;
    /** Cached per-resource multiplier derived from this.type. */
    this._typeMult  = { ...(COLONY_TYPE_BONUS[this.type] ?? COLONY_TYPE_BONUS[ColonyType.STANDARD]) };

    // MOON colonies have a hard size cap
    if (this.type === ColonyType.MOON) {
      this.size = Math.min(this.size, MOON_MAX_SIZE);
    }

    /** Total population */
    this.pops       = Math.min(def.startingPops ?? 1, this.size);
    /** Fractional pop accumulator for growth */
    this._growthAcc = 0;

    /** Job assignments: { FARMER: n, WORKER: n, … } */
    this.jobs = {
      [PopJob.FARMER]:     0,
      [PopJob.WORKER]:     0,
      [PopJob.SCIENTIST]:  0,
      [PopJob.SOLDIER]:    0,
      [PopJob.RULER]:      0,
      [PopJob.UNEMPLOYED]: def.startingPops ?? 1,
    };

    /** Stored resources (includes ore, metal, shipParts for trade chains; defence from soldiers/barracks; darkMatter from dark matter mines) */
    this.stockpile = { food: 10, production: 0, research: 0, credits: 0, ore: 0, metal: 0, shipParts: 0, defence: 0, darkMatter: 0 };

    /**
     * Garrisoned ground troops — permanent stationed units protecting this colony.
     * Independent of SOLDIER pops; each troop adds TROOP_DEFENSE_VALUE to defensePower.
     * Managed via garrisonTroops() / ungarrisonTroops().
     */
    this.garrison   = def.garrison ?? 0;

    /** Colony happiness [0–1] — affects yields */
    this.happiness  = 0.7;
    /** Colony stability [0–1] — affects unrest */
    this.stability  = 0.8;

    /** Accumulated unrest points [0–1] */
    this.unrest     = 0;
    /** Hunger level [0–1]; rises when food is scarce, falls when food is surplus */
    this.hunger     = 0;

    /** Internal escalation stage trackers (prevents repeated callbacks for same stage) */
    this._unrestStage = 0;
    this._hungerStage = 0;

    /** Completed buildings map: { [BuildingType]: count } */
    this.buildings  = Object.fromEntries(Object.values(BuildingType).map(t => [t, 0]));

    /**
     * Build queue: [{ type: BuildingType, remainingTicks: number }]
     * Items are processed each tick and move to buildings on completion.
     * @type {Array<{type: string, remainingTicks: number}>}
     */
    this.buildQueue = [];

    /**
     * History of past colony names.  Each rename prepends an entry.
     * Entries: { name: string, index: number } where index is 0-based rename count.
     * @type {Array<{name: string, index: number}>}
     */
    this.nameHistory = [];
    /** Running rename counter — incremented on each rename(). */
    this._renameCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Job assignment
  // ---------------------------------------------------------------------------

  /**
   * Set job allocations.  Unassigned pops become UNEMPLOYED.
   * @param {Partial<Record<PopJob, number>>} jobs
   */
  setJobs(jobs) {
    let assigned = 0;
    for (const job of Object.values(PopJob)) {
      if (job === PopJob.UNEMPLOYED) continue;
      this.jobs[job] = Math.max(0, Math.floor(jobs[job] ?? 0));
      assigned += this.jobs[job];
    }
    this.jobs[PopJob.UNEMPLOYED] = Math.max(0, this.pops - assigned);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Building queue
  // ---------------------------------------------------------------------------

  /**
   * Attempt to enqueue a building.  Deducts resource costs immediately.
   * @param {string} type  One of BuildingType
   * @returns {{ success: boolean, reason?: string }}
   */
  enqueueBuilding(type) {
    const cost = BUILDING_COST[type];
    if (!cost) throw new TypeError(`[Colony] Unknown building type: '${type}'`);

    // MOON colonies only allow military structures
    if (this.type === ColonyType.MOON && !MOON_ALLOWED_BUILDINGS.has(type)) {
      return { success: false, reason: 'not_allowed_on_moon' };
    }

    // Check affordability
    for (const [res, amt] of Object.entries(cost)) {
      if (res === 'buildTime') continue;
      if ((this.stockpile[res] ?? 0) < amt) {
        return { success: false, reason: `insufficient_${res}` };
      }
    }

    // Deduct costs
    for (const [res, amt] of Object.entries(cost)) {
      if (res === 'buildTime') continue;
      this.stockpile[res] = (this.stockpile[res] ?? 0) - amt;
    }

    this.buildQueue.push({ type, remainingTicks: cost.buildTime });
    return { success: true };
  }

  /**
   * Demolish one building of the given type.
   * Refunds 50% of its construction costs back to the stockpile.
   * @param {string} type  One of BuildingType
   * @returns {{ success: boolean, reason?: string, refund?: Object }}
   */
  demolishBuilding(type) {
    const cost = BUILDING_COST[type];
    if (!cost) throw new TypeError(`[Colony] Unknown building type: '${type}'`);

    if ((this.buildings[type] ?? 0) === 0) {
      return { success: false, reason: 'no_building' };
    }

    this.buildings[type]--;

    // Refund 50% of resource costs (excluding buildTime)
    const refund = {};
    for (const [res, amt] of Object.entries(cost)) {
      if (res === 'buildTime') continue;
      const returned = Math.floor(amt * 0.5);
      if (returned > 0) {
        this.stockpile[res] = (this.stockpile[res] ?? 0) + returned;
        refund[res] = returned;
      }
    }

    return { success: true, refund };
  }

  /**
   * Rename this colony, logging the previous name in nameHistory.
   * @param {string} newName
   */
  rename(newName) {
    if (typeof newName !== 'string' || newName.trim() === '') {
      throw new TypeError('[Colony] rename() requires a non-empty string');
    }
    this.nameHistory.push({ name: this.name, index: this._renameCount });
    this._renameCount++;
    this.name = newName.trim();
  }

  /**
   * Change the colony's specialisation type.
   * Updates the per-resource yield multiplier and enforces MOON size cap.
   * @param {string} type  One of ColonyType
   */
  setType(type) {
    if (!COLONY_TYPE_BONUS[type]) {
      throw new TypeError(`[Colony] Unknown colony type: '${type}'`);
    }
    this.type      = type;
    this._typeMult = { ...COLONY_TYPE_BONUS[type] };
    if (type === ColonyType.MOON) {
      this.size = Math.min(this.size, MOON_MAX_SIZE);
      // Clamp pops to new size cap
      if (this.pops > this.size) {
        this.pops = this.size;
        this.setJobs({});
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Garrison & Defense
  // ---------------------------------------------------------------------------

  /**
   * Effective defense power of this colony.
   * Combines accumulated defence stockpile (from SOLDIER pops + BARRACKS buildings)
   * with stationed garrison troops (each worth TROOP_DEFENSE_VALUE).
   * Colony type bonus (military/moon) is already baked into stockpile.defence via
   * the colony type multiplier applied during computeYield().
   * @returns {number}
   */
  get defensePower() {
    return Math.max(0, this.stockpile.defence) + this.garrison * TROOP_DEFENSE_VALUE;
  }

  /**
   * Station additional ground troops in this colony.
   * Costs are managed by the caller (e.g. deduct from a fleet or resource pool).
   * @param {number} n  Number of troops to add (must be ≥ 1)
   * @returns {Colony}  this, for chaining
   */
  garrisonTroops(n) {
    if (!Number.isFinite(n) || n < 1) throw new RangeError('[Colony] garrisonTroops() requires n ≥ 1');
    this.garrison += Math.floor(n);
    return this;
  }

  /**
   * Withdraw ground troops from this colony.
   * @param {number} n  Number of troops to remove
   * @returns {number}  Actual number of troops removed (≤ n, capped by garrison size)
   */
  ungarrisonTroops(n) {
    if (!Number.isFinite(n) || n < 1) throw new RangeError('[Colony] ungarrisonTroops() requires n ≥ 1');
    const removed  = Math.min(this.garrison, Math.floor(n));
    this.garrison -= removed;
    return removed;
  }


  /**
   * Compute total resource output for one turn (before stockpile update).
   * Colony type multipliers (via _typeMult) are applied after pop calculations.
   * @returns {{ food, production, research, credits, defence }}
   */
  computeYield() {
    const stability  = this.stability;
    const mult       = this._typeMult;
    const out        = { food: 0, production: 0, research: 0, credits: 0, defence: 0 };

    for (const [job, count] of Object.entries(this.jobs)) {
      if (count === 0) continue;
      const base = BASE_YIELD[job];
      out.food       += (base.food       ?? 0) * count * this.fertility;
      out.production += (base.production ?? 0) * count * this.richness;
      out.research   += (base.research   ?? 0) * count;
      out.credits    += (base.credits    ?? 0) * count;
      out.defence    += (base.defence    ?? 0) * count;
    }

    // Stability modifier on all productive output
    out.production *= stability;
    out.research   *= stability;
    out.credits    *= stability;

    // Colony type multipliers
    out.food       *= (mult.food       ?? 1);
    out.production *= (mult.production ?? 1);
    out.research   *= (mult.research   ?? 1);
    out.credits    *= (mult.credits    ?? 1);
    out.defence    *= (mult.defence    ?? 1);

    return out;
  }

  // ---------------------------------------------------------------------------
  // Internal: tick helpers
  // ---------------------------------------------------------------------------

  _applyYield(dt) {
    const y = this.computeYield();
    this.stockpile.food       += y.food       * dt;
    this.stockpile.production += y.production * dt;
    this.stockpile.research   += y.research   * dt;
    this.stockpile.credits    += y.credits    * dt;
    this.stockpile.defence    += y.defence    * dt;
  }

  /** Apply passive resource yield from completed buildings. */
  _applyBuildingYields(dt) {
    for (const [type, count] of Object.entries(this.buildings)) {
      if (count === 0) continue;
      const yields = BUILDING_YIELD[type];
      if (!yields) continue;
      for (const [res, amt] of Object.entries(yields)) {
        this.stockpile[res] = (this.stockpile[res] ?? 0) + amt * count * dt;
      }
    }
  }

  /**
   * Process resource trade chains (Ore → Metal → Ship Parts).
   * Each factory converts up to 2 ore → 1 metal per tick;
   * each spaceport converts up to 3 metal → 1 ship part per tick.
   */
  _applyTradeChains(dt) {
    for (const chain of TRADE_CHAIN) {
      const count = this.buildings[chain.building] ?? 0;
      if (count === 0) continue;

      const inputNeeded = chain.rate * count * dt;
      const inputAvail  = this.stockpile[chain.from] ?? 0;
      const actual      = Math.min(inputNeeded, inputAvail);
      if (actual <= 0) continue;

      this.stockpile[chain.from] -= actual;
      this.stockpile[chain.to]    = (this.stockpile[chain.to] ?? 0) + (actual / chain.rate) * chain.yieldAmt;
    }
  }

  _applyConsumption(dt) {
    // Each pop consumes 1 food per turn
    this.stockpile.food -= this.pops * dt;
  }

  _applyGrowth(dt, onGrow, onStarve) {
    const foodSurplus = this.stockpile.food;
    const capacity    = this.size;

    if (foodSurplus < 0) {
      // Starvation — lose pop
      this._growthAcc -= 0.2 * dt;
      if (this._growthAcc <= -1 && this.pops > 1) {
        this.pops--;
        this._growthAcc = 0;
        this.stockpile.food = 0;
        onStarve(this);
      }
    } else if (this.pops < capacity) {
      // Logistic growth: faster when below half capacity, surplus food speeds it up
      const relPop    = this.pops / capacity;
      const growthRate = 0.02 * (1 - relPop) * (1 + Math.min(foodSurplus / 20, 2));
      this._growthAcc += growthRate * dt;
      if (this._growthAcc >= 1) {
        this.pops++;
        this._growthAcc = 0;
        // Re-assign unemployed pops
        this.jobs[PopJob.UNEMPLOYED]++;
        onGrow(this);
      }
    }
  }

  /**
   * Update hunger level (0–1) based on food stockpile.
   * Fires escalation callback when crossing thresholds upward.
   * @param {number} dt
   * @param {function(Colony, string, number): void} [onEscalate]
   */
  _applyHunger(dt, onEscalate) {
    if (this.stockpile.food < 0) {
      this.hunger = Math.min(1, this.hunger + 0.05 * dt);
    } else {
      this.hunger = Math.max(0, this.hunger - 0.02 * dt);
    }

    const newStage = _escalationStage(this.hunger, HUNGER_THRESHOLDS);
    if (newStage > this._hungerStage) {
      onEscalate?.(this, 'hunger', newStage);
    }
    this._hungerStage = newStage;
  }

  /**
   * Update unrest level (0–1) based on unemployment and stability.
   * RULER pops provide a governance bonus that reduces unrest accumulation
   * proportionally to their share of the population.
   * Fires escalation callback when crossing thresholds upward.
   * @param {function(Colony, string, number): void} [onEscalate]
   */
  _applyUnrest(onEscalate) {
    const unemployedRatio = (this.jobs[PopJob.UNEMPLOYED] ?? 0) / Math.max(1, this.pops);
    // Rulers dampen unrest accumulation (governance bonus).
    // At 15%+ ruler population (rulerRatio ≥ 0.15), rulers provide the maximum 75% reduction.
    // The multiplier of 5 maps: rulerRatio * 5 reaches 0.75 at rulerRatio = 0.15.
    const rulerRatio = (this.jobs[PopJob.RULER] ?? 0) / Math.max(1, this.pops);
    const governanceBonus = 1 - Math.min(0.75, rulerRatio * 5);
    this.unrest += unemployedRatio * 0.01 * (1 - this.stability) * governanceBonus;
    this.unrest  = Math.max(0, Math.min(1, this.unrest - 0.005 * this.happiness));
    if (this.unrest > 0.9) this.stability = Math.max(0, this.stability - 0.01);
    else this.stability = Math.min(1, this.stability + 0.001);

    const newStage = _escalationStage(this.unrest, UNREST_THRESHOLDS);
    if (newStage > this._unrestStage) {
      onEscalate?.(this, 'unrest', newStage);
    }
    this._unrestStage = newStage;
  }

  /**
   * Advance the build queue by dt ticks.  Completed buildings are added to
   * this.buildings and returned as an array.
   * @param {number} dt
   * @returns {Array<{type: string, remainingTicks: number}>} Completed items
   */
  _processBuildQueue(dt) {
    const completed = [];
    for (const item of this.buildQueue) {
      item.remainingTicks -= dt;
      if (item.remainingTicks <= 0) {
        completed.push(item);
        this.buildings[item.type] = (this.buildings[item.type] ?? 0) + 1;
      }
    }
    if (completed.length > 0) {
      this.buildQueue = this.buildQueue.filter(b => b.remainingTicks > 0);
    }
    return completed;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Serialize this colony to a plain JSON-compatible object.
   * @returns {Object}
   */
  serialize() {
    return {
      id:           this.id,
      name:         this.name,
      size:         this.size,
      fertility:    this.fertility,
      richness:     this.richness,
      pops:         this.pops,
      _growthAcc:   this._growthAcc,
      jobs:         { ...this.jobs },
      stockpile:    { ...this.stockpile },
      happiness:    this.happiness,
      stability:    this.stability,
      unrest:       this.unrest,
      hunger:       this.hunger,
      _unrestStage: this._unrestStage,
      _hungerStage: this._hungerStage,
      buildings:    { ...this.buildings },
      buildQueue:   this.buildQueue.map(b => ({ ...b })),
      nameHistory:  this.nameHistory.map(e => ({ ...e })),
      _renameCount: this._renameCount,
      type:         this.type,
      garrison:     this.garrison,
    };
  }

  /**
   * Reconstruct a Colony from a serialized object produced by serialize().
   * @param {Object} json
   * @returns {Colony}
   */
  static deserialize(json) {
    const colony = new Colony({
      id:           json.id,
      name:         json.name,
      size:         json.size,
      fertility:    json.fertility,
      richness:     json.richness,
      startingPops: 0,
      type:         json.type ?? ColonyType.STANDARD,
    });
    colony.pops         = json.pops         ?? 1;
    colony._growthAcc   = json._growthAcc   ?? 0;
    colony.jobs         = { ...json.jobs };
    colony.stockpile    = { ...json.stockpile };
    colony.happiness    = json.happiness    ?? 0.7;
    colony.stability    = json.stability    ?? 0.8;
    colony.unrest       = json.unrest       ?? 0;
    colony.hunger       = json.hunger       ?? 0;
    colony._unrestStage = json._unrestStage ?? 0;
    colony._hungerStage = json._hungerStage ?? 0;
    colony.buildings    = { ...json.buildings };
    colony.buildQueue   = (json.buildQueue ?? []).map(b => ({ ...b }));
    colony.nameHistory  = (json.nameHistory ?? []).map(e => ({ ...e }));
    colony._renameCount = json._renameCount ?? 0;
    colony.garrison     = json.garrison     ?? 0;
    return colony;
  }
}

// ---------------------------------------------------------------------------
// ColonySimulation
// ---------------------------------------------------------------------------

class ColonySimulation {
  /**
   * @param {import('../EventBus').EventBus} [bus]
   */
  constructor(bus) {
    this._bus     = bus ?? null;
    /** @type {Map<string, Colony>} */
    this._colonies = new Map();
  }

  /**
   * Found (create) a new colony.
   * @param {Object} def  Colony definition (see Colony constructor)
   * @returns {Colony}
   */
  found(def) {
    const colony = new Colony(def);
    this._colonies.set(def.id, colony);
    return colony;
  }

  /** @returns {Colony|undefined} */
  get(id) { return this._colonies.get(id); }

  /** @returns {Colony[]} */
  all() { return [...this._colonies.values()]; }

  get count() { return this._colonies.size; }

  /**
   * Dissolve (remove) a colony from the simulation.
   * The dissolved colony is returned so callers can inspect its final state.
   * Emits `colony:dissolved` on the bus if the colony existed.
   * @param {string} id
   * @returns {Colony|undefined}  The removed colony, or undefined if not found.
   */
  dissolve(id) {
    const colony = this._colonies.get(id);
    if (!colony) return undefined;
    this._colonies.delete(id);
    this._bus?.emit('colony:dissolved', { colony, id });
    return colony;
  }

  /**
   * Attempt to invade a colony with a given number of attacking troops.
   *
   * Combat model (round-based, simultaneous fire — inspired by OGame ground combat):
   *   Each round:
   *     - Attacker deals  `currentTroops × TROOP_ATTACK_VALUE` damage to defenderPower.
   *     - Defender deals  `floor(currentDefense × DEFENSE_DPS_FACTOR)` troop casualties.
   *     - Both values are computed from round-start state (simultaneous fire).
   *   Rounds continue until:
   *     a) defenderPower ≤ 0 and troops > 0 → SUCCESS (colony captured)
   *     b) troops ≤ 0 and defenderPower > 0 → REPELLED (defenders hold)
   *     c) MAX_INVASION_ROUNDS reached with both sides surviving → DRAW
   *
   * On SUCCESS:
   *   - INVASION_LOOT_FRACTION (30 %) of each stockpile resource is returned in the report.
   *   - Colony garrison is reset to 0.
   *   - Colony defence stockpile is set to 0.
   *   - Colony happiness, unrest, stability are set to INVASION_CONQUEST_PENALTIES values.
   *   - Emits `colony:invaded`.
   *
   * On REPELLED:
   *   - Colony defence stockpile is reduced by the damage taken.
   *   - Emits `colony:defended`.
   *
   * On DRAW:
   *   - Colony defence stockpile is reduced by the damage taken.
   *   - Emits `colony:siege`.
   *
   * @param {string} colonyId         Target colony id
   * @param {number} attackerTroops   Number of ground troops (positive integer)
   * @param {Object} [opts]
   * @param {number} [opts.maxRounds]  Override MAX_INVASION_ROUNDS
   * @returns {InvasionReport}
   */
  invade(colonyId, attackerTroops, opts = {}) {
    const colony = this._colonies.get(colonyId);
    if (!colony) throw new RangeError(`[ColonySimulation] Colony not found: '${colonyId}'`);

    const troops = Math.floor(attackerTroops);
    if (!Number.isFinite(troops) || troops < 1) {
      throw new RangeError('[ColonySimulation] invade() requires attackerTroops ≥ 1');
    }

    const maxRounds = opts.maxRounds ?? MAX_INVASION_ROUNDS;

    const defenderPowerBefore = colony.defensePower;
    let currentTroops  = troops;
    let currentDefense = defenderPowerBefore;
    let rounds = 0;

    // Round-based combat loop
    while (rounds < maxRounds && currentTroops > 0 && currentDefense > 0) {
      // Simultaneous fire: both sides use round-START values
      const dmgToDefense = currentTroops * TROOP_ATTACK_VALUE;
      const troopKills   = Math.floor(currentDefense * DEFENSE_DPS_FACTOR);

      currentDefense = Math.max(0, currentDefense - dmgToDefense);
      currentTroops  = Math.max(0, currentTroops  - troopKills);
      rounds++;
    }

    const attackerTroopsAfter = currentTroops;
    const defenderPowerAfter  = Math.max(0, currentDefense);

    // Determine outcome
    let result;
    if (currentDefense <= 0 && currentTroops > 0) {
      result = InvasionResult.SUCCESS;
    } else if (currentTroops <= 0) {
      result = InvasionResult.REPELLED;
    } else {
      result = InvasionResult.DRAW;
    }

    // Loot (only on success)
    const loot = {};
    if (result === InvasionResult.SUCCESS) {
      const SKIP = new Set(['defence']);
      for (const [res, amt] of Object.entries(colony.stockpile)) {
        if (SKIP.has(res) || amt <= 0) continue;
        const taken = amt * INVASION_LOOT_FRACTION;
        loot[res] = taken;
        colony.stockpile[res] -= taken;
      }
    }

    // Apply colony state mutations
    if (result === InvasionResult.SUCCESS) {
      colony.garrison         = 0;
      colony.stockpile.defence = 0;
      colony.happiness        = Math.min(colony.happiness, INVASION_CONQUEST_PENALTIES.happiness);
      colony.unrest           = Math.max(colony.unrest,   INVASION_CONQUEST_PENALTIES.unrest);
      colony.stability        = Math.min(colony.stability, INVASION_CONQUEST_PENALTIES.stability);
    } else {
      // Partial defense damage regardless of outcome
      const defenseConsumed = defenderPowerBefore - defenderPowerAfter;
      // Reduce garrison first, then overflow into stockpile.defence
      const garrisonDamage = Math.min(colony.garrison * TROOP_DEFENSE_VALUE, defenseConsumed);
      const garrisonLost   = Math.min(colony.garrison, Math.ceil(garrisonDamage / TROOP_DEFENSE_VALUE));
      colony.garrison     -= garrisonLost;
      const stockpileDamage = defenseConsumed - garrisonLost * TROOP_DEFENSE_VALUE;
      colony.stockpile.defence = Math.max(0, colony.stockpile.defence - stockpileDamage);
    }

    const report = new InvasionReport({
      result,
      rounds,
      attackerTroopsBefore: troops,
      attackerTroopsAfter,
      defenderPowerBefore,
      defenderPowerAfter,
      loot,
      colonyId,
    });

    // Emit event
    if (result === InvasionResult.SUCCESS) {
      this._bus?.emit('colony:invaded',  { colony, id: colonyId, report });
    } else if (result === InvasionResult.REPELLED) {
      this._bus?.emit('colony:defended', { colony, id: colonyId, report });
    } else {
      this._bus?.emit('colony:siege',    { colony, id: colonyId, report });
    }

    return report;
  }

  /**
   * Simulate all colonies for dt turns.
   * @param {number} [dt=1]  In-game turns
   */
  tick(dt = 1) {
    for (const colony of this._colonies.values()) {
      colony._applyYield(dt);
      colony._applyBuildingYields(dt);
      colony._applyTradeChains(dt);

      colony._applyConsumption(dt);
      colony._applyGrowth(
        dt,
        (c) => this._bus?.emit('colony:grow',   { colony: c, id: c.id }),
        (c) => this._bus?.emit('colony:starve',  { colony: c, id: c.id }),
      );
      colony._applyHunger(
        dt,
        (c, type, stage) => this._bus?.emit(`colony:${type}:escalate`, { colony: c, id: c.id, stage }),
      );
      colony._applyUnrest(
        (c, type, stage) => this._bus?.emit(`colony:${type}:escalate`, { colony: c, id: c.id, stage }),
      );
      const completed = colony._processBuildQueue(dt);
      for (const b of completed) {
        this._bus?.emit('colony:building:complete', { colony, id: colony.id, building: b.type });
      }
      if (colony.unrest > 0.75) {
        this._bus?.emit('colony:unrest', { colony, id: colony.id, unrest: colony.unrest });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Serialize the full simulation state to a JSON-compatible object.
   * @returns {Object}
   */
  serialize() {
    return {
      colonies: this.all().map(c => c.serialize()),
    };
  }

  /**
   * Reconstruct a ColonySimulation from a serialized snapshot.
   * @param {Object} json
   * @param {import('../EventBus').EventBus} [bus]
   * @returns {ColonySimulation}
   */
  static deserialize(json, bus) {
    const sim = new ColonySimulation(bus);
    for (const colData of json.colonies) {
      const colony = Colony.deserialize(colData);
      sim._colonies.set(colony.id, colony);
    }
    return sim;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ColonySimulation, Colony, PopJob, BASE_YIELD,
    BuildingType, BUILDING_COST, BUILDING_YIELD, TRADE_CHAIN,
    HUNGER_THRESHOLDS, UNREST_THRESHOLDS,
    ColonyType, COLONY_TYPE_BONUS, MOON_ALLOWED_BUILDINGS, MOON_MAX_SIZE,
    InvasionResult, InvasionReport,
    TROOP_DEFENSE_VALUE, TROOP_ATTACK_VALUE, DEFENSE_DPS_FACTOR,
    MAX_INVASION_ROUNDS, INVASION_LOOT_FRACTION, INVASION_CONQUEST_PENALTIES,
  };
} else {
  window.GQColonySimulation = {
    ColonySimulation, Colony, PopJob, BASE_YIELD,
    BuildingType, BUILDING_COST, BUILDING_YIELD, TRADE_CHAIN,
    HUNGER_THRESHOLDS, UNREST_THRESHOLDS,
    ColonyType, COLONY_TYPE_BONUS, MOON_ALLOWED_BUILDINGS, MOON_MAX_SIZE,
    InvasionResult, InvasionReport,
    TROOP_DEFENSE_VALUE, TROOP_ATTACK_VALUE, DEFENSE_DPS_FACTOR,
    MAX_INVASION_ROUNDS, INVASION_LOOT_FRACTION, INVASION_CONQUEST_PENALTIES,
  };
}
