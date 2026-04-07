/**
 * HybridPhysicsEngine.js
 *
 * CPU+GPU Hybrid Physics Engine for GalaxyQuest.
 *
 * Wraps the CPU-authoritative SpacePhysicsEngine and the GPU-accelerated
 * WebGPUPhysics compute path.  Automatically selects the GPU path when:
 *   - a WebGPU device is available, AND
 *   - the body count exceeds `gpuThreshold` (default: 32)
 *
 * The CPU engine remains the source of truth for game logic (collision
 * detection, body lifecycle, thrust commands).  After each GPU step the
 * computed positions + velocities are reconciled back into the CPU bodies.
 *
 * ## Frame lifecycle
 *
 *   step(dt)       — picks GPU or CPU path; GPU path fires step() + begins
 *                    async readback concurrently with the next CPU frame.
 *   syncReadback() — awaits pending GPU readback and writes results to CPU.
 *                    Call once per frame, after step().
 *   createBody()   — delegates to the CPU engine; upload to GPU on next step.
 *   removeBody()   — delegates to CPU engine; GPU buffers rebuilt on next step.
 *
 * ## Inspired by
 *   - Babylon.js (Apache 2.0): PhysicsEngine abstraction
 *     https://github.com/BabylonJS/Babylon.js
 *   - Three.js (MIT): Object3D update lifecycle
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** Body count below which the CPU path is always used. */
const DEFAULT_GPU_THRESHOLD = 32;

class HybridPhysicsEngine {
  /**
   * @param {Object}         opts
   * @param {GPUDevice|null} [opts.device]         — WebGPU device (null = CPU-only)
   * @param {number}         [opts.gpuThreshold]   — min bodies to enable GPU path
   * @param {number}         [opts.gravitationalConstant]
   * @param {number}         [opts.softening]
   * @param {number}         [opts.maxAcceleration]
   * @param {number}         [opts.defaultDrag]
   * @param {Object}         [opts._cpuEngine]     — inject a pre-built SpacePhysicsEngine (for testing)
   * @param {Object}         [opts._gpuEngine]     — inject a pre-built WebGPUPhysics (for testing)
   */
  constructor(opts = {}) {
    const engineOpts = {
      gravitationalConstant: opts.gravitationalConstant,
      softening:             opts.softening,
      maxAcceleration:       opts.maxAcceleration,
      defaultDrag:           opts.defaultDrag,
    };

    // CPU engine — always available
    this._cpu = opts._cpuEngine ?? _buildCpuEngine(engineOpts);

    // GPU engine — optional
    const device = opts.device ?? null;
    this._gpu = opts._gpuEngine ?? (device ? _buildGpuEngine(device, engineOpts) : null);

    this._gpuThreshold   = Math.max(1, Number(opts.gpuThreshold ?? DEFAULT_GPU_THRESHOLD));
    this._gpuReady       = false;  // true once _gpu.init() has been called
    this._gpuDirty       = true;   // true when CPU bodies must be re-uploaded to GPU

    /**
     * 'auto' | 'gpu' | 'cpu'
     *  'auto' = use GPU when body count >= gpuThreshold and GPU is available.
     */
    this.mode = 'auto';

    /** Read-only: which backend ran last step. 'gpu' | 'cpu' | null */
    this.lastBackend = null;

    /** Forwarded SpacePhysicsEngine constants */
    this.G           = this._cpu.G;
    this.softening   = this._cpu.softening;
    this.maxAcceleration = this._cpu.maxAcceleration;
  }

