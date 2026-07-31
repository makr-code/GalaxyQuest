/**
 * WorkerManager.js
 *
 * Centralized manager for worker pools integrated with the GameEngine.
 * Simplifies spawning and managing multiple specialized workers:
 *   - LOD worker (Level-of-Detail calculations)
 *   - Physics worker (N-body gravity, collisions)
 *   - Data worker (mesh loading, JSON parsing, serialization)
 *
 * Usage:
 *   const manager = new WorkerManager({
 *     workerPath: '/js/engine/workers/',
 *     enablePhysics: true,
 *     enableLOD: true,
 *   });
 *
 *   const lod = await manager.executeTask('lod', 'computeLODLevel', { distance: 1000 });
 *   const physics = await manager.executeTask('physics', 'integrateVelocity', { entities, dt });
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/**
 * Dependency injection pattern for testing
 */
function _req(modPath, globalName) {
  const g = typeof window !== 'undefined' ? window : globalThis;
  if (typeof require !== 'undefined') {
    try {
      return require(modPath);
    } catch (_) {
      // Fall through to global
    }
  }
  const v = g[globalName];
  if (!v) {
    throw new Error(`[WorkerManager] missing global: ${globalName}`);
  }
  return v;
}

const { WorkerPool } = _req('./WorkerPool.js', 'GQWorkerPool');
const { WorkerMetrics } = _req('../telemetry/worker-metrics.js', 'GQWorkerMetrics');

class WorkerManager {
  /**
   * @param {Object} opts
   * @param {string} [opts.workerPath='/js/engine/workers/'] - Base path for worker scripts
   * @param {boolean} [opts.enablePhysics=true] - Enable physics worker
   * @param {boolean} [opts.enableLOD=true] - Enable LOD worker
   * @param {boolean} [opts.enableData=true] - Enable data processing worker
   * @param {number} [opts.maxWorkersPerType=2] - Max workers per type
   * @param {number} [opts.taskTimeout=30000] - Task timeout in ms
   * @param {Function} [opts.onMetrics] - Metrics callback
   */
  constructor(opts = {}) {
    this.workerPath = String(opts.workerPath || '/js/engine/workers/');
    this.maxWorkersPerType = Math.max(1, Number(opts.maxWorkersPerType) ?? 2);
    this.taskTimeout = Number(opts.taskTimeout) ?? 30000;
    this._onMetrics = typeof opts.onMetrics === 'function' ? opts.onMetrics : null;

    this._pools = new Map();        // { poolName: WorkerPool }
    this._metrics = new WorkerMetrics();
    this._initialized = false;
    this._disposed = false;

    // Initialize requested workers
    if (opts.enablePhysics !== false) this._initPhysicsPool();
    if (opts.enableLOD !== false) this._initLODPool();
    if (opts.enableData !== false) this._initDataPool();

    this._initialized = true;
  }

  /**
   * Initialize physics worker pool.
   * @private
   */
  _initPhysicsPool() {
    try {
      const pool = new WorkerPool({
        workerScript: this.workerPath + 'physics-worker.js',
        maxWorkers: this.maxWorkersPerType,
        taskTimeout: this.taskTimeout,
        onTaskStart: this._onTaskStart.bind(this, 'physics'),
        onTaskComplete: this._onTaskComplete.bind(this, 'physics'),
        onTaskError: this._onTaskError.bind(this, 'physics'),
      });
      this._pools.set('physics', pool);
    } catch (err) {
      console.error('[WorkerManager] Failed to init physics pool:', err);
    }
  }

  /**
   * Initialize LOD worker pool.
   * @private
   */
  _initLODPool() {
    try {
      const pool = new WorkerPool({
        workerScript: this.workerPath + 'lod-worker.js',
        maxWorkers: this.maxWorkersPerType,
        taskTimeout: this.taskTimeout,
        onTaskStart: this._onTaskStart.bind(this, 'lod'),
        onTaskComplete: this._onTaskComplete.bind(this, 'lod'),
        onTaskError: this._onTaskError.bind(this, 'lod'),
      });
      this._pools.set('lod', pool);
    } catch (err) {
      console.error('[WorkerManager] Failed to init LOD pool:', err);
    }
  }

