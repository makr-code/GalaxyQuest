/**
 * NPCPathfindingCompute.js
 *
 * GPU-accelerated NPC steering and pathfinding via WebGPU Compute Shaders.
 *
 * Each NPC agent is described by:
 *   - position (vec3)         — current world position
 *   - velocity (vec3)         — current velocity
 *   - target (vec3)           — waypoint / destination
 *   - maxSpeed (f32)          — top speed (ly/s)
 *   - maxForce (f32)          — max steering force per frame
 *   - arrivalRadius (f32)     — slow-down + stop within this radius
 *   - separationRadius (f32)  — avoid-overlap distance to neighbours
 *   - enabled (u32)           — 0 = skip this slot (arrived / inactive)
 *
 * Three behaviours are computed **in parallel** for all N agents:
 *   1. **Seek / Arrive** — steer towards target, decelerate inside arrivalRadius
 *   2. **Separation**    — repulsion from near neighbours (within separationRadius)
 *   3. **Speed cap**     — velocity never exceeds maxSpeed
 *
 * The output is an updated agents array with new position + velocity.
 * Readback is double-buffered (same pattern as WebGPUPhysics) to avoid
 * GPU→CPU stalls.
 *
 * ## CPU Interface
 *
 *   Each agent slot occupies AGENT_STRIDE (= 16) floats (64 bytes):
 *
 *   [0..2]   position.xyz        (float32 × 3)
 *   [3]      maxSpeed            (float32)
 *   [4..6]   velocity.xyz        (float32 × 3)
 *   [7]      maxForce            (float32)
 *   [8..10]  target.xyz          (float32 × 3)
 *   [11]     arrivalRadius       (float32)
 *   [12]     separationRadius    (float32)
 *   [13]     enabled             (float32 — 0 or 1)
 *   [14..15] padding             (float32 × 2)
 *
 * ## Inspiration
 *   - Reynolds, C.W. (1999): "Steering Behaviors For Autonomous Characters"
 *     https://www.red3d.com/cwr/steer/
 *   - WebGPU Samples (Apache 2.0): compute boids
 *     https://github.com/webgpu/webgpu-samples/tree/main/sample/computeBoids
 *   - Babylon.js (Apache 2.0): PathFinder + CrowdNavigationPlugin
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** Floats per agent slot. */
const AGENT_STRIDE = 16;
/** Bytes per agent slot (AGENT_STRIDE × 4). */
const AGENT_BYTES = AGENT_STRIDE * 4;
/** Workgroup size — must match @workgroup_size in WGSL. */
const PATHFIND_WORKGROUP_SIZE = 64;

// ---------------------------------------------------------------------------
// WGSL Compute Shader
// ---------------------------------------------------------------------------

