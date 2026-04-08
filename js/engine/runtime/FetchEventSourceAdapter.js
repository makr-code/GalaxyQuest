/**
 * FetchEventSourceAdapter.js
 *
 * Drop-in `eventSourceFactory` for RuntimeRealtimeSync.js that uses
 * `@microsoft/fetch-event-source` instead of the native `EventSource`.
 *
 * Advantages over native EventSource:
 *   - POST support (enables CSRF-token forwarding in the future)
 *   - AbortController-based cancellation per connection
 *   - Built-in retry with exponential back-off
 *   - Fine-grained onopen / onerror / onclose control
 *
 * The adapter returns an object that mimics the EventSource interface
 * (`addEventListener`, `close`) so that RuntimeRealtimeSync.js needs no
 * changes beyond swapping the factory.
 *
 * Usage (in RuntimeRealtimeSyncSetup.js or game.js):
 *
 *   import { createFetchEventSourceFactory } from './FetchEventSourceAdapter.js';
 *
 *   setupRealtimeSync({
 *     ...
 *     eventSourceFactory: createFetchEventSourceFactory(),
 *   });
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Dependency resolution — ESM-first, then CJS fallback for tests.
// ---------------------------------------------------------------------------

let _fetchEventSource;

if (typeof require !== 'undefined') {
  try {
    _fetchEventSource = require('@microsoft/fetch-event-source').fetchEventSource;
  } catch (_) {
    _fetchEventSource = null;
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Build a `fetchEventSource`-backed EventSource-like object.
 *
 * @param {string} url              — SSE endpoint URL
 * @param {object} [opts]
 * @param {object} [opts.headers]   — Extra HTTP request headers
 * @param {string} [opts.method='GET'] — HTTP method (GET or POST)
 * @param {string|null} [opts.body] — Request body (for POST)
 * @param {Function} [opts.fetchFn] — Fetch implementation (default: globalThis.fetch)
 * @param {Function} [opts.fetchEventSourceFn] — Override fetchEventSource (for testing)
 * @returns {EventSourceLike}
 */
function buildFetchEventSourceAdapter(url, opts = {}) {
  const controller = new AbortController();
  const handlers = {};
  let closed = false;
  let connected = false;

  const fetchFn = opts.fetchFn ?? (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  const fes = opts.fetchEventSourceFn ?? _fetchEventSource;

  if (fes && fetchFn) {
    fes(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers ?? {},
      body: opts.body ?? undefined,
      signal: controller.signal,
      fetch: fetchFn,

      onopen(response) {
        if (response.ok) {
          connected = true;
          const h = handlers['connected'];
          if (h) h({ data: '{}' });
        }
      },

      onmessage(ev) {
        const h = handlers[ev.event ?? 'message'];
        if (h) h(ev);
      },

      onclose() {
        // Connection closed cleanly — no reconnect needed (lib handles it).
      },

      onerror(err) {
        if (closed) throw err; // propagate to stop retries after close()
        // Re-throw to let fetchEventSource apply its own retry logic.
        throw err;
      },
    }).catch(() => {});
  }

  return {
    /** @type {AbortController} — exposed for testing */
    _controller: controller,

    addEventListener(type, handler) {
      handlers[type] = handler;
      if (type === 'connected' && connected) {
        try { handler({ data: '{}' }); } catch (_) {}
      }
    },

    close() {
      closed = true;
      controller.abort();
    },

    get onerror() { return null; },
    set onerror(_fn) { /* not used — errors are handled internally */ },
  };
}

/**
 * Create an `eventSourceFactory` function compatible with
 * `configureRealtimeSyncRuntime({ eventSourceFactory })`.
 *
 * @param {object} [defaultOpts]  — Default options forwarded to every connection
 * @returns {function(url: string): EventSourceLike}
 */
function createFetchEventSourceFactory(defaultOpts = {}) {
  return (url) => buildFetchEventSourceAdapter(url, defaultOpts);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createFetchEventSourceFactory, buildFetchEventSourceAdapter };
} else {
  window.GQFetchEventSourceAdapter = { createFetchEventSourceFactory, buildFetchEventSourceAdapter };
}
