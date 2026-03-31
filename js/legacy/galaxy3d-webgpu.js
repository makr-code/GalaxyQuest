/**
 * galaxy3d-webgpu.js
 *
 * WebGPU compatibility layer for the Galaxy3D view facade.
 *
 * The gameplay/runtime layer talks to the Galaxy3D view facade.
 * This module only selects the pure render backend underneath.
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

    _callNative(method, args) {
      const target = this._native;
      if (target && typeof target[method] === 'function') {
        return target[method](...args);
      }
      return undefined;
    }

    _callDelegate(method, args) {
      const target = this._delegate;
      if (target && typeof target[method] === 'function') {
        return target[method](...args);
      }
      return undefined;
    }

    // -------------------------------------------------------------------------
    // Public API — mirrors the Galaxy3D view surface so callers need no changes
    // while backend selection stays internal to this facade.
    // -------------------------------------------------------------------------

    setStars(stars, opts) {
      this._callNative('setStars', [stars, opts]);
      return this._callDelegate('setStars', [stars, opts]);
    }
    setEmpires(empires) { return this._callDelegate('setEmpires', [empires]); }
    setSelectedStar(star) { return this._callDelegate('setSelectedStar', [star]); }
    setCameraTarget(target) {
      this._callNative('setCameraTarget', [target]);
      return this._callDelegate('setCameraTarget', [target]);
    }
    setTransitionsEnabled(flag) {
      this._callNative('setTransitionsEnabled', [flag]);
      return this._callDelegate('setTransitionsEnabled', [flag]);
    }
    setClusterBoundsVisible(flag) { return this._callDelegate('setClusterBoundsVisible', [flag]); }
    areClusterBoundsVisible() { return this._callDelegate('areClusterBoundsVisible', []); }
    setGalacticCoreFxEnabled(flag) { return this._callDelegate('setGalacticCoreFxEnabled', [flag]); }
    areGalacticCoreFxEnabled() { return this._callDelegate('areGalacticCoreFxEnabled', []); }
    setClusterColorPalette(palette) { return this._callDelegate('setClusterColorPalette', [palette]); }
    setClusterAuras(clusters) { return this._callDelegate('setClusterAuras', [clusters]); }
    setGalaxyMetadata(meta) { return this._callDelegate('setGalaxyMetadata', [meta]); }
    setGalaxyFleets(fleets) { return this._callDelegate('setGalaxyFleets', [fleets]); }
    setFtlInfrastructure(gates, nodes) { return this._callDelegate('setFtlInfrastructure', [gates, nodes]); }
    setGalaxyFleetVectorsVisible(enabled) { return this._callDelegate('setGalaxyFleetVectorsVisible', [enabled]); }
    setSystemOrbitPathsVisible(enabled) { return this._callDelegate('setSystemOrbitPathsVisible', [enabled]); }
    setSystemOrbitMarkersVisible(enabled) { return this._callDelegate('setSystemOrbitMarkersVisible', [enabled]); }
    setSystemOrbitFocusOnly(enabled) { return this._callDelegate('setSystemOrbitFocusOnly', [enabled]); }
    setHoverMagnetConfig(cfg) { return this._callDelegate('setHoverMagnetConfig', [cfg]); }
    setClusterDensityMode(mode, opts) { return this._callDelegate('setClusterDensityMode', [mode, opts]); }
    setOrbitSimulationMode(mode) { return this._callDelegate('setOrbitSimulationMode', [mode]); }
    setEmpireHeartbeatSystems(list) {
      this._callNative('setEmpireHeartbeatSystems', [list]);
      return this._callDelegate('setEmpireHeartbeatSystems', [list]);
    }
    fitCameraToStars(force, immediate) {
      this._callNative('fitCameraToStars', [force, immediate]);
      return this._callDelegate('fitCameraToStars', [force, immediate]);
    }
    setCameraDriver(driver, opts) {
      this._callNative('setCameraDriver', [driver, opts]);
      return this._callDelegate('setCameraDriver', [driver, opts]);
    }
    clearCameraDriver() {
      this._callNative('clearCameraDriver', []);
      return this._callDelegate('clearCameraDriver', []);
    }
    focusOnStar(star, smooth) { return this._callDelegate('focusOnStar', [star, smooth]); }
    focusOnSystemPlanet(planetLike, smooth) { return this._callDelegate('focusOnSystemPlanet', [planetLike, smooth]); }
    nudgeZoom(direction) { return this._callDelegate('nudgeZoom', [direction]); }
    nudgeOrbit(direction) { return this._callDelegate('nudgeOrbit', [direction]); }
    nudgePan(direction) { return this._callDelegate('nudgePan', [direction]); }
    nudgeRoll(direction, stepRad) { return this._callDelegate('nudgeRoll', [direction, stepRad]); }
    resetNavigationView() { return this._callDelegate('resetNavigationView', []); }
    focusCurrentSelection() { return this._callDelegate('focusCurrentSelection', []); }
    toggleFollowSelection() { return this._callDelegate('toggleFollowSelection', []); }
    isFollowingSelection() { return this._callDelegate('isFollowingSelection', []); }
    enterSystemView(star, payload) {
      return this._callDelegate('enterSystemView', [star, payload]);
    }
    exitSystemView(restoreGalaxy) {
      return this._callDelegate('exitSystemView', [restoreGalaxy]);
    }
    getQualityProfileState() {
      return this._callDelegate('getQualityProfileState', []);
    }
    getRenderStats() {
      return this._callDelegate('getRenderStats', [])
        || this._callNative('getRenderStats', [])
        || {
          instanceId: String(this.instanceId || ''),
          systemMode: !!this.systemMode,
          backend: String(this._backend || ''),
        };
    }
    toggleScientificScale() {
      return this._callDelegate('toggleScientificScale', []);
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
    get scene()      { return this._delegate?.scene ?? this._native?.scene ?? null; }
    get camera()     { return this._delegate?.camera ?? this._native?.camera ?? null; }
    get renderFrames() { return this._delegate?.renderFrames ?? this._native?.renderFrames ?? null; }
    get starPoints() { return this._delegate?.starPoints ?? this._native?.starPoints ?? null; }
    get stars() { return this._delegate?.stars ?? this._native?.stars ?? []; }
    get backendType() { return this._delegate?.rendererBackend ?? this._delegate?.backendType ?? this._native?.backendType ?? this._backend; }
    get instanceId() { return this._delegate?.instanceId ?? this._native?.instanceId ?? ''; }
    get systemMode() { return !!(this._delegate?.systemMode ?? this._native?.systemMode ?? false); }
    get visibleStars() { return this._delegate?.visibleStars ?? this._native?.visibleStars ?? []; }
    get selectedIndex() { return Number(this._delegate?.selectedIndex ?? this._native?.selectedIndex ?? -1); }
  }

  // ---------------------------------------------------------------------------

  async function _probeWebGPU() {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try { return (await navigator.gpu.requestAdapter()) !== null; } catch { return false; }
  }

  // Expose both the view-facade alias and the legacy constructor name.
  window.Galaxy3DView = Galaxy3DRendererWebGPU;
  window.Galaxy3DRendererWebGPU = Galaxy3DRendererWebGPU;

})();
