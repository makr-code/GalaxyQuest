import { describe, expect, it } from 'vitest';
import {
  AU_LY,
  createPlanetOrbit,
  planetOrbitPoint,
  resolvePlanetOrbit,
  SystemVisualizationLayer,
} from '../../js/rendering/system-visualization-layer.js';

const star = { galaxy_index: 2, system_index: 81 };

describe('System visualization layer', () => {
  it('creates stable, non-coplanar schematic orientations when catalog inclinations are absent', () => {
    const first = resolvePlanetOrbit(star, { position: 1, semi_major_axis_au: 1 });
    const again = resolvePlanetOrbit(star, { position: 1, semi_major_axis_au: 1 });
    const outer = resolvePlanetOrbit(star, { position: 2, semi_major_axis_au: 2 });

    expect(first).toEqual(again);
    expect(first.usesEstimatedOrientation).toBe(true);
    expect(first.inclinationRad).toBeGreaterThan(0);
    expect(first.inclinationRad).not.toBe(outer.inclinationRad);
  });

  it('uses supplied orbital elements and converts the inclined ellipse to light-years', () => {
    const elements = resolvePlanetOrbit(star, {
      position: 3,
      semi_major_axis_au: 2,
      orbital_eccentricity: 0.25,
      orbital_inclination_deg: 30,
      longitude_ascending_node_deg: 0,
      argument_of_periapsis_deg: 0,
    });

    expect(elements.usesEstimatedOrientation).toBe(false);
    expect(elements.distanceAU).toBeCloseTo(2 * (1 - 0.25 ** 2)
      / (1 + 0.25 * Math.cos(elements.trueAnomalyRad)));
    expect(elements.distanceEstimated).toBe(true);
    expect(planetOrbitPoint(elements, 0)).toEqual([
      2 * (1 - 0.25) * AU_LY, 0, 0,
    ]);
    const quarterOrbit = planetOrbitPoint(elements, Math.PI / 2);
    expect(quarterOrbit[1]).toBeCloseTo(2 * (1 - 0.25 ** 2) * Math.cos(Math.PI / 6) * AU_LY);
    expect(quarterOrbit[2]).toBeCloseTo(2 * (1 - 0.25 ** 2) * Math.sin(Math.PI / 6) * AU_LY);
  });

  it('treats null and empty orbital fields as missing', () => {
    const elements = resolvePlanetOrbit(star, {
      position: 2,
      semi_major_axis_au: null,
      orbital_eccentricity: '',
      orbital_inclination_deg: null,
      longitude_ascending_node_deg: null,
    });

    expect(elements.semiMajorAxisAU).toBe(2);
    expect(elements.eccentricity).toBe(0);
    expect(elements.usesEstimatedOrientation).toBe(true);
    expect(elements.distanceEstimated).toBe(true);
    expect(elements.inclinationRad).toBeGreaterThan(0);
  });

  it('reports the current stellar distance from cataloged orbital values without estimating', () => {
    const elements = resolvePlanetOrbit(star, {
      position: 2,
      semi_major_axis_au: 2,
      orbital_eccentricity: 0.5,
      orbital_inclination_deg: 15,
      true_anomaly_rad: 0,
    });

    expect(elements.distanceAU).toBeCloseTo(1);
    expect(elements.distanceEstimated).toBe(false);
    expect(elements.semiMajorAxisEstimated).toBe(false);
  });

  it('calculates the periapsis and apoapsis of an elliptical orbit', () => {
    const orbit = createPlanetOrbit(star, {
      position: 2,
      semi_major_axis_au: 3,
      orbital_eccentricity: 0.4,
    });

    expect(orbit.elements.periapsisAU).toBeCloseTo(1.8);
    expect(orbit.elements.apoapsisAU).toBeCloseTo(4.2);
    expect(orbit.periapsisPoint).toEqual(planetOrbitPoint(orbit.elements, 0));
    expect(orbit.apoapsisPoint).toEqual(planetOrbitPoint(orbit.elements, Math.PI));
    expect(orbit.elements.apsidesEstimated).toBe(false);
  });

  it('builds a phase arc from periapsis to the planet and flags estimated phase data', () => {
    const orbit = createPlanetOrbit(star, {
      position: 2,
      semi_major_axis_au: 3,
      orbital_eccentricity: 0.4,
      true_anomaly_rad: Math.PI / 2,
    });

    expect(orbit.phaseArcPoints.length).toBeGreaterThan(2);
    expect(orbit.phaseArcPoints[0]).toEqual(orbit.periapsisPoint);
    expect(orbit.phaseArcPoints.at(-1)).toEqual(orbit.bodyPosition);
    expect(orbit.elements.phaseEstimated).toBe(false);

    const estimated = createPlanetOrbit(star, { position: 3, semi_major_axis_au: 4 });
    expect(estimated.elements.phaseEstimated).toBe(true);
  });

  it('builds an elliptical orbit and keeps its focus at the star', () => {
    const orbit = createPlanetOrbit(star, {
      position: 1, semi_major_axis_au: 3, orbital_eccentricity: 0.4,
      orbital_inclination_deg: 0, longitude_ascending_node_deg: 0,
      argument_of_periapsis_deg: 0,
    });

    expect(orbit.points).toHaveLength(512);
    expect(orbit.planeGuides).toHaveLength(8 * 64);
    expect(orbit.planeGuides[0]).toEqual([0, 0, 0]);
    expect(orbit.bodyPosition).toHaveLength(3);
    expect(planetOrbitPoint(orbit.elements, 0)[0]).toBeCloseTo(3 * (1 - 0.4) * AU_LY);
    expect(planetOrbitPoint(orbit.elements, Math.PI)[0]).toBeCloseTo(3 * (1 + 0.4) * -AU_LY);
  });

  it('manages orbit and selection visibility independently', () => {
    const layer = new SystemVisualizationLayer();
    layer.setSystem(star, [
      { position: 1, semi_major_axis_au: 1 },
      { position: 2, semi_major_axis_au: 2 },
    ]);
    layer.selectPlanet(2);

    expect(layer.orbits).toHaveLength(2);
    expect(layer.planesVisible).toBe(false);
    expect(layer.getSelectedPlanet()).toEqual({ kind: 'planet', position: 2 });
    expect(layer.getSelectedOrbit()).toMatchObject({ position: 2 });
    layer.hoverPlanet(2);
    expect(layer.getHoveredPlanet()).toEqual({ kind: 'planet', position: 2 });
    layer.configure({
      orbits: false, planes: true, distanceLine: true, apsides: true, phaseArc: true, selection: false,
    });
    expect(layer.orbitsVisible).toBe(false);
    expect(layer.planesVisible).toBe(true);
    expect(layer.distanceLineVisible).toBe(true);
    expect(layer.apsidesVisible).toBe(true);
    expect(layer.phaseArcVisible).toBe(true);
    expect(layer.getSelectedPlanet()).toBeNull();
    expect(layer.getSelectedOrbit()).toBeNull();
    expect(layer.getHoveredPlanet()).toBeNull();
    layer.clear();
    expect(layer.orbits).toEqual([]);
    expect(layer.selection).toBeNull();
    expect(layer.hover).toBeNull();
  });
});
