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

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

class GalaxyLevelThreeJS extends ZoomLevelRendererBase {
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

    const GalaxyRendererCtor = (typeof window !== 'undefined' && (window.Galaxy3DRenderer || window.GalaxyRendererCore)) || null;
    const runtimeOptions = (typeof window !== 'undefined' && window.__GQ_LEVEL_RENDERER_OPTIONS && typeof window.__GQ_LEVEL_RENDERER_OPTIONS === 'object')
      ? window.__GQ_LEVEL_RENDERER_OPTIONS
      : {};
    const container = canvas?.parentElement || null;
    if (GalaxyRendererCtor && container) {
      const shared = window.__GQ_LEVEL_SHARED_RENDERER_THREEJS;
      if (shared) {
        this._renderer = shared;
        if (this._renderer.opts && typeof this._renderer.opts === 'object') {
          Object.assign(this._renderer.opts, runtimeOptions);
        }
      } else {
        this._renderer = new GalaxyRendererCtor(container, Object.assign({}, runtimeOptions, { externalCanvas: canvas, interactive: true }));
        window.__GQ_LEVEL_SHARED_RENDERER_THREEJS = this._renderer;
      }
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
