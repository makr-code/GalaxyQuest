/*
 * @deprecated 2026-03-29 — Abhaengigkeit von auth-galaxy-animation-profile.js,
 * das selbst nicht mehr geladen wird. Kann nach Migrationsperiode entfernt werden.
 */
/*
 * Auth Galaxy Renderer Profile
 * Applies non-interactive visual tuning for login/auth background mode.
 */
(function () {
  function applyRendererProfile(renderer, stars) {
    if (!renderer || typeof renderer !== 'object') return false;

    if (typeof renderer.setTransitionsEnabled === 'function') {
      renderer.setTransitionsEnabled(false);
    }
    if (typeof renderer.setClusterBoundsVisible === 'function') {
      renderer.setClusterBoundsVisible(false);
    }
    if (typeof renderer.setGalacticCoreFxEnabled === 'function') {
      renderer.setGalacticCoreFxEnabled(false);
    }
    if (typeof renderer.setStars === 'function') {
      renderer.setStars(Array.isArray(stars) ? stars : [], { preserveView: false });
    }
    if (typeof renderer.fitCameraToStars === 'function') {
      renderer.fitCameraToStars(false, true);
    }

    return true;
  }

  window.GQAuthGalaxyRendererProfile = {
    applyRendererProfile,
  };
})();
