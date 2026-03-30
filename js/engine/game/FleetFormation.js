/**
 * FleetFormation.js  — Fleet Formation & Wing System
 *
 * Inspired by:
 *   X4: Foundations  (Egosoft, 2018)     — wing assignments, formation flying
 *   Homeworld        (Relic, 1999)        — 3D tactical formation system
 *   Endless Space 2  (Amplitude, 2017)   — card-based fleet battle lanes
 *   Elite Dangerous  (Frontier, 2014)    — wing mechanics, comms
 *
 * Provides:
 *   - Formation shapes (line, wedge, sphere, delta, column, custom)
 *   - Wing concept: a named group of ships that fly together
 *   - Slot-based positioning relative to a wing leader
 *   - Position recalculation each frame (integrates with SpacePhysicsEngine)
 *   - Cohesion force: ships drift toward their slot position
 *
 * Usage:
 *   const formations = new FleetFormation();
 *
 *   const wing = formations.createWing('Alpha Wing', 'wedge', {
 *     spacing: 80,
 *     leader: myLeaderShip,
 *   });
 *   wing.add(ship1);
 *   wing.add(ship2);
 *   wing.add(ship3);
 *
 *   // Each frame:
 *   formations.update(dt);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** @enum {string} */
const FormationShape = Object.freeze({
  LINE:    'line',    // Ships in a horizontal line behind leader
  WEDGE:   'wedge',  // V-shape (X4 default attack formation)
  SPHERE:  'sphere', // 3D sphere around leader (Homeworld defensive)
  DELTA:   'delta',  // Triangle
  COLUMN:  'column', // Single file behind leader
  ESCORT:  'escort', // Tight box around a VIP ship
  CUSTOM:  'custom', // User-supplied slot offsets
});

// ---------------------------------------------------------------------------
// Wing
// ---------------------------------------------------------------------------

class Wing {
  /**
   * @param {string} name
   * @param {string} shape  FormationShape
   * @param {Object} opts
   * @param {number} [opts.spacing=100]  Distance between slots
   * @param {{ position:{x,y,z}, velocity:{x,y,z} }} [opts.leader]  Leader ship
   * @param {number} [opts.cohesion=0.05]  Spring force toward slot [0–1]
   * @param {Array<{x,y,z}>} [opts.customSlots]  For FormationShape.CUSTOM
   */
  constructor(name, shape, opts = {}) {
    this.name      = name;
    this.shape     = shape;
    this.spacing   = opts.spacing   ?? 100;
    this.cohesion  = opts.cohesion  ?? 0.05;
    this.leader    = opts.leader    ?? null;
    this.enabled   = true;

    /** @type {Array<{ ship: Object, slotIndex: number }>} */
    this._members  = [];
    this._customSlots = opts.customSlots ?? [];
  }

  // ---------------------------------------------------------------------------
  // Membership
  // ---------------------------------------------------------------------------

  /** @param {{ position:{x,y,z}, velocity:{x,y,z} }} ship */
  add(ship) {
    const slotIndex = this._members.length; // next available slot
    this._members.push({ ship, slotIndex });
    return this;
  }

  /** @param {{ position:{x,y,z} }} ship */
  remove(ship) {
    const idx = this._members.findIndex((m) => m.ship === ship);
    if (idx !== -1) {
      this._members.splice(idx, 1);
      // Re-number slots
      this._members.forEach((m, i) => { m.slotIndex = i; });
    }
    return this;
  }

