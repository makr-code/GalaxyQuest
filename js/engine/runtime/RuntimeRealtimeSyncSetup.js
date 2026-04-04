/**
 * RuntimeRealtimeSyncSetup.js
 *
 * Encapsulates realtime sync runtime configuration + initialization.
 */
(function () {
  function setupRealtimeSync({
    realtimeSyncApi,
    windowRef,
    documentRef,
    onLoadBadge,
    onLoadOverview,
    invalidateGetCache,
    refreshWindow,
    getGalaxyRoot,
    refreshGalaxyDensityMetrics,
    showToast,
    gameLog,
    eventSourceFactory,
  }) {
    realtimeSyncApi.configureRealtimeSyncRuntime({
      windowRef,
      documentRef,
      onLoadBadge,
      onLoadOverview,
      invalidateGetCache,
      refreshWindow,
      getGalaxyRoot,
      refreshGalaxyDensityMetrics,
      showToast,
      gameLog,
      eventSourceFactory,
    });
    realtimeSyncApi.initRealtimeSync();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { setupRealtimeSync };
  } else {
    window.GQRuntimeRealtimeSyncSetup = { setupRealtimeSync };
  }
})();
