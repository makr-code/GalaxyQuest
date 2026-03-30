/**
 * Quaternion.js
 *
 * Unit quaternion for 3D rotations — avoids gimbal lock.
 *
 * Inspired by Three.js Quaternion (MIT) — https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }

  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  clone()          { return new Quaternion(this.x, this.y, this.z, this.w); }
  copy(q)          { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }

  identity() { return this.set(0, 0, 0, 1); }

  /** Set from axis (normalized Vector3) + angle (radians). */
  setFromAxisAngle(axis, angle) {
    const half = angle / 2;
    const s    = Math.sin(half);
    this.x = axis.x * s;
    this.y = axis.y * s;
    this.z = axis.z * s;
    this.w = Math.cos(half);
    return this;
  }

  /** Hamilton product — this = this × q. */
  multiply(q) {
    const ax = this.x, ay = this.y, az = this.z, aw = this.w;
    const bx = q.x,    by = q.y,    bz = q.z,    bw = q.w;
    this.x = aw*bx + ax*bw + ay*bz - az*by;
    this.y = aw*by - ax*bz + ay*bw + az*bx;
    this.z = aw*bz + ax*by - ay*bx + az*bw;
    this.w = aw*bw - ax*bx - ay*by - az*bz;
    return this;
  }

  /** Spherical linear interpolation. */
  slerp(q, t) {
    let cosHalfTheta = this.x*q.x + this.y*q.y + this.z*q.z + this.w*q.w;
    if (cosHalfTheta < 0) { cosHalfTheta = -cosHalfTheta; q = q.clone().negate(); }
    if (Math.abs(cosHalfTheta) >= 1) return this;

    const halfTheta    = Math.acos(cosHalfTheta);
    const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
    if (Math.abs(sinHalfTheta) < 1e-7) {
      this.x = this.x * 0.5 + q.x * 0.5;
      this.y = this.y * 0.5 + q.y * 0.5;
      this.z = this.z * 0.5 + q.z * 0.5;
      this.w = this.w * 0.5 + q.w * 0.5;
      return this;
    }
    const ra = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const rb = Math.sin(t * halfTheta) / sinHalfTheta;
    this.x = this.x * ra + q.x * rb;
    this.y = this.y * ra + q.y * rb;
    this.z = this.z * ra + q.z * rb;
    this.w = this.w * ra + q.w * rb;
    return this;
  }

  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; this.w = -this.w; return this; }

  lengthSq() { return this.x*this.x + this.y*this.y + this.z*this.z + this.w*this.w; }
  length()   { return Math.sqrt(this.lengthSq()); }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; this.w /= l; return this; }

  conjugate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }

  /** Rotate Vector3 v by this quaternion (returns new Vector3). */
  rotateVector3(v) {
    const ix =  this.w*v.x + this.y*v.z - this.z*v.y;
    const iy =  this.w*v.y + this.z*v.x - this.x*v.z;
    const iz =  this.w*v.z + this.x*v.y - this.y*v.x;
    const iw = -this.x*v.x - this.y*v.y - this.z*v.z;
    return {
      x: ix*this.w + iw*(-this.x) + iy*(-this.z) - iz*(-this.y),
      y: iy*this.w + iw*(-this.y) + iz*(-this.x) - ix*(-this.z),
      z: iz*this.w + iw*(-this.z) + ix*(-this.y) - iy*(-this.x),
    };
  }

  toArray(arr = [], offset = 0) {
    arr[offset] = this.x; arr[offset+1] = this.y; arr[offset+2] = this.z; arr[offset+3] = this.w;
    return arr;
  }

  equals(q) { return this.x === q.x && this.y === q.y && this.z === q.z && this.w === q.w; }
  toString() { return `Quat(${this.x.toFixed(4)}, ${this.y.toFixed(4)}, ${this.z.toFixed(4)}, ${this.w.toFixed(4)})`; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Quaternion };
} else {
  window.GQQuaternion = Quaternion;
}
