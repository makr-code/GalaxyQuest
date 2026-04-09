import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const controllerPath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeSettingsController.js');

function loadModule() {
  delete window.GQRuntimeSettingsController;
  window.eval(fs.readFileSync(controllerPath, 'utf8'));
  return window.GQRuntimeSettingsController;
}

function createBaseOptions(overrides = {}) {
  return {
    windowRef: window,
    documentRef: document,
    settingsState: { transitionPreset: 'smooth' },
    uiState: {},
    currentUser: { id: 1 },
    audioManager: { snapshot: vi.fn(() => ({})) },
    getAudioManager: () => ({ snapshot: vi.fn(() => ({})) }),
    getAudioTrackOptions: () => [],
    renderMonoIconButton: vi.fn(),
    renderTopbarTrackQuickList: vi.fn(),
    resolveAudioTrackLabel: vi.fn((v) => String(v || '')),
    updateTopbarTrackTicker: vi.fn(),
    loadPortableUiSettings: vi.fn(() => ({ uiThemeMode: 'classic' })),
    savePortableUiSettings: vi.fn(),
    applyTransitionPreset: vi.fn(),
    normalizeHexColor: vi.fn((v) => v),
    uiThemeModeValues: ['classic', 'faction', 'custom'],
    uiThemeDefaultAccent: '#3aa0ff',
    galaxyFiltersEnabled: true,
    applyUiTheme: vi.fn(),
    resolvePlayerFactionThemeSeed: vi.fn(() => 'seed'),
    esc: vi.fn((v) => String(v || '')),
    resolveThemePaletteForSelection: vi.fn(() => ({})),
    wm: {},
    closeTopbarSearchOverlay: vi.fn(),
    closeTopbarPlayerMenu: vi.fn(),
    showToast: vi.fn(),
    api: {},
    loadOverview: vi.fn(),
    getGalaxy3d: () => ({ renderer: true }),
    getGalaxy3dQualityState: () => ({ quality: 'high' }),
    callRendererMethod: vi.fn(),
    hasRendererMethod: vi.fn(() => true),
    ...overrides,
  };
}

describe('RuntimeSettingsController injected runtime APIs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.GQRuntimeSettingsController;
    delete window.GQRuntimeAudioUi;
    delete window.GQRuntimeSettingsNormalization;
    delete window.GQRuntimeAudioSettingsApply;
    delete window.GQRuntimeThemeSettingsUi;
    delete window.GQRuntimeUserMenuUi;
    delete window.GQRuntimeUserMenuActions;
    delete window.GQRuntimeRendererSettingsApply;
  });

  it('uses injected APIs for loadUiSettings and refreshThemeSettingsUi', () => {
    const mod = loadModule();
    const runtimeAudioUiApi = { refreshAudioUi: vi.fn() };
    const runtimeSettingsNormalizationApi = { normalizeLoadedUiSettings: vi.fn() };
    const runtimeAudioSettingsApplyApi = { applyLoadedAudioSettings: vi.fn() };
    const runtimeThemeSettingsUiApi = {
      refreshThemeSettingsUi: vi.fn(),
      renderThemePreviewUi: vi.fn(),
    };

    const controller = mod.createSettingsController(createBaseOptions({
      runtimeAudioUiApi,
      runtimeSettingsNormalizationApi,
      runtimeAudioSettingsApplyApi,
      runtimeThemeSettingsUiApi,
    }));

    controller.loadUiSettings();

    expect(runtimeSettingsNormalizationApi.normalizeLoadedUiSettings).toHaveBeenCalledOnce();
    expect(runtimeAudioSettingsApplyApi.applyLoadedAudioSettings).toHaveBeenCalledOnce();
    expect(runtimeAudioUiApi.refreshAudioUi).toHaveBeenCalledOnce();
    expect(runtimeThemeSettingsUiApi.refreshThemeSettingsUi).toHaveBeenCalled();
  });

  it('uses injected menu and renderer APIs', async () => {
    const mod = loadModule();
    const runtimeUserMenuUiApi = {
      closeUserMenuUi: vi.fn(),
      openUserMenuUi: vi.fn(),
      toggleUserMenuUi: vi.fn(),
      initUserMenuBindings: vi.fn(),
    };
    const runtimeUserMenuActionsApi = { handleUserMenuAction: vi.fn().mockResolvedValue(undefined) };
    const runtimeRendererSettingsApplyApi = { applyRendererRuntimeSettings: vi.fn() };

    const controller = mod.createSettingsController(createBaseOptions({
      runtimeUserMenuUiApi,
      runtimeUserMenuActionsApi,
      runtimeRendererSettingsApplyApi,
    }));

    controller.initUserMenu();
    controller.openUserMenu();
    controller.toggleUserMenu();
    await controller.handleUserMenuAction('toggle-audio');
    controller.applyRuntimeSettings();

    expect(runtimeUserMenuUiApi.initUserMenuBindings).toHaveBeenCalledOnce();
    expect(runtimeUserMenuUiApi.openUserMenuUi).toHaveBeenCalledOnce();
    expect(runtimeUserMenuUiApi.toggleUserMenuUi).toHaveBeenCalledOnce();
    expect(runtimeUserMenuActionsApi.handleUserMenuAction).toHaveBeenCalledOnce();
    expect(runtimeRendererSettingsApplyApi.applyRendererRuntimeSettings).toHaveBeenCalledOnce();
  });
});
