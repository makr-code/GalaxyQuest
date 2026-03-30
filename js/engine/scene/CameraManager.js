/**
 * CameraManager.js
 *
 * Registry for multiple named cameras — primary + any number of follow cameras.
 *
 * Features:
 *   - Named camera registry (add / remove / getByName)
 *   - One "active" primary camera (used for main render)
 *   - Per-camera follow-target binding (ships, bases, planets, colonies)
 *   - Ordered update of all cameras every frame
 *
 * Usage:
 *   const cameras = new CameraManager(mainCamera);
 *
 *   cameras.add('fleet-alpha', new FollowCamera({ name: 'Fleet α' }));
 *   cameras.setFollowTarget('fleet-alpha', myFleetShip, { mode: FollowMode.ORBIT });
 *
 *   cameras.add('colony-ignis', new FollowCamera({ name: 'Colony Ignis' }));
 *   cameras.setFollowTarget('colony-ignis', colonialPlanet, { distance: 500, lag: 0.9 });
 *
 *   // In update loop:
 *   cameras.update(dt);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { FollowCamera } = typeof require !== 'undefined'
  ? require('./FollowCamera.js')
  : window.GQFollowCamera;

// ---------------------------------------------------------------------------
// CameraEntry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CameraEntry
 * @property {string}         name
 * @property {import('./Camera').Camera} camera
 * @property {boolean}        enabled
 * @property {string|null}    targetId   Identifier of the follow target (informational)
 */

// ---------------------------------------------------------------------------
// CameraManager
// ---------------------------------------------------------------------------

class CameraManager {
  /**
   * @param {import('./Camera').Camera} primaryCamera  The main scene camera (already owned by GameEngine)
   */
  constructor(primaryCamera) {
    /** @type {Map<string, CameraEntry>} */
    this._cameras = new Map();

    // Register the primary camera under the reserved name 'main'
    if (primaryCamera) {
      this._cameras.set('main', {
        name:     'main',
        camera:   primaryCamera,
        enabled:  true,
        targetId: null,
      });
    }

    /** Name of the active primary camera — used for the main viewport */
    this.activeName = 'main';
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a camera under a unique name.
   * If a camera with the same name already exists it is replaced.
   *
   * @param {string}                     name
   * @param {import('./Camera').Camera}  camera
   * @param {Object}  [opts]
   * @param {boolean} [opts.enabled=true]
   * @param {string}  [opts.targetId]   Optional label for the follow target
   */
  add(name, camera, opts = {}) {
    if (name === 'main' && this._cameras.has('main')) {
      console.warn('[CameraManager] "main" is reserved; use the primaryCamera constructor argument to replace it.');
      return this;
    }
    this._cameras.set(name, {
      name,
      camera,
      enabled:  opts.enabled  !== false,
      targetId: opts.targetId ?? null,
    });
    return this;
  }

  /**
   * Remove a camera by name.  Cannot remove 'main'.
   * @param {string} name
   */
  remove(name) {
    if (name === 'main') { console.warn('[CameraManager] Cannot remove "main" camera.'); return this; }
    this._cameras.delete(name);
    if (this.activeName === name) this.activeName = 'main';
    return this;
  }

  // ---------------------------------------------------------------------------
  // Follow-target binding
  // ---------------------------------------------------------------------------

  /**
   * Bind a follow target to a named camera.
   * The camera must be a FollowCamera instance (or any camera with a setTarget() method).
   *
   * @param {string} name          Camera name
   * @param {{ position: {x,y,z} }} target  Any game object with a .position property
   * @param {Object} [opts]        Forwarded to FollowCamera#setTarget()
   */
  setFollowTarget(name, target, opts = {}) {
    const entry = this._cameras.get(name);
    if (!entry) {
      console.warn(`[CameraManager] Unknown camera: '${name}'`);
      return this;
    }
    if (typeof entry.camera.setTarget !== 'function') {
      console.warn(`[CameraManager] Camera '${name}' does not support follow targets. Use FollowCamera.`);
      return this;
    }
    entry.camera.setTarget(target, opts);
    entry.targetId = target?.id ?? target?.name ?? String(target);
    return this;
  }

  /**
   * Remove the follow target from a named camera.
   * @param {string} name
   */
  clearFollowTarget(name) {
    const entry = this._cameras.get(name);
    entry?.camera?.clearTarget?.();
    if (entry) entry.targetId = null;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Activation
  // ---------------------------------------------------------------------------

  /**
   * Set the active primary camera (used for the main viewport render).
   * @param {string} name
   */
  setActive(name) {
    if (!this._cameras.has(name)) {
      console.warn(`[CameraManager] Cannot activate unknown camera: '${name}'`);
      return this;
    }
    this.activeName = name;
    return this;
  }

  /**
   * Enable / disable a camera.
   * Disabled cameras are not updated and not rendered in PiP viewports.
   * @param {string}  name
   * @param {boolean} enabled
   */
  setEnabled(name, enabled) {
    const entry = this._cameras.get(name);
    if (entry) entry.enabled = enabled;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /**
   * @returns {import('./Camera').Camera|undefined}
   */
  get(name) { return this._cameras.get(name)?.camera; }

  /** The currently active primary camera. */
  get active() { return this._cameras.get(this.activeName)?.camera ?? null; }

  /** All enabled cameras except 'main' — used to render PiP viewports. */
  get secondaryCameras() {
    const result = [];
    for (const [name, entry] of this._cameras) {
      if (name !== 'main' && entry.enabled) result.push({ name, camera: entry.camera, targetId: entry.targetId });
    }
    return result;
  }

  /** @returns {boolean} */
  has(name) { return this._cameras.has(name); }

  /** @returns {number} Total number of registered cameras (incl. main) */
  get count() { return this._cameras.size; }

  /** Names of all registered cameras in insertion order. */
  names() { return [...this._cameras.keys()]; }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * Update all enabled cameras.  Call once per frame, before rendering.
   * @param {number} dt  Delta time in seconds
   */
  update(dt = 0) {
    for (const entry of this._cameras.values()) {
      if (entry.enabled) {
        entry.camera.update?.(dt);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose() {
    this._cameras.clear();
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CameraManager };
} else {
  window.GQCameraManager = CameraManager;
}
