/**
 * EconomyComputeEngine.js
 *
 * GPU-accelerated colony economy tick via WebGPU Compute Shaders.
 *
 * Three sequential compute passes per tick:
 *   Pass 0 — Resource production  (buildings × bonuses → goods produced)
 *   Pass 1 — Consumption          (pop-class needs consumed from stock)
 *   Pass 2 — Market price delta   (supply/demand → price adjustment)
 *
 * The CPU layer remains authoritative for pop advancement, event lifecycle,
 * and research unlock checks.
 *
 * ## CPU Interface
 *   engine = new EconomyComputeEngine({ device });
 *   await engine.init();
 *   engine.setColonies(coloniesArray);
 *   await engine.tick(dt);
 *   const results = engine.getResults(); // [{ produced, consumed, priceDelta }]
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const COLONY_STRIDE           = 64;   // float32 slots per colony
const COLONY_BYTES            = COLONY_STRIDE * 4;
const RESULT_STRIDE           = 48;   // float32 slots per result (12+12+12+12 pad)
const RESULT_BYTES            = RESULT_STRIDE * 4;
const GOOD_STRIDE             = 4;    // supply, demand, priceMult, pad
const GOOD_BYTES              = GOOD_STRIDE * 4;
const ECONOMY_WORKGROUP_SIZE  = 64;
const NUM_PASSES              = 3;

// ---------------------------------------------------------------------------
// WGSL shader (inline)
// ---------------------------------------------------------------------------

const ECONOMY_WGSL = `
struct ColonyData {
  buildings  : array<f32, 8>,
  bonuses    : array<f32, 8>,
  popClass   : array<f32, 6>,
  stock      : array<f32, 12>,
  population : f32,
  dt         : f32,
  _align     : array<f32, 20>,
}

struct GoodData {
  supply    : f32,
  demand    : f32,
  priceMult : f32,
  _pad      : f32,
}

struct ResultData {
  produced   : array<f32, 12>,
  consumed   : array<f32, 12>,
  priceDelta : array<f32, 12>,
  _align     : array<f32, 12>,
}

@group(0) @binding(0) var<storage, read>       colonies : array<ColonyData>;
@group(0) @binding(1) var<storage, read>       goods    : array<GoodData>;
@group(0) @binding(2) var<storage, read_write> results  : array<ResultData>;
@group(0) @binding(3) var<uniform>             passIdx  : u32;

const BASE_PRODUCTION : array<f32, 8> = array<f32, 8>(
  2.0, 1.5, 1.2, 0.8, 3.0, 2.5, 1.0, 0.5,
);
const POP_CONSUMPTION : array<f32, 6> = array<f32, 6>(
  0.05, 0.08, 0.12, 0.15, 0.10, 0.18,
);
const PRICE_ELASTICITY : f32 = 0.04;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let colIdx = gid.x;
  if (colIdx >= arrayLength(&colonies)) { return; }

  let col = colonies[colIdx];
  let dt  = col.dt;

  if (passIdx == 0u) {
    var produced : array<f32, 12>;
    for (var i : u32 = 0u; i < 8u; i++) {
      let amount = col.buildings[i] * BASE_PRODUCTION[i] * col.bonuses[i] * dt;
      if (i < 12u) { produced[i] = amount; }
    }
    results[colIdx].produced = produced;

  } else if (passIdx == 1u) {
    var consumed : array<f32, 12>;
    for (var cls : u32 = 0u; cls < 6u; cls++) {
      let popCount = col.popClass[cls];
      if (popCount <= 0.0) { continue; }
      let rate    = POP_CONSUMPTION[cls] * popCount * dt;
      let goodIdx = cls % 12u;
      consumed[goodIdx] += min(rate, col.stock[goodIdx]);
    }
    results[colIdx].consumed = consumed;

  } else if (passIdx == 2u) {
    var priceDelta : array<f32, 12>;
    let numGoods = min(arrayLength(&goods), 12u);
    for (var g : u32 = 0u; g < numGoods; g++) {
      priceDelta[g] = -(results[colIdx].produced[g] - results[colIdx].consumed[g]) * PRICE_ELASTICITY;
    }
    results[colIdx].priceDelta = priceDelta;
  }
}
`;

// ---------------------------------------------------------------------------
// EconomyComputeEngine
// ---------------------------------------------------------------------------

function _writeArray(target, offset, src, len) {
  for (let i = 0; i < len; i++) {
    target[offset + i] = Number(src[i] ?? 0);
  }
}

class EconomyComputeEngine {
  /**
   * @param {object}         opts
   * @param {GPUDevice|null} [opts.device]       WebGPU device (null → CPU fallback)
   * @param {number}         [opts.maxColonies=256]
   * @param {number}         [opts.numGoods=12]
   */
  constructor(opts = {}) {
    this._device      = opts.device ?? null;
    this._maxColonies = Math.max(1, Number(opts.maxColonies ?? 256));
    this._numGoods    = Math.max(1, Number(opts.numGoods    ?? 12));
    this._pipeline    = null;
    this._colonyBuf   = null;
    this._goodBuf     = null;
    this._resultBuf   = null;
    this._readBuf     = null;
    this._passBufs    = [];
    this._bindGroups  = [];
    this._ready       = false;
    this._colonies    = [];
    this._results     = [];
  }

  get isGpuAvailable() { return this._device !== null; }
  get results()        { return this._results; }

  /**
   * Initialise GPU resources.  Must be awaited once before tick().
   * No-op when device is null.
   */
  async init() {
    if (!this._device) return;
    const device = this._device;

    const module   = device.createShaderModule({ code: ECONOMY_WGSL });
    this._pipeline = await device.createComputePipelineAsync({
      layout:  'auto',
      compute: { module, entryPoint: 'main' },
    });

    this._colonyBuf = device.createBuffer({
      size:  this._maxColonies * COLONY_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._goodBuf = device.createBuffer({
      size:  this._numGoods * GOOD_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._resultBuf = device.createBuffer({
      size:  this._maxColonies * RESULT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this._readBuf = device.createBuffer({
      size:  this._maxColonies * RESULT_BYTES,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    for (let p = 0; p < NUM_PASSES; p++) {
      const buf = device.createBuffer({
        size:  4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buf, 0, new Uint32Array([p]));
      this._passBufs.push(buf);

      this._bindGroups.push(device.createBindGroup({
        layout:  this._pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this._colonyBuf } },
          { binding: 1, resource: { buffer: this._goodBuf   } },
          { binding: 2, resource: { buffer: this._resultBuf } },
          { binding: 3, resource: { buffer: buf             } },
        ],
      }));
    }

    this._ready = true;
  }

  /**
   * Set the colony array to process on the next tick().
   * @param {Array<object>} colonies
   */
  setColonies(colonies) {
    this._colonies = Array.isArray(colonies) ? colonies : [];
  }

  /**
   * Run the 3-pass economy compute tick and readback results.
   * Falls back to a CPU stub when GPU unavailable.
   *
   * @param {number} dt  delta time in game-seconds
   */
  async tick(dt) {
    if (!this._device || !this._ready) {
      this._cpuFallbackTick(dt);
      return;
    }

    const colonies = this._colonies;
    const n        = Math.min(colonies.length, this._maxColonies);
    if (n === 0) { this._results = []; return; }

    // Upload colony data
    const colData = new Float32Array(n * COLONY_STRIDE);
    for (let i = 0; i < n; i++) {
      const c   = colonies[i];
      const off = i * COLONY_STRIDE;
      _writeArray(colData, off,      c.buildings  ?? [], 8);
      _writeArray(colData, off + 8,  c.bonuses    ?? [], 8);
      _writeArray(colData, off + 16, c.popClass   ?? [], 6);
      _writeArray(colData, off + 22, c.stock      ?? [], 12);
      colData[off + 34] = Number(c.population ?? 0);
      colData[off + 35] = Number(dt);
    }
    this._device.queue.writeBuffer(this._colonyBuf, 0, colData);

    // Upload goods (zeros; caller can extend later)
    this._device.queue.writeBuffer(this._goodBuf, 0, new Float32Array(this._numGoods * GOOD_STRIDE));

    // Encode 3 sequential passes
    const encoder = this._device.createCommandEncoder();
    const wgs     = Math.ceil(n / ECONOMY_WORKGROUP_SIZE);
    for (let p = 0; p < NUM_PASSES; p++) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this._pipeline);
      pass.setBindGroup(0, this._bindGroups[p]);
      pass.dispatchWorkgroups(wgs);
      pass.end();
    }

    // Copy result to read-back buffer
    encoder.copyBufferToBuffer(
      this._resultBuf, 0,
      this._readBuf,   0,
      n * RESULT_BYTES,
    );
    this._device.queue.submit([encoder.finish()]);

    // Await readback
    await this._readBuf.mapAsync(GPUMapMode.READ, 0, n * RESULT_BYTES);
    const raw  = new Float32Array(this._readBuf.getMappedRange(0, n * RESULT_BYTES));
    this._results = [];
    for (let i = 0; i < n; i++) {
      const off = i * RESULT_STRIDE;
      this._results.push({
        produced:   Array.from(raw.subarray(off,      off + 12)),
        consumed:   Array.from(raw.subarray(off + 12, off + 24)),
        priceDelta: Array.from(raw.subarray(off + 24, off + 36)),
      });
    }
    this._readBuf.unmap();
  }

  /** Get results from the last tick(). */
  getResults() { return this._results; }

  // ── CPU fallback ───────────────────────────────────────────────────────────

  _cpuFallbackTick(dt) {
    const BASE  = [2.0, 1.5, 1.2, 0.8, 3.0, 2.5, 1.0, 0.5];
    const POP_C = [0.05, 0.08, 0.12, 0.15, 0.10, 0.18];
    const ELAST = 0.04;

    this._results = this._colonies.map((c) => {
      const buildings = c.buildings ?? [];
      const bonuses   = c.bonuses   ?? [];
      const popClass  = c.popClass  ?? [];
      const stock     = c.stock     ?? [];
      const produced  = new Array(12).fill(0);
      const consumed  = new Array(12).fill(0);
      const priceDelta = new Array(12).fill(0);

      for (let i = 0; i < 8; i++) {
        const idx = i < 12 ? i : 11;
        produced[idx] += (buildings[i] ?? 0) * BASE[i] * (bonuses[i] ?? 1) * dt;
      }
      for (let cls = 0; cls < 6; cls++) {
        const pop  = popClass[cls] ?? 0;
        if (pop <= 0) continue;
        const gi   = cls % 12;
        const rate = POP_C[cls] * pop * dt;
        consumed[gi] += Math.min(rate, stock[gi] ?? 0);
      }
      for (let g = 0; g < 12; g++) {
        const delta = -(produced[g] - consumed[g]) * ELAST;
        priceDelta[g] = Object.is(delta, -0) ? 0 : delta;
      }
      return { produced, consumed, priceDelta };
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EconomyComputeEngine, ECONOMY_WGSL, COLONY_STRIDE, RESULT_STRIDE };
} else {
  window.EconomyComputeEngine = EconomyComputeEngine;
}
