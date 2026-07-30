/**
 * base-worker.js
 *
 * Base template for GalaxyQuest WebWorker implementations.
 * Shows standard patterns for task handling, error management, and data transfer.
 *
 * Each specialized worker (lod-worker, physics-worker, etc.) should:
 *   1. Import WorkerProtocol (or include inline)
 *   2. Define task handlers
 *   3. Set up message listener
 *
 * Usage (in a specific worker implementation):
 *   importScripts('/js/engine/workers/WorkerProtocol.js');
 *
 *   const taskHandlers = {
 *     'computeSomething': (data) => {
 *       // Long-running computation...
 *       return result;
 *     },
 *   };
 *
 *   self.onmessage = WorkerProtocol.createMessageHandler(taskHandlers);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/**
 * WorkerProtocol - Include inline or via importScripts()
 * This is a minimal version shown here for reference.
 */
const WorkerProtocol = {
  sendSuccess(taskId, taskName, result) {
    self.postMessage({
      taskId,
      taskName,
      success: true,
      result,
      error: null,
      sentAt: performance.now(),
    });
  },

  sendError(taskId, taskName, errorMessage) {
    self.postMessage({
      taskId,
      taskName,
      success: false,
      result: null,
      error: String(errorMessage),
      sentAt: performance.now(),
    });
  },

  createMessageHandler(taskHandlers = {}) {
    return async function onWorkerMessage(event) {
      const { taskId, taskName, data } = event.data;

      if (!taskId || !taskName) {
        console.error('[WorkerProtocol] Invalid message format:', event.data);
        return;
      }

      const handler = taskHandlers[taskName];
      if (!handler) {
        WorkerProtocol.sendError(
          taskId,
          taskName,
          `Unknown task handler: ${taskName}`
        );
        return;
      }

      try {
        const result = await Promise.resolve(handler(data));
        WorkerProtocol.sendSuccess(taskId, taskName, result);
      } catch (err) {
        WorkerProtocol.sendError(
          taskId,
          taskName,
          err instanceof Error ? err.message : String(err)
        );
      }
    };
  },
};

/**
 * Example task handlers.
 * Replace these with actual implementations in specific worker files.
 */
const taskHandlers = {
  /**
   * Example: Heavy computation that benefits from worker offloading.
   * @param {Object} data - Input parameters
   * @returns {Object} result
   */
  'exampleTask': (data) => {
    const { value } = data;
    // Simulate heavy work
    let result = 0;
    for (let i = 0; i < value; i++) {
      result += Math.sqrt(i);
    }
    return { computed: result };
  },

  /**
   * Example: Data processing with error handling.
   */
  'processData': (data) => {
    const { items } = data;
    if (!Array.isArray(items)) {
      throw new Error('Expected items array');
    }
    return {
      count: items.length,
      processed: items.map(x => ({ ...x, processed: true })),
    };
  },

  /**
   * Example: Async operation in worker.
   */
  'asyncTask': async (data) => {
    // Can use async/await, Promises, etc.
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ delayed: true });
      }, 100);
    });
  },
};

/**
 * Set up message listener.
 * This will be called for every message from the main thread.
 */
self.onmessage = WorkerProtocol.createMessageHandler(taskHandlers);

/**
 * Optional: Initialize worker state if needed.
 * This runs once when the worker is created.
 */
console.log('[BaseWorker] Initialized');
