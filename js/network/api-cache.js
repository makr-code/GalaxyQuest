/**
 * API Cache Management
 * Handles GET response caching with TTL-based invalidation.
 */
const APICache = (() => {
  const _getCache = new Map();

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
    /^api\/war\.php\?/i,
    /^api\/galaxy\.php\?/i,
  ];

  function _log(level, message, data = null) {
    const lvl = String(level || 'info').toLowerCase();
    const sink = window.GQLog && typeof window.GQLog[lvl] === 'function'
      ? window.GQLog[lvl].bind(window.GQLog)
      : null;
    if (sink) {
      if (data == null) sink('[api-cache]', message);
      else sink('[api-cache]', message, data);
      return;
    }
    const consoleMethod = (lvl === 'error' || lvl === 'warn' || lvl === 'info') ? lvl : 'log';
    if (data == null) console[consoleMethod]('[GQ][API][cache]', message);
    else console[consoleMethod]('[GQ][API][cache]', message, data);
  }

  function _clone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (err) {
      _log('warn', 'Klonieren fehlgeschlagen, Original zurückgebracht', err);
      return obj;
    }
  }

  function _getCacheTtlMs(endpoint) {
    for (const entry of _defaultGetTtlMs) {
      if (entry.re.test(endpoint)) {
        return entry.ttl;
      }
    }
    return 0;
  }

  function _invalidateGetCache(patterns) {
    if (!patterns) {
      _getCache.clear();
      return;
    }

    const patternArray = Array.isArray(patterns) ? patterns : [patterns];
    for (const pattern of patternArray) {
      const re = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
      for (const key of _getCache.keys()) {
        if (re.test(key)) {
          _getCache.delete(key);
        }
      }
    }
  }

  function _getCachedResponse(endpoint) {
    const entry = _getCache.get(endpoint);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      _getCache.delete(endpoint);
      return null;
    }
    return _clone(entry.data);
  }

  function _setCachedResponse(endpoint, data, ttlMs) {
    if (ttlMs <= 0) return;
    _getCache.set(endpoint, {
      data: _clone(data),
      expiresAt: Date.now() + ttlMs,
    });
  }

  function _getMutationInvalidationPatterns() {
    return _mutationInvalidatePatterns;
  }

  return {
    getCachedResponse: (endpoint) => _getCachedResponse(endpoint),
    setCachedResponse: (endpoint, data, ttlMs) => _setCachedResponse(endpoint, data, ttlMs),
    invalidateCache: (patterns) => _invalidateGetCache(patterns),
    getCacheTtl: (endpoint) => _getCacheTtlMs(endpoint),
    getMutationPatterns: () => _getMutationInvalidationPatterns(),
    clear: () => _getCache.clear(),
    size: () => _getCache.size,
  };
})();

if (typeof window !== 'undefined') {
  window.APICache = APICache;
}
