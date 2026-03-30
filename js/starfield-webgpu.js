/**
 * starfield-webgpu.js
 *
 * WebGPU compatibility layer for the Starfield renderer.
 *
 * Mirrors the existing starfield.js API so auth and game screens need no
 * code changes.  Routes to the WebGPU path when available, Three.js otherwise.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

(function () {
  'use strict';

  class StarfieldWebGPU {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Object} [opts]
     */
    constructor(canvas, opts = {}) {
      this._canvas  = canvas;
      this._opts    = opts;
      this._backend = null;
      this._delegate = null;
      this.ready    = false;
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
      const gpuAvailable = await _probeWebGPU();

      if (gpuAvailable) {
        this._backend = 'webgpu';
        // Phase 4: implement native WebGPU starfield render loop
        console.info('[StarfieldWebGPU] WebGPU backend selected (Phase 4 implementation pending)');
        this.ready = true;
        return;
      }

      // Fallback — the existing IIFE in starfield.js already ran and populated
      // the auth galaxy background runtime.  Nothing else needed here.
      this._backend = 'webgl2';
      this.ready    = true;
    }

    /** @returns {'webgpu'|'webgl2'|null} */
    get backendType() { return this._backend; }

    start()    { this._delegate?.start?.(); }
    stop()     { this._delegate?.stop?.(); }
    dispose()  { this._delegate?.dispose?.(); }
  }

  // ---------------------------------------------------------------------------

  async function _probeWebGPU() {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try { return (await navigator.gpu.requestAdapter()) !== null; } catch { return false; }
  }

  window.StarfieldWebGPU = StarfieldWebGPU;
})();
