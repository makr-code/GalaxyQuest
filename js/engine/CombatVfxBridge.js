/**
 * CombatVfxBridge.js — Event producer that bridges fleet & combat game events
 * to the renderer's installation weapon-fire VFX pipeline.
 *
 * Listens for fleet lifecycle events from two sources (in parallel):
 *
 *   1. Window CustomEvents dispatched by the SSE handlers (legacy path):
 *      • gq:fleet-arrived           — fleet reached target
 *      • gq:fleet-incoming-attack   — enemy fleet inbound
 *      • gq:fleet-returning         — fleet returning home
 *
 *   2. Engine EventBus events (canonical path, preferred when an EventBus is
 *      available).  Register a bus via CombatVfxBridge.connectEventBus(bus).
 *      • sse:fleet_arrived
 *      • sse:incoming_attack
 *      • sse:fleet_returning
 *
 * When a combat situation is detected, produces a time-windowed burst of
 *   gq:combat:weapon-fire  CustomEvents consumed by Galaxy3DRenderer.
 *
 * The renderer matches events by sourceOwner / sourceType / weaponKind — any
 * null field matches all entries in the current system.  A broadcast payload
 * (all nulls) fires every installation weapon in the currently viewed system,
 * which is what we want for system-level battles.
 *
 * Registered in window.GQGalaxyEngineBridge under the key 'combat-vfx-bridge'.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration in ms that weapon-fire events are emitted after a fleet_arrived attack. */
const BATTLE_DURATION_MS  = 8_000;

/** Interval in ms between individual weapon-fire event pulses during a battle. */
const FIRE_INTERVAL_MS    = 380;

/** Number of initial warning pulses dispatched on incoming_attack (pre-arrival alert). */
const ALERT_PULSES        = 3;

/** Delay between alert pulses in ms. */
const ALERT_PULSE_DELAY   = 260;

// ---------------------------------------------------------------------------
// CombatVfxBridge
// ---------------------------------------------------------------------------

class CombatVfxBridge {
  constructor() {
    /**
     * Ongoing battle timers keyed by a unique battle string (e.g. "attacker→target").
     * @type {Map<string, { interval: number, timeout: number }>}
     */
    this._activeBattles = new Map();

    this._onFleetArrived        = this._onFleetArrived.bind(this);
    this._onIncomingAttack      = this._onIncomingAttack.bind(this);
    this._onFleetReturning      = this._onFleetReturning.bind(this);

    window.addEventListener('gq:fleet-arrived',         this._onFleetArrived);
    window.addEventListener('gq:fleet-incoming-attack', this._onIncomingAttack);
    window.addEventListener('gq:fleet-returning',       this._onFleetReturning);

    /** @type {Array<Function>} EventBus unsubscribe callbacks */
    this._busUnsubs = [];

    this._registerBridgeAdapter();
  }

  // ---------------------------------------------------------------------------
  // EventBus integration (canonical path)
  // ---------------------------------------------------------------------------

  /**
   * Wire this bridge to an engine-level EventBus so that canonical
   * `sse:*` events are handled in addition to window CustomEvents.
   *
   * Calling this method more than once replaces the previous subscription.
   *
   * @param {import('./EventBus').EventBus} bus
   */
  connectEventBus(bus) {
    // Clean up any previous bus subscriptions.
    this._busUnsubs.forEach((off) => off());
    this._busUnsubs = [];

    if (!bus || typeof bus.on !== 'function') return;

    this._busUnsubs.push(
      bus.on('sse:fleet_arrived',   (data) => this._onFleetArrived({ detail: data })),
      bus.on('sse:incoming_attack', (data) => this._onIncomingAttack({ detail: data })),
      bus.on('sse:fleet_returning', (data) => this._onFleetReturning({ detail: data })),
    );
  }

  // ---------------------------------------------------------------------------
  // Bridge adapter
  // ---------------------------------------------------------------------------

