import { describe, expect, it } from 'vitest';
import { generateLoadingGalaxy } from '../../js/rendering/loading-galaxy.js';

function seededRandom() {
  let state = 4281;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('procedural loading galaxy', () => {
  const radiusLy = 5800;
  const armCount = 6;
  const pitchAngleDeg = 14;
  const pitchAngleRad = pitchAngleDeg * Math.PI / 180;
  const stars = generateLoadingGalaxy(9000, radiusLy, seededRandom(), { armCount, pitchAngleDeg });
  const radius = (star) => Math.hypot(star.x_ly, star.y_ly) / radiusLy;

  it('creates a finite, varied visual sample without claiming DB or spectral measurements', () => {
    expect(stars).toHaveLength(9000);
    expect(new Set(stars.map((star) => star.system_index)).size).toBe(9000);
    for (const star of stars) {
      expect([star.x_ly, star.y_ly, star.z_ly, star.display_size, star.display_opacity].every(Number.isFinite)).toBe(true);
      expect(star.display_color.every((channel) => channel >= 0 && channel <= 1)).toBe(true);
      expect(star.display_opacity).toBeGreaterThan(0);
      expect(star.display_opacity).toBeLessThan(1);
      expect(star).not.toHaveProperty('spectral_class');
    }
    expect(Math.max(...stars.map((star) => star.display_size))).toBeGreaterThan(5.5);
    expect(Math.min(...stars.map((star) => star.display_size))).toBeLessThan(1);
  });

  it('has a bright, warm bulge and an outward declining disk surface density', () => {
    const center = stars.filter((star) => radius(star) < 0.1);
    const middle = stars.filter((star) => radius(star) >= 0.3 && radius(star) < 0.5);
    const outer = stars.filter((star) => radius(star) >= 0.8);
    const light = (list) => list.reduce((sum, star) => sum + star.display_size ** 2 * star.display_opacity, 0);
    expect(light(center) / 0.1 ** 2).toBeGreaterThan(light(middle) / (0.5 ** 2 - 0.3 ** 2) * 10);
    expect(middle.length / (0.5 ** 2 - 0.3 ** 2)).toBeGreaterThan(outer.length / (1 - 0.8 ** 2));
    expect(light(center.filter((star) => star.display_color[0] > star.display_color[2])) / light(center)).toBeGreaterThan(0.9);
    expect(center.filter((star) => star.visual_component === 'bulge').length / center.length).toBeGreaterThan(0.45);
    expect(Math.max(...center.map((star) => Math.abs(star.z_ly))) / radiusLy).toBeGreaterThan(0.04);
  });

  it('has logarithmic arm concentrations with narrower outer tips and a scattered inter-arm disk', () => {
    const scatter = (min, max) => stars.filter((star) => star.visual_component === 'arm' && radius(star) > min && radius(star) < max)
      .map((star) => {
        const r = radius(star);
        const phase = Math.atan2(star.y_ly, star.x_ly) - Math.log(Math.max(r, 0.078) / 0.078) / Math.tan(pitchAngleRad);
        const nearest = Math.atan2(Math.sin(phase * armCount), Math.cos(phase * armCount)) / armCount;
        return Math.abs(nearest * r);
      });
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const inner = scatter(0.25, 0.4);
    const outer = scatter(0.75, 0.95);
    expect(median(outer)).toBeLessThan(median(inner) * 0.65);
    expect(outer.filter((offset) => offset < 0.025).length / outer.length).toBeGreaterThan(0.65);
    expect(new Set(stars.filter((star) => star.arm_index !== null).map((star) => star.arm_index)).size).toBe(armCount);
    const armStars = stars.filter((star) => star.visual_component === 'arm');
    expect(armStars.reduce((sum, star) => sum + star.display_opacity, 0) / armStars.length).toBeLessThan(0.2);
    const innerArmSizes = armStars.filter((star) => radius(star) > 0.1 && radius(star) < 0.25).map((star) => star.display_size);
    const outerArmSizes = armStars.filter((star) => radius(star) > 0.75 && radius(star) < 0.95).map((star) => star.display_size);
    const medianSize = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    expect(medianSize(innerArmSizes)).toBeGreaterThan(medianSize(outerArmSizes) * 1.3);
    expect(stars.filter((star) => star.visual_component === 'interarm' && radius(star) > 0.25 && radius(star) < 0.4).length).toBeGreaterThan(20);
    const occupiedSpurs = new Set(stars.map((star) => star.spur_index).filter((index) => index !== null));
    expect(occupiedSpurs.size).toBeGreaterThan(32);
    expect(stars.filter((star) => star.visual_component === 'halo' && radius(star) > 1).length).toBeGreaterThan(10);
  });
});
