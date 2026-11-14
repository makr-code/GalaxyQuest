import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const actionsPath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeUserMenuActions.js');

function loadActions() {
  delete window.GQRuntimeUserMenuActions;
  window.eval(fs.readFileSync(actionsPath, 'utf8'));
  return window.GQRuntimeUserMenuActions;
}

describe('RuntimeUserMenuActions e-mail notification toggle', () => {
  let actions;
  beforeEach(() => { actions = loadActions(); });

  it('inverts the server setting and reports the confirmed state', async () => {
    const API = {
      notificationSettings: vi.fn(async () => ({ success: true, email_notifications: true })),
      setEmailNotifications: vi.fn(async (enabled) => ({ success: true, email_notifications: enabled })),
    };
    const showToast = vi.fn();
    await actions.handleUserMenuAction('toggle-email-notifications', { settingsState: {}, API, showToast });
    expect(API.setEmailNotifications).toHaveBeenCalledExactlyOnceWith(false);
    expect(showToast).toHaveBeenCalledWith('E-Mail-Benachrichtigungen deaktiviert.', 'info');
  });

  it('does not write when the current setting cannot be read', async () => {
    const API = {
      notificationSettings: vi.fn(async () => ({ success: false, error: 'offline' })),
      setEmailNotifications: vi.fn(),
    };
    const showToast = vi.fn();
    await actions.handleUserMenuAction('toggle-email-notifications', { settingsState: {}, API, showToast });
    expect(API.setEmailNotifications).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('offline', 'error');
  });
});
