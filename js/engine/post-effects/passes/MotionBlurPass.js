/**
 * passes/MotionBlurPass.js
 *
 * Camera motion blur post-processing pass.
 *
 * Applies a velocity-based accumulation blur along the camera's NDC-space
 * displacement vector.  The blur is only active when the velocity magnitude
 * exceeds a configurable threshold, so static gameplay and slow pans remain
 * perfectly sharp.
 *
 * Quality scales automatically with the velocity magnitude — low motion uses
 * the minimum tap count (2) while fast pans ramp up to the configured maximum
 * (default 6).  This ensures the performance cost is near-zero when the
 * camera is still.
 *
 * WGSL shader: motionblur.wgsl (fs_main entry point)
 *
 * Usage:
 *   const blur = new MotionBlurPass({ strength: 0.8, maxSamples: 6 });
 *   composer.addPass(blur);
 *   // Supply camera velocity each frame (NDC-space delta):
 *   blur.setVelocity(ndcDeltaX, ndcDeltaY);
 *   // Or set directly:
 *   blur.velX = 0.03;
 *   blur.velY = 0.01;
 *
 * References:
 *   McGuire (2012) "A Reconstruction Filter for Plausible Motion Blur"
 *   Sousa (2008) "Crysis and CryEngine 2 Shaders" — GDC 2008
 *   Killzone 2 motion blur (Guerrilla Games) — SIGGRAPH 2007
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class MotionBlurPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.strength=0.8]     Overall blur strength multiplier [0,1]
   * @param {number} [opts.maxSamples=6]     Maximum tap count along velocity direction (2–8)
   * @param {number} [opts.threshold=0.001]  Min NDC velocity magnitude before blur activates
   */
  constructor(opts = {}) {
    this.enabled    = true;
    this.strength   = opts.strength   ?? 0.8;
    this.maxSamples = Math.min(8, Math.max(2, Math.floor(opts.maxSamples ?? 6)));
    this.threshold  = opts.threshold  ?? 0.001;

    /** Current frame camera velocity in NDC space (set by caller). */
    this.velX = 0;
    this.velY = 0;

    /** @private — GPU pipeline reference (populated by renderer after compile) */
    this._pipeline = null;
  }

  // =========================================================================
  // Per-frame velocity update
  // =========================================================================

  /**
   * Set the camera's NDC-space velocity for the current frame.
   * Call once per frame with the displacement since last frame.
   *
   * @param {number} ndcDeltaX - Horizontal NDC displacement (positive = right)
   * @param {number} ndcDeltaY - Vertical NDC displacement (positive = up)
   */
  setVelocity(ndcDeltaX, ndcDeltaY) {
    this.velX = Number(ndcDeltaX) || 0;
    this.velY = Number(ndcDeltaY) || 0;
  }

  // =========================================================================
  // Uniform buffer builder (called by renderer each frame)
  // =========================================================================

  /**
   * Build the Float32Array that maps to MotionBlurParams in motionblur.wgsl.
   *
   * Layout:
   *   [0] velX        — horizontal NDC velocity
   *   [1] velY        — vertical NDC velocity
   *   [2] numSamples  — tap count (2–8)
   *   [3] strength    — blur strength multiplier
   *   [4] threshold   — min velocity before blur activates
   *   [5] _pad0
   *   [6] _pad1
   *   [7] _pad2
   *
   * @returns {Float32Array} 8 floats (32 bytes)
   */
  buildParamBlock() {
    const out = new Float32Array(8);
    out[0] = this.velX;
    out[1] = this.velY;
    out[2] = this.maxSamples;
    out[3] = this.strength;
    out[4] = this.threshold;
    // [5..7] reserved
    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the motion-blur fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    if (typeof renderer?.runMotionBlurPass === 'function') {
      renderer.runMotionBlurPass(this, srcTex, dstTex);
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
  module.exports = { MotionBlurPass };
} else {
  window.GQMotionBlurPass = MotionBlurPass;
}
