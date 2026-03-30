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
 *   - ColonyType enum with per-type yield/happiness bonuses
 *   - Resource production per pop type per turn
 *   - Pop growth formula (logistic + food surplus)
 *   - Colony happiness / stability affecting productivity
 *   - Serialise / restore (save-game support)
 *   - EventBus integration: emits 'colony:grow', 'colony:starve', 'colony:unrest', 'colony:type_changed'
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
 *
 *   // Each game turn:
 *   sim.tick(1);
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

// ---------------------------------------------------------------------------
// Colony types & bonuses
// ---------------------------------------------------------------------------

/**
 * Colony specialisation types.
 * Mirrors the backend `colony_type` column (see api/buildings.php, FUTURE_ENHANCEMENTS §2.7).
 * @enum {string}
 */
const ColonyType = Object.freeze({
  MINING:       'mining',       // +20% richness multiplier
  AGRICULTURAL: 'agricultural', // +30% fertility, +0.15 happiness
  RESEARCH:     'research',     // +25% research output
  INDUSTRIAL:   'industrial',   // +20% production output
  MILITARY:     'military',     // +20% defence output, +0.05 stability
  BALANCED:     'balanced',     // no modifiers (default)
});

/**
 * Per-type additive/multiplicative bonuses applied by Colony.setType().
 * Each entry: { fertilityBonus, richnessBonus, researchMult, productionMult, defenceMult, happinessBonus, stabilityBonus }
 */
