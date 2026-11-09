function isTransient(error) {
  const status = error?.status;
  if (Number.isInteger(status) && status > 0) {
    return status === 408 || status === 429 || status >= 500;
  }
  return /failed to fetch|networkerror|network error|load failed|timeout|temporarily unavailable/i
    .test(String(error?.message ?? ''));
}

/**
 * Owns one pull client. The returned run promise rejects on fatal errors;
 * callbacks are awaited and must complete successfully before another page.
 */
export class LiveBattleJournalPoller {
  #client;
  #onSnapshot;
  #onPage;
  #onError;
  #interval;
  #pageLimit;
  #pagesPerCycle;
  #maxRetries;
  #running = false;
  #stopped = false;
  #timer = null;
  #wake = null;

  constructor(client, {
    onSnapshot, onPage, onError, intervalMs = 1000, pageLimit = 50, pagesPerCycle = 4, maxRetries = 5,
  } = {}) {
    if (!client || typeof client.initialize !== 'function' || typeof client.readNextPage !== 'function'
      || typeof client.getState !== 'function' || typeof client.dispose !== 'function') {
      throw new TypeError('A live battle journal client is required.');
    }
    if (![onSnapshot, onPage, onError].every((callback) => typeof callback === 'function')) {
      throw new TypeError('Snapshot, page and error callbacks are required.');
    }
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 30000
      || !Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 100
      || !Number.isSafeInteger(pagesPerCycle) || pagesPerCycle < 1 || pagesPerCycle > 10
      || !Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
      throw new RangeError('Invalid live battle polling settings.');
    }
    this.#client = client;
    this.#onSnapshot = onSnapshot;
    this.#onPage = onPage;
    this.#onError = onError;
    this.#interval = intervalMs;
    this.#pageLimit = pageLimit;
    this.#pagesPerCycle = pagesPerCycle;
    this.#maxRetries = maxRetries;
  }

  run() {
    if (this.#running || this.#stopped) throw new Error('Live battle poller cannot be started again.');
    this.#running = true;
    return this.#run();
  }

  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#client.dispose();
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
      this.#wake();
    }
  }

  async #run() {
    let failures = 0;
    let initialized = false;
    let pages = 0;
    try {
      while (!this.#stopped) {
        let value;
        try {
          value = initialized
            ? await this.#client.readNextPage(this.#pageLimit)
            : await this.#client.initialize();
        } catch (error) {
          if (this.#stopped) return;
          failures++;
          const retry = isTransient(error) && failures <= this.#maxRetries;
          const delay = retry ? Math.min(30000, this.#interval * (2 ** (failures - 1))) : null;
          await this.#onError({ error, attempt: failures, retryInMs: delay });
          if (!retry) throw error;
          if (!this.#stopped) await this.#wait(delay);
          continue;
        }
        if (this.#stopped) return;
        failures = 0;
        if (!initialized) {
          initialized = true;
          await this.#onSnapshot(value);
        } else {
          await this.#onPage(value);
          pages++;
        }
        if (this.#stopped) return;
        if (this.#client.getState().status === 'resolved') return;
        if (initialized && value?.hasMore && pages < this.#pagesPerCycle) continue;
        pages = 0;
        await this.#wait(this.#interval);
      }
    } finally {
      this.stop();
    }
  }

  #wait(delay) {
    return new Promise((resolve) => {
      this.#wake = resolve;
      this.#timer = setTimeout(() => {
        this.#timer = null;
        this.#wake = null;
        resolve();
      }, delay);
    });
  }
}
