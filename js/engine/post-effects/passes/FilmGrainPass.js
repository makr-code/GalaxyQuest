/**
 * passes/FilmGrainPass.js
 *
 * Film grain post-processing pass.
 *
 * Overlays a per-frame temporal noise pattern on the rendered image to
 * simulate the grain structure of photographic film or digital sensor noise.
 * The effect is subtle and cinematic — it adds organic texture to an otherwise
 * pristine digital image, preventing the "too clean" look common in real-time
 * rendering.
 *
 * Grain is generated procedurally using a fast hash noise keyed on screen UV
 * and an animated time uniform, so no texture asset is required.
 *
 * WGSL shader: filmgrain.wgsl (fs_main entry point)
 *
 * Usage:
 *   const grain = new FilmGrainPass({ intensity: 0.18 });
 *   composer.addPass(grain);
 *   // Advance time each frame:
 *   grain.update(dt);
 *   // Adjust at runtime:
 *   grain.intensity = 0.25;
 *   grain.speed = 5.0;
 *
 * References:
 *   Vlachos (2016) "Advanced VR Rendering Performance" — GDC temporal AA + grain
 *   Jimenez (2016) "SMAA + Temporal Filtering" — cinematic grain rationale
 *   Alan Wake 2, Returnal — visible film grain as AAA aesthetic choice
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class FilmGrainPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.intensity=0.18]  Grain visibility [0, 1]
   * @param {number} [opts.speed=3.0]       Temporal variation rate [0, 10]
   * @param {number} [opts.size=1.0]        Noise spatial frequency [0.5, 3]
   */
  constructor(opts = {}) {
    this.enabled   = true;
    this.intensity = opts.intensity ?? 0.18;
    this.speed     = opts.speed     ?? 3.0;
    this.size      = opts.size      ?? 1.0;

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
   * Build the Float32Array that maps to FilmGrainParams in filmgrain.wgsl.
   *
   * Layout:
   *   [0] intensity — grain strength [0, 1]
   *   [1] speed     — temporal variation rate
   *   [2] size      — noise spatial frequency multiplier
   *   [3] time      — elapsed seconds (used for temporal animation)
   *
   * @returns {Float32Array} 4 floats (16 bytes, std140-aligned)
   */
  buildParamBlock() {
    const out = new Float32Array(4);
    out[0] = this.intensity;
    out[1] = this.speed;
    out[2] = this.size;
    out[3] = this._time;
    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the film-grain fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    if (typeof renderer?.runFilmGrainPass === 'function') {
      renderer.runFilmGrainPass(this, srcTex, dstTex);
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
  module.exports = { FilmGrainPass };
} else {
  window.GQFilmGrainPass = { FilmGrainPass };
}
