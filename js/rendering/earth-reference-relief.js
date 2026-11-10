import { EARTH_REFERENCE, geographicVector } from './earth-reference-geography.js';
import { Ray, Vector3 } from 'three';

export const RELIEF_GRID = Object.freeze({
  width: 721, height: 361, step: 0.5, latitude: -90, longitude: -180,
  sha256: '2c5613d1f94b89ce28bf98d8aa749604dd0091c70bcaf5f42c37ea65d734001d',
});

export function createEarthRelief(buffer) {
  const { width, height, step } = RELIEF_GRID;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== width * height * 2) {
    throw new TypeError('ETOPO reference requires a complete 721 x 361 Int16 grid');
  }
  const view = new DataView(buffer);
  const values = new Int16Array(width * height);
  for (let i = 0; i < values.length; i++) {
    values[i] = view.getInt16(i * 2, true);
    if (values[i] < -12000 || values[i] > 9000) throw new RangeError(`Invalid ETOPO height at ${i}`);
  }
  for (let y = 0; y < height; y++) {
    if (Math.abs(values[y * width] - values[y * width + width - 1]) > 1) {
      throw new RangeError('ETOPO dateline endpoints disagree by more than one metre');
    }
  }
  // All longitudes converge at each pole. Average the source row to avoid
  // competing radii at the identical geometric vertex.
  const polar = [0, height - 1].map(y =>
    values.slice(y * width, y * width + width - 1).reduce((sum, n) => sum + n, 0) / (width - 1));
  const at = (x, y) => y === 0 ? polar[0] : y === height - 1 ? polar[1]
    : x === 0 || x === width - 1 ? (values[y * width] + values[y * width + width - 1]) / 2
      : values[y * width + x];
  return {
    sample(longitude, latitude) {
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
        throw new RangeError('Invalid ETOPO longitude/latitude');
      }
      const x = (((longitude + 180) % 360 + 360) % 360) / step;
      const y = (latitude + 90) / step;
      const ix = Math.floor(x), iy = Math.min(height - 2, Math.floor(y));
      const fx = x - ix, fy = y - iy;
      const bottom = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
      const top = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
      return bottom * (1 - fy) + top * fy;
    },
  };
}

export function reliefSettings(settings) {
  const number = value => typeof value === 'string' && value.trim() ? Number(value) : value;
  const exaggeration = number(settings.exaggeration), seaLevel = number(settings.seaLevel);
  if (!Number.isFinite(exaggeration) || exaggeration < 1 || exaggeration > 40
    || !Number.isFinite(seaLevel) || seaLevel < -500 || seaLevel > 500
    || typeof settings.ocean !== 'boolean') throw new RangeError('Invalid Earth relief inspection settings');
  return { exaggeration, seaLevel, ocean: settings.ocean };
}

export function reliefPoint(relief, longitude, latitude, settings) {
  const elevation = relief.sample(longitude, latitude);
  const displayedElevation = settings.ocean ? Math.max(elevation, settings.seaLevel) : elevation;
  return { elevation, displayedElevation,
    radius: 1 + displayedElevation * settings.exaggeration / (EARTH_REFERENCE.radiusKm * 1000),
    water: settings.ocean && elevation < settings.seaLevel };
}

const stops = [
  [-11000, [8, 24, 55]], [-5000, [18, 54, 91]], [-100, [43, 107, 145]],
  [0, [91, 137, 79]], [1000, [137, 151, 92]], [2500, [168, 139, 103]],
  [4500, [183, 166, 147]], [6500, [230, 232, 230]], [9000, [250, 250, 250]],
];
export function elevationColor(elevation) {
  for (let i = 1; i < stops.length; i++) if (elevation <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i];
    const t = Math.max(0, Math.min(1, (elevation - a) / (b - a)));
    return ca.map((value, channel) => Math.round(value + (cb[channel] - value) * t));
  }
  return stops.at(-1)[1];
}

