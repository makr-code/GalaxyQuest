/**
 * CombatVfxBridge.js — Bridges resolved battle summaries to renderer weapon VFX.
 *
 * Listens for fleet lifecycle and resolved-battle events from two sources:
 *
 *   1. Window CustomEvents dispatched by the SSE handlers (legacy path):
 *      • gq:fleet-arrived           — fleet reached target
 *      • gq:fleet-incoming-attack   — enemy fleet inbound
 *      • gq:fleet-returning         — fleet returning home
 *      • gq:battle-resolved         — server-resolved round summary
 *
 *   2. Engine EventBus events (canonical path, preferred when an EventBus is
 *      available).  Register a bus via CombatVfxBridge.connectEventBus(bus).
 *      • sse:fleet_arrived
 *      • sse:incoming_attack
 *      • sse:fleet_returning
 *      • sse:battle_resolved
 *
 * Fleet lifecycle notifications are not rendered as weapon discharges. A
 * resolved battle summary schedules bounded round cues using its fleet/body IDs.
 * These cues visualize aggregate round pressure, not individual server shots.
 *
 * The renderer matches explicit source and target IDs where provided; missing
 * target identities do not authorize a substitute target.
 *
 * Registered in window.GQGalaxyEngineBridge under the key 'combat-vfx-bridge'.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum duration retained for manually requested battle FX. */
const BATTLE_DURATION_MS  = 8_000;

