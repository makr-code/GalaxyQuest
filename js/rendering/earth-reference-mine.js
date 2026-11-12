import { EARTH_REFERENCE, geographicVector } from './earth-reference-geography.js';
import { inspectReliefMesh, reliefPoint } from './earth-reference-relief.js';

export const MINE_REFERENCE = Object.freeze({
  longitude: 14.3, latitude: 51.8, eastRadiusMeters: 2000, northRadiusMeters: 1500,
  depthMeters: 240, benches: 8, seed: 2026,
});
const RADIUS_METERS = EARTH_REFERENCE.radiusKm * 1000;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function mineProfile(eastMeters, northMeters, seed = MINE_REFERENCE.seed) {
  if (![eastMeters, northMeters].every(Number.isFinite) || !Number.isInteger(seed)) {
    throw new RangeError('Invalid mine parcel coordinate or seed');
  }
  const x = eastMeters / MINE_REFERENCE.eastRadiusMeters;
  const y = northMeters / MINE_REFERENCE.northRadiusMeters;
  const angle = Math.atan2(y, x), phase = (seed % 997) * 0.017;
  const radius = Math.hypot(x, y) / (1 + 0.035 * Math.sin(angle * 3 + phase)
    + 0.02 * Math.sin(angle * 7 - phase));
  const progress = Math.max(0, Math.min(1, (1 - radius) / 0.75)) * MINE_REFERENCE.benches;
  const bench = Math.floor(progress);
  const depthMeters = (bench + smooth(0.65, 1, progress - bench))
    / MINE_REFERENCE.benches * MINE_REFERENCE.depthMeters;
  const exposure = smooth(0, 5, depthMeters);
  const sediment = bench % 2 === 0 ? [0.52, 0.40, 0.27] : [0.65, 0.53, 0.36];
  const floor = smooth(210, 240, depthMeters);
  return { depthMeters, bench, exposure,
    color: sediment.map((n, i) => n * (1 - floor) + [0.16, 0.14, 0.12][i] * floor) };
}

export function buildMineMesh(vertices, relief, settings) {
  if (!(vertices instanceof Float32Array) || vertices.length % 36 !== 0 || !vertices.every(Number.isFinite)) {
    throw new TypeError('Invalid mine source triangles');
  }
  const { longitude, latitude } = MINE_REFERENCE;
  if (reliefPoint(relief, longitude, latitude, settings).water) {
    return { vertices, available: false, trianglesAdded: 0 };
  }
  const up = geographicVector(longitude, latitude);
  const east = geographicVector(longitude + 90, 0);
  const north = [up[1] * east[2], up[2] * east[0] - up[0] * east[2], -up[1] * east[0]];
  const local = p => [east, north].map(axis => p.slice(0, 3)
    .reduce((sum, n, i) => sum + n * axis[i], 0) * RADIUS_METERS);
  const output = [];
  let modified = 0;
  const emit = (a, b, c) => {
    for (const p of [a, b, c]) {
      const profile = mineProfile(...local(p));
      const v = [...p];
      if (profile.depthMeters > 0 && p.slice(0, 3).reduce((sum, n, i) => sum + n * up[i], 0) > 0.9) {
        const radius = Math.hypot(...p.slice(0, 3));
        const factor = 1 - profile.depthMeters / (RADIUS_METERS * radius);
        for (let i = 0; i < 3; i++) v[i] *= factor;
        v.splice(3, 4, ...profile.color, profile.exposure);
        modified++;
      }
      output.push(...v);
    }
  };
  const midpoint = (a, b) => a.map((n, i) => (n + b[i]) / 2);
  const refine = (a, b, c, depth = 0) => {
    const points = [a, b, c], coords = points.map(local);
    const near = a.slice(0, 3).reduce((sum, n, i) => sum + n * up[i], 0) > 0.9
      && [2200, 1650].every((extent, i) => Math.min(...coords.map(p => p[i])) < extent
        && Math.max(...coords.map(p => p[i])) > -extent);
    const edge = Math.max(...[0, 1, 2].map(i => Math.hypot(
      coords[i][0] - coords[(i + 1) % 3][0], coords[i][1] - coords[(i + 1) % 3][1])));
    if (!near || edge <= 50 || depth >= 14) {
      emit(a, b, c);
      return;
    }
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    refine(a, ab, ca, depth + 1); refine(ab, b, bc, depth + 1);
    refine(ca, bc, c, depth + 1); refine(ab, bc, ca, depth + 1);
  };
  for (let i = 0; i < vertices.length; i += 36) {
    refine(...[0, 12, 24].map(offset => Array.from(vertices.subarray(i + offset, i + offset + 12))));
  }
  const result = new Float32Array(output);
  const hit = inspectReliefMesh(result, up.map(n => n * 2), up.map(n => -n), relief, settings);
  if (!hit || !modified) throw new Error('Mine refinement did not produce an excavated surface');
  return { vertices: result, available: true, trianglesAdded: (result.length - vertices.length) / 36,
    centreRadius: 1 + hit.meshElevation * settings.exaggeration / RADIUS_METERS };
}
