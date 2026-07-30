/**
 * NebulaAnimator.js — Manages nebula cloud animations and effects.
 *
 * Handles:
 *   • Cloud drift and slow movement
 *   • UV scrolling for texture animation
 *   • Opacity pulsation
 *   • Multi-layer depth effects
 *   • Distance-based LOD
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class NebulaAnimator {
  constructor() {
    /** @type {Map<string, NebulaState>} Tracked nebulae */
    this._nebulae = new Map();
    
    /** @type {number} Global animation time */
    this._time = 0;

    /** @type {number} Master animation scale */
    this._animationScale = 1.0;
  }

  /**
   * Register a nebula cloud for animation.
   *
   * @param {string} nebulaId - Unique identifier
   * @param {THREE.Mesh|THREE.Group} nebulaMesh - The nebula geometry/billboard
   * @param {object} [config] - Configuration
   * @param {number} [config.driftSpeed=0.02] - Linear drift speed (units/s)
   * @param {THREE.Vector3} [config.driftDirection=[1,0,0]] - Drift direction (normalized)
   * @param {number} [config.rotationSpeed=0.005] - Radians per second
   * @param {boolean} [config.enableUVScroll=true] - Animate texture UV
   * @param {number} [config.uvScrollSpeed=0.1] - UV scroll speed
   * @param {number} [config.pulseFrequency=0.5] - Hz for opacity pulse
   * @param {number} [config.baseOpacity=0.5] - Minimum opacity
   * @param {number} [config.peakOpacity=0.8] - Maximum opacity
   * @param {number} [config.visibilityDistance=800] - LOD distance
   */
  addNebula(nebulaId, nebulaMesh, config = {}) {
    if (!nebulaMesh) return;

    const driftDir = config.driftDirection ?? [1, 0, 0];
    const len = Math.sqrt(driftDir[0]**2 + driftDir[1]**2 + driftDir[2]**2);
    const normalizedDir = len > 0 ? [driftDir[0]/len, driftDir[1]/len, driftDir[2]/len] : [1, 0, 0];

    const state = {
      mesh: nebulaMesh,
      driftSpeed: config.driftSpeed ?? 0.02,
      driftDirection: normalizedDir,
      rotationSpeed: config.rotationSpeed ?? 0.005,
      enableUVScroll: config.enableUVScroll ?? true,
      uvScrollSpeed: config.uvScrollSpeed ?? 0.1,
      pulseFrequency: config.pulseFrequency ?? 0.5,
      baseOpacity: config.baseOpacity ?? 0.5,
      peakOpacity: config.peakOpacity ?? 0.8,
      visibilityDistance: config.visibilityDistance ?? 800,
      currentPosition: {
        x: nebulaMesh.position.x,
        y: nebulaMesh.position.y,
        z: nebulaMesh.position.z,
      },
      uvOffset: 0,
    };

    this._nebulae.set(nebulaId, state);
  }

  /**
   * Remove a nebula from animation.
   * @param {string} nebulaId
   */
  removeNebula(nebulaId) {
    this._nebulae.delete(nebulaId);
  }

  /**
   * Update all animated nebulae. Call once per frame.
   * @param {number} dt - Delta-time (seconds)
   * @param {object} [cameraPos] - Camera position for visibility culling
   */
  update(dt, cameraPos = null) {
    this._time += dt;

    for (const [nebulaId, state] of this._nebulae.entries()) {
      if (!state.mesh) continue;

      // Linear drift movement
      const driftDist = state.driftSpeed * dt * this._animationScale;
      state.currentPosition.x += state.driftDirection[0] * driftDist;
      state.currentPosition.y += state.driftDirection[1] * driftDist;
      state.currentPosition.z += state.driftDirection[2] * driftDist;

      state.mesh.position.set(
        state.currentPosition.x,
        state.currentPosition.y,
        state.currentPosition.z
      );

      // Slow rotation
      if (state.rotationSpeed > 0) {
        const rotAngle = state.rotationSpeed * dt * this._animationScale;
        state.mesh.rotateY(rotAngle);
      }

      // UV scrolling for animated clouds
      if (state.enableUVScroll && state.mesh.material) {
        state.uvOffset += state.uvScrollSpeed * dt * this._animationScale;
        if (state.uvOffset >= 1.0) state.uvOffset -= 1.0;

        const material = state.mesh.material;
        if (material.map) {
          material.map.offset.x = state.uvOffset;
        }
      }

      // Opacity pulsation
      if (state.mesh.material) {
        const pulse = 0.5 + 0.5 * Math.sin(this._time * state.pulseFrequency * Math.PI);
        const opacity = state.baseOpacity + pulse * (state.peakOpacity - state.baseOpacity);
        state.mesh.material.opacity = opacity;
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
   * Set animation speed scale.
   * @param {number} scale - 0 = stopped, 1 = normal
   */
  setAnimationScale(scale) {
    this._animationScale = Math.max(0, Math.min(1, scale));
  }

  /**
   * Pause all nebula animations.
   */
  pauseAll() {
    this.setAnimationScale(0);
  }

  /**
   * Resume all nebula animations.
   */
  resumeAll() {
    this.setAnimationScale(1);
  }

  /**
   * Get a specific nebula state for advanced control.
   * @param {string} nebulaId
   * @returns {object|null}
   */
  getNebula(nebulaId) {
    return this._nebulae.get(nebulaId) ?? null;
  }

  /**
   * Clear all nebulae.
   */
  clear() {
    this._nebulae.clear();
    this._time = 0;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NebulaAnimator };
}

if (typeof window !== 'undefined') {
  window.GQNebulaAnimator = { NebulaAnimator };
}
