/**
 * ThrusterFX.js — Visual effects system for spacecraft engines and thrusters.
 *
 * Manages particle-based engine flames, ion trails, and thruster glow effects.
 * Integrates with the ParticleSystem to create realistic spaceship propulsion visuals.
 *
 * Features:
 *   • Continuous trail particles tied to ship acceleration
 *   • Emissive material glow on engine nozzles
 *   • Dynamic point lights for engine flare
 *   • Support for multiple engine slots per ship
 *   • Configurable for chemical, ion, and plasma propulsion types
 *   • LOD-based particle density
 *
 * Usage:
 *   const thrusterFX = new ThrusterFX(particleSystem);
 *   thrusterFX.attachToShip(shipGroup, shipModel, shipVelocity);
 *   // In game loop:
 *   thrusterFX.update(dt, shipVelocity, shipAcceleration);
 *
 * Inspired by:
 *   Star Citizen (RSI)  — Detailed thruster VFX
 *   EVE Online (CCP)    — Large-scale fleet effects
 *   FreeSpace 2         — Engine glow and trails
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { ParticleEmitter, EmitterMode } = typeof require !== 'undefined'
  ? require('./ParticleEmitter.js')
  : { ParticleEmitter: window.GQParticleEmitter.ParticleEmitter,
      EmitterMode:     window.GQParticleEmitter.EmitterMode };

const { PointLight } = typeof require !== 'undefined'
  ? require('../scene/Light.js')
  : { PointLight: window.GQLight.PointLight };

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Propulsion type determines visual characteristics.
 * @enum {string}
 */
const PropulsionType = Object.freeze({
  /** Chemical rocket / combustion engine — orange/red flames. */
  CHEMICAL: 'chemical',
  /** Ion drive / electric propulsion — blue/cyan glow. */
  ION:      'ion',
  /** Plasma engine — white/violet hot plasma. */
  PLASMA:   'plasma',
  /** Jump drive / warp — purple/blue exotic effects. */
  EXOTIC:   'exotic',
});

// ---------------------------------------------------------------------------
// Presets — Thruster-Specific Particle Configurations
// ---------------------------------------------------------------------------

