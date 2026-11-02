import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CombatVfxBridge } = require('../../js/engine/CombatVfxBridge.js');
window.GQCombatVfxBridge?.destroy();

let bridge;
let events;
let onFire;

beforeEach(() => {
  vi.useFakeTimers();
  bridge = new CombatVfxBridge();
  events = [];
  onFire = (event) => events.push(event.detail);
  window.addEventListener('gq:combat:weapon-fire', onFire);
});

afterEach(() => {
  bridge.destroy();
  window.removeEventListener('gq:combat:weapon-fire', onFire);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('combat VFX identity and lifecycle', () => {
  it('deduplicates explicit events across window, event bus and reconnect copies', () => {
    const callbacks = new Map();
    bridge.connectEventBus({ on: (type, cb) => {
      callbacks.set(type, cb);
      return () => callbacks.delete(type);
    } });
    const payload = { event_id: 'arrival-1', fleet_id: 7, mission: 'attack', target: '1:2:3' };
    window.dispatchEvent(new CustomEvent('gq:fleet-arrived', { detail: payload }));
    callbacks.get('sse:fleet_arrived')(payload);
    callbacks.get('sse:fleet_arrived')({ ...payload });
    expect(events).toHaveLength(1);
    expect(bridge._activeBattles.size).toBe(1);
    vi.advanceTimersByTime(380);
    expect(events).toHaveLength(2);
  });

  it('uses fleet IDs for current server payloads without conflating lifecycle stages', () => {
    const payload = { fleet_id: 9, mission: 'attack', target: '1:2:3' };
    bridge._onIncomingAttack({ detail: payload });
    bridge._onIncomingAttack({ detail: { ...payload } });
    bridge._onFleetArrived({ detail: payload });
    bridge._onFleetArrived({ detail: { ...payload } });
    expect(events).toHaveLength(2);
    bridge._onFleetReturning({ detail: payload });
    expect(bridge._activeBattles.size).toBe(0);
  });

  it('deduplicates only identical objects for legacy events with no reliable ID', () => {
    const payload = { mission: 'spy', target: '1:2:3' };
    bridge._onFleetArrived({ detail: payload });
    bridge._onFleetArrived({ detail: payload });
    bridge._onFleetArrived({ detail: { ...payload } });
    expect(events).toHaveLength(2);
  });

  it('stops the matching fleet when the server return event has no target', () => {
    bridge._onFleetArrived({ detail: { fleet_id: 1, mission: 'attack', target: '1:2:3' } });
    bridge._onFleetArrived({ detail: { fleet_id: 2, mission: 'attack', target: '1:2:4' } });
    bridge._onFleetReturning({ detail: { fleet_id: 1, mission: 'attack' } });
    expect(bridge._activeBattles.size).toBe(1);
    expect([...bridge._activeBattles.values()][0].fleetId).toBe('2');
  });

  it('bounds retained IDs and expires old entries', () => {
    for (let id = 0; id < 1100; id++) {
      bridge._onFleetArrived({ detail: { event_id: id, mission: 'spy' } });
    }
    expect(bridge._seenEvents.size).toBe(1024);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    bridge._onFleetArrived({ detail: { event_id: 1099, mission: 'spy' } });
    expect(bridge._seenEvents.size).toBe(1);
    expect(events).toHaveLength(1101);
  });

  it('cancels warning and battle timers on stop, hiding and repeated destruction', () => {
    bridge._onIncomingAttack({ detail: { fleet_id: 1, mission: 'attack' } });
    bridge._onFleetArrived({ detail: { fleet_id: 2, mission: 'attack' } });
    bridge.stopAll();
    vi.advanceTimersByTime(9000);
    expect(events).toHaveLength(2);
    bridge._onIncomingAttack({ detail: { fleet_id: 3, mission: 'attack' } });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(9000);
    expect(events).toHaveLength(3);
    bridge._onIncomingAttack({ detail: { fleet_id: 4, mission: 'attack' } });
    bridge.destroy();
    bridge.destroy();
    vi.advanceTimersByTime(9000);
    window.dispatchEvent(new CustomEvent('gq:fleet-arrived', {
      detail: { fleet_id: 5, mission: 'attack' },
    }));
    expect(events).toHaveLength(3);
    expect(bridge._alertTimers.size).toBe(0);
    expect(bridge._activeBattles.size).toBe(0);
  });

  it('does not replay events received while hidden when visibility returns', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const payload = { event_id: 'hidden-arrival', mission: 'attack' };
    bridge._onFleetArrived({ detail: payload });
    expect(events).toHaveLength(0);
    expect(bridge._activeBattles.size).toBe(0);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    bridge._onFleetArrived({ detail: { ...payload } });
    expect(events).toHaveLength(0);
  });

  it('limits concurrent visual work and adapter-requested duration', () => {
    for (let i = 0; i < 80; i++) bridge._startBattleFx('a', `target${i}`, Infinity);
    expect(bridge._activeBattles.size).toBe(32);
    for (let i = 0; i < 80; i++) {
      bridge._onIncomingAttack({ detail: { fleet_id: i, mission: 'attack' } });
    }
    expect(bridge._alertTimers.size).toBe(32);
    vi.advanceTimersByTime(8001);
    expect(bridge._activeBattles.size).toBe(0);
    expect(bridge._alertTimers.size).toBe(0);
  });

  it.each(['reducedMotion', 'reducedFlashes'])('honors %s without sustained flashes', (option) => {
    bridge._onFleetArrived({ detail: { fleet_id: 1, mission: 'attack' } });
    bridge.setVisualOptions({ [option]: true });
    bridge._onIncomingAttack({ detail: { fleet_id: 2, mission: 'attack' } });
    bridge._onFleetArrived({ detail: { fleet_id: 3, mission: 'attack' } });
    vi.advanceTimersByTime(9000);
    expect(events).toHaveLength(3);
    expect(bridge._activeBattles.size).toBe(0);
    expect(bridge._alertTimers.size).toBe(0);
  });

  it('honors the operating system reduced-motion preference', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    bridge._onFleetArrived({ detail: { fleet_id: 1, mission: 'attack' } });
    vi.advanceTimersByTime(9000);
    expect(events).toHaveLength(1);
    expect(bridge._activeBattles.size).toBe(0);
  });
});
