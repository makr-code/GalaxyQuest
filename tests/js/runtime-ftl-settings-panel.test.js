// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const panelPaths = [
  'js/engine/runtime/RuntimeFtlSettingsPanel.js',
  'js/engine/runtime/layers/ui/settings/ftl/SettingsPanel.js',
];

function createPanelRoot() {
  const root = document.createElement('div');
  root.innerHTML = `
    <div id="set-ftl-current"></div>
    <div id="set-ftl-result"></div>
    <button class="set-ftl-drive-btn" type="button" data-drive="vortex"></button>
  `;
  return root;
}

describe.each(panelPaths)('Runtime FTL settings panel (%s)', (panelPath) => {
  beforeEach(() => {
    delete window.GQRuntimeFtlSettingsPanel;
    window.eval(readFileSync(path.resolve(panelPath), 'utf8'));
  });

  it.each([
    {
      name: 'success message',
      response: { success: true, message: '<img src=x onerror=alert(1)>', dm_spent: 0 },
      expected: 'OK <img src=x onerror=alert(1)>',
      color: 'rgb(136, 255, 136)',
    },
    {
      name: 'error message',
      response: { success: false, error: '<svg onload=alert(1)>' },
      expected: 'Fehler: <svg onload=alert(1)>',
      color: 'rgb(255, 102, 102)',
    },
  ])('renders the $name as text, not markup', async ({ response, expected, color }) => {
    const root = createPanelRoot();
    const api = {
      ftlStatus: vi.fn().mockResolvedValue({ ftl_drive_type: 'aereth' }),
      setFtlDrive: vi.fn().mockResolvedValue(response),
    };

    window.GQRuntimeFtlSettingsPanel.bindFtlSettingsPanel({
      root,
      api,
      esc: (value) => String(value ?? ''),
    });

    await root.querySelector('.set-ftl-drive-btn').click();

    const result = root.querySelector('#set-ftl-result');
    await vi.waitFor(() => {
      expect(result.textContent).toBe(expected);
    });

    expect(result.querySelector('img, svg')).toBeNull();
    expect(result.querySelector('span').style.color).toBe(color);
  });

  it('uses a fixed text message after a network failure', async () => {
    const root = createPanelRoot();
    const api = {
      ftlStatus: vi.fn().mockResolvedValue({ ftl_drive_type: 'aereth' }),
      setFtlDrive: vi.fn().mockRejectedValue(new Error('request failed')),
    };

    window.GQRuntimeFtlSettingsPanel.bindFtlSettingsPanel({ root, api });
    await root.querySelector('.set-ftl-drive-btn').click();

    const result = root.querySelector('#set-ftl-result');
    await vi.waitFor(() => {
      expect(result.textContent).toBe('Netzwerkfehler');
    });
    expect(result.querySelector('img, svg')).toBeNull();
  });
});
