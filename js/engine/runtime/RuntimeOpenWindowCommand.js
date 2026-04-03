/**
 * RuntimeOpenWindowCommand.js
 *
 * Handles the `open <window>` UI console command.
 */

'use strict';

(function () {
  const state = {
    wmOpen: null,
  };

  function configureOpenWindowCommandRuntime(opts = {}) {
    const {
      wmOpen = null,
    } = opts;
    state.wmOpen = typeof wmOpen === 'function' ? wmOpen : null;
  }

  function runOpenWindowCommand(parts, pushLine) {
    const logLine = typeof pushLine === 'function' ? pushLine : (() => {});
    const win = String(parts?.[1] || '').toLowerCase();
    const valid = new Set(['overview','buildings','colony','research','shipyard','fleet','galaxy','messages','quests','leaderboard','leaders','factions','settings']);

    if (!valid.has(win)) {
      logLine('[error] Unknown window.');
      return true;
    }

    if (typeof state.wmOpen === 'function') {
      state.wmOpen(win);
    }

    logLine(`[ok] Opened ${win}.`);
    return true;
  }

  const api = {
    configureOpenWindowCommandRuntime,
    runOpenWindowCommand,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeOpenWindowCommand = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
