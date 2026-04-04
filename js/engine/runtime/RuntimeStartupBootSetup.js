/**
 * RuntimeStartupBootSetup.js
 *
 * Encapsulates startup boot initialization.
 */
(function () {
  function setupStartupBoot({
    startupBootApi,
    wm,
    audioManager,
    loadAudioTrackCatalog,
    refreshAudioUi,
    gameLog,
    windowRef,
  }) {
    startupBootApi.initStartupBoot({
      wm,
      audioManager,
      loadAudioTrackCatalog,
      refreshAudioUi,
      gameLog,
      windowRef,
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { setupStartupBoot };
  } else {
    window.GQRuntimeStartupBootSetup = { setupStartupBoot };
  }
})();
