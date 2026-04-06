/**
 * RuntimeFooterUiKitSetup.js
 *
 * Encapsulates footer UI kit initialization.
 */
(function () {
  function setupFooterUiKit({
    footerUiKitApi,
    wm,
    updateFooterQuickNavBadge,
    documentRef,
    windowRef,
    storage,
  }) {
    footerUiKitApi.initFooterUiKit({
      wm,
      updateFooterQuickNavBadge,
      documentRef,
      windowRef,
      storage,
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { setupFooterUiKit };
  } else {
    window.GQRuntimeFooterUiKitSetup = { setupFooterUiKit };
  }
})();
