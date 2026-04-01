/**
 * GalaxyLevelWebGPU.js
 *
 * IZoomLevelRenderer implementation for the Galaxy zoom level (Level 0).
 * WebGPU backend — wraps and extends StarfieldWebGPU with Cluster Auras,
 * FTL Overlay, and Fleet Sprites via the IGraphicsRenderer interface.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { IZoomLevelRenderer } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

class GalaxyLevelWebGPU extends IZoomLevelRenderer {
  constructor() {
    super();
    this._canvas   = null;
    this._backend  = null;
    this._starfield = null;  // StarfieldWebGPU instance
    this._sceneData = null;
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    // StarfieldWebGPU is registered as a browser global; in Node tests it may
    // be absent — guard accordingly.
    const StarfieldCtor = (typeof window !== 'undefined' && window.StarfieldWebGPU)
      || null;
    if (StarfieldCtor) {
      this._starfield = new StarfieldCtor(canvas, {});
      await this._starfield.init();
    }
  }

  setSceneData(data) {
    this._sceneData = data || null;
    if (!this._starfield) return;
    if (data && Array.isArray(data.stars)) {
      this._starfield.setStars(data.stars);
    }
    if (data && data.clusterAuras) {
      this._starfield.setClusterAuras(data.clusterAuras);
    }
    if (data && data.ftlInfrastructure) {
      this._starfield.setFtlInfrastructure(data.ftlInfrastructure);
    }
    if (data && data.fleets) {
      this._starfield.setGalaxyFleets(data.fleets);
    }
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    // StarfieldWebGPU drives its own RAF loop internally; nothing extra needed.
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    if (this._starfield) {
      this._starfield.exitSystemView();
    }
  }

  async exit(nextLevel) { // eslint-disable-line no-unused-vars
    // Nothing to tear down — StarfieldWebGPU keeps running.
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
  module.exports = { GalaxyLevelWebGPU };
} else {
  window.GQGalaxyLevelWebGPU = { GalaxyLevelWebGPU };
}
