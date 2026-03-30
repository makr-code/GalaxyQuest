/**
 * loaders/TextureLoader.js
 *
 * Async texture loading — ImageBitmap → WebGPUTexture / THREE.Texture.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class TextureLoader {
  /**
   * @param {import('../core/GraphicsContext').IGraphicsRenderer} renderer
   */
  constructor(renderer) {
    this._renderer = renderer;
    /** @type {Map<string, Promise>} Simple cache by URL */
    this._cache = new Map();
  }

  /**
   * @param {string} url
   * @returns {Promise<*>}  WebGPUTexture or THREE.Texture depending on renderer
   */
  load(url) {
    if (this._cache.has(url)) return this._cache.get(url);
    const promise = this._load(url);
    this._cache.set(url, promise);
    return promise;
  }

  async _load(url) {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const bmp  = await createImageBitmap(blob, { colorSpaceConversion: 'none' });

    const tex = this._renderer.createTexture({
      width:  bmp.width,
      height: bmp.height,
      mipMaps: true,
    });

    // WebGPUTexture exposes uploadImage; WebGLRenderer returns a THREE texture
    if (typeof tex.uploadImage === 'function') {
      tex.uploadImage(bmp);
    }

    return tex;
  }

  /** Clear the URL cache (does not destroy GPU textures). */
  clearCache() { this._cache.clear(); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TextureLoader };
} else {
  window.GQTextureLoader = TextureLoader;
}
