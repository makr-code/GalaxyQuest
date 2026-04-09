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

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

class GalaxyLevelWebGPU extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas   = null;
    this._backend  = null;
    this._starfield = null;  // StarfieldWebGPU instance
    this._sceneData = null;
  }

  _isInteractiveWebGpuExperimentEnabled() {
    return true;
  }

  _isLegacyThreeFallbackEnabled() {
    try {
      const key = String(localStorage.getItem('gq:allowThreeFallback') || '').trim().toLowerCase();
      return key === '1' || key === 'true' || key === 'yes' || key === 'on';
    } catch (_) {
      return false;
    }
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    const useNativeWebGpu = this._isInteractiveWebGpuExperimentEnabled();
    const webGpuCtor = (typeof window !== 'undefined' && useNativeWebGpu)
      ? (window.GQGalaxy3DRendererWebGPU || window.Galaxy3DRendererWebGPU)
      : null;
    const allowLegacyThreeFallback = this._isLegacyThreeFallbackEnabled();
    const useLegacyThree = !webGpuCtor && allowLegacyThreeFallback;
    const GalaxyCtor = useLegacyThree
      ? ((typeof window !== 'undefined' && window.Galaxy3DRenderer) || null)
      : webGpuCtor;

    if (!GalaxyCtor) {
      throw new Error(
        'GalaxyLevelWebGPU requires Galaxy3DRendererWebGPU. '
        + 'Temporary fallback: set localStorage gq:allowThreeFallback=1.'
      );
    }

    const runtimeOptions = (typeof window !== 'undefined' && window.__GQ_LEVEL_RENDERER_OPTIONS && typeof window.__GQ_LEVEL_RENDERER_OPTIONS === 'object')
      ? window.__GQ_LEVEL_RENDERER_OPTIONS
      : {};
    const container = canvas?.parentElement || null;
    if (GalaxyCtor && container) {
      const shared = useLegacyThree ? window.__GQ_LEVEL_SHARED_RENDERER_THREEJS : window.__GQ_LEVEL_SHARED_RENDERER_WEBGPU;
      if (shared) {
        this._starfield = shared;
        if (this._starfield._opts && typeof this._starfield._opts === 'object') {
          Object.assign(this._starfield._opts, runtimeOptions);
        }
        if (this._starfield.opts && typeof this._starfield.opts === 'object') {
          Object.assign(this._starfield.opts, runtimeOptions);
        }
      } else {
        this._starfield = new GalaxyCtor(container, Object.assign({}, runtimeOptions, { externalCanvas: canvas, interactive: true }));
        if (typeof this._starfield.init === 'function') {
          await this._starfield.init();
        }
        if (useLegacyThree) window.__GQ_LEVEL_SHARED_RENDERER_THREEJS = this._starfield;
        else window.__GQ_LEVEL_SHARED_RENDERER_WEBGPU = this._starfield;
      }
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
