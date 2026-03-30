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
 *   - Resource production per pop type per turn
 *   - Pop growth formula (logistic + food surplus)
 *   - Colony happiness / stability affecting productivity
 *   - EventBus integration: emits 'colony:grow', 'colony:starve', 'colony:unrest'
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

    /** Stored resources */
    this.stockpile = { food: 10, production: 0, research: 0, credits: 0 };

    /** Colony happiness [0–1] — affects yields */
    this.happiness  = 0.7;
    /** Colony stability [0–1] — affects unrest */
    this.stability  = 0.8;

    /** Accumulated unrest points */
    this.unrest     = 0;
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
  module.exports = { ColonySimulation, Colony, PopJob, BASE_YIELD };
} else {
  window.GQColonySimulation = { ColonySimulation, Colony, PopJob, BASE_YIELD };
}
