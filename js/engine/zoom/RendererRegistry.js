/**
 * RendererRegistry.js
 *
 * Maps zoom-level numbers → { webgpu: Class, threejs: Class } and
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
    /** @type {Map<number, { webgpu: Function, threejs: Function }>} */
    this._entries = new Map();
    /** @type {Map<number, import('./IZoomLevelRenderer').IZoomLevelRenderer>} */
    this._instances = new Map();
  }

  /**
   * Register a pair of renderer classes for a zoom level.
   * Calling register() a second time for the same level replaces the entry
   * and invalidates the cached instance, enabling hot-swap without restart.
   *
   * @param {number} level
   * @param {{ webgpu: Function, threejs: Function }} classes
   */
  register(level, { webgpu, threejs }) {
    if (typeof level !== 'number' || !Number.isFinite(level)) {
      throw new TypeError(`RendererRegistry.register: level must be a finite number, got ${level}`);
    }
    if (typeof webgpu !== 'function' || typeof threejs !== 'function') {
      throw new TypeError('RendererRegistry.register: webgpu and threejs must be constructor functions');
    }
    this._entries.set(level, { webgpu, threejs });
    // Invalidate cached instance so next resolve() creates a fresh one.
    this._instances.delete(level);
  }

  /**
   * Returns the cached (or freshly created) IZoomLevelRenderer instance for
   * the given level.  Selects WebGPU class when the backend reports
   * capabilities.webgpu === true, otherwise falls back to ThreeJS.
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
    const instance = new Ctor();
    this._instances.set(level, instance);
    return instance;
  }

  /**
   * Remove all registrations and cached instances.
   */
  clear() {
    this._entries.clear();
    this._instances.clear();
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
