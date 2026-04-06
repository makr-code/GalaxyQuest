/**
 * RuntimeUiConsoleCommandRegistry.js
 *
 * Generic command registry/dispatcher for the main UI console.
 */

'use strict';

(function () {
  const state = {
    handlers: new Map(),
  };

  function normalizeName(name) {
    return String(name || '').trim().toLowerCase();
  }

  function registerUiConsoleCommand(name, handler) {
    const key = normalizeName(name);
    if (!key) return false;
    if (typeof handler !== 'function') return false;
    state.handlers.set(key, handler);
    return true;
  }

  function registerUiConsoleCommandAliases(names, handler) {
    const list = Array.isArray(names) ? names : [names];
    let registeredAny = false;
    list.forEach((name) => {
      registeredAny = registerUiConsoleCommand(name, handler) || registeredAny;
    });
    return registeredAny;
  }

  function clearUiConsoleCommands() {
    state.handlers.clear();
  }

  function configureUiConsoleCommandRegistryRuntime(opts = {}) {
    const {
      commands = {},
      reset = true,
    } = opts;

    if (reset) {
      clearUiConsoleCommands();
    }

    if (commands && typeof commands === 'object') {
      Object.keys(commands).forEach((name) => {
        registerUiConsoleCommand(name, commands[name]);
      });
    }
  }

  async function dispatchUiConsoleCommand(context = {}) {
    const cmd = normalizeName(context.cmd || context.parts?.[0] || '');
    if (!cmd) return false;
    const handler = state.handlers.get(cmd);
    if (typeof handler !== 'function') return false;
    await handler(context);
    return true;
  }

  const api = {
    configureUiConsoleCommandRegistryRuntime,
    registerUiConsoleCommand,
    registerUiConsoleCommandAliases,
    clearUiConsoleCommands,
    dispatchUiConsoleCommand,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeUiConsoleCommandRegistry = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();