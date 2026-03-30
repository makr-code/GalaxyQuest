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

/**
 * Named combat-maneuver sequences.
 * Each maneuver is a pre-defined series of formation transitions.
 * @enum {string}
 */
const Maneuver = Object.freeze({
  PINCER:   'pincer',   // Envelope enemy: WEDGE → DELTA → ESCORT
  RETREAT:  'retreat',  // Fall back in good order: current → COLUMN
  FLANKING: 'flanking', // Swing to attack from the side: LINE → WEDGE
});

// ---------------------------------------------------------------------------
// Pure slot-position helpers (no class state required — easy to unit-test)
// ---------------------------------------------------------------------------

/**
 * Compute a single slot offset (relative to the formation leader) for the
 * given formation shape.
 *
 * @param {string} shape       FormationShape
 * @param {number} slotIndex   0-based index of this slot
 * @param {number} memberCount Total number of members in the wing
 * @param {number} spacing     Distance between slots
 * @param {Array<{x,y,z}>} [customSlots]  Used only for CUSTOM shape
 * @returns {{ x:number, y:number, z:number }}
 */
function _computeSlotOffset(shape, slotIndex, memberCount, spacing, customSlots = []) {
  const s = spacing;
  let dx = 0, dy = 0, dz = 0;

  switch (shape) {
    case FormationShape.LINE: {
      dx = (slotIndex + 1) * s;
      break;
    }
    case FormationShape.COLUMN: {
      dz = (slotIndex + 1) * s;
      break;
    }
    case FormationShape.WEDGE: {
      const side = slotIndex % 2 === 0 ? 1 : -1;
      const row  = Math.floor(slotIndex / 2) + 1;
      dx = side * row * s * 0.8;
      dz = row  * s;
      break;
    }
    case FormationShape.DELTA: {
      const row = Math.floor(Math.sqrt(slotIndex + 1));
      const col = slotIndex - row * row;
      dx = (col - row / 2) * s;
      dz = row * s;
      break;
    }
    case FormationShape.SPHERE: {
      const golden = Math.PI * (3 - Math.sqrt(5));
      const y2     = 1 - (slotIndex / Math.max(1, memberCount - 1)) * 2;
      const r      = Math.sqrt(1 - y2 * y2) * s;
      const theta  = golden * slotIndex;
      dx = Math.cos(theta) * r;
      dy = y2 * s;
      dz = Math.sin(theta) * r;
      break;
    }
    case FormationShape.ESCORT: {
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
      const cp = customSlots[slotIndex];
      if (cp) { dx = cp.x ?? 0; dy = cp.y ?? 0; dz = cp.z ?? 0; }
      break;
    }
  }

  return { x: dx, y: dy, z: dz };
}

/**
 * Pure function: compute all slot positions (relative to the origin) for a
 * given formation shape and ship count.  Useful for UI previews and tests.
 *
 * @param {string} formation  FormationShape
 * @param {number} shipCount
 * @param {number} [spacing=100]
 * @returns {Array<{x:number, y:number, z:number}>}
 */
