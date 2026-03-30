/**
 * BattleSimulator.js — Deterministic fleet combat resolver
 *
 * Inspired by:
 *   OGame          (Gameforge, 2002)      — round-based combat, rapid fire, shield regen
 *   Master of Orion (SimTex, 1993)        — ship classes, targeting, fleet tech levels
 *   Stellaris      (Paradox, 2016)        — fleet power score, combat computers
 *   Endless Space 2 (Amplitude, 2017)    — lane-based simultaneous fire
 *
 * Provides:
 *   - ShipClass enum (8 types: FIGHTER → CARRIER)
 *   - SHIP_STATS: per-type attack / shield / hull / rapidFire table
 *   - SHIP_METAL_VALUE: loot calculation reference prices
 *   - BattleFleet: user-facing fleet composition { [ShipClass]: count }
 *       .power  — single fleet-strength number for UI comparison
 *   - BattleReport: immutable battle summary returned by simulate()
 *       .winner / .rounds / .attackerLosses / .defenderLosses / .loot
 *   - BattleSimulator.simulate(attacker, defender, opts) — runs up to MAX_ROUNDS
 *       Combat is deterministic: damage is distributed proportionally across enemy ship
 *       groups, so the same inputs always produce the same BattleReport.
 *   - Rapid-fire mechanic: SHIP_STATS[type].rapidFire maps target type → fire count.
 *       e.g. fighter.rapidFire.bomber = 3 means fighters fire 3× against each bomber.
 *   - Shield regen: after each round shields recover 50 % of their per-ship maximum.
 *   - Simultaneous fire: both sides' round-start state is used for damage calculation;
 *       deaths are applied after all damage is tallied.
 *
 * Usage:
 *   import { BattleFleet, BattleSimulator, ShipClass } from './BattleSimulator.js';
 *
 *   const attacker = new BattleFleet({
 *     [ShipClass.FIGHTER]:   100,
 *     [ShipClass.DESTROYER]:  10,
 *   });
 *   const defender = new BattleFleet({
 *     [ShipClass.CRUISER]:    5,
 *     [ShipClass.BATTLESHIP]: 2,
 *   });
 *
 *   const report = BattleSimulator.simulate(attacker, defender);
 *   console.log(report.winner);       // 'attacker' | 'defender' | 'draw'
 *   console.log(report.loot);         // estimated metal value of 50 % of defender losses
 *   console.log(report.rounds);       // rounds fought (≤ MAX_ROUNDS = 6)
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** @enum {string} Ship classes ordered roughly by size/cost */
const ShipClass = Object.freeze({
  FIGHTER:    'fighter',
  BOMBER:     'bomber',
  CORVETTE:   'corvette',
  FRIGATE:    'frigate',
  DESTROYER:  'destroyer',
  CRUISER:    'cruiser',
  BATTLESHIP: 'battleship',
  CARRIER:    'carrier',
});

/**
 * Base combat stats for each ship class.
 *
 * rapidFire: { [targetType]: n } — this ship fires n times against the given target type
 * per round instead of once.  Values represent the expected number of shots per round.
 *
 * @type {Readonly<Record<string, { attack: number, shield: number, hull: number,
 *                                  rapidFire: Record<string, number> }>>}
 */
const SHIP_STATS = Object.freeze({
  [ShipClass.FIGHTER]:    { attack:     50, shield:     10, hull:     400, rapidFire: { bomber: 3 } },
  [ShipClass.BOMBER]:     { attack:    600, shield:     25, hull:   1_500, rapidFire: { destroyer: 5, battleship: 10, carrier: 5 } },
  [ShipClass.CORVETTE]:   { attack:    300, shield:    100, hull:   2_000, rapidFire: {} },
  [ShipClass.FRIGATE]:    { attack:    800, shield:    200, hull:   5_000, rapidFire: { fighter: 5, corvette: 3 } },
  [ShipClass.DESTROYER]:  { attack:  2_000, shield:    500, hull:  15_000, rapidFire: { fighter: 10, corvette: 5, frigate: 3 } },
  [ShipClass.CRUISER]:    { attack:  8_000, shield:  1_500, hull:  50_000, rapidFire: { fighter: 20, bomber: 10, corvette: 15, frigate: 8 } },
  [ShipClass.BATTLESHIP]: { attack: 25_000, shield:  5_000, hull: 150_000, rapidFire: { fighter: 30, bomber: 20, corvette: 25, frigate: 15, destroyer: 5 } },
  [ShipClass.CARRIER]:    { attack:  2_500, shield:  4_000, hull: 200_000, rapidFire: {} },
});

