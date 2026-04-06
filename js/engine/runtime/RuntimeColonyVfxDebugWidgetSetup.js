/**
 * RuntimeColonyVfxDebugWidgetSetup.js
 *
 * Encapsulates safe init for colony VFX debug widget.
 */
(function () {
  function setupColonyVfxDebugWidget({
    colonyVfxDebugWidgetApi,
    esc,
    documentRef,
    windowRef,
    logger,
  }) {
    colonyVfxDebugWidgetApi.safeInitColonyVfxDebugWidget({
      esc,
      documentRef,
      windowRef,
      logger,
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { setupColonyVfxDebugWidget };
  } else {
    window.GQRuntimeColonyVfxDebugWidgetSetup = { setupColonyVfxDebugWidget };
  }
})();
