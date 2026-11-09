import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveBattleJournalClient } from '../../js/engine/game/LiveBattleJournalClient.js';
import { LiveBattleJournalPoller } from '../../js/engine/game/LiveBattleJournalPoller.js';

const state = (tick, status = 'active') => ({
  tick, status, rule_version: 'live-groups-experimental-v1',
  outcome: status === 'active' ? null : 'attacker_wins',
  groups: { attacker: {}, defender: {} },
});
const snapshot = (tick = 0, status = 'active') => ({
  success: true,
  snapshot: { schema_version: 1, journal_id: 17, tick, state: state(tick, status), next_tick_at_utc: null },
});
const page = (from, to, latest = to, resolved = false) => ({
  success: true,
  page: {
    schema_version: 1, journal_id: 17, latest_tick: latest, next_cursor: to, has_more: to < latest,
    ticks: Array.from({ length: to - from }, (_, index) => {
      const tick = from + index + 1;
      return { tick, state: state(tick, resolved && tick === to ? 'resolved' : 'active'), events: [] };
    }),
  },
});
const handlers = () => ({ onSnapshot: vi.fn(), onPage: vi.fn(), onError: vi.fn() });
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('LiveBattleJournalPoller', () => {
  it('drains ordered pages within the configured budget and stops on a resolved state', async () => {
    const api = { get: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(page(0, 2, 5))
      .mockResolvedValueOnce(page(2, 4, 5)).mockResolvedValueOnce(page(4, 5, 5, true)) };
    const callbacks = handlers();
    const poller = new LiveBattleJournalPoller(new LiveBattleJournalClient(api, 17), {
      ...callbacks, pageLimit: 2, pagesPerCycle: 2,
    });
    const run = poller.run();
    await flush();
    expect(callbacks.onSnapshot).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(callbacks.onPage.mock.calls.map(([value]) => value.nextCursor)).toEqual([2, 4]);
    expect(api.get).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(callbacks.onPage.mock.calls.map(([value]) => value.nextCursor)).toEqual([2, 4, 5]);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backs off transient failures then resumes at the same cursor', async () => {
    const error = Object.assign(new Error('unavailable'), { status: 503 });
    const api = { get: vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error).mockResolvedValueOnce(page(0, 1, 1, true)) };
    const callbacks = handlers();
    const poller = new LiveBattleJournalPoller(new LiveBattleJournalClient(api, 17), callbacks);
    const run = poller.run();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(callbacks.onError).toHaveBeenLastCalledWith({ error, attempt: 1, retryInMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(callbacks.onError).toHaveBeenLastCalledWith({ error, attempt: 2, retryInMs: 2000 });
    await vi.advanceTimersByTimeAsync(2000);
    await run;
    expect(api.get.mock.calls.slice(1).map(([url]) => url)).toEqual([
      'api/live_battle_journal.php?action=ticks&journal_id=17&after_tick=0&limit=50',
      'api/live_battle_journal.php?action=ticks&journal_id=17&after_tick=0&limit=50',
      'api/live_battle_journal.php?action=ticks&journal_id=17&after_tick=0&limit=50',
    ]);
  });

  it('reports fatal auth errors and malformed pages without retries', async () => {
    for (const error of [Object.assign(new Error('unauthorized'), { status: 401 }), new Error('Invalid live battle tick page.')]) {
      const client = {
        initialize: vi.fn().mockRejectedValue(error), readNextPage: vi.fn(), getState: vi.fn(), dispose: vi.fn(),
      };
      const callbacks = handlers();
      const poller = new LiveBattleJournalPoller(client, callbacks);
      await expect(poller.run()).rejects.toBe(error);
      expect(callbacks.onError).toHaveBeenCalledWith({ error, attempt: 1, retryInMs: null });
      expect(client.initialize).toHaveBeenCalledOnce();
      expect(client.dispose).toHaveBeenCalledOnce();
    }
  });

  it('limits retries and propagates the final error', async () => {
    const error = Object.assign(new Error('unavailable'), { status: 503 });
    const client = {
      initialize: vi.fn().mockRejectedValue(error), readNextPage: vi.fn(), getState: vi.fn(), dispose: vi.fn(),
    };
    const callbacks = handlers();
    const poller = new LiveBattleJournalPoller(client, { ...callbacks, maxRetries: 1 });
    const run = poller.run();
    const rejected = expect(run).rejects.toBe(error);
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(callbacks.onError.mock.calls.map(([info]) => info.retryInMs)).toEqual([1000, null]);
    expect(client.initialize).toHaveBeenCalledTimes(2);
  });

  it('stops promptly while waiting and discards a late response while running', async () => {
    let resolve;
    const api = { get: vi.fn().mockResolvedValueOnce(snapshot())
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; })) };
    const callbacks = handlers();
    const client = new LiveBattleJournalClient(api, 17);
    const poller = new LiveBattleJournalPoller(client, callbacks);
    const run = poller.run();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    poller.stop();
    poller.stop();
    resolve(page(0, 1));
    await run;
    expect(callbacks.onPage).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(client.getState()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => poller.run()).toThrow('cannot be started');

    const client2 = new LiveBattleJournalClient({ get: vi.fn().mockResolvedValue(snapshot()) }, 17);
    const poller2 = new LiveBattleJournalPoller(client2, handlers());
    const run2 = poller2.run();
    await flush();
    poller2.stop();
    await run2;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for consumers and surfaces callback errors without retrying applied pages', async () => {
    let release;
    const callbacks = handlers();
    callbacks.onPage.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockRejectedValueOnce(new Error('renderer failed'));
    const api = { get: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(page(0, 1, 2))
      .mockResolvedValueOnce(page(1, 2)) };
    const poller = new LiveBattleJournalPoller(new LiveBattleJournalClient(api, 17), {
      ...callbacks, pageLimit: 1,
    });
    const run = poller.run();
    const rejected = expect(run).rejects.toThrow('renderer failed');
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.get).toHaveBeenCalledTimes(2);
    release();
    await flush();
    await rejected;
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('delivers an already resolved snapshot once without polling', async () => {
    const api = { get: vi.fn().mockResolvedValue(snapshot(9, 'resolved')) };
    const callbacks = handlers();
    const poller = new LiveBattleJournalPoller(new LiveBattleJournalClient(api, 17), callbacks);
    await poller.run();
    expect(api.get).toHaveBeenCalledOnce();
    expect(callbacks.onSnapshot.mock.calls[0][0].tick).toBe(9);
    expect(callbacks.onPage).not.toHaveBeenCalled();
  });

  it('resets the retry budget after a successful response', async () => {
    const error = Object.assign(new Error('network error'), { status: 503 });
    const api = { get: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce(error).mockResolvedValueOnce(page(0, 1, 1, true)) };
    const callbacks = handlers();
    const poller = new LiveBattleJournalPoller(new LiveBattleJournalClient(api, 17), {
      ...callbacks, maxRetries: 1,
    });
    const run = poller.run();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(callbacks.onError.mock.calls.map(([info]) => [info.attempt, info.retryInMs]))
      .toEqual([[1, 1000], [1, 1000]]);
  });

  it('validates required callbacks and bounded configuration before starting', () => {
    const client = new LiveBattleJournalClient({ get: vi.fn() }, 17);
    expect(() => new LiveBattleJournalPoller(client, {})).toThrow('callbacks');
    for (const options of [{ intervalMs: 99 }, { pageLimit: 101 }, { pagesPerCycle: 11 }, { maxRetries: -1 }]) {
      expect(() => new LiveBattleJournalPoller(client, { ...handlers(), ...options })).toThrow('settings');
    }
  });
});
