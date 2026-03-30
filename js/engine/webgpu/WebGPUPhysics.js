/**
 * WebGPUPhysics.js
 *
 * GPU-accelerated Space Physics via WebGPU Compute Shaders.
 *
 * Adapts the existing SpacePhysicsEngine (js/telemetry/space-physics-engine.js) to run
 * the expensive O(N²) N-body gravity integration entirely on the GPU, then
 * asynchronously reads results back to JS for game-logic consumption.
 *
 * ## How it works
 *
 *  1. All body states (position, velocity, mass, drag, maxSpeed) are packed
 *     into a pair of Storage Buffers (ping-pong pattern).
 *  2. A Compute Shader performs the full gravity + thrust + drag integration
 *     for all bodies in parallel (one workgroup invocation per body).
 *  3. After dispatch, a staging buffer is used for zero-copy async readback.
 *  4. The JS SpacePhysicsEngine is kept as the CPU fallback and authoritative
 *     source of truth for game logic; GPU results are reconciled each frame.
 *
 * ## CPU↔GPU Interface
 *
 *  Each body occupies 16 floats (64 bytes) in the storage buffer:
 *
 *   [0..2]  position.xyz      (float32 × 3)
 *   [3]     mass              (float32)
 *   [4..6]  velocity.xyz      (float32 × 3)
 *   [7]     drag              (float32)
 *   [8..10] thrust.xyz        (float32 × 3)
 *   [11]    maxSpeed          (float32)
 *   [12]    staticBody flag   (float32 — 0 or 1)
 *   [13..15] padding          (float32 × 3)
 *
 * ## Inspiration
 *   - WebGPU Samples (Apache 2.0): compute N-body sample
 *     https://github.com/webgpu/webgpu-samples/tree/main/sample/computeBoids
 *   - Babylon.js (Apache 2.0): ComputeShader / StorageBuffer API
 *     https://github.com/BabylonJS/Babylon.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** Floats per body in the storage buffer layout. */
const BODY_STRIDE = 16;
/** Bytes per body (BODY_STRIDE × 4 bytes/float). */
const BODY_BYTES  = BODY_STRIDE * 4;
/** Workgroup size — must match @workgroup_size in WGSL. */
const WORKGROUP_SIZE = 64;

// ---------------------------------------------------------------------------
// WGSL Compute Shader
// ---------------------------------------------------------------------------

const PHYSICS_WGSL = /* wgsl */`
// -----------------------------------------------------------------------
// GalaxyQuest — GPU N-body Space Physics
// Adapted from WebGPU Samples compute boids pattern (Apache 2.0)
// https://github.com/webgpu/webgpu-samples
// -----------------------------------------------------------------------

struct Body {
  pos      : vec3<f32>,
  mass     : f32,
  vel      : vec3<f32>,
  drag     : f32,
  thrust   : vec3<f32>,
  maxSpeed : f32,
  isStatic : f32,
  _pad     : vec3<f32>,
}

struct Params {
  G              : f32,
  softening      : f32,
  maxAccel       : f32,
  dt             : f32,
  bodyCount      : u32,
  _pad           : vec3<u32>,
}

@group(0) @binding(0) var<uniform>             params   : Params;
@group(0) @binding(1) var<storage, read>       bodiesIn : array<Body>;
@group(0) @binding(2) var<storage, read_write> bodiesOut: array<Body>;

// -----------------------------------------------------------------------
fn gravity_accel(selfPos: vec3<f32>, selfIdx: u32) -> vec3<f32> {
  var acc = vec3<f32>(0.0);
  let soft2 = params.softening * params.softening;

  for (var i: u32 = 0u; i < params.bodyCount; i++) {
    if (i == selfIdx) { continue; }
    let other = bodiesIn[i];
    if (other.mass <= 0.0) { continue; }

    let delta = other.pos - selfPos;
    let r2    = dot(delta, delta) + soft2;
    let invR  = inverseSqrt(max(r2, 1e-9));
    let invR3 = invR * invR * invR;

    acc += delta * (params.G * other.mass * invR3);
  }

  // clamp acceleration magnitude
  let accLen = length(acc);
  if (accLen > params.maxAccel) {
    acc = normalize(acc) * params.maxAccel;
  }
  return acc;
}

// -----------------------------------------------------------------------
@compute @workgroup_size(${WORKGROUP_SIZE})
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.bodyCount) { return; }

  let b = bodiesIn[idx];
  var out = b;

  if (b.isStatic > 0.5) {
    bodiesOut[idx] = out;
    return;
  }

  let grav  = gravity_accel(b.pos, idx);
  let accel = grav + b.thrust;

  var vel   = b.vel + accel * params.dt;

  // drag
  let dragFactor = clamp(1.0 - b.drag * params.dt, 0.0, 1.0);
  vel = vel * dragFactor;

  // speed cap
  if (b.maxSpeed > 0.0) {
    let sp = length(vel);
    if (sp > b.maxSpeed) {
      vel = normalize(vel) * b.maxSpeed;
    }
  }

  out.vel = vel;
  out.pos = b.pos + vel * params.dt;
  bodiesOut[idx] = out;
}
`;

