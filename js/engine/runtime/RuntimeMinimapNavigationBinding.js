/**
 * RuntimeMinimapNavigationBinding.js
 *
 * Binds minimap navigate events to galaxy focus/navigation updates.
 */

'use strict';

(function () {
  function createMinimapNavigationBinding(opts = {}) {
    const boundFlagKey = typeof opts.boundFlagKey === 'string' ? opts.boundFlagKey : '__gqMinimapNavBound';
    const eventName = typeof opts.eventName === 'string' ? opts.eventName : 'gq:minimap-navigate';
    const getGalaxyBody = typeof opts.getGalaxyBody === 'function' ? opts.getGalaxyBody : (() => null);
    const getGalaxyStars = typeof opts.getGalaxyStars === 'function' ? opts.getGalaxyStars : (() => []);
    const getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : (() => null);
    const setPinnedStar = typeof opts.setPinnedStar === 'function' ? opts.setPinnedStar : (() => {});
    const setActiveStar = typeof opts.setActiveStar === 'function' ? opts.setActiveStar : (() => {});
    const renderGalaxyDetails = typeof opts.renderGalaxyDetails === 'function' ? opts.renderGalaxyDetails : (() => {});
    const isSystemModeActive = typeof opts.isSystemModeActive === 'function' ? opts.isSystemModeActive : (() => false);

    function bindOnce() {
      if (window[boundFlagKey]) return;
      window[boundFlagKey] = true;

      window.addEventListener(eventName, (ev) => {
        const detail = ev && ev.detail ? ev.detail : {};
        const g = Number(detail.galaxy || 0);
        const s = Number(detail.system || 0);
        const star = detail.star || null;
        if (!g || !s) return;

        const root = getGalaxyBody();
        if (!root) return;

        const stars = Array.isArray(getGalaxyStars()) ? getGalaxyStars() : [];
        const target = stars.find(
          (row) => Number(row.galaxy_index || 0) === g && Number(row.system_index || 0) === s
        ) || Object.assign({}, star || {}, { galaxy_index: g, system_index: s });

        const galaxy3d = getGalaxy3d();
        if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') {
          galaxy3d.focusOnStar(target, true);
        }

        setPinnedStar(target);
        setActiveStar(target);
        renderGalaxyDetails(root, target, isSystemModeActive());
      });
    }

    return {
      bindOnce,
    };
  }

  const api = {
    createMinimapNavigationBinding,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMinimapNavigationBinding = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
