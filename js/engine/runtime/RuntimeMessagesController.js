'use strict';
(function () {
  function createMessagesController({
    wm,
    api,
    documentRef,
    renderInlineTemplate,
    renderInlineTemplateList,
    uiKitTemplateHTML,
    uiKitEmptyStateHTML,
    esc,
    gameLog,
    showToast,
    getAudioManager,
    getMessageConsoleState,
    updateMessageSignalsFromInbox,
    runtimeCommandParsingApi,
    runtimeMessageConsoleCommandApi,
    playMessageSendRef,
  } = {}) {
    const templates = {
      shell: '{{{composeToggle}}}{{{composeForm}}}{{{terminalPanel}}}{{{messagesList}}}',
      composeToggle: '<div style="margin-bottom:0.75rem"><button class="btn btn-secondary btn-sm" id="compose-toggle-btn">\u00D4\u00A3\u00EB Compose</button></div>',
      composeForm: `
        <div id="compose-form-wm" class="hidden" style="margin-bottom:1rem">
          <div class="form-group">
            <label>To (username)</label>
            <input id="msg-to-wm" type="text" placeholder="recipient" />
          </div>
          <div class="form-group">
            <label>Subject</label>
            <input id="msg-subject-wm" type="text" placeholder="Subject" />
          </div>
          <div class="form-group">
            <label>Message</label>
            <textarea id="msg-body-wm" rows="3" placeholder="Your message\u00D4\u00C7\u00AA"></textarea>
          </div>
          <button class="btn btn-primary btn-sm" id="msg-send-btn-wm">Send</button>
          <div id="msg-send-result-wm" class="form-info" aria-live="polite"></div>
        </div>`,
      terminalPanel: `
        <div class="msg-terminal" style="margin-bottom:0.9rem;border:1px solid rgba(150,180,230,0.25);border-radius:10px;padding:0.55rem;background:rgba(7,14,28,0.55)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem">
            <strong style="font-size:0.82rem;color:#b8cff3">Terminal Console</strong>
            <span style="font-size:0.72rem;color:var(--text-muted)">Direktbefehle f\u251C\u255Dr Messages</span>
          </div>
          <div id="msg-terminal-log" style="height:140px;overflow:auto;background:rgba(5,10,18,0.82);border-radius:8px;padding:0.45rem;font-family:Consolas, 'Courier New', monospace;font-size:0.74rem;line-height:1.35;color:#d7e4ff"></div>
          <div style="display:flex;gap:0.45rem;margin-top:0.45rem">
            <input id="msg-terminal-input" type="text" list="msg-terminal-users" placeholder="help | msg <user> <text> | inbox | read <id> | delete <id> | clear" style="flex:1" />
            <datalist id="msg-terminal-users"></datalist>
            <button class="btn btn-secondary btn-sm" id="msg-terminal-run">Run</button>
          </div>
        </div>`,
      messagesList: `<div id="messages-list-wm">${uiKitTemplateHTML('tpl-ui-skeleton-list') || '<p class="text-muted">Loading\u00D4\u00C7\u00AA</p>'}</div>`,
      consoleLine: '<div>{{{line}}}</div>',
      userHintOption: '<option value="{{{value}}}"></option>',
      detail: `
        <div class="msg-detail-header">
          <div>
            <strong>{{{subject}}}</strong>
            <div class="msg-detail-meta">From: {{{sender}}} &nbsp;\u00D4\u00C7\u00F3&nbsp; {{{sentAt}}}</div>
          </div>
          <button class="btn btn-secondary btn-sm close-msg-btn">\u00D4\u00A3\u00F2 Close</button>
        </div>
        <hr class="separator" />
        <div class="msg-detail-body">{{{body}}}</div>`,
      row: `
          <div class="msg-row {{{unreadClass}}}" data-mid="{{{id}}}">
            {{{unreadDot}}}
            <span class="msg-subject">{{{subject}}}</span>
            <span class="msg-sender">From: {{{sender}}}</span>
            <span class="msg-date">{{{date}}}</span>
            <button class="btn btn-danger btn-sm del-msg-btn" data-mid="{{{id}}}">\u00AD\u0192\u00F9\u00E6</button>
          </div>`,
    };

    function renderTemplate(templateName, data = {}) {
      return renderInlineTemplate(templates[templateName], data);
    }

    function renderTemplateList(templateName, rows) {
      return renderInlineTemplateList(templates[templateName], rows);
    }

    function speakMessageDetail(message) {
      const ttsApi = (typeof window !== 'undefined' && window.GQTTS) || null;
      if (!ttsApi || typeof ttsApi.isAutoVoiceEnabled !== 'function' || typeof ttsApi.speak !== 'function') return;
      if (!ttsApi.isAutoVoiceEnabled()) return;

      const sender = String(message?.sender || 'Unbekannt').trim();
      const subject = String(message?.subject || '').trim();
      const bodyRaw = String(message?.body || '').replace(/\s+/g, ' ').trim();
      const body = bodyRaw.length > 220 ? `${bodyRaw.slice(0, 217)}...` : bodyRaw;
      const parts = [];
      if (sender) parts.push(`Nachricht von ${sender}.`);
      if (subject) parts.push(`Betreff: ${subject}.`);
      if (body) parts.push(body);
      const text = parts.join(' ').trim();
      if (!text) return;
      ttsApi.speak(text).catch(() => {});
    }

    function consolePush(line) {
      const state = getMessageConsoleState();
      const text = String(line || '').trim();
      if (!text) return;
      state.lines.push(text);
      if (state.lines.length > state.maxLines) {
        state.lines.splice(0, state.lines.length - state.maxLines);
      }
    }

    function renderConsoleLog(root) {
      const log = root?.querySelector('#msg-terminal-log');
      if (!log) return;
      const state = getMessageConsoleState();
      log.innerHTML = renderTemplateList('consoleLine', state.lines.map((line) => ({ line: esc(line) })));
      log.scrollTop = log.scrollHeight;
    }

    function extractUserPrefix(raw) {
      const txt = String(raw || '').trimStart();
      const normalized = txt.startsWith('/') ? txt.slice(1) : txt;
      const match = normalized.match(/^(msg|dm)\s+([^\s]*)$/i);
      return match ? String(match[2] || '') : '';
    }

    function autocompleteCommand(raw, hints) {
      const text = String(raw || '');
      const leadSlash = text.startsWith('/');
      const normalized = leadSlash ? text.slice(1) : text;
      const match = normalized.match(/^(msg|dm)\s+([^\s]*)(\s*)$/i);
      if (!match) return null;
      const cmd = match[1];
      const prefix = String(match[2] || '');
      if (!prefix) return null;
      const list = Array.isArray(hints) ? hints : [];
      const hit = list.find((u) => String(u).toLowerCase().startsWith(prefix.toLowerCase()));
      if (!hit) return null;
      return `${leadSlash ? '/' : ''}${cmd} ${hit} `;
    }

    async function refreshUserHints(root, prefix = '') {
      const datalist = root?.querySelector('#msg-terminal-users');
      if (!datalist) return;
      const state = getMessageConsoleState();
      try {
        const response = await api.messageUsers(prefix || '');
        const users = response?.success && Array.isArray(response.users)
          ? Array.from(new Set(response.users.map((u) => String(u || '').trim()).filter(Boolean))).slice(0, 12)
          : [];
        state.userHints = users;
        datalist.innerHTML = renderTemplateList('userHintOption', users.map((u) => ({ value: esc(u) })));
      } catch (err) {
        gameLog('info', 'Message user hints laden fehlgeschlagen', err);
        state.userHints = [];
        datalist.innerHTML = '';
      }
    }

    function showMessageDetail(root, message) {
      const listEl = root.querySelector('#messages-list-wm');
      if (!listEl) return;
      let detail = root.querySelector('.msg-detail');
      if (!detail) {
        detail = documentRef.createElement('div');
        detail.className = 'msg-detail';
        listEl.before(detail);
      }
      detail.innerHTML = renderTemplate('detail', {
        subject: esc(message.subject),
        sender: esc(message.sender),
        sentAt: esc(new Date(message.sent_at).toLocaleString()),
        body: esc(message.body),
      });
      detail.querySelector('.close-msg-btn')?.addEventListener('click', () => detail.remove());
    }

    async function loadMessagesList(root) {
      const el = root.querySelector('#messages-list-wm');
      if (!el) return;
      el.innerHTML = uiKitTemplateHTML('tpl-ui-skeleton-list') || '<p class="text-muted">Loading\u00D4\u00C7\u00AA</p>';
      try {
        const data = await api.inbox();
        if (!data.success) {
          el.innerHTML = '<p class="text-red">Error.</p>';
          return;
        }
        if (!data.messages.length) {
          el.innerHTML = uiKitEmptyStateHTML('Inbox empty', 'New diplomatic and tactical messages will appear here.');
          return;
        }

        el.innerHTML = renderTemplateList('row', data.messages.map((message) => ({
          id: Number(message.id || 0),
          unreadClass: message.is_read ? '' : 'unread',
          unreadDot: message.is_read ? '' : '<div class="msg-unread-dot"></div>',
          subject: esc(message.subject),
          sender: esc(message.sender),
          date: esc(new Date(message.sent_at).toLocaleDateString()),
        })));

        el.querySelectorAll('.msg-row').forEach((row) => {
          row.addEventListener('click', async (e) => {
            if (e.target.classList.contains('del-msg-btn')) return;
            const mid = parseInt(row.dataset.mid, 10);
            const detail = await api.readMsg(mid);
            if (!detail.success) return;
            const message = detail.message;
            showMessageDetail(root, message);
            const audioManager = getAudioManager();
            if (audioManager && typeof audioManager.playMessageRead === 'function') audioManager.playMessageRead();
            speakMessageDetail(message);
            consolePush(`[read] #${mid} from ${message.sender || 'Unknown'}: ${message.subject || '(no subject)'}`);
            renderConsoleLog(root);
            row.classList.remove('unread');
            await loadBadge();
          });
        });

        el.querySelectorAll('.del-msg-btn').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const response = await api.deleteMsg(parseInt(btn.dataset.mid, 10));
            if (response.success) {
              const audioManager = getAudioManager();
              if (audioManager && typeof audioManager.playMessageDelete === 'function') audioManager.playMessageDelete();
              consolePush(`[ok] Deleted message #${btn.dataset.mid}.`);
              renderConsoleLog(root);
              await loadMessagesList(root);
              await loadBadge();
            }
          });
        });
      } catch (err) {
        gameLog('warn', 'Messages view laden fehlgeschlagen', err);
        el.innerHTML = '<p class="text-red">Failed to load messages.</p>';
      }
    }

    async function runConsoleCommand(root, rawCommand) {
      const parsed = runtimeCommandParsingApi.parseCommandInput(rawCommand, { stripLeadingSlash: true });
      if (!parsed.raw) return;
      consolePush(`> ${parsed.raw}`);
      renderConsoleLog(root);

      const normalized = parsed.normalized;
      const parts = parsed.parts;
      const cmd = parsed.cmd;

      if (!cmd) {
        consolePush('[system] Empty command.');
        renderConsoleLog(root);
        return;
      }

      await runtimeMessageConsoleCommandApi.runMessageConsoleCommand({
        cmd,
        parts,
        normalized,
        root,
        consolePush: (line) => consolePush(line),
        renderConsoleLog: (node) => renderConsoleLog(node),
        resetConsole: () => {
          const state = getMessageConsoleState();
          state.lines = ['[system] Console cleared.'];
        },
        loadMessagesList: async (node) => {
          await loadMessagesList(node);
        },
        showMessageDetail: (node, message) => {
          showMessageDetail(node, message);
        },
        loadBadge: async () => {
          await loadBadge();
        },
        playMessageRead: () => {
          const audioManager = getAudioManager();
          if (audioManager && typeof audioManager.playMessageRead === 'function') audioManager.playMessageRead();
        },
        playMessageDelete: () => {
          const audioManager = getAudioManager();
          if (audioManager && typeof audioManager.playMessageDelete === 'function') audioManager.playMessageDelete();
        },
        playMessageSend: playMessageSendRef,
      });
    }

    async function loadBadge() {
      try {
        const data = await api.inbox();
        if (!data.success) return;
        const list = Array.isArray(data.messages) ? data.messages : [];
        const unread = list.filter((message) => !parseInt(message.is_read, 10)).length;
        const badge = documentRef.getElementById('msg-badge');
        if (unread > 0) {
          badge.textContent = unread;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
        updateMessageSignalsFromInbox(list);
      } catch (_) {}
    }

    function bindComposeControls(root) {
      root.querySelector('#compose-toggle-btn')?.addEventListener('click', () => {
        root.querySelector('#compose-form-wm')?.classList.toggle('hidden');
      });

      root.querySelector('#msg-send-btn-wm')?.addEventListener('click', async () => {
        const res = root.querySelector('#msg-send-result-wm');
        const to = root.querySelector('#msg-to-wm')?.value.trim();
        const subject = root.querySelector('#msg-subject-wm')?.value.trim();
        const body = root.querySelector('#msg-body-wm')?.value.trim();
        if (!to || !subject || !body) {
          res.className = 'form-error';
          res.textContent = 'Fill in all fields.';
          return;
        }
        const response = await api.sendMsg(to, subject, body);
        if (response.success) {
          const audioManager = getAudioManager();
          if (audioManager && typeof audioManager.playMessageSend === 'function') audioManager.playMessageSend();
          res.className = 'form-info';
          res.textContent = 'Message sent!';
          root.querySelector('#msg-to-wm').value = '';
          root.querySelector('#msg-subject-wm').value = '';
          root.querySelector('#msg-body-wm').value = '';
          showToast('Message sent!', 'success');
        } else {
          res.className = 'form-error';
          res.textContent = response.error || 'Failed.';
        }
      });
    }

    function bindTerminalControls(root) {
      const runTerminalCommand = async () => {
        const input = root.querySelector('#msg-terminal-input');
        if (!input) return;
        const command = String(input.value || '').trim();
        if (!command) return;
        input.value = '';
        await runConsoleCommand(root, command);
      };

      root.querySelector('#msg-terminal-run')?.addEventListener('click', runTerminalCommand);
      root.querySelector('#msg-terminal-input')?.addEventListener('keydown', async (e) => {
        if (e.key === 'Tab') {
          const input = e.currentTarget;
          if (!(input instanceof HTMLInputElement)) return;
          const state = getMessageConsoleState();
          const next = autocompleteCommand(input.value, state.userHints || []);
          if (next && next !== input.value) {
            e.preventDefault();
            input.value = next;
            input.setSelectionRange(next.length, next.length);
            return;
          }
        }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        await runTerminalCommand();
      });

      root.querySelector('#msg-terminal-input')?.addEventListener('input', async (e) => {
        const input = e.currentTarget;
        if (!(input instanceof HTMLInputElement)) return;
        const prefix = extractUserPrefix(input.value);
        await refreshUserHints(root, prefix);
      });
    }

    async function render() {
      const root = wm.body('messages');
      if (!root) return;

      root.innerHTML = renderTemplate('shell', {
        composeToggle: templates.composeToggle,
        composeForm: templates.composeForm,
        terminalPanel: templates.terminalPanel,
        messagesList: templates.messagesList,
      });

      bindComposeControls(root);

      renderConsoleLog(root);
      await refreshUserHints(root, '');
      bindTerminalControls(root);

      await loadMessagesList(root);
    }

    return {
      render,
      loadBadge,
    };
  }

  const api = { createMessagesController };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.GQRuntimeMessagesController = api; }
})();
