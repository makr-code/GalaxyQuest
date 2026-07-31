/**
 * DynamicQualityScaler.js
 *
 * Automatically adjusts rendering quality based on frame time.
 * Maintains target FPS by scaling down quality settings when frame time increases.
 *
 * Scalable parameters:
 *   - Render resolution (supersampling factor)
 *   - Shadow map resolution
 *   - Particle count limits
 *   - Post-processing passes
 *   - Geometry LOD thresholds
 *   - Draw distance
 *
 * Usage:
 *   const scaler = new DynamicQualityScaler({
 *     targetFps: 60,
 *     frameTimeThreshold: 16.67,
 *   });
 *
 *   scaler.update(avgFrameTimeMs);
 *   const settings = scaler.getQualitySettings();
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class DynamicQualityScaler {
  /**
   * @param {Object} opts
   * @param {number} [opts.targetFps=60] - Target frame rate
   * @param {number} [opts.frameTimeThreshold=16.67] - Frame time threshold (ms)
   * @param {number} [opts.hysteresis=20] - % margin to prevent oscillation
   * @param {number} [opts.adjustInterval=300] - Min ms between adjustments
   */
  constructor(opts = {}) {
    this.targetFps = Math.max(30, Number(opts.targetFps) ?? 60);
    this.frameTimeThreshold = Number(opts.frameTimeThreshold) ?? (1000 / this.targetFps);
    this.hysteresis = Math.max(0, Number(opts.hysteresis) ?? 20); // % margin
    this.adjustInterval = Math.max(100, Number(opts.adjustInterval) ?? 300);

    // Quality levels: 0 (minimal) to 4 (maximum)
    this._qualityLevel = 4;
    this._maxQualityLevel = 4;
    this._lastAdjustTime = performance.now();

    this._frameTimeHistory = [];
    this._historySize = 30;

    // Quality settings per level
    this._qualitySettings = this._initQualitySettings();
    this._metrics = {
      adjustmentsUp: 0,
      adjustmentsDown: 0,
      currentLevel: 4,
      avgFrameTimeMs: 0,
    };
  }

  /**
   * Initialize quality settings by level.
   * Customize these based on your rendering pipeline.
   * @private
   */
  _initQualitySettings() {
    return {
      0: { // Minimal quality (emergency mode)
        resolutionScale: 0.5,
        shadowResolution: 512,
        particleLimit: 100,
        postProcessing: false,
        maxDrawDistance: 2000,
        lodBias: 2,
        label: 'Minimal',
      },
      1: { // Low quality
        resolutionScale: 0.75,
        shadowResolution: 1024,
        particleLimit: 500,
        postProcessing: false,
        maxDrawDistance: 5000,
        lodBias: 1.5,
        label: 'Low',
      },
      2: { // Medium quality
        resolutionScale: 1.0,
        shadowResolution: 2048,
        particleLimit: 1000,
        postProcessing: true,
        maxDrawDistance: 8000,
        lodBias: 1.0,
        label: 'Medium',
      },
      3: { // High quality
        resolutionScale: 1.2,
        shadowResolution: 4096,
        particleLimit: 2000,
        postProcessing: true,
        maxDrawDistance: 10000,
        lodBias: 0.8,
        label: 'High',
      },
      4: { // Ultra quality (maximum)
        resolutionScale: 1.5,
        shadowResolution: 4096,
        particleLimit: 5000,
        postProcessing: true,
        maxDrawDistance: 15000,
        lodBias: 0.5,
        label: 'Ultra',
      },
    };
  }

  /**
   * Update with latest frame time measurement.
   * @param {number} frameTimeMs - Frame time in milliseconds
   */
  update(frameTimeMs) {
    if (typeof frameTimeMs !== 'number' || frameTimeMs <= 0) {
      return;
    }

    // Add to history
    this._frameTimeHistory.push(frameTimeMs);
    if (this._frameTimeHistory.length > this._historySize) {
      this._frameTimeHistory.shift();
    }

    // Calculate average
    const avgFrameTime = this._frameTimeHistory.reduce((a, b) => a + b, 0) / this._frameTimeHistory.length;
    this._metrics.avgFrameTimeMs = avgFrameTime;

    // Check if adjustment needed (with hysteresis)
    const now = performance.now();
    if (now - this._lastAdjustTime < this.adjustInterval) {
      return; // Too soon to adjust
    }

    const hysteresisMargin = this.frameTimeThreshold * (this.hysteresis / 100);

    if (avgFrameTime > this.frameTimeThreshold + hysteresisMargin) {
      // Frame time too high — lower quality
      this._setQualityLevel(Math.max(0, this._qualityLevel - 1));
    } else if (avgFrameTime < this.frameTimeThreshold - hysteresisMargin && this._qualityLevel < this._maxQualityLevel) {
      // Frame time good — try increasing quality
      this._setQualityLevel(Math.min(this._maxQualityLevel, this._qualityLevel + 1));
    }

    this._lastAdjustTime = now;
  }

  /**
   * Set quality level directly.
   * @private
   */
  _setQualityLevel(level) {
    const oldLevel = this._qualityLevel;
    this._qualityLevel = Math.max(0, Math.min(this._maxQualityLevel, level));

    if (oldLevel > this._qualityLevel) {
      this._metrics.adjustmentsDown++;
    } else if (oldLevel < this._qualityLevel) {
      this._metrics.adjustmentsUp++;
    }

    this._metrics.currentLevel = this._qualityLevel;
  }

  /**
   * Get current quality settings.
   * @returns {Object}
   */
  getQualitySettings() {
    return { ...this._qualitySettings[this._qualityLevel] };
  }

  /**
   * Get current quality level (0-4).
   * @returns {number}
   */
  getQualityLevel() {
    return this._qualityLevel;
  }

  /**
   * Get quality level name.
   * @returns {string}
   */
  getQualityLevelName() {
    return this._qualitySettings[this._qualityLevel]?.label || 'Unknown';
  }

  /**
   * Force quality level.
   * @param {number} level - 0 to 4
   */
  forceQualityLevel(level) {
    this._setQualityLevel(level);
  }

  /**
   * Get performance metrics.
   * @returns {Object}
   */
  getMetrics() {
    return { ...this._metrics };
  }

  /**
   * Get average frame time.
   * @returns {number}
   */
  getAverageFrameTime() {
    if (this._frameTimeHistory.length === 0) return 0;
    return this._frameTimeHistory.reduce((a, b) => a + b, 0) / this._frameTimeHistory.length;
  }

  /**
   * Get frame time percentiles.
   * @returns {Object} { p50, p95, p99, max }
   */
  getFrameTimePercentiles() {
    if (this._frameTimeHistory.length === 0) {
      return { p50: 0, p95: 0, p99: 0, max: 0 };
    }

    const sorted = [...this._frameTimeHistory].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const max = sorted[sorted.length - 1];

    return { p50, p95, p99, max };
  }

  /**
   * Get human-readable status report.
   * @returns {string}
   */
  report() {
    const settings = this.getQualitySettings();
    const pct = this.getFrameTimePercentiles();

    return [
      `[DynamicQualityScaler]`,
      `  Quality Level: ${this._qualityLevel}/4 (${settings.label})`,
      `  Avg Frame Time: ${this._metrics.avgFrameTimeMs.toFixed(2)}ms (target: ${this.frameTimeThreshold.toFixed(2)}ms)`,
      `  Frame Time P50: ${pct.p50.toFixed(2)}ms  P95: ${pct.p95.toFixed(2)}ms  P99: ${pct.p99.toFixed(2)}ms  Max: ${pct.max.toFixed(2)}ms`,
      `  Adjustments: ↑${this._metrics.adjustmentsUp}  ↓${this._metrics.adjustmentsDown}`,
      `  Settings:`,
      `    Resolution: ${(settings.resolutionScale * 100).toFixed(0)}%`,
      `    Shadow Res: ${settings.shadowResolution}px`,
      `    Particles: ${settings.particleLimit}`,
      `    PostFX: ${settings.postProcessing ? 'on' : 'off'}`,
      `    Draw Distance: ${settings.maxDrawDistance}m`,
    ].join('\n');
  }

  /**
   * Reset frame time history.
   */
  reset() {
    this._frameTimeHistory = [];
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DynamicQualityScaler };
} else {
  window.GQDynamicQualityScaler = DynamicQualityScaler;
}
