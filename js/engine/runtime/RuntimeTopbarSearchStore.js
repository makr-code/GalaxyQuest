/**
 * RuntimeTopbarSearchStore.js
 *
 * Store factory for topbar search state and debounce handling.
 */

'use strict';

(function () {
  function createTopbarSearchStore(options = {}) {
    const windowRef = options.windowRef || window;

    return {
      query: '',
      localResults: [],
      serverResults: [],
      open: false,
      serverPending: false,
      debounceId: 0,
      requestToken: 0,
      maxLocal: Math.max(1, Number(options.maxLocal || 10)),
      maxServer: Math.max(1, Number(options.maxServer || 18)),

      nextToken(query) {
        this.query = String(query || '').trim();
        this.requestToken += 1;
        return this.requestToken;
      },

      matchesToken(token) {
        return Number(token || 0) === Number(this.requestToken || 0);
      },

      setLocalResults(rows) {
        this.localResults = Array.isArray(rows) ? rows : [];
      },

      setServerResults(rows) {
        this.serverResults = Array.isArray(rows) ? rows : [];
      },

      setServerPending(flag) {
        this.serverPending = !!flag;
      },

      openOverlay() {
        this.open = true;
      },

      closeOverlay() {
        this.open = false;
      },

      reset() {
        this.query = '';
        this.localResults = [];
        this.serverResults = [];
        this.serverPending = false;
        this.closeOverlay();
      },

      clearDebounce() {
        if (!this.debounceId) return;
        clearTimeout(this.debounceId);
        this.debounceId = 0;
      },

      queueServerFetch(run, delayMs = 260) {
        this.clearDebounce();
        this.debounceId = windowRef.setTimeout(async () => {
          this.debounceId = 0;
          await run();
        }, delayMs);
      },

      firstCandidate() {
        return this.localResults[0] || this.serverResults[0] || null;
      },
    };
  }

  const api = {
    createTopbarSearchStore,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeTopbarSearchStore = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();