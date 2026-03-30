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

  function emitRenderTelemetry(type, payload) {
    const detail = Object.assign({
      type,
      ts: Date.now(),
      source: 'galaxy3d-webgpu',
    }, payload || {});
    try {
      if (!Array.isArray(window.__GQ_RENDER_TELEMETRY)) {
        window.__GQ_RENDER_TELEMETRY = [];
      }
      window.__GQ_RENDER_TELEMETRY.push(detail);
      if (window.__GQ_RENDER_TELEMETRY.length > 300) {
        window.__GQ_RENDER_TELEMETRY.splice(0, window.__GQ_RENDER_TELEMETRY.length - 300);
      }
      window.dispatchEvent(new CustomEvent('gq:render-telemetry', { detail }));
    } catch (_) {}
  }

  function ensureCanvas(container, opts) {
    if (opts && opts.externalCanvas instanceof HTMLCanvasElement) {
      return opts.externalCanvas;
    }
    if (container && typeof container.querySelector === 'function') {
      const existing = container.querySelector('canvas#starfield, canvas');
      if (existing instanceof HTMLCanvasElement) {
        return existing;
      }
    }
    return null;
  }

  function isInteractiveWebGPUExperimentEnabled() {
    try {
      const stored = String(localStorage.getItem('gq:webgpuInteractive') || '').trim().toLowerCase();
      if (stored === '1' || stored === 'true' || stored === 'on') {
        return true;
      }
    } catch (_) {}
    return !!window.__GQ_WEBGPU_INTERACTIVE_EXPERIMENT;
  }

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
      this._native    = null;   // StarfieldWebGPU for non-interactive path
      this._canvas    = opts.externalCanvas ?? null;
      this.ready      = false;

      this._interactiveExperiment = isInteractiveWebGPUExperimentEnabled();

      // In interactive mode we keep feature parity by default.
      if (this._opts.interactive !== false && !this._interactiveExperiment && window.Galaxy3DRenderer) {
        this._delegate = new window.Galaxy3DRenderer(this._container, this._opts);
        this._backend = 'webgl2';
        this.ready = true;
        emitRenderTelemetry('fallback', {
          from: 'webgpu',
          to: 'webgl2',
          reason: 'interactive-galaxy-uses-three-path',
        });
      }
    }

    /**
     * Initialise asynchronously.  Detects WebGPU, falls back to Three.js.
     * @returns {Promise<void>}
     */
    async init() {
      if (this.ready && this._delegate) {
        return;
      }

      const gpuAvailable = await _probeWebGPU();

      const nonInteractive = this._opts.interactive === false;
      const interactive = !nonInteractive;
      const canvas = ensureCanvas(this._container, this._opts);
      const allowNative = nonInteractive || this._interactiveExperiment;

      if (gpuAvailable && allowNative && window.StarfieldWebGPU && canvas) {
        try {
          this._native = new window.StarfieldWebGPU(canvas, {
            stars: this._opts.initialStars || [],
          });
          await this._native.init();
          this._backend = this._native.backendType || 'webgpu';
          this.ready = true;
          window.__GQ_ACTIVE_RENDERER_BACKEND = this._backend;
          emitRenderTelemetry('backend-active', {
            backend: this._backend,
            interactive,
          });
          return;
        } catch (err) {
          emitRenderTelemetry('fallback', {
            from: 'webgpu',
            to: 'webgl2',
            reason: String(err?.message || err || 'native-starfield-init-failed'),
          });
        }
      }

      this._backend = 'webgl2';
      if (!window.Galaxy3DRenderer) {
        throw new Error('[Galaxy3DRendererWebGPU] Galaxy3DRenderer (Three.js) not available and WebGPU not supported');
      }
      if (!this._delegate) {
        this._delegate = new window.Galaxy3DRenderer(this._container, this._opts);
      }
      this.ready     = true;
      window.__GQ_ACTIVE_RENDERER_BACKEND = this._backend;
      emitRenderTelemetry('backend-active', {
        backend: this._backend,
        interactive: this._opts.interactive !== false,
      });

      if (interactive && this._interactiveExperiment) {
        emitRenderTelemetry('fallback', {
          from: 'webgpu',
          to: 'webgl2',
          reason: 'interactive-webgpu-experiment-failed-or-unavailable',
        });
      }
    }

    // -------------------------------------------------------------------------
    // Public API — mirrors Galaxy3DRenderer surface so callers need no changes
    // -------------------------------------------------------------------------

    setStars(stars, opts) {
      if (this._native && typeof this._native.setStars === 'function') {
        this._native.setStars(stars, opts);
      }
      return this._delegate?.setStars?.(stars, opts);
    }
    setEmpires(empires) { return this._delegate?.setEmpires?.(empires); }
    setSelectedStar(star) { return this._delegate?.setSelectedStar?.(star); }
    setCameraTarget(target) {
      if (this._native && typeof this._native.setCameraTarget === 'function') {
        this._native.setCameraTarget(target);
      }
      return this._delegate?.setCameraTarget?.(target);
    }
    setTransitionsEnabled(flag) {
      if (this._native && typeof this._native.setTransitionsEnabled === 'function') {
        this._native.setTransitionsEnabled(flag);
      }
      return this._delegate?.setTransitionsEnabled?.(flag);
    }
    setClusterBoundsVisible(flag) { return this._delegate?.setClusterBoundsVisible?.(flag); }
    setGalacticCoreFxEnabled(flag) { return this._delegate?.setGalacticCoreFxEnabled?.(flag); }
    setEmpireHeartbeatSystems(list) {
      if (this._native && typeof this._native.setEmpireHeartbeatSystems === 'function') {
        this._native.setEmpireHeartbeatSystems(list);
      }
      return this._delegate?.setEmpireHeartbeatSystems?.(list);
    }
    fitCameraToStars(force, immediate) {
      if (this._native && typeof this._native.fitCameraToStars === 'function') {
        this._native.fitCameraToStars(force, immediate);
      }
      return this._delegate?.fitCameraToStars?.(force, immediate);
    }
    setCameraDriver(driver, opts) {
      if (this._native && typeof this._native.setCameraDriver === 'function') {
        this._native.setCameraDriver(driver, opts);
      }
      return this._delegate?.setCameraDriver?.(driver, opts);
    }
    clearCameraDriver() {
      if (this._native && typeof this._native.clearCameraDriver === 'function') {
        this._native.clearCameraDriver();
      }
      return this._delegate?.clearCameraDriver?.();
    }
    destroy() {
      if (this._native && typeof this._native.dispose === 'function') {
        this._native.dispose();
      }
      return this._delegate?.destroy?.();
    }
    resize(w, h) {
      if (this._native && typeof this._native.resize === 'function') {
        this._native.resize(w, h);
      }
      return this._delegate?.resize?.(w, h);
    }
    dispose() {
      if (this._native && typeof this._native.dispose === 'function') {
        this._native.dispose();
      }
      return this._delegate?.dispose?.();
    }

    get renderer()   { return this._delegate?.renderer ?? this._native?.renderer ?? null; }
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
