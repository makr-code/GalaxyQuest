/**
 * GraphicsContext.js
 *
 * Abstract Graphics API — Renderer Abstraction Layer
 *
 * Defines the IGraphicsRenderer interface that both WebGPURenderer and
 * WebGLRenderer implement.  All engine code that draws things talks only to
 * this interface, never to the concrete renderer directly.
 *
 * Inspiration:
 *   - Babylon.js (Apache 2.0): ThinEngine abstraction pattern
 *     https://github.com/BabylonJS/Babylon.js
 *   - Three.js (MIT): WebGLRenderer public surface
 *     https://github.com/mrdoob/three.js
 *   - PlayCanvas Engine (MIT): GraphicsDevice base class
 *     https://github.com/playcanvas/engine
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/**
 * Renderer capability flags returned by IGraphicsRenderer#getCapabilities().
 * @typedef {Object} RendererCapabilities
 * @property {boolean} webgpu
 * @property {boolean} webgl2
 * @property {boolean} computeShaders
 * @property {boolean} float32Textures
 * @property {boolean} depthTextures
 * @property {number}  maxTextureSize
 * @property {number}  maxAnisotropy
 */

/**
 * IGraphicsRenderer
 *
 * All methods throw by default — concrete subclasses must override every
 * method they need.  This mirrors the "abstract base class" pattern used by
 * Babylon.js ThinEngine.
 */
class IGraphicsRenderer {
  /** @param {HTMLCanvasElement} canvas */
  // eslint-disable-next-line no-unused-vars
  async initialize(canvas) { throw new Error(`${this.constructor.name}#initialize not implemented`); }

  /** @returns {RendererCapabilities} */
  getCapabilities() { throw new Error(`${this.constructor.name}#getCapabilities not implemented`); }

  /**
   * @param {'vertex'|'index'|'uniform'|'storage'} type
   * @param {BufferSource} data
   * @param {'static'|'dynamic'|'stream'} usage
   * @returns {*}
   */
  // eslint-disable-next-line no-unused-vars
  createBuffer(type, data, usage) { throw new Error(`${this.constructor.name}#createBuffer not implemented`); }

  /**
   * @param {Object} spec  { width, height, format, mipMaps, renderTarget }
   * @returns {*}
   */
  // eslint-disable-next-line no-unused-vars
  createTexture(spec) { throw new Error(`${this.constructor.name}#createTexture not implemented`); }

  /**
   * @param {string} vertexSrc
   * @param {string} fragmentSrc
   * @returns {*}
   */
  // eslint-disable-next-line no-unused-vars
  createShader(vertexSrc, fragmentSrc) { throw new Error(`${this.constructor.name}#createShader not implemented`); }

  /**
   * @param {Object} config
   * @returns {*}
   */
  // eslint-disable-next-line no-unused-vars
  createRenderPass(config) { throw new Error(`${this.constructor.name}#createRenderPass not implemented`); }

  /**
   * @param {Object} scene
   * @param {Object} camera
   */
  // eslint-disable-next-line no-unused-vars
  render(scene, camera) { throw new Error(`${this.constructor.name}#render not implemented`); }

  /**
   * @param {number} width
   * @param {number} height
   */
  // eslint-disable-next-line no-unused-vars
  resize(width, height) { throw new Error(`${this.constructor.name}#resize not implemented`); }

  dispose() { throw new Error(`${this.constructor.name}#dispose not implemented`); }
}

// Export for both ESM and browser-global usage.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IGraphicsRenderer };
} else {
  window.GQGraphicsContext = { IGraphicsRenderer };
}