// ---------------------------------------------------------------------------
// WebGPUPhysics class
// ---------------------------------------------------------------------------

class WebGPUPhysics {
  /**
   * @param {GPUDevice} device
   * @param {Object}    [engineOpts]  — same options as SpacePhysicsEngine
   */
  constructor(device, engineOpts = {}) {
    this._device      = device;
    this._G           = engineOpts.gravitationalConstant ?? 9.5e-4;
    this._softening   = engineOpts.softening             ?? 180;
    this._maxAccel    = engineOpts.maxAcceleration       ?? 420;
    this._initialized = false;

    /** @type {GPUComputePipeline|null} */
    this._pipeline    = null;
    /** @type {GPUBuffer|null} Params uniform */
    this._paramBuf    = null;
    /** @type {GPUBuffer[]} Ping-pong state buffers */
    this._stateBufs   = [null, null];
    /** @type {GPUBuffer|null} Readback staging */
    this._stagingBuf  = null;
    /** @type {number} Current ping index (0 or 1) */
    this._pingIdx     = 0;
    /** @type {number} Number of bodies */
    this._bodyCount   = 0;
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  /** Compile the compute pipeline. Call once after device is ready. */
  init() {
    const module = this._device.createShaderModule({
      label: 'gq-physics-cs',
      code: PHYSICS_WGSL,
    });
    this._pipeline = this._device.createComputePipeline({
      label:   'gq-physics-pipeline',
      layout:  'auto',
      compute: { module, entryPoint: 'cs_main' },
    });
    this._initialized = true;
  }

  // ---------------------------------------------------------------------------
  // Body management
  // ---------------------------------------------------------------------------

  /**
   * Upload a set of body states from the JS physics engine into GPU buffers.
   * Call whenever bodies are added / removed or an initial sync is needed.
   *
   * @param {Map<number, Object>} bodies — SpacePhysicsEngine#bodies Map
   */
  uploadBodies(bodies) {
    this._bodyCount = bodies.size;
    if (this._bodyCount === 0) return;

    const data = new Float32Array(this._bodyCount * BODY_STRIDE);
    let i = 0;
    for (const b of bodies.values()) {
      const off = i * BODY_STRIDE;
      data[off + 0]  = b.position.x;
      data[off + 1]  = b.position.y;
      data[off + 2]  = b.position.z;
      data[off + 3]  = b.mass;
      data[off + 4]  = b.velocity.x;
      data[off + 5]  = b.velocity.y;
      data[off + 6]  = b.velocity.z;
      data[off + 7]  = b.drag;
      data[off + 8]  = b.thrust?.x ?? 0;
      data[off + 9]  = b.thrust?.y ?? 0;
      data[off + 10] = b.thrust?.z ?? 0;
      data[off + 11] = b.maxSpeed;
      data[off + 12] = b.staticBody ? 1 : 0;
      // [13..15] padding
      i++;
    }

    const byteSize = data.byteLength;
    const storageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

    // Recreate ping-pong buffers if size changed
    if (!this._stateBufs[0] || this._stateBufs[0].size !== byteSize) {
      this._stateBufs[0]?.destroy();
      this._stateBufs[1]?.destroy();
      this._stagingBuf?.destroy();

      this._stateBufs[0]  = this._device.createBuffer({ size: byteSize, usage: storageUsage });
      this._stateBufs[1]  = this._device.createBuffer({ size: byteSize, usage: storageUsage });
      this._stagingBuf    = this._device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }

    this._device.queue.writeBuffer(this._stateBufs[this._pingIdx], 0, data);
    this._rebuildParamBuf();
  }

  // ---------------------------------------------------------------------------
  // Step
  // ---------------------------------------------------------------------------

  /**
   * Dispatch one physics step on the GPU.
   *
   * @param {number} dtSeconds
   */
  step(dtSeconds) {
    if (!this._initialized || !this._pipeline || this._bodyCount === 0) return;

    // Update dt in uniform
    this._updateDt(dtSeconds);

    const inBuf  = this._stateBufs[this._pingIdx];
    const outBuf = this._stateBufs[this._pingIdx ^ 1];

    const bindGroup = this._device.createBindGroup({
      layout: this._pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._paramBuf } },
        { binding: 1, resource: { buffer: inBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });

    const workgroups = Math.ceil(this._bodyCount / WORKGROUP_SIZE);
    const encoder    = this._device.createCommandEncoder();
    const pass       = encoder.beginComputePass({ label: 'gq-physics-pass' });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    this._device.queue.submit([encoder.finish()]);

    // Swap ping-pong
    this._pingIdx ^= 1;
  }

  // ---------------------------------------------------------------------------
  // Readback
  // ---------------------------------------------------------------------------

  /**
   * Asynchronously read back the current body states from the GPU and
   * reconcile them into the JS SpacePhysicsEngine bodies Map.
   *
   * @param {Map<number, Object>} bodies — SpacePhysicsEngine#bodies Map
   * @returns {Promise<void>}
   */
  async readback(bodies) {
    if (!this._stagingBuf || this._bodyCount === 0) return;

    const srcBuf  = this._stateBufs[this._pingIdx];
    const byteSize = this._bodyCount * BODY_BYTES;

    const encoder = this._device.createCommandEncoder();
    encoder.copyBufferToBuffer(srcBuf, 0, this._stagingBuf, 0, byteSize);
    this._device.queue.submit([encoder.finish()]);

    await this._stagingBuf.mapAsync(GPUMapMode.READ, 0, byteSize);
    const raw  = new Float32Array(this._stagingBuf.getMappedRange(0, byteSize).slice(0));
    this._stagingBuf.unmap();

    let i = 0;
    for (const b of bodies.values()) {
      const off = i * BODY_STRIDE;
      b.position.x = raw[off + 0];
      b.position.y = raw[off + 1];
      b.position.z = raw[off + 2];
      b.velocity.x = raw[off + 4];
      b.velocity.y = raw[off + 5];
      b.velocity.z = raw[off + 6];
      i++;
    }
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose() {
    this._stateBufs[0]?.destroy();
    this._stateBufs[1]?.destroy();
    this._stagingBuf?.destroy();
    this._paramBuf?.destroy();
    this._stateBufs  = [null, null];
    this._stagingBuf = null;
    this._paramBuf   = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _rebuildParamBuf() {
    this._paramBuf?.destroy();
    // Params struct: G, softening, maxAccel, dt, bodyCount, pad×3  → 8 floats = 32 bytes
    const data = new Float32Array(8);
    data[0] = this._G;
    data[1] = this._softening;
    data[2] = this._maxAccel;
    data[3] = 0;               // dt — filled per-step
    const countView = new Uint32Array(data.buffer);
    countView[4] = this._bodyCount;
    // [5..7] padding

    this._paramBuf = this._device.createBuffer({
      size:  32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._device.queue.writeBuffer(this._paramBuf, 0, data);
  }

  _updateDt(dt) {
    const data = new Float32Array([dt]);
    // dt is at byte offset 12 (float index 3)
    this._device.queue.writeBuffer(this._paramBuf, 12, data);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPUPhysics, BODY_STRIDE, BODY_BYTES, PHYSICS_WGSL };
} else {
  window.GQWebGPUPhysics = { WebGPUPhysics, BODY_STRIDE, BODY_BYTES };
}
