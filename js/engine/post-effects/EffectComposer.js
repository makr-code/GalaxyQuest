/**
 * EffectComposer.js  (WebGPU port)
 *
 * Renderer-agnostic post-processing chain.
 * Manages ping-pong render targets and routes each pass via the
 * abstract IGraphicsRenderer interface.
 *
 * Existing WebGL PostEffectsManager (js/rendering/post-effects.js) can delegate to
 * this class when WebGPU is available.
 *
 * Pass execution order
 * --------------------
 * Passes are executed in insertion order (first added = first executed).
 * Use addPass() / removePass() to manage the chain at runtime.  Disabled
 * passes (pass.enabled === false) are skipped without affecting the
 * ping-pong state — the next enabled pass receives the same source texture.
 *
 * Ping-pong framebuffer chain
 * ---------------------------
 * Two internal render targets (rtA, rtB) alternate as source and destination.
 * The final enabled pass writes directly to `mainTarget` (null = screen) so
 * no extra copy is needed.
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

  // =========================================================================
  // Pass management
  // =========================================================================

  /**
   * Append a pass to the end of the chain.
   * @param {Object} pass  Any object with a .render(srcTex, dstTex, renderer) method.
   * @returns {this}
   */
  addPass(pass) {
    this._passes.push(pass);
    return this;
  }

  /**
   * Remove a pass from the chain.  No-op if the pass is not present.
   * @param {Object} pass
   * @returns {this}
   */
  removePass(pass) {
    const idx = this._passes.indexOf(pass);
    if (idx !== -1) this._passes.splice(idx, 1);
    return this;
  }

  /**
   * Read-only view of the current pass list (insertion order).
   * @returns {ReadonlyArray<Object>}
   */
  get passes() {
    return this._passes;
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  /**
   * Execute the full pass chain using ping-pong render targets.
   *
   * Only enabled passes participate in the chain.  The last enabled pass
   * renders directly into `mainTarget` to avoid a redundant copy.
   *
   * @param {Object|null} [inputTexture]  Starting source texture for the chain.
   *   When null the first pass reads from the current ping-pong source
   *   (i.e. whatever the previous frame left there).
   * @param {Object|null} [mainTarget]    Final output texture/framebuffer;
   *   null means the last pass renders to the screen / swap-chain.
   */
  render(inputTexture = null, mainTarget = null) {
    const rts = [this._rtA, this._rtB];
    let srcIdx = this._pingIdx;

    // Pre-compute first and last enabled pass indices once.
    let firstEnabledIdx = -1;
    let lastEnabledIdx  = -1;
    for (let i = 0; i < this._passes.length; i++) {
      if (this._passes[i].enabled) {
        if (firstEnabledIdx === -1) firstEnabledIdx = i;
        lastEnabledIdx = i;
      }
    }

    // Track whether we have already consumed the explicit inputTexture.
    let inputConsumed = false;

    for (let i = 0; i < this._passes.length; i++) {
      const pass = this._passes[i];
      if (!pass.enabled) continue;

      const isLast = (i === lastEnabledIdx);

      // Use the caller-supplied inputTexture for the very first enabled pass
      // (only once); fall back to the current ping-pong source afterwards.
      let src;
      if (inputTexture !== null && i === firstEnabledIdx && !inputConsumed) {
        src           = inputTexture;
        inputConsumed = true;
      } else {
        src = rts[srcIdx];
      }

      const dstTex = isLast ? mainTarget : rts[srcIdx ^ 1];

      pass.render(src, dstTex, this._renderer);

      // Toggle ping-pong only when we used an intermediate RT as destination.
      if (!isLast) srcIdx ^= 1;
    }

    this._pingIdx = srcIdx;
  }

  // =========================================================================
  // Resize / dispose
  // =========================================================================

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

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EffectComposer };
} else {
  window.GQEffectComposer = EffectComposer;
}
