/**
 * RuntimeGalaxyDebugLog.js
 *
 * Galaxy loading/render debug log state + UI helpers.
 */

'use strict';

(function () {
  const state = {
    maxEntries: 6,
    entries: [],
    wm: null,
    esc: (value) => String(value || ''),
    showToast: null,
    documentRef: (typeof document !== 'undefined' ? document : null),
    navigatorRef: (typeof navigator !== 'undefined' ? navigator : null),
  };

  function configureGalaxyDebugLogRuntime(opts = {}) {
    const {
      wm = null,
      esc = null,
      showToast = null,
      documentRef = (typeof document !== 'undefined' ? document : null),
      navigatorRef = (typeof navigator !== 'undefined' ? navigator : null),
      maxEntries = 6,
    } = opts;

    state.wm = wm || null;
    state.esc = typeof esc === 'function' ? esc : ((value) => String(value || ''));
    state.showToast = typeof showToast === 'function' ? showToast : null;
    state.documentRef = documentRef || null;
    state.navigatorRef = navigatorRef || null;
    state.maxEntries = Math.max(1, Number(maxEntries || 6));
  }

  function pushGalaxyDebugError(source, message, extra = '') {
    const src = String(source || 'unknown');
    const msg = String(message || 'unknown error');
    const ex = String(extra || '');

    state.entries.unshift({
      ts: Date.now(),
      source: src,
      message: msg,
      extra: ex,
    });
    state.entries = state.entries.slice(0, state.maxEntries);
    renderGalaxyDebugPanel();
  }

  function renderGalaxyDebugPanel(rootRef = null) {
    const root = rootRef || state.wm?.body?.('galaxy');
    const log = root?.querySelector?.('#galaxy-debug-log');
    if (!log) return;

    if (!state.entries.length) {
      log.innerHTML = '<div class="galaxy-debug-empty">Keine aktuellen Lade-/Renderfehler.</div>';
      return;
    }

    log.innerHTML = state.entries.map((entry) => {
      const time = new Date(entry.ts).toLocaleTimeString();
      const extra = entry.extra ? `<div class="galaxy-debug-extra">${state.esc(entry.extra)}</div>` : '';
      return `<div class="galaxy-debug-item">
        <div class="galaxy-debug-head"><span class="galaxy-debug-time">${state.esc(time)}</span><span class="galaxy-debug-source">${state.esc(entry.source)}</span></div>
        <div class="galaxy-debug-msg">${state.esc(entry.message)}</div>
        ${extra}
      </div>`;
    }).join('');
  }

  async function copyLastGalaxyDebugError() {
    const last = state.entries[0] || null;
    if (!last) {
      state.showToast?.('Kein Fehler zum Kopieren vorhanden.', 'info');
      return;
    }

    const payload = `[${new Date(last.ts).toISOString()}] ${last.source}: ${last.message}${last.extra ? ` | ${last.extra}` : ''}`;
    try {
      if (state.navigatorRef?.clipboard?.writeText) {
        await state.navigatorRef.clipboard.writeText(payload);
      } else if (state.documentRef) {
        const ta = state.documentRef.createElement('textarea');
        ta.value = payload;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.left = '-10000px';
        state.documentRef.body.appendChild(ta);
        ta.select();
        state.documentRef.execCommand('copy');
        state.documentRef.body.removeChild(ta);
      }
      state.showToast?.('Letzter Fehler in Zwischenablage kopiert.', 'success');
    } catch (err) {
      console.error('[GQ] copyLastGalaxyDebugError failed', err);
      state.showToast?.('Kopieren fehlgeschlagen.', 'warning');
    }
  }

  function clearGalaxyDebugErrors() {
    state.entries = [];
    renderGalaxyDebugPanel();
    state.showToast?.('Galaxy-Debuglog geleert.', 'info');
  }

  function downloadGalaxyDebugLog() {
    if (!state.entries.length) {
      state.showToast?.('Kein Debuglog zum Download vorhanden.', 'info');
      return;
    }

    const lines = state.entries
      .slice()
      .reverse()
      .map((entry) => {
        const stamp = new Date(entry.ts).toISOString();
        const extra = entry.extra ? ` | ${entry.extra}` : '';
        return `[${stamp}] ${entry.source}: ${entry.message}${extra}`;
      });

    const content = lines.join('\n') + '\n';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const fileName = `gq-galaxy-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;

    try {
      const url = URL.createObjectURL(blob);
      const link = state.documentRef?.createElement?.('a');
      if (!link || !state.documentRef?.body) {
        throw new Error('document unavailable');
      }
      link.href = url;
      link.download = fileName;
      state.documentRef.body.appendChild(link);
      link.click();
      state.documentRef.body.removeChild(link);
      URL.revokeObjectURL(url);
      state.showToast?.('Debuglog heruntergeladen.', 'success');
    } catch (err) {
      console.error('[GQ] downloadGalaxyDebugLog failed', err);
      state.showToast?.('Download des Debuglogs fehlgeschlagen.', 'warning');
    }
  }

  const api = {
    configureGalaxyDebugLogRuntime,
    pushGalaxyDebugError,
    renderGalaxyDebugPanel,
    copyLastGalaxyDebugError,
    clearGalaxyDebugErrors,
    downloadGalaxyDebugLog,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeGalaxyDebugLog = api;
  }
})();
