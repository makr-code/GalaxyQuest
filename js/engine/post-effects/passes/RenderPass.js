/**
 * passes/RenderPass.js
 *
 * Base render pass — renders a scene+camera into a render target.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class RenderPass {
  /**
   * @param {Object} scene
   * @param {Object} camera
   */
  constructor(scene, camera) {
    this.enabled = true;
    this.scene   = scene;
    this.camera  = camera;
  }

  render(_srcTex, _dstTex, renderer) {
    if (!this.enabled) return;
    renderer.render(this.scene, this.camera);
  }

  dispose() {}
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RenderPass };
} else {
  window.GQRenderPass = RenderPass;
}
