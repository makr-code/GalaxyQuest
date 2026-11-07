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
 *  • A live target object/provider controls camera orientation independently
 *    from its flight destination.
 *  • Swept camera clearance against spherical and axis-aligned box colliders.
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
  if (Array.isArray(v)) return [Number(v[0] ?? 0), Number(v[1] ?? 0), Number(v[2] ?? 0)];
  if (v && typeof v === 'object') return [Number(v.x ?? 0), Number(v.y ?? 0), Number(v.z ?? 0)];
  return [0, 0, 0];
}

function arrToObj(a) {
  return { x: a[0], y: a[1], z: a[2] };
}

function vectorToArr(value, label) {
  const vector = Array.isArray(value) ? value : value?.position || value;
  const result = Array.isArray(vector)
    ? vector.slice(0, 3).map(Number)
    : [Number(vector?.x), Number(vector?.y), Number(vector?.z)];
  if (result.length !== 3 || !result.every(Number.isFinite)) {
    throw new TypeError(`CameraFlightPath: ${label} must resolve to finite x/y/z coordinates`);
  }
  return result;
}

function normalizeColliders(colliders) {
  if (colliders == null) return [];
  if (!Array.isArray(colliders)) {
    throw new TypeError('CameraFlightPath: colliders must be an array');
  }
  return colliders.map((collider, index) => {
    if (collider?.type === 'sphere') {
      const center = vectorToArr(collider.center, `colliders[${index}].center`);
      const radius = Number(collider.radius);
      if (!Number.isFinite(radius) || radius <= 0) {
        throw new TypeError(`CameraFlightPath: colliders[${index}].radius must be positive`);
      }
      return { type: 'sphere', center, radius };
    }
    if (collider?.type === 'box') {
      const min = vectorToArr(collider.min, `colliders[${index}].min`);
      const max = vectorToArr(collider.max, `colliders[${index}].max`);
      if (min.some((value, axis) => value >= max[axis])) {
        throw new TypeError(`CameraFlightPath: colliders[${index}] must have increasing box bounds`);
      }
      return { type: 'box', min, max };
    }
    throw new TypeError(`CameraFlightPath: colliders[${index}] must be a sphere or box`);
  });
}

function segmentSphereHit(start, end, center, radius) {
  const direction = end.map((value, axis) => value - start[axis]);
  const lengthSquared = direction.reduce((sum, value) => sum + value * value, 0);
  if (lengthSquared < 1e-12) return null;
  const offset = start.map((value, axis) => value - center[axis]);
  const radialMotion = offset.reduce((sum, value, axis) => sum + value * direction[axis], 0);
  const distanceSquared = offset.reduce((sum, value) => sum + value * value, 0);
  if (distanceSquared < radius * radius) {
    // An initially overlapping camera may escape, but not cross the body.
    return radialMotion >= 0 ? null : start;
  }
  if (radialMotion >= 0) return null;
  const discriminant = radialMotion * radialMotion - lengthSquared * (distanceSquared - radius * radius);
  if (discriminant <= 0) return null;
  const entry = (-radialMotion - Math.sqrt(discriminant)) / lengthSquared;
  if (entry < 0 || entry > 1) return null;
  const hit = Math.max(0, entry - 0.002 / Math.sqrt(lengthSquared));
  return start.map((value, axis) => value + direction[axis] * hit);
}

function segmentBoxHit(start, end, min, max, radius) {
  const direction = end.map((value, axis) => value - start[axis]);
  const lower = min.map((value) => value - radius);
  const upper = max.map((value) => value + radius);
  const inside = start.every((value, axis) => value >= lower[axis] && value <= upper[axis]);
  if (inside) {
    const depths = start.flatMap((value, axis) => [value - lower[axis], upper[axis] - value]);
    const nearestFace = Math.min(...depths);
    const escaping = direction.some((value, axis) =>
      (value < 0 && depths[axis * 2] <= nearestFace + 1e-12)
      || (value > 0 && depths[axis * 2 + 1] <= nearestFace + 1e-12));
    return escaping ? null : start;
  }
  let enter = 0;
  let leave = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) < 1e-12) {
      if (start[axis] < lower[axis] || start[axis] > upper[axis]) return null;
      continue;
    }
    const first = (lower[axis] - start[axis]) / direction[axis];
    const second = (upper[axis] - start[axis]) / direction[axis];
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
    if (enter > leave) return null;
  }
  if (enter < 0 || enter > 1) return null;
  const length = Math.hypot(...direction);
  const safeT = Math.max(0, enter - 0.002 / Math.max(length, 0.002));
  return start.map((value, axis) => value + direction[axis] * safeT);
}

