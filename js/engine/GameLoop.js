/**
 * GameLoop.js
 *
 * RAF-based game loop with:
 *   - Fixed-step physics accumulator (decoupled from render rate)
 *   - Variable render interpolation factor (alpha)
 *   - Configurable max-frame-time clamping (spiral-of-death prevention)
 *   - pause / resume / stop lifecycle
 *
 * Pattern inspired by:
 *   - "Fix Your Timestep!" (Glenn Fiedler, 2004) — fixed-update accumulator
 *   - Babylon.js RunLoop (Apache 2.0) — RAF lifecycle management
 *     https://github.com/BabylonJS/Babylon.js
 *
 * Usage:
 *   const loop = new GameLoop({
 *     fixedStep:  1/60,           // 60 Hz physics
 *     maxDt:      0.25,           // clamp spiral-of-death at 250 ms
 *     onFixedUpdate: (dt)  => physics.step(dt),
 *     onUpdate:      (dt, alpha) => scene.update(alpha),
 *     onRender:      (alpha)     => renderer.render(scene, camera),
 *   });
 *   loop.start();
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class GameLoop {
  /**
   * @param {Object}   opts
   * @param {number}   [opts.fixedStep=1/60]     Physics fixed step in seconds
   * @param {number}   [opts.maxDt=0.25]         Max frame time — prevents spiral of death
   * @param {Function} [opts.onFixedUpdate]       Called once per physics step — (dtSeconds)
   * @param {Function} [opts.onUpdate]            Called once per render frame — (dtSeconds, alpha)
   * @param {Function} [opts.onRender]            Called once per render frame — (alpha)
   * @param {Function} [opts.onPanic]             Called when loop falls behind — ()
   */
  constructor(opts = {}) {
    this.fixedStep  = opts.fixedStep  ?? (1 / 60);
    this.maxDt      = opts.maxDt      ?? 0.25;

    this._onFixedUpdate = opts.onFixedUpdate ?? null;
    this._onUpdate      = opts.onUpdate      ?? null;
    this._onRender      = opts.onRender      ?? null;
    this._onPanic       = opts.onPanic       ?? null;

    this._accumulator   = 0;
    this._previousTs    = null;
    this._rafId         = null;
    this._running       = false;
    this._paused        = false;

    /** Publicly readable frame stats */
    this.frame          = 0;
    this.totalTimeS     = 0;
    this.lastDt         = 0;
    this.alpha          = 0;      // interpolation factor in [0, 1)
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start the loop.  No-op if already running. */
  start() {
    if (this._running) return;
    this._running     = true;
    this._paused      = false;
    this._previousTs  = null;
    this._accumulator = 0;
    this._rafId = _requestFrame(this._tick.bind(this));
  }

  /** Pause rendering.  Physics accumulator is frozen.  resume() continues. */
  pause() {
    if (!this._running || this._paused) return;
    this._paused    = true;
    this._previousTs = null;    // reset so resume doesn't process a huge dt
    if (this._rafId !== null) {
      _cancelFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Resume after pause(). */
  resume() {
    if (!this._running || !this._paused) return;
    this._paused = false;
    this._rafId  = _requestFrame(this._tick.bind(this));
  }

  /** Stop the loop permanently.  Call start() to restart. */
  stop() {
    this._running = false;
    this._paused  = false;
    if (this._rafId !== null) {
      _cancelFrame(this._rafId);
      this._rafId = null;
    }
  }

  get running() { return this._running && !this._paused; }
  get paused()  { return this._paused; }

  // ---------------------------------------------------------------------------
  // Internal tick
  // ---------------------------------------------------------------------------

  _tick(tsMs) {
    if (!this._running || this._paused) return;

    // Schedule next frame first so a throw in update doesn't kill the loop
    this._rafId = _requestFrame(this._tick.bind(this));

    // --- Timestamp delta ---
    const nowS = tsMs / 1000;
    if (this._previousTs === null) {
      this._previousTs = nowS;
      return;   // skip first tick to establish baseline
    }

    let dt = nowS - this._previousTs;
    this._previousTs = nowS;

    // Clamp to prevent spiral of death
    if (dt > this.maxDt) {
      dt = this.maxDt;
      if (typeof this._onPanic === 'function') this._onPanic();
    }

    this.lastDt      = dt;
    this.totalTimeS += dt;
    this.frame++;

    // --- Fixed physics steps ---
    this._accumulator += dt;
    while (this._accumulator >= this.fixedStep) {
      if (typeof this._onFixedUpdate === 'function') {
        this._onFixedUpdate(this.fixedStep);
      }
      this._accumulator -= this.fixedStep;
    }

    // Alpha = remaining fraction — for visual interpolation
    this.alpha = this._accumulator / this.fixedStep;

    // --- Variable update (animations, camera, UI) ---
    if (typeof this._onUpdate === 'function') {
      this._onUpdate(dt, this.alpha);
    }

    // --- Render ---
    if (typeof this._onRender === 'function') {
      this._onRender(this.alpha);
    }
  }
}

// ---------------------------------------------------------------------------
// Platform abstraction — works in browser (RAF) and Node.js test env (setImmediate/setTimeout)
// ---------------------------------------------------------------------------

function _requestFrame(fn) {
  if (typeof requestAnimationFrame !== 'undefined') {
    return requestAnimationFrame(fn);
  }
  // Node.js / test fallback — fires asynchronously like RAF
  return setTimeout(() => fn(performance.now()), 0);
}

function _cancelFrame(id) {
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(id);
  } else {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GameLoop };
} else {
  window.GQGameLoop = GameLoop;
}
