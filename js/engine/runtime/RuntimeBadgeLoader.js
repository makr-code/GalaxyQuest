/**
 * RuntimeBadgeLoader.js
 *
 * Creates a badge loader delegate for message badge refreshes.
 */
(function () {
  function createBadgeLoader({ messagesController }) {
    async function loadBadge() {
      if (!messagesController || typeof messagesController.loadBadge !== 'function') return;
      await messagesController.loadBadge();
    }

    return { loadBadge };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createBadgeLoader };
  } else {
    window.GQRuntimeBadgeLoader = { createBadgeLoader };
  }
})();
