/**
 * RuntimeBootSetupSequence.js
 *
 * Runs the final startup sequence after render delegates are initialized.
 */
(function () {
  async function runBootSetupSequence({
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
    logoutHandlerApi.bindLogoutHandler({
      documentRef,
      audioManager,
      api,
      gameLog,
      localStorageRef,
      sessionStorageRef,
      windowRef,
    });

    const badgeLoader = badgeLoaderApi.createBadgeLoader({ messagesController });
    const loadBadge = badgeLoader.loadBadge;

    realtimeSyncSetupApi.setupRealtimeSync({
      realtimeSyncApi,
      windowRef,
      documentRef,
      onLoadBadge: loadBadge,
      onLoadOverview: loadOverview,
      invalidateGetCache,
      refreshWindow,
      getGalaxyRoot,
      refreshGalaxyDensityMetrics,
      showToast,
      gameLog,
      eventSourceFactory,
    });

    startupBootSetupApi.setupStartupBoot({
      startupBootApi,
      wm,
      audioManager,
      loadAudioTrackCatalog,
      refreshAudioUi,
      gameLog,
      windowRef,
    });

    footerUiKitSetupApi.setupFooterUiKit({
      footerUiKitApi,
      wm,
      updateFooterQuickNavBadge,
      documentRef,
      windowRef,
      storage: localStorageRef,
    });

    await postBootFlowSetupApi.runPostBootFlowSetup({
      postBootFlowApi,
      wm,
      settingsState,
      focusHomeSystemInGalaxy,
      loadOverview,
      loadBadge,
      initSystemBreadcrumb,
      advisorWidget,
      gameLog,
      windowRef,
    });

    colonyVfxDebugWidgetSetupApi.setupColonyVfxDebugWidget({
      colonyVfxDebugWidgetApi,
      esc,
      documentRef,
      windowRef,
      logger,
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runBootSetupSequence };
  } else {
    window.GQRuntimeBootSetupSequence = { runBootSetupSequence };
  }
})();
