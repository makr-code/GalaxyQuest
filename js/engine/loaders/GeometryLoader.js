/**
 * loaders/GeometryLoader.js
 *
 * Load GLTF / OBJ geometry (stubs for Phase 2+).
 * Currently supports inline JSON geometry descriptors.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { Geometry } = typeof require !== 'undefined'
  ? require('../scene/Geometry.js')
  : { Geometry: window.GQGeometry };

class GeometryLoader {
  /**
   * Load a geometry from a plain JSON descriptor URL.
   * JSON format: { positions: [], normals: [], uvs: [], indices: [] }
   *
   * @param {string} url
   * @returns {Promise<Geometry>}
   */
  static async loadJSON(url) {
    const resp = await fetch(url);
    const data = await resp.json();
    const geo  = new Geometry();
    if (data.positions) geo.positions = new Float32Array(data.positions);
    if (data.normals)   geo.normals   = new Float32Array(data.normals);
    if (data.uvs)       geo.uvs       = new Float32Array(data.uvs);
    if (data.indices)   geo.indices   = new Uint16Array(data.indices);
    return geo;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GeometryLoader };
} else {
  window.GQGeometryLoader = GeometryLoader;
}
