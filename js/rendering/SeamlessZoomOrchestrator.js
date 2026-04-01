/**
 * SeamlessZoomOrchestrator.js
 *
 * Top-level coordinator for the seamless zoom system.
 *
 * Responsibilities
 * ─────────────────
 *  • Owns the RendererRegistry and drives level transitions.
 *  • Selects the IGraphicsRenderer backend via RendererFactory.
 *  • Triggers CameraFlightPath for Level-2 (Planet-Approach) transitions.
 *  • Guards against concurrent transitions (double-zoomTo is a no-op while
 *    a transition is already in flight).
 *  • Exposes an event emitter for 'enterLevel', 'exitLevel', 'slotClick',
 *    and 'planetClick'.
 *
 * Zoom levels
 * ────────────
 *   ZOOM_LEVEL.GALAXY          (0)  distance 145–2400
 *   ZOOM_LEVEL.SYSTEM          (1)  distance  50–145
 *   ZOOM_LEVEL.PLANET_APPROACH (2)  distance  12–50   (Fly-in active)
 *   ZOOM_LEVEL.COLONY_SURFACE  (3)  distance   3–12
 *
 * Usage (game.js)
 * ───────────────
 *   import { SeamlessZoomOrchestrator, ZOOM_LEVEL } from './rendering/SeamlessZoomOrchestrator.js';
 *
 *   const orchestrator = new SeamlessZoomOrchestrator(canvas);
 *   orchestrator.register(ZOOM_LEVEL.GALAXY, { webgpu: GalaxyLevelWebGPU, threejs: GalaxyLevelThreeJS });
 *   // … register remaining levels …
 *   await orchestrator.initialize();
 *   orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Dependency resolution — works in both Node.js (CommonJS) and the browser.
// ---------------------------------------------------------------------------

let RendererRegistry, RendererFactory, CameraFlightPath;

if (typeof require !== 'undefined') {
  ({ RendererRegistry } = require('./RendererRegistry.js'));
  ({ RendererFactory }  = require('../engine/core/RendererFactory.js'));
  ({ CameraFlightPath } = require('./CameraFlightPath.js'));
} else {
  ({ RendererRegistry } = window.GQRendererRegistry   || {});
  RendererFactory       = window.GQRendererFactory;
  ({ CameraFlightPath } = window.GQCameraFlightPath   || {});
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Zoom-level constants.
 * @enum {number}
 */
const ZOOM_LEVEL = Object.freeze({
  GALAXY:          0,
  SYSTEM:          1,
  PLANET_APPROACH: 2,
  COLONY_SURFACE:  3,
  OBJECT_APPROACH: 4,
});

/**
 * Target-object types for the OBJECT_APPROACH zoom level.
 * Pass `{ targetType: ApproachTargetType.FLEET, target: fleetObj }` as the
 * zoomTo() payload when entering ZOOM_LEVEL.OBJECT_APPROACH.
 *
 * @enum {string}
 */
const ApproachTargetType = Object.freeze({
  FLEET:                       'FLEET',
  VESSEL:                      'VESSEL',
  VAGABOND:                    'VAGABOND',
  SOLAR_INSTALLATION_SHIPYARD: 'SOLAR_INSTALLATION_SHIPYARD',
  SOLAR_INSTALLATION_STARGATE: 'SOLAR_INSTALLATION_STARGATE',
});

// ---------------------------------------------------------------------------
// SeamlessZoomOrchestrator
// ---------------------------------------------------------------------------

