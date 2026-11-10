import { EARTH_REFERENCE, geographicVector } from './earth-reference-geography.js';

// Named inspection anchors only: no measured population, urban extent or night imagery.
export const EARTH_CITY_ANCHORS = Object.freeze([
  ['Berlin', 13.405, 52.52], ['Paris', 2.352, 48.857], ['Madrid', -3.704, 40.417],
  ['Rome', 12.496, 41.903], ['Cairo', 31.236, 30.044], ['Delhi', 77.209, 28.614],
  ['Beijing', 116.407, 39.904], ['Mexico City', -99.133, 19.433],
  ['Brasilia', -47.882, -15.794], ['Canberra', 149.13, -35.281],
  ['Pretoria', 28.229, -25.747], ['Denver', -104.99, 39.739],
].map(Object.freeze));

export function earthDevelopment(year) {
  year = typeof year === 'string' && year.trim() ? Number(year) : year;
  if (!Number.isFinite(year) || year < 0 || year > 200) {
    throw new RangeError('Invalid Earth development year');
  }
  // Two population decades in a synthetic century; year 50 preserves the reference fixture.
  return { year, population: 12000000 * 100 ** (year / 100) };
}

export const EARTH_ECONOMY_PROFILES = Object.freeze({
  residential: [],
  mixed: ['farm', 'factory', 'trade_center', 'research_lab'],
  agriculture: ['farm'],
  industry: ['factory'],
  trade: ['trade_center'],
  science: ['research_lab'],
});

export function earthSettlementSites(model, relief, seaLevel) {
  const manifest = { seed: 2026, radius_km: EARTH_REFERENCE.radiusKm, biome: 'terran', sea_level_km: seaLevel / 1000 };
  const sample = direction => {
    const lon = Math.atan2(-direction[2], direction[0]) * 180 / Math.PI;
    const lat = Math.asin(Math.max(-1, Math.min(1, direction[1]))) * 180 / Math.PI;
    const height = relief.sample(lon, lat) / 1000;
    const east = (relief.sample(lon + 0.25, lat) - relief.sample(lon - 0.25, lat))
      / (EARTH_REFERENCE.radiusKm * 1000 * Math.PI / 360 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
    const north = (relief.sample(lon, Math.min(90, lat + 0.25)) - relief.sample(lon, Math.max(-90, lat - 0.25)))
      / (EARTH_REFERENCE.radiusKm * 1000 * Math.PI / 360);
    return { height, slope: Math.hypot(east, north) };
  };
  return EARTH_CITY_ANCHORS.filter(([, lon, lat]) => relief.sample(lon, lat) > seaLevel)
    .map(([name, lon, lat]) => ({
      id: `earth-inspection:${name}`, direction: geographicVector(lon, lat),
      height: relief.sample(lon, lat) / 1000, score: 0,
    })).map(site => ({ ...site, urbanCandidates: model.urbanCandidates(manifest, site, sample) }));
}

export function earthSettlementPlan(model, relief, seaLevel, lights, year = 50, economy = 'residential', sites = null) {
  const development = earthDevelopment(year);
  if (!Object.hasOwn(EARTH_ECONOMY_PROFILES, economy)) throw new RangeError('Invalid Earth economy profile');
  const buildings = EARTH_ECONOMY_PROFILES[economy].map(type => ({ type, level: 8 }));
  const plan = model.plan({ colony: { population: development.population, powered: lights }, buildings },
    { seed: 2026, radius_km: EARTH_REFERENCE.radiusKm, biome: 'terran' },
    sites || earthSettlementSites(model, relief, seaLevel));
  return { ...plan, development: { ...development, economy } };
}
