// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const uiPaths = [
  'js/engine/runtime/RuntimeThemeSettingsUi.js',
  'js/engine/runtime/layers/ui/settings/theme/SettingsUi.js',
];

function createSettingsModal() {
  document.body.innerHTML = `
    <div id="settings-modal">
      <select data-setting="uiThemeMode"><option value="faction">Faction</option></select>
      <select data-setting="uiThemeFactionId"></select>
      <input data-setting="uiThemeCustomAccent">
      <div data-theme-preview-source></div>
      <div data-theme-preview-detail></div>
    </div>
  `;
  return document.querySelector('#settings-modal');
}

describe.each(uiPaths)('Runtime theme settings UI (%s)', (uiPath) => {
  let themeUi;

  beforeEach(() => {
    delete window.GQRuntimeThemeSettingsUi;
    window.eval(readFileSync(path.resolve(uiPath), 'utf8'));
    themeUi = window.GQRuntimeThemeSettingsUi;
    createSettingsModal();
  });

  it('renders faction names as text and rejects invalid faction IDs', () => {
    const maliciousName = '<img src=x onerror=alert(1)>';
    themeUi.refreshThemeSettingsUi({
      settingsState: { uiThemeFactionId: 7, factionThemeCache: {} },
      uiState: {
        territory: [
          { id: 7, name: maliciousName },
          { id: '8.5', name: 'Fractional faction' },
          { id: '9007199254740992', name: 'Unsafe integer faction' },
          { id: 'Infinity', name: 'Infinite faction' },
          { id: 8, name: '<svg onload=alert(1)>' },
        ],
      },
      resolvePlayerFactionThemeSeed: () => ({ factionId: 7 }),
      currentUser: { faction: { name: maliciousName } },
      esc: (value) => String(value ?? ''),
      onPreviewRequested: vi.fn(),
    });

    const select = document.querySelector('[data-setting="uiThemeFactionId"]');
    expect(select.querySelector('img, svg')).toBeNull();
    expect(select.querySelectorAll('option')).toHaveLength(3);
    expect(select.options[1].value).toBe('7');
    expect(select.options[1].textContent).toBe(`${maliciousName} (Player)`);
    expect(select.options[2].value).toBe('8');
    expect(select.options[2].textContent).toBe('<svg onload=alert(1)>');
    expect(select.value).toBe('7');
  });

  it('falls back to the automatic faction option for an invalid selected ID', () => {
    themeUi.refreshThemeSettingsUi({
      settingsState: { uiThemeFactionId: Infinity, factionThemeCache: {} },
      uiState: { territory: [] },
      resolvePlayerFactionThemeSeed: () => ({ factionId: 0 }),
      onPreviewRequested: vi.fn(),
    });

    const select = document.querySelector('[data-setting="uiThemeFactionId"]');
    expect(select.value).toBe('0');
    expect(select.options).toHaveLength(1);
    expect(select.options[0].textContent).toBe('Player faction (auto)');
  });
});
