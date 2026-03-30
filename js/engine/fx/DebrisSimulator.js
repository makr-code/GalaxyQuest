/**
 * DebrisSimulator.js — GPU-driven debris chunk physics (Phase FX-6).
 *
 * When a WebGPU device is available, all debris chunks are uploaded to a
 * `GPUBuffer` and advanced each frame via `debris.wgsl` (WebGPUCompute).
 * The renderer reads back transformed positions/rotations directly from GPU
 * memory, avoiding the CPU-side tumble loop in EnvironmentFX.
 *
 * When no GPU device is provided (test environment, WebGL fallback), the
 * simulator runs a pure-JS CPU path that is semantically identical to the
 * compute shader, so behaviour is consistent on all platforms.
 *
 * Buffer layout (per chunk, 96 bytes = 24 × f32):
 *   [0]  px  [1]  py  [2]  pz  [3]  vx
 *   [4]  vy  [5]  vz  [6]  rotX  [7]  rotY
 *   [8]  rotZ  [9] angVelX [10] angVelY [11] angVelZ
 *   [12] scale [13] drag  [14] lifetime [15] active
 *   [16-23] reserved
 *
 * Inspired by:
 *   FreeSpace 2 (1999, Volition) — debris tumble physics
 *   Homeworld   (1999, Relic)   — zero-g rigid-body integration
 *   WebGPU Samples (Apache 2.0) — compute buffer update patterns
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Float32s per chunk in the GPU buffer (24 × 4 bytes = 96 bytes). */
const FLOATS_PER_CHUNK = 24;

/** Default angular-drag fraction per second (gyroscopic damping). */
const DEFAULT_ANG_DRAG = 0.01;

// ---------------------------------------------------------------------------
// Field offsets (indices into a Float32Array row)
// ---------------------------------------------------------------------------
const F_PX       =  0;
const F_PY       =  1;
const F_PZ       =  2;
const F_VX       =  3;
const F_VY       =  4;
const F_VZ       =  5;
const F_ROTX     =  6;
const F_ROTY     =  7;
const F_ROTZ     =  8;
const F_ANGVELX  =  9;
const F_ANGVELY  = 10;
const F_ANGVELZ  = 11;
const F_SCALE    = 12;
const F_DRAG     = 13;
const F_LIFETIME = 14;
const F_ACTIVE   = 15;
// 16-23 reserved

