/**
 * EventBus.js
 *
 * Lightweight synchronous Pub/Sub event bus.
 *
 * Used for decoupled communication between engine subsystems and game code.
 * Supports typed events, one-shot listeners, wildcards, and priority ordering.
 *
 * Usage:
 *   const bus = new EventBus();
 *   const off = bus.on('physics:step', ({ dt }) => { ... });
 *   bus.emit('physics:step', { dt: 0.016 });
 *   off();  // unsubscribe
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class EventBus {
  constructor() {
    /** @type {Map<string, Array<{fn: Function, once: boolean, priority: number}>>} */
    this._listeners = new Map();
    /** @type {boolean} Enable verbose logging via GQLog */
    this.debug = false;
  }

  // ---------------------------------------------------------------------------
  // Subscribe
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to an event.
   *
   * @param {string}   event     Event name (e.g. 'engine:start', 'physics:step')
   * @param {Function} fn        Listener callback — receives the payload object
   * @param {Object}   [opts]
   * @param {boolean}  [opts.once=false]   Auto-unsubscribe after first fire
   * @param {number}   [opts.priority=0]   Higher priority fires first
   * @returns {Function}  Unsubscribe function
   */
  on(event, fn, opts = {}) {
    if (typeof fn !== 'function') throw new TypeError('[EventBus] listener must be a function');
    const entry = { fn, once: opts.once === true, priority: opts.priority ?? 0 };
    const list  = this._listeners.get(event) ?? [];
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority);
    this._listeners.set(event, list);

    // Return unsubscribe
    return () => this.off(event, fn);
  }

  /**
   * Subscribe once — auto-removed after first fire.
   * @param {string}   event
   * @param {Function} fn
   * @returns {Function} Unsubscribe
   */
  once(event, fn) {
    return this.on(event, fn, { once: true });
  }

  /**
   * Unsubscribe a specific listener.
   * @param {string}   event
   * @param {Function} fn
   */
  off(event, fn) {
    const list = this._listeners.get(event);
    if (!list) return;
    const filtered = list.filter((e) => e.fn !== fn);
    if (filtered.length === 0) {
      this._listeners.delete(event);
    } else {
      this._listeners.set(event, filtered);
    }
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  /**
   * Emit an event synchronously to all subscribers.
   *
   * @param {string} event    Event name
   * @param {*}      [payload]  Data passed to every listener
   */
  emit(event, payload) {
    if (this.debug) {
      (typeof window !== 'undefined' && window.GQLog?.info || console.debug)(
        `[EventBus] emit '${event}'`, payload
      );
    }

    const list = this._listeners.get(event);
    if (!list || list.length === 0) return;

    // Iterate over a shallow copy so on/off inside handlers is safe
    const snapshot = list.slice();
    const toRemove = [];

    for (const entry of snapshot) {
      try {
        entry.fn(payload);
      } catch (err) {
        console.error(`[EventBus] Error in listener for '${event}':`, err);
      }
      if (entry.once) toRemove.push(entry.fn);
    }

    for (const fn of toRemove) this.off(event, fn);
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /** Remove all listeners for an event, or all listeners if no event given. */
  clear(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  /** @returns {number} Total number of registered listeners across all events */
  get listenerCount() {
    let n = 0;
    for (const list of this._listeners.values()) n += list.length;
    return n;
  }
}

// ---------------------------------------------------------------------------
// Shared engine-wide singleton — modules can import the same bus instance
// ---------------------------------------------------------------------------

const sharedBus = new EventBus();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EventBus, sharedBus };
} else {
  window.GQEventBus = { EventBus, sharedBus };
}
