import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const bootstrapPath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeSettingsBootstrap.js');

function loadModule() {
  delete window.GQRuntimeSettingsBootstrap;
  window.eval(fs.readFileSync(bootstrapPath, 'utf8'));
  return window.GQRuntimeSettingsBootstrap;
}

describe('RuntimeSettingsBootstrap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.GQRuntimeSettingsDefaults;
    delete window.GQRuntimeThemePalette;
    delete window.GQRuntimeHints;
    delete window.GQRuntimeSettingsStorage;
    delete window.GQRuntimeSettingsBootstrap;
  });

  function installDeps(spies = {}) {
    const themeConfigureSpy = spies.themeConfigureSpy || vi.fn();
    const hintsConfigureSpy = spies.hintsConfigureSpy || vi.fn();
    const loadSpy = spies.loadSpy || vi.fn(() => ({ uiThemeMode: 'faction' }));
    const saveSpy = spies.saveSpy || vi.fn();

    window.GQRuntimeSettingsDefaults = {
      createDefaultSettingsState: vi.fn(() => ({ fromDefaults: true })),
      createUiThemeModeValues: vi.fn(() => ['faction', 'classic', 'custom']),
      UI_THEME_DEFAULT_ACCENT: '#3aa0ff',
      UI_THEME_DYNAMIC_VARS: ['--gq-accent'],
      UI_SETTINGS_STORAGE_KEY: 'gq_ui_settings',
      UI_SETTINGS_SESSION_KEY: 'gq_ui_settings_session',
      UI_SETTINGS_COOKIE_KEY: 'gq_ui_settings_cookie',
      UI_SETTINGS_COOKIE_MAX_AGE_SEC: 86400,
    };

    window.GQRuntimeThemePalette = {
      configureThemeRuntime: themeConfigureSpy,
      normalizeHexColor: vi.fn((value, fallback) => value || fallback),
      createThemePaletteFromAccent: vi.fn(() => ({})),
      resolvePlayerFactionThemeSeed: vi.fn(() => 'seed'),
      ensureFactionThemeCacheEntry: vi.fn(),
      warmFactionThemeCacheFromTerritory: vi.fn(),
      resolveThemePaletteForSelection: vi.fn(() => ({})),
      applyUiTheme: vi.fn(),
    };

    window.GQRuntimeHints = {
      configureHintsRuntime: hintsConfigureSpy,
      showOrbitModeHintOnce: vi.fn(),
      showGalaxyShortcutsHintOnce: vi.fn(),
      scheduleFleetLegendHint: vi.fn(),
    };

    window.GQRuntimeSettingsStorage = {
      loadPortableUiSettings: loadSpy,
      savePortableUiSettings: saveSpy,
    };

    return { themeConfigureSpy, hintsConfigureSpy, loadSpy, saveSpy };
  }

  it('uses provided settingsState when passed in options', () => {
    const { themeConfigureSpy } = installDeps();
    const mod = loadModule();
    const externalState = { uiThemeMode: 'custom', uiThemeAccent: '#112233' };

    const bootstrap = mod.createSettingsBootstrap({
      windowRef: window,
      documentRef: document,
      settingsState: externalState,
      getCurrentUser: () => ({ id: 1 }),
      getUiState: () => ({ activeGalaxy: 1 }),
      showToast: vi.fn(),
      showToastWithAction: vi.fn(),
      gameLog: vi.fn(),
    });

    expect(bootstrap.settingsState).toBe(externalState);
    expect(themeConfigureSpy).toHaveBeenCalledOnce();
    const configArg = themeConfigureSpy.mock.calls[0][0];
    expect(configArg.getSettingsState()).toBe(externalState);
  });

  it('falls back to default settingsState when none is provided', () => {
    const { loadSpy, saveSpy } = installDeps();
    const mod = loadModule();

    const bootstrap = mod.createSettingsBootstrap({
      windowRef: window,
      documentRef: document,
      showToast: vi.fn(),
      showToastWithAction: vi.fn(),
      gameLog: vi.fn(),
    });

    expect(bootstrap.settingsState).toEqual({ fromDefaults: true });
    bootstrap.loadPortableUiSettings();
    expect(loadSpy).toHaveBeenCalledOnce();
    bootstrap.savePortableUiSettings({ uiThemeMode: 'classic' });
    expect(saveSpy).toHaveBeenCalledOnce();
  });
});
