/**
 * ObjectPool.js
 *
 * Reusable object pool for frequently-allocated objects (vectors, matrices, etc.).
 * Reduces GC pressure and improves performance by reusing objects instead of
 * allocating new ones every frame.
 *
 * Usage:
 *   // Create a pool of Vector3 objects
 *   const vec3Pool = new ObjectPool({
 *     factory: () => new THREE.Vector3(),
 *     reset: (v) => v.set(0, 0, 0),
 *     initialSize: 100,
 *   });
 *
 *   const v = vec3Pool.acquire();
 *   v.set(1, 2, 3);
 *   // ... use v ...
 *   vec3Pool.release(v);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class ObjectPool {
  /**
   * @param {Object} opts
   * @param {Function} opts.factory - Function to create new instances
   * @param {Function} [opts.reset] - Optional reset function called on release
   * @param {number} [opts.initialSize=32] - Pre-allocate this many objects
   * @param {number} [opts.maxSize=1000] - Maximum pool size
   * @param {boolean} [opts.autoShrink=false] - Return to initialSize on reset
   */
  constructor(opts = {}) {
    this.factory = opts.factory;
    if (typeof this.factory !== 'function') {
      throw new Error('[ObjectPool] factory function required');
    }

    this.reset = typeof opts.reset === 'function' ? opts.reset : null;
    this.initialSize = Math.max(1, Number(opts.initialSize) ?? 32);
    this.maxSize = Math.max(this.initialSize, Number(opts.maxSize) ?? 1000);
    this.autoShrink = Boolean(opts.autoShrink);

    this._available = [];
    this._inUse = new Set();
    this._stats = {
      totalCreated: 0,
      totalAcquired: 0,
      totalReleased: 0,
      peakInUse: 0,
      allocationCount: 0,
    };

    // Pre-allocate initial objects
    this._preallocate(this.initialSize);
  }

  /**
   * Pre-allocate pool objects.
   * @private
   */
  _preallocate(count) {
    for (let i = 0; i < count; i++) {
      const obj = this.factory();
      this._available.push(obj);
      this._stats.totalCreated++;
    }
  }

  /**
   * Acquire an object from the pool.
   * Creates new instance if pool empty (up to maxSize limit).
   * @returns {Object}
   */
  acquire() {
    let obj;
    if (this._available.length > 0) {
      obj = this._available.pop();
    } else if (this._inUse.size + this._available.length < this.maxSize) {
      obj = this.factory();
      this._stats.totalCreated++;
      this._stats.allocationCount++;
    } else {
      // Pool exhausted — return a new instance (may cause GC)
      // This should rarely happen in well-tuned pools
      console.warn('[ObjectPool] Pool exhausted, creating new instance (potential GC)');
      obj = this.factory();
      this._stats.totalCreated++;
    }

    this._inUse.add(obj);
    this._stats.totalAcquired++;
    this._stats.peakInUse = Math.max(this._stats.peakInUse, this._inUse.size);

    return obj;
  }

  /**
   * Release an object back to the pool.
   * Calls reset() if defined.
   * @param {Object} obj
   */
  release(obj) {
    if (!this._inUse.has(obj)) {
      console.warn('[ObjectPool] Attempting to release object not in pool');
      return;
    }

    this._inUse.delete(obj);

    // Reset object state
    if (this.reset) {
      this.reset(obj);
    }

    // Return to pool if not at capacity
    if (this._available.length < this.initialSize || !this.autoShrink) {
      this._available.push(obj);
    }

    this._stats.totalReleased++;
  }

  /**
   * Acquire multiple objects at once.
   * @param {number} count
   * @returns {Array}
   */
  acquireMultiple(count) {
    const objs = [];
    for (let i = 0; i < count; i++) {
      objs.push(this.acquire());
    }
    return objs;
  }

  /**
   * Release multiple objects at once.
   * @param {Array} objs
   */
  releaseMultiple(objs) {
    if (!Array.isArray(objs)) return;
    objs.forEach(obj => this.release(obj));
  }

  /**
   * Get current pool status.
   * @returns {Object}
   */
  getStatus() {
    return {
      available: this._available.length,
      inUse: this._inUse.size,
      total: this._available.length + this._inUse.size,
      utilization: this._inUse.size + this._available.length > 0
        ? ((this._inUse.size / (this._inUse.size + this._available.length)) * 100).toFixed(1) + '%'
        : '0%',
    };
  }

  /**
   * Get performance metrics.
   * @returns {Object}
   */
  getMetrics() {
    return { ...this._stats };
  }

  /**
   * Clear the pool and release all objects.
   * Useful for cleanup.
   */
  clear() {
    this._available = [];
    this._inUse.clear();
  }

  /**
   * Trim pool back to initialSize.
   * Useful for memory recovery.
   */
  trim() {
    while (this._available.length > this.initialSize) {
      this._available.pop();
    }
  }

  /**
   * Get human-readable status report.
   * @returns {string}
   */
  report() {
    const status = this.getStatus();
    const metrics = this.getMetrics();
    return [
      `[ObjectPool]`,
      `  Available: ${status.available}`,
      `  In Use: ${status.inUse}`,
      `  Total: ${status.total}`,
      `  Utilization: ${status.utilization}`,
      `  Created: ${metrics.totalCreated}`,
      `  Peak In Use: ${metrics.peakInUse}`,
      `  Allocations: ${metrics.allocationCount}`,
    ].join('\n');
  }
}

