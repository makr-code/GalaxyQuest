/**
 * GalaxyQuest - Main game UI controller
 * All views are rendered as floating windows via the WM (window manager).
 */
(async function () {

  function requireRuntimeApi(globalName, requiredMethods = []) {
    const api = window?.[globalName] || null;
    if (!api) {
      throw new Error(`[runtime/game] ${globalName} is required but not available.`);
    }
    const missingMethods = requiredMethods.filter((methodName) => typeof api[methodName] !== 'function');
    if (missingMethods.length) {
      throw new Error(`[runtime/game] ${globalName} is missing methods: ${missingMethods.join(', ')}`);
    }
    return api;
  }

  const API = window?.API || null;
  if (!API) {
    throw new Error('[runtime/game] API is required but not available. Ensure js/network/api.js is loaded before js/runtime/game.js.');
  }

  const WM = window?.WM || null;
  if (!WM) {
    throw new Error('[runtime/game] WM is required but not available. Ensure js/ui/window-manager.js is loaded before js/runtime/game.js.');
  }

  const runtimeEventBus = window?.GQEventBus?.sharedBus || null;

  const runtimeGameContextRefsApi = requireRuntimeApi('GQRuntimeGameContextRefs', ['createGameContextRefs']);
  const runtimeGameInfraHelpersApi = requireRuntimeApi('GQRuntimeGameInfraHelpers', ['gameLog', 'redirectToLogin']);
  const runtimeColonySurfaceSlotMappingApi = requireRuntimeApi('GQRuntimeColonySurfaceSlotMapping', [
    'buildingZoneLabel',
    'buildColonyGridCells',
    'mapBuildingToVfxProfile',
    'buildColonySurfaceVfxSlots',
    'queueColonySurfaceSceneData',
  ]);
  const runtimeGalaxyInit3DFacadeApi = requireRuntimeApi('GQRuntimeGalaxyInit3DFacade', [
    'configureGalaxyInit3DFacadeRuntime',
    'initGalaxy3D',
  ]);
  const runtimeGalaxyPhysicsFlightApi = requireRuntimeApi('GQRuntimeGalaxyPhysicsFlight', [
    'canUsePhysicsFlightPath',
    'runPhysicsCinematicFlight',
  ]);
  const runtimeGalaxySearchScoringApi = requireRuntimeApi('GQRuntimeGalaxySearchScoring', [
    'starSearchKey',
    'scoreStarSearchMatch',
    'collectLocalStarSearch',
  ]);
  const runtimeGalaxyStarBootstrapPreflightApi = requireRuntimeApi('GQRuntimeGalaxyStarBootstrapPreflight', ['runBootstrapPreflight']);
  const runtimeGalaxyStarCacheReadApi = requireRuntimeApi('GQRuntimeGalaxyStarCacheRead', ['loadCachedStarRange']);
  const runtimeGalaxyStarErrorUiApi = requireRuntimeApi('GQRuntimeGalaxyStarErrorUi', ['applyRecoveredFallback']);
  const runtimeGalaxyStarFallbackRecoveryApi = requireRuntimeApi('GQRuntimeGalaxyStarFallbackRecovery', ['recoverFallbackStars']);
  const runtimeGalaxyStarFlowOrchestratorApi = requireRuntimeApi('GQRuntimeGalaxyStarFlowOrchestrator', [
    'applyCacheHit',
    'applyNetworkSuccess',
  ]);
  const runtimeGalaxyStarLoaderFacadeApi = requireRuntimeApi('GQRuntimeGalaxyStarLoaderFacade', ['loadGalaxyStars3D']);
  const runtimeGalaxyStarLoadingHelpersApi = requireRuntimeApi('GQRuntimeGalaxyStarLoadingHelpers', ['applyStarsToRenderer']);
  const runtimeGalaxyStarNetworkFlowApi = requireRuntimeApi('GQRuntimeGalaxyStarNetworkFlow', [
    'configureGalaxyStarNetworkFlowRuntime',
    'fetchAdaptedGalaxyStars',
    'mergeNetworkPayloadIntoStars',
  ]);
  const runtimeGalaxyStarPersistenceApi = requireRuntimeApi('GQRuntimeGalaxyStarPersistence', ['persistNetworkStars']);
  const runtimeGalaxyStarTerritorySyncApi = requireRuntimeApi('GQRuntimeGalaxyStarTerritorySync', [
    'loadGalaxyMetadata',
    'syncTerritoryForGalaxy',
  ]);
  const runtimeGalaxyStarUiStatusApi = requireRuntimeApi('GQRuntimeGalaxyStarUiStatus', [
    'setLoadingStatus',
    'setCacheStatus',
    'setNetworkErrorStatus',
    'setStaleStatus',
    'setLoadedStatus',
    'setRangeInputMax',
  ]);
  const runtimeGalaxyVisualUtilsApi = requireRuntimeApi('GQRuntimeGalaxyVisualUtils', ['starClassColor', 'planetIcon']);
  const runtimeGalaxyWindowBindingsApi = requireRuntimeApi('GQRuntimeGalaxyWindowBindings', ['bindGalaxyWindowControls']);
  const runtimeSelectionStateApi = requireRuntimeApi('GQRuntimeSelectionState', [
    'configureSelectionRuntime',
    'commitSelectionState',
    'getSelectionGroupHighlightedSystems',
    'createSelectionStore',
  ]);
  const PERF_TELEMETRY_OPT_IN_KEY = 'gq_perf_telemetry_opt_in';

  function gameLog(level, message, data = null) {
    runtimeGameInfraHelpersApi.gameLog(level, message, data, {
      windowRef: window,
      consoleRef: console,
    });
  }

  function formatRendererBackendLabel(rawBackend) {
    const value = String(rawBackend || '').toLowerCase();
    if (value === 'webgpu') return 'webgpu';
    if (value === 'three-webgl' || value === 'engine-webgl' || value === 'threejs' || value === 'webgl2') {
      return 'webgl-compat';
    }
    if (value === 'webgl1') return 'webgl1-compat';
    return String(rawBackend || 'unknown');
  }

  function ensureToastHost() {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.body) return null;
    let host = doc.getElementById('gq-toast-host');
    if (host) return host;
    host = doc.createElement('div');
    host.id = 'gq-toast-host';
    host.style.position = 'fixed';
    host.style.right = '16px';
    host.style.bottom = '16px';
    host.style.display = 'flex';
    host.style.flexDirection = 'column';
    host.style.gap = '8px';
    host.style.zIndex = '10050';
    host.style.pointerEvents = 'none';
    doc.body.appendChild(host);
    return host;
  }

  function showToast(message, type = 'info') {
    const text = String(message ?? '').trim();
    if (!text) return;

    if (window.GQToast && typeof window.GQToast.show === 'function') {
      window.GQToast.show(text, type);
      return;
    }

    const host = ensureToastHost();
    if (!host) {
      const consoleLevel = type === 'error' ? 'error' : (type === 'warning' ? 'warn' : 'info');
      gameLog(consoleLevel, text);
      return;
    }

    const toast = document.createElement('div');
    const palette = {
      success: { bg: 'rgba(23, 79, 55, 0.95)', border: 'rgba(122, 219, 162, 0.6)', color: '#d8ffe9' },
      error: { bg: 'rgba(97, 32, 32, 0.96)', border: 'rgba(255, 130, 130, 0.65)', color: '#ffe3e3' },
      warning: { bg: 'rgba(89, 65, 20, 0.96)', border: 'rgba(255, 214, 120, 0.65)', color: '#fff1cf' },
      info: { bg: 'rgba(24, 47, 82, 0.95)', border: 'rgba(138, 183, 255, 0.55)', color: '#dce9ff' },
    };
    const scheme = palette[type] || palette.info;

    toast.textContent = text;
    toast.setAttribute('role', 'status');
    toast.style.pointerEvents = 'auto';
    toast.style.maxWidth = '420px';
    toast.style.padding = '10px 14px';
    toast.style.borderRadius = '10px';
    toast.style.border = `1px solid ${scheme.border}`;
    toast.style.background = scheme.bg;
    toast.style.color = scheme.color;
    toast.style.fontSize = '12px';
    toast.style.fontWeight = '600';
    toast.style.lineHeight = '1.35';
    toast.style.boxShadow = '0 10px 24px rgba(0, 0, 0, 0.35)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(4px)';
    toast.style.transition = 'opacity 140ms ease, transform 140ms ease';

    host.appendChild(toast);
    window.requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    const lifetimeMs = type === 'error' ? 5200 : 3600;
    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(4px)';
      window.setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 180);
    }, lifetimeMs);
  }

  function redirectToLogin(reason = 'auth') {
    runtimeGameInfraHelpersApi.redirectToLogin(reason, {
      windowRef: window,
      showToast,
      uiConsolePush: typeof uiConsolePush === 'function' ? uiConsolePush : null,
    });
  }

  function shouldRedirectOnAuthLoadError(endpoint = '', context = '') {
    const ep = String(endpoint || '').toLowerCase();
    const cx = String(context || '').toLowerCase();
    if (!ep && !cx) return true;

    const coreEndpointPatterns = [
      /api\/(v1\/)?auth\.php\?action=me/i,
      /api\/(v1\/)?game\.php\?/i,
      /api\/(v1\/)?galaxy\.php\?/i,
    ];
    if (coreEndpointPatterns.some((re) => re.test(ep))) {
      return true;
    }

    const coreContextPatterns = [
      /auth|session|bootstrap|overview|galaxy/i,
    ];
    if (coreContextPatterns.some((re) => re.test(cx))) {
      return true;
    }

    return false;
  }

  function _invalidateGetCache(patterns) {
    if (!API || typeof API.invalidateCache !== 'function') return false;
    return API.invalidateCache(patterns);
  }

  function isPerfTelemetryOptIn() {
    try {
      return localStorage.getItem(PERF_TELEMETRY_OPT_IN_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setPerfTelemetryOptIn(enabled) {
    try {
      localStorage.setItem(PERF_TELEMETRY_OPT_IN_KEY, enabled ? '1' : '0');
      return true;
    } catch (_) {
      return false;
    }
  }

  async function sendPerfTelemetrySnapshot(payload = {}) {
    if (!API || typeof API.perfTelemetry !== 'function') return false;
    const response = await API.perfTelemetry(payload);
    return !!response?.success;
  }

  function fmt(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value ?? '0');
    return num.toLocaleString('de-DE');
  }

  function fmtName(value) {
    const text = String(value ?? '').trim();
    if (!text) return '-';
    return text
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\b([a-z])/g, (match, ch) => String(ch || '').toUpperCase());
  }

  function countdown(endValue) {
    if (endValue == null || endValue === '') return '-';

    let endMs = Number(endValue);
    if (Number.isFinite(endMs)) {
      if (endMs > 0 && endMs < 1e12) endMs *= 1000;
    } else {
      const parsed = Date.parse(String(endValue));
      if (!Number.isFinite(parsed)) return '-';
      endMs = parsed;
    }

    const remaining = Math.max(0, endMs - Date.now());
    const totalSec = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  const settingsState = (window.GQ_GAME_STATE && typeof window.GQ_GAME_STATE === 'object')
    ? window.GQ_GAME_STATE
    : {};
  const uiState = (window.GQ_UI_STATE && typeof window.GQ_UI_STATE === 'object')
    ? window.GQ_UI_STATE
    : {
      activeGalaxy: 1,
      activeSystem: 1,
      activeStar: null,
      activePlanet: null,
      activeRange: null,
      intelCache: new Map(),
      clusterSummary: [],
      rawClusters: [],
      territory: [],
      colonyViewFocus: null,
      selectionState: runtimeSelectionStateApi.createSelectionStore(),
    };
  // Legacy alias kept for backward compatibility with existing call-sites.
  Object.defineProperty(uiState, 'selection', {
    get() { return this.selectionState; },
    set(v) { this.selectionState = v; },
    enumerable: true,
    configurable: true,
  });
  const currentUser = window.currentUser || window.GQ_CURRENT_USER || null;

  let audioManager = window.__GQ_AUDIO_MANAGER || window.audioManager || window.GQAudioManagerInstance || null;
  let colonies = Array.isArray(window.colonies) ? window.colonies : [];
  let currentColony = null;
  let galaxy3d = window.galaxy3d || null;
  let galaxy3dInitReason = 'boot';
  let galaxyDB = window.galaxyDB || null;
  let galaxyModel = window.galaxyModel || null;
  let galaxyStars = Array.isArray(window.galaxyStars) ? window.galaxyStars : [];
  let pinnedStar = window.pinnedStar || null;
  let galaxySystemMax = Number(window.galaxySystemMax || 0);
  let galaxyHealthLastCheckMs = 0;
  // Trade-Routes-Cache: wird beim Boot-Abschluss und nach jedem renderTradeRoutes()
  // aktualisiert, damit das Autobahn-Overlay im Minimap immer Daten hat.
  let _tradeRoutesCache = [];

  function publishTradeRoutesCache() {
    try {
      window.__GQ_TRADE_ROUTES_CACHE = Array.isArray(_tradeRoutesCache) ? _tradeRoutesCache : [];
    } catch (_) {}
  }
  publishTradeRoutesCache();

  function normalizeNpcTraderRoutes(routes) {
    if (!Array.isArray(routes)) return [];
    return routes
      .filter((route) => route && route.origin && route.target)
      .map((route) => ({
        id: `npc-${route.id || Math.random().toString(36).slice(2)}`,
        origin: route.origin,
        target: route.target,
        interval_hours: Number(route.interval_hours || 12),
        is_active: route.is_active !== false,
        is_due: !!route.is_due,
        route_type: 'npc_trader',
        resource_type: route.resource_type || null,
        status: route.status || null,
      }));
  }

  function mergeTradeRouteCaches(playerRoutes, npcRoutes) {
    const merged = [];
    const seen = new Set();

    for (const route of Array.isArray(playerRoutes) ? playerRoutes : []) {
      const id = String(route?.id || '');
      if (id && seen.has(`p:${id}`)) continue;
      if (id) seen.add(`p:${id}`);
      merged.push(route);
    }

    for (const route of normalizeNpcTraderRoutes(npcRoutes)) {
      const id = String(route?.id || '');
      if (id && seen.has(`n:${id}`)) continue;
      if (id) seen.add(`n:${id}`);
      merged.push(route);
    }

    return merged;
  }

  async function refreshTradeRoutesCache() {
    try {
      const [data, tradersData] = await Promise.all([
        API.tradeRoutes(),
        API.tradersRoutes('in_transit').catch(() => ({ routes: [] })),
      ]);
      const playerRoutes = Array.isArray(data?.trade_routes) ? data.trade_routes : [];
      const npcRoutes = Array.isArray(tradersData?.routes) ? tradersData.routes : [];
      _tradeRoutesCache = mergeTradeRouteCaches(playerRoutes, npcRoutes);
      publishTradeRoutesCache();
    } catch (_) {}
  }
  let zoomOrchestrator = window.__GQ_ZOOM_ORCHESTRATOR || null;
  let galaxyHydrationToken = 0;
  const STAR_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

  async function ensureGalaxyDataStoresInitialized() {
    if (!galaxyModel && typeof window.GQGalaxyModel === 'function') {
      try {
        galaxyModel = new window.GQGalaxyModel();
        window.galaxyModel = galaxyModel;
      } catch (err) {
        gameLog('warn', 'GQGalaxyModel init failed', err);
      }
    }

    if (!galaxyDB && typeof window.GQGalaxyDB === 'function') {
      try {
        const db = new window.GQGalaxyDB();
        await db.init();
        galaxyDB = db;
        window.galaxyDB = galaxyDB;
      } catch (err) {
        gameLog('warn', 'GQGalaxyDB init failed', err);
      }
    }
  }

  await ensureGalaxyDataStoresInitialized();

  function isCurrentUserAdmin() {
    const user = currentUser || {};
    if (user.is_admin === true || user.admin === true) return true;
    const role = String(user.role || user.user_role || '').toLowerCase();
    return role === 'admin' || role === 'superadmin' || role === 'owner';
  }

  function normalizeStarVisibility(star) {
    if (!star || typeof star !== 'object' || !isCurrentUserAdmin()) return star;
    return Object.assign({}, star, { visibility_level: 'own' });
  }

  function normalizeStarListVisibility(stars) {
    if (!Array.isArray(stars)) return [];
    if (!isCurrentUserAdmin()) return stars;
    return stars.map((star) => normalizeStarVisibility(star));
  }

  function normalizeSystemPayloadVisibility(payload) {
    if (!payload || typeof payload !== 'object' || !isCurrentUserAdmin()) return payload;
    return Object.assign({}, payload, {
      visibility: Object.assign({}, payload.visibility || {}, { level: 'own' }),
    });
  }

  function setGalaxyContext(galaxyIndex, systemIndex, star = null) {
    const nextGalaxy = Math.max(1, Number(galaxyIndex || uiState.activeGalaxy || 1));
    const nextSystem = Math.max(1, Number(systemIndex || uiState.activeSystem || 1));
    uiState.activeGalaxy = nextGalaxy;
    uiState.activeSystem = nextSystem;
    if (star && typeof star === 'object') {
      uiState.activeStar = star;
    }
  }

  const {
    getActiveStarRef,
    getApiRef,
    getColoniesRef,
    getGalaxy3dInitReasonRef,
    getGalaxy3dQualityStateRef,
    getGalaxy3dRef,
    getGalaxyDbRef,
    getHotkeysBoundRef,
    getLocalStorageRef,
    getLogApiRef,
    getNavigatorRef,
    getPinnedStarRef,
    galaxyTriggerNavActionRef,
    getRollStepRef,
    getSettingsStateRef,
    getUiStateRef,
    getWmRef,
    playMessageSendRef,
    refreshAudioUiRef,
    saveUiSettingsRef,
    setGalaxyStarsRef,
    setGalaxySystemMaxRef,
    setHotkeysBoundRef,
    updateFleetVectorsUiSafeRef,
    eventSourceFactoryRef,
    applyRuntimeSettingsRef,
    wmBody,
    wmIsOpen,
    wmOpen,
    wmRefresh,
    apiDeleteMsg,
    apiReadMsg,
    apiSendMsg,
  } = runtimeGameContextRefsApi.createGameContextRefs({
    windowRef: window,
    navigatorRef: navigator,
    localStorageRef: localStorage,
    eventSourceCtor: typeof EventSource !== 'undefined' ? EventSource : null,
    wm: WM,
    api: API,
    getApi: () => API,
    getAudioManager: () => audioManager,
    getColonies: () => colonies,
    getCurrentColony: () => currentColony,
    getGalaxy3d: () => galaxy3d,
    getGalaxy3dInitReason: () => galaxy3dInitReason,
    getGalaxyDb: () => galaxyDB,
    getGalaxyModel: () => galaxyModel,
    getGalaxyStars: () => galaxyStars,
    getPinnedStar: () => pinnedStar,
    getRollStep: () => 0.05,
    getSettingsState: () => settingsState,
    getUiState: () => uiState,
    getActiveStar: () => uiState?.activeStar || null,
    setGalaxySystemMax: (value) => {
      galaxySystemMax = value;
    },
    setGalaxyStars: (stars) => {
      galaxyStars = stars;
    },
    playMessageSend: () => {
      if (audioManager && typeof audioManager.playMessageSend === 'function') {
        audioManager.playMessageSend();
      }
    },
    updateFleetVectorsUiSafe: (root) => {
      if (typeof updateFleetVectorsUiSafe === 'function') {
        updateFleetVectorsUiSafe(root);
      }
    },
    getSettingsController: () => settingsController,
    getGalaxyController: () => galaxyController,
  });

  runtimeGalaxyInit3DFacadeApi.configureGalaxyInit3DFacadeRuntime({
    windowRef: window,
    documentRef: document,
    getGalaxy3d: () => galaxy3d,
    setGalaxy3d: (renderer) => {
      galaxy3d = renderer || null;
      window.galaxy3d = galaxy3d;
    },
    getGalaxy3dInitReason: () => galaxy3dInitReason,
    setGalaxy3dInitReason: (reason) => {
      galaxy3dInitReason = String(reason || '');
      window.galaxy3dInitReason = galaxy3dInitReason;
    },
    getSettingsState: () => settingsState,
    getUiState: () => uiState,
    getZoomOrchestrator: () => zoomOrchestrator || window.__GQ_ZOOM_ORCHESTRATOR || null,
    setZoomOrchestrator: (next) => {
      zoomOrchestrator = next || null;
      window.__GQ_ZOOM_ORCHESTRATOR = zoomOrchestrator;
    },
    esc,
    gameLog,
    showToast,
    toggleGalaxyOverlay,
    isSharedLevelRenderer,
    attachRendererCallbacks,
    getPreferredLevelSharedRenderer,
    applyRuntimeSettings: applyRuntimeSettingsRef,
    refreshGalaxyDensityMetrics,
    updateGalaxyFollowUi,
    updateClusterBoundsUi,
    syncRendererInputContext,
    commitSelectionState: (...args) => runtimeSelectionStateApi.commitSelectionState(...args),
    updateGalaxyHoverCard,
    focusPlanetDetailsInOverlay,
    renderGalaxySystemDetails,
    applyClusterRangeToControls,
    flashGalaxyControlBtn,
    logEnterSystemPipeline,
    loadGalaxyStars3D,
    loadStarSystemPlanets,
    transitionOutOfSystemView,
    renderGalaxyColonySummary,
    isSystemModeActive,
    getAudioManager: () => audioManager,
    getPinnedStar: () => pinnedStar,
    setPinnedStar: (star) => { pinnedStar = star || null; },
    getGalaxyStars: () => galaxyStars,
    getActiveRange: () => uiState.activeRange || null,
    getGalaxyRendererBootstrapApi: () => window.GQGalaxyRendererBootstrap || null,
  });

  runtimeGalaxyStarNetworkFlowApi.configureGalaxyStarNetworkFlowRuntime({
    apiGalaxyStars: (typeof API.galaxyStars === 'function') ? API.galaxyStars.bind(API) : null,
    apiGalaxyFallback: (typeof API.galaxy === 'function') ? API.galaxy.bind(API) : null,
    normalizeStarListVisibility,
    normalizeStarVisibility,
    mergeGalaxyStarsBySystem,
  });

  const runtimeTopbarA11yApi = requireRuntimeApi('GQRuntimeTopbarA11y', ['initTopbarA11yRuntime']);
  runtimeTopbarA11yApi.initTopbarA11yRuntime();
  const runtimeTopbarAudioControlsApi = requireRuntimeApi('GQRuntimeTopbarAudioControls', [
    'bindAudioToggle',
    'bindTopbarPlayer',
  ]);
  const focusFirstInTopbarMenu = runtimeTopbarA11yApi.focusFirstInTopbarMenu;
  const syncTopbarBottomSheetState = runtimeTopbarA11yApi.syncTopbarBottomSheetState;
  const setTopbarMenuFocusTrap = runtimeTopbarA11yApi.setTopbarMenuFocusTrap;
  const clearTopbarMenuFocusTrap = runtimeTopbarA11yApi.clearTopbarMenuFocusTrap;
  const isTopbarMenuFocusTrapped = runtimeTopbarA11yApi.isTopbarMenuFocusTrapped;
  const closeCommanderMenuPanel = runtimeTopbarA11yApi.closeCommanderMenuPanel;
  const closeTopbarPlayerMenu = runtimeTopbarA11yApi.closeTopbarPlayerMenu;
  const runtimeTopbarSearchStoreApi = requireRuntimeApi('GQRuntimeTopbarSearchStore', ['createTopbarSearchStore']);
  const runtimeTopbarSearchApi = requireRuntimeApi('GQRuntimeTopbarSearch', [
    'configureTopbarSearchRuntime',
    'getTopbarSearchDom',
    'closeTopbarSearchOverlay',
    'initTopbarSearch',
  ]);
  const topbarSearchStore = runtimeTopbarSearchStoreApi.createTopbarSearchStore({
    windowRef: window,
    maxLocal: 10,
    maxServer: 18,
  });

  function getTopbarSearchDom() {
    return runtimeTopbarSearchApi.getTopbarSearchDom();
  }

  function closeTopbarSearchOverlay() {
    runtimeTopbarSearchApi.closeTopbarSearchOverlay();
  }

  function initTopbarSearch() {
    runtimeTopbarSearchApi.initTopbarSearch();
  }

  const runtimeFooterUiKitApi = requireRuntimeApi('GQRuntimeFooterUiKit', ['initFooterUiKit']);
  const runtimeFooterNetworkStatusApi = requireRuntimeApi('GQRuntimeFooterNetworkStatus', ['refreshFooterNetworkStatus']);
  runtimeFooterNetworkStatusApi.configureFooterNetworkStatusRuntime({
    documentRef: document,
    getApi: getApiRef,
    getNavigator: getNavigatorRef,
    logger: gameLog,
  });
  const setFooterLoadProgress = runtimeFooterNetworkStatusApi.setFooterLoadProgress;
  const setFooterNetworkStatus = runtimeFooterNetworkStatusApi.setFooterNetworkStatus;
  const refreshFooterNetworkStatus = runtimeFooterNetworkStatusApi.refreshFooterNetworkStatus;
  const runtimeRealtimeSyncApi = requireRuntimeApi('GQRuntimeRealtimeSync', ['initRealtimeSync']);
  const runtimeStartupBootApi = requireRuntimeApi('GQRuntimeStartupBoot', ['initStartupBoot']);
  const runtimePostBootFlowApi = requireRuntimeApi('GQRuntimePostBootFlow', ['runPostBootFlow']);
  const runtimeColonyVfxDebugWidgetApi = requireRuntimeApi('GQRuntimeColonyVfxDebugWidget', ['safeInitColonyVfxDebugWidget']);
  const runtimePolicyEngineApi = requireRuntimeApi('GQRuntimePolicyEngine', ['applyPolicyMode']);
  runtimePolicyEngineApi.configurePolicyRuntime({
    getGalaxyDb: getGalaxyDbRef,
    getLocalStorage: getLocalStorageRef,
    getNavigator: getNavigatorRef,
    logger: gameLog,
  });
  const POLICY_PROFILES = runtimePolicyEngineApi.getPolicyProfiles();
  const LEVEL_POLICIES = runtimePolicyEngineApi.getLevelPolicies();
  const applyPolicyMode = runtimePolicyEngineApi.applyPolicyMode;
  const refreshPolicyUi = runtimePolicyEngineApi.refreshPolicyUi;
  const getActivePolicyMode = runtimePolicyEngineApi.getActivePolicyMode;
  const getActivePolicyProfile = runtimePolicyEngineApi.getActivePolicyProfile;
  const isPolicyModeAuto = runtimePolicyEngineApi.isPolicyModeAuto;
  const getPolicyProfileLabelRef = () => POLICY_PROFILES[getActivePolicyProfile()]?.label || getActivePolicyProfile();
  const runtimeGalaxyDebugLogApi = requireRuntimeApi('GQRuntimeGalaxyDebugLog', ['pushGalaxyDebugError']);
  runtimeGalaxyDebugLogApi.configureGalaxyDebugLogRuntime({
    wm: WM,
    esc,
    showToast,
    documentRef: document,
    navigatorRef: navigator,
    maxEntries: 6,
  });
  const pushGalaxyDebugError = runtimeGalaxyDebugLogApi.pushGalaxyDebugError;
  const renderGalaxyDebugPanel = runtimeGalaxyDebugLogApi.renderGalaxyDebugPanel;
  const copyLastGalaxyDebugError = runtimeGalaxyDebugLogApi.copyLastGalaxyDebugError;
  const clearGalaxyDebugErrors = runtimeGalaxyDebugLogApi.clearGalaxyDebugErrors;
  const downloadGalaxyDebugLog = runtimeGalaxyDebugLogApi.downloadGalaxyDebugLog;
  const runtimeColonyBuildingLogicApi = requireRuntimeApi('GQRuntimeColonyBuildingLogic', ['focusColonyDevelopment']);
  runtimeColonyBuildingLogicApi.configureColonyBuildingLogicRuntime({
    getColonies: getColoniesRef,
    getWm: getWmRef,
    setColonyViewFocusCallback: (colonyId, focusBuilding, source) => {
      uiState.colonyViewFocus = {
        colonyId: Number(colonyId || 0),
        focusBuilding: String(focusBuilding || ''),
        source: String(source || 'manual'),
        ts: Date.now(),
      };
      maybeZoomToColonyBuilding(colonyId, focusBuilding, source);
    },
    selectColonyById,
    showToast,
    prefillFleetTarget,
  });
  const BUILDING_UI_META = runtimeColonyBuildingLogicApi.getBuildingUiMetaAll();
  const BUILDING_ZONE_PRIORITY = runtimeColonyBuildingLogicApi.getBuildingZonePriority();
  const commitSelectionState = runtimeSelectionStateApi.commitSelectionState;
  const getSelectionGroupHighlightedSystems = runtimeSelectionStateApi.getSelectionGroupHighlightedSystems;
  runtimeSelectionStateApi.configureSelectionRuntime({
    getIsSystemMode: () => isSystemModeActive(),
    getClusterSummary: () => uiState.clusterSummary || [],
    getSelectionState: () => uiState.selection,
    setActiveStar: (star) => { uiState.activeStar = star || null; },
    setActiveSystem: (systemIndex) => { uiState.activeSystem = Math.max(1, Number(systemIndex || 1)); },
    applySelectionGroupHighlight: () => { applySelectionGroupHighlightToRenderer(galaxyStars); },
  });
  const getBuildingUiMeta = runtimeColonyBuildingLogicApi.getBuildingUiMeta;
  const getRecommendedBuildingFocus = runtimeColonyBuildingLogicApi.getRecommendedBuildingFocus;
  const pickZoneBuildFocus = runtimeColonyBuildingLogicApi.pickZoneBuildFocus;
  const setColonyViewFocus = runtimeColonyBuildingLogicApi.setColonyViewFocus;
  const focusColonyDevelopment = runtimeColonyBuildingLogicApi.focusColonyDevelopment;
  const openColonySubview = runtimeColonyBuildingLogicApi.openColonySubview;

  const runtimeResourceInsightApi = requireRuntimeApi('GQRuntimeResourceInsight', [
    'configureResourceInsightRuntime',
    'getResourceInsightConfig',
    'getResourceInsightValue',
    'getResourceInsightTotal',
    'formatResourceInsightValue',
    'getSuggestedTradeAmount',
    'openResourceInsight',
    'openTradeMarketplace',
    'openFleetTransportPlanner',
  ]);
  runtimeResourceInsightApi.configureResourceInsightRuntime({
    getCurrentColony: () => currentColony,
    getMeta: () => ({ dark_matter: Number(currentUser?.dark_matter || 0) }),
    getColonies: () => colonies,
    getUiState: () => uiState,
    setFleetPrefill: (payload) => {
      uiState.fleetPrefill = payload;
    },
    showToast,
    wmOpen,
    wmRefresh,
    fmt,
  });

  const getResourceInsightConfig = runtimeResourceInsightApi.getResourceInsightConfig;
  const RESOURCE_INSIGHT_CONFIG = (runtimeResourceInsightApi && runtimeResourceInsightApi.RESOURCE_INSIGHT_CONFIG)
    ? runtimeResourceInsightApi.RESOURCE_INSIGHT_CONFIG
    : {};
  const getResourceInsightValue = runtimeResourceInsightApi.getResourceInsightValue;
  const getResourceInsightTotal = runtimeResourceInsightApi.getResourceInsightTotal;
  const formatResourceInsightValue = runtimeResourceInsightApi.formatResourceInsightValue;
  const getSuggestedTradeAmount = runtimeResourceInsightApi.getSuggestedTradeAmount;
  const openResourceInsight = runtimeResourceInsightApi.openResourceInsight;
  const openTradeMarketplace = runtimeResourceInsightApi.openTradeMarketplace;
  const openFleetTransportPlanner = runtimeResourceInsightApi.openFleetTransportPlanner;

  const runtimeMessageSignalsApi = requireRuntimeApi('GQRuntimeMessageSignals', ['updateMessageSignalsFromInbox']);
  runtimeMessageSignalsApi.configureMessageSignalsRuntime({ documentRef: document });
  const updateMessageSignalsFromInbox = runtimeMessageSignalsApi.updateMessageSignalsFromInbox;
  const runtimeGalaxyCanvasDebugApi = requireRuntimeApi('GQRuntimeGalaxyCanvasDebug', ['inspectGalaxyCanvasLayering']);
  runtimeGalaxyCanvasDebugApi.configureGalaxyCanvasDebugRuntime({
    windowRef: window,
    documentRef: document,
  });
  runtimeGalaxyCanvasDebugApi.attachGlobalGalaxyCanvasDebug();
  const inspectGalaxyCanvasLayering = runtimeGalaxyCanvasDebugApi.inspectGalaxyCanvasLayering;
  const runtimeGalaxyEventProbeApi = requireRuntimeApi('GQRuntimeGalaxyEventProbe', ['runGalaxyEventProbe']);
  runtimeGalaxyEventProbeApi.configureGalaxyEventProbeRuntime({
    documentRef: document,
    windowRef: window,
    consoleRef: console,
  });
  const runtimeGalaxyRendererDebugApi = requireRuntimeApi('GQRuntimeGalaxyRendererDebug', ['runGalaxyRendererDebug']);
  runtimeGalaxyRendererDebugApi.configureGalaxyRendererDebugRuntime({
    getGalaxy3d: getGalaxy3dRef,
    consoleRef: console,
  });
  const runtimePerfTelemetryCommandApi = requireRuntimeApi('GQRuntimePerfTelemetryCommand', ['runPerfTelemetryCommand']);
  runtimePerfTelemetryCommandApi.configurePerfTelemetryCommandRuntime({
    getApi: getApiRef,
    isOptIn: isPerfTelemetryOptIn,
    setOptIn: setPerfTelemetryOptIn,
    sendSnapshot: sendPerfTelemetrySnapshot,
  });
  const runtimeTerminalCommandApi = requireRuntimeApi('GQRuntimeTerminalCommand', ['runTerminalCommand']);
  runtimeTerminalCommandApi.configureTerminalCommandRuntime({
    getLogApi: getLogApiRef,
  });
  const runtimeOpenWindowCommandApi = requireRuntimeApi('GQRuntimeOpenWindowCommand', ['runOpenWindowCommand']);
  runtimeOpenWindowCommandApi.configureOpenWindowCommandRuntime({
    wmOpen,
  });
  const runtimeMessageSendCommandApi = requireRuntimeApi('GQRuntimeMessageSendCommand', ['runMessageSendCommand']);
  runtimeMessageSendCommandApi.configureMessageSendCommandRuntime({
    sendMsg: apiSendMsg,
    playMessageSend: playMessageSendRef,
  });
  const runtimeMessageConsoleCommandApi = requireRuntimeApi('GQRuntimeMessageConsoleCommand', ['runMessageConsoleCommand']);
  runtimeMessageConsoleCommandApi.configureMessageConsoleCommandRuntime({
    readMsg: apiReadMsg,
    deleteMsg: apiDeleteMsg,
    sendMsg: apiSendMsg,
    showToast,
  });
  const messageConsoleState = {
    lines: ['[system] Message console ready. Type "help" for commands.'],
    maxLines: 180,
    userHints: [],
  };
  const runtimeGalaxyOverlayControlsApi = requireRuntimeApi('GQRuntimeGalaxyOverlayControls', ['bindGalaxyOverlayHotkeys']);
  runtimeGalaxyOverlayControlsApi.configureGalaxyOverlayControlsRuntime({
    windowRef: window,
    documentRef: document,
    wmIsOpen,
    wmBody,
    wmOpen: (id) => WM?.open?.(id),
    wmClose: (id) => WM?.close?.(id),
    showToast,
    getGalaxy3d: getGalaxy3dRef,
    updateGalaxyFollowUi,
    getSettingsState: getSettingsStateRef,
    applyRuntimeSettings: applyRuntimeSettingsRef,
    updateFleetVectorsUi: updateFleetVectorsUiSafeRef,
    saveUiSettings: saveUiSettingsRef,
    renderGalaxySystemDetails,
    getPinnedStar: getPinnedStarRef,
    getActiveStar: getActiveStarRef,
    isSystemModeActive,
    getHotkeysBound: getHotkeysBoundRef,
    setHotkeysBound: setHotkeysBoundRef,
    triggerNavAction: galaxyTriggerNavActionRef,
  });
  const runtimeGalaxyNavActionsApi = requireRuntimeApi('GQRuntimeGalaxyNavActions', ['runRendererNavAction']);
  runtimeGalaxyNavActionsApi.configureGalaxyNavActionsRuntime({
    callRendererMethod,
    getRollStep: getRollStepRef,
  });
  const runtimeGalaxyNavOrbRepeatApi = requireRuntimeApi('GQRuntimeGalaxyNavOrbRepeat', ['bindNavRepeatButton']);
  runtimeGalaxyNavOrbRepeatApi.configureGalaxyNavOrbRepeatRuntime({
    triggerNavAction: triggerGalaxyNavAction,
    windowRef: window,
  });
  const runtimeGalaxyNavOrbApi = requireRuntimeApi('GQRuntimeGalaxyNavOrb', ['bindGalaxyNavOrb']);
  runtimeGalaxyNavOrbApi.configureGalaxyNavOrbRuntime({
    windowRef: window,
    documentRef: document,
    getUiState: getUiStateRef,
    getSettingsState: getSettingsStateRef,
    getGalaxy3d: getGalaxy3dRef,
    getGalaxyRoot: () => WM?.body?.('galaxy') || null,
    isSystemModeActive,
    triggerNavAction: triggerGalaxyNavAction,
    showToast,
  });
  const runtimeGalaxyControlUiApi = requireRuntimeApi('GQRuntimeGalaxyControlUi', ['refreshDensityMetrics']);
  const runtimeTransitionsCommandApi = requireRuntimeApi('GQRuntimeTransitionsCommand', ['runTransitionsCommand']);
  const runtimeCommandParsingApi = requireRuntimeApi('GQRuntimeCommandParsing', ['parseCommandInput']);
  const runtimeUiConsoleMetaCommandApi = requireRuntimeApi('GQRuntimeUiConsoleMetaCommand', [
    'configureUiConsoleMetaCommandRuntime',
    'runHelpCommand',
    'runUnknownCommand',
  ]);
  const runtimeUiConsoleCommandRegistryApi = requireRuntimeApi('GQRuntimeUiConsoleCommandRegistry', [
    'configureUiConsoleCommandRegistryRuntime',
    'dispatchUiConsoleCommand',
  ]);
  const runtimeUiConsoleStoreApi = requireRuntimeApi('GQRuntimeUiConsoleStore', ['createUiConsoleStore']);
  const runtimeUiConsolePanelApi = requireRuntimeApi('GQRuntimeUiConsolePanel', ['createUiConsoleController']);
  const runtimeUiConsoleCommandExecutorApi = requireRuntimeApi('GQRuntimeUiConsoleCommandExecutor', ['createUiConsoleCommandController']);

  runtimeUiConsoleMetaCommandApi.configureUiConsoleMetaCommandRuntime();

  const uiConsoleStore = runtimeUiConsoleStoreApi.createUiConsoleStore({
    maxLines: 220,
  });
  let uiConsoleController = null;

  function uiConsolePush(line) {
    uiConsoleStore.push(line);
    if (uiConsoleController && typeof uiConsoleController.render === 'function') {
      uiConsoleController.render();
    }
  }

  function renderUiConsole() {
    if (uiConsoleController && typeof uiConsoleController.render === 'function') {
      uiConsoleController.render();
    }
  }

  async function uiConsoleHelpCommand() {
    runtimeUiConsoleMetaCommandApi.runHelpCommand(uiConsolePush);
  }

  async function uiConsoleCopyCommand() {
    if (uiConsoleController && typeof uiConsoleController.copyToClipboard === 'function') {
      await uiConsoleController.copyToClipboard();
      return;
    }
    uiConsolePush('[warning] Console ist noch nicht bereit.');
  }

  const uiConsoleCommandController = runtimeUiConsoleCommandExecutorApi.createUiConsoleCommandController({
    parseCommandInput: runtimeCommandParsingApi.parseCommandInput,
    uiConsolePush,
    dispatchUiConsoleCommand: runtimeUiConsoleCommandRegistryApi.dispatchUiConsoleCommand,
    runUnknownCommand: (cmd, pushLine) => runtimeUiConsoleMetaCommandApi.runUnknownCommand(cmd, pushLine),
  });

  async function runUiConsoleCommand(raw) {
    await uiConsoleCommandController.execute(raw);
  }

  async function uiConsoleClearCommand() {
    uiConsoleStore.clear();
    renderUiConsole();
  }

  async function uiConsoleRefreshCommand() {
    await loadOverview();
    uiConsolePush('[ok] Overview refreshed.');
  }

  async function uiConsoleHomeCommand() {
    WM.open('galaxy');
    const root = WM.body('galaxy');
    if (root) await focusHomeSystemInGalaxy(root);
    uiConsolePush('[ok] Jumped to home system.');
  }

  async function uiConsoleGalaxyDiagCommand() {
    runtimeGalaxyCanvasDebugApi.runGalaxyCanvasDiag(uiConsolePush);
  }

  async function uiConsoleGalaxyCommand({ parts, normalizedInput }) {
    const diag = (
      normalizedInput === 'gqgalaxycanvasdebug.inspect()'
      || normalizedInput === 'gqgalaxycanvasdebug.inspect'
      || String(parts?.[1] || '').toLowerCase() === 'diag'
    );
    if (diag) {
      await uiConsoleGalaxyDiagCommand();
      return;
    }
    WM.open('galaxy');
    uiConsolePush('[ok] Galaxy window opened.');
  }

  async function uiConsoleGalaxyRendererDebugCommand() {
    runtimeGalaxyRendererDebugApi.runGalaxyRendererDebug(uiConsolePush);
  }

  async function uiConsoleGalprobeCommand({ parts }) {
    runtimeGalaxyEventProbeApi.runGalaxyEventProbe(parts?.[1] || 6, uiConsolePush);
  }

  async function uiConsolePerfTelemetryCommand({ parts }) {
    await runtimePerfTelemetryCommandApi.runPerfTelemetryCommand(parts, uiConsolePush);
  }

  async function uiConsoleOpenCommand({ parts }) {
    runtimeOpenWindowCommandApi.runOpenWindowCommand(parts, uiConsolePush);
  }

  async function uiConsoleTransitionsCommand({ parts }) {
    runtimeTransitionsCommandApi.runTransitionsCommand(parts, uiConsolePush);
  }

  async function uiConsoleMessageSendCommand({ parts, input }) {
    await runtimeMessageSendCommandApi.runMessageSendCommand(parts, input, uiConsolePush);
  }

  async function uiConsoleTerminalCommand({ parts }) {
    runtimeTerminalCommandApi.runTerminalCommand(parts, uiConsolePush);
  }

  runtimeUiConsoleCommandRegistryApi.configureUiConsoleCommandRegistryRuntime({
    commands: {
      help: uiConsoleHelpCommand,
      '?': uiConsoleHelpCommand,
      copy: uiConsoleCopyCommand,
      clear: uiConsoleClearCommand,
      refresh: uiConsoleRefreshCommand,
      home: uiConsoleHomeCommand,
      galaxy: uiConsoleGalaxyCommand,
      galdiag: uiConsoleGalaxyDiagCommand,
      galinspect: uiConsoleGalaxyDiagCommand,
      galdebug: uiConsoleGalaxyRendererDebugCommand,
      galprobe: uiConsoleGalprobeCommand,
      perftelemetry: uiConsolePerfTelemetryCommand,
      open: uiConsoleOpenCommand,
      transitions: uiConsoleTransitionsCommand,
      msg: uiConsoleMessageSendCommand,
      term: uiConsoleTerminalCommand,
      terminal: uiConsoleTerminalCommand,
      'gqgalaxycanvasdebug.inspect()': uiConsoleGalaxyDiagCommand,
      'gqgalaxycanvasdebug.inspect': uiConsoleGalaxyDiagCommand,
    },
  });

  uiConsoleController = runtimeUiConsolePanelApi.createUiConsoleController({
    store: uiConsoleStore,
    showToast,
    esc,
    documentRef: document,
    windowRef: window,
    navigatorRef: navigator,
    wm: WM,
    onRunCommand: async (raw) => {
      await runUiConsoleCommand(raw);
    },
  });
  window.GQUIConsoleController = uiConsoleController;

  function initUiConsole() {
    if (!uiConsoleController || typeof uiConsoleController.init !== 'function') return false;
    return !!uiConsoleController.init();
  }

  function getUiConsoleVisibleLines() {
    return uiConsoleController.getVisibleLines();
  }

  const runtimeAudioCatalogApi = requireRuntimeApi('GQRuntimeAudioCatalog', [
    'configureAudioCatalogRuntime',
    'resolveAudioTrackLabel',
    'updateTopbarTrackTicker',
    'renderTopbarTrackQuickList',
    'loadAudioTrackCatalog',
  ]);
  const audioTrackOptions = [];
  let audioTrackCatalogLoaded = false;
  let audioTrackCatalogPromise = null;

  function getAudioTrackOptions() {
    return audioTrackOptions;
  }

  function basicEsc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  runtimeAudioCatalogApi.configureAudioCatalogRuntime({
    getAudioTrackOptions: () => audioTrackOptions,
    setAudioTrackOptions: (nextOptions) => {
      audioTrackOptions.splice(0, audioTrackOptions.length, ...(Array.isArray(nextOptions) ? nextOptions : []));
    },
    getAudioTrackCatalogLoaded: () => audioTrackCatalogLoaded,
    setAudioTrackCatalogLoaded: (value) => {
      audioTrackCatalogLoaded = !!value;
    },
    getAudioTrackCatalogPromise: () => audioTrackCatalogPromise,
    setAudioTrackCatalogPromise: (value) => {
      audioTrackCatalogPromise = value || null;
    },
    getSettingsState: () => settingsState,
    getAudioManager: () => audioManager,
    getApi: () => API,
    getSettingsController: () => settingsController,
    esc: basicEsc,
    gameLog,
    documentRef: document,
    windowRef: window,
  });

  function resolveAudioTrackLabel(url) {
    return runtimeAudioCatalogApi.resolveAudioTrackLabel(url);
  }

  function updateTopbarTrackTicker(label) {
    runtimeAudioCatalogApi.updateTopbarTrackTicker(label);
  }

  function renderTopbarTrackQuickList(activeTrackUrl = '') {
    runtimeAudioCatalogApi.renderTopbarTrackQuickList(activeTrackUrl);
  }

  function renderMonoIconButton(button, _iconId, title = '') {
    if (!button) return;
    if (title) {
      button.title = String(title);
      button.setAttribute('aria-label', String(title));
    }
  }

  async function loadAudioTrackCatalog(force = false) {
    return runtimeAudioCatalogApi.loadAudioTrackCatalog(force);
  }

  const runtimeSettingsBootstrapApi = requireRuntimeApi('GQRuntimeSettingsBootstrap', ['createSettingsBootstrap']);
  const runtimeSettingsDefaultsApi = requireRuntimeApi('GQRuntimeSettingsDefaults', [
    'createDefaultSettingsState',
    'createUiThemeModeValues',
  ]);
  const runtimeSettingsStorageApi = requireRuntimeApi('GQRuntimeSettingsStorage', [
    'loadPortableUiSettings',
    'savePortableUiSettings',
  ]);
  const runtimeThemePaletteApi = requireRuntimeApi('GQRuntimeThemePalette', [
    'configureThemeRuntime',
    'normalizeHexColor',
    'resolvePlayerFactionThemeSeed',
    'resolveThemePaletteForSelection',
    'applyUiTheme',
  ]);
  const runtimeHintsApi = requireRuntimeApi('GQRuntimeHints', [
    'configureHintsRuntime',
    'showOrbitModeHintOnce',
    'showGalaxyShortcutsHintOnce',
    'scheduleFleetLegendHint',
  ]);
  const runtimeAudioUiApi = requireRuntimeApi('GQRuntimeAudioUi', ['refreshAudioUi']);
  const runtimeSettingsNormalizationApi = requireRuntimeApi('GQRuntimeSettingsNormalization', ['normalizeLoadedUiSettings']);
  const runtimeAudioSettingsApplyApi = requireRuntimeApi('GQRuntimeAudioSettingsApply', ['applyLoadedAudioSettings']);
  const runtimeThemeSettingsUiApi = requireRuntimeApi('GQRuntimeThemeSettingsUi', [
    'refreshThemeSettingsUi',
    'renderThemePreviewUi',
  ]);
  const runtimeUserMenuUiApi = requireRuntimeApi('GQRuntimeUserMenuUi', [
    'closeUserMenuUi',
    'openUserMenuUi',
    'toggleUserMenuUi',
    'initUserMenuBindings',
  ]);
  const runtimeUserMenuActionsApi = requireRuntimeApi('GQRuntimeUserMenuActions', ['handleUserMenuAction']);
  const runtimeRendererSettingsApplyApi = requireRuntimeApi('GQRuntimeRendererSettingsApply', ['applyRendererRuntimeSettings']);
  const runtimeAudioSettingsMetadataApi = requireRuntimeApi('GQRuntimeAudioSettingsMetadata', ['getAudioSfxEvents']);

  const settingsBootstrap = runtimeSettingsBootstrapApi.createSettingsBootstrap({
    windowRef: window,
    documentRef: document,
    getCurrentUser: () => currentUser,
    getUiState: () => uiState,
    showToast,
    showToastWithAction: showToast,
    gameLog,
    settingsState,
    runtimeSettingsDefaultsApi,
    runtimeSettingsStorageApi,
    runtimeThemePaletteApi,
    runtimeHintsApi,
  });

  const UI_THEME_MODE_VALUES = settingsBootstrap.uiThemeModeValues;
  const UI_THEME_DEFAULT_ACCENT = settingsBootstrap.uiThemeDefaultAccent || '#3aa0ff';
  const GALAXY_FILTERS_ENABLED = window.GQ_GALAXY_FILTERS_ENABLED !== false;
  const AUDIO_SFX_EVENTS = runtimeAudioSettingsMetadataApi.getAudioSfxEvents();

  function loadPortableUiSettings() {
    return settingsBootstrap.loadPortableUiSettings();
  }

  function savePortableUiSettings(payload) {
    settingsBootstrap.savePortableUiSettings(payload);
  }

  function normalizeHexColor(value, fallback = UI_THEME_DEFAULT_ACCENT) {
    return settingsBootstrap.normalizeHexColor(value, fallback);
  }

  function resolvePlayerFactionThemeSeed() {
    return settingsBootstrap.resolvePlayerFactionThemeSeed();
  }

  function resolveThemePaletteForSelection(modeInput, customAccentInput, factionIdInput) {
    return settingsBootstrap.resolveThemePaletteForSelection(modeInput, customAccentInput, factionIdInput);
  }

  function applyUiTheme(reason = 'runtime') {
    settingsBootstrap.applyUiTheme(reason);
    try {
      const src = settingsState?.uiThemeLastSource || 'fallback';
      window.dispatchEvent(new CustomEvent('gq:theme-changed', { detail: { source: src, reason } }));
    } catch (_) {}
  }

  function showOrbitModeHintOnce() {
    settingsBootstrap.showOrbitModeHintOnce();
  }

  function showGalaxyShortcutsHintOnce() {
    settingsBootstrap.showGalaxyShortcutsHintOnce();
  }

  function scheduleFleetLegendHint(delayMs = 1300) {
    settingsBootstrap.scheduleFleetLegendHint(delayMs);
  }

  const runtimeSettingsControllerApi = requireRuntimeApi('GQRuntimeSettingsController', ['createSettingsController']);
  const settingsController = runtimeSettingsControllerApi.createSettingsController({
    windowRef: window,
    documentRef: document,
    settingsState,
    uiState,
    currentUser,
    audioManager,
    getAudioManager: () => audioManager || window.__GQ_AUDIO_MANAGER || null,
    getAudioTrackOptions,
    renderMonoIconButton,
    renderTopbarTrackQuickList,
    resolveAudioTrackLabel,
    updateTopbarTrackTicker,
    loadPortableUiSettings,
    savePortableUiSettings,
    applyTransitionPreset,
    normalizeHexColor,
    uiThemeModeValues: UI_THEME_MODE_VALUES,
    uiThemeDefaultAccent: UI_THEME_DEFAULT_ACCENT,
    galaxyFiltersEnabled: GALAXY_FILTERS_ENABLED,
    applyUiTheme,
    resolvePlayerFactionThemeSeed,
    esc,
    resolveThemePaletteForSelection,
    wm: WM,
    closeTopbarSearchOverlay,
    closeTopbarPlayerMenu,
    showToast,
    api: API,
    loadOverview,
    getGalaxy3d: getGalaxy3dRef,
    getGalaxy3dQualityState: getGalaxy3dQualityStateRef,
    callRendererMethod,
    hasRendererMethod,
    runtimeAudioUiApi,
    runtimeSettingsNormalizationApi,
    runtimeAudioSettingsApplyApi,
    runtimeThemeSettingsUiApi,
    runtimeUserMenuUiApi,
    runtimeUserMenuActionsApi,
    runtimeRendererSettingsApplyApi,
  });
  window.GQSettingsController = settingsController;

  const runtimeSettingsUiHelpersApi = requireRuntimeApi('GQRuntimeSettingsUiHelpers', [
    'formatLastAudioEvent',
    'updateLastAudioEventUi',
    'applyTransitionPreset',
  ]);

  function formatLastAudioEvent(detail) {
    return runtimeSettingsUiHelpersApi.formatLastAudioEvent(detail, {
      audioEvents: AUDIO_SFX_EVENTS,
    });
  }

  function updateLastAudioEventUi(detail) {
    runtimeSettingsUiHelpersApi.updateLastAudioEventUi(detail, {
      documentRef: document,
      formatLastAudioEvent,
      audioEvents: AUDIO_SFX_EVENTS,
    });
  }

  window.addEventListener('gq:audio-event', (ev) => {
    updateLastAudioEventUi(ev?.detail || null);
  });

  window.addEventListener('gq:audio-state', () => {
    settingsController.refreshAudioUi();
  });

  // When WM's CSS theme class changes (e.g. via Command Palette theme commands),
  // trigger a full palette re-apply so CSS custom properties stay in sync.
  window.addEventListener('gq:wm-theme-changed', () => {
    applyUiTheme('runtime');
  });

  function applyTransitionPreset(presetName) {
    runtimeSettingsUiHelpersApi.applyTransitionPreset(presetName, settingsState);
  }

  const runtimePayloadValidationApi = requireRuntimeApi('GQRuntimePayloadValidation', ['hasPlanetTextureManifest']);

  function hasPlanetTextureManifest(payload) {
    return runtimePayloadValidationApi.hasPlanetTextureManifest(payload);
  }

  const runtimeUiTemplateHelpersApi = requireRuntimeApi('GQRuntimeUiTemplateHelpers', [
    'esc',
    'renderInlineTemplate',
    'renderInlineTemplateList',
    'uiKitTemplateHTML',
    'uiKitEmptyStateHTML',
    'uiKitSkeletonHTML',
    'waitMs',
  ]);
  const runtimeQuickNavFacadeApi = requireRuntimeApi('GQRuntimeQuickNavFacade', ['createQuickNavFacade']);
  const runtimeGalaxyHoverCardFacadeApi = requireRuntimeApi('GQRuntimeGalaxyHoverCardFacade', ['createGalaxyHoverCardFacade']);
  const runtimeGalaxyClusterRangeControlsApi = requireRuntimeApi('GQRuntimeGalaxyClusterRangeControls', ['createGalaxyClusterRangeControls']);
  const runtimeGalaxySystemDetailsFacadeApi = requireRuntimeApi('GQRuntimeGalaxySystemDetailsFacade', ['createGalaxySystemDetailsFacade']);

  function esc(str) {
    return runtimeUiTemplateHelpersApi.esc(str);
  }

  function renderInlineTemplate(template, data = {}) {
    return runtimeUiTemplateHelpersApi.renderInlineTemplate(template, data, {
      windowRef: window,
    });
  }

  function renderInlineTemplateList(template, rows) {
    return runtimeUiTemplateHelpersApi.renderInlineTemplateList(template, rows, {
      windowRef: window,
    });
  }

  function uiKitTemplateHTML(templateId) {
    return runtimeUiTemplateHelpersApi.uiKitTemplateHTML(templateId, {
      windowRef: window,
      documentRef: document,
    });
  }

  function uiKitEmptyStateHTML(title, text) {
    return runtimeUiTemplateHelpersApi.uiKitEmptyStateHTML(title, text, {
      windowRef: window,
      documentRef: document,
    });
  }

  function uiKitSkeletonHTML() {
    return runtimeUiTemplateHelpersApi.uiKitSkeletonHTML({
      windowRef: window,
      documentRef: document,
    });
  }

  function waitMs(ms) {
    return runtimeUiTemplateHelpersApi.waitMs(ms);
  }

  function canUsePhysicsFlightPath(target) {
    return runtimeGalaxyPhysicsFlightApi.canUsePhysicsFlightPath(target);
  }

  async function runPhysicsCinematicFlight(target, opts = {}) {
    return runtimeGalaxyPhysicsFlightApi.runPhysicsCinematicFlight(target, opts);
  }

  function starSearchKey(star) {
    return runtimeGalaxySearchScoringApi.starSearchKey(star);
  }

  function scoreStarSearchMatch(star, queryLower, systemExact) {
    return runtimeGalaxySearchScoringApi.scoreStarSearchMatch(star, queryLower, systemExact);
  }

  function collectLocalStarSearch(query, limit = 10) {
    return runtimeGalaxySearchScoringApi.collectLocalStarSearch(query, limit);
  }

  runtimeTopbarSearchApi.configureTopbarSearchRuntime({
    getTopbarSearchStore: () => topbarSearchStore,
    collectLocalStarSearch,
    starSearchKey,
    getActiveGalaxy: () => Number(uiState?.activeGalaxy || 1),
    api: API,
    esc: basicEsc,
    renderInlineTemplate,
    closeCommanderMenuPanel,
    closeTopbarPlayerMenu,
    setTopbarMenuFocusTrap,
    syncTopbarBottomSheetState,
    focusFirstInTopbarMenu,
    clearTopbarMenuFocusTrap,
    isTopbarMenuFocusTrapped,
    onJumpToSearchStar: async (star) => {
      const root = WM?.body?.('galaxy') || null;
      await focusHomeSystemInGalaxy(root, { silent: true, preferStar: star });
    },
    documentRef: document,
    windowRef: window,
  });

  function starClassColor(spectralClass) {
    return runtimeGalaxyVisualUtilsApi.starClassColor(spectralClass);
  }

  function planetIcon(planetClass) {
    return runtimeGalaxyVisualUtilsApi.planetIcon(planetClass);
  }

  const galaxyHoverCardFacade = runtimeGalaxyHoverCardFacadeApi.createGalaxyHoverCardFacade({
    documentRef: document,
    windowRef: window,
    esc,
    fmtName,
    countdown,
    planetIcon,
    starClassColor,
    getPinnedStar: () => pinnedStar,
    getColonies: () => colonies,
  });
  const galaxyClusterRangeControls = runtimeGalaxyClusterRangeControlsApi.createGalaxyClusterRangeControls({
    getGalaxySystemMax: () => galaxySystemMax,
    setActiveRange: (range) => {
      uiState.activeRange = range;
    },
    showToast,
  });

  function getNearestSystemNeighbors(star, limit = 3) {
    const sourceGalaxy = Number(star?.galaxy_index || 0);
    const sourceSystem = Number(star?.system_index || 0);
    const sx = Number(star?.x_ly ?? 0);
    const sy = Number(star?.y_ly ?? 0);
    const sz = Number(star?.z_ly ?? 0);
    if (!sourceGalaxy || !sourceSystem) return [];

    return (Array.isArray(galaxyStars) ? galaxyStars : [])
      .filter((candidate) => {
        if (!candidate) return false;
        const cg = Number(candidate.galaxy_index || 0);
        const cs = Number(candidate.system_index || 0);
        if (!cg || !cs) return false;
        return !(cg === sourceGalaxy && cs === sourceSystem);
      })
      .map((candidate) => {
        const dx = Number(candidate.x_ly ?? 0) - sx;
        const dy = Number(candidate.y_ly ?? 0) - sy;
        const dz = Number(candidate.z_ly ?? 0) - sz;
        const distance = Math.hypot(dx, dy, dz);
        return {
          galaxy_index: Number(candidate.galaxy_index || 0),
          system_index: Number(candidate.system_index || 0),
          name: String(candidate.name || candidate.catalog_name || `System ${Number(candidate.system_index || 0)}`),
          distance_ly: Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY,
        };
      })
      .filter((entry) => Number.isFinite(entry.distance_ly))
      .sort((a, b) => a.distance_ly - b.distance_ly)
      .slice(0, Math.max(1, Number(limit || 3)));
  }

  async function navigateToSystemNeighbor(target = {}) {
    const targetGalaxy = Number(target.galaxy_index || 0);
    const targetSystem = Number(target.system_index || 0);
    if (!targetGalaxy || !targetSystem) return;

    const targetStar = (Array.isArray(galaxyStars) ? galaxyStars : []).find((candidate) =>
      Number(candidate?.galaxy_index || 0) === targetGalaxy
      && Number(candidate?.system_index || 0) === targetSystem
    );
    if (!targetStar) {
      showToast('Nachbarsystem nicht in der aktuellen Sternliste gefunden.', 'warning');
      return;
    }

    const root = WM?.body?.('galaxy') || null;
    await loadStarSystemPlanets(root, targetStar);
  }

  const galaxySystemDetailsFacade = runtimeGalaxySystemDetailsFacadeApi.createGalaxySystemDetailsFacade({
    esc,
    settingsState,
    getGalaxy3d: () => galaxy3d,
    getWindowRef: () => window,
    triggerGalaxyNavAction,
    applyClusterRangeToControls,
    flashGalaxyControlBtn,
    loadGalaxyStars3D,
    isFavoriteStar,
    addFavorite,
    removeFavorite,
    showToast,
    updateFooterQuickNavBadge,
    refreshWindow: (id) => WM.refresh(id),
    prefillFleetTarget,
    getUiState: () => uiState,
    getColonies: () => colonies,
    openColonySubview,
    isCurrentUserAdmin,
    rerenderSystemDetails: (renderRoot, renderStar, renderZoomed) => {
      renderGalaxySystemDetails(renderRoot, renderStar, renderZoomed);
    },
    isSystemModeActive,
    getNearestSystemNeighbors,
    navigateToSystemNeighbor,
  });

  function buildingZoneLabel(zone) {
    return runtimeColonySurfaceSlotMappingApi.buildingZoneLabel(zone);
  }

  function buildColonyGridCells(layout, buildings) {
    return runtimeColonySurfaceSlotMappingApi.buildColonyGridCells(layout, buildings);
  }

  function mapBuildingToVfxProfile(building) {
    return runtimeColonySurfaceSlotMappingApi.mapBuildingToVfxProfile(building);
  }

  function buildColonySurfaceVfxSlots(colony, buildingPayload) {
    return runtimeColonySurfaceSlotMappingApi.buildColonySurfaceVfxSlots(colony, buildingPayload);
  }

  function queueColonySurfaceSceneData(colony, buildingPayload) {
    runtimeColonySurfaceSlotMappingApi.queueColonySurfaceSceneData(colony, buildingPayload);
  }

  const runtimeDesktopShellApi = requireRuntimeApi('GQRuntimeDesktopShell', [
    'createWindowRegistry',
    'createNavigationController',
    'selfHealGalaxyWindow',
    'registerGameCommands',
    'registerGlobalHotkeys',
  ]);

  class GameRuntime {
    constructor() {
      this.initialized = false;
    }

    initUi() {
      if (this.initialized) return;
      settingsController.loadUiSettings();
      settingsController.initUserMenu();
      initUiConsole();
      initTopbarSearch();
      this.initialized = true;
    }
  }

  const gameRuntime = new GameRuntime();
  window.GQGameRuntime = gameRuntime;
  gameRuntime.initUi();

  const windowRegistry = runtimeDesktopShellApi.createWindowRegistry({
    wm: WM,
    renderers: {
      renderOverview,
      renderBuildings,
      renderColonyView,
      renderResearch,
      renderShipyard,
      renderFleetForm,
      renderWormholes,
      renderGalaxyWindow,
      renderGalaxyInfoWindow,
      renderMessages,
      renderIntel,
      renderTradeRoutes,
      renderTradersDashboard,
      renderPirates,
      renderConflict,
      renderEconomyFlow,
      renderEconomy,
      renderLogisticsRoutes,
      renderTradeProposals,
      renderQuests,
      renderLeaderboard,
      renderLeaders,
      renderFactions,
      renderAlliances,
      renderWars,
      renderNavOrb,
      renderSettings,
      renderQuickNav,
      renderMinimap,
    },
  });
  window.GQWindowRegistry = windowRegistry;
  windowRegistry.registerAll();
  if (WM && typeof WM.restorePersistedState === 'function') {
    WM.restorePersistedState();
  }

  // ── Navigation Sequences ─────────────────────────────────────────────────
  if (typeof window.GQRuntimeNavigationSequences !== 'undefined') {
    const navSeqApi = window.GQRuntimeNavigationSequences.createNavigationSequenceController({
      wm: WM,
      gameLog,
      settingsState,
    });
    window.GQNavigationSequences = navSeqApi;
    navSeqApi.registerAllSequences();
  }

  runtimeDesktopShellApi.registerGameCommands({
    wm: WM,
    showToast,
    gameLog,
  });

  runtimeDesktopShellApi.registerGlobalHotkeys({
    wm: WM,
    windowRef: window,
    showToast,
    gameLog,
  });

  runtimeDesktopShellApi.selfHealGalaxyWindow({
    wm: WM,
    documentRef: document,
    gameLog,
  });

  // ÔöÇÔöÇ Colony selector ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const planetSelect = document.getElementById('planet-select');
  const navigationController = runtimeDesktopShellApi.createNavigationController({
    wm: WM,
    api: API,
    audio: audioManager,
    planetSelect,
    documentRef: document,
    windowRef: window,
    loadOverview,
    focusHomeSystemInGalaxy,
    openResourceInsight,
    selectColonyById,
    showToast,
    gameLog,
    settingsState,
    applyRuntimeSettings: applyRuntimeSettingsRef,
    saveUiSettings: saveUiSettingsRef,
    refreshAudioUi: refreshAudioUiRef,
    updateTopbarOrbitBadge,
    showOrbitModeHintOnce,
    topbarAudioControlsApi: runtimeTopbarAudioControlsApi,
    audioTrackOptions,
    closeTopbarPlayerMenu,
    closeTopbarSearchOverlay,
    closeCommanderMenuPanel,
    setTopbarMenuFocusTrap,
    syncTopbarBottomSheetState,
    focusFirstInTopbarMenu,
    loadAudioTrackCatalog,
  });
  window.GQNavigationController = navigationController;
  navigationController.init();

  // Initialize Settings Panel with 2FA support
  if (typeof window.GQSettingsPanel !== 'undefined' && typeof window.GQSettingsPanel.init === 'function') {
    window.GQSettingsPanel.init({
      gameState: settingsState,
      onSave: (changes) => {
        console.log('[Game] Settings saved:', changes);
        settingsController.applyRuntimeSettings();
        // Propagate volume changes to audio system
        if (audioManager && changes.hasOwnProperty('masterVolume')) {
          if (typeof audioManager.setMasterVolume === 'function') {
            audioManager.setMasterVolume(changes.masterVolume);
          }
        }
      },
      onCommit2FA: (changes, callback) => {
        // Trigger 2FA authentication flow
        console.log('[Game] 2FA commit requested for:', changes);
        // Show 2FA challenge modal
        // For now, simulate with a simple confirm dialog
        const verified = window.confirm('Bestätigen Sie die Änderungen mit 2FA?');
        if (typeof callback === 'function') {
          callback(verified);
        }
      },
    });
    console.log('[Game] Settings Panel initialized');
  }

  function selectColonyById(cid, opts = {}) {
    const colonyId = Number(cid || 0);
    currentColony = colonies.find(c => c.id === colonyId) || null;
    if (currentColony && planetSelect) planetSelect.value = String(currentColony.id);
    if (opts.focusBuilding && currentColony) {
      setColonyViewFocus(currentColony.id, opts.focusBuilding, opts.focusSource || 'select-colony');
    }
    updateResourceBar();
    ['overview','colony','buildings','research','shipyard','fleet'].forEach(id => WM.refresh(id));
    if (opts.openWindows) {
      WM.open('colony');
      WM.open('buildings');
      if (opts.openOverview) WM.open('overview');
    }
  }

  const runtimeFleetMissionDefaultsApi = requireRuntimeApi('GQRuntimeFleetMissionDefaults', ['createFleetMissionDefaultsHelper']);
  const fleetMissionDefaultsHelper = runtimeFleetMissionDefaultsApi.createFleetMissionDefaultsHelper({
    getCurrentColony: () => currentColony,
    esc,
  });
  const runtimeFleetSubmitFlowApi = requireRuntimeApi('GQRuntimeFleetSubmitFlow', ['createFleetSubmitFlowHelper']);
  const fleetSubmitFlowHelper = runtimeFleetSubmitFlowApi.createFleetSubmitFlowHelper({
    api: API,
    getCurrentColony: () => currentColony,
    getAudioManager: () => audioManager,
    loadOverview,
    showToast,
    gameLog,
  });
  const runtimeFleetStatusPanelsApi = requireRuntimeApi('GQRuntimeFleetStatusPanels', ['createFleetStatusPanelsHelper']);
  const fleetStatusPanelsHelper = runtimeFleetStatusPanelsApi.createFleetStatusPanelsHelper({
    wm: WM,
    api: API,
    showToast,
    esc,
  });
  const runtimeFleetControllerApi = requireRuntimeApi('GQRuntimeFleetController', ['createFleetController']);
  const fleetController = runtimeFleetControllerApi.createFleetController({
    wm: WM,
    api: API,
    getCurrentColony: () => currentColony,
    getUiState: () => uiState,
    esc,
    fmtName,
    gameLog,
    missionDefaultsHelper: fleetMissionDefaultsHelper,
    submitFlowHelper: fleetSubmitFlowHelper,
    statusPanelsHelper: fleetStatusPanelsHelper,
  });
  window.GQFleetController = fleetController;

  function prefillFleetTarget(coords, mission, defaults = {}) {
    fleetController.prefillTarget(coords, mission, defaults);
  }
  const runtimeWormholeControllerApi = requireRuntimeApi('GQRuntimeWormholeController', ['createWormholeController']);
  const wormholeController = runtimeWormholeControllerApi.createWormholeController({
    wm: WM,
    api: API,
    getCurrentColony: () => currentColony,
    waitMs,
    showToast,
    uiKitEmptyStateHTML,
    uiKitSkeletonHTML,
    esc,
    fmt,
    gameLog,
  });
  window.GQWormholeController = wormholeController;

  async function renderWormholes() {
    await wormholeController.render();
  }

  const runtimeGalaxyControllerNavigationApi = requireRuntimeApi('GQRuntimeGalaxyControllerNavigation', ['createGalaxyControllerNavigation']);
  const runtimeGalaxyControllerActionsApi = requireRuntimeApi('GQRuntimeGalaxyControllerActions', ['createGalaxyControllerActions']);
  const runtimeGalaxyControllerWindowApi = requireRuntimeApi('GQRuntimeGalaxyControllerWindow', ['createGalaxyControllerWindow']);
  const runtimeGalaxyControllerRenderWindowFlowApi = requireRuntimeApi('GQRuntimeGalaxyControllerRenderWindowFlow', ['createGalaxyControllerRenderWindowFlow']);
  const runtimeGalaxyControllerControlUiApi = requireRuntimeApi('GQRuntimeGalaxyControllerControlUi', ['createGalaxyControllerControlUi']);
  const runtimeGalaxyControllerStarLoadingApi = requireRuntimeApi('GQRuntimeGalaxyControllerStarLoading', ['createGalaxyControllerStarLoading']);
  const runtimeGalaxyControllerFacadeApi = requireRuntimeApi('GQRuntimeGalaxyControllerFacade', ['createGalaxyControllerFacade']);
  const runtimeGalaxyControllerBootstrapApi = requireRuntimeApi('GQRuntimeGalaxyControllerBootstrap', ['createGalaxyControllerBootstrap']);
  const galaxyControllerBootstrap = runtimeGalaxyControllerBootstrapApi.createGalaxyControllerBootstrap({
    wm: WM,
    documentRef: document,
    runtimeGalaxyControllerFacadeApi,
    runtimeGalaxyControllerStarLoadingApi,
    runtimeGalaxyControllerControlUiApi,
    runtimeGalaxyControllerWindowApi,
    runtimeGalaxyControllerRenderWindowFlowApi,
    runtimeGalaxyControllerActionsApi,
    runtimeGalaxyControllerNavigationApi,
    runtimeGalaxyInit3DFacadeApi,
    runtimeGalaxyStarLoaderFacadeApi,
    runtimeGalaxyControlUiApi,
    runtimeGalaxyWindowBindingsApi,
    isPolicyModeAuto,
    applyPolicyMode,
    refreshPolicyUi,
    getGalaxyStars: () => galaxyStars,
    setGalaxyStars: setGalaxyStarsRef,
    getUiState: getUiStateRef,
    setGalaxyContext,
    getStarsPolicy: () => LEVEL_POLICIES.galaxy.stars,
    getSettingsState: getSettingsStateRef,
    getRenderDataAdapter: () => window.GQRenderDataAdapter || API,
    getExpectedAssetsManifestVersion: () => Number(window.GQ_ASSETS_MANIFEST_VERSION || 1),
    getGalaxySystemMax: () => galaxySystemMax,
    setGalaxySystemMax: setGalaxySystemMaxRef,
    isCurrentUserAdmin,
    mergeGalaxyStarsBySystem,
    assignClusterFactions,
    renderGalaxyFallbackList,
    renderGalaxyColonySummary,
    refreshGalaxyDensityMetrics,
    getGalaxy3d: () => galaxy3d,
    isSystemModeActive,
    hydrateGalaxyRangeInBackground,
    gameLog,
    pushGalaxyDebugError,
    getGalaxy3dInitReason: getGalaxy3dInitReasonRef,
    runtimeGalaxyStarUiStatusApi,
    runtimeGalaxyStarBootstrapPreflightApi,
    runtimeGalaxyStarLoadingHelpersApi,
    runtimeGalaxyStarTerritorySyncApi,
    runtimeGalaxyStarCacheReadApi,
    runtimeGalaxyStarFlowOrchestratorApi,
    runtimeGalaxyStarNetworkFlowApi,
    runtimeGalaxyStarPersistenceApi,
    runtimeGalaxyStarFallbackRecoveryApi,
    runtimeGalaxyStarErrorUiApi,
    galaxySystemMax,
    getActivePolicyMode,
    getActivePolicyProfile,
    policyProfiles: POLICY_PROFILES,
    settingsState,
    getGalaxyHealthLastCheckMs: () => galaxyHealthLastCheckMs,
    refreshGalaxyHealth,
    bindGalaxyNavOrb,
    showGalaxyShortcutsHintOnce,
    scheduleFleetLegendHint,
    updateGalaxyFollowUi,
    updateClusterBoundsUi,
    updateGalaxyColonyFilterUi,
    showToast,
    getAudioManager: () => audioManager,
    runRendererNavAction,
    settingsController,
    callRendererMethod,
    getPinnedStar: () => pinnedStar,
    uiState,
    toggleGalaxyOverlay,
    renderGalaxySystemDetails,
    loadStarSystemPlanets,
    transitionOutOfSystemView,
    closeTopbarSearchOverlay,
    getTopbarSearchDom,
    loadGalaxyStars3D,
    setPinnedStar: (value) => { pinnedStar = value; },
    runPhysicsCinematicFlight,
    colonies,
    getCurrentColony: () => currentColony,
    selectColonyById,
    waitMs,
    focusSystemPlanetInView,
  });
  const galaxyController = galaxyControllerBootstrap.galaxyController;
  window.GQGalaxyController = galaxyController;

  async function focusHomeSystemInGalaxy(root, opts = {}) {
    await galaxyController.focusHomeSystem(root, opts);
  }

  function pickFleetDefaultShips(mission, avail, intel) {
    return fleetController.pickDefaultShips(mission, avail, intel);
  }

  function applyFleetMissionDefaults(root, avail, prefill) {
    fleetController.applyMissionDefaults(root, avail, prefill);
  }

  async function getPlanetIntel(galaxy, system, position, opts = {}) {
    const key = `${Number(galaxy || 0)}:${Number(system || 0)}:${Number(position || 0)}`;
    const cached = uiState.intelCache.get(key);
    if (!opts.force && cached && (Date.now() - cached.ts) < 60 * 1000) {
      return cached.value;
    }
    const result = await API.planetIntel(galaxy, system, position);
    if (result?.success) {
      uiState.intelCache.set(key, { ts: Date.now(), value: result });
      return result;
    }
    return result;
  }

  function renderForeignIntel(detail, payload) {
    const extra = detail.querySelector('.planet-detail-extra');
    if (!extra) return;
    const intel = payload?.intel || null;
    const territory = Array.isArray(payload?.territory) ? payload.territory : [];
    const clusters = uiState.clusterSummary || [];
    if (!intel) {
      extra.innerHTML = '<div class="planet-detail-row">Keine belastbaren Sektor- oder Scan-Daten vorhanden.</div>';
      return;
    }
    const scan = intel.latest_scan;
    const scanHealth = Number(scan?.health_pct);
    const scanShield = Number(scan?.shield_pct);
    const scanBarsHtml = Number.isFinite(scanHealth) || Number.isFinite(scanShield)
      ? buildEntityBarsHtml(
        Number.isFinite(scanHealth) ? scanHealth : 0,
        Number.isFinite(scanShield) ? scanShield : 0,
        'Scanned colony'
      )
      : '';
    extra.innerHTML = `
      <div class="planet-detail-row">Bedrohungsgrad: <span class="threat-chip threat-${esc(intel.threat.level)}">${esc(intel.threat.label)} | ${esc(String(intel.threat.score))}</span></div>
      <div class="planet-detail-row">Letzter Scan: ${intel.latest_scan_at ? esc(new Date(intel.latest_scan_at).toLocaleString()) : 'Kein Scan vorhanden'}</div>
      <div class="planet-detail-row">Scanlage: ${scan ? `${esc(String(scan.ship_count))} Schiffe | Kampfkraft ${esc(String(scan.combat_power_estimate))} | Leader ${esc(String(scan.leader_count))}` : 'Erstspionage empfohlen'}</div>
      ${scanBarsHtml}
      <div class="planet-detail-row">Diplomatie: ${esc(payload.diplomacy_hint || 'Keine Einschaetzung verfuegbar.')}</div>
      <div class="territory-mini-list">${territory.slice(0, 3).map((f) => `
        <span class="territory-chip" style="--territory-color:${esc(f.color)}">${esc(f.icon)} ${esc(f.name)} | ${esc(f.government?.icon || 'GOV')} ${esc(f.government?.label || 'Herrschaft')}</span>`).join('') || '<span class="text-muted">Keine Sektoransprueche</span>'}
      </div>
      ${clusters.length ? `<div class="planet-detail-row">Cluster: ${clusters.slice(0, 2).map((cluster) => `${esc(cluster.label)} ${esc(String(cluster.from))}-${esc(String(cluster.to))}`).join(' | ')}</div>` : ''}`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ►► PROBLEM PRE-WARNINGS SYSTEM ◄◄
  // Automatically detects and displays critical game state issues
  // ─────────────────────────────────────────────────────────────────────────
  
  const runtimeColonyWarningsApi = requireRuntimeApi('GQRuntimeColonyWarnings', ['createColonyWarnings']);
  const colonyWarnings = runtimeColonyWarningsApi.createColonyWarnings({ fmt });

  function detectColonyWarnings(colony, offline) {
    return colonyWarnings.detectColonyWarnings(colony, offline);
  }

  function buildWarningsHtml(colony, offline) {
    return colonyWarnings.buildWarningsHtml(colony, offline);
  }

  const runtimeOverviewInsightsApi = requireRuntimeApi('GQRuntimeOverviewInsights', ['createOverviewInsights']);
  const runtimeOverviewListsApi = requireRuntimeApi('GQRuntimeOverviewLists', ['createOverviewLists']);
  const runtimeOverviewActionsApi = requireRuntimeApi('GQRuntimeOverviewActions', ['createOverviewActions']);
  const runtimeOverviewControllerApi = requireRuntimeApi('GQRuntimeOverviewController', ['createOverviewController']);
  const runtimeOverviewBootstrapApi = requireRuntimeApi('GQRuntimeOverviewBootstrap', ['createOverviewBootstrap']);
  const overviewController = runtimeOverviewBootstrapApi.createOverviewBootstrap({
    runtimeOverviewInsightsApi,
    runtimeOverviewListsApi,
    runtimeOverviewActionsApi,
    runtimeOverviewControllerApi,
    api: API,
    wm: WM,
    windowRef: window,
    documentRef: document,
    fmt,
    fmtName,
    esc,
    countdown,
    showToast,
    getAudioManager: () => audioManager,
    getUiState: () => uiState,
    getCurrentColony: () => currentColony,
    setCurrentColony: (value) => { currentColony = value; },
    getColonies: () => colonies,
    setColonies: (val) => { colonies = val; },
    getPlanetSelect: () => planetSelect,
    getResourceInsightConfig,
    getResourceInsightValue,
    getResourceInsightTotal,
    formatResourceInsightValue,
    focusColonyDevelopment,
    openFleetTransportPlanner,
    openTradeMarketplace,
    shouldRedirectOnAuthLoadError,
    redirectToLogin,
    getGalaxy3d: () => galaxy3d,
    uiKitEmptyStateHTML,
    selectColonyById,
    buildWarningsHtml: (colony, offline) => colonyWarnings.buildWarningsHtml(colony, offline),
    renderInlineTemplate,
    renderInlineTemplateList,
  }).overviewController;
  window.GQOverviewController = overviewController;

  function populatePlanetSelect() {
    overviewController.populatePlanetSelect();
  }

  // ÔöÇÔöÇ Resource bar ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  function updateResourceBar() {
    overviewController.updateResourceBar();
  }

  // ÔöÇÔöÇ Overview data load ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function loadOverview() {
    await overviewController.load();
  }

  // ÔöÇÔöÇ Overview window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  function renderOverview() {
    overviewController.render();
  }

  const runtimeColonyViewControllerApi = requireRuntimeApi('GQRuntimeColonyViewController', ['createColonyViewController']);
  const runtimeEconomyFlowControllerApi = requireRuntimeApi('GQRuntimeEconomyFlowController', ['createEconomyFlowController']);
  const runtimeEconomyControllerApi = requireRuntimeApi('GQRuntimeEconomyController', ['createEconomyController']);
  const runtimeBuildingUpgradePreviewApi = requireRuntimeApi('GQRuntimeBuildingUpgradePreview', ['createBuildingUpgradePreview']);
  const runtimeBuildingsControllerApi = requireRuntimeApi('GQRuntimeBuildingsController', ['createBuildingsController']);
  const runtimeResearchControllerApi = requireRuntimeApi('GQRuntimeResearchController', ['createResearchController']);
  const runtimeShipyardControllerApi = requireRuntimeApi('GQRuntimeShipyardController', ['createShipyardController']);
  const runtimeDevelopmentControllersBootstrapApi = requireRuntimeApi('GQRuntimeDevelopmentControllersBootstrap', ['createDevelopmentControllersBootstrap']);
  const developmentControllers = runtimeDevelopmentControllersBootstrapApi.createDevelopmentControllersBootstrap({
    runtimeColonyViewControllerApi,
    runtimeEconomyFlowControllerApi,
    runtimeEconomyControllerApi,
    runtimeBuildingUpgradePreviewApi,
    runtimeBuildingsControllerApi,
    runtimeResearchControllerApi,
    runtimeShipyardControllerApi,
    wm: WM,
    api: API,
    windowRef: window,
    documentRef: document,
    getCurrentColony: () => currentColony,
    getUiState: () => uiState,
    getColonies: () => colonies,
    getGalaxy3d: () => galaxy3d,
    resourceInsightConfig: RESOURCE_INSIGHT_CONFIG,
    buildColonyGridCells,
    buildingZoneLabel,
    pickZoneBuildFocus,
    getBuildingUiMeta,
    getRecommendedBuildingFocus,
    selectColonyById,
    focusColonyDevelopment,
    queueColonySurfaceSceneData,
    fmtName,
    esc,
    fmt,
    countdown,
    updateResourceBar,
    showToast,
    gameLog,
    getAudioManager: () => audioManager,
    invalidateGetCache: (hint) => API.invalidateGetCache ? API.invalidateGetCache(hint) : undefined,
    GQUI: window.GQUI || null,
  });
  const colonyViewController = developmentControllers.colonyViewController;
  const economyFlowController = developmentControllers.economyFlowController;
  const economyController = developmentControllers.economyController;
  const buildingsController = developmentControllers.buildingsController;
  const researchController = developmentControllers.researchController;
  const shipyardController = developmentControllers.shipyardController;

  window.GQEconomyFlowController = economyFlowController;
  window.GQEconomyController = economyController;
  window.GQColonyViewController = colonyViewController;
  window.GQBuildingsController = buildingsController;
  window.GQResearchController = researchController;
  window.GQShipyardController = shipyardController;

  async function renderEconomyFlow() { await economyFlowController.render(); }
  async function renderEconomy() { if (economyController) await economyController.render(); }

  async function renderColonyView() {
    await colonyViewController.render();
  }

  async function renderBuildings() {
    await buildingsController.render();
  }

  async function renderResearch() {
    await researchController.render();
  }

  async function renderShipyard() {
    await shipyardController.render();
  }

  // ÔöÇÔöÇ Fleet window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderFleetForm() {
    await fleetController.renderForm();
  }

  // ÔöÇÔöÇ Galaxy window (3D) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  function toggleGalaxyOverlay(root, selector, forceVisible) {
    return runtimeGalaxyOverlayControlsApi.toggleGalaxyOverlay(root, selector, forceVisible);
  }

  function makeGalaxyOverlayDraggable(root, selector) {
    runtimeGalaxyOverlayControlsApi.makeGalaxyOverlayDraggable(root, selector);
  }

  function bindGalaxyOverlayHotkeys() {
    runtimeGalaxyOverlayControlsApi.bindGalaxyOverlayHotkeys();
  }

  function triggerGalaxyNavAction(action, rootRef = null) {
    runtimeGalaxyOverlayControlsApi.triggerGalaxyNavAction(action, rootRef);
  }

  function bindGalaxyNavOrb(root) {
    const overlay = root?.querySelector('#galaxy-nav-orb-overlay');
    if (!overlay || overlay.dataset.bound === '1') return;
    overlay.dataset.bound = '1';

    overlay.querySelectorAll('[data-nav-action]').forEach((button) => {
      runtimeGalaxyNavOrbRepeatApi.bindNavRepeatButton(button, root);
    });

    const canvas = overlay.querySelector('#galaxy-nav-gizmo');
    const modeBadge = overlay.querySelector('#galaxy-nav-mode-badge');
    const zoomSlider = overlay.querySelector('#gal-nav-zoom-slider');
    const zoomValue = overlay.querySelector('#gal-nav-zoom-value');
    const fovSlider = overlay.querySelector('#gal-nav-fov-slider');
    const fovValue = overlay.querySelector('#gal-nav-fov-value');
    const debugToggle = overlay.querySelector('#gal-nav-debug-toggle');
    const snapToggle = overlay.querySelector('#gal-nav-snap-toggle');
    const holdRateSlider = overlay.querySelector('#gal-nav-hold-rate-slider');
    const holdRateValue = overlay.querySelector('#gal-nav-hold-rate-value');
    const rollSpeedSlider = overlay.querySelector('#gal-nav-roll-speed-slider');
    const rollSpeedValue = overlay.querySelector('#gal-nav-roll-speed-value');
    const zoomCurveSlider = overlay.querySelector('#gal-nav-zoom-curve-slider');
    const zoomCurveValue = overlay.querySelector('#gal-nav-zoom-curve-value');
    const fovCurveSlider = overlay.querySelector('#gal-nav-fov-curve-slider');
    const fovCurveValue = overlay.querySelector('#gal-nav-fov-curve-value');
    const presetButtons = Array.from(overlay.querySelectorAll('[data-nav-preset]'));

    const navOrbTuning = uiState.navOrbTuning || (uiState.navOrbTuning = {
      debugHitZones: false,
      snapOnDoubleClick: true,
      holdRateMs: 100,
      holdDelayMs: 170,
      rollStepRad: 0.052,
      zoomCurveExp: 1,
      fovCurveExp: 1,
      preset: 'balanced',
    });

    const NAV_ORB_PRESETS = {
      precise: {
        holdRateMs: 145,
        holdDelayMs: 220,
        rollStepRad: 0.03,
        zoomCurveExp: 1.35,
        fovCurveExp: 1.2,
      },
      balanced: {
        holdRateMs: 100,
        holdDelayMs: 170,
        rollStepRad: 0.052,
        zoomCurveExp: 1,
        fovCurveExp: 1,
      },
      cinematic: {
        holdRateMs: 132,
        holdDelayMs: 210,
        rollStepRad: 0.038,
        zoomCurveExp: 1.6,
        fovCurveExp: 1.45,
      },
      fast: {
        holdRateMs: 62,
        holdDelayMs: 110,
        rollStepRad: 0.085,
        zoomCurveExp: 0.8,
        fovCurveExp: 0.82,
      },
      planet_inspect: {
        holdRateMs: 152,
        holdDelayMs: 230,
        rollStepRad: 0.024,
        zoomCurveExp: 1.85,
        fovCurveExp: 1.72,
      },
      galaxy_sweep: {
        holdRateMs: 56,
        holdDelayMs: 90,
        rollStepRad: 0.102,
        zoomCurveExp: 0.68,
        fovCurveExp: 0.7,
      },
    };

    const NAV_ORB_PRESET_LABELS = {
      precise: 'Precise',
      balanced: 'Balanced',
      cinematic: 'Cinematic',
      fast: 'Fast',
      planet_inspect: 'Planet Inspect',
      galaxy_sweep: 'Galaxy Sweep',
      custom: 'Custom',
    };

    let hoverAction = null;

    const readMode = () => {
      const inSystem = isSystemModeActive();
      const hasPlanet = !!(galaxy3d?.systemSelectedEntry || uiState?.activePlanet);
      const hasInfra = !!window?._GQ_ftl_map?.success;
      const shipsOn = settingsState.galaxyFleetVectorsVisible !== false;
      if (hasPlanet) return { key: 'planet', label: 'PLANET' };
      if (inSystem && hasInfra && shipsOn) return { key: 'system-plus', label: 'SYSTEM+' };
      if (inSystem) return { key: 'system', label: 'SYSTEM' };
      if (hasInfra && shipsOn) return { key: 'infrastructure', label: 'INFRA+SHIPS' };
      if (hasInfra) return { key: 'infrastructure', label: 'INFRA' };
      if (shipsOn) return { key: 'ships', label: 'SHIPS' };
      return { key: 'galaxy', label: 'GALAXY' };
    };

    const applyModeStyle = () => {
      const mode = readMode();
      overlay.dataset.navMode = mode.key;
      if (modeBadge) {
        modeBadge.textContent = mode.label;
        modeBadge.className = `galaxy-nav-mode-badge is-${mode.key}`;
      }
    };

    const getCameraBasis = () => {
      const cam = galaxy3d?.camera;
      const three = window.THREE;
      if (!cam || !cam.quaternion || !three?.Vector3) {
        return null;
      }
      const right = new three.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).normalize();
      const up = new three.Vector3(0, 1, 0).applyQuaternion(cam.quaternion).normalize();
      const forward = new three.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
      return { right, up, forward };
    };

    const projectWorldAxis = (axis, basis) => {
      if (!basis || !axis || typeof axis.dot !== 'function') {
        return { x: 0, y: 0, depth: 0 };
      }
      return {
        x: axis.dot(basis.right),
        y: axis.dot(basis.up),
        depth: axis.dot(basis.forward),
      };
    };

    const NAV_RING_RADIUS = 58;
    const NAV_RING_SAMPLES = 72;
    const NAV_RING_HIT_TOLERANCE = 9;

    const buildPlaneRingPoints = (normalVec, basis, cx, cy, radius, samples = NAV_RING_SAMPLES) => {
      const three = window.THREE;
      if (!three?.Vector3 || !basis || !normalVec) {
        const fallback = [];
        for (let i = 0; i <= samples; i += 1) {
          const t = (i / samples) * Math.PI * 2;
          fallback.push({ x: cx + Math.cos(t) * radius, y: cy + Math.sin(t) * radius });
        }
        return fallback;
      }

      const n = normalVec.clone().normalize();
      const ref = Math.abs(n.z) < 0.9 ? new three.Vector3(0, 0, 1) : new three.Vector3(0, 1, 0);
      const u = new three.Vector3().crossVectors(n, ref).normalize();
      const v = new three.Vector3().crossVectors(n, u).normalize();
      const points = [];

      for (let i = 0; i <= samples; i += 1) {
        const t = (i / samples) * Math.PI * 2;
        const p = u.clone().multiplyScalar(Math.cos(t)).add(v.clone().multiplyScalar(Math.sin(t)));
        points.push({
          x: cx + (p.dot(basis.right) * radius),
          y: cy - (p.dot(basis.up) * radius),
        });
      }

      return points;
    };

    const drawPolyline = (ctx, points) => {
      if (!Array.isArray(points) || !points.length) return;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    };

    const pointSegmentDistance = (px, py, ax, ay, bx, by) => {
      const abx = bx - ax;
      const aby = by - ay;
      const apx = px - ax;
      const apy = py - ay;
      const abLenSq = (abx * abx) + (aby * aby);
      if (abLenSq <= 1e-6) return Math.hypot(px - ax, py - ay);
      const t = Math.max(0, Math.min(1, ((apx * abx) + (apy * aby)) / abLenSq));
      const cx = ax + (abx * t);
      const cy = ay + (aby * t);
      return Math.hypot(px - cx, py - cy);
    };

    const ringHitDistance = (px, py, points) => {
      if (!Array.isArray(points) || points.length < 2) return Number.POSITIVE_INFINITY;
      let minDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        minDist = Math.min(minDist, pointSegmentDistance(px, py, a.x, a.y, b.x, b.y));
      }
      return minDist;
    };

    const nearestPointIndex = (px, py, points) => {
      if (!Array.isArray(points) || !points.length) return -1;
      let idx = -1;
      let minDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const d = Math.hypot(px - p.x, py - p.y);
        if (d < minDist) {
          minDist = d;
          idx = i;
        }
      }
      return idx;
    };

    const drawGizmo = (nowMs = (window.performance?.now?.() || 0)) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const cx = w * 0.5;
      const cy = h * 0.5;

      const mode = readMode();
      const pulse = 0.72 + (Math.sin(nowMs * 0.0034) * 0.28);
      const modeGlow = {
        galaxy: 'rgba(52, 104, 170, 0.24)',
        system: 'rgba(90, 170, 225, 0.24)',
        'system-plus': 'rgba(72, 204, 171, 0.24)',
        planet: 'rgba(122, 211, 140, 0.24)',
        infrastructure: 'rgba(230, 172, 90, 0.24)',
        ships: 'rgba(214, 130, 232, 0.24)',
      }[mode.key] || 'rgba(52, 104, 170, 0.24)';

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(9, 20, 38, 0.95)';
      ctx.fillRect(0, 0, w, h);
      const g = ctx.createRadialGradient(cx, cy, 16, cx, cy, 130);
      g.addColorStop(0, modeGlow);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const basis = getCameraBasis();
      const three = window.THREE;
      const axes = three?.Vector3
        ? {
            X: projectWorldAxis(new three.Vector3(1, 0, 0), basis),
            Y: projectWorldAxis(new three.Vector3(0, 1, 0), basis),
            Z: projectWorldAxis(new three.Vector3(0, 0, 1), basis),
          }
        : {
            X: { x: 1, y: 0, depth: 0 },
            Y: { x: 0, y: 1, depth: 0 },
            Z: { x: -0.78, y: -0.62, depth: 0 },
          };

      // Translation arrows: X(red), Y(green), Z(blue)
      const drawArrow = (x1, y1, x2, y2, color, label, depth = 0) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.max(1, Math.hypot(dx, dy));
        const ux = dx / len;
        const uy = dy / len;
        const hx = x2 - ux * 10;
        const hy = y2 - uy * 10;
        const nx = -uy;
        const ny = ux;

        const alpha = Math.max(0.42, Math.min(1, 0.72 + depth * 0.42));
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = hoverAction && hoverAction.includes(`translate-${label.toLowerCase()}`) ? 4 : 3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(hx + nx * 6, hy + ny * 6);
        ctx.lineTo(hx - nx * 6, hy - ny * 6);
        ctx.closePath();
        ctx.fill();

        ctx.font = '12px Consolas, Menlo, Monaco, monospace';
        ctx.fillText(label, x2 + nx * 10, y2 + ny * 10);
        ctx.globalAlpha = 1;
      };

      const arrowLen = 76;
      const ex = axes.X;
      const ey = axes.Y;
      const ez = axes.Z;
      drawArrow(cx, cy, cx + ex.x * arrowLen, cy - ex.y * arrowLen, '#ff6262', 'X', ex.depth);
      drawArrow(cx, cy, cx + ey.x * arrowLen, cy - ey.y * arrowLen, '#6dff99', 'Y', ey.depth);
      drawArrow(cx, cy, cx + ez.x * arrowLen, cy - ez.y * arrowLen, '#69b5ff', 'Z', ez.depth);

      // Rotation rings centered in XY, XZ and YZ planes (same radius -> intersection at center)
      const ringDefs = (three?.Vector3 && basis)
        ? [
            { key: 'u', label: 'U', color: 'rgba(255, 200, 120, 0.95)', normal: new three.Vector3(0, 0, 1), axisProj: ez }, // XY
            { key: 'v', label: 'V', color: 'rgba(130, 255, 225, 0.95)', normal: new three.Vector3(0, 1, 0), axisProj: ey }, // XZ
            { key: 'w', label: 'W', color: 'rgba(222, 160, 255, 0.95)', normal: new three.Vector3(1, 0, 0), axisProj: ex }, // YZ
          ]
        : [];

      ringDefs.forEach((ring, idx) => {
        const pts = buildPlaneRingPoints(ring.normal, basis, cx, cy, NAV_RING_RADIUS, NAV_RING_SAMPLES);
        const highlight = hoverAction && hoverAction.startsWith(`rotate-${ring.key}`);
        const facing = Number(basis ? ring.normal.dot(basis.forward) : 0);
        const plusIdx = Math.max(0, Math.min(pts.length - 1, facing < 0 ? Math.floor((pts.length - 1) * 0.5) : 0));
        const minusIdx = Math.max(0, Math.min(pts.length - 1, facing < 0 ? 0 : Math.floor((pts.length - 1) * 0.5)));
        ctx.strokeStyle = ring.color;
        ctx.globalAlpha = 0.5 + (pulse * 0.22);
        ctx.lineWidth = highlight ? 3.4 : 2.2;
        drawPolyline(ctx, pts);

        const labelIdx = Math.floor(((idx + 1) / 4) * (pts.length - 1));
        const lp = pts[Math.max(0, Math.min(pts.length - 1, labelIdx))];
        ctx.globalAlpha = highlight ? 1 : (0.82 + pulse * 0.1);
        ctx.fillStyle = ring.color;
        ctx.font = '12px Consolas, Menlo, Monaco, monospace';
        const tx = (lp?.x || cx) + ((ring.axisProj?.x || 0) * 8);
        const ty = (lp?.y || cy) - ((ring.axisProj?.y || 0) * 8);
        ctx.fillText(ring.label, tx, ty);

        // Direction cues: show where + / - are mapped for this ring.
        const pPlus = pts[plusIdx] || { x: cx, y: cy };
        const pMinus = pts[minusIdx] || { x: cx, y: cy };
        ctx.globalAlpha = highlight ? 1 : 0.88;
        ctx.fillStyle = 'rgba(214, 242, 255, 0.95)';
        ctx.font = '10px Consolas, Menlo, Monaco, monospace';
        ctx.fillText('+', pPlus.x + 3, pPlus.y - 3);
        ctx.fillText('-', pMinus.x + 3, pMinus.y - 3);
        ctx.globalAlpha = 1;
      });

      if (navOrbTuning.debugHitZones) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i += 1) {
          const p = Math.round((w / 10) * i) + 0.5;
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, h);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, p);
          ctx.lineTo(w, p);
          ctx.stroke();
        }

        if (three?.Vector3 && basis) {
          [
            new three.Vector3(0, 0, 1),
            new three.Vector3(0, 1, 0),
            new three.Vector3(1, 0, 0),
          ].forEach((normal) => {
            const pts = buildPlaneRingPoints(normal, basis, cx, cy, NAV_RING_RADIUS, NAV_RING_SAMPLES);
            ctx.strokeStyle = 'rgba(255,255,255,0.34)';
            ctx.lineWidth = 1;
            drawPolyline(ctx, pts);
          });
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
        ctx.stroke();

        if (hoverAction) {
          ctx.fillStyle = 'rgba(0,0,0,0.62)';
          ctx.fillRect(8, 8, 165, 18);
          ctx.fillStyle = 'rgba(196, 232, 255, 0.98)';
          ctx.font = '11px Consolas, Menlo, Monaco, monospace';
          ctx.fillText(`Zone: ${hoverAction}`, 12, 20);
        }
      }

      ctx.fillStyle = 'rgba(220, 235, 255, 0.95)';
      ctx.font = '11px Consolas, Menlo, Monaco, monospace';
      ctx.fillText('Klick + ziehen: Translation / Rotation', 10, h - 16);
    };

    const getActionFromCanvasPoint = (x, y) => {
      if (!canvas) return null;
      const cx = canvas.width * 0.5;
      const cy = canvas.height * 0.5;
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const basis = getCameraBasis();
      const three = window.THREE;

      // Rings first (U/V/W on XY/XZ/YZ planes with shared center/radius)
      if (three?.Vector3 && basis) {
        const ringDefs = [
          { key: 'u', normal: new three.Vector3(0, 0, 1) },
          { key: 'v', normal: new three.Vector3(0, 1, 0) },
          { key: 'w', normal: new three.Vector3(1, 0, 0) },
        ];

        let best = null;
        ringDefs.forEach((ring) => {
          const pts = buildPlaneRingPoints(ring.normal, basis, cx, cy, NAV_RING_RADIUS, NAV_RING_SAMPLES);
          const dist = ringHitDistance(x, y, pts);
          if (!best || dist < best.dist) {
            best = { key: ring.key, normal: ring.normal, points: pts, dist };
          }
        });

        if (best && best.dist <= NAV_RING_HIT_TOLERANCE) {
          const idx = nearestPointIndex(x, y, best.points);
          const segCount = Math.max(1, best.points.length - 1);
          const phase = idx >= 0 ? ((idx / segCount) * Math.PI * 2) : 0;
          let plus = Math.cos(phase) >= 0;
          const facing = Number(best.normal?.dot?.(basis.forward) || 0);
          if (facing < 0) plus = !plus;
          return `rotate-${best.key}-${plus ? 'plus' : 'minus'}`;
        }
      }

      // Arrows / axis zones
      if (ax > ay * 1.2) return dx >= 0 ? 'translate-x-plus' : 'translate-x-minus';
      if (ay > ax * 1.2) return dy <= 0 ? 'translate-y-plus' : 'translate-y-minus';
      return dy <= 0 ? 'translate-z-plus' : 'translate-z-minus';
    };

    if (canvas) {
      drawGizmo();
      let holdTimer = null;
      let holdStartTimer = null;
      let activeAction = null;

      const stopCanvasHold = () => {
        if (holdStartTimer) {
          window.clearTimeout(holdStartTimer);
          holdStartTimer = null;
        }
        if (holdTimer) {
          window.clearInterval(holdTimer);
          holdTimer = null;
        }
        activeAction = null;
        canvas?.classList?.remove('is-hovering');
      };

      const eventPos = (ev) => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((ev.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
          y: ((ev.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
        };
      };

      const startCanvasHold = (action) => {
        if (!action) return;
        activeAction = action;
        triggerGalaxyNavAction(action, root);
        if (holdTimer) window.clearInterval(holdTimer);
        holdTimer = window.setInterval(() => {
          if (!activeAction) return;
          triggerGalaxyNavAction(activeAction, root);
        }, Math.max(35, Number(navOrbTuning.holdRateMs || 100)));
      };

      canvas.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        canvas.setPointerCapture?.(ev.pointerId);
        const pos = eventPos(ev);
        const action = getActionFromCanvasPoint(pos.x, pos.y);
        hoverAction = action;
        canvas.classList.add('is-hovering');
        drawGizmo();
        if (holdStartTimer) window.clearTimeout(holdStartTimer);
        holdStartTimer = window.setTimeout(() => {
          holdStartTimer = null;
          startCanvasHold(action);
        }, Math.max(0, Number(navOrbTuning.holdDelayMs || 170)));
      });

      canvas.addEventListener('pointermove', (ev) => {
        const pos = eventPos(ev);
        const nextAction = getActionFromCanvasPoint(pos.x, pos.y);
        hoverAction = nextAction;
        if (activeAction) activeAction = nextAction || activeAction;
        if (navOrbTuning.debugHitZones) drawGizmo();
      });

      canvas.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        if (!navOrbTuning.snapOnDoubleClick) return;
        triggerGalaxyNavAction('reset', root);
      });

      canvas.addEventListener('pointerup', stopCanvasHold);
      canvas.addEventListener('pointercancel', stopCanvasHold);
      canvas.addEventListener('lostpointercapture', stopCanvasHold);
      canvas.addEventListener('pointerleave', () => {
        hoverAction = null;
        canvas.classList.remove('is-hovering');
        if (navOrbTuning.debugHitZones) drawGizmo();
      });
    }

    const syncSlidersFromRenderer = () => {
      const renderer = galaxy3d || null;
      applyModeStyle();
      if (!renderer) return;
      const zoomNorm = typeof renderer.getZoomNorm === 'function' ? Number(renderer.getZoomNorm()) : null;
      const fovDeg = typeof renderer.getFov === 'function' ? Number(renderer.getFov()) : null;
      const zCurve = Math.max(0.25, Number(navOrbTuning.zoomCurveExp || 1));
      const fCurve = Math.max(0.25, Number(navOrbTuning.fovCurveExp || 1));

      if (zoomSlider && Number.isFinite(zoomNorm)) {
        const linearT = Math.pow(Math.max(0, Math.min(1, zoomNorm)), 1 / zCurve);
        const pct = Math.round(linearT * 100);
        zoomSlider.value = String(pct);
        if (zoomValue) zoomValue.textContent = `${pct}%`;
      }
      if (fovSlider && Number.isFinite(fovDeg)) {
        const minFov = 25;
        const maxFov = 100;
        const fovT = (Math.max(minFov, Math.min(maxFov, fovDeg)) - minFov) / (maxFov - minFov);
        const linearT = Math.pow(Math.max(0, Math.min(1, fovT)), 1 / fCurve);
        const degLinear = Math.round(minFov + linearT * (maxFov - minFov));
        fovSlider.value = String(degLinear);
        if (fovValue) fovValue.textContent = `${Math.round(fovDeg)}°`;
      }
    };

    const syncTuningUi = () => {
      if (debugToggle) debugToggle.checked = !!navOrbTuning.debugHitZones;
      if (snapToggle) snapToggle.checked = !!navOrbTuning.snapOnDoubleClick;
      if (holdRateSlider) holdRateSlider.value = String(Math.round(Math.max(40, Math.min(220, Number(navOrbTuning.holdRateMs || 100)))));
      if (holdRateValue) holdRateValue.textContent = `${Math.round(Math.max(40, Math.min(220, Number(navOrbTuning.holdRateMs || 100))))}ms`;
      const rollDeg = Math.max(1, Math.min(12, Math.round((Number(navOrbTuning.rollStepRad || 0.052) * 180) / Math.PI)));
      if (rollSpeedSlider) rollSpeedSlider.value = String(rollDeg);
      if (rollSpeedValue) rollSpeedValue.textContent = `${rollDeg}°`;
      const zCurveUi = Math.max(50, Math.min(240, Math.round(Number(navOrbTuning.zoomCurveExp || 1) * 100)));
      const fCurveUi = Math.max(50, Math.min(240, Math.round(Number(navOrbTuning.fovCurveExp || 1) * 100)));
      if (zoomCurveSlider) zoomCurveSlider.value = String(zCurveUi);
      if (zoomCurveValue) zoomCurveValue.textContent = `${(zCurveUi / 100).toFixed(2)}`;
      if (fovCurveSlider) fovCurveSlider.value = String(fCurveUi);
      if (fovCurveValue) fovCurveValue.textContent = `${(fCurveUi / 100).toFixed(2)}`;
      presetButtons.forEach((btn) => {
        const key = String(btn.getAttribute('data-nav-preset') || '');
        btn.classList.toggle('active', key === String(navOrbTuning.preset || 'balanced'));
      });
    };

    const applyPreset = (presetKey) => {
      const key = String(presetKey || 'balanced').toLowerCase();
      const preset = NAV_ORB_PRESETS[key];
      if (!preset) return;
      navOrbTuning.preset = key;
      navOrbTuning.holdRateMs = preset.holdRateMs;
      navOrbTuning.holdDelayMs = preset.holdDelayMs;
      navOrbTuning.rollStepRad = preset.rollStepRad;
      navOrbTuning.zoomCurveExp = preset.zoomCurveExp;
      navOrbTuning.fovCurveExp = preset.fovCurveExp;
      syncTuningUi();
      syncSlidersFromRenderer();
      showToast(`Nav-Preset: ${NAV_ORB_PRESET_LABELS[key] || key}`, 'info');
    };

    debugToggle?.addEventListener('change', () => {
      navOrbTuning.debugHitZones = !!debugToggle.checked;
      drawGizmo();
    });

    snapToggle?.addEventListener('change', () => {
      navOrbTuning.snapOnDoubleClick = !!snapToggle.checked;
    });

    holdRateSlider?.addEventListener('input', () => {
      const ms = Math.max(40, Math.min(220, Number(holdRateSlider.value || 100)));
      navOrbTuning.holdRateMs = ms;
      navOrbTuning.preset = 'custom';
      if (holdRateValue) holdRateValue.textContent = `${Math.round(ms)}ms`;
      syncTuningUi();
    });

    rollSpeedSlider?.addEventListener('input', () => {
      const deg = Math.max(1, Math.min(12, Number(rollSpeedSlider.value || 3)));
      navOrbTuning.rollStepRad = (deg * Math.PI) / 180;
      navOrbTuning.preset = 'custom';
      if (rollSpeedValue) rollSpeedValue.textContent = `${Math.round(deg)}°`;
      syncTuningUi();
    });

    zoomCurveSlider?.addEventListener('input', () => {
      const curve = Math.max(0.5, Math.min(2.4, Number(zoomCurveSlider.value || 100) / 100));
      navOrbTuning.zoomCurveExp = curve;
      navOrbTuning.preset = 'custom';
      if (zoomCurveValue) zoomCurveValue.textContent = curve.toFixed(2);
      syncSlidersFromRenderer();
      syncTuningUi();
    });

    fovCurveSlider?.addEventListener('input', () => {
      const curve = Math.max(0.5, Math.min(2.4, Number(fovCurveSlider.value || 100) / 100));
      navOrbTuning.fovCurveExp = curve;
      navOrbTuning.preset = 'custom';
      if (fovCurveValue) fovCurveValue.textContent = curve.toFixed(2);
      syncSlidersFromRenderer();
      syncTuningUi();
    });

    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        applyPreset(String(btn.getAttribute('data-nav-preset') || 'balanced'));
      });
    });

    zoomSlider?.addEventListener('input', () => {
      const pct = Math.max(0, Math.min(100, Number(zoomSlider.value || 0)));
      if (zoomValue) zoomValue.textContent = `${Math.round(pct)}%`;
      const renderer = galaxy3d || null;
      if (!renderer) return;
      if (typeof renderer.setZoomNorm === 'function') {
        const curve = Math.max(0.25, Number(navOrbTuning.zoomCurveExp || 1));
        const curved = Math.pow(pct / 100, curve);
        renderer.setZoomNorm(curved);
      }
    });

    fovSlider?.addEventListener('input', () => {
      const deg = Math.max(25, Math.min(100, Number(fovSlider.value || 60)));
      const curve = Math.max(0.25, Number(navOrbTuning.fovCurveExp || 1));
      const minFov = 25;
      const maxFov = 100;
      const linearT = (deg - minFov) / (maxFov - minFov);
      const curvedDeg = minFov + Math.pow(Math.max(0, Math.min(1, linearT)), curve) * (maxFov - minFov);
      if (fovValue) fovValue.textContent = `${Math.round(curvedDeg)}°`;
      const renderer = galaxy3d || null;
      if (!renderer) return;
      if (typeof renderer.setFov === 'function') {
        renderer.setFov(curvedDeg);
      }
    });

    syncTuningUi();
    applyModeStyle();
    drawGizmo();
    syncSlidersFromRenderer();
    let navRaf = 0;
    const animateNavOrb = () => {
      if (!document.body.contains(overlay)) {
        if (navRaf) window.cancelAnimationFrame(navRaf);
        return;
      }
      applyModeStyle();
      drawGizmo(window.performance?.now?.() || 0);
      navRaf = window.requestAnimationFrame(animateNavOrb);
    };
    navRaf = window.requestAnimationFrame(animateNavOrb);
  }

  function renderGalaxyWindow() {
    galaxyController.renderWindow();
  }

  function getGalaxyInfoRoot() {
    return WM?.body?.('galaxy-info') || null;
  }

  function renderGalaxyInfoWindow() {
    const root = WM?.body?.('galaxy-info');
    if (!root) return;

    if (!root.querySelector('#galaxy-info-overlay')) {
      root.innerHTML = `
        <div id="galaxy-info-overlay" class="galaxy-info-window-shell">
          <div class="galaxy-overlay-shortcuts">Shortcuts: O Controls | I Info | L Follow | V Vectors</div>

          <div class="galaxy-info-tabs" role="tablist" aria-label="Galaxy Info Tabs">
            <button class="galaxy-info-tab is-active" type="button" role="tab" aria-selected="true" data-info-tab="details">Details</button>
            <button class="galaxy-info-tab" type="button" role="tab" aria-selected="false" data-info-tab="planets">Planets</button>
            <button class="galaxy-info-tab" type="button" role="tab" aria-selected="false" data-info-tab="debug">Debug</button>
          </div>

          <section class="galaxy-info-panel is-active" data-info-panel="details">
            <div id="galaxy-system-details" class="text-muted">Fenster geoeffnet. Waehle ein System fuer Details.</div>
            <div class="galaxy-colony-legend" aria-label="Kolonie-Ring-Legende">
              <div class="galaxy-colony-legend-title">Kolonie-Ringe</div>
              <div class="galaxy-colony-legend-row"><span class="galaxy-colony-legend-ring galaxy-colony-legend-ring-sm"></span><span>Aussenposten</span></div>
              <div class="galaxy-colony-legend-row"><span class="galaxy-colony-legend-ring galaxy-colony-legend-ring-md"></span><span>Kolonie</span></div>
              <div class="galaxy-colony-legend-row"><span class="galaxy-colony-legend-ring galaxy-colony-legend-ring-lg"></span><span>Kernwelt</span></div>
            </div>
          </section>

          <section class="galaxy-info-panel" data-info-panel="planets">
            <div id="galaxy-planets-panel" class="galaxy-planets-panel"></div>
          </section>

          <section class="galaxy-info-panel" data-info-panel="debug">
            <div class="galaxy-debug-wrap">
              <div class="galaxy-debug-headline">
                <div class="galaxy-debug-title">Lade-/Render-Log</div>
                <div class="galaxy-debug-actions">
                  <button class="btn btn-secondary btn-sm" id="galaxy-debug-copy-btn" type="button">Letzten kopieren</button>
                  <button class="btn btn-secondary btn-sm" id="galaxy-debug-download-btn" type="button">Download</button>
                  <button class="btn btn-secondary btn-sm" id="galaxy-debug-clear-btn" type="button">Leeren</button>
                </div>
              </div>
              <div id="galaxy-debug-log" class="galaxy-debug-log">Keine aktuellen Lade-/Renderfehler.</div>
            </div>
          </section>
        </div>
      `;

      const infoTabButtons = Array.from(root.querySelectorAll('[data-info-tab]'));
      const infoPanels = Array.from(root.querySelectorAll('[data-info-panel]'));
      const activateInfoTab = (tabKey) => {
        const key = String(tabKey || 'details').trim().toLowerCase();
        infoTabButtons.forEach((btn) => {
          const isActive = String(btn.getAttribute('data-info-tab') || '').toLowerCase() === key;
          btn.classList.toggle('is-active', isActive);
          btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        infoPanels.forEach((panel) => {
          const isActive = String(panel.getAttribute('data-info-panel') || '').toLowerCase() === key;
          panel.classList.toggle('is-active', isActive);
        });
      };

      infoTabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          activateInfoTab(btn.getAttribute('data-info-tab'));
        });
      });
      activateInfoTab('details');

      root.querySelector('#galaxy-debug-copy-btn')?.addEventListener('click', () => copyLastGalaxyDebugError());
      root.querySelector('#galaxy-debug-download-btn')?.addEventListener('click', () => downloadGalaxyDebugLog());
      root.querySelector('#galaxy-debug-clear-btn')?.addEventListener('click', () => clearGalaxyDebugErrors());
    }

    renderGalaxyDebugPanel(root);
    const activeInfoStar = pinnedStar || uiState.activeStar || null;
    if (activeInfoStar) {
      galaxySystemDetailsFacade.renderGalaxySystemDetails(root, activeInfoStar, isSystemModeActive());
    } else if (!root.querySelector('#galaxy-planets-panel')?.innerHTML.trim()) {
      renderGalaxyColonySummary(root.querySelector('#galaxy-planets-panel'), galaxyStars, null);
    }
  }

  function updateTopbarOrbitBadge() {
    const badge = document.getElementById('topbar-orbit-mode');
    const diagEl = document.getElementById('settings-orbit-diag');
    const nextEl = document.getElementById('settings-orbit-next');
    const visibilityEl = document.getElementById('settings-orbit-visibility');
    if (!badge && !diagEl && !nextEl && !visibilityEl) return;
    const orbitOrder = ['auto', 'simple', 'complex'];
    const toUpperMode = (value, fallback = 'AUTO') => {
      const normalized = String(value || '').toLowerCase();
      return orbitOrder.includes(normalized) ? normalized.toUpperCase() : fallback;
    };
    const nextModeUpper = (value) => {
      const normalized = String(value || 'auto').toLowerCase();
      const index = Math.max(0, orbitOrder.indexOf(normalized));
      return orbitOrder[(index + 1) % orbitOrder.length].toUpperCase();
    };
    if (!galaxy3d || typeof galaxy3d.getRenderStats !== 'function' || !isSystemModeActive()) {
      if (badge) {
        badge.classList.add('hidden');
        badge.textContent = '';
        badge.title = '';
        badge.removeAttribute('aria-label');
        badge.classList.remove('is-gpu', 'is-cpu', 'is-complex');
      }
      if (diagEl) {
        diagEl.textContent = '—';
        diagEl.classList.remove('is-gpu', 'is-cpu', 'is-complex');
      }
      if (nextEl) {
        nextEl.textContent = '—';
        nextEl.title = '';
        nextEl.classList.remove('is-gpu', 'is-cpu', 'is-complex');
      }
      if (visibilityEl) {
        visibilityEl.textContent = '—';
        visibilityEl.title = '';
        visibilityEl.classList.remove('is-gpu', 'is-cpu', 'is-complex');
      }
      return;
    }

    const stats = galaxy3d.getRenderStats() || {};
    const requestedMode = toUpperMode(stats.orbitSimulationMode || settingsState.orbitSimulationMode || 'auto');
    const activeMode = toUpperMode(stats.activeOrbitSimulationMode || 'complex', 'COMPLEX');
    const nextMode = nextModeUpper(stats.orbitSimulationMode || settingsState.orbitSimulationMode || 'auto');
    const gpuActive = !!stats.activeGpuOrbitVisuals;
    const isComplex = activeMode === 'COMPLEX';
    const rawVisibilityFactor = Number(stats.orbitPathVisibilityFactor);
    const visibilityFactor = Number.isFinite(rawVisibilityFactor)
      ? Math.max(0, Math.min(1, rawVisibilityFactor))
      : (settingsState.systemOrbitPathsVisible === false ? 0 : 1);

    if (badge) {
      const label = gpuActive ? `ORB GPU ${activeMode}` : `ORB CPU ${activeMode}`;
      badge.textContent = label;
      badge.title = `Orbit-Simulation\nGewuenscht: ${requestedMode}\nAktiv: ${activeMode}\nVisualisierung: ${gpuActive ? 'GPU' : 'CPU'}\nKlick/Enter/Space: naechster Modus ${nextMode}`;
      badge.setAttribute('aria-label', `Orbit-Simulation. Gewuenscht ${requestedMode}. Aktiv ${activeMode}. Visualisierung ${gpuActive ? 'GPU' : 'CPU'}. Naechster Modus ${nextMode}.`);
      badge.classList.remove('hidden', 'is-gpu', 'is-cpu', 'is-complex');
      badge.classList.add(gpuActive ? 'is-gpu' : 'is-cpu');
      if (isComplex) badge.classList.add('is-complex');
    }

    if (diagEl) {
      const gpuLabel = gpuActive ? 'GPU ✓' : 'CPU';
      diagEl.textContent = `${requestedMode} → ${activeMode} · ${gpuLabel}`;
      diagEl.title = `Requested: ${requestedMode}  Active: ${activeMode}  Visuals: ${gpuActive ? 'GPU (shader)' : 'CPU (position)'}`;
      diagEl.classList.remove('is-gpu', 'is-cpu', 'is-complex');
      diagEl.classList.add(gpuActive ? 'is-gpu' : 'is-cpu');
      if (isComplex) diagEl.classList.add('is-complex');
    }

    if (nextEl) {
      nextEl.textContent = nextMode;
      nextEl.title = `Naechster Orbit-Modus bei Umschaltung: ${nextMode}`;
      nextEl.classList.remove('is-gpu', 'is-cpu', 'is-complex', 'is-next-auto', 'is-next-simple', 'is-next-complex');
      if (nextMode === 'AUTO') nextEl.classList.add('is-next-auto');
      else if (nextMode === 'SIMPLE') nextEl.classList.add('is-next-simple');
      else if (nextMode === 'COMPLEX') nextEl.classList.add('is-next-complex');
    }

    if (visibilityEl) {
      const percent = Math.round(visibilityFactor * 100);
      visibilityEl.textContent = `${percent}%`;
      visibilityEl.title = `Orbitpfad-Sichtbarkeit (kameraabhaengig): ${percent}%`;
      visibilityEl.classList.remove('is-gpu', 'is-cpu', 'is-complex');
      visibilityEl.classList.add(gpuActive ? 'is-gpu' : 'is-cpu');
      if (isComplex) visibilityEl.classList.add('is-complex');
    }
  }

  function refreshGalaxyDensityMetrics(root) {
    galaxyController.refreshDensityMetrics(root);
    updateTopbarOrbitBadge();
  }

  function updateClusterBoundsUi(root) {
    galaxyController.updateClusterBoundsUi(root);
  }

  function updateGalaxyColonyFilterUi(root) {
    const btn = root?.querySelector?.('#gal-colonies-only-btn');
    if (!btn) return;
    if (!GALAXY_FILTERS_ENABLED) {
      btn.classList.add('hidden');
      return;
    }
    btn.classList.remove('hidden');
    const mode = getGalaxyColonyFilterMode();
    const ownerFocus = getGalaxyColonyOwnerFocus();
    const labels = {
      all: 'Filter: alle',
      colonies: 'Filter: Kolonien',
      own: 'Filter: eigene',
      foreign: 'Filter: fremde',
    };
    btn.textContent = labels[mode] || 'Filter: alle';
    btn.classList.toggle('active', mode !== 'all');
    btn.title = ownerFocus.name ? `Aktiver Besitzerfokus: ${ownerFocus.name}` : 'Kein Besitzerfokus aktiv';
  }

  function flashGalaxyControlBtn(root, selector) {
    const btn = root?.querySelector(selector);
    if (!btn) return;
    btn.classList.remove('gal-cluster-flash');
    // Force reflow so re-adding the class triggers the animation fresh
    void btn.offsetWidth;
    btn.classList.add('gal-cluster-flash');
    btn.addEventListener('animationend', () => btn.classList.remove('gal-cluster-flash'), { once: true });
  }

  function updateGalaxyFollowUi(root) {
    galaxyController.updateFollowUi(root);
  }

  async function refreshGalaxyHealth(root, force) {
    try {
      await galaxyController.refreshHealth(root, force);
    } finally {
      galaxyHealthLastCheckMs = Date.now();
    }
  }

  function initGalaxy3D(root) {
    emitGalaxyHandoffDiagnostic('init3d:before');
    galaxyController.init3D(root);
    emitGalaxyHandoffDiagnostic('init3d:after-sync');
    setTimeout(() => emitGalaxyHandoffDiagnostic('init3d:after-250ms'), 250);
  }

  function emitGalaxyHandoffDiagnostic(stage, extra = {}) {
    try {
      const authControl = window.GQAuthGalaxyBackgroundControl || window.GQStarfieldControl || null;
      const authActive = (authControl && typeof authControl.isActive === 'function')
        ? !!authControl.isActive()
        : null;
      const rendererStats = (galaxy3d && typeof galaxy3d.getRenderStats === 'function')
        ? (galaxy3d.getRenderStats() || {})
        : {};
      const payload = Object.assign({
        stage: String(stage || 'unknown'),
        body: String(document.body?.className || ''),
        authActive,
        releaseFlag: window.__GQ_RELEASE_AUTH_BG_ON_BOOT !== false,
        rendererReady: !!galaxy3d,
        backend: String(galaxy3d?.backendType || rendererStats.backend || window.__GQ_ACTIVE_RENDERER_BACKEND || 'n/a'),
        visibleStars: Number(rendererStats.visibleStars || 0),
        rawStars: Array.isArray(galaxyStars) ? galaxyStars.length : 0,
        hasModel: !!galaxyModel,
        hasDb: !!galaxyDB,
        dbMode: String(galaxyDB?.mode || 'n/a'),
      }, extra || {});
      gameLog('info', '[handoff-diag]', payload);
      uiConsolePush(`[diag][handoff] stage=${payload.stage} authActive=${payload.authActive} renderer=${payload.rendererReady} backend=${formatRendererBackendLabel(payload.backend)} visible=${payload.visibleStars} raw=${payload.rawStars} db=${payload.hasDb ? payload.dbMode : 'none'} model=${payload.hasModel} body=${payload.body}`);
    } catch (_) {}
  }

  function collectGalaxyRenderDiagnostics(root) {
    let webglSupport = 'unknown';
    try {
      const testCanvas = document.createElement('canvas');
      const gl2 = testCanvas.getContext('webgl2');
      const gl1 = gl2 || testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
      webglSupport = gl2 ? 'webgl2' : (gl1 ? 'webgl1' : 'none');
    } catch (err) {
      gameLog('info', 'WebGL support detection fehlgeschlagen', err);
      webglSupport = 'error';
    }
    const telemetry = Array.isArray(window.__GQ_RENDER_TELEMETRY) ? window.__GQ_RENDER_TELEMETRY : [];
    const lastRenderTelemetry = telemetry.length ? telemetry[telemetry.length - 1] : null;
    return {
      rendererGlobal: typeof window.Galaxy3DRenderer,
      threeGlobal: typeof window.THREE,
      threeRevision: String(window.THREE?.REVISION || 'n/a'),
      hasCanvas: !!document.getElementById('galaxy-3d-host'),
      webglSupport,
      activeBackend: formatRendererBackendLabel(window.__GQ_ACTIVE_RENDERER_BACKEND || 'unknown'),
      fallbackReason: String(lastRenderTelemetry?.reason || 'n/a'),
      reason: String(galaxy3dInitReason || '').trim() || 'n/a',
      time: new Date().toLocaleTimeString(),
    };
  }

  function renderGalaxyFallbackList(root, stars, from, to, reason = '') {
    const infoRoot = getGalaxyInfoRoot();
    const panel = infoRoot?.querySelector('#galaxy-planets-panel');
    if (!panel) return;
    const rows = (stars || []).slice(0, 40).map((s) => {
      return `<div class="planet-detail-row">#${Number(s.system_index)} - ${esc(s.name || s.catalog_name || 'Unnamed')} (${esc(String(s.spectral_class || '?'))}${esc(String(s.subtype ?? ''))})</div>`;
    }).join('');
    const reasonText = String(reason || galaxy3dInitReason || '').trim();
    const diag = collectGalaxyRenderDiagnostics(root);
    panel.innerHTML = `
      <h4>Fallback Star List</h4>
      <div class="planet-detail-3d">
        ${reasonText ? `<div class="planet-detail-row text-red">Reason: ${esc(reasonText)}</div>` : ''}
        <div class="planet-detail-row" style="margin:0.25rem 0;padding:0.35rem 0.4rem;border:1px solid rgba(180,120,120,0.35);border-radius:6px;background:rgba(32,10,10,0.2)">
          <strong>Render Diagnostics</strong><br/>
          Galaxy3DRenderer: ${esc(diag.rendererGlobal)} ┬À THREE: ${esc(diag.threeGlobal)} (${esc(diag.threeRevision)})<br/>
          Canvas: ${diag.hasCanvas ? 'yes' : 'no'} ┬À WebGL: ${esc(diag.webglSupport)} ┬À Backend: ${esc(diag.activeBackend)}<br/>
          Last fallback: ${esc(diag.fallbackReason)} ┬À Last reason: ${esc(diag.reason)} ┬À ${esc(diag.time)}
          <div style="margin-top:0.35rem"><button id="galaxy-retry-3d-btn" class="btn btn-secondary btn-sm" type="button">Retry 3D Init</button></div>
        </div>
        <div class="planet-detail-row">Range ${from}..${to}</div>
        <div class="planet-detail-row">Loaded stars: ${Number((stars || []).length)}</div>
        ${rows || '<div class="planet-detail-row">No stars returned.</div>'}
      </div>`;

    panel.querySelector('#galaxy-retry-3d-btn')?.addEventListener('click', () => {
      initGalaxy3D(root);
      loadGalaxyStars3D(root);
    });
  }

  function updateGalaxyHoverCard(root, star, pos, pinned) {
    galaxyHoverCardFacade.renderHoverCard(star, pos, pinned);
  }

  function applyClusterRangeToControls(root, clusterPayload, opts = {}) {
    return galaxyClusterRangeControls.applyClusterRangeToControls(root, clusterPayload, opts);
  }

  function renderGalaxySystemDetails(root, star, zoomed) {
    const infoRoot = getGalaxyInfoRoot();
    if (!infoRoot) return;
    galaxySystemDetailsFacade.renderGalaxySystemDetails(infoRoot, star, zoomed);
  }

  // QuickNav domain logic is delegated to an engine runtime facade.
  const quickNavFacade = runtimeQuickNavFacadeApi.createQuickNavFacade({
    wm: WM,
    documentRef: document,
    esc,
    gameLog,
    showToast,
    runPhysicsCinematicFlight,
    renderGalaxySystemDetails,
    isSystemModeActive,
    getGalaxyStars: () => galaxyStars,
    getPinnedStar: () => pinnedStar,
    setPinnedStar: (star) => { pinnedStar = star; },
    getGalaxyRenderer: () => galaxy3d,
    getAudioManager: () => audioManager,
  });

  function loadQuickNavData() {
    return quickNavFacade.loadQuickNavData();
  }

  function saveQuickNavData(data) {
    quickNavFacade.saveQuickNavData(data);
  }

  function getQuickNavFavorites() {
    return quickNavFacade.getQuickNavFavorites();
  }

  function isFavoriteStar(star) {
    return quickNavFacade.isFavoriteStar(star);
  }

  function addFavorite(star, ribbon = '') {
    quickNavFacade.addFavorite(star, ribbon);
  }

  function removeFavorite(key) {
    quickNavFacade.removeFavorite(key);
  }

  function setFavoriteRibbon(key, ribbon) {
    quickNavFacade.setFavoriteRibbon(key, ribbon);
  }

  function updateFooterQuickNavBadge() {
    quickNavFacade.updateFooterQuickNavBadge();
  }

  function renderQuickNav() {
    quickNavFacade.renderQuickNav();
  }

  function mergeGalaxyStarsBySystem(existingStars, incomingStars, galaxyIndex) {
    const g = Number(galaxyIndex || 1);
    const map = new Map();
    (Array.isArray(existingStars) ? existingStars : []).forEach((s) => {
      if (Number(s?.galaxy_index || 0) !== g) return;
      const key = Number(s?.system_index || 0);
      if (key > 0) map.set(key, normalizeStarVisibility(s));
    });
    (Array.isArray(incomingStars) ? incomingStars : []).forEach((s) => {
      if (Number(s?.galaxy_index || g) !== g) return;
      const key = Number(s?.system_index || 0);
      if (key > 0) map.set(key, normalizeStarVisibility(s));
    });
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value);
  }

  function assignClusterFactions(rawClusters, territory) {
    const clusters = Array.isArray(rawClusters) ? rawClusters : [];
    const territoryRows = Array.isArray(territory) ? territory : [];

    const getTerritoryRange = (row) => {
      const from = Number(
        row?.from_system
        ?? row?.range_from
        ?? row?.system_from
        ?? row?.home_system_min
        ?? row?.min_system
        ?? row?.from
        ?? 0
      );
      const to = Number(
        row?.to_system
        ?? row?.range_to
        ?? row?.system_to
        ?? row?.home_system_max
        ?? row?.max_system
        ?? row?.to
        ?? from
      );
      const safeFrom = Math.max(1, Number.isFinite(from) ? from : 1);
      const safeTo = Math.max(safeFrom, Number.isFinite(to) ? to : safeFrom);
      return { from: safeFrom, to: safeTo };
    };

    const overlapScore = (clusterFrom, clusterTo, territoryFrom, territoryTo) => {
      const left = Math.max(clusterFrom, territoryFrom);
      const right = Math.min(clusterTo, territoryTo);
      return right >= left ? (right - left + 1) : 0;
    };

    return clusters.map((cluster, index) => {
      const systems = Array.isArray(cluster?.systems)
        ? cluster.systems
          .map((n) => Number(n || 0))
          .filter((n) => Number.isFinite(n) && n > 0)
        : [];

      const from = systems.length
        ? Math.min(...systems)
        : Math.max(1, Number(cluster?.from ?? cluster?.range_from ?? cluster?.system_from ?? 1));
      const to = systems.length
        ? Math.max(...systems)
        : Math.max(from, Number(cluster?.to ?? cluster?.range_to ?? cluster?.system_to ?? from));

      const stableSystems = systems.length
        ? [...new Set(systems)].sort((a, b) => a - b)
        : Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

      let bestFaction = null;
      let bestScore = 0;
      territoryRows.forEach((row) => {
        const range = getTerritoryRange(row);
        const score = overlapScore(from, to, range.from, range.to);
        if (score > bestScore) {
          bestScore = score;
          bestFaction = row;
        }
      });

      const fallbackFactionName = String(cluster?.faction?.name || cluster?.name || cluster?.label || `Cluster ${index + 1}`);
      const fallbackFactionId = Number(cluster?.faction?.id || cluster?.faction_id || 0);
      const faction = {
        id: Number(bestFaction?.id || bestFaction?.faction_id || fallbackFactionId || 0),
        name: String(bestFaction?.name || bestFaction?.faction_name || fallbackFactionName),
        icon: String(bestFaction?.icon || bestFaction?.sigil || cluster?.faction?.icon || 'FC'),
        color: String(bestFaction?.color || bestFaction?.primary_color || cluster?.faction?.color || cluster?.color || '#6a8cc9'),
        government: bestFaction?.government && typeof bestFaction.government === 'object'
          ? bestFaction.government
          : (cluster?.faction?.government || null),
      };

      const baseLabel = String(cluster?.label || cluster?.name || '').trim();
      const label = baseLabel || `${faction.icon} ${faction.name}`;

      return {
        ...cluster,
        from,
        to,
        systems: stableSystems,
        label,
        faction,
      };
    });
  }

  function getGalaxyColonyFilterMode() {
    if (!GALAXY_FILTERS_ENABLED) return 'all';
    const mode = String(settingsState.galaxyColonyFilterMode || '').toLowerCase();
    if (['all', 'colonies', 'own', 'foreign'].includes(mode)) return mode;
    return settingsState.galaxyColoniesOnly === true ? 'colonies' : 'all';
  }

  function getGalaxyColonyOwnerMeta(star) {
    const isPlayer = Number(star?.colony_is_player || 0) === 1;
    const ownerName = String(star?.colony_owner_name || (isPlayer ? currentUser?.username || 'Du' : 'Unbekannt')).trim() || 'Unbekannt';
    const ownerUserId = Math.max(0, Number(star?.colony_owner_user_id || (isPlayer ? currentUser?.id || 0 : 0)));
    const color = String(star?.colony_owner_color || '#7db7ee');
    return { ownerName, ownerUserId, color, isPlayer };
  }

  function getGalaxyColonyOwnerFocus() {
    if (!GALAXY_FILTERS_ENABLED) {
      return {
        userId: 0,
        name: '',
      };
    }
    return {
      userId: Math.max(0, Number(settingsState.galaxyOwnerFocusUserId || 0)),
      name: String(settingsState.galaxyOwnerFocusName || '').trim(),
    };
  }

  function getDisplayedGalaxyStars(stars) {
    const rows = Array.isArray(stars) ? stars : [];
    const mode = getGalaxyColonyFilterMode();
    if (mode === 'all' && !getGalaxyColonyOwnerFocus().userId && !getGalaxyColonyOwnerFocus().name) {
      return rows;
    }

    const filtered = rows.filter((star) => {
      const colonyCount = Math.max(0, Number(star?.colony_count || 0));
      const isPlayer = Number(star?.colony_is_player || 0) === 1;
      const ownerMeta = getGalaxyColonyOwnerMeta(star);
      const ownerFocus = getGalaxyColonyOwnerFocus();
      if (ownerFocus.userId > 0 || ownerFocus.name) {
        if (colonyCount <= 0) return false;
        const matchesFocus = ownerFocus.userId > 0
          ? ownerMeta.ownerUserId === ownerFocus.userId
          : ownerMeta.ownerName.localeCompare(ownerFocus.name, 'de', { sensitivity: 'base' }) === 0;
        if (!matchesFocus) return false;
      }
      if (mode === 'all') return true;
      if (mode === 'colonies') return colonyCount > 0;
      if (mode === 'own') return colonyCount > 0 && isPlayer;
      if (mode === 'foreign') return colonyCount > 0 && !isPlayer;
      return true;
    });

    // Safety net: never allow an empty galaxy view when raw star data exists.
    // This prevents stale filter/focus settings from making navigation appear broken.
    if (rows.length > 0 && filtered.length === 0) {
      return rows;
    }

    return filtered;
  }

  function getDisplayedGalaxyClusterSummary(clusterSummary, stars) {
    if (getGalaxyColonyFilterMode() === 'all') return Array.isArray(clusterSummary) ? clusterSummary : [];
    const filteredStars = getDisplayedGalaxyStars(stars);
    const allowedSystems = new Set(
      filteredStars
        .map((star) => Number(star?.system_index || 0))
        .filter((systemIndex) => Number.isFinite(systemIndex) && systemIndex > 0)
    );
    if (!allowedSystems.size) return [];
    return (Array.isArray(clusterSummary) ? clusterSummary : []).filter((cluster) => {
      const systems = Array.isArray(cluster?.systems) ? cluster.systems : [];
      return systems.some((systemIndex) => allowedSystems.has(Number(systemIndex || 0)));
    });
  }

  function getGalaxyOwnerFocusHighlightedSystems(stars) {
    const ownerFocus = getGalaxyColonyOwnerFocus();
    if (!ownerFocus.name && ownerFocus.userId <= 0) return [];
    return [...new Set(
      getDisplayedGalaxyStars(stars)
        .map((star) => Number(star?.system_index || 0))
        .filter((systemIndex) => Number.isFinite(systemIndex) && systemIndex > 0)
    )];
  }

    function applySelectionGroupHighlightToRenderer(stars) {
      if (!galaxy3d || typeof galaxy3d.setEmpireHeartbeatSystems !== 'function') return;
      const highlighted = runtimeSelectionStateApi.getSelectionGroupHighlightedSystems(uiState.selection || {});
      const systems = highlighted.length > 0
        ? highlighted
        : (Array.isArray(stars) ? stars.map((s) => Number(s?.system_index || 0)).filter((n) => n > 0) : []);
      galaxy3d.setEmpireHeartbeatSystems(systems);
    }

  function applyGalaxyOwnerHighlightToRenderer(stars) {
    if (!galaxy3d || typeof galaxy3d.setEmpireHeartbeatSystems !== 'function') return;
    applySelectionGroupHighlightToRenderer(stars);
  }

  function renderGalaxyColonySummary(panel, stars, range = null) {
    if (!panel) return;
    const filteredStars = getDisplayedGalaxyStars(stars);
    const ownerFocus = getGalaxyColonyOwnerFocus();
    const highlightedSystems = getGalaxyOwnerFocusHighlightedSystems(stars);
    const groups = new Map();
    filteredStars.forEach((star) => {
      const colonyCount = Math.max(0, Number(star?.colony_count || 0));
      if (colonyCount <= 0) return;
      const ownerMeta = getGalaxyColonyOwnerMeta(star);
      const key = `${ownerMeta.ownerUserId}|${ownerMeta.ownerName}|${ownerMeta.color}|${ownerMeta.isPlayer ? 'own' : 'foreign'}`;
      const slot = groups.get(key) || {
        ownerName: ownerMeta.ownerName,
        ownerUserId: ownerMeta.ownerUserId,
        color: ownerMeta.color,
        isPlayer: ownerMeta.isPlayer,
        systems: 0,
        colonies: 0,
        population: 0,
        minSystem: Number.POSITIVE_INFINITY,
        maxSystem: 0,
      };
      const systemIndex = Math.max(0, Number(star?.system_index || 0));
      slot.systems += 1;
      slot.colonies += colonyCount;
      slot.population += Math.max(0, Number(star?.colony_population || 0));
      if (systemIndex > 0) {
        slot.minSystem = Math.min(slot.minSystem, systemIndex);
        slot.maxSystem = Math.max(slot.maxSystem, systemIndex);
      }
      groups.set(key, slot);
    });

    const rows = [...groups.values()].sort((a, b) => {
      if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
      return b.population - a.population || b.colonies - a.colonies || a.ownerName.localeCompare(b.ownerName);
    });
    const rangeText = range && Number.isFinite(Number(range.from)) && Number.isFinite(Number(range.to))
      ? `${Number(range.from)}-${Number(range.to)}`
      : 'aktuelle Range';
    const modeLabelMap = {
      all: 'Alle Systeme',
      colonies: 'Nur Koloniesysteme',
      own: 'Nur eigene Kolonien',
      foreign: 'Nur fremde Kolonien',
    };
    const modeLabel = modeLabelMap[getGalaxyColonyFilterMode()] || 'Alle Systeme';
    const focusText = ownerFocus.name ? `Besitzerfokus: ${ownerFocus.name}` : 'Besitzerfokus: keiner';
    const quickFilterText = ownerFocus.name
      ? `Schnellfilter aktiv: ${ownerFocus.name} ┬À ${highlightedSystems.length} Systeme hervorgehoben`
      : 'Schnellfilter: aus';

    panel.innerHTML = `
      <h4>Kolonie-├£bersicht</h4>
      <div class="planet-detail-3d galaxy-colony-summary-card">
        <div class="planet-detail-row">Range: ${esc(rangeText)} ┬À Filter: ${esc(modeLabel)}</div>
        <div class="planet-detail-row galaxy-owner-focus-row${ownerFocus.name ? ' galaxy-owner-focus-row-active' : ''}"><span>${esc(focusText)}</span>${ownerFocus.name ? ' <button type="button" class="btn btn-secondary btn-sm galaxy-owner-focus-clear" data-owner-focus-clear="1">Fokus l├Âsen</button>' : ''}</div>
        <div class="planet-detail-row galaxy-owner-quickfilter-row${ownerFocus.name ? ' galaxy-owner-quickfilter-row-active' : ''}">${esc(quickFilterText)}</div>
        ${rows.length ? rows.map((row) => `
          <div class="galaxy-owner-summary-actions">
            <button type="button" class="galaxy-owner-summary-row${row.isPlayer ? ' galaxy-owner-summary-row-own' : ''}${((ownerFocus.userId > 0 && row.ownerUserId === ownerFocus.userId) || (ownerFocus.userId <= 0 && ownerFocus.name && row.ownerName.localeCompare(ownerFocus.name, 'de', { sensitivity: 'base' }) === 0)) ? ' galaxy-owner-summary-row-active' : ''}" data-owner-focus-name="${esc(row.ownerName)}" data-owner-focus-user-id="${esc(String(row.ownerUserId || 0))}">
              <span class="system-colony-swatch" style="background:${esc(row.color)};box-shadow:0 0 10px ${esc(row.color)};"></span>
              <strong>${esc(row.isPlayer ? `${row.ownerName} (Du)` : row.ownerName)}</strong>
              <span>${esc(String(row.systems))} Systeme</span>
              <span>${esc(String(row.colonies))} Kolonien</span>
              <span>Pop ${esc(Number(row.population || 0).toLocaleString('de-DE'))}</span>
            </button>
            ${Number.isFinite(row.minSystem) && row.minSystem > 0 && row.maxSystem >= row.minSystem ? `<button type="button" class="btn btn-secondary btn-sm galaxy-owner-range-btn" data-owner-range-name="${esc(row.ownerName)}" data-owner-range-user-id="${esc(String(row.ownerUserId || 0))}" data-owner-range-from="${esc(String(row.minSystem))}" data-owner-range-to="${esc(String(row.maxSystem))}">Range</button>` : ''}
          </div>`).join('') : '<div class="planet-detail-row text-muted">Keine Kolonien in der aktuellen Auswahl.</div>'}
      </div>`;

    panel.querySelector('[data-owner-focus-clear="1"]')?.addEventListener('click', () => {
      settingsState.galaxyOwnerFocusUserId = 0;
      settingsState.galaxyOwnerFocusName = '';
      settingsController.saveUiSettings();
      const root = WM.body('galaxy');
      if (!root) return;
      updateGalaxyColonyFilterUi(root);
      loadGalaxyStars3D(root);
      showToast('Besitzer-Schnellfilter gel├Âst.', 'info');
    });

    panel.querySelectorAll('[data-owner-focus-name]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextUserId = Math.max(0, Number(button.getAttribute('data-owner-focus-user-id') || 0));
        const nextName = String(button.getAttribute('data-owner-focus-name') || '').trim();
        const isSame = (ownerFocus.userId > 0 && ownerFocus.userId === nextUserId)
          || (ownerFocus.userId <= 0 && ownerFocus.name && nextUserId <= 0 && ownerFocus.name.localeCompare(nextName, 'de', { sensitivity: 'base' }) === 0);
        settingsState.galaxyOwnerFocusUserId = isSame ? 0 : nextUserId;
        settingsState.galaxyOwnerFocusName = isSame ? '' : nextName;
        settingsController.saveUiSettings();
        const root = WM.body('galaxy');
        if (!root) return;
        updateGalaxyColonyFilterUi(root);
        loadGalaxyStars3D(root);
        showToast(isSame ? 'Besitzer-Schnellfilter gel├Âst.' : `Besitzer-Schnellfilter: ${nextName}`, 'info');
      });
    });

    panel.querySelectorAll('[data-owner-range-from]').forEach((button) => {
      button.addEventListener('click', async () => {
        const ownerName = String(button.getAttribute('data-owner-range-name') || '').trim() || 'Besitzer';
        const ownerUserId = Math.max(0, Number(button.getAttribute('data-owner-range-user-id') || 0));
        const rawFrom = Math.max(1, Number(button.getAttribute('data-owner-range-from') || 1));
        const rawTo = Math.max(rawFrom, Number(button.getAttribute('data-owner-range-to') || rawFrom));
        const root = WM.body('galaxy');
        if (!root) return;
        const from = Math.max(1, rawFrom - 12);
        const to = Math.min(galaxySystemMax, rawTo + 12);
        const fromInput = root.querySelector('#gal-from');
        const toInput = root.querySelector('#gal-to');
        settingsState.galaxyOwnerFocusUserId = ownerUserId;
        settingsState.galaxyOwnerFocusName = ownerName;
        settingsController.saveUiSettings();
        if (fromInput) fromInput.value = String(from);
        if (toInput) toInput.value = String(to);
        uiState.activeRange = { from, to };
        updateGalaxyColonyFilterUi(root);
        await loadGalaxyStars3D(root);

        const displayedStars = getDisplayedGalaxyStars(galaxyStars);
        const target = (Array.isArray(displayedStars) ? displayedStars : []).find((star) => {
          const systemIndex = Number(star?.system_index || 0);
          return systemIndex >= rawFrom && systemIndex <= rawTo;
        }) || (Array.isArray(displayedStars) ? displayedStars[0] : null);

        if (target) {
          pinnedStar = target;
          uiState.activeStar = target;
          setGalaxyContext(Number(target.galaxy_index || uiState.activeGalaxy || 1), Number(target.system_index || from), target);
          const flight = await runPhysicsCinematicFlight(target, {
            durationSec: 1.45,
            holdMs: 620,
            label: `${ownerName} ┬À ${target.name || target.catalog_name || `System ${Number(target.system_index || '?')}`}`,
          });
          if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') {
            galaxy3d.focusOnStar(target, !flight.ok);
          }
          renderGalaxySystemDetails(root, target, isSystemModeActive());
          showToast(`Range auf ${ownerName}: ${from}-${to} ┬À Fokus auf ${target.name || target.catalog_name || `System ${Number(target.system_index || '?')}`}`, 'info');
          return;
        }

        showToast(`Range auf ${ownerName}: ${from}-${to}`, 'info');
      });
    });
  }

  function hasDenseSystemCoverage(stars, galaxyIndex, fromSystem, toSystem) {
    const g = Number(galaxyIndex || 1);
    const from = Math.max(1, Number(fromSystem || 1));
    const to = Math.max(from, Number(toSystem || from));
    const span = to - from + 1;
    if (!Array.isArray(stars) || stars.length < span) return false;
    const seen = new Set();
    for (const s of stars) {
      if (Number(s?.galaxy_index || 0) !== g) continue;
      const sys = Number(s?.system_index || 0);
      if (sys >= from && sys <= to) seen.add(sys);
      if (seen.size >= span) return true;
    }
    return seen.size >= span;
  }

  async function hydrateGalaxyRangeInBackground(root, galaxyIndex, fromSystem, toSystem) {
    if (!root) return;
    const g = Number(galaxyIndex || 1);
    const from = Math.max(1, Number(fromSystem || 1));
    const to = Math.max(from, Number(toSystem || from));
    const myToken = ++galaxyHydrationToken;
    const chunkSize = 900;
    let loadedChunks = 0;
    let loadedSystems = 0;
    const renderDataAdapter = window.GQRenderDataAdapter || API;

    gameLog('info', '[hydrate] start', { g, from, to, token: myToken, chunkSize });

    for (let start = from; start <= to; start += chunkSize) {
      if (myToken !== galaxyHydrationToken) {
        gameLog('info', '[hydrate] cancelled', { g, from, to, token: myToken, activeToken: galaxyHydrationToken });
        return;
      }
      const end = Math.min(to, start + chunkSize - 1);
      const alreadyFresh = galaxyModel
        ? galaxyModel.hasLoadedStarRange(g, start, end, STAR_CACHE_MAX_AGE_MS)
        : false;
      if (alreadyFresh) continue;

      let data = null;
      try {
        data = await API.galaxyStars(g, start, end, chunkSize, {
          streamPriority: 'background',
          requestPriority: 'low',
          prefetch: true,
          chunkHint: chunkSize,
          clusterPreset: 'ultra',
          includeClusterLod: false,
        });
      } catch (netErr) {
        console.warn('[GQ] hydrateGalaxyRangeInBackground: chunk request failed', { g, start, end, error: netErr });
        continue;
      }

      const adaptedChunk = (typeof renderDataAdapter?.adaptGalaxyStars === 'function')
        ? renderDataAdapter.adaptGalaxyStars(data, {
            galaxy: g,
            from: start,
            to: end,
            systemMax: Math.max(galaxySystemMax, end),
            assetsManifestVersion: Number(uiState.assetsManifestVersion || 0),
          })
        : { ok: true, data };
      const chunkPayload = adaptedChunk?.ok ? adaptedChunk.data : data;
      if (!chunkPayload?.success || !Array.isArray(chunkPayload.stars)) {
        if (adaptedChunk?.ok === false) {
          const issueList = Array.isArray(adaptedChunk?.issues) ? adaptedChunk.issues.join(', ') : 'schema mismatch';
          console.warn('[GQ] hydrateGalaxyRangeInBackground: chunk schema mismatch', { g, start, end, issues: issueList });
        }
        continue;
      }

      const responseTs = Number(chunkPayload.server_ts_ms || Date.now());
      galaxyStars = mergeGalaxyStarsBySystem(galaxyStars, normalizeStarListVisibility(chunkPayload.stars), g);
      loadedChunks += 1;
      loadedSystems += chunkPayload.stars.length;
      if (loadedChunks <= 2 || loadedChunks % 5 === 0) {
        gameLog('info', '[hydrate] chunk loaded', {
          g,
          start,
          end,
          stars: chunkPayload.stars.length,
          loadedChunks,
          loadedSystems,
        });
      }

      if (galaxyModel) {
        galaxyModel.upsertStarBatch(g, normalizeStarListVisibility(chunkPayload.stars));
        galaxyModel.addLoadedStarRange(g, start, end, responseTs);
      }
      if (galaxyDB) {
            galaxyDB.upsertStars(normalizeStarListVisibility(chunkPayload.stars), responseTs).catch((err) => {
              gameLog('info', 'DB upsertStars (lazy load) fehlgeschlagen', err);
            });
      }

      if (uiState.activeGalaxy === g) {
        if (Array.isArray(chunkPayload.clusters)) uiState.rawClusters = chunkPayload.clusters;
        uiState.clusterSummary = assignClusterFactions(uiState.rawClusters || [], uiState.territory);
        if (galaxy3d) {
          const displayedStars = getDisplayedGalaxyStars(galaxyStars);
          galaxy3d.setStars(displayedStars, { preserveView: true });
          if (typeof galaxy3d.setGalaxyFleets === 'function') {
            galaxy3d.setGalaxyFleets(window._GQ_fleets || []);
          }
          if (typeof galaxy3d.setClusterAuras === 'function') {
            galaxy3d.setClusterAuras(getDisplayedGalaxyClusterSummary(uiState.clusterSummary || [], galaxyStars));
          }
          applyGalaxyOwnerHighlightToRenderer(displayedStars);
        }
        const infoRoot = getGalaxyInfoRoot();
        const details = infoRoot?.querySelector('#galaxy-system-details');
        if (details) {
          details.innerHTML = `<span class="text-cyan">Lazy full-load: ${loadedSystems} Systeme nachgeladen (${start}-${end}/${to}, chunk ${loadedChunks}).</span>`;
        }
        if (!galaxy3d?.systemMode) {
          renderGalaxyColonySummary(infoRoot?.querySelector('#galaxy-planets-panel'), galaxyStars, { from, to });
        }
      }
    }

    gameLog('info', '[hydrate] done', { g, from, to, loadedChunks, loadedSystems, token: myToken });
  }

  async function loadGalaxyStars3D(root) {
    emitGalaxyHandoffDiagnostic('stars:before-load');
    try {
      await galaxyController.loadStars3D(root);
      emitGalaxyHandoffDiagnostic('stars:after-load');
    } catch (err) {
      emitGalaxyHandoffDiagnostic('stars:error', {
        error: String(err?.message || err || 'unknown error'),
      });
      throw err;
    } finally {
      try {
        WM.refresh('minimap');
      } catch (err) {
        gameLog('warn', 'Minimap refresh failed during star load', err);
      }
    }
  }

  function summarizeSystemPayloadMeta(payload, fallbackGalaxy = 0, fallbackSystem = 0) {
    const input = (payload && typeof payload === 'object') ? payload : {};
    const starSystem = (input.star_system && typeof input.star_system === 'object') ? input.star_system : {};
    const planets = Array.isArray(input.planets) ? input.planets : [];
    const bodies = Array.isArray(input.bodies) ? input.bodies : [];
    const freeComets = Array.isArray(input.free_comets) ? input.free_comets : [];
    const roguePlanets = Array.isArray(input.rogue_planets) ? input.rogue_planets : [];
    const starInstallations = Array.isArray(input.star_installations) ? input.star_installations : [];
    const fleets = Array.isArray(input.fleets_in_system) ? input.fleets_in_system : [];
    const textureEntries = (input.planet_texture_manifest && input.planet_texture_manifest.planets && typeof input.planet_texture_manifest.planets === 'object')
      ? Object.keys(input.planet_texture_manifest.planets).length
      : 0;
    const generatedPlanets = planets.filter((planet) => !!planet?.generated_planet).length;
    const playerPlanets = planets.filter((planet) => !!planet?.player_planet).length;
    const moonCount = planets.reduce((sum, planet) => {
      const generatedMoons = Array.isArray(planet?.generated_planet?.moons) ? planet.generated_planet.moons.length : 0;
      const playerMoons = Array.isArray(planet?.player_planet?.moons) ? planet.player_planet.moons.length : 0;
      return sum + generatedMoons + playerMoons;
    }, 0);
    return {
      galaxy: Number(input.galaxy || starSystem.galaxy_index || fallbackGalaxy || 0),
      system: Number(input.system || starSystem.system_index || fallbackSystem || 0),
      starName: String(starSystem.name || ''),
      planets: planets.length,
      generatedPlanets,
      playerPlanets,
      moons: moonCount,
      bodies: bodies.length,
      freeComets: freeComets.length,
      roguePlanets: roguePlanets.length,
      starInstallations: starInstallations.length,
      fleets: fleets.length,
      textureEntries,
    };
  }

  function traceSystemQueryPipeline(stage, meta = {}) {
    try {
      if (!(window.GQLog && typeof window.GQLog.traceEnabled === 'function' && window.GQLog.traceEnabled())) {
        return;
      }
      if (window.GQLog && typeof window.GQLog.info === 'function') {
        window.GQLog.info(`[system-query] ${stage}`, meta);
      } else {
        console.info('[GQ][system-query]', stage, meta);
      }
    } catch (_) {}
  }

  function logEnterSystemPipeline(stage, meta = {}, level = 'info') {
    try {
      const payload = Object.assign({ stage: String(stage || ''), ts: Date.now() }, meta || {});
      if (window.GQLog && typeof window.GQLog[level] === 'function') {
        window.GQLog[level](`[enter-system-pipeline] ${stage}`, payload);
      } else {
        const method = (level === 'warn' || level === 'error' || level === 'info') ? level : 'log';
        console[method]('[GQ][enter-system-pipeline]', stage, payload);
      }
    } catch (_) {}
  }

  function getPreferredLevelSharedRenderer() {
    const preferred = String(settingsState?.renderQualityProfile || 'auto').toLowerCase();
    const sharedWebGpu = window.__GQ_LEVEL_SHARED_RENDERER_WEBGPU || null;
    const sharedThree = window.__GQ_LEVEL_SHARED_RENDERER_THREEJS || null;
    if (preferred === 'webgpu' && sharedWebGpu) return sharedWebGpu;
    if ((preferred === 'webgl2' || preferred === 'webgl-compat' || preferred === 'threejs') && sharedThree) return sharedThree;
    return sharedWebGpu || sharedThree || null;
  }

  function isSharedLevelRenderer(renderer) {
    if (!renderer) return false;
    return renderer === window.__GQ_LEVEL_SHARED_RENDERER_WEBGPU
      || renderer === window.__GQ_LEVEL_SHARED_RENDERER_THREEJS;
  }

  function attachRendererCallbacks(renderer, options = {}) {
    if (!renderer || !options || typeof options !== 'object') return;
    if (renderer._opts && typeof renderer._opts === 'object') {
      Object.assign(renderer._opts, options);
    }
    if (renderer.opts && typeof renderer.opts === 'object') {
      Object.assign(renderer.opts, options);
    }
  }

  function getZoomTransitionContext() {
    const gqZoom = window.GQSeamlessZoomOrchestrator || {};
    const orchestrator = zoomOrchestrator || window.__GQ_ZOOM_ORCHESTRATOR || null;
    if (orchestrator && orchestrator !== zoomOrchestrator) {
      zoomOrchestrator = orchestrator;
    }
    return {
      orchestrator,
      ZOOM_LEVEL: gqZoom.ZOOM_LEVEL || null,
      SPATIAL_DEPTH: gqZoom.SPATIAL_DEPTH || null,
    };
  }

  function resolveOnDemandZoomLevels() {
    return {
      galaxyThreeJS: window.GQGalaxyLevelThreeJS?.GalaxyLevelThreeJS || null,
      galaxyWebGPU: window.GQGalaxyLevelWebGPU?.GalaxyLevelWebGPU || window.GQGalaxyLevelThreeJS?.GalaxyLevelThreeJS || null,
      systemThreeJS: window.GQSystemLevelThreeJS?.SystemLevelThreeJS || null,
      systemWebGPU: window.GQSystemLevelWebGPU?.SystemLevelWebGPU || window.GQSystemLevelThreeJS?.SystemLevelThreeJS || null,
      planetThreeJS: window.GQPlanetApproachLevelThreeJS?.PlanetApproachLevelThreeJS || null,
      planetWebGPU: window.GQPlanetApproachLevelWebGPU?.PlanetApproachLevelWebGPU || window.GQPlanetApproachLevelThreeJS?.PlanetApproachLevelThreeJS || null,
      colonyThreeJS: window.GQColonySurfaceLevelThreeJS?.ColonySurfaceLevelThreeJS || null,
      colonyWebGPU: window.GQColonySurfaceLevelWebGPU?.ColonySurfaceLevelWebGPU || window.GQColonySurfaceLevelThreeJS?.ColonySurfaceLevelThreeJS || null,
      objectThreeJS: window.GQObjectApproachLevelThreeJS?.ObjectApproachLevelThreeJS || null,
      objectWebGPU: window.GQObjectApproachLevelWebGPU?.ObjectApproachLevelWebGPU || window.GQObjectApproachLevelThreeJS?.ObjectApproachLevelThreeJS || null,
      colonyBuildingThreeJS: window.GQColonyBuildingLevelThreeJS?.ColonyBuildingLevelThreeJS || window.GQObjectApproachLevelThreeJS?.ObjectApproachLevelThreeJS || null,
      colonyBuildingWebGPU: window.GQColonyBuildingLevelWebGPU?.ColonyBuildingLevelWebGPU || window.GQObjectApproachLevelWebGPU?.ObjectApproachLevelWebGPU || window.GQObjectApproachLevelThreeJS?.ObjectApproachLevelThreeJS || null,
    };
  }

  function ensureZoomOrchestratorAvailable() {
    const existing = zoomOrchestrator || window.__GQ_ZOOM_ORCHESTRATOR || null;
    if (existing && typeof existing.zoomToTarget === 'function') {
      return existing;
    }

    const bootstrapApi = window.GQGalaxyRendererBootstrap || null;
    const zoomApi = window.GQSeamlessZoomOrchestrator || {};
    const sharedCanvas = galaxy3d?.renderer?.domElement || document.querySelector('#galaxy-3d-host canvas');
    const levels = resolveOnDemandZoomLevels();

    if (!(sharedCanvas instanceof HTMLCanvasElement)) return null;
    if (!bootstrapApi || typeof bootstrapApi.bootstrapSeamlessZoomOrchestrator !== 'function') return null;
    if (!zoomApi.SeamlessZoomOrchestrator || !zoomApi.ZOOM_LEVEL) return null;
    if (!levels.galaxyThreeJS || !levels.galaxyWebGPU) return null;

    try {
      const next = bootstrapApi.bootstrapSeamlessZoomOrchestrator({
        currentOrchestrator: existing,
        setOrchestrator: (value) => {
          zoomOrchestrator = value || null;
          window.__GQ_ZOOM_ORCHESTRATOR = zoomOrchestrator;
        },
        getCurrentOrchestrator: () => zoomOrchestrator || window.__GQ_ZOOM_ORCHESTRATOR || null,
        sharedCanvas,
        settingsState,
        SeamlessZoomOrchestrator: zoomApi.SeamlessZoomOrchestrator,
        ZOOM_LEVEL: zoomApi.ZOOM_LEVEL,
        levels,
        adoptSharedRendererIfAvailable: () => {
          const sharedLevelRenderer = getPreferredLevelSharedRenderer();
          if (!sharedLevelRenderer) return false;
          if (galaxy3d !== sharedLevelRenderer) {
            galaxy3d = sharedLevelRenderer;
            window.galaxy3d = galaxy3d;
            attachRendererCallbacks(galaxy3d, window.__GQ_LEVEL_RENDERER_OPTIONS || {});
          }
          return true;
        },
        initDirectRendererFallback: () => !!(galaxy3d && galaxy3d.renderer),
        onDisposeError: (err) => {
          gameLog('warn', 'On-demand zoom orchestrator dispose failed', err);
        },
        onInitFailed: (err) => {
          gameLog('warn', 'On-demand zoom orchestrator init failed', err);
        },
      });
      if (next && typeof next.zoomToTarget === 'function') {
        zoomOrchestrator = next;
        window.__GQ_ZOOM_ORCHESTRATOR = next;
        return next;
      }
    } catch (err) {
      gameLog('warn', 'On-demand zoom orchestrator bootstrap failed', err);
    }

    return null;
  }

  function resolveColonyNavigationContext(colony) {
    if (!colony || typeof colony !== 'object') return null;
    const galaxy = Number(colony.galaxy || colony.galaxy_index || uiState.activeGalaxy || 0);
    const system = Number(colony.system || colony.system_index || uiState.activeSystem || 0);
    const position = Number(colony.position || colony.planet_position || colony.slot_position || 0);
    if (!galaxy || !system || !position) return null;
    return {
      galaxy,
      system,
      position,
      colonyId: Number(colony.id || 0),
      bodyType: String(colony.body_type || colony.planet_type || colony.kind || 'planet').toLowerCase(),
    };
  }

  async function resolveColonyForZoom(colonyOrId) {
    const requestedColonyId = Number(
      (typeof colonyOrId === 'object' && colonyOrId)
        ? colonyOrId.id
        : colonyOrId || 0
    );
    if (!requestedColonyId) return null;

    const localMatch = (Array.isArray(colonies) ? colonies : []).find((entry) => Number(entry?.id || 0) === requestedColonyId);
    if (localMatch && resolveColonyNavigationContext(localMatch)) {
      return localMatch;
    }

    const windowMatch = (Array.isArray(window.colonies) ? window.colonies : []).find((entry) => Number(entry?.id || 0) === requestedColonyId);
    if (windowMatch && resolveColonyNavigationContext(windowMatch)) {
      return windowMatch;
    }

    try {
      const overview = await API.overview();
      const nextColonies = Array.isArray(overview?.colonies) ? overview.colonies : [];
      if (nextColonies.length) {
        colonies = nextColonies;
        window.colonies = nextColonies;
        const refreshed = nextColonies.find((entry) => Number(entry?.id || 0) === requestedColonyId) || null;
        if (refreshed && currentColony && Number(currentColony.id || 0) === requestedColonyId) {
          currentColony = refreshed;
        }
        if (refreshed && resolveColonyNavigationContext(refreshed)) {
          return refreshed;
        }
      }
    } catch (err) {
      gameLog('warn', 'Overview colony refresh for zoom failed', err);
    }

    return null;
  }

  function resolveColonyTargetStar(navContext) {
    if (!navContext) return null;
    const activeStar = uiState.activeStar || pinnedStar || null;
    if (
      activeStar
      && Number(activeStar.galaxy_index || 0) === Number(navContext.galaxy)
      && Number(activeStar.system_index || 0) === Number(navContext.system)
    ) {
      return activeStar;
    }

    const fromList = (Array.isArray(galaxyStars) ? galaxyStars : []).find((candidate) =>
      Number(candidate?.galaxy_index || 0) === Number(navContext.galaxy)
      && Number(candidate?.system_index || 0) === Number(navContext.system)
    );
    if (fromList) return fromList;

    return {
      galaxy_index: Number(navContext.galaxy),
      system_index: Number(navContext.system),
      name: `System ${Number(navContext.system)}`,
      catalog_name: `SYS-${String(navContext.system).padStart(4, '0')}`,
    };
  }

  function resolveColonyPlanetSlotFromPayload(navContext, payload) {
    const planets = Array.isArray(payload?.planets) ? payload.planets : [];
    if (!planets.length) return null;

    const byColonyId = planets.find((slot) => Number(slot?.player_planet?.colony_id || 0) === Number(navContext?.colonyId || 0));
    if (byColonyId) return byColonyId;

    const byPosition = planets.find((slot) => Number(slot?.position || 0) === Number(navContext?.position || 0));
    if (byPosition) return byPosition;

    return null;
  }

  function waitForZoomLevel(orchestrator, expectedLevel, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = () => {
        const activeLevel = Number(orchestrator?._activeLevel);
        if (activeLevel === Number(expectedLevel)) {
          resolve(true);
          return;
        }
        if ((Date.now() - started) >= Number(timeoutMs || 0)) {
          resolve(false);
          return;
        }
        window.setTimeout(poll, 80);
      };
      poll();
    });
  }

  async function runColonyBuildingZoomSequence(colonyOrId, focusBuilding, source = 'manual') {
    const colony = await resolveColonyForZoom(colonyOrId);
    const navContext = resolveColonyNavigationContext(colony);
    if (!navContext) return false;

    const orchestrator = ensureZoomOrchestratorAvailable();
    const ctx = getZoomTransitionContext();
    const levels = ctx?.ZOOM_LEVEL || null;
    if (!orchestrator || !levels) return false;

    const root = WM?.body?.('galaxy') || null;
    const targetStar = resolveColonyTargetStar(navContext);
    if (!root || !targetStar) return false;

    const systemLevel = Number(levels.SYSTEM);
    const planetLevel = Number(levels.PLANET_APPROACH);
    const colonyLevel = Number(levels.COLONY_SURFACE);
    const buildingLevel = Number(levels.COLONY_BUILDING);
    if (![systemLevel, planetLevel, colonyLevel, buildingLevel].every((value) => Number.isFinite(value))) {
      return false;
    }

    try {
      if (Number(orchestrator._activeLevel) !== Number(levels.GALAXY)) {
        await orchestrator.zoomTo(levels.GALAXY, null);
        await waitMs(120);
      }

      await loadStarSystemPlanets(root, targetStar);
      await waitForZoomLevel(orchestrator, systemLevel, 4500);

      const systemPayload = galaxyModel?.read('system', {
        galaxy_index: navContext.galaxy,
        system_index: navContext.system,
      })?.payload || null;
      const targetSlot = resolveColonyPlanetSlotFromPayload(navContext, systemPayload);
      if (!targetSlot) return false;

      const targetBody = targetSlot.player_planet || targetSlot.generated_planet || null;
      const planetPayload = Object.assign({}, targetBody || {}, {
        __slot: targetSlot,
        position: Number(targetSlot.position || navContext.position || 0),
        galaxy_index: navContext.galaxy,
        system_index: navContext.system,
      });

      focusSystemPlanetInView({ __slot: targetSlot, position: planetPayload.position }, true);
      await waitMs(120);
      await orchestrator.zoomTo(planetLevel, planetPayload, {
        flyDuration: 850,
        cameraFrom: { x: 0, y: 0.6, z: 18 },
        cameraTo: { x: 0, y: 0.1, z: 8.5 },
      });
      await waitForZoomLevel(orchestrator, planetLevel, 2200);

      const buildingData = await API.buildings(navContext.colonyId);
      if (!buildingData?.success) return false;
      queueColonySurfaceSceneData(colony, buildingData);
      const mapped = buildColonySurfaceVfxSlots(colony, buildingData);
      const colonyPayload = {
        colony,
        layout: buildingData.layout || colony.layout || null,
        slots: Array.isArray(mapped?.slots) ? mapped.slots : [],
        vfx_quality: String(settingsState?.renderQualityProfile === 'webgpu' ? 'high' : 'medium'),
        vfx_mapper_stats: mapped?.stats || null,
        source,
      };

      await orchestrator.zoomTo(colonyLevel, colonyPayload, {
        flyDuration: 600,
        cameraFrom: { x: 0, y: 1.2, z: 9.5 },
        cameraTo: { x: 0, y: 8, z: 24 },
      });
      await waitForZoomLevel(orchestrator, colonyLevel, 1800);

      await orchestrator.zoomTo(buildingLevel, {
        spatialDepth: Number(ctx?.SPATIAL_DEPTH?.COLONY_BUILDING || 5),
        targetType: 'BUILDING',
        colonyId: navContext.colonyId,
        buildingType: String(focusBuilding || ''),
        source,
      }, {
        flyDuration: 700,
        cameraFrom: { x: 0, y: 3, z: 12 },
        cameraTo: { x: 0, y: 1.2, z: 2.2 },
      });
      return true;
    } catch (err) {
      gameLog('warn', 'Colony building zoom sequence failed', err);
      return false;
    }
  }

  function maybeZoomToColonyBuilding(colonyId, focusBuilding, source = 'manual') {
    const targetBuilding = String(focusBuilding || '').trim();
    if (!targetBuilding || targetBuilding === 'solar_satellite') return false;

    const src = String(source || 'manual');
    if (!(src.startsWith('colony-') || src === 'planet' || src === 'select-colony' || src === 'view-chain')) {
      return false;
    }

    try {
      Promise.resolve(runColonyBuildingZoomSequence(Number(colonyId || 0), targetBuilding, src)).catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }

  function resolveRendererInputContext(ctx = getZoomTransitionContext(), levelHint = null) {
    const levels = ctx?.ZOOM_LEVEL || null;
    const activeLevelRaw = Number.isFinite(Number(levelHint))
      ? Number(levelHint)
      : Number(ctx?.orchestrator?._activeLevel);
    if (Number.isFinite(activeLevelRaw) && levels) {
      const colonyLevel = Number(levels.COLONY_SURFACE);
      const objectLevel = Number(levels.OBJECT_APPROACH);
      const planetLevel = Number(levels.PLANET_APPROACH);
      const systemLevel = Number(levels.SYSTEM);
      if (Number.isFinite(colonyLevel) && activeLevelRaw >= colonyLevel) {
        return 'colonySurface';
      }
      if (Number.isFinite(objectLevel) && activeLevelRaw >= objectLevel) {
        return 'objectApproach';
      }
      if (Number.isFinite(planetLevel) && activeLevelRaw >= planetLevel) {
        return 'planetApproach';
      }
      if (Number.isFinite(systemLevel) && activeLevelRaw >= systemLevel) {
        return 'system';
      }
    }
    return galaxy3d?.systemMode ? 'system' : 'galaxy';
  }

  function syncRendererInputContext(renderer = galaxy3d, opts = {}) {
    if (!renderer || typeof renderer.setInputContext !== 'function') return '';
    const ctx = opts?.ctx || getZoomTransitionContext();
    const contextName = resolveRendererInputContext(ctx, opts?.level);
    const applyName = opts?.exact === true ? contextName : 'auto';
    try {
      renderer.setInputContext(applyName);
      return contextName;
    } catch (err) {
      gameLog('warn', 'Renderer input context sync failed', err);
      return '';
    }
  }

  function hasRendererMethod(methodName) {
    return !!(galaxy3d && typeof galaxy3d[methodName] === 'function');
  }

  function callRendererMethod(methodName, ...args) {
    if (!hasRendererMethod(methodName)) return false;
    try {
      galaxy3d[methodName](...args);
      return true;
    } catch (err) {
      gameLog('warn', `Renderer call failed: ${String(methodName || 'unknown')}`, err);
      return false;
    }
  }

  function runRendererNavAction(action) {
    return runtimeGalaxyNavActionsApi.runRendererNavAction(action);
  }

  function isSystemModeActive() {
    const ctx = getZoomTransitionContext();
    const activeLevel = Number(ctx.orchestrator?._activeLevel);
    if (Number.isFinite(activeLevel) && ctx.ZOOM_LEVEL) {
      return activeLevel >= Number(ctx.ZOOM_LEVEL.SYSTEM);
    }
    return !!galaxy3d?.systemMode;
  }

  function transitionIntoSystemView(star, payload, source = 'unknown') {
    initSystemBreadcrumb();
    const ctx = getZoomTransitionContext();
    syncRendererInputContext(galaxy3d, { ctx });
    let orchestratorDispatched = false;
    if (ctx.orchestrator && ctx.SPATIAL_DEPTH && star) {
      try {
        ctx.orchestrator.zoomToTarget(
          Object.assign({ spatialDepth: ctx.SPATIAL_DEPTH.STAR_SYSTEM }, star),
        ).catch(() => {});
        orchestratorDispatched = true;
      } catch (_) {}
    }

    const systemLevel = ctx.ZOOM_LEVEL?.SYSTEM;
    if (ctx.orchestrator && Number.isFinite(Number(systemLevel)) && typeof ctx.orchestrator.setSceneData === 'function') {
      try {
        Promise.resolve(ctx.orchestrator.setSceneData(systemLevel, {
          star,
          stars: star ? [star] : [],
          systemPayload: payload || null,
          planets: Array.isArray(payload?.planets) ? payload.planets : [],
          fleets: Array.isArray(payload?.fleets_in_system) ? payload.fleets_in_system : [],
          starInstallations: Array.isArray(payload?.star_installations) ? payload.star_installations : [],
        })).then((accepted) => {
          if (!accepted) return;
          const sharedLevelRenderer = getPreferredLevelSharedRenderer();
          if (sharedLevelRenderer && galaxy3d !== sharedLevelRenderer) {
            galaxy3d = sharedLevelRenderer;
            attachRendererCallbacks(galaxy3d, window.__GQ_LEVEL_RENDERER_OPTIONS || {});
          }
        }).catch(() => {});
      } catch (_) {}
    }

    if (orchestratorDispatched && ctx.ZOOM_LEVEL) {
      setTimeout(() => { syncRendererInputContext(galaxy3d, { ctx }); }, 80);
      setTimeout(() => { syncRendererInputContext(galaxy3d, { ctx }); }, 320);
      if (payload) triggerSystemBreadcrumbEnter(payload, galaxy3d || null);
      logEnterSystemPipeline(`${source}:orchestrator-enter-dispatch`, {
        rendererInstanceId: String(galaxy3d?.getRenderStats?.().instanceId || galaxy3d?.instanceId || ''),
        rendererSystemModeAfter: !!galaxy3d?.systemMode,
        renderStats: galaxy3d?.getRenderStats?.() || null,
      });
      return true;
    }

    const allowLegacyFallback = !ctx.orchestrator || !ctx.ZOOM_LEVEL || settingsState.systemViewLegacyFallback === true;
    if (!allowLegacyFallback) {
      logEnterSystemPipeline(`${source}:enterSystemView:legacy-fallback-disabled`, {
        rendererInstanceId: String(galaxy3d?.getRenderStats?.().instanceId || galaxy3d?.instanceId || ''),
        hasRenderer: !!galaxy3d,
      }, 'warn');
      return false;
    }

    if (galaxy3d && typeof galaxy3d.enterSystemView === 'function') {
      galaxy3d.enterSystemView(star, payload);
      syncRendererInputContext(galaxy3d, { ctx, level: Number(ctx.ZOOM_LEVEL?.SYSTEM) });
      logEnterSystemPipeline(`${source}:enterSystemView`, {
        rendererInstanceId: String(galaxy3d?.getRenderStats?.().instanceId || galaxy3d?.instanceId || ''),
        rendererSystemModeAfter: !!galaxy3d?.systemMode,
        renderStats: galaxy3d?.getRenderStats?.() || null,
      });
      if (payload) triggerSystemBreadcrumbEnter(payload, galaxy3d);
      return true;
    }

    logEnterSystemPipeline(`${source}:enterSystemView:missing`, {
      rendererInstanceId: String(galaxy3d?.getRenderStats?.().instanceId || galaxy3d?.instanceId || ''),
      rendererBackend: String(galaxy3d?.backendType || galaxy3d?.getRenderStats?.().backend || ''),
      hasRenderer: !!galaxy3d,
    }, 'warn');
    return false;
  }

  function transitionOutOfSystemView(star, source = 'unknown') {
    const ctx = getZoomTransitionContext();
    syncRendererInputContext(galaxy3d, { ctx });
    let orchestratorDispatched = false;
    if (ctx.orchestrator && ctx.ZOOM_LEVEL) {
      try {
        ctx.orchestrator.zoomTo(ctx.ZOOM_LEVEL.GALAXY, null).catch(() => {});
        orchestratorDispatched = true;
      } catch (_) {}
    }

    if (orchestratorDispatched && ctx.ZOOM_LEVEL) {
      setTimeout(() => { syncRendererInputContext(galaxy3d, { ctx }); }, 80);
      setTimeout(() => { syncRendererInputContext(galaxy3d, { ctx }); }, 320);
      triggerSystemBreadcrumbExit();
      logEnterSystemPipeline(`${source}:orchestrator-exit-dispatch`, {
        rendererInstanceId: String(galaxy3d?.getRenderStats?.().instanceId || galaxy3d?.instanceId || ''),
        rendererSystemModeAfter: !!galaxy3d?.systemMode,
      });
      return true;
    }

    const allowLegacyFallback = !ctx.orchestrator || !ctx.ZOOM_LEVEL || settingsState.systemViewLegacyFallback === true;
    if (!allowLegacyFallback) {
      logEnterSystemPipeline(`${source}:exitSystemView:legacy-fallback-disabled`, {
        rendererInstanceId: String(galaxy3d?.getRenderStats?.().instanceId || galaxy3d?.instanceId || ''),
        hasRenderer: !!galaxy3d,
      }, 'warn');
      return false;
    }

    if (galaxy3d && typeof galaxy3d.exitSystemView === 'function') {
      galaxy3d.exitSystemView(true);
      syncRendererInputContext(galaxy3d, { ctx, level: Number(ctx.ZOOM_LEVEL?.GALAXY) });
      triggerSystemBreadcrumbExit();
      logEnterSystemPipeline(`${source}:exitSystemView`, {
        rendererInstanceId: String(galaxy3d?.getRenderStats?.().instanceId || galaxy3d?.instanceId || ''),
        rendererSystemModeAfter: !!galaxy3d?.systemMode,
      });
      return true;
    }

    logEnterSystemPipeline(`${source}:exitSystemView:missing`, {
      rendererInstanceId: String(galaxy3d?.getRenderStats?.().instanceId || galaxy3d?.instanceId || ''),
      rendererBackend: String(galaxy3d?.backendType || galaxy3d?.getRenderStats?.().backend || ''),
      hasRenderer: !!galaxy3d,
      hasStar: !!star,
    }, 'warn');
    return false;
  }

  const runtimeSystemBreadcrumbHelpersApi = requireRuntimeApi('GQRuntimeSystemBreadcrumbHelpers', [
    'initSystemBreadcrumb',
    'triggerSystemBreadcrumbEnter',
    'triggerSystemBreadcrumbExit',
  ]);
  let systemBreadcrumbIntegration = null;

  function initSystemBreadcrumb() {
    if (systemBreadcrumbIntegration) return systemBreadcrumbIntegration;
    runtimeSystemBreadcrumbHelpersApi.initSystemBreadcrumb({
      windowRef: window,
      setIntegration: (integration) => {
        systemBreadcrumbIntegration = integration || null;
      },
      logger: console,
    });
    if (systemBreadcrumbIntegration) return systemBreadcrumbIntegration;
    return null;
  }

  function triggerSystemBreadcrumbEnter(payload, renderer) {
    const integration = initSystemBreadcrumb();
    if (!integration) return;
    runtimeSystemBreadcrumbHelpersApi.triggerSystemBreadcrumbEnter(payload, renderer || null, {
      getIntegration: () => systemBreadcrumbIntegration,
      logger: console,
    });
  }

  function triggerSystemBreadcrumbExit() {
    runtimeSystemBreadcrumbHelpersApi.triggerSystemBreadcrumbExit({
      getIntegration: () => systemBreadcrumbIntegration,
      logger: console,
    });
  }

  function focusSystemPlanetInView(planetLike, smooth = true) {
    const payload = planetLike && typeof planetLike === 'object'
      ? planetLike
      : null;
    if (!payload) return false;

    const ctx = getZoomTransitionContext();
    const systemLevel = ctx.ZOOM_LEVEL?.SYSTEM;
    if (ctx.orchestrator && Number.isFinite(Number(systemLevel)) && typeof ctx.orchestrator.setSceneData === 'function') {
      try {
        Promise.resolve(ctx.orchestrator.setSceneData(systemLevel, {
          focusPlanet: payload,
        })).then((accepted) => {
          if (!accepted) return;
          const sharedLevelRenderer = getPreferredLevelSharedRenderer();
          if (sharedLevelRenderer && galaxy3d !== sharedLevelRenderer) {
            galaxy3d = sharedLevelRenderer;
            attachRendererCallbacks(galaxy3d, window.__GQ_LEVEL_RENDERER_OPTIONS || {});
          }
        }).catch(() => {});
      } catch (_) {}
    }

    return callRendererMethod('focusOnSystemPlanet', payload, smooth);
  }

  async function loadStarSystemPlanets(root, star) {
    const infoRoot = getGalaxyInfoRoot();
    const panel = infoRoot?.querySelector('#galaxy-planets-panel');
    if (!star) return;

    if (panel) {
      panel.innerHTML = '<p class="text-muted">Loading planets...</p>';
    }

    const g = Number(star.galaxy_index || 1);
    const s = Number(star.system_index || 1);
    logEnterSystemPipeline('loadStarSystemPlanets:start', {
      rendererInstanceId: String(galaxy3d?.getRenderStats?.().instanceId || galaxy3d?.instanceId || ''),
      rendererBackend: String(galaxy3d?.backendType || galaxy3d?.getRenderStats?.().backend || ''),
      rendererHasEnterSystemView: typeof galaxy3d?.enterSystemView === 'function',
      rendererHasExitSystemView: typeof galaxy3d?.exitSystemView === 'function',
      galaxy: g,
      system: s,
      starName: String(star?.name || star?.catalog_name || ''),
      rendererSystemModeBefore: !!galaxy3d?.systemMode,
    });

    const buildSafeSystemPayload = (rawPayload) => {
      const input = (rawPayload && typeof rawPayload === 'object') ? rawPayload : {};
      traceSystemQueryPipeline('buildSafeSystemPayload:input', summarizeSystemPayloadMeta(input, g, s));
      const safeStar = (input.star_system && typeof input.star_system === 'object')
        ? input.star_system
        : {};
      const safePlanets = Array.isArray(input.planets) ? input.planets : [];
      const safeBodies = Array.isArray(input.bodies) ? input.bodies : [];
      const safeFreeComets = Array.isArray(input.free_comets) ? input.free_comets : [];
      const safeRoguePlanets = Array.isArray(input.rogue_planets) ? input.rogue_planets : [];
      const safeStarInstallations = Array.isArray(input.star_installations) ? input.star_installations : [];
      const safeFleets = Array.isArray(input.fleets_in_system) ? input.fleets_in_system : [];
      const safeManifest = (input.planet_texture_manifest && typeof input.planet_texture_manifest === 'object')
        ? input.planet_texture_manifest
        : { version: 1, planets: {} };

      if (!safeManifest.planets || typeof safeManifest.planets !== 'object') {
        safeManifest.planets = {};
      }

      const safePayload = {
        galaxy: Number(input.galaxy || g),
        system: Number(input.system || s),
        star_system: {
          galaxy_index: g,
          system_index: s,
          name: String(safeStar.name || star.name || star.catalog_name || `System ${s}`),
          spectral_class: String(safeStar.spectral_class || star.spectral_class || 'G'),
          subtype: String(safeStar.subtype || star.subtype || ''),
          x_ly: Number(safeStar.x_ly ?? star.x_ly ?? 0),
          y_ly: Number(safeStar.y_ly ?? star.y_ly ?? 0),
          z_ly: Number(safeStar.z_ly ?? star.z_ly ?? 0),
        },
        planets: safePlanets,
        bodies: safeBodies,
        free_comets: safeFreeComets,
        rogue_planets: safeRoguePlanets,
        star_installations: safeStarInstallations,
        fleets_in_system: safeFleets,
        planet_texture_manifest: safeManifest,
      };
      traceSystemQueryPipeline('buildSafeSystemPayload:output', summarizeSystemPayloadMeta(safePayload, g, s));
      return safePayload;
    };

    setGalaxyContext(g, s, star);
    const systemPolicy = LEVEL_POLICIES.system.payload;

    let loadResult = null;
    try {
      loadResult = await ensureSystemPayloadLazy(g, s, {
        allowStaleFirst: systemPolicy.allowStaleFirst,
        maxAgeMs: systemPolicy.cacheMaxAgeMs,
        onStaleData: (payload) => {
          logEnterSystemPipeline('loadStarSystemPlanets:onStaleData', Object.assign({
            rendererInstanceId: String(galaxy3d?.getRenderStats?.().instanceId || galaxy3d?.instanceId || ''),
          }, summarizeSystemPayloadMeta(payload, g, s)));
          if (panel) {
            renderPlanetPanel(panel, star, payload);
          }
          transitionIntoSystemView(star, payload, 'loadStarSystemPlanets:onStaleData');
        },
      });
      traceSystemQueryPipeline('loadStarSystemPlanets:loadResult', {
        source: String(loadResult?.source || 'none'),
        fresh: !!loadResult?.fresh,
        meta: summarizeSystemPayloadMeta(loadResult?.payload, g, s),
      });
    } catch (err) {
      console.error('[GQ] loadStarSystemPlanets: unexpected error during payload fetch', err);
      pushGalaxyDebugError('system-payload', String(err?.message || err || 'unknown error'), `${g}:${s}`);
      loadResult = null;
    }

    if (!loadResult || !loadResult.payload) {
      const fallbackPayload = buildSafeSystemPayload(null);
      logEnterSystemPipeline('loadStarSystemPlanets:fallback-payload', summarizeSystemPayloadMeta(fallbackPayload, g, s), 'warn');
      try {
        transitionIntoSystemView(star, fallbackPayload, 'loadStarSystemPlanets:fallback');
      } catch (e3d) {
        console.error('[GQ] enterSystemView (fallback) failed:', e3d);
        pushGalaxyDebugError('system-render-fallback', String(e3d?.message || e3d || 'unknown error'), `${g}:${s}`);
      }
      if (panel) {
        panel.innerHTML = `<p class="text-yellow">Systemansicht ge├Âffnet. Planetendaten konnten nicht geladen werden.</p>
          <button class="btn btn-secondary btn-sm" style="margin-top:0.4rem" id="planet-retry-btn">Ôå║ Erneut laden</button>`;
        const retryBtn = panel.querySelector('#planet-retry-btn');
        if (retryBtn) retryBtn.addEventListener('click', () => loadStarSystemPlanets(root, star));
      }
      showToast('Planetendaten nicht verf├╝gbar ÔÇô bitte Retry klicken oder Doppelklick wiederholen.', 'warning');
      if (galaxyModel) {
        galaxyModel.setSystemLoadState(g, s, { pending: false, payload: 'error' });
      }
      return;
    }

    const safePayload = buildSafeSystemPayload(loadResult.payload);
    logEnterSystemPipeline('loadStarSystemPlanets:safePayload', summarizeSystemPayloadMeta(safePayload, g, s));
    if (panel) {
      renderPlanetPanel(panel, star, safePayload);
    }
    try {
      transitionIntoSystemView(star, safePayload, 'loadStarSystemPlanets:final');
    } catch (e3d) {
      console.error('[GQ] enterSystemView failed:', e3d);
      pushGalaxyDebugError('system-render', String(e3d?.message || e3d || 'unknown error'), `${g}:${s}`);
      let fallbackOk = false;
      try {
        fallbackOk = transitionIntoSystemView(star, buildSafeSystemPayload(null), 'loadStarSystemPlanets:error-fallback');
      } catch (fallbackErr) {
        console.error('[GQ] enterSystemView fallback failed:', fallbackErr);
        pushGalaxyDebugError('system-render-fallback', String(fallbackErr?.message || fallbackErr || 'unknown error'), `${g}:${s}`);
      }
      if (fallbackOk) {
        showToast('Systemansicht mit Fallback geladen (Details im Log).', 'warning');
      } else {
        showToast(`3D-Systemansicht konnte nicht geladen werden: ${String(e3d?.message || e3d || 'unbekannt')}`, 'warning');
      }
    }
    if (galaxyModel) {
      galaxyModel.setSystemLoadState(g, s, {
        pending: false,
        payload: 'loaded',
        planets: 'loaded',
        fetched_at: Date.now(),
      });
    }
  }

  async function ensureSystemPayloadLazy(galaxyIndex, systemIndex, opts = {}) {
    const g = Number(galaxyIndex || 1);
    const s = Number(systemIndex || 1);
    const allowStaleFirst = isCurrentUserAdmin() ? false : !!opts.allowStaleFirst;
    const maxAgeMs = Number(opts.maxAgeMs || SYSTEM_CACHE_MAX_AGE_MS);
    const onStaleData = typeof opts.onStaleData === 'function' ? opts.onStaleData : null;

    const currentState = galaxyModel ? galaxyModel.getSystemLoadState(g, s) : null;
    // Note: do NOT check currentState.pending here ÔÇö the caller may have set it already.
    const alreadyLoaded = currentState && currentState.payload === 'loaded';
    const systemNode = galaxyModel ? galaxyModel.read('system', { galaxy_index: g, system_index: s }) : null;

    if (!isCurrentUserAdmin() && alreadyLoaded && systemNode?.payload && hasPlanetTextureManifest(systemNode.payload)) {
      const payload = normalizeSystemPayloadVisibility(systemNode.payload);
      traceSystemQueryPipeline('ensureSystemPayloadLazy:model-hit', {
        source: 'model',
        meta: summarizeSystemPayloadMeta(payload, g, s),
      });
      return { source: 'model', payload, fresh: true };
    }

    if (allowStaleFirst && systemNode?.payload && onStaleData) {
      onStaleData(systemNode.payload);
    }

    let staleFallbackPayload = isCurrentUserAdmin() ? null : (systemNode?.payload || null);

    if (galaxyDB && !isCurrentUserAdmin()) {
      try {
        const dbPayload = await galaxyDB.getSystemPayload(g, s, { maxAgeMs });
        if (dbPayload && hasPlanetTextureManifest(dbPayload)) {
          const normalizedDbPayload = normalizeSystemPayloadVisibility(dbPayload);
          traceSystemQueryPipeline('ensureSystemPayloadLazy:db-hit', {
            source: 'db',
            meta: summarizeSystemPayloadMeta(normalizedDbPayload, g, s),
          });
          if (galaxyModel) {
            galaxyModel.attachSystemPayload(g, s, normalizedDbPayload);
            galaxyModel.setSystemLoadState(g, s, {
              payload: 'loaded',
              planets: 'loaded',
              pending: false,
              fetched_at: Date.now(),
            });
          }
          return { source: 'db', payload: normalizedDbPayload, fresh: true };
        }
        if (dbPayload && !staleFallbackPayload) staleFallbackPayload = dbPayload;
      } catch (dbErr) {
        console.warn('[GQ] ensureSystemPayloadLazy: DB read failed', dbErr);
      }
    }

    try {
      const data = await API.galaxy(g, s);
      if (!data || !data.success) {
        console.error('[GQ] ensureSystemPayloadLazy: API returned non-success', data);
        return staleFallbackPayload ? { source: 'stale', payload: staleFallbackPayload, fresh: false } : null;
      }
      const responseTs = Number(data.server_ts_ms || Date.now());
      const normalizedData = normalizeSystemPayloadVisibility(data);
      traceSystemQueryPipeline('ensureSystemPayloadLazy:network', {
        source: 'network',
        meta: summarizeSystemPayloadMeta(normalizedData, g, s),
      });

      if (galaxyModel) {
        galaxyModel.attachSystemPayload(g, s, normalizedData);
        galaxyModel.setSystemLoadState(g, s, {
          payload: 'loaded',
          planets: 'loaded',
          pending: false,
          fetched_at: responseTs,
        });
      }
      if (galaxyDB) {
            galaxyDB.upsertSystemPayload(g, s, normalizedData, responseTs).catch((err) => {
              gameLog('info', 'DB upsertSystemPayload fehlgeschlagen', err);
            });
      }
      return { source: 'network', payload: normalizedData, fresh: true };
    } catch (netErr) {
      console.error('[GQ] ensureSystemPayloadLazy: network fetch failed for galaxy', g, 'system', s, netErr);
      return staleFallbackPayload ? { source: 'stale', payload: staleFallbackPayload, fresh: false } : null;
    }
  }

  function ensurePlanetDetailPanel(panel) {
    let detail = panel.querySelector('.planet-detail-3d');
    if (!detail) {
      detail = document.createElement('div');
      detail.className = 'planet-detail-3d';
      panel.appendChild(detail);
    }
    return detail;
  }

  function attachPlanetDetailActions(detail, colonyId, isOwnedColony) {
    detail.querySelectorAll('[data-colony-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!colonyId) return;
        const action = String(btn.dataset.colonyAction || '').toLowerCase();
        if (!isOwnedColony) return;

        if (action === 'open') {
          focusColonyDevelopment(colonyId, { source: 'detail-action' });
          return;
        }

        openColonySubview(colonyId, action, {
          source: 'detail-action',
          prefillTarget: {
            galaxy: Number(btn.dataset.targetGalaxy || uiState.activeGalaxy || 1),
            system: Number(btn.dataset.targetSystem || uiState.activeSystem || 1),
            position: Number(btn.dataset.targetPosition || 1),
          },
          mission: String(btn.dataset.fleetMission || 'transport'),
        });
      });
    });
    detail.querySelectorAll('[data-fleet-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const galaxy = Number(btn.dataset.targetGalaxy || 0);
        const system = Number(btn.dataset.targetSystem || 0);
        const position = Number(btn.dataset.targetPosition || 0);
        const mission = String(btn.dataset.fleetAction || 'transport');
        const intel = detail.__planetIntel || null;
        prefillFleetTarget({ galaxy, system, position }, mission, {
          owner: detail.dataset.ownerName || '',
          threatLevel: intel?.intel?.threat?.label || '',
          intel,
        });
      });
    });
  }

  function setActivePlanetListItem(panel, position) {
    panel.querySelectorAll('.planet-item').forEach((el) => {
      el.classList.toggle('planet-item-active', Number(el.dataset.pos || 0) === Number(position || 0));
    });
  }

  function clampPct(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return Math.max(0, Math.min(100, Number(fallback) || 0));
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  function statusToneClass(pct) {
    if (pct < 30) return 'is-critical';
    if (pct < 60) return 'is-warning';
    return 'is-good';
  }

  function buildEntityBarsHtml(healthPct, shieldPct, scopeLabel = 'Entity') {
    const hp = clampPct(healthPct, 0);
    const sh = clampPct(shieldPct, 0);
    const hpTone = statusToneClass(hp);
    const shTone = statusToneClass(sh);
    return `
      <div class="entity-bars" aria-label="${esc(scopeLabel)} status bars">
        <div class="entity-bar-row" title="${esc(scopeLabel)} integrity ${hp}%">
          <span class="entity-bar-label">Health</span>
          <div class="bar-wrap"><div class="bar-fill bar-integrity ${hpTone}" style="width:${hp}%"></div></div>
          <span class="entity-bar-value">${hp}%</span>
        </div>
        <div class="entity-bar-row" title="${esc(scopeLabel)} shields ${sh}%">
          <span class="entity-bar-label">Shield</span>
          <div class="bar-wrap"><div class="bar-fill bar-shield ${shTone}" style="width:${sh}%"></div></div>
          <span class="entity-bar-value">${sh}%</span>
        </div>
      </div>`;
  }

  function getPlanetSlotOrbit(slot) {
    const pp = slot?.player_planet;
    const gp = slot?.generated_planet;
    const orbit = Number(pp?.semi_major_axis_au ?? gp?.semi_major_axis_au);
    return Number.isFinite(orbit) ? orbit : null;
  }

  function getPlanetSlotLabel(slot) {
    const pos = Number(slot?.position || 0);
    const pp = slot?.player_planet;
    const gp = slot?.generated_planet;
    if (pp) {
      return `#${pos} ${String(pp.colony_name || pp.name || 'Kolonie')}`;
    }
    if (gp) {
      return `#${pos} ${String(gp.name || fmtName(gp.planet_class || 'Planet'))}`;
    }
    return `#${pos} Leerer Slot`;
  }

  function collectNearestPlanetNeighbors(detail, slot, limit = 3) {
    const context = detail?.__planetContext || {};
    const planets = Array.isArray(context.planets) ? context.planets : [];
    const currentPos = Number(slot?.position || 0);
    const currentOrbit = getPlanetSlotOrbit(slot);
    if (!currentPos || !planets.length) return [];

    return planets
      .filter((candidate) => Number(candidate?.position || 0) > 0 && Number(candidate.position || 0) !== currentPos)
      .map((candidate) => {
        const candidatePos = Number(candidate.position || 0);
        const candidateOrbit = getPlanetSlotOrbit(candidate);
        let score = Math.abs(candidatePos - currentPos) * 10;
        if (currentOrbit !== null && candidateOrbit !== null) {
          score = Math.abs(candidateOrbit - currentOrbit);
        }
        return {
          slot: candidate,
          score,
          distText: (currentOrbit !== null && candidateOrbit !== null)
            ? `${Math.abs(candidateOrbit - currentOrbit).toFixed(2)} AU`
            : `${candidatePos > currentPos ? '+' : ''}${candidatePos - currentPos} Pos`,
        };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, Math.max(1, Number(limit || 3)));
  }

  function buildPlanetNeighborArrowsHtml(detail, slot) {
    const neighbors = collectNearestPlanetNeighbors(detail, slot, 3);
      // Store enriched entries for the canvas overlay (GQNeighborWaypointOverlay).
      detail.__neighborOverlayData = neighbors.map((entry) => ({
        slot:     entry.slot,
        label:    getPlanetSlotLabel(entry.slot),
        distText: entry.distText || '',
      }));
      return ''; // rendered as canvas waypoints via bindPlanetNeighborActions
  }

  function bindPlanetNeighborActions(detail) {
    const context = detail?.__planetContext || {};
    const panel = context.panel || null;
    const planets = Array.isArray(context.planets) ? context.planets : [];
    if (!detail || !panel || !planets.length) return;

      const entries = Array.isArray(detail.__neighborOverlayData) ? detail.__neighborOverlayData : [];
      const overlay = typeof window?.GQNeighborWaypointOverlay?.getOverlay === 'function'
        ? window.GQNeighborWaypointOverlay.getOverlay() : null;

      if (overlay && entries.length) {
        const canvas3d = galaxy3d?.renderer?.domElement || null;
        if (canvas3d) overlay.mount(canvas3d, () => galaxy3d);
        overlay.setPlanetNeighbors(entries, (entry) => {
          const pos = Number(entry.slot?.position || 0);
          if (!pos) return;
          const targetSlot = planets.find((e) => Number(e?.position || 0) === pos);
          if (!targetSlot) return;
          setActivePlanetListItem(panel, pos);
          detail.__planetContext = context;
          void renderPlanetDetailCard(detail, targetSlot);
          focusSystemPlanetInView({ __slot: targetSlot, position: pos }, true);
        });
      } else if (overlay) {
        overlay.clear();
      }

      detail.addEventListener('keydown', (e) => {
        const tag = String(e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
        const rank = Number(e.key);
        if (rank < 1 || rank > 3) return;
        if (!overlay) return;
        e.preventDefault();
        overlay.activate(rank);
      });
  }

  async function renderPlanetDetailCard(detail, slot) {
    const pos = Number(slot?.position || 0);
    const pp = slot?.player_planet;
    const gp = slot?.generated_planet;
    const neighborArrowsHtml = buildPlanetNeighborArrowsHtml(detail, slot);
    if (pp) {
      const colonyId = Number(pp.colony_id || 0);
      const ownColony = colonies.find((col) => Number(col.id || 0) === colonyId) || null;
      const isOwnedColony = !!ownColony;
      const ownerBadge = isOwnedColony ? 'Eigene Kolonie' : 'Fremde Kolonie';
      const targetGalaxy = Number(pp.galaxy || ownColony?.galaxy || uiState.activeGalaxy || 0);
      const targetSystem = Number(pp.system || ownColony?.system || uiState.activeSystem || 0);
      const targetPosition = Number(pp.position || ownColony?.position || pos || 0);
      const detailHealthPct = clampPct(
        ownColony?.integrity_pct
          ?? ownColony?.health_pct
          ?? ownColony?.hp_pct
          ?? ownColony?.condition_pct
          ?? ownColony?.public_services
          ?? ownColony?.happiness,
        70,
      );
      const detailShieldPct = clampPct(
        ownColony?.shield_pct
          ?? ownColony?.shields_pct
          ?? ownColony?.planetary_shield_pct,
        0,
      );
      detail.dataset.ownerName = String(pp.owner || '');
      detail.innerHTML = `
        <h5>Planet #${pos} - ${esc(pp.name)}</h5>
        ${neighborArrowsHtml}
        <div class="planet-detail-row planet-detail-owner-row"><span class="planet-owner-badge ${isOwnedColony ? 'own' : 'foreign'}">${esc(ownerBadge)}</span>Owner: ${esc(pp.owner || 'Unknown')}</div>
        <div class="planet-detail-row">Class: ${esc(pp.planet_class || pp.type || 'ÔÇö')}</div>
        <div class="planet-detail-row">Colony ID: ${esc(String(pp.colony_id || 'ÔÇö'))}</div>
        <div class="planet-detail-row">Orbit: ${Number(pp.semi_major_axis_au || 0).toFixed(3)} AU</div>
        <div class="planet-detail-row">Habitable Zone: ${pp.in_habitable_zone ? 'Yes' : 'No'}</div>
        ${isOwnedColony ? `
          <div class="planet-detail-row">Colony Type: ${esc(fmtName(ownColony.colony_type || 'balanced'))}</div>
          <div class="planet-detail-row">Population: ${fmt(ownColony.population || 0)} / ${fmt(ownColony.max_population || 0)}</div>
          <div class="planet-detail-row">Happiness: ${esc(String(ownColony.happiness ?? 'ÔÇö'))}% ┬À Energy: ${esc(String(ownColony.energy ?? 'ÔÇö'))}</div>
          ${buildEntityBarsHtml(detailHealthPct, detailShieldPct, 'Colony')}
          <div class="planet-detail-actions">
            <button class="btn btn-secondary btn-sm" data-colony-action="overview">Overview</button>
            <button class="btn btn-secondary btn-sm" data-colony-action="colony">Colony</button>
            <button class="btn btn-secondary btn-sm" data-colony-action="buildings">Buildings</button>
            <button class="btn btn-secondary btn-sm" data-colony-action="shipyard">Shipyard</button>
            <button class="btn btn-secondary btn-sm" data-colony-action="fleet" data-fleet-mission="transport" data-target-galaxy="${targetGalaxy}" data-target-system="${targetSystem}" data-target-position="${targetPosition}">Fleet</button>
            <button class="btn btn-secondary btn-sm" data-colony-action="gates">Gate Installations</button>
            <button class="btn btn-secondary btn-sm" data-colony-action="orbitals">Orbital Installations</button>
            <button class="btn btn-primary btn-sm" data-colony-action="open">Build Focus</button>
          </div>
          <div class="planet-detail-extra text-muted">Loading colony dataÔÇª</div>` : `
          <div class="planet-detail-actions">
            <button class="btn btn-secondary btn-sm" data-fleet-action="spy" data-target-galaxy="${targetGalaxy}" data-target-system="${targetSystem}" data-target-position="${targetPosition}">Spy</button>
            <button class="btn btn-secondary btn-sm" data-fleet-action="attack" data-target-galaxy="${targetGalaxy}" data-target-system="${targetSystem}" data-target-position="${targetPosition}">Attack</button>
            <button class="btn btn-primary btn-sm" data-fleet-action="transport" data-target-galaxy="${targetGalaxy}" data-target-system="${targetSystem}" data-target-position="${targetPosition}">Fleet</button>
          </div>
          <div class="planet-detail-extra text-muted">Lade Scan- und SektorinformationenÔÇª</div>`}`;
      attachPlanetDetailActions(detail, colonyId, isOwnedColony);
      bindPlanetNeighborActions(detail);
      if (isOwnedColony) {
        const extra = detail.querySelector('.planet-detail-extra');
        const token = `${Date.now()}-${Math.random()}`;
        detail.dataset.detailToken = token;
        try {
          const [resourcesRes, buildingsRes] = await Promise.all([
            API.resources(colonyId),
            API.buildings(colonyId),
          ]);
          if (detail.dataset.detailToken !== token || !extra) return;

          const resources = resourcesRes?.success ? resourcesRes.resources || {} : {};
          const buildings = buildingsRes?.success ? (buildingsRes.buildings || []).slice().sort((a, b) => Number(b.level || 0) - Number(a.level || 0)).slice(0, 4) : [];
          const layout = buildingsRes?.success ? buildingsRes.layout || null : null;
          const orbitalFacilities = buildingsRes?.success ? buildingsRes.orbital_facilities || [] : [];
          const extraHealthPct = clampPct(
            resources.integrity_pct
              ?? resources.health_pct
              ?? resources.hp_pct
              ?? resources.condition_pct
              ?? resources.public_services
              ?? ownColony.public_services
              ?? ownColony.happiness,
            detailHealthPct,
          );
          const extraShieldPct = clampPct(
            resources.shield_pct
              ?? resources.shields_pct
              ?? resources.planetary_shield_pct
              ?? ownColony.shield_pct
              ?? ownColony.shields_pct
              ?? ownColony.planetary_shield_pct,
            detailShieldPct,
          );
          extra.innerHTML = `
            ${buildEntityBarsHtml(extraHealthPct, extraShieldPct, 'Colony')}
            <div class="planet-detail-row">Metal: ${fmt(resources.metal || ownColony.metal || 0)} ┬À Crystal: ${fmt(resources.crystal || ownColony.crystal || 0)}</div>
            <div class="planet-detail-row">Deuterium: ${fmt(resources.deuterium || ownColony.deuterium || 0)} ┬À Food: ${fmt(resources.food || ownColony.food || 0)}</div>
            <div class="planet-detail-row">Rare Earth: ${fmt(resources.rare_earth || ownColony.rare_earth || 0)} ┬À Services: ${esc(String(resources.public_services || ownColony.public_services || 'ÔÇö'))}</div>
            <div class="planet-detail-row">Top Buildings: ${buildings.length ? buildings.map((b) => `${esc(fmtName(b.type))} Lv ${esc(String(b.level || 0))}`).join(' ┬À ') : 'No building data'}</div>
            <div class="planet-detail-row">Grid: ${esc(String(layout?.grid?.cols || 0))} ├ù ${esc(String(layout?.grid?.rows || 0))} ┬À Orbital slots: ${esc(String(layout?.grid?.orbital_slots || 0))}</div>
            <div class="planet-detail-row">Orbitals: ${orbitalFacilities.length ? orbitalFacilities.map((facility) => `${esc(facility.icon)} ${esc(facility.label)}`).join(' ┬À ') : 'No orbital facilities online'}</div>`;
        } catch (_) {
          if (detail.dataset.detailToken === token && extra) {
            extra.innerHTML = '<div class="planet-detail-row">Colony detail data unavailable.</div>';
          }
        }
      } else {
        try {
          const intelPayload = await getPlanetIntel(targetGalaxy, targetSystem, targetPosition);
          detail.__planetIntel = intelPayload;
          renderForeignIntel(detail, intelPayload);
        } catch (err) {
          gameLog('info', 'Planet intel render fehlgeschlagen', err);
          const extra = detail.querySelector('.planet-detail-extra');
          if (extra) extra.innerHTML = '<div class="planet-detail-row">Intel-Daten derzeit nicht verf├╝gbar.</div>';
        }
      }
      return;
    }

    if (gp) {
      delete detail.dataset.ownerName;
      detail.innerHTML = `
        <h5>Planet #${pos} - ${esc(gp.name || fmtName(gp.planet_class))}</h5>
        ${neighborArrowsHtml}
        <div class="planet-detail-row">Class: ${esc(gp.planet_class || 'ÔÇö')}</div>
        <div class="planet-detail-row">Semi-major axis: ${Number(gp.semi_major_axis_au || 0).toFixed(3)} AU</div>
        <div class="planet-detail-row">Habitable Zone: ${gp.in_habitable_zone ? 'Yes' : 'No'}</div>
        <div class="planet-detail-row">Composition: ${esc(gp.composition_family || 'ÔÇö')}</div>
        <div class="planet-detail-row">Pressure: ${Number(gp.surface_pressure_bar || 0).toFixed(2)} bar</div>
        <div class="planet-detail-row">Water: ${esc(gp.water_state || 'ÔÇö')} ┬À Methane: ${esc(gp.methane_state || 'ÔÇö')}</div>
        <div class="planet-detail-row">Radiation: ${esc(gp.radiation_level || 'ÔÇö')} ┬À Habitability: ${Number(gp.habitability_score || 0).toFixed(1)}</div>`;
      bindPlanetNeighborActions(detail);
      return;
    }

    delete detail.dataset.ownerName;
    detail.innerHTML = `
      <h5>Planet #${pos}</h5>
      ${neighborArrowsHtml}
      <div class="planet-detail-row">No planetary body in this slot.</div>`;
    bindPlanetNeighborActions(detail);
  }

  function focusPlanetDetailsInOverlay(root, planetLike, zoomPlanet, activateColony = false) {
    const infoRoot = getGalaxyInfoRoot();
    const panel = infoRoot?.querySelector('#galaxy-planets-panel');
    if (!planetLike || !planetLike.__slot) return;
    if (panel) {
      setActivePlanetListItem(panel, planetLike.__slot.position);
      const detail = ensurePlanetDetailPanel(panel);
      detail.__planetContext = panel.__planetContext || detail.__planetContext;
      renderPlanetDetailCard(detail, planetLike.__slot);
    }
    if (zoomPlanet) {
      focusSystemPlanetInView(planetLike, true);
    }
    if (activateColony) {
      const colonyId = Number(planetLike.__slot?.player_planet?.colony_id || 0);
      if (colonyId) {
        const ownColony = colonies.find((col) => Number(col.id || 0) === colonyId);
        if (ownColony) focusColonyDevelopment(colonyId, { source: 'planet-double-click' });
      }
    }
  }

  function renderPlanetPanel(panel, star, data) {
    const vis        = isCurrentUserAdmin()
      ? { level: 'own', scouted_at: data?.visibility?.scouted_at || null }
      : (data?.visibility || {});
    const visLevel   = vis.level || 'unknown';
    const scoutedAt  = vis.scouted_at ? new Date(vis.scouted_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : null;
    const planets = Array.isArray(data?.planets) ? data.planets : [];
    const fleetsInSystem = Array.isArray(data?.fleets_in_system) ? data.fleets_in_system : [];
    const starInstallations = Array.isArray(data?.star_installations) ? data.star_installations : [];
    panel.__planetContext = { panel, star, planets };
    const totalMoons = planets.reduce((sum, slot) => {
      const playerMoons = Array.isArray(slot?.player_planet?.moons) ? slot.player_planet.moons.length : 0;
      const generatedMoons = Array.isArray(slot?.generated_planet?.moons) ? slot.generated_planet.moons.length : 0;
      return sum + playerMoons + generatedMoons;
    }, 0);
    const staleBanner = visLevel === 'stale'
      ? `<div class="fow-stale-banner">Veraltete Aufkl├ñrung${scoutedAt ? ` ┬À Stand: ${esc(scoutedAt)}` : ''} ┬À Daten k├Ânnen veraltet sein.</div>`
      : '';
    const unknownBadge = (visLevel === 'unknown' && staleBanner === '')
      ? `<div class="fow-unknown-badge">Dieses System wurde noch nicht erkundet.</div>`
      : '';
    panel.innerHTML = `
      <h4>${esc(star.name)} Planets</h4>
      ${staleBanner}${unknownBadge}
      <div class="text-muted" style="margin:0.35rem 0 0.65rem">
        Planeten: ${planets.filter((slot) => !!(slot?.player_planet || slot?.generated_planet)).length}
        · Monde: ${totalMoons}
        · Flotten: ${fleetsInSystem.length}
        · Installationen: ${starInstallations.length}
      </div>
      <div class="planet-list-3d">
        ${planets.map(slot => {
          const pp = slot.player_planet;
          const gp = slot.generated_planet;
          const moonCount = (Array.isArray(pp?.moons) ? pp.moons.length : 0) + (Array.isArray(gp?.moons) ? gp.moons.length : 0);
          const moonMeta = moonCount > 0 ? ` · ${moonCount} Mond${moonCount === 1 ? '' : 'e'}` : '';
          if (pp) {
            const staleClass = pp._stale ? ' stale' : '';
            const isOwnedColony = colonies.some((col) => Number(col.id || 0) === Number(pp.colony_id || 0));
            return `<div class="planet-item ${isOwnedColony ? 'own' : 'foreign'}${staleClass}" data-pos="${slot.position}">
              <span>#${slot.position}</span>
              <strong>${esc(pp.colony_name || pp.name || '?')}</strong>
              <span>${esc(pp.owner || '?')} ┬À ${esc(isOwnedColony ? 'dein' : 'fremd')}${esc(moonMeta)}</span>
            </div>`;
          }
          if (gp) {
            return `<div class="planet-item" data-pos="${slot.position}">
              <span>#${slot.position}</span>
              <strong>${esc(gp.name || fmtName(gp.planet_class))}</strong>
              <span>${esc(gp.planet_class)}${esc(moonMeta)}</span>
            </div>`;
          }
          return `<div class="planet-item empty" data-pos="${slot.position}"><span>#${slot.position}</span><strong>Empty slot</strong></div>`;
        }).join('')}
      </div>`;

    if (LEVEL_POLICIES.planet.details.mode === 'on-demand') {
      const list = panel.querySelector('.planet-list-3d');
      if (!list) return;
      list.querySelectorAll('.planet-item').forEach((item) => {
        item.addEventListener('click', () => {
          const pos = Number(item.dataset.pos || 0);
          const slot = planets.find((p) => Number(p.position || 0) === pos);
          if (!slot) return;
          setActivePlanetListItem(panel, pos);
          const detail = ensurePlanetDetailPanel(panel);
          detail.__planetContext = panel.__planetContext;
          renderPlanetDetailCard(detail, slot);
        });
      });
    }
  }

  const runtimeResourceScanOverviewApi = requireRuntimeApi('GQRuntimeResourceScanOverview', ['createResourceScanOverviewController']);
  const runtimeMessagesControllerApi = requireRuntimeApi('GQRuntimeMessagesController', ['createMessagesController']);
  const runtimeIntelControllerApi = requireRuntimeApi('GQRuntimeIntelController', ['createIntelController']);
  const runtimeTradeRoutesControllerApi = requireRuntimeApi('GQRuntimeTradeRoutesController', ['createTradeRoutesController']);
  const runtimeTradersDashboardControllerApi = requireRuntimeApi('GQRuntimeTradersDashboardController', ['createTradersDashboardController']);
  const runtimePiratesControllerApi = requireRuntimeApi('GQRuntimePiratesController', ['createPiratesController']);
  const runtimeAlliancesControllerApi = requireRuntimeApi('GQRuntimeAlliancesController', ['createAlliancesController']);
  const runtimeTradeProposalsControllerApi = requireRuntimeApi('GQRuntimeTradeProposalsController', ['createTradeProposalsController']);
  const runtimeLeadersControllerApi = requireRuntimeApi('GQRuntimeLeadersController', ['createLeadersController']);
  const runtimeFactionsControllerApi = requireRuntimeApi('GQRuntimeFactionsController', ['createFactionsController']);
  const runtimeLeaderboardControllerApi = requireRuntimeApi('GQRuntimeLeaderboardController', ['createLeaderboardController']);
  const runtimeWarControllerApi = requireRuntimeApi('GQRuntimeWarController', ['createWarController']);
  const runtimeColonizationControllerApi = requireRuntimeApi('GQRuntimeColonizationController', ['createColonizationController']);
  const runtimeEmpireCategoriesPanelApi = requireRuntimeApi('GQRuntimeEmpireCategoriesPanel', ['createEmpireCategoriesPanel']);
  const runtimeEspionageControllerApi = requireRuntimeApi('GQRuntimeEspionageController', ['createEspionageController']);
  const runtimeLogisticsRoutesControllerApi = requireRuntimeApi('GQRuntimeLogisticsRoutesController', ['createLogisticsRoutesController']);
  const runtimeDiplomacyDataModelApi = requireRuntimeApi('GQRuntimeDiplomacyDataModel', [
    'getTypes',
    'getType',
    'standingMeta',
    'statusClass',
    'acceptanceBarHTML',
  ]);
  const runtimeDiplomacyPanelApi = requireRuntimeApi('GQRuntimeDiplomacyPanel', ['createDiplomacyPanel']);
  const runtimeDiplomaticPlaysDataModelApi = requireRuntimeApi('GQRuntimeDiplomaticPlaysDataModel', [
    'getPhases',
    'getPhase',
    'trustBarHTML',
    'threatBarHTML',
    'phaseStepperHTML',
    'playCardHTML',
  ]);
  const runtimeDiplomaticPlaysPanelApi = requireRuntimeApi('GQRuntimeDiplomaticPlaysPanel', ['createDiplomaticPlaysPanel']);
  const runtimeContractNegotiationModalApi = requireRuntimeApi('GQRuntimeContractNegotiationModal', ['createModal']);
  const runtimeConflictDashboardApi = requireRuntimeApi('GQRuntimeConflictDashboard', ['createConflictDashboard']);
  const runtimeSocialControllersBootstrapApi = requireRuntimeApi('GQRuntimeSocialControllersBootstrap', ['createSocialControllersBootstrap']);
  const runtimeAdvisorWidgetApi = requireRuntimeApi('GQRuntimeAdvisorWidget', ['createAdvisorWidget']);
  let AdvisorWidget = null;
  const socialControllers = runtimeSocialControllersBootstrapApi.createSocialControllersBootstrap({
    runtimeMessagesControllerApi,
    runtimeIntelControllerApi,
    runtimeTradeRoutesControllerApi,
    runtimeTradersDashboardControllerApi,
    runtimePiratesControllerApi,
    runtimeAlliancesControllerApi,
    runtimeTradeProposalsControllerApi,
    runtimeLeadersControllerApi,
    runtimeFactionsControllerApi,
    runtimeLeaderboardControllerApi,
    runtimeWarControllerApi,
    runtimeColonizationControllerApi,
    runtimeEmpireCategoriesPanelApi,
    runtimeEspionageControllerApi,
    runtimeLogisticsRoutesControllerApi,
    runtimeDiplomacyDataModelApi,
    runtimeDiplomacyPanelApi,
    runtimeDiplomaticPlaysDataModelApi,
    runtimeDiplomaticPlaysPanelApi,
    runtimeContractNegotiationModalApi,
    wm: WM,
    api: API,
    windowRef: window,
    documentRef: document,
    renderInlineTemplate,
    renderInlineTemplateList,
    uiKitTemplateHTML,
    uiKitEmptyStateHTML,
    uiKitSkeletonHTML,
    esc,
    fmt,
    fmtName,
    showToast,
    gameLog,
    getAudioManager: () => audioManager,
    getMessageConsoleState: () => messageConsoleState,
    updateMessageSignalsFromInbox,
    runtimeCommandParsingApi,
    runtimeMessageConsoleCommandApi,
    playMessageSendRef,
    invalidateGetCache: _invalidateGetCache,
    getResourceInsightConfig,
    getSuggestedTradeAmount,
    getCurrentColony: () => currentColony,
    onLoadOverview: loadOverview,
    getColonies: () => colonies,
    getAdvisorWidget: () => AdvisorWidget,
    getCurrentUser: () => currentUser,
  });
  const messagesController = socialControllers.messagesController;
  const intelController = socialControllers.intelController;
  const tradeRoutesController = socialControllers.tradeRoutesController;
  const tradersDashboardController = socialControllers.tradersDashboardController;
  const piratesController = socialControllers.piratesController;
  const alliancesController = socialControllers.alliancesController;
  const tradeProposalsController = socialControllers.tradeProposalsController;
  const leadersController = socialControllers.leadersController;
  const factionsController = socialControllers.factionsController;
  const leaderboardController = socialControllers.leaderboardController;
  const warController = socialControllers.warController;
  const colonizationController = socialControllers.colonizationController;
  const empireCategoriesPanel = socialControllers.empireCategoriesPanel;
  const espionageController = socialControllers.espionageController;
  const logisticsRoutesController = socialControllers.logisticsRoutesController;
  const conflictDashboard = runtimeConflictDashboardApi.createConflictDashboard({
    wm: WM,
    api: API,
    esc,
    gameLog,
    showToast,
  });

  window.GQMessagesController = messagesController;
  window.GQIntelController = intelController;
  window.GQTradeRoutesController = tradeRoutesController;
  window.GQTradersDashboardController = tradersDashboardController;
  window.GQPiratesController = piratesController;
  window.GQAlliancesController = alliancesController;
  window.GQTradeProposalsController = tradeProposalsController;
  window.GQLeadersController = leadersController;
  window.GQFactionsController = factionsController;
  window.GQLeaderboardController = leaderboardController;
  window.GQWarController = warController;
  window.GQConflictDashboard = conflictDashboard;
  window.GQColonizationController = colonizationController;
  window.GQEmpirePanel = empireCategoriesPanel;
  window.GQEspionageController = espionageController;
  window.GQLogisticsRoutesController = logisticsRoutesController;

  // ── Messages window ─────────────────────────────────────────────────────────
  async function renderMessages() {
    await messagesController.render();
  }

  // ÔöÇÔöÇ Intel window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderIntel() {
    await intelController.render();
  }

  // ÔöÇÔöÇ Trade Routes Controller ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderTradeRoutes() {
    await tradeRoutesController.render();
    const playerRoutes = tradeRoutesController.routes || [];
    let npcRoutes = [];
    try {
      const tradersData = await API.tradersRoutes('in_transit');
      npcRoutes = Array.isArray(tradersData?.routes) ? tradersData.routes : [];
    } catch (_) {}
    _tradeRoutesCache = mergeTradeRouteCaches(playerRoutes, npcRoutes);
    publishTradeRoutesCache();
  }

  async function renderTradersDashboard() {
    await tradersDashboardController.render();
  }

  async function renderPirates() {
    await piratesController.render();
  }

  async function renderWars() {
    await warController.render();
  }

  async function renderColonization() {
    if (colonizationController) await colonizationController.render();
  }

  async function renderConflict() {
    await conflictDashboard.render();
  }

  async function renderLogisticsRoutes() {
    if (logisticsRoutesController) await logisticsRoutesController.render();
  }

  function renderNavOrb() {
    const root = WM?.body?.('nav-orb');
    if (!root) return;
    root.classList.add('nav-orb-window');
    root.innerHTML = `
      <div id="galaxy-nav-orb-overlay" class="galaxy-nav-orb-overlay">
        <div class="galaxy-overlay-head galaxy-nav-orb-head">
          <strong>Nav Canvas</strong>
          <span id="galaxy-nav-mode-badge" class="galaxy-nav-mode-badge is-galaxy">GALAXY</span>
        </div>
        <div class="galaxy-nav-gizmo-wrap">
          <canvas id="galaxy-nav-gizmo" class="galaxy-nav-gizmo-canvas" width="250" height="250" aria-label="Navigation gizmo" title="X/Y/Z Translation und U/V/W Rotation"></canvas>
          <div class="galaxy-nav-gizmo-legend">
            <span class="axis axis-x">X</span>
            <span class="axis axis-y">Y</span>
            <span class="axis axis-z">Z</span>
            <span class="ring ring-u">U</span>
            <span class="ring ring-v">V</span>
            <span class="ring ring-w">W</span>
          </div>
        </div>
        <div class="galaxy-nav-strip">
          <label class="galaxy-nav-slider-row" for="gal-nav-zoom-slider">
            <span>Zoom</span>
            <input id="gal-nav-zoom-slider" type="range" min="0" max="100" step="1" value="55" />
            <span id="gal-nav-zoom-value" class="text-muted">55%</span>
          </label>
          <label class="galaxy-nav-slider-row" for="gal-nav-fov-slider">
            <span>FOV</span>
            <input id="gal-nav-fov-slider" type="range" min="25" max="100" step="1" value="60" />
            <span id="gal-nav-fov-value" class="text-muted">60°</span>
          </label>
        </div>
        <div class="galaxy-nav-strip" style="margin-top:0.15rem;grid-template-columns:repeat(4,minmax(0,1fr));">
          <button class="galaxy-nav-mini-btn" type="button" data-nav-action="focus" title="Auf Auswahl zentrieren">Center</button>
          <button class="galaxy-nav-mini-btn" type="button" data-nav-action="enter-system" title="Ins System zoomen">System</button>
          <button class="galaxy-nav-mini-btn galaxy-nav-mini-btn-center galaxy-nav-reset-btn" type="button" data-nav-action="reset" title="Reset view">Reset</button>
          <button class="galaxy-nav-mini-btn" type="button" data-nav-action="home" title="Jump to home system">Home</button>
        </div>
      </div>
    `;
    runtimeGalaxyNavOrbApi.bindGalaxyNavOrb(root, runtimeGalaxyNavOrbRepeatApi.bindNavRepeatButton);
  }

  // ÔöÇÔöÇ Alliances Controller ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderAlliances() {
    await alliancesController.render();
  }

  // ÔöÇÔöÇ Trade Proposals Controller ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
async function renderTradeProposals() {
    await tradeProposalsController.render();
  }

  // ÔöÇÔöÇ Advisor Widget ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  AdvisorWidget = runtimeAdvisorWidgetApi.createAdvisorWidget({
    api: API,
    wm: WM,
    esc,
    documentRef: document,
    getLeadersController: () => leadersController,
  });

  // ÔöÇÔöÇ Leaderboard window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderLeaders() {
    await leadersController.render();
  }

  async function renderFactions() {
    await factionsController.render();
  }

  async function renderLeaderboard() {
    await leaderboardController.render();
  }

  // ÔöÇÔöÇ Minimap ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const MINIMAP_PAD = 14;           // canvas padding in px
  const MINIMAP_GRID_DIVS = 5;     // number of grid lines per axis
  const MINIMAP_CLICK_RADIUS = 18; // max click distance in px to select a star
  const MINIMAP_DRAG_THRESHOLD = 4;
  const MINIMAP_WORLD_SCALE = 0.028;

  function buildMinimapFacadeOptions(overrides = {}) {
    return {
      requireRuntimeApi,
      minimapPad: MINIMAP_PAD,
      minimapGridDivs: MINIMAP_GRID_DIVS,
      minimapClickRadius: MINIMAP_CLICK_RADIUS,
      minimapDragThreshold: MINIMAP_DRAG_THRESHOLD,
      minimapWorldScale: MINIMAP_WORLD_SCALE,
      getGalaxy3d: () => galaxy3d,
      getMinimapCamera: () => (galaxy3d && galaxy3d.camera ? galaxy3d.camera : null),
      getGalaxyStars: () => galaxyStars,
      getColonies: () => colonies,
      getCurrentColony: () => currentColony,
      getUiState: () => uiState,
      getPinnedStar: () => pinnedStar,
      setPinnedStar: (star) => { pinnedStar = star; },
      setActiveStar: (star) => { uiState.activeStar = star; },
      getStarClassColor: (spectralClass) => starClassColor(spectralClass),
      openWindow: (windowName) => WM.open(windowName),
      isWindowOpen: (windowName) => WM.isOpen(windowName),
      getGalaxyBody: () => WM.body('galaxy'),
      renderGalaxyDetails: (root, star, zoomed) => renderGalaxySystemDetails(root, star, zoomed),
      isSystemModeActive: () => isSystemModeActive(),
      getTradeRoutes: () => _tradeRoutesCache,
      requestFrame: (cb) => requestAnimationFrame(cb),
      ...overrides,
    };
  }

  function initMinimapRuntime() {
    const runtimeMinimapFacadeApi = requireRuntimeApi('GQRuntimeMinimapFacade', ['createMinimapFacade']);
    const runtimeMinimapHelpersApi = requireRuntimeApi('GQRuntimeMinimapHelpers', ['createMinimapHelpers']);
    const runtimeMinimapCameraControlsApi = requireRuntimeApi('GQRuntimeMinimapCameraControls', ['createMinimapCameraControls']);
    const runtimeMinimapOverlayApi = requireRuntimeApi('GQRuntimeMinimapOverlay', ['createMinimapOverlay']);
    const runtimeMinimapRendererApi = requireRuntimeApi('GQRuntimeMinimapRenderer', ['createMinimapRenderer']);
    const runtimeMinimapInteractionsApi = requireRuntimeApi('GQRuntimeMinimapInteractions', ['createMinimapInteractions']);
    const runtimeMinimapLoopApi = requireRuntimeApi('GQRuntimeMinimapLoop', ['createMinimapLoop']);
    const runtimeMinimapSeedApi = requireRuntimeApi('GQRuntimeMinimapSeed', ['createMinimapSeed']);
    const runtimeMinimapDomScaffoldApi = requireRuntimeApi('GQRuntimeMinimapDomScaffold', ['createMinimapDomScaffold']);
    const runtimeMinimapNavigationBindingApi = requireRuntimeApi('GQRuntimeMinimapNavigationBinding', ['createMinimapNavigationBinding']);
    const runtimeMinimapRenderOrchestratorApi = requireRuntimeApi('GQRuntimeMinimapRenderOrchestrator', ['createMinimapRenderOrchestrator']);
    const facade = runtimeMinimapFacadeApi.createMinimapFacade(buildMinimapFacadeOptions({
      runtimeMinimapHelpersApi,
      runtimeMinimapCameraControlsApi,
      runtimeMinimapOverlayApi,
      runtimeMinimapRendererApi,
      runtimeMinimapInteractionsApi,
      runtimeMinimapLoopApi,
      runtimeMinimapSeedApi,
      runtimeMinimapDomScaffoldApi,
      runtimeMinimapNavigationBindingApi,
      runtimeMinimapRenderOrchestratorApi,
    }));
    facade.bindNavigationOnce();
    return facade;
  }

  function initSettingsRuntime() {
    const runtimeSettingsSfxRowsApi = requireRuntimeApi('GQRuntimeSettingsSfxRows', ['createSettingsSfxRowsBuilder']);
    const runtimeSettingsMusicTrackOptionsApi = requireRuntimeApi('GQRuntimeSettingsMusicTrackOptions', ['createSettingsMusicTrackOptionsBuilder']);
    const runtimeAiSettingsPanelApi = requireRuntimeApi('GQRuntimeAiSettingsPanel', ['bindAiSettingsPanel']);
    const runtimeFtlSettingsPanelApi = requireRuntimeApi('GQRuntimeFtlSettingsPanel', ['bindFtlSettingsPanel']);
    const runtimeAudioSettingsPanelApi = requireRuntimeApi('GQRuntimeAudioSettingsPanel', ['bindAudioSettingsPanel']);
    const runtimeSettingsFtlDriveButtonsApi = requireRuntimeApi('GQRuntimeSettingsFtlDriveButtons', ['createSettingsFtlDriveButtonsBuilder']);
    const runtimeSettingsFtlDrivesCatalogApi = requireRuntimeApi('GQRuntimeSettingsFtlDrivesCatalog', ['getFtlDrives']);
    const runtimeSettingsFtlTemplateStylesApi = requireRuntimeApi('GQRuntimeSettingsFtlTemplateStyles', ['getFtlTemplateStyles']);
    const runtimeSettingsFtlSectionTemplateApi = requireRuntimeApi('GQRuntimeSettingsFtlSectionTemplate', ['createSettingsFtlSectionTemplateBuilder']);
    const runtimeSettingsLlmSectionTemplateApi = requireRuntimeApi('GQRuntimeSettingsLlmSectionTemplate', ['createSettingsLlmSectionTemplateBuilder']);
    const runtimeSettingsNpcSectionTemplateApi = requireRuntimeApi('GQRuntimeSettingsNpcSectionTemplate', ['createSettingsNpcSectionTemplateBuilder']);
    const runtimeSettingsCoreSectionTemplateApi = requireRuntimeApi('GQRuntimeSettingsCoreSectionTemplate', ['createSettingsCoreSectionTemplateBuilder']);
    const runtimeSettingsViewModelApi = requireRuntimeApi('GQRuntimeSettingsViewModel', ['createSettingsViewModelBuilder']);
    const runtimeSettingsSectionsComposerApi = requireRuntimeApi('GQRuntimeSettingsSectionsComposer', ['createSettingsSectionsComposer']);
    const runtimeSettingsBaseBindingsApi = requireRuntimeApi('GQRuntimeSettingsBaseBindings', ['createSettingsBaseBindings']);
    const runtimeSettingsPanelBindingsOrchestratorApi = requireRuntimeApi('GQRuntimeSettingsPanelBindingsOrchestrator', ['createSettingsPanelBindingsOrchestrator']);
    const runtimeSettingsRenderModelApi = requireRuntimeApi('GQRuntimeSettingsRenderModel', ['createSettingsRenderModelBuilder']);
    const runtimeSettingsRenderBindingsApi = requireRuntimeApi('GQRuntimeSettingsRenderBindings', ['createSettingsRenderBindings']);
    const runtimeSettingsRenderFacadeApi = requireRuntimeApi('GQRuntimeSettingsRenderFacade', ['createSettingsRenderFacade']);
    const runtimeSettingsRenderContextApi = requireRuntimeApi('GQRuntimeSettingsRenderContext', ['createSettingsRenderContextBuilder']);

    const settingsSfxRowsBuilder = runtimeSettingsSfxRowsApi.createSettingsSfxRowsBuilder();
    const settingsMusicTrackOptionsBuilder = runtimeSettingsMusicTrackOptionsApi.createSettingsMusicTrackOptionsBuilder();
    const settingsFtlDriveButtonsBuilder = runtimeSettingsFtlDriveButtonsApi.createSettingsFtlDriveButtonsBuilder();
    const settingsFtlTemplateStyles = runtimeSettingsFtlTemplateStylesApi.getFtlTemplateStyles();
    const settingsFtlSectionTemplateBuilder = runtimeSettingsFtlSectionTemplateApi.createSettingsFtlSectionTemplateBuilder();
    const settingsLlmSectionTemplateBuilder = runtimeSettingsLlmSectionTemplateApi.createSettingsLlmSectionTemplateBuilder();
    const settingsNpcSectionTemplateBuilder = runtimeSettingsNpcSectionTemplateApi.createSettingsNpcSectionTemplateBuilder();
    const settingsCoreSectionTemplateBuilder = runtimeSettingsCoreSectionTemplateApi.createSettingsCoreSectionTemplateBuilder();
    const settingsViewModelBuilder = runtimeSettingsViewModelApi.createSettingsViewModelBuilder();
    const settingsBaseBindings = runtimeSettingsBaseBindingsApi.createSettingsBaseBindings();
    const settingsPanelBindingsOrchestrator = runtimeSettingsPanelBindingsOrchestratorApi.createSettingsPanelBindingsOrchestrator({
      runtimeAudioSettingsPanelApi,
      runtimeAiSettingsPanelApi,
      runtimeFtlSettingsPanelApi,
    });
    const settingsRenderModelBuilder = runtimeSettingsRenderModelApi.createSettingsRenderModelBuilder();
    const settingsRenderBindings = runtimeSettingsRenderBindingsApi.createSettingsRenderBindings();
    const settingsRenderFacade = runtimeSettingsRenderFacadeApi.createSettingsRenderFacade();
    const settingsRenderContextBuilder = runtimeSettingsRenderContextApi.createSettingsRenderContextBuilder();
    const settingsSectionsComposer = runtimeSettingsSectionsComposerApi.createSettingsSectionsComposer({
      buildMusicTrackOptions: ({ audioTrackOptions, esc }) => settingsMusicTrackOptionsBuilder.build({
        audioTrackOptions,
        esc,
      }),
      buildSfxRows: ({ audioState, settingsState, audioEvents, sfxOptions, esc }) => settingsSfxRowsBuilder.buildRows({
        audioState,
        settingsState,
        audioEvents,
        sfxOptions,
        esc,
      }),
      buildFtlDriveButtons: ({ esc }) => settingsFtlDriveButtonsBuilder.build({
        esc,
        drives: runtimeSettingsFtlDrivesCatalogApi.getFtlDrives(),
        buttonStyle: settingsFtlTemplateStyles.button,
      }),
      buildFtlSection: ({ ftlDriveButtons }) => settingsFtlSectionTemplateBuilder.build({
        styles: settingsFtlTemplateStyles,
        ftlDriveButtons,
      }),
      buildLlmSection: () => settingsLlmSectionTemplateBuilder.build(),
      buildNpcSection: () => settingsNpcSectionTemplateBuilder.build(),
    });

    return {
      settingsCoreSectionTemplateBuilder,
      settingsViewModelBuilder,
      settingsBaseBindings,
      settingsPanelBindingsOrchestrator,
      settingsRenderModelBuilder,
      settingsRenderBindings,
      settingsRenderFacade,
      settingsRenderContextBuilder,
      settingsSectionsComposer,
    };
  }

  function initQuestsRuntime() {
    const runtimeQuestsDataModelApi = requireRuntimeApi('GQRuntimeQuestsDataModel', ['createQuestsDataModelBuilder']);
    const runtimeQuestsCardTemplateApi = requireRuntimeApi('GQRuntimeQuestsCardTemplate', ['createQuestsCardTemplateBuilder']);
    const runtimeQuestsGroupTemplateApi = requireRuntimeApi('GQRuntimeQuestsGroupTemplate', ['createQuestsGroupTemplateBuilder']);
    const runtimeQuestsClaimBindingsApi = requireRuntimeApi('GQRuntimeQuestsClaimBindings', ['createQuestsClaimBindings']);
    const runtimeQuestsRenderFacadeApi = requireRuntimeApi('GQRuntimeQuestsRenderFacade', ['createQuestsRenderFacade']);
    const runtimeQuestsRenderContextApi = requireRuntimeApi('GQRuntimeQuestsRenderContext', ['createQuestsRenderContextBuilder']);
    return {
      questsDataModelBuilder: runtimeQuestsDataModelApi.createQuestsDataModelBuilder(),
      questsCardTemplateBuilder: runtimeQuestsCardTemplateApi.createQuestsCardTemplateBuilder(),
      questsGroupTemplateBuilder: runtimeQuestsGroupTemplateApi.createQuestsGroupTemplateBuilder(),
      questsClaimBindings: runtimeQuestsClaimBindingsApi.createQuestsClaimBindings(),
      questsRenderFacade: runtimeQuestsRenderFacadeApi.createQuestsRenderFacade(),
      questsRenderContextBuilder: runtimeQuestsRenderContextApi.createQuestsRenderContextBuilder(),
    };
  }

  function initWindowRuntimes() {
    return {
      minimapFacade: initMinimapRuntime(),
      ...initSettingsRuntime(),
      ...initQuestsRuntime(),
    };
  }

  // Boot/setup API lookups used by the final startup sequence.
  function initBootSetupApis() {
    const runtimeLogoutHandlerApi = requireRuntimeApi('GQRuntimeLogoutHandler', ['bindLogoutHandler']);
    const runtimeBadgeLoaderApi = requireRuntimeApi('GQRuntimeBadgeLoader', ['createBadgeLoader']);
    const runtimeRealtimeSyncSetupApi = requireRuntimeApi('GQRuntimeRealtimeSyncSetup', ['setupRealtimeSync']);
    const runtimeStartupBootSetupApi = requireRuntimeApi('GQRuntimeStartupBootSetup', ['setupStartupBoot']);
    const runtimeFooterUiKitSetupApi = requireRuntimeApi('GQRuntimeFooterUiKitSetup', ['setupFooterUiKit']);
    const runtimePostBootFlowSetupApi = requireRuntimeApi('GQRuntimePostBootFlowSetup', ['runPostBootFlowSetup']);
    const runtimeColonyVfxDebugWidgetSetupApi = requireRuntimeApi('GQRuntimeColonyVfxDebugWidgetSetup', ['setupColonyVfxDebugWidget']);
    const runtimeLoadNetworkEventsApi = requireRuntimeApi('GQRuntimeLoadNetworkEvents', ['registerLoadAndNetworkRuntimeEvents']);
    const runtimeRenderTelemetryHookApi = requireRuntimeApi('GQRuntimeRenderTelemetryHook', [
      'configureRenderTelemetryRuntime',
      'installRenderTelemetryHook',
    ]);
    const runtimeCoreModApi = requireRuntimeApi('GQRuntimeCore', ['createRuntimeCore']);
    const runtimeAdminVisibilityApi = requireRuntimeApi('GQRuntimeAdminVisibility', [
      'isCurrentUserAdmin',
      'normalizeStarVisibility',
      'normalizeStarListVisibility',
      'normalizeSystemPayloadVisibility',
    ]);
    const runtimeGameBootstrapHelpersApi = requireRuntimeApi('GQRuntimeGameBootstrapHelpers', [
      'updateCommanderButtonLabel',
      'invalidateGetCache',
    ]);
    const runtimeBootSetupSequenceApi = requireRuntimeApi('GQRuntimeBootSetupSequence', ['runBootSetupSequence']);
    const runtimeBootSetupContextApi = requireRuntimeApi('GQRuntimeBootSetupContext', ['createBootSetupContextBuilder']);
    const bootSetupContextBuilder = runtimeBootSetupContextApi.createBootSetupContextBuilder();
    return {
      runtimeLogoutHandlerApi,
      runtimeBadgeLoaderApi,
      runtimeRealtimeSyncSetupApi,
      runtimeStartupBootSetupApi,
      runtimeFooterUiKitSetupApi,
      runtimePostBootFlowSetupApi,
      runtimeColonyVfxDebugWidgetSetupApi,
      runtimeLoadNetworkEventsApi,
      runtimeRenderTelemetryHookApi,
      runtimeCoreModApi,
      runtimeAdminVisibilityApi,
      runtimeGameBootstrapHelpersApi,
      runtimeBootSetupSequenceApi,
      bootSetupContextBuilder,
    };
  }

  const {
    runtimeLogoutHandlerApi,
    runtimeBadgeLoaderApi,
    runtimeRealtimeSyncSetupApi,
    runtimeStartupBootSetupApi,
    runtimeFooterUiKitSetupApi,
    runtimePostBootFlowSetupApi,
    runtimeColonyVfxDebugWidgetSetupApi,
    runtimeLoadNetworkEventsApi,
    runtimeRenderTelemetryHookApi,
    runtimeCoreModApi,
    runtimeAdminVisibilityApi,
    runtimeGameBootstrapHelpersApi,
    runtimeBootSetupSequenceApi,
    bootSetupContextBuilder,
  } = initBootSetupApis();
  const runtimeGameCore = runtimeCoreModApi.createRuntimeCore({ autoStart: true });
  window.GQGameRuntimeCore = runtimeGameCore;
  let lastLoadErrorToastAt = 0;
  const runtimeFeatureRegistryApi = requireRuntimeApi('GQRuntimeFeatureRegistry', ['createFeatureRegistry']);
  const runtimeLifecyclePhasesApi = requireRuntimeApi('GQRuntimeLifecyclePhases', [
    'getLifecyclePhaseValues',
    'isLifecyclePhase',
  ]);
  const runtimeLifecycleManagerApi = requireRuntimeApi('GQRuntimeLifecycleManager', ['createLifecycleManager']);
  const runtimeLifecycleCoreFeaturesApi = requireRuntimeApi('GQRuntimeLifecycleCoreFeatures', ['registerLifecycleCoreFeatures']);
  const runtimeLifecycleDomainFeaturesApi = requireRuntimeApi('GQRuntimeLifecycleDomainFeatures', ['registerLifecycleDomainFeatures']);
  const lifecycleRegistry = runtimeFeatureRegistryApi.createFeatureRegistry();
  const lifecycleManager = runtimeLifecycleManagerApi.createLifecycleManager({
    registry: lifecycleRegistry,
    logger: gameLog,
    runtimeLifecyclePhasesApi,
  });
  const LIFECYCLE_PHASES = runtimeLifecycleManagerApi.LIFECYCLE_PHASES;
  runtimeLifecycleCoreFeaturesApi.registerLifecycleCoreFeatures({
    manager: lifecycleManager,
    refreshFooterNetworkStatus,
    gameLog,
  });
  window.GQGameLifecycle = lifecycleManager;

  const {
    minimapFacade,
    settingsCoreSectionTemplateBuilder,
    settingsViewModelBuilder,
    settingsBaseBindings,
    settingsPanelBindingsOrchestrator,
    settingsRenderModelBuilder,
    settingsRenderBindings,
    settingsRenderFacade,
    settingsRenderContextBuilder,
    settingsSectionsComposer,
    questsDataModelBuilder,
    questsCardTemplateBuilder,
    questsGroupTemplateBuilder,
    questsClaimBindings,
    questsRenderFacade,
    questsRenderContextBuilder,
  } = initWindowRuntimes();

  // Window render delegates.
  function renderMinimap(root) {
    minimapFacade.render(root);
  }

  // Shared render context factories for settings and quests windows.
  const renderContextBuilders = {
    settings: () => settingsRenderContextBuilder.build({
      wm: WM,
      settingsState,
      audioManager,
      esc,
      audioTrackOptions,
      audioEvents: AUDIO_SFX_EVENTS,
      sfxOptions: AUDIO_SFX_OPTIONS,
      formatLastAudioEvent,
      settingsSectionsComposer,
      settingsViewModelBuilder,
      settingsCoreSectionTemplateBuilder,
      settingsRenderModelBuilder,
      settingsRenderBindings,
      settingsBaseBindings,
      settingsPanelBindingsOrchestrator,
      settingsController,
      getPinnedStar: () => pinnedStar,
      getActiveStar: () => uiState.activeStar,
      renderGalaxySystemDetails,
      isSystemModeActive,
      galaxyController,
      applyTransitionPreset,
      loadAudioTrackCatalog,
      showToast,
      saveUiSettings: saveUiSettingsRef,
      refreshAudioUi: refreshAudioUiRef,
      rerenderSettings: renderSettings,
      api: API,
      fmt,
      windowRef: window,
    }),
    quests: () => questsRenderContextBuilder.build({
      wm: WM,
      api: API,
      questsDataModelBuilder,
      questsCardTemplateBuilder,
      questsGroupTemplateBuilder,
      questsClaimBindings,
      esc,
      fmt,
      showToast,
      loadOverview,
      rerenderQuests: renderQuests,
    }),
  };

  function renderSettings() {
    const settingsRenderContext = renderContextBuilders.settings();
    settingsRenderFacade.render(settingsRenderContext);
  }

  // ÔöÇÔöÇ Quests window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderQuests() {
    const questsRenderContext = renderContextBuilders.quests();
    await questsRenderFacade.render(questsRenderContext);
  }

  runtimeLifecycleDomainFeaturesApi.registerLifecycleDomainFeatures({
    manager: lifecycleManager,
    wm: WM,
    renderSettings,
    renderQuests,
    renderTradersDashboard,
    renderPirates,
    renderWars,
    renderEconomy,
    gameLog,
  });

  try {
    await lifecycleManager.transitionTo(LIFECYCLE_PHASES.BOOTSTRAPPING, { source: 'game' });
    const bootSetupContext = bootSetupContextBuilder.build({
      logoutHandlerApi: runtimeLogoutHandlerApi,
      badgeLoaderApi: runtimeBadgeLoaderApi,
      realtimeSyncSetupApi: runtimeRealtimeSyncSetupApi,
      startupBootSetupApi: runtimeStartupBootSetupApi,
      footerUiKitSetupApi: runtimeFooterUiKitSetupApi,
      postBootFlowSetupApi: runtimePostBootFlowSetupApi,
      colonyVfxDebugWidgetSetupApi: runtimeColonyVfxDebugWidgetSetupApi,
      loadNetworkEventsApi: runtimeLoadNetworkEventsApi,
      renderTelemetryHookApi: runtimeRenderTelemetryHookApi,
      realtimeSyncApi: runtimeRealtimeSyncApi,
      startupBootApi: runtimeStartupBootApi,
      footerUiKitApi: runtimeFooterUiKitApi,
      postBootFlowApi: runtimePostBootFlowApi,
      colonyVfxDebugWidgetApi: runtimeColonyVfxDebugWidgetApi,
      messagesController,
      audioManager,
      api: API,
      gameLog,
      localStorageRef: localStorage,
      sessionStorageRef: sessionStorage,
      windowRef: window,
      documentRef: document,
      loadOverview,
      invalidateGetCache: _invalidateGetCache,
      refreshWindow: wmRefresh,
      getGalaxyRoot: () => wmBody('galaxy'),
      refreshGalaxyDensityMetrics,
      refreshFooterNetworkStatus,
      showToast,
      eventSourceFactory: eventSourceFactoryRef,
      eventBus: runtimeEventBus,
      runtimeCore: runtimeGameCore,
      setFooterLoadProgress,
      setFooterNetworkStatus,
      redirectToLogin,
      pushGalaxyDebugError,
      getLastLoadErrorToastAt: () => lastLoadErrorToastAt,
      setLastLoadErrorToastAt: (value) => {
        lastLoadErrorToastAt = Number(value || 0);
      },
      wm: WM,
      loadAudioTrackCatalog,
      refreshAudioUi: refreshAudioUiRef,
      updateFooterQuickNavBadge,
      settingsState,
      focusHomeSystemInGalaxy,
      initSystemBreadcrumb,
      advisorWidget: AdvisorWidget,
      esc,
      logger: console,
    });
    await runtimeBootSetupSequenceApi.runBootSetupSequence(bootSetupContext);
    if (currentUser) {
      runtimeGameBootstrapHelpersApi.updateCommanderButtonLabel(currentUser, { documentRef: document });
    }
    await lifecycleManager.transitionTo(LIFECYCLE_PHASES.SERVICES_READY, { source: 'game' });
    await lifecycleManager.transitionTo(LIFECYCLE_PHASES.UI_READY, { source: 'game' });
    await lifecycleManager.transitionTo(LIFECYCLE_PHASES.RUNNING, { source: 'game' });
    refreshTradeRoutesCache().catch(() => {});
  } catch (bootError) {
    await lifecycleManager.transitionTo(LIFECYCLE_PHASES.ERROR, {
      source: 'game',
      error: bootError,
    });
    throw bootError;
  }

})();

