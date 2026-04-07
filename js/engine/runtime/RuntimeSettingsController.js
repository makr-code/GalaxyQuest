/**
 * RuntimeSettingsController.js
 *
 * Factory for settings controller behavior used by runtime/game.
 */

'use strict';

(function () {
  function createSettingsController(opts = {}) {
    const windowRef = opts.windowRef || window;
    const documentRef = opts.documentRef || document;

    const settingsState = opts.settingsState;
    const uiState = opts.uiState;
    const currentUser = opts.currentUser;
    const getAudioManager = typeof opts.getAudioManager === 'function'
      ? opts.getAudioManager
      : (() => opts.audioManager || null);
    const getAudioTrackOptions = typeof opts.getAudioTrackOptions === 'function' ? opts.getAudioTrackOptions : (() => []);
    const renderMonoIconButton = opts.renderMonoIconButton;
    const renderTopbarTrackQuickList = opts.renderTopbarTrackQuickList;
    const resolveAudioTrackLabel = opts.resolveAudioTrackLabel;
    const updateTopbarTrackTicker = opts.updateTopbarTrackTicker;

    const loadPortableUiSettings = opts.loadPortableUiSettings;
    const savePortableUiSettings = opts.savePortableUiSettings;
    const applyTransitionPreset = opts.applyTransitionPreset;
    const normalizeHexColor = opts.normalizeHexColor;
    const uiThemeModeValues = opts.uiThemeModeValues;
    const uiThemeDefaultAccent = opts.uiThemeDefaultAccent;
    const galaxyFiltersEnabled = !!opts.galaxyFiltersEnabled;
    const applyUiTheme = opts.applyUiTheme;
    const resolvePlayerFactionThemeSeed = opts.resolvePlayerFactionThemeSeed;
    const esc = opts.esc;
    const resolveThemePaletteForSelection = opts.resolveThemePaletteForSelection;

    const wm = opts.wm;
    const closeTopbarSearchOverlay = opts.closeTopbarSearchOverlay;
    const closeTopbarPlayerMenu = opts.closeTopbarPlayerMenu;
    const showToast = opts.showToast;
    const api = opts.api;
    const loadOverview = opts.loadOverview;

    const getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : (() => null);
    const getGalaxy3dQualityState = typeof opts.getGalaxy3dQualityState === 'function' ? opts.getGalaxy3dQualityState : (() => null);
    const callRendererMethod = opts.callRendererMethod;
    const hasRendererMethod = opts.hasRendererMethod;

    const controller = {
      refreshAudioUi() {
        const audioUiApi = windowRef.GQRuntimeAudioUi || null;
        if (!audioUiApi || typeof audioUiApi.refreshAudioUi !== 'function') return;
        audioUiApi.refreshAudioUi({
          audioManager: getAudioManager(),
          settingsState,
          audioTrackOptions: getAudioTrackOptions(),
          documentRef,
          renderMonoIconButton,
          renderTopbarTrackQuickList,
          resolveAudioTrackLabel,
          updateTopbarTrackTicker,
        });
      },

      loadUiSettings() {
        const persisted = loadPortableUiSettings();
        if (persisted && typeof persisted === 'object') {
          Object.assign(settingsState, persisted);
        }
        const normalizationApi = windowRef.GQRuntimeSettingsNormalization || null;
        if (normalizationApi && typeof normalizationApi.normalizeLoadedUiSettings === 'function') {
          normalizationApi.normalizeLoadedUiSettings(settingsState, {
            persisted,
            applyTransitionPreset,
            normalizeHexColor,
            uiThemeModeValues,
            uiThemeDefaultAccent,
            galaxyFiltersEnabled,
          });
        } else {
          applyTransitionPreset(settingsState.transitionPreset);
        }
        const audioManager = getAudioManager();
        if (audioManager) {
          const audioApplyApi = windowRef.GQRuntimeAudioSettingsApply || null;
          if (audioApplyApi && typeof audioApplyApi.applyLoadedAudioSettings === 'function') {
            audioApplyApi.applyLoadedAudioSettings({
              audioManager,
              settingsState,
            });
          }
        }
        applyUiTheme('load-ui-settings');
        this.refreshAudioUi();
        this.refreshThemeSettingsUi();
        this.saveUiSettings();
      },

      refreshThemeSettingsUi() {
        const themeApi = windowRef.GQRuntimeThemeSettingsUi || null;
        if (!themeApi || typeof themeApi.refreshThemeSettingsUi !== 'function') return;
        themeApi.refreshThemeSettingsUi({
          settingsState,
          uiState,
          currentUser,
          resolvePlayerFactionThemeSeed,
          esc,
          onModeChanged: () => {
            this.refreshThemeSettingsUi();
            this.renderThemePreviewUi();
          },
          onPreviewRequested: () => {
            this.renderThemePreviewUi();
          },
        });
      },

      renderThemePreviewUi() {
        const themeApi = windowRef.GQRuntimeThemeSettingsUi || null;
        if (!themeApi || typeof themeApi.renderThemePreviewUi !== 'function') return;
        themeApi.renderThemePreviewUi({
          settingsState,
          normalizeHexColor,
          resolveThemePaletteForSelection,
          uiThemeDefaultAccent,
        });
      },

      saveUiSettings() {
        savePortableUiSettings(settingsState);
      },

      renderUserMenu() {
      },

      closeUserMenu() {
        const userMenuApi = windowRef.GQRuntimeUserMenuUi || null;
        if (!userMenuApi || typeof userMenuApi.closeUserMenuUi !== 'function') return;
        userMenuApi.closeUserMenuUi({
          WM: wm,
          documentRef,
        });
      },

      openUserMenu() {
        const userMenuApi = windowRef.GQRuntimeUserMenuUi || null;
        if (!userMenuApi || typeof userMenuApi.openUserMenuUi !== 'function') return;
        userMenuApi.openUserMenuUi({
          WM: wm,
          settingsState,
          onCloseTopbarSearchOverlay: closeTopbarSearchOverlay,
          onCloseTopbarPlayerMenu: closeTopbarPlayerMenu,
          onMenuAction: (action) => {
            this.handleUserMenuAction(action);
          },
          onCloseUserMenu: () => {
            this.closeUserMenu();
          },
          documentRef,
        });
      },

      toggleUserMenu() {
        const userMenuApi = windowRef.GQRuntimeUserMenuUi || null;
        if (!userMenuApi || typeof userMenuApi.toggleUserMenuUi !== 'function') return;
        userMenuApi.toggleUserMenuUi({
          documentRef,
          onCloseUserMenu: () => {
            this.closeUserMenu();
          },
          onOpenUserMenu: () => {
            this.openUserMenu();
          },
        });
      },

      async handleUserMenuAction(action) {
        const userMenuActionsApi = windowRef.GQRuntimeUserMenuActions || null;
        if (!userMenuActionsApi || typeof userMenuActionsApi.handleUserMenuAction !== 'function') return;
        await userMenuActionsApi.handleUserMenuAction(action, {
          settingsState,
          audioManager: getAudioManager(),
          saveUiSettings: () => this.saveUiSettings(),
          refreshAudioUi: () => this.refreshAudioUi(),
          renderUserMenu: () => this.renderUserMenu(),
          applyTransitionPreset,
          applyRuntimeSettings: () => this.applyRuntimeSettings(),
          showToast,
          API: api,
          loadOverview,
          closeUserMenu: () => this.closeUserMenu(),
          documentRef,
        });
      },

      initUserMenu() {
        const userMenuApi = windowRef.GQRuntimeUserMenuUi || null;
        if (!userMenuApi || typeof userMenuApi.initUserMenuBindings !== 'function') return;
        userMenuApi.initUserMenuBindings({
          WM: wm,
          onCloseUserMenu: () => {
            this.closeUserMenu();
          },
          onToggleUserMenu: () => {
            this.toggleUserMenu();
          },
          documentRef,
          windowRef,
        });
      },

      applyRuntimeSettings() {
        applyUiTheme('apply-runtime');
        const galaxy3d = getGalaxy3d();
        if (!galaxy3d) return;
        const runtimeApplyApi = windowRef.GQRuntimeRendererSettingsApply || null;
        if (!runtimeApplyApi || typeof runtimeApplyApi.applyRendererRuntimeSettings !== 'function') return;
        runtimeApplyApi.applyRendererRuntimeSettings({
          renderer: galaxy3d,
          settingsState,
          galaxy3dQualityState: getGalaxy3dQualityState(),
          callRendererMethod,
          hasRendererMethod,
        });
      },
    };

    return controller;
  }

  const api = {
    createSettingsController,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsController = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();