/**
 * PoolManager - Centralized manager for multiple object pools.
 * Simplifies management of several pool types.
 */
class PoolManager {
  constructor() {
    this._pools = new Map();
  }

  /**
   * Register or create a new pool.
   * @param {string} name - Pool identifier
   * @param {Object} opts - ObjectPool options
   * @returns {ObjectPool}
   */
  createPool(name, opts) {
    if (this._pools.has(name)) {
      console.warn(`[PoolManager] Pool "${name}" already exists`);
      return this._pools.get(name);
    }

    const pool = new ObjectPool(opts);
    this._pools.set(name, pool);
    return pool;
  }

  /**
   * Get an existing pool.
   * @param {string} name
   * @returns {ObjectPool|null}
   */
  getPool(name) {
    return this._pools.get(name) || null;
  }

  /**
   * Remove a pool.
   * @param {string} name
   */
  removePool(name) {
    const pool = this._pools.get(name);
    if (pool) {
      pool.clear();
      this._pools.delete(name);
    }
  }

  /**
   * Get all pool names.
   * @returns {string[]}
   */
  listPools() {
    return Array.from(this._pools.keys());
  }

  /**
   * Get status of all pools.
   * @returns {Object} { poolName: status, ... }
   */
  getAllStatus() {
    const result = {};
    for (const [name, pool] of this._pools) {
      result[name] = pool.getStatus();
    }
    return result;
  }

  /**
   * Get metrics for all pools.
   * @returns {Object} { poolName: metrics, ... }
   */
  getAllMetrics() {
    const result = {};
    for (const [name, pool] of this._pools) {
      result[name] = pool.getMetrics();
    }
    return result;
  }

  /**
   * Trim all pools to initial size.
   */
  trimAll() {
    for (const pool of this._pools.values()) {
      pool.trim();
    }
  }

  /**
   * Clear all pools.
   */
  clearAll() {
    for (const pool of this._pools.values()) {
      pool.clear();
    }
  }

  /**
   * Get comprehensive report for all pools.
   * @returns {string}
   */
  report() {
    const lines = ['=== PoolManager Report ==='];
    for (const [name, pool] of this._pools) {
      lines.push(`\nPool: ${name}`);
      lines.push(pool.report());
    }
    return lines.join('\n');
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ObjectPool, PoolManager };
} else {
  window.GQObjectPool = ObjectPool;
  window.GQPoolManager = PoolManager;
}
