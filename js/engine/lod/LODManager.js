/**
 * LODManager.js
 *
 * Central manager for Level-of-Detail (LOD) systems.
 * Tracks object distances, performs LOD selection, and manages transitions.
 *
 * Responsibilities:
 *   - Monitor camera-to-object distances
 *   - Select appropriate LOD based on distance and performance
 *   - Manage fade transitions between LOD levels
 *   - Track LOD state and statistics
 *   - Provide performance-adaptive LOD scaling
 *
 * Integration:
 *   In GameEngine._onUpdate(), call:
 *     lodManager.update(deltaTime, cameraPos, renderedObjects);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { LODConfig } = typeof require !== 'undefined'
  ? require('./LODConfig.js')
  : { LODConfig: window.GQLODConfig?.LODConfig };

/**
 * Represents an object being LOD-managed
 * @typedef {object} LODObject
 * @property {string} id - Unique identifier
 * @property {THREE.Object3D} mesh - Three.js mesh
 * @property {THREE.Vector3} position - Current position
 * @property {string} modelType - 'ship' | 'planet' | 'asteroid' | 'station'
 * @property {number} lastDistance - Cached distance from camera
 * @property {LODLevel} currentLOD - Currently active LOD level
 * @property {number} lodSwitchTime - Timestamp of last LOD switch
 * @property {number} fadeAlpha - Fade opacity (0-1) for LOD transitions
 */

class LODManager {
  /**
   * @param {LODConfig} config
   * @param {object} opts
   * @param {boolean} opts.enableMetrics - Track LOD statistics
   */
  constructor(config, opts = {}) {
    this._config = config || new LODConfig();
    this._enableMetrics = opts.enableMetrics ?? true;

    /** Map of LOD-managed objects: id → LODObject */
    this._objects = new Map();

    /** Current camera position */
    this._cameraPos = new (typeof THREE !== 'undefined' ? THREE.Vector3 : class Vector3 {
      constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    })();

    // Performance metrics
    this._metrics = {
      totalObjects: 0,
      lodSwitches: 0,
      trianglesRendered: 0,
      averageQuality: 1.0,
      lastUpdateTime: 0,
    };

    // Performance-adaptive LOD scaling
    this._adaptiveScale = 1.0; // 1.0 = normal, <1.0 = more aggressive culling
    this._lastPerfCheckTime = Date.now();
    this._perfHistory = [];
  }

  /**
   * Register an object for LOD management
   * @param {string} id
   * @param {THREE.Object3D} mesh
   * @param {string} modelType
   * @param {THREE.Vector3} position
   */
  registerObject(id, mesh, modelType, position) {
    const cascade = this._config.getLODCascade(modelType);
    const initialLOD = cascade[0]; // Start with highest detail

    this._objects.set(id, {
      id,
      mesh,
      position: position.clone ? position.clone() : position,
      modelType,
      lastDistance: Infinity,
      currentLOD: initialLOD,
      lodSwitchTime: Date.now(),
      fadeAlpha: 1.0,
      previousLOD: null,
    });

    this._metrics.totalObjects = this._objects.size;
  }

  /**
   * Unregister an object from LOD management
   * @param {string} id
   */
  unregisterObject(id) {
    this._objects.delete(id);
    this._metrics.totalObjects = this._objects.size;
  }

  /**
   * Update camera position and perform LOD selection
   * @param {number} deltaTime - Frame delta in seconds
   * @param {THREE.Vector3} cameraPos
   * @param {number} estimatedFPS - Current frame rate (for adaptive LOD)
   */
  update(deltaTime, cameraPos, estimatedFPS = 60) {
    if (!this._config.globalSettings.enabled) {
      return;
    }

    this._cameraPos.copy(cameraPos);

    // Update performance-adaptive LOD scaling
    if (estimatedFPS < this._config.globalSettings.minFPS) {
      this._adaptiveScale = Math.max(0.5, this._adaptiveScale - 0.05);
    } else if (estimatedFPS > this._config.globalSettings.targetFPS + 10) {
      this._adaptiveScale = Math.min(1.0, this._adaptiveScale + 0.02);
    }

    // Update each managed object's LOD
    let totalTriangles = 0;
    let totalQuality = 0;

    for (const [id, lodObj] of this._objects) {
      const distance = this._computeDistance(lodObj.position, cameraPos);
      const newLOD = this._selectLOD(lodObj, distance);

      // Track LOD switches
      if (newLOD !== lodObj.currentLOD) {
        this._transitionLOD(lodObj, newLOD);
        this._metrics.lodSwitches++;
      }

      // Update fade transition
      if (lodObj.previousLOD) {
        const transitionTime = this._config.globalSettings.fadeDistance / 100; // ~2 sec for 200-unit distance
        const elapsed = (Date.now() - lodObj.lodSwitchTime) / 1000;
        lodObj.fadeAlpha = Math.min(1.0, elapsed / transitionTime);

        if (lodObj.fadeAlpha >= 1.0) {
          lodObj.previousLOD = null;
        }
      }

      totalTriangles += lodObj.currentLOD.maxTriangles;
      totalQuality += lodObj.currentLOD.quality;

      lodObj.lastDistance = distance;
    }

    // Update metrics
    this._metrics.trianglesRendered = totalTriangles;
    this._metrics.averageQuality = this._objects.size > 0
      ? totalQuality / this._objects.size
      : 1.0;
    this._metrics.lastUpdateTime = Date.now();
  }

