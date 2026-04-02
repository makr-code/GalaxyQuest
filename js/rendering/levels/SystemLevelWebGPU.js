/**
 * SystemLevelWebGPU.js
 *
 * IZoomLevelRenderer implementation for the System zoom level (Level 1).
 * WebGPU backend — wraps the enterSystemView / exitSystemView logic from
 * galaxy-renderer-core.js via StarfieldWebGPU.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

class SystemLevelWebGPU extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas    = null;
    this._backend   = null;
    this._starfield = null;
    this._sceneData = null;
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    const GalaxyCtor = (typeof window !== 'undefined' && (window.GQGalaxy3DRendererWebGPU || window.Galaxy3DRendererWebGPU)) || null;
    const container = canvas?.parentElement || null;
    if (GalaxyCtor && container) {
      const shared = window.__GQ_LEVEL_SHARED_RENDERER_WEBGPU;
      if (shared) {
        this._starfield = shared;
      } else {
        this._starfield = new GalaxyCtor(container, { externalCanvas: canvas, interactive: true });
        if (typeof this._starfield.init === 'function') {
          await this._starfield.init();
        }
        window.__GQ_LEVEL_SHARED_RENDERER_WEBGPU = this._starfield;
      }
    }
  }

  setSceneData(data) {
    this._sceneData = data || null;
    if (!this._starfield) return;
    if (data && data.star && typeof this._starfield.setCameraTarget === 'function') {
      this._starfield.setCameraTarget(data.star);
    }
    if (data && Array.isArray(data.stars) && typeof this._starfield.setStars === 'function') {
      this._starfield.setStars(data.stars);
    }
    if (data && data.focusPlanet && typeof this._starfield.focusOnSystemPlanet === 'function') {
      this._starfield.focusOnSystemPlanet(data.focusPlanet, true);
    }
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    // StarfieldWebGPU RAF loop handles rendering.
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    if (this._starfield) {
      const sceneData = this._sceneData && typeof this._sceneData === 'object'
        ? this._sceneData
        : null;
      const star = (sceneData && sceneData.star)
        || (transitionPayload && transitionPayload.star)
        || null;
      const payload = (sceneData && sceneData.systemPayload)
        ? sceneData.systemPayload
        : transitionPayload;
      if (typeof this._starfield.enterSystemView === 'function') {
        this._starfield.enterSystemView(star, payload);
      } else if (star && typeof this._starfield.focusOnSystemPlanet === 'function') {
        this._starfield.focusOnSystemPlanet(star, false);
      }
    }
  }

  async exit(nextLevel) { // eslint-disable-line no-unused-vars
    // Keep starfield running; galaxy-level will call exitSystemView.
  }

  dispose() {
    if (this._starfield) {
      this._starfield.dispose();
      this._starfield = null;
    }
    this._canvas  = null;
    this._backend = null;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SystemLevelWebGPU };
} else {
  window.GQSystemLevelWebGPU = { SystemLevelWebGPU };
}
