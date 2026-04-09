/**
 * RuntimeBootSetupContext.js
 *
 * Builds the argument object for RuntimeBootSetupSequence.
 */
(function () {
  function createBootSetupContextBuilder() {
    function build({
      logoutHandlerApi,
      badgeLoaderApi,
      realtimeSyncSetupApi,
      startupBootSetupApi,
      footerUiKitSetupApi,
      postBootFlowSetupApi,
      colonyVfxDebugWidgetSetupApi,
      realtimeSyncApi,
      startupBootApi,
      footerUiKitApi,
      postBootFlowApi,
      colonyVfxDebugWidgetApi,
      messagesController,
      audioManager,
      api,
      gameLog,
      localStorageRef,
      sessionStorageRef,
      windowRef,
      documentRef,
      loadOverview,
      invalidateGetCache,
      refreshWindow,
      getGalaxyRoot,
      refreshGalaxyDensityMetrics,
      showToast,
      eventSourceFactory,
      eventBus,
      wm,
      loadAudioTrackCatalog,
      refreshAudioUi,
      updateFooterQuickNavBadge,
      settingsState,
      focusHomeSystemInGalaxy,
      initSystemBreadcrumb,
      advisorWidget,
      esc,
      logger,
    }) {
      return {
        logoutHandlerApi,
        badgeLoaderApi,
        realtimeSyncSetupApi,
        startupBootSetupApi,
        footerUiKitSetupApi,
        postBootFlowSetupApi,
        colonyVfxDebugWidgetSetupApi,
        realtimeSyncApi,
        startupBootApi,
        footerUiKitApi,
        postBootFlowApi,
        colonyVfxDebugWidgetApi,
        messagesController,
        audioManager,
        api,
        gameLog,
        localStorageRef,
        sessionStorageRef,
        windowRef,
        documentRef,
        loadOverview,
        invalidateGetCache,
        refreshWindow,
        getGalaxyRoot,
        refreshGalaxyDensityMetrics,
        showToast,
        eventSourceFactory,
        eventBus,
        wm,
        loadAudioTrackCatalog,
        refreshAudioUi,
        updateFooterQuickNavBadge,
        settingsState,
        focusHomeSystemInGalaxy,
        initSystemBreadcrumb,
        advisorWidget,
        esc,
        logger,
      };
    }

    return { build };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createBootSetupContextBuilder };
  } else {
    window.GQRuntimeBootSetupContext = { createBootSetupContextBuilder };
  }
})();
