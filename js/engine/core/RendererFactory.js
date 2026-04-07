/**
 * RendererFactory.js
 *
 * Factory — detects runtime capabilities and returns the best available
 * IGraphicsRenderer implementation.
 *
 * Fallback chain:  WebGPU  →  WebGL2 (Three.js)
 *
 * Usage:
 *   const renderer = await RendererFactory.create(canvas);
 *   await renderer.initialize(canvas);
 *
 * Inspiration:
 *   - Babylon.js (Apache 2.0): EngineFactory capability detection
 *     https://github.com/BabylonJS/Babylon.js
 *   - Three.js (MIT): WebGPURenderer / WebGLRenderer selection
 *     https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { WebGPURenderer: WebGPURendererCtor } = typeof require !== 'undefined'
  ? require('./WebGPURenderer.js')
  : { WebGPURenderer: window.GQWebGPURenderer };

const { WebGLRenderer: WebGLRendererCtor } = typeof require !== 'undefined'
  ? require('./WebGLRenderer.js')
  : { WebGLRenderer: window.GQWebGLRenderer };

/**
 * @typedef {'webgpu'|'webgl2'|'auto'} RendererHint
 */

class RendererFactory {
  /**
   * Detect and instantiate the best renderer for the current environment.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {{ hint?: RendererHint, onFallback?: function }} [opts]
   * @returns {Promise<import('./GraphicsContext').IGraphicsRenderer>}
   */
  static async create(canvas, opts = {}) {
    // Allow localStorage override — developer/QA can force a specific backend.
    const storedHint = (typeof localStorage !== 'undefined')
      ? (localStorage.getItem('gq:rendererHint') ?? null)
      : null;

    const { hint = storedHint ?? 'auto', onFallback, debug = false } = opts;

    if (hint === 'webgl2') {
      return RendererFactory._createWebGL(canvas, onFallback, debug);
    }

    if (hint === 'webgpu' || hint === 'auto') {
      const gpuAvailable = await RendererFactory.isWebGPUAvailable();
      if (gpuAvailable) {
        try {
          const r = new WebGPURendererCtor();
          await r.initialize(canvas);
          return r;
        } catch (err) {
          console.warn('[RendererFactory] WebGPU init failed, falling back to WebGL2:', err.message);
          if (typeof onFallback === 'function') onFallback('webgpu-failed', err);
        }
      } else if (hint === 'webgpu') {
        throw new Error('WebGPU requested but not available in this browser');
      }
    }

    return RendererFactory._createWebGL(canvas, onFallback, debug);
  }

  /**
   * Returns true when the browser exposes a usable WebGPU adapter.
   * This is a fast probe — no device is actually created.
   *
   * @returns {Promise<boolean>}
   */
  static async isWebGPUAvailable() {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return adapter !== null;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  static async _createWebGL(canvas, onFallback, debug = false) {
    if (typeof onFallback === 'function') {
      onFallback('using-webgl2', null);
    }
    const r = new WebGLRendererCtor();
    r.debug = debug;
    await r.initialize(canvas);
    return r;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RendererFactory };
} else {
  window.GQRendererFactory = RendererFactory;
}
