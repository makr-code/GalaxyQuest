'use strict';

(function () {
  function isCurrentUserAdmin(currentUser) {
    return Number(currentUser?.is_admin || 0) === 1;
  }

  function normalizeStarVisibility(star, currentUser) {
    if (!star || typeof star !== 'object' || !isCurrentUserAdmin(currentUser)) return star;
    return Object.assign({}, star, { visibility_level: 'own' });
  }

  function normalizeStarListVisibility(stars, currentUser) {
    if (!Array.isArray(stars)) return [];
    if (!isCurrentUserAdmin(currentUser)) return stars;
    return stars.map((star) => normalizeStarVisibility(star, currentUser));
  }

  function normalizeSystemPayloadVisibility(payload, currentUser) {
    if (!payload || typeof payload !== 'object' || !isCurrentUserAdmin(currentUser)) return payload;
    return Object.assign({}, payload, {
      visibility: Object.assign({}, payload.visibility || {}, { level: 'own' }),
    });
  }

  const api = {
    isCurrentUserAdmin,
    normalizeStarVisibility,
    normalizeStarListVisibility,
    normalizeSystemPayloadVisibility,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeAdminVisibility = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();