class SeamlessZoomOrchestrator {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object}            [opts]
   * @param {Function}          [opts.onEnterLevel]
   * @param {Function}          [opts.onExitLevel]
   * @param {Function}          [opts.onSlotClick]
   * @param {Function}          [opts.onPlanetClick]
   * @param {'webgpu'|'webgl2'|'auto'} [opts.rendererHint='auto']
   */
  constructor(canvas, opts = {}) {
    this._canvas     = canvas;
    this._opts       = opts || {};
    this._registry   = new RendererRegistry();
    this._backend    = null;   // IGraphicsRenderer — set after initialize()
    this._flight     = new CameraFlightPath();
    this._active     = null;   // currently active IZoomLevelRenderer
    this._activeLevel = null;
    this._transition = false;  // guard flag

    /** @type {Map<string, Function[]>} */
    this._listeners  = new Map();

    // Wire legacy opts callbacks as event listeners.
    if (typeof opts.onEnterLevel  === 'function') this.on('enterLevel',  opts.onEnterLevel);
    if (typeof opts.onExitLevel   === 'function') this.on('exitLevel',   opts.onExitLevel);
    if (typeof opts.onSlotClick   === 'function') this.on('slotClick',   opts.onSlotClick);
    if (typeof opts.onPlanetClick === 'function') this.on('planetClick', opts.onPlanetClick);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Detect the GPU backend.  Must be called once before zoomTo().
   * In test environments a mock backend can be injected via opts._backend.
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._opts._backend) {
      // Allow test injection without touching RendererFactory.
      this._backend = this._opts._backend;
      return;
    }
    this._backend = await RendererFactory.create(
      this._canvas,
      { hint: this._opts.rendererHint || 'auto' },
    );
  }

  // ── Registry delegation ───────────────────────────────────────────────────

  /**
   * Register a pair of renderer classes for a zoom level.
   *
   * @param {number} level
   * @param {{ webgpu: Function, threejs: Function }} classes
   */
  register(level, classes) {
    this._registry.register(level, classes);
  }

  // ── Main API ──────────────────────────────────────────────────────────────

  /**
   * Transition to the given zoom level.
   *
   * Calling zoomTo() while a transition is already in progress is silently
   * ignored (the guard flag this._transition ensures only one transition runs
   * at a time).
   *
   * @param {number} level
   * @param {*}      [payload]   — e.g. { planet, colony, star } or
   *                               { targetType: ApproachTargetType.FLEET, target: fleetObj }
   * @param {object} [opts]
   * @param {THREE.Vector3|{x,y,z}} [opts.cameraFrom]  required for Level-2 / Level-4
   * @param {THREE.Vector3|{x,y,z}} [opts.cameraTo]    required for Level-2 / Level-4
   * @param {number}                [opts.flyDuration]  default 2500 ms
   * @returns {Promise<void>}
   */
  async zoomTo(level, payload, opts = {}) {
    if (this._transition) return;
    this._transition = true;

    try {
      const next = this._registry.resolve(level, this._backend);

      // Initialise the renderer on first use if it hasn't been already.
      if (!next._initialised) {
        await next.initialize(this._canvas, this._backend);
        next._initialised = true;
      }

      // Exit old level.
      if (this._active) {
        await this._active.exit(level);
        this._emit('exitLevel', this._activeLevel);
      }

      // Planet-Approach or Object-Approach: trigger the Bezier fly-in before
      // entering the level.
      if (SeamlessZoomOrchestrator._requiresCameraFlight(level)) {
        const from = opts.cameraFrom || { x: 0, y: 0, z: 100 };
        const to   = opts.cameraTo   || { x: 0, y: 0, z: 15 };
        const dur  = opts.flyDuration != null ? opts.flyDuration : 2500;
        await this._flight.flyTo(from, to, dur, {
          starBlur: 0.4,
          onAtmosphereScale: opts.onAtmosphereScale || null,
          onStarBlur:        opts.onStarBlur        || null,
        });
      }

      // Enter new level.
      await next.enter(this._activeLevel, payload);

      this._active      = next;
      this._activeLevel = level;
      this._emit('enterLevel', level, payload);
    } finally {
      this._transition = false;
    }
  }

  /**
   * Main render loop — call this every animation frame.
   *
   * @param {number} dt — delta time in seconds (or ms — CameraFlightPath
   *                       accepts both)
   */
  tick(dt) {
    // Fly-in in progress: use interpolated camera state.
    const flightState = this._flight.tick(dt);
    const cs = flightState || this._getFallbackCameraState();
    if (this._active) {
      this._active.render(dt, cs);
    }
  }

  // ── Event emitter ─────────────────────────────────────────────────────────

  /**
   * @param {'enterLevel'|'exitLevel'|'slotClick'|'planetClick'} event
   * @param {Function} fn
   */
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return this;
  }

  /** Remove a listener. */
  off(event, fn) {
    const arr = this._listeners.get(event);
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    }
    return this;
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  dispose() {
    if (this._active) {
      try { this._active.dispose(); } catch (_) {}
      this._active = null;
    }
    this._registry.clear();
    this._listeners.clear();
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  _emit(event, ...args) {
    const arr = this._listeners.get(event);
    if (!arr) return;
    for (const fn of arr) {
      try { fn(...args); } catch (_) {}
    }
  }

  /** Minimal fallback camera state when no flight is active. */
  _getFallbackCameraState() {
    return { position: { x: 0, y: 0, z: 500 }, target: { x: 0, y: 0, z: 0 }, roll: 0, t: 0 };
  }

  /**
   * Returns true for zoom levels that require a Bezier camera fly-in
   * animation before the level renderer receives `enter()`.
   *
   * Centralising this check in a single helper makes it easy to add or
   * remove levels from the fly-in list without touching the main zoomTo() body.
   *
   * @param {number} level
   * @returns {boolean}
   */
  static _requiresCameraFlight(level) {
    return level === ZOOM_LEVEL.PLANET_APPROACH || level === ZOOM_LEVEL.OBJECT_APPROACH;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SeamlessZoomOrchestrator, ZOOM_LEVEL, ApproachTargetType };
} else {
  window.GQSeamlessZoomOrchestrator = { SeamlessZoomOrchestrator, ZOOM_LEVEL, ApproachTargetType };
}
