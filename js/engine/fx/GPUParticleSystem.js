/**
 * GPUParticleSystem.js — GPU-accelerated particle simulation (Phase FX-2/5).
 *
 * Wires up the existing `particles.wgsl` compute shader via `WebGPUCompute`
 * to run the full particle pool entirely on the GPU.  A CPU fallback (mirroring
 * the shader logic) is provided for WebGL / test environments.
 *
 * Buffer layout per particle (64 bytes, 16 × f32) — matches particles.wgsl:
 *   [0-2]  position.xyz          [3]  lifetime (remaining, seconds)
 *   [4-6]  velocity.xyz          [7]  age (elapsed since spawn, seconds)
 *   [8]    colorR                [9]  colorG  [10]  colorB  [11]  size
 *   [12]   active (u32 as f32)   [13-15] _pad
 *
 * Usage:
 *   const gps = new GPUParticleSystem({ device, maxParticles: 4096 });
 *   // Spawn a particle by writing directly into the data buffer (F_* offsets)
 *   // or via the helpers spawn() / update() / forEach().
 *   gps.update(dt);  // dispatches GPU compute or steps CPU
 *
 * Inspired by:
 *   Godot GPUParticles3D   — GPU storage-buffer simulation
 *   Babylon.js ComputeShader (Apache 2.0) — https://github.com/BabylonJS/Babylon.js
 *   WebGPU Samples (Apache 2.0) — https://github.com/webgpu/webgpu-samples
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants — buffer field indices (into a Float32Array row of 16 f32)
// ---------------------------------------------------------------------------

/** @const {number} */
const FP_PX       =  0;  // position x
/** @const {number} */
const FP_PY       =  1;  // position y
/** @const {number} */
const FP_PZ       =  2;  // position z
/** @const {number} */
const FP_LIFETIME =  3;  // remaining lifetime (seconds)
/** @const {number} */
const FP_VX       =  4;  // velocity x
/** @const {number} */
const FP_VY       =  5;  // velocity y
/** @const {number} */
const FP_VZ       =  6;  // velocity z
/** @const {number} */
const FP_AGE      =  7;  // elapsed age (seconds)
/** @const {number} */
const FP_CR       =  8;  // color red [0-1]
/** @const {number} */
const FP_CG       =  9;  // color green [0-1]
/** @const {number} */
const FP_CB       = 10;  // color blue [0-1]
/** @const {number} */
const FP_SIZE     = 11;  // display radius
/** @const {number} */
const FP_ACTIVE   = 12;  // 1 = alive, 0 = dead (stored as f32)
// 13-15 reserved (_pad)

/** Float32s per particle slot (16 × f32 = 64 bytes). */
const FLOATS_PER_PARTICLE = 16;

/** Default pool capacity. */
const DEFAULT_MAX_PARTICLES = 4096;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _rand() { return Math.random() * 2 - 1; }

function _hexToRgb(hex) {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >>  8) & 0xff) / 255,
    ( hex        & 0xff) / 255,
  ];
}

