/**
 * ImpactDecalManager.js
 *
 * Manages persistent decals for explosions, impacts, and visual effects.
 * Decals are projected onto surfaces to create impact marks, burn marks, etc.
 *
 * Inspired by:
 *   - Unreal Engine: Decal actors with material projection
 *   - X4: Persistent damage marks on hulls
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/**
 * Represents a single decal instance
 * @typedef {object} Decal
 * @property {string} id
 * @property {THREE.Object3D} mesh
 * @property {THREE.Vector3} position
 * @property {THREE.Quaternion} rotation
 * @property {THREE.Vector3} scale
 * @property {string} type - 'explosion' | 'burn' | 'impact' | 'custom'
 * @property {number} createdAt - Timestamp (ms)
 * @property {number} lifespan - Duration in ms (null = permanent)
 * @property {number} fadeOutStart - When to start fading (ms before expiration)
 * @property {number} opacity - Current alpha (0-1)
 */

class ImpactDecalManager {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene - Three.js scene to add decals to
   * @param {number} opts.maxDecals - Maximum number of active decals (default: 500)
   */
  constructor(opts = {}) {
    this._scene = opts.scene || null;
    this._maxDecals = opts.maxDecals ?? 500;

    /** Map of decals: id → Decal */
    this._decals = new Map();

    /** Decal pool for reuse */
    this._decalPool = [];

    /** Counter for unique IDs */
    this._idCounter = 0;

    // Decal material templates
    this._materials = new Map();
    this._initializeDefaultMaterials();

    // Statistics
    this._stats = {
      activeDecals: 0,
      pooledDecals: 0,
    };
  }

  /**
   * Initialize default decal materials
   * @private
   */
  _initializeDefaultMaterials() {
    // Default explosion decal material
    this._materials.set('explosion', {
      type: 'explosion',
      color: 0x3d3d3d,      // Dark gray
      emissive: 0xff6600,   // Orange-red
      emissiveIntensity: 0.5,
      metalness: 0.1,
      roughness: 0.8,
      opacity: 0.7,
    });

    // Burn mark material
    this._materials.set('burn', {
      type: 'burn',
      color: 0x1a1a1a,      // Very dark
      emissive: 0x440000,   // Dark red
      emissiveIntensity: 0.2,
      metalness: 0.0,
      roughness: 1.0,
      opacity: 0.6,
    });

    // Impact mark material
    this._materials.set('impact', {
      type: 'impact',
      color: 0x4a4a4a,      // Medium gray
      emissive: 0x0066cc,   // Blue (energy impact)
      emissiveIntensity: 0.3,
      metalness: 0.3,
      roughness: 0.7,
      opacity: 0.5,
    });

    // Spark/energy residue
    this._materials.set('spark', {
      type: 'spark',
      color: 0xffff00,      // Yellow
      emissive: 0xffff00,
      emissiveIntensity: 0.8,
      metalness: 0.2,
      roughness: 0.3,
      opacity: 0.4,
    });
  }

  /**
   * Create and add a new decal
   * @param {THREE.Vector3} position - World position
   * @param {THREE.Quaternion} rotation - Rotation
   * @param {THREE.Vector3} scale - Decal size
   * @param {string} decalType - Type of decal
   * @param {object} opts
   * @param {number} opts.lifespan - Lifespan in ms (null = permanent)
   * @param {number} opts.fadeOutStart - When to fade (ms before expiration)
   * @param {object} opts.material - Custom material properties
   * @returns {string} Decal ID
   */
  addDecal(position, rotation, scale, decalType, opts = {}) {
    if (this._decals.size >= this._maxDecals) {
      this._removeOldestDecal();
    }

    const id = `decal_${this._idCounter++}`;
    const now = Date.now();

    // Get material for this decal type
    const materialProps = opts.material || this._materials.get(decalType) || this._materials.get('impact');

    // Create decal mesh (simple quad or plane geometry)
    const geometry = this._createDecalGeometry(decalType);
    const material = this._createDecalMaterial(materialProps);
    const mesh = new (typeof THREE !== 'undefined' ? THREE.Mesh : class {})( geometry, material);

    mesh.position.copy(position);
    mesh.quaternion.copy(rotation);
    mesh.scale.copy(scale);

    if (this._scene) {
      this._scene.add(mesh);
    }

    const decal = {
      id,
      mesh,
      position: position.clone ? position.clone() : position,
      rotation: rotation.clone ? rotation.clone() : rotation,
      scale: scale.clone ? scale.clone() : scale,
      type: decalType,
      createdAt: now,
      lifespan: opts.lifespan ?? null,
      fadeOutStart: opts.fadeOutStart ?? 500,
      opacity: 1.0,
    };

    this._decals.set(id, decal);
    this._stats.activeDecals = this._decals.size;

    return id;
  }