/**
 * Approximate metal-equivalent construction value per ship.
 * Used to calculate loot (50 % of defender losses' total value).
 * @type {Readonly<Record<string, number>>}
 */
const SHIP_METAL_VALUE = Object.freeze({
  [ShipClass.FIGHTER]:      1_000,
  [ShipClass.BOMBER]:       5_000,
  [ShipClass.CORVETTE]:     3_000,
  [ShipClass.FRIGATE]:      9_000,
  [ShipClass.DESTROYER]:   20_000,
  [ShipClass.CRUISER]:     80_000,
  [ShipClass.BATTLESHIP]: 250_000,
  [ShipClass.CARRIER]:    300_000,
});

// ---------------------------------------------------------------------------
// Internal: _FleetGroup
// ---------------------------------------------------------------------------

/**
 * Mutable aggregate group used during simulation.
 * Tracks a single ship type's remaining count and pooled health.
 * @private
 */
class _FleetGroup {
  /**
   * @param {string} shipType  One of ShipClass
   * @param {number} count     Initial ship count (must be > 0)
   */
  constructor(shipType, count) {
    const stats = SHIP_STATS[shipType];
    if (!stats) throw new TypeError(`[BattleSimulator] Unknown ship type: '${shipType}'`);
    if (count <= 0) throw new RangeError(`[BattleSimulator] Ship count must be > 0`);

    this.shipType = shipType;
    this.count    = count;
    this.stats    = stats;

    /** Per-ship maximums (used for regen and hull-to-count conversion) */
    this._maxShieldPerShip = stats.shield;
    this._maxHullPerShip   = stats.hull;

    /** Pooled aggregate health */
    this.currentShield = stats.shield * count;
    this.currentHull   = stats.hull   * count;
  }

  get isEmpty() { return this.count <= 0; }

  /**
   * Apply incoming damage to this group (shield absorbs first, then hull).
   * Updates this.count based on remaining hull pool.
   * @param {number} rawDamage
   */
  applyDamage(rawDamage) {
    if (rawDamage <= 0 || this.count <= 0) return;

    // Shield absorbs first
    const shieldAbsorbed   = Math.min(rawDamage, this.currentShield);
    this.currentShield    -= shieldAbsorbed;
    const hullDamage       = rawDamage - shieldAbsorbed;
    this.currentHull      -= hullDamage;
    if (this.currentHull < 0) this.currentHull = 0;

    // Derive surviving ship count from remaining hull pool
    this.count = Math.ceil(this.currentHull / this._maxHullPerShip);

    // Shield pool cannot exceed surviving ships' maximum
    const maxShieldNow = this._maxShieldPerShip * this.count;
    if (this.currentShield > maxShieldNow) this.currentShield = maxShieldNow;
  }

  /**
   * Regenerate shields by 50 % of surviving ships' maximum (OGame-style).
   * Called after each round.
   */
  regenShield() {
    const maxShield   = this._maxShieldPerShip * this.count;
    this.currentShield = Math.min(maxShield, this.currentShield + maxShield * 0.5);
  }
}

// ---------------------------------------------------------------------------
// BattleFleet
// ---------------------------------------------------------------------------

/**
 * Immutable fleet composition used as input/output for BattleSimulator.
 *
 * @example
 *   const fleet = new BattleFleet({ fighter: 200, cruiser: 5 });
 *   console.log(fleet.power);  // fleet-strength score
 */
class BattleFleet {
  /**
   * @param {Partial<Record<string, number>>} ships  { [ShipClass]: count }
   */
  constructor(ships = {}) {
    /** @type {Record<string, number>} */
    this._ships = {};
    for (const [type, count] of Object.entries(ships)) {
      if (!SHIP_STATS[type]) throw new TypeError(`[BattleFleet] Unknown ship type: '${type}'`);
      const n = Math.floor(count);
      if (n > 0) this._ships[type] = n;
    }
  }

  /** Returns true if this fleet has no ships. */
  get isEmpty() { return Object.keys(this._ships).length === 0; }

  /** Total number of ships across all types. */
  get totalCount() {
    return Object.values(this._ships).reduce((s, c) => s + c, 0);
  }

  /**
   * A single fleet-power score suitable for pre-battle comparison.
   * Formula: sum of (attack + shield + hull × 0.01) × count across all types.
   * @returns {number}
   */
  get power() {
    let p = 0;
    for (const [type, count] of Object.entries(this._ships)) {
      const s = SHIP_STATS[type];
      p += (s.attack + s.shield + s.hull * 0.01) * count;
    }
    return Math.round(p);
  }