function _lerp(a, b, t) { return a + (b - a) * t; }

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class GPUParticleSystem {
  /**
   * @param {object}       [opts]
   * @param {object|null}  [opts.device]          - WebGPU GPUDevice; null → CPU path
   * @param {number}       [opts.maxParticles=4096]
   * @param {number}       [opts.gravity=0]        - Y-down gravity (world-units/s²)
   * @param {number}       [opts.drag=0.04]        - Default drag per second
   */
  constructor(opts = {}) {
    this._maxParticles = opts.maxParticles ?? DEFAULT_MAX_PARTICLES;
    this._gravity      = opts.gravity      ?? 0;
    this._drag         = opts.drag         ?? 0.04;
    this._device       = opts.device       ?? null;

    // CPU-side data mirror — always maintained (GPU path writes here too on syncFromGPU)
    this._data = new Float32Array(this._maxParticles * FLOATS_PER_PARTICLE);

    /** Ring-buffer allocation pointer */
    this._allocHead = 0;

    /** Running count of live particles (informational) */
    this.liveCount = 0;

    // GPU resources (null until _initGPU is called)
    this._gpuBuffer   = null;
    this._paramBuffer = null;
    this._compute     = null;
    this._gpuEnabled  = false;

    if (this._device) {
      this._initGPU();
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Spawn a single particle into the pool.
   *
   * @param {object} p
   * @param {number} p.px, p.py, p.pz         - spawn position
   * @param {number} p.vx, p.vy, p.vz         - initial velocity
   * @param {number} p.lifetime               - total lifetime (seconds)
   * @param {number} [p.colorHex=0xffffff]    - packed 24-bit RGB color
   * @param {number} [p.size=1]               - display radius
   * @returns {number} Slot index, or -1 if pool is full
   */
  spawn(p) {
    const slot = this._allocate();
    if (slot < 0) return -1;

    const [cr, cg, cb] = _hexToRgb(p.colorHex ?? 0xffffff);
    const b = slot * FLOATS_PER_PARTICLE;
    const d = this._data;

    d[b + FP_PX]       = p.px       ?? 0;
    d[b + FP_PY]       = p.py       ?? 0;
    d[b + FP_PZ]       = p.pz       ?? 0;
    d[b + FP_LIFETIME] = Math.max(0.01, p.lifetime ?? 1.0);
    d[b + FP_VX]       = p.vx       ?? 0;
    d[b + FP_VY]       = p.vy       ?? 0;
    d[b + FP_VZ]       = p.vz       ?? 0;
    d[b + FP_AGE]      = 0;
    d[b + FP_CR]       = cr;
    d[b + FP_CG]       = cg;
    d[b + FP_CB]       = cb;
    d[b + FP_SIZE]     = p.size     ?? 1;
    d[b + FP_ACTIVE]   = 1;
    // _pad slots remain 0

    if (this._gpuEnabled) {
      this._uploadSlot(slot);
    }

    return slot;
  }

  /**
   * Advance the simulation by `dt` seconds.
   * Dispatches the GPU compute shader if available; otherwise runs the CPU path.
   *
   * @param {number} dt - Delta-time in seconds
   */
  update(dt) {
    if (this._gpuEnabled) {
      this._dispatchGPU(dt);
    } else {
      this._stepCPU(dt);
    }
  }

  /**
   * Iterate over all live particles, calling `cb(slot, dataView)` for each.
   * On the GPU path you must call `syncFromGPU()` first to populate the CPU mirror.
   *
   * @param {function(number, Float32Array): void} cb
   */
  forEach(cb) {
    const d   = this._data;
    const fpp = FLOATS_PER_PARTICLE;
    for (let i = 0; i < this._maxParticles; i++) {
      if (d[i * fpp + FP_ACTIVE] > 0.5) {
        cb(i, d);
      }
    }
  }

  /**
   * Asynchronously copy GPU particle state back into the CPU mirror.
   * No-op on the CPU path.
   *
   * @returns {Promise<void>}
   */
  async syncFromGPU() {
    if (!this._gpuEnabled || !this._gpuBuffer) return;

    const byteSize = this._maxParticles * FLOATS_PER_PARTICLE * 4;
    const staging  = this._device.createBuffer({
      size:  byteSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const enc = this._device.createCommandEncoder();
    enc.copyBufferToBuffer(this._gpuBuffer, 0, staging, 0, byteSize);
    this._device.queue.submit([enc.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const src = new Float32Array(staging.getMappedRange());
    this._data.set(src);
    staging.unmap();
    staging.destroy();
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** @returns {boolean} Whether GPU acceleration is active */
  get gpuEnabled() { return this._gpuEnabled; }

  /** @returns {number} Pool capacity */
  get maxParticles() { return this._maxParticles; }

  /** @returns {Float32Array} Raw CPU-side data buffer (16 f32 per slot) */
  get dataBuffer() { return this._data; }

  /** Field-offset constants (for direct buffer access by renderer) */
  static get FIELD() {
    return {
      PX: FP_PX, PY: FP_PY, PZ: FP_PZ,
      LIFETIME: FP_LIFETIME,
      VX: FP_VX, VY: FP_VY, VZ: FP_VZ,
      AGE: FP_AGE,
      CR: FP_CR, CG: FP_CG, CB: FP_CB,
      SIZE: FP_SIZE,
      ACTIVE: FP_ACTIVE,
      FLOATS_PER_PARTICLE,
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Attach a pre-compiled WebGPUCompute instance that has particles.wgsl
   * loaded and bind groups set.  Called by the host renderer after GPU init.
   *
   * @param {object} computeInstance - WebGPUCompute with particle pipeline
   */
  setComputePipeline(computeInstance) {
    this._compute = computeInstance;
  }

  dispose() {
    if (this._gpuBuffer)   { this._gpuBuffer.destroy();  this._gpuBuffer   = null; }
    if (this._paramBuffer) { this._paramBuffer.destroy(); this._paramBuffer = null; }
    if (this._compute)     { this._compute.dispose();     this._compute     = null; }
    this._gpuEnabled = false;
    this._data.fill(0);
    this.liveCount = 0;
  }

  // -------------------------------------------------------------------------
  // Private — GPU path
  // -------------------------------------------------------------------------

  /** @private */
  _initGPU() {
    const dev      = this._device;
    const byteSize = this._maxParticles * FLOATS_PER_PARTICLE * 4;

    // Storage buffer (read_write) — full particle pool
    this._gpuBuffer = dev.createBuffer({
      size:  byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: false,
    });

    // Uniform buffer — SimParams: dt(f32), gravity(f32), drag(f32), _pad(f32) = 16 bytes
    this._paramBuffer = dev.createBuffer({
      size:  16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._gpuEnabled = true;
  }

  /** @private */
  _uploadSlot(slot) {
    const byteOffset = slot * FLOATS_PER_PARTICLE * 4;
    const start      = slot * FLOATS_PER_PARTICLE;
    const slice      = this._data.subarray(start, start + FLOATS_PER_PARTICLE);
    this._device.queue.writeBuffer(this._gpuBuffer, byteOffset, slice);
  }

  /** @private */
  _dispatchGPU(dt) {
    // Write SimParams: dt, gravity, drag, _pad
    const params = new Float32Array([dt, this._gravity, this._drag, 0]);
    this._device.queue.writeBuffer(this._paramBuffer, 0, params);

    if (!this._compute) {
      // Pipeline not yet attached — fall back to CPU for this frame
      this._stepCPU(dt);
    } else {
      const workgroups = Math.ceil(this._maxParticles / 64);
      this._compute.dispatch(workgroups);
    }
  }

  // -------------------------------------------------------------------------
  // Private — CPU simulation path (mirrors particles.wgsl exactly)
  // -------------------------------------------------------------------------

  /** @private */
  _stepCPU(dt) {
    const d    = this._data;
    const fpp  = FLOATS_PER_PARTICLE;
    const drag = this._drag;
    const grav = this._gravity;
    let   live = 0;

    for (let i = 0; i < this._maxParticles; i++) {
      const b = i * fpp;
      if (d[b + FP_ACTIVE] < 0.5) continue;

      // --- integrate lifetime ---
      const lt = d[b + FP_LIFETIME] - dt;
      d[b + FP_AGE] += dt;

      if (lt <= 0) {
        d[b + FP_ACTIVE]   = 0;
        d[b + FP_LIFETIME] = 0;
        continue;
      }
      d[b + FP_LIFETIME] = lt;

      // --- drag (velocity decay) ---
      const damping = Math.max(0, 1 - drag * dt);
      d[b + FP_VX] *= damping;
      d[b + FP_VY] *= damping;
      d[b + FP_VZ] *= damping;

      // --- gravity ---
      d[b + FP_VY] -= grav * dt;

      // --- Euler position integration ---
      d[b + FP_PX] += d[b + FP_VX] * dt;
      d[b + FP_PY] += d[b + FP_VY] * dt;
      d[b + FP_PZ] += d[b + FP_VZ] * dt;

      live++;
    }

    this.liveCount = live;
  }

  // -------------------------------------------------------------------------
  // Private — allocation
  // -------------------------------------------------------------------------

  /** @private */
  _allocate() {
    const max = this._maxParticles;
    const fpp = FLOATS_PER_PARTICLE;
    const d   = this._data;

    for (let checked = 0; checked < max; checked++) {
      const idx = (this._allocHead + checked) % max;
      if (d[idx * fpp + FP_ACTIVE] < 0.5) {
        this._allocHead = (idx + 1) % max;
        return idx;
      }
    }
    return -1; // pool exhausted
  }
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GPUParticleSystem, FLOATS_PER_PARTICLE, DEFAULT_MAX_PARTICLES };
} else {
  window.GQGPUParticleSystem = { GPUParticleSystem, FLOATS_PER_PARTICLE, DEFAULT_MAX_PARTICLES };
}
