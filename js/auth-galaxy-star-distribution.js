/*
 * @deprecated 2026-03-29 — Abhaengigkeit von auth-galaxy-animation-profile.js,
 * das selbst nicht mehr geladen wird. Kann nach Migrationsperiode entfernt werden.
 */
/*
 * Auth Galaxy Star Distribution
 * Generates deterministic-shape random stars for the auth background.
 */
(function () {
  function weightedRandomClass() {
    const r = Math.random();
    if (r < 0.01) return 'O';
    if (r < 0.04) return 'B';
    if (r < 0.10) return 'A';
    if (r < 0.24) return 'F';
    if (r < 0.46) return 'G';
    if (r < 0.73) return 'K';
    return 'M';
  }

  function generateStars(count = 8200, maxLy = 5600) {
    const total = Math.max(100, Number(count || 0));
    const radiusMax = Math.max(1200, Number(maxLy || 0));
    const stars = [];

    for (let i = 0; i < total; i += 1) {
      const radiusNorm = Math.pow(Math.random(), 1.22);
      const theta = Math.random() * Math.PI * 2;
      const jitter = (Math.random() - 0.5) * (0.14 + radiusNorm * 0.28);
      const radial = radiusMax * radiusNorm;
      const x = Math.cos(theta + jitter) * radial + (Math.random() - 0.5) * (32 + radiusNorm * 75);
      const y = Math.sin(theta + jitter) * radial + (Math.random() - 0.5) * (32 + radiusNorm * 75);
      const z = (Math.random() - 0.5) * (190 + radial * 0.18);

      stars.push({
        id: i + 1,
        galaxy_index: 1,
        system_index: i + 1,
        x_ly: x,
        y_ly: y,
        z_ly: z,
        spectral_class: weightedRandomClass(),
        subtype: Math.floor(Math.random() * 10),
        owner_id: 0,
        population: 0,
      });
    }

    return stars;
  }

  window.GQAuthGalaxyStarDistribution = {
    weightedRandomClass,
    generateStars,
  };
})();
