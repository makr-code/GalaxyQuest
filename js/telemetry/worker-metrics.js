/**
 * worker-metrics.js
 *
 * Performance telemetry for WebWorker task execution.
 * Tracks task duration, throughput, and error rates for optimization insights.
 *
 * Usage:
 *   const metrics = new WorkerMetrics();
 *   metrics.recordTaskStart('computeLOD', taskId);
 *   // ... task completes ...
 *   metrics.recordTaskComplete('computeLOD', taskId, durationMs);
 *
 *   console.log(metrics.report());
 *   // "Workers: 42 tasks, avg 12ms, 95th 28ms, success 100%"
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class WorkerMetrics {
  constructor() {
    this._taskMetrics = new Map();  // taskName → { count, totalMs, max, min, samples[] }
    this._activeTasks = new Map();  // taskId → { taskName, startTime, startedAt }
    this._globalStats = {
      totalTasksStarted: 0,
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      totalDurationMs: 0,
      sessionStart: Date.now(),
    };
  }

  /**
   * Record task start.
   * @param {string} taskName - Name of task
   * @param {number} taskId - Unique task ID
   */
  recordTaskStart(taskName, taskId) {
    this._activeTasks.set(taskId, {
      taskName,
      startTime: performance.now(),
      startedAt: Date.now(),
    });

    if (!this._taskMetrics.has(taskName)) {
      this._taskMetrics.set(taskName, {
        count: 0,
        totalMs: 0,
        max: 0,
        min: Infinity,
        successCount: 0,
        failureCount: 0,
        samples: [],
      });
    }

    this._globalStats.totalTasksStarted++;
  }

  /**
   * Record task completion.
   * @param {string} taskName - Name of task
   * @param {number} taskId - Unique task ID
   * @param {number} durationMs - Execution time in ms
   */
  recordTaskComplete(taskName, taskId, durationMs) {
    const task = this._activeTasks.get(taskId);
    if (!task) {
      console.warn('[WorkerMetrics] Task not found:', taskId);
      return;
    }

    const metrics = this._taskMetrics.get(taskName);
    if (!metrics) {
      return;
    }

    metrics.count++;
    metrics.totalMs += durationMs;
    metrics.max = Math.max(metrics.max, durationMs);
    metrics.min = Math.min(metrics.min, durationMs);
    metrics.successCount++;

    // Keep last 1000 samples for percentile calculation
    if (metrics.samples.length >= 1000) {
      metrics.samples.shift();
    }
    metrics.samples.push(durationMs);

    this._activeTasks.delete(taskId);
    this._globalStats.totalTasksCompleted++;
    this._globalStats.totalDurationMs += durationMs;
  }

  /**
   * Record task failure.
   * @param {string} taskName - Name of task
   * @param {number} taskId - Unique task ID
   */
  recordTaskError(taskName, taskId) {
    const task = this._activeTasks.get(taskId);
    if (!task) {
      return;
    }

    const metrics = this._taskMetrics.get(taskName);
    if (!metrics) {
      return;
    }

    metrics.failureCount++;
    this._activeTasks.delete(taskId);
    this._globalStats.totalTasksFailed++;
  }

  /**
   * Get metrics for a specific task.
   * @param {string} taskName
   * @returns {Object|null}
   */
  getTaskMetrics(taskName) {
    const m = this._taskMetrics.get(taskName);
    if (!m) return null;

    return {
      taskName,
      count: m.count,
      avgMs: m.count ? m.totalMs / m.count : 0,
      maxMs: m.max,
      minMs: m.min === Infinity ? 0 : m.min,
      p50Ms: this._percentile(m.samples, 0.5),
      p95Ms: this._percentile(m.samples, 0.95),
      p99Ms: this._percentile(m.samples, 0.99),
      successCount: m.successCount,
      failureCount: m.failureCount,
      successRate: m.count ? ((m.successCount / m.count) * 100).toFixed(1) + '%' : 'N/A',
    };
  }

  /**
   * Get all task metrics.
   * @returns {Array}
   */
  getAllTaskMetrics() {
    return Array.from(this._taskMetrics.keys())
      .map(name => this.getTaskMetrics(name))
      .filter(m => m !== null)
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get global statistics.
   * @returns {Object}
   */
  getGlobalStats() {
    const sessionDurationMs = Date.now() - this._globalStats.sessionStart;
    const totalTasks = this._globalStats.totalTasksCompleted + this._globalStats.totalTasksFailed;

    return {
      totalTasksStarted: this._globalStats.totalTasksStarted,
      totalTasksCompleted: this._globalStats.totalTasksCompleted,
      totalTasksFailed: this._globalStats.totalTasksFailed,
      successRate: totalTasks ? ((this._globalStats.totalTasksCompleted / totalTasks) * 100).toFixed(1) + '%' : 'N/A',
      avgDurationMs: this._globalStats.totalTasksCompleted
        ? (this._globalStats.totalDurationMs / this._globalStats.totalTasksCompleted).toFixed(2)
        : 0,
      totalDurationMs: this._globalStats.totalDurationMs.toFixed(0),
      sessionDurationMs,
      sessionDurationSec: (sessionDurationMs / 1000).toFixed(1),
      activeTaskCount: this._activeTasks.size,
    };
  }

  /**
   * Get human-readable report.
   * @returns {string}
   */
  report() {
    const global = this.getGlobalStats();
    const tasks = this.getAllTaskMetrics();

    const lines = [
      '=== Worker Metrics Report ===',
      `Session: ${global.sessionDurationSec}s`,
      `Total Tasks: ${global.totalTasksStarted} (${global.totalTasksCompleted} ✓, ${global.totalTasksFailed} ✗)`,
      `Success Rate: ${global.successRate}`,
      `Avg Duration: ${global.avgDurationMs}ms`,
      `Total Compute: ${global.totalDurationMs}ms`,
      `Active Tasks: ${global.activeTaskCount}`,
      '',
      'Task Breakdown:',
      ...tasks.map(t => [
        `  ${t.taskName}:`,
        `    Count: ${t.count}  Avg: ${t.avgMs.toFixed(2)}ms  Min: ${t.minMs.toFixed(2)}ms  Max: ${t.maxMs.toFixed(2)}ms`,
        `    P50: ${t.p50Ms.toFixed(2)}ms  P95: ${t.p95Ms.toFixed(2)}ms  P99: ${t.p99Ms.toFixed(2)}ms`,
        `    Success: ${t.successRate}`,
      ].join('\n')),
    ];

    return lines.join('\n');
  }

  /**
   * Calculate percentile of sorted array.
   * @private
   */
  _percentile(arr, p) {
    if (!arr || arr.length === 0) return 0;
    if (arr.length === 1) return arr[0];

    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, idx)];
  }

  /**
   * Export metrics as JSON.
   * @returns {Object}
   */
  toJSON() {
    return {
      globalStats: this.getGlobalStats(),
      taskMetrics: this.getAllTaskMetrics(),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Reset all metrics.
   */
  reset() {
    this._taskMetrics.clear();
    this._activeTasks.clear();
    this._globalStats = {
      totalTasksStarted: 0,
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      totalDurationMs: 0,
      sessionStart: Date.now(),
    };
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WorkerMetrics };
} else {
  window.GQWorkerMetrics = WorkerMetrics;
}
