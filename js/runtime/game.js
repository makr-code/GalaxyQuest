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

  runtimeTopbarA11yApi.initTopbarA11yRuntime();
  const focusFirstInTopbarMenu = runtimeTopbarA11yApi.focusFirstInTopbarMenu;
  const syncTopbarBottomSheetState = runtimeTopbarA11yApi.syncTopbarBottomSheetState;
  const setTopbarMenuFocusTrap = runtimeTopbarA11yApi.setTopbarMenuFocusTrap;
  const clearTopbarMenuFocusTrap = runtimeTopbarA11yApi.clearTopbarMenuFocusTrap;
  const isTopbarMenuFocusTrapped = runtimeTopbarA11yApi.isTopbarMenuFocusTrapped;
  const closeCommanderMenuPanel = runtimeTopbarA11yApi.closeCommanderMenuPanel;
  const closeTopbarPlayerMenu = runtimeTopbarA11yApi.closeTopbarPlayerMenu;
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
    },
    selectColonyById,
    showToast,
    prefillFleetTarget,
  });
  const BUILDING_UI_META = runtimeColonyBuildingLogicApi.getBuildingUiMetaAll();
  const BUILDING_ZONE_PRIORITY = runtimeColonyBuildingLogicApi.getBuildingZonePriority();
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
  const runtimeGalaxyOverlayControlsApi = requireRuntimeApi('GQRuntimeGalaxyOverlayControls', ['bindGalaxyOverlayHotkeys']);
  runtimeGalaxyOverlayControlsApi.configureGalaxyOverlayControlsRuntime({
    windowRef: window,
    documentRef: document,
    wmIsOpen,
    wmBody,
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
    isSystemModeActive,
    triggerNavAction: triggerGalaxyNavAction,
    showToast,
  });
  const runtimeGalaxyControlUiApi = requireRuntimeApi('GQRuntimeGalaxyControlUi', ['refreshDensityMetrics']);
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

  const uiConsoleController = runtimeUiConsolePanelApi.createUiConsoleController({
    store: uiConsoleStore,
    showToast,
    esc,
    documentRef: document,
    windowRef: window,
    navigatorRef: navigator,
    onRunCommand: async (raw) => {
      await runUiConsoleCommand(raw);
    },
  });
  window.GQUIConsoleController = uiConsoleController;

  function uiConsolePush(line) {
    uiConsoleController.push(line);
  }

  function getUiConsoleVisibleLines() {
    return uiConsoleController.getVisibleLines();
  }

  const runtimeSettingsControllerApi = requireRuntimeApi('GQRuntimeSettingsController', ['createSettingsController']);
  const settingsController = runtimeSettingsControllerApi.createSettingsController({
    windowRef: window,
    documentRef: document,
    settingsState,
    uiState,
    currentUser,
    audioManager,
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

  function starClassColor(spectralClass) {
    return runtimeGalaxyVisualUtilsApi.starClassColor(spectralClass);
  }

  function planetIcon(planetClass) {
    return runtimeGalaxyVisualUtilsApi.planetIcon(planetClass);
  }

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
      renderMessages,
      renderIntel,
      renderTradeRoutes,
      renderEconomyFlow,
      renderTradeProposals,
      renderQuests,
      renderLeaderboard,
      renderLeaders,
      renderFactions,
      renderAlliances,
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

  class GalaxyController {
    triggerNavAction(action, rootRef = null) {
      const root = rootRef || WM.body('galaxy');
      if (!galaxy3d && root) {
        this.init3D(root);
        if (galaxy3d) {
          this.loadStars3D(root).catch((err) => {
            gameLog('warn', 'Galaxy 3D Sterneladen fehlgeschlagen', err);
          });
        }
      }
      if (!galaxy3d) {
        showToast('3D-Renderer ist noch nicht bereit.', 'warning');
        return;
      }
      const normalized = String(action || '');
      if (audioManager) audioManager.playUiClick();
      if (runRendererNavAction(normalized)) {
        return;
      } else if (normalized === 'toggle-vectors') {
        settingsState.galaxyFleetVectorsVisible = !(settingsState.galaxyFleetVectorsVisible !== false);
        settingsController.applyRuntimeSettings();
        if (root) updateGalaxyFollowUi(root);
      }
      else if (normalized === 'optimize-view' && root) {
        settingsState.clusterDensityMode = 'auto';
        settingsState.renderQualityProfile = 'auto';
        settingsController.applyRuntimeSettings();
        refreshGalaxyDensityMetrics(root);
        showToast('Darstellung optimiert (Auto-Profil).', 'info');
      }
      else if (normalized === 'reset') callRendererMethod('resetNavigationView');
      else if (normalized === 'focus') callRendererMethod('focusCurrentSelection');
      else if (normalized === 'home' && root) this.focusHomeSystem(root);
      else if (normalized === 'enter-system') {
        const activeStar = pinnedStar || uiState.activeStar || null;
        if (activeStar && root) {
          toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
          renderGalaxySystemDetails(root, activeStar, true);
          loadStarSystemPlanets(root, activeStar);
        }
      } else if (normalized === 'exit-system') {
        const activeStar = pinnedStar || uiState.activeStar || null;
        if (isSystemModeActive()) {
          transitionOutOfSystemView(activeStar, 'triggerNavAction:exit-system');
        }
        if (root) {
          renderGalaxySystemDetails(root, activeStar, false);
        }
      }
    }

    async jumpToSearchStar(star) {
      if (!star) return;
      closeTopbarSearchOverlay();
      const { input } = getTopbarSearchDom();
      if (input) input.blur();

      const g = Math.max(1, Number(star.galaxy_index || uiState.activeGalaxy || 1));
      const s = Math.max(1, Number(star.system_index || 1));
      WM.open('galaxy');
      const root = WM.body('galaxy');
      if (!root) return;

      const from = Math.max(1, s - 420);
      const to = Math.min(galaxySystemMax, s + 420);
      const galInput = root.querySelector('#gal-galaxy');
      const fromInput = root.querySelector('#gal-from');
      const toInput = root.querySelector('#gal-to');
      if (galInput) galInput.value = String(g);
      if (fromInput) fromInput.value = String(from);
      if (toInput) toInput.value = String(to);

      await loadGalaxyStars3D(root);

      let target = (Array.isArray(galaxyStars) ? galaxyStars : []).find((row) => Number(row?.galaxy_index || 0) === g && Number(row?.system_index || 0) === s) || null;
      if (!target) target = Object.assign({}, star, { galaxy_index: g, system_index: s });

      pinnedStar = target;
      uiState.activeStar = target;
      setGalaxyContext(g, s, target);
      const flight = await runPhysicsCinematicFlight(target, {
        durationSec: 1.8,
        holdMs: 760,
        label: `${target.name || target.catalog_name || `System ${s}`} [${g}:${s}]`,
      });
      if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') {
        galaxy3d.focusOnStar(target, !flight.ok);
      }
      toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
      renderGalaxySystemDetails(root, target, isSystemModeActive());
      showToast(`Navigation: ${target.name || target.catalog_name || `System ${s}`}`, 'info');
    }

    async focusHomeSystem(root, opts = {}) {
      const silent = !!opts.silent;
      const cinematic = !!opts.cinematic;
      const shouldEnterSystem = (typeof opts.enterSystem === 'boolean')
        ? !!opts.enterSystem
        : !!settingsState.homeEnterSystem;
      const shouldFocusPlanet = (typeof opts.focusPlanet === 'boolean')
        ? !!opts.focusPlanet
        : false;

      const homeColony = colonies.find((c) => !!c?.is_homeworld) || currentColony || null;
      if (!root || !homeColony) {
        if (!silent) showToast('Kein Heimatplanet verfuegbar.', 'warning');
        return;
      }
      const g = Math.max(1, Number(homeColony.galaxy || 1));
      const s = Math.max(1, Number(homeColony.system || 1));
      const p = Math.max(1, Number(homeColony.position || 1));
      const from = Math.max(1, s - 420);
      const to = Math.min(galaxySystemMax, s + 420);

      const galInput = root.querySelector('#gal-galaxy');
      const fromInput = root.querySelector('#gal-from');
      const toInput = root.querySelector('#gal-to');
      if (galInput) galInput.value = String(g);
      if (fromInput) fromInput.value = String(from);
      if (toInput) toInput.value = String(to);

      await loadGalaxyStars3D(root);

      let target = (galaxyStars || []).find((star) => Number(star.system_index || 0) === s) || null;
      if (!target && Array.isArray(galaxyStars) && galaxyStars.length) {
        target = galaxyStars.slice().sort((a, b) => Math.abs(Number(a.system_index || 0) - s) - Math.abs(Number(b.system_index || 0) - s))[0] || null;
      }
      if (!target) {
        let recovered = false;
        try {
          selectColonyById(homeColony.id, {
            openWindows: false,
            focusSource: 'home-visible-zero',
          });
          if (shouldEnterSystem) {
            WM.open('colony');
            recovered = true;
          }
          if (shouldFocusPlanet) {
            WM.open('buildings');
            recovered = true;
          }
        } catch (err) {
          gameLog('warn', 'Home fallback navigation fehlgeschlagen', err);
        }
        if (!silent) showToast('Heimatsystem nicht im aktuellen Sternbereich gefunden.', 'warning');
        if (recovered) {
          gameLog('warn', 'Heimatsystem nicht sichtbar, native Kolonie-Recovery aktiv', {
            galaxy: g,
            system: s,
            position: p,
          });
        }
        return;
      }

      pinnedStar = target;
      uiState.activeStar = target;

      if (cinematic) {
        const label = `${target.name || target.catalog_name || `System ${s}`} [${g}:${s}:${p}]`;
        const details = root.querySelector('#galaxy-system-details');
        if (details) {
          details.innerHTML = `<span class="text-muted">Warp-Lock: ${esc(label)} ...</span>`;
        }
        const flight = await runPhysicsCinematicFlight(target, {
          durationSec: 2.4,
          holdMs: 1050,
          label,
        });
        if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') {
          galaxy3d.focusOnStar(target, !flight.ok);
        }
      }

      if (!cinematic && galaxy3d && typeof galaxy3d.focusOnStar === 'function') {
        galaxy3d.focusOnStar(target, true);
      }

      if (cinematic) {
        toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
        renderGalaxySystemDetails(root, target, false);
        await waitMs(700);
      }

      if (shouldEnterSystem && !isSystemModeActive()) {
        renderGalaxySystemDetails(root, target, true);
        await loadStarSystemPlanets(root, target);
        if (cinematic) {
          await waitMs(450);
        }
      } else {
        renderGalaxySystemDetails(root, target, isSystemModeActive());
      }

      if (shouldFocusPlanet && isSystemModeActive()) {
        focusSystemPlanetInView({ position: p }, true);
        if (cinematic) {
          await waitMs(350);
        }
      }

      if (!silent) {
        showToast(`Heimatnavigation: ${target.name || target.catalog_name || `System ${s}`}`, 'success');
      }
    }

    init3D(root) {
      runtimeGalaxyInit3DFacadeApi.initGalaxy3D(root);
    }

    renderWindow() {
      const root = WM.body('galaxy');
      if (!root) return;

      const galaxyWindow = root.closest('.wm-window[data-winid="galaxy"]');
      if (galaxyWindow) {
        galaxyWindow.style.pointerEvents = 'none';
      }
      root.style.pointerEvents = 'none';

      if (!root.querySelector('.galaxy-3d-stage')) {
        root.innerHTML = `
          <div class="galaxy-3d-stage galaxy-bg-stage">
            <div id="galaxy-controls-overlay" class="galaxy-overlay-window hidden">
              <div class="galaxy-overlay-head">
                <strong>Galaxy Controls</strong>
                <span class="galaxy-overlay-hotkeys">O:Controls | I:Info | L:Follow | V:Vectors</span>
                <button class="btn btn-sm" data-overlay-close="#galaxy-controls-overlay">Close</button>
              </div>
              <div class="galaxy-nav">
                <label>Galaxy: <input type="number" id="gal-galaxy" min="1" max="9" value="1" /></label>
                <label>From: <input type="number" id="gal-from" min="1" max="${galaxySystemMax}" value="1" /></label>
                <label>To: <input type="number" id="gal-to" min="1" max="${galaxySystemMax}" value="${galaxySystemMax}" /></label>
                <button class="btn btn-secondary" id="gal-follow-toggle-btn">Follow: on</button>
                <label>Policy:
                  <select id="gal-policy-profile">
                    <option value="auto" ${getActivePolicyMode() === 'auto' ? 'selected' : ''}>Auto (${POLICY_PROFILES[getActivePolicyProfile()].label})</option>
                    <option value="balanced" ${getActivePolicyMode() === 'manual' && getActivePolicyProfile() === 'balanced' ? 'selected' : ''}>Balanced</option>
                    <option value="cache_aggressive" ${getActivePolicyMode() === 'manual' && getActivePolicyProfile() === 'cache_aggressive' ? 'selected' : ''}>Aggressive Cache</option>
                    <option value="always_fresh" ${getActivePolicyMode() === 'manual' && getActivePolicyProfile() === 'always_fresh' ? 'selected' : ''}>Always Fresh</option>
                  </select>
                </label>
                <label>Density:
                  <select id="gal-cluster-density">
                    <option value="auto" ${String(settingsState.clusterDensityMode || 'auto') === 'auto' ? 'selected' : ''}>Auto</option>
                    <option value="high" ${String(settingsState.clusterDensityMode || 'auto') === 'high' ? 'selected' : ''}>High</option>
                    <option value="max" ${String(settingsState.clusterDensityMode || 'auto') === 'max' ? 'selected' : ''}>Max</option>
                  </select>
                </label>
                <button class="btn btn-secondary" id="gal-cluster-bounds-btn">Cluster Boxes: on</button>
                <button class="btn btn-secondary" id="gal-cluster-heatmap-btn">Cluster Heatmap: on</button>
                <button class="btn btn-secondary" id="gal-colonies-only-btn">Nur Kolonien: aus</button>
                <button class="btn btn-secondary" id="gal-core-fx-btn">Core FX: on</button>
                <button class="btn btn-secondary" id="gal-fleet-vectors-btn">Fleet Vectors: on</button>
                <button class="btn btn-secondary" id="gal-system-legacy-fallback-btn">System Legacy Fallback: off</button>
                <button class="btn btn-secondary" id="gal-magnet-hover-toggle-btn">Magnet Hover: on</button>
                <button class="btn btn-secondary" id="gal-magnet-click-toggle-btn">Magnet Click: on</button>
                <div class="galaxy-nav-strip" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:0.25rem;">
                  <button class="btn btn-secondary btn-sm" type="button" data-magnet-preset="precise">Preset: Precise</button>
                  <button class="btn btn-secondary btn-sm" type="button" data-magnet-preset="balanced">Preset: Balanced</button>
                  <button class="btn btn-secondary btn-sm" type="button" data-magnet-preset="sticky">Preset: Sticky</button>
                </div>
                <label>Star Magnet Px:
                  <input type="range" id="gal-magnet-star-px" min="8" max="64" step="1" value="${Math.max(8, Math.min(64, Number(settingsState.hoverMagnetStarPx || 24)))}" />
                  <span id="gal-magnet-star-px-value" class="text-muted">${Math.max(8, Math.min(64, Number(settingsState.hoverMagnetStarPx || 24)))}</span>
                </label>
                <label>Planet Magnet Px:
                  <input type="range" id="gal-magnet-planet-px" min="8" max="72" step="1" value="${Math.max(8, Math.min(72, Number(settingsState.hoverMagnetPlanetPx || 30)))}" />
                  <span id="gal-magnet-planet-px-value" class="text-muted">${Math.max(8, Math.min(72, Number(settingsState.hoverMagnetPlanetPx || 30)))}</span>
                </label>
                <label>Cluster Magnet Px:
                  <input type="range" id="gal-magnet-cluster-px" min="8" max="72" step="1" value="${Math.max(8, Math.min(72, Number(settingsState.hoverMagnetClusterPx || 28)))}" />
                  <span id="gal-magnet-cluster-px-value" class="text-muted">${Math.max(8, Math.min(72, Number(settingsState.hoverMagnetClusterPx || 28)))}</span>
                </label>
                <span id="gal-magnet-help" class="text-muted">Magnetik wirkt vor allem bei langsamer Mausbewegung.</span>
                <span id="gal-policy-hint" class="text-muted"></span>
                <span id="gal-density-metrics" class="text-muted">Density: n/a</span>
                <span id="gal-health-badge" class="text-muted">Health: checking...</span>
                <button class="btn btn-secondary" id="gal-load-3d-btn">Load 3D Stars</button>
                <button class="btn btn-warning" id="gal-clear-cache-btn">Clear Cache</button>
              </div>
            </div>

            <aside id="galaxy-info-overlay" class="galaxy-overlay-window galaxy-info-overlay hidden">
              <div class="galaxy-overlay-head">
                <strong>System Details</strong>
                <button class="btn btn-sm" data-overlay-close="#galaxy-info-overlay">Close</button>
              </div>
              <div class="galaxy-overlay-shortcuts">Shortcuts: O Controls | I Info | L Follow | V Vectors</div>
              <div id="galaxy-system-details" class="text-muted">Overlay hidden. Press I to open details.</div>
              <div class="galaxy-colony-legend" aria-label="Kolonie-Ring-Legende">
                <div class="galaxy-colony-legend-title">Kolonie-Ringe</div>
                <div class="galaxy-colony-legend-row"><span class="galaxy-colony-legend-ring galaxy-colony-legend-ring-sm"></span><span>Aussenposten</span></div>
                <div class="galaxy-colony-legend-row"><span class="galaxy-colony-legend-ring galaxy-colony-legend-ring-md"></span><span>Kolonie</span></div>
                <div class="galaxy-colony-legend-row"><span class="galaxy-colony-legend-ring galaxy-colony-legend-ring-lg"></span><span>Kernwelt</span></div>
              </div>
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
              <div id="galaxy-planets-panel" class="galaxy-planets-panel"></div>
            </aside>

            <div id="galaxy-nav-orb-overlay" class="galaxy-overlay-window galaxy-nav-orb-overlay">
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
          </div>
        `;


        runtimeGalaxyWindowBindingsApi.bindGalaxyWindowControls(root);
      }

      if (root.querySelector('#gal-health-badge') && (Date.now() - galaxyHealthLastCheckMs) > 60 * 1000) {
        refreshGalaxyHealth(root, false);
      }

      // Reconnect Nav Orb handlers if the galaxy DOM was recreated externally.
      bindGalaxyNavOrb(root);

      if (!galaxy3d && document.getElementById('galaxy-3d-host')) {
        this.init3D(root);
        this.loadStars3D(root);
      }

      showGalaxyShortcutsHintOnce();
      scheduleFleetLegendHint(1300);

      refreshGalaxyDensityMetrics(root);
      updateGalaxyFollowUi(root);
      updateClusterBoundsUi(root);
      this.updateClusterHeatmapUi(root);
      updateGalaxyColonyFilterUi(root);
      this.updateCoreFxUi(root);
      this.updateFleetVectorsUi(root);
      this.updateLegacyFallbackUi(root);
      this.updateMagnetUi(root);
    }

    async loadStars3D(root) {
      await runtimeGalaxyStarLoaderFacadeApi.loadGalaxyStars3D({
        root,
        isPolicyModeAuto,
        applyPolicyMode,
        refreshPolicyUi,
        getGalaxyStars: getGalaxyStarsRef,
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
        getGalaxy3d: getGalaxy3dRef,
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
      });
    }

    refreshDensityMetrics(root) {
      runtimeGalaxyControlUiApi.refreshDensityMetrics(root);
    }

    updateClusterBoundsUi(root) {
      runtimeGalaxyControlUiApi.updateClusterBoundsUi(root);
    }

    updateClusterHeatmapUi(root) {
      runtimeGalaxyControlUiApi.updateClusterHeatmapUi(root);
    }

    updateCoreFxUi(root) {
      runtimeGalaxyControlUiApi.updateCoreFxUi(root);
    }

    updateFleetVectorsUi(root) {
      runtimeGalaxyControlUiApi.updateFleetVectorsUi(root);
    }

    updateLegacyFallbackUi(root) {
      runtimeGalaxyControlUiApi.updateLegacyFallbackUi(root);
    }

    updateFollowUi(root) {
      runtimeGalaxyControlUiApi.updateFollowUi(root);
    }

    applyMagnetPreset(presetName, root) {
      runtimeGalaxyControlUiApi.applyMagnetPreset(presetName, root);
    }

    updateMagnetUi(root) {
      runtimeGalaxyControlUiApi.updateMagnetUi(root);
    }

    async refreshHealth(root, force) {
      await runtimeGalaxyControlUiApi.refreshHealth(root, force);
    }

    /** Debug getter — exposes the live Galaxy3D renderer instance for E2E testing. */
    get _debugRenderer() { return galaxy3d; }
  }

  const galaxyController = new GalaxyController();
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
  const overviewInsights = runtimeOverviewInsightsApi.createOverviewInsights({
    fmt,
    fmtName,
    esc,
    getUiState: () => uiState,
    getCurrentColony: () => currentColony,
    getResourceInsightConfig,
    getResourceInsightValue,
    getResourceInsightTotal,
    formatResourceInsightValue,
  });

  const runtimeOverviewListsApi = requireRuntimeApi('GQRuntimeOverviewLists', ['createOverviewLists']);
  const overviewLists = runtimeOverviewListsApi.createOverviewLists({
    windowRef: window,
    esc,
    fmt,
    fmtName,
    countdown,
    api: API,
    showToast,
    getAudioManager: () => audioManager,
  });

  const runtimeOverviewActionsApi = requireRuntimeApi('GQRuntimeOverviewActions', ['createOverviewActions']);
  const overviewActions = runtimeOverviewActionsApi.createOverviewActions({
    api: API,
    wm: WM,
    getUiState: () => uiState,
    getCurrentColony: () => currentColony,
    setCurrentColony: (value) => { currentColony = value; },
    getColonies: () => colonies,
    getPlanetSelect: () => planetSelect,
    updateResourceBar: () => overviewController.updateResourceBar(),
    renderOverview: () => overviewController.render(),
    focusColonyDevelopment,
    fmtName,
    showToast,
    openFleetTransportPlanner,
    openTradeMarketplace,
    getAudioManager: () => audioManager,
    runRiskAutoUpgrade: async (cid, focusBuilding) => overviewController.runRiskAutoUpgrade(cid, focusBuilding),
    onReload: async () => overviewController.load(),
  });

  const runtimeOverviewControllerApi = requireRuntimeApi('GQRuntimeOverviewController', ['createOverviewController']);
  const overviewController = runtimeOverviewControllerApi.createOverviewController({
    wm: WM,
    api: API,
    windowRef: window,
    documentRef: document,
    getColonies: () => colonies,
    setColonies: (val) => { colonies = val; },
    getCurrentColony: () => currentColony,
    getPlanetSelect: () => planetSelect,
    getUiState: () => uiState,
    fmt,
    fmtName,
    esc,
    showToast,
    shouldRedirectOnAuthLoadError,
    redirectToLogin,
    getGalaxy3d: () => galaxy3d,
    uiKitEmptyStateHTML,
    focusColonyDevelopment,
    selectColonyById,
    buildWarningsHtml: (colony, offline) => colonyWarnings.buildWarningsHtml(colony, offline),
    buildOfflineSummaryHtml: (offline) => overviewInsights.buildOfflineSummaryHtml(offline),
    buildResourceInsightHtml: (offline, meta) => overviewInsights.buildResourceInsightHtml(offline, meta),
    evaluateRiskUpgradeBudget: (colony, nextCost, share) => overviewInsights.evaluateRiskUpgradeBudget(colony, nextCost, share),
    riskFocusFromFlags: (flags) => overviewInsights.riskFocusFromFlags(flags),
    signed: (value, digits) => overviewInsights.signed(value, digits),
    riskLabel: (status) => overviewInsights.riskLabel(status),
    renderInlineTemplate,
    renderInlineTemplateList,
    renderFleetListFn: (params) => overviewLists.renderFleetList(params),
    renderBattleLogFn: (params) => overviewLists.renderBattleLog(params),
    bindOverviewActionsFn: (root) => overviewActions.bindOverviewActions(root),
  });
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
  const colonyViewController = runtimeColonyViewControllerApi.createColonyViewController({
    wm: WM,
    api: API,
    getCurrentColony: () => currentColony,
    getUiState: () => uiState,
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
    showToast,
    gameLog,
  });

  const runtimeEconomyFlowControllerApi = requireRuntimeApi('GQRuntimeEconomyFlowController', ['createEconomyFlowController']);
  const economyFlowController = runtimeEconomyFlowControllerApi.createEconomyFlowController({
    wm: WM,
    getColonies: () => colonies,
    resourceInsightConfig: RESOURCE_INSIGHT_CONFIG,
    fmtName,
    esc,
    fmt,
    selectColonyById,
    gameLog,
  });
  window.GQEconomyFlowController = economyFlowController;
  async function renderEconomyFlow() { await economyFlowController.render(); }

  window.GQColonyViewController = colonyViewController;

  async function renderColonyView() {
    await colonyViewController.render();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ►► SIMULATION PREVIEW SYSTEM ◄◄
  // Shows building upgrade previews before commitment
  // ─────────────────────────────────────────────────────────────────────────
  
  const runtimeBuildingUpgradePreviewApi = requireRuntimeApi('GQRuntimeBuildingUpgradePreview', ['createBuildingUpgradePreview']);
  const runtimeBuildingUpgradePreview = runtimeBuildingUpgradePreviewApi.createBuildingUpgradePreview({
    fmt,
    fmtName,
    esc,
    getCurrentColony: () => currentColony,
  });

  const simulateBuildingUpgrade = runtimeBuildingUpgradePreview.simulateBuildingUpgrade;
  const buildUpgradePreviewModal = runtimeBuildingUpgradePreview.buildUpgradePreviewModal;

  const runtimeBuildingsControllerApi = requireRuntimeApi('GQRuntimeBuildingsController', ['createBuildingsController']);
  const buildingsController = runtimeBuildingsControllerApi.createBuildingsController({
    wm: WM,
    api: API,
    windowRef: window,
    documentRef: document,
    getCurrentColony: () => currentColony,
    getUiState: () => uiState,
    getBuildingUiMeta,
    fmtName,
    fmt,
    esc,
    countdown,
    simulateBuildingUpgrade,
    buildUpgradePreviewModal,
    queueColonySurfaceSceneData,
    updateResourceBar,
    showToast,
    gameLog,
  });
  window.GQBuildingsController = buildingsController;

  // ÔöÇÔöÇ Buildings window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderBuildings() {
    await buildingsController.render();
  }

  const runtimeResearchControllerApi = requireRuntimeApi('GQRuntimeResearchController', ['createResearchController']);
  const researchController = runtimeResearchControllerApi.createResearchController({
    wm: WM,
    api: API,
    getCurrentColony: () => currentColony,
    getAudioManager: () => audioManager,
    fmtName,
    fmt,
    esc,
    countdown,
    showToast,
    gameLog,
  });
  window.GQResearchController = researchController;

  // ÔöÇÔöÇ Research window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderResearch() {
    await researchController.render();
  }

  function gqStatusMsg(el, msg, type) {
    const p = document.createElement('p');
    p.className = 'text-' + type;
    p.textContent = msg;
    el.replaceChildren(p);
  }

  const runtimeShipyardControllerApi = requireRuntimeApi('GQRuntimeShipyardController', ['createShipyardController']);
  const shipyardController = runtimeShipyardControllerApi.createShipyardController({
    wm: WM,
    api: API,
    windowRef: window,
    documentRef: document,
    getCurrentColony: () => currentColony,
    updateResourceBar,
    fmt,
    fmtName,
    esc,
    countdown,
    showToast,
    gameLog,
    gqStatusMsg,
    GQUI,
  });
  window.GQShipyardController = shipyardController;

  // ÔöÇÔöÇ Shipyard window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
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
    await galaxyController.refreshHealth(root, force);
  }

  function initGalaxy3D(root) {
    galaxyController.init3D(root);
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
      activeBackend: String(window.__GQ_ACTIVE_RENDERER_BACKEND || 'unknown'),
      fallbackReason: String(lastRenderTelemetry?.reason || 'n/a'),
      reason: String(galaxy3dInitReason || '').trim() || 'n/a',
      time: new Date().toLocaleTimeString(),
    };
  }

  function renderGalaxyFallbackList(root, stars, from, to, reason = '') {
    const panel = root.querySelector('#galaxy-planets-panel');
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
    const formatColonyPopulation = (value) => {
      const population = Math.max(0, Number(value || 0));
      if (!population) return '0';
      if (population >= 1000000000) return `${(population / 1000000000).toFixed(1)}B`;
      if (population >= 1000000) return `${(population / 1000000).toFixed(1)}M`;
      if (population >= 1000) return `${(population / 1000).toFixed(1)}K`;
      return String(Math.round(population));
    };
    const getColonyMarkerMeta = (target) => {
      const colonyCount = Math.max(0, Number(target?.colony_count || 0));
      if (colonyCount <= 0) return null;
      const colonyPopulation = Math.max(0, Number(target?.colony_population || 0));
      const colonyColor = String(target?.colony_owner_color || target?.owner_color || target?.faction_color || '#7db7ee');
      const ownerName = String(target?.colony_owner_name || target?.owner || '').trim();
      const isPlayer = Number(target?.colony_is_player || 0) === 1;
      const countStrength = colonyCount > 0 ? Math.max(0, Math.min(1, (Math.log2(colonyCount + 1) - 0.3) / 3.2)) : 0;
      const popStrength = colonyPopulation > 0 ? Math.max(0, Math.min(1, (Math.log10(colonyPopulation + 1) - 2.2) / 3.0)) : 0;
      const strength = Math.max(countStrength, popStrength);
      let label = 'Aussenposten';
      if (strength >= 0.75) label = 'Kernwelt';
      else if (strength >= 0.4) label = 'Kolonie';
      return {
        count: colonyCount,
        population: colonyPopulation,
        populationShort: formatColonyPopulation(colonyPopulation),
        color: colonyColor,
        strength,
        label: isPlayer ? `Eigene ${label}` : label,
        ownerName,
        isPlayer,
      };
    };

    const card = document.getElementById('galaxy-hover-card');
    if (!card) return;
    if (!star || !pos) {
      if (!pinnedStar || !pinned) card.classList.add('hidden');
      return;
    }
    if (star.__kind === 'planet') {
      const sourceStar = star.__sourceStar || {};
      const title = star.name || fmtName(String(star.planet_class || 'planet'));
      const owner = star.owner ? ` ┬À ${esc(star.owner)}` : '';
      const ownColony = colonies.find((col) => Number(col.id || 0) === Number(star.colony_id || star.__slot?.player_planet?.colony_id || 0)) || null;
      const ownerColor = String(star.owner_color || star.__slot?.player_planet?.owner_color || '#7db7ee');
      const ownerBadge = star.owner
        ? `<div class="hover-meta hover-meta-colony"><span class="hover-colony-swatch" style="background:${esc(ownerColor)};box-shadow:0 0 8px ${esc(ownerColor)};"></span>${esc(ownColony ? 'Eigene Kolonie' : 'Fremde Kolonie')}${star.owner ? ` ┬À Besitzer: ${esc(star.owner)}` : ''}</div>`
        : '';
      card.innerHTML = `
        <div class="hover-title hover-title-planet"><span class="hover-planet-icon">${planetIcon(star.planet_class)}</span>${esc(title)}</div>
        <div class="hover-meta">${esc(star.planet_class || 'Planet')} ┬À slot ${esc(String(star.__slot?.position || star.position || '?'))}${owner}</div>
        <div class="hover-meta">around ${esc(sourceStar.name || sourceStar.catalog_name || 'system star')}</div>
        ${ownerBadge}`;
    } else if (star.__kind === 'cluster') {
      const systems = Array.isArray(star.__clusterSystems) ? star.__clusterSystems : [];
      const from = systems.length ? Math.min(...systems) : Number(star.from || 0);
      const to = systems.length ? Math.max(...systems) : Number(star.to || 0);
      const clusterColor = String(star.__clusterColor || '#ff7b72');
      card.innerHTML = `
        <div class="hover-title"><span class="hover-star-dot" style="background:${esc(clusterColor)};box-shadow:0 0 10px ${esc(clusterColor)};"></span>${esc(star.label || star.name || `Cluster ${Number(star.__clusterIndex || 0) + 1}`)}</div>
        <div class="hover-meta">Systeme: ${esc(String(from || '?'))} - ${esc(String(to || '?'))}</div>
        <div class="hover-meta">Hover/Klick selektiert ┬À Doppelklick zoomt in die Bounding Box</div>`;
    } else {
      const starColor = starClassColor(star.spectral_class);
      const colonyMeta = getColonyMarkerMeta(star);
      const colonyLine = colonyMeta
        ? `<div class="hover-meta hover-meta-colony"><span class="hover-colony-swatch" style="background:${esc(colonyMeta.color)};box-shadow:0 0 8px ${esc(colonyMeta.color)};"></span>${esc(colonyMeta.label)} ┬À ${esc(String(colonyMeta.count))} Kolonien ┬À Pop ${esc(colonyMeta.populationShort)}${colonyMeta.ownerName ? ` ┬À ${esc(colonyMeta.isPlayer ? 'Besitzer: Du' : `Besitzer: ${colonyMeta.ownerName}`)}` : ''}</div>`
        : '';
      card.innerHTML = `
        <div class="hover-title"><span class="hover-star-dot" style="background:${starColor};box-shadow:0 0 8px ${starColor};"></span>${esc(star.name)}</div>
        <div class="hover-meta">${esc(star.spectral_class)}${esc(String(star.subtype ?? ''))} ┬À ${star.galaxy_index}:${star.system_index}</div>
        ${colonyLine}`;
    }

    const _hostW = document.getElementById('galaxy-3d-host')?.clientWidth || window.innerWidth;
    card.style.left = `${Math.max(10, Math.min(pos.x, _hostW - 10))}px`;
    card.style.top = `${Math.max(18, pos.y - 18)}px`;
    card.classList.remove('hidden');
    card.classList.toggle('pinned', !!pinned);
  }

  function applyClusterRangeToControls(root, clusterPayload, opts = {}) {
    if (!root || !clusterPayload || clusterPayload.__kind !== 'cluster') return null;
    const systems = Array.isArray(clusterPayload.__clusterSystems)
      ? clusterPayload.__clusterSystems
        .map((n) => Number(n || 0))
        .filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const rawFrom = systems.length ? Math.min(...systems) : Number(clusterPayload.from || 0);
    const rawTo = systems.length ? Math.max(...systems) : Number(clusterPayload.to || rawFrom || 0);
    if (!Number.isFinite(rawFrom) || rawFrom <= 0) return null;

    const from = Math.max(1, Math.min(galaxySystemMax, Math.floor(rawFrom)));
    const to = Math.max(from, Math.min(galaxySystemMax, Math.floor(rawTo || rawFrom)));
    const fromInput = root.querySelector('#gal-from');
    const toInput = root.querySelector('#gal-to');
    if (fromInput) fromInput.value = String(from);
    if (toInput) toInput.value = String(to);
    uiState.activeRange = { from, to };

    if (opts.toast !== false) {
      const label = String(clusterPayload.label || clusterPayload.name || `Cluster ${Number(clusterPayload.__clusterIndex || 0) + 1}`);
      showToast(`Cluster-Range gesetzt: ${label} (${from}-${to})`, 'info');
    }
    return { from, to };
  }

  function renderGalaxySystemDetails(root, star, zoomed) {
    const details = root.querySelector('#galaxy-system-details');
    if (!details) return;
    const formatColonyPopulation = (value) => {
      const population = Math.max(0, Number(value || 0));
      if (!population) return '0';
      return population.toLocaleString('de-DE');
    };
    const getColonyMarkerMeta = (target) => {
      const colonyCount = Math.max(0, Number(target?.colony_count || 0));
      if (colonyCount <= 0) return null;
      const colonyPopulation = Math.max(0, Number(target?.colony_population || 0));
      const colonyColor = String(target?.colony_owner_color || target?.owner_color || target?.faction_color || '#7db7ee');
      const ownerName = String(target?.colony_owner_name || target?.owner || '').trim();
      const isPlayer = Number(target?.colony_is_player || 0) === 1;
      const countStrength = colonyCount > 0 ? Math.max(0, Math.min(1, (Math.log2(colonyCount + 1) - 0.3) / 3.2)) : 0;
      const popStrength = colonyPopulation > 0 ? Math.max(0, Math.min(1, (Math.log10(colonyPopulation + 1) - 2.2) / 3.0)) : 0;
      const strength = Math.max(countStrength, popStrength);
      let label = 'Au├ƒenposten';
      if (strength >= 0.75) label = 'Kernwelt';
      else if (strength >= 0.4) label = 'Kolonie';
      return {
        count: colonyCount,
        population: colonyPopulation,
        populationFull: formatColonyPopulation(colonyPopulation),
        color: colonyColor,
        label: isPlayer ? `Eigene ${label}` : label,
        ownerName,
        isPlayer,
      };
    };
    const followEnabled = !galaxy3d || typeof galaxy3d.isFollowingSelection !== 'function'
      ? true
      : galaxy3d.isFollowingSelection();
    const quickNavActions = [
      { action: 'home', label: 'Home', title: 'Jump to home system' },
      { action: 'zoom-in', label: '+', title: 'Zoom in' },
      { action: 'zoom-out', label: '-', title: 'Zoom out' },
      { action: 'rotate-left', label: 'Left', title: 'Rotate left' },
      { action: 'rotate-right', label: 'Right', title: 'Rotate right' },
      { action: 'rotate-up', label: 'Up', title: 'Rotate up' },
      { action: 'rotate-down', label: 'Down', title: 'Rotate down' },
      { action: 'focus', label: 'Focus', title: 'Focus selection' },
    ];
    if (star && !zoomed) {
      quickNavActions.unshift({ action: 'enter-system', label: 'System', title: 'Enter selected system', className: 'galaxy-detail-nav-btn-mode' });
    }
    if (star && zoomed) {
      quickNavActions.unshift({ action: 'exit-system', label: 'Galaxie', title: 'Return to galaxy view', className: 'galaxy-detail-nav-btn-mode' });
    }
    quickNavActions.push({ action: 'reset', label: 'Reset', title: 'Reset', className: 'galaxy-detail-nav-btn-reset' });
    const navButtons = `
      <div class="galaxy-detail-nav" aria-label="Schnellnavigation 3D">
        ${quickNavActions.map((entry) => `<button type="button" class="galaxy-detail-nav-btn ${esc(entry.className || '')}" data-nav-action="${esc(entry.action)}" title="${esc(entry.title)}">${esc(entry.label)}</button>`).join('')}
      </div>`;
    const fleetVectorsOn = settingsState.galaxyFleetVectorsVisible !== false;
    const visibleFleetCount = zoomed
      ? Number(galaxy3d?.systemFleetEntries?.length || 0)
      : Number(galaxy3d?.galaxyFleetEntries?.length || (window._GQ_fleets || []).length || 0);
    const showFleetLegend = visibleFleetCount > 0;
    const fleetLegendBodyHtml = !showFleetLegend
      ? ''
      : (fleetVectorsOn
      ? (zoomed
        ? `
        <div class="galaxy-fleet-legend-title">Fleet-Richtungsfarben (kompakt)</div>
        <div class="galaxy-fleet-legend-row galaxy-fleet-legend-row-compact">
          <span class="galaxy-fleet-legend-line" style="--fleet-color:#ff4d3d"></span>Angriff
          <span class="galaxy-fleet-legend-line" style="--fleet-color:#41d1ff"></span>Spionage
        </div>
        <div class="galaxy-fleet-legend-row galaxy-fleet-legend-row-compact">
          <span class="galaxy-fleet-legend-line" style="--fleet-color:#86ff66"></span>Transport
          <span class="galaxy-fleet-legend-line" style="--fleet-color:#5cf2a5"></span>Kolonisieren
          <span class="galaxy-fleet-legend-line" style="--fleet-color:#ffd15c"></span>Ernten
        </div>
      `
        : `
        <div class="galaxy-fleet-legend-title">Fleet-Richtungsfarben</div>
        <div class="galaxy-fleet-legend-row"><span class="galaxy-fleet-legend-line" style="--fleet-color:#ff4d3d"></span>Angriff</div>
        <div class="galaxy-fleet-legend-row"><span class="galaxy-fleet-legend-line" style="--fleet-color:#41d1ff"></span>Spionage</div>
        <div class="galaxy-fleet-legend-row"><span class="galaxy-fleet-legend-line" style="--fleet-color:#86ff66"></span>Transport</div>
        <div class="galaxy-fleet-legend-row"><span class="galaxy-fleet-legend-line" style="--fleet-color:#5cf2a5"></span>Kolonisieren</div>
        <div class="galaxy-fleet-legend-row"><span class="galaxy-fleet-legend-line" style="--fleet-color:#ffd15c"></span>Ernten</div>
      `)
      : `
        <div class="galaxy-fleet-legend-title">Fleet-Richtungsfarben</div>
        <div class="galaxy-fleet-legend-row text-muted">In Settings deaktiviert (Galaxy: Fleet-Marker und Fluglinien anzeigen).</div>
      `);
    const fleetLegendHtml = `
      <div class="galaxy-fleet-legend ${showFleetLegend ? 'is-visible' : 'is-hidden'}" aria-label="Fleet-Richtungsfarben" aria-hidden="${showFleetLegend ? 'false' : 'true'}">
        ${fleetLegendBodyHtml}
      </div>`;
    if (!star) {
      details.innerHTML = `${navButtons}<span class="text-muted">Press I for this overlay. Camera: mouse drag + wheel, keyboard WASD/QE + arrows, F fit, R reset, L follow ${followEnabled ? 'off' : 'on'}.</span>${fleetLegendHtml}`;
      details.querySelectorAll('[data-nav-action]').forEach((button) => {
        button.addEventListener('click', () => triggerGalaxyNavAction(button.getAttribute('data-nav-action'), root));
      });
      return;
    }

    if (star.__kind === 'cluster') {
      const systems = Array.isArray(star.__clusterSystems) ? star.__clusterSystems : [];
      const from = systems.length ? Math.min(...systems) : Number(star.from || 0);
      const to = systems.length ? Math.max(...systems) : Number(star.to || 0);
      const factionName = star?.faction?.name ? ` | ${esc(star.faction.name)}` : '';
      details.innerHTML = `
        <div class="system-card">
          <div class="system-title">${esc(star.label || `Cluster ${Number(star.__clusterIndex || 0) + 1}`)}</div>
          ${navButtons}
          <div class="system-row">Clusterbereich: ${esc(String(from || '?'))} - ${esc(String(to || '?'))}${factionName}</div>
          <div class="system-row">Bounding Box: ${Number(star.__clusterSize?.x || 0).toFixed(1)} x ${Number(star.__clusterSize?.y || 0).toFixed(1)} x ${Number(star.__clusterSize?.z || 0).toFixed(1)}</div>
          <div class="system-row">Center: ${Number(star.__clusterCenter?.x || 0).toFixed(1)}, ${Number(star.__clusterCenter?.y || 0).toFixed(1)}, ${Number(star.__clusterCenter?.z || 0).toFixed(1)}</div>
          <div class="system-row">Cluster gebunden, rotiert mit der Sternwolke und ist per Mouse hover-/selektierbar.</div>
          <div class="system-row">Klick fokussiert die Box, Doppelklick zoomt clusterweise hinein.</div>
          ${fleetLegendHtml}
          <div class="system-row" style="margin-top:0.45rem;">
            <button id="gal-load-cluster-range-btn" type="button" class="btn btn-secondary btn-sm">Cluster-Range laden</button>
          </div>
        </div>`;
      details.querySelectorAll('[data-nav-action]').forEach((button) => {
        button.addEventListener('click', () => triggerGalaxyNavAction(button.getAttribute('data-nav-action'), root));
      });
      details.querySelector('#gal-load-cluster-range-btn')?.addEventListener('click', async () => {
        const range = applyClusterRangeToControls(root, star, { toast: true });
        if (!range) return;
        flashGalaxyControlBtn(root, '#gal-cluster-bounds-btn');
        flashGalaxyControlBtn(root, '#gal-density-metrics');
        await loadGalaxyStars3D(root);
      });
      return;
    }

    const countRaw = Number(star.planet_count);
    const hasKnownPlanetCount = Number.isFinite(countRaw) && countRaw > 0;
    const planetCountHtml = hasKnownPlanetCount
      ? String(Math.round(countRaw))
      : '<span class="text-muted" title="legacy cache/no count">n/a</span>';
    const isFav = isFavoriteStar(star);
    const colonyMeta = getColonyMarkerMeta(star);
    const colonyHtml = colonyMeta
      ? `<div class="system-row system-row-colony"><span class="system-colony-swatch" style="background:${esc(colonyMeta.color)};box-shadow:0 0 10px ${esc(colonyMeta.color)};"></span>${esc(colonyMeta.label)} | ${esc(String(colonyMeta.count))} Kolonien | Bevoelkerung ${esc(colonyMeta.populationFull)}${colonyMeta.ownerName ? ` | ${esc(colonyMeta.isPlayer ? 'Dominanz: Du' : `Dominanz: ${colonyMeta.ownerName}`)}` : ''}</div>`
      : '<div class="system-row text-muted">Keine bekannten Kolonien in diesem System.</div>';
    const scientificScaleEnabled = galaxy3d?.getRenderStats?.()?.scientificScaleEnabled === true;
    const scaleButtonHtml = zoomed ? `<button type="button" class="btn btn-secondary btn-sm${scientificScaleEnabled ? ' active' : ''}" data-system-action="scientific-scale" title="Toggle between game scale and scientific proportions">${scientificScaleEnabled ? 'Spielmodus' : 'Wissenschaft'}</button>` : '';
    const systemActionHtml = `
      <div class="system-row" style="margin-top:0.42rem; display:flex; gap:0.36rem; flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary btn-sm" data-system-action="enter-system">Planet View</button>
        <button type="button" class="btn btn-secondary btn-sm" data-system-action="fleet">Fleet</button>
        <button type="button" class="btn btn-secondary btn-sm" data-system-action="gates">Gate Installations</button>
        ${scaleButtonHtml}
      </div>`;

    // FoW visibility indicator
    const fowLevel = isCurrentUserAdmin() ? 'own' : (star.visibility_level || 'unknown');
    const fowLabels = { own: 'Eigene Kolonie', active: 'Flotte aktiv', stale: 'Veraltete Aufklaerung', unknown: 'Unerforscht' };
    const fowHtml = `<div class="system-row ${fowLevel === 'unknown' ? 'fow-unknown-badge' : ''}" style="${fowLevel === 'stale' ? 'color:#e8c843' : ''}">${esc(fowLabels[fowLevel] || fowLevel)}</div>`;

    details.innerHTML = `
      <div class="system-card">
        <div class="system-title">${esc(star.name)}</div>
        ${navButtons}
        <div class="system-row">Catalog: ${esc(star.catalog_name || '-')}</div>
        <div class="system-row">Galaxy/System: ${star.galaxy_index}:${star.system_index}</div>
        <div class="system-row">Class: ${esc(star.spectral_class)}${esc(String(star.subtype ?? ''))}</div>
        <div class="system-row">Coordinates: ${Number(star.x_ly || 0).toFixed(0)}, ${Number(star.y_ly || 0).toFixed(0)}, ${Number(star.z_ly || 0).toFixed(0)} ly</div>
        <div class="system-row">Habitable Zone: ${Number(star.hz_inner_au || 0).toFixed(2)} - ${Number(star.hz_outer_au || 0).toFixed(2)} AU</div>
        <div class="system-row">Planets: ${planetCountHtml}</div>
        ${colonyHtml}
        ${fowHtml}
        <div class="system-row">Selection Follow: ${followEnabled ? 'locked' : 'free'} (L)</div>
        <div class="system-row">${zoomed ? 'System view active. Esc/F/R returns to galaxy overview.' : 'Double click to zoom into the system and show planets.'}</div>
        ${systemActionHtml}
        ${fleetLegendHtml}
        <div class="system-row" style="margin-top:0.4rem">
          <button id="gal-quicknav-fav-btn" type="button" class="btn btn-secondary btn-sm${isFav ? ' active' : ''}">${isFav ? 'Favorit entfernen' : 'Favorit hinzufuegen'}</button>
        </div>
      </div>`;
    details.querySelectorAll('[data-nav-action]').forEach((button) => {
      button.addEventListener('click', () => triggerGalaxyNavAction(button.getAttribute('data-nav-action'), root));
    });
    details.querySelector('#gal-quicknav-fav-btn')?.addEventListener('click', () => {
      const btn = details.querySelector('#gal-quicknav-fav-btn');
      if (isFavoriteStar(star)) {
        removeFavorite(`${Number(star.galaxy_index)}:${Number(star.system_index)}`);
        if (btn) { btn.textContent = 'Favorit hinzufuegen'; btn.classList.remove('active'); }
        showToast(`${star.name} aus Favoriten entfernt.`, 'info');
      } else {
        addFavorite(star);
        if (btn) { btn.textContent = 'Favorit entfernen'; btn.classList.add('active'); }
        showToast(`${star.name} als Favorit gespeichert.`, 'success');
      }
      updateFooterQuickNavBadge();
      WM.refresh('quicknav');
    });
    details.querySelectorAll('[data-system-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = String(button.getAttribute('data-system-action') || '').toLowerCase();
        if (action === 'enter-system') {
          if (zoomed) return;
          triggerGalaxyNavAction('enter-system', root);
          return;
        }
        if (action === 'fleet') {
          prefillFleetTarget({
            galaxy: Number(star.galaxy_index || uiState.activeGalaxy || 1),
            system: Number(star.system_index || uiState.activeSystem || 1),
            position: 1,
          }, 'transport', {
            owner: String(star.colony_owner_name || ''),
          });
          return;
        }
        if (action === 'gates') {
          const colonyInSystem = colonies.find((col) =>
            Number(col.galaxy || 0) === Number(star.galaxy_index || 0)
            && Number(col.system || 0) === Number(star.system_index || 0)
          );
          if (!colonyInSystem) {
            showToast('Keine eigene Kolonie in diesem System fuer Gate-Installationen.', 'warning');
            return;
          }
          openColonySubview(colonyInSystem.id, 'gates', { source: 'system-view' });
          return;
        }
        if (action === 'scientific-scale') {
          if (galaxy3d && typeof galaxy3d.toggleScientificScale === 'function') {
            const newState = galaxy3d.toggleScientificScale();
            const msg = newState ? 'Wissenschaftliche Skalierung: Relative Planetengrößen korrekt' : 'Spielmodus: Alle Planeten gleichzeitig sichtbar';
            showToast(msg, 'info');
            renderGalaxySystemDetails(root, star, isSystemModeActive());
          } else {
            showToast('Wissenschaftliche Skalierung ist derzeit nicht verfügbar.', 'warning');
          }
          return;
        }
      });
    });
  }

  // ÔöÇÔöÇ QuickNav / Favoriten ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const QUICKNAV_KEY = 'gq_quicknav';
  const QUICKNAV_RIBBONS = [
    { id: '', label: 'Keine' },
    { id: 'home',   label: 'Home' },
    { id: 'colony', label: 'Kolonie' },
    { id: 'combat', label: 'Kampf' },
    { id: 'watch',  label: 'Beobachten' },
  ];

  function loadQuickNavData() {
    try {
      return JSON.parse(localStorage.getItem(QUICKNAV_KEY) || '{}');
    } catch (err) {
      gameLog('info', 'QuickNav Daten konnten nicht geladen werden, fallback leer', err);
      return {};
    }
  }
  function saveQuickNavData(data) {
    try {
      localStorage.setItem(QUICKNAV_KEY, JSON.stringify(data));
    } catch (err) {
      gameLog('info', 'QuickNav Daten konnten nicht gespeichert werden', err);
    }
  }
  function getQuickNavFavorites() {
    return Array.isArray(loadQuickNavData().favorites) ? loadQuickNavData().favorites : [];
  }
  function isFavoriteStar(star) {
    if (!star || !star.galaxy_index || !star.system_index) return false;
    const key = `${Number(star.galaxy_index)}:${Number(star.system_index)}`;
    return getQuickNavFavorites().some((f) => f.key === key);
  }
  function addFavorite(star, ribbon = '') {
    const g = Number(star.galaxy_index || 1);
    const s = Number(star.system_index || 0);
    if (!s) return;
    const key = `${g}:${s}`;
    const data = loadQuickNavData();
    if (!Array.isArray(data.favorites)) data.favorites = [];
    if (data.favorites.some((f) => f.key === key)) return;
    data.favorites.unshift({
      key,
      galaxy_index: g,
      system_index: s,
      name: String(star.name || star.catalog_name || `System ${s}`),
      catalog_name: String(star.catalog_name || ''),
      spectral_class: String(star.spectral_class || 'G'),
      subtype: String(star.subtype || ''),
      x_ly: Number(star.x_ly || 0),
      y_ly: Number(star.y_ly || 0),
      z_ly: Number(star.z_ly || 0),
      ribbon,
      pinnedAt: Date.now(),
    });
    saveQuickNavData(data);
  }
  function removeFavorite(key) {
    const data = loadQuickNavData();
    if (!Array.isArray(data.favorites)) return;
    data.favorites = data.favorites.filter((f) => f.key !== key);
    saveQuickNavData(data);
  }
  function setFavoriteRibbon(key, ribbon) {
    const data = loadQuickNavData();
    if (!Array.isArray(data.favorites)) return;
    const fav = data.favorites.find((f) => f.key === key);
    if (fav) { fav.ribbon = ribbon; saveQuickNavData(data); }
  }
  function updateFooterQuickNavBadge() {
    const badge = document.getElementById('footer-quicknav-badge');
    if (!badge) return;
    const count = getQuickNavFavorites().length;
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  }

  /** QuickNav window render */
  function renderQuickNav() {
    const root = WM.body('quicknav');
    if (!root) return;

    // Read filter/sort state from DOM if already rendered, else defaults
    const prevSearch = root.querySelector('#qn-search')?.value || '';
    const prevRibbon = root.querySelector('.quicknav-ribbon-pill.active')?.dataset.ribbon ?? 'all';
    const prevSort   = root.querySelector('#qn-sort')?.value || 'recent';

    const ribbonOptions = QUICKNAV_RIBBONS.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('');
    root.innerHTML = `<div class="quicknav-wrap">
      <div class="quicknav-toolbar">
        <input id="qn-search" class="quicknav-search" type="search" placeholder="Name oder Koordinate suchen..." value="${esc(prevSearch)}" autocomplete="off" />
        <select id="qn-sort" class="quicknav-sort" title="Sortierung">
          <option value="recent"   ${prevSort === 'recent'   ? 'selected' : ''}>Hinzugefuegt</option>
          <option value="name"     ${prevSort === 'name'     ? 'selected' : ''}>A-Z Name</option>
          <option value="name-z"   ${prevSort === 'name-z'   ? 'selected' : ''}>Z-A Name</option>
          <option value="system"   ${prevSort === 'system'   ? 'selected' : ''}>System-Nr.</option>
          <option value="ribbon"   ${prevSort === 'ribbon'   ? 'selected' : ''}>Ribbon</option>
        </select>
        <div class="quicknav-ribbon-filter">
          <button class="quicknav-ribbon-pill${prevRibbon === 'all' ? ' active' : ''}" data-ribbon="all">Alle</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'home' ? ' active' : ''}" data-ribbon="home">Home</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'colony' ? ' active' : ''}" data-ribbon="colony">Kolonie</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'combat' ? ' active' : ''}" data-ribbon="combat">Kampf</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'watch' ? ' active' : ''}" data-ribbon="watch">Watch</button>
          <button class="quicknav-ribbon-pill${prevRibbon === '' ? ' active' : ''}" data-ribbon="">Keine</button>
        </div>
      </div>
      <div class="quicknav-list" id="qn-list"></div>
    </div>`;

    const renderList = () => {
      const listEl = root.querySelector('#qn-list');
      if (!listEl) return;
      const search    = (root.querySelector('#qn-search')?.value || '').trim().toLowerCase();
      const ribbon    = root.querySelector('.quicknav-ribbon-pill.active')?.dataset.ribbon ?? 'all';
      const sortMode  = root.querySelector('#qn-sort')?.value || 'recent';
      let favorites   = getQuickNavFavorites();

      // Filter
      if (ribbon !== 'all') favorites = favorites.filter((f) => (f.ribbon || '') === ribbon);
      if (search) {
        favorites = favorites.filter((f) =>
          f.name.toLowerCase().includes(search) ||
          f.catalog_name.toLowerCase().includes(search) ||
          `${f.galaxy_index}:${f.system_index}`.includes(search)
        );
      }

      // Sort
      if (sortMode === 'name')     favorites = [...favorites].sort((a, b) => a.name.localeCompare(b.name));
      else if (sortMode === 'name-z')  favorites = [...favorites].sort((a, b) => b.name.localeCompare(a.name));
      else if (sortMode === 'system')  favorites = [...favorites].sort((a, b) => a.galaxy_index - b.galaxy_index || a.system_index - b.system_index);
      else if (sortMode === 'ribbon')  favorites = [...favorites].sort((a, b) => (a.ribbon || '').localeCompare(b.ribbon || ''));
      // 'recent' = insertion order (already sorted by pinnedAt desc on add)

      if (!favorites.length) {
        listEl.innerHTML = `<div class="quicknav-empty">
          Keine Favoriten${ribbon !== 'all' || search ? ' fuer diese Auswahl' : ''}.<br/>
          <span style="font-size:0.77rem">Stern im Galaxy-Detail-Panel mit <strong>Favorit</strong> markieren.</span>
        </div>`;
        return;
      }

      listEl.innerHTML = favorites.map((fav) => {
        const r = fav.ribbon || '';
        const cls = String(fav.spectral_class || 'G') + String(fav.subtype || '');
        return `<div class="quicknav-item" data-fav-key="${esc(fav.key)}">
          <div class="quicknav-ribbon-dot" data-r="${esc(r)}"></div>
          <div class="quicknav-item-name" title="${esc(fav.name)}">${esc(fav.name)}</div>
          <span class="quicknav-item-class">${esc(cls)}</span>
          <span class="quicknav-item-meta">${fav.galaxy_index}:${fav.system_index}</span>
          <div class="quicknav-item-actions">
            <select class="quicknav-ribbon-select" data-fav-key="${esc(fav.key)}" title="Ribbon">
              ${QUICKNAV_RIBBONS.map((rb) => `<option value="${esc(rb.id)}"${(fav.ribbon || '') === rb.id ? ' selected' : ''}>${esc(rb.label)}</option>`).join('')}
            </select>
            <button class="quicknav-item-btn go" data-fav-key="${esc(fav.key)}" title="Ansteuern">Go</button>
            <button class="quicknav-item-btn remove" data-fav-key="${esc(fav.key)}" title="Aus Favoriten entfernen">Del</button>
          </div>
        </div>`;
      }).join('');
    };

    renderList();

    // ÔöÇÔöÇ Events ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    const navigateToFav = async (key) => {
      const favs = getQuickNavFavorites();
      const fav  = favs.find((f) => f.key === key);
      if (!fav) return;
      const liveData = (Array.isArray(galaxyStars) ? galaxyStars : []).find((s) =>
        Number(s.galaxy_index) === fav.galaxy_index && Number(s.system_index) === fav.system_index
      );
      const starData = liveData || {
        galaxy_index: fav.galaxy_index, system_index: fav.system_index,
        name: fav.name, catalog_name: fav.catalog_name,
        spectral_class: fav.spectral_class, subtype: fav.subtype,
        x_ly: fav.x_ly, y_ly: fav.y_ly, z_ly: fav.z_ly,
      };
      WM.open('galaxy');
      pinnedStar = starData;
      const flight = await runPhysicsCinematicFlight(starData, {
        durationSec: 1.7,
        holdMs: 720,
        label: `${starData.name || starData.catalog_name || `System ${Number(starData.system_index || 0)}`} [${Number(starData.galaxy_index || 1)}:${Number(starData.system_index || 0)}]`,
      });
      if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') galaxy3d.focusOnStar(starData, !flight.ok);
      const galaxyRoot = WM.body('galaxy');
      if (galaxyRoot) renderGalaxySystemDetails(galaxyRoot, starData, false);
      if (audioManager && typeof audioManager.playNavigation === 'function') audioManager.playNavigation();
    };

    root.querySelector('#qn-search')?.addEventListener('input', renderList);
    root.querySelector('#qn-sort')?.addEventListener('change', renderList);

    root.querySelectorAll('.quicknav-ribbon-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        root.querySelectorAll('.quicknav-ribbon-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        renderList();
      });
    });

    root.querySelector('#qn-list')?.addEventListener('click', (e) => {
      const goBtn    = e.target.closest('.quicknav-item-btn.go');
      const removeBtn = e.target.closest('.quicknav-item-btn.remove');
      const itemRow  = e.target.closest('.quicknav-item');
      if (goBtn) {
          navigateToFav(goBtn.dataset.favKey).catch((err) => {
            gameLog('info', 'QuickNav Navigation (Button) fehlgeschlagen', err);
          });
        return;
      }
      if (removeBtn) {
        removeFavorite(removeBtn.dataset.favKey);
        updateFooterQuickNavBadge();
        renderList();
        const galaxyRoot = WM.body('galaxy');
        if (galaxyRoot && pinnedStar) renderGalaxySystemDetails(galaxyRoot, pinnedStar, isSystemModeActive());
        return;
      }
      if (itemRow && !e.target.closest('select') && !e.target.closest('button')) {
            navigateToFav(itemRow.dataset.favKey).catch((err) => {
              gameLog('info', 'QuickNav Navigation (Item) fehlgeschlagen', err);
            });
      }
    });

    root.querySelector('#qn-list')?.addEventListener('change', (e) => {
      const sel = e.target.closest('.quicknav-ribbon-select');
      if (!sel) return;
      setFavoriteRibbon(sel.dataset.favKey, sel.value);
      renderList();
    });
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
          toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
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

    for (let start = from; start <= to; start += chunkSize) {
      if (myToken !== galaxyHydrationToken) return;
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
          clusterPreset: 'low',
          includeClusterLod: false,
        });
      } catch (netErr) {
        console.warn('[GQ] hydrateGalaxyRangeInBackground: chunk request failed', { g, start, end, error: netErr });
        continue;
      }
      if (!data?.success || !Array.isArray(data.stars)) continue;

      const responseTs = Number(data.server_ts_ms || Date.now());
      galaxyStars = mergeGalaxyStarsBySystem(galaxyStars, normalizeStarListVisibility(data.stars), g);
      loadedChunks += 1;
      loadedSystems += data.stars.length;

      if (galaxyModel) {
        galaxyModel.upsertStarBatch(g, normalizeStarListVisibility(data.stars));
        galaxyModel.addLoadedStarRange(g, start, end, responseTs);
      }
      if (galaxyDB) {
            galaxyDB.upsertStars(normalizeStarListVisibility(data.stars), responseTs).catch((err) => {
              gameLog('info', 'DB upsertStars (lazy load) fehlgeschlagen', err);
            });
      }

      if (uiState.activeGalaxy === g) {
        if (Array.isArray(data.clusters)) uiState.rawClusters = data.clusters;
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
        const details = root.querySelector('#galaxy-system-details');
        if (details) {
          details.innerHTML = `<span class="text-cyan">Lazy full-load: ${loadedSystems} Systeme nachgeladen (${start}-${end}/${to}, chunk ${loadedChunks}).</span>`;
        }
        if (!galaxy3d?.systemMode) {
          renderGalaxyColonySummary(root.querySelector('#galaxy-planets-panel'), galaxyStars, { from, to });
        }
      }
    }
  }

  async function loadGalaxyStars3D(root) {
    await galaxyController.loadStars3D(root);
    WM.refresh('minimap');
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
    if (preferred === 'webgl2' && sharedThree) return sharedThree;
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
    return {
      orchestrator: zoomOrchestrator,
      ZOOM_LEVEL: gqZoom.ZOOM_LEVEL || null,
      SPATIAL_DEPTH: gqZoom.SPATIAL_DEPTH || null,
    };
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
    const panel = root.querySelector('#galaxy-planets-panel');
    if (!panel || !star) return;

    panel.innerHTML = '<p class="text-muted">Loading planets...</p>';

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
          renderPlanetPanel(panel, star, payload);
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
      panel.innerHTML = `<p class="text-yellow">Systemansicht ge├Âffnet. Planetendaten konnten nicht geladen werden.</p>
        <button class="btn btn-secondary btn-sm" style="margin-top:0.4rem" id="planet-retry-btn">Ôå║ Erneut laden</button>`;
      const retryBtn = panel.querySelector('#planet-retry-btn');
      if (retryBtn) retryBtn.addEventListener('click', () => loadStarSystemPlanets(root, star));
      showToast('Planetendaten nicht verf├╝gbar ÔÇô bitte Retry klicken oder Doppelklick wiederholen.', 'warning');
      if (galaxyModel) {
        galaxyModel.setSystemLoadState(g, s, { pending: false, payload: 'error' });
      }
      return;
    }

    const safePayload = buildSafeSystemPayload(loadResult.payload);
    logEnterSystemPipeline('loadStarSystemPlanets:safePayload', summarizeSystemPayloadMeta(safePayload, g, s));
    renderPlanetPanel(panel, star, safePayload);
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

  async function renderPlanetDetailCard(detail, slot) {
    const pos = Number(slot?.position || 0);
    const pp = slot?.player_planet;
    const gp = slot?.generated_planet;
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
      detail.innerHTML = `
        <h5>Planet #${pos} - ${esc(gp.name || fmtName(gp.planet_class))}</h5>
        <div class="planet-detail-row">Class: ${esc(gp.planet_class || 'ÔÇö')}</div>
        <div class="planet-detail-row">Semi-major axis: ${Number(gp.semi_major_axis_au || 0).toFixed(3)} AU</div>
        <div class="planet-detail-row">Habitable Zone: ${gp.in_habitable_zone ? 'Yes' : 'No'}</div>
        <div class="planet-detail-row">Composition: ${esc(gp.composition_family || 'ÔÇö')}</div>
        <div class="planet-detail-row">Pressure: ${Number(gp.surface_pressure_bar || 0).toFixed(2)} bar</div>
        <div class="planet-detail-row">Water: ${esc(gp.water_state || 'ÔÇö')} ┬À Methane: ${esc(gp.methane_state || 'ÔÇö')}</div>
        <div class="planet-detail-row">Radiation: ${esc(gp.radiation_level || 'ÔÇö')} ┬À Habitability: ${Number(gp.habitability_score || 0).toFixed(1)}</div>`;
      return;
    }

    detail.innerHTML = `
      <h5>Planet #${pos}</h5>
      <div class="planet-detail-row">No planetary body in this slot.</div>`;
  }

  function focusPlanetDetailsInOverlay(root, planetLike, zoomPlanet, activateColony = false) {
    const panel = root.querySelector('#galaxy-planets-panel');
    if (!panel || !planetLike || !planetLike.__slot) return;
    toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
    setActivePlanetListItem(panel, planetLike.__slot.position);
    const detail = ensurePlanetDetailPanel(panel);
    renderPlanetDetailCard(detail, planetLike.__slot);
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
          renderPlanetDetailCard(detail, slot);
        });
      });
    }
  }

  const runtimeMessagesControllerApi = requireRuntimeApi('GQRuntimeMessagesController', ['createMessagesController']);
  const messagesController = runtimeMessagesControllerApi.createMessagesController({
    wm: WM,
    api: API,
    documentRef: document,
    renderInlineTemplate,
    renderInlineTemplateList,
    uiKitTemplateHTML,
    uiKitEmptyStateHTML,
    esc,
    gameLog,
    showToast,
    getAudioManager: () => audioManager,
    getMessageConsoleState: () => messageConsoleState,
    updateMessageSignalsFromInbox,
    runtimeCommandParsingApi,
    runtimeMessageConsoleCommandApi,
    playMessageSendRef,
  });
  window.GQMessagesController = messagesController;

  // ÔöÇÔöÇ Messages window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderMessages() {
    await messagesController.render();
  }

  const runtimeIntelControllerApi = requireRuntimeApi('GQRuntimeIntelController', ['createIntelController']);
  const intelController = runtimeIntelControllerApi.createIntelController({
    wm: WM,
    api: API,
    documentRef: document,
    uiKitSkeletonHTML,
    uiKitEmptyStateHTML,
    esc,
    fmt,
    fmtName,
    showToast,
    getCurrentColony: () => currentColony,
  });
  window.GQIntelController = intelController;

  // ÔöÇÔöÇ Intel window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderIntel() {
    await intelController.render();
  }

  // ÔöÇÔöÇ Trade Routes Controller ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  class TradeRoutesController {
    constructor() {
      this.routes = [];
    }

    async render() {
      const root = WM.body('trade-routes');
      if (!root) return;
      root.innerHTML = uiKitSkeletonHTML();

      let data;
      try {
        data = await API.tradeRoutes();
      } catch (err) {
        gameLog('warn', 'Trade routes laden fehlgeschlagen', err);
        root.innerHTML = '<p class="text-red">Failed to load trade routes.</p>';
        return;
      }
      this.routes = data.trade_routes || [];

      let html = '<div class="trade-routes-list">';

      if (this.routes.length === 0) {
        html += uiKitEmptyStateHTML('No trade routes yet', 'Create your first automated route between two colonies.');
      } else {
        html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px;">';
        for (const route of this.routes) {
          html += this.renderRouteCard(route);
        }
        html += '</div>';
      }

      html += '<div style="margin-top: 12px; padding: 8px; border-top: 1px solid #555;">';
      html += '<button id="btn-create-route" class="btn" style="width: 100%;">New Trade Route</button>';
      html += '</div>';
      html += '</div>';

      root.innerHTML = html;
      this.attachEventListeners();
    }

    renderRouteCard(route) {
      const routeId = route.id;
      const intervalHours = Number(route.interval_hours || 24);
      const isDue = !!route.is_due;
      const isActive = !!route.is_active;
      
      let nextExecProgressPct = isDue ? 100 : 0;
      let nextExecTone = 'is-good';
      let nextExecHtml = '';
      
      if (route.next_execution_at || route.last_execution_at) {
        const nextExecTime = route.next_execution_at ? new Date(route.next_execution_at).getTime() : null;
        const lastExecTime = route.last_execution_at ? new Date(route.last_execution_at).getTime() : null;
        const now = Date.now();
        
        if (nextExecTime) {
          const intervalMs = intervalHours * 3600000;
          const timeUntilNextMs = Math.max(0, nextExecTime - now);
          nextExecProgressPct = Math.min(100, Math.round((1 - (timeUntilNextMs / intervalMs)) * 100));
        } else if (lastExecTime) {
          const intervalMs = intervalHours * 3600000;
          const timeSinceLastMs = now - lastExecTime;
          nextExecProgressPct = Math.min(100, Math.round((timeSinceLastMs / intervalMs) * 100));
        }
        
        nextExecTone = nextExecProgressPct < 30 ? 'is-good' : (nextExecProgressPct < 70 ? 'is-warning' : 'is-critical');
        nextExecHtml = `<div class="entity-bars" style="margin-top:0.4rem;">
          <div class="entity-bar-row" title="Next execution in ${intervalHours - Math.floor(nextExecProgressPct / 100 * intervalHours)}h">
            <span class="entity-bar-label" style="font-size:0.75rem;">Next</span>
            <div class="bar-wrap"><div class="bar-fill bar-integrity ${nextExecTone}" style="width:${nextExecProgressPct}%"></div></div>
            <span class="entity-bar-value" style="font-size:0.75rem;">${nextExecProgressPct}%</span>
          </div>
        </div>`;
      }
      
      const html = `
        <div class="route-card" style="padding: 8px; border: 1px solid #777; border-radius: 4px; background: #1a1a1a;">
          <div style="font-weight: bold; margin-bottom: 4px;">
            ${esc(route.origin_name)} -> ${esc(route.target_name)}
          </div>
          <div style="font-size: 0.85em; color: #ccc; margin-bottom: 4px;">
            <span style="color: #ffa500;">${(route.cargo.metal || 0).toLocaleString()}</span> M
            <span style="color: #00ff00;">${(route.cargo.crystal || 0).toLocaleString()}</span> K
            <span style="color: #00ccff;">${(route.cargo.deuterium || 0).toLocaleString()}</span> D
          </div>
          <div style="font-size: 0.8em; color: #aaa; margin-bottom: 6px;">
            Interval: ${route.interval_hours}h
            ${route.is_due ? ' <span style="color: #f00;">[DUE NOW]</span>' : ''}
            ${!route.is_active ? ' <span style="color: #f80;">[PAUSED]</span>' : ''}
          </div>
          ${nextExecHtml}
          <div style="display: flex; gap: 4px; margin-top:6px;">
            <button data-toggle-route="${routeId}" class="btn" style="flex: 1; padding: 4px;">
              ${route.is_active ? 'Pause' : 'Resume'}
            </button>
            <button data-delete-route="${routeId}" class="btn" style="flex: 1; padding: 4px; color: #f55;">Delete</button>
          </div>
        </div>
      `;
      return html;
    }

    attachEventListeners() {
      document.getElementById('btn-create-route')?.addEventListener('click', () => this.showCreateDialog());

      document.querySelectorAll('[data-toggle-route]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const routeId = parseInt(e.target.dataset.toggleRoute);
          await API.toggleTradeRoute(routeId);
          _invalidateGetCache([/api\/trade\.php/i]);
          await this.render();
        });
      });

      document.querySelectorAll('[data-delete-route]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          if (!confirm('Delete this trade route?')) return;
          const routeId = parseInt(e.target.dataset.deleteRoute);
          await API.deleteTradeRoute(routeId);
          _invalidateGetCache([/api\/trade\.php/i]);
          await this.render();
        });
      });
    }

    showCreateDialog(options = {}) {
      const config = getResourceInsightConfig(options.resourceKey);
      const focusedCargo = { metal: 0, crystal: 0, deuterium: 0 };
      if (config?.tradeable) {
        focusedCargo[config.key] = getSuggestedTradeAmount(config.key, 'offer');
      }
      const dialog = document.createElement('div');
      dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #222; border: 2px solid #777; border-radius: 4px; padding: 16px; z-index: 10000; width: 90%; max-width: 400px;';
      dialog.innerHTML = `
        <h3 style="margin-top: 0;">Create Trade Route</h3>
        <p style="color: #aaa; font-size: 0.9em;">${config ? `${esc(config.icon)} ${esc(config.label)} fokussiert. ` : ''}Routen starten echte Frachter, binden Fracht an Flugzeit und verbrauchen Deuterium fuer den Transport.</p>
        <p style="color: #aaa; font-size: 0.85em;">This feature requires clicking on colonies to select. You can also use the command line API:</p>
        <code style="display: block; background: #1a1a1a; padding: 8px; border-radius: 2px; margin: 8px 0; font-size: 0.8em; word-break: break-all;">
          await API.createTradeRoute({ origin_colony_id: ${Number(currentColony?.id || 1)}, target_colony_id: 2, cargo_metal: ${Math.round(focusedCargo.metal || 1000)}, cargo_crystal: ${Math.round(focusedCargo.crystal || 500)}, cargo_deuterium: ${Math.round(focusedCargo.deuterium || 100)}, interval_hours: 24 })
        </code>
        <button class="btn" onclick="this.closest('div').remove();" style="width: 100%;">Close</button>
      `;
      document.body.appendChild(dialog);
    }
  }

  const tradeRoutesController = new TradeRoutesController();
  window.GQTradeRoutesController = tradeRoutesController;

  async function renderTradeRoutes() {
    await tradeRoutesController.render();
  }

  // ÔöÇÔöÇ Alliances Controller ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  const runtimeAlliancesControllerApi = requireRuntimeApi('GQRuntimeAlliancesController', ['createAlliancesController']);
  const alliancesController = runtimeAlliancesControllerApi.createAlliancesController({
    wm: WM,
    api: API,
    documentRef: document,
    uiKitSkeletonHTML,
    uiKitEmptyStateHTML,
    esc,
    fmt,
    showToast,
    invalidateGetCache: _invalidateGetCache,
  });
  window.GQAlliancesController = alliancesController;

  async function renderAlliances() {
    await alliancesController.render();
  }

  // ÔöÇÔöÇ Trade Proposals Controller ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const runtimeTradeProposalsControllerApi = requireRuntimeApi('GQRuntimeTradeProposalsController', ['createTradeProposalsController']);
  const tradeProposalsController = runtimeTradeProposalsControllerApi.createTradeProposalsController({
    wm: WM,
    api: API,
    documentRef: document,
    esc,
    showToast,
    getAudioManager: () => audioManager,
    onLoadOverview: loadOverview,
    getResourceInsightConfig,
    getSuggestedTradeAmount,
  });
  window.GQTradeProposalsController = tradeProposalsController;
