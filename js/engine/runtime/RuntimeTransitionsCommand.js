/**
 * RuntimeTransitionsCommand.js
 *
 * Handles the `transitions` UI console command.
 */

'use strict';

(function () {
  const state = {
    getAutoTransitions: () => false,
    setAutoTransitions: null,
    applyRuntimeSettings: null,
    saveUiSettings: null,
  };

  function configureTransitionsCommandRuntime(opts = {}) {
    const {
      getAutoTransitions = null,
      setAutoTransitions = null,
      applyRuntimeSettings = null,
      saveUiSettings = null,
    } = opts;

    state.getAutoTransitions = typeof getAutoTransitions === 'function' ? getAutoTransitions : (() => false);
    state.setAutoTransitions = typeof setAutoTransitions === 'function' ? setAutoTransitions : null;
    state.applyRuntimeSettings = typeof applyRuntimeSettings === 'function' ? applyRuntimeSettings : null;
    state.saveUiSettings = typeof saveUiSettings === 'function' ? saveUiSettings : null;
  }

  function runTransitionsCommand(parts, pushLine) {
    const logLine = typeof pushLine === 'function' ? pushLine : (() => {});
    const arg = String(parts?.[1] || '').toLowerCase();

    if (arg === 'status') {
      logLine(`[state] transitions=${state.getAutoTransitions() ? 'on' : 'off'}`);
      return true;
    }

    if (arg === 'on' || arg === 'off') {
      if (typeof state.setAutoTransitions === 'function') {
        state.setAutoTransitions(arg === 'on');
      }
      if (typeof state.applyRuntimeSettings === 'function') {
        state.applyRuntimeSettings();
      }
      if (typeof state.saveUiSettings === 'function') {
        state.saveUiSettings();
      }
      logLine(`[ok] transitions=${arg}`);
      return true;
    }

    logLine('[usage] transitions on|off|status');
    return true;
  }

  const api = {
    configureTransitionsCommandRuntime,
    runTransitionsCommand,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeTransitionsCommand = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
