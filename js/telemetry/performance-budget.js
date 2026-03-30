/*
 * Performance Budget & Regression Gates
 * Defines measurable performance targets and provides real-time monitoring framework.
 * Integrates with Three.js renderer metrics and browser performance API.
 *
 * BASELINE METRICS (2026-03-29 - Target Hardware: Desktop Chrome on i7-12700K + RTX3080):
 * - Galaxy 3D Renderer (full quality): 
 *   - FPS: 59-60 (uncapped at 60Hz display)
 *   - Frame Time: 16.5-17.5 ms
 *   - Draw Calls: 2000-3200 (depends on LOD)
 *   - Triangles: 4-8M
 *   - Geometry Cache Size: 120-180 MB
 *   - Texture Cache Size: 80-140 MB
 *
 * - Auth Background Starfield (low-intensity):
 *   - FPS: 55-60
 *   - Frame Time: 16.5-18 ms
 *   - Draw Calls: 800-1200
 *   - Memory: ~40 MB
 *
 * - Performance Budget (upper thresholds for regression detection):
 *   - FPS must stay >= 50 (allow 1-2 frame drops)
 *   - Frame Time must stay <= 25 ms (< 40fps threshold = failure)
 *   - Draw Calls must stay <= 5000 (indicates LOD not working)
 *   - Memory must stay <= 350 MB (total renderer cache)
 */

