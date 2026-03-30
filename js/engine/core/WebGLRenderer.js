/**
 * WebGLRenderer.js
 *
 * WebGL2 Fallback Renderer — wraps Three.js WebGLRenderer to implement the
 * IGraphicsRenderer interface.
 *
 * Used automatically when WebGPU is not available (older browsers, Safari).
 *
 * Inspiration:
 *   - Three.js (MIT): WebGLRenderer API surface
 *     https://github.com/mrdoob/three.js
 *   - PlayCanvas Engine (MIT): WebGLGraphicsDevice
 *     https://github.com/playcanvas/engine
 *   - OSG.JS (MIT): Viewer + Renderer pattern
 *     https://github.com/cedricpinson/osgjs
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { IGraphicsRenderer } = typeof require !== 'undefined'
  ? require('./GraphicsContext.js')
  : window.GQGraphicsContext;

class WebGLRenderer extends IGraphicsRenderer {
  constructor() {
    super();
    /** @type {THREE.WebGLRenderer|null} */
    this._threeRenderer = null;
    /** @type {boolean} */
    this.ready = false;
  }

  // ---------------------------------------------------------------------------
  // IGraphicsRenderer implementation
  // ---------------------------------------------------------------------------

  async initialize(canvas) {
    if (typeof THREE === 'undefined') {
      throw new Error('WebGLRenderer requires Three.js — load three.min.js first');
    }

    this._threeRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });

    this._threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._threeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this._threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._threeRenderer.toneMappingExposure = 1.0;

    this.ready = true;
  }

  getCapabilities() {
    if (!this._threeRenderer) {
      return {
        webgpu: false, webgl2: false, computeShaders: false,
        float32Textures: false, depthTextures: false,
        maxTextureSize: 0, maxAnisotropy: 1,
      };
    }
    const caps = this._threeRenderer.capabilities;
    return {
      webgpu: false,
      webgl2: caps.isWebGL2,
      computeShaders: false,
      float32Textures: caps.floatFragmentTextures,
      depthTextures: true,
      maxTextureSize: caps.maxTextureSize,
      maxAnisotropy: caps.getMaxAnisotropy(),
    };
  }

  createBuffer(type, data, usage = 'static') {
    // Three.js manages buffers internally via BufferAttribute / BufferGeometry.
    // Return a plain descriptor; higher-level Geometry/Material classes will
    // consume it via THREE.BufferAttribute.
    return { type, data, usage, _backend: 'webgl' };
  }

  createTexture(spec) {
    if (!this._threeRenderer) throw new Error('WebGLRenderer not initialised');

    const { width, height, format = 'rgba8unorm', renderTarget = false } = spec;

    if (renderTarget) {
      return new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
      });
    }

    // Plain data texture
    const tex = new THREE.DataTexture(
      new Uint8Array(width * height * 4),
      width, height,
      THREE.RGBAFormat
    );
    tex.needsUpdate = true;
    return tex;
  }

  createShader(vertexSrc, fragmentSrc) {
    // Three.js ShaderMaterial accepts GLSL src strings directly.
    return { vertexShader: vertexSrc, fragmentShader: fragmentSrc, _backend: 'webgl' };
  }

  createRenderPass(config = {}) {
    return { ...config, _type: 'webgl-render-pass' };
  }

  render(scene, camera) {
    if (!this.ready || !this._threeRenderer) return;
    this._threeRenderer.render(scene, camera);
  }

  resize(width, height) {
    if (!this._threeRenderer) return;
    this._threeRenderer.setSize(width, height, false);
  }

  dispose() {
    if (this._threeRenderer) {
      this._threeRenderer.dispose();
      this._threeRenderer = null;
    }
    this.ready = false;
  }

  // ---------------------------------------------------------------------------
  // Pass-through accessors (used by existing post-effects pipeline)
  // ---------------------------------------------------------------------------

  /** @returns {THREE.WebGLRenderer|null} */
  get threeRenderer() { return this._threeRenderer; }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGLRenderer };
} else {
  window.GQWebGLRenderer = WebGLRenderer;
}
