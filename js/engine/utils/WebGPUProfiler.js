/**
 * Optional render-pass GPU timestamps. CPU submission time is never a GPU sample.
 * begin() returns pass.timestampWrites; resolve() encodes copies before submission;
 * end() reads back only AFTER the caller has submitted the encoder.
 */
'use strict';

const WINDOW_SIZE = 60;

class WebGPUProfiler {
  constructor(device) {
    this._device = device;
    this._gpuEnabled = !!device?.features?.has('timestamp-query');
    this._activeSpans = new Map();
    this._stats = new Map();
    this._disposed = false;
  }

  begin(label) {
    // One in-flight readback bounds allocations and avoids per-frame queue stalls.
    if (!this._gpuEnabled || this._disposed || this._activeSpans.size) return null;
    let querySet, resolveBuf, stagingBuf;
    try {
      querySet = this._device.createQuerySet({ type: 'timestamp', count: 2 });
      resolveBuf = this._device.createBuffer({
        size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      stagingBuf = this._device.createBuffer({
        size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    } catch (_) {
      querySet?.destroy();
      resolveBuf?.destroy();
      stagingBuf?.destroy();
      this._gpuEnabled = false;
      return null;
    }
    this._activeSpans.set(label, { querySet, resolveBuf, stagingBuf, resolved: false });
    return { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }

  resolve(label, encoder) {
    const span = this._activeSpans.get(label);
    if (!span || span.resolved) return;
    encoder.resolveQuerySet(span.querySet, 0, 2, span.resolveBuf, 0);
    encoder.copyBufferToBuffer(span.resolveBuf, 0, span.stagingBuf, 0, 16);
    span.resolved = true;
  }

  async end(label) {
    const span = this._activeSpans.get(label);
    if (!span) return null;
    try {
      if (!span.resolved) return null;
      await span.stagingBuf.mapAsync(GPUMapMode.READ);
      if (this._disposed) return null;
      const raw = new BigUint64Array(span.stagingBuf.getMappedRange());
      const ms = Number(raw[1] - raw[0]) / 1_000_000;
      span.stagingBuf.unmap();
      if (!Number.isFinite(ms) || ms < 0) return null;
      this._record(label, ms);
      return ms;
    } catch (_) {
      // Device loss or unsupported readback must not interrupt rendering.
      this._gpuEnabled = false;
      return null;
    } finally {
      if (this._activeSpans.get(label) === span) {
        this._activeSpans.delete(label);
        span.stagingBuf.destroy();
        span.resolveBuf.destroy();
        span.querySet.destroy();
      }
    }
  }

  report() {
    const out = {};
    for (const [label, s] of this._stats) {
      out[label] = {
        avgMs: s.ring.reduce((sum, ms) => sum + ms, 0) / s.ring.length,
        minMs: Math.min(...s.ring),
        maxMs: Math.max(...s.ring),
        samples: s.count,
        windowSamples: s.ring.length,
      };
    }
    return out;
  }

  reset() { this._stats.clear(); }

  dispose() {
    this._disposed = true;
    for (const span of this._activeSpans.values()) {
      span.stagingBuf.destroy();
      span.resolveBuf.destroy();
      span.querySet.destroy();
    }
    this._activeSpans.clear();
    this._stats.clear();
  }

  _record(label, ms) {
    if (!this._stats.has(label)) {
      if (this._stats.size >= 16) this._stats.delete(this._stats.keys().next().value);
      this._stats.set(label, { count: 0, ring: [] });
    }
    const s = this._stats.get(label);
    s.ring.push(ms);
    if (s.ring.length > WINDOW_SIZE) s.ring.shift();
    s.count++;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPUProfiler, WINDOW_SIZE };
}
if (typeof window !== 'undefined') window.GQWebGPUProfiler = { WebGPUProfiler, WINDOW_SIZE };
