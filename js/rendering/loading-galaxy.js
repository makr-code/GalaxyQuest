// Visual loading model, not a catalog or an orbital simulation.
export function generateLoadingGalaxy(count = 9000, radiusLy = 5800, random = Math.random) {
  function gaussian() {
    return Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, random())))
      * Math.cos(2 * Math.PI * random());
  }

  function diskRadius() {
    let radius;
    do {
      radius = -0.22 * Math.log(Math.max(Number.EPSILON, random() * random()));
    } while (radius > 1);
    return radius;
  }

  return Array.from({ length: count }, (_, index) => {
    const component = random();
    const bulge = component < 0.24;
    const arm = !bulge && component < 0.84;
    const radius = bulge ? Math.min(0.28, Math.abs(gaussian()) * 0.075) : diskRadius();
    const theta = arm
      ? Math.floor(random() * 4) * Math.PI / 2 + Math.log((radius + 0.06) / 0.14) / Math.tan(Math.PI / 10)
      : random() * 2 * Math.PI;
    // Gaussian cross-arm scatter narrows in physical width toward the outer tips.
    const width = arm ? 0.004 + 0.032 * (1 - radius) ** 1.4 : 0;
    const offset = gaussian() * width;
    const x = Math.cos(theta) * radius - Math.sin(theta) * offset;
    const y = Math.sin(theta) * radius + Math.cos(theta) * offset;
    const luminosity = random() ** 3;
    const warm = bulge || (!arm && random() < 0.7);
    const color = warm
      ? [1, 0.72 + random() * 0.2, 0.48 + random() * 0.24]
      : [0.55 + random() * 0.25, 0.72 + random() * 0.22, 1];
    return {
      id: index + 1,
      galaxy_index: 1,
      system_index: index + 1,
      x_ly: x * radiusLy,
      y_ly: y * radiusLy,
      z_ly: gaussian() * radiusLy * (bulge ? 0.045 : 0.008),
      display_color: color,
      display_size: bulge ? 3 + luminosity * 4 : 0.65 + luminosity * 2.4,
      display_opacity: bulge ? 0.12 + luminosity * 0.18 : 0.18 + luminosity * 0.62,
      owner_id: 0,
      population: 0,
    };
  });
}
