/**
 * WorkerPool.js
 *
 * Manages a pool of reusable WebWorkers to offload computationally expensive tasks
 * from the main thread. Implements:
 *   - Worker lifecycle management (creation, reuse, disposal)
 *   - Task queuing & fair distribution across available workers
 *   - Performance metrics (task duration, queue depth)
 *   - Automatic degradation to main-thread fallback if Workers unavailable
 *
 * Usage:
 *   const pool = new WorkerPool({
 *     workerScript: '/js/workers/lod-worker.js',
 *     maxWorkers: 4,
 *     taskTimeout: 30000,
 *   });
 *
 *   const result = await pool.execute('computeLOD', { systemId: 42, ... });
 *   pool.dispose();
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class WorkerPool {
  /**
   * @param {Object} opts
   * @param {string} opts.workerScript - URL to worker script
   * @param {number} [opts.maxWorkers=4] - Max concurrent workers
   * @param {number} [opts.taskTimeout=30000] - Task timeout in ms
   * @param {Function} [opts.onTaskStart] - Metric callback: (taskId, taskName)
   * @param {Function} [opts.onTaskComplete] - Metric callback: (taskId, taskName, durationMs)
   * @param {Function} [opts.onTaskError] - Error callback: (taskId, taskName, error)
   */
  constructor(opts = {}) {
    this.workerScript = opts.workerScript;
    if (!this.workerScript) {
      throw new Error('[WorkerPool] workerScript required');
    }

    this.maxWorkers = Math.max(1, Number(opts.maxWorkers) ?? 4);
    this.taskTimeout = Number(opts.taskTimeout) ?? 30000;

    this._onTaskStart = typeof opts.onTaskStart === 'function' ? opts.onTaskStart : null;
    this._onTaskComplete = typeof opts.onTaskComplete === 'function' ? opts.onTaskComplete : null;
    this._onTaskError = typeof opts.onTaskError === 'function' ? opts.onTaskError : null;

    this._workers = [];        // Array of { worker, busy, taskId }
    this._taskQueue = [];      // { taskId, taskName, data, resolve, reject, startTime, timeoutId }
    this._nextTaskId = 1;
    this._metrics = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalDurationMs: 0,
      maxQueueDepth: 0,
      avgDurationMs: 0,
    };

    this._initialized = false;
    this._disposed = false;

    // Initialize worker pool
    this._initWorkers();
  }

  /**
   * Create initial pool of workers (async).
   * @private
   */
  _initWorkers() {
    try {
      // Pre-create max workers upfront (all ready by default)
      for (let i = 0; i < this.maxWorkers; i++) {
        const w = new Worker(this.workerScript);
        w.onmessage = this._handleWorkerMessage.bind(this, i);
        w.onerror = this._handleWorkerError.bind(this, i);
        this._workers.push({ worker: w, busy: false, taskId: null });
      }
      this._initialized = true;
    } catch (err) {
      console.error('[WorkerPool] Failed to initialize workers:', err);
      this._initialized = false;
    }
  }

  /**
   * Execute a task asynchronously on an available worker.
   * Falls back to main-thread execution if Workers not available.
   *
   * @param {string} taskName - Name of task (e.g., 'computeLOD')
   * @param {Object} data - Input data for worker
   * @returns {Promise} resolves with worker result or rejected on timeout
   */
  async execute(taskName, data) {
    if (this._disposed) {
      throw new Error('[WorkerPool] Pool disposed');
    }

    if (!this._initialized) {
      console.warn('[WorkerPool] Workers not available, skipping task:', taskName);
      return null;
    }

    const taskId = this._nextTaskId++;

    // Emit start metric
    if (this._onTaskStart) {
      this._onTaskStart(taskId, taskName);
    }

    this._metrics.totalTasks++;

    return new Promise((resolve, reject) => {
      const task = {
        taskId,
        taskName,
        data,
        resolve,
        reject,
        startTime: performance.now(),
        timeoutId: null,
      };

      // Set timeout for task
      task.timeoutId = setTimeout(() => {
        this._metrics.failedTasks++;
        reject(new Error(`[WorkerPool] Task ${taskName}(${taskId}) timeout after ${this.taskTimeout}ms`));
        this._removeTask(taskId);
      }, this.taskTimeout);

      // Try to dispatch immediately, otherwise queue
      this._tryDispatchTask(task);
    });
  }

  /**
   * Try to dispatch task to available worker, or queue if all busy.
   * @private
   */
  _tryDispatchTask(task) {
    // Find idle worker
    const idleWorker = this._workers.find(w => !w.busy);
    if (idleWorker) {
      this._dispatchToWorker(task, idleWorker);
    } else {
      // Queue for later
      this._taskQueue.push(task);
      this._metrics.maxQueueDepth = Math.max(this._metrics.maxQueueDepth, this._taskQueue.length);
    }
  }

  /**
   * Send task to a specific worker.
   * @private
   */
  _dispatchToWorker(task, workerSlot) {
    workerSlot.busy = true;
    workerSlot.taskId = task.taskId;

    const message = {
      taskId: task.taskId,
      taskName: task.taskName,
      data: task.data,
    };

    try {
      workerSlot.worker.postMessage(message);
    } catch (err) {
      // Serialization error — reject task
      this._metrics.failedTasks++;
      clearTimeout(task.timeoutId);
      task.reject(new Error(`[WorkerPool] Serialization error: ${err.message}`));
      workerSlot.busy = false;
      workerSlot.taskId = null;
      this._processQueue();
    }
  }

  /**
   * Handle message from worker.
   * @private
   */
  _handleWorkerMessage(workerIndex, event) {
    const { taskId, taskName, success, result, error } = event.data;
    const workerSlot = this._workers[workerIndex];

    // Find task in flight
    const task = this._taskQueue.find(t => t.taskId === taskId);
    const foundInQueue = !!task;

    if (!foundInQueue) {
      // Might have already timed out, ignore
      console.warn('[WorkerPool] Received message for unknown task:', taskId);
      workerSlot.busy = false;
      workerSlot.taskId = null;
      this._processQueue();
      return;
    }

    clearTimeout(task.timeoutId);
    const durationMs = performance.now() - task.startTime;

    if (success) {
      this._metrics.completedTasks++;
      this._metrics.totalDurationMs += durationMs;
      this._metrics.avgDurationMs = this._metrics.totalDurationMs / this._metrics.completedTasks;

      if (this._onTaskComplete) {
        this._onTaskComplete(taskId, taskName, durationMs);
      }

      task.resolve(result);
    } else {
      this._metrics.failedTasks++;
      if (this._onTaskError) {
        this._onTaskError(taskId, taskName, error);
      }
      task.reject(new Error(`[WorkerPool] Task ${taskName} failed: ${error}`));
    }

    // Mark worker idle & process queue
    workerSlot.busy = false;
    workerSlot.taskId = null;
    this._removeTask(taskId);
    this._processQueue();
  }

  /**
   * Handle worker error.
   * @private
   */
  _handleWorkerError(workerIndex, event) {
    console.error('[WorkerPool] Worker error:', event.message);
    const workerSlot = this._workers[workerIndex];
    const taskId = workerSlot.taskId;

    if (taskId) {
      const task = this._taskQueue.find(t => t.taskId === taskId);
      if (task) {
        clearTimeout(task.timeoutId);
        this._metrics.failedTasks++;
        if (this._onTaskError) {
          this._onTaskError(taskId, task.taskName, event.message);
        }
        task.reject(new Error(`[WorkerPool] Worker crashed: ${event.message}`));
        this._removeTask(taskId);
      }
    }

    // Try to recover: restart worker
    try {
      workerSlot.worker = new Worker(this.workerScript);
      workerSlot.worker.onmessage = this._handleWorkerMessage.bind(this, workerIndex);
      workerSlot.worker.onerror = this._handleWorkerError.bind(this, workerIndex);
      workerSlot.busy = false;
      workerSlot.taskId = null;
      this._processQueue();
    } catch (err) {
      console.error('[WorkerPool] Failed to recover worker:', err);
    }
  }

  /**
   * Remove task from queue.
   * @private
   */
  _removeTask(taskId) {
    const idx = this._taskQueue.findIndex(t => t.taskId === taskId);
    if (idx !== -1) {
      this._taskQueue.splice(idx, 1);
    }
  }

  /**
   * Process queued tasks on idle workers.
   * @private
   */
  _processQueue() {
    while (this._taskQueue.length > 0) {
      const idleWorker = this._workers.find(w => !w.busy);
      if (!idleWorker) break;
      const task = this._taskQueue.shift();
      this._dispatchToWorker(task, idleWorker);
    }
  }

  /**
   * Terminate all workers and dispose pool.
   */
  dispose() {
    this._disposed = true;
    this._workers.forEach(w => w.worker.terminate());
    this._workers = [];
    this._taskQueue.forEach(t => {
      clearTimeout(t.timeoutId);
      t.reject(new Error('[WorkerPool] Pool disposed'));
    });
    this._taskQueue = [];
  }

  /**
   * Get performance metrics.
   * @returns {Object} metrics snapshot
   */
  getMetrics() {
    return { ...this._metrics };
  }

  /**
   * Reset metrics (useful for session boundaries).
   */
  resetMetrics() {
    this._metrics = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalDurationMs: 0,
      maxQueueDepth: 0,
      avgDurationMs: 0,
    };
  }

  /**
   * Get current queue depth and worker status.
   * @returns {Object}
   */
  getStatus() {
    return {
      queueDepth: this._taskQueue.length,
      busyWorkers: this._workers.filter(w => w.busy).length,
      totalWorkers: this._workers.length,
      initialized: this._initialized,
      disposed: this._disposed,
    };
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WorkerPool };
} else {
  window.GQWorkerPool = WorkerPool;
}
