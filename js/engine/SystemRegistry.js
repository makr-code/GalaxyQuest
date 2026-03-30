/**
 * SystemRegistry.js
 *
 * Ordered game-system update pipeline.
 *
 * A "System" is any object with at minimum an `update(dt, engine)` method.
 * Systems are executed each frame in ascending priority order.
 *
 * Built-in system categories (priority slots):
 *
 *   0    Input handling
 *   100  Physics (CPU / GPU)
 *   200  AI / NPC behaviour
 *   300  Animation / Tweens
 *   400  Camera follow
 *   500  Scene graph update
 *   600  Render
 *   700  Post-processing / UI
 *   900  Cleanup / deferred destroy
 *
 * Usage:
 *   const reg = new SystemRegistry();
 *   reg.add({ name: 'physics', priority: 100, update(dt, engine) { ... } });
 *   reg.update(dt, engine);   // called by GameEngine each frame
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** @enum {number} Recommended priority slots */
const SystemPriority = Object.freeze({
  INPUT:        0,
  PHYSICS:    100,
  AI:         200,
  ANIMATION:  300,
  CAMERA:     400,
  SCENE:      500,
  RENDER:     600,
  POSTFX:     700,
  CLEANUP:    900,
});

class SystemRegistry {
  constructor() {
    /** @type {Array<{name:string, priority:number, enabled:boolean, update:Function, onAdd?:Function, onRemove?:Function}>} */
    this._systems = [];
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Add a system.  Inserting a system with an existing name replaces it.
   *
   * @param {Object} system
   * @param {string}   system.name      Unique identifier
   * @param {number}   [system.priority=500]
   * @param {boolean}  [system.enabled=true]
   * @param {Function} system.update    (dtSeconds, engine) => void
   * @param {Function} [system.onAdd]   Called immediately after registration
   * @param {Function} [system.onRemove] Called when removed
   */
  add(system) {
    if (typeof system.update !== 'function') {
      throw new TypeError(`[SystemRegistry] System '${system.name}' must have an update() method`);
    }

    // Replace existing system with same name
    this.remove(system.name);

    const entry = {
      name:     system.name     ?? `system_${this._systems.length}`,
      priority: system.priority ?? SystemPriority.SCENE,
      enabled:  system.enabled  !== false,
      update:   system.update.bind(system),
      onAdd:    system.onAdd    ? system.onAdd.bind(system)    : null,
      onRemove: system.onRemove ? system.onRemove.bind(system) : null,
      _ref:     system,
    };

    this._systems.push(entry);
    this._sort();

    entry.onAdd?.();
    return this;
  }

  /**
   * Remove a system by name.
   * @param {string} name
   */
  remove(name) {
    const idx = this._systems.findIndex((s) => s.name === name);
    if (idx !== -1) {
      const entry = this._systems[idx];
      entry.onRemove?.();
      this._systems.splice(idx, 1);
    }
    return this;
  }

  /** Enable / disable a system by name without removing it. */
  setEnabled(name, enabled) {
    const entry = this._systems.find((s) => s.name === name);
    if (entry) entry.enabled = enabled;
    return this;
  }

  /** @returns {boolean} Whether a system with this name is registered */
  has(name) {
    return this._systems.some((s) => s.name === name);
  }

  // ---------------------------------------------------------------------------
  // Update pipeline
  // ---------------------------------------------------------------------------

  /**
   * Run all enabled systems in priority order.
   * @param {number} dt       Delta time in seconds
   * @param {Object} engine   GameEngine instance (passed to every system)
   */
  update(dt, engine) {
    for (const entry of this._systems) {
      if (!entry.enabled) continue;
      try {
        entry.update(dt, engine);
      } catch (err) {
        console.error(`[SystemRegistry] Error in system '${entry.name}':`, err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /** Returns a copy of the systems array (ordered). */
  list() {
    return this._systems.map(({ name, priority, enabled }) => ({ name, priority, enabled }));
  }

  get count() { return this._systems.length; }

  _sort() {
    this._systems.sort((a, b) => a.priority - b.priority);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SystemRegistry, SystemPriority };
} else {
  window.GQSystemRegistry = { SystemRegistry, SystemPriority };
}
