/**
 * EngineMaterialAnimator.js — Animates emissive materials on ship engines.
 *
 * Handles time-based pulsation and intensity modulation of engine nozzle materials
 * to create realistic thruster glow effects.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class EngineMaterialAnimator {
  constructor() {
    /** @type {Map<string, EngineMaterialState>} Tracked materials by ID */
    this._materials = new Map();
    /** @type {number} Global animation time */
    this._time = 0;
  }

  /**
   * Register an engine material for animation.
   *
   * @param {string} materialId - Unique identifier
   * @param {THREE.MeshStandardMaterial} material - Target material
   * @param {object} config - Animation config
   * @param {number} [config.pulseFrequency=2.0] - Hz
   * @param {number} [config.baseIntensity=0.6] - Base emissive intensity
   * @param {number} [config.peakIntensity=1.4] - Peak emissive intensity
   * @param {number} [config.color=0xff6600] - Emissive color (hex)
   */
  addMaterial(materialId, material, config = {}) {
    if (!material) return;

    const state = {
      material,
      pulseFrequency: config.pulseFrequency ?? 2.0,
      baseIntensity: config.baseIntensity ?? 0.6,
      peakIntensity: config.peakIntensity ?? 1.4,
      color: new (material.constructor.prototype.constructor.getColorClass?.() || Object)(config.color ?? 0xff6600),
      isAnimating: true,
    };

    this._materials.set(materialId, state);
  }

  /**
   * Remove a material from animation.
   * @param {string} materialId
   */
  removeMaterial(materialId) {
    this._materials.delete(materialId);
  }

  /**
   * Update all animated materials. Call once per frame.
   * @param {number} dt - Delta-time (seconds)
   */
  update(dt) {
    this._time += dt;

    for (const [, state] of this._materials.entries()) {
      if (!state.isAnimating || !state.material) continue;

      // Pulse between base and peak intensity
      const pulse = 0.5 + 0.5 * Math.sin(this._time * state.pulseFrequency * Math.PI);
      const intensity = state.baseIntensity + pulse * (state.peakIntensity - state.baseIntensity);

      state.material.emissiveIntensity = intensity;
      state.material.emissive = state.color;
    }
  }

  /**
   * Set animation active/inactive for a material.
   * @param {string} materialId
   * @param {boolean} isAnimating
   */
  setAnimating(materialId, isAnimating) {
    const state = this._materials.get(materialId);
    if (state) {
      state.isAnimating = isAnimating;
    }
  }

  /**
   * Clear all tracked materials.
   */
  clear() {
    this._materials.clear();
    this._time = 0;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EngineMaterialAnimator };
}

if (typeof window !== 'undefined') {
  window.GQEngineMaterialAnimator = { EngineMaterialAnimator };
}
