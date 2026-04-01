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

const { IZoomLevelRenderer } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

class SystemLevelThreeJS extends IZoomLevelRenderer {
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

    const GalaxyRendererCtor = (typeof window !== 'undefined' && window.GalaxyRenderer) || null;
    if (GalaxyRendererCtor) {
      this._renderer = new GalaxyRendererCtor(canvas, {});
    }
  }

  setSceneData(data) {
    this._sceneData = data || null;
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    // GalaxyRenderer RAF loop handles rendering.
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    if (this._renderer && typeof this._renderer.enterSystemView === 'function') {
      const star = transitionPayload && transitionPayload.star
        ? transitionPayload.star
        : null;
      this._renderer.enterSystemView(star, transitionPayload);
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
