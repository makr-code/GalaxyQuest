/**
 * SystemLevelThreeJS.js
 *
 * IZoomLevelRenderer implementation for the System zoom level (Level 1).
 * Three.js (WebGL2) fallback — wraps galaxy-renderer-core.js enterSystemView /
 * exitSystemView without modifying the original file.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

class SystemLevelThreeJS extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas    = null;
    this._backend   = null;
    this._renderer  = null;   // GalaxyRenderer instance
    this._sceneData = null;
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    const GalaxyRendererCtor = (typeof window !== 'undefined' && (window.Galaxy3DRenderer || window.GalaxyRendererCore)) || null;
    const container = canvas?.parentElement || null;
    if (GalaxyRendererCtor && container) {
      const shared = window.__GQ_LEVEL_SHARED_RENDERER_THREEJS;
      if (shared) {
        this._renderer = shared;
      } else {
        this._renderer = new GalaxyRendererCtor(container, { externalCanvas: canvas, interactive: true });
        window.__GQ_LEVEL_SHARED_RENDERER_THREEJS = this._renderer;
      }
    }
  }

  setSceneData(data) {
    this._sceneData = data || null;
    if (this._renderer && data && data.focusPlanet && typeof this._renderer.focusOnSystemPlanet === 'function') {
      this._renderer.focusOnSystemPlanet(data.focusPlanet, true);
    }
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    // GalaxyRenderer RAF loop handles rendering.
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    if (this._renderer && typeof this._renderer.enterSystemView === 'function') {
      const sceneData = this._sceneData && typeof this._sceneData === 'object'
        ? this._sceneData
        : null;
      const star = (sceneData && sceneData.star)
        || (transitionPayload && transitionPayload.star)
        || null;
      const payload = (sceneData && sceneData.systemPayload)
        ? sceneData.systemPayload
        : transitionPayload;
      this._renderer.enterSystemView(star, payload);
    }
  }

  async exit(nextLevel) { // eslint-disable-line no-unused-vars
    // exitSystemView is called by GalaxyLevel on re-entry.
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
  module.exports = { SystemLevelThreeJS };
} else {
  window.GQSystemLevelThreeJS = { SystemLevelThreeJS };
}
