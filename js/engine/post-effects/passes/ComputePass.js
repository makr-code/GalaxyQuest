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
   * @param {string} opts.shaderSrc        WGSL compute shader (must expose cs_main entry)
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
    /** @type {GPUComputePipeline|null} Lazily compiled by the renderer on first dispatch. */
    this._pipeline    = null;
    /** @type {Map<number, GPUBindGroup>} group-index → GPUBindGroup */
    this._bindGroups  = new Map();
  }

  // ---------------------------------------------------------------------------
  // Bind group management
  // ---------------------------------------------------------------------------

  /**
   * Register a pre-built GPUBindGroup for a specific bind-group index.
   * Must be called before the pass is rendered for the first time.
   *
   * @param {number}       groupIndex
   * @param {GPUBindGroup} bindGroup
   */
  setBindGroup(groupIndex, bindGroup) {
    this._bindGroups.set(groupIndex, bindGroup);
  }

  /**
   * Remove the bind group registered at `groupIndex`.
   * @param {number} groupIndex
   */
  removeBindGroup(groupIndex) {
    this._bindGroups.delete(groupIndex);
  }

  // ---------------------------------------------------------------------------
  // EffectComposer integration
  // ---------------------------------------------------------------------------

  /**
   * Dispatch the compute shader.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   * Compute passes do not consume or write textures directly — they operate
   * on storage buffers registered via setBindGroup().
   *
   * @param {*} _srcTex   - unused (compute passes operate on storage buffers)
   * @param {*} _dstTex   - unused
   * @param {import('../../core/GraphicsContext').IGraphicsRenderer} renderer
   */
  render(_srcTex, _dstTex, renderer) {
    if (!this.enabled) return;
    if (!this.shaderSrc) return;

    if (typeof renderer?.dispatchCompute === 'function') {
      renderer.dispatchCompute(this);
    }
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
