/**
 * CameraFlightPath.js
 *
 * Cubic-Bezier fly-in animation for the Planet-Approach transition.
 *
 * Implements the camera-driver interface expected by GalaxyCameraController
 * (update(ctx) method), so it can be plugged in via:
 *   cameraController.setDriver(flightPath, { blendFrames: 0 }, rendererRef)
 *
 * Design goals
 * ─────────────
 *  • Cubic Bezier spline from current camera position to a point above the
 *    planet, with control points that produce a sweeping arc ("pull back,
 *    then dive in").
 *  • Cubic Hermite ease-in-out speed curve (fast in the middle, slow at ends).
 *  • Correlated roll (±8°) derived from the tangent angle of the Bezier.
 *  • Atmosphere scale modulation: 0.95 → 1.2 during approach.
 *  • Starfield velocity blur: 0 → 0.4 during approach.
 *  • abort() triggers reverse interpolation back to the start pose.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

/** Linear interpolation. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Cubic Hermite ease-in-out: smoothstep applied twice.
 * @param {number} t — [0, 1]
 * @returns {number}
 */
function easeInOut(t) {
  // Cubic Hermite: 3t² - 2t³
  return t * t * (3 - 2 * t);
}

/**
 * Evaluate a cubic Bezier at parameter t.
 * @param {number[]} p0  [x, y, z]
 * @param {number[]} p1
 * @param {number[]} p2
 * @param {number[]} p3
 * @param {number}   t   [0, 1]
 * @returns {number[]}
 */
function cubicBezier(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2  = t  * t;
  return [
    mt2 * mt * p0[0] + 3 * mt2 * t * p1[0] + 3 * mt * t2 * p2[0] + t2 * t * p3[0],
    mt2 * mt * p0[1] + 3 * mt2 * t * p1[1] + 3 * mt * t2 * p2[1] + t2 * t * p3[1],
    mt2 * mt * p0[2] + 3 * mt2 * t * p1[2] + 3 * mt * t2 * p2[2] + t2 * t * p3[2],
  ];
}

/**
 * Derivative (tangent) of the cubic Bezier at t.
 * @returns {number[]} un-normalised tangent [dx, dy, dz]
 */
function cubicBezierTangent(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return [
    3 * (mt * mt * (p1[0] - p0[0]) + 2 * mt * t * (p2[0] - p1[0]) + t * t * (p3[0] - p2[0])),
    3 * (mt * mt * (p1[1] - p0[1]) + 2 * mt * t * (p2[1] - p1[1]) + t * t * (p3[1] - p2[1])),
    3 * (mt * mt * (p1[2] - p0[2]) + 2 * mt * t * (p2[2] - p1[2]) + t * t * (p3[2] - p2[2])),
  ];
}

// Convert a THREE.Vector3-like object to a plain array (or identity if already array).
function toArr(v) {
  if (Array.isArray(v)) return [v[0] || 0, v[1] || 0, v[2] || 0];
  if (v && typeof v === 'object') return [Number(v.x || 0), Number(v.y || 0), Number(v.z || 0)];
  return [0, 0, 0];
}

function arrToObj(a) {
  return { x: a[0], y: a[1], z: a[2] };
}

// ---------------------------------------------------------------------------
// CameraFlightPath
// ---------------------------------------------------------------------------

const MAX_ROLL_RAD = (8 * Math.PI) / 180; // ±8°