  _registerBridgeAdapter() {
    const bridge = window.GQGalaxyEngineBridge;
    if (!bridge || typeof bridge.registerAdapter !== 'function') return;
    bridge.registerAdapter('combat-vfx-bridge', {
      startBattleFx:  (attacker, target, durationMs) => this._startBattleFx(attacker, target, durationMs),
      stopBattleFx:   (key)                           => this._stopBattleFx(key),
      dispatchWpnFire:(payload)                        => this._dispatchWeaponFire(payload),
    });
  }

  // ---------------------------------------------------------------------------
  // Incoming event handlers
  // ---------------------------------------------------------------------------

  _onFleetArrived(ev) {
    const data    = ev?.detail ?? {};
    const mission = String(data.mission || '').toLowerCase();
    if (mission !== 'attack' && mission !== 'spy') return;

    const attacker = String(data.attacker || data.owner || '');
    const target   = String(data.target   || '');
    const sourcePosition = this._deriveSourcePosition(data, ['targetPosition', 'target_position', 'position']);

    if (mission === 'attack') {
      // Immediate opening salvo then sustained fire window
      // Installations ($target system) fire defensively
      this._dispatchWeaponFire({
        sourceOwner: null,
        sourceType: 'installation',
        sourcePosition,
        weaponKind: null,
        ts: Date.now(),
      });
      this._startBattleFx(attacker, target, BATTLE_DURATION_MS, sourcePosition);
    } else {
      // Spy: one silent pulse (no visible weapon FX needed, but emit for any interest)
      this._dispatchWeaponFire({
        sourceOwner: null,
        sourceType: 'installation',
        sourcePosition,
        weaponKind: 'beam',
        ts: Date.now(),
      });
    }
  }

  _onIncomingAttack(ev) {
    const data    = ev?.detail ?? {};
    const mission = String(data.mission || '').toLowerCase();
    // Raise alert-level weapon FX on defender installations (pre-battle warning)
    if (mission === 'spy') return;   // spy → no visible weapons
    const sourcePosition = this._deriveSourcePosition(data, ['targetPosition', 'target_position', 'position']);

    let sent = 0;
    const dispatchPulse = () => {
      if (sent >= ALERT_PULSES) return;
      this._dispatchWeaponFire({
        sourceOwner: null,
        sourceType: 'installation',
        sourcePosition,
        weaponKind: null,
        ts: Date.now(),
      });
      sent += 1;
      window.setTimeout(dispatchPulse, ALERT_PULSE_DELAY);
    };
    dispatchPulse();
  }

  _onFleetReturning(ev) {
    const data    = ev?.detail ?? {};
    const mission = String(data.mission || '').toLowerCase();
    if (mission !== 'attack') return;

    // End any active battle in the system the fleet just left
    const target = String(data.target || data.origin || '');
    const key    = this._battleKey('', target);
    this._stopBattleFx(key);

    // Stop any attacker-named battles too (legacy key format)
    for (const k of this._activeBattles.keys()) {
      if (k.endsWith(`→${target}`)) this._stopBattleFx(k);
    }
  }

  // ---------------------------------------------------------------------------
  // Battle FX management
  // ---------------------------------------------------------------------------

  /**
   * Begin emitting weapon-fire events at FIRE_INTERVAL_MS for durationMs.
   * Alternates between installation and ship weapon fire for visual variety.
   * @param {string} attacker
   * @param {string} target
   * @param {number} durationMs
   * @param {number|null} sourcePosition
   * @returns {string} battle key
   */
  _startBattleFx(attacker, target, durationMs = BATTLE_DURATION_MS, sourcePosition = null) {
    const key = this._battleKey(attacker, target);
    this._stopBattleFx(key); // clear any prior battle for the same key

    let fireCount = 0;
    const intervalId = window.setInterval(() => {
      // Alternate between installation and ship weapon fire (Phase 2 multi-entity)
      const sourceType = (fireCount % 3 < 2) ? 'installation' : 'ship';
      const weaponKind = ['laser', 'beam', 'missile'][fireCount % 3];
      
      this._dispatchWeaponFire({
        sourceOwner: null,
        sourceType,
        sourcePosition,
        weaponKind,
        ts: Date.now(),
      });
      fireCount += 1;
    }, FIRE_INTERVAL_MS);

    const timeoutId = window.setTimeout(() => {
      this._stopBattleFx(key);
    }, durationMs);

    this._activeBattles.set(key, { interval: intervalId, timeout: timeoutId });
    return key;
  }