const COLONY_TYPE_BONUS = Object.freeze({
  [ColonyType.MINING]:       { fertilityBonus: 0,    richnessBonus: 0.20, researchMult: 1,    productionMult: 1,    defenceMult: 1,    happinessBonus: 0,    stabilityBonus: 0 },
  [ColonyType.AGRICULTURAL]: { fertilityBonus: 0.30, richnessBonus: 0,    researchMult: 1,    productionMult: 1,    defenceMult: 1,    happinessBonus: 0.15, stabilityBonus: 0 },
  [ColonyType.RESEARCH]:     { fertilityBonus: 0,    richnessBonus: 0,    researchMult: 1.25, productionMult: 1,    defenceMult: 1,    happinessBonus: 0,    stabilityBonus: 0 },
  [ColonyType.INDUSTRIAL]:   { fertilityBonus: 0,    richnessBonus: 0,    researchMult: 1,    productionMult: 1.20, defenceMult: 1,    happinessBonus: 0,    stabilityBonus: 0 },
  [ColonyType.MILITARY]:     { fertilityBonus: 0,    richnessBonus: 0,    researchMult: 1,    productionMult: 1,    defenceMult: 1.20, happinessBonus: 0,    stabilityBonus: 0.05 },
  [ColonyType.BALANCED]:     { fertilityBonus: 0,    richnessBonus: 0,    researchMult: 1,    productionMult: 1,    defenceMult: 1,    happinessBonus: 0,    stabilityBonus: 0 },
});

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
   * @param {string} [def.type]          ColonyType (default BALANCED)
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

    /** Stored resources */
    this.stockpile = { food: 10, production: 0, research: 0, credits: 0 };

    /** Colony happiness [0–1] — affects yields */
    this.happiness  = 0.7;
    /** Colony stability [0–1] — affects unrest */
    this.stability  = 0.8;

    /** Accumulated unrest points */
    this.unrest     = 0;

    /** Active colony type (@see ColonyType) */
    this._type      = ColonyType.BALANCED;
    /** Type-derived multipliers (recomputed by setType) */
    this._typeMult  = { researchMult: 1, productionMult: 1, defenceMult: 1 };

    if (def.type && def.type !== ColonyType.BALANCED) {
      // Apply without bus (no bus available in constructor)
      this._applyType(def.type);
    }
  }

  /** @returns {string} ColonyType */
  get type() { return this._type; }

  // ---------------------------------------------------------------------------
  // Colony type
  // ---------------------------------------------------------------------------

  /**
   * Change the colony specialisation, applying bonuses to fertility, richness,
   * happiness and stability.  Emits 'colony:type_changed' on the provided bus.
   *
   * @param {string} type   ColonyType value
   * @param {import('../EventBus').EventBus} [bus]
   */
  setType(type, bus) {
    if (!COLONY_TYPE_BONUS[type]) {
      console.warn(`[Colony] Unknown colony type: '${type}'`);
      return this;
    }
    const prev = this._type;
    this._applyType(type);
    bus?.emit('colony:type_changed', { id: this.id, prev, type });
    return this;
  }

  /** @private */
  _applyType(type) {
    const b = COLONY_TYPE_BONUS[type];
    this.fertility  = Math.max(0, this.fertility  + b.fertilityBonus);
    this.richness   = Math.max(0, this.richness   + b.richnessBonus);
    this.happiness  = Math.min(1, this.happiness  + b.happinessBonus);
    this.stability  = Math.min(1, this.stability  + b.stabilityBonus);
    this._typeMult  = { researchMult: b.researchMult, productionMult: b.productionMult, defenceMult: b.defenceMult };
    this._type      = type;
  }

  // ---------------------------------------------------------------------------
  // Save / restore
  // ---------------------------------------------------------------------------

  /**
   * Return a plain-object snapshot suitable for JSON serialisation.
   * @returns {Object}
   */
  serialize() {
    return {
      id:         this.id,
      name:       this.name,
      size:       this.size,
      fertility:  this.fertility,
      richness:   this.richness,
      pops:       this.pops,
      _growthAcc: this._growthAcc,
      jobs:       { ...this.jobs },
      stockpile:  { ...this.stockpile },
      happiness:  this.happiness,
      stability:  this.stability,
      unrest:     this.unrest,
      type:       this._type,
    };
  }

  /**
   * Restore a Colony from a snapshot produced by `serialize()`.
   * @param {Object} snap
   * @returns {Colony}
   */
  static fromSnapshot(snap) {
    const c         = new Colony({ id: snap.id, name: snap.name, size: snap.size,
                                   fertility: snap.fertility, richness: snap.richness,
                                   startingPops: snap.pops });
    c.pops          = snap.pops;
    c._growthAcc    = snap._growthAcc ?? 0;
    c.jobs          = { ...snap.jobs };
    c.stockpile     = { ...snap.stockpile };
    c.happiness     = snap.happiness;
    c.stability     = snap.stability;
    c.unrest        = snap.unrest;
    if (snap.type && snap.type !== ColonyType.BALANCED) {
      // The snapshot already contains post-bonus fertility/richness/happiness/stability values.
      // Restore only the yield multipliers (_typeMult) and type tag — do NOT call _applyType()
      // again, which would stack the additive bonuses a second time.
      const b = COLONY_TYPE_BONUS[snap.type];
      c._typeMult = { researchMult: b.researchMult, productionMult: b.productionMult, defenceMult: b.defenceMult };
      c._type     = snap.type;
    }
    return c;
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
  // Production
  // ---------------------------------------------------------------------------

  /**
   * Compute total resource output for one turn (before stockpile update).
   * @returns {{ food, production, research, credits, defence }}
   */
  computeYield() {
    const stability  = this.stability;
    const tm         = this._typeMult;
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

    // Colony-type multipliers
    out.production *= tm.productionMult;
    out.research   *= tm.researchMult;
    out.defence    *= tm.defenceMult;

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

  _applyUnrest() {
    const unemployedRatio = (this.jobs[PopJob.UNEMPLOYED] ?? 0) / Math.max(1, this.pops);
    this.unrest += unemployedRatio * 0.01 * (1 - this.stability);
    this.unrest  = Math.max(0, Math.min(1, this.unrest - 0.005 * this.happiness));
    if (this.unrest > 0.9) this.stability = Math.max(0, this.stability - 0.01);
    else this.stability = Math.min(1, this.stability + 0.001);
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
   * Remove and return a colony from the simulation.
   * No-ops (returns undefined) if the id is unknown.
   * @param {string} id
   * @returns {Colony|undefined}
   */
  dissolve(id) {
    const colony = this._colonies.get(id);
    if (!colony) return undefined;
    this._colonies.delete(id);
    return colony;
  }

  /**
   * Serialise all colonies to an array of plain objects.
   * @returns {Object[]}
   */
  serialize() {
    return [...this._colonies.values()].map((c) => c.serialize());
  }

  /**
   * Restore a ColonySimulation from a snapshot array (e.g. loaded from disk).
   * @param {Object[]} snapshots
   * @param {import('../EventBus').EventBus} [bus]
   * @returns {ColonySimulation}
   */
  static fromSnapshot(snapshots, bus) {
    const sim = new ColonySimulation(bus);
    for (const snap of snapshots) {
      const colony = Colony.fromSnapshot(snap);
      sim._colonies.set(colony.id, colony);
    }
    return sim;
  }

  /**
   * Simulate all colonies for dt turns.
   * @param {number} [dt=1]  In-game turns
   */
  tick(dt = 1) {
    for (const colony of this._colonies.values()) {
      colony._applyYield(dt);
      colony._applyConsumption(dt);
      colony._applyGrowth(
        dt,
        (c) => this._bus?.emit('colony:grow',   { colony: c, id: c.id }),
        (c) => this._bus?.emit('colony:starve',  { colony: c, id: c.id }),
      );
      colony._applyUnrest();
      if (colony.unrest > 0.75) {
        this._bus?.emit('colony:unrest', { colony, id: colony.id, unrest: colony.unrest });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ColonySimulation, Colony, PopJob, BASE_YIELD, ColonyType, COLONY_TYPE_BONUS };
} else {
  window.GQColonySimulation = { ColonySimulation, Colony, PopJob, BASE_YIELD, ColonyType, COLONY_TYPE_BONUS };
}
