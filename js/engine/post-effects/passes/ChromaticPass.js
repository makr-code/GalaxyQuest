/**
 * passes/ChromaticPass.js
 *
 * Chromatic Aberration post-processing pass — separates RGB channels by a
 * configurable offset, simulating lens fringing.  Optional barrel-distortion
 * pre-warp ensures the shift follows realistic lens geometry.
 *
 * WGSL shader: chromatic.wgsl (fs_main entry point)
 *
 * Usage:
 *   const chroma = new ChromaticPass({ power: 0.005, barrelStrength: 0.1 });
 *   composer.addPass(chroma);
 *   // Adjust at runtime:
 *   chroma.power          = 0.012;
 *   chroma.barrelStrength = 0.2;
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class ChromaticPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.power=0.005]          - RGB channel shift magnitude (UV units)
   * @param {number} [opts.angle=0]              - Shift direction in radians (0 = horizontal)
   * @param {number} [opts.barrelStrength=0.0]   - Barrel-distortion pre-warp strength [0, 1]
   *                                               0 = no distortion, 1 = strong barrel warp
   */
  constructor(opts = {}) {
    this.enabled        = true;
    this.power          = opts.power          ?? 0.005;
    this.angle          = opts.angle          ?? 0;
    this.barrelStrength = opts.barrelStrength ?? 0.0;

    /** @private — GPU pipeline reference (populated by renderer after compile) */
    this._pipeline = null;
  }

  // =========================================================================
  // Uniform buffer builder (called by renderer each frame)
  // =========================================================================

  /**
   * Build the Float32Array that maps to ChromaticParams in chromatic.wgsl.
   *
   * Layout:
   *   [0] power          - shift magnitude
   *   [1] angle          - shift direction (radians)
   *   [2] barrelStrength - barrel-distortion warp strength
   *   [3] _pad           - reserved (std140 alignment)
   *
   * @returns {Float32Array} 4 floats (16 bytes, std140-aligned)
   */
  buildParamBlock() {
    const out = new Float32Array(4);
    out[0] = this.power;
    out[1] = this.angle;
    out[2] = this.barrelStrength;
    // [3] reserved
    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the chromatic aberration fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    // Renderer dispatch (wired up when WebGPU device is available):
    //   renderer.runChromaticPass(this, srcTex, dstTex)
    // The renderer binds buildParamBlock() into @group(0) @binding(2)
    // and dispatches a fullscreen quad using chromatic.wgsl.
    void srcTex; void dstTex; void renderer;
  }

  dispose() {
    this._pipeline = null;
  }
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChromaticPass };
} else {
  window.GQChromaticPass = ChromaticPass;
}
