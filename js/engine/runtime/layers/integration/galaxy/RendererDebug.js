/**
 * RendererDebug.js
 *
 * Console diagnostics for Galaxy3D renderer internals.
 */

'use strict';

(function () {
  const state = {
    getGalaxy3d: () => null,
    consoleRef: (typeof console !== 'undefined' ? console : null),
  };

  function configureGalaxyRendererDebugRuntime(opts = {}) {
    const {
      getGalaxy3d = null,
      consoleRef = (typeof console !== 'undefined' ? console : null),
    } = opts;

    state.getGalaxy3d = typeof getGalaxy3d === 'function' ? getGalaxy3d : (() => null);
    state.consoleRef = consoleRef || null;
  }

  function runGalaxyRendererDebug(pushLine) {
    const logger = typeof pushLine === 'function' ? pushLine : (() => {});
    logger('[galdebug] === Galaxy3D Renderer Status ===');

    const galaxy3d = state.getGalaxy3d();
    if (!galaxy3d) {
      logger('[galdebug] galaxy3d is NULL');
      return false;
    }

    const stats = (typeof galaxy3d.getRenderStats === 'function') ? galaxy3d.getRenderStats() : null;
    logger(`[galdebug] visible stars: ${stats?.visibleStars || 0}`);
    logger(`[galdebug] target points: ${stats?.targetPoints || 0}`);
    logger(`[galdebug] density mode: ${stats?.densityMode || 'n/a'}`);
    logger(`[galdebug] starPoints: ${galaxy3d.starPoints ? 'exists' : 'NULL'}`);

    if (galaxy3d.starPoints) {
      logger(`[galdebug] starPoints.visible: ${galaxy3d.starPoints.visible}`);
      logger(`[galdebug] starPoints.material: ${galaxy3d.starPoints.material?.constructor?.name || 'unknown'}`);
      logger(`[galdebug] starPoints.geometry.attributes.position.count: ${galaxy3d.starPoints.geometry?.attributes?.position?.count || 0}`);
    }

    logger(`[galdebug] renderFrames.galaxy.visible: ${galaxy3d.renderFrames?.galaxy?.visible ?? 'n/a'}`);
    logger(`[galdebug] renderFrames.galaxy children: ${galaxy3d.renderFrames?.galaxy?.children?.length || 0}`);

    if (galaxy3d.renderFrames?.galaxy) {
      const starPointsInScene = galaxy3d.renderFrames.galaxy.children.includes(galaxy3d.starPoints);
      logger(`[galdebug] starPoints in scene: ${starPointsInScene}`);
    }

    logger(`[galdebug] camera position: ${galaxy3d.camera?.position?.x?.toFixed(1) || 'n/a'}, ${galaxy3d.camera?.position?.y?.toFixed(1) || 'n/a'}, ${galaxy3d.camera?.position?.z?.toFixed(1) || 'n/a'}`);

    try {
      if (state.consoleRef && typeof state.consoleRef.log === 'function') {
        state.consoleRef.log('[GQ][galdebug]', { galaxy3d, stats });
      }
    } catch (_) {}

    return true;
  }

  const api = {
    configureGalaxyRendererDebugRuntime,
    runGalaxyRendererDebug,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyRendererDebug = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