  /**
   * Initialize data processing worker pool.
   * @private
   */
  _initDataPool() {
    try {
      const pool = new WorkerPool({
        workerScript: this.workerPath + 'data-worker.js',
        maxWorkers: this.maxWorkersPerType,
        taskTimeout: this.taskTimeout,
        onTaskStart: this._onTaskStart.bind(this, 'data'),
        onTaskComplete: this._onTaskComplete.bind(this, 'data'),
        onTaskError: this._onTaskError.bind(this, 'data'),
      });
      this._pools.set('data', pool);
    } catch (err) {
      console.warn('[WorkerManager] Data pool not available (worker script missing)');
    }
  }

  /**
   * Internal: record task start.
   * @private
   */
  _onTaskStart(poolType, taskId, taskName) {
    this._metrics.recordTaskStart(`${poolType}:${taskName}`, taskId);
    if (this._onMetrics) {
      this._onMetrics({ type: 'taskStart', poolType, taskId, taskName });
    }
  }

  /**
   * Internal: record task completion.
   * @private
   */
  _onTaskComplete(poolType, taskId, taskName, durationMs) {
    this._metrics.recordTaskComplete(`${poolType}:${taskName}`, taskId, durationMs);
    if (this._onMetrics) {
      this._onMetrics({ type: 'taskComplete', poolType, taskId, taskName, durationMs });
    }
  }

  /**
   * Internal: record task error.
   * @private
   */
  _onTaskError(poolType, taskId, taskName, error) {
    this._metrics.recordTaskError(`${poolType}:${taskName}`, taskId);
    if (this._onMetrics) {
      this._onMetrics({ type: 'taskError', poolType, taskId, taskName, error });
    }
  }

  /**
   * Execute a task on a specific worker pool.
   * @param {string} poolType - 'physics', 'lod', 'data'
   * @param {string} taskName - Name of task within worker
   * @param {Object} data - Input data
   * @returns {Promise}
   */
  async executeTask(poolType, taskName, data) {
    if (this._disposed) {
      throw new Error('[WorkerManager] Manager disposed');
    }

    const pool = this._pools.get(poolType);
    if (!pool) {
      throw new Error(`[WorkerManager] Pool not available: ${poolType}`);
    }

    return pool.execute(taskName, data);
  }

  /**
   * Get status of a specific pool.
   * @param {string} poolType
   * @returns {Object|null}
   */
  getPoolStatus(poolType) {
    const pool = this._pools.get(poolType);
    return pool ? pool.getStatus() : null;
  }

  /**
   * Get status of all pools.
   * @returns {Object} { poolType: status, ... }
   */
  getAllPoolStatus() {
    const result = {};
    for (const [name, pool] of this._pools) {
      result[name] = pool.getStatus();
    }
    return result;
  }

  /**
   * Get metrics for all tasks.
   * @returns {Object}
   */
  getMetrics() {
    return this._metrics.toJSON();
  }

  /**
   * Get human-readable metrics report.
   * @returns {string}
   */
  getMetricsReport() {
    return this._metrics.report();
  }

  /**
   * Reset all metrics.
   */
  resetMetrics() {
    this._metrics.reset();
  }

  /**
   * List all available pool types.
   * @returns {string[]}
   */
  listPools() {
    return Array.from(this._pools.keys());
  }

  /**
   * Dispose all worker pools.
   */
  dispose() {
    this._disposed = true;
    for (const pool of this._pools.values()) {
      pool.dispose();
    }
    this._pools.clear();
  }

  /**
   * Get comprehensive status report.
   * @returns {string}
   */
  report() {
    const lines = [
      '=== WorkerManager Report ===',
      `Initialized: ${this._initialized}`,
      `Disposed: ${this._disposed}`,
      `Active Pools: ${this._pools.size}`,
      '',
      'Pool Status:',
    ];

    for (const [name, pool] of this._pools) {
      const status = pool.getStatus();
      lines.push(
        `  ${name}: ${status.busyWorkers}/${status.totalWorkers} busy, ` +
        `${status.queueDepth} queued`
      );
    }

    lines.push('');
    lines.push(this._metrics.report());

    return lines.join('\n');
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WorkerManager };
} else {
  window.GQWorkerManager = WorkerManager;
}
