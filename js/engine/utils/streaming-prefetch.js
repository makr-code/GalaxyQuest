/**
 * streaming-prefetch.js
 *
 * Predictive asset streaming and prefetch optimization.
 * Anticipates viewport changes and preloads assets before needed.
 *
 * Usage:
 *   const prefetcher = new StreamingPrefetcher({
 *     workerManager: managerInstance,
 *     chunkSize: 1000,
 *     lookaheadDistance: 5000,
 *   });
 *
 *   prefetcher.updateViewport(cameraPos);
 *   await prefetcher.prefetchChunks();
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class StreamingPrefetcher {
  /**
   * @param {Object} opts
   * @param {WorkerManager} opts.workerManager - Worker manager instance
   * @param {number} [opts.chunkSize=1000] - Distance per chunk
   * @param {number} [opts.lookaheadDistance=5000] - Prefetch distance ahead
   * @param {Function} [opts.onChunkLoad] - Callback when chunk loaded
   * @param {Function} [opts.onChunkUnload] - Callback when chunk unloaded
   */
  constructor(opts = {}) {
    this.workerManager = opts.workerManager;
    if (!this.workerManager) {
      throw new Error('[StreamingPrefetcher] workerManager required');
    }

    this.chunkSize = Math.max(1, Number(opts.chunkSize) ?? 1000);
    this.lookaheadDistance = Math.max(0, Number(opts.lookaheadDistance) ?? 5000);

    this._onChunkLoad = typeof opts.onChunkLoad === 'function' ? opts.onChunkLoad : null;
    this._onChunkUnload = typeof opts.onChunkUnload === 'function' ? opts.onChunkUnload : null;

    this._loadedChunks = new Set();      // Set of loaded chunk IDs
    this._pendingChunks = new Set();     // Set of chunks waiting to load
    this._currentViewport = null;        // { x, y, z }
    this._chunkData = new Map();         // chunkId → { systems: [], metadata }
    this._metrics = {
      chunksLoaded: 0,
      chunksUnloaded: 0,
      prefetchLatencyMs: 0,
      totalAssetSize: 0,
    };
  }

  /**
   * Update camera viewport position.
   * @param {Object} pos - { x, y, z }
   */
  updateViewport(pos) {
    this._currentViewport = { ...pos };
  }

  /**
   * Calculate which chunks should be loaded based on viewport.
   * @returns {Set<number>} chunk IDs to load
   */
  _calculateRequiredChunks() {
    if (!this._currentViewport) return new Set();

    const { x, y, z } = this._currentViewport;
    const required = new Set();

    // Simple grid-based chunking
    // In 3D, divide space into chunks based on position
    const baseChunkX = Math.floor(x / this.chunkSize);
    const baseChunkY = Math.floor(y / this.chunkSize);
    const baseChunkZ = Math.floor(z / this.chunkSize);

    // Look ahead: include chunks within lookahead distance
    const lookRange = Math.ceil(this.lookaheadDistance / this.chunkSize);

    for (let dx = -lookRange; dx <= lookRange; dx++) {
      for (let dy = -lookRange; dy <= lookRange; dy++) {
        for (let dz = -lookRange; dz <= lookRange; dz++) {
          // Simple distance heuristic
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist <= lookRange) {
            const chunkId = this._hashChunk(baseChunkX + dx, baseChunkY + dy, baseChunkZ + dz);
            required.add(chunkId);
          }
        }
      }
    }

    return required;
  }

  /**
   * Hash chunk coordinates to ID.
   * @private
   */
  _hashChunk(x, y, z) {
    // Simple hash: treat as single number (may collide with very large coordinates)
    return (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  }

  /**
   * Prefetch required chunks asynchronously.
   * @returns {Promise}
   */
  async prefetchChunks() {
    const required = this._calculateRequiredChunks();
    const toLoad = Array.from(required).filter(id => !this._loadedChunks.has(id));
    const toUnload = Array.from(this._loadedChunks).filter(id => !required.has(id));

    const startMs = performance.now();

    // Load new chunks
    for (const chunkId of toLoad) {
      if (this._pendingChunks.has(chunkId)) continue;

      this._pendingChunks.add(chunkId);

      try {
        // In a real implementation, this would fetch from server or generate
        const chunkData = await this._loadChunk(chunkId);
        this._chunkData.set(chunkId, chunkData);
        this._loadedChunks.add(chunkId);
        this._pendingChunks.delete(chunkId);

        if (this._onChunkLoad) {
          this._onChunkLoad(chunkId, chunkData);
        }

        this._metrics.chunksLoaded++;
      } catch (err) {
        console.error(`[StreamingPrefetcher] Failed to load chunk ${chunkId}:`, err);
        this._pendingChunks.delete(chunkId);
      }
    }

    // Unload distant chunks
    for (const chunkId of toUnload) {
      this._loadedChunks.delete(chunkId);
      const data = this._chunkData.get(chunkId);
      this._chunkData.delete(chunkId);

      if (this._onChunkUnload) {
        this._onChunkUnload(chunkId, data);
      }

      this._metrics.chunksUnloaded++;
    }

    this._metrics.prefetchLatencyMs = performance.now() - startMs;
  }

  /**
   * Load a single chunk (placeholder).
   * In real implementation, would fetch from server or generate procedurally.
   * @private
   */
  async _loadChunk(chunkId) {
    // Simulate async loading
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          chunkId,
          systems: [],
          metadata: {
            loadedAt: Date.now(),
          },
        });
      }, Math.random() * 100);
    });
  }

  /**
   * Get prefetch metrics.
   * @returns {Object}
   */
  getMetrics() {
    return { ...this._metrics };
  }

  /**
   * Get current loaded chunk count.
   * @returns {number}
   */
  getLoadedChunkCount() {
    return this._loadedChunks.size;
  }

  /**
   * Get pending chunk count.
   * @returns {number}
   */
  getPendingChunkCount() {
    return this._pendingChunks.size;
  }

  /**
   * Clear all loaded chunks.
   */
  clear() {
    this._loadedChunks.clear();
    this._pendingChunks.clear();
    this._chunkData.clear();
  }

  /**
   * Get status report.
   * @returns {string}
   */
  report() {
    return [
      `[StreamingPrefetcher]`,
      `  Loaded Chunks: ${this._loadedChunks.size}`,
      `  Pending Chunks: ${this._pendingChunks.size}`,
      `  Total Loaded: ${this._metrics.chunksLoaded}`,
      `  Total Unloaded: ${this._metrics.chunksUnloaded}`,
      `  Prefetch Latency: ${this._metrics.prefetchLatencyMs.toFixed(2)}ms`,
    ].join('\n');
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StreamingPrefetcher };
} else {
  window.GQStreamingPrefetcher = StreamingPrefetcher;
}
