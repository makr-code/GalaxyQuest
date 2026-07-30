/**
 * AsteroidBeltAnimator.js — Manages rotating asteroid belt and debris field animations.
 *
 * Handles:
 *   • Belt rotation and drift
 *   • Particle tumbling and precession
 *   • Distance-based LOD (detail reduction at distance)
 *   • Optional collision/impact effects
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class AsteroidBeltAnimator {
  constructor() {
    /** @type {Map<string, BeltState>} Tracked asteroid belts */
    this._belts = new Map();
    
    /** @type {number} Global animation time */
    this._time = 0;

    /** @type {number} Master animation scale */
    this._animationScale = 1.0;
  }

  /**
   * Register an asteroid belt for animation.
   *
   * @param {string} beltId - Unique identifier
   * @param {THREE.Group|THREE.Mesh} beltMesh - The belt geometry/particle system
   * @param {object} [config] - Configuration
   * @param {number} [config.rotationSpeed=0.05] - Radians per second
   * @param {number} [config.tiltAxis=[0,0,1]] - Rotation axis (x, y, z)
   * @param {number} [config.driftSpeed=0.01] - Optional drift/precession speed
   * @param {boolean} [config.autoRotate=true] - Auto-rotate in update
   * @param {number} [config.visibilityDistance=500] - Hide if farther than this
   */
  addBelt(beltId, beltMesh, config = {}) {
    if (!beltMesh) return;

    const state = {
      mesh: beltMesh,
      rotationSpeed: config.rotationSpeed ?? 0.05,
      driftSpeed: config.driftSpeed ?? 0.01,
      tiltAxis: config.tiltAxis ?? [0, 0, 1],
      autoRotate: config.autoRotate ?? true,
      visibilityDistance: config.visibilityDistance ?? 500,
      rotationAngle: 0,
      driftAngle: 0,
    };

    this._belts.set(beltId, state);
  }

  /**
   * Remove an asteroid belt from animation.
   * @param {string} beltId
   */
  removeBelt(beltId) {
    this._belts.delete(beltId);
  }

  /**
   * Update all animated belts. Call once per frame.
   * @param {number} dt - Delta-time (seconds)
   * @param {object} [cameraPos] - Camera position for visibility culling
   */
  update(dt, cameraPos = null) {
    this._time += dt;

    for (const [beltId, state] of this._belts.entries()) {
      if (!state.mesh) continue;

      if (state.autoRotate) {
        // Continuous rotation around the tilt axis
        state.rotationAngle += state.rotationSpeed * dt * this._animationScale;

        // Optional precession/drift
        if (state.driftSpeed > 0) {
          state.driftAngle += state.driftSpeed * dt * this._animationScale;
        }

        // Apply rotation to mesh
        this._applyRotation(state.mesh, state);
      }

      // Visibility culling
      if (cameraPos) {
        const dist = Math.hypot(
          state.mesh.position.x - cameraPos.x,
          state.mesh.position.y - cameraPos.y,
          state.mesh.position.z - cameraPos.z
        );
        state.mesh.visible = dist < state.visibilityDistance;
      }
    }
  }

  /**
   * Apply rotation quaternion to mesh.
   * @private
   */
  _applyRotation(mesh, state) {
    if (!mesh.quaternion) return;

    const THREE = window.THREE;
    if (!THREE) return;

    // Main rotation
    const qMain = new THREE.Quaternion();
    qMain.setFromAxisAngle(
      new THREE.Vector3(...state.tiltAxis).normalize(),
      state.rotationAngle
    );

    // Optional drift/precession
    let qFinal = qMain;
    if (state.driftAngle > 0) {
      const qDrift = new THREE.Quaternion();
      qDrift.setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.driftAngle);
      qFinal = qMain.multiply(qDrift);
    }

    mesh.quaternion.copy(qFinal);
  }

  /**
   * Set animation speed scale for LOD.
   * @param {number} scale - 0 = stopped, 1 = normal
   */
  setAnimationScale(scale) {
    this._animationScale = Math.max(0, Math.min(1, scale));
  }

  /**
   * Stop all belt rotation (for paused state).
   */
  pauseAll() {
    this.setAnimationScale(0);
  }

  /**
   * Resume all belt rotation.
   */
  resumeAll() {
    this.setAnimationScale(1);
  }

  /**
   * Clear all belts.
   */
  clear() {
    this._belts.clear();
    this._time = 0;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AsteroidBeltAnimator };
}

if (typeof window !== 'undefined') {
  window.GQAsteroidBeltAnimator = { AsteroidBeltAnimator };
}
