/**
 * FollowCamera.js
 *
 * A PerspectiveCamera that smoothly tracks any game object with a
 * { position: Vector3 } property (ship, base, planet, colony).
 *
 * ## Follow Modes
 *
 *  FIXED_OFFSET — camera stays at a fixed world-space offset from the target
 *  ORBIT        — camera orbits at a fixed distance; azimuth/elevation are user-controlled
 *  FREE         — look-at only; camera position is managed externally
 *
 * ## Lag (smooth follow)
 *
 *  lagFactor in [0, 1]:
 *    0   = instant snap (no lag)
 *    0.9 = heavy smoothing / slow follow
 *
 * Usage:
 *   const cam = new FollowCamera({ fov: 60, aspect: 16/9 });
 *   cam.setTarget(myShip, { mode: FollowMode.ORBIT, distance: 200, lag: 0.85 });
 *   cam.update(dt);   // call every frame
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { PerspectiveCamera } = typeof require !== 'undefined'
  ? require('./Camera.js')
  : window.GQCamera;

const { Vector3 } = typeof require !== 'undefined'
  ? require('../math/Vector3.js')
  : { Vector3: window.GQVector3 };

const { MathUtils } = typeof require !== 'undefined'
  ? require('../math/MathUtils.js')
  : { MathUtils: window.GQMathUtils };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @enum {string} */
const FollowMode = Object.freeze({
  FIXED_OFFSET: 'fixed_offset',
  ORBIT:        'orbit',
  FREE:         'free',
});

// ---------------------------------------------------------------------------
// FollowCamera
// ---------------------------------------------------------------------------

class FollowCamera extends PerspectiveCamera {
  /**
   * @param {Object} opts
   * @param {number} [opts.fov=60]
   * @param {number} [opts.aspect=1]
   * @param {number} [opts.near=0.1]
   * @param {number} [opts.far=10000]
   * @param {string} [opts.name='']  Human-readable label (shown in PiP header)
   */
  constructor(opts = {}) {
    super(opts.fov ?? 60, opts.aspect ?? 1, opts.near ?? 0.1, opts.far ?? 10000);

    /** Human-readable label (shown in PiP header) */
    this.name = opts.name ?? '';

    // Follow target — any object with a { position: Vector3-like } property
    /** @type {{ position: {x:number,y:number,z:number} }|null} */
    this._target      = null;

    /** @type {string} FollowMode */
    this._mode        = FollowMode.FIXED_OFFSET;

    /** Smooth follow lag [0=instant, 1=never catches up] */
    this._lag         = 0.1;

    // FIXED_OFFSET mode
    this._offset      = new Vector3(0, 50, 150);

    // ORBIT mode
    this._orbitDist   = 200;
    this._orbitAz     = 0;    // azimuth  in radians
    this._orbitEl     = 0.3;  // elevation in radians

    /** Current interpolated target position (for smooth follow) */
    this._smoothPos   = new Vector3(0, 0, 0);
    this._initialized = false;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Bind a follow target.
   *
   * @param {{ position: {x,y,z} }|null} target  Any object with a .position property
   * @param {Object} [opts]
   * @param {string} [opts.mode]         FollowMode (default: FIXED_OFFSET)
   * @param {number} [opts.lag=0.1]      Smoothing [0=instant … <1=smooth]
   * @param {Vector3|{x,y,z}} [opts.offset]   Fixed offset (FIXED_OFFSET mode)
   * @param {number} [opts.distance]     Orbit radius (ORBIT mode)
   * @param {number} [opts.azimuth]      Orbit azimuth in radians
   * @param {number} [opts.elevation]    Orbit elevation in radians
   */
  setTarget(target, opts = {}) {
    this._target = target;
    if (opts.mode      !== undefined) this._mode      = opts.mode;
    if (opts.lag       !== undefined) this._lag        = MathUtils.clamp(opts.lag, 0, 0.999);
    if (opts.offset    !== undefined) this._offset     = _toVec3(opts.offset);
    if (opts.distance  !== undefined) this._orbitDist  = opts.distance;
    if (opts.azimuth   !== undefined) this._orbitAz    = opts.azimuth;
    if (opts.elevation !== undefined) this._orbitEl    = opts.elevation;

    // Snap immediately on first bind
    if (target && !this._initialized) {
      const tp = target.position;
      this._smoothPos.x = tp.x;
      this._smoothPos.y = tp.y;
      this._smoothPos.z = tp.z;
      this._initialized = true;
    }
    this._markDirty();
  }

  /** Remove the follow target (camera keeps its current position). */
  clearTarget() {
    this._target = null;
  }

  // ORBIT mode controls
  /** @param {number} dAz  Delta azimuth in radians */
  orbitPan(dAz)  { this._orbitAz += dAz; this._markDirty(); }
  /** @param {number} dEl  Delta elevation in radians (clamped ±π/2) */
  orbitTilt(dEl) { this._orbitEl = MathUtils.clamp(this._orbitEl + dEl, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01); this._markDirty(); }
  /** @param {number} factor  Multiply orbit distance (e.g. 1.1 = zoom out) */
  orbitZoom(factor) { this._orbitDist = Math.max(1, this._orbitDist * factor); this._markDirty(); }

  // ---------------------------------------------------------------------------
  // Update (call every frame)
  // ---------------------------------------------------------------------------

  /**
   * @param {number} [dt=0]  Delta time in seconds (used for lag smoothing)
   */
  update(dt = 0) {
    if (!this._target) {
      // No target — just rebuild matrices from current position
      super.update();
      return;
    }

    const tp = this._target.position;

    // Smooth the target position
    const lagCoeff = Math.pow(this._lag, dt * 60); // frame-rate independent
    this._smoothPos.x = MathUtils.lerp(tp.x, this._smoothPos.x, lagCoeff);
    this._smoothPos.y = MathUtils.lerp(tp.y, this._smoothPos.y, lagCoeff);
    this._smoothPos.z = MathUtils.lerp(tp.z, this._smoothPos.z, lagCoeff);

    switch (this._mode) {
      case FollowMode.FIXED_OFFSET:
        this.position.x = this._smoothPos.x + this._offset.x;
        this.position.y = this._smoothPos.y + this._offset.y;
        this.position.z = this._smoothPos.z + this._offset.z;
        this.lookAt(new Vector3(this._smoothPos.x, this._smoothPos.y, this._smoothPos.z));
        break;

      case FollowMode.ORBIT: {
        const sinAz = Math.sin(this._orbitAz);
        const cosAz = Math.cos(this._orbitAz);
        const cosEl = Math.cos(this._orbitEl);
        const sinEl = Math.sin(this._orbitEl);
        this.position.x = this._smoothPos.x + this._orbitDist * cosEl * sinAz;
        this.position.y = this._smoothPos.y + this._orbitDist * sinEl;
        this.position.z = this._smoothPos.z + this._orbitDist * cosEl * cosAz;
        this.lookAt(new Vector3(this._smoothPos.x, this._smoothPos.y, this._smoothPos.z));
        break;
      }

      case FollowMode.FREE:
        // Only look at target, position managed externally
        this.lookAt(new Vector3(this._smoothPos.x, this._smoothPos.y, this._smoothPos.z));
        break;

      default:
        super.update();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _toVec3(v) {
  if (v instanceof Vector3) return v;
  return new Vector3(v.x ?? 0, v.y ?? 0, v.z ?? 0);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FollowCamera, FollowMode };
} else {
  window.GQFollowCamera = { FollowCamera, FollowMode };
}
