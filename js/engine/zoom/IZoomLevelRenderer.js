/**
 * IZoomLevelRenderer.js
 *
 * Abstract base class / interface for a single zoom-level renderer.
 *
 * Each zoom level (Galaxy / System / Planet-Approach / Colony-Surface) has
 * two concrete implementations: one for the WebGPU backend and one for the
 * Three.js (WebGL2) fallback.  RendererRegistry picks the right class at
 * runtime via RendererFactory.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class IZoomLevelRenderer {
  /**
   * One-time initialisation.  Called by RendererRegistry.resolve() before
   * the first enter() call.
   *
   * @param {HTMLCanvasElement}                    canvas
   * @param {import('../engine/core/GraphicsContext').IGraphicsRenderer} backend
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async initialize(canvas, backend) { throw new Error(`${this.constructor.name}#initialize not implemented`); }

  /**
   * Feed scene data into this renderer (star list, colony data, fleet data …).
   * May be called before and after enter().
   *
   * @param {*} data
   */
  // eslint-disable-next-line no-unused-vars
  setSceneData(data) { throw new Error(`${this.constructor.name}#setSceneData not implemented`); }

  /**
   * Per-frame render call.
   *
   * @param {number} dt          — delta time in seconds
   * @param {object} cameraState — { position, target, roll, t }
   */
  // eslint-disable-next-line no-unused-vars
  render(dt, cameraState) { throw new Error(`${this.constructor.name}#render not implemented`); }

  /**
   * Activation transition (Fade-In, LOD build-up …).
   *
   * @param {number|null} prevLevel      — ZOOM_LEVEL of the outgoing renderer
   * @param {*}           transitionPayload
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async enter(prevLevel, transitionPayload) { throw new Error(`${this.constructor.name}#enter not implemented`); }

  /**
   * Deactivation transition.
   *
   * @param {number} nextLevel — ZOOM_LEVEL of the incoming renderer
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async exit(nextLevel) { throw new Error(`${this.constructor.name}#exit not implemented`); }

  /** Release all GPU/Three.js resources. */
  dispose() { throw new Error(`${this.constructor.name}#dispose not implemented`); }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IZoomLevelRenderer };
} else {
  window.GQIZoomLevelRenderer = { IZoomLevelRenderer };
}
