/**
 * WebGPUProfiler.js
 *
 * GPU-side performance measurement using the WebGPU timestamp-query feature.
 * When the feature is unavailable (most devices in 2024), the profiler
 * degrades silently to CPU-side `performance.now()` measurements.
 *
 * Usage:
 *   const profiler = new WebGPUProfiler(device, capabilities);
 *   // Around a render pass:
 *   profiler.begin('galaxy-render');
 *   // ... submit GPU work ...
 *   const gpuMs = await profiler.end('galaxy-render');
 *
 *   // Read all accumulated samples:
 *   const report = profiler.report();
 *   // { 'galaxy-render': { avgMs: 1.2, minMs: 0.9, maxMs: 1.8, samples: 60 }, ... }
 *
 * References:
 *   WebGPU timestamp-query spec — https://gpuweb.github.io/gpuweb/#timestamp-query
 *   Babylon.js (Apache 2.0) WebGPUPerfCounter
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** Rolling window size for moving-average FPS / GPU-time metrics. */
const WINDOW_SIZE = 60;

/** Number of timestamp slots per query-set (begin + end per span). */
const SLOTS_PER_SPAN = 2;

class WebGPUProfiler {
  /**
   * @param {GPUDevice|null}              device
   * @param {{ timestampQuery: boolean }} [capabilities]
   */
  constructor(device, capabilities = {}) {
    this._device       = device;
    this._gpuEnabled   = !!(device && capabilities.timestampQuery);

    /** @type {Map<string, { querySet: GPUQuerySet, resolveBuf: GPUBuffer, stagingBuf: GPUBuffer, cpuStart: number }>} */
    this._activeSpans = new Map();

    /** @type {Map<string, { sum: number, min: number, max: number, count: number, ring: Float64Array, ringIdx: number }>} */
    this._stats = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Begin a timed GPU span.  Call once before submitting work.
   *
   * @param {string}             label
   * @param {GPUCommandEncoder}  [encoder]  When provided, injects timestamp writes.
   */
  begin(label, encoder) {
    const cpuStart = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    if (!this._gpuEnabled || !encoder) {
      this._activeSpans.set(label, { querySet: null, resolveBuf: null, stagingBuf: null, cpuStart });
      return;
    }

    const querySet = this._device.createQuerySet({
      type:  'timestamp',
      count: SLOTS_PER_SPAN,
      label: `gq-ts-qs:${label}`,
    });

    const resolveBuf = this._device.createBuffer({
      size:  SLOTS_PER_SPAN * 8,   // 2 × uint64
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      label: `gq-ts-res:${label}`,
    });

    const stagingBuf = this._device.createBuffer({
      size:  SLOTS_PER_SPAN * 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: `gq-ts-stg:${label}`,
    });

    encoder.writeTimestamp(querySet, 0);
    this._activeSpans.set(label, { querySet, resolveBuf, stagingBuf, encoder, cpuStart });
  }

  /**
   * End a timed GPU span and asynchronously resolve the GPU duration.
   *
   * @param {string}            label
   * @param {GPUCommandEncoder} [encoder]  Must be the same encoder passed to begin().
   * @returns {Promise<number>}  Resolves to the elapsed time in milliseconds.
   *                             Falls back to CPU time when GPU timestamps unavailable.
   */
  async end(label, encoder) {
    const span = this._activeSpans.get(label);
    if (!span) return 0;
    this._activeSpans.delete(label);

    const cpuMs = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - span.cpuStart;

    if (!this._gpuEnabled || !span.querySet || !encoder) {
      this._record(label, cpuMs);
      return cpuMs;
    }

    encoder.writeTimestamp(span.querySet, 1);
    encoder.resolveQuerySet(span.querySet, 0, SLOTS_PER_SPAN, span.resolveBuf, 0);
    encoder.copyBufferToBuffer(span.resolveBuf, 0, span.stagingBuf, 0, SLOTS_PER_SPAN * 8);

    // Submit is caller's responsibility — we just read back after the queue drains.
    await span.stagingBuf.mapAsync(GPUMapMode.READ);
    const raw = new BigUint64Array(span.stagingBuf.getMappedRange());
    const gpuNs = Number(raw[1] - raw[0]);
    span.stagingBuf.unmap();

    span.stagingBuf.destroy();
    span.resolveBuf.destroy();
    span.querySet.destroy();

    const gpuMs = gpuNs / 1_000_000;
    this._record(label, gpuMs);
    return gpuMs;
  }

  /**
   * Return a snapshot of all accumulated statistics.
   *
   * @returns {Object.<string, { avgMs: number, minMs: number, maxMs: number, samples: number }>}
   */
  report() {
    const out = {};
    for (const [label, s] of this._stats) {
      const filled = Math.min(s.count, WINDOW_SIZE);
      let   sum    = 0;
      for (let i = 0; i < filled; i++) sum += s.ring[i];
      out[label] = {
        avgMs:   filled > 0 ? sum / filled : 0,
        minMs:   s.min,
        maxMs:   s.max,
        samples: s.count,
      };
    }
    return out;
  }

  /** Reset all accumulated statistics. */
  reset() {
    this._stats.clear();
  }

  dispose() {
    for (const span of this._activeSpans.values()) {
      span.stagingBuf?.destroy();
      span.resolveBuf?.destroy();
      span.querySet?.destroy();
    }
    this._activeSpans.clear();
    this._stats.clear();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _record(label, ms) {
    if (!this._stats.has(label)) {
      this._stats.set(label, {
        sum:    0,
        min:    Infinity,
        max:    -Infinity,
        count:  0,
        ring:   new Float64Array(WINDOW_SIZE),
        ringIdx: 0,
      });
    }
    const s = this._stats.get(label);
    s.ring[s.ringIdx % WINDOW_SIZE] = ms;
    s.ringIdx++;
    s.count++;
    if (ms < s.min) s.min = ms;
    if (ms > s.max) s.max = ms;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPUProfiler, WINDOW_SIZE };
} else {
  window.GQWebGPUProfiler = { WebGPUProfiler, WINDOW_SIZE };
}
