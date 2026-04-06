/**
 * passes/VignettePass.js
 *
 * Vignette post-processing pass — darkens screen edges using a smooth radial
 * falloff, creating the classic "lens edge" effect.
 *
 * WGSL shader: vignette.wgsl (fs_main entry point)
 *
 * Usage:
 *   const vignette = new VignettePass({ darkness: 0.5, falloff: 2.0 });
 *   composer.addPass(vignette);
 *   // Adjust at runtime:
 *   vignette.darkness = 0.8;
 *   vignette.centre   = { x: 0.6, y: 0.4 };
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class VignettePass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.darkness=0.5]  - Maximum darkening at the outer edge [0, 1]
   * @param {number} [opts.falloff=2.0]   - Smoothstep exponent controlling edge sharpness
   * @param {object} [opts.centre]        - UV centre of the vignette (default: {x:0.5,y:0.5})
   * @param {number} [opts.centre.x=0.5]
   * @param {number} [opts.centre.y=0.5]
   */
  constructor(opts = {}) {
    this.enabled  = true;
    this.darkness = opts.darkness ?? 0.5;
    this.falloff  = opts.falloff  ?? 2.0;
    this.centre   = {
      x: opts.centre?.x ?? 0.5,
      y: opts.centre?.y ?? 0.5,
    };

    /** @private — GPU pipeline reference (populated by renderer after compile) */
    this._pipeline = null;
  }

  // =========================================================================
  // Uniform buffer builder (called by renderer each frame)
  // =========================================================================

  /**
   * Build the Float32Array that maps to VignetteParams in vignette.wgsl.
   *
   * Layout:
   *   [0] darkness  - maximum edge darkening factor
   *   [1] falloff   - smoothstep range controlling the gradient width
   *   [2] centreX   - UV x-coordinate of the vignette centre
   *   [3] centreY   - UV y-coordinate of the vignette centre
   *
   * @returns {Float32Array} 4 floats (16 bytes, std140-aligned)
   */
  buildParamBlock() {
    const out = new Float32Array(4);
    out[0] = this.darkness;
    out[1] = this.falloff;
    out[2] = this.centre.x;
    out[3] = this.centre.y;
    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the vignette fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    // Dispatch to the renderer's fullscreen vignette pass.
    // The renderer binds buildParamBlock() into @group(0) @binding(2)
    // and dispatches a fullscreen quad using vignette.wgsl.
    if (typeof renderer?.runVignettePass === 'function') {
      renderer.runVignettePass(this, srcTex, dstTex);
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
  module.exports = { VignettePass };
} else {
  window.GQVignettePass = VignettePass;
}
