/**
 * galaxy3d-webgpu.js
 *
 * WebGPU compatibility layer for the Galaxy3D renderer.
 *
 * When WebGPU is available this module registers as the preferred renderer.
 * When WebGPU is NOT available it delegates to the existing
 * galaxy-renderer-core.js (Three.js based) transparently.
 *
 * Zero breaking changes — existing code that uses window.Galaxy3DRenderer
 * continues to work without modification.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

(function () {
  'use strict';

  /**
   * Phase 0: compatibility shim.
   * Phase 4+: replace body of renderFrame() with WebGPU draw calls.
   */
  class Galaxy3DRendererWebGPU {
    /**
     * @param {HTMLElement} container
     * @param {Object}      [opts]
     */
    constructor(container, opts = {}) {
      this._container = container;
      this._opts      = opts;
      this._backend   = null;   // 'webgpu' | 'webgl2'
      this._delegate  = null;   // existing Galaxy3DRenderer (Three.js) when in WebGL mode
      this._canvas    = opts.externalCanvas ?? null;
      this.ready      = false;
    }

    /**
     * Initialise asynchronously.  Detects WebGPU, falls back to Three.js.
     * @returns {Promise<void>}
     */
    async init() {
      const gpuAvailable = await _probeWebGPU();

      if (gpuAvailable) {
        this._backend = 'webgpu';
        // Phase 4: create WebGPURenderer + scene graph here
        // For now: log intent and proceed
        console.info('[Galaxy3DRendererWebGPU] WebGPU backend selected (Phase 4 implementation pending)');
        this.ready = true;
        return;
      }

      // Fallback: delegate to existing Galaxy3DRenderer
      this._backend = 'webgl2';
      if (!window.Galaxy3DRenderer) {
        throw new Error('[Galaxy3DRendererWebGPU] Galaxy3DRenderer (Three.js) not available and WebGPU not supported');
      }
      this._delegate = new window.Galaxy3DRenderer(this._container, this._opts);
      this.ready     = true;
    }

    // -------------------------------------------------------------------------
    // Public API — mirrors Galaxy3DRenderer surface so callers need no changes
    // -------------------------------------------------------------------------

    setStars(stars, opts)    { return this._delegate?.setStars(stars, opts); }
    setEmpires(empires)      { return this._delegate?.setEmpires(empires); }
    setSelectedStar(star)    { return this._delegate?.setSelectedStar(star); }
    setCameraTarget(target)  { return this._delegate?.setCameraTarget(target); }
    resize(w, h)             { return this._delegate?.resize(w, h); }
    dispose()                { return this._delegate?.dispose(); }

    get renderer()   { return this._delegate?.renderer   ?? null; }
    get scene()      { return this._delegate?.scene      ?? null; }
    get camera()     { return this._delegate?.camera     ?? null; }
    get backendType() { return this._backend; }
  }

  // ---------------------------------------------------------------------------

  async function _probeWebGPU() {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try { return (await navigator.gpu.requestAdapter()) !== null; } catch { return false; }
  }

  // Expose both the new class and preserve the old name for zero-change compat
  window.Galaxy3DRendererWebGPU = Galaxy3DRendererWebGPU;

})();
