/**
 * passes/ComputePass.js
 *
 * Generic compute pass — dispatches a WGSL compute shader as part of the
 * post-processing chain.  Used for parallel NPC-AI updates and physics.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class ComputePass {
  /**
   * @param {Object} opts
   * @param {string} opts.label
   * @param {string} opts.shaderSrc        WGSL compute shader
   * @param {number} [opts.workgroupsX=1]
   * @param {number} [opts.workgroupsY=1]
   * @param {number} [opts.workgroupsZ=1]
   */
  constructor(opts = {}) {
    this.enabled      = true;
    this.label        = opts.label      ?? 'compute-pass';
    this.shaderSrc    = opts.shaderSrc  ?? '';
    this.workgroupsX  = opts.workgroupsX ?? 1;
    this.workgroupsY  = opts.workgroupsY ?? 1;
    this.workgroupsZ  = opts.workgroupsZ ?? 1;
    this._pipeline    = null;
    this._bindGroups  = new Map();
  }

  /**
   * Dispatch the compute pass.
   * @param {*} _srcTex   unused — compute passes don't sample the scene texture
   * @param {*} _dstTex   unused
   * @param {import('../../core/GraphicsContext').IGraphicsRenderer} renderer
   */
  render(_srcTex, _dstTex, renderer) {
    if (!this.enabled) return;
    // Phase 5: call renderer.dispatchCompute(...)
    void renderer;
  }

  dispose() {
    this._pipeline   = null;
    this._bindGroups.clear();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ComputePass };
} else {
  window.GQComputePass = ComputePass;
}
