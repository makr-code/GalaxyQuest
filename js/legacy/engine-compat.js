/**
 * engine-compat.js
 *
 * WebGPU / WebGL2 Fallback Selector
 *
 * Drop-in compatibility bridge for existing galaxy3d.js / starfield.js code.
 * Sets window.GQActiveRenderer to the best available renderer and exposes a
 * unified interface that the rest of the game can use without knowing which
 * backend is running.
 *
 * Usage (add once before other game scripts):
 *   <script src="js/legacy/engine-compat.js"></script>
 *
 * Then any script can:
 *   const renderer = await window.GQEngineCompat.getRenderer(canvas);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

(function () {
  'use strict';

  /**
   * Renderer hint — can be overridden via:
   *   localStorage.setItem('gq:rendererHint', 'webgpu' | 'webgl2' | 'auto')
   */
  function getHint() {
    try { return localStorage.getItem('gq:rendererHint') || 'auto'; } catch { return 'auto'; }
  }

  /** @type {Promise<import('./engine/core/GraphicsContext').IGraphicsRenderer>|null} */
  let _rendererPromise = null;

  const GQEngineCompat = {
    /**
     * Initialise (once) and return the active renderer.
     * Subsequent calls return the same cached renderer.
     *
     * @param {HTMLCanvasElement} canvas
     * @returns {Promise<*>}
     */
    getRenderer(canvas) {
      if (_rendererPromise) return _rendererPromise;

      const hint = getHint();

      // If GQRendererFactory is loaded (engine/core/RendererFactory.js), use it.
      if (window.GQRendererFactory) {
        _rendererPromise = window.GQRendererFactory.create(canvas, {
          hint,
          onFallback(reason) {
            console.info('[GQEngineCompat] Renderer fallback:', reason);
          },
        }).then((r) => {
          window.GQActiveRenderer = r;
          _dispatchEvent(r);
          return r;
        });
        return _rendererPromise;
      }

      // Minimal inline fallback: try WebGPU, fall back to Three.js
      _rendererPromise = _detectAndCreate(canvas, hint).then((r) => {
        window.GQActiveRenderer = r;
        _dispatchEvent(r);
        return r;
      });
      return _rendererPromise;
    },

    /**
     * Returns the cached renderer synchronously (or null if not yet ready).
     * @returns {*|null}
     */
    get activeRenderer() { return window.GQActiveRenderer ?? null; },

    /** True if a WebGPU renderer is active. */
    get isWebGPU() { return window.GQActiveRenderer?.getCapabilities?.()?.webgpu === true; },

    /** Override the renderer hint for the next page load. */
    setHint(hint) {
      try { localStorage.setItem('gq:rendererHint', hint); } catch {}
    },
  };

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  async function _detectAndCreate(canvas, hint) {
    const gpuOk = hint !== 'webgl2' && await _probeWebGPU();

    if (gpuOk) {
      try {
        return await _createWebGPU(canvas);
      } catch (e) {
        console.warn('[GQEngineCompat] WebGPU init failed, falling back to WebGL2:', e.message);
      }
    }
    return _createWebGL(canvas);
  }

  async function _probeWebGPU() {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try { return (await navigator.gpu.requestAdapter()) !== null; } catch { return false; }
  }

  async function _createWebGPU(canvas) {
    if (!window.GQWebGPURenderer) throw new Error('GQWebGPURenderer not loaded');
    const r = new window.GQWebGPURenderer();
    await r.initialize(canvas);
    return r;
  }

  function _createWebGL(canvas) {
    // Wrap Three.js renderer if available, else return null stub
    if (typeof THREE !== 'undefined' && window.GQWebGLRenderer) {
      const r = new window.GQWebGLRenderer();
      return r.initialize(canvas).then(() => r);
    }
    console.warn('[GQEngineCompat] No supported renderer found');
    return Promise.resolve(null);
  }

  function _dispatchEvent(renderer) {
    try {
      const caps = renderer?.getCapabilities?.() ?? {};
      window.dispatchEvent(new CustomEvent('gq:rendererReady', {
        detail: { renderer, backend: caps.webgpu ? 'webgpu' : 'webgl2' },
      }));
    } catch {}
  }

  window.GQEngineCompat = GQEngineCompat;
})();
