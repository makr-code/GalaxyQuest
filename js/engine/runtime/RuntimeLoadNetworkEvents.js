/**
 * RuntimeLoadNetworkEvents.js
 *
 * Registers load/network window events and forwards them into runtime flows.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

(function () {
  function bindRuntimeWindowEvent(runtimeCore, name, handler, runtimeEventName) {
    if (runtimeCore && typeof runtimeCore.bindWindowEvent === 'function') {
      return runtimeCore.bindWindowEvent(name, handler, runtimeEventName);
    }
    window.addEventListener(name, handler);
    return () => window.removeEventListener(name, handler);
  }

  function shouldRedirectOnAuthLoadError(endpoint = '', context = '') {
    const ep = String(endpoint || '').toLowerCase();
    const cx = String(context || '').toLowerCase();
    if (!ep && !cx) return true;

    const coreEndpointPatterns = [
      /api\/(v1\/)?auth\.php\?action=me/i,
      /api\/(v1\/)?game\.php\?/i,
      /api\/(v1\/)?galaxy\.php\?/i,
    ];
    if (coreEndpointPatterns.some((re) => re.test(ep))) {
      return true;
    }

    const coreContextPatterns = [
      /auth|session|bootstrap|overview|galaxy/i,
    ];
    if (coreContextPatterns.some((re) => re.test(cx))) {
      return true;
    }

    return false;
  }

  function registerLoadAndNetworkRuntimeEvents(opts = {}) {
    const {
      runtimeCore = null,
      setFooterLoadProgress = () => {},
      pushGalaxyDebugError = () => {},
      showToast = () => {},
      setFooterNetworkStatus = () => {},
      refreshFooterNetworkStatus = () => {},
      redirectToLogin = () => {},
      getLastLoadErrorToastAt = () => 0,
      setLastLoadErrorToastAt = () => {},
    } = opts;

    bindRuntimeWindowEvent(runtimeCore, 'gq:load-progress', (ev) => {
      setFooterLoadProgress(ev?.detail || {});
    }, 'runtime:load-progress');

    bindRuntimeWindowEvent(runtimeCore, 'gq:load-error', (ev) => {
      const detail = ev?.detail || {};
      const endpoint = String(detail.endpoint || 'unbekannt');
      const context = String(detail.context || 'request');
      const message = String(detail.message || 'Ladevorgang fehlgeschlagen');
      const kind = String(detail.kind || 'unknown');
      if (kind === 'abort' || /aborted|cancelled|canceled|home navigation|view switch|aborterror/i.test(message)) return;
      pushGalaxyDebugError(`api:${context}`, message, endpoint);
      console.error('[GQ][LoadError]', { endpoint, context, kind, message, detail });

      const now = Date.now();
      if ((now - Number(getLastLoadErrorToastAt() || 0)) > 2500) {
        let suffix = '';
        if (kind === 'offline') suffix = ' (Offline)';
        else if (kind === 'unreachable') suffix = ' (API nicht erreichbar)';
        else if (kind === 'timeout') suffix = ' (Timeout)';
        if (kind === 'auth') {
          showToast('Session abgelaufen. Bitte neu einloggen.', 'warning');
        } else {
          showToast(`Laden fehlgeschlagen (${context}${suffix}): ${message}`, 'error');
        }
        setLastLoadErrorToastAt(now);
      }

      if (kind === 'offline' || kind === 'timeout' || kind === 'unreachable' || kind === 'http' || kind === 'auth') {
        setFooterNetworkStatus(kind);
      }

      if (kind === 'auth') {
        if (shouldRedirectOnAuthLoadError(endpoint, context)) {
          redirectToLogin('load-error-auth');
        } else {
          console.info('[GQ][LoadError] Auth-Fehler bei Nebenendpoint ignoriert (kein Redirect).', {
            endpoint,
            context,
          });
        }
      }
    }, 'runtime:load-error');

    bindRuntimeWindowEvent(runtimeCore, 'online', () => {
      refreshFooterNetworkStatus(true);
    }, 'runtime:online');

    bindRuntimeWindowEvent(runtimeCore, 'offline', () => {
      setFooterNetworkStatus('offline');
    }, 'runtime:offline');

    setFooterNetworkStatus(navigator.onLine === false ? 'offline' : 'unknown');
    refreshFooterNetworkStatus(false);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { registerLoadAndNetworkRuntimeEvents };
  } else {
    window.GQRuntimeLoadNetworkEvents = { registerLoadAndNetworkRuntimeEvents };
  }
})();
