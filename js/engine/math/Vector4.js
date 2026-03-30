/**
 * Vector4.js
 *
 * 4D vector — homogeneous coordinates, RGBA colours, quaternion storage.
 *
 * Inspired by Three.js Vector4 (MIT) — https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class Vector4 {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }

  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  clone()          { return new Vector4(this.x, this.y, this.z, this.w); }
  copy(v)          { this.x = v.x; this.y = v.y; this.z = v.z; this.w = v.w; return this; }

  add(v)           { this.x += v.x; this.y += v.y; this.z += v.z; this.w += v.w; return this; }
  multiplyScalar(s){ this.x *= s; this.y *= s; this.z *= s; this.w *= s; return this; }

  length()    { return Math.sqrt(this.x*this.x + this.y*this.y + this.z*this.z + this.w*this.w); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  dot(v)      { return this.x*v.x + this.y*v.y + this.z*v.z + this.w*v.w; }

  toArray(arr = [], offset = 0) {
    arr[offset]     = this.x; arr[offset + 1] = this.y;
    arr[offset + 2] = this.z; arr[offset + 3] = this.w;
    return arr;
  }
  fromArray(arr, offset = 0) {
    this.x = arr[offset]; this.y = arr[offset + 1];
    this.z = arr[offset + 2]; this.w = arr[offset + 3];
    return this;
  }

  equals(v) { return this.x === v.x && this.y === v.y && this.z === v.z && this.w === v.w; }
  toString() { return `Vector4(${this.x.toFixed(4)}, ${this.y.toFixed(4)}, ${this.z.toFixed(4)}, ${this.w.toFixed(4)})`; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Vector4 };
} else {
  window.GQVector4 = Vector4;
}
