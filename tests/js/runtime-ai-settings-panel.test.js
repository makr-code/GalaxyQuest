// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const panelPaths = [
  'js/engine/runtime/RuntimeAiSettingsPanel.js',
  'js/engine/runtime/layers/ui/settings/ai/SettingsPanel.js',
];

function createPanelRoot() {
  const root = document.createElement('div');
  root.innerHTML = `
    <select id="set-llm-profile"></select>
    <textarea id="set-llm-input-vars"></textarea>
    <textarea id="set-llm-output"></textarea>
    <div id="set-npc-status-line"></div>
    <input id="set-npc-summary-hours" value="24">
    <textarea id="set-npc-summary"></textarea>
    <textarea id="set-npc-decisions"></textarea>
  `;
  return root;
}

describe.each(panelPaths)('Runtime AI settings panel (%s)', (panelPath) => {
  beforeEach(() => {
    delete window.GQRuntimeAiSettingsPanel;
    window.eval(readFileSync(path.resolve(panelPath), 'utf8'));
  });

  it('renders untrusted profile names and keys as option text, not markup', async () => {
    const root = createPanelRoot();
    const profileName = '<img src=x onerror=alert(1)>';
    const profileKey = '"><svg onload=alert(1)>';
    const api = {
      llmProfiles: vi.fn().mockResolvedValue({
        success: true,
        profiles: [{ name: profileName, profile_key: profileKey }],
      }),
      npcControllerStatus: vi.fn().mockResolvedValue({ success: true }),
      npcControllerSummary: vi.fn().mockResolvedValue({ success: true }),
      npcControllerDecisions: vi.fn().mockResolvedValue({ success: true }),
    };

    window.GQRuntimeAiSettingsPanel.bindAiSettingsPanel({
      root,
      api,
      esc: (value) => String(value ?? ''),
    });

    await vi.waitFor(() => {
      expect(root.querySelector('#set-llm-profile option')?.value).toBe(profileKey);
    });

    const select = root.querySelector('#set-llm-profile');
    expect(select.querySelector('img, svg')).toBeNull();
    expect(select.options[0].textContent).toBe(`${profileName} (${profileKey})`);
  });
});