const PATHFIND_WGSL = /* wgsl */`
// -----------------------------------------------------------------------
// GalaxyQuest — GPU NPC Pathfinding Compute Shader
// Steering behaviours: Seek/Arrive + Separation
//
// Reynolds steering: "Steering Behaviors For Autonomous Characters" (1999)
// Adapted from WebGPU Samples compute boids pattern (Apache 2.0)
// https://github.com/webgpu/webgpu-samples
// -----------------------------------------------------------------------

struct Agent {
  pos             : vec3<f32>,
  maxSpeed        : f32,
  vel             : vec3<f32>,
  maxForce        : f32,
  target          : vec3<f32>,
  arrivalRadius   : f32,
  separationRadius: f32,
  enabled         : f32,
  _pad            : vec2<f32>,
}

struct Params {
  dt         : f32,
  agentCount : u32,
  _pad       : vec2<u32>,
}

@group(0) @binding(0) var<uniform>             params    : Params;
@group(0) @binding(1) var<storage, read>       agentsIn  : array<Agent>;
@group(0) @binding(2) var<storage, read_write> agentsOut : array<Agent>;

// -----------------------------------------------------------------------
// Seek / Arrive — steer towards target, decelerate inside arrivalRadius
// -----------------------------------------------------------------------
fn seek_arrive(agent: Agent) -> vec3<f32> {
  let toTarget = agent.target - agent.pos;
  let dist     = length(toTarget);

  if (dist < 0.001) {
    return vec3<f32>(0.0);
  }

  let dir      = toTarget / dist;
  var desiredSpeed = agent.maxSpeed;

  // Arrive: linearly ramp down speed inside arrival radius
  if (dist < agent.arrivalRadius) {
    desiredSpeed = agent.maxSpeed * (dist / agent.arrivalRadius);
  }

  let desired  = dir * desiredSpeed;
  let steer    = desired - agent.vel;
  let steerLen = length(steer);

  if (steerLen > agent.maxForce) {
    return (steer / steerLen) * agent.maxForce;
  }
  return steer;
}

// -----------------------------------------------------------------------
// Separation — push away from neighbours within separationRadius
// -----------------------------------------------------------------------
fn separation(selfIdx: u32, agent: Agent) -> vec3<f32> {
  var force = vec3<f32>(0.0);
  var count = 0u;

  for (var i: u32 = 0u; i < params.agentCount; i++) {
    if (i == selfIdx) { continue; }
    let other = agentsIn[i];
    if (other.enabled < 0.5) { continue; }

    let diff = agent.pos - other.pos;
    let dist = length(diff);

    if (dist < agent.separationRadius && dist > 0.001) {
      // Inverse distance weighting — stronger repulsion when very close
      force += (diff / dist) * (agent.separationRadius / max(dist, 0.001) - 1.0);
      count += 1u;
    }
  }

  if (count == 0u) {
    return vec3<f32>(0.0);
  }

  let avg      = force / f32(count);
  let avgLen   = length(avg);
  if (avgLen > agent.maxForce) {
    return (avg / avgLen) * agent.maxForce;
  }
  return avg;
}

// -----------------------------------------------------------------------
@compute @workgroup_size(${PATHFIND_WORKGROUP_SIZE})
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.agentCount) { return; }

  let a   = agentsIn[idx];
  var out = a;

  if (a.enabled < 0.5) {
    agentsOut[idx] = out;
    return;
  }

  // Combine steering forces (seek+arrive has priority; separation is secondary)
  let steerSeek = seek_arrive(a);
  let steerSep  = separation(idx, a);

  // Weight: seek = 1.0, separation = 0.6
  let totalForce = steerSeek + steerSep * 0.6;

  // Integrate velocity
  var vel = a.vel + totalForce * params.dt;

  // Speed cap
  let sp = length(vel);
  if (sp > a.maxSpeed) {
    vel = (vel / sp) * a.maxSpeed;
  }

  out.vel = vel;
  out.pos = a.pos + vel * params.dt;

  // Mark as arrived (disable) when within a small fraction of arrivalRadius
  let remaining = length(a.target - out.pos);
  if (remaining < a.arrivalRadius * 0.05 && sp < a.maxSpeed * 0.08) {
    out.enabled = 0.0;
    out.vel     = vec3<f32>(0.0);
  }

  agentsOut[idx] = out;
}
`;

// ---------------------------------------------------------------------------
// NPCPathfindingCompute class
// ---------------------------------------------------------------------------

