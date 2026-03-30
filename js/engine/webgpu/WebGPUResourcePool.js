/**
 * WebGPUResourcePool.js
 *
 * Memory pooling — reuse GPUBuffers and GPUTextures to avoid
 * GPU allocator pressure, especially in per-frame temporary resources.
 *
 * Inspiration:
 *   - Three.js (MIT): RenderTarget pooling concepts
 *     https://github.com/mrdoob/three.js
 *   - Babylon.js (Apache 2.0): WebGPUBufferManager
 *     https://github.com/BabylonJS/Babylon.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class WebGPUResourcePool {
  /**
   * @param {GPUDevice} device
   * @param {Object}    [opts]
   * @param {number}    [opts.maxPoolSize=64]  Max entries per bucket
   */
  constructor(device, opts = {}) {
    this._device = device;
    this._maxPoolSize = opts.maxPoolSize ?? 64;
    /** @type {Map<string, GPUBuffer[]>} key = `${usage}:${size}` */
    this._bufferPool = new Map();
    /** @type {Map<string, GPUTexture[]>} key = `${format}:${w}x${h}` */
    this._texturePool = new Map();
  }

  // ---------------------------------------------------------------------------
  // Buffer pool
  // ---------------------------------------------------------------------------

  /**
   * Acquire a buffer from the pool, or create a new one.
   * @param {GPUBufferUsageFlags} usage
   * @param {number}              size  byte size (will be aligned to 4)
   * @returns {GPUBuffer}
   */
  acquireBuffer(usage, size) {
    const alignedSize = (size + 3) & ~3;
    const key = `${usage}:${alignedSize}`;
    const pool = this._bufferPool.get(key) ?? [];

    if (pool.length > 0) {
      return pool.pop();
    }

    return this._device.createBuffer({ size: alignedSize, usage });
  }

  /**
   * Return a buffer to the pool for later reuse.
   * @param {GPUBuffer}           buffer
   * @param {GPUBufferUsageFlags} usage
   * @param {number}              size
   */
  releaseBuffer(buffer, usage, size) {
    const alignedSize = (size + 3) & ~3;
    const key = `${usage}:${alignedSize}`;
    const pool = this._bufferPool.get(key) ?? [];
    if (pool.length < this._maxPoolSize) {
      pool.push(buffer);
      this._bufferPool.set(key, pool);
    } else {
      buffer.destroy();
    }
  }

  // ---------------------------------------------------------------------------
  // Texture pool
  // ---------------------------------------------------------------------------

  /**
   * Acquire a texture from the pool, or create a new one.
   * @param {GPUTextureFormat}    format
   * @param {number}              width
   * @param {number}              height
   * @param {GPUTextureUsageFlags} usage
   * @returns {GPUTexture}
   */
  acquireTexture(format, width, height, usage) {
    const key  = `${format}:${width}x${height}:${usage}`;
    const pool = this._texturePool.get(key) ?? [];

    if (pool.length > 0) return pool.pop();

    return this._device.createTexture({ size: [width, height], format, usage });
  }

  /**
   * Return a texture to the pool.
   * @param {GPUTexture} texture
   * @param {string}     format
   * @param {number}     width
   * @param {number}     height
   * @param {number}     usage
   */
  releaseTexture(texture, format, width, height, usage) {
    const key  = `${format}:${width}x${height}:${usage}`;
    const pool = this._texturePool.get(key) ?? [];
    if (pool.length < this._maxPoolSize) {
      pool.push(texture);
      this._texturePool.set(key, pool);
    } else {
      texture.destroy();
    }
  }

  // ---------------------------------------------------------------------------
  // Dispose everything
  // ---------------------------------------------------------------------------

  dispose() {
    for (const pool of this._bufferPool.values())  pool.forEach((b) => b.destroy());
    for (const pool of this._texturePool.values()) pool.forEach((t) => t.destroy());
    this._bufferPool.clear();
    this._texturePool.clear();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPUResourcePool };
} else {
  window.GQWebGPUResourcePool = WebGPUResourcePool;
}