async function renderTradeProposals() {
    await tradeProposalsController.render();
  }

  const runtimeLeadersControllerApi = requireRuntimeApi('GQRuntimeLeadersController', ['createLeadersController']);
  const leadersController = runtimeLeadersControllerApi.createLeadersController({
    wm: WM,
    api: API,
    documentRef: document,
    esc,
    showToast,
    getColonies: () => colonies,
    getAdvisorWidget: () => AdvisorWidget,
  });
  window.GQLeadersController = leadersController;

  // ÔöÇÔöÇ Advisor Widget ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const AdvisorWidget = (() => {
    let _advisor = null;
    let _hints   = [];

    function _init() {
      const widget = document.createElement('div');
      widget.id = 'advisor-widget';
      widget.style.display = 'none';
      widget.innerHTML = `<div id="advisor-bubble" title="Advisor ÔÇö click for hints">
        <span id="advisor-bubble-portrait">­ƒºÖ</span>
        <div id="advisor-bubble-info">
          <span id="advisor-bubble-name">Advisor</span>
          <span id="advisor-bubble-badge"></span>
        </div>
      </div>`;
      document.body.appendChild(widget);
      widget.querySelector('#advisor-bubble').addEventListener('click', () => {
        WM.open('advisor-hints');
      });
    }

    function _renderHintsWindow() {
      const root = WM.body('advisor-hints');
      if (!root) return;
      leadersController._injectCardStyles();
      if (!_advisor) {
        root.innerHTML = '<p class="text-muted">No advisor assigned. Hire an Advisor from the Leaders Marketplace.</p>';
        return;
      }
      if (_hints.length === 0) {
        root.innerHTML = `
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
            <span style="font-size:2rem">${esc(_advisor.portrait || '­ƒºÖ')}</span>
            <div><strong>${esc(_advisor.name)}</strong>
              <div style="font-size:0.75rem;color:var(--text-secondary)">${esc(_advisor.tagline || '')}</div></div>
          </div>
          <p class="text-muted">Ô£à No active hints. Check back soon.</p>
          <button class="btn btn-secondary btn-sm" id="advisor-refresh-btn" style="margin-top:0.5rem">­ƒöä Re-scan</button>`;
      } else {
        root.innerHTML = `
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
            <span style="font-size:2rem">${esc(_advisor.portrait || '­ƒºÖ')}</span>
            <div><strong>${esc(_advisor.name)}</strong>
              <div style="font-size:0.75rem;color:var(--text-secondary)">${esc(_advisor.tagline || '')}</div></div>
          </div>
          <div id="hints-list">
            ${_hints.map((h) => `
              <div class="advisor-hint-card hint-${h.hint_type}" data-hid="${h.id}">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                  <div class="advisor-hint-title">${esc(h.title)}</div>
                  <button class="btn btn-secondary btn-sm dismiss-hint-btn" data-hid="${h.id}" style="padding:0 5px;font-size:0.7rem;margin-left:0.5rem">Ô£ò</button>
                </div>
                <div class="advisor-hint-body">${esc(h.body)}</div>
                ${h.action_label && h.action_window ? `
                  <button class="btn btn-primary btn-sm hint-action-btn" data-window="${h.action_window}" style="margin-top:0.4rem;font-size:0.75rem">
                    ${esc(h.action_label)}
                  </button>` : ''}
              </div>`).join('')}
          </div>
          <button class="btn btn-secondary btn-sm" id="advisor-refresh-btn" style="margin-top:0.5rem">­ƒöä Re-scan</button>`;
      }

      root.querySelector('#advisor-refresh-btn')?.addEventListener('click', async () => {
        const res = await API.advisorTick();
        if (res.success) {
          _hints   = res.hints   || [];
          _advisor = res.advisor || _advisor;
          _update();
          _renderHintsWindow();
        }
      });

      root.querySelectorAll('.dismiss-hint-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const hid = parseInt(btn.dataset.hid, 10);
          await API.dismissHint(hid);
          _hints = _hints.filter((h) => +h.id !== hid);
          _update();
          _renderHintsWindow();
        });
      });

      root.querySelectorAll('.hint-action-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          WM.open(btn.dataset.window);
        });
      });
    }

    function _update() {
      const widget = document.getElementById('advisor-widget');
      if (!widget) return;
      if (!_advisor) { widget.style.display = 'none'; return; }
      widget.style.display = '';
      const portraitEl = document.getElementById('advisor-bubble-portrait');
      if (portraitEl) portraitEl.textContent = _advisor.portrait || '­ƒºÖ';
      const nameEl = document.getElementById('advisor-bubble-name');
      if (nameEl) nameEl.textContent = _advisor.name || 'Advisor';
      const badge = document.getElementById('advisor-bubble-badge');
      if (!badge) return;
      if (_hints.length > 0) {
        badge.textContent = `${_hints.length} hint${_hints.length > 1 ? 's' : ''}`;
        badge.style.color = _hints.some((h) => h.hint_type === 'warning' || h.hint_type === 'action_required') ? '#f59e0b' : 'var(--accent,#4a9eff)';
      } else {
        badge.textContent = 'All clear Ô£ô';
        badge.style.color = '#4ade80';
      }
      // Refresh the hints window if open
      if (WM.body('advisor-hints')) _renderHintsWindow();
    }

    async function load() {
      try {
        const res = await API.advisorHints();
        if (res.success) {
          _advisor = res.advisor;
          _hints   = res.hints || [];
          _update();
        }
      } catch (_) { /* non-critical */ }
    }

    async function maybeRefresh() {
      // Called after hiring/dismissing a leader
      setTimeout(load, 800);
    }

    function register() {
      _init();
      WM.register('advisor-hints', {
        title: '­ƒºÖ Advisor',
        w: 420,
        h: 520,
        defaultDock: 'right',
        defaultY: 44,
        onRender: _renderHintsWindow,
      });
    }

    return { load, maybeRefresh, register };
  })();

  // ÔöÇÔöÇ Leaderboard window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderLeaders() {
    await leadersController.render();
  }

  const runtimeFactionsControllerApi = requireRuntimeApi('GQRuntimeFactionsController', ['createFactionsController']);
  const factionsController = runtimeFactionsControllerApi.createFactionsController({
    wm: WM,
    api: API,
    showToast,
    esc,
    uiKitSkeletonHTML,
    uiKitEmptyStateHTML,
    onLoadOverview: loadOverview,
    getCurrentColony: () => currentColony,
    windowRef: window,
  });
  window.GQFactionsController = factionsController;

  async function renderFactions() {
    await factionsController.render();
  }

  const runtimeLeaderboardControllerApi = requireRuntimeApi('GQRuntimeLeaderboardController', ['createLeaderboardController']);
  const leaderboardController = runtimeLeaderboardControllerApi.createLeaderboardController({
    wm: WM,
    api: API,
    esc,
    fmt,
    uiKitSkeletonHTML,
    uiKitEmptyStateHTML,
    gameLog,
    getCurrentUser: () => currentUser,
  });
  window.GQLeaderboardController = leaderboardController;

  async function renderLeaderboard() {
    await leaderboardController.render();
  }

  // ÔöÇÔöÇ Minimap ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const MINIMAP_PAD = 14;           // canvas padding in px
  const MINIMAP_GRID_DIVS = 5;     // number of grid lines per axis
  const MINIMAP_CLICK_RADIUS = 18; // max click distance in px to select a star
  const MINIMAP_DRAG_THRESHOLD = 4;
  const MINIMAP_WORLD_SCALE = 0.028;

  function minimapProjectPoint(state, x, y) {
    return {
      x: state.offX + (Number(x || 0) - state.minX) * state.scale,
      y: state.offY + (Number(y || 0) - state.minY) * state.scale,
    };
  }

  function minimapClampCanvasPoint(state, point) {
    const pad = MINIMAP_PAD + 2;
    return {
      x: Math.max(pad, Math.min((state.width || 0) - pad, Number(point?.x || 0))),
      y: Math.max(pad, Math.min((state.height || 0) - pad, Number(point?.y || 0))),
    };
  }

  function minimapUnprojectPoint(state, px, py) {
    const x = state.minX + ((Number(px || 0) - state.offX) / Math.max(0.0001, state.scale));
    const y = state.minY + ((Number(py || 0) - state.offY) / Math.max(0.0001, state.scale));
    return {
      x: Math.max(state.minX, Math.min(state.maxX, x)),
      y: Math.max(state.minY, Math.min(state.maxY, y)),
    };
  }

  function resolveMinimapRendererPose() {
    const renderer = galaxy3d;
    if (!renderer) {
      return {
        kind: 'virtual',
        backend: 'offline',
        scale: MINIMAP_WORLD_SCALE,
        zoom: minimapCamera.zoom,
        cameraX: minimapCamera.cameraX,
        cameraY: minimapCamera.cameraY,
        targetX: minimapCamera.targetX,
        targetY: minimapCamera.targetY,
      };
    }

    const delegate = renderer._delegate || null;
    const base = delegate || renderer;
    const scale = Number(base?._starScale || renderer?._starScale || MINIMAP_WORLD_SCALE) || MINIMAP_WORLD_SCALE;

    if (base?.camera?.position && base?.controls?.target) {
      return {
        kind: 'orbit',
        backend: String(renderer.backendType || base.rendererBackend || 'threejs'),
        scale,
        zoom: Number(renderer?._view?.zoom || renderer?._view?.targetZoom || 1) || 1,
        cameraX: Number(base.camera.position.x || 0) / scale,
        cameraY: Number(base.camera.position.z || 0) / scale,
        targetX: Number(base.controls.target.x || 0) / scale,
        targetY: Number(base.controls.target.z || 0) / scale,
      };
    }

    if (renderer?._view) {
      const zoom = Number(renderer._view.zoom || renderer._view.targetZoom || 1) || 1;
      const targetX = -(Number(renderer._view.targetPanX ?? renderer._view.panX ?? 0) / scale);
      const targetY = -(Number(renderer._view.targetPanY ?? renderer._view.panY ?? 0) / scale);
      const distanceLy = Math.max(55, Math.min(240, 118 / Math.max(0.45, zoom)));
      return {
        kind: 'panzoom',
        backend: String(renderer.backendType || 'webgpu'),
        scale,
        zoom,
        cameraX: targetX + distanceLy * 0.58,
        cameraY: targetY + distanceLy * 0.92,
        targetX,
        targetY,
      };
    }

    // No live renderer — return the virtual camera state so overlays and smoke
    // tests always have a readable, mutable pose object.
    return {
      kind: 'virtual',
      backend: 'offline',
      scale: MINIMAP_WORLD_SCALE,
      zoom: minimapCamera.zoom,
      cameraX: minimapCamera.cameraX,
      cameraY: minimapCamera.cameraY,
      targetX: minimapCamera.targetX,
      targetY: minimapCamera.targetY,
    };
  }

  function setMinimapCameraTarget(targetX, targetY, immediate = false) {
    // Always keep virtual camera in sync so the minimap overlay works even
    // without a live renderer (e.g. headless CI or planet/system view mode).
    const tx = Number(targetX || 0);
    const ty = Number(targetY || 0);
    minimapCamera.targetX = tx;
    minimapCamera.targetY = ty;
    // Approximate camera eye offset (distanceLy ≈ 118 at zoom 1).
    minimapCamera.cameraX = tx + 68;
    minimapCamera.cameraY = ty + 109;

    const renderer = galaxy3d;
    if (!renderer) return false;

    const delegate = renderer._delegate || null;
    const base = delegate || renderer;
    const scale = Number(base?._starScale || renderer?._starScale || MINIMAP_WORLD_SCALE) || MINIMAP_WORLD_SCALE;

    if (base?.camera?.position && base?.controls?.target) {
      const nextX = Number(targetX || 0) * scale;
      const nextZ = Number(targetY || 0) * scale;
      const deltaX = nextX - Number(base.controls.target.x || 0);
      const deltaZ = nextZ - Number(base.controls.target.z || 0);
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaZ)) return false;
      base.controls.target.x += deltaX;
      base.controls.target.z += deltaZ;
      base.camera.position.x += deltaX;
      base.camera.position.z += deltaZ;
      if (immediate && typeof base.controls.update === 'function') {
        try { base.controls.update(); } catch (_) {}
      }
      return true;
    }

    if (renderer?._view) {
      const nextPanX = -Number(targetX || 0) * scale;
      const nextPanY = -Number(targetY || 0) * scale;
      renderer._view.targetPanX = nextPanX;
      renderer._view.targetPanY = nextPanY;
      if (immediate) {
        renderer._view.panX = nextPanX;
        renderer._view.panY = nextPanY;
      }
      return true;
    }

    return false;
  }

  function zoomMinimapCamera(deltaY) {
    // Always update virtual zoom so the smoke-test pose is readable even when
    // the live renderer is absent.
    const zoomOut = Number(deltaY || 0) > 0;
    const vz = Number(minimapCamera.zoom || 1) || 1;
    minimapCamera.zoom = zoomOut ? Math.max(0.25, vz * 0.88) : Math.min(8, vz * 1.12);

    const renderer = galaxy3d;
    if (!renderer) return false;

    const delegate = renderer._delegate || null;
    const base = delegate || renderer;

    if (base?.camera?.position && base?.controls?.target) {
      const factor = zoomOut ? 1.12 : 0.88;
      const offset = base.camera.position.clone().sub(base.controls.target).multiplyScalar(factor);
      base.camera.position.copy(base.controls.target.clone().add(offset));
      if (typeof base.controls.update === 'function') {
        try { base.controls.update(); } catch (_) {}
      }
      return true;
    }

    if (renderer?._view) {
      const currentZoom = Number(renderer._view.targetZoom || renderer._view.zoom || 1) || 1;
      const nextZoom = zoomOut
        ? Math.max(0.45, currentZoom * 0.88)
        : Math.min(6, currentZoom * 1.12);
      renderer._view.targetZoom = nextZoom;
      return true;
    }

    return false;
  }

  function queueMinimapCameraTarget(targetX, targetY, immediate = false) {
    WM.open('galaxy');
    if (setMinimapCameraTarget(targetX, targetY, immediate)) return;
    setTimeout(() => { setMinimapCameraTarget(targetX, targetY, immediate); }, 120);
    setTimeout(() => { setMinimapCameraTarget(targetX, targetY, immediate); }, 360);
  }

  function drawMinimapCameraOverlay(ctx, state, pose) {
    if (!ctx || !state || !pose) return;

    const rawApex = minimapProjectPoint(state, pose.cameraX, pose.cameraY);
    const rawTarget = minimapProjectPoint(state, pose.targetX, pose.targetY);
    const apex = minimapClampCanvasPoint(state, rawApex);
    const target = minimapClampCanvasPoint(state, rawTarget);

    const dirXRaw = target.x - apex.x;
    const dirYRaw = target.y - apex.y;
    const dirLen = Math.hypot(dirXRaw, dirYRaw) || 1;
    const dirX = dirXRaw / dirLen;
    const dirY = dirYRaw / dirLen;
    const perpX = -dirY;
    const perpY = dirX;
    const zoom = Math.max(0.45, Number(pose.zoom || 1));
    const fovFactor = Math.max(0.52, Math.min(1.45, 1.35 / zoom));
    const nearDist = Math.max(10, dirLen * 0.22);
    const farDist = Math.max(22, dirLen * 0.86);
    const nearHalf = Math.max(6, farDist * 0.12 * fovFactor);
    const farHalf = Math.max(12, farDist * 0.23 * fovFactor);

    const nearCenter = { x: apex.x + dirX * nearDist, y: apex.y + dirY * nearDist };
    const farCenter = { x: apex.x + dirX * farDist, y: apex.y + dirY * farDist };
    const nearLeft = { x: nearCenter.x - perpX * nearHalf, y: nearCenter.y - perpY * nearHalf };
    const nearRight = { x: nearCenter.x + perpX * nearHalf, y: nearCenter.y + perpY * nearHalf };
    const farLeft = { x: farCenter.x - perpX * farHalf, y: farCenter.y - perpY * farHalf };
    const farRight = { x: farCenter.x + perpX * farHalf, y: farCenter.y + perpY * farHalf };

    ctx.save();
    ctx.shadowColor = 'rgba(79, 222, 255, 0.45)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(35, 157, 214, 0.12)';
    ctx.beginPath();
    ctx.moveTo(apex.x, apex.y);
    ctx.lineTo(farLeft.x, farLeft.y);
    ctx.lineTo(farRight.x, farRight.y);
    ctx.closePath();
    ctx.fill();

    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(110, 229, 255, 0.9)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(apex.x, apex.y);
    ctx.lineTo(nearLeft.x, nearLeft.y);
    ctx.lineTo(farLeft.x, farLeft.y);
    ctx.lineTo(farRight.x, farRight.y);
    ctx.lineTo(nearRight.x, nearRight.y);
    ctx.closePath();
    ctx.moveTo(apex.x, apex.y);
    ctx.lineTo(farLeft.x, farLeft.y);
    ctx.moveTo(apex.x, apex.y);
    ctx.lineTo(farRight.x, farRight.y);
    ctx.moveTo(nearLeft.x, nearLeft.y);
    ctx.lineTo(nearRight.x, nearRight.y);
    ctx.moveTo(nearCenter.x, nearCenter.y);
    ctx.lineTo(farCenter.x, farCenter.y);
    ctx.stroke();

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(147, 219, 255, 0.55)';
    ctx.beginPath();
    ctx.moveTo(apex.x, apex.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(148, 235, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(apex.x, apex.y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(148, 235, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 4.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawMinimap(root, wrap, canvas, hud) {
    if (!root || !wrap || !canvas) return;

    const w = Math.max(100, wrap.clientWidth || 260);
    const h = Math.max(100, wrap.clientHeight || 260);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#050d1e';
    ctx.fillRect(0, 0, w, h);

    const stars = Array.isArray(galaxyStars) ? galaxyStars.filter((s) => s.x_ly != null && s.y_ly != null) : [];

    if (!stars.length) {
      if (hud) hud.dataset.backend = 'offline';
      ctx.fillStyle = 'rgba(80, 140, 200, 0.6)';
      ctx.font = '11px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Galaxy data loadingÔÇª', w / 2, h / 2);
      canvas.__minimapState = null;
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of stars) {
      const sx = Number(s.x_ly);
      const sy = Number(s.y_ly);
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }

    const rangeX = (maxX - minX) || 1;
    const rangeY = (maxY - minY) || 1;
    const scaleX = (w - MINIMAP_PAD * 2) / rangeX;
    const scaleY = (h - MINIMAP_PAD * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);
    const offX = MINIMAP_PAD + ((w - MINIMAP_PAD * 2) - rangeX * scale) / 2;
    const offY = MINIMAP_PAD + ((h - MINIMAP_PAD * 2) - rangeY * scale) / 2;
    const pose = resolveMinimapRendererPose();

    canvas.__minimapState = {
      minX,
      minY,
      maxX,
      maxY,
      scale,
      offX,
      offY,
      width: w,
      height: h,
      stars,
      pose,
    };

    if (hud) {
      hud.dataset.backend = pose?.backend || 'offline';
      const badge = hud.querySelector('.minimap-badge');
      const meta = hud.querySelector('.minimap-meta');
      if (badge) badge.textContent = pose ? `LIVE ${String(pose.backend || '').toUpperCase()}` : 'STATIC';
      if (meta) meta.textContent = pose ? 'Ziehen bewegt die Kamera' : 'Klick springt zum System';
    }

    ctx.strokeStyle = 'rgba(50, 90, 150, 0.22)';
    ctx.lineWidth = 0.5;
    const gridStepLy = Math.max(1, Math.round(rangeX / MINIMAP_GRID_DIVS));
    for (let gx = Math.ceil(minX / gridStepLy) * gridStepLy; gx <= maxX; gx += gridStepLy) {
      const cx = offX + (gx - minX) * scale;
      ctx.beginPath();
      ctx.moveTo(cx, MINIMAP_PAD);
      ctx.lineTo(cx, h - MINIMAP_PAD);
      ctx.stroke();
    }
    for (let gy = Math.ceil(minY / gridStepLy) * gridStepLy; gy <= maxY; gy += gridStepLy) {
      const cy = offY + (gy - minY) * scale;
      ctx.beginPath();
      ctx.moveTo(MINIMAP_PAD, cy);
      ctx.lineTo(w - MINIMAP_PAD, cy);
      ctx.stroke();
    }

    const ownColonySystems = new Set(
      (Array.isArray(colonies) ? colonies : []).map((col) => Number(col.system || col.system_index || 0)).filter(Boolean)
    );
    const currentSysIdx = Number(currentColony?.system || currentColony?.system_index || 0);
    const activeSysIdx = Number(uiState.activeStar?.system_index || pinnedStar?.system_index || 0);

    for (const star of stars) {
      const sx = Number(star.x_ly);
      const sy = Number(star.y_ly);
      const point = minimapProjectPoint(canvas.__minimapState, sx, sy);
      const cx = point.x;
      const cy = point.y;
      const sysIdx = Number(star.system_index || 0);
      const isOwn = sysIdx > 0 && ownColonySystems.has(sysIdx);
      const isCurrent = currentSysIdx > 0 && sysIdx === currentSysIdx;
      const isActive = activeSysIdx > 0 && sysIdx === activeSysIdx;

      if (isCurrent) {
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffe066';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 224, 102, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (isActive) {
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#5de4ff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(93, 228, 255, 0.55)';
        ctx.lineWidth = 1.25;
        ctx.stroke();
      } else if (isOwn) {
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#44ee88';
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, 1, 0, Math.PI * 2);
        ctx.fillStyle = starClassColor(star.spectral_class);
        ctx.fill();
      }
    }

    drawMinimapCameraOverlay(ctx, canvas.__minimapState, pose);

    ctx.font = '9px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(100, 160, 220, 0.6)';
    ctx.fillText(`${stars.length} stars`, 5, h - 5);
  }

  function bindMinimapInteractions(root, canvas) {
    if (!canvas || canvas.__minimapInteractiveBound) return;
    canvas.__minimapInteractiveBound = true;

    const dragState = {
      active: false,
      moved: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      baseTargetX: 0,
      baseTargetY: 0,
    };
    canvas.__minimapDragState = dragState;

    const getPointerPos = (evt) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top,
      };
    };

    const finishDrag = (evt) => {
      if (!dragState.active) return;
      if (evt?.pointerId != null && dragState.pointerId !== evt.pointerId) return;
      if (dragState.pointerId != null) {
        try { canvas.releasePointerCapture(dragState.pointerId); } catch (_) {}
      }
      canvas.classList.remove('is-dragging');
      dragState.active = false;
      dragState.pointerId = null;
    };

    canvas.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0) return;
      const state = canvas.__minimapState;
      if (!state) return;
      const pose = resolveMinimapRendererPose();
      const pointer = getPointerPos(evt);
      const fallbackWorld = minimapUnprojectPoint(state, pointer.x, pointer.y);
      dragState.active = true;
      dragState.moved = false;
      dragState.pointerId = evt.pointerId;
      dragState.startX = pointer.x;
      dragState.startY = pointer.y;
      dragState.baseTargetX = Number(pose?.targetX ?? fallbackWorld.x ?? 0);
      dragState.baseTargetY = Number(pose?.targetY ?? fallbackWorld.y ?? 0);
      canvas.classList.add('is-dragging');
      try { canvas.setPointerCapture(evt.pointerId); } catch (_) {}
      evt.preventDefault();
    });

    canvas.addEventListener('pointermove', (evt) => {
      const state = canvas.__minimapState;
      if (!state || !dragState.active || dragState.pointerId !== evt.pointerId) return;
      const pointer = getPointerPos(evt);
      const dx = pointer.x - dragState.startX;
      const dy = pointer.y - dragState.startY;
      if (!dragState.moved && Math.hypot(dx, dy) >= MINIMAP_DRAG_THRESHOLD) {
        dragState.moved = true;
      }
      if (!dragState.moved) return;
      const nextX = Math.max(state.minX, Math.min(state.maxX, dragState.baseTargetX + dx / Math.max(0.0001, state.scale)));
      const nextY = Math.max(state.minY, Math.min(state.maxY, dragState.baseTargetY + dy / Math.max(0.0001, state.scale)));
      setMinimapCameraTarget(nextX, nextY, true);
    });

    canvas.addEventListener('pointerup', (evt) => {
      const state = canvas.__minimapState;
      if (!state) {
        finishDrag(evt);
        return;
      }

      const wasDrag = dragState.active && dragState.moved && dragState.pointerId === evt.pointerId;
      const pointer = getPointerPos(evt);
      finishDrag(evt);
      if (wasDrag) return;

      let best = null;
      let bestDist = Infinity;
      for (const star of state.stars) {
        const point = minimapProjectPoint(state, star.x_ly, star.y_ly);
        const dist = Math.hypot(pointer.x - point.x, pointer.y - point.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = star;
        }
      }

      if (best && bestDist < MINIMAP_CLICK_RADIUS) {
        WM.open('galaxy');
        window.dispatchEvent(new CustomEvent('gq:minimap-navigate', {
          detail: { galaxy: Number(best.galaxy_index || uiState.activeGalaxy || 1), system: Number(best.system_index || 0), star: best },
        }));
        return;
      }

      const world = minimapUnprojectPoint(state, pointer.x, pointer.y);
      queueMinimapCameraTarget(world.x, world.y, true);
    });

    canvas.addEventListener('pointercancel', finishDrag);
    canvas.addEventListener('wheel', (evt) => {
      evt.preventDefault();
      zoomMinimapCamera(evt.deltaY);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (evt) => evt.preventDefault());
  }

  function ensureMinimapLoop(root, wrap, canvas, hud) {
    if (!canvas || canvas.__minimapLoopActive) return;
    canvas.__minimapLoopActive = true;

    const tick = () => {
      if (!canvas.__minimapLoopActive) return;
      if (!root?.isConnected || !WM.isOpen('minimap')) {
        canvas.__minimapLoopActive = false;
        canvas.__minimapRaf = 0;
        return;
      }
      drawMinimap(root, wrap, canvas, hud);
      canvas.__minimapRaf = requestAnimationFrame(tick);
    };

    canvas.__minimapRaf = requestAnimationFrame(tick);
  }

  function renderMinimap(root) {
    if (!root) return;

    // Seed virtualcamera from active/pinned star the first time the minimap opens.
    if (minimapCamera.targetX === 0 && minimapCamera.targetY === 0) {
      const seedStar = uiState.activeStar || pinnedStar;
      if (seedStar) {
        minimapCamera.targetX = Number(seedStar.x_ly || 0);
        minimapCamera.targetY = Number(seedStar.y_ly || 0);
        minimapCamera.cameraX = minimapCamera.targetX + 68;
        minimapCamera.cameraY = minimapCamera.targetY + 109;
        minimapCamera.zoom = 1;
      }
    }

    let wrap = root.querySelector('.minimap-wrap');
    if (!wrap) {
      root.innerHTML = '';
      wrap = document.createElement('div');
      wrap.className = 'minimap-wrap';
      root.appendChild(wrap);
    }

    let canvas = wrap.querySelector('.minimap-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'minimap-canvas';
      wrap.appendChild(canvas);
    }

    let hud = wrap.querySelector('.minimap-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.className = 'minimap-hud';
      hud.innerHTML = '<span class="minimap-badge">LIVE</span><span class="minimap-meta">Ziehen bewegt die Kamera</span><span class="minimap-hint">Klick fokussiert Systeme, Mausrad zoomt</span>';
      wrap.appendChild(hud);
    }

    bindMinimapInteractions(root, canvas);
    drawMinimap(root, wrap, canvas, hud);
    ensureMinimapLoop(root, wrap, canvas, hud);
  }

  // Handle minimap click-to-navigate: open galaxy map and fly to the selected star.
  // Guard against duplicate bindings if the module is ever re-evaluated.
  if (!window.__gqMinimapNavBound) {
    window.__gqMinimapNavBound = true;
    window.addEventListener('gq:minimap-navigate', (ev) => {
      const { galaxy: g, system: s, star } = ev.detail || {};
      if (!g || !s) return;
      const root = WM.body('galaxy');
      if (!root) return;
      const target = (Array.isArray(galaxyStars) ? galaxyStars : []).find(
        (row) => Number(row.galaxy_index || 0) === g && Number(row.system_index || 0) === s
      ) || Object.assign({}, star, { galaxy_index: g, system_index: s });
      if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') {
        galaxy3d.focusOnStar(target, true);
      }
      pinnedStar = target;
      uiState.activeStar = target;
      renderGalaxySystemDetails(root, target, isSystemModeActive());
    });
  }

  function renderSettings() {
    const root = WM.body('settings');
    if (!root) return;
    const audioState = audioManager ? audioManager.snapshot() : settingsState;
    settingsState.sfxMap = Object.assign({}, settingsState.sfxMap || {}, audioState.sfxMap || {});
    const musicTrackOptions = audioTrackOptions
      .map((entry) => `<option value="${esc(entry.value)}">${esc(entry.label)}</option>`)
      .join('');
    const sfxOptionMarkup = AUDIO_SFX_OPTIONS
      .map((entry) => `<option value="${esc(entry.value)}">${esc(entry.label)}</option>`)
      .join('');
    const sfxRows = AUDIO_SFX_EVENTS.map((item) => {
      const value = String(audioState.sfxMap?.[item.key] || settingsState.sfxMap?.[item.key] || '');
      return `
        <div class="system-row" style="display:grid;grid-template-columns:minmax(120px, 160px) 1fr auto;gap:0.5rem;align-items:center;">
          <span>${esc(item.label)}</span>
          <select class="set-sfx-select" data-sfx-key="${esc(item.key)}">
            ${sfxOptionMarkup.replace(`value="${esc(value)}"`, `value="${esc(value)}" selected`)}
          </select>
          <button class="btn btn-secondary btn-sm set-sfx-test" type="button" data-sfx-test="${esc(item.tester)}">Test</button>
        </div>`;
    }).join('');

    root.innerHTML = `
      <div class="system-card">
        <h3 style="margin-top:0">Einstellungen</h3>
        <div class="system-row"><strong>Navigation & Transition</strong></div>
        <label class="system-row">Transition-Preset</label>
        <select id="set-transition-preset">
          <option value="smooth" ${settingsState.transitionPreset === 'smooth' ? 'selected' : ''}>Smooth</option>
          <option value="balanced" ${settingsState.transitionPreset === 'balanced' ? 'selected' : ''}>Balanced</option>
          <option value="snappy" ${settingsState.transitionPreset === 'snappy' ? 'selected' : ''}>Snappy</option>
        </select>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-auto-transitions" ${settingsState.autoTransitions ? 'checked' : ''} />
          Auto-Transitions aktivieren
        </label>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-galaxy-fleet-vectors" ${settingsState.galaxyFleetVectorsVisible !== false ? 'checked' : ''} />
          Galaxy: Fleet-Marker und Fluglinien anzeigen
        </label>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-home-enter-system" ${settingsState.homeEnterSystem ? 'checked' : ''} />
          Home-Navigation ├Âffnet direkt Systemansicht
        </label>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-system-legacy-fallback" ${settingsState.systemViewLegacyFallback === true ? 'checked' : ''} />
          System Legacy Fallback (direkte enter/exitSystemView-Calls erlauben)
        </label>
        <label class="system-row">Persistente Hover-Distanz: <span id="set-hover-distance-value">${Math.round(settingsState.persistentHoverDistance)}</span></label>
        <input id="set-hover-distance" type="range" min="120" max="380" step="5" value="${Math.round(settingsState.persistentHoverDistance)}" />
        <label class="system-row">Transition-Ruhezeit (ms): <span id="set-transition-ms-value">${Math.round(settingsState.transitionStableMinMs)}</span></label>
        <input id="set-transition-ms" type="range" min="80" max="360" step="10" value="${Math.round(settingsState.transitionStableMinMs)}" />

        <div class="system-row" style="margin-top:0.9rem;"><strong>Audio</strong></div>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-master-mute" ${audioState.masterMuted ? 'checked' : ''} />
          Ton aus
        </label>
        <label class="system-row">Master: <span id="set-master-vol-value">${Math.round((audioState.masterVolume || 0) * 100)}</span>%</label>
        <input id="set-master-vol" type="range" min="0" max="100" step="1" value="${Math.round((audioState.masterVolume || 0) * 100)}" />

        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-music-mute" ${audioState.musicMuted ? 'checked' : ''} />
          Musik stumm
        </label>
        <label class="system-row">Musik: <span id="set-music-vol-value">${Math.round((audioState.musicVolume || 0) * 100)}</span>%</label>
        <input id="set-music-vol" type="range" min="0" max="100" step="1" value="${Math.round((audioState.musicVolume || 0) * 100)}" />

        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-sfx-mute" ${audioState.sfxMuted ? 'checked' : ''} />
          SFX stumm
        </label>
        <label class="system-row">SFX: <span id="set-sfx-vol-value">${Math.round((audioState.sfxVolume || 0) * 100)}</span>%</label>
        <input id="set-sfx-vol" type="range" min="0" max="100" step="1" value="${Math.round((audioState.sfxVolume || 0) * 100)}" />
        <div class="system-row" style="font-size:0.8rem;color:var(--text-muted)">Letztes Audio-Event: <span id="set-last-audio-event">${esc(formatLastAudioEvent(audioState.lastAudioEvent || null))}</span></div>

        <label class="system-row" style="margin-top:0.75rem;">Musik-URL (optional)</label>
        <input id="set-music-url" type="text" placeholder="music/Nebula_Overture.mp3" value="${esc(audioState.musicUrl || '')}" />
        <label class="system-row">Track-Transition</label>
        <select id="set-music-transition-mode">
          <option value="fade" ${String(audioState.musicTransitionMode || settingsState.musicTransitionMode || 'fade') === 'fade' ? 'selected' : ''}>Fade (nahtlos)</option>
          <option value="cut" ${String(audioState.musicTransitionMode || settingsState.musicTransitionMode || 'fade') === 'cut' ? 'selected' : ''}>Cut (sofort)</option>
        </select>
        <div class="system-row" style="margin-top:0.6rem;"><strong>Mini-Player</strong></div>
        <div class="system-row" style="display:grid;grid-template-columns:1fr auto auto auto;gap:0.4rem;align-items:center;">
          <select id="set-player-track">${musicTrackOptions}</select>
          <button id="set-player-prev" class="btn btn-secondary btn-sm" type="button">ÔùÇ</button>
          <button id="set-player-toggle" class="btn btn-primary btn-sm" type="button">Play</button>
          <button id="set-player-next" class="btn btn-secondary btn-sm" type="button">ÔûÂ</button>
        </div>
        <label class="system-row">Lokale Musik-Vorlage</label>
        <select id="set-music-preset">
          <option value="">Keine Vorlage</option>
          ${musicTrackOptions}
        </select>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;margin-top:0.65rem;">
          <input type="checkbox" id="set-auto-scene-music" ${audioState.autoSceneMusic ? 'checked' : ''} />
          Auto-Szenenmusik aktiv
        </label>
        <label class="system-row">Galaxy-Track URL</label>
        <input id="set-scene-galaxy" type="text" placeholder="music/Nebula_Overture.mp3" value="${esc(audioState.sceneTracks?.galaxy || '')}" />
        <label class="system-row">System-Track URL</label>
        <input id="set-scene-system" type="text" placeholder="music/Nebula_Overture.mp3" value="${esc(audioState.sceneTracks?.system || '')}" />
        <label class="system-row">Battle-Track URL</label>
        <input id="set-scene-battle" type="text" placeholder="music/Nebula_Overture.mp3" value="${esc(audioState.sceneTracks?.battle || '')}" />
        <label class="system-row">UI-Track URL</label>
        <input id="set-scene-ui" type="text" placeholder="music/Nebula_Overture.mp3" value="${esc(audioState.sceneTracks?.ui || '')}" />
        <div class="system-row" style="margin-top:0.85rem;"><strong>SFX-Browser</strong></div>
        ${sfxRows}
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.55rem;">
          <button id="set-audio-test" class="btn btn-secondary btn-sm" type="button">SFX-Test</button>
          <button id="set-sfx-apply" class="btn btn-secondary btn-sm" type="button">SFX speichern</button>
          <button id="set-audio-reset" class="btn btn-warning btn-sm" type="button">Audio-Defaults</button>
          <button id="set-scene-apply" class="btn btn-secondary btn-sm" type="button">Szenen speichern</button>
          <button id="set-scene-preview-galaxy" class="btn btn-secondary btn-sm" type="button">Preview Galaxy</button>
          <button id="set-scene-preview-system" class="btn btn-secondary btn-sm" type="button">Preview System</button>
          <button id="set-scene-preview-battle" class="btn btn-secondary btn-sm" type="button">Preview Battle</button>
          <button id="set-scene-preview-ui" class="btn btn-secondary btn-sm" type="button">Preview UI</button>
          <button id="set-music-apply" class="btn btn-secondary btn-sm" type="button">Musik laden</button>
          <button id="set-music-play" class="btn btn-primary btn-sm" type="button">Play</button>
          <button id="set-music-stop" class="btn btn-warning btn-sm" type="button">Stop</button>
        </div>

        <div class="system-row" style="margin-top:1rem;"><strong>LLM Prompt Profiles (SoC)</strong></div>
        <label class="system-row">Prompt-Profil</label>
        <select id="set-llm-profile">
          <option value="">Bitte laden...</option>
        </select>
        <label class="system-row">Input-Variablen (JSON)</label>
        <textarea id="set-llm-input-vars" rows="6" style="width:100%;resize:vertical;" placeholder='{"origin":"[1:100:7]","target":"[1:110:4]","mission":"attack","fleet_summary":"8 cruisers"}'></textarea>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.55rem;">
          <button id="set-llm-profiles-load" class="btn btn-secondary btn-sm" type="button">Profile laden</button>
          <button id="set-llm-compose" class="btn btn-secondary btn-sm" type="button">Prompt compose</button>
          <button id="set-llm-run" class="btn btn-primary btn-sm" type="button">LLM ausfuehren</button>
        </div>
        <label class="system-row" style="margin-top:0.6rem;">Ausgabe</label>
        <textarea id="set-llm-output" rows="8" style="width:100%;resize:vertical;" readonly></textarea>

        <div class="system-row" style="margin-top:1rem;"><strong>NPC / PvE Controller</strong></div>
        <div class="system-row" id="set-npc-status-line" style="font-size:0.82rem;color:var(--text-muted)">Status wird geladen...</div>
        <div class="system-row" style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
          <label for="set-npc-summary-hours" style="margin:0;">Summary-Fenster</label>
          <select id="set-npc-summary-hours" style="max-width:140px;">
            <option value="6">6h</option>
            <option value="24" selected>24h</option>
            <option value="72">72h</option>
            <option value="168">168h</option>
          </select>
          <button id="set-npc-load-summary" class="btn btn-secondary btn-sm" type="button">Summary laden</button>
        </div>
        <pre id="set-npc-summary" style="margin:0.45rem 0 0;max-height:180px;overflow:auto;background:rgba(0,0,0,0.22);padding:0.5rem;border-radius:8px;font-size:0.78rem;">Wird geladen...</pre>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.45rem;">
          <button id="set-npc-refresh" class="btn btn-secondary btn-sm" type="button">Status aktualisieren</button>
          <button id="set-npc-run-once" class="btn btn-primary btn-sm" type="button">NPC Tick jetzt ausfuehren</button>
          <button id="set-npc-load-decisions" class="btn btn-secondary btn-sm" type="button">Entscheidungen laden</button>
        </div>
        <label class="system-row" style="margin-top:0.55rem;">NPC Decisions (letzte 10)</label>
        <textarea id="set-npc-decisions" rows="7" style="width:100%;resize:vertical;" readonly></textarea>
      </div>

      <div class="system-card" style="margin-top:1rem;">
        <h3 style="margin-top:0">ÔÜí FTL Drive ÔÇö Faction Selection</h3>
        <p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 0.6rem;">
          W├ñhle den FTL-Antrieb deiner Fraktion. Erste Wahl ist kostenlos. Wechsel kostet <strong>200 Ôùå Dark Matter</strong>.
        </p>
        <div id="set-ftl-current" style="margin-bottom:0.6rem;font-size:0.84rem;color:#88ccff;">Wird geladenÔÇª</div>
        <div id="set-ftl-drive-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem 0.6rem;">
          ${[
            { id: 'aereth',  name: "Aereth ÔÇö Alcubierre Warp",     desc: "+50% Kern ┬À -30% Rand" },
            { id: 'vor_tak', name: "Vor'Tak ÔÇö K-F Jump Drive",     desc: "30 LY ┬À 72h Cooldown ┬À Carrier+30%" },
            { id: 'syl_nar', name: "Syl'Nar ÔÇö Resonance Gates",   desc: "Instant via Gate-Netz" },
            { id: 'vel_ar',  name: "Vel'Ar ÔÇö Blind Quantum Jump",  desc: "Instant ┬À 0.5% Scatter ┬À Stealth 60s" },
            { id: 'zhareen', name: "Zhareen ÔÇö Crystal Channel",   desc: "Survey-Nodes ┬À 30min CD" },
            { id: 'kryl_tha',name: "Kryl'Tha ÔÇö Swarm Tunnel",     desc: "Max 50 Schiffe ┬À -10% H├╝lle" },
          ].map((d) => `<button class="btn btn-secondary set-ftl-drive-btn" data-drive="${esc(d.id)}"
              style="text-align:left;padding:0.35rem 0.5rem;font-size:0.78rem;line-height:1.3;" type="button">
              <strong>${esc(d.name)}</strong><br><span style="color:var(--text-muted)">${esc(d.desc)}</span>
            </button>`).join('')}
        </div>
        <div id="set-ftl-result" style="margin-top:0.4rem;font-size:0.8rem;min-height:1rem;"></div>
      </div>`;

    const bindRange = (id, valueId, setter) => {
      const input = root.querySelector(id);
      const out = root.querySelector(valueId);
      if (!input || !out) return;
      const apply = () => {
        out.textContent = String(input.value);
        setter(Number(input.value || 0));
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', apply);
    };

    const autoTransitions = root.querySelector('#set-auto-transitions');
    autoTransitions?.addEventListener('change', () => {
      settingsState.autoTransitions = !!autoTransitions.checked;
      settingsController.applyRuntimeSettings();
      settingsController.saveUiSettings();
    });

    const fleetVectors = root.querySelector('#set-galaxy-fleet-vectors');
    fleetVectors?.addEventListener('change', () => {
      settingsState.galaxyFleetVectorsVisible = !!fleetVectors.checked;
      settingsController.applyRuntimeSettings();
      settingsController.saveUiSettings();
      const galaxyRoot = WM.body('galaxy');
      if (galaxyRoot?.querySelector('#galaxy-system-details')) {
        const activeStar = pinnedStar || uiState.activeStar || null;
        renderGalaxySystemDetails(galaxyRoot, activeStar, isSystemModeActive());
      }
    });

    const homeEnterSystem = root.querySelector('#set-home-enter-system');
    homeEnterSystem?.addEventListener('change', () => {
      settingsState.homeEnterSystem = !!homeEnterSystem.checked;
      settingsController.saveUiSettings();
    });

    const systemLegacyFallback = root.querySelector('#set-system-legacy-fallback');
    systemLegacyFallback?.addEventListener('change', () => {
      settingsState.systemViewLegacyFallback = !!systemLegacyFallback.checked;
      settingsController.saveUiSettings();
      const galaxyRoot = WM.body('galaxy');
      if (galaxyRoot && galaxyController) {
        galaxyController.updateLegacyFallbackUi(galaxyRoot);
      }
    });

    const transitionPreset = root.querySelector('#set-transition-preset');
    transitionPreset?.addEventListener('change', () => {
      applyTransitionPreset(transitionPreset.value);
      const hoverSlider = root.querySelector('#set-hover-distance');
      const stableSlider = root.querySelector('#set-transition-ms');
      const hoverOut = root.querySelector('#set-hover-distance-value');
      const stableOut = root.querySelector('#set-transition-ms-value');
      if (hoverSlider) hoverSlider.value = String(Math.round(settingsState.persistentHoverDistance));
      if (stableSlider) stableSlider.value = String(Math.round(settingsState.transitionStableMinMs));
      if (hoverOut) hoverOut.textContent = String(Math.round(settingsState.persistentHoverDistance));
      if (stableOut) stableOut.textContent = String(Math.round(settingsState.transitionStableMinMs));
      settingsController.applyRuntimeSettings();
      settingsController.saveUiSettings();
    });

    bindRange('#set-hover-distance', '#set-hover-distance-value', (v) => {
      settingsState.persistentHoverDistance = Math.max(120, v);
      settingsController.applyRuntimeSettings();
      settingsController.saveUiSettings();
    });

    bindRange('#set-transition-ms', '#set-transition-ms-value', (v) => {
      settingsState.transitionStableMinMs = Math.max(80, v);
      settingsController.applyRuntimeSettings();
      settingsController.saveUiSettings();
    });

    runtimeAudioSettingsPanelApi.bindAudioSettingsPanel({
      root,
      audioState,
      audioTrackOptions,
      settingsState,
      audioManager,
      bindRange,
      loadAudioTrackCatalog,
      showToast,
      saveUiSettings: saveUiSettingsRef,
      refreshAudioUi: refreshAudioUiRef,
      rerenderSettings: renderSettings,
    });
    runtimeAiSettingsPanelApi.bindAiSettingsPanel({
      root,
      api: API,
      esc,
      showToast,
    });
    runtimeFtlSettingsPanelApi.bindFtlSettingsPanel({
      root,
      api: API,
      wm: WM,
      esc,
      fmt,
      showToast,
      windowRef: window,
    });
  }

  // ÔöÇÔöÇ Quests window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderQuests() {
    const root = WM.body('quests');
    if (!root) return;
    root.innerHTML = '<p class="text-muted">LoadingÔÇª</p>';
    try {
      const data = await API.achievements();
      if (!data.success) { root.innerHTML = '<p class="text-red">Error loading quests.</p>'; return; }

      const all    = data.achievements || [];
      const groups = {};
      for (const a of all) {
        if (!groups[a.category]) groups[a.category] = [];
        groups[a.category].push(a);
      }

      const categoryLabels = {
        tutorial:  '­ƒôÿ Tutorial ÔÇô New Player Quests',
        economy:   '­ƒÆ░ Economy', expansion: '­ƒîì Expansion',
        combat:    'ÔÜö Combat',   milestone: '­ƒÅå Veteran Milestones',
      };
      const categoryOrder = ['tutorial','economy','expansion','combat','milestone'];
      let html = '';

      for (const cat of categoryOrder) {
        if (!groups[cat]) continue;
        const quests    = groups[cat];
        const done      = quests.filter(q => q.completed && q.reward_claimed).length;
        const claimable = quests.filter(q => q.completed && !q.reward_claimed).length;

        html += `<div class="quest-group">
          <h3 class="quest-group-title">
            ${esc(categoryLabels[cat] ?? cat)}
            <span class="quest-group-progress">${done}/${quests.length}</span>
            ${claimable ? `<span class="quest-claimable-badge">${claimable} ready!</span>` : ''}
          </h3><div class="quest-list">`;

        for (const q of quests) {
          const pct   = (q.goal > 0) ? Math.min(100, Math.round(q.progress / q.goal * 100)) : 100;
          const state = q.reward_claimed ? 'claimed' : q.completed ? 'claimable' : 'pending';
          const rewards = [];
          if (q.reward_metal)       rewards.push(`Ô¼í ${fmt(q.reward_metal)}`);
          if (q.reward_crystal)     rewards.push(`­ƒÆÄ ${fmt(q.reward_crystal)}`);
          if (q.reward_deuterium)   rewards.push(`­ƒöÁ ${fmt(q.reward_deuterium)}`);
          if (q.reward_dark_matter) rewards.push(`Ôùå ${fmt(q.reward_dark_matter)} DM`);
          if (q.reward_rank_points) rewards.push(`Ôÿà ${fmt(q.reward_rank_points)} RP`);

          html += `
            <div class="quest-card quest-${state}" data-aid="${q.id}">
              <div class="quest-header">
                <span class="quest-icon">${state==='claimed'?'Ô£à':state==='claimable'?'­ƒÄü':'Ôùï'}</span>
                <span class="quest-title">${esc(q.title)}</span>
              </div>
              <div class="quest-desc">${esc(q.description)}</div>
              ${state !== 'claimed' ? `
                <div class="quest-progress-wrap">
                  <div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${pct}%"></div></div>
                  <span class="quest-progress-label">${q.progress} / ${q.goal}</span>
                </div>` : ''}
              <div class="quest-footer">
                <span class="quest-rewards">${rewards.join(' &nbsp; ')}</span>
                ${state==='claimable'
                  ? `<button class="btn btn-primary btn-sm claim-btn" data-aid="${q.id}">Ô£¿ Claim</button>`
                  : state==='claimed'
                    ? `<span class="quest-claimed-label">Claimed ${q.completed_at?new Date(q.completed_at).toLocaleDateString():''}</span>`
                    : ''}
              </div>
            </div>`;
        }
        html += `</div></div>`;
      }

      root.innerHTML = html || '<p class="text-muted">No quests found.</p>';

      root.querySelectorAll('.claim-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const r = await API.claimAchievement(parseInt(btn.dataset.aid, 10));
          if (r.success) {
            showToast(r.message || '­ƒÅå Reward claimed!', 'success');
            await loadOverview();
            renderQuests();
          } else { showToast(r.error || 'Could not claim reward.', 'error'); btn.disabled = false; }
        });
      });
    } catch (e) { root.innerHTML = '<p class="text-red">Failed to load quests.</p>'; }
  }

  // ÔöÇÔöÇ Logout ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    if (audioManager) audioManager.playUiClick();
    
    // Attempt graceful logout
    try {
      const res = await API.logout();
      if (res && res.success) {
        // Clear session-related storage
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (err) {
          gameLog('info', 'Session-Storage cleanup im Logout fehlgeschlagen', err);
        }
        
        // Close EventSource if active
        if (typeof window.__gqSSE !== 'undefined' && window.__gqSSE?.close) {
          try {
            window.__gqSSE.close();
          } catch (err) {
            gameLog('info', 'SSE close im Logout-Cleanup fehlgeschlagen', err);
          }
        }
        
        // Hard redirect after brief delay to ensure cookies are sent
        setTimeout(() => {
          window.location.href = 'index.html?logout=1&nocache=' + Date.now();
        }, 200);
        return;
      }
    } catch (err) {
      gameLog('warn', 'API logout fehlgeschlagen, fallback redirect aktiv', err);
    }
    
    // Fallback: redirect immediately if logout failed
    window.location.href = 'index.html?logout=1&nocache=' + Date.now();
  });

  // ÔöÇÔöÇ Badge refresh (messages) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function loadBadge() {
    await messagesController.loadBadge();
  }

  runtimeRealtimeSyncApi.configureRealtimeSyncRuntime({
    windowRef: window,
    documentRef: document,
    onLoadBadge: loadBadge,
    onLoadOverview: loadOverview,
    invalidateGetCache: _invalidateGetCache,
    refreshWindow: wmRefresh,
    getGalaxyRoot: () => wmBody('galaxy'),
    refreshGalaxyDensityMetrics,
    showToast,
    gameLog,
    eventSourceFactory: eventSourceFactoryRef,
  });
  runtimeRealtimeSyncApi.initRealtimeSync();

  // ÔöÇÔöÇ Boot: keep galaxy fixed in main desktop area and preload overview data ÔöÇÔöÇ
  runtimeStartupBootApi.initStartupBoot({
    wm: WM,
    audioManager,
    loadAudioTrackCatalog,
    refreshAudioUi: refreshAudioUiRef,
    gameLog,
    windowRef: window,
  });

  // ÔöÇÔöÇ Footer actions init ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  runtimeFooterUiKitApi.initFooterUiKit({
    wm: WM,
    updateFooterQuickNavBadge,
    documentRef: document,
    windowRef: window,
    storage: localStorage,
  });

  await runtimePostBootFlowApi.runPostBootFlow({
    wm: WM,
    settingsState,
    focusHomeSystemInGalaxy,
    loadOverview,
    loadBadge,
    initSystemBreadcrumb,
    advisorWidget: AdvisorWidget,
    gameLog,
    windowRef: window,
  });

  runtimeColonyVfxDebugWidgetApi.safeInitColonyVfxDebugWidget({
    esc,
    documentRef: document,
    windowRef: window,
    logger: console,
  });

})();

