/**
 * RuntimeMessageConsoleCommand.js
 *
 * Handles commands from the Messages window terminal.
 */

'use strict';

(function () {
  const state = {
    readMsg: null,
    deleteMsg: null,
    sendMsg: null,
    showToast: null,
  };

  function configureMessageConsoleCommandRuntime(opts = {}) {
    const {
      readMsg = null,
      deleteMsg = null,
      sendMsg = null,
      showToast = null,
    } = opts;

    state.readMsg = typeof readMsg === 'function' ? readMsg : null;
    state.deleteMsg = typeof deleteMsg === 'function' ? deleteMsg : null;
    state.sendMsg = typeof sendMsg === 'function' ? sendMsg : null;
    state.showToast = typeof showToast === 'function' ? showToast : null;
  }

  async function runMessageConsoleCommand(context = {}) {
    const {
      cmd = '',
      parts = [],
      normalized = '',
      root = null,
      consolePush = null,
      renderConsoleLog = null,
      resetConsole = null,
      loadMessagesList = null,
      showMessageDetail = null,
      loadBadge = null,
      playMessageRead = null,
      playMessageDelete = null,
      playMessageSend = null,
    } = context;

    const pushLine = typeof consolePush === 'function' ? consolePush : (() => {});
    const renderLog = typeof renderConsoleLog === 'function' ? renderConsoleLog : (() => {});

    if (cmd === 'help' || cmd === '?') {
      pushLine('[help] msg <user> <text>  -> sends direct message (subject auto).');
      pushLine('[help] msg <user> <subject> | <body>  -> custom subject/body.');
      pushLine('[help] inbox  -> reload inbox list.');
      pushLine('[help] read <id>  -> open message detail.');
      pushLine('[help] delete <id>  -> delete message.');
      pushLine('[help] clear  -> clear console output.');
      renderLog(root);
      return true;
    }

    if (cmd === 'clear') {
      if (typeof resetConsole === 'function') {
        resetConsole();
      }
      renderLog(root);
      return true;
    }

    if (cmd === 'inbox') {
      if (typeof loadMessagesList === 'function') {
        await loadMessagesList(root);
      }
      pushLine('[ok] Inbox refreshed.');
      renderLog(root);
      return true;
    }

    if (cmd === 'read') {
      const id = Number(parts[1] || 0);
      if (!Number.isFinite(id) || id <= 0) {
        pushLine('[error] Usage: read <id>');
        renderLog(root);
        return true;
      }
      if (typeof state.readMsg !== 'function') {
        pushLine('[error] Message API unavailable.');
        renderLog(root);
        return true;
      }

      const detail = await state.readMsg(id);
      if (!detail || !detail.success || !detail.message) {
        pushLine(`[error] ${(detail && detail.error) ? detail.error : 'Message not found.'}`);
        renderLog(root);
        return true;
      }

      if (typeof showMessageDetail === 'function') {
        showMessageDetail(root, detail.message);
      }
      if (typeof playMessageRead === 'function') {
        playMessageRead();
      }
      pushLine(`[ok] Opened message #${id} from ${detail.message.sender || 'Unknown'}.`);
      if (typeof loadMessagesList === 'function') {
        await loadMessagesList(root);
      }
      if (typeof loadBadge === 'function') {
        await loadBadge();
      }
      renderLog(root);
      return true;
    }

    if (cmd === 'delete') {
      const id = Number(parts[1] || 0);
      if (!Number.isFinite(id) || id <= 0) {
        pushLine('[error] Usage: delete <id>');
        renderLog(root);
        return true;
      }
      if (typeof state.deleteMsg !== 'function') {
        pushLine('[error] Message API unavailable.');
        renderLog(root);
        return true;
      }

      const response = await state.deleteMsg(id);
      if (!response || !response.success) {
        pushLine(`[error] ${(response && response.error) ? response.error : 'Delete failed.'}`);
        renderLog(root);
        return true;
      }

      if (typeof loadMessagesList === 'function') {
        await loadMessagesList(root);
      }
      if (typeof playMessageDelete === 'function') {
        playMessageDelete();
      }
      pushLine(`[ok] Deleted message #${id}.`);
      if (typeof loadBadge === 'function') {
        await loadBadge();
      }
      renderLog(root);
      return true;
    }

    if (cmd === 'msg' || cmd === 'dm') {
      if (!Array.isArray(parts) || parts.length < 3) {
        pushLine('[error] Usage: msg <user> <text>');
        renderLog(root);
        return true;
      }
      if (typeof state.sendMsg !== 'function') {
        pushLine('[error] Message API unavailable.');
        renderLog(root);
        return true;
      }

      const to = String(parts[1] || '').trim();
      const payload = String(normalized || '').split(/\s+/).slice(2).join(' ').trim();
      if (!payload) {
        pushLine('[error] Message text missing.');
        renderLog(root);
        return true;
      }

      let subject = 'Direct Message';
      let body = payload;
      if (payload.includes('|')) {
        const payloadParts = payload.split('|');
        subject = String(payloadParts.shift() || '').trim() || 'Direct Message';
        body = payloadParts.join('|').trim();
      }
      if (!body) {
        pushLine('[error] Message body missing after subject separator.');
        renderLog(root);
        return true;
      }

      const response = await state.sendMsg(to, subject, body);
      if (!response || !response.success) {
        pushLine(`[error] ${(response && response.error) ? response.error : 'Send failed.'}`);
        renderLog(root);
        return true;
      }

      if (typeof playMessageSend === 'function') {
        playMessageSend();
      }
      pushLine(`[ok] Sent message to ${to} (subject: ${subject}).`);
      if (typeof state.showToast === 'function') {
        state.showToast(`Message sent to ${to}.`, 'success');
      }
      renderLog(root);
      return true;
    }

    pushLine(`[error] Unknown command: ${String(cmd || '')}. Type "help".`);
    renderLog(root);
    return true;
  }

  const api = {
    configureMessageConsoleCommandRuntime,
    runMessageConsoleCommand,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMessageConsoleCommand = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();