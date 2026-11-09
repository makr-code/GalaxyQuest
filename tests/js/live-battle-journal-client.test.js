import { describe, expect, it, vi } from 'vitest';
import { LiveBattleJournalClient } from '../../js/engine/game/LiveBattleJournalClient.js';

const state = (tick, status = 'active') => ({
  rule_version: 'live-groups-experimental-v1',
  tick,
  status,
  outcome: status === 'active' ? null : 'attacker_wins',
  groups: { attacker: { fighter: { count: 2 } }, defender: { fighter: { count: 1 } } },
});
const snapshot = (tick = 0) => ({
  success: true,
  snapshot: { schema_version: 1, journal_id: 17, tick, state: state(tick), next_tick_at_utc: null },
});
const page = (start, end, latest = end) => ({
  success: true,
  page: {
    schema_version: 1,
    journal_id: 17,
    latest_tick: latest,
    next_cursor: end,
    has_more: end < latest,
    ticks: Array.from({ length: end - start }, (_, i) => ({
      tick: start + i + 1,
      state: state(start + i + 1),
      events: [{ tick: start + i + 1, ships_lost: 0 }],
    })),
  },
});

describe('LiveBattleJournalClient', () => {
  it('initializes and follows paginated ticks without caching or losing event order', async () => {
    const api = { get: vi.fn().mockResolvedValueOnce(snapshot(4))
      .mockResolvedValueOnce(page(4, 6, 7)).mockResolvedValueOnce(page(6, 7)) };
    const client = new LiveBattleJournalClient(api, 17);
    expect(await client.initialize()).toEqual(state(4));
    const first = await client.readNextPage(2);
    expect(first).toMatchObject({ nextCursor: 6, latestTick: 7, hasMore: true });
    expect(first.ticks.map((entry) => entry.events[0].tick)).toEqual([5, 6]);
    const second = await client.readNextPage(2);
    expect(second).toMatchObject({ nextCursor: 7, hasMore: false });
    expect(second.ticks[0].tick).toBe(7);
    expect(client.getState()).toEqual(state(7));
    expect(api.get.mock.calls).toEqual([
      ['api/live_battle_journal.php?action=snapshot&journal_id=17', { cacheMode: 'no-store' }],
      ['api/live_battle_journal.php?action=ticks&journal_id=17&after_tick=4&limit=2', { cacheMode: 'no-store' }],
      ['api/live_battle_journal.php?action=ticks&journal_id=17&after_tick=6&limit=2', { cacheMode: 'no-store' }],
    ]);
  });

  it('retries failed requests at the last committed cursor and keeps returned data isolated', async () => {
    const api = { get: vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page(0, 1)) };
    const client = new LiveBattleJournalClient(api, 17);
    const initial = await client.initialize();
    initial.groups.attacker.fighter.count = 999;
    await expect(client.readNextPage()).rejects.toThrow('offline');
    expect(client.getState()).toEqual(state(0));
    const result = await client.readNextPage();
    result.ticks[0].state.groups.attacker.fighter.count = 999;
    expect(client.getState()).toEqual(state(1));
    expect(api.get.mock.calls[1][0]).toBe(api.get.mock.calls[2][0]);
  });

  it('rejects gaps, incorrect cursors, and unsupported versions without advancing', async () => {
    const invalid = [
      (value) => { value.page.ticks[1].tick = 3; },
      (value) => { value.page.next_cursor = 1; },
      (value) => { value.page.ticks[1].state.rule_version = 'legacy-v1'; },
      (value) => { value.page.ticks[1].events[0].tick = 3; },
      (value) => { value.page.has_more = true; },
      (value) => { value.page.journal_id = 18; },
      (value) => { value.page.ticks[0].state.status = 'resolved'; value.page.ticks[0].state.outcome = 'attacker_wins'; },
    ];
    for (const mutate of invalid) {
      const bad = page(0, 2);
      mutate(bad);
      const api = { get: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(bad)
        .mockResolvedValueOnce(page(0, 2)) };
      const client = new LiveBattleJournalClient(api, 17);
      await client.initialize();
      await expect(client.readNextPage(2)).rejects.toThrow();
      expect(client.getState()).toEqual(state(0));
      expect((await client.readNextPage(2)).nextCursor).toBe(2);
    }
  });

  it('guards concurrent requests and discards results after disposal', async () => {
    let resolve;
    const api = { get: vi.fn(() => new Promise((done) => { resolve = done; })) };
    const client = new LiveBattleJournalClient(api, 17);
    const pending = client.initialize();
    await expect(client.initialize()).rejects.toThrow('already in progress');
    client.dispose();
    resolve(snapshot());
    await expect(pending).rejects.toThrow('disposed');
    expect(client.getState()).toBeNull();
    await expect(client.readNextPage()).rejects.toThrow('disposed');
  });

  it('handles terminal and empty pages and rejects invalid use', async () => {
    const terminalPage = page(0, 1);
    terminalPage.page.ticks[0].state = state(1, 'resolved');
    const api = { get: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(terminalPage)
      .mockResolvedValueOnce(page(1, 1)) };
    const client = new LiveBattleJournalClient(api, 17);
    await expect(client.readNextPage()).rejects.toThrow('not initialized');
    await client.initialize();
    await expect(client.initialize()).rejects.toThrow('already initialized');
    await expect(client.readNextPage(101)).rejects.toThrow('limit');
    expect((await client.readNextPage()).ticks[0].state.status).toBe('resolved');
    expect((await client.readNextPage()).ticks).toEqual([]);
    expect(client.getState().outcome).toBe('attacker_wins');
    expect(() => new LiveBattleJournalClient(api, Number.MAX_SAFE_INTEGER + 1)).toThrow('ID');
    expect(() => new LiveBattleJournalClient({}, 17)).toThrow('API client');
  });

  it('does not initialize on invalid snapshots or transport errors', async () => {
    const bad = snapshot();
    bad.snapshot.state.tick = 2;
    const api = { get: vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(snapshot()) };
    const client = new LiveBattleJournalClient(api, 17);
    await expect(client.initialize()).rejects.toThrow('state');
    expect(client.getState()).toBeNull();
    expect(await client.initialize()).toEqual(state(0));
  });

  it('resumes after empty polls and rejects non-progressing or regressing pages', async () => {
    const stuck = page(0, 0, 1);
    const regression = page(0, 0);
    regression.page.latest_tick = -1;
    const api = { get: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(page(0, 0))
      .mockResolvedValueOnce(stuck).mockResolvedValueOnce(regression).mockResolvedValueOnce(page(0, 1)) };
    const client = new LiveBattleJournalClient(api, 17);
    await client.initialize();
    expect(await client.readNextPage()).toMatchObject({ nextCursor: 0, ticks: [], hasMore: false });
    await expect(client.readNextPage()).rejects.toThrow('page');
    await expect(client.readNextPage()).rejects.toThrow('page');
    expect(client.getState().tick).toBe(0);
    expect((await client.readNextPage()).ticks[0].tick).toBe(1);
  });

  it('discards an in-flight tick page when the client is disposed', async () => {
    let resolve;
    const api = { get: vi.fn().mockResolvedValueOnce(snapshot())
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; })) };
    const client = new LiveBattleJournalClient(api, 17);
    await client.initialize();
    const pending = client.readNextPage();
    await expect(client.readNextPage()).rejects.toThrow('already in progress');
    client.dispose();
    resolve(page(0, 1));
    await expect(pending).rejects.toThrow('disposed');
    expect(client.getState()).toBeNull();
  });
});