const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class DebrisSimulator {
  /**
   * @param {object}     [opts]
   * @param {object|null}[opts.device]     - WebGPU GPUDevice; null → CPU fallback
   * @param {number}     [opts.capacity=512] - Max simultaneously live chunks
   * @param {number}     [opts.angDrag=0.01] - Angular drag per second
   */
  constructor(opts = {}) {
    this._capacity = opts.capacity ?? 512;
    this._angDrag  = opts.angDrag  ?? DEFAULT_ANG_DRAG;
    this._device   = opts.device   ?? null;

    // CPU-side Float32Array mirror (always maintained for readback / fallback)
    this._data = new Float32Array(this._capacity * FLOATS_PER_CHUNK);

    /** Sparse slot map: chunkId → buffer slot index */
    this._slotByChunkId = new Map();

    /** Free slots available for allocation */
    this._freeSlots = Array.from({ length: this._capacity }, (_, i) => i);

    /** Live slot count */
    this._liveCount = 0;

    // GPU resources (null until _initGPU is called)
    this._gpuBuffer     = null;
    this._paramBuffer   = null;
    this._compute       = null;
    this._gpuEnabled    = false;

    if (this._device) {
      this._initGPU();
    }
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Upload a debris chunk record (from EnvironmentFX) into the simulation.
   *
   * Accepts either a plain JS object (as produced by EnvironmentFX) or a
   * Float32Array row already formatted for the GPU buffer.
   *
   * @param {object} chunk - Debris chunk record from EnvironmentFX
   * @returns {number} Internal slot index, or -1 if the pool is full
   */
  addChunk(chunk) {
    if (this._freeSlots.length === 0) {
      console.warn('[DebrisSimulator] Pool full — debris chunk dropped');
      return -1;
    }

    const slot = this._freeSlots.pop();
    this._slotByChunkId.set(chunk.id, slot);
    this._liveCount++;

    this._writeSlot(slot, chunk);

    if (this._gpuEnabled) {
      this._uploadSlot(slot);
    }

    return slot;
  }

  /**
   * Remove a chunk from the simulation (marks its slot inactive and frees it).
   * @param {number} chunkId
   */
  removeChunk(chunkId) {
    const slot = this._slotByChunkId.get(chunkId);
    if (slot === undefined) return;

    const base = slot * FLOATS_PER_CHUNK;
    this._data[base + F_ACTIVE] = 0;

    if (this._gpuEnabled) {
      this._uploadSlot(slot);
    }

    this._slotByChunkId.delete(chunkId);
    this._freeSlots.push(slot);
    this._liveCount = Math.max(0, this._liveCount - 1);
  }

  /**
   * Advance all live chunks by `dt` seconds.
   *
   * GPU path: dispatches `debris.wgsl` (one invocation per chunk slot).
   * CPU path: runs the same integration loop in JS.
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
   * Read back the current state of a specific chunk from the CPU mirror.
   * On the GPU path the mirror is not automatically updated — call
   * `syncFromGPU()` first if you need CPU-side readback.
   *
   * @param {number} chunkId
   * @returns {{px,py,pz,rotX,rotY,rotZ,scale,active}|null}
   */
  readChunk(chunkId) {
    const slot = this._slotByChunkId.get(chunkId);
    if (slot === undefined) return null;
    const b = slot * FLOATS_PER_CHUNK;
    const d = this._data;
    return {
      px:     d[b + F_PX],
      py:     d[b + F_PY],
      pz:     d[b + F_PZ],
      rotX:   d[b + F_ROTX],
      rotY:   d[b + F_ROTY],
      rotZ:   d[b + F_ROTZ],
      scale:  d[b + F_SCALE],
      active: d[b + F_ACTIVE] > 0.5,
    };
  }

  /**
   * Asynchronously read back all GPU chunk state into the CPU mirror.
   * No-op on the CPU path.
   *
   * @returns {Promise<void>}
   */
  async syncFromGPU() {
    if (!this._gpuEnabled || !this._gpuBuffer) return;

    const byteSize = this._capacity * FLOATS_PER_CHUNK * 4;
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

  /** @returns {number} Number of currently tracked (live) chunk slots */
  get liveCount() { return this._liveCount; }

  /** @returns {boolean} Whether GPU acceleration is active */
  get gpuEnabled() { return this._gpuEnabled; }

  /** @returns {Float32Array} Raw CPU-side data buffer */
  get dataBuffer() { return this._data; }

  dispose() {
    this._slotByChunkId.clear();
    this._freeSlots = [];
    this._liveCount = 0;
    if (this._gpuBuffer)   { this._gpuBuffer.destroy();   this._gpuBuffer   = null; }
    if (this._paramBuffer) { this._paramBuffer.destroy();  this._paramBuffer = null; }
    if (this._compute)     { this._compute.dispose();      this._compute     = null; }
    this._gpuEnabled = false;
  }

  // =========================================================================
  // Private — CPU simulation path
  // =========================================================================

  /** @private */
  _stepCPU(dt) {
    const d = this._data;
    const linDampBase = 1;   // base; modified per-chunk by chunk.drag
    const angDamp     = Math.max(0, 1 - this._angDrag * dt);

    for (let slot = 0; slot < this._capacity; slot++) {
      const b = slot * FLOATS_PER_CHUNK;
      if (d[b + F_ACTIVE] < 0.5) continue;

      // --- lifetime ---
      const lt = d[b + F_LIFETIME];
      if (lt > 0) {
        const newLt = lt - dt;
        if (newLt <= 0) {
          d[b + F_ACTIVE]   = 0;
          d[b + F_LIFETIME] = 0;
          continue;
        }
        d[b + F_LIFETIME] = newLt;
      }

      // --- linear drag ---
      const drag    = d[b + F_DRAG];
      const linDamp = Math.max(0, linDampBase - drag * dt);
      d[b + F_VX] *= linDamp;
      d[b + F_VY] *= linDamp;
      d[b + F_VZ] *= linDamp;

      // --- integrate position ---
      d[b + F_PX] += d[b + F_VX] * dt;
      d[b + F_PY] += d[b + F_VY] * dt;
      d[b + F_PZ] += d[b + F_VZ] * dt;

      // --- angular drag ---
      d[b + F_ANGVELX] *= angDamp;
      d[b + F_ANGVELY] *= angDamp;
      d[b + F_ANGVELZ] *= angDamp;

      // --- integrate Euler angles ---
      d[b + F_ROTX] += d[b + F_ANGVELX] * dt;
      d[b + F_ROTY] += d[b + F_ANGVELY] * dt;
      d[b + F_ROTZ] += d[b + F_ANGVELZ] * dt;

      // Wrap to [-π, π]
      d[b + F_ROTX] = _wrapAngle(d[b + F_ROTX]);
      d[b + F_ROTY] = _wrapAngle(d[b + F_ROTY]);
      d[b + F_ROTZ] = _wrapAngle(d[b + F_ROTZ]);
    }
  }

  // =========================================================================
  // Private — GPU path
  // =========================================================================

  /** @private — initialise GPU resources */
  _initGPU() {
    const dev      = this._device;
    const byteSize = this._capacity * FLOATS_PER_CHUNK * 4;

    // Storage buffer (read_write) — full pool
    this._gpuBuffer = dev.createBuffer({
      size:  byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: false,
    });

    // Uniform buffer — DebrisSimParams (16 bytes)
    this._paramBuffer = dev.createBuffer({
      size:  16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._gpuEnabled = true;
  }

  /** @private — write one chunk into the CPU Float32Array */
  _writeSlot(slot, chunk) {
    const b = slot * FLOATS_PER_CHUNK;
    const d = this._data;
    d[b + F_PX]       = chunk.px      ?? 0;
    d[b + F_PY]       = chunk.py      ?? 0;
    d[b + F_PZ]       = chunk.pz      ?? 0;
    d[b + F_VX]       = chunk.vx      ?? 0;
    d[b + F_VY]       = chunk.vy      ?? 0;
    d[b + F_VZ]       = chunk.vz      ?? 0;
    d[b + F_ROTX]     = chunk.rotX    ?? 0;
    d[b + F_ROTY]     = chunk.rotY    ?? 0;
    d[b + F_ROTZ]     = chunk.rotZ    ?? 0;
    d[b + F_ANGVELX]  = chunk.angVelX ?? 0;
    d[b + F_ANGVELY]  = chunk.angVelY ?? 0;
    d[b + F_ANGVELZ]  = chunk.angVelZ ?? 0;
    d[b + F_SCALE]    = chunk.scale   ?? 1;
    d[b + F_DRAG]     = chunk.drag    ?? 0;
    d[b + F_LIFETIME] = chunk.lifetime ?? 0;
    d[b + F_ACTIVE]   = chunk.active   ? 1 : 0;
    // reserved slots 16-23 remain 0
  }

  /** @private — upload a single slot to the GPU buffer */
  _uploadSlot(slot) {
    const byteOffset = slot * FLOATS_PER_CHUNK * 4;
    const sliceStart = slot * FLOATS_PER_CHUNK;
    const slice      = this._data.subarray(sliceStart, sliceStart + FLOATS_PER_CHUNK);
    this._device.queue.writeBuffer(this._gpuBuffer, byteOffset, slice);
  }

  /** @private — dispatch the compute shader with the given dt */
  _dispatchGPU(dt) {
    // Update DebrisSimParams uniform
    const params = new Float32Array([dt, this._angDrag, 0, 0]);
    this._device.queue.writeBuffer(this._paramBuffer, 0, params);

    // DebrisSimulator does not hold a pre-compiled pipeline — the host is
    // expected to supply one via setComputePipeline() (advanced usage).
    // Without a pipeline we fall back to CPU for this frame.
    if (!this._compute) {
      this._stepCPU(dt);
    } else {
      const workgroups = Math.ceil(this._capacity / 64);
      this._compute.dispatch(workgroups);
    }
  }

  /**
   * Attach a pre-compiled WebGPUCompute instance (with debris.wgsl pipeline
   * and bind groups already set).  Called by the host renderer after GPU init.
   *
   * @param {object} computeInstance - WebGPUCompute wrapper
   */
  setComputePipeline(computeInstance) {
    this._compute = computeInstance;
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

function _wrapAngle(a) {
  // Wrap to [-π, π] using the same formula as the WGSL shader
  return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DebrisSimulator, FLOATS_PER_CHUNK };
} else {
  window.GQDebrisSimulator = { DebrisSimulator, FLOATS_PER_CHUNK };
}
