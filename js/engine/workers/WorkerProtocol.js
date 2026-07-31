/**
 * WorkerProtocol.js
 *
 * Standardized message protocol for main thread ↔ worker communication.
 * Defines message envelope format and utilities for reliable task execution.
 *
 * Message Format (main → worker):
 *   {
 *     taskId: number,
 *     taskName: string,
 *     data: Object,
 *   }
 *
 * Message Format (worker → main):
 *   {
 *     taskId: number,
 *     taskName: string,
 *     success: boolean,
 *     result: any,          // if success
 *     error: string,        // if !success
 *     durationMs: number,
 *   }
 *
 * Worker Implementation Pattern:
 *   self.onmessage = async (event) => {
 *     const { taskId, taskName, data } = event.data;
 *     try {
 *       const result = await handleTask(taskName, data);
 *       WorkerProtocol.sendSuccess(taskId, taskName, result);
 *     } catch (err) {
 *       WorkerProtocol.sendError(taskId, taskName, err.message);
 *     }
 *   };
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const WorkerProtocol = {
  /**
   * Message format constants
   */
  MESSAGE_TYPE: {
    TASK: 'task',
    RESULT: 'result',
    ERROR: 'error',
  },

  /**
   * Send success result from worker to main thread.
   * Call this from within a worker's onmessage handler.
   *
   * @param {number} taskId - Task identifier
   * @param {string} taskName - Name of the task
   * @param {*} result - Result payload (must be serializable)
   */
  sendSuccess(taskId, taskName, result) {
    const startMs = performance.now();
    self.postMessage({
      taskId,
      taskName,
      success: true,
      result,
      error: null,
      sentAt: startMs,
    });
  },

  /**
   * Send error result from worker to main thread.
   * Call this from within a worker's onmessage handler.
   *
   * @param {number} taskId - Task identifier
   * @param {string} taskName - Name of the task
   * @param {string} errorMessage - Error message
   */
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

  /**
   * Create a worker message handler wrapper.
   * Handles common error cases and message validation.
   *
   * Usage (in worker):
   *   self.onmessage = WorkerProtocol.createMessageHandler(taskHandlers);
   *
   * @param {Object} taskHandlers - Map of { taskName: async handler function }
   * @returns {Function} message handler
   */
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

  /**
   * Validate a result message from worker.
   * @param {Object} msg - Message from worker
   * @returns {Object} { valid: boolean, error?: string }
   */
  validateResultMessage(msg) {
    if (!msg) {
      return { valid: false, error: 'Message is null/undefined' };
    }
    if (typeof msg.taskId !== 'number') {
      return { valid: false, error: 'Missing or invalid taskId' };
    }
    if (typeof msg.taskName !== 'string') {
      return { valid: false, error: 'Missing or invalid taskName' };
    }
    if (typeof msg.success !== 'boolean') {
      return { valid: false, error: 'Missing or invalid success flag' };
    }
    return { valid: true };
  },

  /**
   * Transferable objects helper.
   * Some data (ArrayBuffer, etc.) should be transferred instead of copied.
   *
   * @param {*} data - Data to check
   * @returns {Array} transferable objects
   */
  getTransferables(data) {
    const transferables = [];

    if (!data || typeof data !== 'object') {
      return transferables;
    }

    // Check for ArrayBuffer
    if (data instanceof ArrayBuffer) {
      transferables.push(data);
      return transferables;
    }

    // Check for TypedArrays (their buffers are transferable)
    if (ArrayBuffer.isView(data) && data.buffer instanceof ArrayBuffer) {
      transferables.push(data.buffer);
      return transferables;
    }

    // Recursively check nested objects
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const val = data[key];
        if (val instanceof ArrayBuffer) {
          transferables.push(val);
        } else if (ArrayBuffer.isView(val) && val.buffer instanceof ArrayBuffer) {
          transferables.push(val.buffer);
        }
      }
    }

    return transferables;
  },

  /**
   * Send with transferable objects optimization.
   * Improves performance for large data transfers by transferring ownership.
   *
   * @param {Object} message - Message to send
   * @param {Worker} worker - Worker instance
   */
  postMessageWithTransfer(message, worker) {
    const transferables = this.getTransferables(message.data || message.result);
    if (transferables.length > 0) {
      worker.postMessage(message, transferables);
    } else {
      worker.postMessage(message);
    }
  },

  /**
   * Create a task result wrapper for type safety.
   * @param {number} taskId
   * @param {string} taskName
   * @param {boolean} success
   * @param {*} resultOrError
   * @returns {Object} properly formatted message
   */
  createResultMessage(taskId, taskName, success, resultOrError) {
    return {
      taskId,
      taskName,
      success,
      result: success ? resultOrError : null,
      error: success ? null : String(resultOrError),
      sentAt: performance.now(),
    };
  },
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WorkerProtocol };
} else {
  window.GQWorkerProtocol = WorkerProtocol;
}