  /**
   * Stop the weapon-fire loop for a given battle key.
   * @param {string} key
   */
  _stopBattleFx(key) {
    const entry = this._activeBattles.get(key);
    if (!entry) return;
    window.clearInterval(entry.interval);
    window.clearTimeout(entry.timeout);
    this._activeBattles.delete(key);
  }

  /** Stop all active battle FX loops. */
  stopAll() {
    for (const key of this._activeBattles.keys()) this._stopBattleFx(key);
  }

  // ---------------------------------------------------------------------------
  // Event dispatch helpers
  // ---------------------------------------------------------------------------

  /**
   * Dispatch a gq:combat:weapon-fire CustomEvent on window.
   * Renderer's Galaxy3DRenderer._bindCombatEventHooks() picks this up.
   *
   * @param {object} payload
   * @param {string|null}  [payload.sourceOwner]  - Owner name filter (null = all)
   * @param {string|null}  [payload.sourceType]   - Entity type filter: installation|ship|debris|wormhole|beacon|gate (null = all)
   * @param {number|null}  [payload.sourcePosition] - Optional system slot position hint for renderer-side narrowing
   * @param {string|null}  [payload.weaponKind]   - Weapon kind filter: beam|plasma|rail|missile|null
   * @param {number}       [payload.ts]           - Timestamp (defaults to Date.now())
   */
  _dispatchWeaponFire(payload = {}) {
    const detail = {
      sourceOwner:  payload.sourceOwner  ?? null,
      sourceType:   payload.sourceType   ?? null,
      sourcePosition: this._normalizeSourcePosition(payload.sourcePosition),
      weaponKind:   payload.weaponKind   ?? null,
      ts:           payload.ts           ?? Date.now(),
    };
    window.dispatchEvent(new CustomEvent('gq:combat:weapon-fire', { detail }));
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _battleKey(attacker, target) {
    return `${attacker}→${target}`;
  }

  _normalizeSourcePosition(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  _deriveSourcePosition(data, preferredKeys = []) {
    const payload = data && typeof data === 'object' ? data : {};
    const keys = [
      ...preferredKeys,
      'sourcePosition',
      'source_position',
      'targetPosition',
      'target_position',
      'originPosition',
      'origin_position',
      'position',
      'planet_position',
      'slot_position',
    ];

    for (const key of keys) {
      const normalized = this._normalizeSourcePosition(payload[key]);
      if (normalized != null) return normalized;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy() {
    this.stopAll();
    window.removeEventListener('gq:fleet-arrived',         this._onFleetArrived);
    window.removeEventListener('gq:fleet-incoming-attack', this._onIncomingAttack);
    window.removeEventListener('gq:fleet-returning',       this._onFleetReturning);

    this._busUnsubs.forEach((off) => off());
    this._busUnsubs = [];

    const bridge = window.GQGalaxyEngineBridge;
    if (bridge && typeof bridge.unregisterAdapter === 'function') {
      bridge.unregisterAdapter('combat-vfx-bridge');
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton boot
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.GQCombatVfxBridge = new CombatVfxBridge();
}

// ---------------------------------------------------------------------------
// Export (CommonJS test shim)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CombatVfxBridge, BATTLE_DURATION_MS, FIRE_INTERVAL_MS, ALERT_PULSES };
}
