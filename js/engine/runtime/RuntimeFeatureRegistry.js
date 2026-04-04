/**
 * RuntimeFeatureRegistry.js
 *
 * Registry for lifecycle-aware runtime features.
 */
(function () {
  class FeatureRegistry {
    constructor() {
      this._features = [];
      this._featureNames = new Set();
    }

    register(feature) {
      const normalized = this._normalizeFeature(feature);
      if (this._featureNames.has(normalized.name)) {
        throw new Error(`[RuntimeFeatureRegistry] Duplicate feature: ${normalized.name}`);
      }
      this._featureNames.add(normalized.name);
      this._features.push(normalized);
      return normalized;
    }

    getAll() {
      return this._features.slice();
    }

    getAllSorted() {
      return this._features.slice().sort((a, b) => {
        if (a.phaseOrder === b.phaseOrder) {
          return a.name.localeCompare(b.name);
        }
        return a.phaseOrder - b.phaseOrder;
      });
    }

    _normalizeFeature(feature) {
      if (!feature || typeof feature !== 'object') {
        throw new Error('[RuntimeFeatureRegistry] feature must be an object');
      }
      const name = String(feature.name || '').trim();
      if (!name) {
        throw new Error('[RuntimeFeatureRegistry] feature.name is required');
      }
      const phaseOrder = Number.isFinite(feature.phaseOrder) ? Number(feature.phaseOrder) : 0;
      return { ...feature, name, phaseOrder };
    }
  }

  function createFeatureRegistry() {
    return new FeatureRegistry();
  }

  const api = {
    FeatureRegistry,
    createFeatureRegistry,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeFeatureRegistry = api;
  }
})();
