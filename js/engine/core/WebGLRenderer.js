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
  /**
   * @param {Object|null} [threeOptions]  When provided the underlying
   *   THREE.WebGLRenderer is created synchronously in the constructor
   *   (useful for the Galaxy3DRenderer path where async init is not possible).
   *   Pass `null` or omit to use the async {@link initialize} path instead.
   */
  constructor(threeOptions = null) {
    super();
    /** @type {THREE.WebGLRenderer|null} */
    this._threeRenderer = null;
    /** @type {boolean} */
    this.ready = false;

    if (threeOptions !== null) {
      this._initSync(threeOptions);
    }
  }

  // ---------------------------------------------------------------------------
  // Synchronous construction helper (Galaxy3DRenderer path)
  // ---------------------------------------------------------------------------

  /**
   * Initialize the underlying THREE.WebGLRenderer synchronously.
   * Called automatically when constructor options are provided.
   * @param {Object} opts  Passed verbatim to `new THREE.WebGLRenderer(opts)`.
   */
  _initSync(opts) {
    if (typeof THREE === 'undefined') {
      throw new Error('WebGLRenderer requires Three.js — load three.min.js first');
    }
    this._threeRenderer = new THREE.WebGLRenderer(opts);
    this.ready = true;
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

  // ---------------------------------------------------------------------------
  // Three.js-compatible pass-through API
  //
  // These delegates expose the THREE.WebGLRenderer surface required by
  // Galaxy3DRenderer so the adapter is a transparent drop-in replacement.
  // ---------------------------------------------------------------------------

  /** @returns {HTMLCanvasElement|null} */
  get domElement() { return this._threeRenderer ? this._threeRenderer.domElement : null; }

  /** @returns {string} */
  get outputColorSpace() { return this._threeRenderer ? this._threeRenderer.outputColorSpace : ''; }
  /** @param {string} v */
  set outputColorSpace(v) { if (this._threeRenderer) this._threeRenderer.outputColorSpace = v; }

  /**
   * Set the device pixel ratio.
   * @param {number} ratio
   */
  setPixelRatio(ratio) {
    if (this._threeRenderer) this._threeRenderer.setPixelRatio(ratio);
  }

  /** @returns {number} */
  getPixelRatio() {
    return this._threeRenderer ? this._threeRenderer.getPixelRatio() : 1;
  }

  /**
   * Set the clear color.
   * @param {number|string|THREE.Color} color
   * @param {number} [alpha]
   */
  setClearColor(color, alpha) {
    if (this._threeRenderer) this._threeRenderer.setClearColor(color, alpha);
  }

  /**
   * Resize the renderer output.
   * Equivalent to IGraphicsRenderer#resize — provided here for the
   * THREE.WebGLRenderer-compatible spelling used by Galaxy3DRenderer.
   * @param {number} width
   * @param {number} height
   * @param {boolean} [updateStyle=true]
   */
  setSize(width, height, updateStyle = true) {
    if (this._threeRenderer) this._threeRenderer.setSize(width, height, updateStyle);
  }

  /**
   * Pre-compile shaders for a scene/camera pair.
   * Delegates to THREE.WebGLRenderer#compile.
   * @param {THREE.Object3D} scene
   * @param {THREE.Camera}   camera
   */
  compile(scene, camera) {
    if (this._threeRenderer) return this._threeRenderer.compile(scene, camera);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGLRenderer };
} else {
  window.GQWebGLRenderer = WebGLRenderer;
}
