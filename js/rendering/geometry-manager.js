/*
 * GQGeometryManager
 * Zentraler Einstieg fuer wiederverwendbare Geometrien inkl. LRU-Cache.
 */
(function () {
  'use strict';

  class GQGeometryManager {
    constructor(opts = {}) {
      this.THREE = opts.three || window.THREE;
      this.vesselMaxEntries = Math.max(24, Number(opts.vesselMaxEntries || 96));
      this.instancingUseThreshold = Math.max(2, Number(opts.instancingUseThreshold || 4));
      this.vesselGeometryCache = new Map();
      this.vesselUsage = new Map();
      this.instancingCandidates = new Set();
    }

    getVesselGeometry(cacheKey, factoryFn, meta = {}) {
      const key = String(cacheKey || 'vessel:default');
      const hit = this.vesselGeometryCache.get(key);
      if (hit) {
        this._trackUsage(key);
        return hit;
      }

      if (typeof factoryFn !== 'function') return null;
      const geometry = factoryFn();
      if (!geometry) return null;

      geometry.userData = Object.assign({}, geometry.userData, {
        sharedGeometry: true,
        geometryFamily: String(meta.family || 'generic'),
      });

      this.vesselGeometryCache.set(key, geometry);
      this._trackUsage(key);
      this._evictVesselIfNeeded();
      return geometry;
    }

    _trackUsage(key) {
      const uses = Number(this.vesselUsage.get(key) || 0) + 1;
      this.vesselUsage.set(key, uses);
      if (uses >= this.instancingUseThreshold) {
        this.instancingCandidates.add(key);
      }

      if (this.vesselGeometryCache.has(key)) {
        const value = this.vesselGeometryCache.get(key);
        this.vesselGeometryCache.delete(key);
        this.vesselGeometryCache.set(key, value);
      }
    }

    _evictVesselIfNeeded() {
      while (this.vesselGeometryCache.size > this.vesselMaxEntries) {
        const oldestKey = this.vesselGeometryCache.keys().next().value;
        const oldestGeo = this.vesselGeometryCache.get(oldestKey);
        oldestGeo?.dispose?.();
        this.vesselGeometryCache.delete(oldestKey);
        this.vesselUsage.delete(oldestKey);
        this.instancingCandidates.delete(oldestKey);
      }
    }

    getInstancingCandidates(minUses = this.instancingUseThreshold) {
      const min = Math.max(1, Number(minUses || 1));
      const out = [];
      for (const key of this.instancingCandidates.values()) {
        const uses = Number(this.vesselUsage.get(key) || 0);
        if (uses >= min) out.push({ key, uses });
      }
      out.sort((a, b) => b.uses - a.uses);
      return out;
    }

    dispose() {
      for (const geometry of this.vesselGeometryCache.values()) {
        geometry?.dispose?.();
      }
      this.vesselGeometryCache.clear();
      this.vesselUsage.clear();
      this.instancingCandidates.clear();
    }
  }

  window.GQGeometryManager = GQGeometryManager;
})();
