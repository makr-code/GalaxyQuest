import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const orchestratorPath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeSettingsPanelBindingsOrchestrator.js');

function loadModule() {
  delete window.GQRuntimeSettingsPanelBindingsOrchestrator;
  window.eval(fs.readFileSync(orchestratorPath, 'utf8'));
  return window.GQRuntimeSettingsPanelBindingsOrchestrator;
}

function createBindArgs() {
  return {
    root: document.createElement('div'),
    audioState: {},
    audioTrackOptions: [],
    settingsState: {},
    audioManager: null,
    bindRange: vi.fn(),
    loadAudioTrackCatalog: vi.fn(),
    showToast: vi.fn(),
    saveUiSettings: vi.fn(),
    refreshAudioUi: vi.fn(),
    rerenderSettings: vi.fn(),
    api: {},
    esc: vi.fn((value) => String(value ?? '')),
    wm: {},
    fmt: vi.fn((value) => String(value ?? '')),
    windowRef: window,
  };
}

describe('RuntimeSettingsPanelBindingsOrchestrator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.GQRuntimeSettingsPanelBindingsOrchestrator;
    delete window.GQRuntimeAudioSettingsPanel;
    delete window.GQRuntimeAiSettingsPanel;
    delete window.GQRuntimeFtlSettingsPanel;
  });

  it('uses injected panel APIs when provided', () => {
    const mod = loadModule();
    const audioApi = { bindAudioSettingsPanel: vi.fn() };
    const aiApi = { bindAiSettingsPanel: vi.fn() };
    const ftlApi = { bindFtlSettingsPanel: vi.fn() };

    const orchestrator = mod.createSettingsPanelBindingsOrchestrator({
      runtimeAudioSettingsPanelApi: audioApi,
      runtimeAiSettingsPanelApi: aiApi,
      runtimeFtlSettingsPanelApi: ftlApi,
    });

    orchestrator.bindAllPanels(createBindArgs());

    expect(audioApi.bindAudioSettingsPanel).toHaveBeenCalledOnce();
    expect(aiApi.bindAiSettingsPanel).toHaveBeenCalledOnce();
    expect(ftlApi.bindFtlSettingsPanel).toHaveBeenCalledOnce();
  });

  it('falls back to window globals when no injected APIs are provided', () => {
    const mod = loadModule();
    window.GQRuntimeAudioSettingsPanel = { bindAudioSettingsPanel: vi.fn() };
    window.GQRuntimeAiSettingsPanel = { bindAiSettingsPanel: vi.fn() };
    window.GQRuntimeFtlSettingsPanel = { bindFtlSettingsPanel: vi.fn() };

    const orchestrator = mod.createSettingsPanelBindingsOrchestrator();
    orchestrator.bindAllPanels(createBindArgs());

    expect(window.GQRuntimeAudioSettingsPanel.bindAudioSettingsPanel).toHaveBeenCalledOnce();
    expect(window.GQRuntimeAiSettingsPanel.bindAiSettingsPanel).toHaveBeenCalledOnce();
    expect(window.GQRuntimeFtlSettingsPanel.bindFtlSettingsPanel).toHaveBeenCalledOnce();
  });
});