class CameraFlightPath {
  constructor() {
    /** @type {'idle'|'flying'|'aborting'} */
    this._state    = 'idle';
    this._t        = 0;      // normalised flight progress [0, 1]
    this._elapsed  = 0;      // ms elapsed
    this._duration = 2500;   // ms

    // Bezier control points (plain arrays)
    this._p0 = [0, 0, 0];
    this._p1 = [0, 0, 0];
    this._p2 = [0, 0, 0];
    this._p3 = [0, 0, 0];

    // Options stored at flyTo() call
    this._opts = {};

    /** Resolve / reject for the promise returned by flyTo() */
    this._resolve = null;
    this._reject  = null;

    // Cached last camera state (position + target)
    this._lastPos    = [0, 0, 0];
    this._lastTarget = [0, 0, 0];
    this._lastRoll   = 0;

    // External side-effect callbacks set by SeamlessZoomOrchestrator
    this._onAtmosphereScale = null;
    this._onStarBlur        = null;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Start a fly-in to a planet.
   *
   * @param {THREE.Vector3|{x,y,z}} from       Current camera position
   * @param {THREE.Vector3|{x,y,z}} to         Target point above planet
   * @param {number}                [durationMs=2500]
   * @param {object}                [opts]
   * @param {number}                [opts.roll=8]          max roll degrees
   * @param {number}                [opts.atmosphereScale] initial atmo scale
   * @param {number}                [opts.starBlur=0.4]    max star blur
   * @param {Function}              [opts.onAtmosphereScale]
   * @param {Function}              [opts.onStarBlur]
   * @returns {Promise<void>}        Resolves when flight completes (t === 1)
   */
  flyTo(from, to, durationMs, opts = {}) {
    this._opts     = opts || {};
    this._duration = Number(durationMs) > 0 ? Number(durationMs) : 2500;
    this._elapsed  = 0;
    this._t        = 0;
    this._state    = 'flying';

    if (typeof opts.onAtmosphereScale === 'function') {
      this._onAtmosphereScale = opts.onAtmosphereScale;
    }
    if (typeof opts.onStarBlur === 'function') {
      this._onStarBlur = opts.onStarBlur;
    }

    const p0 = toArr(from);
    const p3 = toArr(to);

    // Control points: camera first "pulls back" (away from target) then arcs.
    // Offset p1 behind the start direction, p2 in front of target with a
    // pole-ward bias so the camera approaches from an angle.
    const mid = [
      (p0[0] + p3[0]) * 0.5,
      (p0[1] + p3[1]) * 0.5,
      (p0[2] + p3[2]) * 0.5,
    ];
    const dist = Math.sqrt(
      (p3[0] - p0[0]) ** 2 + (p3[1] - p0[1]) ** 2 + (p3[2] - p0[2]) ** 2,
    ) || 1;

    const p1 = [
      p0[0] + (mid[0] - p0[0]) * 0.25 - (p3[2] - p0[2]) * 0.3,
      p0[1] + dist * 0.35,   // pull up first
      p0[2] + (mid[2] - p0[2]) * 0.25 + (p3[0] - p0[0]) * 0.3,
    ];
    const p2 = [
      p3[0] - (p3[0] - p0[0]) * 0.2,
      p3[1] + dist * 0.12,   // slight altitude before final descent
      p3[2] - (p3[2] - p0[2]) * 0.2,
    ];

    this._p0 = p0;
    this._p1 = p1;
    this._p2 = p2;
    this._p3 = p3;

    this._lastPos    = p0.slice();
    this._lastTarget = p3.slice();
    this._lastRoll   = 0;

    // Cancel any previous in-flight promise
    if (this._reject) {
      this._reject(new Error('CameraFlightPath: new flyTo started'));
    }

    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject  = reject;
    });
  }

  /**
   * Per-frame update.  Must be called from the main render loop.
   *
   * @param {number} dt  — delta time in *milliseconds*
   * @returns {{ position: {x,y,z}, target: {x,y,z}, roll: number, t: number }|null}
   *          Returns null when idle.
   */
  tick(dt) {
    if (this._state === 'idle') return null;

    const dtMs = dt > 1 ? dt : dt * 1000; // accept both ms and seconds
    this._elapsed += dtMs;

    const raw = Math.min(1, this._elapsed / this._duration);
    const eased = easeInOut(raw);

    if (this._state === 'aborting') {
      // Reverse: drive t from current back to 0
      this._t = Math.max(0, this._t - (dtMs / this._duration));
      if (this._t <= 0) {
        this._t     = 0;
        this._state = 'idle';
        if (this._resolve) { this._resolve(); this._resolve = null; this._reject = null; }
      }
    } else {
      this._t = eased;
      if (raw >= 1) {
        this._t    = 1;
        this._state = 'idle';
        if (this._resolve) { this._resolve(); this._resolve = null; this._reject = null; }
      }
    }

    const pos    = cubicBezier(this._p0, this._p1, this._p2, this._p3, this._t);
    const tangent = cubicBezierTangent(this._p0, this._p1, this._p2, this._p3, Math.max(0.001, Math.min(0.999, this._t)));

    // Roll correlates with the horizontal (XZ) curvature angle of the tangent.
    const tangentAngle = Math.atan2(tangent[2], tangent[0]);
    const roll = Math.sin(tangentAngle) * MAX_ROLL_RAD * Math.sin(Math.PI * this._t);

    this._lastPos    = pos;
    this._lastTarget = this._p3.slice();
    this._lastRoll   = roll;

    // Side effects: atmosphere scale and star blur
    const atmoScale = lerp(0.95, 1.2, this._t);
    const starBlur  = lerp(0, Number(this._opts.starBlur ?? 0.4), Math.sin(Math.PI * this._t));

    if (typeof this._onAtmosphereScale === 'function') {
      try { this._onAtmosphereScale(atmoScale); } catch (_) {}
    }
    if (typeof this._onStarBlur === 'function') {
      try { this._onStarBlur(starBlur); } catch (_) {}
    }

    return {
      position: arrToObj(pos),
      target:   arrToObj(this._p3),
      roll,
      t: this._t,
    };
  }

  /**
   * Start a very short fly-in to a colony building.
   *
   * Distance is typically 0.5–3 world units.  The camera moves in a gentle
   * straight-ish arc from the current position to a point just in front of
   * the building facade, with minimal roll and no atmosphere/star effects.
   *
   * @param {THREE.Vector3|{x,y,z}} from          Current camera position
   * @param {THREE.Vector3|{x,y,z}} to            Target point in front of building
   * @param {number}                [durationMs=900]
   * @param {object}                [opts]
   * @param {number}                [opts.roll=3]  max roll degrees (small for buildings)
   * @returns {Promise<void>}        Resolves when flight completes (t === 1)
   */
  flyToBuilding(from, to, durationMs, opts = {}) {
    this._opts     = opts || {};
    this._duration = Number(durationMs) > 0 ? Number(durationMs) : 900;
    this._elapsed  = 0;
    this._t        = 0;
    this._state    = 'flying';

    // No atmosphere/star callbacks for building-level fly-in
    this._onAtmosphereScale = null;
    this._onStarBlur        = null;

    const p0 = toArr(from);
    const p3 = toArr(to);

    const dist = Math.sqrt(
      (p3[0] - p0[0]) ** 2 + (p3[1] - p0[1]) ** 2 + (p3[2] - p0[2]) ** 2,
    ) || 1;

    // Very gentle arc: control points only slightly offset from the straight line.
    const p1 = [
      p0[0] + (p3[0] - p0[0]) * 0.33 - (p3[2] - p0[2]) * 0.08,
      p0[1] + dist * 0.06,
      p0[2] + (p3[2] - p0[2]) * 0.33 + (p3[0] - p0[0]) * 0.08,
    ];
    const p2 = [
      p0[0] + (p3[0] - p0[0]) * 0.66 - (p3[2] - p0[2]) * 0.04,
      p0[1] + dist * 0.03,
      p0[2] + (p3[2] - p0[2]) * 0.66 + (p3[0] - p0[0]) * 0.04,
    ];

    this._p0 = p0;
    this._p1 = p1;
    this._p2 = p2;
    this._p3 = p3;

    this._lastPos    = p0.slice();
    this._lastTarget = p3.slice();
    this._lastRoll   = 0;

    if (this._reject) {
      this._reject(new Error('CameraFlightPath: new flyToBuilding started'));
    }

    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject  = reject;
    });
  }

  /**
   * Abort the current flight with reverse interpolation.
   * The promise returned by flyTo() resolves (not rejects) when the camera
   * has returned to the start pose, so callers don't need separate error
   * handling for user-initiated cancellation.
   */
  abort() {
    if (this._state === 'flying') {
      this._state   = 'aborting';
      this._elapsed = (1 - this._t) * this._duration; // keep proportional timing
    }
  }

  /** Whether a flight is currently in progress. */
  get isFlying() {
    return this._state !== 'idle';
  }

  /** Current normalised progress [0, 1]. */
  get t() { return this._t; }

  // ── Driver interface (GalaxyCameraController) ─────────────────────────────

  /**
   * Camera-driver update called by GalaxyCameraController each frame.
   *
   * @param {object} ctx  — { camera: THREE.Camera, target?, controls? }
   */
  update(ctx) {
    if (this._state === 'idle') return;

    // dt not available in the driver context — use a fixed 16 ms step.
    const dt = 16;
    const state = this.tick(dt);
    if (!state || !ctx) return;

    const cam = ctx.camera || ctx;
    if (cam && typeof cam.position === 'object' && cam.position !== null) {
      cam.position.x = state.position.x;
      cam.position.y = state.position.y;
      cam.position.z = state.position.z;
    }
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CameraFlightPath };
} else {
  window.GQCameraFlightPath = { CameraFlightPath };
}
