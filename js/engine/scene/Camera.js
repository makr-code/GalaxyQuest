/**
 * Camera.js
 *
 * Perspective and Orthographic camera with Matrix4-based frustum.
 *
 * Inspired by Three.js PerspectiveCamera / OrthographicCamera (MIT)
 *   https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { Matrix4 }    = typeof require !== 'undefined' ? require('../math/Matrix4.js')    : { Matrix4:    window.GQMatrix4    };
const { Vector3 }    = typeof require !== 'undefined' ? require('../math/Vector3.js')    : { Vector3:    window.GQVector3    };
const { Quaternion } = typeof require !== 'undefined' ? require('../math/Quaternion.js') : { Quaternion: window.GQQuaternion };

class Camera {
  constructor() {
    this.position    = new Vector3(0, 0, 5);
    this.rotation    = new Quaternion();
    this.projMatrix  = new Matrix4();
    this.viewMatrix  = new Matrix4();
    this._dirty      = true;
  }

  /** Force a view-matrix rebuild next update(). */
  _markDirty() { this._dirty = true; }

  /** Rebuild view matrix from position + rotation quaternion. */
  update() {
    if (!this._dirty) return;
    // View = inverse(TRS) — for unit quaternion: conjugate(q) handles R-1
    const invPos = this.position.clone().negate();
    // Simple: compose(invPos, conjugate(rot), {1,1,1})
    const invRot = this.rotation.clone().conjugate();
    const scale  = new Vector3(1, 1, 1);
    this.viewMatrix.compose(invPos, invRot, scale);
    this._dirty = false;
  }

  lookAt(target) {
    // Direction from position to target
    const dir = target.clone().sub(this.position).normalize();
    const up  = new Vector3(0, 1, 0);
    const right = up.clone().cross(dir).normalize();
    const trueUp  = dir.clone().cross(right).normalize();

    const e = this.viewMatrix.elements;
    e[0]=right.x;  e[4]=right.y;  e[8]=right.z;  e[12]=-right.dot(this.position);
    e[1]=trueUp.x; e[5]=trueUp.y; e[9]=trueUp.z; e[13]=-trueUp.dot(this.position);
    e[2]=-dir.x;   e[6]=-dir.y;   e[10]=-dir.z;  e[14]=dir.dot(this.position);
    e[3]=0;        e[7]=0;        e[11]=0;        e[15]=1;
    this._dirty = false;
  }
}

class PerspectiveCamera extends Camera {
  /**
   * @param {number} fovDeg    Vertical FOV in degrees
   * @param {number} aspect    Width / height
   * @param {number} near
   * @param {number} far
   */
  constructor(fovDeg = 60, aspect = 1, near = 0.1, far = 5000) {
    super();
    this.fov    = fovDeg;
    this.aspect = aspect;
    this.near   = near;
    this.far    = far;
    this._rebuildProj();
  }

  setAspect(aspect) { this.aspect = aspect; this._rebuildProj(); }
  setFov(fovDeg)    { this.fov    = fovDeg; this._rebuildProj(); }

  _rebuildProj() {
    this.projMatrix.makePerspective(
      this.fov * (Math.PI / 180),
      this.aspect,
      this.near,
      this.far,
    );
  }
}

class OrthographicCamera extends Camera {
  /**
   * @param {number} left
   * @param {number} right
   * @param {number} top
   * @param {number} bottom
   * @param {number} near
   * @param {number} far
   */
  constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 100) {
    super();
    this.left   = left;  this.right  = right;
    this.top    = top;   this.bottom = bottom;
    this.near   = near;  this.far    = far;
    this._rebuildProj();
  }

  updateFrustum(left, right, top, bottom) {
    Object.assign(this, { left, right, top, bottom });
    this._rebuildProj();
  }

  _rebuildProj() {
    this.projMatrix.makeOrthographic(this.left, this.right, this.top, this.bottom, this.near, this.far);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Camera, PerspectiveCamera, OrthographicCamera };
} else {
  window.GQCamera = { Camera, PerspectiveCamera, OrthographicCamera };
}
