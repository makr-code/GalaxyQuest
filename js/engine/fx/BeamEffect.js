/**
 * BeamEffect.js — Instanced capsule beam renderer (Phase FX-3).
 *
 * Manages a fixed-capacity pool of active beam instances (laser beams, plasma
 * bolts in flight, etc.) and exposes the per-frame GPU buffer that the
 * renderer passes to `beam.wgsl` for instanced drawing.
 *
 * Each `BeamRecord` produced by `CombatFX.spawnWeaponFire()` can be handed to
 * `BeamEffect.addBeam()`.  The pool tracks elapsed time and removes beams once
 * their duration expires.  On the GPU path, the instance storage buffer is
 * written once per frame before the draw call.
 *
 * Buffer layout per instance (64 bytes = 16 × f32) — mirrors BeamInstance in beam.wgsl:
 *   [0-2]  from.xyz   [3]  to.x
 *   [4-5]  to.yz      [6]  coreR  [7]  coreG
 *   [8]    coreB      [9]  glowR  [10] glowG  [11] glowB
 *   [12]   glowRadius [13] alpha  [14-15] _pad
 *
 * Renderer integration:
 *   1. Call `update(dt)` each frame — updates elapsed time and alpha fades.
 *   2. Read `instanceBuffer` (Float32Array) and `liveCount` to draw.
 *   3. On the GPU path, call `uploadToGPU()` after `update()` to write the
 *      instance buffer to `gpuInstanceBuffer` before issuing the draw call.
 *
 * Inspired by:
 *   FreeSpace 2   (Volition, 1999) — continuous beam VFX
 *   Elite Dangerous (Frontier)     — laser bolt trails
 *   Three.js Line2 (MIT)           — screen-space line expansion pattern
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Float32s per beam instance (16 × f32 = 64 bytes). */
const FLOATS_PER_BEAM = 16;

/** Default beam pool capacity. */
const DEFAULT_MAX_BEAMS = 128;

