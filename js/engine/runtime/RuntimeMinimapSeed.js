/**
 * RuntimeMinimapSeed.js
 *
 * Initializes minimap virtual camera from the active or pinned star.
 */

'use strict';

(function () {
  function createMinimapSeed(opts = {}) {
    const getMinimapCamera = typeof opts.getMinimapCamera === 'function' ? opts.getMinimapCamera : (() => ({}));
    const getActiveStar = typeof opts.getActiveStar === 'function' ? opts.getActiveStar : (() => null);
    const getPinnedStar = typeof opts.getPinnedStar === 'function' ? opts.getPinnedStar : (() => null);

    function seedIfNeeded() {
      const minimapCamera = getMinimapCamera() || {};
      if (Number(minimapCamera.targetX || 0) !== 0 || Number(minimapCamera.targetY || 0) !== 0) {
        return false;
      }

      const seedStar = getActiveStar() || getPinnedStar();
      if (!seedStar) return false;

      minimapCamera.targetX = Number(seedStar.x_ly || 0);
      minimapCamera.targetY = Number(seedStar.y_ly || 0);
      minimapCamera.cameraX = minimapCamera.targetX + 68;
      minimapCamera.cameraY = minimapCamera.targetY + 109;
      minimapCamera.zoom = 1;
      return true;
    }

    return {
      seedIfNeeded,
    };
  }

  const api = {
    createMinimapSeed,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMinimapSeed = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
