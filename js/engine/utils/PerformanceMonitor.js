/**
 * PerformanceMonitor.js
 *
 * FPS counter + GPU memory tracking.
 * Integrates with the existing GQLog window logger when available.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class PerformanceMonitor {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.sampleWindow=60]   Number of frames to average over
   * @param {number} [opts.warnThresholdFps=30]
   */
  constructor(opts = {}) {
    this._sampleWindow    = opts.sampleWindow     ?? 60;
    this._warnThreshold   = opts.warnThresholdFps ?? 30;
    this._frameTimes      = [];
    /** @type {number|null} null = not yet started */
    this._lastTs          = null;
    this._frameCount      = 0;
    this.fps              = 0;
    this.frameTimeMs      = 0;
    this.gpuMemoryBytes   = 0;
  }

  /**
   * Call once per animation frame.
   * @param {number} [ts]  timestamp from requestAnimationFrame; defaults to performance.now()
   */
  tick(ts = performance.now()) {
    if (this._lastTs !== null) {
      const dt = ts - this._lastTs;
      this._frameTimes.push(dt);
      if (this._frameTimes.length > this._sampleWindow) this._frameTimes.shift();
      const avg = this._frameTimes.reduce((a, b) => a + b, 0) / this._frameTimes.length;
      this.frameTimeMs = avg;
      this.fps         = avg > 0 ? 1000 / avg : 0;
    }
    this._lastTs = ts;
    this._frameCount++;

    if (this.fps > 0 && this.fps < this._warnThreshold && this._frameCount % this._sampleWindow === 0) {
      if (typeof window !== 'undefined' && window.GQLog?.warn) {
        window.GQLog.warn(`[PerformanceMonitor] FPS below target: ${this.fps.toFixed(1)}`);
      }
    }
  }

  /**
   * Sample GPU memory usage (Chrome/Edge only via performance.memory extension).
   * @param {GPUDevice} [device]
   */
  sampleGpuMemory(device) {
    // navigator.gpu memory info is proposal-stage; fall back gracefully
    if (device?.adapterInfo?.memoryHeaps) {
      this.gpuMemoryBytes = device.adapterInfo.memoryHeaps
        .reduce((s, h) => s + (h.size ?? 0), 0);
    }
  }

  /** @returns {{ fps: number, frameTimeMs: number, gpuMemoryMb: number }} */
  stats() {
    return {
      fps:          Math.round(this.fps),
      frameTimeMs:  +this.frameTimeMs.toFixed(2),
      gpuMemoryMb:  +(this.gpuMemoryBytes / 1_048_576).toFixed(1),
    };
  }

  reset() {
    this._frameTimes  = [];
    this._lastTs      = null;
    this._frameCount  = 0;
    this.fps          = 0;
    this.frameTimeMs  = 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PerformanceMonitor };
} else {
  window.GQPerformanceMonitor = PerformanceMonitor;
}
