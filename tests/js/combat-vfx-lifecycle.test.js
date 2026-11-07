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
    expect(events).toHaveLength(0);
    expect(bridge._activeBattles.size).toBe(0);
  });

  it('does not present fleet lifecycle notifications as weapon fire', () => {
    const payload = { fleet_id: 9, mission: 'attack', target: '1:2:3' };
    bridge._onIncomingAttack({ detail: payload });
    bridge._onIncomingAttack({ detail: { ...payload } });
    bridge._onFleetArrived({ detail: payload });
    bridge._onFleetArrived({ detail: { ...payload } });
    expect(events).toHaveLength(0);
    bridge._onFleetReturning({ detail: payload });
    expect(bridge._activeBattles.size).toBe(0);
  });

  it('does not present id-less fleet lifecycle notifications as weapon fire', () => {
    const payload = { mission: 'spy', target: '1:2:3' };
    bridge._onFleetArrived({ detail: payload });
    bridge._onFleetArrived({ detail: payload });
    bridge._onFleetArrived({ detail: { ...payload } });
    expect(events).toHaveLength(0);
  });

  it('stops the matching fleet when the server return event has no target', () => {
    bridge._startBattleFx('a', '1:2:3', 8000, null, { fleetId: 1 });
    bridge._startBattleFx('a', '1:2:4', 8000, null, { fleetId: 2 });
    bridge._onFleetReturning({ detail: { fleet_id: 1, mission: 'attack' } });
    expect(bridge._activeBattles.size).toBe(1);
    expect([...bridge._activeBattles.values()][0].fleetId).toBe('2');
  });

  it('preserves bounded source and target fleet IDs in weapon-fire events', () => {
    bridge._dispatchWeaponFire({
      sourceType: 'ship',
      sourceFleetId: 17,
      targetFleetId: ' 23 ',
      targetPos: [1, 2, 3],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceFleetId: '17',
      targetFleetId: '23',
      targetPos: [1, 2, 3],
    });

    bridge._dispatchWeaponFire({
      sourceFleetId: Number.NaN,
      targetFleetId: 'x'.repeat(257),
    });
    expect(events[1]).toMatchObject({ sourceFleetId: null, targetFleetId: null });
  });

  it('deduplicates resolved battles by report ID', () => {
    const payload = {
      event_id: 'battle-report:1099',
      battle_report_id: 1099,
      fleet_id: 7,
      target_position: 3,
      role: 'attacker',
      rounds: [{ round: 1, attacker_pressure: 1, defender_pressure: 1 }],
    };
    bridge._onBattleResolved({ detail: payload });
    bridge._onBattleResolved({ detail: { ...payload } });
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(events).toHaveLength(1);
  });

  it('cancels warning and battle timers on stop, hiding and repeated destruction', () => {
    bridge._onIncomingAttack({ detail: { fleet_id: 1, mission: 'attack' } });
    bridge._onFleetArrived({ detail: { fleet_id: 2, mission: 'attack' } });
    bridge._onBattleResolved({ detail: {
      event_id: 'battle-report:3', fleet_id: 2, target_position: 3, role: 'attacker',
      rounds: [{ round: 1, attacker_pressure: 1, defender_pressure: 1 }],
    } });
    bridge.stopAll();
    vi.advanceTimersByTime(1000);
    expect(events).toHaveLength(0);
    bridge._onIncomingAttack({ detail: { fleet_id: 3, mission: 'attack' } });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(9000);
    expect(events).toHaveLength(0);
    bridge._onIncomingAttack({ detail: { fleet_id: 4, mission: 'attack' } });
    bridge.destroy();
    bridge.destroy();
    vi.advanceTimersByTime(9000);
    window.dispatchEvent(new CustomEvent('gq:fleet-arrived', {
      detail: { fleet_id: 5, mission: 'attack' },
    }));
    expect(events).toHaveLength(0);
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

  it.each(['destroy', 'stopAll'])('cancels scheduled battle summary effects on %s', (method) => {
    bridge._onBattleResolved({ detail: {
      event_id: `battle-report:${method}`, fleet_id: 1, target_position: 2, role: 'attacker',
      rounds: [{ round: 1, attacker_pressure: 1, defender_pressure: 1 }],
    } });
    bridge[method]();
    vi.advanceTimersByTime(1000);
    expect(events).toHaveLength(0);
  });

  it('plays only the reported side salvo and carries exact fleet and body-slot identities', () => {
    bridge._onBattleResolved({ detail: {
      event_id: 'battle-report:55',
      battle_report_id: 55,
      fleet_id: 17,
      target_position: 9,
      role: 'attacker',
      rounds: [
        { round: 1, attacker_pressure: 100, defender_pressure: 80 },
        { round: 2, attacker_pressure: 0, defender_pressure: 50 },
      ],
    } });
    vi.advanceTimersByTime(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceType: 'ship',
      sourceFleetId: '17',
      targetSlotPosition: 9,
      weaponKind: 'laser',
      battleReportId: '55',
      round: 1,
    });
    vi.advanceTimersByTime(520);
    expect(events).toHaveLength(1);
  });

  it('renders defender round pressure as installation fire toward the attacker fleet', () => {
    bridge._onBattleResolved({ detail: {
      event_id: 'battle-report:56',
      battle_report_id: 56,
      fleet_id: 18,
      target_position: 6,
      role: 'defender',
      rounds: [{ round: 1, attacker_pressure: 10, defender_pressure: 20 }],
    } });
    vi.advanceTimersByTime(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceType: 'installation',
      targetFleetId: '18',
      sourcePosition: 6,
      targetSlotPosition: 6,
      weaponKind: 'beam',
    });
  });

  it('does not schedule effects for invalid or hidden battle summaries', () => {
    bridge._onBattleResolved({ detail: {
      event_id: 'battle-report:invalid', fleet_id: 1, role: 'attacker',
      rounds: [{ round: 1, attacker_pressure: 1 }],
    } });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    bridge._onBattleResolved({ detail: {
      event_id: 'battle-report:hidden', fleet_id: 1, target_position: 2, role: 'attacker',
      rounds: [{ round: 1, attacker_pressure: 1 }],
    } });
    vi.advanceTimersByTime(1000);
    expect(events).toHaveLength(0);
  });

  describe.each(['_onIncomingAttack', '_onFleetArrived'])('%s', (handler) => {
    it('does not create weapon fire without a resolved battle report', () => {
      bridge[handler]({ detail: { fleet_id: 1, mission: 'attack' } });
      expect(bridge._activeBattles.size).toBe(0);
      expect(events).toHaveLength(0);
    });
  });

  it('limits concurrent visual work and adapter-requested duration', () => {
    for (let i = 0; i < 80; i++) bridge._startBattleFx('a', `target${i}`, Infinity);
    expect(bridge._activeBattles.size).toBe(32);
    for (let i = 0; i < 80; i++) {
      bridge._onIncomingAttack({ detail: { fleet_id: i, mission: 'attack' } });
    }
    expect(bridge._alertTimers.size).toBe(0);
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
    expect(events).toHaveLength(0);
    expect(bridge._activeBattles.size).toBe(0);
    expect(bridge._alertTimers.size).toBe(0);
  });

  it('honors the operating system reduced-motion preference', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    bridge._onFleetArrived({ detail: { fleet_id: 1, mission: 'attack' } });
    vi.advanceTimersByTime(9000);
    expect(events).toHaveLength(0);
    expect(bridge._activeBattles.size).toBe(0);
  });
});