/** @private */
const _THRUSTER_PRESETS = {
  [PropulsionType.CHEMICAL]: {
    trail: {
      mode: EmitterMode.CONTINUOUS,
      count: 25,                    // particles/second
      lifetime: 0.6, lifetimeVariance: 0.15,
      speed: 2.5, speedVariance: 0.8, spread: 0.3,
      colorStart: 0xff8800, colorEnd: 0x330000,
      sizeStart: 1.2, sizeEnd: 0.0, drag: 0.05, gravity: 0,
    },
    light: {
      color: 0xff6600, intensity: 2.0, distance: 20, duration: 0.15,
    },
    glowIntensity: 0.8,
    pulseFrequency: 2.0,          // Hz — flicker rate
  },

  [PropulsionType.ION]: {
    trail: {
      mode: EmitterMode.CONTINUOUS,
      count: 20,
      lifetime: 0.8, lifetimeVariance: 0.2,
      speed: 3.5, speedVariance: 0.6, spread: 0.2,
      colorStart: 0x00ddff, colorEnd: 0x001155,
      sizeStart: 1.0, sizeEnd: 0.0, drag: 0.04, gravity: 0,
    },
    light: {
      color: 0x0099ff, intensity: 1.5, distance: 25, duration: 0.2,
    },
    glowIntensity: 0.6,
    pulseFrequency: 1.5,
  },

  [PropulsionType.PLASMA]: {
    trail: {
      mode: EmitterMode.CONTINUOUS,
      count: 30,
      lifetime: 0.5, lifetimeVariance: 0.1,
      speed: 4.0, speedVariance: 1.0, spread: 0.35,
      colorStart: 0xffffff, colorEnd: 0xaa0088,
      sizeStart: 1.5, sizeEnd: 0.0, drag: 0.06, gravity: 0,
    },
    light: {
      color: 0xff00ff, intensity: 2.5, distance: 30, duration: 0.25,
    },
    glowIntensity: 1.0,
    pulseFrequency: 3.0,
  },

  [PropulsionType.EXOTIC]: {
    trail: {
      mode: EmitterMode.CONTINUOUS,
      count: 15,
      lifetime: 1.0, lifetimeVariance: 0.3,
      speed: 3.0, speedVariance: 0.9, spread: 0.4,
      colorStart: 0xaa44ff, colorEnd: 0x220044,
      sizeStart: 1.8, sizeEnd: 0.0, drag: 0.03, gravity: 0,
    },
    light: {
      color: 0x8844ff, intensity: 1.8, distance: 35, duration: 0.3,
    },
    glowIntensity: 0.9,
    pulseFrequency: 1.2,
  },
};

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class ThrusterFX {
  /**
   * @param {ParticleSystem} particleSystem - Shared particle system instance
   * @param {object} [opts]
   * @param {number} [opts.maxThrusters=32] - Maximum concurrent thrusters
   * @param {PropulsionType} [opts.propulsionType='chemical'] - Default thruster style
   */
  constructor(particleSystem, opts = {}) {
    this._particleSystem = particleSystem;
    this._maxThrusters = opts.maxThrusters ?? 32;
    this._propulsionType = opts.propulsionType ?? PropulsionType.CHEMICAL;

    /** @type {Map<string, ThrusterSlot>} Active thrusters by ship ID */
    this._thrusters = new Map();

    /** @type {number} Current game time for animation purposes */
    this._globalTime = 0;

    /** @type {boolean} Enable/disable thruster effects globally */
    this._enabled = true;

    /** @type {number} Particle density scale (0 = none, 1 = full) */
    this._densityScale = 1.0;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Attach thruster effects to a ship.
   *
   * @param {string} shipId                  - Unique ship identifier
   * @param {Array<{position: {x,y,z}, direction: {x,y,z}, size: number}>} engines
   *   Array of engine slots with 3D positions and directions
   * @param {PropulsionType} [propulsionType] - Thruster type (uses default if omitted)
   * @returns {ThrusterSlot}
   */
  attachToShip(shipId, engines, propulsionType) {
    if (this._thrusters.size >= this._maxThrusters) {
      console.warn(`[ThrusterFX] Max thrusters (${this._maxThrusters}) exceeded`);
      return null;
    }

    propulsionType = propulsionType ?? this._propulsionType;
    const preset = _THRUSTER_PRESETS[propulsionType];
    if (!preset) {
      console.warn(`[ThrusterFX] Unknown propulsion type: ${propulsionType}`);
      return null;
    }

    const slot = new ThrusterSlot(shipId, engines, propulsionType, preset);
    this._thrusters.set(shipId, slot);
    return slot;
  }

  /**
   * Detach thruster effects from a ship.
   * @param {string} shipId
   */
  detachFromShip(shipId) {
    const slot = this._thrusters.get(shipId);
    if (!slot) return;
    slot.dispose();
    this._thrusters.delete(shipId);
  }

  /**
   * Update thruster effects for all active ships.
   * Call this every frame from the game loop.
   *
   * @param {number} dt                - Delta-time (seconds)
   * @param {Map<string, {x,y,z}>} velocities    - Current velocities keyed by shipId
   * @param {Map<string, {x,y,z}>} accelerations - Current accelerations keyed by shipId
   * @param {Map<string, Array<{x,y,z}>} positions - Ship positions for emitter anchoring
   */
  update(dt, velocities = new Map(), accelerations = new Map(), positions = new Map()) {
    this._globalTime += dt;

    for (const [shipId, slot] of this._thrusters.entries()) {
      const velocity = velocities.get(shipId) ?? { x: 0, y: 0, z: 0 };
      const acceleration = accelerations.get(shipId) ?? { x: 0, y: 0, z: 0 };
      const shipPos = positions.get(shipId) ?? { x: 0, y: 0, z: 0 };

      slot.update(dt, this._globalTime, velocity, acceleration, shipPos, this._densityScale);
    }
  }

  /**
   * Enable/disable all thruster effects.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._enabled = enabled;
    for (const slot of this._thrusters.values()) {
      slot.setEmittersActive(enabled);
    }
  }

  /**
   * Adjust particle density (LOD).
   * @param {number} scale - 0 = none, 1 = full
   */
  setDensityScale(scale) {
    this._densityScale = Math.max(0, Math.min(1, scale));
  }

  /**
   * Get a thruster slot for direct control (advanced).
   * @param {string} shipId
   * @returns {ThrusterSlot | null}
   */
  getSlot(shipId) {
    return this._thrusters.get(shipId) ?? null;
  }

  // Expose enums
  static PropulsionType = PropulsionType;
  static EmitterMode = EmitterMode;
}

// ---------------------------------------------------------------------------
// ThrusterSlot — Per-ship thruster state
// ---------------------------------------------------------------------------

class ThrusterSlot {
  constructor(shipId, engines, propulsionType, preset) {
    this.shipId = shipId;
    this.engines = engines ?? [];
    this.propulsionType = propulsionType;
    this.preset = preset;

    /** @type {ParticleEmitter[]} Emitters for each engine slot */
    this.emitters = [];

    /** @type {PointLight[]} Dynamic lights for engine glow */
    this.lights = [];

    /** @type {number} Track throttle for glow intensity modulation */
    this._throttle = 0;
  }

  /**
   * Update emitter positions and intensity based on acceleration.
   * @private
   */
  update(dt, globalTime, velocity, acceleration, shipPos, densityScale) {
    // Calculate throttle from acceleration magnitude
    const accelMag = Math.sqrt(
      acceleration.x * acceleration.x +
      acceleration.y * acceleration.y +
      acceleration.z * acceleration.z
    );
    this._throttle = Math.min(1.0, accelMag / 20.0); // Normalize to ~0-1

    // Only emit if throttle > threshold
    const emitThreshold = 0.05;
    if (this._throttle < emitThreshold) {
      this._throttle = 0;
    }

    // Update each engine slot
    for (let i = 0; i < this.engines.length; i++) {
      const engine = this.engines[i];
      const emitter = this.emitters[i];
      const light = this.lights[i];

      if (!emitter) continue;

      // Update emitter position
      emitter.position = {
        x: shipPos.x + (engine.position?.x ?? 0),
        y: shipPos.y + (engine.position?.y ?? 0),
        z: shipPos.z + (engine.position?.z ?? 0),
      };

      // Direction points backward (opposite acceleration)
      const dir = engine.direction ?? { x: 0, y: -1, z: 0 };
      emitter.direction = { x: -dir.x, y: -dir.y, z: -dir.z };

      // Modulate emission rate based on throttle and density
      const baseRate = this.preset.trail.count;
      const scaledRate = baseRate * this._throttle * densityScale;
      emitter.count = scaledRate;

      // Update light intensity
      if (light) {
        const baseIntensity = this.preset.light.intensity;
        const glowPulse = 0.7 + 0.3 * Math.sin(globalTime * this.preset.pulseFrequency * Math.PI);
        light.intensity = baseIntensity * this._throttle * glowPulse;
      }
    }
  }

  /**
   * Enable/disable all emitters in this slot.
   * @private
   */
  setEmittersActive(active) {
    for (const emitter of this.emitters) {
      if (active && emitter.count > 0) {
        // Re-enable
        emitter._emitAccum = 0;
      } else {
        // Disable by setting count to 0
        emitter.count = 0;
      }
    }
  }

  /**
   * Clean up resources.
   * @private
   */
  dispose() {
    // Emitters will clean up themselves when removed from the particle system
    this.emitters = [];
    this.lights = [];
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThrusterFX, PropulsionType };
}

if (typeof window !== 'undefined') {
  window.GQThrusterFX = { ThrusterFX, PropulsionType };
}
