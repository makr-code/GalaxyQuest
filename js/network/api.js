/**
 * Thin API wrapper for the game frontend.
 * All requests automatically attach the CSRF token from the session.
 * 
 * Refactored to coordinate modular transport, queue, cache, schema, and session layers.
 * This facade maintains backward compatibility with all existing endpoint methods while
 * delegating core responsibilities to focused modules:
 * - Transport: Low-level fetch with retry/timeout/error handling
 * - Queue: Request prioritization and concurrency management
 * - Cache: GET response caching with TTL and mutation-based invalidation
 * - SchemaAdapters: Payload normalization for render pipeline
 * - Session: CSRF token lifecycle and session expiry management
 */

// Fallback implementations when modules are not loaded (for testing or minimal deployments)
if (typeof window !== 'undefined' && !window.APITransport) {
  window.APITransport = {
    fetchTask: async (endpoint, options) => {
      const response = await fetch(endpoint, options);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return response.json();
      }
      return response;
    },
  };
}

if (typeof window !== 'undefined' && !window.APISession) {
  window.APISession = {
    getCsrfToken: () => null,
    setCsrfToken: () => {},
    fetchCsrfToken: async () => {},
    isSessionExpired: () => false,
    resetSessionState: () => {},
    handleAuthError: async () => {},
  };
}

if (typeof window !== 'undefined' && !window.APICache) {
  window.APICache = {
    getCachedResponse: () => null,
    setCachedResponse: () => {},
    invalidateCache: () => {},
    getMutationPatterns: () => ({}),
  };
}

if (typeof window !== 'undefined' && !window.APIQueue) {
  window.APIQueue = {
    queueFetch: async (endpoint, method, body, priority, executeTask) => {
      // Direct execution without queuing
      return executeTask();
    },
    pumpQueue: () => {},
    cancelPendingRequests: () => {},
    getQueueStats: () => ({ pending: 0, active: 0, concurrency: {} }),
    setConcurrencyLimit: () => {},
  };
}

if (typeof window !== 'undefined' && !window.APISchemaAdapters) {
  window.APISchemaAdapters = {
    adaptGalaxyBootstrap: (data) => data,
    adaptGalaxyStars: (data) => data,
    classifyRenderError: () => 'unknown',
  };
}

