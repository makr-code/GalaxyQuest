'use strict';

(function () {
  function redirectToLogin(reason = 'auth', deps = {}) {
    const getAuthRedirectScheduled = typeof deps.getAuthRedirectScheduled === 'function'
      ? deps.getAuthRedirectScheduled
      : () => false;
    const setAuthRedirectScheduled = typeof deps.setAuthRedirectScheduled === 'function'
      ? deps.setAuthRedirectScheduled
      : () => {};
    const uiConsolePush = typeof deps.uiConsolePush === 'function' ? deps.uiConsolePush : () => {};
    const showToast = typeof deps.showToast === 'function' ? deps.showToast : () => {};
    const windowRef = deps.windowRef || window;

    if (getAuthRedirectScheduled()) return;
    setAuthRedirectScheduled(true);
    const target = `index.html?reason=${encodeURIComponent(String(reason || 'auth'))}`;
    uiConsolePush(`[system] Session abgelaufen (${reason}). Redirect -> ${target}`);
    showToast('Session abgelaufen. Weiterleitung zum Login...', 'warning');
    windowRef.setTimeout(() => {
      windowRef.location.href = target;
    }, 450);
  }

  function gameLog(level, message, data = null, deps = {}) {
    const windowRef = deps.windowRef || window;
    const consoleRef = deps.consoleRef || console;
    const lvl = String(level || 'info').toLowerCase();
    const sink = windowRef.GQLog && typeof windowRef.GQLog[lvl] === 'function'
      ? windowRef.GQLog[lvl].bind(windowRef.GQLog)
      : null;
    const prefix = '[game]';
    if (sink) {
      if (data == null) sink(prefix, message);
      else sink(prefix, message, data);
      return;
    }
    const method = (lvl === 'error' || lvl === 'warn' || lvl === 'info') ? lvl : 'log';
    if (data == null) consoleRef[method]('[GQ][game]', message);
    else consoleRef[method]('[GQ][game]', message, data);
  }

  const api = {
    redirectToLogin,
    gameLog,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGameInfraHelpers = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();