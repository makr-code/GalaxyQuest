export const AU_LY = 1 / 63241.077084266;

const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_ORBIT_SAMPLES = 512;
const PLANE_GUIDE_SPOKES = 8;
const PLANE_GUIDE_SAMPLES = 64;

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function finiteField(body, names) {
  for (const name of names) {
    const rawValue = body?.[name];
    if (rawValue === null || rawValue === undefined || rawValue === '') continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function resolvePlanetOrbit(star, body) {
  const galaxy = Number(star?.galaxy_index) || 0;
  const system = Number(star?.system_index) || 0;
  const position = Number(body?.position) || 0;
  const seed = hashString(`${galaxy}:${system}:${position}`);
  const semiMajorAxisAU = Math.max(0.01,
    finiteField(body, ['semi_major_axis_au']) ?? (position || 1));
  const suppliedSemiMajorAxis = finiteField(body, ['semi_major_axis_au']);
  const suppliedEccentricity = finiteField(body, ['orbital_eccentricity', 'eccentricity']);
  const eccentricity = Math.max(0, Math.min(0.92,
    suppliedEccentricity ?? 0));
  const inclinationDegrees = finiteField(body, ['orbital_inclination_deg', 'inclination_deg'])
    ?? 2 + ((seed >>> 8) % 1600) / 100;
  const ascendingNodeDegrees = finiteField(body, [
    'longitude_ascending_node_deg', 'longitude_of_ascending_node_deg', 'ascending_node_deg',
  ]) ?? ((seed >>> 16) % 36000) / 100;
  const periapsisDegrees = finiteField(body, [
    'argument_of_periapsis_deg', 'argument_periapsis_deg',
  ]) ?? ((seed >>> 3) % 36000) / 100;
  const suppliedInclinationRadians = finiteField(body, ['orbital_inclination_rad', 'inclination_rad']);
  const suppliedNodeRadians = finiteField(body, [
    'longitude_ascending_node_rad', 'longitude_of_ascending_node_rad',
  ]);
  const suppliedPeriapsisRadians = finiteField(body, [
    'argument_of_periapsis_rad', 'argument_periapsis_rad',
  ]);
  const trueAnomaly = finiteField(body, ['true_anomaly_rad', 'polar_theta_rad'])
    ?? ((seed >>> 20) / 0x100000000) * Math.PI * 2;
  const suppliedTrueAnomaly = finiteField(body, ['true_anomaly_rad', 'polar_theta_rad']);

  return {
    semiMajorAxisAU,
    eccentricity,
    inclinationRad: suppliedInclinationRadians ?? inclinationDegrees * DEG_TO_RAD,
    ascendingNodeRad: suppliedNodeRadians ?? ascendingNodeDegrees * DEG_TO_RAD,
    periapsisRad: suppliedPeriapsisRadians ?? periapsisDegrees * DEG_TO_RAD,
    trueAnomalyRad: trueAnomaly,
    distanceAU: semiMajorAxisAU * (1 - eccentricity * eccentricity)
      / (1 + eccentricity * Math.cos(trueAnomaly)),
    periapsisAU: semiMajorAxisAU * (1 - eccentricity),
    apoapsisAU: semiMajorAxisAU * (1 + eccentricity),
    distanceEstimated: suppliedSemiMajorAxis === null || suppliedTrueAnomaly === null,
    phaseEstimated: suppliedTrueAnomaly === null,
    apsidesEstimated: suppliedSemiMajorAxis === null || suppliedEccentricity === null,
    semiMajorAxisEstimated: suppliedSemiMajorAxis === null,
    usesEstimatedOrientation: finiteField(body, [
      'orbital_inclination_deg', 'inclination_deg', 'orbital_inclination_rad', 'inclination_rad',
    ]) === null,
  };
}

export function planetOrbitPoint(elements, trueAnomalyRad) {
  const { semiMajorAxisAU: a, eccentricity: e, inclinationRad: inclination,
    ascendingNodeRad: node, periapsisRad: periapsis } = elements;
  const radius = a * (1 - e * e) / (1 + e * Math.cos(trueAnomalyRad));
  const angle = periapsis + trueAnomalyRad;
  const planeX = radius * Math.cos(angle);
  const planeY = radius * Math.sin(angle);
  const tiltedY = planeY * Math.cos(inclination);
  const tiltedZ = planeY * Math.sin(inclination);
  return [
    (planeX * Math.cos(node) - tiltedY * Math.sin(node)) * AU_LY,
    (planeX * Math.sin(node) + tiltedY * Math.cos(node)) * AU_LY,
    tiltedZ * AU_LY,
  ];
}

export function createPlanetOrbit(star, body, samples = DEFAULT_ORBIT_SAMPLES) {
  const elements = resolvePlanetOrbit(star, body);
  const pointCount = Math.max(16, Math.floor(Number(samples) || DEFAULT_ORBIT_SAMPLES));
  const points = Array.from({ length: pointCount }, (_, index) =>
    planetOrbitPoint(elements, (index / pointCount) * Math.PI * 2));
  const planeGuides = Array.from({ length: PLANE_GUIDE_SPOKES }, (_, spoke) => {
    const edge = planetOrbitPoint(elements, (spoke / PLANE_GUIDE_SPOKES) * Math.PI * 2);
    return Array.from({ length: PLANE_GUIDE_SAMPLES }, (_, sample) =>
      edge.map((coordinate) => coordinate * (sample / (PLANE_GUIDE_SAMPLES - 1))));
  }).flat();
  const periapsisPoint = planetOrbitPoint(elements, 0);
  const apoapsisPoint = planetOrbitPoint(elements, Math.PI);
  const phaseSweep = ((elements.trueAnomalyRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const phaseSegments = Math.ceil(pointCount * phaseSweep / (Math.PI * 2));
  const phaseArcPoints = phaseSegments > 0
    ? Array.from({ length: phaseSegments + 1 }, (_, index) =>
      planetOrbitPoint(elements, phaseSweep * index / phaseSegments))
    : [];
  return {
    position: Number(body?.position) || 0,
    elements,
    points,
    planeGuides,
    periapsisPoint,
    apoapsisPoint,
    phaseArcPoints,
    bodyPosition: planetOrbitPoint(elements, elements.trueAnomalyRad),
  };
}

export class SystemVisualizationLayer {
  constructor() {
    this.orbitsVisible = true;
    this.planesVisible = false;
    this.distanceLineVisible = false;
    this.apsidesVisible = false;
    this.phaseArcVisible = false;
    this.selectionVisible = true;
    this.orbits = [];
    this.selection = null;
    this.hover = null;
  }

  setSystem(star, planets) {
    this.orbits = (Array.isArray(planets) ? planets : [])
      .filter((planet) => planet && Number(planet.position) > 0)
      .map((planet) => createPlanetOrbit(star, planet));
    this.selection = null;
    this.hover = null;
  }

  clear() {
    this.orbits = [];
    this.selection = null;
    this.hover = null;
  }

  configure({ orbits, planes, distanceLine, apsides, phaseArc, selection } = {}) {
    if (typeof orbits === 'boolean') this.orbitsVisible = orbits;
    if (typeof planes === 'boolean') this.planesVisible = planes;
    if (typeof distanceLine === 'boolean') this.distanceLineVisible = distanceLine;
    if (typeof apsides === 'boolean') this.apsidesVisible = apsides;
    if (typeof phaseArc === 'boolean') this.phaseArcVisible = phaseArc;
    if (typeof selection === 'boolean') this.selectionVisible = selection;
  }

  selectPlanet(position) {
    this.selection = this.planetMarker(position);
  }

  hoverPlanet(position) {
    this.hover = this.planetMarker(position);
  }

  getHoveredPlanet() {
    return this.selectionVisible ? this.hover : null;
  }

  getSelectedPlanet() {
    return this.selectionVisible ? this.selection : null;
  }

  getSelectedOrbit() {
    const selection = this.getSelectedPlanet();
    return selection
      ? this.orbits.find((orbit) => orbit.position === selection.position) ?? null
      : null;
  }

  planetMarker(position) {
    const value = Number(position);
    return Number.isInteger(value) && value > 0 ? { kind: 'planet', position: value } : null;
  }
}