function resolveTarget(target, fallback) {
  if (target == null) return fallback;
  const value = typeof target === 'function' ? target() : target;
  return vectorToArr(value, 'target');
}

// ---------------------------------------------------------------------------
// CameraFlightPath
// ---------------------------------------------------------------------------

const MAX_ROLL_RAD = (8 * Math.PI) / 180; // ±8°

class CameraFlightPath {
  constructor() {
    this._generation = 0;
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
    this._targetRef = null;
    this._colliders = [];
    this._collisionRadius = 0.25;

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
   * @param {object|Function}       [opts.target] live target point/provider
   * @param {Array<object>}         [opts.colliders] sphere/box obstacles
   * @param {number}                 [opts.collisionRadius=0.25] camera clearance
   * @returns {Promise<void>}        Resolves when flight completes (t === 1)
   */
  flyTo(from, to, durationMs, opts = {}) {
    const generation = this._generation;
    const setup = this._prepareFlight(from, to, durationMs, opts, 2500, { x: 0, y: 0, z: 0 });
    if (this._generation !== generation) return Promise.resolve();
    const { p0, p3 } = setup;

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

    return this._startFlight(setup, p1, p2, 'flyTo');
  }

  _prepareFlight(from, to, durationMs, opts, defaultDuration, defaultTarget) {
    if (!opts || typeof opts !== 'object') throw new TypeError('CameraFlightPath: options must be an object');
    const options = { ...opts };
    const target = options.target ?? options.targetObject ?? defaultTarget;
    const colliders = normalizeColliders(options.colliders);
    const collisionRadius = Number(options.collisionRadius ?? 0.25);
    if (!Number.isFinite(collisionRadius) || collisionRadius < 0) {
      throw new TypeError('CameraFlightPath: collisionRadius must be a non-negative number');
    }
    const duration = durationMs == null ? defaultDuration : Number(durationMs);
    if (!Number.isFinite(duration)) throw new TypeError('CameraFlightPath: duration must be finite');
    options.starBlur = Number(options.starBlur ?? 0.4);
    if (!Number.isFinite(options.starBlur)) throw new TypeError('CameraFlightPath: starBlur must be finite');
    const p0 = toArr(from);
    const p3 = toArr(to);
    if (![...p0, ...p3].every(Number.isFinite)) {
      throw new TypeError('CameraFlightPath: endpoints must have finite coordinates');
    }
    resolveTarget(target, p3);
    return { options, target, colliders, collisionRadius, duration: duration > 0 ? duration : defaultDuration, p0, p3 };
  }

  _startFlight(setup, p1, p2, method) {
    if (![...p1, ...p2].every(Number.isFinite)) {
      throw new TypeError('CameraFlightPath: path must have finite control points');
    }
    this._reject?.(new Error(`CameraFlightPath: new ${method} started`));
    ++this._generation;
    this._opts = setup.options;
    this._targetRef = setup.target;
    this._colliders = setup.colliders;
    this._collisionRadius = setup.collisionRadius;
    this._duration = setup.duration;
    this._elapsed = 0;
    this._t = 0;
    this._state = 'flying';
    this._onAtmosphereScale = method === 'flyTo' && typeof setup.options.onAtmosphereScale === 'function'
      ? setup.options.onAtmosphereScale : null;
    this._onStarBlur = method === 'flyTo' && typeof setup.options.onStarBlur === 'function'
      ? setup.options.onStarBlur : null;
    this._p0 = setup.p0;
    this._p1 = p1;
    this._p2 = p2;
    this._p3 = setup.p3;
    this._lastPos = setup.p0.slice();
    this._lastTarget = setup.p3.slice();
    this._lastRoll = 0;
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  /**
   * Per-frame update.  Must be called from the main render loop.
   *
   * @param {number} dt — finite non-negative delta; values <= 1 are seconds, otherwise milliseconds
   * @returns {{ position: {x,y,z}, target: {x,y,z}, roll: number, t: number }|null}
   *          Returns null when idle.
   */
  tick(dt) {
    return this._advance(dt);
  }

  _advance(dt, applyState) {
    if (this._state === 'idle') return null;
    const resolve = this._resolve;
    const reject = this._reject;
    try {
      if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
        throw new TypeError('CameraFlightPath: frame time must be a finite non-negative number');
      }
      const state = this._tick(dt, resolve);
      if (this._resolve !== resolve) return null;
      applyState?.(state, resolve);
      if (this._resolve !== resolve) return null;
      if (this._state === 'idle') this.dispose();
      return state;
    } catch (error) {
      if (this._reject === reject) {
        this._resolve = null;
        this.dispose();
        reject?.(error);
      }
      throw error;
    }
  }

  _tick(dt, resolve) {
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
      }
    } else {
      this._t = eased;
      if (raw >= 1) {
        this._t    = 1;
        this._state = 'idle';
      }
    }

