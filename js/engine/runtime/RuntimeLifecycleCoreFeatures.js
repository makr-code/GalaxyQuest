/**
 * RuntimeLifecycleCoreFeatures.js
 *
 * Registers minimal core lifecycle features for the game runtime.
 */
(function () {
  function registerLifecycleCoreFeatures({ manager, refreshFooterNetworkStatus, gameLog }) {
    if (!manager || typeof manager.registerFeature !== 'function') {
      throw new Error('[RuntimeLifecycleCoreFeatures] manager.registerFeature is required');
    }

    manager.registerFeature({
      name: 'core-footer-network-refresh',
      phaseOrder: 10,
      async onServicesReady() {
        if (typeof refreshFooterNetworkStatus !== 'function') return;
        try {
          await refreshFooterNetworkStatus();
        } catch (err) {
          if (typeof gameLog === 'function') {
            gameLog('warn', '[LifecycleFeature] footer network refresh failed', err);
          }
        }
      },
    });

    manager.registerFeature({
      name: 'core-running-telemetry',
      phaseOrder: 20,
      onRunning() {
        if (typeof gameLog === 'function') {
          gameLog('info', '[LifecycleFeature] Runtime entered RUNNING phase');
        }
      },
    });
  }

  const api = { registerLifecycleCoreFeatures };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeLifecycleCoreFeatures = api;
  }
})();