export function paintReliefTexture(context, relief, width, height, settings, surfaceColor = null) {
  settings = reliefSettings(settings);
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const lon = (x + 0.5) / width * 360 - 180, lat = 90 - (y + 0.5) / height * 180;
    const point = reliefPoint(relief, lon, lat, settings);
    const color = surfaceColor ? surfaceColor(lon, lat, point.elevation, point.water)
      : point.water ? [22, 63, 104] : elevationColor(point.elevation);
    const i = (y * width + x) * 4;
    image.data.set(color, i);
    image.data[i + 3] = point.water ? 0 : 128;
  }
  context.putImageData(image, 0, 0);
  return image.data;
}

export function buildReliefMesh(relief, rows, settings, textureOnly = false) {
  if (![32, 64, 128, 180].includes(rows)) throw new RangeError('Invalid Earth relief mesh LOD');
  settings = reliefSettings(settings);
  const columns = rows * 2, stride = 12;
  const vertices = new Float32Array(rows * columns * 6 * stride);
  let offset = 0;
  const vertex = (x, y) => {
    const lon = x / columns * 360 - 180, lat = y / rows * 180 - 90;
    const point = reliefPoint(relief, lon, lat, settings);
    const radius = textureOnly ? 1 : point.radius;
    return [...geographicVector(lon, lat, radius), 0, 0, 0, 0, point.water ? 1 : 0,
      settings.ocean ? point.elevation - settings.seaLevel : 1, -1, settings.ocean ? 1 : 0, 0];
  };
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const a = vertex(x, y), b = vertex(x + 1, y), c = vertex(x, y + 1), d = vertex(x + 1, y + 1);
    for (const point of [a, b, c, b, d, c]) {
      vertices.set(point, offset);
      offset += stride;
    }
  }
  return vertices;
}

export function reliefMeshRows(detail) {
  if (detail === 'auto') return null;
  const rows = typeof detail === 'string' && detail.trim() ? Number(detail) : detail;
  if (![32, 64, 128, 180].includes(rows)) throw new RangeError('Invalid Earth relief detail selection');
  return rows;
}

export function inspectReliefMesh(vertices, origin, direction, relief, settings, textureOnly = false) {
  settings = reliefSettings(settings);
  if (!(vertices instanceof Float32Array) || vertices.length % 36 !== 0
    || !Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite)
    || !Array.isArray(direction) || direction.length !== 3 || !direction.every(Number.isFinite)
    || Math.hypot(...direction) < 1e-12) throw new TypeError('Invalid Earth inspection ray or mesh');
  const ray = new Ray(new Vector3(...origin), new Vector3(...direction).normalize());
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3();
  let distance = Infinity, nearest = null, triangle = -1;
  for (let i = 0; i < vertices.length; i += 36) {
    a.fromArray(vertices, i);
    b.fromArray(vertices, i + 12);
    c.fromArray(vertices, i + 24);
    if (!ray.intersectTriangle(a, b, c, false, hit)) continue;
    const squared = hit.distanceToSquared(ray.origin);
    if (squared < distance) {
      distance = squared;
      nearest = hit.clone();
      triangle = i / 36;
    }
  }
  if (!nearest) return null;
  const radius = nearest.length();
  const latitude = Math.asin(Math.max(-1, Math.min(1, nearest.y / radius))) * 180 / Math.PI;
  const longitude = Math.atan2(-nearest.z, nearest.x) * 180 / Math.PI;
  const source = reliefPoint(relief, longitude, latitude, settings);
  const meshElevation = (radius - 1) * EARTH_REFERENCE.radiusKm * 1000 / settings.exaggeration;
  return {
    longitude, latitude, elevation: source.elevation, expectedElevation: source.displayedElevation,
    meshElevation, meshError: textureOnly ? null : meshElevation - source.displayedElevation,
    water: source.water, textureOnly, triangle,
  };
}
