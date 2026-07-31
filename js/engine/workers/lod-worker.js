/**
 * lod-worker.js
 *
 * WebWorker for Level-of-Detail (LOD) cascade calculations.
 * Offloads CPU-intensive LOD decisions to avoid blocking the render thread.
 *
 * Tasks:
 *   - computeLODLevel: Calculate appropriate LOD for a system based on distance
 *   - batchComputeLOD: Process multiple systems at once (batch mode)
 *   - updateVisibilitySet: Determine visible systems in current viewport
 *
 * Usage (in main thread):
 *   const lodWorker = new WorkerPool({
 *     workerScript: '/js/engine/workers/lod-worker.js',
 *     maxWorkers: 2,
 *   });
 *
 *   const lod = await lodWorker.execute('computeLODLevel', {
 *     distance: 1000,
 *     cameraHeight: 500,
 *     lodDistances: [100, 500, 2000, 5000],
 *   });
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// Import protocol (assumed to be loaded via importScripts if not available)
if (typeof WorkerProtocol === 'undefined') {
  importScripts('/js/engine/workers/WorkerProtocol.js');
}

/**
 * LOD Level Constants
 */
const LOD_LEVELS = {
  HIGH: 0,      // Full quality, closest
  MEDIUM: 1,    // Medium quality
  LOW: 2,       // Lower quality, distant
  CULLED: 3,    // Not visible (off-screen or too far)
};

/**
 * Default LOD distance thresholds (in game units).
 * Customize via task data if needed.
 */
const DEFAULT_LOD_DISTANCES = [
  500,    // LOD0 (HIGH): 0-500 units
  2000,   // LOD1 (MEDIUM): 500-2000 units
  5000,   // LOD2 (LOW): 2000-5000 units
  Infinity, // LOD3 (CULLED): > 5000 units
];

/**
 * Task handlers
 */