/** Interval in ms between manually requested weapon-fire pulses. */
const FIRE_INTERVAL_MS    = 380;
const ALERT_PULSES = 3;
const MAX_ACTIVE_BATTLES = 32;
const MAX_SEEN_EVENTS = 1024;
const EVENT_RETENTION_MS = 10 * 60 * 1000;

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
    this._alertTimers = new Set();
    this._seenEvents = new Map();
    this._seenPayloads = new WeakMap();
    this._destroyed = false;
    this._effectEpoch = 0;
    this._visualOptions = { reducedMotion: false, reducedFlashes: false };
    this._onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') this.stopAll();
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    this._onFleetArrived        = this._onFleetArrived.bind(this);
    this._onIncomingAttack      = this._onIncomingAttack.bind(this);
    this._onFleetReturning      = this._onFleetReturning.bind(this);
    this._onBattleResolved      = this._onBattleResolved.bind(this);

    window.addEventListener('gq:fleet-arrived',         this._onFleetArrived);
    window.addEventListener('gq:fleet-incoming-attack', this._onIncomingAttack);
    window.addEventListener('gq:fleet-returning',       this._onFleetReturning);
    window.addEventListener('gq:battle-resolved',       this._onBattleResolved);

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
      bus.on('sse:battle_resolved', (data) => this._onBattleResolved({ detail: data })),
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
      setVisualOptions: (options)                      => this.setVisualOptions(options),
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
    this._acceptEvent('fleet_arrived', data);
  }

  _onIncomingAttack(ev) {
    const data    = ev?.detail ?? {};
    const mission = String(data.mission || '').toLowerCase();
    if (mission === 'spy') return;
    this._acceptEvent('incoming_attack', data);
  }

  _onBattleResolved(ev) {
    const data = ev?.detail ?? {};
    if (!this._acceptEvent('battle_resolved', data) || this._reducedEffects()) return;

    const fleetId = this._normalizeEntityId(data.fleet_id);
    const targetPosition = this._normalizeSourcePosition(data.target_position);
    const role = String(data.role || '').toLowerCase();
    const rounds = Array.isArray(data.rounds) ? data.rounds.slice(0, 6) : [];
    if (!fleetId || !targetPosition || !['attacker', 'defender'].includes(role) || !rounds.length) return;

    this._alertTimers ||= new Set();
    const epoch = this._effectEpoch;
    rounds.forEach((round, index) => {
      if (this._alertTimers.size >= MAX_ACTIVE_BATTLES * 6) return;
      const pressureKey = role === 'attacker' ? 'attacker_pressure' : 'defender_pressure';
      if (!(Number(round?.[pressureKey]) > 0)) return;

      const timer = window.setTimeout(() => {
        this._alertTimers.delete(timer);
        if (this._destroyed || epoch !== this._effectEpoch || document.visibilityState === 'hidden') return;
        const attacking = role === 'attacker';
        this._dispatchWeaponFire({
          sourceType: attacking ? 'ship' : 'installation',
          sourceFleetId: attacking ? fleetId : null,
          targetFleetId: attacking ? null : fleetId,
          sourcePosition: targetPosition,
          targetSlotPosition: targetPosition,
          weaponKind: attacking ? 'laser' : 'beam',
          battleReportId: data.battle_report_id,
          round: Number(round.round) || index + 1,
          ts: Date.now(),
        });
      }, index * 520);
      this._alertTimers.add(timer);
    });
  }

  _onFleetReturning(ev) {
    const data    = ev?.detail ?? {};
    const mission = String(data.mission || '').toLowerCase();
    if (mission !== 'attack') return;
    if (!this._acceptEvent('fleet_returning', data)) return;
    if (data.fleet_id != null) {
      for (const [battleKey, battle] of this._activeBattles) {
        if (battle.fleetId === String(data.fleet_id)) this._stopBattleFx(battleKey);
      }
    }

    // End any active battle in the system the fleet just left
    const target = String(data.target || data.origin || '');
    if (!target) return;
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
   * Begin emitting diagnostic weapon-fire events for manual adapter requests.
   * Normal battle visuals are driven by battle_resolved events.
   * @param {string} attacker
   * @param {string} target
   * @param {number} durationMs
   * @param {number|null} sourcePosition
   * @param {object|null} context
   * @returns {string} battle key
   */
  _startBattleFx(attacker, target, durationMs = BATTLE_DURATION_MS, sourcePosition = null, context = null) {
    const key = this._battleKey(attacker, target);
    if (this._destroyed || document.visibilityState === 'hidden' || this._reducedEffects()) return key;
    this._stopBattleFx(key); // clear any prior battle for the same key
    if (this._activeBattles.size >= MAX_ACTIVE_BATTLES) {
      this._stopBattleFx(this._activeBattles.keys().next().value);
    }
    const duration = Number.isFinite(durationMs)
      ? Math.max(0, Math.min(BATTLE_DURATION_MS, durationMs)) : BATTLE_DURATION_MS;
    if (!duration) return key;

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
        sourceFleetId: sourceType === 'ship' ? context?.fleetId ?? null : null,
        targetFleetId: context?.targetFleetId ?? null,
        targetPos: context?.targetPos ?? null,
        sourcePosition,
        weaponKind,
        ts: Date.now(),
      });
      fireCount += 1;
    }, FIRE_INTERVAL_MS);

    const timeoutId = window.setTimeout(() => {
      this._stopBattleFx(key);
    }, duration);

    this._activeBattles.set(key, {
      interval: intervalId, timeout: timeoutId,
      fleetId: context?.fleetId == null ? null : String(context.fleetId),
    });
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
    this._effectEpoch = (this._effectEpoch || 0) + 1;
    for (const key of this._activeBattles.keys()) this._stopBattleFx(key);
    for (const timer of this._alertTimers || []) window.clearTimeout(timer);
    this._alertTimers?.clear();
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
   * @param {string|number|null} [payload.sourceFleetId] - Exact source fleet for ship fire
   * @param {string|number|null} [payload.targetFleetId] - Exact fleet target, when applicable
   * @param {number|null}  [payload.sourcePosition] - Optional system slot position hint for renderer-side narrowing
   * @param {string|null}  [payload.weaponKind]   - Weapon kind filter: beam|plasma|rail|missile|null
   * @param {number[]|null} [payload.targetPos] - Optional world-space target position
   * @param {number|null} [payload.targetSlotPosition] - Exact system-body slot target
   * @param {number}       [payload.ts]           - Timestamp (defaults to Date.now())
   */
  _dispatchWeaponFire(payload = {}) {
    if (this._destroyed || document.visibilityState === 'hidden') return;
    const detail = {
      sourceOwner:  payload.sourceOwner  ?? null,
      sourceType:   payload.sourceType   ?? null,
      sourceFleetId: this._normalizeEntityId(payload.sourceFleetId ?? payload.sourceEntityId),
      targetFleetId: this._normalizeEntityId(payload.targetFleetId ?? payload.targetEntityId),
      targetPos:     payload.targetPos ?? payload.target_pos ?? null,
      targetSlotPosition: this._normalizeSourcePosition(payload.targetSlotPosition),
      battleReportId: this._normalizeEntityId(payload.battleReportId),
      round: Number.isSafeInteger(Number(payload.round)) && Number(payload.round) > 0
        ? Number(payload.round)
        : null,
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

  _normalizeEntityId(value) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length > 256) return null;
    const id = String(value).trim();
    return id ? id : null;
  }

  setVisualOptions(options = {}) {
    this._visualOptions = {
      reducedMotion: options.reducedMotion === true,
      reducedFlashes: options.reducedFlashes === true,
    };
    if (this._reducedEffects()) this.stopAll();
  }

  _reducedEffects() {
    return this._visualOptions?.reducedMotion || this._visualOptions?.reducedFlashes
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }

  _acceptEvent(type, data) {
    if (this._destroyed) return false;
    this._seenEvents ||= new Map();
    this._seenPayloads ||= new WeakMap();
    const now = Date.now();
    for (const [key, expires] of this._seenEvents) {
      if (expires <= now) this._seenEvents.delete(key);
    }
    const explicit = data.event_id ?? data.eventId;
    const fleet = data.fleet_id;
    const id = explicit ?? fleet;
    if ((typeof id === 'string' && id.length > 0 && id.length <= 256)
      || (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0)) {
      const key = JSON.stringify([type, explicit != null ? 'event' : 'fleet', String(id)]);
      if (this._seenEvents.has(key)) return false;
      if (this._seenEvents.size >= MAX_SEEN_EVENTS) {
        this._seenEvents.delete(this._seenEvents.keys().next().value);
      }
      this._seenEvents.set(key, now + EVENT_RETENTION_MS);
    } else if (data && typeof data === 'object') {
      // Both runtime transports forward the same object; do not guess an identity
      // from owner/target and accidentally suppress distinct id-less battles.
      let stages = this._seenPayloads.get(data);
      if (stages?.has(type)) return false;
      if (!stages) this._seenPayloads.set(data, stages = new Set());
      stages.add(type);
    }
    return document.visibilityState !== 'hidden';
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
    if (this._destroyed) return;
    this._destroyed = true;
    this.stopAll();
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    this._seenEvents?.clear();
    this._seenPayloads = new WeakMap();
    window.removeEventListener('gq:fleet-arrived',         this._onFleetArrived);
    window.removeEventListener('gq:fleet-incoming-attack', this._onIncomingAttack);
    window.removeEventListener('gq:fleet-returning',       this._onFleetReturning);
    window.removeEventListener('gq:battle-resolved',       this._onBattleResolved);

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
