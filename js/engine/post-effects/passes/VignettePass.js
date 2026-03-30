/**
 * passes/VignettePass.js
 *
 * Vignette post-processing pass.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class VignettePass {
  constructor(opts = {}) {
    this.enabled   = true;
    this.darkness  = opts.darkness ?? 0.5;
    this.falloff   = opts.falloff  ?? 2.0;
    this._pipeline = null;
  }

  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    // Phase 3: blit via vignette.wgsl
    void srcTex; void dstTex; void renderer;
  }

  dispose() { this._pipeline = null; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VignettePass };
} else {
  window.GQVignettePass = VignettePass;
}
