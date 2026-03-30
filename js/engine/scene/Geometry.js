/**
 * Geometry.js
 *
 * Vertex data container — positions, normals, UVs, indices.
 *
 * Inspired by Three.js BufferGeometry (MIT) — https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class Geometry {
  constructor() {
    /** @type {Float32Array|null} */
    this.positions = null;
    /** @type {Float32Array|null} */
    this.normals   = null;
    /** @type {Float32Array|null} */
    this.uvs       = null;
    /** @type {Uint16Array|Uint32Array|null} */
    this.indices   = null;
    this._gpuBuffers = {};
  }

  /** Factory: build a screen-aligned quad (-1..1) for post-effect passes. */
  static screenQuad() {
    const g = new Geometry();
    g.positions = new Float32Array([-1,-1,0,  1,-1,0,  1,1,0,  -1,1,0]);
    g.uvs       = new Float32Array([ 0, 0,    1, 0,    1,1,     0,1]);
    g.indices   = new Uint16Array([0,1,2, 0,2,3]);
    return g;
  }

  /** Factory: unit box. */
  static box(w = 1, h = 1, d = 1) {
    const hw = w/2, hh = h/2, hd = d/2;
    const g = new Geometry();
    g.positions = new Float32Array([
      -hw,-hh,-hd,  hw,-hh,-hd,  hw,hh,-hd,  -hw,hh,-hd,
      -hw,-hh, hd,  hw,-hh, hd,  hw,hh, hd,  -hw,hh, hd,
    ]);
    g.indices = new Uint16Array([
      0,1,2,0,2,3, 4,5,6,4,6,7,
      0,4,7,0,7,3, 1,5,6,1,6,2,
      0,1,5,0,5,4, 3,2,6,3,6,7,
    ]);
    return g;
  }

  dispose() {
    // GPU buffers are destroyed by ResourceTracker or renderer
    this._gpuBuffers = {};
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Geometry };
} else {
  window.GQGeometry = Geometry;
}