  /**
   * How many ships of the given type are in this fleet.
   * @param {string} type  ShipClass
   * @returns {number}
   */
  countOf(type) { return this._ships[type] ?? 0; }

  /**
   * Returns a plain-object copy of the ship composition.
   * @returns {Record<string, number>}
   */
  toPlainObject() { return { ...this._ships }; }

  /**
   * Convert to internal mutable groups for simulation.
   * @returns {_FleetGroup[]}
   * @package
   */
  _toGroups() {
    return Object.entries(this._ships)
      .filter(([, c]) => c > 0)
      .map(([type, count]) => new _FleetGroup(type, count));
  }

  /**
   * Reconstruct a BattleFleet from an array of _FleetGroups.
   * @param {_FleetGroup[]} groups
   * @returns {BattleFleet}
   * @package
   */
  static _fromGroups(groups) {
    const ships = {};
    for (const g of groups) {
      if (g.count > 0) ships[g.shipType] = g.count;
    }
    return new BattleFleet(ships);
  }
}

// ---------------------------------------------------------------------------
// BattleReport
// ---------------------------------------------------------------------------

/**
 * Immutable result of a BattleSimulator.simulate() call.
 */
class BattleReport {
  /**
   * @param {Object} params
   * @param {'attacker'|'defender'|'draw'} params.winner
   * @param {number}      params.rounds
   * @param {BattleFleet} params.attackerStart
   * @param {BattleFleet} params.defenderStart
   * @param {BattleFleet} params.attackerRemaining
   * @param {BattleFleet} params.defenderRemaining
   */
  constructor({ winner, rounds, attackerStart, defenderStart, attackerRemaining, defenderRemaining }) {
    /** @type {'attacker'|'defender'|'draw'} */
    this.winner             = winner;
    /** @type {number} Number of rounds fought */
    this.rounds             = rounds;
    /** @type {BattleFleet} */
    this.attackerStart      = attackerStart;
    /** @type {BattleFleet} */
    this.defenderStart      = defenderStart;
    /** @type {BattleFleet} */
    this.attackerRemaining  = attackerRemaining;
    /** @type {BattleFleet} */
    this.defenderRemaining  = defenderRemaining;

    /** Ships lost by the attacker: { [shipType]: count } */
    this.attackerLosses     = _calcLosses(attackerStart, attackerRemaining);
    /** Ships lost by the defender: { [shipType]: count } */
    this.defenderLosses     = _calcLosses(defenderStart, defenderRemaining);

    /**
     * Loot estimate: 50 % of the metal value of the defender's destroyed ships.
     * @type {number}
     */
    this.loot               = _calcLoot(this.defenderLosses);
  }