// ---------------------------------------------------------------------------
// Field offsets within a beam instance row
// ---------------------------------------------------------------------------
const FB_FROM_X    =  0;
const FB_FROM_Y    =  1;
const FB_FROM_Z    =  2;
const FB_TO_X      =  3;
const FB_TO_Y      =  4;
const FB_TO_Z      =  5;
const FB_CORE_R    =  6;
const FB_CORE_G    =  7;
const FB_CORE_B    =  8;
const FB_GLOW_R    =  9;
const FB_GLOW_G    = 10;
const FB_GLOW_B    = 11;
const FB_GLOW_RAD  = 12;
const FB_ALPHA     = 13;
// 14-15 reserved

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _hexToRgb(hex) {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >>  8) & 0xff) / 255,
    ( hex        & 0xff) / 255,
  ];
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class BeamEffect {
  /**
   * @param {object}       [opts]
   * @param {number}       [opts.maxBeams=128]   - Pool capacity
   * @param {object|null}  [opts.device]         - WebGPU GPUDevice (optional)
   */
  constructor(opts = {}) {
    this._maxBeams = opts.maxBeams ?? DEFAULT_MAX_BEAMS;
    this._device   = opts.device   ?? null;

    /**
     * Live beam metadata array.
     * @type {Array<{id, elapsed, duration, slot}>}
     */
    this._beams = [];

    /** @type {Set<number>} Free slot indices */
    this._freeSlots = new Set(Array.from({ length: this._maxBeams }, (_, i) => i));

    /** CPU-side instance buffer (FLOATS_PER_BEAM × maxBeams) */
    this._instanceData = new Float32Array(this._maxBeams * FLOATS_PER_BEAM);

    /** Number of currently live beams */
    this.liveCount = 0;

    // GPU instance buffer (null until _initGPU)
    this._gpuBuffer  = null;
    this._gpuEnabled = false;

    if (this._device) {
      this._initGPU();
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Register a BeamRecord (as returned by CombatFX.spawnWeaponFire).
   *
   * Accepts any object with the fields defined in BeamRecord:
   *   from, to, color, coreColor, glowRadius, duration.
   *
   * @param {object} rec - BeamRecord
   * @returns {number} Internal slot index, or -1 if pool is full
   */
  addBeam(rec) {
    if (this._freeSlots.size === 0) {
      console.warn('[BeamEffect] Pool full — beam dropped');
      return -1;
    }

    const slot = this._freeSlots.values().next().value;
    this._freeSlots.delete(slot);

    const meta = {
      id:       rec.id,
      elapsed:  0,
      duration: rec.duration ?? 0.05,
      slot,
    };
    this._beams.push(meta);
    this.liveCount++;

    this._writeSlot(slot, rec, 1.0 /* alpha */);
    return slot;
  }

  /**
   * Advance all beams by `dt` seconds.
   * Beams that have exceeded their duration are retired.
   *
   * @param {number} dt
   */
  update(dt) {
    for (let i = this._beams.length - 1; i >= 0; i--) {
      const meta = this._beams[i];
      meta.elapsed += dt;

      if (meta.elapsed >= meta.duration) {
        // Mark slot as inactive (alpha = 0)
        this._setAlpha(meta.slot, 0);
        this._freeSlots.add(meta.slot);
        this._beams.splice(i, 1);
        this.liveCount--;
      } else {
        // Fade out in the last 20 % of duration
        const progress = meta.elapsed / meta.duration;
        const fadeStart = 0.8;
        const alpha = progress > fadeStart
          ? 1 - (progress - fadeStart) / (1 - fadeStart)
          : 1.0;
        this._setAlpha(meta.slot, alpha);
      }
    }
  }

  /**
   * Upload the CPU instance buffer to the GPU instance buffer.
   * Call after `update()` and before issuing the draw call.
   * No-op if GPU is not enabled.
   */
  uploadToGPU() {
    if (!this._gpuEnabled || !this._gpuBuffer) return;
    this._device.queue.writeBuffer(this._gpuBuffer, 0, this._instanceData);
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** @returns {Float32Array} CPU instance data (FLOATS_PER_BEAM × maxBeams) */
  get instanceBuffer() { return this._instanceData; }

  /** @returns {GPUBuffer|null} GPU instance buffer (null on CPU path) */
  get gpuBuffer() { return this._gpuBuffer; }

  /** @returns {boolean} Whether GPU instance buffer is available */
  get gpuEnabled() { return this._gpuEnabled; }

  /** @returns {number} Pool capacity */
  get maxBeams() { return this._maxBeams; }

  /** Field-offset constants (for renderer / tests) */
  static get FIELD() {
    return {
      FROM_X: FB_FROM_X, FROM_Y: FB_FROM_Y, FROM_Z: FB_FROM_Z,
      TO_X: FB_TO_X, TO_Y: FB_TO_Y, TO_Z: FB_TO_Z,
      CORE_R: FB_CORE_R, CORE_G: FB_CORE_G, CORE_B: FB_CORE_B,
      GLOW_R: FB_GLOW_R, GLOW_G: FB_GLOW_G, GLOW_B: FB_GLOW_B,
      GLOW_RADIUS: FB_GLOW_RAD,
      ALPHA: FB_ALPHA,
      FLOATS_PER_BEAM,
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  dispose() {
    if (this._gpuBuffer) { this._gpuBuffer.destroy(); this._gpuBuffer = null; }
    this._gpuEnabled = false;
    this._beams.length = 0;
    this._freeSlots.clear();
    this._instanceData.fill(0);
    this.liveCount = 0;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** @private */
  _initGPU() {
    const byteSize = this._maxBeams * FLOATS_PER_BEAM * 4;
    this._gpuBuffer = this._device.createBuffer({
      size:  byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._gpuEnabled = true;
  }

  /** @private */
  _writeSlot(slot, rec, alpha) {
    const b = slot * FLOATS_PER_BEAM;
    const d = this._instanceData;

    d[b + FB_FROM_X] = rec.from?.x ?? 0;
    d[b + FB_FROM_Y] = rec.from?.y ?? 0;
    d[b + FB_FROM_Z] = rec.from?.z ?? 0;
    d[b + FB_TO_X]   = rec.to?.x   ?? 0;
    d[b + FB_TO_Y]   = rec.to?.y   ?? 0;
    d[b + FB_TO_Z]   = rec.to?.z   ?? 0;

    const [coreR, coreG, coreB] = _hexToRgb(rec.coreColor ?? rec.color ?? 0xffffff);
    const [glowR, glowG, glowB] = _hexToRgb(rec.color     ?? 0x4488ff);

    // Core colour is 2× brighter to simulate HDR bloom
    d[b + FB_CORE_R]   = coreR * 2;
    d[b + FB_CORE_G]   = coreG * 2;
    d[b + FB_CORE_B]   = coreB * 2;
    d[b + FB_GLOW_R]   = glowR;
    d[b + FB_GLOW_G]   = glowG;
    d[b + FB_GLOW_B]   = glowB;
    d[b + FB_GLOW_RAD] = rec.glowRadius ?? 0.4;
    d[b + FB_ALPHA]    = alpha;
    // _pad 14-15 remain 0
  }

  /** @private */
  _setAlpha(slot, alpha) {
    this._instanceData[slot * FLOATS_PER_BEAM + FB_ALPHA] = alpha;
  }
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BeamEffect, FLOATS_PER_BEAM, DEFAULT_MAX_BEAMS };
} else {
  window.GQBeamEffect = { BeamEffect, FLOATS_PER_BEAM, DEFAULT_MAX_BEAMS };
}