  get size() { return this._members.length; }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * Apply cohesion forces toward formation slots.
   * Designed to be called by FleetFormation.update() each frame.
   *
   * @param {number} dt  Delta time in seconds
   */
  update(dt) {
    if (!this.leader || !this.enabled || this._members.length === 0) return;

    const lp = this.leader.position;
    const lv = this.leader.velocity ?? { x: 0, y: 0, z: 0 };

    for (const { ship, slotIndex } of this._members) {
      const slot   = this._slotPosition(slotIndex, lp, lv);
      const sp     = ship.position;
      const sv     = ship.velocity ?? { x: 0, y: 0, z: 0 };

      // Spring force toward slot (simple proportional control)
      const dx = slot.x - sp.x;
      const dy = slot.y - sp.y;
      const dz = slot.z - sp.z;

      const k = this.cohesion;
      if (ship.velocity) {
        ship.velocity.x = sv.x + dx * k;
        ship.velocity.y = sv.y + dy * k;
        ship.velocity.z = sv.z + dz * k;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Slot computation
  // ---------------------------------------------------------------------------

  /**
   * @param {number} slotIndex
   * @param {{ x,y,z }} leaderPos
   * @param {{ x,y,z }} leaderVel
   * @returns {{ x,y,z }}
   */
  _slotPosition(slotIndex, leaderPos, leaderVel) {
    const s = this.spacing;
    let dx = 0, dy = 0, dz = 0;

    switch (this.shape) {
      case FormationShape.LINE: {
        // All ships to the right of the leader in a horizontal line
        dx = (slotIndex + 1) * s;
        break;
      }
      case FormationShape.COLUMN: {
        // Single file behind leader
        dz = (slotIndex + 1) * s;
        break;
      }
      case FormationShape.WEDGE: {
        // V-shape: alternating left/right behind leader
        const side  = slotIndex % 2 === 0 ? 1 : -1;
        const row   = Math.floor(slotIndex / 2) + 1;
        dx = side  * row * s * 0.8;
        dz = row   * s;
        break;
      }
      case FormationShape.DELTA: {
        // Triangle: row 0 = 1 ship, row 1 = 2 ships, etc.
        const row  = Math.floor(Math.sqrt(slotIndex + 1));
        const col  = slotIndex - row * row;
        dx = (col - row / 2) * s;
        dz = row * s;
        break;
      }
      case FormationShape.SPHERE: {
        // Distribute on a sphere of radius spacing
        // Fibonacci sphere sampling
        const golden = Math.PI * (3 - Math.sqrt(5));
        const y2     = 1 - (slotIndex / Math.max(1, this._members.length - 1)) * 2;
        const r      = Math.sqrt(1 - y2 * y2) * s;
        const theta  = golden * slotIndex;
        dx = Math.cos(theta) * r;
        dy = y2 * s;
        dz = Math.sin(theta) * r;
        break;
      }
      case FormationShape.ESCORT: {
        // Tight box: front-left, front-right, rear-left, rear-right, then second layer
        const positions = [
          [-0.6 * s, 0,  0.6 * s],
          [ 0.6 * s, 0,  0.6 * s],
          [-0.6 * s, 0, -0.6 * s],
          [ 0.6 * s, 0, -0.6 * s],
          [-1.0 * s, 0,  0],
          [ 1.0 * s, 0,  0],
          [0, 0.8 * s,  0],
          [0, -0.8 * s, 0],
        ];
        const p = positions[slotIndex % positions.length];
        dx = p[0]; dy = p[1]; dz = p[2];
        break;
      }
      case FormationShape.CUSTOM: {
        const cp = this._customSlots[slotIndex];
        if (cp) { dx = cp.x ?? 0; dy = cp.y ?? 0; dz = cp.z ?? 0; }
        break;
      }
    }

    return { x: leaderPos.x + dx, y: leaderPos.y + dy, z: leaderPos.z + dz };
  }
}

// ---------------------------------------------------------------------------
// FleetFormation — registry for multiple wings
// ---------------------------------------------------------------------------

class FleetFormation {
  constructor() {
    /** @type {Map<string, Wing>} */
    this._wings = new Map();
  }

  /**
   * Create and register a new wing.
   * @param {string} name
   * @param {string} [shape]  FormationShape
   * @param {Object} [opts]
   * @returns {Wing}
   */
  createWing(name, shape = FormationShape.WEDGE, opts = {}) {
    const wing = new Wing(name, shape, opts);
    this._wings.set(name, wing);
    return wing;
  }

  removeWing(name) { this._wings.delete(name); }

  getWing(name) { return this._wings.get(name) ?? null; }

  /** Update all enabled wings. */
  update(dt) {
    for (const wing of this._wings.values()) {
      wing.update(dt);
    }
  }

  get wingCount() { return this._wings.size; }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FleetFormation, Wing, FormationShape };
} else {
  window.GQFleetFormation = { FleetFormation, Wing, FormationShape };
}
