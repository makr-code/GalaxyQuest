/**
 * RuntimeFooterNetworkStatus.js
 *
 * Footer load progress + network health probe UI state.
 */

'use strict';

(function () {
  const state = {
    footerLoadUi: {
      root: null,
      badge: null,
      bar: null,
      pct: null,
      queue: null,
      net: null,
      label: null,
    },
    footerNetwork: {
      lastProbeAt: 0,
      inFlight: false,
      kind: 'unknown',
    },
    getApi: () => null,
    getNavigator: () => (typeof navigator !== 'undefined' ? navigator : null),
    logger: null,
  };

  function configureFooterNetworkStatusRuntime(opts = {}) {
    const {
      documentRef = (typeof document !== 'undefined' ? document : null),
      getApi = null,
      getNavigator = null,
      logger = null,
    } = opts;

    state.footerLoadUi = {
      root: documentRef?.getElementById?.('footer-load') || null,
      badge: documentRef?.getElementById?.('footer-load-badge') || null,
      bar: documentRef?.getElementById?.('footer-load-bar') || null,
      pct: documentRef?.getElementById?.('footer-load-pct') || null,
      queue: documentRef?.getElementById?.('footer-load-queue') || null,
      net: documentRef?.getElementById?.('footer-network-status') || null,
      label: documentRef?.getElementById?.('footer-load-label') || null,
    };

    state.footerNetwork.lastProbeAt = 0;
    state.footerNetwork.inFlight = false;
    state.footerNetwork.kind = 'unknown';
    state.getApi = typeof getApi === 'function' ? getApi : () => null;
    state.getNavigator = typeof getNavigator === 'function'
      ? getNavigator
      : () => (typeof navigator !== 'undefined' ? navigator : null);
    state.logger = logger;
  }

  function applyFooterLoadBadgeState(kind = 'unknown', active = false) {
    const badge = state.footerLoadUi.badge;
    if (!badge) return;

    badge.classList.remove(
      'footer-load-badge-ok',
      'footer-load-badge-warn',
      'footer-load-badge-bad',
      'footer-load-badge-idle'
    );

    if (!active) {
      badge.classList.add('footer-load-badge-idle');
      return;
    }

    const normalized = String(kind || 'unknown');
    if (normalized === 'offline' || normalized === 'unreachable') {
      badge.classList.add('footer-load-badge-bad');
      return;
    }
    if (normalized === 'timeout' || normalized === 'auth' || normalized === 'http') {
      badge.classList.add('footer-load-badge-warn');
      return;
    }
    badge.classList.add('footer-load-badge-ok');
  }

  function setFooterNetworkStatus(kind = 'unknown', latencyMs = 0, status = 0) {
    const node = state.footerLoadUi.net;
    if (!node) return;

    node.classList.remove('footer-net-ok', 'footer-net-warn', 'footer-net-bad', 'footer-net-unknown');

    const latency = Math.max(0, Number(latencyMs || 0));
    const httpStatus = Math.max(0, Number(status || 0));
    const k = String(kind || 'unknown');
    state.footerNetwork.kind = k;
    applyFooterLoadBadgeState(k, !state.footerLoadUi.root?.classList.contains('hidden'));

    if (k === 'ok') {
      node.textContent = `NET: ${latency}ms`;
      node.classList.add('footer-net-ok');
      return;
    }
    if (k === 'offline') {
      node.textContent = 'NET: offline';
      node.classList.add('footer-net-bad');
      return;
    }
    if (k === 'timeout') {
      node.textContent = 'NET: timeout';
      node.classList.add('footer-net-warn');
      return;
    }
    if (k === 'unreachable') {
      node.textContent = 'NET: unreachable';
      node.classList.add('footer-net-bad');
      return;
    }
    if (k === 'auth') {
      node.textContent = httpStatus > 0 ? `NET: auth ${httpStatus}` : 'NET: auth';
      node.classList.add('footer-net-warn');
      return;
    }
    if (k === 'http') {
      node.textContent = httpStatus > 0 ? `NET: HTTP ${httpStatus}` : 'NET: HTTP';
      node.classList.add('footer-net-warn');
      return;
    }

    node.textContent = 'NET: ?';
    node.classList.add('footer-net-unknown');
  }

  async function refreshFooterNetworkStatus(force = false) {
    if (state.footerNetwork.inFlight) return;
    const api = state.getApi();
    if (typeof api?.networkHealth !== 'function') {
      setFooterNetworkStatus('unknown');
      return;
    }

    const now = Date.now();
    if (!force && (now - state.footerNetwork.lastProbeAt) < 5000) return;

    state.footerNetwork.inFlight = true;
    state.footerNetwork.lastProbeAt = now;
    try {
      const health = await api.networkHealth(!!force);
      const kind = String(health?.kind || (health?.ok ? 'ok' : 'unknown'));
      const latencyMs = Number(health?.latencyMs || 0);
      const status = Number(health?.status || 0);
      setFooterNetworkStatus(kind, latencyMs, status);
    } catch (err) {
      state.logger?.('warn', 'Footer-Netzwerkstatus Probe fehlgeschlagen', err);
      const nav = state.getNavigator();
      setFooterNetworkStatus(nav?.onLine === false ? 'offline' : 'unknown');
    } finally {
      state.footerNetwork.inFlight = false;
    }
  }

  function setFooterLoadProgress(detail = {}) {
    const root = state.footerLoadUi.root;
    const badge = state.footerLoadUi.badge;
    const bar = state.footerLoadUi.bar;
    const pct = state.footerLoadUi.pct;
    const queue = state.footerLoadUi.queue;
    const net = state.footerLoadUi.net;
    const label = state.footerLoadUi.label;
    if (!root || !bar || !pct || !queue || !label) return;

    const active = !!detail.active;
    const progress = Math.max(0, Math.min(1, Number(detail.progress || 0)));
    const percent = Math.round(progress * 100);
    const pending = Math.max(0, Number(detail.pending || 0));
    const queued = Math.max(0, Number(detail.queued || 0));
    const inFlight = Math.max(0, Number(detail.inFlight || 0));
    const concurrency = Math.max(0, Number(detail.concurrency || 0));

    if (!active && percent <= 0) {
      root.classList.add('hidden');
      badge?.classList.add('hidden');
      applyFooterLoadBadgeState(state.footerNetwork.kind, false);
      bar.style.width = '0%';
      pct.textContent = '0%';
      queue.textContent = 'Q:0|F:0|C:0';
      if (net && !net.textContent) {
        net.textContent = 'NET: ?';
      }
      label.textContent = 'Bereit';
      return;
    }

    root.classList.remove('hidden');
    if (badge) {
      badge.classList.remove('hidden');
      badge.textContent = pending > 1
        ? `Nachladen ${pending}`
        : (queued > 0 || inFlight > 0 ? 'Nachladen' : 'Sync');
    }
    applyFooterLoadBadgeState(state.footerNetwork.kind, true);
    bar.style.width = `${percent}%`;
    pct.textContent = `${percent}%`;
    queue.textContent = `Q:${queued}|F:${inFlight}|C:${concurrency}`;
    label.textContent = detail.label
      ? String(detail.label)
      : (pending > 1 ? `Lade Daten (${pending})...` : 'Lade Daten...');

    refreshFooterNetworkStatus(false);
  }

  const api = {
    configureFooterNetworkStatusRuntime,
    setFooterLoadProgress,
    setFooterNetworkStatus,
    refreshFooterNetworkStatus,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeFooterNetworkStatus = api;
  }
})();