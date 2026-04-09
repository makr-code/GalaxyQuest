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

/**
 * Mission-aware battle pulse profiles used by _battlePulseProfile().
 * Keeping this data centralized allows balance tuning without touching logic.
 */
const BATTLE_PULSE_PROFILES = Object.freeze({
  attack: Object.freeze({
    sourcePattern: Object.freeze(['installation', 'ship', 'ship']),
    weaponPattern: Object.freeze(['laser', 'beam', 'missile', 'rail']),
  }),
  spy: Object.freeze({
    sourcePattern: Object.freeze(['installation']),
    weaponPattern: Object.freeze(['beam']),
  }),
  default: Object.freeze({
    sourcePattern: Object.freeze(['installation', 'installation', 'ship']),
    weaponPattern: Object.freeze(['laser', 'beam', 'missile']),
  }),
});

/**
 * Optional QA presets to switch pulse behavior quickly at runtime.
 * Presets are partial mission-profile maps applied as overrides.
 */
const BATTLE_PULSE_PROFILE_PRESETS = Object.freeze({
  balanced: Object.freeze({
    attack: Object.freeze({
      sourcePattern: Object.freeze(['installation', 'ship', 'ship']),
      weaponPattern: Object.freeze(['laser', 'beam', 'missile', 'rail']),
    }),
    spy: Object.freeze({
      sourcePattern: Object.freeze(['installation']),
      weaponPattern: Object.freeze(['beam']),
    }),
  }),
  siege: Object.freeze({
    attack: Object.freeze({
      sourcePattern: Object.freeze(['installation', 'installation', 'ship']),
      weaponPattern: Object.freeze(['missile', 'rail', 'beam']),
    }),
    default: Object.freeze({
      sourcePattern: Object.freeze(['installation', 'installation', 'ship']),
      weaponPattern: Object.freeze(['beam', 'missile', 'rail']),
    }),
  }),
  skirmish: Object.freeze({
    attack: Object.freeze({
      sourcePattern: Object.freeze(['ship', 'ship', 'installation']),
      weaponPattern: Object.freeze(['beam', 'rail', 'laser']),
    }),
    default: Object.freeze({
      sourcePattern: Object.freeze(['ship', 'installation', 'ship']),
      weaponPattern: Object.freeze(['laser', 'beam', 'rail']),
    }),
  }),
});

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

    /** @type {{[mission: string]: {sourcePattern: string[], weaponPattern: string[]}}} */
    this._battlePulseProfiles = this._cloneBattlePulseProfiles(BATTLE_PULSE_PROFILES);

    this._registerBridgeAdapter();
    this._registerDebugApi();
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
      setBattlePulseProfiles: (profiles)               => this.configureBattlePulseProfiles(profiles),
      resetBattlePulseProfiles: ()                     => this.resetBattlePulseProfiles(),
      getBattlePulseProfiles: ()                       => this._cloneBattlePulseProfiles(this._battlePulseProfiles),
      applyBattlePulsePreset: (presetName)             => this.applyBattlePulsePreset(presetName),
      listBattlePulsePresets: ()                       => this.getBattlePulsePresetNames(),
    });
  }

  _registerDebugApi() {
    if (typeof window === 'undefined') return;

    this._prevDebugApi = window.GQCombatVfxDebug;

    const previous = this._prevDebugApi && typeof this._prevDebugApi === 'object'
      ? this._prevDebugApi
      : {};

    window.GQCombatVfxDebug = {
      ...previous,
      getBattlePulseProfiles: () => this._cloneBattlePulseProfiles(this._battlePulseProfiles),
      setBattlePulseProfiles: (profiles) => this.configureBattlePulseProfiles(profiles),
      resetBattlePulseProfiles: () => this.resetBattlePulseProfiles(),
      applyBattlePulsePreset: (presetName) => this.applyBattlePulsePreset(presetName),
      listBattlePulsePresets: () => this.getBattlePulsePresetNames(),
    };
  }

  _unregisterDebugApi() {
    if (typeof window === 'undefined') return;

    if (typeof this._prevDebugApi === 'undefined') {
      delete window.GQCombatVfxDebug;
      return;
    }

    window.GQCombatVfxDebug = this._prevDebugApi;
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
      this._startBattleFx(attacker, target, BATTLE_DURATION_MS, sourcePosition, {
        mission,
        attacker,
        target,
      });
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
   * @param {object|null} context
   * @returns {string} battle key
   */
  _startBattleFx(attacker, target, durationMs = BATTLE_DURATION_MS, sourcePosition = null, context = null) {
    const key = this._battleKey(attacker, target);
    this._stopBattleFx(key); // clear any prior battle for the same key

    const profile = this._battlePulseProfile(context);
    const sourcePattern = Array.isArray(profile?.sourcePattern) && profile.sourcePattern.length
      ? profile.sourcePattern
      : ['installation', 'installation', 'ship'];
    const weaponPattern = Array.isArray(profile?.weaponPattern) && profile.weaponPattern.length
      ? profile.weaponPattern
      : ['laser', 'beam', 'missile'];

    let fireCount = 0;
    const intervalId = window.setInterval(() => {
      // Mission-aware pulse profile keeps visuals coherent with battle context.
      const sourceType = String(sourcePattern[fireCount % sourcePattern.length] || 'installation');
      const weaponKind = String(weaponPattern[fireCount % weaponPattern.length] || 'beam');
      
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

  _battlePulseProfile(context = null) {
    const mission = String(context?.mission || '').toLowerCase();
    const profiles = this._battlePulseProfiles || BATTLE_PULSE_PROFILES;
    return profiles[mission] || profiles.default || BATTLE_PULSE_PROFILES.default;
  }

  _sanitizePulsePattern(rawPattern, fallback) {
    const normalized = Array.isArray(rawPattern)
      ? rawPattern
        .map((v) => String(v || '').trim().toLowerCase())
        .filter((v) => !!v)
      : [];
    return normalized.length ? normalized : [...fallback];
  }

  _normalizePulseProfile(rawProfile = {}, fallbackProfile = null) {
    const fallback = fallbackProfile || BATTLE_PULSE_PROFILES.default;
    return {
      sourcePattern: this._sanitizePulsePattern(rawProfile?.sourcePattern, fallback.sourcePattern),
      weaponPattern: this._sanitizePulsePattern(rawProfile?.weaponPattern, fallback.weaponPattern),
    };
  }

  _cloneBattlePulseProfiles(sourceProfiles) {
    const source = sourceProfiles && typeof sourceProfiles === 'object'
      ? sourceProfiles
      : BATTLE_PULSE_PROFILES;

    const baseDefault = this._normalizePulseProfile(source.default, BATTLE_PULSE_PROFILES.default);
    const result = { default: baseDefault };

    Object.keys(source).forEach((mission) => {
      if (mission === 'default') return;
      result[mission] = this._normalizePulseProfile(source[mission], baseDefault);
    });

    return result;
  }

  configureBattlePulseProfiles(overrides = null) {
    const next = this._cloneBattlePulseProfiles(this._battlePulseProfiles || BATTLE_PULSE_PROFILES);
    if (!overrides || typeof overrides !== 'object') {
      this._battlePulseProfiles = next;
      return this._cloneBattlePulseProfiles(next);
    }

    const fallbackDefault = next.default || BATTLE_PULSE_PROFILES.default;

    Object.keys(overrides).forEach((mission) => {
      const missionKey = String(mission || '').trim().toLowerCase();
      if (!missionKey) return;
      const rawProfile = overrides[mission];
      if (!rawProfile || typeof rawProfile !== 'object') return;
      next[missionKey] = this._normalizePulseProfile(rawProfile, fallbackDefault);
    });

    if (!next.default) {
      next.default = this._normalizePulseProfile(null, BATTLE_PULSE_PROFILES.default);
    }

    this._battlePulseProfiles = next;
    return this._cloneBattlePulseProfiles(next);
  }

  resetBattlePulseProfiles() {
    this._battlePulseProfiles = this._cloneBattlePulseProfiles(BATTLE_PULSE_PROFILES);
    return this._cloneBattlePulseProfiles(this._battlePulseProfiles);
  }

  getBattlePulsePresetNames() {
    return Object.keys(BATTLE_PULSE_PROFILE_PRESETS);
  }

  applyBattlePulsePreset(presetName) {
    const key = String(presetName || '').trim().toLowerCase();
    const preset = BATTLE_PULSE_PROFILE_PRESETS[key];
    if (!preset) {
      return this._cloneBattlePulseProfiles(this._battlePulseProfiles);
    }
    return this.configureBattlePulseProfiles(preset);
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

    this._unregisterDebugApi();
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
