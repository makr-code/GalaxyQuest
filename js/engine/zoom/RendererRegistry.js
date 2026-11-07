/**
 * RendererRegistry.js
 *
 * Maps zoom-level numbers → { webgpu?: Class, threejs?: Class } and
 * instantiates the right implementation at runtime based on the active
 * IGraphicsRenderer backend.
 *
 * Usage:
 *   const registry = new RendererRegistry();
 *   registry.register(ZOOM_LEVEL.GALAXY, { webgpu: GalaxyLevelWebGPU, threejs: GalaxyLevelThreeJS });
 *   const renderer = registry.resolve(ZOOM_LEVEL.GALAXY, backendInstance);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class RendererRegistry {
  constructor() {
    /** @type {Map<number, { webgpu?: Function, threejs?: Function }>} */
    this._entries = new Map();
    /** @type {Map<number, import('./IZoomLevelRenderer').IZoomLevelRenderer>} */
    this._instances = new Map();
  }

  /**
   * Register one or both renderer classes for a zoom level.
   * Calling register() a second time for the same level replaces the entry
   * and invalidates the cached instance, enabling hot-swap without restart.
   *
   * @param {number} level
   * @param {{ webgpu?: Function, threejs?: Function }} classes
   */
  register(level, { webgpu, threejs }) {
    if (typeof level !== 'number' || !Number.isFinite(level)) {
      throw new TypeError(`RendererRegistry.register: level must be a finite number, got ${level}`);
    }
    const hasWebGPU = typeof webgpu === 'function';
    const hasThreeJS = typeof threejs === 'function';
    if (!hasWebGPU && !hasThreeJS) {
      throw new TypeError('RendererRegistry.register: at least one renderer constructor is required');
    }
    this._entries.set(level, { webgpu, threejs });
    const previousInstance = this._instances.get(level);
    this._instances.delete(level);
    if (previousInstance) previousInstance.dispose();
  }

  /**
   * Returns the cached (or freshly created) IZoomLevelRenderer instance for
   * the given level.  Selects WebGPU class when the backend reports
   * capabilities.webgpu === true. Three.js is only selected for a non-WebGPU
   * backend when that compatibility implementation was registered.
   *
   * @param {number} level
   * @param {import('../engine/core/GraphicsContext').IGraphicsRenderer} backend
   * @returns {import('./IZoomLevelRenderer').IZoomLevelRenderer}
   */
  resolve(level, backend) {
    if (!this._entries.has(level)) {
      throw new Error(`RendererRegistry.resolve: no entry registered for level ${level}`);
    }

    if (this._instances.has(level)) {
      return this._instances.get(level);
    }

    const { webgpu, threejs } = this._entries.get(level);
    const useWebGPU = RendererRegistry._backendIsWebGPU(backend);
    const Ctor = useWebGPU ? webgpu : threejs;
    if (typeof Ctor !== 'function') {
      const backendName = useWebGPU ? 'WebGPU' : 'non-WebGPU';
      throw new Error(`RendererRegistry.resolve: no ${backendName} renderer registered for level ${level}`);
    }
    const instance = new Ctor();
    this._instances.set(level, instance);
    return instance;
  }

  /**
   * Check identity without creating or replacing a cached renderer.
   *
   * @param {number} level
   * @param {import('./IZoomLevelRenderer').IZoomLevelRenderer} instance
   * @returns {boolean}
   */
  isCurrent(level, instance) {
    return this._instances.get(level) === instance;
  }

  /**
   * Release a specific cached instance while keeping its registration for retry.
   * A stale caller must not evict a replacement registered in the meantime.
   *
   * @param {number} level
   * @param {import('./IZoomLevelRenderer').IZoomLevelRenderer} instance
   */
  release(level, instance) {
    if (this._instances.get(level) !== instance) return;
    this._instances.delete(level);
    instance.dispose();
  }

  /**
   * Remove all registrations and cached instances.
   */
  clear() {
    const errors = [];
    for (const instance of this._instances.values()) {
      try {
        instance.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this._entries.clear();
    this._instances.clear();
    if (errors.length) {
      throw new AggregateError(errors, 'RendererRegistry.clear: one or more renderers failed to dispose');
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Determine whether the given backend is a WebGPU renderer.
   * We check getCapabilities() when available, then fall back to constructor
   * name, so unit tests can pass in a plain object with the right shape.
   *
   * @param {*} backend
   * @returns {boolean}
   */
  static _backendIsWebGPU(backend) {
    if (!backend) return false;
    if (typeof backend.getCapabilities === 'function') {
      try {
        const caps = backend.getCapabilities();
        return !!(caps && caps.webgpu);
      } catch (_) { /* ignore */ }
    }
    // Fallback: check the constructor name.
    const name = (backend.constructor && backend.constructor.name) || '';
    return /webgpu/i.test(name);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RendererRegistry };
} else {
  window.GQRendererRegistry = { RendererRegistry };
}
