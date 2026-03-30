/**
 * Vector3.js
 *
 * Immutable-style 3D vector (operates via instance methods that return `this`
 * for chaining, compatible with Three.js Vector3 duck-typing).
 *
 * Inspired by Three.js Vector3 (MIT) — https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }

  set(x, y, z)  { this.x = x; this.y = y; this.z = z; return this; }
  clone()        { return new Vector3(this.x, this.y, this.z); }
  copy(v)        { this.x = v.x; this.y = v.y; this.z = v.z; return this; }

  add(v)         { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v)         { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  divideScalar(s)   { return this.multiplyScalar(1 / s); }

  dot(v)  { return this.x * v.x + this.y * v.y + this.z * v.z; }

  cross(v) {
    const ax = this.x, ay = this.y, az = this.z;
    this.x = ay * v.z - az * v.y;
    this.y = az * v.x - ax * v.z;
    this.z = ax * v.y - ay * v.x;
    return this;
  }

  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length()   { return Math.sqrt(this.lengthSq()); }

  normalize() {
    const l = this.length() || 1;
    return this.divideScalar(l);
  }

  lerp(v, t) {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  distanceToSquared(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }

  /** Write into a Float32Array at offset (for GPU upload). */
  toArray(arr = [], offset = 0) { arr[offset] = this.x; arr[offset + 1] = this.y; arr[offset + 2] = this.z; return arr; }
  fromArray(arr, offset = 0)    { this.x = arr[offset]; this.y = arr[offset + 1]; this.z = arr[offset + 2]; return this; }

  equals(v) { return this.x === v.x && this.y === v.y && this.z === v.z; }

  toString() { return `Vector3(${this.x.toFixed(4)}, ${this.y.toFixed(4)}, ${this.z.toFixed(4)})`; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Vector3 };
} else {
  window.GQVector3 = Vector3;
}
