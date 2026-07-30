/**
 * SunAnimator.js — Manages animated sun/star effects with pulsating glow.
 *
 * Handles:
 *   • Emissive intensity pulsation (flare effects)
 *   • Color variation over time (star twinkling)
 *   • Dynamic point lights for illumination
 *   • Bloom pass parameter adjustment
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class SunAnimator {
  constructor() {
    /** @type {Map<string, SunState>} Animated stars by ID */
    this._suns = new Map();
    
    /** @type {number} Global animation time */
    this._time = 0;

    /** @type {number} Master intensity scale (for LOD/fading) */
    this._intensityScale = 1.0;

    /** @type {?object} Bloom pass reference (for dynamic adjustment) */
    this._bloomPass = null;
  }

  /**
   * Register a star/sun for animation.
   *
   * @param {string} sunId - Unique identifier (e.g., "star_alpha_centauri")
   * @param {THREE.Mesh} mesh - The star mesh
   * @param {THREE.PointLight} [light] - Optional dynamic light at star position
   * @param {object} [config] - Animation configuration
   * @param {number} [config.pulseFrequency=1.2] - Hz
   * @param {number} [config.baseIntensity=0.8] - Base emissive intensity
   * @param {number} [config.peakIntensity=1.6] - Peak intensity (during flare)
   * @param {number} [config.lightIntensity=3.0] - Dynamic light peak intensity
   * @param {number} [config.lightDistance=200] - Light max distance
   * @param {boolean} [config.enableTwinkle=true] - Color variation
   */
  addSun(sunId, mesh, light = null, config = {}) {
    if (!mesh || !mesh.material) return;

    const material = mesh.material;
    const baseColor = material.color ? material.color.clone() : new (material.constructor.prototype.constructor || Object)(0xffffff);

    const state = {
      mesh,
      material,
      light,
      pulseFrequency: config.pulseFrequency ?? 1.2,
      baseIntensity: config.baseIntensity ?? 0.8,
      peakIntensity: config.peakIntensity ?? 1.6,
      lightIntensity: config.lightIntensity ?? 3.0,
      lightDistance: config.lightDistance ?? 200,
      enableTwinkle: config.enableTwinkle ?? true,
      baseColor,
      twinkleFrequency: (config.twinkleFrequency ?? 0.33),
      twinkleAmount: config.twinkleAmount ?? 0.15,
      phase: Math.random() * Math.PI * 2, // Per-sun phase offset
    };

    this._suns.set(sunId, state);
  }

  /**
   * Remove a sun from animation.
   * @param {string} sunId
   */
  removeSun(sunId) {
    this._suns.delete(sunId);
  }

  /**
   * Update all animated suns. Call once per frame from the game loop.
   * @param {number} dt - Delta-time (seconds)
   */
  update(dt) {
    this._time += dt;

    for (const [, state] of this._suns.entries()) {
      if (!state.mesh || !state.material) continue;

      const t = this._time + state.phase;

      // Main pulse (flare effect)
      const pulse = 0.5 + 0.5 * Math.sin(t * state.pulseFrequency * Math.PI);
      const intensity = state.baseIntensity + pulse * (state.peakIntensity - state.baseIntensity);
      state.material.emissiveIntensity = intensity * this._intensityScale;

      // Optional color twinkle
      if (state.enableTwinkle) {
        const twinkle = 0.5 + 0.5 * Math.sin(t * state.twinkleFrequency * Math.PI);
        const colorShift = 1.0 + (twinkle - 0.5) * state.twinkleAmount;

        // Modulate color slightly (warmer/cooler)
        const color = state.baseColor.clone();
        color.multiplyScalar(colorShift);
        state.material.emissive = color;
      }

      // Update dynamic light
      if (state.light) {
        const lightIntensity = state.lightIntensity * pulse * this._intensityScale;
        state.light.intensity = lightIntensity;
        state.light.distance = state.lightDistance;
      }
    }
  }

  /**
   * Set the bloom pass for automatic tuning of bloom parameters during sun flares.
   * @param {object} bloomPass - UnrealBloomPass instance
   */
  setBloomPass(bloomPass) {
    this._bloomPass = bloomPass;
  }

  /**
   * Adjust overall glow intensity (e.g., for distance-based LOD).
   * @param {number} scale - 0 = off, 1 = normal
   */
  setIntensityScale(scale) {
    this._intensityScale = Math.max(0, Math.min(1, scale));
  }

  /**
   * Create an animated sun material optimized for bloom.
   * @param {THREE.Color|number} color
   * @returns {THREE.MeshStandardMaterial}
   */
  static createAnimatedSunMaterial(THREE, color) {
    const c = typeof color === 'number' ? new THREE.Color(color) : color;
    return new THREE.MeshStandardMaterial({
      color: c,
      emissive: c,
      emissiveIntensity: 1.0,
      roughness: 0.4,
      metalness: 0.02,
      toneMapped: true,
    });
  }

  /**
   * Clear all tracked suns.
   */
  clear() {
    this._suns.clear();
    this._time = 0;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SunAnimator };
}

if (typeof window !== 'undefined') {
  window.GQSunAnimator = { SunAnimator };
}
