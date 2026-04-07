/**
 * passes/StarScintillationPass.js
 *
 * Star scintillation (twinkle) post-processing pass.
 *
 * Simulates atmospheric scintillation — the apparent twinkling of stars
 * caused by refractive-index fluctuations in the atmosphere.  Bright pixels
 * above a luminance threshold are modulated by an animated per-position noise
 * function, creating the characteristic rapid brightness variation of stars
 * seen from a planetary surface or low orbit.
 *
 * The effect is selectively applied only to high-luminance pixels (stars) via
 * the `threshold` parameter, leaving the darker background unaffected.
 *
 * WGSL shader: starscintillation.wgsl (fs_main entry point)
 *
 * Usage:
 *   const sci = new StarScintillationPass({ amplitude: 0.25 });
 *   composer.addPass(sci);
 *   // Advance time each frame:
 *   sci.update(dt);
 *
 * References:
 *   Dravins et al. (1997) "Atmospheric Intensity Scintillation of Stars"
 *   Elite Dangerous (Frontier) — star scintillation on approach
 *   Stellarium — atmospheric refraction + twinkle model
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class StarScintillationPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.threshold=0.8]   Minimum luminance to apply twinkle [0, 1]
   * @param {number} [opts.amplitude=0.3]   Maximum brightness variation [0, 1]
   * @param {number} [opts.speed=2.0]       Temporal variation frequency [0, 10]
   */
  constructor(opts = {}) {
    this.enabled   = true;
    this.threshold = opts.threshold ?? 0.8;
    this.amplitude = opts.amplitude ?? 0.3;
    this.speed     = opts.speed     ?? 2.0;

    /** Elapsed time in seconds. */
    this._time = 0;

    /** @private — GPU pipeline reference (populated by renderer after compile) */
    this._pipeline = null;
  }

  // =========================================================================
  // Per-frame update
  // =========================================================================

  /**
   * Advance internal time. Call once per frame before render().
   * @param {number} dt - Frame delta in seconds
   */
  update(dt) {
    this._time += Number(dt) || 0;
  }

  // =========================================================================
  // Uniform buffer builder (called by renderer each frame)
  // =========================================================================

  /**
   * Build the Float32Array that maps to ScintillationParams in starscintillation.wgsl.
   *
   * Layout:
   *   [0] threshold  — minimum luminance to apply effect
   *   [1] amplitude  — maximum brightness variation [0, 1]
   *   [2] speed      — temporal frequency of the noise
   *   [3] time       — elapsed seconds
   *
   * @returns {Float32Array} 4 floats (16 bytes, std140-aligned)
   */
  buildParamBlock() {
    const out = new Float32Array(4);
    out[0] = this.threshold;
    out[1] = this.amplitude;
    out[2] = this.speed;
    out[3] = this._time;
    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the star-scintillation fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    if (typeof renderer?.runStarScintillationPass === 'function') {
      renderer.runStarScintillationPass(this, srcTex, dstTex);
    }
  }

  dispose() {
    this._pipeline = null;
  }
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StarScintillationPass };
} else {
  window.GQStarScintillationPass = { StarScintillationPass };
}
