/**
 * RenderBindings.js
 *
 * Applies settings HTML and wires base + panel bindings after view model composition.
 */
(function () {
  function createSettingsRenderBindings() {
    function apply({
      root,
      coreSectionHtml,
      ftlSectionHtml,
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
      audioState,
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
    }) {
      root.innerHTML = `${coreSectionHtml}\n\n      ${ftlSectionHtml}`;

      const { bindRange, bindDefaultRanges } = settingsBaseBindings.bind({
        root,
        settingsState,
        settingsController,
        wm,
        getPinnedStar,
        getActiveStar,
        renderGalaxySystemDetails,
        isSystemModeActive,
        galaxyController,
        applyTransitionPreset,
      });
      bindDefaultRanges();

      settingsPanelBindingsOrchestrator.bindAllPanels({
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
      });
    }

    return { apply };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createSettingsRenderBindings };
  } else {
    window.GQRuntimeSettingsRenderBindings = { createSettingsRenderBindings };
  }
})();
