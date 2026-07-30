/**
 * VisualEffectsPerformanceOptimizer.js — Adaptive LOD and performance tuning.
 *
 * Handles:
 *   • Adaptive particle density based on FPS
 *   • Distance-based LOD for effects visibility
 *   • Automatic downscaling on performance pressure
 *   • Recovery logic when performance improves
 *   • Per-frame budget management
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class VisualEffectsPerformanceOptimizer {
  /**
   * @param {VisualEffectsManager} vfxManager - Effects manager to optimize
   * @param {object} [opts]
   * @param {number} [opts.targetFPS=60] - Target frame rate
   * @param {number} [opts.fpsThreshold=45] - FPS threshold for degradation
   * @param {number} [opts.recoveryThreshold=50] - FPS threshold for recovery
   * @param {number} [opts.checkInterval=1.0] - Seconds between perf checks
   */
  constructor(vfxManager, opts = {}) {
    this._vfxManager = vfxManager;
    this._targetFPS = opts.targetFPS ?? 60;
    this._degradeThreshold = opts.fpsThreshold ?? 45;
    this._recoveryThreshold = opts.recoveryThreshold ?? 50;
    this._checkInterval = opts.checkInterval ?? 1.0;

    // LOD levels (0 = off, 1 = full)
    this._currentLOD = 1.0;
    this._targetLOD = 1.0;

    // State tracking
    this._timeSinceCheck = 0;
    this._consecutiveSlowFrames = 0;
    this._consecutiveFastFrames = 0;
    this._enabled = true;

    // Performance metrics
    this.currentFPS = 60;
    this.particleDensity = 1.0;
    this.sunIntensity = 1.0;
  }

  /**
   * Update performance monitor. Call once per frame.
   *
   * @param {number} dt - Delta-time (seconds)
   * @param {number} [currentFPS] - Current frame rate (if available)
   */
  update(dt, currentFPS = null) {
    if (!this._enabled || !this._vfxManager) return;

    // Track time since last perf check
    this._timeSinceCheck += dt;

    // Update FPS estimate if provided
    if (currentFPS !== null) {
      this.currentFPS = currentFPS;
    } else {
      // Estimate from dt
      this.currentFPS = dt > 0 ? 1 / dt : 60;
    }

    // Check performance periodically
    if (this._timeSinceCheck >= this._checkInterval) {
      this._performanceCheck();
      this._timeSinceCheck = 0;
    }

    // Smoothly transition LOD
    this._updateLOD(dt);
  }

  /**
   * Enable/disable optimization.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._enabled = enabled;
    if (!enabled) {
      this._targetLOD = 1.0;
      this._updateLODImmediate();
    }
  }

  /**
   * Force a specific LOD level.
   * @param {number} lod - 0 = off, 1 = full
   */
  forceLOD(lod) {
    this._targetLOD = Math.max(0, Math.min(1, lod));
    this._updateLODImmediate();
  }

  /**
   * Get current performance report.
   * @returns {object}
   */
  getReport() {
    return {
      fps: Math.round(this.currentFPS),
      lod: this._currentLOD.toFixed(2),
      particleDensity: this.particleDensity.toFixed(2),
      sunIntensity: this.sunIntensity.toFixed(2),
      degraded: this._currentLOD < 1.0,
    };
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Evaluate current performance and adjust LOD.
   * @private
   */
  _performanceCheck() {
    if (this.currentFPS < this._degradeThreshold) {
      // Performance is degraded
      this._consecutiveSlowFrames++;
      this._consecutiveFastFrames = 0;

      if (this._consecutiveSlowFrames >= 2) {
        // Degrade LOD after 2 slow periods
        this._targetLOD = Math.max(0.1, this._targetLOD - 0.25);
        console.debug('[VFXPerf] Degrading LOD to', this._targetLOD.toFixed(2), '@ FPS', this.currentFPS.toFixed(1));
      }
    } else if (this.currentFPS > this._recoveryThreshold) {
      // Performance is good
      this._consecutiveFastFrames++;
      this._consecutiveSlowFrames = 0;

      if (this._consecutiveFastFrames >= 3 && this._currentLOD < 1.0) {
        // Improve LOD after 3 good periods
        this._targetLOD = Math.min(1.0, this._targetLOD + 0.15);
        console.debug('[VFXPerf] Improving LOD to', this._targetLOD.toFixed(2), '@ FPS', this.currentFPS.toFixed(1));
      }
    } else {
      // Performance is stable
      this._consecutiveSlowFrames = Math.max(0, this._consecutiveSlowFrames - 1);
      this._consecutiveFastFrames = Math.max(0, this._consecutiveFastFrames - 1);
    }
  }

  /**
   * Smooth LOD transition.
   * @private
   */
  _updateLOD(dt) {
    const lerpSpeed = 0.1;  // Per-frame lerp factor
    this._currentLOD += (this._targetLOD - this._currentLOD) * lerpSpeed;

    // Apply LOD to subsystems
    this.particleDensity = this._currentLOD;
    this.sunIntensity = Math.max(0.3, this._currentLOD);  // Keep some glow even at low LOD

    if (this._vfxManager) {
      this._vfxManager.setParticleDensityScale(this.particleDensity);
      this._vfxManager.setSunIntensityScale(this.sunIntensity);
    }
  }

  /**
   * Apply LOD immediately without smoothing.
   * @private
   */
  _updateLODImmediate() {
    this._currentLOD = this._targetLOD;
    this.particleDensity = this._currentLOD;
    this.sunIntensity = Math.max(0.3, this._currentLOD);

    if (this._vfxManager) {
      this._vfxManager.setParticleDensityScale(this.particleDensity);
      this._vfxManager.setSunIntensityScale(this.sunIntensity);
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VisualEffectsPerformanceOptimizer };
}

if (typeof window !== 'undefined') {
  window.GQVisualEffectsPerformanceOptimizer = { VisualEffectsPerformanceOptimizer };
}
