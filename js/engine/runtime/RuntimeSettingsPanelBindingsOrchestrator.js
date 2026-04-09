/**
 * RuntimeSettingsPanelBindingsOrchestrator.js
 *
 * Orchestrates all three settings panel binding calls (Audio, AI, FTL) into
 * a single `bindAllPanels()` call, removing the need for three separate
 * top-level API lookups inside renderSettings().
 */
(function () {
  function createSettingsPanelBindingsOrchestrator(opts = {}) {
    const audioApi = opts.runtimeAudioSettingsPanelApi || ((typeof window !== 'undefined' && window.GQRuntimeAudioSettingsPanel) || null);
    const aiApi = opts.runtimeAiSettingsPanelApi || ((typeof window !== 'undefined' && window.GQRuntimeAiSettingsPanel) || null);
    const ftlApi = opts.runtimeFtlSettingsPanelApi || ((typeof window !== 'undefined' && window.GQRuntimeFtlSettingsPanel) || null);

    function bindAllPanels({
      root,
      audioState,
      audioTrackOptions,
      settingsState,
      audioManager,
      bindRange,
      loadAudioTrackCatalog,
      showToast,
      saveUiSettings,
      refreshAudioUi,
      rerenderSettings,
      api,
      esc,
      wm,
      fmt,
      windowRef,
    }) {
      if (audioApi) {
        audioApi.bindAudioSettingsPanel({
          root,
          audioState,
          audioTrackOptions,
          settingsState,
          audioManager,
          bindRange,
          loadAudioTrackCatalog,
          showToast,
          saveUiSettings,
          refreshAudioUi,
          rerenderSettings,
        });
      }

      if (aiApi) {
        aiApi.bindAiSettingsPanel({
          root,
          api,
          esc,
          showToast,
        });
      }

      if (ftlApi) {
        ftlApi.bindFtlSettingsPanel({
          root,
          api,
          wm,
          esc,
          fmt,
          showToast,
          windowRef,
        });
      }
    }

    return { bindAllPanels };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createSettingsPanelBindingsOrchestrator };
  } else {
    window.GQRuntimeSettingsPanelBindingsOrchestrator = { createSettingsPanelBindingsOrchestrator };
  }
})();
