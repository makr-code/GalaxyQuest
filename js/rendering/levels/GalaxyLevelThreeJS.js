/**
 * GalaxyLevelThreeJS.js
 *
 * IZoomLevelRenderer implementation for the Galaxy zoom level (Level 0).
 * Three.js (WebGL2) fallback — delegates to the existing GalaxyRenderer
 * (galaxy-renderer-core.js) without modifying it.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { IZoomLevelRenderer } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

class GalaxyLevelThreeJS extends IZoomLevelRenderer {
  constructor() {
    super();
    this._canvas     = null;
    this._backend    = null;
    this._renderer   = null;   // GalaxyRenderer (galaxy-renderer-core.js) instance
    this._sceneData  = null;
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    // GalaxyRenderer is registered as a browser global in the live app.
    // In Node/test environments it may be absent — guard gracefully.
    const GalaxyRendererCtor = (typeof window !== 'undefined' && window.GalaxyRenderer)
      || null;
    if (GalaxyRendererCtor) {
      this._renderer = new GalaxyRendererCtor(canvas, {});
    }
  }

  setSceneData(data) {
    this._sceneData = data || null;
    if (!this._renderer) return;
    if (data && Array.isArray(data.stars)) {
      if (typeof this._renderer.setStars === 'function') {
        this._renderer.setStars(data.stars);
      }
    }
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    // GalaxyRenderer drives its own RAF loop; no explicit call needed.
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    if (this._renderer && typeof this._renderer.exitSystemView === 'function') {
      this._renderer.exitSystemView(true);
    }
  }

  async exit(nextLevel) { // eslint-disable-line no-unused-vars
    // Nothing to tear down — GalaxyRenderer continues internally.
  }

  dispose() {
    if (this._renderer && typeof this._renderer.dispose === 'function') {
      try { this._renderer.dispose(); } catch (_) {}
    }
    this._renderer = null;
    this._canvas   = null;
    this._backend  = null;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GalaxyLevelThreeJS };
} else {
  window.GQGalaxyLevelThreeJS = { GalaxyLevelThreeJS };
}
