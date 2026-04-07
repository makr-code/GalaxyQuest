/**
 * RuntimeUiConsoleMetaCommand.js
 *
 * Handles small meta commands for the UI console (help + unknown fallback).
 */

'use strict';

(function () {
  const state = {
    helpLine: '[help] refresh | home | galaxy | galdiag | galinspect | galdebug | galprobe [sec] | perftelemetry on/off/status/send | open <window> | transitions on/off/status | term debug on/off/status | term clear | term download | msg <user> <text> | copy | clear',
  };

  function configureUiConsoleMetaCommandRuntime(opts = {}) {
    const { helpLine = '' } = opts;
    if (String(helpLine || '').trim()) {
      state.helpLine = String(helpLine);
    }
  }

  function runHelpCommand(pushLine) {
    const logLine = typeof pushLine === 'function' ? pushLine : (() => {});
    logLine(state.helpLine);
    return true;
  }

  function runUnknownCommand(cmd, pushLine) {
    const logLine = typeof pushLine === 'function' ? pushLine : (() => {});
    logLine(`[error] Unknown command: ${String(cmd || '')}`);
    return true;
  }

  const api = {
    configureUiConsoleMetaCommandRuntime,
    runHelpCommand,
    runUnknownCommand,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeUiConsoleMetaCommand = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
