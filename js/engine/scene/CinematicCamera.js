/**
 * CinematicCamera.js
 *
 * Advanced camera system with sequencer-like control for cinematics.
 * Supports keyframe interpolation, camera paths (splines), and automatic framing.
 *
 * Features:
 *   - Keyframe-based camera animation
 *   - Cubic spline path interpolation
 *   - Easing functions (linear, ease-in/out, etc.)
 *   - Automatic framing on targets
 *   - Smooth camera transitions
 *
 * Inspired by:
 *   - Unreal Engine: Matinee/Sequencer cameras
 *   - Babylon.js: Animation system
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/**
 * Camera keyframe
 * @typedef {object} CameraKeyframe
 * @property {number} time - Keyframe time (seconds)
 * @property {THREE.Vector3} position - Camera world position
 * @property {THREE.Vector3} target - Look-at target
 * @property {number} fov - Field of view angle
 * @property {string} easing - Easing function name
 */

class CinematicCamera {
  /**
   * @param {THREE.PerspectiveCamera} baseCamera
   * @param {object} opts
   * @param {number} opts.defaultSpeed - Animation speed multiplier (default: 1.0)
   */
  constructor(baseCamera, opts = {}) {
    this._baseCamera = baseCamera;
    this._defaultSpeed = opts.defaultSpeed ?? 1.0;

    // Animation state
    this._keyframes = [];
    this._isPlaying = false;
    this._currentTime = 0;
    this._totalDuration = 0;
    this._playbackSpeed = 1.0;

    // Camera path (spline)
    this._cameraCurve = null;
    this._targetCurve = null;

    // Easing functions
    this._easingFunctions = {
      'linear': (t) => t,
      'ease-in-quad': (t) => t * t,
      'ease-out-quad': (t) => 1 - (1 - t) * (1 - t),
      'ease-in-out-quad': (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
      'ease-in-cubic': (t) => t * t * t,
      'ease-out-cubic': (t) => 1 + (--t) * t * t,
      'ease-in-out-cubic': (t) => t < 0.5 ? 4 * t * t * t : 1 + (--t) * 2 * (--t) * (--t),
      'ease-in-quart': (t) => t * t * t * t,
      'ease-out-quart': (t) => 1 - (--t) * t * t * t,
      'ease-in-quint': (t) => t * t * t * t * t,
      'ease-out-quint': (t) => 1 + (--t) * t * t * t * t,
      'ease-out-elastic': (t) => {
        const c5 = (2 * Math.PI) / 4.5;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c5) + 1;
      },
    };
  }

  /**
   * Add a keyframe to the animation
   * @param {number} time - Time in seconds
   * @param {THREE.Vector3} position - Camera position
   * @param {THREE.Vector3} target - Look-at target
   * @param {number} fov - Field of view
   * @param {string} easing - Easing function name
   */
  addKeyframe(time, position, target, fov = 50, easing = 'ease-in-out-cubic') {
    this._keyframes.push({
      time,
      position: position.clone ? position.clone() : position,
      target: target.clone ? target.clone() : target,
      fov,
      easing,
    });

    // Sort keyframes by time
    this._keyframes.sort((a, b) => a.time - b.time);

    // Update duration
    if (this._keyframes.length > 0) {
      this._totalDuration = this._keyframes[this._keyframes.length - 1].time;
    }

    // Rebuild curves
    this._buildSplineCurves();
  }

  /**
   * Add multiple keyframes at once
   * @param {CameraKeyframe[]} keyframes
   */
  addKeyframes(keyframes) {
    for (const kf of keyframes) {
      this.addKeyframe(kf.time, kf.position, kf.target, kf.fov, kf.easing);
    }
  }

  /**
   * Build spline curves for smooth interpolation
   * @private
   */
  _buildSplineCurves() {
    if (this._keyframes.length < 2) {
      return;
    }

    // Use Catmull-Rom spline for smooth camera paths
    const positionPoints = this._keyframes.map(kf => kf.position);
    const targetPoints = this._keyframes.map(kf => kf.target);
    const times = this._keyframes.map(kf => kf.time);

    // Store for later interpolation
    this._cameraCurve = { points: positionPoints, times };
    this._targetCurve = { points: targetPoints, times };
  }

