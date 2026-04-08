/**
 * fetch-event-source-adapter.test.js
 *
 * Tests for FetchEventSourceAdapter — the @microsoft/fetch-event-source
 * drop-in factory for RuntimeRealtimeSync.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { createFetchEventSourceFactory, buildFetchEventSourceAdapter } =
  require(path.join(root, 'js/engine/runtime/FetchEventSourceAdapter.js'));

// ---------------------------------------------------------------------------
// Fake fetchEventSource
// ---------------------------------------------------------------------------

function makeFakeFes() {
  const calls = [];
  const fes = vi.fn(async (url, opts) => {
    calls.push({ url, opts });
    // Simulate onopen immediately
    if (opts.onopen) {
      await opts.onopen({ ok: true, status: 200 });
    }
  });
  fes._calls = calls;
  return fes;
}

function makeFakeFetch() {
  return vi.fn();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createFetchEventSourceFactory', () => {
  it('returns a function', () => {
    const factory = createFetchEventSourceFactory();
    expect(typeof factory).toBe('function');
  });

  it('factory returns an object with addEventListener and close', () => {
    const fes = makeFakeFes();
    const factory = createFetchEventSourceFactory({ fetchEventSourceFn: fes, fetchFn: makeFakeFetch() });
    const adapter = factory('api/events.php');
    expect(typeof adapter.addEventListener).toBe('function');
    expect(typeof adapter.close).toBe('function');
  });
});

describe('buildFetchEventSourceAdapter', () => {
  it('calls fetchEventSource with the correct URL', () => {
    const fes = makeFakeFes();
    buildFetchEventSourceAdapter('api/events.php', { fetchEventSourceFn: fes, fetchFn: makeFakeFetch() });
    expect(fes).toHaveBeenCalledWith('api/events.php', expect.any(Object));
  });

  it('addEventListener registers a handler', () => {
    const fes = makeFakeFes();
    const adapter = buildFetchEventSourceAdapter('api/events.php', {
      fetchEventSourceFn: fes, fetchFn: makeFakeFetch(),
    });
    const handler = vi.fn();
    adapter.addEventListener('fleet_arrived', handler);
    // Simulate a message from the fes internals
    const opts = fes.mock.calls[0][1];
    opts.onmessage({ event: 'fleet_arrived', data: '{"mission":"attack"}' });
    expect(handler).toHaveBeenCalledWith({ event: 'fleet_arrived', data: '{"mission":"attack"}' });
  });

  it('close() calls abort on the AbortController', () => {
    const fes = makeFakeFes();
    const adapter = buildFetchEventSourceAdapter('api/events.php', {
      fetchEventSourceFn: fes, fetchFn: makeFakeFetch(),
    });
    const abortSpy = vi.spyOn(adapter._controller, 'abort');
    adapter.close();
    expect(abortSpy).toHaveBeenCalled();
  });

  it('passes signal from AbortController to fetchEventSource', () => {
    const fes = makeFakeFes();
    const adapter = buildFetchEventSourceAdapter('api/events.php', {
      fetchEventSourceFn: fes, fetchFn: makeFakeFetch(),
    });
    const opts = fes.mock.calls[0][1];
    expect(opts.signal).toBe(adapter._controller.signal);
  });

  it('uses GET method by default', () => {
    const fes = makeFakeFes();
    buildFetchEventSourceAdapter('api/events.php', {
      fetchEventSourceFn: fes, fetchFn: makeFakeFetch(),
    });
    const opts = fes.mock.calls[0][1];
    expect(opts.method).toBe('GET');
  });

  it('respects custom method option', () => {
    const fes = makeFakeFes();
    buildFetchEventSourceAdapter('api/events.php', {
      fetchEventSourceFn: fes, fetchFn: makeFakeFetch(), method: 'POST',
    });
    const opts = fes.mock.calls[0][1];
    expect(opts.method).toBe('POST');
  });

  it('fires "connected" handler on onopen with ok response', async () => {
    const fes = makeFakeFes();
    const adapter = buildFetchEventSourceAdapter('api/events.php', {
      fetchEventSourceFn: fes, fetchFn: makeFakeFetch(),
    });
    const connectedHandler = vi.fn();
    adapter.addEventListener('connected', connectedHandler);

    // Wait a tick for the async fes call
    await Promise.resolve();
    expect(connectedHandler).toHaveBeenCalled();
  });

  it('gracefully handles missing fetchEventSource (no crash)', () => {
    const adapter = buildFetchEventSourceAdapter('api/events.php', {
      fetchEventSourceFn: null, fetchFn: null,
    });
    expect(typeof adapter.addEventListener).toBe('function');
    expect(typeof adapter.close).toBe('function');
  });
});
