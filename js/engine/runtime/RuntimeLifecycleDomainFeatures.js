/**
 * RuntimeLifecycleDomainFeatures.js
 *
 * Registers first domain lifecycle features for settings/quests UI sync.
 */
(function () {
  function registerLifecycleDomainFeatures({ manager, wm, renderSettings, renderQuests, gameLog }) {
    if (!manager || typeof manager.registerFeature !== 'function') {
      throw new Error('[RuntimeLifecycleDomainFeatures] manager.registerFeature is required');
    }

    async function syncOpenWindows() {
      const isOpen = (name) => {
        try {
          return !!wm?.isOpen?.(name);
        } catch (_) {
          return false;
        }
      };

      if (isOpen('settings') && typeof renderSettings === 'function') {
        try {
          renderSettings();
        } catch (err) {
          if (typeof gameLog === 'function') {
            gameLog('warn', '[LifecycleFeature] settings sync failed', err);
          }
        }
      }

      if (isOpen('quests') && typeof renderQuests === 'function') {
        try {
          await renderQuests();
        } catch (err) {
          if (typeof gameLog === 'function') {
            gameLog('warn', '[LifecycleFeature] quests sync failed', err);
          }
        }
      }
    }

    manager.registerFeature({
      name: 'domain-ui-open-window-sync',
      phaseOrder: 200,
      onUiReady: syncOpenWindows,
      onResume: syncOpenWindows,
    });
  }

  const api = { registerLifecycleDomainFeatures };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeLifecycleDomainFeatures = api;
  }
})();
