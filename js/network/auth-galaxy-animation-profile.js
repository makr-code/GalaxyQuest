/*
 * @deprecated 2026-03-29 — Wird nur von auth-galaxy-background-controller.js geladen,
 * welches selbst nicht mehr im aktiven Ladepfad ist. Nachfolger: starfield.js (intern).
 * Kann nach Migrationsperiode entfernt werden.
 */
/*
 * Auth Galaxy Animation Profile (Facade)
 * Keeps a stable API while delegating responsibilities to focused modules.
 */
(function () {
  function getStarDistributionModule() {
    return window.GQAuthGalaxyStarDistribution || null;
  }

  function getRendererProfileModule() {
    return window.GQAuthGalaxyRendererProfile || null;
  }

  function generateStars(count = 8200, maxLy = 5600) {
    const starDistribution = getStarDistributionModule();
    if (!starDistribution || typeof starDistribution.generateStars !== 'function') {
      throw new Error('GQAuthGalaxyStarDistribution.generateStars unavailable');
    }
    return starDistribution.generateStars(count, maxLy);
  }

  function applyRendererProfile(renderer, stars) {
    const rendererProfile = getRendererProfileModule();
    if (!rendererProfile || typeof rendererProfile.applyRendererProfile !== 'function') {
      throw new Error('GQAuthGalaxyRendererProfile.applyRendererProfile unavailable');
    }
    return rendererProfile.applyRendererProfile(renderer, stars);
  }

  window.GQAuthGalaxyAnimationProfile = {
    generateStars,
    applyRendererProfile,
  };
})();