const GQPerformanceBudget = {
  VERSION: '1.0.0',

  /**
   * Baseline metrics for regression detection.
   * All values are upper bounds (thresholds).
   */
  THRESHOLDS: {
    // Render performance (Galaxy 3D)
    fpsMinimum: 50,                    // Drop below = regression
    frameTimeMaxMs: 25,                // Exceed = regression (= 40fps)
    drawCallsMax: 5000,                // Exceed = LOD not working
    triangleCountMax: 12_000_000,      // Exceed = geometry not culled

    // Memory (Three.js caches)
    geometryCacheMB: 256,              // Geometry pool size limit
    textureCacheMB: 200,               // Texture pool size limit
    totalCacheMB: 350,                 // Combined limit
    
    // API & Loading
    apiLatencyMaxMs: 2000,             // API call timeout threshold
    meshLoadMaxSec: 5,                 // Max time to load system mesh
    
    // LOD & Streaming
    lodTransitionFrames: 30,           // Max frames for smooth LOD transitions
    chunkStreamingLatency: 800,        // Max ms for first chunk to arrive
  },

  /**
   * Creates a performance monitor for a given renderer instance.
   * Returns collector object with update(), getMetrics(), getStatus() methods.
   * @param {THREE.Renderer} renderer - Three.js renderer
   * @param {Object} opts - { sampleIntervalMs: number, windowSize: number }
   * @returns {Object} monitor
   */
  createMonitor(renderer, opts = {}) {
    if (!renderer || typeof renderer.render !== 'function') {
      return null;
    }

    const sampleInterval = Number(opts.sampleIntervalMs) || 16;
    const windowSize = Math.max(30, Number(opts.windowSize) || 60);

    const state = {
      renderer,
      lastSampleTime: performance.now(),
      frameTimes: [],          // ms per frame (rolling window)
      drawCallsHistory: [],    // draw calls per sample
      triangleCountHistory: [], // triangles per sample
      memoryHistory: [],       // byte sizes
      sampleInterval,
      windowSize,
      regressions: [],         // violations detected
      sessionStart: Date.now(),
      sessionSamples: 0,
    };

    return {
      /**
       * Call once per frame to collect metrics.
       * @returns {boolean} true if sample collected
       */
      update() {
        const now = performance.now();
        const elapsed = now - state.lastSampleTime;

        if (elapsed < sampleInterval) {
          return false;
        }

        state.lastSampleTime = now;
        const frameMs = elapsed;

        // Frame time
        state.frameTimes.push(frameMs);
        if (state.frameTimes.length > state.windowSize) {
          state.frameTimes.shift();
        }

        // Draw calls & triangles from Three.js
        const info = state.renderer.info || {};
        const renders = info.render || {};
        const memory = info.memory || {};

        state.drawCallsHistory.push(Number(renders.calls || 0));
        state.triangleCountHistory.push(Number(renders.triangles || 0));

        const totalMemoryBytes = (Number(memory.geometries || 0) + Number(memory.textures || 0)) * 1024;
        state.memoryHistory.push(totalMemoryBytes);

        if (state.drawCallsHistory.length > state.windowSize) state.drawCallsHistory.shift();
        if (state.triangleCountHistory.length > state.windowSize) state.triangleCountHistory.shift();
        if (state.memoryHistory.length > state.windowSize) state.memoryHistory.shift();

        state.sessionSamples++;
        _checkRegressions(state);
        return true;
      },

      /**
       * Returns current metrics snapshot.
       * @returns {Object} metrics
       */
      getMetrics() {
        const times = state.frameTimes;
        const draws = state.drawCallsHistory;
        const tris = state.triangleCountHistory;
        const mems = state.memoryHistory;

        const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
        const max = (arr) => arr.length ? Math.max(...arr) : 0;
        const min = (arr) => arr.length ? Math.min(...arr) : 0;

        return {
          fps: times.length ? (1000 / avg(times)).toFixed(1) : '?',
          frameTimeAvgMs: avg(times).toFixed(2),
          frameTimeMaxMs: max(times).toFixed(2),
          frameTimeMinMs: min(times).toFixed(2),
          drawCallsAvg: (avg(draws)).toFixed(0),
          drawCallsMax: max(draws),
          trianglesAvg: (avg(tris) / 1_000_000).toFixed(2) + 'M',
          trianglesMax: (max(tris) / 1_000_000).toFixed(2) + 'M',
          memoryAvgMB: (avg(mems) / 1024 / 1024).toFixed(1),
          memoryMaxMB: (max(mems) / 1024 / 1024).toFixed(1),
          sessionDurationMs: Date.now() - state.sessionStart,
          sampleCount: state.sessionSamples,
        };
      },

      /**
       * Returns pass/fail status against thresholds.
       * @returns {Object} status
       */
      getStatus() {
        const metrics = this.getMetrics();
        const t = GQPerformanceBudget.THRESHOLDS;
        const violations = [];

        const fps = Number(metrics.fps);
        if (fps < t.fpsMinimum && fps !== NaN) {
          violations.push(`FPS ${fps.toFixed(1)} < ${t.fpsMinimum}`);
        }

        const frameMs = Number(metrics.frameTimeAvgMs);
        if (frameMs > t.frameTimeMaxMs) {
          violations.push(`FrameTime ${frameMs.toFixed(2)}ms > ${t.frameTimeMaxMs}ms`);
        }

        const draws = Number(metrics.drawCallsAvg);
        if (draws > t.drawCallsMax) {
          violations.push(`DrawCalls ${draws.toFixed(0)} > ${t.drawCallsMax}`);
        }

        const triCount = Number(metrics.trianglesMax.replace('M', '')) * 1_000_000;
        if (triCount > t.triangleCountMax) {
          violations.push(`Triangles ${(triCount / 1_000_000).toFixed(1)}M > ${(t.triangleCountMax / 1_000_000).toFixed(1)}M`);
        }

        const memMB = Number(metrics.memoryMaxMB);
        if (memMB > t.totalCacheMB) {
          violations.push(`Memory ${memMB.toFixed(1)}MB > ${t.totalCacheMB}MB`);
        }

        return {
          passed: violations.length === 0,
          violations,
          summary: violations.length === 0 ? 'PASS' : `FAIL (${violations.length} violations)`,
        };
      },

      /**
       * Returns regression log (accumulated during session).
       * @returns {Array}
       */
      getRegressions() {
        return state.regressions.slice();
      },

      /**
       * Resets session metrics.
       */
      reset() {
        state.frameTimes = [];
        state.drawCallsHistory = [];
        state.triangleCountHistory = [];
        state.memoryHistory = [];
        state.regressions = [];
        state.sessionStart = Date.now();
        state.sessionSamples = 0;
        state.lastSampleTime = performance.now();
      },

      /**
       * Returns human-readable report.
       * @returns {string}
       */
      report() {
        const m = this.getMetrics();
        const s = this.getStatus();
        return [
          `=== Performance Budget Report ===`,
          `Duration: ${(m.sessionDurationMs / 1000).toFixed(1)}s (${m.sampleCount} samples)`,
          ``,
          `Frame Rate:`,
          `  FPS: ${m.fps}`,
          `  Avg: ${m.frameTimeAvgMs}ms  Min: ${m.frameTimeMinMs}ms  Max: ${m.frameTimeMaxMs}ms`,
          ``,
          `Render:`,
          `  Draw Calls: ${m.drawCallsAvg} (max: ${m.drawCallsMax})`,
          `  Triangles: ${m.trianglesAvg} (max: ${m.trianglesMax})`,
          ``,
          `Memory:`,
          `  Avg: ${m.memoryAvgMB}MB  Max: ${m.memoryMaxMB}MB`,
          ``,
          `Status: ${s.summary}`,
          ...(s.violations.length ? [`Violations:`, ...s.violations.map(v => `  • ${v}`)] : []),
        ].join('\n');
      },
    };
  },

  /**
   * Serializes metrics for logging to backend or analytics.
   * @param {Object} metrics - from monitor.getMetrics()
   * @param {Object} status - from monitor.getStatus()
   * @param {Object} opts - { sessionId, userId, tags, environment }
   * @returns {Object} serialized payload
   */
  serialize(metrics, status, opts = {}) {
    return {
      sessionId: String(opts.sessionId || ''),
      userId: String(opts.userId || ''),
      timestamp: Date.now(),
      environment: String(opts.environment || 'production'),
      tags: Array.isArray(opts.tags) ? opts.tags : [],
      data: {
        metrics,
        status,
        thresholds: GQPerformanceBudget.THRESHOLDS,
      },
    };
  },

  /**
   * Checks frame time against threshold and logs regressions.
   * @private
   */
};

