export function generateGalaxyNebulae({ radiusLy = 50000, armCount = 6, pitchAngleDeg = 14 } = {}) {
  const radius = Math.max(1, Number(radiusLy) || 50000);
  const arms = Math.max(2, Math.min(12, Math.floor(Number(armCount) || 6)));
  const pitch = Math.max(5, Math.min(35, Number(pitchAngleDeg) || 14)) * Math.PI / 180;
  const colors = [
    { inner: [0.95, 0.24, 0.32], outer: [0.28, 0.045, 0.08] },
    { inner: [0.22, 0.52, 1], outer: [0.035, 0.12, 0.32] },
    { inner: [0.16, 0.72, 0.65], outer: [0.025, 0.19, 0.17] },
  ];
  return Array.from({ length: arms * 4 }, (_, index) => {
    const arm = Math.floor(index / 4);
    const segment = index % 4;
    const seed = arm * 17 + segment * 31 + 7;
    const radial = 0.2 + segment * 0.17 + Math.sin(seed) * 0.025;
    const theta = arm * Math.PI * 2 / arms + Math.log(radial / 0.078) / Math.tan(pitch);
    const palette = colors[(arm + segment) % colors.length];
    return {
      id: `nebula-${arm}-${segment}`,
      center: [Math.cos(theta) * radial * radius, Math.sin(theta) * radial * radius,
        Math.sin(seed * 1.7) * radius * 0.008],
      radius: radius * (0.035 + (Math.sin(seed * 2.3) + 1) * 0.012),
      colorInner: [...palette.inner],
      colorOuter: [...palette.outer],
      seed,
      opacity: 0.38,
      visual_only: true,
    };
  });
}

// Visual loading model, not a catalog or an orbital simulation.
export function generateLoadingGalaxy(count = 9000, radiusLy = 5800, random = Math.random, options = {}) {
  const armCount = Math.max(2, Math.min(12, Math.floor(Number(options.armCount) || 6)));
  const pitchAngleDeg = Math.max(5, Math.min(35, Number(options.pitchAngleDeg) || 14));
  const pitchAngleRad = pitchAngleDeg * Math.PI / 180;
  const armStartRadius = 0.078;
  const spursPerArm = 10;

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

  function smoothstep(edge0, edge1, value) {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  return Array.from({ length: count }, (_, index) => {
    const component = random();
    const bulge = component < 0.10;
    const diskRadiusValue = diskRadius();
    const arm = !bulge && component < 0.63 && diskRadiusValue >= armStartRadius;
    const halo = component >= 0.96;
    const radius = bulge
      ? Math.min(0.26, Math.abs(gaussian()) * 0.095)
      : halo
        ? Math.min(1.12, 0.62 + Math.abs(gaussian()) * 0.22)
        : diskRadiusValue;
    const armIndex = arm ? Math.floor(random() * armCount) : -1;
    let theta = arm
      ? armIndex * (2 * Math.PI / armCount) + Math.log(Math.max(radius, armStartRadius) / armStartRadius) / Math.tan(pitchAngleRad)
      : random() * 2 * Math.PI;
    let spurIndex = null;
    if (arm && radius > 0.2 && random() < 0.08) {
      const segment = Math.min(spursPerArm - 1, Math.floor(((radius - armStartRadius) / (1 - armStartRadius)) * spursPerArm));
      const startRadius = armStartRadius + segment * ((1 - armStartRadius) / spursPerArm);
      if (radius > startRadius) {
        const segmentLength = (1 - armStartRadius) / spursPerArm;
        const progress = Math.min(1, (radius - startRadius) / Math.max(0.01, segmentLength * 0.72));
        const smoothProgress = progress * progress * (3 - 2 * progress);
        const side = (armIndex + segment) % 2 === 0 ? 1 : -1;
        theta += side * (0.15 + smoothProgress * 0.9) * Math.PI / 180;
        spurIndex = armIndex * spursPerArm + segment;
      }
    }
    // Main-arm scatter tapers outward; the thinner offshoots remain distinct.
    const width = arm ? 0.003 + 0.029 * (1 - radius) ** 1.45 : 0;
    const offset = gaussian() * width;
    const x = Math.cos(theta) * radius - Math.sin(theta) * offset;
    const y = Math.sin(theta) * radius + Math.cos(theta) * offset;
    const luminosity = random() ** 3;
    const color = bulge
      ? [1, 0.54 + random() * 0.22, 0.25 + random() * 0.2]
      : halo
        ? [0.46 + random() * 0.18, 0.62 + random() * 0.18, 0.86 + random() * 0.14]
        : arm
          ? [0.48 + random() * 0.2, 0.56 + random() * 0.18, 0.7 + random() * 0.16]
          : random() < 0.62
            ? [1, 0.73 + random() * 0.18, 0.48 + random() * 0.25]
            : [0.58 + random() * 0.32, 0.7 + random() * 0.26, 0.94 + random() * 0.06];
    const zScale = bulge ? 0.055 : halo ? 0.18 : 0.009;
    const armProgress = Math.max(0, Math.min(1, (radius - armStartRadius) / (1 - armStartRadius)));
    const armSize = 2.0 - armProgress * 1.25 + luminosity * 0.95;
    const diskSize = bulge
      ? 2.4 + luminosity * 3.4
      : halo
        ? 0.25 + luminosity * 0.9
        : arm
          ? armSize
          : 0.25 + luminosity * 0.9;
    const diskOpacity = bulge
      ? 0.09 + luminosity * 0.21
      : halo
        ? 0.035 + luminosity * 0.09
        : arm
          ? 0.035 + luminosity * 0.12
          : 0.05 + luminosity * 0.14;
    const coreWeight = 1 - smoothstep(0.055, 0.34, radius);
    const coreColor = [1.0, 0.72, 0.48];
    const blendedColor = color.map((channel, channelIndex) => (
      channel * (1 - coreWeight * 0.72) + coreColor[channelIndex] * coreWeight * 0.72
    ));
    const coreSize = 2.4 + luminosity * 3.4;
    const displaySize = diskSize * (1 - coreWeight * 0.72) + coreSize * coreWeight * 0.72;
    const coreOpacity = 0.09 + luminosity * 0.21;
    const displayOpacity = diskOpacity * (1 - coreWeight * 0.72) + coreOpacity * coreWeight * 0.72;
    return {
      id: index + 1,
      galaxy_index: 1,
      system_index: index + 1,
      x_ly: x * radiusLy,
      y_ly: y * radiusLy,
      z_ly: gaussian() * radiusLy * zScale,
      display_color: blendedColor,
      display_size: displaySize,
      display_opacity: displayOpacity,
      visual_only: true,
      visual_component: bulge ? 'bulge' : halo ? 'halo' : spurIndex !== null ? 'spur' : arm ? 'arm' : 'interarm',
      arm_index: arm ? armIndex : null,
      spur_index: spurIndex,
      owner_id: 0,
      population: 0,
    };
  });
}
