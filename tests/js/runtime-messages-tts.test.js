import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/layers/domain/messages/RuntimeMessagesController.js');

function loadModule() {
  delete window.GQRuntimeMessagesController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeMessagesController;
}

function renderInlineTemplate(template, data = {}) {
  return String(template || '').replace(/\{\{\{(.*?)\}\}\}/g, (_, key) => String(data[String(key).trim()] ?? ''));
}

function renderInlineTemplateList(template, rows = []) {
  return rows.map((row) => renderInlineTemplate(template, row)).join('');
}

describe('RuntimeMessagesController TTS wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="msg-badge" class="hidden"></div>';
    window.GQTTS = {
      isAutoVoiceEnabled: vi.fn(() => true),
      speak: vi.fn().mockResolvedValue(null),
    };
  });

  it('speaks a concise message summary when opening a message', async () => {
    const mod = loadModule();
    const subject = 'Alarmstatus <img src=x onerror=alert(1)>';
    const sender = 'Admiral Nova "><svg onload=alert(1)>';
    const body = 'Feindliche Signaturen wurden am Randsektor erfasst. Bitte Flotte in Alarmbereitschaft versetzen. <img src=x onerror=alert(1)>';
    const userHint = '"><img src=x onerror=alert(1)>';
    const root = document.createElement('div');
    const wm = {
      body: vi.fn(() => root),
    };
    const api = {
      inbox: vi.fn(async () => ({
        success: true,
        messages: [
          { id: 7, subject, sender, sent_at: '2026-04-07 19:00:00', is_read: 0 },
        ],
      })),
      readMsg: vi.fn(async () => ({
        success: true,
        message: {
          id: 7,
          subject,
          sender,
          sent_at: '2026-04-07 19:00:00',
          body,
        },
      })),
      deleteMsg: vi.fn(async () => ({ success: true })),
      sendMsg: vi.fn(async () => ({ success: true })),
      messageUsers: vi.fn(async () => ({ success: true, users: [userHint] })),
    };
    const audioManager = { playMessageRead: vi.fn(), playMessageDelete: vi.fn(), playMessageSend: vi.fn() };
    const state = { lines: [], maxLines: 20, userHints: [] };

    const controller = mod.createMessagesController({
      wm,
      api,
      documentRef: document,
      renderInlineTemplate,
      renderInlineTemplateList,
      uiKitTemplateHTML: () => '',
      uiKitEmptyStateHTML: () => '',
      gameLog: vi.fn(),
      showToast: vi.fn(),
      getAudioManager: () => audioManager,
      getMessageConsoleState: () => state,
      updateMessageSignalsFromInbox: vi.fn(),
      runtimeCommandParsingApi: { parseCommandInput: vi.fn(() => ({ raw: '', parts: [], normalized: '', cmd: '' })) },
      runtimeMessageConsoleCommandApi: { runMessageConsoleCommand: vi.fn() },
      playMessageSendRef: vi.fn(),
    });

    await controller.render();
    expect(root.querySelector('img, svg')).toBeNull();
    expect(root.querySelector('[onerror], [onload]')).toBeNull();
    expect(root.querySelector('.msg-subject').textContent).toBe(subject);
    expect(root.querySelector('.msg-sender').textContent).toBe(`From: ${sender}`);
    expect(root.querySelector('#msg-terminal-users option').value).toBe(userHint);
    root.querySelector('.msg-row').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(audioManager.playMessageRead).toHaveBeenCalled();
    expect(window.GQTTS.speak).toHaveBeenCalledTimes(1);
    expect(root.querySelector('img, svg')).toBeNull();
    expect(root.querySelector('[onerror], [onload]')).toBeNull();
    expect(root.querySelector('.msg-detail-body').textContent).toBe(body);
    expect(window.GQTTS.speak.mock.calls[0][0]).toContain('Nachricht von Admiral Nova');
    expect(window.GQTTS.speak.mock.calls[0][0]).toContain('Betreff: Alarmstatus');
    expect(window.GQTTS.speak.mock.calls[0][0]).toContain('Feindliche Signaturen wurden am Randsektor erfasst.');
  });
});