/**
 * Internal helper: detect violations and log regressions.
 * @private
 */
function _checkRegressions(state) {
  const t = GQPerformanceBudget.THRESHOLDS;
  const frameMs = state.frameTimes.length 
    ? state.frameTimes.reduce((s, v) => s + v, 0) / state.frameTimes.length 
    : 0;

  if (frameMs > t.frameTimeMaxMs * 1.2) { // 20% over threshold = serious regression
    const violation = {
      ts: Date.now(),
      type: 'frame_time_spike',
      value: frameMs.toFixed(2),
      threshold: t.frameTimeMaxMs,
      severity: frameMs > t.frameTimeMaxMs * 1.5 ? 'high' : 'medium',
    };
    state.regressions.push(violation);
  }

  const draws = state.drawCallsHistory.length
    ? state.drawCallsHistory[state.drawCallsHistory.length - 1]
    : 0;

  if (draws > t.drawCallsMax) {
    const violation = {
      ts: Date.now(),
      type: 'draw_call_spike',
      value: draws,
      threshold: t.drawCallsMax,
      severity: draws > t.drawCallsMax * 1.5 ? 'high' : 'medium',
    };
    state.regressions.push(violation);
  }

  // Keep only last 100 violations
  if (state.regressions.length > 100) {
    state.regressions = state.regressions.slice(-100);
  }
}

// Export to global namespace
if (typeof window !== 'undefined') {
  window.GQPerformanceBudget = GQPerformanceBudget;
}

// Export as module if in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GQPerformanceBudget;
}