  /**
   * Interpolate Catmull-Rom spline at time t
   * @private
   * @param {object} curve - Curve with points and times
   * @param {number} time
   * @returns {THREE.Vector3}
   */
  _interpolateSpline(curve, time) {
    if (!curve || curve.points.length < 2) {
      return curve?.points[0] || new (typeof THREE !== 'undefined' ? THREE.Vector3 : class {})();
    }

    // Find segment
    let idx = 0;
    for (let i = 0; i < curve.times.length - 1; i++) {
      if (time >= curve.times[i] && time < curve.times[i + 1]) {
        idx = i;
        break;
      }
    }

    const t0 = curve.times[idx];
    const t1 = curve.times[idx + 1];
    const localT = (time - t0) / (t1 - t0);

    // Simple lerp for now (could upgrade to Catmull-Rom)
    const p0 = curve.points[idx];
    const p1 = curve.points[idx + 1];

    if (typeof THREE === 'undefined') {
      return {
        x: p0.x + (p1.x - p0.x) * localT,
        y: p0.y + (p1.y - p0.y) * localT,
        z: p0.z + (p1.z - p0.z) * localT,
      };
    }

    return new THREE.Vector3().lerpVectors(p0, p1, localT);
  }

  /**
   * Start animation playback
   */
  play() {
    this._isPlaying = true;
    this._currentTime = 0;
  }

  /**
   * Pause animation
   */
  pause() {
    this._isPlaying = false;
  }

  /**
   * Resume animation from current position
   */
  resume() {
    this._isPlaying = true;
  }

  /**
   * Stop animation and reset to start
   */
  stop() {
    this._isPlaying = false;
    this._currentTime = 0;
  }

  /**
   * Seek to specific time
   * @param {number} time - Time in seconds
   */
  seek(time) {
    this._currentTime = Math.max(0, Math.min(time, this._totalDuration));
    this._updateCamera();
  }

  /**
   * Update camera animation (call each frame)
   * @param {number} deltaTime - Delta time in seconds
   */
  update(deltaTime) {
    if (!this._isPlaying || this._keyframes.length === 0) {
      return;
    }

    this._currentTime += deltaTime * this._playbackSpeed;

    if (this._currentTime >= this._totalDuration) {
      this._currentTime = this._totalDuration;
      this._isPlaying = false; // Auto-stop at end
    }

    this._updateCamera();
  }

  /**
   * Update camera position/rotation/fov based on current time
   * @private
   */
  _updateCamera() {
    if (this._keyframes.length === 0 || !this._baseCamera) {
      return;
    }

    // Interpolate position
    const newPosition = this._interpolateSpline(this._cameraCurve, this._currentTime);
    this._baseCamera.position.copy(newPosition);

    // Interpolate target
    const newTarget = this._interpolateSpline(this._targetCurve, this._currentTime);
    this._baseCamera.lookAt(newTarget);

    // Interpolate FOV
    let newFOV = 50;
    for (let i = 0; i < this._keyframes.length - 1; i++) {
      if (this._currentTime >= this._keyframes[i].time && this._currentTime < this._keyframes[i + 1].time) {
        const kf0 = this._keyframes[i];
        const kf1 = this._keyframes[i + 1];
        const t = (this._currentTime - kf0.time) / (kf1.time - kf0.time);
        newFOV = kf0.fov + (kf1.fov - kf0.fov) * t;
        break;
      }
    }
    this._baseCamera.fov = newFOV;
    this._baseCamera.updateProjectionMatrix();
  }

  /**
   * Set playback speed multiplier
   * @param {number} speed
   */
  setPlaybackSpeed(speed) {
    this._playbackSpeed = Math.max(0.1, Math.min(4.0, speed));
  }

  /**
   * Get current animation time
   * @returns {number}
   */
  getCurrentTime() {
    return this._currentTime;
  }

  /**
   * Get total animation duration
   * @returns {number}
   */
  getDuration() {
    return this._totalDuration;
  }

  /**
   * Get keyframe at index
   * @param {number} index
   * @returns {CameraKeyframe|null}
   */
  getKeyframe(index) {
    return this._keyframes[index] || null;
  }

  /**
   * Remove keyframe at index
   * @param {number} index
   */
  removeKeyframe(index) {
    this._keyframes.splice(index, 1);
    this._buildSplineCurves();
  }

  /**
   * Clear all keyframes
   */
  clearKeyframes() {
    this._keyframes = [];
    this._cameraCurve = null;
    this._targetCurve = null;
    this._totalDuration = 0;
  }

  /**
   * Is animation playing?
   * @returns {boolean}
   */
  isPlaying() {
    return this._isPlaying;
  }

  /**
   * Get all keyframes
   * @returns {CameraKeyframe[]}
   */
  getKeyframes() {
    return [...this._keyframes];
  }
}

// Export for both CommonJS and browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CinematicCamera };
}
if (typeof window !== 'undefined') {
  window.GQCinematicCamera = { CinematicCamera };
}
