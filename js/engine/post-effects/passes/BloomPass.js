/**
 * passes/BloomPass.js
 *
 * Bloom post-processing pass — wraps bloom.wgsl (WebGPU) or the existing
 * Three.js UnrealBloomPass (WebGL fallback).
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class BloomPass {
  /**
   * @param {Object} opts
   * @param {number} [opts.threshold=0.8]
   * @param {number} [opts.strength=1.2]
   * @param {number} [opts.radius=0.6]
   */
  constructor(opts = {}) {
    this.enabled   = true;
    this.threshold = opts.threshold ?? 0.8;
    this.strength  = opts.strength  ?? 1.2;
    this.radius    = opts.radius    ?? 0.6;
    this._wgslSrc  = null;
    this._pipeline = null;
  }

  /**
   * @param {*} srcTex
   * @param {*} dstTex
   * @param {import('../../core/GraphicsContext').IGraphicsRenderer} renderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    // Phase 3: implement full two-pass bloom via bloom.wgsl
    // For now: pass-through (skeleton)
    _passThrough(srcTex, dstTex, renderer);
  }

  dispose() { this._pipeline = null; }
}

function _passThrough(src, dst) {
  // Placeholder — replaced by real blit in Phase 3
  void src; void dst;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BloomPass };
} else {
  window.GQBloomPass = BloomPass;
}
