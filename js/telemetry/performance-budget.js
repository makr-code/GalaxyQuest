/*
 * Configurable regression targets, not hardware benchmark claims.
 * Durations are milliseconds; unknown measurements remain null.
 * Three.js info.memory geometries/textures are COUNTS, never byte estimates.
 */
'use strict';

const GQPerformanceBudget = {
  VERSION: '2.0.0',
  THRESHOLDS: {
    fpsMinimum: 50,
    frameTimeMaxMs: 25,
    cpuSubmissionMaxMs: 12,
    gpuTimeMaxMs: 20,
    drawCallsMax: 5000,
    triangleCountMax: 12_000_000,
    totalCacheMB: 350,
    ownedBufferMaxBytes: 128 * 1048576,
  },

  createMonitor(renderer, opts = {}) {
    const windowSize = Math.max(1, Math.min(600, Math.floor(Number(opts.windowSize) || 60)));
    const interval = Math.max(0, Number(opts.sampleIntervalMs) || 0);
    const scope = String(opts.scope || 'renderer');
    const thresholds = { ...this.THRESHOLDS, ...opts.thresholds };
    const regressions = [];
    const history = [];
    let previousFrame = null;
    let lastSample = -Infinity;
    let sessionStart = Date.now();
    let sampleCount = 0;
    let lastViolation = '';
    const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    const values = key => history.map(s => s[key]).filter(v => v !== null);
    const avg = key => {
      const list = values(key);
      return list.length ? list.reduce((sum, v) => sum + v, 0) / list.length : null;
    };
    const extreme = (key, fn) => {
      const list = values(key);
      return list.length ? fn(...list) : null;
    };
    const monitor = {
      // Call every submitted frame, even if storing a less frequent sample.
      update(sample = {}) {
        const now = valid(sample.timestampMs) ?? performance.now();
        const frameMs = valid(sample.frameMs) ?? (previousFrame === null ? null : valid(now - previousFrame));
        previousFrame = now;
        if (now - lastSample < interval) return false;
        lastSample = now;
        const info = renderer?.info || {};
        history.push({
          frameMs,
          cpuSubmissionMs: valid(sample.cpuSubmissionMs),
          gpuMs: valid(sample.gpuMs),
          drawCalls: valid(sample.drawCalls ?? info.render?.calls),
          triangles: valid(sample.triangles ?? info.render?.triangles),
          memoryBytes: valid(sample.memoryBytes),
          ownedBufferBytes: valid(sample.ownedBufferBytes),
          geometryCount: valid(info.memory?.geometries),
          textureCount: valid(info.memory?.textures),
        });
        if (history.length > windowSize) history.shift();
        sampleCount++;
        const status = monitor.getStatus();
        const signature = status.violations.join('|');
        if (signature && signature !== lastViolation) {
          regressions.push({ ts: Date.now(), scope, violations: status.violations });
          if (regressions.length > 100) regressions.shift();
        }
        lastViolation = signature;
        return true;
      },
      getMetrics() {
        const frameTimeAvgMs = avg('frameMs');
        const memoryAvg = avg('memoryBytes');
        const memoryMax = extreme('memoryBytes', Math.max);
        return {
          scope,
          fps: frameTimeAvgMs > 0 ? 1000 / frameTimeAvgMs : null,
          frameTimeAvgMs,
          frameTimeMinMs: extreme('frameMs', Math.min),
          frameTimeMaxMs: extreme('frameMs', Math.max),
          cpuSubmissionAvgMs: avg('cpuSubmissionMs'),
          cpuSubmissionMaxMs: extreme('cpuSubmissionMs', Math.max),
          gpuTimeAvgMs: avg('gpuMs'),
          gpuTimeMaxMs: extreme('gpuMs', Math.max),
          drawCallsAvg: avg('drawCalls'),
          drawCallsMax: extreme('drawCalls', Math.max),
          trianglesAvg: avg('triangles'),
          trianglesMax: extreme('triangles', Math.max),
          memoryAvgMB: memoryAvg === null ? null : memoryAvg / 1048576,
          memoryMaxMB: memoryMax === null ? null : memoryMax / 1048576,
          ownedBufferBytes: history.at(-1)?.ownedBufferBytes ?? null,
          geometryCount: history.at(-1)?.geometryCount ?? null,
          textureCount: history.at(-1)?.textureCount ?? null,
          sessionDurationMs: Date.now() - sessionStart,
          sampleCount,
          windowSamples: history.length,
        };
      },
      getStatus() {
        const m = monitor.getMetrics();
        const violations = [];
        for (const [metric, threshold, minimum] of [
          ['fps', 'fpsMinimum', true],
          ['frameTimeAvgMs', 'frameTimeMaxMs'],
          ['cpuSubmissionAvgMs', 'cpuSubmissionMaxMs'],
          ['gpuTimeAvgMs', 'gpuTimeMaxMs'],
          ['drawCallsAvg', 'drawCallsMax'],
          ['trianglesMax', 'triangleCountMax'],
          ['memoryMaxMB', 'totalCacheMB'],
          ['ownedBufferBytes', 'ownedBufferMaxBytes'],
        ]) {
          if (m[metric] !== null && Number.isFinite(thresholds[threshold])
            && (minimum ? m[metric] < thresholds[threshold] : m[metric] > thresholds[threshold])) {
            violations.push(metric);
          }
        }
        return {
          passed: violations.length === 0,
          measured: sampleCount > 0,
          violations,
          summary: sampleCount === 0 ? 'UNKNOWN' : violations.length ? 'FAIL' : 'PASS',
        };
      },
      getRegressions() { return regressions.map(entry => ({ ...entry, violations: entry.violations.slice() })); },
      reset() {
        history.length = 0;
        regressions.length = 0;
        previousFrame = null;
        lastSample = -Infinity;
        sampleCount = 0;
        lastViolation = '';
        sessionStart = Date.now();
      },
      report() { return JSON.stringify({ metrics: monitor.getMetrics(), status: monitor.getStatus() }); },
    };
    return monitor;
  },

  serialize(metrics, status, opts = {}) {
    return {
      sessionId: String(opts.sessionId || ''),
      userId: String(opts.userId || ''),
      timestamp: Date.now(),
      environment: String(opts.environment || 'production'),
      tags: Array.isArray(opts.tags) ? opts.tags : [],
      data: { metrics, status, thresholds: { ...this.THRESHOLDS, ...opts.thresholds } },
    };
  },
};

if (typeof window !== 'undefined') window.GQPerformanceBudget = GQPerformanceBudget;
if (typeof module !== 'undefined' && module.exports) module.exports = GQPerformanceBudget;
