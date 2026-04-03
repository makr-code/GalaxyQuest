/**
 * RuntimeTerminalCommand.js
 *
 * Handles the `term` / `terminal` UI console commands.
 */

'use strict';

(function () {
  const state = {
    getLogApi: () => null,
  };

  function configureTerminalCommandRuntime(opts = {}) {
    const {
      getLogApi = null,
    } = opts;

    state.getLogApi = typeof getLogApi === 'function' ? getLogApi : (() => null);
  }

  function runTerminalCommand(parts, pushLine) {
    const logLine = typeof pushLine === 'function' ? pushLine : (() => {});
    const termApi = state.getLogApi();
    const sub = String(parts?.[1] || '').toLowerCase();

    if (!termApi) {
      logLine('[error] Terminal logger nicht verfuegbar.');
      return true;
    }

    if (sub === 'clear') {
      if (typeof termApi.clear === 'function') {
        termApi.clear();
      }
      logLine('[ok] Terminal-Log geleert.');
      return true;
    }

    if (sub === 'download') {
      if (typeof termApi.download === 'function') {
        termApi.download();
      }
      logLine('[ok] Terminal-Log Download gestartet.');
      return true;
    }

    if (sub === 'debug') {
      const mode = String(parts?.[2] || '').toLowerCase();
      if (mode === 'status') {
        const enabled = (typeof termApi.debugEnabled === 'function') ? termApi.debugEnabled() : false;
        logLine(`[state] term.debug=${enabled ? 'on' : 'off'}`);
        return true;
      }
      if (mode === 'on' || mode === 'off') {
        if (typeof termApi.setDebugEnabled === 'function') {
          termApi.setDebugEnabled(mode === 'on');
        }
        logLine(`[ok] term.debug=${mode}`);
        return true;
      }
      logLine('[usage] term debug on|off|status');
      return true;
    }

    if (sub === 'trace') {
      const mode = String(parts?.[2] || '').toLowerCase();
      if (mode === 'status') {
        const enabled = (typeof termApi.traceEnabled === 'function') ? termApi.traceEnabled() : false;
        logLine(`[state] term.trace=${enabled ? 'on' : 'off'}`);
        return true;
      }
      if (mode === 'on' || mode === 'off') {
        if (typeof termApi.setTraceEnabled === 'function') {
          termApi.setTraceEnabled(mode === 'on');
        }
        if (typeof termApi.instrumentNow === 'function') {
          termApi.instrumentNow();
        }
        logLine(`[ok] term.trace=${mode}`);
        return true;
      }
      logLine('[usage] term trace on|off|status');
      return true;
    }

    if (sub === 'instrument') {
      const count = Number((typeof termApi.instrumentNow === 'function') ? termApi.instrumentNow() : 0);
      logLine(`[ok] Instrumentierung ausgefuehrt (+${count}).`);
      return true;
    }

    logLine('[usage] term clear | term download | term debug on|off|status | term trace on|off|status | term instrument');
    return true;
  }

  const api = {
    configureTerminalCommandRuntime,
    runTerminalCommand,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeTerminalCommand = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