  /**
   * Serialize to a plain JSON-compatible object.
   * @returns {Object}
   */
  serialize() {
    return {
      winner:             this.winner,
      rounds:             this.rounds,
      attackerStart:      this.attackerStart.toPlainObject(),
      defenderStart:      this.defenderStart.toPlainObject(),
      attackerRemaining:  this.attackerRemaining.toPlainObject(),
      defenderRemaining:  this.defenderRemaining.toPlainObject(),
      attackerLosses:     { ...this.attackerLosses },
      defenderLosses:     { ...this.defenderLosses },
      loot:               this.loot,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Calculate losses between a starting fleet and its remaining fleet.
 * @param {BattleFleet} start
 * @param {BattleFleet} remaining
 * @returns {Record<string, number>}
 */
function _calcLosses(start, remaining) {
  const losses = {};
  for (const [type, count] of Object.entries(start._ships)) {
    const rem  = remaining._ships[type] ?? 0;
    const lost = count - rem;
    if (lost > 0) losses[type] = lost;
  }
  return losses;
}

/**
 * Estimate loot as 50 % of the metal value of destroyed ships.
 * @param {Record<string, number>} losses
 * @returns {number}
 */
function _calcLoot(losses) {
  let total = 0;
  for (const [type, count] of Object.entries(losses)) {
    total += (SHIP_METAL_VALUE[type] ?? 0) * count;
  }
  return Math.floor(total * 0.5);
}

/**
 * Execute one round of combat between two fleets (simultaneous fire).
 *
 * Damage model:
 *   For each attacker group A and each defender group D:
 *     damageFromAtoD = A.count × A.attack × rapidFire(A,D) × (D.count / defenderTotal)
 *   This distributes A's fire proportionally across all defender groups.
 *   Both sides' damage is computed from round-start state, then applied simultaneously.
 *   Shields regenerate at end of round.
 *
 * @param {_FleetGroup[]} attGroups  Mutated in-place
 * @param {_FleetGroup[]} defGroups  Mutated in-place
 */
function _simulateRound(attGroups, defGroups) {
  const attTotal = attGroups.reduce((s, g) => s + g.count, 0);
  const defTotal = defGroups.reduce((s, g) => s + g.count, 0);
  if (attTotal <= 0 || defTotal <= 0) return;

  // Pending damage arrays computed from round-start state (simultaneous fire)
  const defPending = new Array(defGroups.length).fill(0);
  const attPending = new Array(attGroups.length).fill(0);

  // Attacker → defender
  for (const ag of attGroups) {
    if (ag.count <= 0) continue;
    for (let di = 0; di < defGroups.length; di++) {
      const dg = defGroups[di];
      if (dg.count <= 0) continue;
      const targetFrac  = dg.count / defTotal;
      const rapidFactor = ag.stats.rapidFire[dg.shipType] ?? 1;
      defPending[di] += ag.count * ag.stats.attack * rapidFactor * targetFrac;
    }
  }

  // Defender → attacker
  for (const dg of defGroups) {
    if (dg.count <= 0) continue;
    for (let ai = 0; ai < attGroups.length; ai++) {
      const ag = attGroups[ai];
      if (ag.count <= 0) continue;
      const targetFrac  = ag.count / attTotal;
      const rapidFactor = dg.stats.rapidFire[ag.shipType] ?? 1;
      attPending[ai] += dg.count * dg.stats.attack * rapidFactor * targetFrac;
    }
  }

  // Apply damage simultaneously
  for (let i = 0; i < defGroups.length; i++) defGroups[i].applyDamage(defPending[i]);
  for (let i = 0; i < attGroups.length; i++) attGroups[i].applyDamage(attPending[i]);

  // Shield regeneration (50 % of surviving ships' maximum)
  for (const g of attGroups) g.regenShield();
  for (const g of defGroups) g.regenShield();
}

// ---------------------------------------------------------------------------
// BattleSimulator
// ---------------------------------------------------------------------------

class BattleSimulator {
  /**
   * Maximum number of rounds before declaring a draw.
   * OGame uses 6 rounds; we match this default.
   * @type {number}
   */
  static MAX_ROUNDS = 6;

  /**
   * Simulate combat between two fleets and return a deterministic BattleReport.
   *
   * The simulation is fully deterministic: the same inputs always produce the same output.
   * Damage is distributed proportionally across ship groups, so large fleet compositions
   * are handled efficiently without per-unit iteration.
   *
   * @param {BattleFleet} attacker
   * @param {BattleFleet} defender
   * @param {Object}  [opts]
   * @param {number}  [opts.maxRounds]  Override the default MAX_ROUNDS (default: 6)
   * @returns {BattleReport}
   */
  static simulate(attacker, defender, opts = {}) {
    if (attacker.isEmpty) throw new RangeError('[BattleSimulator] Attacker fleet is empty');
    if (defender.isEmpty) throw new RangeError('[BattleSimulator] Defender fleet is empty');

    const maxRounds = opts.maxRounds ?? BattleSimulator.MAX_ROUNDS;

    const attGroups = attacker._toGroups();
    const defGroups = defender._toGroups();

    let round = 0;
    while (round < maxRounds) {
      const attAlive = attGroups.some(g => g.count > 0);
      const defAlive = defGroups.some(g => g.count > 0);
      if (!attAlive || !defAlive) break;

      _simulateRound(attGroups, defGroups);
      round++;
    }

    const attRemaining = BattleFleet._fromGroups(attGroups);
    const defRemaining = BattleFleet._fromGroups(defGroups);

    const attAlive = !attRemaining.isEmpty;
    const defAlive = !defRemaining.isEmpty;

    let winner;
    if (attAlive && !defAlive)       winner = 'attacker';
    else if (defAlive && !attAlive)  winner = 'defender';
    else                             winner = 'draw';  // both survive, or both wiped

    return new BattleReport({
      winner,
      rounds: round,
      attackerStart:     attacker,
      defenderStart:     defender,
      attackerRemaining: attRemaining,
      defenderRemaining: defRemaining,
    });
  }

  /**
   * Return a single fleet-power number for pre-battle comparison display.
   * @param {BattleFleet} fleet
   * @returns {number}
   */
  static fleetPower(fleet) { return fleet.power; }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BattleSimulator, BattleFleet, BattleReport,
    ShipClass, SHIP_STATS, SHIP_METAL_VALUE,
  };
} else {
  window.GQBattleSimulator = {
    BattleSimulator, BattleFleet, BattleReport,
    ShipClass, SHIP_STATS, SHIP_METAL_VALUE,
  };
}
