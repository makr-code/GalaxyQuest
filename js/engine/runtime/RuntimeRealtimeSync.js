/**
 * RuntimeRealtimeSync.js
 *
 * Manages SSE updates and fallback polling/ticker loops.
 *
 * EventBus integration
 * ─────────────────────
 * When an `eventBus` is passed to configureRealtimeSyncRuntime(), each SSE
 * event is also published on the bus under a canonical name so that engine
 * subsystems (e.g. CombatVfxBridge) can subscribe without touching the DOM.
 *
 *   sse:new_messages    — { unread, new }
 *   sse:fleet_arrived   — { mission, target, attacker, … }
 *   sse:fleet_returning — { mission, origin, … }
 *   sse:incoming_attack — { attacker, target, arrival_time, mission, … }
 *   sse:world_event     — { title_de, code, conclusion_key, … }
 *
 * Both the window CustomEvent path and the EventBus path are fired in
 * parallel, so existing listeners on window are not broken.
 */

'use strict';

(function () {
  const runtimeConfig = {
    windowRef: (typeof window !== 'undefined' ? window : null),
    documentRef: (typeof document !== 'undefined' ? document : null),
    onLoadBadge: async () => {},
    onLoadOverview: async () => {},
    invalidateGetCache: () => {},
    refreshWindow: () => {},
    getGalaxyRoot: () => null,
    refreshGalaxyDensityMetrics: () => {},
    showToast: () => {},
    gameLog: () => {},
    eventSourceFactory: null,
    /** @type {import('../EventBus').EventBus|null} Optional engine-level event bus */
    eventBus: null,
  };

  const tickerFleetArrived = new Set();
  const tickerWindowRefreshed = {};
  let initialized = false;

  function configureRealtimeSyncRuntime(options = {}) {
    Object.assign(runtimeConfig, options || {});
  }

  function applyMessageBadge(unread) {
    const badge = runtimeConfig.documentRef?.getElementById('msg-badge');
    if (!badge) return;
    if (unread > 0) {
      badge.textContent = String(unread);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function speakTts(text) {
    const windowRef = runtimeConfig.windowRef;
    const ttsApi = windowRef?.GQTTS || null;
    if (!ttsApi || typeof ttsApi.isAutoVoiceEnabled !== 'function' || typeof ttsApi.speak !== 'function') return;
    if (!ttsApi.isAutoVoiceEnabled()) return;
    const line = String(text || '').trim();
    if (!line) return;
    ttsApi.speak(line).catch(() => {});
  }

  function initSseListeners() {
    const windowRef = runtimeConfig.windowRef;
    if (!windowRef) return;
    if (!windowRef.EventSource && !runtimeConfig.eventSourceFactory) return;

    let eventSource;
    let reconnectDelay = 3000;
    const maxReconnectDelay = 60000;
    const createEventSource = runtimeConfig.eventSourceFactory || ((url) => new windowRef.EventSource(url));

    const connect = () => {
      eventSource = createEventSource('api/events.php');

      eventSource.addEventListener('connected', () => {
        reconnectDelay = 3000;
      });

      eventSource.addEventListener('new_messages', (event) => {
        try {
          const data = JSON.parse(event.data);
          const unread = parseInt(data.unread, 10) || 0;
          applyMessageBadge(unread);
          runtimeConfig.eventBus?.emit('sse:new_messages', data);
          if ((parseInt(data.new, 10) || 0) > 0) {
            runtimeConfig.showToast(`${data.new} new message${data.new > 1 ? 's' : ''}`, 'info');
            speakTts(data.new > 1 ? `${data.new} neue Nachrichten eingegangen.` : 'Neue Nachricht eingegangen.');
          }
        } catch (err) {
          runtimeConfig.gameLog('info', 'SSE new_messages handler fehlgeschlagen', err);
        }
      });

      eventSource.addEventListener('fleet_arrived', async (event) => {
        try {
          const data = JSON.parse(event.data);
          const mission = data.mission || '';
          const target = data.target || '';
          runtimeConfig.showToast(`Fleet arrived at ${target} (${mission})`, mission === 'attack' ? 'success' : 'info');
          windowRef.dispatchEvent(new CustomEvent('gq:fleet-arrived', { detail: data }));
          runtimeConfig.eventBus?.emit('sse:fleet_arrived', data);
          speakTts(`Flotte hat ${target} erreicht.`);
          await runtimeConfig.onLoadOverview();
          runtimeConfig.invalidateGetCache([/api\/fleet\.php/, /api\/game\.php/]);
          ['fleet', 'shipyard', 'buildings'].forEach((id) => runtimeConfig.refreshWindow(id));
        } catch (err) {
          runtimeConfig.gameLog('info', 'SSE fleet_arrived handler fehlgeschlagen', err);
        }
      });

      eventSource.addEventListener('fleet_returning', async (event) => {
        try {
          const data = JSON.parse(event.data);
          runtimeConfig.showToast(`Fleet returned home (${data.mission || ''})`, 'info');
          windowRef.dispatchEvent(new CustomEvent('gq:fleet-returning', { detail: data }));
          runtimeConfig.eventBus?.emit('sse:fleet_returning', data);
          speakTts('Flotte ist heimgekehrt.');
          await runtimeConfig.onLoadOverview();
          runtimeConfig.invalidateGetCache([/api\/fleet\.php/, /api\/game\.php/]);
          runtimeConfig.refreshWindow('fleet');
        } catch (err) {
          runtimeConfig.gameLog('info', 'SSE fleet_returning handler fehlgeschlagen', err);
        }
      });

      eventSource.addEventListener('incoming_attack', (event) => {
        try {
          const data = JSON.parse(event.data);
          const arrival = data.arrival_time ? new Date(data.arrival_time).toLocaleTimeString() : '?';
          const msg = data.mission === 'spy'
            ? `Spy fleet from ${data.attacker} inbound to ${data.target} (${arrival})`
            : `INCOMING ATTACK from ${data.attacker} to ${data.target} at ${arrival}!`;
          runtimeConfig.showToast(msg, 'danger');
          windowRef.dispatchEvent(new CustomEvent('gq:fleet-incoming-attack', { detail: data }));
          runtimeConfig.eventBus?.emit('sse:incoming_attack', data);
          const ttsText = data.mission === 'spy'
            ? `Achtung! Spionageflotte von ${data.attacker} im Anflug.`
            : `Warnung! Angriff von ${data.attacker} auf ${data.target} um ${arrival}!`;
          speakTts(ttsText);
        } catch (err) {
          runtimeConfig.gameLog('info', 'SSE incoming_attack handler fehlgeschlagen', err);
        }
      });

      eventSource.addEventListener('world_event', (event) => {
        try {
          const data = JSON.parse(event.data);
          const title = data.title_de || data.code || 'Galaxie-Ereignis';
          const isResolved = data.conclusion_key != null;
          const msg = isResolved
            ? `🌌 ${title} – Ergebnis: ${data.conclusion_key}`
            : `🌌 ${title} – Ein neues Szenario beginnt`;
          runtimeConfig.showToast(msg, 'info');
          windowRef.dispatchEvent(new CustomEvent('gq:world-event', { detail: data }));
          runtimeConfig.eventBus?.emit('sse:world_event', data);
          const ttsText = isResolved
            ? `${title}. Ergebnis: ${data.conclusion_key}.`
            : `${title}. Ein neues Galaxie-Szenario beginnt.`;
          speakTts(ttsText);
        } catch (err) {
          runtimeConfig.gameLog('info', 'SSE world_event handler fehlgeschlagen', err);
        }
      });

      eventSource.addEventListener('reconnect', () => {
        eventSource.close();
        windowRef.setTimeout(connect, 1000);
      });

      eventSource.onerror = () => {
        eventSource.close();
        reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
        windowRef.setTimeout(connect, reconnectDelay);
      };
    };

    connect();
  }

  function initTickersAndPolling() {
    const windowRef = runtimeConfig.windowRef;
    const documentRef = runtimeConfig.documentRef;

    windowRef.setInterval(() => {
      const nowMs = Date.now();

      documentRef.querySelectorAll('[data-end]:not([data-start])').forEach((el) => {
        const endRaw = el.dataset.end;
        const endTime = new Date(endRaw).getTime();
        if (!endTime || Number.isNaN(endTime)) return;
        const sec = Math.max(0, Math.floor((endTime - nowMs) / 1000));
        const h = String(Math.floor(sec / 3600)).padStart(2, '0');
        const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        const text = `${h}:${m}:${s}`;
        el.textContent = text;

        if (text === '00:00:00') {
          const win = el.closest('.wm-window[data-winid]');
          if (win) {
            const winId = win.dataset.winid;
            const last = tickerWindowRefreshed[winId] || 0;
            if (nowMs - last > 8000) {
              tickerWindowRefreshed[winId] = nowMs;
              runtimeConfig.refreshWindow(winId);
            }
          }
        }
      });

      documentRef.querySelectorAll('.progress-bar[data-start][data-end]').forEach((bar) => {
        const start = new Date(bar.dataset.start).getTime();
        const end = new Date(bar.dataset.end).getTime();
        const total = end - start;
        if (!total || total <= 0 || Number.isNaN(total)) return;
        const pct = Math.max(0, Math.min(100, ((nowMs - start) / total) * 100));
        bar.style.width = `${pct.toFixed(1)}%`;
      });

      documentRef.querySelectorAll('.fleet-progress-bar[data-dep][data-arr]').forEach((bar) => {
        const dep = new Date(bar.dataset.dep).getTime();
        const arr = new Date(bar.dataset.arr).getTime();
        const total = arr - dep;
        if (!total || total <= 0) return;
        const pct = Math.max(0, Math.min(100, ((nowMs - dep) / total) * 100));
        bar.style.width = `${pct.toFixed(1)}%`;
        if (pct >= 100 && !tickerFleetArrived.has(bar.dataset.arr)) {
          tickerFleetArrived.add(bar.dataset.arr);
          runtimeConfig.onLoadOverview();
          runtimeConfig.invalidateGetCache([/api\/fleet\.php/, /api\/game\.php/]);
          runtimeConfig.refreshWindow('fleet');
        }
      });
    }, 1000);

    windowRef.setInterval(async () => {
      await runtimeConfig.onLoadOverview();
      await runtimeConfig.onLoadBadge();
      ['buildings', 'research', 'shipyard'].forEach((id) => runtimeConfig.refreshWindow(id));
    }, 60000);

    windowRef.setInterval(async () => {
      await runtimeConfig.onLoadBadge();
    }, 30000);

    windowRef.setInterval(() => {
      const root = runtimeConfig.getGalaxyRoot();
      if (!root) return;
      runtimeConfig.refreshGalaxyDensityMetrics(root);
    }, 1500);
  }

  function initRealtimeSync() {
    if (initialized) return;
    initialized = true;
    initSseListeners();
    initTickersAndPolling();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { configureRealtimeSyncRuntime, initRealtimeSync };
  } else {
    window.GQRuntimeRealtimeSync = { configureRealtimeSyncRuntime, initRealtimeSync };
  }
})();