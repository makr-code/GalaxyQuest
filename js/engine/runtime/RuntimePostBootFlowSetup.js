/**
 * RuntimePostBootFlowSetup.js
 *
 * Encapsulates post-boot flow execution.
 */
(function () {
  async function runPostBootFlowSetup({
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
  }) {
    await postBootFlowApi.runPostBootFlow({
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
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runPostBootFlowSetup };
  } else {
    window.GQRuntimePostBootFlowSetup = { runPostBootFlowSetup };
  }
})();
