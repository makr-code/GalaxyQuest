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

  /**
   * Upload all available vertex / index arrays to the GPU.
   *
   * Creates WebGPUBuffer instances for each attribute that is present and
   * stores the underlying `GPUBuffer` handles in `this._gpuBuffers`.
   * Existing GPU buffers are replaced (the caller is responsible for
   * destroying old buffers via a ResourceTracker when needed).
   *
   * @param {GPUDevice} device
   * @param {{ WebGPUBuffer: typeof import('../webgpu/WebGPUBuffer').WebGPUBuffer,
   *           BufferType:   typeof import('../webgpu/WebGPUBuffer').BufferType }} deps
   * @returns {this}
   */
  uploadToGPU(device, { WebGPUBuffer, BufferType }) {
    if (this.positions) {
      this._gpuBuffers.positions = new WebGPUBuffer(device, BufferType.VERTEX, this.positions).gpuBuffer;
    }
    if (this.normals) {
      this._gpuBuffers.normals = new WebGPUBuffer(device, BufferType.VERTEX, this.normals).gpuBuffer;
    }
    if (this.uvs) {
      this._gpuBuffers.uvs = new WebGPUBuffer(device, BufferType.VERTEX, this.uvs).gpuBuffer;
    }
    if (this.indices) {
      this._gpuBuffers.indices = new WebGPUBuffer(device, BufferType.INDEX, this.indices).gpuBuffer;
    }
    return this;
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
