/**
 * ParticleSystem.js — CPU particle pool with optional GPU compute path.
 *
 * Manages a fixed-capacity pool of particle slots (plain JS objects) and
 * drives attached ParticleEmitters each frame.  Dynamic PointLights are
 * created alongside emitters to simulate the brief flash of explosions and
 * weapon impacts.
 *
 * GPU compute path:
 *   When a WebGPUDevice is supplied the particle pool can be uploaded to a
 *   GPUBuffer and simulated via particles.wgsl (see WebGPUCompute).  The CPU
 *   path is always available as a fallback.
 *   TODO (Phase FX-2): wire up GPU simulation via WebGPUCompute + particles.wgsl.
 *
 * Inspired by:
 *   Unity ParticleSystem   — pool-based emission
 *   Godot GPUParticles3D   — GPU storage-buffer simulation
 *   Babylon.js ParticleSystem (Apache 2.0) — https://github.com/BabylonJS/Babylon.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { ParticleEmitter } = typeof require !== 'undefined'
  ? require('./ParticleEmitter.js')
  : { ParticleEmitter: window.GQParticleEmitter.ParticleEmitter };

const { PointLight } = typeof require !== 'undefined'
  ? require('../scene/Light.js')
  : { PointLight: window.GQLight.PointLight };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum number of live particles in the pool. */
const DEFAULT_MAX_PARTICLES = 4096;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Fast pseudo-random in [-1, 1]. */
function _rand() { return Math.random() * 2 - 1; }

/** Decompose a 24-bit hex colour into [r, g, b] in [0, 1]. */
function _hexToRgb(hex) {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >>  8) & 0xff) / 255,
    ( hex        & 0xff) / 255,
  ];
}

/** Linear interpolation */
function _lerp(a, b, t) { return a + (b - a) * t; }

// ---------------------------------------------------------------------------
// Particle prototype
// ---------------------------------------------------------------------------

/**
 * Create a dead particle slot.
 * @returns {object}
 */
