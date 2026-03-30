/**
 * ParticleEmitter.js — Particle emitter descriptor for the CombatFX system.
 *
 * An emitter is a lightweight config-plus-state object that tells
 * ParticleSystem how to spawn particles each frame.  It supports two modes:
 *
 *   • BURST      — all particles fired in a single tick (explosions, impacts)
 *   • CONTINUOUS — steady stream at a fixed rate/s (engine trails, beams)
 *
 * Inspired by:
 *   Unity ParticleSystem    — https://docs.unity3d.com/Manual/class-ParticleSystem.html
 *   Godot GPUParticles3D    — https://docs.godotengine.org/en/stable/classes/class_gpuparticles3d.html
 *   Unreal Cascade/Niagara  — particle emitter concepts
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

/** @enum {string} Emission strategy */
const EmitterMode = Object.freeze({
  /** All `count` particles emitted in a single tick, then emitter expires. */
  BURST:      'burst',
  /** Particles emitted at `count` particles/second until stopped or duration elapses. */
  CONTINUOUS: 'continuous',
});

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

let _nextId = 1;

class ParticleEmitter {
  /**
   * @param {object}   opts
   * @param {string}  [opts.mode='burst']           - EmitterMode value
   * @param {{x,y,z}}  opts.position                - World-space origin
   * @param {{x,y,z}} [opts.direction={x:0,y:1,z:0}] - Normalised main axis
   * @param {number}  [opts.spread=0.3]             - Cone half-angle (radians)
   * @param {number}  [opts.count=30]               - Particles (burst) or rate/s (continuous)
   * @param {number}  [opts.lifetime=1.0]           - Per-particle base lifetime (s)
   * @param {number}  [opts.lifetimeVariance=0.2]   - ± random lifetime variance (s)
   * @param {number}  [opts.speed=8]                - Initial speed (units/s)
   * @param {number}  [opts.speedVariance=0.3]      - ± random speed variance
   * @param {number}  [opts.colorStart=0xffffff]    - RGB hex colour at birth
   * @param {number}  [opts.colorEnd=0x000000]      - RGB hex colour at death
   * @param {number}  [opts.sizeStart=1.2]          - Particle radius at birth
   * @param {number}  [opts.sizeEnd=0.0]            - Particle radius at death
   * @param {number}  [opts.gravity=0]              - Y-axis gravity acceleration (units/s²)
   * @param {number}  [opts.drag=0.04]              - Velocity drag coefficient per second
   * @param {number}  [opts.duration=0]             - Max emitter lifetime (s); 0 = infinite
   */
  constructor(opts = {}) {
    this.id   = _nextId++;
    this.mode = opts.mode ?? EmitterMode.BURST;

    this.position  = { x: 0, y: 0, z: 0, ...(opts.position  ?? {}) };
    this.direction = { x: 0, y: 1, z: 0, ...(opts.direction ?? {}) };
    this.spread    = opts.spread ?? 0.3;

    this.count           = opts.count           ?? 30;
    this.lifetime        = opts.lifetime        ?? 1.0;
    this.lifetimeVariance = opts.lifetimeVariance ?? 0.2;
    this.speed           = opts.speed           ?? 8;
    this.speedVariance   = opts.speedVariance   ?? 0.3;

    this.colorStart = opts.colorStart ?? 0xffffff;
    this.colorEnd   = opts.colorEnd   ?? 0x000000;
    this.sizeStart  = opts.sizeStart  ?? 1.2;
    this.sizeEnd    = opts.sizeEnd    ?? 0.0;

    this.gravity  = opts.gravity  ?? 0;
    this.drag     = opts.drag     ?? 0.04;
    this.duration = opts.duration ?? 0;

    /** @private */
    this._elapsed   = 0;
    /** @private */
    this._emitAccum = 0;
    /** @private */
    this._done      = false;
  }

  /** @returns {boolean} True when the emitter will no longer produce particles. */
  get done() { return this._done; }

  /**
   * Advance the emitter clock and return the number of particles to spawn.
   *
   * @param {number} dt - Delta-time in seconds
   * @returns {number}  - Particles to spawn this tick (≥ 0)
   */
  tick(dt) {
    if (this._done) return 0;
    this._elapsed += dt;

    if (this.mode === EmitterMode.BURST) {
      this._done = true;
      return this.count;
    }

    // Continuous: accumulate fractional particles
    this._emitAccum += this.count * dt; // this.count = particles/second
    const toSpawn = Math.floor(this._emitAccum);
    this._emitAccum -= toSpawn;

    if (this.duration > 0 && this._elapsed >= this.duration) {
      this._done = true;
    }
    return toSpawn;
  }
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ParticleEmitter, EmitterMode };
} else {
  window.GQParticleEmitter = { ParticleEmitter, EmitterMode };
}
