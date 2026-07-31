/**
 * API Schema Adapters
 * Handles payload adaptation and normalization for render pipeline.
 */
const APISchemaAdapters = (() => {
  const RENDER_SCHEMA_VERSION = 1;
  const ASSETS_MANIFEST_VERSION = Math.max(1, Number(window.GQ_ASSETS_MANIFEST_VERSION || 1));
  const RENDER_STALE_MAX_AGE_MS = 10 * 60 * 1000;

  function _log(level, message, data = null) {
    const lvl = String(level || 'info').toLowerCase();
    const sink = window.GQLog && typeof window.GQLog[lvl] === 'function'
      ? window.GQLog[lvl].bind(window.GQLog)
      : null;
    if (sink) {
      if (data == null) sink('[api-schema]', message);
      else sink('[api-schema]', message, data);
      return;
    }
    const consoleMethod = (lvl === 'error' || lvl === 'warn' || lvl === 'info') ? lvl : 'log';
    if (data == null) console[consoleMethod]('[GQ][API][schema]', message);
    else console[consoleMethod]('[GQ][API][schema]', message, data);
  }

  function _normalizeRenderSchemaVersion(payload) {
    const n = Number(payload?.render_schema_version);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function _normalizeAssetsManifestVersion(payload, fallback = {}) {
    const n = Number(payload?.assets_manifest_version || fallback?.assetsManifestVersion || 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function _buildSchemaError(kind, issues, payload) {
    return {
      ok: false,
      errorType: 'schema',
      kind,
      issues: Array.isArray(issues) ? issues : [],
      payload,
    };
  }

  function _summarizeSystemPayloadMeta(payload) {
    const input = (payload && typeof payload === 'object') ? payload : {};
    const planets = Array.isArray(input.planets) ? input.planets : [];
    const fleets = Array.isArray(input.fleets_in_system) ? input.fleets_in_system : [];
    const textureManifest = (input.planet_texture_manifest && typeof input.planet_texture_manifest === 'object')
      ? input.planet_texture_manifest
      : null;
    const textureEntries = textureManifest && textureManifest.planets && typeof textureManifest.planets === 'object'
      ? Object.keys(textureManifest.planets).length
      : 0;
    const generatedPlanets = planets.filter((planet) => !!planet?.generated_planet).length;
    const playerPlanets = planets.filter((planet) => !!planet?.player_planet).length;
    const moonCount = planets.reduce((sum, planet) => {
      const generatedMoons = Array.isArray(planet?.generated_planet?.moons) ? planet.generated_planet.moons.length : 0;
      const playerMoons = Array.isArray(planet?.player_planet?.moons) ? planet.player_planet.moons.length : 0;
      return sum + generatedMoons + playerMoons;
    }, 0);
    return {
      galaxy: Number(input.galaxy || input.star_system?.galaxy_index || 0),
      system: Number(input.system || input.star_system?.system_index || 0),
      starName: String(input.star_system?.name || ''),
      planets: planets.length,
      generatedPlanets,
      playerPlanets,
      moons: moonCount,
      fleets: fleets.length,
      textureEntries,
      success: input.success !== false,
    };
  }

  function adaptGalaxyBootstrapPayload(payload, fallback = {}) {
    if (!payload || payload.success !== true) {
      return _buildSchemaError('bootstrap', ['payload.success !== true'], payload);
    }

    const galaxy = Math.max(1, Number(payload.galaxy || fallback.galaxy || 1));
    const systemMax = Math.max(1, Number(payload.system_max || 0));
    const initialRaw = payload.initial_range || {};
    const from = Math.max(1, Number(initialRaw.from || fallback.from || 1));
    const to = Math.max(from, Number(initialRaw.to || fallback.to || from));
    const maxPoints = Math.max(100, Math.min(50000, Number(initialRaw.max_points || fallback.maxPoints || 1500)));
    const schemaVersion = _normalizeRenderSchemaVersion(payload);
    const assetsManifestVersion = _normalizeAssetsManifestVersion(payload, fallback);

    const issues = [];
    if (!systemMax) issues.push('system_max missing');
    if (schemaVersion <= 0) issues.push('render_schema_version missing');
    if (assetsManifestVersion <= 0) issues.push('assets_manifest_version missing');

    if (issues.length > 0) {
      return _buildSchemaError('bootstrap', issues, payload);
    }

    const serverTsMs = Number(payload.server_ts_ms || Date.now());
    const isStale = (Date.now() - serverTsMs) > RENDER_STALE_MAX_AGE_MS;

    return {
      ok: true,
      galaxy,
      systemMax,
      initialFrom: from,
      initialTo: to,
      maxPoints,
      renderSchemaVersion: schemaVersion,
      assetsManifestVersion,
      serverTsMs,
      isStale: isStale ? { ts: Date.now(), maxAgeMs: RENDER_STALE_MAX_AGE_MS } : null,
    };
  }

  function adaptGalaxyStarsPayload(payload, fallback = {}) {
    if (!payload || payload.success !== true) {
      return _buildSchemaError('stars', ['payload.success !== true'], payload);
    }

    const galaxy = Math.max(1, Number(payload.galaxy || fallback.galaxy || 1));
    const from = Math.max(1, Number(payload.from || fallback.from || 1));
    const to = Math.max(from, Number(payload.to || fallback.to || from));
    const total = Math.max(to, Number(payload.total || fallback.total || to));
    const systems = Array.isArray(payload.systems) ? payload.systems : [];
    const schemaVersion = _normalizeRenderSchemaVersion(payload);
    const assetsManifestVersion = _normalizeAssetsManifestVersion(payload, fallback);

    const issues = [];
    if (systems.length === 0) issues.push('systems array is empty');
    if (schemaVersion <= 0) issues.push('render_schema_version missing');
    if (assetsManifestVersion <= 0) issues.push('assets_manifest_version missing');

    if (issues.length > 0) {
      return _buildSchemaError('stars', issues, payload);
    }

    const serverTsMs = Number(payload.server_ts_ms || Date.now());
    const isStale = (Date.now() - serverTsMs) > RENDER_STALE_MAX_AGE_MS;

    return {
      ok: true,
      galaxy,
      from,
      to,
      total,
      count: systems.length,
      systems,
      renderSchemaVersion: schemaVersion,
      assetsManifestVersion,
      serverTsMs,
      isStale: isStale ? { ts: Date.now(), maxAgeMs: RENDER_STALE_MAX_AGE_MS } : null,
    };
  }

  function classifyRenderLoadError(input) {
    if (input?.errorType === 'schema') {
      return { type: 'schema', message: 'Render schema mismatch', details: input.issues || [] };
    }
    if (input?.errorType === 'stale') {
      return { type: 'stale', message: 'Render data is stale', details: input.issues || [] };
    }

    const status = Number(input?.status || input?.cause?.status || 0);
    const text = String(input?.message || input?.error || input || '').toLowerCase();

    if (status === 401 || status === 403 || /not authenticated|unauthorized|forbidden/.test(text)) {
      return { type: 'auth', message: 'Authentication required', details: [status || 'auth'] };
    }
    if (/network|failed to fetch|timeout|offline|econn|abort/.test(text) || status >= 500 || status === 0) {
      return { type: 'network', message: 'Network error', details: [status || 'transport'] };
    }
    return { type: 'network', message: 'Unknown transport error', details: [status || 'unknown'] };
  }

  return {
    adaptGalaxyBootstrap: (payload, fallback) => adaptGalaxyBootstrapPayload(payload, fallback),
    adaptGalaxyStars: (payload, fallback) => adaptGalaxyStarsPayload(payload, fallback),
    classifyRenderError: (input) => classifyRenderLoadError(input),
    summarizeSystemPayload: (payload) => _summarizeSystemPayloadMeta(payload),
  };
})();

if (typeof window !== 'undefined') {
  window.APISchemaAdapters = APISchemaAdapters;
}