function _makeParticle() {
  return {
    active:    false,
    // position
    px: 0, py: 0, pz: 0,
    // velocity
    vx: 0, vy: 0, vz: 0,
    age:      0,
    lifetime: 0,  // total lifetime (s)
    remaining: 0, // remaining lifetime (s)
    // interpolated colour (0-1)
    cr: 1, cg: 1, cb: 1,
    size:     1,
    // emitter config (cached for per-frame interpolation)
    colorStartR: 1, colorStartG: 1, colorStartB: 1,
    colorEndR:   0, colorEndG:   0, colorEndB:   0,
    sizeStart:   1,
    sizeEnd:     0,
    gravity:     0,
    drag:        0.04,
  };
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class ParticleSystem {
  /**
   * @param {object}  [opts]
   * @param {number}  [opts.maxParticles=4096] - Pool capacity
   * @param {object}  [opts.gpuDevice]         - Optional WebGPUDevice (reserved for Phase FX-2)
   */
  constructor(opts = {}) {
    this._maxParticles = opts.maxParticles ?? DEFAULT_MAX_PARTICLES;
    this._gpuDevice    = opts.gpuDevice ?? null; // TODO (Phase FX-2): GPU compute path

    /** @type {object[]} Flat particle pool */
    this._pool = Array.from({ length: this._maxParticles }, _makeParticle);

    /** @type {number} Next slot to check when allocating (ring-buffer scan) */
    this._allocHead = 0;

    /** @type {ParticleEmitter[]} Active emitters */
    this._emitters = [];

    /**
     * Active dynamic point lights.
     * Each entry: { light: PointLight, elapsed: number, duration: number, peakIntensity: number }
     * @type {Array<{light: PointLight, elapsed: number, duration: number, peakIntensity: number}>}
     */
    this._dynamicLights = [];

    /** @type {number} Running count of live particles (informational) */
    this.liveCount = 0;
  }

  // -------------------------------------------------------------------------
  // Emitter management
  // -------------------------------------------------------------------------

  /**
   * Register and immediately fire/start a ParticleEmitter.
   * @param {ParticleEmitter} emitter
   * @returns {ParticleEmitter} The same emitter (for chaining)
   */
  addEmitter(emitter) {
    this._emitters.push(emitter);
    return emitter;
  }

  /**
   * Register a short-lived dynamic PointLight (e.g. explosion flash).
   * The light's intensity will be animated: ramp-up for 10 % of duration,
   * then exponential decay for the remaining 90 %.
   *
   * @param {PointLight} light         - Pre-configured PointLight instance
   * @param {number}     duration      - Total flash duration in seconds
   * @returns {PointLight}
   */
  addDynamicLight(light, duration) {
    this._dynamicLights.push({
      light,
      elapsed:       0,
      duration:      Math.max(duration, 0.01),
      peakIntensity: light.intensity,
    });
    return light;
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  /**
   * Advance the simulation by `dt` seconds.
   * Call once per game-loop frame before rendering.
   *
   * @param {number} dt - Delta-time in seconds
   */
  update(dt) {
    // --- tick emitters and spawn new particles ---
    for (let i = this._emitters.length - 1; i >= 0; i--) {
      const emitter = this._emitters[i];
      const count   = emitter.tick(dt);
      for (let n = 0; n < count; n++) {
        this._spawn(emitter);
      }
      if (emitter.done) {
        this._emitters.splice(i, 1);
      }
    }

    // --- simulate live particles ---
    let live = 0;
    for (let i = 0; i < this._maxParticles; i++) {
      const p = this._pool[i];
      if (!p.active) continue;
      live++;

      p.age       += dt;
      p.remaining -= dt;

      if (p.remaining <= 0) {
        p.active = false;
        live--;
        continue;
      }

      // Drag (velocity decay)
      const damping = Math.max(0, 1 - p.drag * dt);
      p.vx *= damping;
      p.vy *= damping;
      p.vz *= damping;

      // Gravity
      p.vy -= p.gravity * dt;

      // Euler position integration
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;

      // Colour & size interpolation (by normalized age)
      const t = Math.min(1, p.age / p.lifetime);
      p.cr   = _lerp(p.colorStartR, p.colorEndR, t);
      p.cg   = _lerp(p.colorStartG, p.colorEndG, t);
      p.cb   = _lerp(p.colorStartB, p.colorEndB, t);
      p.size = _lerp(p.sizeStart,   p.sizeEnd,   t);
    }
    this.liveCount = live;

    // --- animate dynamic lights ---
    for (let i = this._dynamicLights.length - 1; i >= 0; i--) {
      const entry = this._dynamicLights[i];
      entry.elapsed += dt;

      const progress = entry.elapsed / entry.duration;
      if (progress >= 1) {
        entry.light.visible = false;
        this._dynamicLights.splice(i, 1);
        continue;
      }

      // Shape: quick ramp-up (0→10 %), then exponential decay
      const rampEnd = 0.1;
      let factor;
      if (progress < rampEnd) {
        factor = progress / rampEnd;
      } else {
        const t = (progress - rampEnd) / (1 - rampEnd);
        factor  = Math.exp(-4 * t); // e^-4 ≈ 0.018 at t=1
      }
      entry.light.intensity = entry.peakIntensity * factor;
    }
  }

  // -------------------------------------------------------------------------
  // Read-only access (for renderer)
  // -------------------------------------------------------------------------

  /**
   * Iterate over all live particles, calling `cb(particle)` for each.
   * @param {function(object): void} cb
   */
  forEach(cb) {
    for (let i = 0; i < this._maxParticles; i++) {
      if (this._pool[i].active) cb(this._pool[i]);
    }
  }

  /**
   * @returns {Array<{light: PointLight, ...}>} Live dynamic light entries.
   */
  get dynamicLights() { return this._dynamicLights; }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  dispose() {
    this._emitters.length     = 0;
    this._dynamicLights.length = 0;
    for (const p of this._pool) { p.active = false; }
    this.liveCount = 0;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Allocate a pool slot and initialise a new particle from an emitter.
   * @param {ParticleEmitter} e
   */
  _spawn(e) {
    const slot = this._allocate();
    if (!slot) return; // pool full

    // Random direction within cone
    const theta = (Math.random() * 2 - 1) * e.spread;
    const phi   = Math.random() * Math.PI * 2;
    const sinT  = Math.sin(theta);

    // Rotate direction vector by (theta, phi) — simplified: perturb around e.direction
    const dx = e.direction.x + sinT * Math.cos(phi);
    const dy = e.direction.y + sinT * Math.sin(phi);
    const dz = e.direction.z + sinT;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    const speed = e.speed + _rand() * e.speedVariance * e.speed;

    const lt  = Math.max(0.01, e.lifetime + _rand() * e.lifetimeVariance);
    const [csr, csg, csb] = _hexToRgb(e.colorStart);
    const [cer, ceg, ceb] = _hexToRgb(e.colorEnd);

    slot.active    = true;
    slot.px        = e.position.x;
    slot.py        = e.position.y;
    slot.pz        = e.position.z;
    slot.vx        = (dx / len) * speed;
    slot.vy        = (dy / len) * speed;
    slot.vz        = (dz / len) * speed;
    slot.age       = 0;
    slot.lifetime  = lt;
    slot.remaining = lt;
    slot.cr        = csr;
    slot.cg        = csg;
    slot.cb        = csb;
    slot.size      = e.sizeStart;

    slot.colorStartR = csr; slot.colorStartG = csg; slot.colorStartB = csb;
    slot.colorEndR   = cer; slot.colorEndG   = ceg; slot.colorEndB   = ceb;
    slot.sizeStart   = e.sizeStart;
    slot.sizeEnd     = e.sizeEnd;
    slot.gravity     = e.gravity;
    slot.drag        = e.drag;
  }

  /**
   * Find the next inactive pool slot (ring-buffer).
   * @returns {object|null}
   */
  _allocate() {
    const max = this._maxParticles;
    for (let checked = 0; checked < max; checked++) {
      const idx = (this._allocHead + checked) % max;
      if (!this._pool[idx].active) {
        this._allocHead = (idx + 1) % max;
        return this._pool[idx];
      }
    }
    return null; // pool exhausted
  }
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ParticleSystem, DEFAULT_MAX_PARTICLES };
} else {
  window.GQParticleSystem = { ParticleSystem, DEFAULT_MAX_PARTICLES };
}