const taskHandlers = {
  /**
   * Calculate LOD level for a single system based on distance.
   * @param {Object} data
   *   - distance: number (distance from camera to system)
   *   - lodDistances: number[] (LOD threshold distances, optional)
   * @returns {Object} { distance, lodLevel, lodName }
   */
  'computeLODLevel': (data) => {
    const { distance, lodDistances = DEFAULT_LOD_DISTANCES } = data;

    if (typeof distance !== 'number' || distance < 0) {
      throw new Error('Invalid distance parameter');
    }

    let lodLevel = LOD_LEVELS.CULLED;
    for (let i = 0; i < lodDistances.length; i++) {
      if (distance < lodDistances[i]) {
        lodLevel = i;
        break;
      }
    }

    const lodNames = ['HIGH', 'MEDIUM', 'LOW', 'CULLED'];
    return {
      distance,
      lodLevel,
      lodName: lodNames[lodLevel] || 'UNKNOWN',
      lodThreshold: lodDistances[lodLevel],
    };
  },

  /**
   * Batch compute LOD for multiple systems.
   * More efficient than repeated computeLODLevel calls.
   *
   * @param {Object} data
   *   - systems: Array<{ id, x, y, z, radius? }>
   *   - cameraX, cameraY, cameraZ: number
   *   - lodDistances: number[] (optional)
   * @returns {Object} { results: Array<{ id, distance, lodLevel, lodName }> }
   */
  'batchComputeLOD': (data) => {
    const {
      systems = [],
      cameraX = 0,
      cameraY = 0,
      cameraZ = 0,
      lodDistances = DEFAULT_LOD_DISTANCES,
    } = data;

    if (!Array.isArray(systems)) {
      throw new Error('systems must be an array');
    }

    const results = systems.map(system => {
      const { id, x = 0, y = 0, z = 0, radius = 0 } = system;

      // Euclidean distance from camera to system center
      const dx = x - cameraX;
      const dy = y - cameraY;
      const dz = z - cameraZ;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Subtract radius to account for system size
      const adjustedDistance = Math.max(0, distance - (radius || 0));

      // Determine LOD
      let lodLevel = LOD_LEVELS.CULLED;
      for (let i = 0; i < lodDistances.length; i++) {
        if (adjustedDistance < lodDistances[i]) {
          lodLevel = i;
          break;
        }
      }

      const lodNames = ['HIGH', 'MEDIUM', 'LOW', 'CULLED'];
      return {
        id,
        distance: adjustedDistance,
        lodLevel,
        lodName: lodNames[lodLevel] || 'UNKNOWN',
      };
    });

    return {
      count: results.length,
      results,
      computedAt: performance.now(),
    };
  },

  /**
   * Compute visibility for viewport frustum.
   * Returns which systems are visible (not culled) based on distance.
   *
   * @param {Object} data
   *   - systems: Array<{ id, x, y, z, radius? }>
   *   - cameraX, cameraY, cameraZ: number
   *   - viewportDistance: number (max visible distance, optional)
   *   - lodDistances: number[] (optional)
   * @returns {Object} { visible: Array<{ id, distance, lodLevel }>, culled: number }
   */
  'updateVisibilitySet': (data) => {
    const {
      systems = [],
      cameraX = 0,
      cameraY = 0,
      cameraZ = 0,
      viewportDistance = 10000,
      lodDistances = DEFAULT_LOD_DISTANCES,
    } = data;

    if (!Array.isArray(systems)) {
      throw new Error('systems must be an array');
    }

    const visible = [];
    let culled = 0;

    for (const system of systems) {
      const { id, x = 0, y = 0, z = 0, radius = 0 } = system;

      const dx = x - cameraX;
      const dy = y - cameraY;
      const dz = z - cameraZ;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const adjustedDistance = Math.max(0, distance - (radius || 0));

      if (adjustedDistance > viewportDistance) {
        culled++;
        continue;
      }

      // Determine LOD
      let lodLevel = LOD_LEVELS.CULLED;
      for (let i = 0; i < lodDistances.length; i++) {
        if (adjustedDistance < lodDistances[i]) {
          lodLevel = i;
          break;
        }
      }

      visible.push({
        id,
        distance: adjustedDistance,
        lodLevel,
      });
    }

    return {
      visibleCount: visible.length,
      culledCount: culled,
      visible,
      visibilityRatio: systems.length ? ((visible.length / systems.length) * 100).toFixed(1) : '0',
    };
  },

  /**
   * Compute draw call estimate based on LOD levels.
   * Useful for performance budgeting.
   *
   * @param {Object} data
   *   - lodResults: Array<{ lodLevel }>
   *   - drawCallCosts: { [lodLevel]: number } (draw calls per LOD, optional)
   * @returns {Object} { estimatedDrawCalls, breakdown }
   */
  'estimateDrawCalls': (data) => {
    const {
      lodResults = [],
      drawCallCosts = {
        0: 150,  // HIGH LOD
        1: 80,   // MEDIUM LOD
        2: 40,   // LOW LOD
        3: 0,    // CULLED
      },
    } = data;

    if (!Array.isArray(lodResults)) {
      throw new Error('lodResults must be an array');
    }

    const breakdown = { 0: 0, 1: 0, 2: 0, 3: 0 };
    let totalDrawCalls = 0;

    for (const result of lodResults) {
      const { lodLevel } = result;
      breakdown[lodLevel]++;
      totalDrawCalls += (drawCallCosts[lodLevel] || 0);
    }

    return {
      estimatedDrawCalls: totalDrawCalls,
      breakdown,
      avgDrawCallsPerSystem: lodResults.length
        ? (totalDrawCalls / lodResults.length).toFixed(2)
        : 0,
    };
  },
};

/**
 * Set up message listener
 */
self.onmessage = WorkerProtocol.createMessageHandler(taskHandlers);

console.log('[LODWorker] Initialized');
