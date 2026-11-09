import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectLiveBattleTick, startLiveBattlePresentation } from '../../js/rendering/live-battle-presentation.js';

const group = (count, shield = 10, hull = 20) => ({
  initial_count: 2, count, shield, hull,
});
const state = (tick, status = 'active') => ({
  tick, status, rule_version: 'live-groups-experimental-v1',
  outcome: status === 'active' ? null : 'attacker_wins',
  groups: { attacker: { fighter: group(2) }, defender: { cruiser: group(status === 'resolved' ? 0 : 1, 0, 5) } },
});
const event = (tick) => ({
  tick, source_side: 'attacker', target_side: 'defender', target_group: 'cruiser',
  shield_damage: 3, hull_damage: 4, ships_lost: 1,
});
const entry = (tick, status) => ({ tick, state: state(tick, status), events: [event(tick)] });
const snapshotResponse = () => ({
  success: true,
  snapshot: { schema_version: 1, journal_id: 17, tick: 0, state: state(0), next_tick_at_utc: null },
});
const pageResponse = () => ({
  success: true,
  page: {
    schema_version: 1, journal_id: 17, latest_tick: 2, next_cursor: 2, has_more: false,
    ticks: [entry(1), entry(2, 'resolved')],
  },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('live battle presentation adapter', () => {
  it('projects exact side, type, group health, and aggregate damage without inventing shots', () => {
    const result = projectLiveBattleTick(entry(1));
    expect(result.snapshot).toEqual({
      tick: 1, status: 'active', outcome: null,
      groups: [
        { side: 'attacker', type: 'fighter', initialCount: 2, count: 2, shield: 10, hull: 20 },
        { side: 'defender', type: 'cruiser', initialCount: 2, count: 1, shield: 0, hull: 5 },
      ],
    });
    expect(result.cues).toEqual([{
      kind: 'aggregate-damage', tick: 1, sourceSide: 'attacker', targetSide: 'defender',
      targetGroup: 'cruiser', shieldDamage: 3, hullDamage: 4, shipsLost: 1,
    }]);
  });

  it('rejects invalid groups and missing or fabricated event targets', () => {
    for (const mutate of [
      (value) => { value.events[0].target_group = 'missing'; },
      (value) => { value.events[0].source_side = 'defender'; },
      (value) => { value.events[0].ships_lost = -1; },
      (value) => { value.state.groups.attacker.fighter.count = 3; },
      (value) => { value.events[0].hull_damage = Infinity; },
    ]) {
      const bad = entry(1);
      mutate(bad);
      expect(() => projectLiveBattleTick(bad)).toThrow();
    }
  });

  it('delivers the snapshot and every server tick in order, identifying catch-up', async () => {
    const api = { get: vi.fn().mockResolvedValueOnce(snapshotResponse()).mockResolvedValueOnce(pageResponse()) };
    const sink = { snapshot: vi.fn(), tick: vi.fn(), error: vi.fn() };
    const presentation = startLiveBattlePresentation(api, 17, sink);
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.snapshot.mock.calls[0][0].tick).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    await presentation.finished;
    expect(sink.tick.mock.calls.map(([value, info]) => [value.snapshot.tick, info.isCatchUp]))
      .toEqual([[1, true], [2, false]]);
    expect(sink.error).not.toHaveBeenCalled();
  });

  it('stops delivering an already fetched page after an asynchronous sink is stopped', async () => {
    let release;
    const api = { get: vi.fn().mockResolvedValueOnce(snapshotResponse()).mockResolvedValueOnce(pageResponse()) };
    const sink = {
      snapshot: vi.fn(), tick: vi.fn(() => new Promise((resolve) => { release = resolve; })), error: vi.fn(),
    };
    const presentation = startLiveBattlePresentation(api, 17, sink);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sink.tick).toHaveBeenCalledTimes(1);
    presentation.stop();
    release();
    await presentation.finished;
    expect(sink.tick).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates presentation errors and does not retry an already applied tick', async () => {
    const api = { get: vi.fn().mockResolvedValueOnce(snapshotResponse()).mockResolvedValueOnce(pageResponse()) };
    const sink = { snapshot: vi.fn(), tick: vi.fn().mockRejectedValue(new Error('renderer failed')), error: vi.fn() };
    const presentation = startLiveBattlePresentation(api, 17, sink);
    const failure = expect(presentation.finished).rejects.toThrow('renderer failed');
    await vi.advanceTimersByTimeAsync(1000);
    await failure;
    expect(sink.tick).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
