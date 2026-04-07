/**
 * passes/ColorGradingPass.js
 *
 * Analytical color grading post-processing pass.
 *
 * Applies a classic Lift/Gamma/Gain (LGG) color model — the same model used
 * in DaVinci Resolve and most professional color grading software — via
 * four independent controls:
 *
 *   brightness  — global exposure offset (additive), like Lift
 *   contrast    — pivot-at-0.5 multiplier, like Gain−Lift
 *   saturation  — luma-preserving chroma multiplier
 *   hueShift    — full-circle hue rotation (radians) for colour tinting
 *
 * The controls are composited analytically in the WGSL shader without
 * requiring a LUT texture, keeping memory bandwidth to zero and maintaining
 * perfect precision at all colour values.
 *
 * WGSL shader: colorgrading.wgsl (fs_main entry point)
 *
 * Usage:
 *   const cg = new ColorGradingPass({ saturation: 1.2, contrast: 1.1 });
 *   composer.addPass(cg);
 *   // Adjust at runtime:
 *   cg.hueShift = Math.PI * 0.1; // slight warm tint
 *
 * References:
 *   Reinhard et al. (2005) "Color Transfer between Images" — luma-chroma
 *   DaVinci Resolve Color Manual — Lift/Gamma/Gain model
 *   Unreal Engine 5 Post Process Volume (Epic Games)
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class ColorGradingPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.brightness=0.0]    Additive brightness offset [-1, 1]
   * @param {number} [opts.contrast=1.0]      Contrast multiplier (pivot 0.5) [0, 3]
   * @param {number} [opts.saturation=1.0]    Saturation multiplier [0, 3]
   * @param {number} [opts.hueShift=0.0]      Hue rotation in radians [0, 2π]
   */
  constructor(opts = {}) {
    this.enabled    = true;
    this.brightness = opts.brightness ?? 0.0;
    this.contrast   = opts.contrast   ?? 1.0;
    this.saturation = opts.saturation ?? 1.0;
    this.hueShift   = opts.hueShift   ?? 0.0;

    /** @private — GPU pipeline reference (populated by renderer after compile) */
    this._pipeline = null;
  }

  // =========================================================================
  // Uniform buffer builder (called by renderer each frame)
  // =========================================================================

  /**
   * Build the Float32Array that maps to ColorGradingParams in colorgrading.wgsl.
   *
   * Layout:
   *   [0] brightness  — additive offset per channel
   *   [1] contrast    — multiplier around mid-grey (0.5)
   *   [2] saturation  — luma-preserving saturation multiplier
   *   [3] hueShift    — hue rotation (radians)
   *
   * @returns {Float32Array} 4 floats (16 bytes, std140-aligned)
   */
  buildParamBlock() {
    const out = new Float32Array(4);
    out[0] = this.brightness;
    out[1] = this.contrast;
    out[2] = this.saturation;
    out[3] = this.hueShift;
    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the color-grading fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    if (typeof renderer?.runColorGradingPass === 'function') {
      renderer.runColorGradingPass(this, srcTex, dstTex);
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
  module.exports = { ColorGradingPass };
} else {
  window.GQColorGradingPass = { ColorGradingPass };
}
