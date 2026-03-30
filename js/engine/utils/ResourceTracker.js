/**
 * ResourceTracker.js
 *
 * Memory-leak detection — tracks every GPU resource (GPUBuffer, GPUTexture,
 * GPUSampler, etc.) and reports objects that were never disposed.
 *
 * Usage:
 *   const tracker = new ResourceTracker();
 *   const buf = tracker.track(device.createBuffer(...));
 *   // later:
 *   tracker.dispose(buf);      // single resource
 *   tracker.disposeAll();      // everything still tracked
 *   tracker.report();          // log surviving resources
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class ResourceTracker {
  constructor() {
    /** @type {Set<Object>} */
    this._resources = new Set();
  }

  /**
   * Register a resource and return it (for one-liner use).
   * @template T
   * @param {T} resource
   * @returns {T}
   */
  track(resource) {
    this._resources.add(resource);
    return resource;
  }

  /**
   * Dispose a single resource and stop tracking it.
   * @param {Object} resource
   */
  dispose(resource) {
    if (this._resources.has(resource)) {
      if (typeof resource.destroy === 'function') resource.destroy();
      else if (typeof resource.dispose === 'function') resource.dispose();
      this._resources.delete(resource);
    }
  }

  /** Dispose and untrack all registered resources. */
  disposeAll() {
    for (const r of this._resources) {
      if (typeof r.destroy  === 'function') r.destroy();
      else if (typeof r.dispose === 'function') r.dispose();
    }
    this._resources.clear();
  }

  /** Log a summary of currently tracked (potentially leaked) resources. */
  report() {
    const count = this._resources.size;
    const msg   = `[ResourceTracker] ${count} resource(s) still tracked`;
    if (count > 0) {
      console.warn(msg, [...this._resources]);
    } else {
      console.info('[ResourceTracker] No leaks detected.');
    }
    return count;
  }

  get size() { return this._resources.size; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ResourceTracker };
} else {
  window.GQResourceTracker = ResourceTracker;
}
