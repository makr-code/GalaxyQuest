/**
 * passes/ToneMappingPass.js
 *
 * HDR tone-mapping post-processing pass.
 *
 * Converts HDR scene colours into displayable LDR output using one of two
 * industry-standard tone-mapping operators:
 *
 *   REINHARD — Reinhard et al. (2002), simple and numerically stable.
 *              Good for scenes with wide dynamic range but less filmic look.
 *   ACES     — ACES Filmic approximation (Narkowicz 2015), used in Unreal
 *              Engine 4.  Produces a warmer, high-contrast S-curve that
 *              closely matches the Academy Color Encoding System.
 *
 * Always applies a sRGB gamma correction step (x^(1/2.2)) after mapping so
 * the output is ready for standard 8-bit display surfaces.
 *
 * WGSL shader: tonemapping.wgsl (fs_main entry point)
 *
 * Usage:
 *   const tm = new ToneMappingPass({ mode: ToneMappingMode.ACES, exposure: 1.2 });
 *   composer.addPass(tm);
 *   // Adjust at runtime:
 *   tm.exposure = 0.9;
 *   tm.mode = ToneMappingMode.REINHARD;
 *
 * References:
 *   Reinhard et al. (2002) "Photographic Tone Reproduction for Digital Images"
 *   Narkowicz (2015) "ACES Filmic Tone Mapping Curve" — blog.
 *   Three.js ACESFilmicToneMapping (MIT) — https://github.com/mrdoob/three.js
 *   Unreal Engine 4 — default ACES tone mapping pipeline
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

/**
 * Tone mapping operator selection.
 * @enum {number}
 */
const ToneMappingMode = Object.freeze({
  /** Reinhard (2002) — simple, numerically stable, maps [0,∞) → [0,1). */
  REINHARD: 0,
  /** ACES Filmic approximation (Narkowicz 2015) — warmer, more cinematic. */
  ACES:     1,
});

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class ToneMappingPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.mode=ToneMappingMode.ACES]  Tone mapping operator
   * @param {number} [opts.exposure=1.0]               Pre-exposure multiplier
   */
  constructor(opts = {}) {
    this.enabled  = true;
    this.mode     = opts.mode     ?? ToneMappingMode.ACES;
    this.exposure = opts.exposure ?? 1.0;

    /** @private — GPU pipeline reference (populated by renderer after compile) */
    this._pipeline = null;
  }

  // =========================================================================
  // Uniform buffer builder (called by renderer each frame)
  // =========================================================================

  /**
   * Build the Float32Array that maps to ToneMappingParams in tonemapping.wgsl.
   *
   * Layout:
   *   [0] mode     — 0.0 = Reinhard, 1.0 = ACES
   *   [1] exposure — pre-exposure multiplier
   *   [2] _pad0    — reserved (std140 alignment)
   *   [3] _pad1    — reserved (std140 alignment)
   *
   * @returns {Float32Array} 4 floats (16 bytes, std140-aligned)
   */
  buildParamBlock() {
    const out = new Float32Array(4);
    out[0] = Number(this.mode);
    out[1] = this.exposure;
    // [2], [3] reserved
    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the tone-mapping fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input HDR scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    if (typeof renderer?.runToneMappingPass === 'function') {
      renderer.runToneMappingPass(this, srcTex, dstTex);
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
  module.exports = { ToneMappingPass, ToneMappingMode };
} else {
  window.GQToneMappingPass = { ToneMappingPass, ToneMappingMode };
}