  /**
   * Compute distance from object to camera
   * @private
   * @param {THREE.Vector3} objPos
   * @param {THREE.Vector3} cameraPos
   * @returns {number}
   */
  _computeDistance(objPos, cameraPos) {
    if (objPos.distanceTo) {
      return objPos.distanceTo(cameraPos);
    }
    // Fallback for non-Three.js Vector3
    const dx = objPos.x - cameraPos.x;
    const dy = objPos.y - cameraPos.y;
    const dz = objPos.z - cameraPos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Select appropriate LOD level based on distance and performance
   * @private
   * @param {LODObject} lodObj
   * @param {number} distance
   * @returns {LODLevel}
   */
  _selectLOD(lodObj, distance) {
    const cascade = this._config.getLODCascade(lodObj.modelType);
    let selectedLOD = cascade[0];

    // Apply hysteresis to prevent thrashing
    const hysteresis = this._config.globalSettings.hysteresisDistance * this._adaptiveScale;
    const effectiveDistance = distance - hysteresis;

    // Find appropriate LOD based on distance
    for (let i = 0; i < cascade.length; i++) {
      if (effectiveDistance >= cascade[i].distance) {
        selectedLOD = cascade[i];
      }
    }

    // Performance-adaptive quality scaling
    if (this._adaptiveScale < 1.0) {
      // If performance is poor, consider using more aggressive LOD
      const qualityDropAllowed = this._config.globalSettings.maxQualityDropPercent / 100;
      const minAllowedQuality = 1.0 - qualityDropAllowed;

      if (selectedLOD.quality < minAllowedQuality) {
        // Move to next (more aggressive) LOD if available
        const currentIndex = cascade.indexOf(selectedLOD);
        if (currentIndex < cascade.length - 1) {
          selectedLOD = cascade[currentIndex + 1];
        }
      }
    }

    return selectedLOD;
  }

  /**
   * Perform LOD transition with optional fade effect
   * @private
   * @param {LODObject} lodObj
   * @param {LODLevel} newLOD
   */
  _transitionLOD(lodObj, newLOD) {
    lodObj.previousLOD = lodObj.currentLOD;
    lodObj.currentLOD = newLOD;
    lodObj.lodSwitchTime = Date.now();
    lodObj.fadeAlpha = 0.0;

    // Apply mesh/visibility changes
    if (newLOD.culled) {
      lodObj.mesh.visible = false;
    } else {
      lodObj.mesh.visible = true;

      // Swap mesh variant if needed (e.g., _lod1, _lod2)
      if (newLOD.meshVariant && lodObj.mesh.userData) {
        // This would be handled by the renderer when swapping mesh LOD variants
        lodObj.mesh.userData.lodLevel = newLOD.meshVariant;
      }

      // Update material properties for quality level
      if (lodObj.mesh.material) {
        lodObj.mesh.material.wireframe = false;
        // Could adjust texture resolution, shader quality, etc.
      }
    }
  }

  /**
   * Get current LOD information for an object
   * @param {string} id
   * @returns {LODObject|null}
   */
  getObjectLODInfo(id) {
    return this._objects.get(id) || null;
  }

  /**
   * Get current metrics
   * @returns {object}
   */
  getMetrics() {
    return { ...this._metrics };
  }

  /**
   * Set adaptive LOD scale (manual override)
   * @param {number} scale - 0.5 to 1.0
   */
  setAdaptiveScale(scale) {
    this._adaptiveScale = Math.max(0.5, Math.min(1.0, scale));
  }

  /**
   * Enable/disable LOD system
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._config.globalSettings.enabled = enabled;
  }

  /**
   * Get all managed objects
   * @returns {Map}
   */
  getObjects() {
    return this._objects;
  }
}

// Export for both CommonJS and browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LODManager };
}
if (typeof window !== 'undefined') {
  window.GQLODManager = { LODManager };
}
