/**
 * Material.js
 *
 * Material + shader binding descriptor.
 *
 * Inspired by Three.js Material / ShaderMaterial (MIT)
 *   https://github.com/mrdoob/three.js
 * and Babylon.js ShaderMaterial (Apache 2.0)
 *   https://github.com/BabylonJS/Babylon.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class Material {
  /**
   * @param {Object} opts
   * @param {string} [opts.vertexSrc]
   * @param {string} [opts.fragmentSrc]
   * @param {Object} [opts.uniforms]
   * @param {boolean} [opts.transparent]
   * @param {boolean} [opts.depthTest]
   * @param {boolean} [opts.depthWrite]
   * @param {'none'|'front'|'back'} [opts.cullMode]
   */
  constructor(opts = {}) {
    this.vertexSrc   = opts.vertexSrc   ?? '';
    this.fragmentSrc = opts.fragmentSrc ?? '';
    this.uniforms    = opts.uniforms    ?? {};
    this.transparent = opts.transparent ?? false;
    this.depthTest   = opts.depthTest   ?? true;
    this.depthWrite  = opts.depthWrite  ?? true;
    this.cullMode    = opts.cullMode    ?? 'back';
    this.needsUpdate = true;
    this._pipeline   = null;
  }

  /** Clone, preserving uniform values. */
  clone() {
    const m = new Material(this);
    m.uniforms = JSON.parse(JSON.stringify(this.uniforms));
    return m;
  }

  dispose() { this._pipeline = null; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Material };
} else {
  window.GQMaterial = Material;
}
