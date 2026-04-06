'use strict';

(function () {
  function hasPlanetTextureManifest(payload) {
    if (!payload) return false;
    if (Array.isArray(payload.planets) && payload.planets.length > 0) return true;
    if (payload.star_system && typeof payload.star_system === 'object') return true;
    const planets = payload?.planet_texture_manifest?.planets;
    return !!(planets && typeof planets === 'object' && Object.keys(planets).length);
  }

  const api = {
    hasPlanetTextureManifest,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimePayloadValidation = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();