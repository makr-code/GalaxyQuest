/**
 * runtime-realtime-sync.test.js
 *
 * Tests for the EventBus integration in RuntimeRealtimeSync.js.
 *
 * Verifies that every SSE event handler emits the corresponding canonical
 * `sse:*` event on the engine EventBus (in addition to the window CustomEvent)
 * when an `eventBus` is configured.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(fileURLToPath(import.meta.url), '../../..');

const modulePath = path.join(root, 'js/engine/runtime/RuntimeRealtimeSync.js');

// ── Synthetic EventSource ─────────────────────────────────────────────────────

class FakeEventSource {
  constructor() {
    this._handlers = {};
    this.onerror = null;
  }

  addEventListener(type, handler) {
    this._handlers[type] = handler;
  }

  emit(type, data) {
    const handler = this._handlers[type];
    if (handler) handler({ data: JSON.stringify(data) });
  }

  async emitAsync(type, data) {
    const handler = this._handlers[type];
    if (handler) await handler({ data: JSON.stringify(data) });
  }

  close() {}
}

// ── Mock EventBus ─────────────────────────────────────────────────────────────

function makeMockBus() {
  return { emit: vi.fn() };
}

// ── Module loader (fresh per test) ────────────────────────────────────────────

function loadAndSetup(extraOpts = {}) {
  delete window.GQRuntimeRealtimeSync;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  const mod = window.GQRuntimeRealtimeSync;

  const fakeEs = new FakeEventSource();
  const toastCalls = [];

  window.EventSource = undefined;
  const dispatched = [];
  window.dispatchEvent = vi.fn((ev) => dispatched.push(ev));

  mod.configureRealtimeSyncRuntime({
    windowRef: window,
    documentRef: document,
    onLoadOverview: vi.fn().mockResolvedValue(undefined),
    onLoadBadge: vi.fn().mockResolvedValue(undefined),
    invalidateGetCache: vi.fn(),
    refreshWindow: vi.fn(),
    showToast: vi.fn((msg, type) => toastCalls.push({ msg, type })),
    gameLog: vi.fn(),
    eventSourceFactory: () => fakeEs,
    ...extraOpts,
  });

  mod.initRealtimeSync();

  return { mod, fakeEs, toastCalls, dispatched };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RuntimeRealtimeSync — EventBus: sse:fleet_arrived', () => {
  it('emits on EventBus when fleet_arrived SSE fires', async () => {
    const bus = makeMockBus();
    const { fakeEs } = loadAndSetup({ eventBus: bus });
    const payload = { mission: 'attack', target: 'Sol III', attacker: 'Player1' };
    await fakeEs.emitAsync('fleet_arrived', payload);
    expect(bus.emit).toHaveBeenCalledWith('sse:fleet_arrived', expect.objectContaining(payload));
  });

  it('still dispatches window CustomEvent alongside EventBus emit', async () => {
    const bus = makeMockBus();
    const { fakeEs, dispatched } = loadAndSetup({ eventBus: bus });
    const payload = { mission: 'transport', target: 'Beta' };
    await fakeEs.emitAsync('fleet_arrived', payload);
    expect(dispatched.length).toBeGreaterThan(0);
    expect(dispatched[0].type).toBe('gq:fleet-arrived');
    expect(dispatched[0].detail).toMatchObject(payload);
    expect(bus.emit).toHaveBeenCalledWith('sse:fleet_arrived', expect.objectContaining(payload));
  });

  it('passes full payload including extra fields', async () => {
    const bus = makeMockBus();
    const { fakeEs } = loadAndSetup({ eventBus: bus });
    const payload = { mission: 'attack', target: 'Delta', attacker: 'Zeta', extra: 'value' };
    await fakeEs.emitAsync('fleet_arrived', payload);
    const [, emittedData] = bus.emit.mock.calls.find(([evt]) => evt === 'sse:fleet_arrived') ?? [];
    expect(emittedData).toMatchObject({ extra: 'value' });
  });
});

describe('RuntimeRealtimeSync — EventBus: sse:fleet_returning', () => {
  it('emits on EventBus when fleet_returning SSE fires', async () => {
    const bus = makeMockBus();
    const { fakeEs } = loadAndSetup({ eventBus: bus });
    const payload = { mission: 'attack', origin: 'Sol III' };
    await fakeEs.emitAsync('fleet_returning', payload);
    expect(bus.emit).toHaveBeenCalledWith('sse:fleet_returning', expect.objectContaining(payload));
  });
});

describe('RuntimeRealtimeSync — EventBus: sse:incoming_attack', () => {
  it('emits on EventBus when incoming_attack SSE fires', () => {
    const bus = makeMockBus();
    const { fakeEs } = loadAndSetup({ eventBus: bus });
    const payload = { mission: 'attack', attacker: 'Enemy', target: 'Alpha', arrival_time: null };
    fakeEs.emit('incoming_attack', payload);
    expect(bus.emit).toHaveBeenCalledWith('sse:incoming_attack', expect.objectContaining({ mission: 'attack' }));
  });
});

describe('RuntimeRealtimeSync — EventBus: sse:world_event', () => {
  it('emits on EventBus for unresolved world event', () => {
    const bus = makeMockBus();
    const { fakeEs } = loadAndSetup({ eventBus: bus });
    const payload = { code: 'supernova_alpha', title_de: 'Supernova', conclusion_key: null };
    fakeEs.emit('world_event', payload);
    expect(bus.emit).toHaveBeenCalledWith('sse:world_event', expect.objectContaining({ code: 'supernova_alpha' }));
  });

  it('emits on EventBus for resolved world event with conclusion_key', () => {
    const bus = makeMockBus();
    const { fakeEs } = loadAndSetup({ eventBus: bus });
    const payload = { code: 'truce', title_de: 'Waffenstillstand', conclusion_key: 'peace_agreement' };
    fakeEs.emit('world_event', payload);
    expect(bus.emit).toHaveBeenCalledWith('sse:world_event', expect.objectContaining({
      conclusion_key: 'peace_agreement',
    }));
  });
});

describe('RuntimeRealtimeSync — EventBus: sse:new_messages', () => {
  it('emits on EventBus when new_messages SSE fires', () => {
    const bus = makeMockBus();
    const { fakeEs } = loadAndSetup({ eventBus: bus });
    const payload = { unread: 3, new: 1 };
    fakeEs.emit('new_messages', payload);
    expect(bus.emit).toHaveBeenCalledWith('sse:new_messages', expect.objectContaining(payload));
  });
});

describe('RuntimeRealtimeSync — EventBus: null/undefined bus', () => {
  it('does not throw if eventBus is null', async () => {
    const { fakeEs } = loadAndSetup({ eventBus: null });
    const payload = { mission: 'attack', target: 'Sol', attacker: 'X' };
    await expect(fakeEs.emitAsync('fleet_arrived', payload)).resolves.toBeUndefined();
  });

  it('does not throw if eventBus is omitted', () => {
    const { fakeEs } = loadAndSetup({});
    const payload = { mission: 'spy', target: 'Alpha', attacker: 'Y', arrival_time: null };
    expect(() => fakeEs.emit('incoming_attack', payload)).not.toThrow();
  });
});

// ── CombatVfxBridge: connectEventBus ──────────────────────────────────────────

describe('CombatVfxBridge — connectEventBus()', () => {
  it('has a connectEventBus method on prototype', () => {
    const { CombatVfxBridge } = require(path.join(root, 'js/engine/CombatVfxBridge.js'));
    expect(typeof CombatVfxBridge.prototype.connectEventBus).toBe('function');
  });

  it('subscribes to sse:fleet_arrived, sse:incoming_attack, sse:fleet_returning', () => {
    const { CombatVfxBridge } = require(path.join(root, 'js/engine/CombatVfxBridge.js'));
    const subscribed = [];
    const mockBus = {
      on: vi.fn((event, cb) => {
        subscribed.push(event);
        return () => {};
      }),
    };

    // Instantiate without window singleton boot
    const bridge = Object.create(CombatVfxBridge.prototype);
    bridge._activeBattles = new Map();
    bridge._busUnsubs = [];
    bridge.connectEventBus(mockBus);

    expect(subscribed).toContain('sse:fleet_arrived');
    expect(subscribed).toContain('sse:incoming_attack');
    expect(subscribed).toContain('sse:fleet_returning');
  });

  it('calls previous unsub functions when connectEventBus is called again', () => {
    const { CombatVfxBridge } = require(path.join(root, 'js/engine/CombatVfxBridge.js'));
    const unsub = vi.fn();
    const mockBus = { on: vi.fn(() => unsub) };

    const bridge = Object.create(CombatVfxBridge.prototype);
    bridge._activeBattles = new Map();
    bridge._busUnsubs = [];
    bridge.connectEventBus(mockBus);

    const unsub2 = vi.fn();
    const mockBus2 = { on: vi.fn(() => unsub2) };
    bridge.connectEventBus(mockBus2);

    expect(unsub).toHaveBeenCalled();
  });

  it('forwards sse:fleet_arrived data to _onFleetArrived', () => {
    const { CombatVfxBridge } = require(path.join(root, 'js/engine/CombatVfxBridge.js'));
    const bridge = Object.create(CombatVfxBridge.prototype);
    bridge._activeBattles = new Map();
    bridge._busUnsubs = [];
    bridge._onFleetArrived = vi.fn();
    bridge._onIncomingAttack = vi.fn();
    bridge._onFleetReturning = vi.fn();

    const handlers = {};
    const mockBus = { on: vi.fn((evt, cb) => { handlers[evt] = cb; return () => {}; }) };
    bridge.connectEventBus(mockBus);

    const data = { mission: 'attack', target: 'Sol', attacker: 'X' };
    handlers['sse:fleet_arrived'](data);
    expect(bridge._onFleetArrived).toHaveBeenCalledWith({ detail: data });
  });

  it('includes sourcePosition in dispatched weapon-fire detail when provided', () => {
    const { CombatVfxBridge } = require(path.join(root, 'js/engine/CombatVfxBridge.js'));
    const bridge = Object.create(CombatVfxBridge.prototype);
    const dispatched = [];
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation((ev) => {
      dispatched.push(ev);
      return true;
    });

    bridge._dispatchWeaponFire({
      sourceType: 'installation',
      sourcePosition: '7',
      weaponKind: 'beam',
      ts: 123,
    });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe('gq:combat:weapon-fire');
    expect(dispatched[0].detail).toMatchObject({ sourceType: 'installation', sourcePosition: 7, weaponKind: 'beam' });

    dispatchSpy.mockRestore();
  });

  it('derives sourcePosition from fleet_arrived payload and forwards to battle start', () => {
    const { CombatVfxBridge, BATTLE_DURATION_MS } = require(path.join(root, 'js/engine/CombatVfxBridge.js'));
    const bridge = Object.create(CombatVfxBridge.prototype);
    bridge._dispatchWeaponFire = vi.fn();
    bridge._startBattleFx = vi.fn();
    bridge._deriveSourcePosition = CombatVfxBridge.prototype._deriveSourcePosition;
    bridge._normalizeSourcePosition = CombatVfxBridge.prototype._normalizeSourcePosition;

    bridge._onFleetArrived({ detail: { mission: 'attack', attacker: 'A', target: 'B', target_position: 11 } });

    expect(bridge._dispatchWeaponFire).toHaveBeenCalledWith(expect.objectContaining({ sourcePosition: 11, sourceType: 'installation' }));
    expect(bridge._startBattleFx).toHaveBeenCalledWith(
      'A',
      'B',
      BATTLE_DURATION_MS,
      11,
      expect.objectContaining({ mission: 'attack', attacker: 'A', target: 'B' })
    );
  });

  it('derives sourcePosition for incoming_attack pulses', () => {
    const { CombatVfxBridge } = require(path.join(root, 'js/engine/CombatVfxBridge.js'));
    const bridge = Object.create(CombatVfxBridge.prototype);
    bridge._dispatchWeaponFire = vi.fn();
    bridge._deriveSourcePosition = CombatVfxBridge.prototype._deriveSourcePosition;
    bridge._normalizeSourcePosition = CombatVfxBridge.prototype._normalizeSourcePosition;

    vi.useFakeTimers();
    bridge._onIncomingAttack({ detail: { mission: 'attack', position: 9 } });
    vi.runAllTimers();
    vi.useRealTimers();

    expect(bridge._dispatchWeaponFire).toHaveBeenCalled();
    const hasPos = bridge._dispatchWeaponFire.mock.calls.every((call) => call?.[0]?.sourcePosition === 9);
    expect(hasPos).toBe(true);
  });

  it('uses ship-heavier pulse profile for attack missions', () => {
    const { CombatVfxBridge } = require(path.join(root, 'js/engine/CombatVfxBridge.js'));
    const bridge = Object.create(CombatVfxBridge.prototype);

    const profile = bridge._battlePulseProfile({ mission: 'attack' });

    expect(profile.sourcePattern).toEqual(['installation', 'ship', 'ship']);
    expect(profile.weaponPattern).toEqual(['laser', 'beam', 'missile', 'rail']);
  });

  it('uses stealth profile for spy missions', () => {
    const { CombatVfxBridge } = require(path.join(root, 'js/engine/CombatVfxBridge.js'));
    const bridge = Object.create(CombatVfxBridge.prototype);

    const profile = bridge._battlePulseProfile({ mission: 'spy' });

    expect(profile.sourcePattern).toEqual(['installation']);
    expect(profile.weaponPattern).toEqual(['beam']);
  });

  it('falls back to default profile for unknown missions', () => {
    const { CombatVfxBridge } = require(path.join(root, 'js/engine/CombatVfxBridge.js'));
    const bridge = Object.create(CombatVfxBridge.prototype);

    const profile = bridge._battlePulseProfile({ mission: 'trade' });

    expect(profile.sourcePattern).toEqual(['installation', 'installation', 'ship']);
    expect(profile.weaponPattern).toEqual(['laser', 'beam', 'missile']);
  });

  it('applies mission profile inside _startBattleFx dispatch loop', () => {
    const { CombatVfxBridge, FIRE_INTERVAL_MS } = require(path.join(root, 'js/engine/CombatVfxBridge.js'));
    const bridge = Object.create(CombatVfxBridge.prototype);
    bridge._activeBattles = new Map();
    bridge._dispatchWeaponFire = vi.fn();
    bridge._stopBattleFx = CombatVfxBridge.prototype._stopBattleFx;
    bridge._battleKey = CombatVfxBridge.prototype._battleKey;
    bridge._battlePulseProfile = vi.fn(() => ({ sourcePattern: ['ship'], weaponPattern: ['rail'] }));

    vi.useFakeTimers();
    bridge._startBattleFx('A', 'B', FIRE_INTERVAL_MS + 20, 12, { mission: 'attack' });
    vi.advanceTimersByTime(FIRE_INTERVAL_MS + 5);
    vi.runAllTimers();
    vi.useRealTimers();

    expect(bridge._dispatchWeaponFire).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'ship',
      weaponKind: 'rail',
      sourcePosition: 12,
    }));
  });
});
