/**
 * passes/BloomPass.js
 *
 * Bloom post-processing pass — implements a three-stage pipeline:
 *   1. Threshold pass  : bright-pass extraction using luminance threshold
 *   2. Blur pyramid    : separable Gaussian over `mipLevels` blur levels
 *                        (each level uses a progressively larger kernel radius)
 *   3. Composite pass  : additively blends the blurred bloom texture onto the
 *                        original scene colour without clipping HDR values
 *
 * WGSL shaders: bloom.wgsl (fs_threshold + fs_blur entry points)
 *
 * Usage:
 *   const bloom = new BloomPass({ threshold: 0.8, strength: 1.2, radius: 0.6 });
 *   composer.addPass(bloom);
 *   // At runtime you can tweak:
 *   bloom.threshold = 0.6;
 *   bloom.strength  = 1.8;
 *
 * Uniform block builders are called by the renderer each frame and return
 * plain Float32Arrays that are written directly into GPU uniform buffers.
 *
 * References:
 *   Kawase (2004) "Frame Buffer Postprocessing Effects" — GDC 2004
 *   Three.js UnrealBloomPass (MIT) — https://github.com/mrdoob/three.js
 *   Babylon.js BloomEffect (Apache 2.0) — https://github.com/BabylonJS/Babylon.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of blur-pyramid mip levels. */
const MAX_BLOOM_LEVELS = 8;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class BloomPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.threshold=0.8]  - Luminance threshold for bright-pass [0, 1]
   * @param {number} [opts.strength=1.2]   - Bloom intensity multiplier
   * @param {number} [opts.radius=0.6]     - Base blur radius (texels) for level 0
   * @param {number} [opts.mipLevels=4]    - Blur-pyramid depth (1–8)
   */
  constructor(opts = {}) {
    this.enabled   = true;
    this.threshold = opts.threshold ?? 0.8;
    this.strength  = opts.strength  ?? 1.2;
    this.radius    = opts.radius    ?? 0.6;
    this.mipLevels = Math.min(
      Math.max(1, Math.floor(opts.mipLevels ?? 4)),
      MAX_BLOOM_LEVELS,
    );

    /** @private — GPU pipeline reference (populated by renderer after compile) */
    this._pipeline = null;
  }

  // =========================================================================
  // Uniform buffer builders (called by renderer each frame)
  // =========================================================================

  /**
   * Build the Float32Array for the threshold (bright-pass) sub-pass.
   *
   * Maps to BloomParams in bloom.wgsl (threshold + fs_threshold entry):
   *   [0] threshold
   *   [1] strength
   *   [2] _pad0
   *   [3] _pad1
   *
   * @returns {Float32Array} 4 floats (16 bytes, std140-aligned)
   */
  buildThresholdParamBlock() {
    const out = new Float32Array(4);
    out[0] = this.threshold;
    out[1] = this.strength;
    // [2] and [3] reserved for future use (e.g. knee width)
    return out;
  }

  /**
   * Build the Float32Array for a single blur sub-pass in the blur pyramid.
   *
   * Maps to BloomParams in bloom.wgsl (fs_blur entry).
   * `horizontal` controls whether the separable Gaussian runs along X or Y.
   * `levelRadius` is the blur kernel half-extent for this mip level; callers
   * should pass `this.levelRadius(level)` to get the auto-scaled value.
   *
   * Layout:
   *   [0] threshold   (unused in blur; kept for uniform-layout consistency)
   *   [1] strength    (unused in blur; kept for uniform-layout consistency)
   *   [2] radius      — levelRadius for this pass
   *   [3] horizontal  — 1.0 = horizontal, 0.0 = vertical
   *
   * @param {boolean} horizontal
   * @param {number}  [levelRadius]  Defaults to this.radius when omitted.
   * @returns {Float32Array} 4 floats (16 bytes)
   */
  buildBlurParamBlock(horizontal, levelRadius) {
    const r   = levelRadius ?? this.radius;
    const out = new Float32Array(4);
    out[0] = this.threshold;
    out[1] = this.strength;
    out[2] = r;
    out[3] = horizontal ? 1.0 : 0.0;
    return out;
  }

  /**
   * Build the Float32Array for the additive composite sub-pass.
   *
   * Layout:
   *   [0] strength    — additive blend factor (bloom intensity)
   *   [1] _pad0
   *   [2] _pad1
   *   [3] _pad2
   *
   * @returns {Float32Array} 4 floats (16 bytes)
   */
  buildCompositeParamBlock() {
    const out = new Float32Array(4);
    out[0] = this.strength;
    return out;
  }

  /**
   * Return the blur kernel radius for mip `level` (0-based).
   * Each level doubles the effective radius to create a blur pyramid.
   *
   * @param {number} level - Pyramid level index (0 = finest)
   * @returns {number}
   */
  levelRadius(level) {
    return this.radius * (1 << level);   // radius × 2^level
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the full bloom pipeline (threshold → blur pyramid → composite).
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * The renderer is responsible for dispatching the three sub-passes using
   * the param blocks returned by buildThresholdParamBlock(),
   * buildBlurParamBlock(), and buildCompositeParamBlock().
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    // Dispatch to the renderer's two-pass bloom implementation.
    // The renderer iterates mipLevels and calls buildThresholdParamBlock(),
    // buildBlurParamBlock(true/false, levelRadius(l)) for each level, then
    // buildCompositeParamBlock() for the additive blend.
    if (typeof renderer?.runBloomPass === 'function') {
      renderer.runBloomPass(this, srcTex, dstTex);
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
  module.exports = { BloomPass, MAX_BLOOM_LEVELS };
} else {
  window.GQBloomPass = { BloomPass, MAX_BLOOM_LEVELS };
}
