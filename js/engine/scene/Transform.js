/**
 * Transform.js
 *
 * Hierarchical Transform node — position, rotation (Quaternion), scale.
 * Computes world-space Matrix4 lazily by walking the parent chain.
 *
 * Inspired by Three.js Object3D (MIT) — https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { Matrix4 }    = typeof require !== 'undefined' ? require('../math/Matrix4.js')    : { Matrix4:    window.GQMatrix4    };
const { Vector3 }    = typeof require !== 'undefined' ? require('../math/Vector3.js')    : { Vector3:    window.GQVector3    };
const { Quaternion } = typeof require !== 'undefined' ? require('../math/Quaternion.js') : { Quaternion: window.GQQuaternion };

class Transform {
  constructor() {
    this.position       = new Vector3(0, 0, 0);
    this.rotation       = new Quaternion();
    this.scale          = new Vector3(1, 1, 1);
    this.localMatrix    = new Matrix4();
    this.worldMatrix    = new Matrix4();
    /** @type {Transform|null} */
    this.parent         = null;
    /** @type {Transform[]} */
    this.children       = [];
    this._matrixDirty   = true;
  }

  // ---------------------------------------------------------------------------
  // Hierarchy
  // ---------------------------------------------------------------------------

  /** Attach a child transform. */
  add(child) {
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    return this;
  }

  remove(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) { this.children.splice(idx, 1); child.parent = null; }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Matrix
  // ---------------------------------------------------------------------------

  /** Mark this node and all descendants dirty. */
  markDirty() {
    this._matrixDirty = true;
    for (const c of this.children) c.markDirty();
  }

  /** Rebuild local + world matrices (propagates up parent chain first). */
  updateMatrices() {
    if (this._matrixDirty) {
      this.localMatrix.compose(this.position, this.rotation, this.scale);
      if (this.parent) {
        this.parent.updateMatrices();
        this.worldMatrix.multiplyMatrices(this.parent.worldMatrix, this.localMatrix);
      } else {
        this.worldMatrix.copy(this.localMatrix);
      }
      this._matrixDirty = false;
    }
  }

  /** Convenience: set position and mark dirty. */
  setPosition(x, y, z) {
    this.position.set(x, y, z);
    return this.markDirty();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Transform };
} else {
  window.GQTransform = Transform;
}
