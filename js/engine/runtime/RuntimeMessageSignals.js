/**
 * RuntimeMessageSignals.js
 *
 * Unread-message signal rings: DOM layer creation, level classification,
 * and inbox-driven update logic.
 */

'use strict';

(function () {
  const state = {
    host: null,
    rings: Object.create(null),
    levelLabel: {
      danger: 'Gefahr',
      success: 'Erfolg',
      info: 'Info',
    },
    levelPriority: {
      danger: 3,
      success: 2,
      info: 1,
    },
    unreadIds: new Set(),
    unreadByLevel: { danger: 0, success: 0, info: 0 },
    flashUntilByLevel: { danger: 0, success: 0, info: 0 },
    bootstrapped: false,
    documentRef: (typeof document !== 'undefined' ? document : null),
  };

  function configureMessageSignalsRuntime(opts = {}) {
    const {
      documentRef = (typeof document !== 'undefined' ? document : null),
    } = opts;
    state.documentRef = documentRef || null;
  }

  function ensureMessageSignalLayer() {
    const doc = state.documentRef;
    if (!doc) return null;
    if (state.host && doc.body.contains(state.host)) {
      return state.host;
    }
    const host = doc.createElement('aside');
    host.id = 'global-message-signals';
    host.className = 'global-message-signals hidden';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-label', 'Nachrichten-Signale');

    const levels = [
      { key: 'danger', label: 'Gefahr', colorClass: 'danger' },
      { key: 'success', label: 'Erfolg', colorClass: 'success' },
      { key: 'info', label: 'Info', colorClass: 'info' },
    ];
    levels.forEach((level) => {
      const ring = doc.createElement('div');
      ring.className = `message-signal-ring ${level.colorClass}`;
      ring.setAttribute('data-level', level.key);
      ring.setAttribute('title', `${level.label}-Meldungen`);
      ring.innerHTML = `
        <span class="ring-core"></span>
        <span class="ring-wave"></span>
        <span class="ring-wave delay"></span>
        <span class="ring-count">0</span>
      `;
      host.appendChild(ring);
      state.rings[level.key] = ring;
    });

    doc.body.appendChild(host);
    state.host = host;
    return host;
  }

  function classifyMessageSignalLevel(message) {
    const subject = String(message?.subject || '').toLowerCase();
    const body = String(message?.body || '').toLowerCase();
    const text = `${subject} ${body}`;

    const dangerPattern = /(attacked|attack|battle|raid|defeat|defeated|under attack|hostile|war|lost|alarm|danger|failed|gescheitert|angegriffen|verloren|niederlage)/i;
    const successPattern = /(complete|completed|established|finished|success|reward|quest completed|repelled|fertig|abgeschlossen|errichtet|gebaut|erfolgreich|gewonnen)/i;

    if (dangerPattern.test(text)) return 'danger';
    if (successPattern.test(text)) return 'success';
    return 'info';
  }

  function updateMessageSignalsFromInbox(messages) {
    const host = ensureMessageSignalLayer();
    if (!host) return;
    const now = Date.now();
    const list = Array.isArray(messages) ? messages : [];
    const unread = list.filter((message) => !parseInt(message?.is_read, 10));
    const unreadByLevel = { danger: 0, success: 0, info: 0 };
    const nextUnreadIds = new Set();

    unread.forEach((message) => {
      const id = Number(message?.id || 0);
      if (id > 0) nextUnreadIds.add(id);
      const level = classifyMessageSignalLevel(message);
      unreadByLevel[level] += 1;
    });

    if (!state.bootstrapped) {
      state.unreadIds = nextUnreadIds;
      state.unreadByLevel = unreadByLevel;
      state.bootstrapped = true;
    } else {
      unread.forEach((message) => {
        const id = Number(message?.id || 0);
        if (id <= 0 || state.unreadIds.has(id)) return;
        const level = classifyMessageSignalLevel(message);
        state.flashUntilByLevel[level] = Math.max(
          Number(state.flashUntilByLevel[level] || 0),
          now + 14000
        );
      });
      state.unreadIds = nextUnreadIds;
      state.unreadByLevel = unreadByLevel;
    }

    let activeAny = false;
    let dominantLevel = '';
    let dominantScore = -1;
    ['danger', 'success', 'info'].forEach((level) => {
      const ring = state.rings[level];
      if (!ring) return;
      const unreadCount = Number(unreadByLevel[level] || 0);
      const flashing = now < Number(state.flashUntilByLevel[level] || 0);
      const active = unreadCount > 0 || flashing;
      const score = (Number(state.levelPriority[level] || 0) * 1000) + (unreadCount * 10) + (flashing ? 1 : 0);
      ring.classList.toggle('active', active);
      ring.classList.toggle('flash', flashing);
      const countEl = ring.querySelector('.ring-count');
      if (countEl) countEl.textContent = String(Math.max(0, unreadCount));
      const label = String(state.levelLabel[level] || level);
      ring.setAttribute('title', `${label}: ${unreadCount} ungelesen`);
      ring.style.order = String(10 - Number(state.levelPriority[level] || 0));
      if (active && score > dominantScore) {
        dominantScore = score;
        dominantLevel = level;
      }
      activeAny = activeAny || active;
    });

    ['danger', 'success', 'info'].forEach((level) => {
      const ring = state.rings[level];
      if (!ring) return;
      ring.classList.toggle('dominant', activeAny && level === dominantLevel);
    });

    host.classList.toggle('danger-priority', dominantLevel === 'danger');
    host.classList.toggle('hidden', !activeAny);
  }

  const api = {
    configureMessageSignalsRuntime,
    updateMessageSignalsFromInbox,
    classifyMessageSignalLevel,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMessageSignals = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
