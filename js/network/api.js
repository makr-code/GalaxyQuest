/**
 * Thin API wrapper for the game frontend.
 * All requests automatically attach the CSRF token from the session.
 */
const API = (() => {
  const API_VERSION = 'v1';
  let _csrfToken = null;
  let _sessionExpired = false;   // set on first 401 to stop redirect storm
  const _getCache = new Map();
  let _activeLoads = 0;
  let _activeNetworkRequests = 0;
  let _requestSequence = 0;
  let _requestTaskId = 0;
  const _requestQueue = [];
  const _inflightTasks = new Map();
  const _activeByRequestClass = Object.create(null);
  let _maxConcurrentRequests = 4;
  let _lastConnectivityProbe = { ts: 0, data: null };
  const _recentLoadErrorLogs = new Map();
  const _recentRetryLogs = new Map();
  const _authErrorGate = { ts: 0, key: '' };
  const _requestClassCaps = {
    auth: 2,
    overview: 1,
    stars: 1,
    binary: 2,
    mutation: 2,
  };
  const _preferBinaryGalaxySystem = false;

  // Short-lived cache tuned for frequently refreshed strategy-game data.
  const _defaultGetTtlMs = [
    { re: /api\/audio\.php\?action=list/i, ttl: 60 * 1000 },
    { re: /api\/ollama\.php\?action=status/i, ttl: 5 * 1000 },
    { re: /api\/game\.php\?action=health/i, ttl: 5 * 1000 },
    { re: /api\/game\.php\?action=overview/i, ttl: 10 * 1000 },
    { re: /api\/game\.php\?action=resources/i, ttl: 8 * 1000 },
    { re: /api\/game\.php\?action=leaderboard/i, ttl: 20 * 1000 },
    { re: /api\/buildings\.php\?action=list/i, ttl: 10 * 1000 },
    { re: /api\/research\.php\?action=list/i, ttl: 12 * 1000 },
    { re: /api\/shipyard\.php\?action=list/i, ttl: 12 * 1000 },
    { re: /api\/fleet\.php\?action=list/i, ttl: 10 * 1000 },
    { re: /api\/messages\.php\?action=inbox/i, ttl: 8 * 1000 },
    { re: /api\/messages\.php\?action=users/i, ttl: 20 * 1000 },
    { re: /api\/reports\.php\?action=spy_reports/i, ttl: 10 * 1000 },
    { re: /api\/reports\.php\?action=battle_reports/i, ttl: 10 * 1000 },
    { re: /api\/trade\.php\?action=list$/i,          ttl: 8 * 1000 },
    { re: /api\/trade\.php\?action=list_proposals/i, ttl: 6 * 1000 },
    { re: /api\/traders\.php\?action=list_traders/i, ttl: 8 * 1000 },
    { re: /api\/traders\.php\?action=list_routes/i, ttl: 6 * 1000 },
    { re: /api\/traders_events\.php\?event=status/i, ttl: 5 * 1000 },
    { re: /api\/traders_dashboard\.php\?action=opportunity_alerts/i, ttl: 6 * 1000 },
    { re: /api\/pirates\.php\?action=status/i, ttl: 6 * 1000 },
    { re: /api\/pirates\.php\?action=recent_raids/i, ttl: 6 * 1000 },
    { re: /api\/pirates\.php\?action=forecast/i, ttl: 8 * 1000 },
    { re: /api\/economy\.php\?action=get_overview/i, ttl: 8 * 1000 },
    { re: /api\/economy\.php\?action=get_policy/i, ttl: 10 * 1000 },
    { re: /api\/economy\.php\?action=get_pop_classes/i, ttl: 10 * 1000 },
    { re: /api\/economy\.php\?action=get_pop_status/i, ttl: 10 * 1000 },
    { re: /api\/economy\.php\?action=get_production/i, ttl: 8 * 1000 },
    { re: /api\/alliances\.php\?action=list/i, ttl: 8 * 1000 },
    { re: /api\/alliances\.php\?action=details/i, ttl: 6 * 1000 },
    { re: /api\/alliances\.php\?action=relations/i, ttl: 5 * 1000 },
    { re: /api\/alliances\.php\?action=get_messages/i, ttl: 5 * 1000 },
    { re: /api\/alliances\.php\?action=war_map/i, ttl: 10 * 1000 },
    { re: /api\/alliance_wars\.php\?action=list/i, ttl: 8 * 1000 },
    { re: /api\/alliance_wars\.php\?action=get_status/i, ttl: 5 * 1000 },
    { re: /api\/war\.php\?action=list/i, ttl: 8 * 1000 },
    { re: /api\/war\.php\?action=get_status/i, ttl: 5 * 1000 },
    { re: /api\/war\.php\?action=get_intel/i, ttl: 30 * 1000 },
    { re: /api\/war\.php\?action=alliance_wars/i, ttl: 10 * 1000 },
    { re: /api\/galaxy\.php\?action=stars/i, ttl: 45 * 1000 },
    { re: /api\/galaxy\.php\?action=bootstrap/i, ttl: 20 * 1000 },
    { re: /api\/galaxy\.php\?/i, ttl: 15 * 1000 },
    { re: /api\/achievements\.php\?action=list/i, ttl: 15 * 1000 },
    { re: /api\/leaders\.php\?action=list/i, ttl: 15 * 1000 },
    { re: /api\/factions\.php\?action=/i, ttl: 20 * 1000 },
    { re: /api\/npc_controller\.php\?action=status/i, ttl: 8 * 1000 },
    { re: /api\/npc_controller\.php\?action=summary/i, ttl: 8 * 1000 },
    { re: /api\/npc_controller\.php\?action=decisions/i, ttl: 6 * 1000 },
  ];

  const _mutationInvalidatePatterns = [
    /^api\/game\.php\?action=/i,
    /^api\/buildings\.php\?action=/i,
    /^api\/research\.php\?action=/i,
    /^api\/shipyard\.php\?action=/i,
    /^api\/fleet\.php\?action=/i,
    /^api\/achievements\.php\?action=/i,
    /^api\/leaders\.php\?action=/i,
    /^api\/factions\.php\?action=/i,
    /^api\/npc_controller\.php\?action=/i,
    /^api\/messages\.php\?action=/i,
    /^api\/reports\.php\?action=/i,
    /^api\/trade\.php\?action=/i,
    /^api\/traders\.php\?action=/i,
    /^api\/traders_events\.php\?event=/i,
    /^api\/traders_dashboard\.php\?action=/i,
    /^api\/pirates\.php\?action=/i,
    /^api\/economy\.php\?action=/i,
    /^api\/alliances\.php\?action=/i,
    /^api\/alliance_wars\.php\?action=/i,
    /^api\/war\.php\?action=/i,
    /^api\/galaxy\.php\?/i,
  ];

  function _emitLoadProgress(detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('gq:load-progress', {
      detail: Object.assign({}, detail, {
        queued: _requestQueue.length,
        inFlight: _activeNetworkRequests,
        concurrency: _maxConcurrentRequests,
      }),
    }));
  }

  function _emitLoadError(detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('gq:load-error', { detail }));
  }

  function _shouldLogWithCooldown(bucket, key, cooldownMs = 2000) {
    const now = Date.now();
    const prev = Number(bucket.get(key) || 0);
    if ((now - prev) < cooldownMs) {
      return false;
    }
    bucket.set(key, now);

    if (bucket.size > 400) {
      const pruneBefore = now - Math.max(60000, cooldownMs * 8);
      for (const [k, ts] of bucket.entries()) {
        if (Number(ts || 0) < pruneBefore) bucket.delete(k);
      }
    }
    return true;
  }

  function _log(level, message, data = null) {
    const lvl = String(level || 'info').toLowerCase();
    const sink = window.GQLog && typeof window.GQLog[lvl] === 'function'
      ? window.GQLog[lvl].bind(window.GQLog)
      : null;
    if (sink) {
      if (data == null) sink('[api]', message);
      else sink('[api]', message, data);
      return;
    }
    const consoleMethod = (lvl === 'error' || lvl === 'warn' || lvl === 'info') ? lvl : 'log';
    if (data == null) console[consoleMethod]('[GQ][API]', message);
    else console[consoleMethod]('[GQ][API]', message, data);
  }

  function _isTraceEnabled() {
    try {
      return !!(window.GQLog && typeof window.GQLog.traceEnabled === 'function' && window.GQLog.traceEnabled());
    } catch (_) {
      return false;
    }
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

  function _traceSystemQuery(stage, meta = {}) {
    if (!_isTraceEnabled()) return;
    _log('info', `[query-pipeline] ${stage}`, meta);
  }

  function _emitQueueStats(label = 'Queue aktiv') {
    const busy = _activeLoads > 0 || _activeNetworkRequests > 0 || _requestQueue.length > 0;
    _emitLoadProgress({
      active: busy,
      progress: _activeLoads > 0 ? 0.12 : (busy ? 0.06 : 0),
      pending: _activeLoads,
      label,
    });
  }

  function _isAbortError(err) {
    if (!err) return false;
    if (typeof err === 'string') {
      return /abort|cancel|navigation/i.test(err);
    }
    const name = String(err.name || '');
    const message = String(err.message || '');
    const reason = String(err.reason || err.cause?.message || err.cause || '');
    return name === 'AbortError' || /abort|cancel|navigation/i.test(message) || /abort|cancel|navigation/i.test(reason);
  }

  function _createAbortError(message = 'Request cancelled') {
    try {
      return new DOMException(message, 'AbortError');
    } catch (_) {
      const e = new Error(message);
      e.name = 'AbortError';
      return e;
    }
  }

  const RENDER_SCHEMA_VERSION = 1;
  const ASSETS_MANIFEST_VERSION = Math.max(1, Number(window.GQ_ASSETS_MANIFEST_VERSION || 1));
  const RENDER_STALE_MAX_AGE_MS = 10 * 60 * 1000;

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
      data: {
        success: true,
        action: 'bootstrap',
        render_schema_version: schemaVersion,
        schema_ok: schemaVersion === RENDER_SCHEMA_VERSION,
        assets_manifest_version: assetsManifestVersion,
        assets_manifest_ok: assetsManifestVersion === ASSETS_MANIFEST_VERSION,
        stale: isStale,
        galaxy,
        system_max: systemMax,
        server_ts_ms: serverTsMs,
        initial_range: {
          from,
          to,
          max_points: maxPoints,
        },
        endpoints: payload.endpoints || {},
        capabilities: payload.capabilities || {},
      },
    };
  }

  function adaptGalaxyStarsPayload(payload, fallback = {}) {
    if (!payload || payload.success !== true) {
      return _buildSchemaError('stars', ['payload.success !== true'], payload);
    }

    const stars = Array.isArray(payload.stars) ? payload.stars : [];
    const issues = [];
    const schemaVersion = _normalizeRenderSchemaVersion(payload);
    const assetsManifestVersion = _normalizeAssetsManifestVersion(payload, fallback);
    if (schemaVersion <= 0) issues.push('render_schema_version missing');
    if (assetsManifestVersion <= 0) issues.push('assets_manifest_version missing');
    if (!Array.isArray(payload.stars)) issues.push('stars missing');

    const galaxy = Math.max(1, Number(payload.galaxy || fallback.galaxy || 1));
    const from = Math.max(1, Number(payload.from || fallback.from || 1));
    const to = Math.max(from, Number(payload.to || fallback.to || from));
    const stride = Math.max(1, Number(payload.stride || 1));
    const systemMax = Math.max(1, Number(payload.system_max || fallback.systemMax || 1));

    if (issues.length > 0) {
      return _buildSchemaError('stars', issues, payload);
    }

    const serverTsMs = Number(payload.server_ts_ms || Date.now());
    const isStale = (Date.now() - serverTsMs) > RENDER_STALE_MAX_AGE_MS;

    return {
      ok: true,
      data: {
        success: true,
        action: 'stars',
        render_schema_version: schemaVersion,
        schema_ok: schemaVersion === RENDER_SCHEMA_VERSION,
        assets_manifest_version: assetsManifestVersion,
        assets_manifest_ok: assetsManifestVersion === ASSETS_MANIFEST_VERSION,
        stale: isStale,
        galaxy,
        from,
        to,
        stride,
        system_max: systemMax,
        count: Number(payload.count || stars.length || 0),
        server_ts_ms: serverTsMs,
        cache_mode: String(payload.cache_mode || ''),
        request: (payload.request && typeof payload.request === 'object') ? payload.request : {
          priority: 'normal',
          prefetch: false,
          chunk_hint: Number(fallback.maxPoints || 1500),
        },
        cluster_preset_selected: String(payload.cluster_preset_selected || 'medium'),
        prefetch: (payload.prefetch && typeof payload.prefetch === 'object') ? payload.prefetch : {
          before: { from, to: Math.max(from, from - 1) },
          after: { from: Math.min(systemMax, to + 1), to: Math.min(systemMax, to + 1) },
        },
        clusters_lod: (payload.clusters_lod && typeof payload.clusters_lod === 'object') ? payload.clusters_lod : null,
        clusters: Array.isArray(payload.clusters) ? payload.clusters : [],
        stars,
      },
    };
  }

  function _detectConcurrencyLimit() {
    try {
      const nav = navigator || {};
      const conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
      const cores = Number(nav.hardwareConcurrency || 0);
      const mem = Number(nav.deviceMemory || 0);
      const effectiveType = String(conn.effectiveType || '').toLowerCase();
      const saveData = !!conn.saveData;

      if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') return 2;
      if (cores > 0 && cores <= 4) return 3;
      if (mem > 0 && mem <= 4) return 3;
      if (effectiveType === '3g') return 3;
      if (cores >= 12 || mem >= 12) return 6;
      return 4;
    } catch (err) {
      _log('warn', 'Konnte Netzwerkprofil nicht bestimmen, verwende Default-Parallelisierung', err);
      return 4;
    }
  }

  _maxConcurrentRequests = _detectConcurrencyLimit();
  try {
    const conn = navigator?.connection || navigator?.mozConnection || navigator?.webkitConnection;
    if (conn && typeof conn.addEventListener === 'function') {
      conn.addEventListener('change', () => {
        _maxConcurrentRequests = _detectConcurrencyLimit();
        _emitQueueStats('Netzwerkprofil aktualisiert…');
        _pumpRequestQueue();
      });
    }
  } catch (err) {
    _log('warn', 'Netzwerk-Change-Listener konnte nicht registriert werden', err);
  }

  function _reportLoadError(endpoint, err, context = '') {
    const message = _describeError(err, endpoint, context);
    const diagnostics = _diagnoseFromError(err, endpoint, context);

    const status = Number(err?.status || err?.cause?.status || 0);
    const baseKey = `${context}|${endpoint}|${diagnostics.kind}|${status}|${message}`;

    // Auth failures can repeat rapidly across many callers; keep a single visible entry per short window.
    if (diagnostics.kind === 'auth') {
      const authKey = `${endpoint}|${status || 401}`;
      const now = Date.now();
      if (_authErrorGate.key === authKey && (now - _authErrorGate.ts) < 8000) {
        return;
      }
      _authErrorGate.key = authKey;
      _authErrorGate.ts = now;
    }

    if (!_shouldLogWithCooldown(_recentLoadErrorLogs, baseKey, diagnostics.kind === 'unreachable' ? 5000 : 2200)) {
      return;
    }

    console.error('[GQ][API] Ladefehler', {
      endpoint,
      context,
      message,
      kind: diagnostics.kind,
      error: err,
    });
    _emitLoadError({
      endpoint: String(endpoint || ''),
      context: String(context || ''),
      message,
      kind: String(diagnostics.kind || 'unknown'),
      error: err,
    });
  }

  function _describeError(err, endpoint = '', context = '') {
    const parts = [];
    const ep = String(endpoint || '');
    const cx = String(context || '');
    if (cx) parts.push(cx);
    if (ep) parts.push(ep);

    let detail = '';
    if (err instanceof Error) {
      detail = String(err.message || err.name || '').trim();
      const causeMsg = String(err.cause?.message || err.cause || '').trim();
      if (!detail && causeMsg) detail = causeMsg;
      if (!detail) detail = String(err.name || 'Error');
    } else if (err && typeof err === 'object') {
      const status = Number(err.status || 0);
      const statusText = String(err.statusText || '').trim();
      const msg = String(err.message || err.error || err.reason || '').trim();
      if (status > 0) {
        detail = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
      } else if (msg) {
        detail = msg;
      } else {
        try {
          detail = JSON.stringify(err);
        } catch (jsonErr) {
          _log('info', 'Fehlerobjekt konnte nicht serialisiert werden', jsonErr);
          detail = String(err);
        }
      }
    } else if (typeof err === 'string') {
      detail = err.trim();
    } else if (typeof err === 'number' || typeof err === 'boolean') {
      detail = String(err);
    }

    if (!detail) detail = 'Unbekannter Ladefehler';
    const snippet = String(err?.responseSnippet || '').trim();
    if (snippet) {
      detail += ` | body: ${snippet}`;
    }
    parts.push(detail);
    return parts.join(': ');
  }

  function _diagnoseFromError(err, endpoint = '', context = '') {
    if (_isAbortError(err)) {
      return {
        kind: 'abort',
        reachable: null,
        message: _describeError(err, endpoint, context),
      };
    }

    const status = Number(err?.status || err?.cause?.status || 0);
    const statusText = String(err?.statusText || err?.cause?.statusText || '').trim();
    const rawMessage = String(err?.message || err?.cause?.message || err || '').toLowerCase();
    const offline = typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
    const authByMessage = /not authenticated|unauthorized|forbidden|http\s*401|http\s*403/.test(rawMessage);

    if (offline) {
      return {
        kind: 'offline',
        reachable: false,
        status: 0,
        message: 'Netzwerk offline',
      };
    }

    if (status > 0) {
      if (status === 401 || status === 403) {
        return {
          kind: 'auth',
          reachable: true,
          status,
          message: `Auth-Fehler (${status}${statusText ? ` ${statusText}` : ''})`,
        };
      }
      return {
        kind: 'http',
        reachable: true,
        status,
        message: `HTTP ${status}${statusText ? ` ${statusText}` : ''}`,
      };
    }

    if (authByMessage) {
      return {
        kind: 'auth',
        reachable: true,
        status: 401,
        message: 'Auth-Fehler (Session nicht authentifiziert)',
      };
    }

    if (rawMessage.includes('timeout')) {
      return {
        kind: 'timeout',
        reachable: null,
        status: 0,
        message: 'Zeitueberschreitung beim Verbindungsaufbau',
      };
    }

    if (rawMessage.includes('failed to fetch') || rawMessage.includes('networkerror') || rawMessage.includes('network error')) {
      return {
        kind: 'unreachable',
        reachable: false,
        status: 0,
        message: 'API nicht erreichbar (Failed to fetch)',
      };
    }

    return {
      kind: 'unknown',
      reachable: null,
      status: status || 0,
      message: _describeError(err, endpoint, context),
    };
  }

  async function _probeConnectivity(force = false) {
    const now = Date.now();
    const ttlMs = 12000;
    if (!force && _lastConnectivityProbe.data && (now - _lastConnectivityProbe.ts) < ttlMs) {
      return _lastConnectivityProbe.data;
    }

    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
      const data = {
        ok: false,
        kind: 'offline',
        reachable: false,
        status: 0,
        latencyMs: 0,
        message: 'Client offline',
        ts: now,
      };
      _lastConnectivityProbe = { ts: now, data };
      return data;
    }

    const controller = new AbortController();
    const started = performance.now();
    const timeout = setTimeout(() => controller.abort(_createAbortError('Connectivity probe timeout')), 3500);
    try {
      const resp = await _queueFetch('api/auth.php?action=csrf', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      }, { priority: 'critical', canCancel: false });
      const latencyMs = Math.max(0, Math.round(performance.now() - started));
      const status = Number(resp?.status || 0);
      const data = {
        ok: !!resp && status > 0 && status < 500,
        kind: status >= 500 ? 'http' : 'ok',
        reachable: !!resp && status > 0,
        status,
        latencyMs,
        message: status >= 500 ? `HTTP ${status}` : 'API erreichbar',
        ts: Date.now(),
      };
      _lastConnectivityProbe = { ts: Date.now(), data };
      return data;
    } catch (err) {
      const diag = _diagnoseFromError(err, 'api/auth.php?action=csrf', 'CONNECTIVITY');
      const data = {
        ok: false,
        kind: diag.kind,
        reachable: diag.reachable,
        status: Number(diag.status || 0),
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
        message: String(diag.message || 'Connectivity probe failed'),
        ts: Date.now(),
      };
      _lastConnectivityProbe = { ts: Date.now(), data };
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  function _isTransientError(err) {
    const status = Number(err?.status || 0);
    if (status > 0) {
      // Retry only on clearly transient HTTP statuses.
      return status >= 500 || status === 408 || status === 429;
    }
    const message = String(err?.message || err || '').toLowerCase();
    return message.includes('failed to fetch')
      || message.includes('networkerror')
      || message.includes('network error')
      || message.includes('timeout')
      || message.includes('temporarily unavailable');
  }

  function _sanitizeSnippet(text, maxLen = 300) {
    const clean = String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .trim();
    if (!clean) return '';
    if (clean.length <= maxLen) return clean;
    return `${clean.slice(0, maxLen)}...`;
  }

  function _contentTypeOf(response) {
    try {
      return String(response?.headers?.get('content-type') || '').toLowerCase();
    } catch (err) {
      _log('info', 'Content-Type konnte nicht gelesen werden', err);
      return '';
    }
  }

  async function _throwHttpError(endpoint, response, context = '') {
    const status = Number(response?.status || 0);
    const statusText = String(response?.statusText || '').trim();
    const contentType = _contentTypeOf(response);
    const err = new Error(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
    err.status = status;
    err.statusText = statusText;
    err.endpoint = endpoint;
    err.context = context;
    err.contentType = contentType || 'unknown';

    try {
      const clone = response.clone();
      const raw = await clone.text();
      const snippet = _sanitizeSnippet(raw, 300);
      if (snippet) err.responseSnippet = snippet;
    } catch (err) {
      _log('info', 'Fehlerantwort konnte nicht fuer Snippet gelesen werden', {
        endpoint,
        status,
        error: err,
      });
      // Ignore body read errors for diagnostics.
    }

    throw err;
  }

  function _priorityValue(name) {
    const key = String(name || 'normal').toLowerCase();
    if (key === 'critical') return 0;
    if (key === 'high') return 1;
    if (key === 'low') return 3;
    return 2;
  }

  function _resolveRequestPriority(endpoint, explicitPriority) {
    if (explicitPriority) return String(explicitPriority);

    const ep = String(endpoint || '').toLowerCase();
    if (/api\/auth\.php\?action=csrf|api\/auth\.php\?action=me/.test(ep)) return 'critical';
    if (/api\/game\.php\?action=overview/.test(ep)) return 'critical';
    if (/api\/galaxy\.php\?action=stars/.test(ep)) return 'high';
    if (/api\/galaxy\.php\?/.test(ep)) return 'high';
    if (/api\/fleet\.php\?action=send|api\/fleet\.php\?action=recall/.test(ep)) return 'high';
    if (/api\/messages\.php\?action=users/.test(ep)) return 'low';
    if (/api\/leaderboard\.php\?/.test(ep)) return 'low';
    return 'normal';
  }

  function _resolveRequestClass(endpoint, init = {}, explicitClass = '') {
    if (explicitClass) return String(explicitClass);
    const ep = String(endpoint || '').toLowerCase();
    const method = String(init?.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return 'mutation';
    if (/api\/auth\.php\?action=csrf|api\/auth\.php\?action=me/.test(ep)) return 'auth';
    if (/api\/game\.php\?action=overview/.test(ep)) return 'overview';
    if (/api\/galaxy\.php\?action=stars/.test(ep)) return 'stars';
    if (/api\/galaxy\.php\?/.test(ep)) return 'binary';
    return 'default';
  }

  function _hasCriticalQueuePressure() {
    return _requestQueue.some((item) => item.priorityValue === 0);
  }

  function _canStartTask(task) {
    if (!task) return false;
    const cls = String(task.requestClass || 'default');
    const activeInClass = Number(_activeByRequestClass[cls] || 0);
    const classCap = Number(_requestClassCaps[cls] || 0);
    if (classCap > 0 && activeInClass >= classCap) return false;

    // Keep one slot available when critical auth/overview requests are waiting.
    if (task.priorityValue > 0 && _hasCriticalQueuePressure() && _activeNetworkRequests >= Math.max(1, _maxConcurrentRequests - 1)) {
      return false;
    }
    return true;
  }

  function _pickNextQueuedTask() {
    if (_requestQueue.length === 0) return null;

    for (let i = 0; i < _requestQueue.length; i += 1) {
      const candidate = _requestQueue[i];
      if (_canStartTask(candidate)) {
        return _requestQueue.splice(i, 1)[0];
      }
    }
    return null;
  }

  function _isUnreachableFetchError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('failed to fetch')
      || msg.includes('networkerror')
      || msg.includes('network error')
      || msg.includes('load failed');
  }

  function _toDevPortEndpoint(endpoint) {
    const raw = String(endpoint || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/')) return `http://localhost:8080${raw}`;
    return `http://localhost:8080/${raw.replace(/^\.\//, '')}`;
  }

  function _canRetryViaDevPort(task, err) {
    if (!_isUnreachableFetchError(err)) return false;
    if (task?.init?.signal?.aborted) return false;
    if (typeof window === 'undefined' || !window.location) return false;
    const host = String(window.location.hostname || '').toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1') return false;
    const port = String(window.location.port || '').trim();
    if (port === '8080') return false;
    const endpoint = String(task?.fetchEndpoint || task?.endpoint || '');
    return endpoint.startsWith('api/') || endpoint.startsWith('/api/');
  }

  function _fetchTask(task) {
    const primaryEndpoint = task.fetchEndpoint || task.endpoint;
    return fetch(primaryEndpoint, task.init).catch((err) => {
      if (!_canRetryViaDevPort(task, err)) {
        throw err;
      }
      const fallbackEndpoint = _toDevPortEndpoint(primaryEndpoint);
      if (!fallbackEndpoint || fallbackEndpoint === primaryEndpoint) {
        throw err;
      }
      _log('warn', 'Netzwerk-Fallback aktiv: Retry ueber localhost:8080', {
        endpoint: primaryEndpoint,
        fallbackEndpoint,
      });
      return fetch(fallbackEndpoint, task.init);
    });
  }

  function _pumpRequestQueue() {
    while (_activeNetworkRequests < _maxConcurrentRequests && _requestQueue.length > 0) {
      const task = _pickNextQueuedTask();
      if (!task) break;

      if (task.cancelled) {
        task.reject(_createAbortError(task.cancelReason || 'Request cancelled before start'));
        continue;
      }

      _activeNetworkRequests += 1;
      _activeByRequestClass[task.requestClass] = Number(_activeByRequestClass[task.requestClass] || 0) + 1;
      task.started = true;
      _inflightTasks.set(task.id, task);

      _fetchTask(task)
        .then((resp) => task.resolve(resp))
        .catch((err) => task.reject(err))
        .finally(() => {
          _inflightTasks.delete(task.id);
          _activeNetworkRequests = Math.max(0, _activeNetworkRequests - 1);
          _activeByRequestClass[task.requestClass] = Math.max(0, Number(_activeByRequestClass[task.requestClass] || 0) - 1);
          _emitQueueStats('Queue synchronisiert…');
          _pumpRequestQueue();
        });
    }
  }

  function _queueFetch(endpoint, init = {}, options = {}) {
    const endpointText = String(endpoint || '');
    const authMaintenance = /api\/(?:v1\/)?auth\.php\?action=(me|csrf|logout|login)/i.test(endpointText);
    if (_sessionExpired && !authMaintenance) {
      const blocked = new Error('Session redirect in progress');
      blocked.code = 'EAUTH_REDIRECT';
      blocked.status = 401;
      blocked.endpoint = endpointText;
      return Promise.reject(blocked);
    }

    const priority = _resolveRequestPriority(endpoint, options.priority);
    const priorityValue = _priorityValue(priority);
    const method = String(init?.method || 'GET').toUpperCase();
    const requestClass = _resolveRequestClass(endpoint, init, options.requestClass);
    const controller = new AbortController();
    const signal = options.signal || controller.signal;
    const canCancel = options.canCancel !== false && (method === 'GET' || method === 'HEAD');
    const taskId = ++_requestTaskId;

    if (options.signal && typeof options.signal.addEventListener === 'function') {
      options.signal.addEventListener('abort', () => {
        controller.abort(options.signal.reason || 'Aborted by caller signal');
      }, { once: true });
    }

    return new Promise((resolve, reject) => {
      const fetchEndpoint = _versionEndpoint(endpointText);
      _requestQueue.push({
        id: taskId,
        endpoint,
        fetchEndpoint,
        init: Object.assign({}, init, { signal }),
        resolve,
        reject,
        priority,
        priorityValue,
        requestClass,
        method,
        canCancel,
        controller,
        cancelled: false,
        cancelReason: '',
        seq: ++_requestSequence,
        started: false,
      });

      _requestQueue.sort((a, b) => {
        if (a.priorityValue !== b.priorityValue) return a.priorityValue - b.priorityValue;
        return a.seq - b.seq;
      });

      _emitQueueStats('Anfrage eingereiht…');
      _pumpRequestQueue();
    });
  }

  function _cancelPendingRequests(reason = 'View switch', predicate = null) {
    const test = typeof predicate === 'function' ? predicate : (() => true);
    let cancelledQueued = 0;
    let cancelledInflight = 0;

    for (let i = _requestQueue.length - 1; i >= 0; i -= 1) {
      const task = _requestQueue[i];
      if (!task || !task.canCancel || !test(task)) continue;
      _requestQueue.splice(i, 1);
      task.cancelled = true;
      task.cancelReason = reason;
      task.reject(_createAbortError(reason));
      cancelledQueued += 1;
    }

    for (const task of _inflightTasks.values()) {
      if (!task || !task.canCancel || !test(task)) continue;
      try {
        task.cancelled = true;
        task.cancelReason = reason;
        task.controller.abort(_createAbortError(reason));
        cancelledInflight += 1;
      } catch (err) {
        _log('warn', 'Abbruch einer Inflight-Anfrage fehlgeschlagen', {
          reason,
          endpoint: String(task?.endpoint || ''),
          error: err,
        });
      }
    }

    if (cancelledQueued > 0 || cancelledInflight > 0) {
      _emitQueueStats(`Anfragen verworfen (${cancelledQueued + cancelledInflight})`);
    }

    return { cancelledQueued, cancelledInflight };
  }

  async function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function _retryDelayMs(attempt) {
    const base = 220;
    const jitter = Math.floor(Math.random() * 90);
    return Math.min(1800, (base * (2 ** attempt)) + jitter);
  }

  function _versionEndpoint(endpoint) {
    const raw = String(endpoint || '').trim();
    if (!raw) return raw;
    if (/^(https?:)?\/\//i.test(raw)) return raw;

    const normalized = raw.startsWith('/') ? raw.slice(1) : raw;
    if (new RegExp(`^api/${API_VERSION}/`, 'i').test(normalized)) {
      return normalized;
    }
    if (/^api\//i.test(normalized)) {
      return normalized.replace(/^api\//i, `api/${API_VERSION}/`);
    }
    return normalized;
  }

  async function _fetchWithRetry(endpoint, init = {}, options = {}) {
    const method = String(init?.method || 'GET').toUpperCase();
    const idempotent = method === 'GET' || method === 'HEAD';
    const retryCount = idempotent
      ? Math.max(0, Number.isFinite(Number(options.retryCount)) ? Number(options.retryCount) : 2)
      : 0;
    const timeoutMs = Math.max(0, Number(options.timeoutMs || 0));

    let lastErr = null;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      let timeoutId = null;
      try {
        const timeoutController = new AbortController();
        if (init?.signal && typeof init.signal.addEventListener === 'function') {
          init.signal.addEventListener('abort', () => {
            timeoutController.abort(init.signal.reason || _createAbortError('Request cancelled'));
          }, { once: true });
        }
        if (timeoutMs > 0) {
          timeoutId = setTimeout(() => {
            timeoutController.abort(_createAbortError(`Request timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        }

        const queueInit = Object.assign({}, init, { signal: timeoutController.signal });
        const queueOptions = Object.assign({}, options, { signal: timeoutController.signal });
        const response = await _queueFetch(endpoint, queueInit, queueOptions);
        if (!response || !response.ok) {
          await _throwHttpError(endpoint, response, method);
        }
        return response;
      } catch (err) {
        lastErr = err;
        const abortMessage = String(err?.message || err?.reason || err?.cause?.message || err?.cause || '').toLowerCase();
        const timeoutAbort = _isAbortError(err) && (abortMessage.includes('timeout') || abortMessage.includes('timed out'));
        if (_isAbortError(err) && !timeoutAbort) throw err;
        const transient = timeoutAbort || _isTransientError(err);
        if (!idempotent || !transient || attempt >= retryCount) {
          const finalMessage = _describeError(err, endpoint, `${method} retry ${attempt + 1}/${retryCount + 1}`);
          const wrapped = new Error(finalMessage);
          wrapped.cause = err;
          if (err?.status) wrapped.status = err.status;
          if (err?.statusText) wrapped.statusText = err.statusText;
          if (err?.responseSnippet) wrapped.responseSnippet = err.responseSnippet;
          throw wrapped;
        }
        const retryMsg = _describeError(err, endpoint, method);
        const retryKey = `${method}|${endpoint}|${attempt + 1}|${retryMsg}`;
        if (_shouldLogWithCooldown(_recentRetryLogs, retryKey, 2000)) {
          console.warn('[GQ][API] Retry due to transient error', {
            endpoint,
            method,
            attempt: attempt + 1,
            maxAttempts: retryCount + 1,
            error: retryMsg,
          });
        }
        await _sleep(_retryDelayMs(attempt));
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
    throw lastErr || new Error('Network request failed');
  }

  function _sanitizeLoadLabel(endpoint, fallback = 'Lade Daten…') {
    const ep = String(endpoint || '').trim();
    if (!ep) return fallback;
    try {
      const path = ep.replace(/^https?:\/\/[^/]+/i, '');
      const noQuery = path.split('?')[0] || path;
      const shortPath = noQuery.replace(/^\/+/, '');
      return shortPath ? `Lade ${shortPath}…` : fallback;
    } catch (err) {
      _log('info', 'Load-Label konnte nicht aus Endpoint extrahiert werden', {
        endpoint,
        error: err,
      });
      return fallback;
    }
  }

  function _beginLoad(endpoint, label) {
    _activeLoads += 1;
    const finalLabel = _sanitizeLoadLabel(endpoint, label);
    _emitLoadProgress({
      active: true,
      progress: 0.08,
      endpoint,
      pending: _activeLoads,
      label: finalLabel,
    });
    return {
      endpoint,
      label: finalLabel,
      closed: false,
    };
  }

  function _tickLoad(ticket, progress, phaseLabel) {
    if (!ticket || ticket.closed) return;
    _emitLoadProgress({
      active: true,
      progress: Math.max(0.08, Math.min(0.98, Number(progress || 0))),
      endpoint: ticket.endpoint,
      pending: _activeLoads,
      label: phaseLabel ? String(phaseLabel) : ticket.label,
    });
  }

  function _endLoad(ticket) {
    if (!ticket || ticket.closed) return;
    ticket.closed = true;
    _activeLoads = Math.max(0, _activeLoads - 1);

    if (_activeLoads > 0) {
      _emitLoadProgress({
        active: true,
        progress: 0.2,
        endpoint: ticket.endpoint,
        pending: _activeLoads,
        label: `Lade Daten (${_activeLoads})…`,
      });
      return;
    }

    _emitLoadProgress({
      active: true,
      progress: 1,
      endpoint: ticket.endpoint,
      pending: 0,
      label: 'Laden abgeschlossen',
    });

    setTimeout(() => {
      _emitLoadProgress({
        active: false,
        progress: 0,
        endpoint: ticket.endpoint,
        pending: 0,
        label: 'Bereit',
      });
    }, 200);
  }

  function _clone(value) {
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      _log('warn', 'Konnte Antwort nicht klonen, gebe Originalobjekt zurueck', err);
      return value;
    }
  }

  function _resolveGetTtl(endpoint) {
    for (const rule of _defaultGetTtlMs) {
      if (rule.re.test(endpoint)) return Number(rule.ttl) || 0;
    }
    return 0;
  }

  function _purgeExpiredGetCache(now = Date.now()) {
    for (const [key, item] of _getCache.entries()) {
      if (!item || item.expiresAt <= now) _getCache.delete(key);
    }
  }

  function _invalidateGetCache(patterns = _mutationInvalidatePatterns) {
    if (!patterns?.length) {
      _getCache.clear();
      return;
    }
    for (const key of [..._getCache.keys()]) {
      if (patterns.some((re) => re.test(key))) {
        _getCache.delete(key);
      }
    }
  }

  function _triggerSessionExpiredRedirect() {
    if (_sessionExpired) return;
    _sessionExpired = true;
    try {
      _cancelPendingRequests('Session expired', (task) => !/api\/(?:v1\/)?auth\.php\?action=(me|csrf|logout|login)/i.test(String(task?.endpoint || '')));
    } catch (err) {
      _log('warn', 'Konnte Pending-Requests nach Session-Ablauf nicht abbrechen', err);
    }
    window.location.href = 'index.html';
  }

  async function _csrf() {
    if (!_csrfToken) {
      const r = await _fetchWithRetry('api/auth.php?action=csrf', {}, { priority: 'high', retryCount: 1 });
      const d = await r.json();
      _csrfToken = d.token;
    }
    return _csrfToken;
  }

  async function get(endpoint, options = {}) {
    const loadTicket = _beginLoad(endpoint, 'Lade Daten…');
    const cacheMode = String(options.cacheMode || 'default');
    const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : _resolveGetTtl(endpoint);
    const now = Date.now();

    _purgeExpiredGetCache(now);

    if (cacheMode !== 'no-store' && ttlMs > 0) {
      const hit = _getCache.get(endpoint);
      if (hit && hit.expiresAt > now) return _clone(hit.data);
    }

    try {
      _tickLoad(loadTicket, 0.25, loadTicket.label);
      const r = await _fetchWithRetry(endpoint, {}, { priority: options.priority, retryCount: options.retryCount });
      if (r.status === 401) {
        _triggerSessionExpiredRedirect();
        const authErr = new Error('Not authenticated');
        authErr.status = 401;
        authErr.statusText = r.statusText || 'Unauthorized';
        throw authErr;
      }
      _tickLoad(loadTicket, 0.7, 'Verarbeite Antwort…');
      const data = await r.json();
      _tickLoad(loadTicket, 0.92, 'Fertigstelle Daten…');
      if (cacheMode !== 'no-store' && ttlMs > 0 && data && data.success !== false) {
        _getCache.set(endpoint, {
          data: _clone(data),
          expiresAt: Date.now() + ttlMs,
        });
      }
      return data;
    } catch (err) {
      if (_isAbortError(err)) throw err;
      // Auth-check endpoint can legitimately return 401 before login.
      if (Number(err?.status || err?.cause?.status || 0) === 401 && /api\/auth\.php\?action=me/i.test(String(endpoint || ''))) {
        throw err;
      }
      if (cacheMode === 'stale-if-error') {
        const stale = _getCache.get(endpoint);
        if (stale?.data) {
          console.warn('[GQ][API] Verwende stale Cache wegen Fehler', { endpoint, error: err });
          return _clone(stale.data);
        }
      }
      _reportLoadError(endpoint, err, 'GET');
      throw err;
    } finally {
      _endLoad(loadTicket);
    }
  }

  async function post(endpoint, body) {
    const loadTicket = _beginLoad(endpoint, 'Sende Daten…');
    try {
      const sendWithCsrf = async (csrfToken) => _fetchWithRetry(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(body),
      }, {});

      let csrf = await _csrf();
      _tickLoad(loadTicket, 0.22, loadTicket.label);
      let r = await sendWithCsrf(csrf);

      // Session rotation can invalidate a cached CSRF token (e.g. around auth transitions).
      // Refresh once and retry transparently when the backend reports a CSRF mismatch.
      if (r.status === 403) {
        let isCsrfMismatch = false;
        try {
          const probe = await r.clone().json();
          const msg = String(probe?.error || probe?.message || '').toLowerCase();
          isCsrfMismatch = /csrf/.test(msg);
        } catch (err) {
          _log('info', 'CSRF-Fehlerprobe konnte nicht geparst werden', err);
          isCsrfMismatch = false;
        }

        if (isCsrfMismatch) {
          _csrfToken = null;
          csrf = await _csrf();
          r = await sendWithCsrf(csrf);
        }
      }

      if (r.status === 401) {
        _triggerSessionExpiredRedirect();
        const authErr = new Error('Not authenticated');
        authErr.status = 401;
        authErr.statusText = r.statusText || 'Unauthorized';
        throw authErr;
      }
      _tickLoad(loadTicket, 0.72, 'Verarbeite Serverantwort…');
      const data = await r.json();
      if (data && data.success !== false) {
        _invalidateGetCache();
      }
      _tickLoad(loadTicket, 0.92, 'Aktualisiere Ansicht…');
      return data;
    } catch (err) {
      if (_isAbortError(err)) throw err;
      _reportLoadError(endpoint, err, 'POST');
      throw err;
    } finally {
      _endLoad(loadTicket);
    }
  }

  async function getBinary(endpoint, options = {}) {
    const loadTicket = _beginLoad(endpoint, 'Lade Sternsystem…');
    const cacheMode = String(options.cacheMode || 'default');
    const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : _resolveGetTtl(endpoint);
    const now = Date.now();

    _purgeExpiredGetCache(now);

    if (cacheMode !== 'no-store' && ttlMs > 0) {
      const hit = _getCache.get(endpoint);
      if (hit && hit.expiresAt > now) return _clone(hit.data);
    }

    try {
      _tickLoad(loadTicket, 0.24, loadTicket.label);
      const r = await _fetchWithRetry(endpoint, {}, {
        priority: options.priority || 'high',
        retryCount: options.retryCount,
      });
      if (r.status === 401) {
        _triggerSessionExpiredRedirect();
        const authErr = new Error('Not authenticated');
        authErr.status = 401;
        authErr.statusText = r.statusText || 'Unauthorized';
        throw authErr;
      }
      _tickLoad(loadTicket, 0.52, 'Dekodiere Binärdaten…');
      
      // Check for binary format marker
      const contentType = r.headers.get('content-type') || '';
      if (contentType.includes('octet-stream')) {
        // Binary mode
        const buffer = await r.arrayBuffer();
        let data = null;
        let decoderVersion = 0;

        // Version is stored after magic as u16 (offset 4..5).
        try {
          const view = new DataView(buffer);
          const magic = view.getUint32(0, false);
          const version = view.getUint16(4, false);
          decoderVersion = version;
          if (magic === 0xDEADBEEF) {
            if (version === 3 && typeof BinaryDecoderV3 !== 'undefined' && BinaryDecoderV3?.decode) {
              data = BinaryDecoderV3.decode(buffer);
            } else if (version === 2 && typeof BinaryDecoderV2 !== 'undefined' && BinaryDecoderV2?.decode) {
              data = BinaryDecoderV2.decode(buffer);
            } else if (version === 1 && typeof BinaryDecoder !== 'undefined' && BinaryDecoder?.decode) {
              data = BinaryDecoder.decode(buffer);
            }
          }
        } catch (err) {
          _log('warn', 'Binary-Header konnte nicht gelesen werden, Decoder-Fallback aktiv', err);
          data = null;
        }

        // Legacy fallback chain (in case version parse fails or decoder missing).
        if (!data && typeof BinaryDecoderV3 !== 'undefined' && BinaryDecoderV3?.decode) {
          data = BinaryDecoderV3.decode(buffer);
        }
        if (!data && typeof BinaryDecoderV2 !== 'undefined' && BinaryDecoderV2?.decode) {
          data = BinaryDecoderV2.decode(buffer);
        }
        if (!data && typeof BinaryDecoder !== 'undefined' && BinaryDecoder?.decode) {
          data = BinaryDecoder.decode(buffer);
        }
        
        if (!data) {
          throw new Error('Binary decode failed');
        }
        _tickLoad(loadTicket, 0.86, 'Baue Nutzdaten auf…');
        
        // Add metadata
        data.success = true;
        data.server_ts_ms = data.server_ts_ms || Date.now();
        _traceSystemQuery('binary-response', {
          endpoint,
          contentType,
          byteLength: Number(buffer.byteLength || 0),
          decoderVersion,
          meta: _summarizeSystemPayloadMeta(data),
        });
        
        if (cacheMode !== 'no-store' && ttlMs > 0) {
          _getCache.set(endpoint, {
            data: _clone(data),
            expiresAt: Date.now() + ttlMs,
          });
        }
        
        return data;
      } else {
        // Fallback to JSON
        _tickLoad(loadTicket, 0.7, 'Verarbeite JSON-Fallback…');
        const data = await r.json();
        _traceSystemQuery('json-response-via-getBinary', {
          endpoint,
          contentType,
          meta: _summarizeSystemPayloadMeta(data),
        });
        if (cacheMode !== 'no-store' && ttlMs > 0 && data && data.success !== false) {
          _getCache.set(endpoint, {
            data: _clone(data),
            expiresAt: Date.now() + ttlMs,
          });
        }
        return data;
      }
    } catch (err) {
      if (_isAbortError(err)) throw err;
      if (cacheMode === 'stale-if-error') {
        const stale = _getCache.get(endpoint);
        if (stale?.data) {
          console.warn('[GQ][API] Verwende stale Cache (binary) wegen Fehler', { endpoint, error: err });
          return _clone(stale.data);
        }
      }
      _reportLoadError(endpoint, err, 'GET_BINARY');
      throw err;
    } finally {
      _endLoad(loadTicket);
    }
  }

  return {
    // Cache control
    get: (endpoint, options = {}) => get(endpoint, options),
    post: (endpoint, body = {}) => post(endpoint, body),
    getBinary: (endpoint, options = {}) => getBinary(endpoint, options),
    invalidateCache: (patterns) => _invalidateGetCache(patterns),
    cancelPendingRequests: (reason = 'View switch') =>
      _cancelPendingRequests(reason, (task) => String(task.method || 'GET').toUpperCase() !== 'POST'),
    getQueueStats: () => ({
      queued: _requestQueue.length,
      inFlight: _activeNetworkRequests,
      concurrency: _maxConcurrentRequests,
      pendingLoads: _activeLoads,
    }),
    setConcurrencyLimit: (limit) => {
      const n = Math.max(1, Math.min(8, Number(limit || _maxConcurrentRequests)));
      _maxConcurrentRequests = n;
      _pumpRequestQueue();
      return _maxConcurrentRequests;
    },
    networkHealth: (force = false) => _probeConnectivity(!!force),
    adaptGalaxyBootstrap: (payload, fallback = {}) => adaptGalaxyBootstrapPayload(payload, fallback),
    adaptGalaxyStars: (payload, fallback = {}) => adaptGalaxyStarsPayload(payload, fallback),
    classifyRenderError: (input) => classifyRenderLoadError(input),

    // Auth
    me:     () => get('api/auth.php?action=me'),
    logout: () => post('api/auth.php?action=logout', {}),
    audioTracks: () => get('api/audio.php?action=list'),

    // Game overview
    overview:    ()    => get('api/game.php?action=overview', { priority: 'high' }),
    health:      ()    => get('api/game.php?action=health'),
    resources:   (cid) => get(`api/game.php?action=resources&colony_id=${cid}`),
    planetIntel: (g, s, p) => get(`api/game.php?action=planet_intel&galaxy=${g}&system=${s}&position=${p}`),
    leaderboard: ()    => get('api/game.php?action=leaderboard'),
    renameColony:  (cid, name) => post('api/game.php?action=rename_colony',   { colony_id: cid, name }),
    setColonyType: (cid, type) => post('api/game.php?action=set_colony_type', { colony_id: cid, colony_type: type }),
    setFtlDrive:   (driveType) => post('api/game.php?action=set_ftl_drive',   { ftl_drive_type: driveType }),
    resetFtlCooldown: ()       => post('api/fleet.php?action=reset_ftl_cooldown', {}),

    // Buildings
    buildings:     (cid)        => get(`api/buildings.php?action=list&colony_id=${cid}`),
    upgrade:       (cid, type)  => post('api/buildings.php?action=upgrade', { colony_id: cid, type }),
    finishBuilding:(cid)        => post('api/buildings.php?action=finish',  { colony_id: cid }),

    // Research
    research:      (cid)        => get(`api/research.php?action=list&colony_id=${cid}`),
    doResearch:    (cid, type)  => post('api/research.php?action=research', { colony_id: cid, type }),
    finishResearch:()           => post('api/research.php?action=finish', {}),

    // Shipyard
    ships:    (cid)                        => get(`api/shipyard.php?action=list&colony_id=${cid}`),
    shipyardHulls: (cid)                  => get(`api/shipyard.php?action=list_hulls&colony_id=${cid}`),
    shipyardModules: (cid, hullCode, slotLayoutCode = 'default') => get(`api/shipyard.php?action=list_modules&colony_id=${cid}&hull_code=${encodeURIComponent(hullCode)}&slot_layout_code=${encodeURIComponent(slotLayoutCode)}`),
    createBlueprint: (payload)            => post('api/shipyard.php?action=create_blueprint', payload),
    deleteBlueprint: (blueprintId)        => post('api/shipyard.php?action=delete_blueprint', { blueprint_id: blueprintId }),
    buildShip:(cid, type, count, extra={}) => post('api/shipyard.php?action=build', Object.assign({ colony_id: cid, type, count }, extra)),
    shipyardVessels: (cid)                => get(`api/shipyard.php?action=list_vessels&colony_id=${cid}`),
    decommissionVessel: (vesselId)        => post('api/shipyard.php?action=decommission_vessel', { vessel_id: vesselId }),
    repairVessel: (vesselId)              => post('api/shipyard.php?action=repair_vessel',       { vessel_id: vesselId }),

    // Fleet
    fleets:     ()        => get('api/fleet.php?action=list'),
    sendFleet:  (payload) => post('api/fleet.php?action=send', payload),
    wormholes: (originColonyId) => get(`api/fleet.php?action=wormholes&origin_colony_id=${originColonyId}`),
    ftlStatus:  ()        => get('api/fleet.php?action=ftl_status'),
    ftlMap:     ()        => get('api/fleet.php?action=ftl_map'),
    recallFleet:(id)      => post('api/fleet.php?action=recall', { fleet_id: id }),
    renameFleet:(id, label) => post('api/fleet.php?action=rename_fleet', { fleet_id: id, label }),
    simulateBattle: (payload) => post('api/fleet.php?action=simulate_battle', payload),
    matchupScan: (payload) => post('api/fleet.php?action=matchup_scan', payload),

    // Galaxy
    galaxy: async (g, s) => {
      const gf = Math.max(1, Number(g || 1));
      const sf = Math.max(1, Number(s || 1));
      const binEndpoint = `api/v1/galaxy.php?galaxy=${gf}&system=${sf}&format=bin`;
      const jsonEndpoint = `api/v1/galaxy.php?galaxy=${gf}&system=${sf}`;
      _traceSystemQuery('request', {
        galaxy: gf,
        system: sf,
        preferBinary: !!_preferBinaryGalaxySystem,
        binEndpoint,
        jsonEndpoint,
      });
      if (!_preferBinaryGalaxySystem) {
        const data = await get(jsonEndpoint, {
          priority: 'high',
          retryCount: 2,
          cacheMode: 'stale-if-error',
        });
        _traceSystemQuery('json-response', {
          endpoint: jsonEndpoint,
          meta: _summarizeSystemPayloadMeta(data),
        });
        return data;
      }
      try {
        const data = await getBinary(binEndpoint, {
          priority: 'high',
          retryCount: 1,
          timeoutMs: 12000,
          cacheMode: 'stale-if-error',
        });
        _traceSystemQuery('binary-success', {
          endpoint: binEndpoint,
          meta: _summarizeSystemPayloadMeta(data),
        });
        return data;
      } catch (err) {
        _log('warn', 'Galaxy BIN request failed, fallback to JSON', {
          endpoint: binEndpoint,
          error: _describeError(err, binEndpoint, 'galaxy-bin-fallback'),
        });
        const data = await get(jsonEndpoint, {
          priority: 'high',
          retryCount: 1,
          cacheMode: 'stale-if-error',
        });
        _traceSystemQuery('json-fallback-response', {
          endpoint: jsonEndpoint,
          meta: _summarizeSystemPayloadMeta(data),
        });
        return data;
      }
    },
    galaxyStars: (g, from = 1, to = 25000, maxPoints = 1500, opts = {}) => {
      const gf = Math.max(1, Number(g || 1));
      const rf = Math.max(1, Number(from || 1));
      const rt = Math.max(rf, Number(to || rf));
      const mp = Math.max(100, Math.min(50000, Number(maxPoints || 1500)));
      const allowedStreamPriorities = new Set(['critical', 'high', 'normal', 'low', 'background']);
      const streamPriorityRaw = String(opts.streamPriority || opts.priority || 'normal').toLowerCase();
      const streamPriority = allowedStreamPriorities.has(streamPriorityRaw) ? streamPriorityRaw : 'normal';
      const requestPriorityRaw = String(opts.requestPriority || (streamPriority === 'background' ? 'low' : 'critical')).toLowerCase();
      const requestPriority = ['critical', 'high', 'normal', 'low'].includes(requestPriorityRaw) ? requestPriorityRaw : 'critical';
      const prefetch = !!opts.prefetch;
      const chunkHint = Math.max(100, Math.min(5000, Number(opts.chunkHint || mp)));
      const clusterPresetRaw = String(opts.clusterPreset || 'auto').toLowerCase();
      const clusterPreset = ['auto', 'low', 'medium', 'high', 'ultra'].includes(clusterPresetRaw)
        ? clusterPresetRaw
        : 'auto';
      const includeClusterLod = !!opts.includeClusterLod;
      const endpoint = `api/v1/galaxy.php?action=stars&galaxy=${gf}&from=${rf}&to=${rt}&max_points=${mp}`
        + `&priority=${encodeURIComponent(streamPriority)}`
        + `&prefetch=${prefetch ? 1 : 0}`
        + `&chunk_hint=${chunkHint}`
        + `&cluster_preset=${encodeURIComponent(clusterPreset)}`
        + `&cluster_lod=${includeClusterLod ? 1 : 0}`;
      return get(endpoint, { priority: requestPriority });
    },
    galaxyBootstrap: (g, from = 1, to = null, maxPoints = 1500) => {
      const gf = Math.max(1, Number(g || 1));
      const rf = Math.max(1, Number(from || 1));
      const hasTo = Number.isFinite(Number(to));
      const rt = hasTo ? `&to=${Math.max(rf, Number(to))}` : '';
      const mp = Math.max(100, Math.min(50000, Number(maxPoints || 1500)));
      return get(`api/v1/galaxy.php?action=bootstrap&galaxy=${gf}&from=${rf}${rt}&max_points=${mp}`, { priority: 'high' });
    },
    galaxyAssetMeta: (g, scope = 'render') => {
      const gf = Math.max(1, Number(g || 1));
      const scopeRaw = String(scope || 'render').toLowerCase();
      const safeScope = ['render', 'planet_textures', 'clusters', 'ships'].includes(scopeRaw)
        ? scopeRaw
        : 'render';
      return get(`api/v1/galaxy.php?action=asset_meta&galaxy=${gf}&scope=${encodeURIComponent(safeScope)}`, { priority: 'high' });
    },
    galaxyMeta: (g) => {
      const gf = Math.max(1, Number(g || 1));
      return get(`api/v1/galaxy.php?action=galaxy_meta&galaxy=${gf}`, { priority: 'high' });
    },
    galaxySearch: (g, q, limit = 18) =>
      get(`api/v1/galaxy.php?action=search&galaxy=${g}&q=${encodeURIComponent(String(q || ''))}&limit=${Math.max(1, Number(limit || 18))}`),
    perfTelemetry: (payload = {}) =>
      post('api/perf_telemetry.php?action=ingest', payload),
    perfTelemetryRecent: ({ limit = 50, source = '', userId = 0 } = {}) => {
      const lim = Math.max(1, Math.min(300, Number(limit || 50)));
      const src = String(source || '').trim().toLowerCase();
      const uid = Math.max(0, Number(userId || 0));
      const srcPart = src ? `&source=${encodeURIComponent(src)}` : '';
      const uidPart = uid > 0 ? `&user_id=${uid}` : '';
      return get(`api/perf_telemetry.php?action=recent&limit=${lim}${srcPart}${uidPart}`, { priority: 'low' });
    },
    perfTelemetrySummary: ({ minutes = 60, source = '', userId = 0 } = {}) => {
      const mins = Math.max(5, Math.min(24 * 60, Number(minutes || 60)));
      const src = String(source || '').trim().toLowerCase();
      const uid = Math.max(0, Number(userId || 0));
      const srcPart = src ? `&source=${encodeURIComponent(src)}` : '';
      const uidPart = uid > 0 ? `&user_id=${uid}` : '';
      return get(`api/perf_telemetry.php?action=summary&minutes=${mins}${srcPart}${uidPart}`, { priority: 'low' });
    },

    // Achievements / quests
    achievements:    ()    => get('api/achievements.php?action=list'),
    claimAchievement:(id)  => post('api/achievements.php?action=claim', { achievement_id: id }),

    // PvP
    togglePvp: () => post('api/game.php?action=pvp_toggle', {}),

    // Leaders
    leaders:             ()            => get('api/leaders.php?action=list'),
    hireLeader:          (name, role)  => post('api/leaders.php?action=hire',           { name, role }),
    assignLeader:        (lid, cid, fid) => post('api/leaders.php?action=assign',       { leader_id: lid, colony_id: cid ?? undefined, fleet_id: fid ?? undefined }),
    setAutonomy:         (lid, autonomy) => post('api/leaders.php?action=autonomy',     { leader_id: lid, autonomy }),
    dismissLeader:       (lid)         => post('api/leaders.php?action=dismiss',        { leader_id: lid }),
    aiTick:              ()            => post('api/leaders.php?action=ai_tick',        {}),
    leaderMarketplace:   ()            => get('api/leaders.php?action=marketplace'),
    hireCandidate:       (cid)         => post('api/leaders.php?action=hire_candidate', { candidate_id: cid }),
    advisorHints:        ()            => get('api/leaders.php?action=advisor_hints'),
    advisorTick:         ()            => post('api/leaders.php?action=advisor_tick',   {}),
    dismissHint:         (hid)         => post('api/leaders.php?action=dismiss_hint',   { hint_id: hid }),

    // Factions & diplomacy
    factions:        ()           => get('api/factions.php?action=list'),
    tradeOffers:     (fid)        => get(`api/factions.php?action=trade_offers&faction_id=${fid}`),
    acceptTrade:     (oid, cid)   => post('api/factions.php?action=accept_trade',  { offer_id: oid, colony_id: cid }),
    factionQuests:   (fid)        => get(`api/factions.php?action=quests&faction_id=${fid}`),
    startFactionQuest:(fqid)      => post('api/factions.php?action=start_quest',   { faction_quest_id: fqid }),
    checkFactionQuests:()         => post('api/factions.php?action=check_quests',  {}),
    claimFactionQuest:(uqid)      => post('api/factions.php?action=claim_quest',   { user_quest_id: uqid }),
    factionDialogue: ({ faction_id, history = [], player_input = '' } = {}) =>
      post('api/factions.php?action=dialogue', { faction_id, history, player_input }),

    // Faction agreements (Victoria 3-style treaty system)
    factionAgreementsList:   (faction_id) =>
      get(faction_id ? `api/diplomacy.php?action=list&faction_id=${Number(faction_id)}` : 'api/diplomacy.php?action=list'),
    factionAgreementsTypes:  ()           => get('api/diplomacy.php?action=types'),
    factionAgreementsPropose:(data)       => post('api/diplomacy.php?action=propose', data),
    factionAgreementsRespond:(id)         => post('api/diplomacy.php?action=respond', { agreement_id: Number(id) }),
    factionAgreementsCancel: (id)         => post('api/diplomacy.php?action=cancel',  { agreement_id: Number(id) }),

    // Diplomatic Plays – 4-phase escalation system (Sprint 3.2)
    diplomaticPlaysList:       (faction_id) =>
      get(faction_id ? `api/diplomatic_plays.php?action=list&faction_id=${Number(faction_id)}` : 'api/diplomatic_plays.php?action=list'),
    diplomaticPlaysTrustThreat:(faction_id) =>
      get(`api/diplomatic_plays.php?action=trust_threat&faction_id=${Number(faction_id)}`),
    diplomaticPlaysPropose:    (data)       => post('api/diplomatic_plays.php?action=propose_play',  data),
    diplomaticPlaysCounter:    (data)       => post('api/diplomatic_plays.php?action=counter_play',  data),
    diplomaticPlaysMobilize:   (data)       => post('api/diplomatic_plays.php?action=mobilize',      data),
    diplomaticPlaysResolve:    (data)       => post('api/diplomatic_plays.php?action=resolve',       data),

    // NPC / PvE controller
    npcControllerStatus: () => get('api/npc_controller.php?action=status'),
    npcControllerSummary: ({ hours = 24, faction_id = 0 } = {}) =>
      get(`api/npc_controller.php?action=summary&hours=${Math.max(1, Math.min(168, Number(hours || 24)))}&faction_id=${Math.max(0, Number(faction_id || 0))}`),
    npcControllerDecisions: ({ limit = 20, faction_id = 0 } = {}) =>
      get(`api/npc_controller.php?action=decisions&limit=${Math.max(1, Number(limit || 20))}&faction_id=${Math.max(0, Number(faction_id || 0))}`),
    npcControllerRunOnce: () => post('api/npc_controller.php?action=run_once', {}),

    // Empire politics model (species/government/civics)
    politicsCatalog: () => get('api/politics.php?action=catalog'),
    politicsPresets: () => get('api/politics.php?action=presets'),
    politicsStatus: () => get('api/politics.php?action=status', { priority: 'high' }),
    configurePolitics: ({ primary_species_key, government_key, civic_keys } = {}) =>
      post('api/politics.php?action=configure', {
        primary_species_key,
        government_key,
        civic_keys,
      }),
    applyPoliticsPreset: (preset_key) =>
      post('api/politics.php?action=apply_preset', { preset_key }),

    // Messages
    inbox:    ()               => get('api/messages.php?action=inbox'),
    messageUsers: (q = '')     => get(`api/messages.php?action=users&q=${encodeURIComponent(String(q || ''))}`),
    readMsg:  (id)             => get(`api/messages.php?action=read&id=${id}`),
    sendMsg:  (to, sub, body)  => post('api/messages.php?action=send', { to_username: to, subject: sub, body }),
    deleteMsg:(id)             => post('api/messages.php?action=delete', { id }),

    // Reports
    spyReports: ()             => get('api/reports.php?action=spy_reports'),
    battleReports: ()          => get('api/reports.php?action=battle_reports'),
    battleReportDetail: (id)   => get(`api/reports.php?action=battle_detail&id=${id}`),

    // Trade Routes
    tradeRoutes: ()            => get('api/trade.php?action=list'),
    createTradeRoute: (data)   => post('api/trade.php?action=create', data),
    deleteTradeRoute: (id)     => post('api/trade.php?action=delete', { route_id: id }),
    toggleTradeRoute: (id)     => post('api/trade.php?action=toggle', { route_id: id }),

    // NPC Traders Dashboard
    tradersStatus: ()          => get('api/traders_events.php?event=status'),
    tradersEvent: (eventName)  => post(`api/traders_events.php?event=${encodeURIComponent(String(eventName || 'status'))}`, {}),
    tradersList: ()            => get('api/traders.php?action=list_traders'),
    tradersRoutes: (status = '') => get(`api/traders.php?action=list_routes${status ? `&status=${encodeURIComponent(String(status))}` : ''}`),
    traderOpportunities: (threshold = 15) =>
      get(`api/traders_dashboard.php?action=opportunity_alerts&threshold=${Math.max(0, Number(threshold || 15))}`),

    // Pirates / raids
    piratesStatus: ()          => get('api/pirates.php?action=status'),
    piratesRecentRaids: (limit = 20) => get(`api/pirates.php?action=recent_raids&limit=${Math.max(1, Number(limit || 20))}`),
    piratesForecast: ()        => get('api/pirates.php?action=forecast'),
    piratesRunTick: ()         => post('api/pirates.php?action=run_tick', {}),
    piratesContracts: ()       => get('api/pirates.php?action=list_contracts'),
    piratesProposeContract: ({ faction_id, contract_type = 'tributary', credit_offer = 0, duration_days = 30 } = {}) =>
      post('api/pirates.php?action=propose_contract', {
        faction_id: Math.max(0, Number(faction_id || 0)),
        contract_type: String(contract_type || 'tributary'),
        credit_offer: Math.max(0, Number(credit_offer || 0)),
        duration_days: Math.max(1, Math.min(90, Number(duration_days || 30))),
      }),

    // Economy management (policy / tax / subsidies / overview)
    economyOverview: (colony_id = null) => {
      const q = colony_id != null ? `&colony_id=${encodeURIComponent(Number(colony_id))}` : '';
      return get(`api/economy.php?action=get_overview${q}`);
    },
    economyProduction: (colony_id) =>
      get(`api/economy.php?action=get_production&colony_id=${encodeURIComponent(Number(colony_id))}`),
    economyPolicy: ()          => get('api/economy.php?action=get_policy'),
    setEconomyPolicy: (policy) => post('api/economy.php?action=set_policy', { policy }),
    setEconomyTax: (type, rate) => post('api/economy.php?action=set_tax', { type, rate }),
    setEconomySubsidy: (sector, enabled) => post('api/economy.php?action=set_subsidy', { sector, enabled }),
    setEconomyProductionMethod: (colony_id, building_type, method) =>
      post('api/economy.php?action=set_production_method', { colony_id: Number(colony_id), building_type, method }),
    economyPopClasses: (colony_id = null) => {
      const q = colony_id != null ? `&colony_id=${encodeURIComponent(Number(colony_id))}` : '';
      return get(`api/economy.php?action=get_pop_classes${q}`);
    },
    marketRegionPrices: (good_type = null) => {
      const q = good_type ? `&good_type=${encodeURIComponent(String(good_type))}` : '';
      return get(`api/market.php?action=get_region_prices${q}`);
    economyPopStatus: (colony_id = null) => {
      const q = colony_id != null ? `&colony_id=${encodeURIComponent(Number(colony_id))}` : '';
      return get(`api/economy.php?action=get_pop_status${q}`);
    },
    setPopPolicy: ({ colony_id, wage_adjustment = 1.0, culture_spending = 0, safety_budget = 0 } = {}) => {
      const cid = Number(colony_id);
      if (!cid || cid < 1) return Promise.reject(new Error('setPopPolicy: colony_id is required'));
      return post('api/economy.php?action=set_pop_policy', {
        colony_id: cid,
        wage_adjustment: Math.min(2.0, Math.max(0.5, Number(wage_adjustment))),
        culture_spending: Math.min(1000, Math.max(0, Number(culture_spending))),
        safety_budget: Math.min(100, Math.max(0, Number(safety_budget))),
      });
    },

    // Strategic wars
    wars: () => get('api/war.php?action=list'),
    warStatus: (warId) =>
      get(`api/war.php?action=get_status&war_id=${encodeURIComponent(Math.max(0, Number(warId || 0)))}`),
    warGoalProgress: (warId) =>
      get(`api/war.php?action=get_goal_progress&war_id=${encodeURIComponent(Math.max(0, Number(warId || 0)))}`),
    warIntel: (warId) =>
      get(`api/war.php?action=get_intel&war_id=${encodeURIComponent(Math.max(0, Number(warId || 0)))}`),
    warAllianceList: () => get('api/war.php?action=alliance_wars'),
    declareStrategicWar: ({ target_user_id, war_goals = [], casus_belli = '' } = {}) =>
      post('api/war.php?action=declare', {
        target_user_id: Math.max(0, Number(target_user_id || 0)),
        war_goals: Array.isArray(war_goals) ? war_goals : [],
        casus_belli: String(casus_belli || ''),
      }),
    offerPeace: ({ war_id, terms = [] } = {}) =>
      post('api/war.php?action=offer_peace', {
        war_id: Math.max(0, Number(war_id || 0)),
        terms: Array.isArray(terms) ? terms : [],
      }),
    respondPeaceOffer: ({ offer_id, accept } = {}) =>
      post('api/war.php?action=respond_peace', {
        offer_id: Math.max(0, Number(offer_id || 0)),
        accept: !!accept,
      }),

  // Trade Proposals (player-to-player)
  listTradeSuggestions: ({ limit = 10, interval_hours = 24 } = {}) =>
    get(`api/trade.php?action=list_suggestions&limit=${encodeURIComponent(Math.max(1, Number(limit || 10)))}&interval_hours=${encodeURIComponent(Math.max(1, Number(interval_hours || 24)))}`),
  applyTradeSuggestion: (data) => post('api/trade.php?action=apply_suggestion', data),
  goodsFlowAnalysis: ({ limit = 10, interval_hours = 24 } = {}) =>
    get(`api/trade.php?action=goods_flow&limit=${encodeURIComponent(Math.max(1, Number(limit || 10)))}&interval_hours=${encodeURIComponent(Math.max(1, Number(interval_hours || 24)))}`),
  listTradeProposals: ()       => get('api/trade.php?action=list_proposals'),
  proposeTrade: (data)         => post('api/trade.php?action=propose', data),
  acceptTrade: (id)            => post('api/trade.php?action=accept',  { proposal_id: id }),
  rejectTrade: (id)            => post('api/trade.php?action=reject',  { proposal_id: id }),

  // Colonization — Empire Sprawl, Sectors, Governors, Edicts
  colonizationSprawl: () => get('api/colonization.php?action=sprawl_status'),
  colonizationSectors: () => get('api/colonization.php?action=list_sectors'),
  colonizationSectorDetail: (id) => get(`api/colonization.php?action=sector_detail&id=${encodeURIComponent(Math.max(0, Number(id || 0)))}`),
  colonizationCreateSector: ({ name } = {}) => post('api/colonization.php?action=create_sector', { name: String(name || '') }),
  colonizationUpdateSector: ({ sector_id, name, tax_rate, autonomy_level } = {}) =>
    post('api/colonization.php?action=update_sector', { sector_id: Math.max(0, Number(sector_id || 0)), name, tax_rate, autonomy_level }),
  colonizationDeleteSector: (sectorId) => post('api/colonization.php?action=delete_sector', { sector_id: Math.max(0, Number(sectorId || 0)) }),
  colonizationAssignSystem: ({ sector_id, star_system_id } = {}) =>
    post('api/colonization.php?action=assign_system', { sector_id: Math.max(0, Number(sector_id || 0)), star_system_id: Math.max(0, Number(star_system_id || 0)) }),
  colonizationRemoveSystem: ({ sector_id, star_system_id } = {}) =>
    post('api/colonization.php?action=remove_system', { sector_id: Math.max(0, Number(sector_id || 0)), star_system_id: Math.max(0, Number(star_system_id || 0)) }),
  colonizationGovernors: () => get('api/colonization.php?action=list_governors'),
  colonizationAppointGovernor: ({ governor_id, sector_id } = {}) =>
    post('api/colonization.php?action=appoint_governor', { governor_id: Math.max(0, Number(governor_id || 0)), sector_id: Math.max(0, Number(sector_id || 0)) }),
  colonizationDismissGovernor: (governorId) => post('api/colonization.php?action=dismiss_governor', { governor_id: Math.max(0, Number(governorId || 0)) }),
  colonizationEdicts: () => get('api/colonization.php?action=list_edicts'),
  colonizationActivateEdict: (edictType) => post('api/colonization.php?action=activate_edict', { edict_type: String(edictType || '') }),
  colonizationDeactivateEdict: (edictType) => post('api/colonization.php?action=deactivate_edict', { edict_type: String(edictType || '') }),

  // Colony Buildings
  colonyBuildingsLayout: (colonyId) => get(`api/colony_buildings.php?action=get_layout&colony_id=${encodeURIComponent(Math.max(0, Number(colonyId || 0)))}`),
  colonyBuildingsPlace: ({ colony_id, building_type, slot_x, slot_y } = {}) =>
    post('api/colony_buildings.php?action=place_building', { colony_id: Math.max(0, Number(colony_id || 0)), building_type: String(building_type || ''), slot_x: Number(slot_x ?? 0), slot_y: Number(slot_y ?? 0) }),
  colonyBuildingsRemove: ({ colony_id, slot_x, slot_y } = {}) =>
    post('api/colony_buildings.php?action=remove_building', { colony_id: Math.max(0, Number(colony_id || 0)), slot_x: Number(slot_x ?? 0), slot_y: Number(slot_y ?? 0) }),
  colonyBuildingsUpgrade: ({ colony_id, slot_x, slot_y, completes_in_seconds } = {}) =>
    post('api/colony_buildings.php?action=upgrade_slot', { colony_id: Math.max(0, Number(colony_id || 0)), slot_x: Number(slot_x ?? 0), slot_y: Number(slot_y ?? 0), completes_in_seconds: completes_in_seconds != null ? Number(completes_in_seconds) : undefined }),
  colonyBuildingsSlotInfo: (colonyId, slotX, slotY) => get(`api/colony_buildings.php?action=get_slot_info&colony_id=${encodeURIComponent(Math.max(0, Number(colonyId || 0)))}&slot_x=${encodeURIComponent(Number(slotX ?? 0))}&slot_y=${encodeURIComponent(Number(slotY ?? 0))}`),
  cancelTrade: (id)            => post('api/trade.php?action=cancel',  { proposal_id: id }),

    // Alliances
    alliances: ()              => get('api/alliances.php?action=list'),
    allianceDetails: (id)      => get(`api/alliances.php?action=details&alliance_id=${id}`),
    createAlliance: (data)     => post('api/alliances.php?action=create', data),
    joinAlliance: (id)         => post('api/alliances.php?action=join', { alliance_id: id }),
    leaveAlliance: (id)        => post('api/alliances.php?action=leave', { alliance_id: id }),
    disbandAlliance: (id)      => post('api/alliances.php?action=disband', { alliance_id: id }),
    removeAllianceMember: (data) => post('api/alliances.php?action=remove_member', data),
    setAllianceMemberRole: (data) => post('api/alliances.php?action=set_role', data),
    contributeAlliance: (data) => post('api/alliances.php?action=contribute', data),
    withdrawAlliance: (data)   => post('api/alliances.php?action=withdraw', data),
    allianceRelations: (id)    => get(`api/alliances.php?action=relations&alliance_id=${id}`),
    allianceWarMap: (galaxy, from, to) => get(`api/alliances.php?action=war_map&galaxy=${galaxy}&from=${from}&to=${to}`),
    declareWar: (data)         => post('api/alliances.php?action=declare_war', data),
    declareNap: (data)         => post('api/alliances.php?action=declare_nap', data),
    declareAllianceDiplomacy: (data) => post('api/alliances.php?action=declare_alliance', data),
    revokeRelation: (data)     => post('api/alliances.php?action=revoke_relation', data),
    setAllianceRelation: (data) => post('api/alliances.php?action=set_relation', data),
    allianceMessages: (id)     => get(`api/alliances.php?action=get_messages&alliance_id=${id}`),
    sendAllianceMessage: (id, msg) => post('api/alliances.php?action=send_message', { alliance_id: id, message: msg }),

    // Alliance Wars — N-vs-M multi-alliance wars
    allianceWars: () => get('api/alliance_wars.php?action=list'),
    allianceWarStatus: (warId) =>
      get(`api/alliance_wars.php?action=get_status&war_id=${encodeURIComponent(Math.max(0, Number(warId || 0)))}`),
    declareAllianceWar: ({ name = '', side_a = [], side_b = [], casus_belli = '' } = {}) =>
      post('api/alliance_wars.php?action=declare', {
        name: String(name || ''),
        side_a: Array.isArray(side_a) ? side_a.map(Number) : [],
        side_b: Array.isArray(side_b) ? side_b.map(Number) : [],
        casus_belli: String(casus_belli || ''),
      }),
    offerAlliancePeace: ({ war_id, from_alliance_id, terms = [] } = {}) =>
      post('api/alliance_wars.php?action=offer_peace', {
        war_id: Math.max(0, Number(war_id || 0)),
        from_alliance_id: Math.max(0, Number(from_alliance_id || 0)),
        terms: Array.isArray(terms) ? terms : [],
      }),
    respondAlliancePeaceOffer: ({ offer_id, alliance_id, accept } = {}) =>
      post('api/alliance_wars.php?action=respond_peace', {
        offer_id: Math.max(0, Number(offer_id || 0)),
        alliance_id: Math.max(0, Number(alliance_id || 0)),
        accept: !!accept,
      }),

    // Local LLM (Ollama)
    llmStatus: () => get('api/ollama.php?action=status', { priority: 'high' }),
    llmChat: ({
      prompt,
      system,
      messages,
      model,
      temperature,
      options,
      timeout,
    } = {}) => post('api/ollama.php?action=chat', {
      prompt,
      system,
      messages,
      model,
      temperature,
      options,
      timeout,
    }),
    llmGenerate: ({
      prompt,
      model,
      temperature,
      options,
      timeout,
    } = {}) => post('api/ollama.php?action=generate', {
      prompt,
      model,
      temperature,
      options,
      timeout,
    }),
    llmProfiles: () => get('api/llm.php?action=catalog', { priority: 'high' }),
    llmCompose: ({ profile_key, input_vars } = {}) =>
      post('api/llm.php?action=compose', { profile_key, input_vars }),
    llmChatProfile: ({
      profile_key,
      input_vars,
      model,
      temperature,
      options,
      timeout,
    } = {}) => post('api/llm.php?action=chat_profile', {
      profile_key,
      input_vars,
      model,
      temperature,
      options,
      timeout,
    }),
    chatNpc: ({
      faction_code,
      npc_name,
      player_message,
      session_id,
      model,
      temperature,
      options,
      timeout,
    } = {}) => post('api/llm.php?action=chat_npc', {
      faction_code,
      npc_name,
      player_message,
      session_id,
      model,
      temperature,
      options,
      timeout,
    }),
    closeNpcSession: ({
      session_id,
      model,
    } = {}) => post('api/llm.php?action=close_npc_session', {
      session_id,
      model,
    }),

    // Situations
    situations: (status = 'active', limit = 50) =>
      get(`api/situations.php?action=list&status=${encodeURIComponent(String(status || 'active'))}&limit=${Math.max(1, Number(limit || 50))}`),
    setSituationApproach: (situation_id, approach_key) =>
      post('api/situations.php?action=set_approach', { situation_id, approach_key }),
    tickSituations: (situation_id) =>
      post('api/situations.php?action=tick', situation_id ? { situation_id } : {}),

    // Empire Categories — scores & espionage
    getEmpireScores: () => get('api/empire.php?action=get_scores'),
    getEmpireScoreBreakdown: () => get('api/empire.php?action=get_score_breakdown'),
    getEspionageStatus: () => get('api/empire.php?action=get_espionage_status'),
    hireEspionageAgent: (data = {}) => post('api/espionage.php?action=hire_agent', data),
    assignEspionageMission: (data = {}) => post('api/espionage.php?action=assign_mission', data),
    getActiveEspionageMissions: () => get('api/espionage.php?action=get_active_missions'),
    getEspionageMissionResult: (missionId) =>
      get(`api/espionage.php?action=mission_result&mission_id=${encodeURIComponent(Math.max(0, Number(missionId || 0)))}`),
  };
})();

if (typeof window !== 'undefined') {
  window.API = API;
  window.GQRenderDataAdapter = {
    renderSchemaVersion: 1,
    adaptGalaxyBootstrap: (payload, fallback = {}) => API.adaptGalaxyBootstrap(payload, fallback),
    adaptGalaxyStars: (payload, fallback = {}) => API.adaptGalaxyStars(payload, fallback),
    classifyRenderError: (input) => API.classifyRenderError(input),
  };
  window.GQ_LLM = {
    status: () => API.llmStatus(),
    chat: (payload) => API.llmChat(payload),
    generate: (payload) => API.llmGenerate(payload),
    profiles: () => API.llmProfiles(),
    compose: (payload) => API.llmCompose(payload),
    chatProfile: (payload) => API.llmChatProfile(payload),
    chatNpc: (payload) => API.chatNpc(payload),
    closeNpcSession: (payload) => API.closeNpcSession(payload),
  };
}
