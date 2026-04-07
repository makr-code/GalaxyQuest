/**
 * RenderContext.js
 *
 * Builds the argument object for RuntimeSettingsRenderFacade.
 */
(function () {
  function createSettingsRenderContextBuilder() {
    function build({
      wm,
      settingsState,
      audioManager,
      esc,
      audioTrackOptions,
      audioEvents,
      sfxOptions,
      formatLastAudioEvent,
      settingsSectionsComposer,
      settingsViewModelBuilder,
      settingsCoreSectionTemplateBuilder,
      settingsRenderModelBuilder,
      settingsRenderBindings,
      settingsBaseBindings,
      settingsPanelBindingsOrchestrator,
      settingsController,
      getPinnedStar,
      getActiveStar,
      renderGalaxySystemDetails,
      isSystemModeActive,
      galaxyController,
      applyTransitionPreset,
      loadAudioTrackCatalog,
      showToast,
      saveUiSettings,
      refreshAudioUi,
      rerenderSettings,
      api,
      fmt,
      windowRef,
    }) {
      return {
        wm,
        settingsState,
        audioManager,
        esc,
        audioTrackOptions,
        audioEvents,
        sfxOptions,
        formatLastAudioEvent,
        settingsSectionsComposer,
        settingsViewModelBuilder,
        settingsCoreSectionTemplateBuilder,
        settingsRenderModelBuilder,
        settingsRenderBindings,
        settingsBaseBindings,
        settingsPanelBindingsOrchestrator,
        settingsController,
        getPinnedStar,
        getActiveStar,
        renderGalaxySystemDetails,
        isSystemModeActive,
        galaxyController,
        applyTransitionPreset,
        loadAudioTrackCatalog,
        showToast,
        saveUiSettings,
        refreshAudioUi,
        rerenderSettings,
        api,
        fmt,
        windowRef,
      };
    }

    return { build };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createSettingsRenderContextBuilder };
  } else {
    window.GQRuntimeSettingsRenderContext = { createSettingsRenderContextBuilder };
  }
})();
