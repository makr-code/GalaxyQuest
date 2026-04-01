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

// ---------------------------------------------------------------------------
// Frustum
// ---------------------------------------------------------------------------

/**
 * Six-plane view frustum extracted from a combined projection × view matrix.
 * Used by SceneGraph to cull nodes whose bounding sphere lies outside.
 *
 * Plane extraction uses the Gribb/Hartmann method (direct row combination).
 */
class Frustum {
  constructor() {
    /** @type {Float32Array[]} 6 planes, each [nx, ny, nz, d] (normalised). */
    this.planes = Array.from({ length: 6 }, () => new Float32Array(4));
  }

  /**
   * Populate the six planes from a combined projection-view matrix.
   *
   * The matrix is expected in column-major order (same as Matrix4.elements).
   * Plane order: left, right, bottom, top, near, far.
   *
   * @param {Matrix4} pvMatrix  Result of projMatrix.clone().multiplyMatrices(projMatrix, viewMatrix)
   * @returns {this}
   */
  setFromMatrix(pvMatrix) {
    const e = pvMatrix.elements;
    // Extract rows (matrix is column-major, so row i = [e[i], e[4+i], e[8+i], e[12+i]])
    const r0 = [e[0],  e[4],  e[8],  e[12]];
    const r1 = [e[1],  e[5],  e[9],  e[13]];
    const r2 = [e[2],  e[6],  e[10], e[14]];
    const r3 = [e[3],  e[7],  e[11], e[15]];

    _setPlane(this.planes[0], r3, r0, +1); // left:   r3 + r0
    _setPlane(this.planes[1], r3, r0, -1); // right:  r3 - r0
    _setPlane(this.planes[2], r3, r1, +1); // bottom: r3 + r1
    _setPlane(this.planes[3], r3, r1, -1); // top:    r3 - r1
    _setPlane(this.planes[4], r3, r2, +1); // near:   r3 + r2
    _setPlane(this.planes[5], r3, r2, -1); // far:    r3 - r2
    return this;
  }

  /**
   * Test whether a bounding sphere is at least partially inside the frustum.
   *
   * @param {Vector3} center  World-space sphere center
   * @param {number}  radius  Sphere radius (≥ 0)
   * @returns {boolean}  false = fully outside; true = inside or intersecting
   */
  containsSphere(center, radius) {
    for (const p of this.planes) {
      // Signed distance from plane (positive = inside half-space)
      const dist = p[0] * center.x + p[1] * center.y + p[2] * center.z + p[3];
      if (dist < -radius) return false; // sphere entirely behind this plane
    }
    return true;
  }
}

/**
 * Fill a plane array from two matrix rows (r3 ± sign*ri), then normalise.
 * @param {Float32Array} out
 * @param {number[]} r3
 * @param {number[]} ri
 * @param {number}   sign
 */
function _setPlane(out, r3, ri, sign) {
  out[0] = r3[0] + sign * ri[0];
  out[1] = r3[1] + sign * ri[1];
  out[2] = r3[2] + sign * ri[2];
  out[3] = r3[3] + sign * ri[3];
  const len = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
  if (len > 1e-10) { out[0] /= len; out[1] /= len; out[2] /= len; out[3] /= len; }
}

// ---------------------------------------------------------------------------
// Camera base
// ---------------------------------------------------------------------------

class Camera {
  constructor() {
    this.position    = new Vector3(0, 0, 5);
    this.rotation    = new Quaternion();
    this.projMatrix  = new Matrix4();
    this.viewMatrix  = new Matrix4();
    this._dirty      = true;
    /** @type {Frustum|null} Lazily created; kept in sync by update(). */
    this._frustum    = null;
  }

  /** Force a view-matrix rebuild next update(). */
  _markDirty() { this._dirty = true; }

  /** Rebuild view matrix from position + rotation quaternion. */
  update() {
    if (!this._dirty) return;
    // View = inverse(TRS) — for unit quaternion: conjugate(q) handles R-1
    const invPos = this.position.clone().negate();
    const invRot = this.rotation.clone().conjugate();
    const scale  = new Vector3(1, 1, 1);
    this.viewMatrix.compose(invPos, invRot, scale);
    this._updateFrustum();
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
    this._updateFrustum();
    this._dirty = false;
  }

  /**
   * Recompute the camera frustum from the current proj × view matrices.
   * Called automatically by update() and lookAt().
   */
  _updateFrustum() {
    if (!this._frustum) this._frustum = new Frustum();
    const pv = new Matrix4().multiplyMatrices(this.projMatrix, this.viewMatrix);
    this._frustum.setFromMatrix(pv);
  }

  /**
   * Explicit frustum refresh for cases where the projection matrix changed
   * without a full update() cycle (e.g. after setAspect / setFov).
   */
  updateFrustumNow() {
    this._dirty = true;
    this.update();
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

  setAspect(aspect) { this.aspect = aspect; this._rebuildProj(); this._markDirty(); }
  setFov(fovDeg)    { this.fov    = fovDeg; this._rebuildProj(); this._markDirty(); }

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
    this._markDirty();
  }

  _rebuildProj() {
    this.projMatrix.makeOrthographic(this.left, this.right, this.top, this.bottom, this.near, this.far);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Camera, PerspectiveCamera, OrthographicCamera, Frustum };
} else {
  window.GQCamera = { Camera, PerspectiveCamera, OrthographicCamera, Frustum };
}
