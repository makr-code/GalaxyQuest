'use strict';

(function () {
  function updateCommanderButtonLabel(currentUser, deps = {}) {
    const documentRef = deps.documentRef || document;
    const commanderBtn = documentRef.getElementById('commander-name');
    if (commanderBtn) commanderBtn.textContent = `${currentUser.username}`;
  }

  function invalidateGetCache(patterns, deps = {}) {
    const api = deps.api || null;
    const logger = deps.logger || console;
    try {
      if (api && typeof api.invalidateCache === 'function') {
        api.invalidateCache(patterns);
      }
    } catch (err) {
      logger.warn('[GQ][game] Cache-Invalidierung fehlgeschlagen', err);
    }
  }

  const api = {
    updateCommanderButtonLabel,
    invalidateGetCache,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGameBootstrapHelpers = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();