/**
 * Vector2.js
 *
 * 2D vector — UV coordinates, screen-space math, post-effect passes.
 *
 * Inspired by Three.js Vector2 (MIT) — https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }

  set(x, y) { this.x = x; this.y = y; return this; }
  clone()    { return new Vector2(this.x, this.y); }
  copy(v)    { this.x = v.x; this.y = v.y; return this; }

  add(v)          { this.x += v.x; this.y += v.y; return this; }
  sub(v)          { this.x -= v.x; this.y -= v.y; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; return this; }

  length()   { return Math.sqrt(this.x * this.x + this.y * this.y); }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; }

  dot(v)  { return this.x * v.x + this.y * v.y; }
  angle() { return Math.atan2(this.y, this.x); }

  toArray(arr = [], offset = 0) { arr[offset] = this.x; arr[offset + 1] = this.y; return arr; }
  fromArray(arr, offset = 0)    { this.x = arr[offset]; this.y = arr[offset + 1]; return this; }

  equals(v) { return this.x === v.x && this.y === v.y; }
  toString() { return `Vector2(${this.x.toFixed(4)}, ${this.y.toFixed(4)})`; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Vector2 };
} else {
  window.GQVector2 = Vector2;
}
