/**
 * RuntimeGalaxyControllerRenderWindowFlow.js
 *
 * Extracted post-shell flow of GalaxyController.renderWindow.
 */

'use strict';

(function () {
  function flowLog(level, message, meta = null) {
    try {
      const fn = window.GQLog && typeof window.GQLog[level] === 'function' ? window.GQLog[level] : null;
      if (fn) {
        fn('[galaxy-renderflow]', message, meta || {});
      } else {
        const method = (level === 'warn' || level === 'error' || level === 'info') ? level : 'log';
        console[method]('[GQ][galaxy-renderflow]', message, meta || {});
      }
    } catch (_) {}
  }

  function createGalaxyControllerRenderWindowFlow(opts = {}) {
    const getGalaxyHealthLastCheckMs = typeof opts.getGalaxyHealthLastCheckMs === 'function'
      ? opts.getGalaxyHealthLastCheckMs
      : (() => 0);
    const refreshGalaxyHealth = typeof opts.refreshGalaxyHealth === 'function' ? opts.refreshGalaxyHealth : (() => {});
    const bindGalaxyNavOrb = typeof opts.bindGalaxyNavOrb === 'function' ? opts.bindGalaxyNavOrb : (() => {});
    const getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : (() => null);
    const documentRef = opts.documentRef || document;
    const init3D = typeof opts.init3D === 'function' ? opts.init3D : (() => {});
    const loadStars3D = typeof opts.loadStars3D === 'function' ? opts.loadStars3D : (() => {});
    const showGalaxyShortcutsHintOnce = typeof opts.showGalaxyShortcutsHintOnce === 'function' ? opts.showGalaxyShortcutsHintOnce : (() => {});
    const scheduleFleetLegendHint = typeof opts.scheduleFleetLegendHint === 'function' ? opts.scheduleFleetLegendHint : (() => {});
    const refreshGalaxyDensityMetrics = typeof opts.refreshGalaxyDensityMetrics === 'function' ? opts.refreshGalaxyDensityMetrics : (() => {});
    const updateGalaxyFollowUi = typeof opts.updateGalaxyFollowUi === 'function' ? opts.updateGalaxyFollowUi : (() => {});
    const updateClusterBoundsUi = typeof opts.updateClusterBoundsUi === 'function' ? opts.updateClusterBoundsUi : (() => {});
    const updateClusterHeatmapUi = typeof opts.updateClusterHeatmapUi === 'function' ? opts.updateClusterHeatmapUi : (() => {});
    const updateGalaxyColonyFilterUi = typeof opts.updateGalaxyColonyFilterUi === 'function' ? opts.updateGalaxyColonyFilterUi : (() => {});
    const updateCoreFxUi = typeof opts.updateCoreFxUi === 'function' ? opts.updateCoreFxUi : (() => {});
    const updateFleetVectorsUi = typeof opts.updateFleetVectorsUi === 'function' ? opts.updateFleetVectorsUi : (() => {});
    const updateLegacyFallbackUi = typeof opts.updateLegacyFallbackUi === 'function' ? opts.updateLegacyFallbackUi : (() => {});
    const updateMagnetUi = typeof opts.updateMagnetUi === 'function' ? opts.updateMagnetUi : (() => {});

    function run(root) {
      if (!root) return;

      flowLog('info', 'run:start', {
        hasRoot: !!root,
        hasHost: !!documentRef.getElementById('galaxy-3d-host'),
        hasRenderer: !!getGalaxy3d(),
      });

      if (root.querySelector('#gal-health-badge') && (Date.now() - getGalaxyHealthLastCheckMs()) > 60 * 1000) {
        refreshGalaxyHealth(root, false);
      }

      // Reconnect Nav Orb handlers if the galaxy DOM was recreated externally.
      bindGalaxyNavOrb(root);

      if (!getGalaxy3d() && documentRef.getElementById('galaxy-3d-host')) {
        flowLog('info', 'run:bootstrap-needed', {
          hasRenderer: !!getGalaxy3d(),
          hasHost: !!documentRef.getElementById('galaxy-3d-host'),
        });
        try {
          init3D(root);
          flowLog('info', 'run:init3D:dispatched', {
            hasRendererAfterInit: !!getGalaxy3d(),
          });
        } catch (err) {
          flowLog('error', 'run:init3D:failed', {
            error: String(err?.message || err || 'unknown error'),
          });
        }

        try {
          Promise.resolve(loadStars3D(root)).catch((err) => {
            flowLog('error', 'run:loadStars3D:rejected', {
              error: String(err?.message || err || 'unknown error'),
            });
          });
          flowLog('info', 'run:loadStars3D:dispatched', {});
        } catch (err) {
          flowLog('error', 'run:loadStars3D:failed-sync', {
            error: String(err?.message || err || 'unknown error'),
          });
        }
      }

      showGalaxyShortcutsHintOnce();
      scheduleFleetLegendHint(1300);

      refreshGalaxyDensityMetrics(root);
      updateGalaxyFollowUi(root);
      updateClusterBoundsUi(root);
      updateClusterHeatmapUi(root);
      updateGalaxyColonyFilterUi(root);
      updateCoreFxUi(root);
      updateFleetVectorsUi(root);
      updateLegacyFallbackUi(root);
      updateMagnetUi(root);
    }

    return {
      run,
    };
  }

  const api = {
    createGalaxyControllerRenderWindowFlow,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyControllerRenderWindowFlow = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