const API = (() => {
  const API_VERSION = 'v1';

  // Private state: load progress tracking
  let _activeLoads = 0;
  let _sessionExpired = false;

  /**
   * Normalize endpoint to include API version prefix
   */
  const _versionEndpoint = (endpoint) => {
    const raw = String(endpoint || '').trim();
    if (!raw) return raw;
    if (/^(https?:)?\/\//i.test(raw)) return raw; // Keep absolute URLs unchanged

    const normalized = raw.startsWith('/') ? raw.slice(1) : raw;
    if (new RegExp(`^api/${API_VERSION}/`, 'i').test(normalized)) {
      return normalized; // Already versioned
    }
    if (/^api\//i.test(normalized)) {
      // Rewrite api/... to api/v1/...
      return normalized.replace(/^api\//i, `api/${API_VERSION}/`);
    }
    return normalized;
  };

  // Emit load progress event to any listeners (e.g., loading bar UI)
  const _emitLoadProgress = () => {
    if (typeof window !== 'undefined' && window.document) {
      window.dispatchEvent(new CustomEvent('apiLoadProgress', { detail: { activeLoads: _activeLoads } }));
    }
  };

  // Emit error event for UI feedback
  const _emitLoadError = (error) => {
    if (typeof window !== 'undefined' && window.document) {
      window.dispatchEvent(new CustomEvent('apiLoadError', { detail: { error } }));
    }
  };

  // Begin a load operation
  const _beginLoad = () => {
    if (_activeLoads === 0) {
      _emitLoadProgress();
    }
    _activeLoads++;
  };

  // End a load operation
  const _endLoad = () => {
    _activeLoads = Math.max(0, _activeLoads - 1);
    if (_activeLoads === 0) {
      _emitLoadProgress();
    }
  };

  /**
   * Core get() method: cache → queue → transport pipeline
   * Implements cache before queue insertion, then transport execution
   */
  const get = async (endpoint, options = {}) => {
    const versionedEndpoint = _versionEndpoint(endpoint);
    const { cacheMode = 'auto', onProgress = null } = options;

    _beginLoad();
    try {
      // Check cache if not explicitly disabled
      if (cacheMode !== 'no-store' && APICache && typeof APICache.getCachedResponse === 'function') {
        const cached = APICache.getCachedResponse(versionedEndpoint);
        if (cached !== null) {
          _endLoad();
          return cached;
        }
      }

      // Check session expiry
      if (APISession && typeof APISession.isSessionExpired === 'function' && APISession.isSessionExpired()) {
        _sessionExpired = true;
        const error = new Error('Session expired');
        error.sessionExpired = true;
        _emitLoadError(error);
        _endLoad();
        throw error;
      }

      // Ensure CSRF token is available
      if (APISession && typeof APISession.getCsrfToken === 'function') {
        const token = APISession.getCsrfToken();
        if (!token) {
          // Try to fetch a fresh token
          await APISession.fetchCsrfToken();
        }
      }

      // Queue the request with appropriate priority
      const priority = _deriveQueuePriority(versionedEndpoint);
      let response;

      if (APIQueue && typeof APIQueue.queueFetch === 'function') {
        response = await APIQueue.queueFetch(versionedEndpoint, 'GET', null, priority, async (abortSignal) => {
          // Transport layer executor
          return APITransport.fetchTask(versionedEndpoint, {
            method: 'GET',
            signal: abortSignal,
            headers: _buildRequestHeaders(),
          });
        });
      } else {
        // Fallback to direct transport if queue not available
        response = await APITransport.fetchTask(versionedEndpoint, {
          method: 'GET',
          headers: _buildRequestHeaders(),
        });
      }

      // Cache the response if applicable
      if (cacheMode !== 'no-store' && APICache && typeof APICache.setCachedResponse === 'function') {
        APICache.setCachedResponse(versionedEndpoint, response);
      }

      _endLoad();
      return response;
    } catch (error) {
      _emitLoadError(error);
      _endLoad();
      throw error;
    }
  };

  /**
   * Core post() method: session prep → queue → transport → response handling
   * Includes CSRF token fetch on 403 CSRF errors with automatic retry
   */
  const post = async (endpoint, body, options = {}) => {
    const versionedEndpoint = _versionEndpoint(endpoint);
    const { onProgress = null } = options;
    const maxRetries = 2; // Retry on CSRF token mismatch
    let retryCount = 0;

    _beginLoad();
    try {
      const _attemptPost = async () => {
        // Check session expiry before POST
        if (APISession && typeof APISession.isSessionExpired === 'function' && APISession.isSessionExpired()) {
          _sessionExpired = true;
          const error = new Error('Session expired');
          error.sessionExpired = true;
          throw error;
        }

        // Fetch or revalidate CSRF token
        if (APISession && typeof APISession.fetchCsrfToken === 'function') {
          await APISession.fetchCsrfToken();
        }

        // Invalidate related GET caches on mutation
        if (APICache && typeof APICache.invalidateCache === 'function') {
          APICache.invalidateCache(versionedEndpoint);
        }

        // Queue the POST request
        const priority = _deriveQueuePriority(versionedEndpoint);
        let response;

        if (APIQueue && typeof APIQueue.queueFetch === 'function') {
          response = await APIQueue.queueFetch(versionedEndpoint, 'POST', body, priority, async (abortSignal) => {
            return APITransport.fetchTask(versionedEndpoint, {
              method: 'POST',
              body: JSON.stringify(body),
              signal: abortSignal,
              headers: _buildRequestHeaders(),
            });
          });
        } else {
          response = await APITransport.fetchTask(versionedEndpoint, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: _buildRequestHeaders(),
          });
        }

        return response;
      };

      let response;
      try {
        response = await _attemptPost();
      } catch (error) {
        // Retry on CSRF token mismatch (403 errors from auth)
        if (error.status === 403 && retryCount < maxRetries && versionedEndpoint.includes('auth')) {
          retryCount++;
          // Clear session state and retry
          if (APISession && typeof APISession.resetSessionState === 'function') {
            APISession.resetSessionState();
          }
          response = await _attemptPost();
        } else {
          throw error;
        }
      }

      _endLoad();
      return response;
    } catch (error) {
      _emitLoadError(error);
      _endLoad();
      throw error;
    }
  };

  /**
   * Get binary endpoint (e.g., map data). Uses transport directly, no cache/queue.
   */
  const getBinary = async (endpoint, options = {}) => {
    const versionedEndpoint = _versionEndpoint(endpoint);
    _beginLoad();
    try {
      const response = await APITransport.fetchTask(versionedEndpoint, {
        method: 'GET',
        headers: _buildRequestHeaders(),
      });
      _endLoad();
      return response;
    } catch (error) {
      _emitLoadError(error);
      _endLoad();
      throw error;
    }
  };

  /**
   * Build request headers with CSRF token if available
   */
  const _buildRequestHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    if (APISession && typeof APISession.getCsrfToken === 'function') {
      const token = APISession.getCsrfToken();
      if (token) {
        headers['X-CSRF-Token'] = token;
      }
    }
    return headers;
  };

  /**
   * Derive queue priority based on endpoint
   * Used to prioritize auth/overview ahead of stars/binary
   */
  const _deriveQueuePriority = (endpoint) => {
    if (endpoint.includes('auth')) return 'high';
    if (endpoint.includes('overview')) return 'high';
    if (endpoint.includes('health')) return 'high';
    if (endpoint.includes('research') || endpoint.includes('shipyard')) return 'medium';
    if (endpoint.includes('map') || endpoint.includes('chat')) return 'medium';
    return 'low'; // stars, binary, etc.
  };

  // ============================================================================
  // Public endpoint methods: maintain backward compatibility
  // Each is a thin wrapper around get/post
  // ============================================================================

  const overview = async (options = {}) => {
    return get('api/overview.php', options);
  };

  const health = async (options = {}) => {
    return get('api/health.php', { ...options, cacheMode: 'no-store' });
  };

  const resources = async (options = {}) => {
    return get('api/resources.php', options);
  };

  const buildings = async (options = {}) => {
    return get('api/buildings.php', options);
  };

  const research = async (options = {}) => {
    return get('api/research.php', options);
  };

  const shipyard = async (options = {}) => {
    return get('api/shipyard.php', options);
  };

  const fleet = async (options = {}) => {
    return get('api/fleet.php', options);
  };

  const galaxy = async (coords, options = {}) => {
    const endpoint = `api/galaxy.php?x=${coords.x}&y=${coords.y}`;
    const raw = await get(endpoint, options);
    // Adapt galaxy data through schema adapters if available
    if (APISchemaAdapters && typeof APISchemaAdapters.adaptGalaxyStars === 'function') {
      return APISchemaAdapters.adaptGalaxyStars(raw);
    }
    return raw;
  };

  const map = async (x, y, options = {}) => {
    const endpoint = `api/map.php?x=${x}&y=${y}`;
    return getBinary(endpoint, options);
  };

  const war = async (warId, options = {}) => {
    return get(`api/war.php?action=get_status&war_id=${encodeURIComponent(Math.max(0, Number(warId || 0)))}`, options);
  };

  const wars = async (options = {}) => {
    return get('api/war.php?action=list', options);
  };

  const warStatus = async (warId, options = {}) => {
    return get(`api/war.php?action=get_status&war_id=${encodeURIComponent(Math.max(0, Number(warId || 0)))}`, options);
  };

  const declareStrategicWar = async (body, options = {}) => {
    const coercedBody = {
      target_user_id: Math.max(0, Number(body?.target_user_id || 0)),
      war_goals: Array.isArray(body?.war_goals) ? body.war_goals : [],
      casus_belli: String(body?.casus_belli || ''),
    };
    return post('api/war.php?action=declare', coercedBody, options);
  };

  const offerPeace = async (body, options = {}) => {
    const coercedBody = {
      war_id: Math.max(0, Number(body?.war_id || 0)),
      terms: Array.isArray(body?.terms) ? body.terms : [],
    };
    return post('api/war.php?action=offer_peace', coercedBody, options);
  };

  const respondPeaceOffer = async (body, options = {}) => {
    const coercedBody = {
      offer_id: Math.max(0, Number(body?.offer_id || 0)),
      accept: !!body?.accept,
    };
    return post('api/war.php?action=respond_peace', coercedBody, options);
  };

  const chatNpc = async (body, options = {}) => {
    return post('api/llm.php?action=chat_npc', body, options);
  };

  const closeNpcSession = async (body, options = {}) => {
    return post('api/llm.php?action=close_npc_session', body, options);
  };

  const alliances = async (options = {}) => {
    return get('api/alliances.php', options);
  };

  const allianceMembers = async (allianceId, options = {}) => {
    return get(`api/alliance_members.php?alliance_id=${allianceId}`, options);
  };

  const allianceMembersOnline = async (allianceId, options = {}) => {
    return get(`api/alliance_members_online.php?alliance_id=${allianceId}`, options);
  };

  const joinAlliance = async (body, options = {}) => {
    return post('api/join_alliance.php', body, options);
  };

  const leaveAlliance = async (body, options = {}) => {
    return post('api/leave_alliance.php', body, options);
  };

  const createAlliance = async (body, options = {}) => {
    return post('api/create_alliance.php', body, options);
  };

  const transferAllianceLeadership = async (body, options = {}) => {
    return post('api/transfer_alliance_leadership.php', body, options);
  };

  const deleteAlliance = async (body, options = {}) => {
    return post('api/delete_alliance.php', body, options);
  };

  const editAllianceDetails = async (body, options = {}) => {
    return post('api/edit_alliance_details.php', body, options);
  };

  const inviteToAlliance = async (body, options = {}) => {
    return post('api/invite_to_alliance.php', body, options);
  };

  const revokeAllianceInvite = async (body, options = {}) => {
    return post('api/revoke_alliance_invite.php', body, options);
  };

  const respondAllianceInvite = async (body, options = {}) => {
    return post('api/respond_alliance_invite.php', body, options);
  };

  const removeAllianceMember = async (body, options = {}) => {
    return post('api/remove_alliance_member.php', body, options);
  };

  const galaxyBootstrap = async (options = {}) => {
    const raw = await get('api/galaxy_bootstrap.php', options);
    // Adapt bootstrap data through schema adapters if available
    if (APISchemaAdapters && typeof APISchemaAdapters.adaptGalaxyBootstrap === 'function') {
      return APISchemaAdapters.adaptGalaxyBootstrap(raw);
    }
    return raw;
  };

  const buildBuilding = async (body, options = {}) => {
    return post('api/build_building.php', body, options);
  };

  const cancelBuilding = async (body, options = {}) => {
    return post('api/cancel_building.php', body, options);
  };

  const buildShip = async (body, options = {}) => {
    return post('api/build_ship.php', body, options);
  };

  const cancelShip = async (body, options = {}) => {
    return post('api/cancel_ship.php', body, options);
  };

  const startResearch = async (body, options = {}) => {
    return post('api/start_research.php', body, options);
  };

  const cancelResearch = async (body, options = {}) => {
    return post('api/cancel_research.php', body, options);
  };

  const attack = async (body, options = {}) => {
    return post('api/attack.php', body, options);
  };

  const sendFleet = async (body, options = {}) => {
    return post('api/send_fleet.php', body, options);
  };

  const recallFleet = async (body, options = {}) => {
    return post('api/recall_fleet.php', body, options);
  };

  const getQueueStats = () => {
    if (APIQueue && typeof APIQueue.getQueueStats === 'function') {
      return APIQueue.getQueueStats();
    }
    return { pending: 0, active: 0, concurrency: {} };
  };

  const cancelPendingRequests = () => {
    if (APIQueue && typeof APIQueue.cancelPendingRequests === 'function') {
      APIQueue.cancelPendingRequests();
    }
  };

  const isSessionExpired = () => _sessionExpired;

  const resetSessionState = () => {
    _sessionExpired = false;
    if (APISession && typeof APISession.resetSessionState === 'function') {
      APISession.resetSessionState();
    }
  };

  const setCsrfToken = (token) => {
    if (APISession && typeof APISession.setCsrfToken === 'function') {
      APISession.setCsrfToken(token);
    }
  };

  const handleAuthError = async (error) => {
    if (APISession && typeof APISession.handleAuthError === 'function') {
      return APISession.handleAuthError(error);
    }
  };

  // Public exports
  return {
    get,
    post,
    getBinary,
    overview,
    health,
    resources,
    buildings,
    research,
    shipyard,
    fleet,
    galaxy,
    map,
    war,
    wars,
    warStatus,
    declareStrategicWar,
    offerPeace,
    respondPeaceOffer,
    chatNpc,
    closeNpcSession,
    alliances,
    allianceMembers,
    allianceMembersOnline,
    joinAlliance,
    leaveAlliance,
    createAlliance,
    transferAllianceLeadership,
    deleteAlliance,
    editAllianceDetails,
    inviteToAlliance,
    revokeAllianceInvite,
    respondAllianceInvite,
    removeAllianceMember,
    galaxyBootstrap,
    buildBuilding,
    cancelBuilding,
    buildShip,
    cancelShip,
    startResearch,
    cancelResearch,
    attack,
    sendFleet,
    recallFleet,
    getQueueStats,
    cancelPendingRequests,
    isSessionExpired,
    resetSessionState,
    setCsrfToken,
    handleAuthError,
  };
})();

// Export for use in browser and tests
if (typeof window !== 'undefined') {
  window.API = API;
}

// For render data adapter compatibility (used by render pipeline)
if (typeof window !== 'undefined') {
  window.GQRenderDataAdapter = {
    adaptGalaxy: (data) => {
      if (APISchemaAdapters && typeof APISchemaAdapters.adaptGalaxyStars === 'function') {
        return APISchemaAdapters.adaptGalaxyStars(data);
      }
      return data;
    },
    adaptBootstrap: (data) => {
      if (APISchemaAdapters && typeof APISchemaAdapters.adaptGalaxyBootstrap === 'function') {
        return APISchemaAdapters.adaptGalaxyBootstrap(data);
      }
      return data;
    },
    classifyError: (error) => {
      if (APISchemaAdapters && typeof APISchemaAdapters.classifyRenderError === 'function') {
        return APISchemaAdapters.classifyRenderError(error);
      }
      return 'unknown';
    },
  };
}

// LLM API compatibility export
if (typeof window !== 'undefined') {
  window.GQ_LLM = {
    chatNpc: (payload) => API.chatNpc(payload),
    closeNpcSession: (payload) => API.closeNpcSession(payload),
  };
}
