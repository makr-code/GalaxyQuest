/**
 * EffectComposer.js  (WebGPU port)
 *
 * Renderer-agnostic post-processing chain.
 * Manages ping-pong render targets and routes each pass via the
 * abstract IGraphicsRenderer interface.
 *
 * Existing WebGL PostEffectsManager (js/post-effects.js) can delegate to
 * this class when WebGPU is available.
 *
 * Inspiration:
 *   - Three.js EffectComposer (MIT) — https://github.com/mrdoob/three.js
 *   - Babylon.js PostProcessRenderPipeline (Apache 2.0)
 *     https://github.com/BabylonJS/Babylon.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class EffectComposer {
  /**
   * @param {import('../core/GraphicsContext').IGraphicsRenderer} renderer
   * @param {number} width
   * @param {number} height
   */
  constructor(renderer, width, height) {
    this._renderer = renderer;
    this._passes   = [];
    this._width    = width;
    this._height   = height;

    // Two render targets for ping-pong
    this._rtA = renderer.createTexture({ width, height, format: 'rgba8unorm', renderTarget: true });
    this._rtB = renderer.createTexture({ width, height, format: 'rgba8unorm', renderTarget: true });
    this._pingIdx = 0;
  }

  /** @param {Object} pass  Any object with a .render(srcTex, dstTex, renderer) method. */
  addPass(pass) {
    this._passes.push(pass);
    return this;
  }

  removePass(pass) {
    const idx = this._passes.indexOf(pass);
    if (idx !== -1) this._passes.splice(idx, 1);
    return this;
  }

  /**
   * Execute the full pass chain.
   * @param {Object} [mainTarget]  Final output texture/view; null = screen
   */
  render(mainTarget = null) {
    const rts = [this._rtA, this._rtB];
    let srcIdx = this._pingIdx;

    for (let i = 0; i < this._passes.length; i++) {
      const pass = this._passes[i];
      if (!pass.enabled) continue;

      const isLast = (i === this._passes.length - 1);
      const dstTex = isLast ? mainTarget : rts[srcIdx ^ 1];

      pass.render(rts[srcIdx], dstTex, this._renderer);
      srcIdx ^= 1;
    }

    this._pingIdx = srcIdx;
  }

  resize(width, height) {
    this._width  = width;
    this._height = height;
    // Recreate render targets at new resolution
    const renderer = this._renderer;
    this._rtA = renderer.createTexture({ width, height, format: 'rgba8unorm', renderTarget: true });
    this._rtB = renderer.createTexture({ width, height, format: 'rgba8unorm', renderTarget: true });
  }

  dispose() {
    for (const pass of this._passes) pass.dispose?.();
    this._passes = [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EffectComposer };
} else {
  window.GQEffectComposer = EffectComposer;
}
