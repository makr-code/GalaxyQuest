/**
 * PhysicsFlight.js
 *
 * Physics-based cinematic camera flight helpers.
 */

'use strict';

(function () {
  const state = {
    windowRef: null,
    getGalaxy3d: null,
    hasRendererMethod: null,
    callRendererMethod: null,
    getGalaxyStars: null,
    waitMs: null,
  };

  function configureGalaxyPhysicsFlightRuntime(opts = {}) {
    state.windowRef = opts.windowRef || window;
    state.getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : (() => null);
    state.hasRendererMethod = typeof opts.hasRendererMethod === 'function' ? opts.hasRendererMethod : (() => false);
    state.callRendererMethod = typeof opts.callRendererMethod === 'function' ? opts.callRendererMethod : (() => null);
    state.getGalaxyStars = typeof opts.getGalaxyStars === 'function' ? opts.getGalaxyStars : (() => []);
    state.waitMs = typeof opts.waitMs === 'function' ? opts.waitMs : ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  function canUsePhysicsFlightPath(target) {
    return !!(
      state.getGalaxy3d?.()
      && state.hasRendererMethod?.('setCameraDriver')
      && state.hasRendererMethod?.('clearCameraDriver')
      && state.windowRef?.GQSpaceCameraFlightDriver
      && typeof state.windowRef?.GQSpaceCameraFlightDriver?.create === 'function'
      && Number.isFinite(Number(target?.x_ly))
      && Number.isFinite(Number(target?.z_ly))
    );
  }

  async function runPhysicsCinematicFlight(target, opts = {}) {
    if (!canUsePhysicsFlightPath(target)) return { ok: false, reason: 'unavailable' };

    const durationSec = Math.max(1.2, Number(opts.durationSec || 2.2));
    const holdMs = Math.max(420, Number(opts.holdMs || Math.round(durationSec * 520)));
    const label = String(opts.label || target?.name || target?.catalog_name || `System ${Number(target?.system_index || 0)}`);

    try {
      const driver = state.windowRef.GQSpaceCameraFlightDriver.create({ three: state.windowRef.THREE });
      const stars = Array.isArray(state.getGalaxyStars?.()) ? state.getGalaxyStars() : [];
      if (typeof driver.setRandomStars === 'function' && stars.length) {
        driver.setRandomStars(stars);
      }
      const accepted = driver.setTarget({
        id: Number(target?.id || target?.system_index || 0) || 0,
        x_ly: Number(target?.x_ly),
        y_ly: Number(target?.y_ly || 0),
        z_ly: Number(target?.z_ly),
        label,
      }, { durationSec });
      if (!accepted) return { ok: false, reason: 'target-rejected' };

      state.callRendererMethod?.('setCameraDriver', driver, { consumeAutoNav: true, updateControls: true });
      await state.waitMs?.(holdMs);
      return { ok: true };
    } catch (_) {
      return { ok: false, reason: 'driver-error' };
    } finally {
      try {
        state.callRendererMethod?.('clearCameraDriver');
      } catch (_) {}
    }
  }

  const api = {
    configureGalaxyPhysicsFlightRuntime,
    canUsePhysicsFlightPath,
    runPhysicsCinematicFlight,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyPhysicsFlight = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();