    const desiredPosition = cubicBezier(this._p0, this._p1, this._p2, this._p3, this._t);
    const pos = this._resolveCameraPosition(desiredPosition);
    const target = resolveTarget(this._targetRef, this._p3);
    if (this._resolve !== resolve) return null;
    const tangent = cubicBezierTangent(this._p0, this._p1, this._p2, this._p3, Math.max(0.001, Math.min(0.999, this._t)));

    // Roll correlates with the horizontal (XZ) curvature angle of the tangent.
    const tangentAngle = Math.atan2(tangent[2], tangent[0]);
    const roll = Math.sin(tangentAngle) * MAX_ROLL_RAD * Math.sin(Math.PI * this._t);

    this._lastPos    = pos;
    this._lastTarget = target;
    this._lastRoll   = roll;

    // Side effects: atmosphere scale and star blur
    const atmoScale = lerp(0.95, 1.2, this._t);
    const starBlur  = lerp(0, Number(this._opts.starBlur ?? 0.4), Math.sin(Math.PI * this._t));

    if (typeof this._onAtmosphereScale === 'function') {
      this._onAtmosphereScale(atmoScale);
    }
    if (this._resolve !== resolve) return null;
    if (typeof this._onStarBlur === 'function') {
      this._onStarBlur(starBlur);
    }
    if (this._resolve !== resolve) return null;

    return {
      position: arrToObj(pos),
      target:   arrToObj(target),
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
   * @param {object|Function}       [opts.target] live target point/provider
   * @param {Array<object>}         [opts.colliders] sphere/box obstacles
   * @param {number}                 [opts.collisionRadius=0.25] camera clearance
   * @returns {Promise<void>}        Resolves when flight completes (t === 1)
   */
  flyToBuilding(from, to, durationMs, opts = {}) {
    const generation = this._generation;
    const setup = this._prepareFlight(from, to, durationMs, opts, 900, null);
    if (this._generation !== generation) return Promise.resolve();
    const { p0, p3 } = setup;

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

    return this._startFlight(setup, p1, p2, 'flyToBuilding');
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

  dispose() {
    ++this._generation;
    this._state = 'idle';
    const resolve = this._resolve;
    this._resolve = null;
    this._reject = null;
    this._opts = {};
    this._targetRef = null;
    this._colliders = [];
    this._onAtmosphereScale = null;
    this._onStarBlur = null;
    resolve?.();
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
   * Camera publication failures reject the flight before completion is committed.
   */
  update(ctx) {
    // dt not available in the driver context — use a fixed 16 ms step.
    this._advance(16, (state, resolve) => {
      if (!ctx) throw new TypeError('CameraFlightPath: driver context is required');
      const cam = ctx.camera || ctx;
      const position = cam?.position;
      if (this._resolve !== resolve) return;
      if (position && typeof position === 'object') {
        for (const axis of ['x', 'y', 'z']) {
          position[axis] = state.position[axis];
          if (this._resolve !== resolve) return;
        }
      }
      const controls = ctx.controls;
      if (this._resolve !== resolve) return;
      if (controls?.target && typeof controls.target.set === 'function') {
        controls.target.set(state.target.x, state.target.y, state.target.z);
        if (this._resolve !== resolve) return;
        controls.update?.();
      } else if (typeof cam?.lookAt === 'function') {
        cam.lookAt(state.target.x, state.target.y, state.target.z);
      }
    });
  }

  _resolveCameraPosition(position) {
    let resolved = position;
    const start = this._lastPos;
    const radius = this._collisionRadius;
    for (const collider of this._colliders) {
      const hit = collider.type === 'sphere'
        ? segmentSphereHit(start, resolved, collider.center, collider.radius + radius)
        : segmentBoxHit(start, resolved, collider.min, collider.max, radius);
      if (!hit) continue;
      const hitDistance = Math.hypot(...hit.map((value, axis) => value - start[axis]));
      const resolvedDistance = Math.hypot(...resolved.map((value, axis) => value - start[axis]));
      if (hitDistance < resolvedDistance) resolved = hit;
    }
    return resolved;
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
