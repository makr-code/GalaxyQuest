/**
 * loaders/ShaderLoader.js
 *
 * Fetch WGSL / GLSL shader source from a URL and apply preprocessor.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { preprocessWGSL } = typeof require !== 'undefined'
  ? require('../utils/ShaderCompiler.js')
  : window.GQShaderCompiler;

class ShaderLoader {
  /** @type {Map<string,string>} */
  static _cache = new Map();

  /**
   * @param {string} url
   * @param {Object} [defines]
   * @returns {Promise<string>}
   */
  static async load(url, defines = {}) {
    const key = url + JSON.stringify(defines);
    if (ShaderLoader._cache.has(key)) return ShaderLoader._cache.get(key);

    const resp = await fetch(url);
    const src  = await resp.text();
    const processed = preprocessWGSL(src, defines);
    ShaderLoader._cache.set(key, processed);
    return processed;
  }

  static clearCache() { ShaderLoader._cache.clear(); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ShaderLoader };
} else {
  window.GQShaderLoader = ShaderLoader;
}
