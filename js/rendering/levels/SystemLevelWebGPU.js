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

const { IZoomLevelRenderer } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

class SystemLevelWebGPU extends IZoomLevelRenderer {
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

    const StarfieldCtor = (typeof window !== 'undefined' && window.StarfieldWebGPU) || null;
    if (StarfieldCtor) {
      this._starfield = new StarfieldCtor(canvas, {});
      await this._starfield.init();
    }
  }

  setSceneData(data) {
    this._sceneData = data || null;
    if (!this._starfield) return;
    if (data && data.star) {
      this._starfield.setCameraTarget(data.star);
    }
    if (data && Array.isArray(data.stars)) {
      this._starfield.setStars(data.stars);
    }
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    // StarfieldWebGPU RAF loop handles rendering.
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    if (this._starfield) {
      const star = transitionPayload && transitionPayload.star
        ? transitionPayload.star
        : null;
      if (star) {
        this._starfield.focusOnSystemPlanet(star, false);
      } else {
        this._starfield.enterSystemView();
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
