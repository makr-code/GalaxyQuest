const RULE_VERSION = 'live-groups-experimental-v1';
const ENDPOINT = 'api/live_battle_journal.php';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateState(state, tick) {
  if (!isRecord(state) || state.tick !== tick || state.rule_version !== RULE_VERSION
    || !['active', 'resolved'].includes(state.status) || !isRecord(state.groups)
    || !isRecord(state.groups.attacker) || !isRecord(state.groups.defender)
    || (state.status === 'active' ? state.outcome !== null
      : !['attacker_wins', 'defender_wins', 'mutual_destruction', 'stalemate'].includes(state.outcome))) {
    throw new Error('Invalid live battle state.');
  }
}

/**
 * Pull-only experimental read model. API must provide get(endpoint, {cacheMode}).
 * No polling, presentation, or combat simulation is performed here.
 */
export class LiveBattleJournalClient {
  #api;
  #journalId;
  #state = null;
  #pending = false;
  #disposed = false;

  constructor(api, journalId) {
    if (!api || typeof api.get !== 'function') throw new TypeError('An API client is required.');
    if (!Number.isSafeInteger(journalId) || journalId < 1) throw new RangeError('Invalid journal ID.');
    this.#api = api;
    this.#journalId = journalId;
  }

  getState() {
    return this.#state === null ? null : structuredClone(this.#state);
  }

  async initialize() {
    this.#start();
    try {
      if (this.#state !== null) throw new Error('Live battle journal is already initialized.');
      const response = await this.#api.get(
        `${ENDPOINT}?action=snapshot&journal_id=${this.#journalId}`, { cacheMode: 'no-store' },
      );
      this.#ensureOpen();
      const snapshot = response?.snapshot;
      if (response?.success !== true || !isRecord(snapshot) || snapshot.schema_version !== 1
        || snapshot.journal_id !== this.#journalId || !Number.isSafeInteger(snapshot.tick)
        || snapshot.tick < 0 || !(snapshot.next_tick_at_utc === null
          || typeof snapshot.next_tick_at_utc === 'string')) {
        throw new Error('Invalid live battle snapshot.');
      }
      validateState(snapshot.state, snapshot.tick);
      this.#state = structuredClone(snapshot.state);
      return this.getState();
    } finally {
      this.#pending = false;
    }
  }

  /**
   * Apply one page atomically and return its ordered server events and snapshots.
   * The caller may call again while hasMore is true, or later to poll for new ticks.
   */
  async readNextPage(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Invalid page limit.');
    this.#start();
    try {
      if (this.#state === null) throw new Error('Live battle journal is not initialized.');
      const cursor = this.#state.tick;
      const response = await this.#api.get(
        `${ENDPOINT}?action=ticks&journal_id=${this.#journalId}&after_tick=${cursor}&limit=${limit}`,
        { cacheMode: 'no-store' },
      );
      this.#ensureOpen();
      const page = response?.page;
      if (response?.success !== true || !isRecord(page) || page.schema_version !== 1
        || page.journal_id !== this.#journalId || !Number.isSafeInteger(page.latest_tick)
        || page.latest_tick < cursor || !Number.isSafeInteger(page.next_cursor)
        || !Array.isArray(page.ticks) || page.ticks.length > limit || typeof page.has_more !== 'boolean'
        || page.next_cursor !== cursor + page.ticks.length || page.next_cursor > page.latest_tick
        || page.has_more !== (page.next_cursor < page.latest_tick)
        || (page.has_more && page.ticks.length !== limit)) {
        throw new Error('Invalid live battle tick page.');
      }
      let previous = this.#state;
      for (const [index, item] of page.ticks.entries()) {
        const tick = cursor + index + 1;
        if (!isRecord(item) || item.tick !== tick || !Array.isArray(item.events)
          || item.events.some((event) => !isRecord(event) || event.tick !== tick)
          || previous.status !== 'active') {
          throw new Error('Invalid or noncontiguous live battle tick.');
        }
        validateState(item.state, tick);
        previous = item.state;
      }
      const ticks = structuredClone(page.ticks);
      const state = structuredClone(previous);
      this.#state = state;
      return { ticks, latestTick: page.latest_tick, nextCursor: page.next_cursor, hasMore: page.has_more };
    } finally {
      this.#pending = false;
    }
  }

  dispose() {
    this.#disposed = true;
    this.#state = null;
  }

  #ensureOpen() {
    if (this.#disposed) throw new Error('Live battle journal client is disposed.');
  }

  #start() {
    this.#ensureOpen();
    if (this.#pending) throw new Error('A live battle request is already in progress.');
    this.#pending = true;
  }
}