  /**
   * Create geometry for decal
   * @private
   * @param {string} decalType
   * @returns {THREE.BufferGeometry}
   */
  _createDecalGeometry(decalType) {
    // Simple plane geometry for decal
    if (typeof THREE === 'undefined') {
      return { type: 'plane' };
    }

    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    // Center the geometry
    geometry.translate(0, 0, 0);
    return geometry;
  }

  /**
   * Create material for decal
   * @private
   * @param {object} props - Material properties
   * @returns {THREE.Material}
   */
  _createDecalMaterial(props) {
    if (typeof THREE === 'undefined') {
      return { type: props.type };
    }

    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(props.color),
      emissive: new THREE.Color(props.emissive),
      emissiveIntensity: props.emissiveIntensity,
      metalness: props.metalness,
      roughness: props.roughness,
      transparent: true,
      opacity: props.opacity,
      depthWrite: false,
    });
  }

  /**
   * Update all active decals
   * @param {number} deltaTime - Frame delta in seconds
   */
  update(deltaTime) {
    const now = Date.now();
    const toRemove = [];

    for (const [id, decal] of this._decals) {
      if (decal.lifespan !== null) {
        const age = now - decal.createdAt;
        const remaining = decal.lifespan - age;

        if (remaining <= 0) {
          toRemove.push(id);
        } else if (remaining < decal.fadeOutStart) {
          // Fade out effect
          const fadeProgress = 1.0 - (remaining / decal.fadeOutStart);
          decal.opacity = 1.0 - fadeProgress;

          if (decal.mesh && decal.mesh.material) {
            decal.mesh.material.opacity = decal.opacity;
          }
        }
      }
    }

    // Remove expired decals
    for (const id of toRemove) {
      this.removeDecal(id);
    }
  }

  /**
   * Remove a specific decal
   * @param {string} id
   */
  removeDecal(id) {
    const decal = this._decals.get(id);
    if (decal) {
      if (decal.mesh && this._scene) {
        this._scene.remove(decal.mesh);
      }
      decal.mesh.geometry?.dispose();
      decal.mesh.material?.dispose();
      this._decals.delete(id);
      this._stats.activeDecals = this._decals.size;
    }
  }

  /**
   * Remove oldest decal when pool is full
   * @private
   */
  _removeOldestDecal() {
    let oldestId = null;
    let oldestTime = Infinity;

    for (const [id, decal] of this._decals) {
      if (decal.createdAt < oldestTime && decal.lifespan === null) {
        oldestTime = decal.createdAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.removeDecal(oldestId);
    }
  }

  /**
   * Clear all decals
   */
  clearAll() {
    for (const [id] of this._decals) {
      this.removeDecal(id);
    }
  }

  /**
   * Get decal by ID
   * @param {string} id
   * @returns {Decal|null}
   */
  getDecal(id) {
    return this._decals.get(id) || null;
  }

  /**
   * Get all active decals
   * @returns {Decal[]}
   */
  getAllDecals() {
    return Array.from(this._decals.values());
  }

  /**
   * Register custom decal material template
   * @param {string} name
   * @param {object} properties
   */
  registerMaterial(name, properties) {
    this._materials.set(name, properties);
  }

  /**
   * Get statistics
   * @returns {object}
   */
  getStats() {
    return { ...this._stats };
  }

  /**
   * Dispose all resources
   */
  dispose() {
    this.clearAll();
    this._materials.clear();
  }
}

// Export for both CommonJS and browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ImpactDecalManager };
}
if (typeof window !== 'undefined') {
  window.GQImpactDecalManager = { ImpactDecalManager };
}
