/**
 * passes/DiskRotationParallaxPass.js
 *
 * Galaxy disc rotation parallax post-processing pass.
 *
 * Simulates Keplerian orbital mechanics in the galaxy disc's visual
 * appearance: inner regions orbit faster than outer regions (Kepler's Third
 * Law), producing the characteristic differential rotation of spiral galaxies.
 *
 * The pass warps the galaxy disc texture by rotating concentric regions at
 * different angular velocities — inner radius at `innerVelocity` rad/s,
 * outer edge at `outerVelocity` rad/s, with smooth interpolation between
 * them.  This creates the impression that the galaxy is a living, rotating
 * structure rather than a static backdrop.
 *
 * The warp is applied as a UV-space rotation offset, so only the galaxy disc
 * contribution is distorted; point-source stars (which have their own
 * scintillation pass) remain fixed.
 *
 * WGSL shader: diskrotationparallax.wgsl (fs_main entry point)
 *
 * Usage:
 *   const drp = new DiskRotationParallaxPass({ innerVelocity: 0.15 });
 *   composer.addPass(drp);
 *   // Advance each frame:
 *   drp.update(dt);
 *
 * References:
 *   Kepler's Third Law — T² ∝ a³ (angular velocity ∝ r^(-3/2))
 *   No Man's Sky galaxy rotation (Hello Games)
 *   EVE Online stellar cartography (CCP Games)
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class DiskRotationParallaxPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.innerVelocity=0.15]  Angular velocity at disc center (rad/s)
   * @param {number} [opts.outerVelocity=0.02]  Angular velocity at disc edge (rad/s)
   * @param {number} [opts.centerX=0.5]         Disc centre UV X [0, 1]
   * @param {number} [opts.centerY=0.5]         Disc centre UV Y [0, 1]
   */
  constructor(opts = {}) {
    this.enabled       = true;
    this.innerVelocity = opts.innerVelocity ?? 0.15;
    this.outerVelocity = opts.outerVelocity ?? 0.02;
    this.centerX       = opts.centerX       ?? 0.5;
    this.centerY       = opts.centerY       ?? 0.5;

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
   * Build the Float32Array that maps to DiskRotationParams in diskrotationparallax.wgsl.
   *
   * Layout:
   *   [0] innerVelocity — angular velocity at disc centre (rad/s)
   *   [1] outerVelocity — angular velocity at disc edge (rad/s)
   *   [2] centerX       — disc centre UV X
   *   [3] centerY       — disc centre UV Y
   *   [4] time          — elapsed seconds
   *   [5] _pad0         — reserved
   *   [6] _pad1         — reserved
   *   [7] _pad2         — reserved
   *
   * @returns {Float32Array} 8 floats (32 bytes, std140-aligned)
   */
  buildParamBlock() {
    const out = new Float32Array(8);
    out[0] = this.innerVelocity;
    out[1] = this.outerVelocity;
    out[2] = this.centerX;
    out[3] = this.centerY;
    out[4] = this._time;
    // [5..7] reserved
    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the disc-rotation-parallax fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    if (typeof renderer?.runDiskRotationParallaxPass === 'function') {
      renderer.runDiskRotationParallaxPass(this, srcTex, dstTex);
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
  module.exports = { DiskRotationParallaxPass };
} else {
  window.GQDiskRotationParallaxPass = { DiskRotationParallaxPass };
}
