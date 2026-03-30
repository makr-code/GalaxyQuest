/**
 * EventSystem.js  — Game Event & Choice System
 *
 * Inspired by:
 *   Stellaris      (Paradox, 2016) — narrative event framework with choices
 *   Victoria 3     (Paradox, 2022) — journal entries + political events
 *   Endless Space 2 (Amplitude, 2017) — fleet encounter cards
 *
 * Provides:
 *   - A library of typed game events (anomaly, political, trade, fleet, random)
 *   - Each event has a weight, conditions (guard function), and 1–4 choices
 *   - Each choice has effects (callbacks) applied to the game state
 *   - An EventQueue fires pending events once per in-game turn / cycle
 *   - Journal entries: long-running objectives (Victoria 3 style)
 *   - EventBus integration: emits 'game:event:fired', 'game:event:resolved',
 *     'game:event:dismissed', 'game:journal:complete'
 *
 * Usage:
 *   const evtSys = new EventSystem(engine.events);
 *
 *   evtSys.define({
 *     id:      'anomaly.derelict_ship',
 *     type:    EventType.ANOMALY,
 *     title:   'Derelict Vessel Detected',
 *     body:    'Your science ship has found a drifting hulk…',
 *     weight:  10,
 *     condition: (gs) => gs.scienceShips > 0,
 *     choices: [
 *       { label: 'Salvage',  effect: (gs) => { gs.credits += 500; } },
 *       { label: 'Ignore',   effect: () => {} },
 *     ],
 *   });
 *
 *   evtSys.schedule('anomaly.derelict_ship');   // queue immediately
 *   evtSys.tick(gameState);   // call each in-game cycle
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** @enum {string} */
const EventType = Object.freeze({
  ANOMALY:   'anomaly',    // Exploration anomaly (Stellaris)
  POLITICAL: 'political',  // Internal politics (Victoria 3)
  TRADE:     'trade',      // Trade route event
  FLEET:     'fleet',      // Fleet encounter (Endless Space)
  COLONY:    'colony',     // Colony milestone / disaster (Master of Orion)
  RANDOM:    'random',     // Generic scripted random event
  RESEARCH:  'research',   // Technology breakthrough
  SCRIPTED:  'scripted',   // Manually triggered (story beat)
});

/** @enum {string} */
const EventStatus = Object.freeze({
  PENDING:   'pending',
  ACTIVE:    'active',    // Presented to player — awaiting choice
  RESOLVED:  'resolved',
  EXPIRED:   'expired',
  DISMISSED: 'dismissed', // Player dismissed without resolving
});

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

/**
 * A Journal entry tracks a long-running in-game objective (Victoria 3 style).
 * It becomes 'complete' when its condition returns true during tickJournal().
 *
 * @typedef {Object} JournalDef
 * @property {string}   id
 * @property {string}   [title]
 * @property {string}   [body]
 * @property {Function} condition      (gameState) => boolean — completion test
 * @property {Function} [onComplete]   (gameState) => void   — called on completion
 */

/** @enum {string} */
const JournalStatus = Object.freeze({
  ACTIVE:   'active',
  COMPLETE: 'complete',
});

class Journal {
  /**
   * @param {JournalDef} def
   */
  constructor(def) {
    if (!def.id)        throw new TypeError('[Journal] Entry must have an id');
    if (!def.condition) throw new TypeError(`[Journal] Entry '${def.id}' must have a condition`);
    this.id         = def.id;
    this.title      = def.title     ?? def.id;
    this.body       = def.body      ?? '';
    this.condition  = def.condition;
    this.onComplete = def.onComplete ?? null;
    this.status     = JournalStatus.ACTIVE;
  }

  /** @returns {boolean} */
  get isComplete() { return this.status === JournalStatus.COMPLETE; }
}

// ---------------------------------------------------------------------------
// EventSystem
// ---------------------------------------------------------------------------

class EventSystem {
  /**
   * @param {import('../EventBus').EventBus} [bus]  Engine event bus for notifications
   */
  constructor(bus) {
    this._bus     = bus ?? null;
    /** @type {Map<string, EventDefinition>} */
    this._library = new Map();
    /** @type {EventInstance[]} */
    this._queue   = [];
    /** @type {EventInstance[]} */
    this._active  = [];
    /** @type {EventInstance[]} */
    this._history = [];

    /** @type {Map<string, Journal>} */
    this._journal = new Map();

    /** Max events shown simultaneously (like Stellaris event cap) */
    this.maxActive = 3;
    /** Probability of a random event firing per tick (0–1) */
    this.randomEventChance = 0.05;
  }

  // ---------------------------------------------------------------------------
  // Library
  // ---------------------------------------------------------------------------

  /**
   * Register an event definition.
   * @param {EventDefinition} def
   */
  define(def) {
    if (!def.id)      throw new TypeError('[EventSystem] Event must have an id');
    if (!def.choices?.length) throw new TypeError(`[EventSystem] Event '${def.id}' must have at least one choice`);
    this._library.set(def.id, {
      type:      def.type      ?? EventType.RANDOM,
      title:     def.title     ?? def.id,
      body:      def.body      ?? '',
      weight:    def.weight    ?? 10,
      condition: def.condition ?? null,
      choices:   def.choices,
      cooldown:  def.cooldown  ?? 0,
      _lastFired: -Infinity,
      ...def,
    });
    return this;
  }

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  /**
   * Queue a specific event by id for firing on the next tick.
   * @param {string} id
   * @param {Object} [context]  Extra data attached to the instance
   */
  schedule(id, context = {}) {
    const def = this._library.get(id);
    if (!def) { console.warn(`[EventSystem] Unknown event: '${id}'`); return this; }
    this._queue.push({ id, def, status: EventStatus.PENDING, context, choice: null });
    return this;
  }

