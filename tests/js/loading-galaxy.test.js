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
  const stars = generateLoadingGalaxy(9000, radiusLy, seededRandom());
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
    expect(Math.max(...stars.map((star) => star.display_size))).toBeGreaterThan(6);
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
  });

  it('has logarithmic arm concentrations with narrower outer tips and a scattered inter-arm disk', () => {
    const scatter = (min, max) => stars.filter((star) => radius(star) > min && radius(star) < max)
      .map((star) => {
        const r = radius(star);
        const phase = Math.atan2(star.y_ly, star.x_ly) - Math.log((r + 0.06) / 0.14) / Math.tan(Math.PI / 10);
        const nearest = Math.atan2(Math.sin(phase * 4), Math.cos(phase * 4)) / 4;
        return Math.abs(nearest * r);
      });
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const inner = scatter(0.25, 0.4);
    const outer = scatter(0.75, 0.95);
    expect(median(outer)).toBeLessThan(median(inner) * 0.65);
    expect(outer.filter((offset) => offset < 0.025).length / outer.length).toBeGreaterThan(0.65);
    expect(inner.filter((offset) => offset > 0.07).length).toBeGreaterThan(20);
  });
});
