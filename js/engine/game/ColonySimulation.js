/**
 * ColonySimulation.js  — Colony Pop & Resource Simulation
 *
 * Inspired by:
 *   Victoria 3        (Paradox, 2022)  — Pop growth, needs, jobs, goods
 *   Master of Orion   (SimTex, 1993)   — Farmer/Worker/Scientist allocation
 *   Stellaris         (Paradox, 2016)  — Planetary districts + pop jobs
 *   Endless Space 2   (Amplitude, 2017) — FIDS (Food, Industry, Dust, Science)
 *
 * Provides:
 *   - A Colony data model with Pops (population units)
 *   - Pop job types: FARMER, WORKER, SCIENTIST, SOLDIER, RULER
 *   - Resource production per pop type per turn (including accumulated defence)
 *   - Pop growth formula (logistic + food surplus)
 *   - Colony happiness / stability affecting productivity
 *   - RULER governance: reduces unrest accumulation proportionally to ruler count
 *   - Building types: FARM, MINE, FACTORY, LAB, BARRACKS, SPACEPORT
 *   - Build queue with resource costs and build-time ticks
 *   - demolishBuilding(type) — removes one building, refunds 50% of its costs
 *   - Resource trade chains: Ore → Metal → Ship Parts
 *   - Hunger/Unrest escalation levels (0–1) with consequence callbacks
 *   - rename(newName) with a nameHistory log (array of { name, index } entries)
 *   - serialize() / deserialize() for save-game persistence
 *   - EventBus integration: emits 'colony:grow', 'colony:starve', 'colony:unrest',
 *       'colony:hunger:escalate', 'colony:unrest:escalate', 'colony:building:complete'
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
  FARM:      'farm',
  MINE:      'mine',
  FACTORY:   'factory',
  LAB:       'lab',
  BARRACKS:  'barracks',
  SPACEPORT: 'spaceport',
});

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
   */
  constructor(def) {
    this.id         = def.id;
    this.name       = def.name;
    this.size       = def.size       ?? 10;
    this.fertility  = def.fertility  ?? 1.0;
    this.richness   = def.richness   ?? 1.0;

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

    /** Stored resources (includes ore, metal, shipParts for trade chains; defence from soldiers/barracks) */
    this.stockpile = { food: 10, production: 0, research: 0, credits: 0, ore: 0, metal: 0, shipParts: 0, defence: 0 };

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

  // ---------------------------------------------------------------------------
  // Production
  // ---------------------------------------------------------------------------

  /**
   * Compute total resource output for one turn (before stockpile update).
   * @returns {{ food, production, research, credits, defence }}
   */
  computeYield() {
    const stability  = this.stability;
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
  };
} else {
  window.GQColonySimulation = {
    ColonySimulation, Colony, PopJob, BASE_YIELD,
    BuildingType, BUILDING_COST, BUILDING_YIELD, TRADE_CHAIN,
    HUNGER_THRESHOLDS, UNREST_THRESHOLDS,
  };
}
