/**
 * RuntimeSettingsRenderFacade.js
 *
 * Single entry point for rendering the settings window:
 * 1) resolve settings root
 * 2) build render model
 * 3) apply HTML and bindings
 */
(function () {
  function createSettingsRenderFacade() {
    function render({
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
      const root = wm.body('settings');
      if (!root) return;

      const settingsRenderModel = settingsRenderModelBuilder.build({
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
      });

      settingsRenderBindings.apply({
        root,
        coreSectionHtml: settingsRenderModel.coreSectionHtml,
        ftlSectionHtml: settingsRenderModel.ftlSectionHtml,
        settingsBaseBindings,
        settingsPanelBindingsOrchestrator,
        settingsState,
        settingsController,
        wm,
        getPinnedStar,
        getActiveStar,
        renderGalaxySystemDetails,
        isSystemModeActive,
        galaxyController,
        applyTransitionPreset,
        audioState: settingsRenderModel.audioState,
        audioTrackOptions,
        audioManager,
        loadAudioTrackCatalog,
        showToast,
        saveUiSettings,
        refreshAudioUi,
        rerenderSettings,
        api,
        esc,
        fmt,
        windowRef,
      });
    }

    return { render };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createSettingsRenderFacade };
  } else {
    window.GQRuntimeSettingsRenderFacade = { createSettingsRenderFacade };
  }
})();