function getSlotPositions(formation, shipCount, spacing = 100) {
  const positions = [];
  for (let i = 0; i < shipCount; i++) {
    positions.push(_computeSlotOffset(formation, i, shipCount, spacing));
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Wing
// ---------------------------------------------------------------------------

class Wing {
  /**
   * @param {string} name
   * @param {string} shape  FormationShape
   * @param {Object} opts
   * @param {number} [opts.spacing=100]          Distance between slots
   * @param {{ position:{x,y,z}, velocity:{x,y,z} }} [opts.leader]  Leader ship
   * @param {number} [opts.cohesionStrength=0.05] Spring constant toward slot [0–1]
   * @param {number} [opts.cohesion=0.05]         Alias for cohesionStrength (legacy)
   * @param {number} [opts.dampening=0]           Velocity damping factor [0–1]
   * @param {Array<{x,y,z}>} [opts.customSlots]  For FormationShape.CUSTOM
   */
  constructor(name, shape, opts = {}) {
    this.name    = name;
    this.shape   = shape;
    this.spacing = opts.spacing ?? 100;
    // Spring-damper cohesion model (issue requirement).
    // Accept both `cohesionStrength` (new) and `cohesion` (legacy alias).
    this.cohesionStrength = opts.cohesionStrength ?? opts.cohesion ?? 0.05;
    this.dampening        = opts.dampening ?? 0;
    this.leader  = opts.leader ?? null;
    this.enabled = true;

    /** @type {Array<{ ship: Object, slotIndex: number }>} */
    this._members     = [];
    this._customSlots = opts.customSlots ?? [];

    // Formation-transition state
    /** @type {Array<{x,y,z}>|null} slot offsets captured from previous shape */
    this._transitionFromOffsets   = null;
    this._transitionFramesTotal   = 0;
    this._transitionFramesCurrent = 0;

    // Maneuver queue: [{shape, frames}, ...]
    this._maneuverQueue = [];
  }

  // ---------------------------------------------------------------------------
  // Membership
  // ---------------------------------------------------------------------------

  /** @param {{ position:{x,y,z}, velocity:{x,y,z} }} ship */
  add(ship) {
    const slotIndex = this._members.length;
    this._members.push({ ship, slotIndex });
    return this;
  }

  /** @param {{ position:{x,y,z} }} ship */
  remove(ship) {
    const idx = this._members.findIndex((m) => m.ship === ship);
    if (idx !== -1) {
      this._members.splice(idx, 1);
      this._members.forEach((m, i) => { m.slotIndex = i; });
    }
    return this;
  }

  get size() { return this._members.length; }

  // ---------------------------------------------------------------------------
  // Formation transitions
  // ---------------------------------------------------------------------------

  /**
   * Switch to a new formation shape, optionally transitioning over N frames.
   * During the transition, slot positions are linearly interpolated between
   * the old and new offsets.
   *
   * @param {string} shape           FormationShape
   * @param {number} [transitionFrames=0]  0 = instant switch
   * @returns {this}
   */
  setFormation(shape, transitionFrames = 0) {
    if (transitionFrames > 0 && this._members.length > 0) {
      const n = this._members.length;
      // Snapshot slot offsets from the CURRENT shape before we switch.
      this._transitionFromOffsets = this._members.map((_, i) =>
        _computeSlotOffset(this.shape, i, n, this.spacing, this._customSlots),
      );
      this._transitionFramesTotal   = transitionFrames;
      this._transitionFramesCurrent = 0;
    }
    this.shape = shape;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Maneuvers
  // ---------------------------------------------------------------------------

  /**
   * Execute a named combat maneuver — a pre-defined sequence of formation
   * transitions.  Each step uses `framesPerTransition` frames to interpolate.
   *
   * @param {string} maneuver          Maneuver enum value
   * @param {number} [framesPerTransition=30]
   * @returns {this}
   */
  startManeuver(maneuver, framesPerTransition = 30) {
    const SEQUENCES = {
      [Maneuver.PINCER]:   [FormationShape.WEDGE, FormationShape.DELTA, FormationShape.ESCORT],
      [Maneuver.RETREAT]:  [FormationShape.COLUMN],
      [Maneuver.FLANKING]: [FormationShape.LINE, FormationShape.WEDGE],
    };
    const seq = SEQUENCES[maneuver];
    if (!seq) { console.warn(`[Wing] Unknown maneuver: '${maneuver}'`); return this; }
    this._maneuverQueue = seq.map((shape) => ({ shape, frames: framesPerTransition }));
    this._advanceManeuver();
    return this;
  }

  /** @private */
  _advanceManeuver() {
    if (this._maneuverQueue.length === 0) return;
    const { shape, frames } = this._maneuverQueue.shift();
    this.setFormation(shape, frames);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * Apply spring-damper cohesion forces toward formation slots, with optional
   * transition interpolation.  Call once per frame.
   *
   * Cohesion model:
   *   velocity += displacement × cohesionStrength − velocity × dampening
   *
   * @param {number} dt  Delta time in seconds (kept for future integration)
   */
  update(dt) {
    if (!this.leader || !this.enabled || this._members.length === 0) return;

    const lp = this.leader.position;
    const n  = this._members.length;

    // Compute interpolation factor and advance transition counter
    let interpT = 1;
    if (this._transitionFramesTotal > 0) {
      interpT = this._transitionFramesCurrent / this._transitionFramesTotal;
      this._transitionFramesCurrent++;
      if (this._transitionFramesCurrent >= this._transitionFramesTotal) {
        this._transitionFromOffsets   = null;
        this._transitionFramesTotal   = 0;
        this._transitionFramesCurrent = 0;
        interpT = 1;
        if (this._maneuverQueue.length > 0) this._advanceManeuver();
      }
    }

    for (const { ship, slotIndex } of this._members) {
      let offset = _computeSlotOffset(this.shape, slotIndex, n, this.spacing, this._customSlots);

      // Interpolate between old and new offsets during a transition
      if (this._transitionFromOffsets && slotIndex < this._transitionFromOffsets.length) {
        const fromOff = this._transitionFromOffsets[slotIndex];
        offset = {
          x: fromOff.x + (offset.x - fromOff.x) * interpT,
          y: fromOff.y + (offset.y - fromOff.y) * interpT,
          z: fromOff.z + (offset.z - fromOff.z) * interpT,
        };
      }

      const slot = { x: lp.x + offset.x, y: lp.y + offset.y, z: lp.z + offset.z };
      const sp   = ship.position;
      const sv   = ship.velocity ?? { x: 0, y: 0, z: 0 };

      const dx = slot.x - sp.x;
      const dy = slot.y - sp.y;
      const dz = slot.z - sp.z;

      const k = this.cohesionStrength;
      const b = this.dampening;

      if (ship.velocity) {
        ship.velocity.x = sv.x + dx * k - sv.x * b;
        ship.velocity.y = sv.y + dy * k - sv.y * b;
        ship.velocity.z = sv.z + dz * k - sv.z * b;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Slot computation
  // ---------------------------------------------------------------------------

  /**
   * Compute the world-space slot position for a given slot index.
   * Delegates to the pure `_computeSlotOffset` helper.
   *
   * @param {number} slotIndex
   * @param {{ x,y,z }} leaderPos
   * @param {{ x,y,z }} leaderVel  (unused currently, kept for API parity)
   * @returns {{ x,y,z }}
   */
  _slotPosition(slotIndex, leaderPos, leaderVel) {
    const offset = _computeSlotOffset(
      this.shape, slotIndex, this._members.length, this.spacing, this._customSlots,
    );
    return { x: leaderPos.x + offset.x, y: leaderPos.y + offset.y, z: leaderPos.z + offset.z };
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
  module.exports = { FleetFormation, Wing, FormationShape, Maneuver, getSlotPositions };
} else {
  window.GQFleetFormation = { FleetFormation, Wing, FormationShape, Maneuver, getSlotPositions };
}
