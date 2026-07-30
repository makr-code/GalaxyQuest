/**
 * LODConfig.js
 *
 * Configuration for Level-of-Detail (LOD) systems.
 * Defines LOD thresholds, cascades, and fallback strategies per model type.
 *
 * Inspired by:
 *   - Unreal Engine: LOD systems with distance-based selection
 *   - X4: Billboard rendering for distant objects
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/**
 * LOD level definition
 * @typedef {object} LODLevel
 * @property {number} distance - Distance threshold (units). Objects beyond this use this LOD.
 * @property {number} quality - Quality level (1.0 = full, 0.5 = half resolution, etc.)
 * @property {number} maxTriangles - Approximate triangle budget for this LOD
 * @property {boolean} usesBillboard - If true, render as 2D billboard instead of 3D mesh
 * @property {string} meshVariant - Mesh ID suffix (e.g., "_lod1", "_lod2")
 * @property {boolean} culled - If true, don't render at all (for extreme distances)
 */

class LODConfig {
  constructor() {
    /**
     * Default LOD cascade for ships
     * @type {LODLevel[]}
     */
    this.shipLODs = [
      { distance: 0,      quality: 1.0,   maxTriangles: 50000, usesBillboard: false, meshVariant: '',      culled: false },
      { distance: 500,    quality: 0.7,   maxTriangles: 25000, usesBillboard: false, meshVariant: '_lod1',  culled: false },
      { distance: 1500,   quality: 0.4,   maxTriangles: 10000, usesBillboard: false, meshVariant: '_lod2',  culled: false },
      { distance: 3000,   quality: 0.15,  maxTriangles: 3000,  usesBillboard: true,  meshVariant: '_lod3',  culled: false },
      { distance: 10000,  quality: 0,     maxTriangles: 0,     usesBillboard: false, meshVariant: '',       culled: true  },
    ];

    /**
     * LOD cascade for planets
     * @type {LODLevel[]}
     */
    this.planetLODs = [
      { distance: 0,      quality: 1.0,   maxTriangles: 100000, usesBillboard: false, meshVariant: '',      culled: false },
      { distance: 2000,   quality: 0.8,   maxTriangles: 50000,  usesBillboard: false, meshVariant: '_lod1',  culled: false },
      { distance: 5000,   quality: 0.5,   maxTriangles: 20000,  usesBillboard: false, meshVariant: '_lod2',  culled: false },
      { distance: 15000,  quality: 0.2,   maxTriangles: 5000,   usesBillboard: true,  meshVariant: '_lod3',  culled: false },
      { distance: 50000,  quality: 0,     maxTriangles: 0,      usesBillboard: false, meshVariant: '',       culled: true  },
    ];

    /**
     * LOD cascade for asteroids/debris
     * @type {LODLevel[]}
     */
    this.asteroidLODs = [
      { distance: 0,      quality: 1.0,   maxTriangles: 20000, usesBillboard: false, meshVariant: '',      culled: false },
      { distance: 300,    quality: 0.6,   maxTriangles: 8000,  usesBillboard: false, meshVariant: '_lod1',  culled: false },
      { distance: 1000,   quality: 0.2,   maxTriangles: 2000,  usesBillboard: true,  meshVariant: '_lod2',  culled: false },
      { distance: 5000,   quality: 0,     maxTriangles: 0,     usesBillboard: false, meshVariant: '',       culled: true  },
    ];

    /**
     * LOD cascade for stations/structures
     * @type {LODLevel[]}
     */
    this.stationLODs = [
      { distance: 0,      quality: 1.0,   maxTriangles: 80000, usesBillboard: false, meshVariant: '',      culled: false },
      { distance: 1000,   quality: 0.7,   maxTriangles: 40000, usesBillboard: false, meshVariant: '_lod1',  culled: false },
      { distance: 3000,   quality: 0.4,   maxTriangles: 15000, usesBillboard: false, meshVariant: '_lod2',  culled: false },
      { distance: 8000,   quality: 0.1,   maxTriangles: 3000,  usesBillboard: true,  meshVariant: '_lod3',  culled: false },
      { distance: 30000,  quality: 0,     maxTriangles: 0,     usesBillboard: false, meshVariant: '',       culled: true  },
    ];

    /**
     * Global LOD settings
     */
    this.globalSettings = {
      // Enable/disable LOD system globally
      enabled: true,

      // Maximum performance drop before clamping LOD levels
      maxQualityDropPercent: 30,

      // Hysteresis to prevent LOD thrashing (units)
      hysteresisDistance: 100,

      // Billboard render size multiplier (1.0 = object bounding box, 2.0 = 2x larger)
      billboardSizeMultiplier: 1.5,

      // Fade transition distance (units). Objects fade between LODs over this range.
      fadeDistance: 200,

      // Enable fade animation between LODs
      enableFadeTransitions: true,

      // Performance monitoring interval (ms)
      perfMonitorInterval: 1000,

      // Target FPS for adaptive LOD scaling
      targetFPS: 60,

      // Minimum FPS threshold before aggressively culling distant objects
      minFPS: 30,
    };
  }

  /**
   * Get LOD cascade for a given model type
   * @param {string} modelType - 'ship' | 'planet' | 'asteroid' | 'station' | custom type
   * @returns {LODLevel[]}
   */
  getLODCascade(modelType) {
    switch (modelType.toLowerCase()) {
      case 'ship':      return this.shipLODs;
      case 'planet':    return this.planetLODs;
      case 'asteroid':  return this.asteroidLODs;
      case 'debris':    return this.asteroidLODs;
      case 'station':   return this.stationLODs;
      default:
        // Default to ship LODs for unknown types
        console.warn(`[LODConfig] Unknown model type: ${modelType}, using ship LODs`);
        return this.shipLODs;
    }
  }

  /**
   * Get LOD level for a given distance
   * @param {string} modelType
   * @param {number} distance
   * @returns {LODLevel}
   */
  getLODAtDistance(modelType, distance) {
    const cascade = this.getLODCascade(modelType);
    for (let i = cascade.length - 1; i >= 0; i--) {
      if (distance >= cascade[i].distance) {
        return cascade[i];
      }
    }
    return cascade[0];
  }

  /**
   * Register a custom LOD cascade
   * @param {string} modelType
   * @param {LODLevel[]} cascade
   */
  registerCustomLOD(modelType, cascade) {
    this[`${modelType}LODs`] = cascade;
  }
}

// Export for both CommonJS and browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LODConfig };
}
if (typeof window !== 'undefined') {
  window.GQLODConfig = { LODConfig };
}
