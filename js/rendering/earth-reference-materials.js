import { DataUtils } from 'three';
import { EARTH_REFERENCE, climateZone, ZONE_COLORS } from './earth-reference-geography.js';
import { RELIEF_GRID, reliefSettings } from './earth-reference-relief.js';

const zoneColors = Object.fromEntries(Object.entries(ZONE_COLORS).map(([zone, hex]) =>
  [zone, [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))]));

export function earthSurfaceColor(longitude, latitude, elevation, water) {
  if (water) return [22, 63, 104];
  const zone = climateZone(longitude, latitude);
  const color = zoneColors[zone];
  // Schematic exposed rock, not a measured snow line or vegetation dataset.
  const rock = zone === 'ice' ? 0 : Math.max(0, Math.min(0.8, (elevation - 1800) / 4500));
  return color.map((n, i) => Math.round(n * (1 - rock) + [147, 139, 125][i] * rock));
}

export function earthMaterialPoint(relief, longitude, latitude, settings) {
  const elevation = relief.sample(longitude, latitude);
  const water = settings.ocean && elevation < settings.seaLevel;
  const step = RELIEF_GRID.step, radians = Math.PI / 180;
  const height = (lon, lat) => {
    const value = relief.sample(lon, lat);
    return settings.ocean ? Math.max(value, settings.seaLevel) : value;
  };
  const south = Math.max(-90, latitude - step), north = Math.min(90, latitude + step);
  const meters = EARTH_REFERENCE.radiusKm * 1000 * radians;
  const cosine = Math.cos(latitude * radians);
  // The longitude tangent frame is undefined at the poles. Fade the final source cell.
  const polar = Math.min(1, (90 - Math.abs(latitude)) / step);
  const eastSlope = water || cosine < 1e-8 ? 0 : polar
    * (height(longitude + step, latitude) - height(longitude - step, latitude)) / (2 * step * meters * cosine);
  const northSlope = water ? 0 : polar * (height(longitude, north) - height(longitude, south)) / ((north - south) * meters);
  const ice = !water && climateZone(longitude, latitude) === 'ice';
  return { eastSlope, northSlope, roughness: water ? 0.16 : ice ? 0.38 : 0.88,
    specular: water ? 0.02 : 0.04 };
}

export function buildEarthMaterialMap(relief, width, height, options) {
  const settings = reliefSettings(options);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 2 || height < 2 || width > 2048 || height > 1024) {
    throw new RangeError('Invalid Earth material map dimensions');
  }
  const data = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const point = earthMaterialPoint(relief, (x + 0.5) / width * 360 - 180,
      90 - (y + 0.5) / height * 180, settings);
    data.set([point.eastSlope, point.northSlope, point.roughness, point.specular].map(DataUtils.toHalfFloat),
      (y * width + x) * 4);
  }
  return data;
}

export function earthMaterialMipChain(data, width, height) {
  if (!(data instanceof Uint16Array) || data.length !== width * height * 4
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || (width & (width - 1)) || (height & (height - 1))) {
    throw new RangeError('Earth material mipmaps require power-of-two dimensions');
  }
  const levels = [{ data, width, height }];
  while (width > 1 || height > 1) {
    const nextWidth = Math.max(1, width / 2), nextHeight = Math.max(1, height / 2);
    const next = new Uint16Array(nextWidth * nextHeight * 4);
    for (let y = 0; y < nextHeight; y++) for (let x = 0; x < nextWidth; x++) for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        sum += DataUtils.fromHalfFloat(data[((Math.min(height - 1, y * 2 + dy) * width)
          + Math.min(width - 1, x * 2 + dx)) * 4 + c]);
      }
      next[(y * nextWidth + x) * 4 + c] = DataUtils.toHalfFloat(sum / 4);
    }
    data = next;
    width = nextWidth;
    height = nextHeight;
    levels.push({ data, width, height });
  }
  return levels;
}

export function earthAppearanceSettings(settings) {
  const bump = typeof settings.bump === 'string' && settings.bump.trim() ? Number(settings.bump) : settings.bump;
  const phase = typeof settings.phase === 'string' && settings.phase.trim() ? Number(settings.phase) : settings.phase;
  const altitude = typeof settings.cloudAltitude === 'string' && settings.cloudAltitude.trim()
    ? Number(settings.cloudAltitude) : settings.cloudAltitude;
  const modes = ['shaded', 'albedo', 'normal', 'roughness', 'specular'];
  if (![0, 1, 10, 40].includes(bump) || !modes.includes(settings.materialView)
    || !['height', 'surface'].includes(settings.palette) || typeof settings.gloss !== 'boolean'
    || typeof settings.sky !== 'boolean' || !Number.isFinite(phase) || phase < 0 || phase > 120
    || ![12, 80, 200].includes(altitude) || !['shell', 'surface'].includes(settings.cloudMode)
    || typeof settings.cloudShadows !== 'boolean' || typeof settings.solarAtmosphere !== 'boolean'
    || typeof settings.cityLights !== 'boolean'
    || (settings.cityMaterials !== undefined && typeof settings.cityMaterials !== 'boolean')) {
    throw new RangeError('Invalid Earth appearance settings');
  }
  return { bump, mode: modes.indexOf(settings.materialView), gloss: settings.gloss,
    palette: settings.palette, sky: settings.sky, phase, cloudAltitude: altitude, cloudMode: settings.cloudMode,
    cloudShadows: settings.cloudShadows,
    solarAtmosphere: settings.solarAtmosphere,
    cityLights: settings.cityLights,
    cityMaterials: settings.cityMaterials ?? false,
    sun: earthSunDirection(settings.sunAzimuth, settings.sunElevation) };
}

export function earthSunDirection(azimuth, elevation) {
  const number = value => typeof value === 'string' && value.trim() ? Number(value) : value;
  azimuth = number(azimuth);
  elevation = number(elevation);
  if (!Number.isFinite(azimuth) || azimuth < -180 || azimuth > 180
    || !Number.isFinite(elevation) || elevation < -90 || elevation > 90) {
    throw new RangeError('Invalid Earth sun angles');
  }
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
}
