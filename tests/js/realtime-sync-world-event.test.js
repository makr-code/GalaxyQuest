/**
 * realtime-sync-world-event.test.js
 *
 * Tests for the SSE world_event handler added to RuntimeRealtimeSync.js.
 *
 * The module is an IIFE that writes to window.GQRuntimeRealtimeSync.
 * We load it with eval() and wire up a synthetic EventSource mock so we
 * can fire test events directly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ── Load helpers ─────────────────────────────────────────────────────────────

const modulePath = path.resolve(
  process.cwd(),
  'js/engine/runtime/RuntimeRealtimeSync.js'
);

function loadModule() {
  delete window.GQRuntimeRealtimeSync;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeRealtimeSync;
}

// ── Synthetic EventSource ─────────────────────────────────────────────────────

class FakeEventSource {
  constructor() {
    this._handlers = {};
    this.onerror = null;
  }

  addEventListener(type, handler) {
    this._handlers[type] = handler;
  }

  /** Fire a synthetic event with JSON payload. */
  emit(type, data) {
    const handler = this._handlers[type];
    if (handler) {
      handler({ data: JSON.stringify(data) });
    }
  }

  close() {}
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RuntimeRealtimeSync – world_event SSE handler', () => {
  let mod;
  let fakeEs;
  let toastCalls;
  let dispatchedEvents;

  beforeEach(() => {
    mod = loadModule();
    fakeEs = new FakeEventSource();
    toastCalls = [];
    dispatchedEvents = [];

    window.addEventListener('gq:world-event', (ev) => {
      dispatchedEvents.push(ev.detail);
    });

    mod.configureRealtimeSyncRuntime({
      windowRef: window,
      documentRef: document,
      eventSourceFactory: () => fakeEs,
      showToast: (msg, type) => toastCalls.push({ msg, type }),
      onLoadOverview: async () => {},
      onLoadBadge: async () => {},
      invalidateGetCache: () => {},
      refreshWindow: () => {},
      getGalaxyRoot: () => null,
      refreshGalaxyDensityMetrics: () => {},
      gameLog: () => {},
    });

    // initRealtimeSync is guarded by an initialized flag; reset it
    // by reloading the module fresh (already done in loadModule above).
    mod.initRealtimeSync();
  });

  it('fires a toast notification for a scenario start event', () => {
    fakeEs.emit('world_event', {
      event_id: 1,
      code: 'iron_fleet_global_council',
      title_de: 'Eisenflotte schlägt Galaktischen Rat vor',
      phase: 0,
      conclusion_key: null,
      ends_at: '2026-04-08 10:00:00',
      flavor_text: null,
    });

    expect(toastCalls.length).toBe(1);
    expect(toastCalls[0].msg).toContain('Eisenflotte schlägt Galaktischen Rat vor');
    expect(toastCalls[0].msg).toContain('neues Szenario');
    expect(toastCalls[0].type).toBe('info');
  });

  it('fires a toast notification for a scenario conclusion event', () => {
    fakeEs.emit('world_event', {
      event_id: 2,
      code: 'iron_fleet_global_council',
      title_de: 'Eisenflotte schlägt Galaktischen Rat vor',
      phase: 2,
      conclusion_key: 'internal_collapse',
      ends_at: '2026-04-08 10:00:00',
      flavor_text: 'Der Generalstab zieht die Initiative still zurück.',
    });

    expect(toastCalls.length).toBe(1);
    expect(toastCalls[0].msg).toContain('internal_collapse');
    expect(toastCalls[0].msg).toContain('Ergebnis');
    expect(toastCalls[0].type).toBe('info');
  });

  it('dispatches a gq:world-event CustomEvent on the window', () => {
    const payload = {
      event_id: 3,
      code: 'iron_fleet_global_council',
      title_de: 'Test',
      phase: 1,
      conclusion_key: null,
      ends_at: '2026-04-08 10:00:00',
      flavor_text: null,
    };

    fakeEs.emit('world_event', payload);

    expect(dispatchedEvents.length).toBe(1);
    expect(dispatchedEvents[0].event_id).toBe(3);
    expect(dispatchedEvents[0].code).toBe('iron_fleet_global_council');
  });

  it('does not crash on malformed JSON in world_event', () => {
    const handler = fakeEs._handlers['world_event'];
    expect(handler).toBeDefined();
    // Fire with bad JSON – should not throw
    expect(() => handler({ data: 'not-json!!!' })).not.toThrow();
    // Toast should not have been called
    expect(toastCalls.length).toBe(0);
  });

  it('uses the code as fallback title when title_de is missing', () => {
    fakeEs.emit('world_event', {
      event_id: 4,
      code: 'mysterious_scenario',
      title_de: '',
      phase: 0,
      conclusion_key: null,
      ends_at: '2026-04-09 00:00:00',
      flavor_text: null,
    });

    expect(toastCalls.length).toBe(1);
    expect(toastCalls[0].msg).toContain('mysterious_scenario');
  });

  it('uses generic fallback label when both title_de and code are empty', () => {
    fakeEs.emit('world_event', {
      event_id: 5,
      code: '',
      title_de: '',
      phase: 0,
      conclusion_key: null,
      ends_at: '2026-04-09 00:00:00',
      flavor_text: null,
    });

    expect(toastCalls.length).toBe(1);
    expect(toastCalls[0].msg).toContain('Galaxie-Ereignis');
  });
});