class NPCPathfindingCompute {
  /**
   * @param {GPUDevice} device
   */
  constructor(device) {
    this._device          = device;
    this._pipeline        = null;
    this._paramBuf        = null;
    /** @type {GPUBuffer[]} Ping-pong agent state buffers */
    this._agentBufs       = [null, null];
    /** @type {GPUBuffer[]} Double-buffered staging for readback */
    this._stagingBufs     = [null, null];
    this._stagingPing     = 0;
    /** @type {Promise<number|null>|null} */
    this._pendingReadback = null;
    this._pingIdx         = 0;
    this._agentCount      = 0;
    this._initialized     = false;
    /** Ordered agent IDs matching the buffer layout (for readback reconcile) */
    this._agentIds        = [];
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  /** Compile the compute pipeline. Call once after device is ready. */
  init() {
    const module = this._device.createShaderModule({
      label: 'gq-npc-pathfind-cs',
      code: PATHFIND_WGSL,
    });
    this._pipeline = this._device.createComputePipeline({
      label:   'gq-npc-pathfind-pipeline',
      layout:  'auto',
      compute: { module, entryPoint: 'cs_main' },
    });
    this._initialized = true;
  }

  // ---------------------------------------------------------------------------
  // Agent management
  // ---------------------------------------------------------------------------

  /**
   * Upload a collection of NPC agent states to the GPU.
   * Call whenever agents are added, removed, or need a full re-sync.
   *
   * @param {Map<number|string, Object>} agents
   *   Each value must have at minimum:
   *     position   {x,y,z}  — current position
   *     velocity   {x,y,z}  — current velocity
   *     target     {x,y,z}  — current waypoint / destination
   *     maxSpeed   number   — top speed
   *     maxForce   number   — steering force cap (default: 0.5 × maxSpeed)
   *     arrivalRadius       number  — (default: 10)
   *     separationRadius    number  — (default: 5)
   *     enabled    boolean  — skip if false
   */
  uploadAgents(agents) {
    this._agentCount = agents.size;
    if (this._agentCount === 0) return;

    this._agentIds = [...agents.keys()];
    const data = new Float32Array(this._agentCount * AGENT_STRIDE);

    let i = 0;
    for (const a of agents.values()) {
      const off = i * AGENT_STRIDE;
      const pos = a.position ?? a.pos ?? { x: 0, y: 0, z: 0 };
      const vel = a.velocity ?? a.vel ?? { x: 0, y: 0, z: 0 };
      const tgt = a.target   ?? { x: 0, y: 0, z: 0 };
      const maxSpeed = Math.max(0.001, Number(a.maxSpeed || 1));

      data[off + 0]  = Number(pos.x || 0);
      data[off + 1]  = Number(pos.y || 0);
      data[off + 2]  = Number(pos.z || 0);
      data[off + 3]  = maxSpeed;
      data[off + 4]  = Number(vel.x || 0);
      data[off + 5]  = Number(vel.y || 0);
      data[off + 6]  = Number(vel.z || 0);
      data[off + 7]  = Math.max(0.001, Number(a.maxForce ?? (maxSpeed * 0.5)));
      data[off + 8]  = Number(tgt.x || 0);
      data[off + 9]  = Number(tgt.y || 0);
      data[off + 10] = Number(tgt.z || 0);
      data[off + 11] = Math.max(0.01, Number(a.arrivalRadius ?? 10));
      data[off + 12] = Math.max(0.01, Number(a.separationRadius ?? 5));
      data[off + 13] = a.enabled === false ? 0 : 1;
      // [14..15] padding
      i++;
    }

    const byteSize = data.byteLength;
    const storageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

    if (!this._agentBufs[0] || this._agentBufs[0].size !== byteSize) {
      this._agentBufs[0]?.destroy();
      this._agentBufs[1]?.destroy();
      this._stagingBufs[0]?.destroy();
      this._stagingBufs[1]?.destroy();

      this._agentBufs[0]  = this._device.createBuffer({ size: byteSize, usage: storageUsage });
      this._agentBufs[1]  = this._device.createBuffer({ size: byteSize, usage: storageUsage });

      const stagingUsage = GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
      this._stagingBufs[0] = this._device.createBuffer({ size: byteSize, usage: stagingUsage });
      this._stagingBufs[1] = this._device.createBuffer({ size: byteSize, usage: stagingUsage });

      this._stagingPing     = 0;
      this._pendingReadback = null;
    }

    this._device.queue.writeBuffer(this._agentBufs[this._pingIdx], 0, data);
    this._rebuildParamBuf();
  }

  // ---------------------------------------------------------------------------
  // Step
  // ---------------------------------------------------------------------------

  /**
   * Dispatch one pathfinding step for all agents.
   * Starts the async GPU→CPU copy immediately (double-buffer pattern).
   * Results are applied via readback() one frame later — zero frame-block.
   *
   * @param {number} dtSeconds
   */
  step(dtSeconds) {
    if (!this._initialized || !this._pipeline || this._agentCount === 0) return;

    this._updateDt(dtSeconds);

    const inBuf  = this._agentBufs[this._pingIdx];
    const outBuf = this._agentBufs[this._pingIdx ^ 1];

    const bindGroup = this._device.createBindGroup({
      layout: this._pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._paramBuf } },
        { binding: 1, resource: { buffer: inBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });

    const workgroups = Math.ceil(this._agentCount / PATHFIND_WORKGROUP_SIZE);
    const encoder    = this._device.createCommandEncoder();
    const pass       = encoder.beginComputePass({ label: 'gq-npc-pathfind-pass' });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();

    const stagingIdx = this._stagingPing;
    const byteSize   = this._agentCount * AGENT_BYTES;
    encoder.copyBufferToBuffer(outBuf, 0, this._stagingBufs[stagingIdx], 0, byteSize);

    this._device.queue.submit([encoder.finish()]);

    this._pendingReadback = this._stagingBufs[stagingIdx]
      .mapAsync(GPUMapMode.READ, 0, byteSize)
      .then(() => stagingIdx)
      .catch(() => null);

    this._pingIdx    ^= 1;
    this._stagingPing ^= 1;
  }

  // ---------------------------------------------------------------------------
  // Readback
  // ---------------------------------------------------------------------------

  /**
   * Apply the GPU pathfinding result from the previous frame's async copy.
   *
   * Reconciles position, velocity, and enabled-flag back into the JS agents Map.
   * Returns an array of IDs for agents that completed their path this step.
   *
   * @param {Map<number|string, Object>} agents  — same Map passed to uploadAgents()
   * @returns {Promise<Array<number|string>>}     — IDs of newly-arrived agents
   */
  async readback(agents) {
    if (!this._pendingReadback || this._agentCount === 0) return [];

    const stagingIdx = await this._pendingReadback;
    this._pendingReadback = null;

    if (stagingIdx === null) return [];

    const byteSize = this._agentCount * AGENT_BYTES;
    const raw = new Float32Array(
      this._stagingBufs[stagingIdx].getMappedRange(0, byteSize).slice(0),
    );
    this._stagingBufs[stagingIdx].unmap();

    const arrived = [];
    for (let i = 0; i < this._agentIds.length; i++) {
      const id  = this._agentIds[i];
      const a   = agents.get(id);
      if (!a) continue;

      const off = i * AGENT_STRIDE;
      const prevEnabled = a.enabled !== false;
      const nowEnabled  = raw[off + 13] > 0.5;

      const pos = a.position ?? a.pos ?? {};
      pos.x = raw[off + 0];
      pos.y = raw[off + 1];
      pos.z = raw[off + 2];
      if (!a.position) a.pos = pos; else a.position = pos;

      const vel = a.velocity ?? a.vel ?? {};
      vel.x = raw[off + 4];
      vel.y = raw[off + 5];
      vel.z = raw[off + 6];
      if (!a.velocity) a.vel = vel; else a.velocity = vel;

      if (prevEnabled && !nowEnabled) {
        a.enabled = false;
        arrived.push(id);
      }
    }
    return arrived;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Manually disable (stop) a single agent by ID without a full re-upload.
   * The change is written directly into the active GPU buffer at the agent's
   * slot offset.
   *
   * @param {number|string} agentId
   */
  disableAgent(agentId) {
    const idx = this._agentIds.indexOf(agentId);
    if (idx < 0 || !this._agentBufs[this._pingIdx]) return;
    const off  = idx * AGENT_BYTES + 13 * 4; // float[13] = enabled
    const zero = new Float32Array([0]);
    this._device.queue.writeBuffer(this._agentBufs[this._pingIdx], off, zero.buffer, 0, 4);
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose() {
    this._agentBufs[0]?.destroy();
    this._agentBufs[1]?.destroy();
    this._stagingBufs[0]?.destroy();
    this._stagingBufs[1]?.destroy();
    this._paramBuf?.destroy();
    this._agentBufs   = [null, null];
    this._stagingBufs = [null, null];
    this._paramBuf    = null;
    this._pendingReadback = null;
    this._agentIds    = [];
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _rebuildParamBuf() {
    this._paramBuf?.destroy();
    // Params struct: dt(f32), agentCount(u32), pad(u32 × 2) → 16 bytes
    const data = new Float32Array(4);
    data[0] = 0;               // dt — filled per-step
    const uints = new Uint32Array(data.buffer);
    uints[1] = this._agentCount;
    // [2..3] padding

    this._paramBuf = this._device.createBuffer({
      size:  16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._device.queue.writeBuffer(this._paramBuf, 0, data);
  }

  _updateDt(dt) {
    const data = new Float32Array([Math.max(0, Number(dt || 0))]);
    this._device.queue.writeBuffer(this._paramBuf, 0, data.buffer, 0, 4);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NPCPathfindingCompute, AGENT_STRIDE, AGENT_BYTES, PATHFIND_WORKGROUP_SIZE, PATHFIND_WGSL };
} else if (typeof window !== 'undefined') {
  window.GQNPCPathfindingCompute = NPCPathfindingCompute;
}
