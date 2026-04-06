/**
 * RuntimeMessageSendCommand.js
 *
 * Handles the `msg <user> <text>` UI console command.
 */

'use strict';

(function () {
  const state = {
    sendMsg: null,
    playMessageSend: null,
  };

  function configureMessageSendCommandRuntime(opts = {}) {
    const {
      sendMsg = null,
      playMessageSend = null,
    } = opts;

    state.sendMsg = typeof sendMsg === 'function' ? sendMsg : null;
    state.playMessageSend = typeof playMessageSend === 'function' ? playMessageSend : null;
  }

  async function runMessageSendCommand(parts, rawInput, pushLine) {
    const logLine = typeof pushLine === 'function' ? pushLine : (() => {});

    if (!Array.isArray(parts) || parts.length < 3) {
      logLine('[usage] msg <user> <text>');
      return true;
    }
    if (typeof state.sendMsg !== 'function') {
      logLine('[error] Message API nicht verfuegbar.');
      return true;
    }

    const to = String(parts[1] || '').trim();
    const body = String(rawInput || '').split(/\s+/).slice(2).join(' ').trim();

    if (!to || !body) {
      logLine('[usage] msg <user> <text>');
      return true;
    }

    const r = await state.sendMsg(to, 'Direct Message', body);
    if (r && r.success) {
      if (typeof state.playMessageSend === 'function') {
        state.playMessageSend();
      }
      logLine(`[ok] message sent to ${to}`);
    } else {
      logLine(`[error] ${(r && r.error) ? r.error : 'send failed'}`);
    }

    return true;
  }

  const api = {
    configureMessageSendCommandRuntime,
    runMessageSendCommand,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMessageSendCommand = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
