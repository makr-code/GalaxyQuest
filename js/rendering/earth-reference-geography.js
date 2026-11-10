import { ShapeUtils, Vector2 } from 'three';

export const EARTH_REFERENCE = Object.freeze({
  radiusKm: 6371.0088,
  rotation_period_hours: 23.9344696,
  axial_tilt_deg: 23.43928,
  rotation_axis_node_deg: 0,
  rotation_phase_deg: 0,
  rotation_epoch_unix_seconds: 946728000,
});
export const ZONE_COLORS = Object.freeze({
  water: '#163f68', temperate: '#668854', tropical: '#317343',
  desert: '#c9ac71', ice: '#e5eef2',
});

// Deliberately schematic inspection masks, not measured biome boundaries.
const DESERTS = [
  [[-17, 18], [-12, 31], [10, 34], [34, 30], [40, 16], [15, 14], [-17, 18]],
  [[35, 15], [37, 30], [48, 32], [59, 24], [52, 13], [35, 15]],
  [[112, -21], [122, -18], [139, -23], [142, -31], [119, -33], [112, -21]],
  [[12, -16], [22, -18], [28, -27], [17, -30], [12, -16]],
  [[-116, 28], [-114, 38], [-107, 38], [-103, 28], [-116, 28]],
  [[-73, -17], [-68, -18], [-68, -30], [-72, -28], [-73, -17]],
  [[78, 35], [91, 45], [110, 46], [110, 39], [90, 34], [78, 35]],
];

export function referencePolygons(collection) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new TypeError('Earth reference requires a GeoJSON FeatureCollection');
  }
  return collection.features.flatMap(feature => {
    const { type, coordinates } = feature.geometry || {};
    const polygons = type === 'Polygon' ? [coordinates] : type === 'MultiPolygon' ? coordinates : null;
    if (!polygons || !polygons.every(polygon => Array.isArray(polygon) && polygon.length
      && polygon.every(ring => ring.length >= 4 && ring.every(point => point.length >= 2
        && Number.isFinite(point[0]) && Number.isFinite(point[1])
        && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)
        && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]))) {
      throw new TypeError('Invalid Earth reference polygon');
    }
    return polygons;
  });
}

export function ringContains(ring, longitude, latitude) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > latitude) !== (b[1] > latitude)
      && longitude < (b[0] - a[0]) * (latitude - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function polygonsContain(polygons, longitude, latitude) {
  return polygons.some(rings => ringContains(rings[0], longitude, latitude)
    && !rings.slice(1).some(ring => ringContains(ring, longitude, latitude)));
}

export function climateZone(longitude, latitude) {
  if (Math.abs(latitude) >= 66.56072
    || (longitude >= -74 && longitude <= -12 && latitude > 60)) return 'ice';
  if (DESERTS.some(ring => ringContains(ring, longitude, latitude))) return 'desert';
  return Math.abs(latitude) <= EARTH_REFERENCE.axial_tilt_deg ? 'tropical' : 'temperate';
}

export function createEarthGeography(landCollection, lakeCollection) {
  const land = referencePolygons(landCollection), lakes = referencePolygons(lakeCollection);
  return {
    land, lakes,
    sample(longitude, latitude) {
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
        throw new RangeError('Invalid Earth reference coordinate');
      }
      const lon = ((longitude + 180) % 360 + 360) % 360 - 180;
      const water = !polygonsContain(land, lon, latitude) || polygonsContain(lakes, lon, latitude);
      return { water, zone: water ? 'water' : climateZone(lon, latitude) };
    },
  };
}

export function geographicVector(longitude, latitude, radius = 1) {
  const lon = longitude * Math.PI / 180, lat = latitude * Math.PI / 180;
  return [radius * Math.cos(lat) * Math.cos(lon), radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon)];
}

export function earthReferenceBasis(basis) {
  // Conjugate the production +Z-east basis into the globe's right-handed
  // -Z-east frame. Reflecting only the geography would reverse prograde spin.
  const signs = [1, 1, -1];
  return basis.map((column, i) => column.map((value, j) => value * signs[i] * signs[j]));
}

// Subdivide in geographic coordinates so mesh edges follow the raster's straight
// GeoJSON segments, including the authored +/-180 seams and Antarctic closure.
export function triangulateGeography(polygons, maxDegrees = 3) {
  if (!Number.isFinite(maxDegrees) || maxDegrees < 1 || maxDegrees > 10) {
    throw new RangeError('Earth reference tessellation must be between 1 and 10 degrees');
  }
  const triangles = [];
  for (const rings of polygons) {
    const vectors = rings.map(ring => ring.slice(0, -1).map(point => new Vector2(...point)));
    const points = vectors.flat();
    const pending = ShapeUtils.triangulateShape(vectors[0], vectors.slice(1))
      .map(indices => indices.map(index => [points[index].x, points[index].y]));
    while (pending.length) {
      const triangle = pending.pop();
      const lengths = triangle.map((a, i) => {
        const b = triangle[(i + 1) % 3];
        return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
      });
      const edge = lengths.indexOf(Math.max(...lengths));
      if (lengths[edge] <= maxDegrees ** 2) {
        triangles.push(triangle);
        continue;
      }
      const a = triangle[edge], b = triangle[(edge + 1) % 3], c = triangle[(edge + 2) % 3];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      pending.push([a, mid, c], [mid, b, c]);
    }
  }
  return triangles;
}

export function paintEarthTexture(context, geography, width, height, mask = false) {
  const colors = mask ? { water: '#000000', temperate: '#808080', tropical: '#808080',
    desert: '#808080', ice: '#ffffff' } : ZONE_COLORS;
  const path = polygons => {
    context.beginPath();
    for (const rings of polygons) for (const ring of rings) {
      ring.forEach(([lon, lat], index) => {
        const x = (lon + 180) / 360 * width, y = (90 - lat) / 180 * height;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.closePath();
    }
  };
  context.fillStyle = colors.water;
  context.fillRect(0, 0, width, height);
  context.save();
  path(geography.land);
  context.clip('evenodd');
  context.fillStyle = colors.temperate;
  context.fillRect(0, 0, width, height);
  const band = (south, north, color) => {
    context.fillStyle = color;
    context.fillRect(0, (90 - north) / 180 * height, width, (north - south) / 180 * height);
  };
  band(-EARTH_REFERENCE.axial_tilt_deg, EARTH_REFERENCE.axial_tilt_deg, colors.tropical);
  context.fillStyle = colors.desert;
  for (const ring of DESERTS) {
    path([[ring]]);
    context.fill('evenodd');
  }
  band(66.56072, 90, colors.ice);
  band(-90, -66.56072, colors.ice);
  context.fillRect(106 / 360 * width, 0, 62 / 360 * width, 30 / 180 * height);
  context.restore();
  context.fillStyle = colors.water;
  path(geography.lakes);
  context.fill('evenodd');
}
