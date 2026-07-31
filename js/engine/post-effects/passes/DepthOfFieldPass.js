/**
 * passes/DepthOfFieldPass.js
 *
 * Depth-of-field post-processing pass — simulates camera lens focus with
 * realistic depth-based blur. Uses a 3-pass pipeline:
 *
 *   1. Circle-of-Confusion (CoC) pass: calculates per-pixel blur radius
 *      from linear depth and focus parameters
 *   2. Blur Near pass: applies Gaussian blur to out-of-focus foreground
 *   3. Blur Far pass: applies Gaussian blur to out-of-focus background
 *
 * The final composite blends based on the CoC value, creating the characteristic
 * shallow depth-of-field effect where only a focal plane remains sharp.
 *
 * WGSL shaders: depthoffield.wgsl (fs_coc, fs_blur_near, fs_blur_far entry points)
 *
 * Usage:
 *   const dof = new DepthOfFieldPass({
 *     focusDistance: 500.0,
 *     focusRange: 300.0,
 *     nearBlurAmount: 2.0,
 *     farBlurAmount: 4.0,
 *   });
 *   composer.addPass(dof);
 *   // Adjust focus at runtime:
 *   dof.focusDistance = 350.0;
 *   dof.farBlurAmount = 6.0;
 *
 * Performance Notes:
 *   • Only active on High/Ultra quality profiles (graceful degradation)
 *   • 3-pass pipeline: moderate GPU cost (~15-25 FPS impact on Mid-Range)
 *   • Requires depth texture from renderer (depthTexture)
 *   • Memory: ~128 MB for intermediate blur targets
 *
 * References:
 *   Demers (2004) "Depth of Field Beyond the Lens" — GDC 2004
 *   Sousa (2008) "Crysis and CryEngine 2 Shaders" — GDC 2008
 *   Unity Technologies — Built-in Lens Distortion + DoF
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum blur kernel radius (in texels) for performance. */
const MAX_BLUR_RADIUS = 16;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class DepthOfFieldPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.focusDistance=500.0]   - Distance to the focal plane
   * @param {number} [opts.focusRange=300.0]      - Range around focal plane that remains sharp
   * @param {number} [opts.nearBlurAmount=2.0]    - Blur intensity for near objects [0, MAX_BLUR_RADIUS]
   * @param {number} [opts.farBlurAmount=4.0]     - Blur intensity for far objects [0, MAX_BLUR_RADIUS]
   * @param {number} [opts.aperture=1.0]          - Lens aperture (f-stop equivalent, affects CoC)
   */
  constructor(opts = {}) {
    this.enabled = true;
    this.focusDistance = opts.focusDistance ?? 500.0;
    this.focusRange = opts.focusRange ?? 300.0;
    this.nearBlurAmount = Math.min(MAX_BLUR_RADIUS, Math.max(0, opts.nearBlurAmount ?? 2.0));
    this.farBlurAmount = Math.min(MAX_BLUR_RADIUS, Math.max(0, opts.farBlurAmount ?? 4.0));
    this.aperture = opts.aperture ?? 1.0;

    /** Depth texture (set by renderer before render() is called). */
    this._depthTexture = null;

    /** @private — GPU pipeline references (populated by renderer after compile) */
    this._cocPipeline = null;
    this._blurNearPipeline = null;
    this._blurFarPipeline = null;
  }

  /**
   * Set the focus distance for the focal plane.
   * @param {number} distance
   */
  setFocusDistance(distance) {
    this.focusDistance = distance;
  }

  /**
   * Set the range around the focal plane that remains sharp.
   * @param {number} range
   */
  setFocusRange(range) {
    this.focusRange = range;
  }

  /**
   * Set blur amounts for near and far out-of-focus regions.
   * @param {number} near
   * @param {number} far
   */
  setBlurAmount(near, far) {
    this.nearBlurAmount = Math.min(MAX_BLUR_RADIUS, Math.max(0, near));
    this.farBlurAmount = Math.min(MAX_BLUR_RADIUS, Math.max(0, far));
  }

  /**
   * Set the aperture (f-stop equivalent) — larger values increase CoC.
   * @param {number} aperture
   */
  setAperture(aperture) {
    this.aperture = Math.max(0.1, aperture);
  }

  // =========================================================================
  // Uniform buffer builders (called by renderer each frame)
  // =========================================================================

  /**
   * Build Circle-of-Confusion (CoC) pass parameters.
   * Maps to DofCoCParams in depthoffield.wgsl.
   *
   * Layout:
   *   [0] focusDistance
   *   [1] focusRange
   *   [2] aperture
   *   [3] _pad
   *
   * @returns {Float32Array} 4 floats (16 bytes, std140-aligned)
   */
  buildCoCParamBlock() {
    const out = new Float32Array(4);
    out[0] = this.focusDistance;
    out[1] = this.focusRange;
    out[2] = this.aperture;
    out[3] = 0; // padding
    return out;
  }

  /**
   * Build blur pass parameters.
   * Maps to DofBlurParams in depthoffield.wgsl.
   *
   * Layout:
   *   [0] blurRadius (near or far depending on pass)
   *   [1] _pad0
   *   [2] _pad1
   *   [3] _pad2
   *
   * @param {number} blurAmount
   * @returns {Float32Array} 4 floats (16 bytes, std140-aligned)
   */
  buildBlurParamBlock(blurAmount) {
    const out = new Float32Array(4);
    out[0] = Math.max(1, Math.ceil(blurAmount));
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the depth-of-field 3-pass pipeline.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * The renderer is expected to:
   *   1. Create intermediate blur textures for the CoC and blur passes
   *   2. Dispatch three separate fullscreen passes
   *   3. Handle the depthTexture binding (from GBuffer or similar)
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer (must have runDepthOfFieldPass method)
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    if (typeof renderer?.runDepthOfFieldPass === 'function') {
      renderer.runDepthOfFieldPass(this, srcTex, dstTex, this._depthTexture);
    }
  }

  /**
   * Set the depth texture for this pass (called by renderer).
   * @param {*} depthTexture
   */
  setDepthTexture(depthTexture) {
    this._depthTexture = depthTexture;
  }

  dispose() {
    this._cocPipeline = null;
    this._blurNearPipeline = null;
    this._blurFarPipeline = null;
    this._depthTexture = null;
  }
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DepthOfFieldPass, MAX_BLUR_RADIUS };
} else {
  window.GQDepthOfFieldPass = DepthOfFieldPass;
}