  // ---------------------------------------------------------------------------
  // Body management (delegated to CPU — GPU buffers rebuilt lazily)
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} options — same as SpacePhysicsEngine.createBody()
   * @returns {Object} body
   */
  createBody(options = {}) {
    const body = this._cpu.createBody(options);
    this._gpuDirty = true;
    return body;
  }

  /**
   * @param {number|Object} bodyOrId
   */
  removeBody(bodyOrId) {
    this._cpu.removeBody(bodyOrId);
    this._gpuDirty = true;
  }

  /** @returns {Map<number, Object>} */
  get bodies() {
    return this._cpu.bodies;
  }

  // ---------------------------------------------------------------------------
  // Step
  // ---------------------------------------------------------------------------

  /**
   * Advance the simulation by `dtSeconds`.
   *
   * Selects the GPU path when:
   *   - mode === 'gpu'  (forced), OR
   *   - mode === 'auto' AND GPU is available AND body count >= gpuThreshold
   *
   * On the GPU path the step fires a GPU compute dispatch and starts an async
   * readback, but does NOT block.  Call syncReadback() once per frame to
   * apply GPU results.
   *
   * On the CPU path the result is synchronous and immediately available.
   *
   * @param {number} dtSeconds
   */
  step(dtSeconds) {
    const dt = Math.max(0, Number(dtSeconds || 0));
    const bodyCount = this._cpu.bodies.size;

    if (this._shouldUseGpu(bodyCount)) {
      this._stepGpu(dt);
      this.lastBackend = 'gpu';
    } else {
      this._stepCpu(dt);
      this.lastBackend = 'cpu';
    }
  }

  // ---------------------------------------------------------------------------
  // Readback (GPU path only)
  // ---------------------------------------------------------------------------

  /**
   * Await the pending GPU→CPU readback and apply results to the CPU body Map.
   * No-op on the CPU path.  Call once per frame, after step().
   *
   * @returns {Promise<void>}
   */
  async syncReadback() {
    if (!this._gpu || this.lastBackend !== 'gpu') return;
    await this._gpu.readback(this._cpu.bodies);
  }

  // ---------------------------------------------------------------------------
  // SpacePhysicsEngine helpers (forwarded)
  // ---------------------------------------------------------------------------

  /**
   * Compute gravitational acceleration at a position from a list of sources.
   * Always runs on CPU.
   */
  computeGravityAt(position, sources) {
    return this._cpu.computeGravityAt(position, sources);
  }

  /**
   * Step a single body (CPU).  Useful for NPC pathfinding at low frequency.
   */
  stepBody(body, dtSeconds, options) {
    return this._cpu.stepBody(body, dtSeconds, options);
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose() {
    this._gpu?.dispose?.();
    this._gpu  = null;
    this._cpu  = null;
    this.lastBackend = null;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _shouldUseGpu(bodyCount) {
    if (this.mode === 'gpu') return !!this._gpu;
    if (this.mode === 'cpu') return false;
    // 'auto'
    return !!this._gpu && bodyCount >= this._gpuThreshold;
  }

  _ensureGpuReady() {
    if (!this._gpuReady && this._gpu) {
      this._gpu.init();
      this._gpuReady = true;
    }
  }

  _stepGpu(dt) {
    this._ensureGpuReady();
    if (this._gpuDirty) {
      this._gpu.uploadBodies(this._cpu.bodies);
      this._gpuDirty = false;
    }
    this._gpu.step(dt);
  }

  _stepCpu(dt) {
    const sources = [...this._cpu.bodies.values()];
    for (const body of this._cpu.bodies.values()) {
      this._cpu.stepBody(body, dt, { gravitySources: sources });
    }
  }
}

// ---------------------------------------------------------------------------
// Factory helpers — separated so tests can inject mocks
// ---------------------------------------------------------------------------

function _buildCpuEngine(opts) {
  // Browser path: SpacePhysicsEngine lives on window.GQSpacePhysicsEngine
  if (typeof window !== 'undefined' && window.GQSpacePhysicsEngine) {
    return window.GQSpacePhysicsEngine.create(opts);
  }
  // Node.js / test path: require directly
  if (typeof require !== 'undefined') {
    try {
      const mod = require('../../telemetry/space-physics-engine.js');
      return new (mod.SpacePhysicsEngine || mod)(opts);
    } catch (_) {}
  }
  throw new Error('[HybridPhysicsEngine] SpacePhysicsEngine not available');
}

function _buildGpuEngine(device, opts) {
  if (typeof window !== 'undefined' && window.GQWebGPUPhysics) {
    return new window.GQWebGPUPhysics(device, opts);
  }
  if (typeof require !== 'undefined') {
    try {
      const { WebGPUPhysics } = require('./WebGPUPhysics.js');
      return new WebGPUPhysics(device, opts);
    } catch (_) {}
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HybridPhysicsEngine };
} else {
  window.GQHybridPhysicsEngine = HybridPhysicsEngine;
}
