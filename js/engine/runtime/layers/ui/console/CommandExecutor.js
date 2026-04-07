/**
 * RuntimeUiConsoleCommandExecutor.js
 *
 * UI console command execution controller.
 */

'use strict';

(function () {
  function createUiConsoleCommandController(opts = {}) {
    const parseCommandInput = typeof opts.parseCommandInput === 'function' ? opts.parseCommandInput : null;
    const uiConsolePush = typeof opts.uiConsolePush === 'function' ? opts.uiConsolePush : (() => {});
    const dispatchUiConsoleCommand = typeof opts.dispatchUiConsoleCommand === 'function' ? opts.dispatchUiConsoleCommand : null;
    const runUnknownCommand = typeof opts.runUnknownCommand === 'function' ? opts.runUnknownCommand : null;

    if (!parseCommandInput || !dispatchUiConsoleCommand || !runUnknownCommand) {
      throw new Error('[runtime/ui-console-command-executor] parse/dispatch/unknown handlers are required.');
    }

    return {
      async execute(raw) {
        const parsed = parseCommandInput(raw, { stripLeadingSlash: false });
        if (!parsed.raw) return;
        uiConsolePush(`> ${parsed.raw}`);

        const handled = await dispatchUiConsoleCommand({
          input: parsed.raw,
          normalizedInput: parsed.normalizedLower,
          parts: parsed.parts,
          cmd: parsed.cmd,
        });
        if (handled) return;

        runUnknownCommand(parsed.cmd, uiConsolePush);
      },
    };
  }

  const api = {
    createUiConsoleCommandController,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeUiConsoleCommandExecutor = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
