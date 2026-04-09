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
    const runtimeAudioUiApi = opts.runtimeAudioUiApi || windowRef.GQRuntimeAudioUi || null;
    const runtimeSettingsNormalizationApi = opts.runtimeSettingsNormalizationApi || windowRef.GQRuntimeSettingsNormalization || null;
    const runtimeAudioSettingsApplyApi = opts.runtimeAudioSettingsApplyApi || windowRef.GQRuntimeAudioSettingsApply || null;
    const runtimeThemeSettingsUiApi = opts.runtimeThemeSettingsUiApi || windowRef.GQRuntimeThemeSettingsUi || null;
    const runtimeUserMenuUiApi = opts.runtimeUserMenuUiApi || windowRef.GQRuntimeUserMenuUi || null;
    const runtimeUserMenuActionsApi = opts.runtimeUserMenuActionsApi || windowRef.GQRuntimeUserMenuActions || null;
    const runtimeRendererSettingsApplyApi = opts.runtimeRendererSettingsApplyApi || windowRef.GQRuntimeRendererSettingsApply || null;

    const controller = {
      refreshAudioUi() {
        if (!runtimeAudioUiApi || typeof runtimeAudioUiApi.refreshAudioUi !== 'function') return;
        runtimeAudioUiApi.refreshAudioUi({
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
        if (runtimeSettingsNormalizationApi && typeof runtimeSettingsNormalizationApi.normalizeLoadedUiSettings === 'function') {
          runtimeSettingsNormalizationApi.normalizeLoadedUiSettings(settingsState, {
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
          if (runtimeAudioSettingsApplyApi && typeof runtimeAudioSettingsApplyApi.applyLoadedAudioSettings === 'function') {
            runtimeAudioSettingsApplyApi.applyLoadedAudioSettings({
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
        if (!runtimeThemeSettingsUiApi || typeof runtimeThemeSettingsUiApi.refreshThemeSettingsUi !== 'function') return;
        runtimeThemeSettingsUiApi.refreshThemeSettingsUi({
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
        if (!runtimeThemeSettingsUiApi || typeof runtimeThemeSettingsUiApi.renderThemePreviewUi !== 'function') return;
        runtimeThemeSettingsUiApi.renderThemePreviewUi({
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
        if (!runtimeUserMenuUiApi || typeof runtimeUserMenuUiApi.closeUserMenuUi !== 'function') return;
        runtimeUserMenuUiApi.closeUserMenuUi({
          WM: wm,
          documentRef,
        });
      },

      openUserMenu() {
        if (!runtimeUserMenuUiApi || typeof runtimeUserMenuUiApi.openUserMenuUi !== 'function') return;
        runtimeUserMenuUiApi.openUserMenuUi({
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
        if (!runtimeUserMenuUiApi || typeof runtimeUserMenuUiApi.toggleUserMenuUi !== 'function') return;
        runtimeUserMenuUiApi.toggleUserMenuUi({
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
        if (!runtimeUserMenuActionsApi || typeof runtimeUserMenuActionsApi.handleUserMenuAction !== 'function') return;
        await runtimeUserMenuActionsApi.handleUserMenuAction(action, {
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
        if (!runtimeUserMenuUiApi || typeof runtimeUserMenuUiApi.initUserMenuBindings !== 'function') return;
        runtimeUserMenuUiApi.initUserMenuBindings({
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
        if (!runtimeRendererSettingsApplyApi || typeof runtimeRendererSettingsApplyApi.applyRendererRuntimeSettings !== 'function') return;
        runtimeRendererSettingsApplyApi.applyRendererRuntimeSettings({
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