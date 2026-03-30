/**
 * passes/ChromaticPass.js
 *
 * Chromatic Aberration post-processing pass.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class ChromaticPass {
  constructor(opts = {}) {
    this.enabled   = true;
    this.power     = opts.power ?? 0.005;
    this.angle     = opts.angle ?? 0;
    this._pipeline = null;
  }

  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    // Phase 3: blit via chromatic.wgsl
    void srcTex; void dstTex; void renderer;
  }

  dispose() { this._pipeline = null; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChromaticPass };
} else {
  window.GQChromaticPass = ChromaticPass;
}