  /**
   * Evaluate all events eligible for random firing against gameState and
   * promote pending events to ACTIVE status.
   *
   * @param {Object} gameState  Arbitrary game-state object passed to conditions + effects
   * @param {number} [cycle=0]  Current game cycle (for cooldown tracking)
   */
  tick(gameState, cycle = 0) {
    // Maybe fire a random event
    if (Math.random() < this.randomEventChance) {
      this._tryFireRandom(gameState, cycle);
    }

    // Promote queued events up to maxActive
    while (this._active.length < this.maxActive && this._queue.length > 0) {
      const inst = this._queue.shift();
      if (inst.def.condition && !inst.def.condition(gameState)) {
        inst.status = EventStatus.EXPIRED;
        this._history.push(inst);
        continue;
      }
      inst.status = EventStatus.ACTIVE;
      this._active.push(inst);
      this._bus?.emit('game:event:fired', { event: inst });
    }
  }

  /**
   * Resolve an active event by choosing an option.
   *
   * @param {string} id          Event instance id
   * @param {number} choiceIndex 0-based index into def.choices
   * @param {Object} gameState
   */
  resolve(id, choiceIndex, gameState) {
    const idx  = this._active.findIndex((e) => e.id === id);
    if (idx === -1) { console.warn(`[EventSystem] No active event: '${id}'`); return; }

    const inst   = this._active[idx];
    const choice = inst.def.choices[choiceIndex];
    if (!choice) { console.warn(`[EventSystem] Invalid choice index ${choiceIndex} for '${id}'`); return; }

    inst.choice = choiceIndex;
    inst.status = EventStatus.RESOLVED;
    inst.def._lastFired = Date.now();

    try {
      choice.effect?.(gameState, inst.context);
    } catch (err) {
      console.error(`[EventSystem] Error in choice effect for '${id}':`, err);
    }

    this._active.splice(idx, 1);
    this._history.push(inst);
    this._bus?.emit('game:event:resolved', { event: inst, choiceIndex });
  }

  /**
   * Dismiss an active event without applying any choice effect.
   * The event is moved to history with status DISMISSED.
   * Emits 'game:event:dismissed'.
   *
   * @param {string} id  Event id
   */
  dismiss(id) {
    const idx = this._active.findIndex((e) => e.id === id);
    if (idx === -1) { console.warn(`[EventSystem] No active event to dismiss: '${id}'`); return; }
    const inst   = this._active[idx];
    inst.status  = EventStatus.DISMISSED;
    this._active.splice(idx, 1);
    this._history.push(inst);
    this._bus?.emit('game:event:dismissed', { event: inst });
  }

  /**
   * Publicly trigger the random-event selection logic once.
   * Useful for testing or scripted event injection.
   *
   * @param {Object} gameState
   * @param {number} [cycle=0]
   */
  fireRandom(gameState, cycle = 0) {
    this._tryFireRandom(gameState, cycle);
  }

  // ---------------------------------------------------------------------------
  // Journal
  // ---------------------------------------------------------------------------

  /**
   * Register a journal entry.  Throws if id is missing or condition is absent.
   * @param {JournalDef} def
   * @returns {this}
   */
  defineJournalEntry(def) {
    const entry = new Journal(def);
    this._journal.set(def.id, entry);
    return this;
  }

  /**
   * Evaluate all active journal entries against the current game state.
   * Entries whose condition returns true are marked complete; their onComplete
   * callback is invoked and 'game:journal:complete' is emitted.
   *
   * @param {Object} gameState
   */
  tickJournal(gameState) {
    for (const entry of this._journal.values()) {
      if (entry.status === JournalStatus.COMPLETE) continue;
      let met = false;
      try { met = entry.condition(gameState); } catch (err) {
        console.warn(`[EventSystem] Error evaluating journal condition for '${entry.id}':`, err);
      }
      if (!met) continue;
      entry.status = JournalStatus.COMPLETE;
      try { entry.onComplete?.(gameState); } catch (err) {
        console.error(`[EventSystem] Error in journal onComplete for '${entry.id}':`, err);
      }
      this._bus?.emit('game:journal:complete', { entry });
    }
  }

  /**
   * Return all journal entries that have not yet been completed.
   * @returns {Journal[]}
   */
  activeJournal() {
    return [...this._journal.values()].filter((e) => !e.isComplete);
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Currently presented events (awaiting player choice) */
  get activeEvents() { return [...this._active]; }

  /** Full event history (resolved + expired + dismissed) */
  get history() { return [...this._history]; }

  /** Number of events in the library */
  get librarySize() { return this._library.size; }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _tryFireRandom(gameState, cycle) {
    const candidates = [];
    for (const def of this._library.values()) {
      if (def.type === EventType.SCRIPTED) continue;
      if ((cycle - def._lastFired) < def.cooldown) continue;
      if (def.condition && !def.condition(gameState)) continue;
      for (let w = 0; w < def.weight; w++) candidates.push(def.id);
    }
    if (candidates.length === 0) return;
    const id = candidates[Math.floor(Math.random() * candidates.length)];
    this.schedule(id);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EventSystem, EventType, EventStatus, Journal, JournalStatus };
} else {
  window.GQEventSystem = { EventSystem, EventType, EventStatus, Journal, JournalStatus };
}
