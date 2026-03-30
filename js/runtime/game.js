/**
 * GalaxyQuest ÔÇô Main game UI controller
 * All views are rendered as floating windows via the WM (window manager).
 */
(async function () {

  // ÔöÇÔöÇ Auth guard ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  let currentUser;
  try {
    const meData = await API.me();
    if (!meData.success) { window.location.href = 'index.html'; return; }
    currentUser = meData.user;
  } catch (_) { window.location.href = 'index.html'; return; }

  function updateCommanderButtonLabel() {
    const commanderBtn = document.getElementById('commander-name');
    if (commanderBtn) commanderBtn.textContent = `ÔÜÖ ${currentUser.username} Ôû¥`;
  }
  updateCommanderButtonLabel();

  function isCurrentUserAdmin() {
    return Number(currentUser?.is_admin || 0) === 1;
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

  // ÔöÇÔöÇ State ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  let colonies       = [];
  let currentColony  = null;
  let galaxySystemMax = 499;
  let galaxy3d = null;
  let galaxy3dQualityState = null;
  let galaxy3dInitReason = '';
  const messageConsoleState = {
    maxLines: 140,
    userHints: [],
    lines: [
      '[system] Message console ready. Type "help" for commands.',
    ],
  };
  const messageSignalState = {
    host: null,
    rings: Object.create(null),
    levelLabel: {
      danger: 'Gefahr',
      success: 'Erfolg',
      info: 'Info',
    },
    levelPriority: {
      danger: 3,
      success: 2,
      info: 1,
    },
    unreadIds: new Set(),
    unreadByLevel: { danger: 0, success: 0, info: 0 },
    flashUntilByLevel: { danger: 0, success: 0, info: 0 },
    bootstrapped: false,
  };
  class UIConsoleStore {
    constructor(options = {}) {
      this.maxLines = Math.max(20, Number(options.maxLines || 220));
      this.lines = Array.isArray(options.initialLines) && options.initialLines.length
        ? options.initialLines.map((line) => String(line || '').trim()).filter(Boolean)
        : ['[ui] Console ready. Type "help".'];
      this.filter = String(options.filter || 'all').toLowerCase();
    }

    push(line) {
      const text = String(line || '').trim();
      if (!text) return false;
      this.lines.push(text);
      if (this.lines.length > this.maxLines) {
        this.lines.splice(0, this.lines.length - this.maxLines);
      }
      return true;
    }

    clear(seedLine = '[ui] Console cleared.') {
      this.lines = [String(seedLine || '[ui] Console cleared.')];
    }

    setFilter(value) {
      this.filter = String(value || 'all').toLowerCase();
    }

    getVisibleLines() {
      const selected = this.filter;
      if (selected === 'all') return this.lines.slice();
      return this.lines.filter((line) => {
        const text = String(line || '').toLowerCase();
        if (selected === 'abort') {
          return text.includes('abort') || text.includes('cancel') || text.includes('navigation') || text.includes('fetchabort');
        }
        if (selected === 'system') {
          return text.includes('[ui]') || text.includes('[system]') || text.includes('[api:');
        }
        return text.includes(`[${selected}]`);
      });
    }
  }
  const uiConsoleStore = new UIConsoleStore({
    maxLines: 220,
    initialLines: ['[ui] Console ready. Type "help".'],
    filter: 'all',
  });
  let galaxyStars = [];
  let pinnedStar = null;
  let galaxyHealthLast = null;
  let galaxyHealthLastCheckMs = 0;
  let galaxyHealthWarned = false;
  let galaxyOverlayHotkeysBound = false;
  let galaxyHydrationToken = 0;
  let galaxyAutoFramedOnce = false;
  const galaxyDebugState = {
    maxEntries: 6,
    entries: [],
  };
  class TopbarSearchStore {
    constructor(options = {}) {
      this.query = '';
      this.localResults = [];
      this.serverResults = [];
      this.open = false;
      this.serverPending = false;
      this.debounceId = 0;
      this.requestToken = 0;
      this.maxLocal = Math.max(1, Number(options.maxLocal || 10));
      this.maxServer = Math.max(1, Number(options.maxServer || 18));
    }

    nextToken(query) {
      this.query = String(query || '').trim();
      this.requestToken += 1;
      return this.requestToken;
    }

    matchesToken(token) {
      return Number(token || 0) === Number(this.requestToken || 0);
    }

    setLocalResults(rows) {
      this.localResults = Array.isArray(rows) ? rows : [];
    }

    setServerResults(rows) {
      this.serverResults = Array.isArray(rows) ? rows : [];
    }

    setServerPending(flag) {
      this.serverPending = !!flag;
    }

    openOverlay() {
      this.open = true;
    }

    closeOverlay() {
      this.open = false;
    }

    reset() {
      this.query = '';
      this.localResults = [];
      this.serverResults = [];
      this.serverPending = false;
      this.closeOverlay();
    }

    clearDebounce() {
      if (!this.debounceId) return;
      clearTimeout(this.debounceId);
      this.debounceId = 0;
    }

    queueServerFetch(run, delayMs = 260) {
      this.clearDebounce();
      this.debounceId = window.setTimeout(async () => {
        this.debounceId = 0;
        await run();
      }, delayMs);
    }

    firstCandidate() {
      return this.localResults[0] || this.serverResults[0] || null;
    }
  }
  const topbarSearchStore = new TopbarSearchStore({
    maxLocal: 10,
    maxServer: 18,
  });
  let lastLoadErrorToastAt = 0;
  let authRedirectScheduled = false;
  const uiState = {
    activeGalaxy: 1,
    activeSystem: 1,
    activeStar: null,
    activeRange: { from: 1, to: 499 },
    assetsManifestVersion: Math.max(1, Number(window.GQ_ASSETS_MANIFEST_VERSION || 1)),
    colonyViewFocus: null,
    fleetPrefill: null,
    intelCache: new Map(),
    territory: [],
    rawClusters: [],
    clusterSummary: [],
    resourceInsight: null,
  };
  const RESOURCE_INSIGHT_CONFIG = Object.freeze({
    metal: { key: 'metal', label: 'Metal', icon: 'Ô¼í', desc: 'Basismetall fuer Hulls, Industrie und Ausbau. Ueberschuesse eignen sich fuer Angebotstrades oder interne Transporte.', focusBuilding: 'metal_mine', rateKey: 'metal', tradeable: true, transportable: true },
    crystal: { key: 'crystal', label: 'Crystal', icon: '­ƒÆÄ', desc: 'Veredelte Hochtechnologieressource fuer Forschung, Scanner und Komponentenbau.', focusBuilding: 'crystal_mine', rateKey: 'crystal', tradeable: true, transportable: true },
    deuterium: { key: 'deuterium', label: 'Deuterium', icon: '­ƒöÁ', desc: 'Treibstoff und Spezialressource. Transporte, Flottenstarts und Handel ziehen Deuterium fuer Frachtsicherung und Flugzeit.', focusBuilding: 'deuterium_synth', rateKey: 'deuterium', tradeable: true, transportable: true },
    food: { key: 'food', label: 'Food', icon: '­ƒî¥', desc: 'Versorgt die Bevoelkerung und stabilisiert Wachstum. Negative Raten wirken direkt auf Wohlfahrt und Ausbau.', focusBuilding: 'hydroponic_farm', rateKey: 'food', tradeable: false, transportable: false },
    rare_earth: { key: 'rare_earth', label: 'Rare Earth', icon: '­ƒÆ£', desc: 'Seltene Fertigungsmetalle fuer fortgeschrittene Module. Im aktuellen Handelssystem nur strategisch beobachten, nicht direkt handeln.', focusBuilding: 'rare_earth_drill', rateKey: 'rare_earth', tradeable: false, transportable: false },
    population: { key: 'population', label: 'Population', icon: '­ƒæÑ', desc: 'Arbeitskraefte und Wachstumspuffer der Kolonie. Engpaesse limitieren Produktion und Baugeschwindigkeit.', focusBuilding: 'habitat_dome', rateKey: 'population', tradeable: false, transportable: false },
    happiness: { key: 'happiness', label: 'Happiness', icon: '­ƒÿè', desc: 'Produktivitaets- und Stabilitaetsindikator. Sinkt Happiness, verlieren selbst volle Lager an Effizienz.', focusBuilding: 'hospital', rateKey: null, tradeable: false, transportable: false },
    energy: { key: 'energy', label: 'Energy', icon: 'ÔÜí', desc: 'Versorgt Gebaeude und beeinflusst alle Produktionsketten. Defizite wirken sofort auf die Wirtschaft.', focusBuilding: 'solar_plant', rateKey: null, tradeable: false, transportable: false },
    dark_matter: { key: 'dark_matter', label: 'Dark Matter', icon: 'Ôùå', desc: 'Prestigewaehrung aus Quests und Progression. Nicht ueber den normalen Rohstoffmarkt handelbar.', focusBuilding: '', rateKey: null, tradeable: false, transportable: false },
  });

  function getResourceInsightConfig(resourceKey) {
    return RESOURCE_INSIGHT_CONFIG[String(resourceKey || '').toLowerCase()] || null;
  }

  function getResourceInsightValue(resourceKey, colony = currentColony, meta = window._GQ_meta || {}) {
    const key = String(resourceKey || '');
    if (key === 'dark_matter') return Number(meta?.dark_matter || 0);
    if (!colony) return 0;
    if (key === 'population') return Number(colony.population || 0);
    if (key === 'happiness') return Number(colony.happiness || 0);
    if (key === 'energy') return Number(colony.energy || 0);
    return Number(colony[key] || 0);
  }

  function getResourceInsightTotal(resourceKey, meta = window._GQ_meta || {}) {
    const key = String(resourceKey || '');
    if (key === 'dark_matter') return Number(meta?.dark_matter || 0);
    return colonies.reduce((sum, colony) => sum + getResourceInsightValue(key, colony, meta), 0);
  }

  function formatResourceInsightValue(resourceKey, value, colony = currentColony) {
    const key = String(resourceKey || '');
    const numeric = Number(value || 0);
    if (key === 'population') {
      const maxPopulation = Number(colony?.max_population || 0);
      return maxPopulation > 0 ? `${fmt(numeric)}/${fmt(maxPopulation)}` : fmt(numeric);
    }
    if (key === 'happiness') return `${Math.round(numeric)}%`;
    if (key === 'energy') return `${Math.round(numeric)}`;
    return fmt(numeric);
  }

  function getSuggestedTradeAmount(resourceKey, mode = 'request') {
    const key = String(resourceKey || '');
    if (!['metal', 'crystal', 'deuterium'].includes(key)) return 0;
    const currentValue = Math.max(0, getResourceInsightValue(key));
    if (mode === 'offer') {
      return Math.max(250, Math.min(5000, Math.round(currentValue * 0.08)));
    }
    return Math.max(1000, Math.min(5000, Math.round(currentValue * 0.15) || 1000));
  }

  function openResourceInsight(resourceKey) {
    const config = getResourceInsightConfig(resourceKey);
    if (!config) return;
    uiState.resourceInsight = config.key;
    WM.open('overview');
    WM.refresh('overview');
  }

  function openTradeMarketplace(resourceKey, mode = 'request') {
    const config = getResourceInsightConfig(resourceKey);
    if (!config?.tradeable) {
      showToast(`${config?.label || 'Ressource'} ist im aktuellen Markt nicht direkt handelbar.`, 'info');
      return;
    }
    WM.open('trade');
    window.setTimeout(() => {
      window.GQTradeProposalsController?.showProposeDialog(0, '', {
        resourceKey: config.key,
        mode,
      });
    }, 0);
  }

  function openFleetTransportPlanner(resourceKey) {
    const config = getResourceInsightConfig(resourceKey);
    if (!config?.transportable) {
      showToast(`${config?.label || 'Ressource'} nutzt aktuell keinen direkten Frachteinsatz.`, 'info');
      return;
    }
    const cargo = { metal: 0, crystal: 0, deuterium: 0 };
    cargo[config.key] = getSuggestedTradeAmount(config.key, 'offer');
    uiState.fleetPrefill = {
      galaxy: Number(currentColony?.galaxy || 1),
      system: Number(currentColony?.system || 1),
      position: Number(currentColony?.position || 1),
      mission: 'transport',
      owner: `${config.icon} ${config.label}`,
      threatLevel: 'Frachtsicherung aktiv',
      cargo,
      ts: Date.now(),
    };
    WM.open('fleet');
    WM.refresh('fleet');
  }
  const PERF_TELEMETRY_OPT_IN_KEY = 'gq_perf_telemetry_opt_in';
  const PERF_TELEMETRY_INTERVAL_MS = 2 * 60 * 1000;
  const footerLoadUi = {
    root: document.getElementById('footer-load'),
    bar: document.getElementById('footer-load-bar'),
    pct: document.getElementById('footer-load-pct'),
    queue: document.getElementById('footer-load-queue'),
    net: document.getElementById('footer-network-status'),
    label: document.getElementById('footer-load-label'),
  };
  const footerNetworkState = {
    lastProbeAt: 0,
    inFlight: false,
  };

  function redirectToLogin(reason = 'auth') {
    if (authRedirectScheduled) return;
    authRedirectScheduled = true;
    const target = `index.html?reason=${encodeURIComponent(String(reason || 'auth'))}`;
    uiConsolePush(`[system] Session abgelaufen (${reason}). Redirect -> ${target}`);
    showToast('Session abgelaufen. Weiterleitung zum LoginÔÇª', 'warning');
    window.setTimeout(() => {
      window.location.href = target;
    }, 450);
  }
  const AUDIO_TRACK_OPTIONS_FALLBACK = [
    { value: 'music/Nebula_Overture.mp3', label: 'Nebula Overture' },
  ];
  let audioTrackOptions = AUDIO_TRACK_OPTIONS_FALLBACK.slice();
  let audioTrackCatalogLoaded = false;
  let audioTrackCatalogPromise = null;
  const AUDIO_SFX_OPTIONS = [
    { value: 'sfx/mixkit-video-game-retro-click-237.wav', label: 'Retro Click' },
    { value: 'sfx/mixkit-quick-positive-video-game-notification-interface-265.wav', label: 'Positive Notification' },
    { value: 'sfx/mixkit-negative-game-notification-249.wav', label: 'Negative Notification' },
    { value: 'sfx/mixkit-sci-fi-positive-notification-266.wav', label: 'Sci-Fi Positive Notification' },
    { value: 'sfx/mixkit-sci-fi-warp-slide-3113.wav', label: 'Sci-Fi Warp Slide' },
    { value: 'sfx/mixkit-unlock-new-item-game-notification-254.wav', label: 'Unlock New Item' },
    { value: 'sfx/mixkit-casino-bling-achievement-2067.wav', label: 'Achievement Bling' },
    { value: 'sfx/mixkit-space-shot-whoosh-3001.wav', label: 'Space Shot Whoosh' },
    { value: 'sfx/mixkit-space-coin-win-notification-271.wav', label: 'Space Coin Win' },
    { value: 'sfx/mixkit-falling-hit-757.wav', label: 'Falling Hit' },
    { value: 'sfx/mixkit-horn-suspense-transition-3112.wav', label: 'Horn Suspense Transition' },
    { value: 'sfx/mixkit-laser-gun-shot-3110.wav', label: 'Laser Gun Shot' },
    { value: 'sfx/mixkit-night-vision-starting-2476.wav', label: 'Night Vision Start' },
    { value: 'sfx/mixkit-medieval-show-fanfare-announcement-226.wav', label: 'Fanfare Announcement' },
    { value: 'sfx/mixkit-space-plasma-shot-3002.wav', label: 'Space Plasma Shot' },
    { value: 'sfx/mixkit-bonus-earned-in-video-game-2058.wav', label: 'Bonus Earned' },
    { value: 'sfx/mixkit-space-deploy-whizz-3003.wav', label: 'Space Deploy Whizz' },
    { value: 'sfx/mixkit-sci-fi-laser-in-space-sound-2825.wav', label: 'Sci-Fi Laser' },
    { value: 'sfx/mixkit-space-plasma-shot-3002.wav', label: 'Space Plasma Shot' },
    { value: 'sfx/mixkit-space-shot-whoosh-3001.wav', label: 'Space Shot Whoosh' },
    { value: 'sfx/mixkit-unlock-new-item-game-notification-254.wav', label: 'Unlock New Item' },
    { value: 'sfx/mixkit-space-coin-win-notification-271.wav', label: 'Space Coin Win' },
    { value: 'sfx/mixkit-medieval-show-fanfare-announcement-226.wav', label: 'Fanfare Announcement' },
    { value: 'sfx/mixkit-laser-gun-shot-3110.wav', label: 'Laser Gun Shot' },
    { value: 'sfx/mixkit-short-laser-gun-shot-1670.wav', label: 'Short Laser Shot' },
  ];
  const AUDIO_SFX_EVENTS = [
    { key: 'uiClick', label: 'UI Click', tester: 'playUiClick' },
    { key: 'uiConfirm', label: 'UI Confirm', tester: 'playUiConfirm' },
    { key: 'uiError', label: 'UI Error', tester: 'playUiError' },
    { key: 'uiNotify', label: 'UI Notify', tester: 'playUiNotify' },
    { key: 'navigation', label: 'Navigation', tester: 'playNavigation' },
    { key: 'pvpToggle', label: 'PvP Toggle', tester: 'playPvpToggle' },
    { key: 'researchStart', label: 'Research Start', tester: 'playResearchStart' },
    { key: 'researchComplete', label: 'Research Complete', tester: 'playResearchComplete' },
    { key: 'fleetRecall', label: 'Fleet Recall', tester: 'playFleetRecall' },
    { key: 'messageSend', label: 'Message Send', tester: 'playMessageSend' },
    { key: 'messageRead', label: 'Message Read', tester: 'playMessageRead' },
    { key: 'messageDelete', label: 'Message Delete', tester: 'playMessageDelete' },
    { key: 'fleetAttack', label: 'Fleet Attack', tester: 'playFleetAttack' },
    { key: 'fleetTransport', label: 'Fleet Transport', tester: 'playFleetTransport' },
    { key: 'fleetSpy', label: 'Fleet Spy', tester: 'playFleetSpy' },
    { key: 'fleetColonize', label: 'Fleet Colonize', tester: 'playFleetColonize' },
    { key: 'fleetHarvest', label: 'Fleet Harvest', tester: 'playFleetHarvest' },
    { key: 'buildComplete', label: 'Build Complete', tester: 'playBuildComplete' },
    { key: 'fleetLaunch', label: 'Fleet Launch', tester: 'playFleetLaunch' },
  ];
  const settingsState = {
    transitionPreset: 'balanced',
    autoTransitions: true,
    renderQualityProfile: 'auto',
    clusterDensityMode: 'auto',
    galaxyColonyFilterMode: 'all',
    galaxyColoniesOnly: false,
    galaxyOwnerFocusUserId: 0,
    galaxyOwnerFocusName: '',
    clusterBoundsVisible: true,
    galaxyFleetVectorsVisible: true,
    galacticCoreFxAuto: true,
    galacticCoreFxEnabled: true,
    magnetPreset: 'balanced',
    hoverMagnetEnabled: true,
    clickMagnetEnabled: true,
    hoverMagnetStarPx: 24,
    hoverMagnetPlanetPx: 30,
    hoverMagnetClusterPx: 28,
    persistentHoverDistance: 220,
    transitionStableMinMs: 160,
    homeEnterSystem: false,
    introFlightMode: 'cinematic',
    masterVolume: 0.8,
    musicVolume: 0.55,
    sfxVolume: 0.8,
    masterMuted: false,
    musicMuted: false,
    sfxMuted: false,
    musicTransitionMode: 'fade',
    musicUrl: '',
    autoSceneMusic: true,
    sceneTracks: {
      galaxy: '',
      system: '',
      battle: '',
      ui: '',
    },
    sfxMap: {
      uiClick: 'sfx/mixkit-video-game-retro-click-237.wav',
      uiConfirm: 'sfx/mixkit-quick-positive-video-game-notification-interface-265.wav',
      uiError: 'sfx/mixkit-negative-game-notification-249.wav',
      uiNotify: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
      navigation: 'sfx/mixkit-sci-fi-warp-slide-3113.wav',
      pvpToggle: 'sfx/mixkit-horn-suspense-transition-3112.wav',
      researchStart: 'sfx/mixkit-unlock-new-item-game-notification-254.wav',
      researchComplete: 'sfx/mixkit-casino-bling-achievement-2067.wav',
      fleetRecall: 'sfx/mixkit-space-shot-whoosh-3001.wav',
      messageSend: 'sfx/mixkit-space-coin-win-notification-271.wav',
      messageRead: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
      messageDelete: 'sfx/mixkit-falling-hit-757.wav',
      fleetAttack: 'sfx/mixkit-laser-gun-shot-3110.wav',
      fleetTransport: 'sfx/mixkit-space-deploy-whizz-3003.wav',
      fleetSpy: 'sfx/mixkit-night-vision-starting-2476.wav',
      fleetColonize: 'sfx/mixkit-medieval-show-fanfare-announcement-226.wav',
      fleetHarvest: 'sfx/mixkit-space-plasma-shot-3002.wav',
      buildComplete: 'sfx/mixkit-bonus-earned-in-video-game-2058.wav',
      fleetLaunch: 'sfx/mixkit-space-deploy-whizz-3003.wav',
    },
  };

  const UI_SETTINGS_STORAGE_KEY = 'gq_ui_settings';
  const UI_SETTINGS_SESSION_KEY = 'gq_ui_settings_session';
  const UI_SETTINGS_COOKIE_KEY = 'gq_ui_settings';
  const UI_SETTINGS_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 180;
  const GALAXY_FLEET_HINT_KEY = 'gq_hint_galaxy_fleet_colors_v1';
  const GALAXY_FLEET_HINT_COOKIE_DAYS = 365;
  let galaxyFleetHintShownInSession = false;
  let galaxyFleetHintScheduledInSession = false;
  let galaxyShortcutsHintShownInSession = false;

  function readCookieValue(name) {
    try {
      const cookieText = String(document.cookie || '');
      if (!cookieText) return '';
      const safeName = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = cookieText.match(new RegExp(`(?:^|;\\s*)${safeName}=([^;]*)`));
      return match?.[1] ? decodeURIComponent(match[1]) : '';
    } catch (_) {
      return '';
    }
  }

  function writeCookieValue(name, value, maxAgeSec) {
    try {
      const safeAge = Math.max(60, Number(maxAgeSec || 0));
      document.cookie = `${name}=${encodeURIComponent(String(value || ''))}; Max-Age=${safeAge}; Path=/; SameSite=Lax`;
    } catch (_) {}
  }

  function hasSeenGalaxyFleetHint() {
    try {
      if (window.localStorage?.getItem(GALAXY_FLEET_HINT_KEY) === '1') return true;
    } catch (_) {}
    return readCookieValue(GALAXY_FLEET_HINT_KEY) === '1';
  }

  function markGalaxyFleetHintSeen() {
    try {
      window.localStorage?.setItem(GALAXY_FLEET_HINT_KEY, '1');
    } catch (_) {}
    writeCookieValue(GALAXY_FLEET_HINT_KEY, '1', GALAXY_FLEET_HINT_COOKIE_DAYS * 24 * 60 * 60);
  }

  function readJsonFromCookie(name) {
    try {
      const cookieText = String(document.cookie || '');
      if (!cookieText) return null;
      const safeName = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = cookieText.match(new RegExp(`(?:^|;\\s*)${safeName}=([^;]*)`));
      if (!match || !match[1]) return null;
      const raw = decodeURIComponent(match[1]);
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writeJsonCookie(name, data, maxAgeSec = UI_SETTINGS_COOKIE_MAX_AGE_SEC) {
    try {
      const encoded = encodeURIComponent(JSON.stringify(data));
      document.cookie = `${name}=${encoded}; Max-Age=${Math.max(60, Number(maxAgeSec || 0))}; Path=/; SameSite=Lax`;
    } catch (_) {}
  }

  function loadPortableUiSettings() {
    const merged = {};
    try {
      const raw = localStorage.getItem(UI_SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') Object.assign(merged, parsed);
      }
    } catch (_) {}

    const cookieState = readJsonFromCookie(UI_SETTINGS_COOKIE_KEY);
    if (cookieState && typeof cookieState === 'object') Object.assign(merged, cookieState);

    try {
      const rawSession = sessionStorage.getItem(UI_SETTINGS_SESSION_KEY);
      if (rawSession) {
        const parsedSession = JSON.parse(rawSession);
        if (parsedSession && typeof parsedSession === 'object') Object.assign(merged, parsedSession);
      }
    } catch (_) {}

    return merged;
  }

  function savePortableUiSettings(data) {
    try {
      localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(data));
    } catch (_) {}
    try {
      sessionStorage.setItem(UI_SETTINGS_SESSION_KEY, JSON.stringify(data));
    } catch (_) {}
    writeJsonCookie(UI_SETTINGS_COOKIE_KEY, data, UI_SETTINGS_COOKIE_MAX_AGE_SEC);
  }

  function normalizeAudioTrackCatalog(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    const seen = new Set();

    for (let i = 0; i < items.length; i += 1) {
      const row = items[i] || {};
      const value = String(row.value || '').trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      const label = String(row.label || row.file || value).trim() || value;
      out.push({ value, label });
    }

    return out;
  }

  function resolveAudioTrackLabel(url) {
    const value = String(url || '').trim();
    if (!value) return '-';
    const fromCatalog = audioTrackOptions.find((entry) => String(entry.value || '') === value);
    if (fromCatalog && fromCatalog.label) return String(fromCatalog.label);
    const parts = value.split('/');
    const file = String(parts[parts.length - 1] || value);
    return file.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || file;
  }

  function updateTopbarTrackTicker(label) {
    const host = document.getElementById('topbar-player-current');
    if (!host) return;

    const text = String(label || '-').trim() || '-';
    host.textContent = '';
    const node = document.createElement('span');
    node.className = 'topbar-player-current-text';
    node.textContent = text;
    host.appendChild(node);

    host.classList.remove('is-overflow');
    host.style.removeProperty('--marquee-shift');
    host.style.removeProperty('--marquee-duration');

    const checkOverflow = () => {
      const overflow = node.scrollWidth - host.clientWidth;
      if (overflow > 6) {
        const shift = Math.ceil(overflow + 18);
        const duration = Math.max(6, Math.min(18, shift / 18));
        host.style.setProperty('--marquee-shift', `${shift}px`);
        host.style.setProperty('--marquee-duration', `${duration.toFixed(2)}s`);
        host.classList.add('is-overflow');
      }
    };

    window.requestAnimationFrame(checkOverflow);
  }

  function refreshSettingsMusicPresetOptions() {
    const select = document.querySelector('#set-music-preset');
    const miniSelect = document.querySelector('#set-player-track');
    const topbarSelect = document.querySelector('#topbar-player-track');
    const current = select ? String(select.value || '') : '';
    const miniCurrent = miniSelect ? String(miniSelect.value || '') : '';
    const topbarCurrent = topbarSelect ? String(topbarSelect.value || '') : '';
    const optionsHtml = audioTrackOptions
      .map((entry) => `<option value="${esc(entry.value)}">${esc(entry.label)}</option>`)
      .join('');

    if (select) {
      select.innerHTML = `<option value="">Keine Vorlage</option>${optionsHtml}`;
      if (current && audioTrackOptions.some((entry) => String(entry.value) === current)) {
        select.value = current;
      }
    }

    if (miniSelect) {
      miniSelect.innerHTML = optionsHtml;
      if (miniCurrent && audioTrackOptions.some((entry) => String(entry.value) === miniCurrent)) {
        miniSelect.value = miniCurrent;
      }
    }

    if (topbarSelect) {
      topbarSelect.innerHTML = optionsHtml;
      if (topbarCurrent && audioTrackOptions.some((entry) => String(entry.value) === topbarCurrent)) {
        topbarSelect.value = topbarCurrent;
      }
    }

    renderTopbarTrackQuickList(topbarCurrent || settingsState.musicUrl || '');
  }

  function renderTopbarTrackQuickList(activeTrackUrl = '') {
    const list = document.getElementById('topbar-player-track-list');
    if (!list) return;

    const active = String(activeTrackUrl || '').trim();
    if (!Array.isArray(audioTrackOptions) || !audioTrackOptions.length) {
      list.innerHTML = '<div class="topbar-player-track-empty">Keine Titel verfuegbar.</div>';
      return;
    }

    list.innerHTML = audioTrackOptions.map((entry) => {
      const value = String(entry?.value || '').trim();
      const label = String(entry?.label || value || '-').trim() || '-';
      const isActive = !!value && value === active;
      return `<button type="button" class="topbar-player-track-item${isActive ? ' is-active' : ''}" data-track="${esc(value)}" role="option" aria-selected="${isActive ? 'true' : 'false'}" title="${esc(label)}">${esc(label)}</button>`;
    }).join('');
  }

  function applyAudioPlaylistFromCatalog() {
    if (!audioManager || typeof audioManager.setMusicPlaylist !== 'function') return;
    const playlist = audioTrackOptions
      .map((entry) => String(entry.value || '').trim())
      .filter((value, idx, arr) => value && arr.indexOf(value) === idx);
    audioManager.setMusicPlaylist(playlist, { mode: 'shuffle' });
  }

  async function loadAudioTrackCatalog(force = false) {
    if (!force && audioTrackCatalogLoaded) return audioTrackOptions;
    if (!force && audioTrackCatalogPromise) return audioTrackCatalogPromise;

    audioTrackCatalogPromise = (async () => {
      try {
        if (!API || typeof API.audioTracks !== 'function') {
          audioTrackCatalogLoaded = true;
          return audioTrackOptions;
        }
        const data = await API.audioTracks();
        const nextOptions = normalizeAudioTrackCatalog(data?.tracks);
        if (nextOptions.length > 0) {
          audioTrackOptions = nextOptions;
          const firstTrack = String(nextOptions[0].value || '').trim();
          const sceneTracks = settingsState.sceneTracks || {};
          const hasSceneTrack = ['galaxy', 'system', 'battle', 'ui'].some((k) => String(sceneTracks[k] || '').trim() !== '');
          const hasMusicUrl = String(settingsState.musicUrl || '').trim() !== '';

          if (firstTrack && !hasMusicUrl && !hasSceneTrack) {
            settingsState.musicUrl = firstTrack;
            settingsState.sceneTracks = {
              galaxy: firstTrack,
              system: firstTrack,
              battle: firstTrack,
              ui: firstTrack,
            };

            if (audioManager) {
              if (typeof audioManager.setMusicTrack === 'function') {
                audioManager.setMusicTrack(firstTrack, false);
              }
              if (typeof audioManager.setSceneTrack === 'function') {
                audioManager.setSceneTrack('galaxy', firstTrack);
                audioManager.setSceneTrack('system', firstTrack);
                audioManager.setSceneTrack('battle', firstTrack);
                audioManager.setSceneTrack('ui', firstTrack);
              }
            }

            saveUiSettings();
          }
        }
        audioTrackCatalogLoaded = true;
        applyAudioPlaylistFromCatalog();
        refreshSettingsMusicPresetOptions();
        refreshAudioUi();
        return audioTrackOptions;
      } catch (_) {
        audioTrackCatalogLoaded = true;
        applyAudioPlaylistFromCatalog();
        refreshSettingsMusicPresetOptions();
        refreshAudioUi();
        return audioTrackOptions;
      } finally {
        audioTrackCatalogPromise = null;
      }
    })();

    return audioTrackCatalogPromise;
  }
  const BUILDING_UI_META = {
    metal_mine:       { cat:'Extraction', icon:'Ô¼í', desc:'Mines metal from the planet crust. Output scales with richness.' },
    crystal_mine:     { cat:'Extraction', icon:'­ƒÆÄ', desc:'Extracts crystal formations. Higher levels deplete deposits faster.' },
    deuterium_synth:  { cat:'Extraction', icon:'­ƒöÁ', desc:'Synthesises deuterium from surface water or atmosphere.' },
    rare_earth_drill: { cat:'Extraction', icon:'­ƒÆ£', desc:'Extracts rare earth elements ÔÇö finite deposit, high value.' },
    solar_plant:      { cat:'Energy', icon:'ÔÿÇ', desc:'Converts sunlight to energy. Output depends on star type.' },
    fusion_reactor:   { cat:'Energy', icon:'­ƒöå', desc:'High-output fusion reactor. Consumes deuterium.' },
    hydroponic_farm:  { cat:'Life Support', icon:'­ƒî¥', desc:'Grows food for the population. Required to prevent starvation.' },
    food_silo:        { cat:'Life Support', icon:'­ƒÅÜ', desc:'Increases food storage capacity.' },
    habitat:          { cat:'Population', icon:'­ƒÅá', desc:'+200 max population per level.' },
    hospital:         { cat:'Population', icon:'­ƒÅÑ', desc:'Improves healthcare. Raises happiness and public services index.' },
    school:           { cat:'Population', icon:'­ƒÄô', desc:'Education facility. Improves public services and colony productivity.' },
    security_post:    { cat:'Population', icon:'­ƒöÆ', desc:'Maintains order. Reduces unrest and deters pirate raids.' },
    robotics_factory: { cat:'Industry', icon:'­ƒñû', desc:'Reduces building construction time.' },
    shipyard:         { cat:'Industry', icon:'­ƒÜÇ', desc:'Required to build spacecraft.' },
    metal_storage:    { cat:'Storage', icon:'­ƒôª', desc:'Increases metal storage cap.' },
    crystal_storage:  { cat:'Storage', icon:'­ƒôª', desc:'Increases crystal storage cap.' },
    deuterium_tank:   { cat:'Storage', icon:'­ƒôª', desc:'Increases deuterium storage cap.' },
    research_lab:     { cat:'Science', icon:'­ƒö¼', desc:'Enables and accelerates research.' },
    missile_silo:     { cat:'Military', icon:'­ƒÜÇ', desc:'Launches defensive missiles.' },
    nanite_factory:   { cat:'Advanced', icon:'ÔÜÖ', desc:'Nano-assemblers that dramatically cut build times.' },
    terraformer:      { cat:'Advanced', icon:'­ƒîì', desc:'Reshapes planetary geology to expand available tiles.' },
    colony_hq:        { cat:'Advanced', icon:'­ƒÅø', desc:'Colony administration. Raises colony level cap.' },
    solar_satellite:  { cat:'Orbital', icon:'­ƒø░', desc:'Orbital solar collectors supporting planetary energy output.' },
  };
  const BUILDING_ZONE_PRIORITY = {
    industrial: ['metal_mine', 'crystal_mine', 'deuterium_synth', 'robotics_factory'],
    utility: ['solar_plant', 'fusion_reactor', 'metal_storage', 'crystal_storage', 'deuterium_tank'],
    civic: ['habitat', 'hydroponic_farm', 'hospital', 'school'],
    science: ['research_lab', 'terraformer'],
    military: ['shipyard', 'missile_silo', 'security_post'],
    orbital: ['solar_satellite', 'shipyard', 'missile_silo'],
    flex: ['colony_hq', 'robotics_factory', 'habitat'],
  };
  const galaxyModel = window.GQGalaxyModel ? new window.GQGalaxyModel() : null;
  const galaxyDB = window.GQGalaxyDB ? new window.GQGalaxyDB() : null;
  const audioManager = (() => {
    if (!window.GQAudioManager) return null;
    if (window.__GQ_AUDIO_MANAGER) return window.__GQ_AUDIO_MANAGER;
    try {
      const manager = new window.GQAudioManager({ storageKey: 'gq_audio_settings' });
      window.__GQ_AUDIO_MANAGER = manager;
      return manager;
    } catch (_) {
      return null;
    }
  })();
  const STAR_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const SYSTEM_CACHE_MAX_AGE_MS = 20 * 60 * 1000;
  const POLICY_PROFILES = {
    balanced: {
      label: 'Balanced',
      galaxy: { stars: { maxPoints: 12000, cacheMaxAgeMs: 6 * 60 * 60 * 1000, alwaysRefreshNetwork: false } },
      system: { payload: { cacheMaxAgeMs: 20 * 60 * 1000, allowStaleFirst: true } },
      planet: { details: { mode: 'on-demand' } },
    },
    cache_aggressive: {
      label: 'Aggressive Cache',
      galaxy: { stars: { maxPoints: 12000, cacheMaxAgeMs: 12 * 60 * 60 * 1000, alwaysRefreshNetwork: false } },
      system: { payload: { cacheMaxAgeMs: 45 * 60 * 1000, allowStaleFirst: true } },
      planet: { details: { mode: 'on-demand' } },
    },
    always_fresh: {
      label: 'Always Fresh',
      galaxy: { stars: { maxPoints: 12000, cacheMaxAgeMs: 60 * 1000, alwaysRefreshNetwork: true } },
      system: { payload: { cacheMaxAgeMs: 60 * 1000, allowStaleFirst: false } },
      planet: { details: { mode: 'on-demand' } },
    },
  };
  let activePolicyProfile = 'balanced';
  let activePolicyMode = 'auto';
  let activeAutoPolicyReason = '';
  const LEVEL_POLICIES = {
    galaxy: {
      stars: {
        maxPoints: 12000,
        cacheMaxAgeMs: STAR_CACHE_MAX_AGE_MS,
        alwaysRefreshNetwork: false,
      },
    },
    system: {
      payload: {
        cacheMaxAgeMs: SYSTEM_CACHE_MAX_AGE_MS,
        allowStaleFirst: true,
      },
    },
    planet: {
      details: {
        mode: 'on-demand',
      },
    },
  };

  function setFooterLoadProgress(detail = {}) {
    const root = footerLoadUi.root;
    const bar = footerLoadUi.bar;
    const pct = footerLoadUi.pct;
    const queue = footerLoadUi.queue;
    const net = footerLoadUi.net;
    const label = footerLoadUi.label;
    if (!root || !bar || !pct || !queue || !label) return;

    const active = !!detail.active;
    const progress = Math.max(0, Math.min(1, Number(detail.progress || 0)));
    const percent = Math.round(progress * 100);
    const pending = Math.max(0, Number(detail.pending || 0));
    const queued = Math.max(0, Number(detail.queued || 0));
    const inFlight = Math.max(0, Number(detail.inFlight || 0));
    const concurrency = Math.max(0, Number(detail.concurrency || 0));
    const queueTotal = queued + inFlight;

    if (!active && percent <= 0) {
      root.classList.add('hidden');
      bar.style.width = '0%';
      pct.textContent = '0%';
      queue.textContent = 'Q:0|F:0|C:0';
      if (net && !net.textContent) {
        net.textContent = 'NET: ?';
      }
      label.textContent = 'Bereit';
      return;
    }

    root.classList.remove('hidden');
    bar.style.width = `${percent}%`;
    pct.textContent = `${percent}%`;
    queue.textContent = `Q:${queued}|F:${inFlight}|C:${concurrency}`;
    label.textContent = detail.label
      ? String(detail.label)
      : (pending > 1 ? `Lade Daten (${pending})ÔÇª` : 'Lade DatenÔÇª');

    refreshFooterNetworkStatus(false);
  }

  function setFooterNetworkStatus(kind = 'unknown', latencyMs = 0, status = 0) {
    const node = footerLoadUi.net;
    if (!node) return;

    node.classList.remove('footer-net-ok', 'footer-net-warn', 'footer-net-bad', 'footer-net-unknown');

    const latency = Math.max(0, Number(latencyMs || 0));
    const httpStatus = Math.max(0, Number(status || 0));
    const k = String(kind || 'unknown');

    if (k === 'ok') {
      node.textContent = `NET: ${latency}ms`;
      node.classList.add('footer-net-ok');
      return;
    }
    if (k === 'offline') {
      node.textContent = 'NET: offline';
      node.classList.add('footer-net-bad');
      return;
    }
    if (k === 'timeout') {
      node.textContent = 'NET: timeout';
      node.classList.add('footer-net-warn');
      return;
    }
    if (k === 'unreachable') {
      node.textContent = 'NET: unreachable';
      node.classList.add('footer-net-bad');
      return;
    }
    if (k === 'auth') {
      node.textContent = httpStatus > 0 ? `NET: auth ${httpStatus}` : 'NET: auth';
      node.classList.add('footer-net-warn');
      return;
    }
    if (k === 'http') {
      node.textContent = httpStatus > 0 ? `NET: HTTP ${httpStatus}` : 'NET: HTTP';
      node.classList.add('footer-net-warn');
      return;
    }

    node.textContent = 'NET: ?';
    node.classList.add('footer-net-unknown');
  }

  async function refreshFooterNetworkStatus(force = false) {
    if (footerNetworkState.inFlight) return;
    if (typeof API?.networkHealth !== 'function') {
      setFooterNetworkStatus('unknown');
      return;
    }

    const now = Date.now();
    if (!force && (now - footerNetworkState.lastProbeAt) < 5000) return;

    footerNetworkState.inFlight = true;
    footerNetworkState.lastProbeAt = now;
    try {
      const health = await API.networkHealth(!!force);
      const kind = String(health?.kind || (health?.ok ? 'ok' : 'unknown'));
      const latencyMs = Number(health?.latencyMs || 0);
      const status = Number(health?.status || 0);
      setFooterNetworkStatus(kind, latencyMs, status);
    } catch (_) {
      setFooterNetworkStatus(navigator.onLine === false ? 'offline' : 'unknown');
    } finally {
      footerNetworkState.inFlight = false;
    }
  }

  function pushGalaxyDebugError(source, message, extra = '') {
    const src = String(source || 'unknown');
    const msg = String(message || 'unknown error');
    const ex = String(extra || '');
    galaxyDebugState.entries.unshift({
      ts: Date.now(),
      source: src,
      message: msg,
      extra: ex,
    });
    galaxyDebugState.entries = galaxyDebugState.entries.slice(0, galaxyDebugState.maxEntries);
    renderGalaxyDebugPanel();
  }

  function renderGalaxyDebugPanel(rootRef = null) {
    const root = rootRef || WM.body('galaxy');
    const log = root?.querySelector?.('#galaxy-debug-log');
    if (!log) return;

    if (!galaxyDebugState.entries.length) {
      log.innerHTML = '<div class="galaxy-debug-empty">Keine aktuellen Lade-/Renderfehler.</div>';
      return;
    }

    log.innerHTML = galaxyDebugState.entries.map((entry) => {
      const time = new Date(entry.ts).toLocaleTimeString();
      const extra = entry.extra ? `<div class="galaxy-debug-extra">${esc(entry.extra)}</div>` : '';
      return `<div class="galaxy-debug-item">
        <div class="galaxy-debug-head"><span class="galaxy-debug-time">${esc(time)}</span><span class="galaxy-debug-source">${esc(entry.source)}</span></div>
        <div class="galaxy-debug-msg">${esc(entry.message)}</div>
        ${extra}
      </div>`;
    }).join('');
  }

  async function copyLastGalaxyDebugError() {
    const last = galaxyDebugState.entries[0] || null;
    if (!last) {
      showToast('Kein Fehler zum Kopieren vorhanden.', 'info');
      return;
    }
    const payload = `[${new Date(last.ts).toISOString()}] ${last.source}: ${last.message}${last.extra ? ` | ${last.extra}` : ''}`;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const ta = document.createElement('textarea');
        ta.value = payload;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.left = '-10000px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast('Letzter Fehler in Zwischenablage kopiert.', 'success');
    } catch (err) {
      console.error('[GQ] copyLastGalaxyDebugError failed', err);
      showToast('Kopieren fehlgeschlagen.', 'warning');
    }
  }

  function clearGalaxyDebugErrors() {
    galaxyDebugState.entries = [];
    renderGalaxyDebugPanel();
    showToast('Galaxy-Debuglog geleert.', 'info');
  }

  function downloadGalaxyDebugLog() {
    if (!galaxyDebugState.entries.length) {
      showToast('Kein Debuglog zum Download vorhanden.', 'info');
      return;
    }

    const lines = galaxyDebugState.entries
      .slice()
      .reverse()
      .map((entry) => {
        const stamp = new Date(entry.ts).toISOString();
        const extra = entry.extra ? ` | ${entry.extra}` : '';
        return `[${stamp}] ${entry.source}: ${entry.message}${extra}`;
      });

    const content = lines.join('\n') + '\n';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const fileName = `gq-galaxy-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;

    try {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Debuglog heruntergeladen.', 'success');
    } catch (err) {
      console.error('[GQ] downloadGalaxyDebugLog failed', err);
      showToast('Download des Debuglogs fehlgeschlagen.', 'warning');
    }
  }

  window.addEventListener('gq:load-progress', (ev) => {
    setFooterLoadProgress(ev?.detail || {});
  });
  window.addEventListener('gq:load-error', (ev) => {
    const detail = ev?.detail || {};
    const endpoint = String(detail.endpoint || 'unbekannt');
    const context = String(detail.context || 'request');
    const message = String(detail.message || 'Ladevorgang fehlgeschlagen');
    const kind = String(detail.kind || 'unknown');
    if (kind === 'abort' || /aborted|cancelled|canceled|home navigation|view switch|aborterror/i.test(message)) return;
    pushGalaxyDebugError(`api:${context}`, message, endpoint);
    console.error('[GQ][LoadError]', { endpoint, context, kind, message, detail });

    const now = Date.now();
    if ((now - lastLoadErrorToastAt) > 2500) {
      let suffix = '';
      if (kind === 'offline') suffix = ' (Offline)';
      else if (kind === 'unreachable') suffix = ' (API nicht erreichbar)';
      else if (kind === 'timeout') suffix = ' (Timeout)';
      showToast(`Laden fehlgeschlagen (${context}${suffix}): ${message}`, 'error');
      lastLoadErrorToastAt = now;
    }

    if (kind === 'offline' || kind === 'timeout' || kind === 'unreachable' || kind === 'http' || kind === 'auth') {
      setFooterNetworkStatus(kind);
    }

    if (kind === 'auth') {
      redirectToLogin('load-error-auth');
    }
  });

  window.addEventListener('online', () => {
    refreshFooterNetworkStatus(true);
  });
  window.addEventListener('offline', () => {
    setFooterNetworkStatus('offline');
  });

  setFooterNetworkStatus(navigator.onLine === false ? 'offline' : 'unknown');
  refreshFooterNetworkStatus(false);

  function applyPolicyProfile(name) {
    const profileName = POLICY_PROFILES[name] ? name : 'balanced';
    const profile = POLICY_PROFILES[profileName];
    LEVEL_POLICIES.galaxy.stars = Object.assign({}, profile.galaxy.stars);
    LEVEL_POLICIES.system.payload = Object.assign({}, profile.system.payload);
    LEVEL_POLICIES.planet.details = Object.assign({}, profile.planet.details);
    if (galaxyDB && galaxyDB.policies) {
      galaxyDB.policies.starMaxAgeMs = Number(profile.galaxy.stars.cacheMaxAgeMs);
      galaxyDB.policies.systemMaxAgeMs = Number(profile.system.payload.cacheMaxAgeMs);
    }
    activePolicyProfile = profileName;
    try { localStorage.setItem('gq_policy_profile', profileName); } catch (_) {}
  }

  function detectAutoPolicyProfile() {
    try {
      const nav = navigator || {};
      const conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
      const cores = Number(nav.hardwareConcurrency || 0);
      const mem = Number(nav.deviceMemory || 0);
      const saveData = !!conn.saveData;
      const effectiveType = String(conn.effectiveType || '').toLowerCase();
      const isSlowNetwork = effectiveType === 'slow-2g' || effectiveType === '2g';
      const isConstrained = saveData || isSlowNetwork || (cores > 0 && cores <= 4) || (mem > 0 && mem <= 4);
      const isStrong = !saveData && !isSlowNetwork && cores >= 8 && mem >= 8;

      if (isConstrained) {
        return {
          profile: 'cache_aggressive',
          reason: `Auto rule: constrained device/network (cores=${cores || 'n/a'}, mem=${mem || 'n/a'}GB, net=${effectiveType || 'unknown'}, saveData=${saveData ? 'on' : 'off'})`,
        };
      }
      if (isStrong) {
        return {
          profile: 'always_fresh',
          reason: `Auto rule: strong device/network (cores=${cores}, mem=${mem}GB, net=${effectiveType || 'unknown'})`,
        };
      }
      return {
        profile: 'balanced',
        reason: `Auto rule: mixed profile (cores=${cores || 'n/a'}, mem=${mem || 'n/a'}GB, net=${effectiveType || 'unknown'})`,
      };
    } catch (_) {
      return {
        profile: 'balanced',
        reason: 'Auto rule: fallback (device capabilities unavailable).',
      };
    }
  }

  function currentPolicyHintText() {
    if (activePolicyMode === 'auto') {
      return `Auto active -> ${POLICY_PROFILES[activePolicyProfile].label}. ${activeAutoPolicyReason}`;
    }
    return `Manual policy: ${POLICY_PROFILES[activePolicyProfile].label}.`;
  }

  function refreshPolicyUi(root) {
    if (!root) return;
    const select = root.querySelector('#gal-policy-profile');
    if (select) {
      const autoOption = select.querySelector('option[value="auto"]');
      if (autoOption) autoOption.textContent = `Auto (${POLICY_PROFILES[activePolicyProfile].label})`;
      select.value = activePolicyMode === 'auto' ? 'auto' : activePolicyProfile;
    }
    const hint = root.querySelector('#gal-policy-hint');
    if (hint) hint.textContent = currentPolicyHintText();
  }

  function setGalaxyContext(galaxy, system, star = null) {
    uiState.activeGalaxy = Math.max(1, Number(galaxy || uiState.activeGalaxy || 1));
    uiState.activeSystem = Math.max(1, Number(system || uiState.activeSystem || 1));
    if (star) uiState.activeStar = star;
  }

  function resolvePlayerFactionId() {
    const candidates = [
      currentUser?.faction_id,
      currentUser?.home_faction_id,
      currentUser?.primary_faction_id,
      currentUser?.player_faction_id,
      currentUser?.faction?.id,
      currentUser?.faction?.faction_id,
    ];
    for (const candidate of candidates) {
      const id = Number(candidate || 0);
      if (Number.isFinite(id) && id > 0) return id;
    }
    return 0;
  }

  function mapTerritoryFactionsForPlayer(territoryList) {
    const list = Array.isArray(territoryList) ? territoryList : [];
    const playerFactionId = resolvePlayerFactionId();
    return list.map((faction) => {
      const factionId = Number(faction?.id || faction?.faction_id || 0);
      const isPlayer = playerFactionId > 0 && factionId > 0 && factionId === playerFactionId;
      return Object.assign({}, faction, { __isPlayer: isPlayer });
    });
  }

  function resolveClusterColorPalette(territoryList) {
    const list = Array.isArray(territoryList) ? territoryList : [];
    const playerFaction = list.find((f) => f?.__isPlayer) || null;
    return {
      player: String(playerFaction?.color || '#5de0a0'),
      pve: '#ff7b72',
      neutral: '#6a8cc9',
    };
  }

  function setColonyViewFocus(colonyId, focusBuilding = '', source = 'manual') {
    uiState.colonyViewFocus = {
      colonyId: Number(colonyId || 0),
      focusBuilding: String(focusBuilding || ''),
      source: String(source || 'manual'),
      ts: Date.now(),
    };
  }

  function getRecommendedBuildingFocus(colony) {
    if (!colony) return 'colony_hq';
    const type = String(colony.colony_type || '').toLowerCase();
    if (type === 'mining') return 'metal_mine';
    if (type === 'industrial') return 'robotics_factory';
    if (type === 'research') return 'research_lab';
    if (type === 'agricultural') return 'hydroponic_farm';
    if (type === 'military') return 'shipyard';
    return 'colony_hq';
  }

  function getBuildingUiMeta(type) {
    return BUILDING_UI_META[String(type || '')] || { cat:'Other', icon:'­ƒÅù', desc:'' };
  }

  function pickZoneBuildFocus(zone, colony, buildings = []) {
    const normalizedZone = String(zone || 'flex');
    const priorities = BUILDING_ZONE_PRIORITY[normalizedZone] || BUILDING_ZONE_PRIORITY.flex;
    const existing = new Set((buildings || []).map((building) => String(building.type || '')));
    const missing = priorities.find((type) => !existing.has(type));
    return missing || priorities[0] || getRecommendedBuildingFocus(colony);
  }

  function focusColonyDevelopment(colonyId, opts = {}) {
    const colony = colonies.find((col) => Number(col.id || 0) === Number(colonyId || 0));
    if (!colony) return;
    const focusBuilding = String(opts.focusBuilding || getRecommendedBuildingFocus(colony));
    setColonyViewFocus(colony.id, focusBuilding, opts.source || 'planet');
    selectColonyById(colony.id, {
      openWindows: true,
      focusBuilding,
      openOverview: !!opts.openOverview,
    });
  }

  // Attaches faction data (from separate factions API) to backend-provided cluster objects.
  function assignClusterFactions(clusters, territory) {
    const claims = Array.isArray(territory) ? territory : [];
    return (Array.isArray(clusters) ? clusters : []).map((cluster, index) =>
      Object.assign({}, cluster, { faction: claims.length ? claims[index % claims.length] : null })
    );
  }

  function applyPolicyMode(mode, explicitProfile) {
    const normalizedMode = mode === 'manual' ? 'manual' : 'auto';
    activePolicyMode = normalizedMode;
    let nextProfile = 'balanced';

    if (normalizedMode === 'manual') {
      nextProfile = POLICY_PROFILES[explicitProfile] ? explicitProfile : activePolicyProfile;
      activeAutoPolicyReason = '';
    } else {
      const autoDecision = detectAutoPolicyProfile();
      nextProfile = autoDecision.profile;
      activeAutoPolicyReason = autoDecision.reason;
    }

    applyPolicyProfile(nextProfile);
    try {
      localStorage.setItem('gq_policy_mode', activePolicyMode);
      if (normalizedMode === 'manual' && POLICY_PROFILES[nextProfile]) {
        localStorage.setItem('gq_policy_profile_manual', nextProfile);
      }
    } catch (_) {}
  }

  (() => {
    try {
      const savedMode = localStorage.getItem('gq_policy_mode');
      const savedManual = localStorage.getItem('gq_policy_profile_manual');
      const savedLegacy = localStorage.getItem('gq_policy_profile');
      if (savedMode === 'manual' && savedManual && POLICY_PROFILES[savedManual]) {
        applyPolicyMode('manual', savedManual);
        return;
      }
      if (savedMode === 'manual' && savedLegacy && POLICY_PROFILES[savedLegacy]) {
        applyPolicyMode('manual', savedLegacy);
        return;
      }
      applyPolicyMode('auto');
    } catch (_) {
      applyPolicyMode('auto');
    }
  })();

  if (galaxyDB) {
    galaxyDB.init().catch(() => {
      showToast('Browser DB fallback active (memory only).', 'warning');
    });
    setInterval(() => {
      galaxyDB.prune().catch(() => {});
    }, 5 * 60 * 1000);
  }

  window.GQGalaxyModelStore = galaxyModel;
  window.GQGalaxyDBStore = galaxyDB;

  setInterval(() => {
    sendPerfTelemetrySnapshot('interval').catch(() => {});
  }, PERF_TELEMETRY_INTERVAL_MS);

  // ÔöÇÔöÇ Utilities ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  function fmt(n) {
    n = parseFloat(n);
    if (isNaN(n)) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return Math.floor(n).toLocaleString();
  }

  function fmtName(type) {
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function isPerfTelemetryOptIn() {
    try {
      return window.localStorage?.getItem(PERF_TELEMETRY_OPT_IN_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setPerfTelemetryOptIn(enabled) {
    try {
      window.localStorage?.setItem(PERF_TELEMETRY_OPT_IN_KEY, enabled ? '1' : '0');
      return true;
    } catch (_) {
      return false;
    }
  }

  async function sendPerfTelemetrySnapshot(reason = 'interval') {
    if (!isPerfTelemetryOptIn()) return false;
    if (!API || typeof API.perfTelemetry !== 'function') return false;
    if (!galaxy3d || typeof galaxy3d.getRenderStats !== 'function') return false;

    const stats = galaxy3d.getRenderStats() || {};
    const payload = {
      opt_in: true,
      source: 'galaxy',
      reason: String(reason || 'interval'),
      app_version: String(window.GQ_BOOT_CONFIG?.version || ''),
      assets_manifest_version: Number(uiState.assetsManifestVersion || window.GQ_ASSETS_MANIFEST_VERSION || 1),
      render_schema_version: Number(window.GQRenderDataAdapter?.renderSchemaVersion || 1),
      metrics: {
        rawStars: Number(stats.rawStars || 0),
        visibleStars: Number(stats.visibleStars || 0),
        clusterCount: Number(stats.clusterCount || 0),
        targetPoints: Number(stats.targetPoints || 0),
        densityRatio: Number(stats.densityRatio || 0),
        densityMode: String(stats.densityMode || 'auto'),
        lodProfile: String(stats.lodProfile || 'medium'),
        qualityProfile: String(stats.qualityProfile || 'medium'),
        pixelRatio: Number(stats.pixelRatio || 1),
        cameraDistance: Number(stats.cameraDistance || 0),
        instancingCandidates: Number(stats.instancingCandidates || 0),
        lightRig: String(stats.lightRig || ''),
      },
    };

    try {
      const res = await API.perfTelemetry(payload);
      return !!res?.success;
    } catch (_) {
      return false;
    }
  }

  function countdown(endTime) {
    const secs = Math.max(0, Math.round((new Date(endTime) - Date.now()) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  }

  function showToast(msg, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `toast ${type}`;
    el.classList.remove('hidden');
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => el.classList.add('hidden'), 3500);
    if (audioManager) {
      if (type === 'error' || type === 'warning') audioManager.playUiError();
      else if (type === 'success') audioManager.playUiConfirm();
      else audioManager.playUiNotify();
    }
  }

  function showToastWithAction(msg, type = 'info', actionLabel = '', onAction = null, timeoutMs = 7000) {
    const el = document.getElementById('toast');
    if (!el) return;

    el.innerHTML = '';
    el.className = `toast ${type}`;

    const textNode = document.createElement('span');
    textNode.className = 'toast-message';
    textNode.textContent = String(msg || '');
    el.appendChild(textNode);

    if (actionLabel) {
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'toast-action-btn';
      actionBtn.textContent = String(actionLabel);
      actionBtn.addEventListener('click', () => {
        try {
          if (typeof onAction === 'function') onAction();
        } finally {
          el.classList.add('hidden');
        }
      });
      el.appendChild(actionBtn);
    }

    el.classList.remove('hidden');
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => el.classList.add('hidden'), Math.max(1200, Number(timeoutMs || 7000)));

    if (audioManager) {
      if (type === 'error' || type === 'warning') audioManager.playUiError();
      else if (type === 'success') audioManager.playUiConfirm();
      else audioManager.playUiNotify();
    }
  }

  function ensureMessageSignalLayer() {
    if (messageSignalState.host && document.body.contains(messageSignalState.host)) {
      return messageSignalState.host;
    }
    const host = document.createElement('aside');
    host.id = 'global-message-signals';
    host.className = 'global-message-signals hidden';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-label', 'Nachrichten-Signale');

    const levels = [
      { key: 'danger', label: 'Gefahr', colorClass: 'danger' },
      { key: 'success', label: 'Erfolg', colorClass: 'success' },
      { key: 'info', label: 'Info', colorClass: 'info' },
    ];
    levels.forEach((level) => {
      const ring = document.createElement('div');
      ring.className = `message-signal-ring ${level.colorClass}`;
      ring.setAttribute('data-level', level.key);
      ring.setAttribute('title', `${level.label}-Meldungen`);
      ring.innerHTML = `
        <span class="ring-core"></span>
        <span class="ring-wave"></span>
        <span class="ring-wave delay"></span>
        <span class="ring-count">0</span>
      `;
      host.appendChild(ring);
      messageSignalState.rings[level.key] = ring;
    });

    document.body.appendChild(host);
    messageSignalState.host = host;
    return host;
  }

  function classifyMessageSignalLevel(message) {
    const subject = String(message?.subject || '').toLowerCase();
    const body = String(message?.body || '').toLowerCase();
    const text = `${subject} ${body}`;

    const dangerPattern = /(attacked|attack|battle|raid|defeat|defeated|under attack|hostile|war|lost|alarm|danger|failed|gescheitert|angegriffen|verloren|niederlage)/i;
    const successPattern = /(complete|completed|established|finished|success|reward|quest completed|repelled|fertig|abgeschlossen|errichtet|gebaut|erfolgreich|gewonnen)/i;

    if (dangerPattern.test(text)) return 'danger';
    if (successPattern.test(text)) return 'success';
    return 'info';
  }

  function updateMessageSignalsFromInbox(messages) {
    const host = ensureMessageSignalLayer();
    const now = Date.now();
    const list = Array.isArray(messages) ? messages : [];
    const unread = list.filter((message) => !parseInt(message?.is_read, 10));
    const unreadByLevel = { danger: 0, success: 0, info: 0 };
    const nextUnreadIds = new Set();

    unread.forEach((message) => {
      const id = Number(message?.id || 0);
      if (id > 0) nextUnreadIds.add(id);
      const level = classifyMessageSignalLevel(message);
      unreadByLevel[level] += 1;
    });

    if (!messageSignalState.bootstrapped) {
      messageSignalState.unreadIds = nextUnreadIds;
      messageSignalState.unreadByLevel = unreadByLevel;
      messageSignalState.bootstrapped = true;
    } else {
      unread.forEach((message) => {
        const id = Number(message?.id || 0);
        if (id <= 0 || messageSignalState.unreadIds.has(id)) return;
        const level = classifyMessageSignalLevel(message);
        messageSignalState.flashUntilByLevel[level] = Math.max(
          Number(messageSignalState.flashUntilByLevel[level] || 0),
          now + 14000
        );
      });
      messageSignalState.unreadIds = nextUnreadIds;
      messageSignalState.unreadByLevel = unreadByLevel;
    }

    let activeAny = false;
    let dominantLevel = '';
    let dominantScore = -1;
    ['danger', 'success', 'info'].forEach((level) => {
      const ring = messageSignalState.rings[level];
      if (!ring) return;
      const unreadCount = Number(unreadByLevel[level] || 0);
      const flashing = now < Number(messageSignalState.flashUntilByLevel[level] || 0);
      const active = unreadCount > 0 || flashing;
      const score = (Number(messageSignalState.levelPriority[level] || 0) * 1000) + (unreadCount * 10) + (flashing ? 1 : 0);
      ring.classList.toggle('active', active);
      ring.classList.toggle('flash', flashing);
      const countEl = ring.querySelector('.ring-count');
      if (countEl) countEl.textContent = String(Math.max(0, unreadCount));
      const label = String(messageSignalState.levelLabel[level] || level);
      ring.setAttribute('title', `${label}: ${unreadCount} ungelesen`);
      ring.style.order = String(10 - Number(messageSignalState.levelPriority[level] || 0));
      if (active && score > dominantScore) {
        dominantScore = score;
        dominantLevel = level;
      }
      activeAny = activeAny || active;
    });

    ['danger', 'success', 'info'].forEach((level) => {
      const ring = messageSignalState.rings[level];
      if (!ring) return;
      ring.classList.toggle('dominant', activeAny && level === dominantLevel);
    });

    host.classList.toggle('danger-priority', dominantLevel === 'danger');
    host.classList.toggle('hidden', !activeAny);
  }

  class UIConsoleController {
    constructor(store) {
      this.store = store;
      this.initialized = false;
    }

    push(line) {
      if (!this.store.push(line)) return false;
      this.render();
      return true;
    }

    getVisibleLines() {
      return this.store.getVisibleLines();
    }

    async copyToClipboard() {
      const lines = this.getVisibleLines();
      if (!lines.length) {
        showToast('Keine Console-Zeilen zum Kopieren.', 'info');
        return;
      }
      const payload = lines.join('\n');
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(payload);
        } else {
          const ta = document.createElement('textarea');
          ta.value = payload;
          ta.setAttribute('readonly', 'readonly');
          ta.style.position = 'fixed';
          ta.style.left = '-10000px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        showToast(`Console kopiert (${lines.length} Zeilen).`, 'success');
      } catch (err) {
        console.error('[GQ] copyUiConsoleToClipboard failed', err);
        showToast('Kopieren der Console fehlgeschlagen.', 'warning');
      }
    }

    render() {
      const log = document.getElementById('ui-console-log');
      if (!log) return;
      const visibleLines = this.getVisibleLines();
      log.innerHTML = visibleLines.map((line) => `<div>${esc(line)}</div>`).join('');
      log.scrollTop = log.scrollHeight;
    }

    hydrateFromTerminal() {
      if (!(window.GQLog && typeof window.GQLog.getAll === 'function')) return;
      const source = typeof window.GQLog.getSessionEntries === 'function'
        ? window.GQLog.getSessionEntries()
        : window.GQLog.getAll();
      const history = source.slice(-25);
      history.forEach((entry) => {
        const level = String(entry?.level || 'log').toUpperCase();
        const sourceName = String(entry?.source || 'app');
        const text = String(entry?.text || '');
        this.push(`[${level}] [${sourceName}] ${text}`);
      });
    }

    bindTerminalLogStream() {
      if (window.__gqTerminalLogBound) return;
      window.__gqTerminalLogBound = true;
      window.addEventListener('gq:terminal-log', (ev) => {
        const entry = ev?.detail || {};
        const level = String(entry.level || 'log').toUpperCase();
        const source = String(entry.source || 'app');
        const text = String(entry.text || '');
        this.push(`[${level}] [${source}] ${text}`);
      });
    }

    setOpen(open, panel, toggleBtn, input) {
      panel.classList.toggle('hidden', !open);
      toggleBtn.textContent = open ? 'Ôîâ Console' : 'Ôîä Console';
      if (open) {
        this.render();
        input.focus();
      }
    }

    init() {
      if (this.initialized) return true;
      const panel = document.getElementById('ui-console-panel') || document.getElementById('boot-terminal');
      const toggleBtn = document.getElementById('ui-console-toggle');
      const closeBtn = document.getElementById('ui-console-close');
      const clearBtn = document.getElementById('ui-console-clear');
      const copyBtn = document.getElementById('ui-console-copy');
      const filterSelect = document.getElementById('ui-console-filter');
      const runBtn = document.getElementById('ui-console-run');
      const input = document.getElementById('ui-console-input');
      if (!panel || !toggleBtn || !runBtn || !input) return false;

      this.hydrateFromTerminal();
      this.bindTerminalLogStream();

      toggleBtn.addEventListener('click', () => this.setOpen(panel.classList.contains('hidden'), panel, toggleBtn, input));
      closeBtn?.addEventListener('click', () => this.setOpen(false, panel, toggleBtn, input));
      clearBtn?.addEventListener('click', () => {
        this.store.clear();
        this.render();
      });
      copyBtn?.addEventListener('click', async () => {
        await this.copyToClipboard();
      });
      filterSelect?.addEventListener('change', () => {
        this.store.setFilter(filterSelect.value || 'all');
        this.render();
      });
      runBtn.addEventListener('click', async () => {
        const cmd = input.value;
        input.value = '';
        await runUiConsoleCommand(cmd);
      });
      input.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const cmd = input.value;
        input.value = '';
        await runUiConsoleCommand(cmd);
      });

      // Sync toggle button text with current panel visibility (unified panel may already be visible)
      if (toggleBtn) toggleBtn.textContent = panel.classList.contains('hidden') ? 'Ôîä Con' : 'Ôîâ Con';

      window.__gqUiConsoleReady = true;
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('gq:ui-console-ready', {
          detail: { panelId: panel.id, logId: 'ui-console-log' },
        }));
      }

      this.initialized = true;
      return true;
    }
  }

  const uiConsoleController = new UIConsoleController(uiConsoleStore);
  window.GQUIConsoleController = uiConsoleController;

  function uiConsolePush(line) {
    uiConsoleController.push(line);
  }

  function getUiConsoleVisibleLines() {
    return uiConsoleController.getVisibleLines();
  }

  async function copyUiConsoleToClipboard() {
    await uiConsoleController.copyToClipboard();
  }

  function renderUiConsole() {
    uiConsoleController.render();
  }

  function inspectGalaxyCanvasLayering() {
    const stage = document.querySelector('.galaxy-3d-stage') || document.getElementById('galaxy-stage');
    const canvas = document.getElementById('starfield');
    const desktop = document.body;
    const report = {
      ok: !!canvas,
      bodyClass: String(document.body.className || ''),
      canvas: null,
      stage: null,
      desktop: null,
      windows: [],
      topElementsAtCanvas: [],
    };

    const styleOf = (el) => {
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        id: String(el.id || ''),
        className: String(el.className || ''),
        display: String(cs.display || ''),
        visibility: String(cs.visibility || ''),
        opacity: Number(cs.opacity || 0),
        pointerEvents: String(cs.pointerEvents || ''),
        position: String(cs.position || ''),
        zIndex: String(cs.zIndex || ''),
        width: Math.round(Number(r.width || 0)),
        height: Math.round(Number(r.height || 0)),
        top: Math.round(Number(r.top || 0)),
        left: Math.round(Number(r.left || 0)),
      };
    };

    report.canvas = styleOf(canvas);
    report.stage = styleOf(stage);
    report.desktop = styleOf(desktop);

    document.querySelectorAll('.wm-window').forEach((el) => {
      const item = styleOf(el);
      if (item) report.windows.push(item);
    });

    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const points = [
        [Math.round(rect.left + rect.width * 0.5), Math.round(rect.top + rect.height * 0.5)],
        [Math.round(rect.left + rect.width * 0.2), Math.round(rect.top + rect.height * 0.25)],
        [Math.round(rect.left + rect.width * 0.8), Math.round(rect.top + rect.height * 0.75)],
      ];
      points.forEach(([x, y]) => {
        const top = document.elementFromPoint(x, y);
        report.topElementsAtCanvas.push({
          x,
          y,
          topId: String(top?.id || ''),
          topClass: String(top?.className || ''),
          topTag: String(top?.tagName || ''),
        });
      });
    }

    return report;
  }

  window.GQGalaxyCanvasDebug = {
    inspect: inspectGalaxyCanvasLayering,
  };

  class UIConsoleCommandController {
    async execute(raw) {
      const input = String(raw || '').trim();
      if (!input) return;
      uiConsolePush(`> ${input}`);

      const parts = input.split(/\s+/).filter(Boolean);
      const cmd = String(parts[0] || '').toLowerCase();
      const normalizedInput = String(input || '').trim().toLowerCase();

      if (cmd === 'help' || cmd === '?') {
        uiConsolePush('[help] refresh | home | galaxy | galdiag | galinspect | galdebug | galprobe [sec] | perftelemetry on/off/status/send | open <window> | transitions on/off/status | term debug on/off/status | term clear | term download | msg <user> <text> | copy | clear');
        return;
      }
      if (cmd === 'copy') {
        await copyUiConsoleToClipboard();
        return;
      }
      if (cmd === 'clear') {
        uiConsoleStore.clear();
        renderUiConsole();
        return;
      }
      if (cmd === 'refresh') {
        await loadOverview();
        uiConsolePush('[ok] Overview refreshed.');
        return;
      }
      if (cmd === 'home') {
        WM.open('galaxy');
        const root = WM.body('galaxy');
        if (root) await focusHomeSystemInGalaxy(root);
        uiConsolePush('[ok] Jumped to home system.');
        return;
      }
      if (cmd === 'galaxy') {
        WM.open('galaxy');
        uiConsolePush('[ok] Galaxy window opened.');
        return;
      }
      if (
        cmd === 'galdiag'
        || cmd === 'galinspect'
        || normalizedInput === 'gqgalaxycanvasdebug.inspect()'
        || normalizedInput === 'gqgalaxycanvasdebug.inspect'
        || (cmd === 'galaxy' && String(parts[1] || '').toLowerCase() === 'diag')
      ) {
        const diag = inspectGalaxyCanvasLayering();
        uiConsolePush(`[diag] body=${diag.bodyClass || '(none)'}`);
        uiConsolePush(`[diag] stage z=${diag.stage?.zIndex || 'n/a'} display=${diag.stage?.display || 'n/a'} vis=${diag.stage?.visibility || 'n/a'} size=${diag.stage?.width || 0}x${diag.stage?.height || 0}`);
        uiConsolePush(`[diag] canvas z=${diag.canvas?.zIndex || 'n/a'} display=${diag.canvas?.display || 'n/a'} vis=${diag.canvas?.visibility || 'n/a'} op=${diag.canvas?.opacity ?? 'n/a'} size=${diag.canvas?.width || 0}x${diag.canvas?.height || 0}`);
        uiConsolePush(`[diag] desktop z=${diag.desktop?.zIndex || 'n/a'} display=${diag.desktop?.display || 'n/a'} vis=${diag.desktop?.visibility || 'n/a'} size=${diag.desktop?.width || 0}x${diag.desktop?.height || 0}`);
        const topInfo = (diag.topElementsAtCanvas || []).map((p) => `${p.x},${p.y}->${p.topTag}${p.topId ? '#' + p.topId : ''}`).join(' | ');
        uiConsolePush(`[diag] elementFromPoint: ${topInfo || 'n/a'}`);
        const visibleWindows = (diag.windows || []).filter((w) => w.display !== 'none' && w.visibility !== 'hidden' && (w.width > 0 && w.height > 0));
        uiConsolePush(`[diag] wm windows visible=${visibleWindows.length}`);
        visibleWindows.slice(0, 6).forEach((w) => {
          uiConsolePush(`[diag] win ${w.id || '(no-id)'} z=${w.zIndex} pos=${w.left},${w.top} size=${w.width}x${w.height}`);
        });
        try { console.table(diag.windows || []); } catch (_) {}
        try { console.log('[GQ][galdiag]', diag); } catch (_) {}
        return;
      }
      if (cmd === 'galdebug') {
        uiConsolePush('[galdebug] === Galaxy3D Renderer Status ===');
        if (!galaxy3d) {
          uiConsolePush('[galdebug] galaxy3d is NULL');
          return;
        }
        const stats = (typeof galaxy3d.getRenderStats === 'function') ? galaxy3d.getRenderStats() : null;
        uiConsolePush(`[galdebug] visible stars: ${stats?.visibleStars || 0}`);
        uiConsolePush(`[galdebug] target points: ${stats?.targetPoints || 0}`);
        uiConsolePush(`[galdebug] density mode: ${stats?.densityMode || 'n/a'}`);
        uiConsolePush(`[galdebug] starPoints: ${galaxy3d.starPoints ? 'exists' : 'NULL'}`);
        if (galaxy3d.starPoints) {
          uiConsolePush(`[galdebug] starPoints.visible: ${galaxy3d.starPoints.visible}`);
          uiConsolePush(`[galdebug] starPoints.material: ${galaxy3d.starPoints.material?.constructor?.name || 'unknown'}`);
          uiConsolePush(`[galdebug] starPoints.geometry.attributes.position.count: ${galaxy3d.starPoints.geometry?.attributes?.position?.count || 0}`);
        }
        uiConsolePush(`[galdebug] renderFrames.galaxy.visible: ${galaxy3d.renderFrames?.galaxy?.visible ?? 'n/a'}`);
        uiConsolePush(`[galdebug] renderFrames.galaxy children: ${galaxy3d.renderFrames?.galaxy?.children?.length || 0}`);
        if (galaxy3d.renderFrames?.galaxy) {
          const starPointsInScene = galaxy3d.renderFrames.galaxy.children.includes(galaxy3d.starPoints);
          uiConsolePush(`[galdebug] starPoints in scene: ${starPointsInScene}`);
        }
        uiConsolePush(`[galdebug] camera position: ${galaxy3d.camera?.position?.x?.toFixed(1) || 'n/a'}, ${galaxy3d.camera?.position?.y?.toFixed(1) || 'n/a'}, ${galaxy3d.camera?.position?.z?.toFixed(1) || 'n/a'}`);
        try { console.log('[GQ][galdebug]', { galaxy3d, stats }); } catch (_) {}
        return;
      }
      if (cmd === 'galprobe') {
        const sec = Math.max(2, Math.min(20, Number(parts[1] || 6)));
        const canvas = document.getElementById('starfield');
        if (!(canvas instanceof HTMLCanvasElement)) {
          uiConsolePush('[galprobe] canvas #starfield nicht gefunden.');
          return;
        }
        const counters = {
          mousemove: 0,
          mousedown: 0,
          mouseup: 0,
          click: 0,
          dblclick: 0,
          wheel: 0,
          contextmenu: 0,
        };
        const opts = { capture: true, passive: false };
        const bump = (key) => (e) => {
          counters[key] += 1;
          if (key === 'wheel' || key === 'contextmenu') {
            // Nur Telemetrie; Verhalten nicht veraendern.
            void e;
          }
        };
        const handlers = {
          mousemove: bump('mousemove'),
          mousedown: bump('mousedown'),
          mouseup: bump('mouseup'),
          click: bump('click'),
          dblclick: bump('dblclick'),
          wheel: bump('wheel'),
          contextmenu: bump('contextmenu'),
        };

        Object.keys(handlers).forEach((type) => {
          canvas.addEventListener(type, handlers[type], opts);
        });

        uiConsolePush(`[galprobe] Starte Event-Probe fuer ${sec}s auf #starfield ...`);
        setTimeout(() => {
          Object.keys(handlers).forEach((type) => {
            canvas.removeEventListener(type, handlers[type], opts);
          });
          uiConsolePush('[galprobe] Ergebnis: '
            + `move=${counters.mousemove}, down=${counters.mousedown}, up=${counters.mouseup}, `
            + `click=${counters.click}, dbl=${counters.dblclick}, wheel=${counters.wheel}, ctx=${counters.contextmenu}`);
          try { console.log('[GQ][galprobe]', counters); } catch (_) {}
        }, Math.round(sec * 1000));
        return;
      }
      if (cmd === 'perftelemetry') {
        const arg = String(parts[1] || '').toLowerCase();
        if (arg === 'status') {
          uiConsolePush(`[state] perftelemetry=${isPerfTelemetryOptIn() ? 'on' : 'off'}`);
          return;
        }
        if (arg === 'on' || arg === 'off') {
          const ok = setPerfTelemetryOptIn(arg === 'on');
          if (!ok) {
            uiConsolePush('[error] Konnte Opt-In nicht speichern.');
            return;
          }
          uiConsolePush(`[ok] perftelemetry=${arg}`);
          return;
        }
        if (arg === 'send') {
          const sent = await sendPerfTelemetrySnapshot('manual');
          uiConsolePush(sent ? '[ok] Perf-Telemetrie gesendet.' : '[warn] Perf-Telemetrie nicht gesendet (Opt-In aus oder keine Renderer-Daten).');
          return;
        }
        if (arg === 'summary') {
          const mins = Math.max(5, Math.min(24 * 60, Number(parts[2] || 60)));
          if (!API || typeof API.perfTelemetrySummary !== 'function') {
            uiConsolePush('[error] Perf-Telemetrie-Summary API nicht verfuegbar.');
            return;
          }
          const formatBytes = (input) => {
            const bytes = Math.max(0, Number(input || 0));
            if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let value = bytes;
            let idx = 0;
            while (value >= 1024 && idx < units.length - 1) {
              value /= 1024;
              idx += 1;
            }
            const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
            return `${value.toFixed(digits)} ${units[idx]}`;
          };
          try {
            const res = await API.perfTelemetrySummary({ minutes: mins, source: 'galaxy' });
            if (!res?.success) {
              uiConsolePush(`[error] ${res?.error || 'summary failed'}`);
              return;
            }
            const s = res.summary || {};
            const storage = res.storage || {};
            const today = storage.today || {};
            const limits = storage.limits || {};
            const fps = s.fps || {};
            const ft = s.frame_time_ms || {};
            const dc = s.draw_calls || {};
            uiConsolePush(`[perf] summary ${mins}m events=${res.count || 0}`);
            uiConsolePush(`[perf] fps avg=${fps.avg ?? 'n/a'} p95=${fps.p95 ?? 'n/a'} min=${fps.min ?? 'n/a'}`);
            uiConsolePush(`[perf] frameMs avg=${ft.avg ?? 'n/a'} p95=${ft.p95 ?? 'n/a'} max=${ft.max ?? 'n/a'}`);
            uiConsolePush(`[perf] drawCalls avg=${dc.avg ?? 'n/a'} p95=${dc.p95 ?? 'n/a'} max=${dc.max ?? 'n/a'}`);
            uiConsolePush(`[perf] storage files=${storage.files_count ?? 0} total=${formatBytes(storage.total_bytes)} latest=${storage.latest_file || 'n/a'} (${formatBytes(storage.latest_size_bytes)})`);
            uiConsolePush(`[perf] shards date=${today.date || 'n/a'} count=${today.shards ?? 0} maxShard=${today.max_shard ?? 0}`);
            uiConsolePush(`[perf] rotation maxFile=${formatBytes(limits.max_file_bytes)} maxShards=${limits.max_shards ?? 'n/a'} retention=${limits.retention_days ?? 'n/a'}d`);
          } catch (e) {
            uiConsolePush(`[error] ${String(e?.message || e || 'summary failed')}`);
          }
          return;
        }
        uiConsolePush('[usage] perftelemetry on|off|status|send|summary [minutes]');
        return;
      }
      if (cmd === 'open') {
        const win = String(parts[1] || '').toLowerCase();
        const valid = new Set(['overview','buildings','colony','research','shipyard','fleet','galaxy','messages','quests','leaderboard','leaders','factions','settings']);
        if (!valid.has(win)) {
          uiConsolePush('[error] Unknown window.');
          return;
        }
        WM.open(win);
        uiConsolePush(`[ok] Opened ${win}.`);
        return;
      }
      if (cmd === 'transitions') {
        const arg = String(parts[1] || '').toLowerCase();
        if (arg === 'status') {
          uiConsolePush(`[state] transitions=${settingsState.autoTransitions ? 'on' : 'off'}`);
          return;
        }
        if (arg === 'on' || arg === 'off') {
          settingsState.autoTransitions = arg === 'on';
          applyRuntimeSettings();
          saveUiSettings();
          uiConsolePush(`[ok] transitions=${arg}`);
          return;
        }
        uiConsolePush('[usage] transitions on|off|status');
        return;
      }
      if (cmd === 'msg') {
        if (parts.length < 3) {
          uiConsolePush('[usage] msg <user> <text>');
          return;
        }
        const to = parts[1];
        const body = input.split(/\s+/).slice(2).join(' ').trim();
        const r = await API.sendMsg(to, 'Direct Message', body);
        if (r.success) {
          if (audioManager && typeof audioManager.playMessageSend === 'function') audioManager.playMessageSend();
          uiConsolePush(`[ok] message sent to ${to}`);
        }
        else uiConsolePush(`[error] ${r.error || 'send failed'}`);
        return;
      }

      if (cmd === 'term' || cmd === 'terminal') {
        const sub = String(parts[1] || '').toLowerCase();
        if (!window.GQLog) {
          uiConsolePush('[error] Terminal logger nicht verfuegbar.');
          return;
        }
        if (sub === 'clear') {
          window.GQLog.clear();
          uiConsolePush('[ok] Terminal-Log geleert.');
          return;
        }
        if (sub === 'download') {
          window.GQLog.download();
          uiConsolePush('[ok] Terminal-Log Download gestartet.');
          return;
        }
        if (sub === 'debug') {
          const mode = String(parts[2] || '').toLowerCase();
          if (mode === 'status') {
            uiConsolePush(`[state] term.debug=${window.GQLog.debugEnabled() ? 'on' : 'off'}`);
            return;
          }
          if (mode === 'on' || mode === 'off') {
            window.GQLog.setDebugEnabled(mode === 'on');
            uiConsolePush(`[ok] term.debug=${mode}`);
            return;
          }
          uiConsolePush('[usage] term debug on|off|status');
          return;
        }
        if (sub === 'trace') {
          const mode = String(parts[2] || '').toLowerCase();
          if (mode === 'status') {
            uiConsolePush(`[state] term.trace=${window.GQLog.traceEnabled() ? 'on' : 'off'}`);
            return;
          }
          if (mode === 'on' || mode === 'off') {
            window.GQLog.setTraceEnabled(mode === 'on');
            window.GQLog.instrumentNow();
            uiConsolePush(`[ok] term.trace=${mode}`);
            return;
          }
          uiConsolePush('[usage] term trace on|off|status');
          return;
        }
        if (sub === 'instrument') {
          const count = Number(window.GQLog.instrumentNow() || 0);
          uiConsolePush(`[ok] Instrumentierung ausgefuehrt (+${count}).`);
          return;
        }
        uiConsolePush('[usage] term clear | term download | term debug on|off|status | term trace on|off|status | term instrument');
        return;
      }

      uiConsolePush(`[error] Unknown command: ${cmd}`);
    }
  }

  const uiConsoleCommandController = new UIConsoleCommandController();
  window.GQUIConsoleCommandController = uiConsoleCommandController;

  async function runUiConsoleCommand(raw) {
    await uiConsoleCommandController.execute(raw);
  }

  function initUiConsole() {
    uiConsoleController.init();
  }

  class SettingsController {
    refreshAudioUi() {
      const btn = document.getElementById('audio-toggle-btn');
      const topbarTrack = document.getElementById('topbar-player-track');
      const topbarToggle = document.getElementById('topbar-player-toggle');
      const topbarCurrent = document.getElementById('topbar-player-current');
      const topbarMode = document.getElementById('topbar-player-mode');
      if (!btn) return;
      if (!audioManager) {
        btn.disabled = true;
        btn.textContent = '­ƒöç';
        btn.title = 'Audio nicht verfuegbar';
        if (topbarTrack) topbarTrack.disabled = true;
        if (topbarToggle) {
          topbarToggle.disabled = true;
          topbarToggle.textContent = 'ÔûÂ';
          topbarToggle.title = 'Musik nicht verfuegbar';
          topbarToggle.setAttribute('aria-label', 'Musik nicht verfuegbar');
        }
        if (topbarCurrent) {
          topbarCurrent.textContent = '-';
          topbarCurrent.title = 'Kein aktiver Track';
        }
        if (topbarMode) {
          topbarMode.textContent = 'N/A';
          topbarMode.title = 'Transition-Modus nicht verfuegbar';
        }
        renderTopbarTrackQuickList('');
        return;
      }
      const state = audioManager.snapshot();
      const muted = !!state.masterMuted;
      btn.disabled = false;
      btn.textContent = muted ? '­ƒöç' : '­ƒöè';
      btn.title = muted ? 'Audio aktivieren' : 'Audio stummschalten';

      if (topbarTrack) {
        topbarTrack.disabled = false;
        const activeTrack = String(state.musicUrl || settingsState.musicUrl || '').trim();
        if (activeTrack && Array.isArray(audioTrackOptions) && audioTrackOptions.some((entry) => String(entry.value) === activeTrack)) {
          topbarTrack.value = activeTrack;
        }
      }
      const activeTrackForList = String(state.musicUrl || settingsState.musicUrl || '').trim();
      renderTopbarTrackQuickList(activeTrackForList);
      if (topbarCurrent) {
        const activeTrack = String(state.musicUrl || settingsState.musicUrl || '').trim();
        const label = resolveAudioTrackLabel(activeTrack);
        updateTopbarTrackTicker(label);
        topbarCurrent.title = activeTrack ? `Aktueller Track: ${label}` : 'Kein aktiver Track';
      }
      if (topbarToggle) {
        topbarToggle.disabled = false;
        const playing = !!state.musicPlaying;
        topbarToggle.textContent = playing ? 'ÔÅ©' : 'ÔûÂ';
        topbarToggle.title = playing ? 'Musik pausieren' : 'Musik starten';
        topbarToggle.setAttribute('aria-label', playing ? 'Musik pausieren' : 'Musik starten');
      }
      if (topbarMode) {
        const mode = String(state.musicTransitionMode || settingsState.musicTransitionMode || 'fade').toLowerCase() === 'cut' ? 'cut' : 'fade';
        topbarMode.textContent = mode.toUpperCase();
        topbarMode.title = mode === 'fade' ? 'Transition-Modus: Fade (nahtlos)' : 'Transition-Modus: Cut (sofort)';
      }
    }

    loadUiSettings() {
      const persisted = loadPortableUiSettings();
      if (persisted && typeof persisted === 'object') {
        Object.assign(settingsState, persisted);
      }
      applyTransitionPreset(settingsState.transitionPreset);
      settingsState.magnetPreset = ['precise', 'balanced', 'sticky', 'custom'].includes(String(settingsState.magnetPreset || 'balanced'))
        ? String(settingsState.magnetPreset)
        : 'balanced';
      settingsState.renderQualityProfile = ['auto', 'low', 'medium', 'high', 'ultra'].includes(String(settingsState.renderQualityProfile || 'auto').toLowerCase())
        ? String(settingsState.renderQualityProfile || 'auto').toLowerCase()
        : 'auto';
      settingsState.hoverMagnetEnabled = settingsState.hoverMagnetEnabled !== false;
      settingsState.clickMagnetEnabled = settingsState.clickMagnetEnabled !== false;
      settingsState.galacticCoreFxAuto = persisted && typeof persisted === 'object' && Object.prototype.hasOwnProperty.call(persisted, 'galacticCoreFxAuto')
        ? persisted.galacticCoreFxAuto !== false
        : !(persisted && typeof persisted === 'object' && Object.prototype.hasOwnProperty.call(persisted, 'galacticCoreFxEnabled'));
      settingsState.galacticCoreFxEnabled = settingsState.galacticCoreFxEnabled !== false;
      settingsState.galaxyFleetVectorsVisible = settingsState.galaxyFleetVectorsVisible !== false;
      settingsState.introFlightMode = ['off', 'fast', 'cinematic'].includes(String(settingsState.introFlightMode || 'cinematic').toLowerCase())
        ? String(settingsState.introFlightMode || 'cinematic').toLowerCase()
        : 'cinematic';
      settingsState.hoverMagnetStarPx = Math.max(8, Math.min(64, Number(settingsState.hoverMagnetStarPx || 24)));
      settingsState.hoverMagnetPlanetPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetPlanetPx || 30)));
      settingsState.hoverMagnetClusterPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetClusterPx || 28)));
      settingsState.galaxyOwnerFocusUserId = Math.max(0, Number(settingsState.galaxyOwnerFocusUserId || 0));
      settingsState.galaxyOwnerFocusName = String(settingsState.galaxyOwnerFocusName || '').trim();
      if (!settingsState.sceneTracks || typeof settingsState.sceneTracks !== 'object') {
        settingsState.sceneTracks = { galaxy: '', system: '', battle: '', ui: '' };
      }
      if (!settingsState.sfxMap || typeof settingsState.sfxMap !== 'object') {
        settingsState.sfxMap = {
          uiClick: 'sfx/mixkit-video-game-retro-click-237.wav',
          uiConfirm: 'sfx/mixkit-quick-positive-video-game-notification-interface-265.wav',
          uiError: 'sfx/mixkit-negative-game-notification-249.wav',
          uiNotify: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
          navigation: 'sfx/mixkit-sci-fi-warp-slide-3113.wav',
          pvpToggle: 'sfx/mixkit-horn-suspense-transition-3112.wav',
          researchStart: 'sfx/mixkit-unlock-new-item-game-notification-254.wav',
          researchComplete: 'sfx/mixkit-casino-bling-achievement-2067.wav',
          fleetRecall: 'sfx/mixkit-space-shot-whoosh-3001.wav',
          messageSend: 'sfx/mixkit-space-coin-win-notification-271.wav',
          messageRead: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
          messageDelete: 'sfx/mixkit-falling-hit-757.wav',
          fleetAttack: 'sfx/mixkit-laser-gun-shot-3110.wav',
          fleetTransport: 'sfx/mixkit-space-deploy-whizz-3003.wav',
          fleetSpy: 'sfx/mixkit-night-vision-starting-2476.wav',
          fleetColonize: 'sfx/mixkit-medieval-show-fanfare-announcement-226.wav',
          fleetHarvest: 'sfx/mixkit-space-plasma-shot-3002.wav',
          buildComplete: 'sfx/mixkit-bonus-earned-in-video-game-2058.wav',
          fleetLaunch: 'sfx/mixkit-space-deploy-whizz-3003.wav',
        };
      }
      if (audioManager) {
        const audioSnapshot = audioManager.snapshot();
        if (audioSnapshot?.sfxMap && typeof audioSnapshot.sfxMap === 'object') {
          settingsState.sfxMap = Object.assign({}, settingsState.sfxMap, audioSnapshot.sfxMap);
        }
        if (audioSnapshot?.musicTransitionMode) {
          settingsState.musicTransitionMode = String(audioSnapshot.musicTransitionMode || 'fade').toLowerCase() === 'cut' ? 'cut' : 'fade';
        }
        audioManager.setMasterVolume(settingsState.masterVolume);
        audioManager.setMusicVolume(settingsState.musicVolume);
        audioManager.setSfxVolume(settingsState.sfxVolume);
        audioManager.setMasterMuted(settingsState.masterMuted);
        audioManager.setMusicMuted(settingsState.musicMuted);
        audioManager.setSfxMuted(settingsState.sfxMuted);
        if (typeof audioManager.setMusicTransitionMode === 'function') {
          audioManager.setMusicTransitionMode(settingsState.musicTransitionMode);
        }
        if (typeof audioManager.setAutoSceneMusic === 'function') {
          audioManager.setAutoSceneMusic(!!settingsState.autoSceneMusic);
        }
        if (typeof audioManager.setSceneTrack === 'function') {
          ['galaxy', 'system', 'battle', 'ui'].forEach((sceneKey) => {
            audioManager.setSceneTrack(sceneKey, settingsState.sceneTracks?.[sceneKey] || '');
          });
        }
        if (typeof audioManager.setSfxTrack === 'function') {
          Object.entries(settingsState.sfxMap || {}).forEach(([eventKey, trackUrl]) => {
            audioManager.setSfxTrack(eventKey, trackUrl || '');
          });
        }
        if (settingsState.musicUrl) {
          audioManager.setMusicTrack(settingsState.musicUrl, false);
        }
      }
      this.refreshAudioUi();
      this.saveUiSettings();
    }

    saveUiSettings() {
      savePortableUiSettings(settingsState);
    }

    renderUserMenu() {
      const menu = document.getElementById('user-menu');
      if (!menu) return;
      const meta = window._GQ_meta || {};
      const pvpOn = !!parseInt(meta.pvp_mode, 10);
      const audioSnap = audioManager ? audioManager.snapshot() : settingsState;
      const masterMuted = !!audioSnap.masterMuted;
      const transitionPreset = String(settingsState.transitionPreset || 'balanced');
      const homeEnterSystem = !!settingsState.homeEnterSystem;
      const introFlightMode = String(settingsState.introFlightMode || 'cinematic');
      const introLabel = introFlightMode === 'off' ? 'Aus' : introFlightMode === 'fast' ? 'Schnell' : 'Cinematic';

      menu.innerHTML = `
        <button class="user-menu-item" type="button" data-user-action="open-settings" role="menuitem">ÔÜÖ Benutzereinstellungen ├Âffnen</button>
        <button class="user-menu-item" type="button" data-user-action="toggle-master-mute" role="menuitem">${masterMuted ? '­ƒöê Ton aktivieren' : '­ƒöç Ton stummschalten'}</button>
        <button class="user-menu-item" type="button" data-user-action="cycle-transition" role="menuitem">­ƒÄ¼ Transition: ${esc(transitionPreset)}</button>
        <button class="user-menu-item" type="button" data-user-action="toggle-home-enter" role="menuitem">­ƒÅá Home-├ûffnung: ${homeEnterSystem ? 'Systemansicht' : 'Galaxieansicht'}</button>
        <button class="user-menu-item" type="button" data-user-action="cycle-intro-flight" role="menuitem">­ƒø© Intro-Flight: ${esc(introLabel)}</button>
        <hr class="user-menu-sep" />
        <button class="user-menu-item" type="button" data-user-action="toggle-pvp" role="menuitem">ÔÜö PvP: ${pvpOn ? 'aktiv (klicken zum Deaktivieren)' : 'inaktiv (klicken zum Aktivieren)'}</button>
        <button class="user-menu-item" type="button" data-user-action="refresh-profile" role="menuitem">­ƒöä Profildaten neu laden</button>
        <hr class="user-menu-sep" />
        <button class="user-menu-item user-menu-item-danger" type="button" data-user-action="logout" role="menuitem">ÔÄï Logout</button>`;
    }

    closeUserMenu() {
      closeCommanderMenuPanel();
    }

    openUserMenu() {
      const wrap = document.getElementById('user-menu-wrap');
      const menu = document.getElementById('user-menu');
      const btn = document.getElementById('commander-name');
      if (!menu || !btn) return;
      closeTopbarSearchOverlay();
      closeTopbarPlayerMenu();
      this.renderUserMenu();
      menu.classList.remove('hidden');
      if (wrap) wrap.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }

    toggleUserMenu() {
      const menu = document.getElementById('user-menu');
      if (!menu) return;
      if (menu.classList.contains('hidden')) this.openUserMenu();
      else this.closeUserMenu();
    }

    async handleUserMenuAction(action) {
      if (audioManager) audioManager.playNavigation();
      if (action === 'open-settings') {
        WM.open('settings');
        this.closeUserMenu();
        return;
      }
      if (action === 'toggle-master-mute') {
        settingsState.masterMuted = !settingsState.masterMuted;
        if (audioManager) audioManager.setMasterMuted(settingsState.masterMuted);
        this.saveUiSettings();
        this.refreshAudioUi();
        this.renderUserMenu();
        return;
      }
      if (action === 'cycle-transition') {
        const order = ['smooth', 'balanced', 'snappy'];
        const idx = Math.max(0, order.indexOf(String(settingsState.transitionPreset || 'balanced')));
        const next = order[(idx + 1) % order.length];
        applyTransitionPreset(next);
        this.applyRuntimeSettings();
        this.saveUiSettings();
        this.renderUserMenu();
        showToast(`Transition-Preset: ${next}`, 'info');
        return;
      }
      if (action === 'toggle-home-enter') {
        settingsState.homeEnterSystem = !settingsState.homeEnterSystem;
        this.saveUiSettings();
        this.renderUserMenu();
        showToast(`Home-Navigation: ${settingsState.homeEnterSystem ? 'Systemansicht' : 'Galaxieansicht'}`, 'info');
        return;
      }
      if (action === 'cycle-intro-flight') {
        const order = ['off', 'fast', 'cinematic'];
        const idx = Math.max(0, order.indexOf(String(settingsState.introFlightMode || 'cinematic')));
        const next = order[(idx + 1) % order.length];
        settingsState.introFlightMode = next;
        this.saveUiSettings();
        this.renderUserMenu();
        const label = next === 'off' ? 'Aus' : next === 'fast' ? 'Schnell' : 'Cinematic';
        showToast(`Intro-Flight: ${label}`, 'info');
        return;
      }
      if (action === 'toggle-pvp') {
        const response = await API.togglePvp();
        if (response.success) {
          if (audioManager && typeof audioManager.playPvpToggle === 'function') audioManager.playPvpToggle();
          showToast(response.pvp_mode ? 'ÔÜö PvP enabled!' : '­ƒøí PvP disabled.', 'info');
          await loadOverview();
          this.renderUserMenu();
        } else {
          showToast(response.error || 'PvP konnte nicht ge├ñndert werden.', 'error');
        }
        return;
      }
      if (action === 'refresh-profile') {
        await loadOverview();
        this.renderUserMenu();
        showToast('Profildaten aktualisiert.', 'success');
        return;
      }
      if (action === 'logout') {
        this.closeUserMenu();
        document.getElementById('logout-btn')?.click();
      }
    }

    initUserMenu() {
      const wrap = document.getElementById('user-menu-wrap');
      const btn = document.getElementById('commander-name');
      const menu = document.getElementById('user-menu');
      if (!wrap || !btn || !menu) return;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleUserMenu();
      });

      menu.addEventListener('click', async (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const action = String(target.getAttribute('data-user-action') || '');
        if (!action) return;
        await this.handleUserMenuAction(action);
      });

      document.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof Node)) return;
        if (!wrap.contains(target)) this.closeUserMenu();
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.closeUserMenu();
      });
    }

    applyRuntimeSettings() {
      if (!galaxy3d) return;
      if (typeof galaxy3d.setTransitionsEnabled === 'function') {
        galaxy3d.setTransitionsEnabled(!!settingsState.autoTransitions);
      } else {
        galaxy3d.transitionsEnabled = !!settingsState.autoTransitions;
      }
      if (typeof galaxy3d.setHoverMagnetConfig === 'function') {
        galaxy3d.setHoverMagnetConfig({
          enabled: !!settingsState.hoverMagnetEnabled,
          clickEnabled: !!settingsState.clickMagnetEnabled,
          starPx: Number(settingsState.hoverMagnetStarPx || 24),
          planetPx: Number(settingsState.hoverMagnetPlanetPx || 30),
          clusterPx: Number(settingsState.hoverMagnetClusterPx || 28),
        });
      } else {
        galaxy3d.hoverMagnetEnabled = !!settingsState.hoverMagnetEnabled;
        galaxy3d.clickMagnetEnabled = !!settingsState.clickMagnetEnabled;
        galaxy3d.hoverMagnetStarPx = Math.max(8, Math.min(64, Number(settingsState.hoverMagnetStarPx || 24)));
        galaxy3d.hoverMagnetPlanetPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetPlanetPx || 30)));
        galaxy3d.hoverMagnetClusterPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetClusterPx || 28)));
      }
      galaxy3d.persistentHoverDistance = Math.max(120, Number(settingsState.persistentHoverDistance || 220));
      galaxy3d.transitionStableMinMs = Math.max(60, Number(settingsState.transitionStableMinMs || 160));
      if (typeof galaxy3d.setClusterDensityMode === 'function') {
        galaxy3d.setClusterDensityMode(settingsState.clusterDensityMode || 'auto', {
          recluster: true,
          preserveView: true,
        });
      }
      if (typeof galaxy3d.setClusterBoundsVisible === 'function') {
        galaxy3d.setClusterBoundsVisible(settingsState.clusterBoundsVisible !== false);
      }
      if (typeof galaxy3d.setGalaxyFleetVectorsVisible === 'function') {
        galaxy3d.setGalaxyFleetVectorsVisible(settingsState.galaxyFleetVectorsVisible !== false);
      }
      if (typeof galaxy3d.setGalacticCoreFxEnabled === 'function') {
        const autoCoreFx = settingsState.galacticCoreFxAuto !== false;
        const recommendedCoreFx = galaxy3dQualityState?.features?.galacticCoreFx;
        const shouldEnableCoreFx = autoCoreFx && recommendedCoreFx === false
          ? false
          : (settingsState.galacticCoreFxEnabled !== false);
        galaxy3d.setGalacticCoreFxEnabled(shouldEnableCoreFx);
      }
    }
  }

  const settingsController = new SettingsController();
  window.GQSettingsController = settingsController;

  function refreshAudioUi() {
    settingsController.refreshAudioUi();
  }

  function formatLastAudioEvent(detail) {
    if (!detail || !detail.key) return 'Kein Event';
    const key = String(detail.key || '');
    const matching = AUDIO_SFX_EVENTS.find((item) => item.key === key);
    const label = matching ? matching.label : key;
    const stamp = detail.ts ? new Date(detail.ts).toLocaleTimeString() : '';
    return stamp ? `${label} @ ${stamp}` : label;
  }

  function updateLastAudioEventUi(detail) {
    const node = document.querySelector('#set-last-audio-event');
    if (!node) return;
    node.textContent = formatLastAudioEvent(detail);
  }

  window.addEventListener('gq:audio-event', (ev) => {
    updateLastAudioEventUi(ev?.detail || null);
  });

  window.addEventListener('gq:audio-state', () => {
    refreshAudioUi();
  });

  function loadUiSettings() {
    settingsController.loadUiSettings();
  }

  function saveUiSettings() {
    settingsController.saveUiSettings();
  }

  function renderUserMenu() {
    settingsController.renderUserMenu();
  }

  function closeUserMenu() {
    settingsController.closeUserMenu();
  }

  function openUserMenu() {
    settingsController.openUserMenu();
  }

  function toggleUserMenu() {
    settingsController.toggleUserMenu();
  }

  function initUserMenu() {
    settingsController.initUserMenu();
  }

  function applyTransitionPreset(presetName) {
    const preset = String(presetName || 'balanced');
    const presets = {
      smooth: { hover: 270, stableMs: 240 },
      balanced: { hover: 220, stableMs: 160 },
      snappy: { hover: 175, stableMs: 100 },
    };
    const selected = presets[preset] || presets.balanced;
    settingsState.transitionPreset = presets[preset] ? preset : 'balanced';
    settingsState.persistentHoverDistance = selected.hover;
    settingsState.transitionStableMinMs = selected.stableMs;
  }

  function applyRuntimeSettings() {
    settingsController.applyRuntimeSettings();
  }

  function hasPlanetTextureManifest(payload) {
    // Accept any payload that has a star_system or a non-empty planets array ÔÇö
    // a missing/empty texture manifest is harmless (planets render with fallback colors).
    if (!payload) return false;
    if (Array.isArray(payload.planets) && payload.planets.length > 0) return true;
    if (payload.star_system && typeof payload.star_system === 'object') return true;
    const planets = payload?.planet_texture_manifest?.planets;
    return !!(planets && typeof planets === 'object' && Object.keys(planets).length);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderInlineTemplate(template, data = {}) {
    const tpl = String(template || '');
    if (window.Mustache && typeof window.Mustache.render === 'function') {
      return window.Mustache.render(tpl, data);
    }
    return tpl.replace(/\{\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}\}/g, (_, key) => {
      const value = data[key];
      if (value === null || value === undefined) return '';
      return String(value);
    });
  }

  function renderInlineTemplateList(template, rows) {
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row) => renderInlineTemplate(template, row)).join('');
  }

  function uiKitTemplateHTML(templateId) {
    try {
      if (!(window.GQUIKit && typeof window.GQUIKit.cloneTemplate === 'function')) return '';
      const frag = window.GQUIKit.cloneTemplate(templateId);
      if (!frag) return '';
      const wrap = document.createElement('div');
      wrap.appendChild(frag);
      return wrap.innerHTML;
    } catch (_) {
      return '';
    }
  }

  function uiKitEmptyStateHTML(title, text) {
    const fromTemplate = uiKitTemplateHTML('tpl-ui-empty-state');
    if (fromTemplate) return fromTemplate;
    return `
      <section class="ui-empty-state">
        <div class="ui-empty-icon">ÔùÄ</div>
        <h4 class="ui-empty-title">${esc(title || 'No data available')}</h4>
        <p class="ui-empty-text">${esc(text || 'Content will appear here soon.')}</p>
      </section>`;
  }

  function uiKitSkeletonHTML() {
    return uiKitTemplateHTML('tpl-ui-skeleton-list') || '<p class="text-muted">LoadingÔÇª</p>';
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  function canUsePhysicsFlightPath(target) {
    return !!(
      galaxy3d
      && typeof galaxy3d.setCameraDriver === 'function'
      && typeof galaxy3d.clearCameraDriver === 'function'
      && window.GQSpaceCameraFlightDriver
      && typeof window.GQSpaceCameraFlightDriver.create === 'function'
      && Number.isFinite(Number(target?.x_ly))
      && Number.isFinite(Number(target?.z_ly))
    );
  }

  async function runPhysicsCinematicFlight(target, opts = {}) {
    if (!canUsePhysicsFlightPath(target)) return { ok: false, reason: 'unavailable' };

    const durationSec = Math.max(1.2, Number(opts.durationSec || 2.2));
    const holdMs = Math.max(420, Number(opts.holdMs || Math.round(durationSec * 520)));
    const label = String(opts.label || target?.name || target?.catalog_name || `System ${Number(target?.system_index || 0)}`);

    try {
      const driver = window.GQSpaceCameraFlightDriver.create({ three: window.THREE });
      if (typeof driver.setRandomStars === 'function' && Array.isArray(galaxyStars) && galaxyStars.length) {
        driver.setRandomStars(galaxyStars);
      }
      const accepted = driver.setTarget({
        id: Number(target?.id || target?.system_index || 0) || 0,
        x_ly: Number(target?.x_ly),
        y_ly: Number(target?.y_ly || 0),
        z_ly: Number(target?.z_ly),
        label,
      }, { durationSec });
      if (!accepted) return { ok: false, reason: 'target-rejected' };

      galaxy3d.setCameraDriver(driver, { consumeAutoNav: true, updateControls: true });
      await waitMs(holdMs);
      return { ok: true };
    } catch (_) {
      return { ok: false, reason: 'driver-error' };
    } finally {
      try {
        galaxy3d?.clearCameraDriver?.();
      } catch (_) {}
    }
  }

  function starSearchKey(star) {
    if (!star) return '';
    const g = Number(star.galaxy_index || star.galaxy || 1);
    const s = Number(star.system_index || star.system || 0);
    return `${g}:${s}`;
  }

  function scoreStarSearchMatch(star, queryLower, systemExact) {
    const name = String(star?.name || '').toLowerCase();
    const catalog = String(star?.catalog_name || '').toLowerCase();
    const sys = Number(star?.system_index || 0);
    const sysText = String(sys);
    let score = -1;

    if (systemExact > 0 && sys === systemExact) score = Math.max(score, 120);
    if (sysText === queryLower) score = Math.max(score, 116);
    if (sysText.startsWith(queryLower)) score = Math.max(score, 100);
    if (name === queryLower) score = Math.max(score, 98);
    if (catalog === queryLower) score = Math.max(score, 96);
    if (name.startsWith(queryLower)) score = Math.max(score, 86);
    if (catalog.startsWith(queryLower)) score = Math.max(score, 84);
    if (name.includes(queryLower)) score = Math.max(score, 70);
    if (catalog.includes(queryLower)) score = Math.max(score, 66);

    if (score < 0) return -1;
    return score - Math.min(30, Math.floor(sys / 1000));
  }

  function collectLocalStarSearch(query, limit = 10) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const g = Number(uiState.activeGalaxy || currentColony?.galaxy || 1);
    const systemExact = /^\d+$/.test(q) ? Number(q) : -1;
    const rows = [];

    (Array.isArray(galaxyStars) ? galaxyStars : []).forEach((star) => {
      if (Number(star?.galaxy_index || 0) !== g) return;
      const score = scoreStarSearchMatch(star, q, systemExact);
      if (score < 0) return;
      rows.push({ score, star });
    });

    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, Math.max(1, Number(limit || 10))).map((row) => row.star);
  }

  function getTopbarSearchDom() {
    const wrap = document.getElementById('topbar-search-wrap');
    const toggle = document.getElementById('topbar-search-toggle');
    const menu = document.getElementById('topbar-search-menu');
    const input = document.getElementById('topbar-search-input');
    const overlay = document.getElementById('topbar-search-overlay');
    return { wrap, toggle, menu, input, overlay };
  }

  function closeCommanderMenuPanel() {
    const wrap = document.getElementById('user-menu-wrap');
    const menu = document.getElementById('user-menu');
    const btn = document.getElementById('commander-name');
    if (menu) menu.classList.add('hidden');
    if (wrap) wrap.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function closeTopbarPlayerMenu() {
    const menuWrap = document.getElementById('topbar-player');
    const menu = document.getElementById('topbar-player-menu');
    const menuToggle = document.getElementById('topbar-player-menu-toggle');
    if (menu) menu.classList.add('hidden');
    if (menuWrap) menuWrap.classList.remove('open');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
  }

  function closeTopbarSearchOverlay() {
    topbarSearchStore.closeOverlay();
    renderTopbarSearchOverlay();
    const { wrap, menu, toggle } = getTopbarSearchDom();
    wrap?.classList.remove('open');
    menu?.classList.add('hidden');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  const TOPBAR_SEARCH_TEMPLATES = {
    item: '<button type="button" class="topbar-search-item" data-search-source="{{{source}}}" data-search-index="{{{index}}}" role="option"><div class="topbar-search-title">{{{name}}}</div><div class="topbar-search-meta">{{{coords}}} ┬À {{{starClass}}} ┬À {{{origin}}}</div></button>',
    sections: '<div class="topbar-search-section"><div class="topbar-search-head">Lokal (Three)</div>{{{localHtml}}}</div><div class="topbar-search-section"><div class="topbar-search-head">Server-Erweiterung</div>{{{serverHtml}}}</div>',
  };

  function renderTopbarSearchOverlay() {
    const { overlay } = getTopbarSearchDom();
    if (!overlay) return;
    if (!topbarSearchStore.open) {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      return;
    }

    const localRows = Array.isArray(topbarSearchStore.localResults) ? topbarSearchStore.localResults : [];
    const serverRows = Array.isArray(topbarSearchStore.serverResults) ? topbarSearchStore.serverResults : [];
    const renderRow = (star, source, idx) => {
      const name = star?.name || star?.catalog_name || `System ${Number(star?.system_index || 0)}`;
      const cls = `${String(star?.spectral_class || '?')}${String(star?.subtype || '')}`;
      const g = Number(star?.galaxy_index || uiState.activeGalaxy || 1);
      const s = Number(star?.system_index || 0);
      return renderInlineTemplate(TOPBAR_SEARCH_TEMPLATES.item, {
        source: esc(source),
        index: esc(String(idx)),
        name: esc(name),
        coords: esc(`${g}:${s}`),
        starClass: esc(cls),
        origin: source === 'local' ? 'lokal (3D)' : 'server',
      });
    };

    const localHtml = localRows.length
      ? localRows.map((star, idx) => renderRow(star, 'local', idx)).join('')
      : '<div class="topbar-search-empty">Keine lokalen Treffer im aktuell geladenen 3D-Sternfeld.</div>';
    const serverHtml = topbarSearchStore.serverPending
      ? '<div class="topbar-search-empty">Server-Suche l├ñuft...</div>'
      : (serverRows.length
        ? serverRows.map((star, idx) => renderRow(star, 'server', idx)).join('')
        : '<div class="topbar-search-empty">Keine zus├ñtzlichen Server-Treffer.</div>');

    overlay.innerHTML = renderInlineTemplate(TOPBAR_SEARCH_TEMPLATES.sections, {
      localHtml,
      serverHtml,
    });
    overlay.classList.remove('hidden');

    overlay.querySelectorAll('.topbar-search-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const source = String(btn.getAttribute('data-search-source') || 'local');
        const index = Number(btn.getAttribute('data-search-index') || -1);
        const list = source === 'server' ? serverRows : localRows;
        const star = (index >= 0 && index < list.length) ? list[index] : null;
        if (!star) return;
        await jumpToSearchStar(star);
        closeTopbarSearchOverlay();
      });
    });
  }

  function queueServerStarSearch(query, token) {
    topbarSearchStore.queueServerFetch(async () => {
      if (!topbarSearchStore.matchesToken(token)) return;
      const g = Number(uiState.activeGalaxy || currentColony?.galaxy || 1);
      try {
        const data = await API.galaxySearch(g, query, topbarSearchStore.maxServer);
        if (!topbarSearchStore.matchesToken(token)) return;
        const localKeys = new Set((topbarSearchStore.localResults || []).map((s) => starSearchKey(s)));
        const stars = Array.isArray(data?.stars) ? data.stars : [];
        topbarSearchStore.setServerResults(stars.filter((star) => !localKeys.has(starSearchKey(star))));
      } catch (_) {
        if (!topbarSearchStore.matchesToken(token)) return;
        topbarSearchStore.setServerResults([]);
      }
      topbarSearchStore.setServerPending(false);
      renderTopbarSearchOverlay();
    }, 260);
  }

  function runTopbarSearch(query) {
    const normalized = String(query || '').trim();
    const token = topbarSearchStore.nextToken(normalized);

    if (!normalized) {
      topbarSearchStore.reset();
      closeTopbarSearchOverlay();
      return;
    }

    topbarSearchStore.setLocalResults(collectLocalStarSearch(normalized, topbarSearchStore.maxLocal));
    topbarSearchStore.setServerResults([]);
    topbarSearchStore.setServerPending(normalized.length >= 2);
    topbarSearchStore.openOverlay();
    renderTopbarSearchOverlay();

    if (topbarSearchStore.serverPending) {
      queueServerStarSearch(normalized, token);
    }
  }

  async function jumpToSearchStar(star) {
    await galaxyController.jumpToSearchStar(star);
  }

  function initTopbarSearch() {
    const { wrap, toggle, menu, input, overlay } = getTopbarSearchDom();
    if (!wrap || !input || !overlay || !menu || !toggle) return;

    const openSearchMenu = () => {
      closeCommanderMenuPanel();
      closeTopbarPlayerMenu();
      wrap.classList.add('open');
      menu.classList.remove('hidden');
      toggle.setAttribute('aria-expanded', 'true');
    };

    input.addEventListener('input', () => runTopbarSearch(input.value));
    input.addEventListener('focus', () => {
      if (!String(input.value || '').trim()) return;
      openSearchMenu();
      topbarSearchStore.openOverlay();
      renderTopbarSearchOverlay();
    });

    toggle.addEventListener('click', () => {
      const willOpen = menu.classList.contains('hidden');
      if (willOpen) {
        openSearchMenu();
        input.focus();
      } else {
        closeTopbarSearchOverlay();
      }
    });
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeTopbarSearchOverlay();
        input.blur();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const candidate = topbarSearchStore.firstCandidate();
        if (candidate) {
          await jumpToSearchStar(candidate);
          closeTopbarSearchOverlay();
        }
      }
    });

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (!wrap.contains(target)) closeTopbarSearchOverlay();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) return;
        e.preventDefault();
        openSearchMenu();
        input.focus();
      }
    });
  }

  function starClassColor(spectralClass) {
    const cls = String(spectralClass || '').toUpperCase();
    const colors = {
      O: '#9bb0ff',
      B: '#aabfff',
      A: '#cad7ff',
      F: '#f8f7ff',
      G: '#fff4ea',
      K: '#ffd2a1',
      M: '#ffcc6f',
    };
    return colors[cls] || '#d8e6ff';
  }

  function planetIcon(planetClass) {
    const cls = String(planetClass || '').toLowerCase();
    if (cls.includes('gas')) return '­ƒ¬É';
    if (cls.includes('ice') || cls.includes('frozen')) return '­ƒºè';
    if (cls.includes('lava') || cls.includes('volcan')) return '­ƒîï';
    if (cls.includes('ocean')) return '­ƒîè';
    if (cls.includes('desert')) return '­ƒÅ£';
    if (cls.includes('terra') || cls.includes('hab')) return '­ƒîì';
    if (cls.includes('toxic')) return 'Ôÿú';
    return 'ÔùÅ';
  }

  function buildingZoneLabel(zone) {
    return {
      industrial: 'Industry',
      utility: 'Utility',
      civic: 'Civic',
      science: 'Science',
      military: 'Defense',
      orbital: 'Orbital',
      flex: 'Flexible',
    }[String(zone || '')] || fmtName(String(zone || 'flex'));
  }

  function buildColonyGridCells(layout, buildings) {
    const cols = Number(layout?.grid?.cols || 6);
    const rows = Number(layout?.grid?.rows || 4);
    const surfaceSlots = cols * rows;
    const caps = Object.assign({}, layout?.class_caps || {});
    const zones = [];
    const order = ['industrial', 'utility', 'civic', 'science', 'military', 'flex'];
    order.forEach((zone) => {
      const count = Math.max(0, Number(caps[zone] || 0));
      for (let index = 0; index < count; index++) zones.push(zone);
    });
    while (zones.length < surfaceSlots) zones.push('flex');
    zones.length = surfaceSlots;

    const cells = zones.map((zone, index) => ({ index, zone, building: null, fill: 0, locked: false }));
    const sortedBuildings = (buildings || []).filter((b) => (b.meta?.zone || 'surface') === 'surface')
      .slice()
      .sort((a, b) => Number(b.meta?.footprint || 1) - Number(a.meta?.footprint || 1));

    for (const building of sortedBuildings) {
      const footprint = Math.max(1, Number(building.meta?.footprint || 1));
      const zone = String(building.meta?.class_key || 'flex');
      let anchor = cells.findIndex((cell, idx) => {
        if (cell.building || cell.locked) return false;
        if (cell.zone !== zone && cell.zone !== 'flex') return false;
        for (let offset = 0; offset < footprint; offset++) {
          const next = cells[idx + offset];
          if (!next || next.building || next.locked) return false;
          if (offset > 0 && Math.floor((idx + offset) / cols) !== Math.floor(idx / cols)) return false;
        }
        return true;
      });
      if (anchor < 0) {
        anchor = cells.findIndex((cell, idx) => {
          if (cell.building || cell.locked) return false;
          for (let offset = 0; offset < footprint; offset++) {
            const next = cells[idx + offset];
            if (!next || next.building || next.locked) return false;
            if (offset > 0 && Math.floor((idx + offset) / cols) !== Math.floor(idx / cols)) return false;
          }
          return true;
        });
      }
      if (anchor < 0) continue;
      for (let offset = 0; offset < footprint; offset++) {
        const cell = cells[anchor + offset];
        cell.building = building;
        cell.fill = offset;
      }
    }
    return { cols, rows, cells };
  }

  class GameRuntime {
    constructor() {
      this.initialized = false;
    }

    initUi() {
      if (this.initialized) return;
      loadUiSettings();
      initUserMenu();
      initUiConsole();
      initTopbarSearch();
      this.initialized = true;
    }
  }

  const gameRuntime = new GameRuntime();
  window.GQGameRuntime = gameRuntime;
  gameRuntime.initUi();

  class WindowRegistry {
    constructor(wm) {
      this.wm = wm;
      this.registered = false;
    }

    buildDefinitions() {
      return [
        ['overview', { title: '­ƒîì Overview', w: 460, h: 620, defaultDock: 'right', defaultY: 12, onRender: () => renderOverview() }],
        ['buildings', { title: '­ƒÅù Buildings', w: 480, h: 560, defaultDock: 'right', defaultY: 38, onRender: () => renderBuildings() }],
        ['colony', { title: '­ƒÅø Colony', w: 620, h: 620, defaultDock: 'right', defaultY: 24, onRender: () => renderColonyView() }],
        ['research', { title: '­ƒö¼ Research', w: 480, h: 560, defaultDock: 'right', defaultY: 58, onRender: () => renderResearch() }],
        ['shipyard', { title: '­ƒÜÇ Shipyard', w: 500, h: 560, defaultDock: 'right', defaultY: 78, onRender: () => renderShipyard() }],
        ['fleet', { title: 'ÔÜí Fleet', w: 500, h: 620, defaultDock: 'right', defaultY: 98, onRender: () => renderFleetForm() }],
        ['wormholes', { title: '­ƒîÇ Wormholes', w: 520, h: 560, defaultDock: 'right', defaultY: 108, onRender: () => renderWormholes() }],
        ['galaxy', { title: '­ƒîî Galaxy Map', fullscreenDesktop: true, hideTaskButton: true, backgroundLayer: true, onRender: () => renderGalaxyWindow() }],
        ['messages', { title: 'Ô£ë Messages', w: 500, h: 520, defaultDock: 'right', defaultY: 118, onRender: () => renderMessages() }],
        ['intel', { title: '­ƒöì Intel', w: 520, h: 560, defaultDock: 'right', defaultY: 128, onRender: () => renderIntel() }],
        ['trade-routes', { title: '­ƒÜÇ Trade Routes', w: 520, h: 560, defaultDock: 'right', defaultY: 138, onRender: () => renderTradeRoutes() }],
          ['trade', { title: '­ƒÆ▒ Trade', w: 540, h: 580, defaultDock: 'right', defaultY: 148, onRender: () => renderTradeProposals() }],
        ['quests', { title: '­ƒôï Quests', w: 540, h: 620, defaultDock: 'right', defaultY: 28, onRender: () => renderQuests() }],
        ['leaderboard', { title: '­ƒÅå Leaderboard', w: 420, h: 480, defaultDock: 'right', defaultY: 138, onRender: () => renderLeaderboard() }],
        ['leaders', { title: '­ƒæñ Leaders & Marketplace', w: 700, h: 600, defaultDock: 'right', defaultY: 44, onRender: () => renderLeaders() }],
        ['factions', { title: '­ƒîÉ Factions', w: 560, h: 620, defaultDock: 'right', defaultY: 24, onRender: () => renderFactions() }],
        ['alliances', { title: '­ƒñØ Alliances', w: 560, h: 620, defaultDock: 'right', defaultY: 54, onRender: () => renderAlliances() }],
        ['settings', { title: 'ÔÜÖ Settings', w: 460, h: 560, defaultDock: 'right', defaultY: 12, onRender: () => renderSettings() }],
        ['quicknav', { title: 'Ô¡É QuickNav', w: 370, h: 520, defaultDock: 'left', defaultY: 12, onRender: () => renderQuickNav() }],
        ['minimap', { title: '­ƒù║ Minimap', w: 290, h: 310, defaultDock: 'right', defaultY: 12, defaultDockMargin: 12, onRender: (root) => renderMinimap(root) }],
        ['left-sidebar', {
          title: '­ƒôî Left Sidebar',
          sectionId: 'left_sidebar',
          prebuiltSelector: '.sidebar-panel-left',
          adaptExisting: true,
          defaultDock: 'left',
          defaultY: 72,
          w: 300,
          h: 520,
          onRender: (root) => {
            if (!root) return;
            if (!root.innerHTML.trim()) root.innerHTML = '<p class="text-muted">Left sidebar window.</p>';
          },
        }],
        ['right-sidebar', {
          title: '­ƒôì Right Sidebar',
          sectionId: 'right_sidebar',
          prebuiltSelector: '.sidebar-panel-right',
          adaptExisting: true,
          defaultDock: 'right',
          defaultY: 72,
          w: 300,
          h: 520,
          onRender: (root) => {
            if (!root) return;
            if (!root.innerHTML.trim()) root.innerHTML = '<p class="text-muted">Right sidebar window.</p>';
          },
        }],
      ];
    }

    registerAll() {
      if (this.registered) return;
      const definitions = this.buildDefinitions();
      definitions.forEach(([id, options]) => this.wm.register(id, options));
      this.registered = true;
    }
  }

  const windowRegistry = new WindowRegistry(WM);
  window.GQWindowRegistry = windowRegistry;
  windowRegistry.registerAll();

  class NavigationController {
    constructor(options = {}) {
      this.wm = options.wm;
      this.api = options.api;
      this.audio = options.audio;
      this.planetSelect = options.planetSelect;
      this.bound = false;
    }

    bindNavButtons() {
      document.querySelectorAll('.nav-btn[data-win]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (this.audio && typeof this.audio.playNavigation === 'function') this.audio.playNavigation();
          const win = String(btn.dataset.win || '');
          if (this.api && typeof this.api.cancelPendingRequests === 'function') {
            this.api.cancelPendingRequests(`View switch to ${win || 'unknown'}`);
          }
          this.wm.open(win);
          if (this.audio && typeof this.audio.setScene === 'function') {
            if (win === 'galaxy') this.audio.setScene('galaxy', { autoplay: false, transition: 'fast', force: true });
            else if (win === 'fleet') this.audio.setScene('battle', { autoplay: false, transition: 'normal', force: true });
            else this.audio.setScene('ui', { autoplay: false, transition: 'fast', force: true });
          }
        });
      });
    }

    bindTopbarButtons() {
      document.getElementById('topbar-title-btn')?.addEventListener('click', async () => {
        if (this.audio) this.audio.playNavigation();
        await loadOverview();
        ['overview','colony','buildings','research','shipyard','fleet','wormholes','messages','quests','leaders','factions','leaderboard'].forEach((id) => {
          try { this.wm.refresh(id); } catch (_) {}
        });
        showToast('Daten aktualisiert.', 'success');
      });

      document.getElementById('topbar-home-btn')?.addEventListener('click', async () => {
        if (this.audio) this.audio.playNavigation();
        if (this.api && typeof this.api.cancelPendingRequests === 'function') {
          this.api.cancelPendingRequests('Home navigation');
        }
        this.wm.open('galaxy');
        const root = this.wm.body('galaxy');
        if (!root) return;
        await focusHomeSystemInGalaxy(root);
      });

      document.querySelectorAll('.resource-btn[data-resource]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (this.audio && typeof this.audio.playNavigation === 'function') this.audio.playNavigation();
          openResourceInsight(String(btn.dataset.resource || ''));
        });
      });
    }

    bindAudioToggle() {
      document.getElementById('audio-toggle-btn')?.addEventListener('click', () => {
        if (!this.audio) return;
        const snap = this.audio.snapshot();
        settingsState.masterMuted = !snap.masterMuted;
        this.audio.setMasterMuted(settingsState.masterMuted);
        if (!settingsState.masterMuted) this.audio.playUiClick();
        saveUiSettings();
        refreshAudioUi();
      });
    }

    bindTopbarPlayer() {
      const trackSelect = document.getElementById('topbar-player-track');
      const trackList = document.getElementById('topbar-player-track-list');
      const prevBtn = document.getElementById('topbar-player-prev');
      const nextBtn = document.getElementById('topbar-player-next');
      const nextQuickBtn = document.getElementById('topbar-player-next-quick');
      const toggleBtn = document.getElementById('topbar-player-toggle');
      const menuWrap = document.getElementById('topbar-player');
      const menuToggle = document.getElementById('topbar-player-menu-toggle');
      const menu = document.getElementById('topbar-player-menu');
      if (!trackSelect || !toggleBtn || !menuWrap || !menuToggle || !menu) return;

      menuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = menu.classList.contains('hidden');
        if (!willOpen) {
          closeTopbarPlayerMenu();
          return;
        }
        closeTopbarSearchOverlay();
        closeCommanderMenuPanel();
        menu.classList.remove('hidden');
        menuWrap.classList.add('open');
        menuToggle.setAttribute('aria-expanded', 'true');
      });

      document.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof Node)) return;
        if (menuWrap.contains(target)) return;
        closeTopbarPlayerMenu();
      });

      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        closeTopbarPlayerMenu();
      });

      const setActiveTrack = (url, autoplay = false) => {
        const next = String(url || '').trim();
        if (!next || !this.audio) return;
        settingsState.musicUrl = next;
        this.audio.setMusicTrack(next, autoplay);
        saveUiSettings();
      };

      const shiftTrack = async (dir) => {
        if (!this.audio || !audioTrackOptions.length) return;
        if (typeof this.audio.playNextInPlaylist === 'function') {
          const ok = await this.audio.playNextInPlaylist(dir, true);
          if (!ok) showToast('Track konnte nicht gestartet werden.', 'warning');
          const snap = this.audio.snapshot ? this.audio.snapshot() : null;
          const currentUrl = String(snap?.musicUrl || '').trim();
          if (currentUrl) settingsState.musicUrl = currentUrl;
          saveUiSettings();
          refreshAudioUi();
          return;
        }

        const currentUrl = String(trackSelect.value || settingsState.musicUrl || '').trim();
        let idx = audioTrackOptions.findIndex((entry) => String(entry.value) === currentUrl);
        if (idx < 0) idx = 0;
        const nextIdx = (idx + dir + audioTrackOptions.length) % audioTrackOptions.length;
        const nextTrack = String(audioTrackOptions[nextIdx]?.value || '').trim();
        if (!nextTrack) return;
        setActiveTrack(nextTrack, false);
        const ok = await this.audio.playMusic();
        if (!ok) showToast('Track konnte nicht gestartet werden.', 'warning');
        refreshAudioUi();
      };

      trackSelect.addEventListener('change', () => {
        const selected = String(trackSelect.value || '').trim();
        if (!selected) return;
        setActiveTrack(selected, false);
        refreshAudioUi();
      });

      trackList?.addEventListener('click', async (e) => {
        const target = e.target;
        const btn = (target instanceof Element) ? target.closest('.topbar-player-track-item') : null;
        if (!(btn instanceof HTMLElement)) return;
        const selected = String(btn.getAttribute('data-track') || '').trim();
        if (!selected || !this.audio) return;
        const wasPlaying = !!this.audio.snapshot()?.musicPlaying;
        setActiveTrack(selected, wasPlaying);
        if (wasPlaying && !this.audio.snapshot()?.musicPlaying) {
          const ok = await this.audio.playMusic();
          if (!ok) showToast('Track konnte nicht gestartet werden.', 'warning');
        }
        refreshAudioUi();
      });

      prevBtn?.addEventListener('click', async () => {
        await shiftTrack(-1);
      });

      nextBtn?.addEventListener('click', async () => {
        await shiftTrack(1);
      });

      nextQuickBtn?.addEventListener('click', async () => {
        await shiftTrack(1);
      });

      toggleBtn.addEventListener('click', async () => {
        if (!this.audio) return;
        const hasTrack = String(trackSelect.value || settingsState.musicUrl || '').trim();
        if (hasTrack && String(this.audio.snapshot()?.musicUrl || '').trim() !== hasTrack) {
          setActiveTrack(hasTrack, false);
        }

        const isPlaying = !!this.audio.snapshot()?.musicPlaying;
        if (isPlaying) {
          if (typeof this.audio.pauseMusic === 'function') this.audio.pauseMusic(false);
          else this.audio.stopMusic();
        } else {
          const ok = await this.audio.playMusic();
          if (!ok) showToast('Musik konnte nicht gestartet werden.', 'warning');
        }
        refreshAudioUi();
      });

      loadAudioTrackCatalog().catch(() => {});
      refreshAudioUi();
    }

    bindColonySelector() {
      if (!this.planetSelect) return;
      this.planetSelect.addEventListener('change', () => {
        if (this.audio && typeof this.audio.playNavigation === 'function') this.audio.playNavigation();
        const cid = parseInt(this.planetSelect.value, 10);
        selectColonyById(cid);
      });
    }

    init() {
      if (this.bound) return;
      this.bindNavButtons();
      this.bindTopbarButtons();
      this.bindAudioToggle();
      this.bindTopbarPlayer();
      this.bindColonySelector();
      this.bound = true;
    }
  }

  // ÔöÇÔöÇ Colony selector ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const planetSelect = document.getElementById('planet-select');
  const navigationController = new NavigationController({
    wm: WM,
    api: API,
    audio: audioManager,
    planetSelect,
  });
  window.GQNavigationController = navigationController;
  navigationController.init();

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

  class FleetController {
    prefillTarget(coords, mission, defaults = {}) {
      if (!coords) return;
      uiState.fleetPrefill = {
        galaxy: Number(coords.galaxy || 1),
        system: Number(coords.system || 1),
        position: Number(coords.position || 1),
        mission: String(mission || 'transport'),
        owner: defaults.owner || '',
        threatLevel: defaults.threatLevel || '',
        intel: defaults.intel || null,
        ts: Date.now(),
      };
      WM.open('fleet');
      setTimeout(() => {
        const root = WM.body('fleet');
        if (!root) return;
        const galaxyInput = root.querySelector('#f-galaxy');
        const systemInput = root.querySelector('#f-system');
        const positionInput = root.querySelector('#f-position');
        if (galaxyInput) galaxyInput.value = String(coords.galaxy || 1);
        if (systemInput) systemInput.value = String(coords.system || 1);
        if (positionInput) positionInput.value = String(coords.position || 1);
        const missionInput = root.querySelector(`input[name="mission"][value="${mission}"]`);
        if (missionInput) {
          missionInput.checked = true;
          missionInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, 0);
    }

    pickDefaultShips(mission, avail, intel) {
      const available = Array.isArray(avail) ? avail : [];
      const byType = Object.fromEntries(available.map((ship) => [String(ship.type), ship]));
      const selected = {};
      const choose = (type, amount) => {
        const ship = byType[type];
        if (!ship) return false;
        const count = Math.max(0, Math.min(Number(ship.count || 0), Number(amount || 0)));
        if (count > 0) {
          selected[type] = count;
          return true;
        }
        return false;
      };

      if (mission === 'spy') {
        if (!choose('espionage_probe', 1)) choose('pathfinder', 1);
        return selected;
      }
      if (mission === 'colonize') {
        choose('colony_ship', 1);
        choose('small_cargo', 1);
        choose('large_cargo', 1);
        return selected;
      }
      if (mission === 'harvest') {
        if (!choose('recycler', 4)) choose('pathfinder', 2);
        choose('large_cargo', 2);
        return selected;
      }
      if (mission === 'transport') {
        if (!choose('large_cargo', 8)) choose('small_cargo', 12);
        choose('pathfinder', 1);
        return selected;
      }

      if (mission === 'attack') {
        const threatScore = Number(intel?.threat?.score || 0);
        const heavyTarget = threatScore >= 80 ? 8 : threatScore >= 50 ? 5 : 3;
        const mediumTarget = threatScore >= 80 ? 12 : threatScore >= 50 ? 8 : 5;
        if (!choose('battlecruiser', heavyTarget)) choose('battleship', heavyTarget);
        choose('cruiser', mediumTarget);
        choose('heavy_fighter', mediumTarget);
        if (!Object.keys(selected).length) choose('light_fighter', Math.min(20, Number(byType.light_fighter?.count || 0)));
        return selected;
      }

      choose('small_cargo', 1);
      return selected;
    }

    applyMissionDefaults(root, avail, prefill) {
      if (!root) return;
      const fallbackPrefill = prefill || {};
      const mission = String(root.querySelector('input[name="mission"]:checked')?.value || fallbackPrefill.mission || 'transport');
      const selectedShips = this.pickDefaultShips(mission, avail, fallbackPrefill.intel);
      root.querySelectorAll('.fleet-ship-qty').forEach((inp) => {
        inp.value = String(selectedShips[inp.dataset.type] || 0);
      });

      const cargoMetal = root.querySelector('#f-cargo-metal');
      const cargoCrystal = root.querySelector('#f-cargo-crystal');
      const cargoDeut = root.querySelector('#f-cargo-deut');
      if (mission === 'transport' && currentColony) {
        const cargoCap = Object.entries(selectedShips).reduce((sum, [type, count]) => {
          const ship = (avail || []).find((entry) => entry.type === type);
          return sum + (Number(ship?.cargo || 0) * Number(count || 0));
        }, 0);
        const prefillCargo = fallbackPrefill.cargo && typeof fallbackPrefill.cargo === 'object'
          ? fallbackPrefill.cargo
          : null;
        const metal = prefillCargo
          ? Math.min(Number(currentColony.metal || 0), Math.max(0, Number(prefillCargo.metal || 0)), cargoCap)
          : Math.min(Number(currentColony.metal || 0), Math.round(cargoCap * 0.45));
        const crystal = prefillCargo
          ? Math.min(Number(currentColony.crystal || 0), Math.max(0, Number(prefillCargo.crystal || 0)), cargoCap)
          : Math.min(Number(currentColony.crystal || 0), Math.round(cargoCap * 0.3));
        const deut = prefillCargo
          ? Math.min(Number(currentColony.deuterium || 0), Math.max(0, Number(prefillCargo.deuterium || 0)), cargoCap)
          : Math.min(Number(currentColony.deuterium || 0), Math.round(cargoCap * 0.15));
        if (cargoMetal) cargoMetal.value = String(Math.max(0, metal));
        if (cargoCrystal) cargoCrystal.value = String(Math.max(0, crystal));
        if (cargoDeut) cargoDeut.value = String(Math.max(0, deut));
      } else {
        if (cargoMetal) cargoMetal.value = '0';
        if (cargoCrystal) cargoCrystal.value = '0';
        if (cargoDeut) cargoDeut.value = '0';
      }

      const hint = root.querySelector('#fleet-default-hint');
      if (hint) {
        const owner = fallbackPrefill.owner ? `Ziel: ${esc(fallbackPrefill.owner)}` : 'Freies Zielprofil';
        const threat = fallbackPrefill.threatLevel ? ` ┬À Bedrohung: ${esc(fallbackPrefill.threatLevel)}` : '';
        const scan = fallbackPrefill.intel?.intel?.latest_scan_at
          ? ` ┬À Scan: ${esc(new Date(fallbackPrefill.intel.intel.latest_scan_at).toLocaleString())}`
          : '';
        hint.innerHTML = `${owner}${threat}${scan} ┬À Missionsdefaults gesetzt.`;
      }
    }

    buildPayload(root) {
      const ships = {};
      root.querySelectorAll('.fleet-ship-qty').forEach((inp) => {
        const count = parseInt(inp.value, 10);
        if (count > 0) ships[inp.dataset.type] = count;
      });

      return {
        origin_colony_id: currentColony.id,
        target_galaxy: parseInt(root.querySelector('#f-galaxy').value, 10),
        target_system: parseInt(root.querySelector('#f-system').value, 10),
        target_position: parseInt(root.querySelector('#f-position').value, 10),
        mission: root.querySelector('input[name="mission"]:checked')?.value,
        use_wormhole: !!root.querySelector('#f-use-wormhole')?.checked,
        ships,
        cargo: {
          metal: parseFloat(root.querySelector('#f-cargo-metal').value) || 0,
          crystal: parseFloat(root.querySelector('#f-cargo-crystal').value) || 0,
          deuterium: parseFloat(root.querySelector('#f-cargo-deut').value) || 0,
        },
      };
    }

    bindMissionDefaults(root, avail) {
      root.querySelectorAll('input[name="mission"]').forEach((input) => {
        input.addEventListener('change', () => this.applyMissionDefaults(root, avail, uiState.fleetPrefill));
      });
    }

    async renderForm() {
      const root = WM.body('fleet');
      if (!root) return;
      if (!currentColony) {
        root.innerHTML = '<p class="text-muted">Select a colony first.</p>';
        return;
      }

      root.innerHTML = `
        <form id="fleet-form-wm" autocomplete="off">
          <h3>1. Select Ships</h3>
          <div id="fleet-ship-select-wm"><p class="text-muted">Loading shipsÔÇª</p></div>

          <h3>2. Select Mission</h3>
          <div class="mission-grid">
            <label><input type="radio" name="mission" value="attack" /> ÔÜö´©Å Attack colony</label>
            <label><input type="radio" name="mission" value="transport" checked /> ­ƒôª Transport resources</label>
            <label><input type="radio" name="mission" value="spy" /> ­ƒö¡ Spy on colony</label>
            <label><input type="radio" name="mission" value="colonize" /> ­ƒîì Colonize planet</label>
            <label><input type="radio" name="mission" value="harvest" /> ÔøÅ Harvest deposits</label>
            <label><input type="radio" name="mission" value="survey" /> ­ƒù║´©Å Survey system (FTL infrastructure)</label>
          </div>

          <h3>3. Target Coordinates</h3>
          <div class="coord-inputs">
            <label>Galaxy  <input type="number" id="f-galaxy"   min="1" max="9"   value="1" /></label>
            <label>System  <input type="number" id="f-system"   min="1" max="499" value="1" /></label>
            <label>Position<input type="number" id="f-position" min="1" max="15"  value="1" /></label>
          </div>

          <div class="form-info" id="fleet-wormhole-info" style="margin-top:0.4rem;">
            <label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;">
              <input type="checkbox" id="f-use-wormhole" />
              Use Wormhole Jump (requires Wormhole Theory Lv5 and active route)
            </label>
          </div>

          <div id="fleet-ftl-status" style="margin-top:0.4rem;padding:0.4rem 0.6rem;border-radius:4px;background:rgba(0,0,0,0.15);font-size:0.82rem;"></div>

          <h3>4. Cargo (optional)</h3>
          <div class="cargo-inputs">
            <label>Metal    <input type="number" id="f-cargo-metal"   min="0" value="0" /></label>
            <label>Crystal  <input type="number" id="f-cargo-crystal" min="0" value="0" /></label>
            <label>Deuterium<input type="number" id="f-cargo-deut"    min="0" value="0" /></label>
          </div>

          <div id="fleet-default-hint" class="form-info"></div>

          <button type="submit" class="btn btn-primary">­ƒÜÇ Launch Fleet</button>
          <div id="fleet-send-result-wm" class="form-info" aria-live="polite"></div>
        </form>`;

      try {
        const [data, wormholeData, ftlData] = await Promise.all([
          API.ships(currentColony.id),
          API.wormholes(currentColony.id).catch(() => ({ success: false, wormholes: [], wormhole_theory_level: 0, can_jump: false })),
          API.ftlStatus().catch(() => null),
        ]);
        const shipEl = root.querySelector('#fleet-ship-select-wm');
        const wormholeEl = root.querySelector('#fleet-wormhole-info');
        if (!data.success) {
          shipEl.innerHTML = '<p class="text-red">Error.</p>';
          return;
        }

        if (wormholeEl) {
          const routeCount = Array.isArray(wormholeData?.wormholes) ? wormholeData.wormholes.filter((w) => !!w.available).length : 0;
          const level = Number(wormholeData?.wormhole_theory_level || 0);
          const canJump = !!wormholeData?.can_jump;
          const cb = root.querySelector('#f-use-wormhole');
          if (cb && (!canJump || routeCount <= 0)) {
            cb.disabled = true;
            cb.checked = false;
          }
          const reason = canJump
            ? (routeCount > 0 ? `${routeCount} active route(s) from this colony.` : 'No active route currently available.')
            : `Wormhole Theory Lv5 required (current Lv${level}).`;
          wormholeEl.insertAdjacentHTML('beforeend', `<div class="text-muted small" style="margin-top:0.2rem;">${esc(reason)}</div>`);
        }

        // ÔöÇÔöÇ FTL drive status panel ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
        const ftlEl = root.querySelector('#fleet-ftl-status');
        if (ftlEl && ftlData?.success) {
          const driveLabels = {
            vor_tak:  "ÔÜö´©Å Vor'Tak ÔÇö K-F Jump Drive",
            syl_nar:  "­ƒÉÖ Syl'Nar ÔÇö Resonance Gate Network",
            vel_ar:   "­ƒªà Vel'Ar ÔÇö Blind Quantum Jump",
            zhareen:  "­ƒÆÄ Zhareen ÔÇö Crystal Resonance Channel",
            aereth:   "Ô£ª Aereth ÔÇö Alcubierre Warp",
            kryl_tha: "­ƒ¬▓ Kryl'Tha ÔÇö Swarm Tunnel",
          };
          const driveType = ftlData.ftl_drive_type || 'aereth';
          const driveLabel = driveLabels[driveType] || driveType;
          const ready = !!ftlData.ftl_ready;
          const cooldownSec = Number(ftlData.ftl_cooldown_remaining_s || 0);
          const cooldownStr = cooldownSec > 0
            ? `Recharging: ${Math.floor(cooldownSec/3600)}h ${Math.floor((cooldownSec%3600)/60)}m remaining`
            : 'Ô£à Ready';

          let extraInfo = '';
          if (driveType === 'syl_nar') {
            const gateCount = Array.isArray(ftlData.gates) ? ftlData.gates.filter((g) => g.is_active && g.health > 0).length : 0;
            extraInfo = ` ┬À ${gateCount} gate(s) active ┬À Survey to build new gates`;
          } else if (driveType === 'zhareen') {
            const nodeCount = Array.isArray(ftlData.resonance_nodes) ? ftlData.resonance_nodes.length : 0;
            extraInfo = ` ┬À ${nodeCount} node(s) charted ┬À Survey to chart new nodes`;
          } else if (driveType === 'aereth') {
            extraInfo = ' ┬À Core bonus: +50% speed in galaxies Ôëñ3, ÔêÆ30% in galaxies ÔëÑ7';
          } else if (driveType === 'kryl_tha') {
            extraInfo = ' ┬À Max 50 ships per FTL jump ┬À ÔêÆ10% hull after each jump';
          } else if (driveType === 'vel_ar') {
            extraInfo = ' ┬À Arrival scatter: 0.5% of distance ┬À 60s stealth on landing';
          } else if (driveType === 'vor_tak') {
            extraInfo = ' ┬À Max 30 LY ┬À 72h recharge ┬À Carrier gives +30% cargo';
          }

          ftlEl.innerHTML = `<span style="color:#88ccff;font-weight:600;">${esc(driveLabel)}</span>`
            + ` <span style="color:${ready ? '#88ff88' : '#ffcc44'}">${esc(cooldownStr)}</span>`
            + `<span style="color:#aaa">${esc(extraInfo)}</span>`
            + (!ready && driveType === 'vor_tak'
              ? ` <button class="btn btn-sm" id="ftl-reset-cooldown-btn" style="margin-left:0.5rem;font-size:0.75rem;">Reset (50 Ôùå)</button>`
              : '');
          // Wire cooldown reset button
          const resetBtn = ftlEl.querySelector('#ftl-reset-cooldown-btn');
          if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
              resetBtn.disabled = true;
              resetBtn.textContent = 'ÔÇª';
              try {
                const res = await API.resetFtlCooldown();
                if (res?.success) {
                  showToast(res.message || 'FTL cooldown reset.', 'success');
                  WM.refresh('fleet');
                } else {
                  showToast(res?.error || 'Reset failed.', 'error');
                  resetBtn.disabled = false;
                  resetBtn.textContent = 'Reset (50 Ôùå)';
                }
              } catch {
                showToast('Reset failed.', 'error');
                resetBtn.disabled = false;
                resetBtn.textContent = 'Reset (50 Ôùå)';
              }
            });
          }
        } else if (ftlEl) {
          ftlEl.innerHTML = '';
        }
        // ÔöÇÔöÇ end FTL panel ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

        const avail = [...(data.ships || []), ...(data.blueprints || [])].filter((ship) => Number(ship.count || 0) > 0);
        if (!avail.length) {
          shipEl.innerHTML = '<p class="text-muted">No ships on this planet.</p>';
          return;
        }
        shipEl.innerHTML = `<div class="ship-selector-grid">${avail.map((ship) => `
          <div class="ship-selector-row">
            <span>${esc(ship.name || fmtName(ship.type))}${ship.ship_class ? ` ┬À ${esc(fmtName(ship.ship_class))}` : ''} (${ship.count})</span>
            <input type="number" class="fleet-ship-qty" data-type="${esc(ship.type)}"
                   min="0" max="${ship.count}" value="0" />
          </div>`).join('')}</div>`;
        this.bindMissionDefaults(root, avail);
        this.applyMissionDefaults(root, avail, uiState.fleetPrefill);
      } catch (_) {}

      root.querySelector('#fleet-form-wm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const resultEl = root.querySelector('#fleet-send-result-wm');
        resultEl.textContent = '';

        const payload = this.buildPayload(root);
        const mission = payload.mission;
        const submitBtn = root.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        try {
          const response = await API.sendFleet(payload);
          if (response.success) {
            resultEl.className = 'form-info';
            resultEl.textContent = `Fleet launched! ETA: ${new Date(response.arrival_time).toLocaleString()}`;
            showToast('­ƒÜÇ Fleet launched!', 'success');
            if (audioManager && typeof audioManager.playFleetMission === 'function') audioManager.playFleetMission(mission);
            else if (audioManager && typeof audioManager.playFleetLaunch === 'function') audioManager.playFleetLaunch();
            await loadOverview();
          } else {
            resultEl.className = 'form-error';
            resultEl.textContent = response.error || 'Failed to send fleet.';
          }
        } catch (_) {
          resultEl.className = 'form-error';
          resultEl.textContent = 'Network error.';
        }
        submitBtn.disabled = false;
      });
    }
  }

  const fleetController = new FleetController();
  window.GQFleetController = fleetController;

  function prefillFleetTarget(coords, mission, defaults = {}) {
    fleetController.prefillTarget(coords, mission, defaults);
  }

  class WormholeController {
    resolveOriginCoords() {
      const g = Number(currentColony?.galaxy || 0);
      const s = Number(currentColony?.system || 0);
      return { g, s };
    }

    resolveCounterpart(wormhole, origin) {
      const a = wormhole?.a || {};
      const b = wormhole?.b || {};
      const originMatchesA = Number(a.galaxy || 0) === origin.g && Number(a.system || 0) === origin.s;
      if (originMatchesA) return b;
      const originMatchesB = Number(b.galaxy || 0) === origin.g && Number(b.system || 0) === origin.s;
      if (originMatchesB) return a;
      return b;
    }

    async openFleetWithWormholeTarget(endpoint) {
      WM.open('fleet');
      await waitFor(120);
      const root = WM.body('fleet');
      if (!root) return;

      const gInput = root.querySelector('#f-galaxy');
      const sInput = root.querySelector('#f-system');
      const pInput = root.querySelector('#f-position');
      const cb = root.querySelector('#f-use-wormhole');
      const missionTransport = root.querySelector('input[name="mission"][value="transport"]');

      if (gInput) gInput.value = String(Number(endpoint?.galaxy || 1));
      if (sInput) sInput.value = String(Number(endpoint?.system || 1));
      if (pInput) pInput.value = String(Number(pInput?.value || 1));
      if (missionTransport) {
        missionTransport.checked = true;
        missionTransport.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (cb && !cb.disabled) cb.checked = true;
      showToast('Fleet target prefilled for wormhole jump.', 'info');
    }

    buildCardsHtml(payload) {
      const wormholes = Array.isArray(payload?.wormholes) ? payload.wormholes : [];
      const canJump = !!payload?.can_jump;
      const level = Number(payload?.wormhole_theory_level || 0);
      const origin = this.resolveOriginCoords();

      if (!wormholes.length) {
        return uiKitEmptyStateHTML(
          'No Wormhole Routes',
          canJump
            ? 'No active route starts at this colony system.'
            : `Wormhole Theory Lv5 required (current Lv${level}).`
        );
      }

      return `<div class="card-grid">${wormholes.map((w) => {
        const to = this.resolveCounterpart(w, origin);
        const available = !!w.available;
        const isPermanent = !!w.is_permanent;
        const unlocked = !!w.unlocked;
        const statusCls = available ? 'resource-positive' : 'text-muted';
        const cooldown = w.cooldown_until ? new Date(w.cooldown_until).toLocaleString() : 'ready';
        const availabilityText = available
          ? 'Available for jump'
          : (isPermanent && !unlocked ? 'Requires Precursor beacon unlock quest' : 'Unavailable');
        return `
          <div class="item-card">
            <div class="item-card-header">
              <span class="item-name">${esc(String(w.label || `Route #${w.id}`))}</span>
              <span class="item-level">Stability ${fmt(w.stability || 0)}</span>
            </div>
            ${isPermanent ? '<div class="system-row small">Permanent Beacon Route</div>' : ''}
            <div class="system-row small">A: [${fmt(w.a?.galaxy || 0)}:${fmt(w.a?.system || 0)}] ┬À B: [${fmt(w.b?.galaxy || 0)}:${fmt(w.b?.system || 0)}]</div>
            <div class="system-row small">Jump target from here: [${fmt(to?.galaxy || 0)}:${fmt(to?.system || 0)}]</div>
            <div class="system-row small">Cooldown: ${esc(cooldown)}</div>
            <div class="system-row small ${statusCls}">${availabilityText}</div>
            ${available
              ? `<button class="btn btn-primary btn-sm wormhole-use-btn" data-target-g="${esc(String(to?.galaxy || 1))}" data-target-s="${esc(String(to?.system || 1))}">Use Wormhole (Fleet)</button>`
              : `<button class="btn btn-secondary btn-sm" disabled>Unavailable</button>`}
          </div>`;
      }).join('')}</div>`;
    }

    bindActions(root) {
      root.querySelectorAll('.wormhole-use-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const g = Number(btn.getAttribute('data-target-g') || 1);
          const s = Number(btn.getAttribute('data-target-s') || 1);
          await this.openFleetWithWormholeTarget({ galaxy: g, system: s });
        });
      });
    }

    async render() {
      const root = WM.body('wormholes');
      if (!root) return;
      if (!currentColony) {
        root.innerHTML = '<p class="text-muted">Select a colony first.</p>';
        return;
      }

      root.innerHTML = uiKitSkeletonHTML();
      try {
        const data = await API.wormholes(currentColony.id);
        if (!data?.success) {
          root.innerHTML = '<p class="text-red">Failed to load wormholes.</p>';
          return;
        }
        root.innerHTML = this.buildCardsHtml(data);
        this.bindActions(root);
      } catch (_) {
        root.innerHTML = '<p class="text-red">Failed to load wormholes.</p>';
      }
    }
  }

  const wormholeController = new WormholeController();
  window.GQWormholeController = wormholeController;

  async function renderWormholes() {
    await wormholeController.render();
  }

  class GalaxyController {
    showShortcutsHintOnce() {
      if (galaxyShortcutsHintShownInSession) return;
      showToast('Galaxy-Shortcuts: O Controls, I Info, L Follow, V Vectors.', 'info');
      galaxyShortcutsHintShownInSession = true;
    }

    showFleetLegendHintOnce() {
      if (galaxyFleetHintShownInSession) return;
      if (hasSeenGalaxyFleetHint()) {
        galaxyFleetHintShownInSession = true;
        return;
      }

      showToastWithAction(
        'Tipp: Fleet-Richtungsfarben und Marker findest du in Settings unter "Galaxy: Fleet-Marker und Fluglinien anzeigen".',
        'info',
        'Nicht mehr anzeigen',
        () => {
          markGalaxyFleetHintSeen();
        },
        8500
      );
      galaxyFleetHintShownInSession = true;
    }

    scheduleFleetLegendHint(delayMs = 1300) {
      if (galaxyFleetHintShownInSession || galaxyFleetHintScheduledInSession) return;
      galaxyFleetHintScheduledInSession = true;
      window.setTimeout(() => {
        this.showFleetLegendHintOnce();
      }, Math.max(0, Number(delayMs || 0)));
    }

    triggerNavAction(action, rootRef = null) {
      const root = rootRef || WM.body('galaxy');
      if (!galaxy3d && root) {
        this.init3D(root);
        if (galaxy3d) {
          this.loadStars3D(root).catch(() => {});
        }
      }
      if (!galaxy3d) {
        showToast('3D-Renderer ist noch nicht bereit.', 'warning');
        return;
      }
      const normalized = String(action || '');
      if (audioManager) audioManager.playUiClick();
      if (normalized === 'zoom-in' && typeof galaxy3d.nudgeZoom === 'function') galaxy3d.nudgeZoom('in');
      else if (normalized === 'zoom-out' && typeof galaxy3d.nudgeZoom === 'function') galaxy3d.nudgeZoom('out');
      else if (normalized === 'rotate-left' && typeof galaxy3d.nudgeOrbit === 'function') galaxy3d.nudgeOrbit('left');
      else if (normalized === 'rotate-right' && typeof galaxy3d.nudgeOrbit === 'function') galaxy3d.nudgeOrbit('right');
      else if (normalized === 'rotate-up' && typeof galaxy3d.nudgeOrbit === 'function') galaxy3d.nudgeOrbit('up');
      else if (normalized === 'rotate-down' && typeof galaxy3d.nudgeOrbit === 'function') galaxy3d.nudgeOrbit('down');
      else if (normalized === 'pan-left' && typeof galaxy3d.nudgePan === 'function') galaxy3d.nudgePan('left');
      else if (normalized === 'pan-right' && typeof galaxy3d.nudgePan === 'function') galaxy3d.nudgePan('right');
      else if (normalized === 'pan-up' && typeof galaxy3d.nudgePan === 'function') galaxy3d.nudgePan('up');
      else if (normalized === 'pan-down' && typeof galaxy3d.nudgePan === 'function') galaxy3d.nudgePan('down');
      else if (normalized === 'pan-up-left' && typeof galaxy3d.nudgePan === 'function') galaxy3d.nudgePan('up-left');
      else if (normalized === 'pan-up-right' && typeof galaxy3d.nudgePan === 'function') galaxy3d.nudgePan('up-right');
      else if (normalized === 'pan-down-left' && typeof galaxy3d.nudgePan === 'function') galaxy3d.nudgePan('down-left');
      else if (normalized === 'pan-down-right' && typeof galaxy3d.nudgePan === 'function') galaxy3d.nudgePan('down-right');
      else if (normalized === 'reset' && typeof galaxy3d.resetNavigationView === 'function') galaxy3d.resetNavigationView();
      else if (normalized === 'focus' && typeof galaxy3d.focusCurrentSelection === 'function') galaxy3d.focusCurrentSelection();
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
        if (galaxy3d.systemMode && typeof galaxy3d.exitSystemView === 'function') {
          galaxy3d.exitSystemView(true);
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
      renderGalaxySystemDetails(root, target, !!galaxy3d?.systemMode);
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
        if (!silent) showToast('Kein Heimatplanet verf├╝gbar.', 'warning');
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
        if (!silent) showToast('Heimatsystem nicht im aktuellen Sternbereich gefunden.', 'warning');
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

      if (shouldEnterSystem && !galaxy3d?.systemMode) {
        renderGalaxySystemDetails(root, target, true);
        await loadStarSystemPlanets(root, target);
        if (cinematic) {
          await waitMs(450);
        }
      } else {
        renderGalaxySystemDetails(root, target, !!galaxy3d?.systemMode);
      }

      if (shouldFocusPlanet && galaxy3d?.systemMode && typeof galaxy3d.focusOnSystemPlanet === 'function') {
        galaxy3d.focusOnSystemPlanet({ position: p }, true);
        if (cinematic) {
          await waitMs(350);
        }
      }

      if (!silent) {
        showToast(`Heimatnavigation: ${target.name || target.catalog_name || `System ${s}`}`, 'success');
      }
    }

    init3D(root) {
      const holder = document.getElementById('galaxy-3d-host');
      const hostWrapper = document.getElementById('galaxy-host-wrapper');
      const sharedCanvas = holder?.querySelector('#starfield');
      if (!holder) {
        galaxy3dInitReason = 'Missing #galaxy-3d-host container';
        root.querySelector('#galaxy-system-details').innerHTML = `<span class="text-red">3D engine failed to load. Reason: ${esc(galaxy3dInitReason)}</span>`;
        toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
        return;
      }
      if (!window.Galaxy3DRenderer) {
        galaxy3dInitReason = 'window.Galaxy3DRenderer unavailable';
        root.querySelector('#galaxy-system-details').innerHTML = `<span class="text-red">3D engine failed to load. Reason: ${esc(galaxy3dInitReason)}</span>`;
        toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
        return;
      }

      if (galaxy3d) {
        galaxy3d.destroy();
        galaxy3d = null;
      }

      galaxyAutoFramedOnce = false;

      try {
        const resolvedRendererQuality = window.GQGalaxyRendererConfig?.resolveQualityProfile?.({
          requestedProfile: settingsState.renderQualityProfile || 'auto',
        }) || null;
        galaxy3dQualityState = resolvedRendererQuality;
        const authBgControl = window.GQAuthGalaxyBackgroundControl || window.GQStarfieldControl;
        if (authBgControl && typeof authBgControl.releaseCanvasForGame === 'function') {
          authBgControl.releaseCanvasForGame();
        }

        const stage = root?.querySelector('.galaxy-3d-stage') || document.getElementById('galaxy-stage');
        if (stage) {
          stage.style.pointerEvents = 'none';
          stage.style.zIndex = '1';
        }
        if (hostWrapper) {
          hostWrapper.style.display = 'block';
          hostWrapper.style.visibility = 'visible';
          hostWrapper.style.opacity = '1';
        }
        if (holder) {
          holder.style.display = 'block';
          holder.style.visibility = 'visible';
          holder.style.opacity = '1';
        }
        if (sharedCanvas instanceof HTMLCanvasElement) {
          sharedCanvas.style.display = 'block';
          sharedCanvas.style.opacity = '1';
          sharedCanvas.style.visibility = 'visible';
          sharedCanvas.style.pointerEvents = 'auto';
        }

        galaxy3d = new window.Galaxy3DRenderer(holder, {
          externalCanvas: sharedCanvas instanceof HTMLCanvasElement ? sharedCanvas : null,
          interactive: true,
          qualityProfile: resolvedRendererQuality?.name || settingsState.renderQualityProfile || 'auto',
          onHover: (star, pos) => updateGalaxyHoverCard(root, star, pos, false),
          onClick: (star, pos) => {
            if (star?.__kind === 'planet') {
              focusPlanetDetailsInOverlay(root, star, false, false);
              updateGalaxyHoverCard(root, star, pos, true);
              return;
            }
            if (star?.__kind === 'cluster') {
              pinnedStar = star;
              toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
              updateGalaxyHoverCard(root, star, pos, true);
              renderGalaxySystemDetails(root, star, false);
              applyClusterRangeToControls(root, star, { toast: false });
              flashGalaxyControlBtn(root, '#gal-cluster-bounds-btn');
              return;
            }
            pinnedStar = star;
            toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
            updateGalaxyHoverCard(root, star, pos, true);
            renderGalaxySystemDetails(root, star, false);
          },
          onDoubleClick: async (star, pos) => {
            if (star?.__kind === 'planet') {
              focusPlanetDetailsInOverlay(root, star, true, true);
              updateGalaxyHoverCard(root, star, pos, true);
              return;
            }
            if (star?.__kind === 'cluster') {
              pinnedStar = star;
              toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
              updateGalaxyHoverCard(root, star, pos, true);
              renderGalaxySystemDetails(root, star, true);
              const range = applyClusterRangeToControls(root, star, { toast: true });
              if (range) {
                flashGalaxyControlBtn(root, '#gal-cluster-bounds-btn');
                await loadGalaxyStars3D(root);
              }
              return;
            }
            if (audioManager && typeof audioManager.setScene === 'function') {
              audioManager.setScene('system', { autoplay: true, transition: 'soft', minHoldMs: 700 });
            }
            pinnedStar = star;
            toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
            updateGalaxyHoverCard(root, star, pos, true);
            renderGalaxySystemDetails(root, star, true);
            await loadStarSystemPlanets(root, star);
          },
          onSystemZoomOut: (star) => {
            if (audioManager && typeof audioManager.setScene === 'function') {
              audioManager.setScene('galaxy', { autoplay: true, transition: 'soft', minHoldMs: 700 });
            }
            if (galaxy3d && typeof galaxy3d.exitSystemView === 'function') {
              galaxy3d.exitSystemView(true);
            }
            pinnedStar = star || null;
            renderGalaxySystemDetails(root, star, false);
            const panel = root.querySelector('#galaxy-planets-panel');
            if (panel) renderGalaxyColonySummary(panel, galaxyStars, uiState.activeRange || null);
          },
          onPlanetZoomOut: (star) => {
            if (audioManager && typeof audioManager.setScene === 'function') {
              audioManager.setScene('system', { autoplay: true, transition: 'normal', minHoldMs: 500 });
            }
            if (star) renderGalaxySystemDetails(root, star, true);
          },
        });

        if (typeof galaxy3d.getQualityProfileState === 'function') {
          galaxy3dQualityState = galaxy3d.getQualityProfileState();
        }
        if (settingsState.renderQualityProfile === 'auto' && galaxy3dQualityState?.name === 'low') {
          showToast('Low-End-Rendering aktiv: Pixel Ratio, Cache-Gr├Â├ƒen und FX wurden reduziert.', 'warning');
        }
        if (galaxy3d?.renderer?.domElement) {
          galaxy3d.renderer.domElement.style.pointerEvents = 'auto';
        }
        galaxy3dQualityState = null;
        // Window-manager transitions can report stale host bounds for a frame.
        // Trigger a few deferred resizes so the renderer matches the visible host.
        const kickResize = () => {
          try {
            if (galaxy3d && typeof galaxy3d.resize === 'function') galaxy3d.resize();
          } catch (_) {}
        };
        kickResize();
        setTimeout(kickResize, 60);
        setTimeout(kickResize, 220);
        galaxy3dInitReason = '';
        if (typeof galaxy3d.setClusterColorPalette === 'function') {
          galaxy3d.setClusterColorPalette(resolveClusterColorPalette(uiState.territory));
        }
        applyRuntimeSettings();
        refreshGalaxyDensityMetrics(root);
        updateGalaxyFollowUi(root);
        updateClusterBoundsUi(root);
      } catch (err) {
        galaxy3d = null;
        console.error('Galaxy3D init failed:', err);
        galaxy3dInitReason = String(err?.message || err || 'unknown error');
        const reason = esc(galaxy3dInitReason);
        root.querySelector('#galaxy-system-details').innerHTML = `<span class="text-red">3D renderer unavailable. Fallback list active. Reason: ${reason}</span>`;
        toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
      }
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
                <span class="galaxy-overlay-hotkeys">O:Controls ┬À I:Info ┬À L:Follow ┬À V:Vectors</span>
                <button class="btn btn-sm" data-overlay-close="#galaxy-controls-overlay">Close</button>
              </div>
              <div class="galaxy-nav">
                <label>Galaxy: <input type="number" id="gal-galaxy" min="1" max="9" value="1" /></label>
                <label>From: <input type="number" id="gal-from" min="1" max="${galaxySystemMax}" value="1" /></label>
                <label>To: <input type="number" id="gal-to" min="1" max="${galaxySystemMax}" value="${galaxySystemMax}" /></label>
                <button class="btn btn-secondary" id="gal-follow-toggle-btn">Follow: on</button>
                <label>Policy:
                  <select id="gal-policy-profile">
                    <option value="auto" ${activePolicyMode === 'auto' ? 'selected' : ''}>Auto (${POLICY_PROFILES[activePolicyProfile].label})</option>
                    <option value="balanced" ${activePolicyMode === 'manual' && activePolicyProfile === 'balanced' ? 'selected' : ''}>Balanced</option>
                    <option value="cache_aggressive" ${activePolicyMode === 'manual' && activePolicyProfile === 'cache_aggressive' ? 'selected' : ''}>Aggressive Cache</option>
                    <option value="always_fresh" ${activePolicyMode === 'manual' && activePolicyProfile === 'always_fresh' ? 'selected' : ''}>Always Fresh</option>
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
                <button class="btn btn-secondary" id="gal-colonies-only-btn">Nur Kolonien: aus</button>
                <button class="btn btn-secondary" id="gal-core-fx-btn">Core FX: on</button>
                <button class="btn btn-secondary" id="gal-fleet-vectors-btn">Fleet Vectors: on</button>
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
              <div class="galaxy-overlay-shortcuts">Shortcuts: O Controls ┬À I Info ┬À L Follow ┬À V Vectors</div>
              <div id="galaxy-system-details" class="text-muted">Overlay hidden. Press I to open details.</div>
              <div class="galaxy-colony-legend" aria-label="Kolonie-Ring-Legende">
                <div class="galaxy-colony-legend-title">Kolonie-Ringe</div>
                <div class="galaxy-colony-legend-row"><span class="galaxy-colony-legend-ring galaxy-colony-legend-ring-sm"></span><span>Au├ƒenposten</span></div>
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
                <strong>Nav Orb</strong>
              </div>
              <div class="galaxy-nav-orb-body">
                <button class="galaxy-nav-btn zoom" type="button" data-nav-action="zoom-in" title="Zoom in">+</button>
                <div class="galaxy-nav-orb-pad" aria-label="Orbit controls">
                  <button class="galaxy-nav-btn" type="button" data-nav-action="rotate-up" title="Rotate up">Ôû▓</button>
                  <div class="galaxy-nav-orb-row">
                    <button class="galaxy-nav-btn" type="button" data-nav-action="rotate-left" title="Rotate left">ÔùÇ</button>
                    <button class="galaxy-nav-btn galaxy-nav-btn-center" type="button" data-nav-action="focus" title="Focus selection">ÔùÄ</button>
                    <button class="galaxy-nav-btn" type="button" data-nav-action="rotate-right" title="Rotate right">ÔûÂ</button>
                  </div>
                  <button class="galaxy-nav-btn" type="button" data-nav-action="rotate-down" title="Rotate down">Ôû╝</button>
                </div>
                <button class="galaxy-nav-btn zoom" type="button" data-nav-action="zoom-out" title="Zoom out">ÔêÆ</button>
              </div>
              <div class="galaxy-nav-strip">
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-up-left" title="Pan up-left">Ôåû</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-up" title="Pan up">Ôåæ</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-up-right" title="Pan up-right">Ôåù</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-left" title="Pan left">ÔåÉ</button>
                <button class="galaxy-nav-mini-btn galaxy-nav-mini-btn-center galaxy-nav-reset-btn" type="button" data-nav-action="reset" title="Reset view">Reset</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-right" title="Pan right">ÔåÆ</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-down-left" title="Pan down-left">ÔåÖ</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-down" title="Pan down">Ôåô</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-down-right" title="Pan down-right">Ôåÿ</button>
              </div>
              <div class="galaxy-nav-strip" style="margin-top:0.3rem;grid-template-columns:1fr;">
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="home" title="Jump to home system">­ƒÅá Home</button>
              </div>
            </div>
          </div>
        `;


      const stageEl = root.querySelector('.galaxy-3d-stage');
      if (stageEl) {
        stageEl.style.pointerEvents = 'none';
        stageEl.style.zIndex = '1';
      }
      root.querySelectorAll('.galaxy-overlay-window').forEach((overlay) => {
        overlay.style.pointerEvents = 'auto';
      });
        bindGalaxyOverlayHotkeys();
        makeGalaxyOverlayDraggable(root, '#galaxy-controls-overlay');
        makeGalaxyOverlayDraggable(root, '#galaxy-info-overlay');
        makeGalaxyOverlayDraggable(root, '#galaxy-nav-orb-overlay');
        bindGalaxyNavOrb(root);

        root.querySelector('#gal-load-3d-btn').addEventListener('click', () => this.loadStars3D(root));
        root.querySelector('#gal-follow-toggle-btn').addEventListener('click', () => {
          if (!galaxy3d || typeof galaxy3d.toggleFollowSelection !== 'function') return;
          galaxy3d.toggleFollowSelection();
          updateGalaxyFollowUi(root);
        });
        root.querySelector('#gal-cluster-bounds-btn')?.addEventListener('click', () => {
          settingsState.clusterBoundsVisible = !(settingsState.clusterBoundsVisible !== false);
          applyRuntimeSettings();
          refreshGalaxyDensityMetrics(root);
          updateClusterBoundsUi(root);
          saveUiSettings();
          showToast(`Cluster-Boxen: ${settingsState.clusterBoundsVisible ? 'an' : 'aus'}`, 'info');
        });
        root.querySelector('#gal-colonies-only-btn')?.addEventListener('click', () => {
          const modes = ['all', 'colonies', 'own', 'foreign'];
          const currentIndex = modes.indexOf(getGalaxyColonyFilterMode());
          settingsState.galaxyColonyFilterMode = modes[(currentIndex + 1 + modes.length) % modes.length];
          settingsState.galaxyColoniesOnly = settingsState.galaxyColonyFilterMode !== 'all';
          refreshGalaxyDensityMetrics(root);
          updateGalaxyColonyFilterUi(root);
          saveUiSettings();
          this.loadStars3D(root);
          const modeLabels = {
            all: 'alle Systeme',
            colonies: 'nur Kolonien',
            own: 'nur eigene Kolonien',
            foreign: 'nur fremde Kolonien',
          };
          showToast(`Galaxie-Filter: ${modeLabels[getGalaxyColonyFilterMode()] || 'alle Systeme'}`, 'info');
        });
        root.querySelector('#gal-core-fx-btn')?.addEventListener('click', () => {
          settingsState.galacticCoreFxAuto = false;
          settingsState.galacticCoreFxEnabled = !(settingsState.galacticCoreFxEnabled !== false);
          applyRuntimeSettings();
          this.updateCoreFxUi(root);
          saveUiSettings();
          showToast(`Galactic Core FX: ${settingsState.galacticCoreFxEnabled ? 'an' : 'aus'}`, 'info');
        });
        root.querySelector('#gal-fleet-vectors-btn')?.addEventListener('click', () => {
          settingsState.galaxyFleetVectorsVisible = !(settingsState.galaxyFleetVectorsVisible !== false);
          applyRuntimeSettings();
          this.updateFleetVectorsUi(root);
          if (root?.querySelector('#galaxy-system-details')) {
            renderGalaxySystemDetails(root, pinnedStar || uiState.activeStar || null, !!galaxy3d?.systemMode);
          }
          saveUiSettings();
          showToast(`Fleet-Vektoren: ${settingsState.galaxyFleetVectorsVisible ? 'an' : 'aus'}`, 'info');
        });
        root.querySelector('#gal-magnet-hover-toggle-btn')?.addEventListener('click', () => {
          settingsState.hoverMagnetEnabled = !(settingsState.hoverMagnetEnabled !== false);
          applyRuntimeSettings();
          this.updateMagnetUi(root);
          saveUiSettings();
          showToast(`Magnet-Hover: ${settingsState.hoverMagnetEnabled ? 'an' : 'aus'}`, 'info');
        });
        root.querySelector('#gal-magnet-click-toggle-btn')?.addEventListener('click', () => {
          settingsState.clickMagnetEnabled = !(settingsState.clickMagnetEnabled !== false);
          applyRuntimeSettings();
          this.updateMagnetUi(root);
          saveUiSettings();
          showToast(`Magnet-Klick: ${settingsState.clickMagnetEnabled ? 'an' : 'aus'}`, 'info');
        });
        root.querySelector('#gal-magnet-star-px')?.addEventListener('input', (e) => {
          settingsState.hoverMagnetStarPx = Math.max(8, Math.min(64, Number(e.target.value || 24)));
          settingsState.magnetPreset = 'custom';
          applyRuntimeSettings();
          this.updateMagnetUi(root);
          saveUiSettings();
        });
        root.querySelector('#gal-magnet-planet-px')?.addEventListener('input', (e) => {
          settingsState.hoverMagnetPlanetPx = Math.max(8, Math.min(72, Number(e.target.value || 30)));
          settingsState.magnetPreset = 'custom';
          applyRuntimeSettings();
          this.updateMagnetUi(root);
          saveUiSettings();
        });
        root.querySelector('#gal-magnet-cluster-px')?.addEventListener('input', (e) => {
          settingsState.hoverMagnetClusterPx = Math.max(8, Math.min(72, Number(e.target.value || 28)));
          settingsState.magnetPreset = 'custom';
          applyRuntimeSettings();
          this.updateMagnetUi(root);
          saveUiSettings();
        });
        root.querySelectorAll('[data-magnet-preset]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const preset = String(btn.getAttribute('data-magnet-preset') || 'balanced');
            this.applyMagnetPreset(preset, root);
          });
        });
        root.querySelector('#gal-policy-profile').addEventListener('change', (e) => {
          const selected = String(e.target.value || 'auto');
          if (selected === 'auto') {
            applyPolicyMode('auto');
            showToast(`Policy: Auto -> ${POLICY_PROFILES[activePolicyProfile].label}`, 'info');
          } else {
            applyPolicyMode('manual', selected);
            showToast(`Policy: ${POLICY_PROFILES[activePolicyProfile].label}`, 'info');
          }
          refreshPolicyUi(root);
          this.loadStars3D(root);
        });
        root.querySelector('#gal-cluster-density')?.addEventListener('change', (e) => {
          const selected = String(e.target.value || 'auto').toLowerCase();
          settingsState.clusterDensityMode = ['auto', 'high', 'max'].includes(selected) ? selected : 'auto';
          applyRuntimeSettings();
          refreshGalaxyDensityMetrics(root);
          saveUiSettings();
          showToast(`Cluster-Dichte: ${settingsState.clusterDensityMode.toUpperCase()}`, 'info');
        });
        root.querySelector('#gal-clear-cache-btn').addEventListener('click', async () => {
          galaxyHydrationToken += 1;
          if (galaxyModel) galaxyModel.clearAll();
          if (galaxyDB) await galaxyDB.clearAll();
          galaxyStars = [];
          pinnedStar = null;
          if (galaxy3d) galaxy3d.setStars([]);
          const details = root.querySelector('#galaxy-system-details');
          const panel = root.querySelector('#galaxy-planets-panel');
          if (details) details.innerHTML = '<span class="text-muted">Galaxy cache cleared.</span>';
          if (panel) panel.innerHTML = '';
          showToast('Galaxy cache cleared.', 'success');
        });
        root.querySelector('#galaxy-debug-copy-btn')?.addEventListener('click', () => {
          copyLastGalaxyDebugError();
        });
        root.querySelector('#galaxy-debug-download-btn')?.addEventListener('click', () => {
          downloadGalaxyDebugLog();
        });
        root.querySelector('#galaxy-debug-clear-btn')?.addEventListener('click', () => {
          clearGalaxyDebugErrors();
        });
        root.querySelector('#gal-from').addEventListener('change', () => {
          const from = root.querySelector('#gal-from');
          const to = root.querySelector('#gal-to');
          if (parseInt(from.value, 10) > parseInt(to.value, 10)) to.value = from.value;
        });

        root.querySelectorAll('[data-overlay-close]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const selector = btn.getAttribute('data-overlay-close');
            if (!selector) return;
            toggleGalaxyOverlay(root, selector, false);
          });
        });

        refreshPolicyUi(root);
        refreshGalaxyHealth(root, false);
        refreshGalaxyDensityMetrics(root);
        updateGalaxyFollowUi(root);
        updateClusterBoundsUi(root);
        updateGalaxyColonyFilterUi(root);
        this.updateCoreFxUi(root);
        this.updateFleetVectorsUi(root);
        this.updateMagnetUi(root);
        renderGalaxyDebugPanel(root);
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

      this.showShortcutsHintOnce();
      this.scheduleFleetLegendHint(1300);

      refreshGalaxyDensityMetrics(root);
      updateGalaxyFollowUi(root);
      updateClusterBoundsUi(root);
      updateGalaxyColonyFilterUi(root);
      this.updateCoreFxUi(root);
      this.updateFleetVectorsUi(root);
      this.updateMagnetUi(root);
    }

    async loadStars3D(root) {
      const details = root.querySelector('#galaxy-system-details');
      if (activePolicyMode === 'auto') {
        applyPolicyMode('auto');
        refreshPolicyUi(root);
      }
      const g = parseInt(root.querySelector('#gal-galaxy').value, 10) || 1;
      let from = Math.max(1, parseInt(root.querySelector('#gal-from').value, 10) || 1);
      let to = Math.max(from, parseInt(root.querySelector('#gal-to').value, 10) || from);
      if (galaxyStars.length && Number(galaxyStars[0]?.galaxy_index || 0) !== g) {
        galaxyStars = [];
      }
      uiState.activeRange = { from, to };
      setGalaxyContext(g, uiState.activeSystem || from, uiState.activeStar);
      const starsPolicy = LEVEL_POLICIES.galaxy.stars;
      let requestMaxPoints = Number(starsPolicy.maxPoints || 1500);
      const densityMode = String(settingsState.clusterDensityMode || 'auto').toLowerCase();
      const clusterPreset = densityMode === 'max'
        ? 'ultra'
        : (densityMode === 'high' ? 'high' : 'auto');
      const renderDataAdapter = window.GQRenderDataAdapter || API;

      if (details) details.innerHTML = '<span class="text-muted">Loading star cloud...</span>';

      if (typeof API.galaxyBootstrap === 'function') {
        try {
          const bootstrapRaw = await API.galaxyBootstrap(g, from, to, requestMaxPoints);
          const bootstrapRes = (typeof renderDataAdapter?.adaptGalaxyBootstrap === 'function')
            ? renderDataAdapter.adaptGalaxyBootstrap(bootstrapRaw, { galaxy: g, from, to, maxPoints: requestMaxPoints })
            : { ok: true, data: bootstrapRaw };
          if (bootstrapRes?.ok && bootstrapRes.data) {
            const bootstrap = bootstrapRes.data;
            const reportedSystemMax = Number(bootstrap.system_max || 0);
            if (reportedSystemMax > 0) {
              galaxySystemMax = Math.max(galaxySystemMax, reportedSystemMax);
            }
            const init = bootstrap.initial_range || {};
            const recommendedTo = Math.max(from, Number(init.to || to));
            if (to <= from && recommendedTo > to) {
              to = recommendedTo;
              uiState.activeRange = { from, to };
              const toInput = root.querySelector('#gal-to');
              if (toInput) {
                toInput.value = String(to);
              }
            }
            requestMaxPoints = Math.max(100, Math.min(50000, Number(init.max_points || requestMaxPoints)));
            const assetsManifestVersion = Number(bootstrap.assets_manifest_version || 0);
            if (assetsManifestVersion > 0) {
              uiState.assetsManifestVersion = assetsManifestVersion;
            }
            if (bootstrap.assets_manifest_ok === false) {
              console.warn('[GQ] loadGalaxyStars3D: assets manifest mismatch', {
                expected: Number(window.GQ_ASSETS_MANIFEST_VERSION || 1),
                received: assetsManifestVersion,
              });
              if (details) {
                details.innerHTML = '<span class="text-yellow">Asset manifest mismatch; forcing fresh asset paths.</span>';
              }
            }
            if (bootstrap.stale && details) {
              details.innerHTML = '<span class="text-yellow">Bootstrap data is stale; refreshing live starsÔÇª</span>';
            }
          } else if (bootstrapRes?.errorType === 'schema') {
            const issueList = Array.isArray(bootstrapRes.issues) ? bootstrapRes.issues.join(', ') : 'invalid payload';
            console.warn('[GQ] loadGalaxyStars3D: bootstrap schema mismatch', issueList);
            const cls = (typeof renderDataAdapter?.classifyRenderError === 'function')
              ? renderDataAdapter.classifyRenderError(bootstrapRes)
              : { type: 'schema' };
            if (details && cls.type === 'schema') {
              details.innerHTML = '<span class="text-yellow">Bootstrap schema mismatch; using fallback stars endpoint.</span>';
            }
          }
        } catch (bootstrapErr) {
          console.warn('[GQ] loadGalaxyStars3D: bootstrap request failed', bootstrapErr);
          const cls = (typeof renderDataAdapter?.classifyRenderError === 'function')
            ? renderDataAdapter.classifyRenderError(bootstrapErr)
            : { type: 'network' };
          if (details && cls.type === 'auth') {
            details.innerHTML = '<span class="text-red">Session expired. Please log in again.</span>';
          }
        }
      }

      const applyStarsToRenderer = (stars, clusterSummary, contextLabel = 'render') => {
        if (!galaxy3d) return true;
        try {
          const curGalaxy = galaxy3d.stars?.length > 0 ? Number(galaxy3d.stars[0]?.galaxy_index || 0) : 0;
          const preserveView = curGalaxy > 0 && curGalaxy === g;
          const displayedStars = getDisplayedGalaxyStars(stars);
          const displayedClusterSummary = getDisplayedGalaxyClusterSummary(clusterSummary, displayedStars);
          galaxy3d.setStars(displayedStars, { preserveView });
          if (typeof galaxy3d.setGalaxyFleets === 'function') {
            galaxy3d.setGalaxyFleets(window._GQ_fleets || []);
          }
          if (typeof galaxy3d.setFtlInfrastructure === 'function') {
            const ftlMap = window._GQ_ftl_map;
            galaxy3d.setFtlInfrastructure(ftlMap?.gates || [], ftlMap?.resonance_nodes || []);
          }
          if (typeof galaxy3d.setClusterColorPalette === 'function') {
            galaxy3d.setClusterColorPalette(resolveClusterColorPalette(uiState.territory));
          }
          if (typeof galaxy3d.setClusterAuras === 'function') {
            galaxy3d.setClusterAuras(displayedClusterSummary || []);
          }
          applyGalaxyOwnerHighlightToRenderer(displayedStars);
          return true;
        } catch (err) {
          const msg = String(err?.message || err || 'renderer error');
          console.error('[GQ] Galaxy renderer failed', { context: contextLabel, error: err });
          pushGalaxyDebugError('galaxy-render', msg, contextLabel);
          return false;
        }
      };

      const emitRenderProbe = (sourceLabel, meta = {}) => {
        const rawStars = Array.isArray(galaxyStars) ? galaxyStars.length : 0;
        const displayedStars = getDisplayedGalaxyStars(galaxyStars);
        const filteredStars = Array.isArray(displayedStars) ? displayedStars.length : 0;
        const stats = (galaxy3d && typeof galaxy3d.getRenderStats === 'function')
          ? galaxy3d.getRenderStats()
          : null;
        const visibleStars = Number(stats?.visibleStars || 0);
        const targetPoints = Number(stats?.targetPoints || 0);
        const densityMode = String(stats?.densityMode || 'n/a');
        uiConsolePush(`[galaxy] probe src=${sourceLabel} raw=${rawStars} filtered=${filteredStars} visible=${visibleStars} target=${targetPoints} mode=${densityMode}`);

        if (meta && Object.keys(meta).length) {
          const extras = Object.entries(meta)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(' ');
          uiConsolePush(`[galaxy] meta ${extras}`);
        }

        if (filteredStars > 0 && visibleStars <= 0) {
          const diag = inspectGalaxyCanvasLayering();
          const topInfo = (diag.topElementsAtCanvas || [])
            .map((p) => `${p.x},${p.y}->${p.topTag}${p.topId ? '#' + p.topId : ''}`)
            .join(' | ');
          uiConsolePush(`[galaxy][warn] stars loaded but not visible. top=${topInfo || 'n/a'}`);
          pushGalaxyDebugError('galaxy-visible-zero', `raw=${rawStars} filtered=${filteredStars} visible=${visibleStars}`, String(sourceLabel || 'unknown'));
        }
      };

      const ensureInitialGalaxyFrame = () => {
        if (galaxyAutoFramedOnce) return;
        if (!galaxy3d || typeof galaxy3d.fitCameraToStars !== 'function') return;
        const stats = (typeof galaxy3d.getRenderStats === 'function') ? galaxy3d.getRenderStats() : null;
        if (Number(stats?.visibleStars || 0) <= 0) return;
        galaxyAutoFramedOnce = true;
        setTimeout(() => {
          try {
            galaxy3d.fitCameraToStars(true, true);
          } catch (_) {}
        }, 30);
      };

      let cachedStars = normalizeStarListVisibility(galaxyModel ? galaxyModel.listStars(g, from, to) : []);
      const fullRangeInModel = galaxyModel
        ? galaxyModel.hasLoadedStarRange(g, from, to, starsPolicy.cacheMaxAgeMs)
        : false;
      if ((!cachedStars || cachedStars.length === 0) && galaxyDB && !isCurrentUserAdmin()) {
        try {
          const dbStars = await galaxyDB.getStars(g, from, to, { maxAgeMs: starsPolicy.cacheMaxAgeMs });
          if (dbStars.length && galaxyModel) {
            cachedStars = normalizeStarListVisibility(galaxyModel.upsertStarBatch(g, dbStars));
            if (hasDenseSystemCoverage(dbStars, g, from, to)) {
              galaxyModel.addLoadedStarRange(g, from, to, Date.now());
            }
          } else {
            cachedStars = normalizeStarListVisibility(dbStars);
          }
        } catch (dbErr) {
          console.warn('[GQ] loadGalaxyStars3D: DB cache read failed', dbErr);
        }
      }

      if (cachedStars && cachedStars.length) {
        galaxyStars = mergeGalaxyStarsBySystem(galaxyStars, cachedStars, g);
        uiState.clusterSummary = assignClusterFactions(uiState.rawClusters || [], uiState.territory);
        const rendered = applyStarsToRenderer(galaxyStars, uiState.clusterSummary, 'cache');
        if (!rendered) {
          renderGalaxyFallbackList(root, galaxyStars, from, to, '3D renderer unavailable (cache fallback)');
        } else if (!galaxy3d?.systemMode) {
          renderGalaxyColonySummary(root.querySelector('#galaxy-planets-panel'), galaxyStars, { from, to });
        }
        if (details) {
          details.innerHTML = `<span class="text-cyan">Cache: ${galaxyStars.length} stars loaded${fullRangeInModel ? ' (complete range)' : ''}. Syncing live data...</span>`;
        }
        refreshGalaxyDensityMetrics(root);
        emitRenderProbe('cache', {
          fullRange: fullRangeInModel,
          from,
          to,
        });
        ensureInitialGalaxyFrame();
      }

      const shouldRefreshNetwork = isCurrentUserAdmin() || starsPolicy.alwaysRefreshNetwork || !fullRangeInModel;
      if (!shouldRefreshNetwork && cachedStars && cachedStars.length) {
        if (details) {
          details.innerHTML = `<span class="text-cyan">Policy hit: fresh range from cache (${from}-${to}), network refresh skipped.</span>`;
        }
        hydrateGalaxyRangeInBackground(root, g, 1, galaxySystemMax).catch(() => {});
        return;
      }

      try {
        const dataRaw = (typeof API.galaxyStars === 'function')
          ? await API.galaxyStars(g, from, to, requestMaxPoints, {
              streamPriority: 'critical',
              requestPriority: 'critical',
              prefetch: false,
              chunkHint: requestMaxPoints,
              clusterPreset,
              includeClusterLod: false,
            })
          : await API.galaxy(g, from);
        const adapted = (typeof renderDataAdapter?.adaptGalaxyStars === 'function')
          ? renderDataAdapter.adaptGalaxyStars(dataRaw, {
              galaxy: g,
              from,
              to,
              systemMax: galaxySystemMax,
              assetsManifestVersion: uiState.assetsManifestVersion,
            })
          : { ok: true, data: dataRaw };
        if (!adapted?.ok || !adapted.data?.success) {
          const cls = (typeof renderDataAdapter?.classifyRenderError === 'function')
            ? renderDataAdapter.classifyRenderError(adapted)
            : { type: 'schema' };
          if (details) {
            if (cls.type === 'auth') {
              details.innerHTML = '<span class="text-red">Session expired. Please log in again.</span>';
            } else if (cls.type === 'schema') {
              details.innerHTML = '<span class="text-red">Could not load stars (schema mismatch).</span>';
            } else if (cls.type === 'stale') {
              details.innerHTML = '<span class="text-yellow">Star data is stale.</span>';
            } else {
              details.innerHTML = '<span class="text-red">Could not load stars (network).</span>';
            }
          }
          if (cls.type === 'schema') {
            const issueList = Array.isArray(adapted?.issues) ? adapted.issues.join(', ') : 'invalid payload';
            console.warn('[GQ] loadGalaxyStars3D: stars schema mismatch', issueList);
          }
          return;
        }
        const data = adapted.data;
        if (data.stale && details) {
          details.innerHTML = '<span class="text-yellow">Loaded stale star data; resyncingÔÇª</span>';
        }

        if (Array.isArray(data.stars)) {
          galaxyStars = mergeGalaxyStarsBySystem(galaxyStars, normalizeStarListVisibility(data.stars), g);
        } else if (data.star_system) {
          const single = normalizeStarVisibility(Object.assign({}, data.star_system, {
            galaxy_index: Number(data.galaxy || g),
            system_index: Number(data.system || from),
          }));
          galaxyStars = mergeGalaxyStarsBySystem(galaxyStars, [single], g);
        } else {
          galaxyStars = [];
        }
        const reportedSystemMax = Number(data.system_max || 0);
        if (reportedSystemMax > 0) {
          galaxySystemMax = Math.max(galaxySystemMax, reportedSystemMax);
        }
        const territoryData = await API.factions().catch(() => null);
        uiState.territory = territoryData?.success
          ? mapTerritoryFactionsForPlayer((territoryData.factions || []).filter((f) => g >= Number(f.home_galaxy_min || 1) && g <= Number(f.home_galaxy_max || 0)))
          : [];
        uiState.rawClusters = Array.isArray(data.clusters) ? data.clusters : [];
        uiState.clusterSummary = assignClusterFactions(uiState.rawClusters, uiState.territory);
        const responseTs = Number(data.server_ts_ms || Date.now());
        if (galaxyModel) {
          galaxyModel.upsertStarBatch(g, galaxyStars);
          const stride = Number(data.stride || 1);
          if (stride <= 1 && hasDenseSystemCoverage(data.stars || galaxyStars, g, from, to)) {
            galaxyModel.addLoadedStarRange(g, from, to, responseTs);
          }
        }
        if (galaxyDB) {
          galaxyDB.upsertStars(galaxyStars, responseTs).catch(() => {});
        }

        const rendered = applyStarsToRenderer(galaxyStars, uiState.clusterSummary, 'network');
        if (!galaxy3d || !rendered) {
          renderGalaxyFallbackList(root, galaxyStars, from, to, galaxy3dInitReason || 'renderer unavailable');
        } else if (!galaxy3d.systemMode) {
          renderGalaxyColonySummary(root.querySelector('#galaxy-planets-panel'), galaxyStars, { from, to });
        }

        if (details) {
          details.innerHTML = `<span class="text-cyan">Loaded ${galaxyStars.length} stars from systems ${from}..${to} (stride ${data.stride}).</span>`;
        }
        const toInput = root.querySelector('#gal-to');
        const fromInput = root.querySelector('#gal-from');
        if (toInput) toInput.max = String(galaxySystemMax);
        if (fromInput) fromInput.max = String(galaxySystemMax);
        refreshGalaxyDensityMetrics(root);
        emitRenderProbe('network', {
          from,
          to,
          stride: data.stride,
          count: data.count,
          cacheMode: data.cache_mode || 'n/a',
        });
        ensureInitialGalaxyFrame();
        hydrateGalaxyRangeInBackground(root, g, 1, galaxySystemMax).catch(() => {});
      } catch (err) {
        const errMsg = String(err?.message || err || 'unknown error');
        pushGalaxyDebugError('galaxy-stars', errMsg, `${from}..${to}`);

        // Failure guard: keep galaxy navigation alive with the best available local data.
        let fallbackStars = Array.isArray(cachedStars) ? cachedStars.slice() : [];

        if (!fallbackStars.length) {
          const scopedInMemory = (Array.isArray(galaxyStars) ? galaxyStars : [])
            .filter((star) => Number(star?.galaxy_index || 0) === g);
          if (scopedInMemory.length) fallbackStars = scopedInMemory;
        }

        if (!fallbackStars.length && galaxyModel) {
          try {
            fallbackStars = galaxyModel.listStars(g, 1, galaxySystemMax) || [];
          } catch (_) {}
        }

        if (!fallbackStars.length && galaxyDB && !isCurrentUserAdmin()) {
          try {
            fallbackStars = await galaxyDB.getStars(g, 1, galaxySystemMax, { maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
            if (fallbackStars.length && galaxyModel) {
              galaxyModel.upsertStarBatch(g, fallbackStars);
            }
          } catch (_) {}
        }

        fallbackStars = normalizeStarListVisibility(fallbackStars);

        if (fallbackStars.length) {
          galaxyStars = mergeGalaxyStarsBySystem(galaxyStars, fallbackStars, g);
          uiState.clusterSummary = assignClusterFactions(uiState.rawClusters || [], uiState.territory);
          const rendered = applyStarsToRenderer(galaxyStars, uiState.clusterSummary, 'error-fallback');
          if (!rendered) {
            renderGalaxyFallbackList(root, galaxyStars, from, to, `network error (fallback): ${errMsg}`);
          } else if (!galaxy3d?.systemMode) {
            renderGalaxyColonySummary(root.querySelector('#galaxy-planets-panel'), galaxyStars, { from, to });
          }
          if (details) {
            details.innerHTML = `<span class="text-yellow">Netzwerkfehler bei ${from}..${to}; nutze lokalen Fallback mit ${galaxyStars.length} Sternen.</span>`;
          }
          refreshGalaxyDensityMetrics(root);
          emitRenderProbe('error-fallback', {
            from,
            to,
            fallbackCount: fallbackStars.length,
          });
          ensureInitialGalaxyFrame();
          return;
        }

        if (details) details.innerHTML = `<span class="text-red">Failed to load stars: ${esc(errMsg)}</span>`;
        renderGalaxyFallbackList(root, galaxyStars, from, to, errMsg);
      }
    }

    refreshDensityMetrics(root) {
      const label = root?.querySelector?.('#gal-density-metrics');
      if (!label) return;
      if (!galaxy3d || typeof galaxy3d.getRenderStats !== 'function') {
        label.textContent = 'Density: renderer offline';
        label.className = 'text-muted';
        return;
      }
      const stats = galaxy3d.getRenderStats();
      const raw = Number(stats.rawStars || 0);
      const visible = Number(stats.visibleStars || 0);
      const target = Number(stats.targetPoints || 0);
      const clusters = Number(stats.clusterCount || 0);
      const clusterLabel = stats.clusterBoundsVisible ? 'boxes on' : 'boxes off';
      const ratioPct = raw > 0 ? Math.max(0, Math.min(100, Math.round((visible / raw) * 100))) : 0;
      label.textContent = `Density: ${visible}/${raw} (${ratioPct}%) ┬À target ${target} ┬À ${clusters} clusters ┬À ${clusterLabel} ┬À ${String(stats.densityMode || 'auto').toUpperCase()} ┬À ${String(stats.lodProfile || 'n/a')} ┬À q=${String(stats.qualityProfile || 'n/a')}`;
      label.className = ratioPct >= 70 ? 'text-green' : ratioPct >= 35 ? 'text-yellow' : 'text-muted';
    }

    updateClusterBoundsUi(root) {
      const btn = root?.querySelector('#gal-cluster-bounds-btn');
      const enabled = !galaxy3d || typeof galaxy3d.areClusterBoundsVisible !== 'function'
        ? (settingsState.clusterBoundsVisible !== false)
        : galaxy3d.areClusterBoundsVisible();
      if (!btn) return;
      btn.textContent = `Cluster Boxes: ${enabled ? 'on' : 'off'}`;
      btn.classList.toggle('btn-secondary', enabled);
      btn.classList.toggle('btn-warning', !enabled);
    }

    updateCoreFxUi(root) {
      const btn = root?.querySelector('#gal-core-fx-btn');
      if (!btn) return;
      const enabled = !galaxy3d || typeof galaxy3d.areGalacticCoreFxEnabled !== 'function'
        ? (settingsState.galacticCoreFxEnabled !== false)
        : galaxy3d.areGalacticCoreFxEnabled();
      btn.textContent = `Core FX: ${enabled ? 'on' : 'off'}${settingsState.galacticCoreFxAuto !== false ? ' (auto)' : ''}`;
      btn.classList.toggle('btn-secondary', enabled);
      btn.classList.toggle('btn-warning', !enabled);
    }

    updateFleetVectorsUi(root) {
      const btn = root?.querySelector('#gal-fleet-vectors-btn');
      if (!btn) return;
      const enabled = settingsState.galaxyFleetVectorsVisible !== false;
      btn.textContent = `Fleet Vectors: ${enabled ? 'on' : 'off'}`;
      btn.classList.toggle('btn-secondary', enabled);
      btn.classList.toggle('btn-warning', !enabled);
    }

    updateFollowUi(root) {
      const btn = root?.querySelector('#gal-follow-toggle-btn');
      const enabled = !galaxy3d || typeof galaxy3d.isFollowingSelection !== 'function'
        ? true
        : galaxy3d.isFollowingSelection();
      if (btn) {
        btn.textContent = `Follow: ${enabled ? 'on' : 'off'}`;
        btn.classList.toggle('btn-secondary', enabled);
        btn.classList.toggle('btn-warning', !enabled);
      }
      const activeStar = pinnedStar || uiState.activeStar || null;
      if (root?.querySelector('#galaxy-system-details')) {
        renderGalaxySystemDetails(root, activeStar, !!galaxy3d?.systemMode);
      }
    }

    applyMagnetPreset(presetName, root) {
      const preset = String(presetName || 'balanced').toLowerCase();
      const presets = {
        precise: { star: 16, planet: 20, cluster: 18 },
        balanced: { star: 24, planet: 30, cluster: 28 },
        sticky: { star: 34, planet: 42, cluster: 40 },
      };
      const selected = presets[preset] || presets.balanced;
      settingsState.magnetPreset = presets[preset] ? preset : 'balanced';
      settingsState.hoverMagnetStarPx = selected.star;
      settingsState.hoverMagnetPlanetPx = selected.planet;
      settingsState.hoverMagnetClusterPx = selected.cluster;
      applyRuntimeSettings();
      this.updateMagnetUi(root);
      saveUiSettings();
      showToast(`Magnet-Preset: ${settingsState.magnetPreset}`, 'info');
    }

    updateMagnetUi(root) {
      const hoverBtn = root?.querySelector('#gal-magnet-hover-toggle-btn');
      const clickBtn = root?.querySelector('#gal-magnet-click-toggle-btn');
      const presetButtons = root?.querySelectorAll?.('[data-magnet-preset]') || [];
      const starRange = root?.querySelector('#gal-magnet-star-px');
      const planetRange = root?.querySelector('#gal-magnet-planet-px');
      const clusterRange = root?.querySelector('#gal-magnet-cluster-px');
      const starValue = root?.querySelector('#gal-magnet-star-px-value');
      const planetValue = root?.querySelector('#gal-magnet-planet-px-value');
      const clusterValue = root?.querySelector('#gal-magnet-cluster-px-value');

      const hoverEnabled = settingsState.hoverMagnetEnabled !== false;
      const clickEnabled = settingsState.clickMagnetEnabled !== false;
      const starPx = Math.max(8, Math.min(64, Number(settingsState.hoverMagnetStarPx || 24)));
      const planetPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetPlanetPx || 30)));
      const clusterPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetClusterPx || 28)));
      const activePreset = String(settingsState.magnetPreset || 'custom');

      if (hoverBtn) {
        hoverBtn.textContent = `Magnet Hover: ${hoverEnabled ? 'on' : 'off'}`;
        hoverBtn.classList.toggle('btn-secondary', hoverEnabled);
        hoverBtn.classList.toggle('btn-warning', !hoverEnabled);
      }
      if (clickBtn) {
        clickBtn.textContent = `Magnet Click: ${clickEnabled ? 'on' : 'off'}`;
        clickBtn.classList.toggle('btn-secondary', clickEnabled);
        clickBtn.classList.toggle('btn-warning', !clickEnabled);
      }
      if (starRange) starRange.value = String(starPx);
      if (planetRange) planetRange.value = String(planetPx);
      if (clusterRange) clusterRange.value = String(clusterPx);
      if (starValue) starValue.textContent = String(starPx);
      if (planetValue) planetValue.textContent = String(planetPx);
      if (clusterValue) clusterValue.textContent = String(clusterPx);

      presetButtons.forEach((btn) => {
        const preset = String(btn.getAttribute('data-magnet-preset') || '');
        const active = preset === activePreset;
        btn.classList.toggle('btn-secondary', !active);
        btn.classList.toggle('btn-primary', active);
      });
    }

    async refreshHealth(root, force) {
      const badge = root ? root.querySelector('#gal-health-badge') : null;
      if (!badge) return;
      if (!force && (Date.now() - galaxyHealthLastCheckMs) < 8000) return;

      badge.textContent = 'Health: checking...';
      badge.className = 'text-muted';
      try {
        const data = await API.health();
        galaxyHealthLastCheckMs = Date.now();
        if (!data || !data.success || !data.health) {
          badge.textContent = 'Health: unavailable';
          badge.className = 'text-muted';
          return;
        }

        galaxyHealthLast = data.health;
        const checks = data.health.checks || {};
        const missing = Number(checks.star_systems_missing_metadata || 0);
        if (data.health.ok) {
          badge.textContent = `Health: OK (${Number(checks.star_systems_total || 0)} systems)`;
          badge.className = 'text-green';
        } else {
          badge.textContent = `Health: WARN (${missing} missing metadata)`;
          badge.className = 'text-red';
          if (!galaxyHealthWarned) {
            showToast(`Galaxy metadata warnings: ${missing} rows`, 'warning');
            galaxyHealthWarned = true;
          }
        }
      } catch (_) {
        galaxyHealthLastCheckMs = Date.now();
        try {
          const net = (typeof API?.networkHealth === 'function') ? await API.networkHealth(false) : null;
          const kind = String(net?.kind || 'unknown');
          if (kind === 'offline') {
            badge.textContent = 'Health: offline';
            badge.className = 'text-red';
          } else if (kind === 'timeout') {
            badge.textContent = 'Health: timeout';
            badge.className = 'text-yellow';
          } else if (kind === 'unreachable') {
            badge.textContent = 'Health: API unreachable';
            badge.className = 'text-red';
          } else if (kind === 'http' || kind === 'auth') {
            badge.textContent = `Health: API ${Number(net?.status || 0) || 'error'}`;
            badge.className = 'text-yellow';
          } else {
            badge.textContent = 'Health: unavailable';
            badge.className = 'text-muted';
          }
        } catch (_) {
          badge.textContent = 'Health: unavailable';
          badge.className = 'text-muted';
        }
      }
    }
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
    extra.innerHTML = `
      <div class="planet-detail-row">Bedrohungsgrad: <span class="threat-chip threat-${esc(intel.threat.level)}">${esc(intel.threat.label)} ┬À ${esc(String(intel.threat.score))}</span></div>
      <div class="planet-detail-row">Letzter Scan: ${intel.latest_scan_at ? esc(new Date(intel.latest_scan_at).toLocaleString()) : 'Kein Scan vorhanden'}</div>
      <div class="planet-detail-row">Scanlage: ${scan ? `${esc(String(scan.ship_count))} Schiffe ┬À Kampfkraft ${esc(String(scan.combat_power_estimate))} ┬À Leader ${esc(String(scan.leader_count))}` : 'Erstspionage empfohlen'}</div>
      <div class="planet-detail-row">Diplomatie: ${esc(payload.diplomacy_hint || 'Keine Einsch├ñtzung verf├╝gbar.')}</div>
      <div class="territory-mini-list">${territory.slice(0, 3).map((f) => `
        <span class="territory-chip" style="--territory-color:${esc(f.color)}">${esc(f.icon)} ${esc(f.name)} ┬À ${esc(f.government?.icon || '­ƒÅ│')} ${esc(f.government?.label || 'Herrschaft')}</span>`).join('') || '<span class="text-muted">Keine Sektoranspr├╝che</span>'}
      </div>
      ${clusters.length ? `<div class="planet-detail-row">Cluster: ${clusters.slice(0, 2).map((cluster) => `${esc(cluster.label)} ${esc(String(cluster.from))}-${esc(String(cluster.to))}`).join(' ┬À ')}</div>` : ''}`;
  }

  class OverviewController {
    constructor() {
      this.templates = {
        fleetRow: `
          <div class="fleet-row">
            <span class="fleet-mission">{{{mission}}}</span>
            <span class="fleet-target">ÔåÆ [{{{targetGalaxy}}}:{{{targetSystem}}}:{{{targetPosition}}}]</span>
            {{{positionHtml}}}
            <span class="fleet-timer" data-end="{{{arrivalTimeRaw}}}">{{{arrivalCountdown}}}</span>
            <div class="progress-bar-wrap fleet-progress-wrap" style="width:80px">
              <div class="progress-bar fleet-progress-bar" style="width:{{{progressPct}}}%" data-dep="{{{departureTimeRaw}}}" data-arr="{{{arrivalTimeRaw}}}"></div>
            </div>
            {{{vesselListHtml}}}
            {{{returningBadgeHtml}}}
            {{{ftlBadgesHtml}}}
            {{{recallButtonHtml}}}
          </div>`,
        battleRow: `
          <div class="battle-row {{{battleClass}}}">
            <span class="battle-result">{{{resultLabel}}}</span>
            <span class="battle-vs">vs {{{defenderName}}}</span>
            <span class="battle-time" style="font-size:0.75rem;color:var(--text-muted)">{{{createdAt}}}</span>
            {{{lootHtml}}}
          </div>`,
      };
    }

    renderTemplate(templateName, data = {}) {
      return renderInlineTemplate(this.templates[templateName], data);
    }

    renderTemplateList(templateName, rows) {
      return renderInlineTemplateList(this.templates[templateName], rows);
    }

    populatePlanetSelect() {
      if (planetSelect) {
        planetSelect.innerHTML = colonies.map((colony) =>
          `<option value="${colony.id}">${esc(colony.name)} [${colony.galaxy}:${colony.system}:${colony.position}]</option>`
        ).join('');
      }
      if (!currentColony && colonies.length) {
        selectColonyById(colonies[0].id);
      }
    }

    updateResourceBar() {
      if (!currentColony) return;
      document.getElementById('res-metal').textContent = fmt(currentColony.metal);
      document.getElementById('res-crystal').textContent = fmt(currentColony.crystal);
      document.getElementById('res-deuterium').textContent = fmt(currentColony.deuterium);
      document.getElementById('res-energy').textContent = currentColony.energy ?? 'ÔÇö';
      const foodEl = document.getElementById('res-food');
      if (foodEl) foodEl.textContent = fmt(currentColony.food ?? 0);
      const reEl = document.getElementById('res-rare-earth');
      if (reEl) reEl.textContent = fmt(currentColony.rare_earth ?? 0);
      const popEl = document.getElementById('res-population');
      if (popEl) popEl.textContent = `${fmt(currentColony.population ?? 0)}/${fmt(currentColony.max_population ?? 500)}`;
      const happEl = document.getElementById('res-happiness');
      if (happEl) {
        const happiness = parseInt(currentColony.happiness ?? 70, 10);
        happEl.textContent = `${happiness}%`;
        happEl.style.color = happiness >= 70 ? '#2ecc71' : happiness >= 40 ? '#f1c40f' : '#e74c3c';
      }
      document.getElementById('topbar-coords').textContent = `[${currentColony.galaxy}:${currentColony.system}:${currentColony.position}]`;
      if (window._GQ_meta) {
        document.getElementById('res-dark-matter').textContent = fmt(window._GQ_meta.dark_matter ?? 0);
      }
    }

    applyBadges(data) {
      const msgBadge = document.getElementById('msg-badge');
      if (data.unread_msgs > 0) {
        msgBadge.textContent = data.unread_msgs;
        msgBadge.classList.remove('hidden');
      } else {
        msgBadge.classList.add('hidden');
      }

      const qBadge = document.getElementById('quest-badge');
      const unclaimed = data.user_meta?.unclaimed_quests ?? 0;
      if (unclaimed > 0) {
        qBadge.textContent = unclaimed;
        qBadge.classList.remove('hidden');
      } else {
        qBadge.classList.add('hidden');
      }
    }

    async load() {
      try {
        const data = await API.overview();
        if (!data.success) {
          console.error('Overview API error:', data.error);
          if (/not authenticated|unauthorized|401/i.test(String(data.error || ''))) {
            redirectToLogin('overview-not-authenticated');
            return;
          }
          showToast(data.error || 'Overview konnte nicht geladen werden.', 'error');
          const root = WM.body('overview');
          if (root) root.innerHTML = `<p class="text-muted" style="color:#e74c3c">ÔÜá ${data.error || 'Nicht eingeloggt. Bitte neu laden.'}</p>`;
          return;
        }

        colonies = data.colonies || [];
        window._GQ_battles = data.battles || [];
        window._GQ_politics = data.politics || null;
        window._GQ_meta = data.user_meta || {};
        window._GQ_fleets = data.fleets || [];
        window._GQ_offline = data.offline_progress || null;

        if (galaxy3d && typeof galaxy3d.setGalaxyFleets === 'function') {
          galaxy3d.setGalaxyFleets(window._GQ_fleets || []);
        }

        // Refresh FTL infrastructure overlay (lazy: only when galaxy3d is active)
        if (galaxy3d && typeof galaxy3d.setFtlInfrastructure === 'function') {
          API.ftlMap().then((ftlData) => {
            if (ftlData?.success) {
              window._GQ_ftl_map = ftlData;
              galaxy3d.setFtlInfrastructure(ftlData.gates || [], ftlData.resonance_nodes || []);
            }
          }).catch(() => {});
        }

        this.populatePlanetSelect();
        this.updateResourceBar();
        this.applyBadges(data);
        WM.refresh('overview');
        WM.refresh('minimap');
      } catch (e) {
        const em = String(e?.message || e || '');
        if (/abort|cancel|navigation/i.test(em)) return;
        if (/not authenticated|unauthorized|http\s*401|\b401\b/i.test(em)) {
          redirectToLogin('overview-401');
          return;
        }
        console.error('Overview load failed', e);
        showToast('Overview konnte nicht geladen werden. Bitte Seite neu laden.', 'error');
        const root = WM.body('overview');
        if (root && !root.innerHTML.trim()) {
          root.innerHTML = `<p class="text-muted" style="color:#e74c3c">ÔÜá Fehler beim Laden: ${e.message || e}</p>`;
        }
      }
    }

    riskFocusFromFlags(flags) {
      const list = Array.isArray(flags) ? flags.map((f) => String(f || '')) : [];
      if (list.includes('food_decline') || list.includes('low_food_buffer')) return 'hydroponic_farm';
      if (list.includes('energy_deficit')) return 'solar_plant';
      if (list.includes('low_welfare')) return 'hospital';
      return 'colony_hq';
    }

    evaluateRiskUpgradeBudget(colony, nextCost, share = 0.55) {
      const parseRes = (v) => Math.max(0, Number(v || 0));
      const resources = {
        metal: parseRes(colony?.metal),
        crystal: parseRes(colony?.crystal),
        deuterium: parseRes(colony?.deuterium),
      };
      const costs = {
        metal: parseRes(nextCost?.metal),
        crystal: parseRes(nextCost?.crystal),
        deuterium: parseRes(nextCost?.deuterium),
      };
      const over = [];
      ['metal', 'crystal', 'deuterium'].forEach((key) => {
        if (!costs[key]) return;
        const limit = resources[key] * share;
        if (costs[key] > limit) {
          over.push(`${key}:${Math.round(costs[key])}>${Math.round(limit)}`);
        }
      });
      return { ok: over.length === 0, details: over };
    }

    async runRiskAutoUpgrade(cid, focusBuilding) {
      const autoRiskUpgradeBudgetShare = 0.55;
      focusColonyDevelopment(cid, {
        source: 'economy-risk-auto',
        focusBuilding,
      });

      const colony = colonies.find((c) => Number(c.id || 0) === Number(cid || 0)) || null;
      if (!colony) {
        showToast('Kolonie nicht gefunden, Auto-Upgrade abgebrochen.', 'warning');
        return;
      }

      let buildingsPayload = null;
      try {
        buildingsPayload = await API.buildings(cid);
      } catch (_) {
        showToast('Kostenpr├╝fung nicht m├Âglich (Netzwerk). Auto-Upgrade aus Sicherheitsgr├╝nden abgebrochen.', 'warning');
        return;
      }
      if (!buildingsPayload?.success) {
        showToast(buildingsPayload?.error || 'Kostenpr├╝fung fehlgeschlagen. Auto-Upgrade abgebrochen.', 'warning');
        return;
      }

      const buildingEntry = (buildingsPayload.buildings || []).find((b) => String(b.type || '') === String(focusBuilding || ''));
      if (!buildingEntry) {
        showToast(`Geb├ñude ${fmtName(focusBuilding)} nicht verf├╝gbar.`, 'warning');
        return;
      }

      const budgetCheck = this.evaluateRiskUpgradeBudget(colony, buildingEntry.next_cost || {}, autoRiskUpgradeBudgetShare);
      if (!budgetCheck.ok) {
        showToast(`Auto +1 blockiert (Budgetlimit ${Math.round(autoRiskUpgradeBudgetShare * 100)}%). ${budgetCheck.details.join(', ')}`, 'warning');
        return;
      }

      const res = await API.upgrade(cid, focusBuilding);
      if (!res?.success) {
        showToast(res?.error || 'Auto-Upgrade fehlgeschlagen.', 'warning');
        return;
      }
      const queuePos = Number(res.queue_position || 0);
      const targetLevel = Number(res.target_level || 0);
      if (queuePos > 1) showToast(`${fmtName(focusBuilding)} eingereiht (Pos ${queuePos}, Lv ${targetLevel}).`, 'success');
      else showToast(`${fmtName(focusBuilding)} gestartet (Lv ${targetLevel}).`, 'success');
      await this.load();
      WM.refresh('buildings');
      WM.refresh('colony');
    }

    signed(value, digits = 0) {
      const n = Number(value || 0);
      const fixed = digits > 0 ? n.toFixed(digits) : Math.round(n).toString();
      return `${n >= 0 ? '+' : ''}${fixed}`;
    }

    riskLabel(status) {
      const code = String(status || 'stable');
      if (code === 'strain') return '<span class="text-red">Kritisch</span>';
      if (code === 'watch') return '<span class="text-yellow">Beobachten</span>';
      return '<span class="text-cyan">Stabil</span>';
    }

    buildOfflineSummaryHtml(offline) {
      const economy = offline?.economy || null;
      const netRates = economy?.net_rates_per_hour || offline?.rates_per_hour || null;
      const hadOfflineTime = !!offline?.had_offline_time;
      const statusCounts = economy?.status_counts || { stable: 0, watch: 0, strain: 0 };
      const topRisks = Array.isArray(economy?.top_risks) ? economy.top_risks : [];
      const topRiskHtml = topRisks.length
        ? `<div class="system-row" style="font-size:0.8rem;line-height:1.45;margin-top:0.25rem">
            ${topRisks.map((risk) => {
              const flags = Array.isArray(risk.risk_flags) ? risk.risk_flags.join(', ') : '';
              const cid = Number(risk.colony_id || 0);
              const focus = this.riskFocusFromFlags(risk.risk_flags);
              return `ÔÜá ${esc(String(risk.colony_name || 'Colony'))}: ${this.riskLabel(risk.status)} ┬À Score ${esc(String(risk.risk_score || 0))} ┬À ­ƒî¥ ${esc(String(risk.food_rate_per_hour || 0))}/h ┬À ÔÜí ${esc(String(risk.energy || 0))}${flags ? ` ┬À ${esc(flags)}` : ''} <button type="button" class="btn btn-secondary btn-sm" data-risk-action="focus" data-risk-cid="${cid}" data-risk-focus="${esc(focus)}" style="margin-left:0.35rem;padding:0.2rem 0.45rem;font-size:0.7rem">Fix</button><button type="button" class="btn btn-primary btn-sm" data-risk-action="auto" data-risk-cid="${cid}" data-risk-focus="${esc(focus)}" style="margin-left:0.25rem;padding:0.2rem 0.45rem;font-size:0.7rem">Auto +1</button>`;
            }).join('<br>')}
          </div>`
        : '<div class="system-row text-cyan" style="font-size:0.8rem">Keine akuten Wirtschaftsrisiken erkannt.</div>';

      return `
        <div class="system-card" style="margin:0.75rem 0 0.6rem">
          <div class="system-row"><strong>├ûkonomie-Snapshot</strong>${hadOfflineTime ? ` ┬À Offline-Zeit: ${Math.max(1, Math.round((Number(offline?.max_elapsed_seconds || 0) / 60)))} min` : ''}</div>
          <div class="system-row" style="font-size:0.8rem;color:var(--text-secondary)">
            Ô¼í ${this.signed(netRates?.metal, 1)}/h ┬À ­ƒÆÄ ${this.signed(netRates?.crystal, 1)}/h ┬À ­ƒöÁ ${this.signed(netRates?.deuterium, 1)}/h ┬À ­ƒî¥ ${this.signed(netRates?.food, 1)}/h ┬À ­ƒæÑ ${this.signed(netRates?.population, 2)}/h
          </div>
          <div class="system-row" style="font-size:0.8rem;color:var(--text-secondary)">
            Stabil: ${statusCounts.stable || 0} ┬À Beobachten: ${statusCounts.watch || 0} ┬À Kritisch: ${statusCounts.strain || 0}
            ${economy ? ` ┬À Wohlfahrt ├ÿ ${(Number(economy.avg_welfare || 0)).toFixed(1)}%` : ''}
          </div>
          ${topRiskHtml}
        </div>`;
    }

    buildResourceInsightHtml(offline, meta) {
      const config = getResourceInsightConfig(uiState.resourceInsight);
      if (!config || !currentColony) return '';
      const netRates = offline?.economy?.net_rates_per_hour || offline?.rates_per_hour || {};
      const currentValue = getResourceInsightValue(config.key, currentColony, meta);
      const totalValue = getResourceInsightTotal(config.key, meta);
      const share = totalValue > 0 ? Math.min(100, Math.round((currentValue / totalValue) * 100)) : 0;
      const perHour = config.rateKey ? Number(netRates?.[config.rateKey] || 0) : null;
      const actions = [];
      if (config.focusBuilding) {
        actions.push(`<button type="button" class="btn btn-secondary btn-sm" data-resource-action="focus-building" data-resource-focus="${esc(config.focusBuilding)}">­ƒÅù Produktionsfokus</button>`);
      }
      if (config.transportable) {
        actions.push(`<button type="button" class="btn btn-secondary btn-sm" data-resource-action="transport" data-resource="${esc(config.key)}">­ƒÜÜ Transport starten</button>`);
      }
      if (config.tradeable) {
        actions.push(`<button type="button" class="btn btn-primary btn-sm" data-resource-action="market-sell" data-resource="${esc(config.key)}">­ƒøÆ Verkaufen</button>`);
        actions.push(`<button type="button" class="btn btn-primary btn-sm" data-resource-action="market-buy" data-resource="${esc(config.key)}">­ƒøÆ Kaufen</button>`);
      }
      actions.push('<button type="button" class="btn btn-secondary btn-sm" data-resource-action="close-insight">Schliessen</button>');

      return `
        <section class="resource-insight-card">
          <div class="resource-insight-head">
            <div>
              <div class="resource-insight-title">${esc(config.icon)} ${esc(config.label)} ┬À ${esc(currentColony.name || 'Kolonie')}</div>
              <div class="resource-insight-note">${esc(config.desc)}</div>
            </div>
            <span class="status-chip chip-neutral">[${esc(String(currentColony.galaxy || 0))}:${esc(String(currentColony.system || 0))}:${esc(String(currentColony.position || 0))}]</span>
          </div>
          <div class="resource-insight-meta">
            <div class="resource-insight-stat">
              <div class="resource-insight-stat-label">Aktueller Bestand</div>
              <div class="resource-insight-stat-value">${esc(formatResourceInsightValue(config.key, currentValue, currentColony))}</div>
            </div>
            <div class="resource-insight-stat">
              <div class="resource-insight-stat-label">Anteil an deinem Imperium</div>
              <div class="resource-insight-stat-value">${esc(String(share))}%</div>
            </div>
            <div class="resource-insight-stat">
              <div class="resource-insight-stat-label">Imperiumsbestand</div>
              <div class="resource-insight-stat-value">${esc(formatResourceInsightValue(config.key, totalValue, currentColony))}</div>
            </div>
            <div class="resource-insight-stat">
              <div class="resource-insight-stat-label">Nettofluss</div>
              <div class="resource-insight-stat-value">${perHour === null ? 'Kontextwert' : `${perHour >= 0 ? '+' : ''}${fmt(Math.abs(perHour))}/h`}</div>
            </div>
          </div>
          <div class="resource-insight-actions">${actions.join('')}</div>
          <div class="resource-insight-note">Handelsangebote werden nach Annahme nicht mehr sofort verrechnet. Stattdessen starten Frachter von der bestversorgten Quelle, binden die Fracht an die Flugzeit und verbrauchen Deuterium fuer den Transport.</div>
        </section>`;
    }

    renderFleetList(root) {
      const fleetList = root.querySelector('#fleet-list-wm');
      const fleets = window._GQ_fleets || [];
      if (!fleetList) return;
      if (!fleets.length) {
        fleetList.innerHTML = '<p class="text-muted">No active fleets.</p>';
        return;
      }

      fleetList.innerHTML = this.renderTemplateList('fleetRow', fleets.map((fleet) => {
        const pos = fleet.current_pos || {};
        const positionHtml = (pos.x !== undefined)
          ? `<span class="fleet-pos" title="3D position">­ƒôì ${esc(String(pos.x.toFixed(0)))}, ${esc(String(pos.y.toFixed(0)))}, ${esc(String(pos.z.toFixed(0)))} ly</span>`
          : '';
        const vesselChips = (fleet.vessels || [])
          .slice(0, 5)
          .map((vessel) => `<span class="fleet-vessel-chip">${esc(fmtName(vessel.type))} x${esc(String(vessel.count))}</span>`)
          .join('');
        const vesselListHtml = vesselChips ? `<div class="fleet-vessel-list">${vesselChips}</div>` : '';
        const progressPct = ((pos.progress || 0) * 100).toFixed(0);

        // FTL status badges
        const stealthSec = Number(fleet.stealth_remaining_s || 0);
        const stealthBadge = stealthSec > 0
          ? `<span class="fleet-stealth-badge" title="Vel'Ar stealth: ${stealthSec}s remaining">­ƒæü´©Å Stealth ${stealthSec}s</span>`
          : '';
        const hullDmg = Number(fleet.hull_damage_pct || 0);
        const hullBadge = hullDmg > 0
          ? `<span class="fleet-hull-badge" title="Kryl'Tha hull damage: -${hullDmg}% attack">ÔÜá Hull ${hullDmg}%</span>`
          : '';

        return {
          mission: esc(String(fleet.mission || '').toUpperCase()),
          targetGalaxy: esc(String(fleet.target_galaxy || '')),
          targetSystem: esc(String(fleet.target_system || '')),
          targetPosition: esc(String(fleet.target_position || '')),
          positionHtml,
          arrivalTimeRaw: esc(String(fleet.arrival_time || '')),
          departureTimeRaw: esc(String(fleet.departure_time || '')),
          arrivalCountdown: esc(countdown(fleet.arrival_time)),
          progressPct: esc(progressPct),
          vesselListHtml,
          returningBadgeHtml: fleet.returning ? '<span class="fleet-returning">Ôå® Returning</span>' : '',
          ftlBadgesHtml: stealthBadge + hullBadge,
          recallButtonHtml: !fleet.returning
            ? `<button class="btn btn-warning btn-sm recall-btn" data-fid="${esc(String(fleet.id || ''))}">Recall</button>`
            : '',
        };
      }));

      fleetList.querySelectorAll('.recall-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const response = await API.recallFleet(parseInt(btn.dataset.fid, 10));
          if (response.success) {
            if (audioManager && typeof audioManager.playFleetRecall === 'function') audioManager.playFleetRecall();
            showToast('Fleet recalled.', 'success');
            await this.load();
          } else {
            showToast(response.error || 'Recall failed', 'error');
          }
        });
      });
    }

    renderBattleLog(root) {
      const battleLog = root.querySelector('#battle-log-wm');
      if (!battleLog) return;
      const battles = window._GQ_battles || [];
      if (!battles.length) {
        battleLog.innerHTML = '<p class="text-muted">No battles yet.</p>';
        return;
      }

      battleLog.innerHTML = this.renderTemplateList('battleRow', battles.map((battle) => {
        const report = battle.report || {};
        const won = report.attacker_wins;
        const loot = report.loot || {};
        const lootStr = [
          loot.metal > 0 ? `Ô¼í${fmt(loot.metal)}` : '',
          loot.crystal > 0 ? `­ƒÆÄ${fmt(loot.crystal)}` : '',
          loot.deuterium > 0 ? `­ƒöÁ${fmt(loot.deuterium)}` : '',
          loot.rare_earth > 0 ? `­ƒÆ£${fmt(loot.rare_earth)}` : '',
        ].filter(Boolean).join(' ');
        return {
          battleClass: won ? 'battle-win' : 'battle-loss',
          resultLabel: won ? 'ÔÜö Victory' : '­ƒÆÇ Defeat',
          defenderName: esc(battle.defender_name),
          createdAt: esc(new Date(battle.created_at).toLocaleString()),
          lootHtml: won && lootStr ? `<span class="battle-loot">${esc(lootStr)}</span>` : '',
        };
      }));
    }

    bindOverviewActions(root) {
      root.querySelectorAll('.planet-card').forEach((card) => {
        card.addEventListener('click', () => {
          const cid = parseInt(card.dataset.cid, 10);
          currentColony = colonies.find((c) => c.id === cid) || null;
          if (planetSelect) planetSelect.value = String(cid);
          this.updateResourceBar();
          this.render();
        });
      });

      root.querySelector('#open-leaders-btn')?.addEventListener('click', () => WM.open('leaders'));

      root.querySelectorAll('[data-resource-action="focus-building"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!currentColony) return;
          const focusBuilding = String(btn.getAttribute('data-resource-focus') || 'colony_hq');
          focusColonyDevelopment(currentColony.id, {
            source: 'resource-insight',
            focusBuilding,
          });
          WM.open('buildings');
          showToast(`Fokus gesetzt: ${fmtName(focusBuilding)}.`, 'info');
        });
      });

      root.querySelectorAll('[data-resource-action="transport"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          openFleetTransportPlanner(String(btn.getAttribute('data-resource') || ''));
          showToast('Transportplanung geoeffnet. Ziel und Eskorte im Fleet-Fenster setzen.', 'info');
        });
      });

      root.querySelectorAll('[data-resource-action="market-buy"]').forEach((btn) => {
        btn.addEventListener('click', () => openTradeMarketplace(String(btn.getAttribute('data-resource') || ''), 'request'));
      });

      root.querySelectorAll('[data-resource-action="market-sell"]').forEach((btn) => {
        btn.addEventListener('click', () => openTradeMarketplace(String(btn.getAttribute('data-resource') || ''), 'offer'));
      });

      root.querySelectorAll('[data-resource-action="close-insight"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          uiState.resourceInsight = null;
          this.render();
        });
      });

      root.querySelectorAll('[data-risk-action="focus"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cid = Number(btn.getAttribute('data-risk-cid') || 0);
          if (!cid) return;
          const focusBuilding = String(btn.getAttribute('data-risk-focus') || 'colony_hq');
          focusColonyDevelopment(cid, {
            source: 'economy-risk',
            focusBuilding,
          });
          if (audioManager) audioManager.playUiClick();
          showToast(`Kolonie-Fokus gesetzt: ${fmtName(focusBuilding)}.`, 'info');
        });
      });

      root.querySelectorAll('[data-risk-action="auto"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const cid = Number(btn.getAttribute('data-risk-cid') || 0);
          if (!cid) return;
          const focusBuilding = String(btn.getAttribute('data-risk-focus') || 'colony_hq');
          btn.disabled = true;
          const prevLabel = btn.textContent;
          btn.textContent = '...';
          try {
            await this.runRiskAutoUpgrade(cid, focusBuilding);
            if (audioManager) audioManager.playUiConfirm();
          } catch (err) {
            showToast(String(err?.message || err || 'Auto-Upgrade fehlgeschlagen.'), 'error');
            if (audioManager) audioManager.playUiError();
          } finally {
            btn.disabled = false;
            btn.textContent = prevLabel || 'Auto +1';
          }
        });
      });

      root.querySelector('#pvp-toggle-btn')?.addEventListener('click', async () => {
        const response = await API.togglePvp();
        if (response.success) {
          if (audioManager && typeof audioManager.playPvpToggle === 'function') audioManager.playPvpToggle();
          showToast(response.pvp_mode ? 'ÔÜö PvP enabled!' : '­ƒøí PvP disabled.', 'info');
          await this.load();
        } else {
          showToast(response.error || 'Could not toggle PvP.', 'error');
        }
      });
    }

    render() {
      const root = WM.body('overview');
      if (!root) return;
      if (!colonies.length) {
        root.innerHTML = uiKitEmptyStateHTML('No colonies yet', 'Found your first colony to unlock strategic overview data.');
        return;
      }

      const meta = window._GQ_meta || {};
      const protUntil = meta.protection_until ? new Date(meta.protection_until) : null;
      const protected_ = protUntil && protUntil > Date.now();
      const pvpOn = !!parseInt(meta.pvp_mode, 10);
      const protText = protected_ ? `­ƒøí Newbie protection until ${protUntil.toLocaleDateString()}` : '­ƒøí No protection';
      const colonyTypeLabels = {
        balanced: 'ÔÜû Balanced', mining: 'ÔøÅ Mining', industrial: '­ƒÅ¡ Industrial',
        research: '­ƒö¼ Research', agricultural: '­ƒî¥ Agricultural', military: 'ÔÜö Military'
      };
      const offline = window._GQ_offline || null;

      root.innerHTML = `
        <div class="status-bar">
          <span class="status-chip ${protected_ ? 'chip-shield' : 'chip-neutral'}">${protText}</span>
          <span class="status-chip ${pvpOn ? 'chip-pvp-on' : 'chip-pvp-off'}">ÔÜö PvP: ${pvpOn ? 'ON' : 'OFF'}</span>
          <button id="pvp-toggle-btn" class="btn btn-sm ${pvpOn ? 'btn-warning' : 'btn-secondary'}" ${protected_ ? 'disabled' : ''}>
            ${pvpOn ? 'Disable PvP' : 'Enable PvP'}
          </button>
          <span class="status-chip chip-rank">Ôÿà ${fmt(meta.rank_points ?? 0)} RP</span>
          <span class="status-chip chip-dm">Ôùå ${fmt(meta.dark_matter ?? 0)} DM</span>
          <button class="btn btn-secondary btn-sm" id="open-leaders-btn">­ƒæñ Leaders</button>
        </div>

        ${this.buildOfflineSummaryHtml(offline)}

        ${this.buildResourceInsightHtml(offline, meta)}

        <h3 style="margin:0.75rem 0 0.5rem">Your Colonies</h3>
        <div class="overview-grid">
          ${colonies.map((colony) => {
            const leaderChips = (colony.leaders || []).map((leader) =>
              `<span class="leader-chip" title="${esc(leader.role)} Lv${leader.level} ÔÇô ${leader.last_action || 'idle'}">
                 ${leader.role === 'colony_manager' ? '­ƒÅù' : leader.role === 'science_director' ? '­ƒö¼' : 'ÔÜö'} ${esc(leader.name)}
               </span>`
            ).join('');
            return `
            <div class="planet-card ${currentColony && colony.id === currentColony.id ? 'selected' : ''}" data-cid="${colony.id}">
              <div class="planet-card-name">${esc(colony.name)}
                ${colony.is_homeworld ? '<span class="hw-badge">­ƒÅá</span>' : ''}
              </div>
              <div class="planet-card-coords">[${colony.galaxy}:${colony.system}:${colony.position}]</div>
              <div class="planet-card-type">
                <span class="colony-type-badge">${colonyTypeLabels[colony.colony_type] || colony.colony_type}</span>
                ÔÇó ${fmtName(colony.planet_type || 'terrestrial')}
                ${colony.in_habitable_zone ? '<span class="hz-badge" title="Habitable Zone">­ƒî┐</span>' : ''}
              </div>
              <div style="margin-top:0.4rem;font-size:0.78rem;color:var(--text-secondary)">
                Ô¼í ${fmt(colony.metal)} &nbsp; ­ƒÆÄ ${fmt(colony.crystal)} &nbsp; ­ƒöÁ ${fmt(colony.deuterium)}
                ${parseFloat(colony.rare_earth || 0) > 0 ? `&nbsp; ­ƒÆ£ ${fmt(colony.rare_earth)}` : ''}
              </div>
              <div style="margin-top:0.2rem;font-size:0.75rem;color:var(--text-secondary)">
                ­ƒî¥ ${fmt(colony.food || 0)} &nbsp; ÔÜí ${colony.energy ?? 0}
              </div>
              <div class="welfare-bar" style="margin-top:0.4rem">
                <span title="Happiness ${colony.happiness ?? 70}%">­ƒÿè</span>
                <div class="bar-wrap"><div class="bar-fill bar-happiness" style="width:${colony.happiness ?? 70}%"></div></div>
                <span style="font-size:0.7rem;min-width:28px">${colony.happiness ?? 70}%</span>
              </div>
              <div class="welfare-bar">
                <span title="Population ${colony.population ?? 0}/${colony.max_population ?? 500}">­ƒæÑ</span>
                <div class="bar-wrap"><div class="bar-fill bar-population" style="width:${Math.min(100, Math.round((colony.population ?? 0) / (colony.max_population || 500) * 100))}%"></div></div>
                <span style="font-size:0.7rem;min-width:28px">${fmt(colony.population ?? 0)}</span>
              </div>
              <div class="welfare-bar">
                <span title="Public Services ${colony.public_services ?? 0}%">­ƒÅÑ</span>
                <div class="bar-wrap"><div class="bar-fill bar-services" style="width:${colony.public_services ?? 0}%"></div></div>
                <span style="font-size:0.7rem;min-width:28px">${colony.public_services ?? 0}%</span>
              </div>
              ${colony.deposit_metal >= 0 ? `
                <div style="margin-top:0.3rem;font-size:0.7rem">
                  <span class="deposit-chip ${colony.deposit_metal < 100000 ? 'depleted' : ''}" title="Metal deposit remaining">Ô¼í ${fmt(colony.deposit_metal)}</span>
                  <span class="deposit-chip ${colony.deposit_crystal < 50000 ? 'depleted' : ''}" title="Crystal deposit">­ƒÆÄ ${fmt(colony.deposit_crystal)}</span>
                  <span class="deposit-chip rare-earth-chip" title="Rare Earth deposit">­ƒÆ£ ${fmt(colony.deposit_rare_earth)}</span>
                </div>` : ''}
              ${leaderChips ? `<div class="leader-chips">${leaderChips}</div>` : ''}
            </div>`;
          }).join('')}
        </div>

        <h3 style="margin:1rem 0 0.5rem">Fleets in Motion</h3>
        <div id="fleet-list-wm"></div>

        <h3 style="margin:1rem 0 0.5rem">Recent Battles</h3>
        <div id="battle-log-wm"></div>`;

      this.bindOverviewActions(root);
      this.renderFleetList(root);
      this.renderBattleLog(root);
    }
  }

  const overviewController = new OverviewController();
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

  class ColonyViewController {
    buildViewHtml(data) {
      const layout = data.layout || currentColony.layout || null;
      const buildings = data.buildings || [];
      const orbitalFacilities = data.orbital_facilities || [];
      const grid = buildColonyGridCells(layout, buildings);
      const classCaps = layout?.class_caps || {};
      const buildingFocus = uiState.colonyViewFocus && Number(uiState.colonyViewFocus.colonyId) === Number(currentColony.id)
        ? String(uiState.colonyViewFocus.focusBuilding || '')
        : '';

      return `
        <div class="colony-view-head">
          <div>
            <h3>${esc(currentColony.name)}</h3>
            <div class="colony-view-meta">${esc(fmtName(currentColony.planet_class || currentColony.planet_type || 'planet'))} ┬À ${esc(String(currentColony.diameter || layout?.planet_scale?.diameter || 0))} km ┬À ${esc(layout?.planet_scale?.tier || 'standard')}</div>
          </div>
          <div class="colony-view-actions">
            <button class="btn btn-secondary btn-sm" id="colony-open-buildings-btn">Buildings</button>
            <button class="btn btn-secondary btn-sm" id="colony-open-shipyard-btn">Shipyard</button>
          </div>
        </div>
        ${buildingFocus ? `<div class="build-focus-banner">Rasterfokus: ${esc(fmtName(buildingFocus))}${uiState.colonyViewFocus?.source ? ` ┬À Quelle: ${esc(uiState.colonyViewFocus.source)}` : ''}</div>` : ''}
        ${(() => {
          const ev = currentColony.active_event;
          if (!ev) return '';
          const meta = {
            solar_flare:        { icon: 'ÔÿÇ´©Å', label: 'Solar Flare',        cls: 'event-solar',   desc: 'Energy production ÔêÆ30%' },
            mineral_vein:       { icon: 'ÔøÅ´©Å', label: 'Mineral Vein',       cls: 'event-mineral', desc: 'Metal production +20%' },
            disease:            { icon: '­ƒªá', label: 'Disease Outbreak',   cls: 'event-disease', desc: 'Happiness ÔêÆ25 (until Hospital Lv3)' },
            archaeological_find:{ icon: '­ƒÅ║', label: 'Archaeological Find', cls: 'event-unknown', desc: '+500 Dark Matter discovered' },
          }[ev.type] || { icon: 'ÔÜá´©Å', label: ev.type, cls: 'event-unknown', desc: '' };
          const mins = Number(ev.ends_in_min || 0);
          const timeLeft = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
          return `<div class="colony-event-banner ${esc(meta.cls)}"><span class="ce-icon">${meta.icon}</span><span class="ce-label"><strong>${esc(meta.label)}</strong> ÔÇö ${esc(meta.desc)}</span><span class="ce-timer">ends in ${esc(timeLeft)}</span></div>`;
        })()}
        <div class="colony-capacity-row">${Object.entries(classCaps).map(([key, value]) => `<span class="colony-cap-chip">${esc(buildingZoneLabel(key))}: ${esc(String(value))}</span>`).join('')}</div>
        <div class="colony-grid" style="grid-template-columns:repeat(${grid.cols}, minmax(0, 1fr));">
          ${grid.cells.map((cell) => {
            const building = cell.building;
            const anchor = !!building && cell.fill === 0;
            const focusType = building ? String(building.type || '') : pickZoneBuildFocus(cell.zone, currentColony, buildings);
            return `<button type="button" class="colony-cell colony-zone-${esc(cell.zone)} ${building ? 'occupied' : 'empty'} ${anchor ? 'anchor' : ''} ${buildingFocus && focusType === buildingFocus ? 'colony-cell-focus' : ''}" data-focus-building="${esc(focusType)}" data-cell-zone="${esc(cell.zone)}" data-cell-state="${building ? 'occupied' : 'empty'}" title="${building ? esc(building.meta?.label || fmtName(building.type)) : esc(buildingZoneLabel(cell.zone))}">
              ${building ? `<span class="colony-cell-icon">${esc(building.meta?.icon || '­ƒÅù')}</span><span class="colony-cell-label">${esc(fmtName(building.type))}</span><span class="colony-cell-level">Lv ${esc(String(building.level || 0))}</span>` : `<span class="colony-cell-icon">${esc(getBuildingUiMeta(focusType).icon || '­ƒÅù')}</span><span class="colony-cell-label">${esc(fmtName(focusType))}</span><span class="colony-cell-empty">${esc(buildingZoneLabel(cell.zone))}</span>`}
            </button>`;
          }).join('')}
        </div>
        <div class="colony-orbital-band">
          <h4>Orbital Layer</h4>
          <div class="colony-orbital-list">${orbitalFacilities.length ? orbitalFacilities.map((facility) => `<button type="button" class="colony-orbital-card" data-focus-building="${esc(facility.type || 'solar_satellite')}"><strong>${esc(facility.icon)} ${esc(facility.label)}</strong><span>Lv ${esc(String(facility.level || 0))}</span></button>`).join('') : '<p class="text-muted">No orbital facilities online.</p>'}</div>
        </div>`;
    }

    bindActions(root) {
      root.querySelector('#colony-open-buildings-btn')?.addEventListener('click', () => WM.open('buildings'));
      root.querySelector('#colony-open-shipyard-btn')?.addEventListener('click', () => WM.open('shipyard'));
      root.querySelectorAll('[data-focus-building]').forEach((el) => {
        el.addEventListener('click', () => {
          const focusBuilding = String(el.getAttribute('data-focus-building') || getRecommendedBuildingFocus(currentColony));
          const cellState = String(el.getAttribute('data-cell-state') || 'occupied');
          const cellZone = String(el.getAttribute('data-cell-zone') || 'flex');
          if (focusBuilding === 'solar_satellite') {
            selectColonyById(currentColony.id, { openWindows: false });
            WM.open('shipyard');
            showToast('Orbitalenergie wird im Shipyard verwaltet.', 'info');
            return;
          }
          focusColonyDevelopment(currentColony.id, {
            source: cellState === 'empty' ? `colony-zone:${cellZone}` : 'colony-grid',
            focusBuilding,
          });
          if (cellState === 'empty') {
            showToast(`Zone ${buildingZoneLabel(cellZone)}: Fokus auf ${fmtName(focusBuilding)}.`, 'info');
          }
        });
      });
    }

    async render() {
      const root = WM.body('colony');
      if (!root) return;
      if (!currentColony) {
        root.innerHTML = '<p class="text-muted">Select a colony first.</p>';
        return;
      }
      root.innerHTML = '<p class="text-muted">Loading colony viewÔÇª</p>';

      try {
        const data = await API.buildings(currentColony.id);
        if (!data.success) {
          root.innerHTML = '<p class="text-red">Failed to load colony view.</p>';
          return;
        }
        root.innerHTML = this.buildViewHtml(data);
        this.bindActions(root);
      } catch (_) {
        root.innerHTML = '<p class="text-red">Failed to render colony view.</p>';
      }
    }
  }

  const colonyViewController = new ColonyViewController();
  window.GQColonyViewController = colonyViewController;

  async function renderColonyView() {
    await colonyViewController.render();
  }

  class BuildingsController {
    getBuildingFocus() {
      return uiState.colonyViewFocus && Number(uiState.colonyViewFocus.colonyId) === Number(currentColony.id)
        ? String(uiState.colonyViewFocus.focusBuilding || '')
        : '';
    }

    groupByCategory(buildings) {
      const byCategory = {};
      for (const building of buildings) {
        const meta = getBuildingUiMeta(building.type);
        (byCategory[meta.cat] ??= []).push({ ...building, meta });
      }
      return byCategory;
    }

    buildQueueHtml(upgradeQueue) {
      if (!upgradeQueue.length) return '';
      const active = upgradeQueue.find((q) => String(q.status || '') === 'running') || null;
      const queued = upgradeQueue.filter((q) => String(q.status || '') === 'queued');
      return `
        <div class="system-card" style="margin-bottom:0.8rem">
          <div class="system-row"><strong>Bauauftrags-Queue</strong></div>
          ${active ? `<div class="system-row">­ƒöº Aktiv: ${esc(fmtName(active.type || 'building'))} -> Lv ${esc(String(active.target_level || '?'))} ┬À ETA <span data-end="${esc(active.eta)}">${countdown(active.eta)}</span></div>` : '<div class="system-row text-muted">Aktuell kein aktiver Auftrag.</div>'}
          ${queued.length ? `<div class="system-row">­ƒôï Wartend: ${queued.map((q) => `${esc(fmtName(q.type || 'building'))} -> Lv ${esc(String(q.target_level || '?'))}`).join(' ┬À ')}</div>` : '<div class="system-row text-muted">Keine weiteren Auftr├ñge in Warteschlange.</div>'}
        </div>`;
    }

    buildCardsHtml(byCategory, buildingFocus) {
      const catOrder = ['Extraction', 'Energy', 'Life Support', 'Population', 'Industry', 'Storage', 'Science', 'Military', 'Advanced', 'Other'];
      let html = '';
      for (const cat of catOrder) {
        const items = byCategory[cat];
        if (!items?.length) continue;
        html += `<div class="building-category"><h4 class="building-cat-title">${cat}</h4><div class="card-grid">`;
        for (const building of items) {
          const busy = !!building.upgrade_end;
          const cost = building.next_cost;
          html += `
            <div class="item-card ${buildingFocus === building.type ? 'item-card-focus' : ''}" data-building-type="${esc(building.type)}">
              <div class="item-card-header">
                <span class="item-name">${building.meta.icon} ${fmtName(building.type)}</span>
                <span class="item-level">Lv ${building.level}</span>
              </div>
              <div class="item-desc">${building.meta.desc}</div>
              <div class="item-cost">
                ${cost.metal ? `<span class="cost-metal">Ô¼í ${fmt(cost.metal)}</span>` : ''}
                ${cost.crystal ? `<span class="cost-crystal">­ƒÆÄ ${fmt(cost.crystal)}</span>` : ''}
                ${cost.deuterium ? `<span class="cost-deut">­ƒöÁ ${fmt(cost.deuterium)}</span>` : ''}
              </div>
              ${busy
                ? `<div class="item-timer">ÔÅ│ <span data-end="${esc(building.upgrade_end)}">${countdown(building.upgrade_end)}</span></div><div class="progress-bar-wrap"><div class="progress-bar" data-start="${esc(building.upgrade_start||'')}" data-end="${esc(building.upgrade_end)}" style="width:0%"></div></div>`
                : `<button class="btn btn-primary btn-sm upgrade-btn" data-type="${esc(building.type)}">Ôåæ Upgrade</button>`}
            </div>`;
        }
        html += '</div></div>';
      }
      return html;
    }

    async handleUpgrade(type, btn) {
      btn.disabled = true;
      const response = await API.upgrade(currentColony.id, type);
      if (response.success) {
        const queuePos = Number(response.queue_position || 0);
        const targetLevel = Number(response.target_level || 0);
        if (queuePos > 1) showToast(`Queued ${fmtName(type)} -> Lv ${targetLevel} (Position ${queuePos}).`, 'success');
        else showToast(`Upgrading ${fmtName(type)} -> Lv ${targetLevel}ÔÇª`, 'success');
        const resources = await API.resources(currentColony.id);
        if (resources.success) Object.assign(currentColony, resources.resources);
        updateResourceBar();
        await this.render();
      } else {
        showToast(response.error || 'Upgrade failed', 'error');
        btn.disabled = false;
      }
    }

    bindActions(root, buildingFocus) {
      root.querySelectorAll('.upgrade-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await this.handleUpgrade(btn.dataset.type, btn);
        });
      });
      if (buildingFocus) {
        const focusEl = root.querySelector(`.item-card[data-building-type="${buildingFocus}"]`);
        if (focusEl) focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    async render() {
      const root = WM.body('buildings');
      if (!root) return;
      if (!currentColony) {
        root.innerHTML = '<p class="text-muted">Select a colony first.</p>';
        return;
      }
      root.innerHTML = '<p class="text-muted">LoadingÔÇª</p>';
      const buildingFocus = this.getBuildingFocus();

      try {
        await API.finishBuilding(currentColony.id);
        const data = await API.buildings(currentColony.id);
        if (!data.success) {
          root.innerHTML = '<p class="text-red">Error loading buildings.</p>';
          return;
        }

        const byCategory = this.groupByCategory(data.buildings || []);
        const upgradeQueue = Array.isArray(data.upgrade_queue) ? data.upgrade_queue : [];
        let html = '';
        if (buildingFocus) {
          html += `<div class="build-focus-banner">Fokus: ${fmtName(buildingFocus)}${uiState.colonyViewFocus?.source ? ` ┬À Quelle: ${esc(uiState.colonyViewFocus.source)}` : ''}</div>`;
        }
        html += this.buildQueueHtml(upgradeQueue);
        html += this.buildCardsHtml(byCategory, buildingFocus);
        root.innerHTML = html;
        this.bindActions(root, buildingFocus);
      } catch (_) {
        root.innerHTML = '<p class="text-red">Failed to load buildings.</p>';
      }
    }
  }

  const buildingsController = new BuildingsController();
  window.GQBuildingsController = buildingsController;

  // ÔöÇÔöÇ Buildings window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderBuildings() {
    await buildingsController.render();
  }

  class ResearchController {
    buildCardsHtml(researchRows) {
      return `<div class="card-grid">${researchRows.map((row) => {
        const busy = !!row.research_end;
        const unlocked = row.can_research !== false;
        const locked = !unlocked;
        const cost = row.next_cost;
        const missing = Array.isArray(row.missing_prereqs) ? row.missing_prereqs : [];
        const missingText = missing.map(m => m.tech + ' L' + m.required_level).join(', ');
        return `
          <div class="item-card ${locked ? 'item-card-locked' : ''}">
            <div class="item-card-header">
              <span class="item-name">${fmtName(row.type)}</span>
              <span class="item-level">Lv ${row.level}</span>
            </div>
            ${locked ? `<div class="item-locked-badge">­ƒöÆ Locked</div>` : ''}
            <div class="item-cost">
              ${cost.metal ? `<span class="cost-metal">Ô¼í ${fmt(cost.metal)}</span>` : ''}
              ${cost.crystal ? `<span class="cost-crystal">­ƒÆÄ ${fmt(cost.crystal)}</span>` : ''}
              ${cost.deuterium ? `<span class="cost-deut">­ƒöÁ ${fmt(cost.deuterium)}</span>` : ''}
            </div>
            ${locked && missing.length ? `<div class="item-prereq-hint" title="Prerequisites">Requires: ${esc(missingText)}</div>` : ''}
            ${busy
              ? `<div class="item-timer">­ƒö¼ <span data-end="${esc(row.research_end)}">${countdown(row.research_end)}</span></div><div class="progress-bar-wrap"><div class="progress-bar" data-start="${esc(row.research_start||'')}" data-end="${esc(row.research_end)}" style="width:0%"></div></div>`
              : unlocked ? `<button class="btn btn-primary btn-sm research-btn" data-type="${esc(row.type)}">Research</button>` : `<button class="btn btn-secondary btn-sm" disabled>Locked</button>`}
          </div>`;
      }).join('')}</div>`;
    }

    bindActions(root) {
      root.querySelectorAll('.research-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const response = await API.doResearch(currentColony.id, btn.dataset.type);
          if (response.success) {
            showToast(`Researching ${fmtName(btn.dataset.type)}ÔÇª`, 'success');
            if (audioManager && typeof audioManager.playResearchStart === 'function') audioManager.playResearchStart();
            await this.render();
          } else {
            showToast(response.error || 'Research failed', 'error');
            btn.disabled = false;
          }
        });
      });
    }

    async render() {
      const root = WM.body('research');
      if (!root) return;
      if (!currentColony) {
        root.innerHTML = '<p class="text-muted">Select a colony first.</p>';
        return;
      }
      root.innerHTML = '<p class="text-muted">LoadingÔÇª</p>';

      try {
        const finishResult = await API.finishResearch();
        if (finishResult?.success && Array.isArray(finishResult.completed) && finishResult.completed.length > 0) {
          if (audioManager && typeof audioManager.playResearchComplete === 'function') audioManager.playResearchComplete();
          showToast(`Forschung abgeschlossen: ${finishResult.completed.map((type) => fmtName(type)).join(', ')}`, 'success');
        }
        const data = await API.research(currentColony.id);
        if (!data.success) {
          root.innerHTML = '<p class="text-red">Error.</p>';
          return;
        }

        root.innerHTML = this.buildCardsHtml(data.research || []);
        this.bindActions(root);
      } catch (_) {
        root.innerHTML = '<p class="text-red">Failed to load research.</p>';
      }
    }
  }

  const researchController = new ResearchController();
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

  class ShipyardController {
    constructor() {
      this.moduleCatalogCache = new Map();
    }

    renderSlotProfile(profile = {}) {
      const entries = Object.entries(profile || {}).filter(([, count]) => Number(count || 0) > 0);
      const frag = document.createDocumentFragment();
      if (!entries.length) {
        const s = new GQUI.Span().setClass('text-muted small').setTextContent('No slots');
        frag.appendChild(s.dom);
        return frag;
      }
      entries.forEach(([group, count]) => {
        const s = document.createElement('span');
        s.style.cssText = 'display:inline-flex;align-items:center;gap:0.25rem;padding:0.15rem 0.4rem;border:1px solid rgba(120,145,180,0.35);border-radius:999px;background:rgba(80,108,152,0.14);font-size:0.7rem;';
        s.textContent = fmtName(group) + ' ' + fmt(count);
        frag.appendChild(s);
      });
      return frag;
    }

    computeSlotProfile(hull, layoutCode = 'default') {
      const base = Object.assign({}, hull?.slot_profile || {});
      const layout = hull?.slot_variations?.[layoutCode] || null;
      const adjustments = layout?.slot_adjustments || {};
      Object.entries(adjustments).forEach(([group, delta]) => {
        base[group] = Math.max(0, Number(base[group] || 0) + Number(delta || 0));
      });
      return base;
    }

    moduleCatalogKey(hullCode, layoutCode) {
      return `${String(hullCode || '')}|${String(layoutCode || 'default')}`;
    }

    async fetchModuleCatalog(colonyId, hullCode, layoutCode = 'default') {
      const key = this.moduleCatalogKey(hullCode, layoutCode);
      if (this.moduleCatalogCache.has(key)) {
        return this.moduleCatalogCache.get(key);
      }

      const response = await API.shipyardModules(colonyId, hullCode, layoutCode);
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to load module catalog.');
      }
      this.moduleCatalogCache.set(key, response);
      return response;
    }

    renderAffinityChips(affinities) {
      if (!Array.isArray(affinities) || !affinities.length) return null;
      const fmtBonus = (type, val) => {
        const v = Number(val);
        if (type === 'cost_pct') return `Kosten ${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
        if (type === 'build_time_pct') return `Bauzeit ${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
        if (type === 'stat_mult') return `Stats ${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
        if (type === 'unlock_tier') return `Tier +${v.toFixed(0)}`;
        return `${type} ${v}`;
      };
      const frag = document.createDocumentFragment();
      affinities.forEach((a) => {
        const label = fmtBonus(a.bonus_type, a.bonus_value);
        const titleText = `${String(a.faction_name || a.faction_code || '')}: ${label} ┬À Ben├Âtigt Stand ${a.min_standing} ┬À Aktuell ${a.user_standing ?? '?'}`;
        const chip = new GQUI.Span().setClass('shipyard-affinity-chip ' + (a.active ? 'affinity-active' : 'affinity-inactive'));
        chip.dom.title = titleText;
        chip.dom.textContent = String(a.faction_icon || 'Ô¼í') + ' ' + label;
        frag.appendChild(chip.dom);
      });
      return frag;
    }

    renderModuleSlotEditor(moduleCatalog) {
      const groups = Array.isArray(moduleCatalog?.module_groups) ? moduleCatalog.module_groups : [];
      if (!groups.length) {
        return new GQUI.Div().setClass('text-muted small')
          .setTextContent('No module groups available for this hull/layout.').dom;
      }

      const editor = new GQUI.Div().setClass('shipyard-slot-editor');
      groups.forEach((group) => {
        const slotCount = Math.max(0, Number(group.slot_count || 0));
        if (!slotCount) return;

        const groupDiv = new GQUI.Div().setClass('shipyard-slot-group');
        groupDiv.dom.dataset.groupCode = String(group.code || '');

        const labelDiv = new GQUI.Div().setClass('small shipyard-slot-group-label');
        labelDiv.dom.textContent = `${fmtName(group.label || group.code || 'group')} ┬À Slots ${fmt(slotCount)}`;
        const affFrag = this.renderAffinityChips(group.affinities || []);
        if (affFrag) {
          const chipsWrap = new GQUI.Span().setClass('shipyard-affinity-chips');
          chipsWrap.dom.appendChild(affFrag);
          labelDiv.dom.appendChild(chipsWrap.dom);
        }
        groupDiv.add(labelDiv);

        const rowsDiv = new GQUI.Div().setClass('shipyard-slot-rows');
        for (let idx = 0; idx < slotCount; idx++) {
          const slotRow = new GQUI.Div().setClass('shipyard-slot-row');
          slotRow.dom.dataset.groupCode = String(group.code || '');
          slotRow.dom.dataset.slotIndex = String(idx);

          const lbl = new GQUI.Span().setClass('shipyard-slot-label small')
            .setTextContent('Slot ' + (idx + 1));
          slotRow.add(lbl);

          const sel = document.createElement('select');
          sel.className = 'input shipyard-module-slot';
          sel.dataset.groupCode = String(group.code || '');
          sel.dataset.slotIndex = String(idx);
          const emptyOpt = document.createElement('option');
          emptyOpt.value = '';
          emptyOpt.textContent = 'ÔÇö empty ÔÇö';
          sel.appendChild(emptyOpt);
          (Array.isArray(group.modules) ? group.modules : []).forEach((mod) => {
            const statsLabel = Object.entries(mod.stats_delta || {})
              .map(([k, v]) => `${fmtName(k)} ${v >= 0 ? '+' : ''}${fmt(v)}`).join(', ');
            const statsData = Object.entries(mod.stats_delta || {})
              .map(([k, v]) => `${k}:${v}`).join(',');
            const blocker = Array.isArray(mod.blockers) && mod.blockers.length
              ? ` [LOCKED: ${mod.blockers.join(' / ')}]` : '';
            const opt = document.createElement('option');
            opt.value = String(mod.code || '');
            opt.dataset.stats = statsData;
            opt.dataset.tier = String(Number(mod.tier || 1));
            if (mod.unlocked === false) opt.disabled = true;
            opt.textContent = `${String(mod.label || mod.code || 'Module')} (T${fmt(mod.tier || 1)})${statsLabel ? ' ┬À ' + statsLabel : ''}${blocker}`;
            sel.appendChild(opt);
          });
          if (!group.modules?.length) sel.disabled = true;
          slotRow.dom.appendChild(sel);

          const arrowsDiv = new GQUI.Div().setClass('shipyard-slot-arrows');
          const upBtn = new GQUI.Button('Ôû▓').setClass('btn shipyard-slot-up');
          upBtn.dom.type = 'button';
          upBtn.dom.dataset.groupCode = String(group.code || '');
          upBtn.dom.dataset.slotIndex = String(idx);
          upBtn.dom.title = 'Tauscht diesen Slot mit dem dar├╝ber';
          if (idx === 0) upBtn.dom.disabled = true;
          const downBtn = new GQUI.Button('Ôû╝').setClass('btn shipyard-slot-down');
          downBtn.dom.type = 'button';
          downBtn.dom.dataset.groupCode = String(group.code || '');
          downBtn.dom.dataset.slotIndex = String(idx);
          downBtn.dom.title = 'Tauscht diesen Slot mit dem darunter';
          if (idx === slotCount - 1) downBtn.dom.disabled = true;
          arrowsDiv.add(upBtn, downBtn);
          slotRow.add(arrowsDiv);

          rowsDiv.add(slotRow);
        }
        groupDiv.add(rowsDiv);
        editor.add(groupDiv);
      });

      if (!editor.dom.children.length) {
        return new GQUI.Div().setClass('text-muted small')
          .setTextContent('No active slots for this layout.').dom;
      }
      return editor.dom;
    }

    collectBlueprintModulesFromUI(root) {
      const selects = Array.from(root.querySelectorAll('.shipyard-module-slot'));
      if (!selects.length) {
        return [];
      }

      const totals = new Map();
      selects.forEach((el) => {
        const code = String(el.value || '').trim();
        if (!code) return;
        totals.set(code, (totals.get(code) || 0) + 1);
      });

      return Array.from(totals.entries()).map(([code, quantity]) => ({ code, quantity }));
    }

    swapSlots(root, groupCode, idxA, idxB) {
      const selA = root.querySelector(`.shipyard-module-slot[data-group-code="${groupCode}"][data-slot-index="${idxA}"]`);
      const selB = root.querySelector(`.shipyard-module-slot[data-group-code="${groupCode}"][data-slot-index="${idxB}"]`);
      if (!selA || !selB) return;
      const tmp = selA.value;
      selA.value = selB.value;
      selB.value = tmp;
      this.updateStatsPreview(root);
    }

    computeLiveStats(root, baseStats = {}) {
      const slots = Array.from(root.querySelectorAll('.shipyard-module-slot'));
      const totals = Object.assign({ attack: 0, shield: 0, hull: 0, cargo: 0, speed: 0 }, baseStats);
      slots.forEach((sel) => {
        if (!sel.value) return;
        const opt = sel.options[sel.selectedIndex];
        if (!opt) return;
        const statsStr = String(opt.dataset.stats || '');
        statsStr.split(',').forEach((part) => {
          const [key, val] = part.split(':');
          if (!key || val === undefined) return;
          const k = key.trim();
          if (k in totals) totals[k] = (totals[k] || 0) + Number(val);
        });
      });
      return totals;
    }

    updateStatsPreview(root) {
      const preview = root.querySelector('#shipyard-blueprint-stats-preview');
      if (!preview) return;
      const hullCode = String(root.querySelector('#shipyard-blueprint-hull')?.value || '');
      const hullCard = root.querySelector(`.shipyard-hull-base[data-hull-code="${hullCode}"]`);
      const baseStats = hullCard
        ? {
            attack: Number(hullCard.dataset.attack || 0),
            shield: Number(hullCard.dataset.shield || 0),
            hull:   Number(hullCard.dataset.hull   || 0),
            cargo:  Number(hullCard.dataset.cargo  || 0),
            speed:  Number(hullCard.dataset.speed  || 0),
          }
        : {};
      const live = this.computeLiveStats(root, baseStats);
      const hasMods = Array.from(root.querySelectorAll('.shipyard-module-slot')).some((s) => s.value);
      if (!hasMods) {
        const empty = new GQUI.Div().setClass('shipyard-stats-preview-empty small text-muted')
          .setTextContent('W├ñhle Module, um eine Vorschau zu erhalten.');
        preview.replaceChildren(empty.dom);
        return;
      }
      const chipDefs = [
        { cls: 'chiptype-atk',   icon: 'ÔÜö',  key: 'ATK',   val: live.attack },
        { cls: 'chiptype-shd',   icon: '­ƒøí', key: 'SHD',   val: live.shield },
        { cls: 'chiptype-hll',   icon: '­ƒö®', key: 'HULL',  val: live.hull   },
        { cls: 'chiptype-cargo', icon: '­ƒôª', key: 'CARGO', val: live.cargo  },
        { cls: 'chiptype-spd',   icon: 'ÔÜí', key: 'SPD',   val: live.speed  },
      ];
      const grid = new GQUI.Div().setClass('shipyard-stats-preview-grid');
      chipDefs.forEach(({ cls, icon, key, val }) => {
        const chip = new GQUI.Div().setClass('shipyard-stats-chip ' + cls);
        chip.dom.textContent = icon + ' ' + key + ' ';
        const strong = document.createElement('strong');
        strong.textContent = fmt(val);
        chip.dom.appendChild(strong);
        grid.add(chip);
      });
      const wrap = new GQUI.Div().setClass('shipyard-stats-preview');
      wrap.add(new GQUI.Div().setClass('shipyard-stats-preview-label').setTextContent('Kompilierte Statistiken (Vorschau)'));
      wrap.add(grid);
      preview.replaceChildren(wrap.dom);
    }

    // ÔöÇÔöÇ Saved presets (localStorage) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    _presetKey() { return 'gq_shipyard_presets_v1'; }

    loadPresetsFromStorage() {
      try {
        return JSON.parse(localStorage.getItem(this._presetKey()) || '[]');
      } catch (_) { return []; }
    }

    savePresetToStorage(name, hull, layout, modules) {
      const presets = this.loadPresetsFromStorage().filter((p) => p.name !== name);
      presets.unshift({ name, hull, layout, modules, ts: Date.now() });
      localStorage.setItem(this._presetKey(), JSON.stringify(presets.slice(0, 20)));
    }

    deletePresetFromStorage(name) {
      const presets = this.loadPresetsFromStorage().filter((p) => p.name !== name);
      localStorage.setItem(this._presetKey(), JSON.stringify(presets));
    }

    buildPresetToolbarDom() {
      const presets = this.loadPresetsFromStorage();
      const sel = document.createElement('select');
      sel.id = 'shipyard-preset-select';
      sel.className = 'input shipyard-preset-select';
      if (!presets.length) sel.disabled = true;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'ÔÇö Preset laden ÔÇö';
      sel.appendChild(placeholder);
      if (presets.length) {
        presets.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = String(p.name);
          opt.textContent = `${p.name} ┬À ${fmtName(p.hull)} / ${fmtName(p.layout)}`;
          sel.appendChild(opt);
        });
      } else {
        const noOpt = document.createElement('option');
        noOpt.value = '';
        noOpt.disabled = true;
        noOpt.textContent = 'Keine Presets gespeichert';
        sel.appendChild(noOpt);
      }

      const loadBtn = new GQUI.Button('Laden').setClass('btn btn-secondary btn-sm');
      loadBtn.dom.id = 'shipyard-preset-load';
      loadBtn.dom.type = 'button';
      if (!presets.length) loadBtn.dom.disabled = true;

      const saveBtn = new GQUI.Button('Speichern').setClass('btn btn-secondary btn-sm');
      saveBtn.dom.id = 'shipyard-preset-save';
      saveBtn.dom.type = 'button';

      const delBtn = new GQUI.Button('L├Âschen').setClass('btn btn-warning btn-sm');
      delBtn.dom.id = 'shipyard-preset-delete';
      delBtn.dom.type = 'button';
      if (!presets.length) delBtn.dom.disabled = true;

      const toolbar = new GQUI.Div().setClass('shipyard-preset-toolbar');
      toolbar.dom.appendChild(sel);
      toolbar.add(loadBtn, saveBtn, delBtn);
      return toolbar.dom;
    }

    refreshPresetToolbar(root) {
      const container = root.querySelector('#shipyard-preset-toolbar-wrap');
      if (container) container.replaceChildren(this.buildPresetToolbarDom());
      this.bindPresetActions(root);
    }

    applyPreset(root, preset, hulls) {
      const hullSel = root.querySelector('#shipyard-blueprint-hull');
      const layoutSel = root.querySelector('#shipyard-blueprint-layout');
      if (hullSel) hullSel.value = preset.hull;
      this.updateBlueprintLayoutOptions(root, hulls).then(() => {
        if (layoutSel) layoutSel.value = preset.layout;
        // restore module slots after layout is rendered
        window.setTimeout(() => {
          const groupMap = new Map();
          (Array.isArray(preset.modules) ? preset.modules : []).forEach((m) => {
            if (!groupMap.has(m.group)) groupMap.set(m.group, []);
            for (let i = 0; i < (m.quantity || 1); i++) groupMap.get(m.group).push(m.code);
          });
          root.querySelectorAll('.shipyard-module-slot').forEach((sel) => {
            const g = sel.dataset.groupCode;
            const idx = Number(sel.dataset.slotIndex || 0);
            const codes = groupMap.get(g) || [];
            if (codes[idx] !== undefined) sel.value = codes[idx];
          });
          this.updateStatsPreview(root);
        }, 80);
      });
    }

    bindPresetActions(root) {
      root.querySelector('#shipyard-preset-save')?.addEventListener('click', () => {
        const hullCode = String(root.querySelector('#shipyard-blueprint-hull')?.value || '');
        const layoutCode = String(root.querySelector('#shipyard-blueprint-layout')?.value || 'default');
        if (!hullCode) { showToast('Kein Hull ausgew├ñhlt.', 'warning'); return; }
        const nameDefault = `${fmtName(hullCode)}-${fmtName(layoutCode)}`;
        const name = (window.prompt('Preset-Name:', nameDefault) || '').trim();
        if (!name) return;
        const slotModules = [];
        root.querySelectorAll('.shipyard-module-slot').forEach((sel) => {
          if (sel.value) slotModules.push({ group: sel.dataset.groupCode, code: sel.value, quantity: 1 });
        });
        this.savePresetToStorage(name, hullCode, layoutCode, slotModules);
        this.refreshPresetToolbar(root);
        showToast(`Preset gespeichert: ${name}`, 'success');
      });

      root.querySelector('#shipyard-preset-load')?.addEventListener('click', () => {
        const sel = root.querySelector('#shipyard-preset-select');
        const name = String(sel?.value || '').trim();
        if (!name) { showToast('Kein Preset ausgew├ñhlt.', 'warning'); return; }
        const preset = this.loadPresetsFromStorage().find((p) => p.name === name);
        if (!preset) { showToast('Preset nicht gefunden.', 'error'); return; }
        this._pendingHulls = this._pendingHulls || [];
        this.applyPreset(root, preset, this._pendingHulls);
        showToast(`Preset geladen: ${name}`, 'info');
      });

      root.querySelector('#shipyard-preset-delete')?.addEventListener('click', () => {
        const sel = root.querySelector('#shipyard-preset-select');
        const name = String(sel?.value || '').trim();
        if (!name) { showToast('Kein Preset ausgew├ñhlt.', 'warning'); return; }
        this.deletePresetFromStorage(name);
        this.refreshPresetToolbar(root);
        showToast(`Preset gel├Âscht: ${name}`, 'info');
      });
    }

    buildCardsDom(ships) {
      const grid = new GQUI.Div().setClass('card-grid');
      ships.forEach((ship) => {
        const card = new GQUI.Div().setClass('item-card');

        const header = new GQUI.Div().setClass('item-card-header');
        header.add(new GQUI.Span().setClass('item-name').setTextContent(fmtName(ship.type)));
        header.add(new GQUI.Span().setClass('item-level').setTextContent(ship.count + ' owned'));
        card.add(header);

        const runningCount = Number(ship.running_count || 0);
        const queuedCount  = Number(ship.queued_count  || 0);
        if (runningCount > 0 || queuedCount > 0) {
          const qDiv = new GQUI.Div().setClass('small text-muted');
          qDiv.dom.style.marginBottom = '0.35rem';
          let qText = 'Queue: ';
          if (runningCount > 0) qText += `${fmt(runningCount)} running`;
          if (runningCount > 0 && queuedCount > 0) qText += ' ┬À ';
          if (queuedCount > 0) qText += `${fmt(queuedCount)} queued`;
          if (ship.active_eta) qText += ` ┬À ETA ${countdown(ship.active_eta)}`;
          qDiv.dom.textContent = qText;
          card.add(qDiv);
        }

        const costDiv = new GQUI.Div().setClass('item-cost');
        if (ship.cost.metal)     { const s = new GQUI.Span().setClass('cost-metal').setTextContent(`Ô¼í ${fmt(ship.cost.metal)}`); costDiv.add(s); }
        if (ship.cost.crystal)   { const s = new GQUI.Span().setClass('cost-crystal').setTextContent(`­ƒÆÄ ${fmt(ship.cost.crystal)}`); costDiv.add(s); }
        if (ship.cost.deuterium) { const s = new GQUI.Span().setClass('cost-deut').setTextContent(`­ƒöÁ ${fmt(ship.cost.deuterium)}`); costDiv.add(s); }
        card.add(costDiv);

        const statsDiv = new GQUI.Div();
        statsDiv.dom.style.cssText = 'font-size:0.75rem;color:var(--text-muted)';
        statsDiv.dom.textContent = `­ƒôª ${fmt(ship.cargo)}   ÔÜí ${fmt(ship.speed)}`;
        card.add(statsDiv);

        const buildRow = new GQUI.Div().setClass('ship-build-row');
        const qtyInput = document.createElement('input');
        qtyInput.type = 'number';
        qtyInput.className = 'ship-qty';
        qtyInput.dataset.type = String(ship.type);
        qtyInput.min = '1';
        qtyInput.value = '1';
        buildRow.dom.appendChild(qtyInput);
        const buildBtn = new GQUI.Button('Build').setClass('btn btn-primary btn-sm build-btn');
        buildBtn.dom.dataset.type = String(ship.type);
        buildRow.add(buildBtn);
        card.add(buildRow);

        grid.add(card);
      });
      return grid.dom;
    }

    buildBlueprintCardsDom(blueprints) {
      if (!Array.isArray(blueprints) || !blueprints.length) {
        const p = document.createElement('p');
        p.className = 'text-muted small';
        p.textContent = 'No blueprints created yet.';
        return p;
      }
      const grid = new GQUI.Div().setClass('card-grid');
      blueprints.forEach((bp) => {
        const card = new GQUI.Div().setClass('item-card');
        card.dom.style.cssText = 'border-color:rgba(94,133,189,0.45);background:linear-gradient(180deg, rgba(13,20,33,0.96), rgba(10,16,27,0.92));';

        const header = new GQUI.Div().setClass('item-card-header');
        header.add(new GQUI.Span().setClass('item-name').setTextContent(String(bp.name || bp.type)));
        header.add(new GQUI.Span().setClass('item-level').setTextContent(`${fmt(bp.count || 0)} owned`));
        card.add(header);

        const runningCount = Number(bp.running_count || 0);
        const queuedCount  = Number(bp.queued_count  || 0);
        if (runningCount > 0 || queuedCount > 0) {
          const qDiv = new GQUI.Div().setClass('small text-muted');
          qDiv.dom.style.marginBottom = '0.35rem';
          let qText = 'Queue: ';
          if (runningCount > 0) qText += `${fmt(runningCount)} running`;
          if (runningCount > 0 && queuedCount > 0) qText += ' ┬À ';
          if (queuedCount > 0) qText += `${fmt(queuedCount)} queued`;
          if (bp.active_eta) qText += ` ┬À ETA ${countdown(bp.active_eta)}`;
          qDiv.dom.textContent = qText;
          card.add(qDiv);
        }

        const classDiv = new GQUI.Div().setClass('small text-muted');
        classDiv.dom.style.marginBottom = '0.35rem';
        classDiv.dom.textContent = `${fmtName(bp.ship_class || 'corvette')} ┬À ${fmtName(bp.slot_layout_code || 'default')}`;
        card.add(classDiv);

        const costDiv = new GQUI.Div().setClass('item-cost');
        if (bp.cost?.metal)     { const s = new GQUI.Span().setClass('cost-metal').setTextContent(`Ô¼í ${fmt(bp.cost.metal)}`); costDiv.add(s); }
        if (bp.cost?.crystal)   { const s = new GQUI.Span().setClass('cost-crystal').setTextContent(`­ƒÆÄ ${fmt(bp.cost.crystal)}`); costDiv.add(s); }
        if (bp.cost?.deuterium) { const s = new GQUI.Span().setClass('cost-deut').setTextContent(`­ƒöÁ ${fmt(bp.cost.deuterium)}`); costDiv.add(s); }
        card.add(costDiv);

        const stats1 = new GQUI.Div();
        stats1.dom.style.cssText = 'font-size:0.75rem;color:var(--text-muted)';
        stats1.dom.textContent = `ATK ${fmt(bp.stats?.attack || 0)} ┬À SHD ${fmt(bp.stats?.shield || 0)} ┬À HULL ${fmt(bp.stats?.hull || 0)}`;
        card.add(stats1);

        const stats2 = new GQUI.Div();
        stats2.dom.style.cssText = 'font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;';
        stats2.dom.textContent = `CARGO ${fmt(bp.stats?.cargo || 0)} ┬À SPD ${fmt(bp.stats?.speed || 0)}`;
        card.add(stats2);

        const slotWrap = new GQUI.Div();
        slotWrap.dom.style.cssText = 'margin-top:0.45rem; display:flex; flex-wrap:wrap; gap:0.3rem;';
        slotWrap.dom.appendChild(this.renderSlotProfile(bp.slot_profile || {}));
        card.add(slotWrap);

        const buildRow = new GQUI.Div().setClass('ship-build-row');
        buildRow.dom.style.marginTop = '0.65rem';
        const qtyInput = document.createElement('input');
        qtyInput.type = 'number';
        qtyInput.className = 'ship-qty';
        qtyInput.dataset.blueprintId = String(Number(bp.id || 0));
        qtyInput.min = '1';
        qtyInput.value = '1';
        buildRow.dom.appendChild(qtyInput);
        const buildBtn = new GQUI.Button('Build').setClass('btn btn-primary btn-sm build-blueprint-btn');
        buildBtn.dom.dataset.blueprintId = String(Number(bp.id || 0));
        buildBtn.dom.dataset.blueprintType = String(bp.type || '');
        buildBtn.dom.dataset.blueprintName = String(bp.name || bp.type || 'Blueprint');
        buildRow.add(buildBtn);
        card.add(buildRow);

        grid.add(card);
      });
      return grid.dom;
    }

    buildHullCatalogDom(hulls) {
      if (!Array.isArray(hulls) || !hulls.length) {
        const p = document.createElement('p');
        p.className = 'text-muted small';
        p.textContent = 'No hull catalog available.';
        return p;
      }
      const grid = new GQUI.Div().setClass('card-grid');
      hulls.forEach((hull) => {
        const layouts = Object.keys(hull.slot_variations || {});
        const card = new GQUI.Div().setClass('item-card');
        card.dom.style.cssText = 'border-color:rgba(137,117,70,0.45);';

        const header = new GQUI.Div().setClass('item-card-header');
        header.add(new GQUI.Span().setClass('item-name').setTextContent(String(hull.label || hull.code)));
        header.add(new GQUI.Span().setClass('item-level').setTextContent(fmtName(hull.ship_class || hull.role || 'hull')));
        card.add(header);

        if (hull.unlocked === false) {
          const lockDiv = new GQUI.Div().setClass('small text-red');
          lockDiv.dom.style.marginBottom = '0.35rem';
          lockDiv.dom.textContent = 'Locked: ' + (hull.blockers || []).join(' | ');
          card.add(lockDiv);
        } else {
          const unlockDiv = new GQUI.Div().setClass('small');
          unlockDiv.dom.style.cssText = 'margin-bottom:0.35rem;color:#7ed7a1;';
          unlockDiv.dom.textContent = 'Unlocked';
          card.add(unlockDiv);
        }

        const tierDiv = new GQUI.Div().setClass('small text-muted');
        tierDiv.dom.style.marginBottom = '0.35rem';
        tierDiv.dom.textContent = `Tier ${fmt(hull.tier || 1)} ┬À ${String(hull.code || '')}`;
        card.add(tierDiv);

        const stats1 = new GQUI.Div();
        stats1.dom.style.cssText = 'font-size:0.75rem;color:var(--text-muted)';
        stats1.dom.textContent = `ATK ${fmt(hull.base_stats?.attack || 0)} ┬À SHD ${fmt(hull.base_stats?.shield || 0)} ┬À HULL ${fmt(hull.base_stats?.hull || 0)}`;
        card.add(stats1);

        const stats2 = new GQUI.Div();
        stats2.dom.style.cssText = 'font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;';
        stats2.dom.textContent = `CARGO ${fmt(hull.base_stats?.cargo || 0)} ┬À SPD ${fmt(hull.base_stats?.speed || 0)}`;
        card.add(stats2);

        const slotWrap = new GQUI.Div();
        slotWrap.dom.style.cssText = 'margin-top:0.45rem; display:flex; flex-wrap:wrap; gap:0.3rem;';
        slotWrap.dom.appendChild(this.renderSlotProfile(hull.slot_profile || {}));
        card.add(slotWrap);

        const layoutsDiv = new GQUI.Div().setClass('small text-muted');
        layoutsDiv.dom.style.marginTop = '0.45rem';
        layoutsDiv.dom.textContent = 'Layouts: ' + (layouts.length
          ? layouts.map((layout) => fmtName(layout)).join(' ┬À ')
          : 'default only');
        card.add(layoutsDiv);

        grid.add(card);
      });
      return grid.dom;
    }

    buildBlueprintCreatorDom(hulls) {
      const card = new GQUI.Div().setClass('system-card');
      card.dom.style.marginBottom = '1rem';

      const titleRow = new GQUI.Div().setClass('system-row');
      const titleStrong = document.createElement('strong');
      titleStrong.textContent = 'Blueprint Forge';
      titleRow.dom.appendChild(titleStrong);
      card.add(titleRow);

      const desc = new GQUI.Div().setClass('small text-muted');
      desc.dom.style.marginTop = '0.3rem';
      desc.dom.textContent = 'Quick-create a starter blueprint from a hull class and one of its slot layouts.';
      card.add(desc);

      const presetWrap = new GQUI.Div();
      presetWrap.dom.id = 'shipyard-preset-toolbar-wrap';
      presetWrap.dom.style.marginTop = '0.65rem';
      presetWrap.dom.appendChild(this.buildPresetToolbarDom());
      card.add(presetWrap);

      const grid = new GQUI.Div();
      grid.dom.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.6rem;margin-top:0.7rem;';

      const nameLbl = document.createElement('label');
      nameLbl.className = 'small';
      nameLbl.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem;';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = 'Name';
      const nameInput = document.createElement('input');
      nameInput.id = 'shipyard-blueprint-name';
      nameInput.className = 'input';
      nameInput.placeholder = 'Aegis Frigate';
      nameLbl.appendChild(nameSpan);
      nameLbl.appendChild(nameInput);
      grid.dom.appendChild(nameLbl);

      const hullLbl = document.createElement('label');
      hullLbl.className = 'small';
      hullLbl.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem;';
      const hullSpan = document.createElement('span');
      hullSpan.textContent = 'Hull';
      const hullSel = document.createElement('select');
      hullSel.id = 'shipyard-blueprint-hull';
      hullSel.className = 'input';
      (Array.isArray(hulls) ? hulls : []).forEach((hull) => {
        const opt = document.createElement('option');
        opt.value = String(hull.code || '');
        opt.dataset.attack = String(Number(hull.base_stats?.attack || 0));
        opt.dataset.shield = String(Number(hull.base_stats?.shield || 0));
        opt.dataset.hull   = String(Number(hull.base_stats?.hull   || 0));
        opt.dataset.cargo  = String(Number(hull.base_stats?.cargo  || 0));
        opt.dataset.speed  = String(Number(hull.base_stats?.speed  || 0));
        if (hull.unlocked === false) opt.disabled = true;
        opt.textContent = `${String(hull.label || hull.code || 'Hull')} (${fmtName(hull.ship_class || hull.role || 'hull')})${hull.unlocked === false ? ' [locked]' : ''}`;
        hullSel.appendChild(opt);
      });
      hullLbl.appendChild(hullSpan);
      hullLbl.appendChild(hullSel);
      grid.dom.appendChild(hullLbl);

      const layoutLbl = document.createElement('label');
      layoutLbl.className = 'small';
      layoutLbl.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem;';
      const layoutSpan = document.createElement('span');
      layoutSpan.textContent = 'Layout';
      const layoutSel = document.createElement('select');
      layoutSel.id = 'shipyard-blueprint-layout';
      layoutSel.className = 'input';
      layoutLbl.appendChild(layoutSpan);
      layoutLbl.appendChild(layoutSel);
      grid.dom.appendChild(layoutLbl);

      card.add(grid);

      const layoutPreview = new GQUI.Div().setClass('small text-muted');
      layoutPreview.dom.id = 'shipyard-blueprint-layout-preview';
      layoutPreview.dom.style.marginTop = '0.55rem';
      card.add(layoutPreview);

      const modulesDiv = new GQUI.Div();
      modulesDiv.dom.id = 'shipyard-blueprint-modules';
      modulesDiv.dom.style.marginTop = '0.65rem';
      card.add(modulesDiv);

      const statsPreview = new GQUI.Div();
      statsPreview.dom.id = 'shipyard-blueprint-stats-preview';
      statsPreview.dom.style.marginTop = '0.55rem';
      card.add(statsPreview);

      const actionsDiv = new GQUI.Div();
      actionsDiv.dom.style.cssText = 'margin-top:0.7rem; display:flex; gap:0.5rem; flex-wrap:wrap;';
      const createBtn = new GQUI.Button('Create Blueprint').setClass('btn');
      createBtn.dom.id = 'shipyard-create-blueprint';
      actionsDiv.add(createBtn);
      card.add(actionsDiv);

      return card.dom;
    }

    buildQueueDom(queue) {
      if (!Array.isArray(queue) || !queue.length) {
        return new GQUI.El(document.createElement('p')).setClass('text-muted small')
          .setTextContent('No ships in production.').dom;
      }
      const wrap = new GQUI.Div();
      wrap.dom.style.cssText = 'display:grid;gap:0.55rem;';
      queue.forEach((entry) => {
        const running = String(entry.status || '') === 'running';
        const label = String(entry.label || entry.ship_type || 'Ship');
        const statusLabel = running ? 'Running' : `Queued #${Number(entry.position || 1)}`;

        const card = new GQUI.Div().setClass('item-card');
        card.dom.style.cssText = 'padding:0.8rem 0.9rem;';

        const header = new GQUI.Div().setClass('item-card-header');
        const nameSpan = new GQUI.Span().setClass('item-name').setTextContent(label);
        const statusSpan = new GQUI.Span().setClass('item-level').setTextContent(statusLabel);
        header.add(nameSpan, statusSpan);
        card.add(header);

        const qtyDiv = new GQUI.Div().setClass('small text-muted');
        qtyDiv.dom.style.marginBottom = '0.35rem';
        qtyDiv.dom.textContent = `${fmt(Number(entry.quantity || 1))}x ${fmtName(entry.ship_type || label)}`;
        card.add(qtyDiv);

        if (running && entry.eta) {
          const timerDiv = new GQUI.Div().setClass('item-timer');
          timerDiv.dom.textContent = 'ÔÅ│ ';
          const etaSpan = document.createElement('span');
          etaSpan.dataset.end = String(entry.eta);
          etaSpan.textContent = countdown(entry.eta);
          timerDiv.dom.appendChild(etaSpan);
          card.add(timerDiv);

          const pbWrap = new GQUI.Div().setClass('progress-bar-wrap');
          const pb = new GQUI.Div().setClass('progress-bar');
          pb.dom.dataset.start = String(entry.started_at || '');
          pb.dom.dataset.end = String(entry.eta);
          pb.dom.style.width = '0%';
          pbWrap.add(pb);
          card.add(pbWrap);
        } else {
          const waitDiv = new GQUI.Div().setClass('small text-muted')
            .setTextContent('Waiting for free shipyard slot.');
          card.add(waitDiv);
        }
        wrap.add(card);
      });
      return wrap.dom;
    }

    async updateBlueprintLayoutOptions(root, hulls) {
      const hullCode = String(root.querySelector('#shipyard-blueprint-hull')?.value || '');
      const hull = (Array.isArray(hulls) ? hulls : []).find((entry) => String(entry.code || '') === hullCode);
      const layoutSelect = root.querySelector('#shipyard-blueprint-layout');
      const preview = root.querySelector('#shipyard-blueprint-layout-preview');
      const modulesRoot = root.querySelector('#shipyard-blueprint-modules');
      if (!layoutSelect || !hull) {
        if (layoutSelect) {
          const defOpt = document.createElement('option');
          defOpt.value = 'default';
          defOpt.textContent = 'Default';
          layoutSelect.replaceChildren(defOpt);
        }
        if (preview) preview.replaceChildren();
        if (modulesRoot) modulesRoot.replaceChildren();
        return;
      }

      const layouts = ['default', ...Object.keys(hull.slot_variations || {})];
      const newOpts = layouts.map((layoutCode) => {
        const label = layoutCode === 'default'
          ? 'Default'
          : String(hull.slot_variations?.[layoutCode]?.label || fmtName(layoutCode));
        const opt = document.createElement('option');
        opt.value = layoutCode;
        opt.textContent = label;
        return opt;
      });
      layoutSelect.replaceChildren(...newOpts);

      const selectedLayout = String(layoutSelect.value || 'default');
      const profile = this.computeSlotProfile(hull, selectedLayout);
      if (preview) {
        const previewFrag = document.createDocumentFragment();
        const classSpan = document.createTextNode(
          `Class: ${fmtName(hull.ship_class || hull.role || 'hull')} ┬À Slots: `
        );
        previewFrag.appendChild(classSpan);
        previewFrag.appendChild(this.renderSlotProfile(profile));
        if (Array.isArray(hull.blockers) && hull.blockers.length) {
          const lockDiv = new GQUI.Div().setClass('text-red');
          lockDiv.dom.style.marginTop = '0.3rem';
          lockDiv.dom.textContent = 'Locked: ' + hull.blockers.join(' | ');
          previewFrag.appendChild(lockDiv.dom);
        }
        preview.replaceChildren(previewFrag);
      }

      if (modulesRoot) {
        const loadingDiv = new GQUI.Div().setClass('text-muted small')
          .setTextContent('Loading module options...');
        modulesRoot.replaceChildren(loadingDiv.dom);
      }
      try {
        const catalog = await this.fetchModuleCatalog(currentColony.id, hull.code, selectedLayout);
        if (modulesRoot) {
          modulesRoot.replaceChildren();
          if (catalog?.hull_unlocked === false && Array.isArray(catalog?.hull_blockers) && catalog.hull_blockers.length) {
            const gateDiv = new GQUI.Div().setClass('text-red small');
            gateDiv.dom.style.marginBottom = '0.45rem';
            gateDiv.dom.textContent = 'Hull locked: ' + catalog.hull_blockers.join(' | ');
            modulesRoot.appendChild(gateDiv.dom);
          }
          modulesRoot.appendChild(this.renderModuleSlotEditor(catalog));
        }
      } catch (err) {
        if (modulesRoot) {
          const errDiv = new GQUI.Div().setClass('text-red small');
          errDiv.dom.textContent = String(err?.message || 'Failed to load module options.');
          modulesRoot.replaceChildren(errDiv.dom);
        }
      }
    }

    bindActions(root, hulls = []) {
      root.querySelectorAll('.build-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const type = btn.dataset.type;
          const qty = parseInt(root.querySelector(`.ship-qty[data-type="${type}"]`).value, 10) || 1;
          btn.disabled = true;
          const res = await API.buildShip(currentColony.id, type, qty);
          if (res.success) {
            const queuePosition = Number(res.queue_position || 1);
            showToast(`Queued ${qty}x ${fmtName(type)}${queuePosition > 1 ? ` (#${queuePosition})` : ''}`, 'success');
            const resources = await API.resources(currentColony.id);
            if (resources.success) Object.assign(currentColony, resources.resources);
            updateResourceBar();
            await this.render();
          } else {
            showToast(res.error || 'Build failed', 'error');
            btn.disabled = false;
          }
        });
      });

      root.querySelectorAll('.build-blueprint-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const blueprintId = Number(btn.dataset.blueprintId || 0);
          const type = String(btn.dataset.blueprintType || '');
          const name = String(btn.dataset.blueprintName || 'Blueprint');
          const qty = parseInt(root.querySelector(`.ship-qty[data-blueprint-id="${blueprintId}"]`)?.value || '1', 10) || 1;
          btn.disabled = true;
          const res = await API.buildShip(currentColony.id, type, qty, { blueprint_id: blueprintId });
          if (res.success) {
            const queuePosition = Number(res.queue_position || 1);
            showToast(`Queued ${qty}x ${name}${queuePosition > 1 ? ` (#${queuePosition})` : ''}`, 'success');
            const resources = await API.resources(currentColony.id);
            if (resources.success) Object.assign(currentColony, resources.resources);
            updateResourceBar();
            await this.render();
          } else {
            showToast(res.error || 'Build failed', 'error');
            btn.disabled = false;
          }
        });
      });

      root.querySelector('#shipyard-blueprint-hull')?.addEventListener('change', async () => {
        await this.updateBlueprintLayoutOptions(root, hulls);
      });
      root.querySelector('#shipyard-blueprint-layout')?.addEventListener('change', async () => {
        await this.updateBlueprintLayoutOptions(root, hulls);
      });
      root.querySelector('#shipyard-create-blueprint')?.addEventListener('click', async () => {
        const hullCode = String(root.querySelector('#shipyard-blueprint-hull')?.value || '');
        const layoutCode = String(root.querySelector('#shipyard-blueprint-layout')?.value || 'default');
        const nameInput = root.querySelector('#shipyard-blueprint-name');
        const hull = hulls.find((entry) => String(entry.code || '') === hullCode);
        if (!hull) {
          showToast('No hull selected.', 'warning');
          return;
        }

        const modules = this.collectBlueprintModulesFromUI(root);
        if (!modules.length) {
          showToast('Select modules for at least one slot.', 'warning');
          return;
        }

        const defaultName = `${fmtName(hull.ship_class || hull.role || 'Hull')} ${fmtName(layoutCode === 'default' ? hull.code : layoutCode)}`;
        const payload = {
          colony_id: currentColony.id,
          name: String(nameInput?.value || '').trim() || defaultName,
          hull_code: hullCode,
          slot_layout_code: layoutCode,
          doctrine_tag: layoutCode,
          modules,
        };

        const createBtn = root.querySelector('#shipyard-create-blueprint');
        if (createBtn) createBtn.disabled = true;
        try {
          const res = await API.createBlueprint(payload);
          if (!res.success) {
            throw new Error(res.error || 'Blueprint creation failed');
          }
          showToast(`Blueprint created: ${payload.name}`, 'success');
          if (nameInput) nameInput.value = '';
          await this.render();
        } catch (err) {
          showToast(String(err?.message || 'Blueprint creation failed'), 'error');
          if (createBtn) createBtn.disabled = false;
        }
      });

      this.updateBlueprintLayoutOptions(root, hulls).catch(() => {});

      // ÔöÇÔöÇ Module slot events (delegated on modules container) ÔöÇ
      const modsContainer = root.querySelector('#shipyard-blueprint-modules');
      if (modsContainer) {
        modsContainer.addEventListener('change', (e) => {
          if (e.target.classList.contains('shipyard-module-slot')) {
            this.updateStatsPreview(root);
          }
        });
        modsContainer.addEventListener('click', (e) => {
          const upBtn = e.target.closest('.shipyard-slot-up');
          const downBtn = e.target.closest('.shipyard-slot-down');
          const btn = upBtn || downBtn;
          if (!btn || btn.disabled) return;
          const groupCode = String(btn.dataset.groupCode || '');
          const idx = Number(btn.dataset.slotIndex || 0);
          if (upBtn) this.swapSlots(root, groupCode, idx, idx - 1);
          else this.swapSlots(root, groupCode, idx, idx + 1);
        });
      }

      // ÔöÇÔöÇ Hull change: update base stats proxy element ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
      root.querySelector('#shipyard-blueprint-hull')?.addEventListener('change', () => {
        this.updateStatsPreview(root);
      });

      this.bindPresetActions(root);

      // ÔöÇÔöÇ Decommission vessel buttons ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('.vessel-decommission-btn');
        if (!btn) return;
        const vid = Number(btn.dataset.vesselId);
        if (vid > 0) this.decommissionVessel(vid, root);
      });
    }

    async render() {
      const root = WM.body('shipyard');
      if (!root) return;
      if (!currentColony) {
        gqStatusMsg(root, 'Select a colony first.', 'muted');
        return;
      }
      gqStatusMsg(root, 'Loading\u2026', 'muted');

      try {
        const [data, hullData, vesselData] = await Promise.all([
          API.ships(currentColony.id),
          API.shipyardHulls(currentColony.id),
          API.shipyardVessels(currentColony.id).catch(() => ({ vessels: [] })),
        ]);
        if (!data.success) {
          gqStatusMsg(root, 'Error.', 'red');
          return;
        }
        const hulls   = Array.isArray(hullData?.hulls)       ? hullData.hulls       : [];
        const vessels = Array.isArray(vesselData?.vessels)    ? vesselData.vessels   : [];
        this._pendingHulls = hulls;

        const frag = document.createDocumentFragment();

        frag.appendChild(this.buildBlueprintCreatorDom(hulls));

        const queueCard = new GQUI.Div().setClass('system-card');
        queueCard.dom.style.marginBottom = '1rem';
        const queueTitle = new GQUI.Div().setClass('system-row');
        const queueStrong = document.createElement('strong');
        queueStrong.textContent = 'Build Queue';
        queueTitle.dom.appendChild(queueStrong);
        queueCard.add(queueTitle);
        const queueDesc = new GQUI.Div().setClass('small text-muted');
        queueDesc.dom.style.marginTop = '0.3rem';
        queueDesc.dom.textContent = 'Ships now enter a real production queue with ETA.';
        queueCard.add(queueDesc);
        const queueBody = new GQUI.Div();
        queueBody.dom.style.marginTop = '0.7rem';
        queueBody.dom.appendChild(this.buildQueueDom(data.queue || []));
        queueCard.add(queueBody);
        frag.appendChild(queueCard.dom);

        if (vessels.length) {
          const vesselsDom = this.renderDockedVesselsDom(vessels);
          if (vesselsDom) {
            const vesselCard = new GQUI.Div().setClass('system-card');
            vesselCard.dom.id = 'shipyard-docked-vessels-card';
            vesselCard.dom.style.marginBottom = '1rem';
            const vesselTitle = new GQUI.Div().setClass('system-row');
            const vesselStrong = document.createElement('strong');
            vesselStrong.textContent = 'Docked Vessels';
            vesselTitle.dom.appendChild(vesselStrong);
            const badge = new GQUI.Span().setClass('badge');
            badge.dom.style.marginLeft = '0.5rem';
            badge.dom.textContent = String(vessels.length);
            vesselTitle.add(badge);
            vesselCard.add(vesselTitle);
            const vesselDesc = new GQUI.Div().setClass('small text-muted');
            vesselDesc.dom.style.marginTop = '0.3rem';
            vesselDesc.dom.textContent = 'Individual blueprint vessels docked at this colony.';
            vesselCard.add(vesselDesc);
            const vesselBody = new GQUI.Div();
            vesselBody.dom.style.marginTop = '0.7rem';
            vesselBody.dom.appendChild(vesselsDom);
            vesselCard.add(vesselBody);
            frag.appendChild(vesselCard.dom);
          }
        }

        const hullCard = new GQUI.Div().setClass('system-card');
        hullCard.dom.style.marginBottom = '1rem';
        const hullTitle = new GQUI.Div().setClass('system-row');
        const hullStrong = document.createElement('strong');
        hullStrong.textContent = 'Hull Catalog';
        hullTitle.dom.appendChild(hullStrong);
        hullCard.add(hullTitle);
        const hullDesc = new GQUI.Div().setClass('small text-muted');
        hullDesc.dom.style.marginTop = '0.3rem';
        hullDesc.dom.textContent = 'Ship classes and their slot-layout variations.';
        hullCard.add(hullDesc);
        const hullBody = new GQUI.Div();
        hullBody.dom.style.marginTop = '0.7rem';
        hullBody.dom.appendChild(this.buildHullCatalogDom(hulls));
        hullCard.add(hullBody);
        frag.appendChild(hullCard.dom);

        const bpCard = new GQUI.Div().setClass('system-card');
        bpCard.dom.style.marginBottom = '1rem';
        const bpTitle = new GQUI.Div().setClass('system-row');
        const bpStrong = document.createElement('strong');
        bpStrong.textContent = 'Blueprints';
        bpTitle.dom.appendChild(bpStrong);
        bpCard.add(bpTitle);
        const bpDesc = new GQUI.Div().setClass('small text-muted');
        bpDesc.dom.style.marginTop = '0.3rem';
        bpDesc.dom.textContent = 'Compiled blueprints built as synthetic ship types.';
        bpCard.add(bpDesc);
        const bpBody = new GQUI.Div();
        bpBody.dom.style.marginTop = '0.7rem';
        bpBody.dom.appendChild(this.buildBlueprintCardsDom(data.blueprints || []));
        bpCard.add(bpBody);
        frag.appendChild(bpCard.dom);

        const legacyCard = new GQUI.Div().setClass('system-card');
        const legacyTitle = new GQUI.Div().setClass('system-row');
        const legacyStrong = document.createElement('strong');
        legacyStrong.textContent = 'Legacy Ships';
        legacyTitle.dom.appendChild(legacyStrong);
        legacyCard.add(legacyTitle);
        const legacyDesc = new GQUI.Div().setClass('small text-muted');
        legacyDesc.dom.style.marginTop = '0.3rem';
        legacyDesc.dom.textContent = 'Fallback SHIP_STATS path remains available during migration.';
        legacyCard.add(legacyDesc);
        const legacyBody = new GQUI.Div();
        legacyBody.dom.style.marginTop = '0.7rem';
        legacyBody.dom.appendChild(this.buildCardsDom(data.ships || []));
        legacyCard.add(legacyBody);
        frag.appendChild(legacyCard.dom);

        root.replaceChildren(frag);
        this.bindActions(root, hulls);
      } catch (_) {
        gqStatusMsg(root, 'Failed to load shipyard.', 'red');
      }
    }

    renderDockedVesselsDom(vessels) {
      if (!vessels.length) return null;
      const list = new GQUI.Div().setClass('vessel-list');
      vessels.forEach((v) => {
        const hp    = v.hp_state?.hp    ?? v.stats?.hull ?? '?';
        const maxHp = v.hp_state?.max_hp ?? v.stats?.hull ?? '?';
        const hpPct = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 100;

        const card = new GQUI.Div().setClass('vessel-card');
        card.dom.dataset.vesselId = String(v.id);

        const header = new GQUI.Div().setClass('vessel-card-header');
        header.add(new GQUI.Span().setClass('vessel-card-name').setTextContent(String(v.bp_name || v.name || `Vessel #${v.id}`)));
        header.add(new GQUI.Span().setClass('vessel-card-class badge').setTextContent(`${fmtName(v.hull_class || 'unknown')} T${v.hull_tier ?? '?'}`));
        const statusSpan = new GQUI.Span().setClass('vessel-card-status vessel-status-' + String(v.status)).setTextContent(String(v.status));
        header.add(statusSpan);
        card.add(header);

        const hullLbl = new GQUI.Div().setClass('vessel-card-hull').setTextContent(String(v.hull_label || ''));
        card.add(hullLbl);

        const hpBarWrap = new GQUI.Div().setClass('vessel-hp-bar');
        const hpFill = new GQUI.Div().setClass('vessel-hp-fill');
        hpFill.dom.style.width = hpPct + '%';
        hpBarWrap.add(hpFill);
        card.add(hpBarWrap);

        const chipsDiv = new GQUI.Div().setClass('vessel-stat-chips');
        ['attack', 'shield', 'hull', 'cargo', 'speed'].filter((k) => v.stats?.[k] > 0).forEach((k) => {
          const chip = new GQUI.Span().setClass('vessel-stat-chip chiptype-' + k.slice(0, 3));
          chip.dom.textContent = fmtName(k) + ' ' + fmt(v.stats[k]);
          chipsDiv.add(chip);
        });
        card.add(chipsDiv);

        const actionsDiv = new GQUI.Div().setClass('vessel-card-actions');
        const decommBtn = new GQUI.Button('Decommission').setClass('btn btn-sm btn-danger vessel-decommission-btn');
        decommBtn.dom.type = 'button';
        decommBtn.dom.dataset.vesselId = String(v.id);
        decommBtn.dom.title = 'Permanently decommission this vessel';
        actionsDiv.add(decommBtn);
        card.add(actionsDiv);

        list.add(card);
      });
      return list.dom;
    }

    async decommissionVessel(vesselId, root) {
      if (!confirm('Permanently decommission this vessel? This cannot be undone.')) return;
      try {
        const res = await API.decommissionVessel(vesselId);
        if (res.success) {
          const card = root?.querySelector(`.vessel-card[data-vessel-id="${vesselId}"]`);
          card?.remove();
          const listEl = root?.querySelector('.vessel-list');
          if (listEl && !listEl.querySelector('.vessel-card')) {
            root?.querySelector('#shipyard-docked-vessels-card')?.remove();
          }
        } else {
          alert(res.error || 'Decommission failed.');
        }
      } catch (_) {
        alert('Network error.');
      }
    }
  }

  const shipyardController = new ShipyardController();
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
    if (!root) return false;
    const el = root.querySelector(selector);
    if (!el) return false;
    const nextVisible = typeof forceVisible === 'boolean'
      ? forceVisible
      : el.classList.contains('hidden');
    el.classList.toggle('hidden', !nextVisible);
    return nextVisible;
  }

  function makeGalaxyOverlayDraggable(root, selector) {
    const overlay = root?.querySelector(selector);
    const head = overlay?.querySelector('.galaxy-overlay-head');
    const stage = root?.querySelector('.galaxy-3d-stage');
    if (!overlay || !head || !stage || overlay.dataset.dragBound === '1') return;
    overlay.dataset.dragBound = '1';

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const getStageRect = () => stage.getBoundingClientRect();
    const startDrag = (clientX, clientY) => {
      const rect = overlay.getBoundingClientRect();
      dragging = true;
      offsetX = clientX - rect.left;
      offsetY = clientY - rect.top;
    };

    const doDrag = (clientX, clientY) => {
      if (!dragging) return;
      const stageRect = getStageRect();
      const maxLeft = Math.max(0, stage.clientWidth - overlay.offsetWidth);
      const maxTop = Math.max(0, stage.clientHeight - overlay.offsetHeight);
      const left = Math.max(0, Math.min(clientX - stageRect.left - offsetX, maxLeft));
      const top = Math.max(0, Math.min(clientY - stageRect.top - offsetY, maxTop));
      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.right = 'auto';
      overlay.style.bottom = 'auto';
    };

    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      startDrag(e.clientX, e.clientY);
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => doDrag(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => { dragging = false; });

    head.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      const t = e.touches[0];
      startDrag(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (!t) return;
      doDrag(t.clientX, t.clientY);
    }, { passive: true });
    window.addEventListener('touchend', () => { dragging = false; });
  }

  function bindGalaxyOverlayHotkeys() {
    if (galaxyOverlayHotkeysBound) return;
    galaxyOverlayHotkeysBound = true;
    window.addEventListener('keydown', (e) => {
      const tag = String(e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (!WM.isOpen('galaxy')) return;

      const root = WM.body('galaxy');
      if (!root) return;

      const k = String(e.key || '').toLowerCase();
      if (k === 'o') {
        e.preventDefault();
        const opened = toggleGalaxyOverlay(root, '#galaxy-controls-overlay');
        if (opened) showToast('Galaxy controls overlay opened (O to toggle).', 'info');
      } else if (k === 'i') {
        e.preventDefault();
        const opened = toggleGalaxyOverlay(root, '#galaxy-info-overlay');
        if (opened) showToast('Galaxy info overlay opened (I to toggle).', 'info');
      } else if (k === 'escape') {
        toggleGalaxyOverlay(root, '#galaxy-controls-overlay', false);
        toggleGalaxyOverlay(root, '#galaxy-info-overlay', false);
        const card = document.getElementById('galaxy-hover-card');
        if (card) card.classList.add('hidden');
      } else if (k === 'l') {
        e.preventDefault();
        const enabled = galaxy3d && typeof galaxy3d.toggleFollowSelection === 'function'
          ? galaxy3d.toggleFollowSelection()
          : false;
        updateGalaxyFollowUi(root);
        showToast(`Selection follow ${enabled ? 'enabled' : 'disabled'} (L to toggle).`, 'info');
      } else if (k === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        settingsState.galaxyFleetVectorsVisible = !(settingsState.galaxyFleetVectorsVisible !== false);
        applyRuntimeSettings();
        if (galaxyController && typeof galaxyController.updateFleetVectorsUi === 'function') {
          galaxyController.updateFleetVectorsUi(root);
        }
        if (root?.querySelector('#galaxy-system-details')) {
          renderGalaxySystemDetails(root, pinnedStar || uiState.activeStar || null, !!galaxy3d?.systemMode);
        }
        saveUiSettings();
        showToast(`Fleet-Vektoren: ${settingsState.galaxyFleetVectorsVisible ? 'an' : 'aus'} (V zum Umschalten).`, 'info');
      }
    });
  }

  function triggerGalaxyNavAction(action, rootRef = null) {
    galaxyController.triggerNavAction(action, rootRef);
  }

  function bindGalaxyNavOrb(root) {
    const overlay = root?.querySelector('#galaxy-nav-orb-overlay');
    if (!overlay || overlay.dataset.bound === '1') return;
    overlay.dataset.bound = '1';

    const bindRepeat = (button) => {
      const action = String(button.dataset.navAction || '');
      if (!action) return;
      let intervalTimer = null;
      let delayTimer = null;
      let held = false;
      const clearTimers = () => {
        if (delayTimer) {
          window.clearTimeout(delayTimer);
          delayTimer = null;
        }
        if (intervalTimer) {
          window.clearInterval(intervalTimer);
          intervalTimer = null;
        }
      };
      const fire = () => triggerGalaxyNavAction(action, root);
      const startHold = () => {
        held = true;
        fire();
        clearTimers();
        delayTimer = window.setTimeout(() => {
          intervalTimer = window.setInterval(fire, 96);
        }, 190);
      };
      const stopHold = () => {
        clearTimers();
        window.setTimeout(() => { held = false; }, 0);
      };
      button.addEventListener('click', (e) => {
        e.preventDefault();
        if (held) return;
        fire();
      });
      button.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        startHold();
      });
      button.addEventListener('mouseup', stopHold);
      button.addEventListener('mouseleave', stopHold);
      button.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startHold();
      }, { passive: false });
      button.addEventListener('touchend', stopHold);
      button.addEventListener('touchcancel', stopHold);
      window.addEventListener('mouseup', stopHold);
      window.addEventListener('touchend', stopHold);
      window.addEventListener('touchcancel', stopHold);
    };

    overlay.querySelectorAll('[data-nav-action]').forEach(bindRepeat);
  }

  function renderGalaxyWindow() {
    galaxyController.renderWindow();
  }

  function refreshGalaxyDensityMetrics(root) {
    galaxyController.refreshDensityMetrics(root);
  }

  function updateClusterBoundsUi(root) {
    galaxyController.updateClusterBoundsUi(root);
  }

  function updateGalaxyColonyFilterUi(root) {
    const btn = root?.querySelector?.('#gal-colonies-only-btn');
    if (!btn) return;
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
    } catch (_) {
      webglSupport = 'error';
    }
    return {
      rendererGlobal: typeof window.Galaxy3DRenderer,
      threeGlobal: typeof window.THREE,
      threeRevision: String(window.THREE?.REVISION || 'n/a'),
      hasCanvas: !!document.getElementById('galaxy-3d-host'),
      webglSupport,
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
          Canvas: ${diag.hasCanvas ? 'yes' : 'no'} ┬À WebGL: ${esc(diag.webglSupport)} ┬À Last reason: ${esc(diag.reason)} ┬À ${esc(diag.time)}
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
      let label = 'Au├ƒenposten';
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
      { action: 'home', label: '­ƒÅá', title: 'Jump to home system' },
      { action: 'zoom-in', label: '+', title: 'Zoom in' },
      { action: 'zoom-out', label: 'ÔêÆ', title: 'Zoom out' },
      { action: 'rotate-left', label: 'ÔùÇ', title: 'Rotate left' },
      { action: 'rotate-right', label: 'ÔûÂ', title: 'Rotate right' },
      { action: 'rotate-up', label: 'Ôû▓', title: 'Rotate up' },
      { action: 'rotate-down', label: 'Ôû╝', title: 'Rotate down' },
      { action: 'focus', label: 'ÔùÄ', title: 'Focus selection' },
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
      const factionName = star?.faction?.name ? ` ┬À ${esc(star.faction.name)}` : '';
      details.innerHTML = `
        <div class="system-card">
          <div class="system-title">${esc(star.label || `Cluster ${Number(star.__clusterIndex || 0) + 1}`)}</div>
          ${navButtons}
          <div class="system-row">Clusterbereich: ${esc(String(from || '?'))} - ${esc(String(to || '?'))}${factionName}</div>
          <div class="system-row">Bounding Box: ${Number(star.__clusterSize?.x || 0).toFixed(1)} ├ù ${Number(star.__clusterSize?.y || 0).toFixed(1)} ├ù ${Number(star.__clusterSize?.z || 0).toFixed(1)}</div>
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
      ? `<div class="system-row system-row-colony"><span class="system-colony-swatch" style="background:${esc(colonyMeta.color)};box-shadow:0 0 10px ${esc(colonyMeta.color)};"></span>${esc(colonyMeta.label)} ┬À ${esc(String(colonyMeta.count))} Kolonien ┬À Bev├Âlkerung ${esc(colonyMeta.populationFull)}${colonyMeta.ownerName ? ` ┬À ${esc(colonyMeta.isPlayer ? 'Dominanz: Du' : `Dominanz: ${colonyMeta.ownerName}`)}` : ''}</div>`
      : '<div class="system-row text-muted">Keine bekannten Kolonien in diesem System.</div>';

    // FoW visibility indicator
    const fowLevel = isCurrentUserAdmin() ? 'own' : (star.visibility_level || 'unknown');
    const fowLabels = { own: '­ƒÅá Eigene Kolonie', active: '­ƒø© Flotte aktiv', stale: 'ÔÅ│ Veraltete Aufkl├ñrung', unknown: '­ƒîæ Unerforscht' };
    const fowHtml = `<div class="system-row ${fowLevel === 'unknown' ? 'fow-unknown-badge' : ''}" style="${fowLevel === 'stale' ? 'color:#e8c843' : ''}">${esc(fowLabels[fowLevel] || fowLevel)}</div>`;

    details.innerHTML = `
      <div class="system-card">
        <div class="system-title">${esc(star.name)}</div>
        ${navButtons}
        <div class="system-row">Catalog: ${esc(star.catalog_name || 'ÔÇö')}</div>
        <div class="system-row">Galaxy/System: ${star.galaxy_index}:${star.system_index}</div>
        <div class="system-row">Class: ${esc(star.spectral_class)}${esc(String(star.subtype ?? ''))}</div>
        <div class="system-row">Coordinates: ${Number(star.x_ly || 0).toFixed(0)}, ${Number(star.y_ly || 0).toFixed(0)}, ${Number(star.z_ly || 0).toFixed(0)} ly</div>
        <div class="system-row">Habitable Zone: ${Number(star.hz_inner_au || 0).toFixed(2)} - ${Number(star.hz_outer_au || 0).toFixed(2)} AU</div>
        <div class="system-row">Planets: ${planetCountHtml}</div>
        ${colonyHtml}
        ${fowHtml}
        <div class="system-row">Selection Follow: ${followEnabled ? 'locked' : 'free'} (L)</div>
        <div class="system-row">${zoomed ? 'System view active. Esc/F/R returns to galaxy overview.' : 'Double click to zoom into the system and show planets.'}</div>
        ${fleetLegendHtml}
        <div class="system-row" style="margin-top:0.4rem">
          <button id="gal-quicknav-fav-btn" type="button" class="btn btn-secondary btn-sm${isFav ? ' active' : ''}">${isFav ? 'Ôÿà Favorit entfernen' : 'Ôÿå Favorit hinzuf├╝gen'}</button>
        </div>
      </div>`;
    details.querySelectorAll('[data-nav-action]').forEach((button) => {
      button.addEventListener('click', () => triggerGalaxyNavAction(button.getAttribute('data-nav-action'), root));
    });
    details.querySelector('#gal-quicknav-fav-btn')?.addEventListener('click', () => {
      const btn = details.querySelector('#gal-quicknav-fav-btn');
      if (isFavoriteStar(star)) {
        removeFavorite(`${Number(star.galaxy_index)}:${Number(star.system_index)}`);
        if (btn) { btn.textContent = 'Ôÿå Favorit hinzuf├╝gen'; btn.classList.remove('active'); }
        showToast(`${star.name} aus Favoriten entfernt.`, 'info');
      } else {
        addFavorite(star);
        if (btn) { btn.textContent = 'Ôÿà Favorit entfernen'; btn.classList.add('active'); }
        showToast(`${star.name} als Favorit gespeichert.`, 'success');
      }
      updateFooterQuickNavBadge();
      WM.refresh('quicknav');
    });
  }

  // ÔöÇÔöÇ QuickNav / Favoriten ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const QUICKNAV_KEY = 'gq_quicknav';
  const QUICKNAV_RIBBONS = [
    { id: '', label: 'Keine' },
    { id: 'home',   label: '­ƒÅá Home'   },
    { id: 'colony', label: '­ƒîì Kolonie' },
    { id: 'combat', label: 'ÔÜö Kampf'   },
    { id: 'watch',  label: '­ƒæü Beobachten' },
  ];

  function loadQuickNavData() {
    try { return JSON.parse(localStorage.getItem(QUICKNAV_KEY) || '{}'); } catch (_) { return {}; }
  }
  function saveQuickNavData(data) {
    try { localStorage.setItem(QUICKNAV_KEY, JSON.stringify(data)); } catch (_) {}
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
        <input id="qn-search" class="quicknav-search" type="search" placeholder="Name oder Koordinate suchenÔÇª" value="${esc(prevSearch)}" autocomplete="off" />
        <select id="qn-sort" class="quicknav-sort" title="Sortierung">
          <option value="recent"   ${prevSort === 'recent'   ? 'selected' : ''}>Ôåô Hinzugef├╝gt</option>
          <option value="name"     ${prevSort === 'name'     ? 'selected' : ''}>AÔÇôZ Name</option>
          <option value="name-z"   ${prevSort === 'name-z'   ? 'selected' : ''}>ZÔÇôA Name</option>
          <option value="system"   ${prevSort === 'system'   ? 'selected' : ''}>System-Nr.</option>
          <option value="ribbon"   ${prevSort === 'ribbon'   ? 'selected' : ''}>Ribbon</option>
        </select>
        <div class="quicknav-ribbon-filter">
          <button class="quicknav-ribbon-pill${prevRibbon === 'all' ? ' active' : ''}" data-ribbon="all">Alle</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'home' ? ' active' : ''}" data-ribbon="home">­ƒÅá</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'colony' ? ' active' : ''}" data-ribbon="colony">­ƒîì</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'combat' ? ' active' : ''}" data-ribbon="combat">ÔÜö</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'watch' ? ' active' : ''}" data-ribbon="watch">­ƒæü</button>
          <button class="quicknav-ribbon-pill${prevRibbon === '' ? ' active' : ''}" data-ribbon="">Ôùî</button>
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
          Keine Favoriten${ribbon !== 'all' || search ? ' f├╝r diese Auswahl' : ''}.<br/>
          <span style="font-size:0.77rem">Stern im Galaxy-Detail-Panel mit <strong>Ôÿå Favorit</strong> markieren.</span>
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
            <button class="quicknav-item-btn go" data-fav-key="${esc(fav.key)}" title="Ansteuern">ÔåÆ</button>
            <button class="quicknav-item-btn remove" data-fav-key="${esc(fav.key)}" title="Aus Favoriten entfernen">Ô£ò</button>
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
        navigateToFav(goBtn.dataset.favKey).catch(() => {});
        return;
      }
      if (removeBtn) {
        removeFavorite(removeBtn.dataset.favKey);
        updateFooterQuickNavBadge();
        renderList();
        const galaxyRoot = WM.body('galaxy');
        if (galaxyRoot && pinnedStar) renderGalaxySystemDetails(galaxyRoot, pinnedStar, !!galaxy3d?.systemMode);
        return;
      }
      if (itemRow && !e.target.closest('select') && !e.target.closest('button')) {
        navigateToFav(itemRow.dataset.favKey).catch(() => {});
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
    return {
      userId: Math.max(0, Number(settingsState.galaxyOwnerFocusUserId || 0)),
      name: String(settingsState.galaxyOwnerFocusName || '').trim(),
    };
  }

  function getDisplayedGalaxyStars(stars) {
    const rows = Array.isArray(stars) ? stars : [];
    const mode = getGalaxyColonyFilterMode();
    return rows.filter((star) => {
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
    galaxy3d.setEmpireHeartbeatSystems(getGalaxyOwnerFocusHighlightedSystems(stars));
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
      saveUiSettings();
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
        saveUiSettings();
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
        saveUiSettings();
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
          renderGalaxySystemDetails(root, target, !!galaxy3d?.systemMode);
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
        galaxyDB.upsertStars(normalizeStarListVisibility(data.stars), responseTs).catch(() => {});
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

  async function loadStarSystemPlanets(root, star) {
    const panel = root.querySelector('#galaxy-planets-panel');
    if (!panel || !star) return;

    panel.innerHTML = '<p class="text-muted">Loading planets...</p>';

    const g = Number(star.galaxy_index || 1);
    const s = Number(star.system_index || 1);

    const buildSafeSystemPayload = (rawPayload) => {
      const input = (rawPayload && typeof rawPayload === 'object') ? rawPayload : {};
      const safeStar = (input.star_system && typeof input.star_system === 'object')
        ? input.star_system
        : {};
      const safePlanets = Array.isArray(input.planets) ? input.planets : [];
      const safeFleets = Array.isArray(input.fleets_in_system) ? input.fleets_in_system : [];
      const safeManifest = (input.planet_texture_manifest && typeof input.planet_texture_manifest === 'object')
        ? input.planet_texture_manifest
        : { version: 1, planets: {} };

      if (!safeManifest.planets || typeof safeManifest.planets !== 'object') {
        safeManifest.planets = {};
      }

      return {
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
        fleets_in_system: safeFleets,
        planet_texture_manifest: safeManifest,
      };
    };

    setGalaxyContext(g, s, star);
    const systemPolicy = LEVEL_POLICIES.system.payload;

    let loadResult = null;
    try {
      loadResult = await ensureSystemPayloadLazy(g, s, {
        allowStaleFirst: systemPolicy.allowStaleFirst,
        maxAgeMs: systemPolicy.cacheMaxAgeMs,
        onStaleData: (payload) => {
          renderPlanetPanel(panel, star, payload);
          if (galaxy3d && typeof galaxy3d.enterSystemView === 'function') {
            galaxy3d.enterSystemView(star, payload);
          }
        },
      });
    } catch (err) {
      console.error('[GQ] loadStarSystemPlanets: unexpected error during payload fetch', err);
      pushGalaxyDebugError('system-payload', String(err?.message || err || 'unknown error'), `${g}:${s}`);
      loadResult = null;
    }

    if (!loadResult || !loadResult.payload) {
      const fallbackPayload = buildSafeSystemPayload(null);
      try {
        if (galaxy3d && typeof galaxy3d.enterSystemView === 'function') {
          galaxy3d.enterSystemView(star, fallbackPayload);
        }
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
    renderPlanetPanel(panel, star, safePayload);
    try {
      if (galaxy3d && typeof galaxy3d.enterSystemView === 'function') {
        galaxy3d.enterSystemView(star, safePayload);
      }
    } catch (e3d) {
      console.error('[GQ] enterSystemView failed:', e3d);
      pushGalaxyDebugError('system-render', String(e3d?.message || e3d || 'unknown error'), `${g}:${s}`);
      let fallbackOk = false;
      try {
        if (galaxy3d && typeof galaxy3d.enterSystemView === 'function') {
          galaxy3d.enterSystemView(star, buildSafeSystemPayload(null));
          fallbackOk = true;
        }
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
      return { source: 'model', payload: normalizeSystemPayloadVisibility(systemNode.payload), fresh: true };
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
        galaxyDB.upsertSystemPayload(g, s, normalizedData, responseTs).catch(() => {});
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
        if (isOwnedColony && btn.dataset.colonyAction === 'open') {
          focusColonyDevelopment(colonyId, { source: 'detail-action' });
        } else if (isOwnedColony) {
          selectColonyById(colonyId, { openWindows: false });
        }
        if (btn.dataset.colonyAction === 'colony') WM.open('colony');
        if (btn.dataset.colonyAction === 'overview') WM.open('overview');
        if (btn.dataset.colonyAction === 'buildings') WM.open('buildings');
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
          <div class="planet-detail-actions">
            <button class="btn btn-secondary btn-sm" data-colony-action="overview">Overview</button>
            <button class="btn btn-secondary btn-sm" data-colony-action="colony">Colony</button>
            <button class="btn btn-secondary btn-sm" data-colony-action="buildings">Buildings</button>
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
          extra.innerHTML = `
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
        } catch (_) {
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
    if (zoomPlanet && galaxy3d && typeof galaxy3d.focusOnSystemPlanet === 'function') {
      galaxy3d.focusOnSystemPlanet(planetLike, true);
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
    const staleBanner = visLevel === 'stale'
      ? `<div class="fow-stale-banner">Veraltete Aufkl├ñrung${scoutedAt ? ` ┬À Stand: ${esc(scoutedAt)}` : ''} ┬À Daten k├Ânnen veraltet sein.</div>`
      : '';
    const unknownBadge = (visLevel === 'unknown' && staleBanner === '')
      ? `<div class="fow-unknown-badge">Dieses System wurde noch nicht erkundet.</div>`
      : '';
    panel.innerHTML = `
      <h4>${esc(star.name)} Planets</h4>
      ${staleBanner}${unknownBadge}
      <div class="planet-list-3d">
        ${(data.planets || []).map(slot => {
          const pp = slot.player_planet;
          const gp = slot.generated_planet;
          if (pp) {
            const staleClass = pp._stale ? ' stale' : '';
            const isOwnedColony = colonies.some((col) => Number(col.id || 0) === Number(pp.colony_id || 0));
            return `<div class="planet-item ${isOwnedColony ? 'own' : 'foreign'}${staleClass}" data-pos="${slot.position}">
              <span>#${slot.position}</span>
              <strong>${esc(pp.colony_name || pp.name || '?')}</strong>
              <span>${esc(pp.owner || '?')} ┬À ${esc(isOwnedColony ? 'dein' : 'fremd')}</span>
            </div>`;
          }
          if (gp) {
            return `<div class="planet-item" data-pos="${slot.position}">
              <span>#${slot.position}</span>
              <strong>${esc(gp.name || fmtName(gp.planet_class))}</strong>
              <span>${esc(gp.planet_class)}</span>
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
          const slot = (data.planets || []).find((p) => Number(p.position || 0) === pos);
          if (!slot) return;
          setActivePlanetListItem(panel, pos);
          const detail = ensurePlanetDetailPanel(panel);
          renderPlanetDetailCard(detail, slot);
        });
      });
    }
  }

  class MessagesController {
    constructor() {
      this.templates = {
        shell: '{{{composeToggle}}}{{{composeForm}}}{{{terminalPanel}}}{{{messagesList}}}',
        composeToggle: '<div style="margin-bottom:0.75rem"><button class="btn btn-secondary btn-sm" id="compose-toggle-btn">Ô£ë Compose</button></div>',
        composeForm: `
        <div id="compose-form-wm" class="hidden" style="margin-bottom:1rem">
          <div class="form-group">
            <label>To (username)</label>
            <input id="msg-to-wm" type="text" placeholder="recipient" />
          </div>
          <div class="form-group">
            <label>Subject</label>
            <input id="msg-subject-wm" type="text" placeholder="Subject" />
          </div>
          <div class="form-group">
            <label>Message</label>
            <textarea id="msg-body-wm" rows="3" placeholder="Your messageÔÇª"></textarea>
          </div>
          <button class="btn btn-primary btn-sm" id="msg-send-btn-wm">Send</button>
          <div id="msg-send-result-wm" class="form-info" aria-live="polite"></div>
        </div>`,
        terminalPanel: `
        <div class="msg-terminal" style="margin-bottom:0.9rem;border:1px solid rgba(150,180,230,0.25);border-radius:10px;padding:0.55rem;background:rgba(7,14,28,0.55)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem">
            <strong style="font-size:0.82rem;color:#b8cff3">Terminal Console</strong>
            <span style="font-size:0.72rem;color:var(--text-muted)">Direktbefehle f├╝r Messages</span>
          </div>
          <div id="msg-terminal-log" style="height:140px;overflow:auto;background:rgba(5,10,18,0.82);border-radius:8px;padding:0.45rem;font-family:Consolas, 'Courier New', monospace;font-size:0.74rem;line-height:1.35;color:#d7e4ff"></div>
          <div style="display:flex;gap:0.45rem;margin-top:0.45rem">
            <input id="msg-terminal-input" type="text" list="msg-terminal-users" placeholder="help | msg <user> <text> | inbox | read <id> | delete <id> | clear" style="flex:1" />
            <datalist id="msg-terminal-users"></datalist>
            <button class="btn btn-secondary btn-sm" id="msg-terminal-run">Run</button>
          </div>
        </div>`,
        messagesList: `<div id="messages-list-wm">${uiKitTemplateHTML('tpl-ui-skeleton-list') || '<p class="text-muted">LoadingÔÇª</p>'}</div>`,
        consoleLine: '<div>{{{line}}}</div>',
        userHintOption: '<option value="{{{value}}}"></option>',
        detail: `
        <div class="msg-detail-header">
          <div>
            <strong>{{{subject}}}</strong>
            <div class="msg-detail-meta">From: {{{sender}}} &nbsp;ÔÇó&nbsp; {{{sentAt}}}</div>
          </div>
          <button class="btn btn-secondary btn-sm close-msg-btn">Ô£ò Close</button>
        </div>
        <hr class="separator" />
        <div class="msg-detail-body">{{{body}}}</div>`,
        row: `
          <div class="msg-row {{{unreadClass}}}" data-mid="{{{id}}}">
            {{{unreadDot}}}
            <span class="msg-subject">{{{subject}}}</span>
            <span class="msg-sender">From: {{{sender}}}</span>
            <span class="msg-date">{{{date}}}</span>
            <button class="btn btn-danger btn-sm del-msg-btn" data-mid="{{{id}}}">­ƒùæ</button>
          </div>`,
      };
    }

    renderTemplate(templateName, data = {}) {
      return renderInlineTemplate(this.templates[templateName], data);
    }

    renderTemplateList(templateName, rows) {
      return renderInlineTemplateList(this.templates[templateName], rows);
    }

    consolePush(line) {
      const text = String(line || '').trim();
      if (!text) return;
      messageConsoleState.lines.push(text);
      if (messageConsoleState.lines.length > messageConsoleState.maxLines) {
        messageConsoleState.lines.splice(0, messageConsoleState.lines.length - messageConsoleState.maxLines);
      }
    }

    renderConsoleLog(root) {
      const log = root?.querySelector('#msg-terminal-log');
      if (!log) return;
      log.innerHTML = this.renderTemplateList('consoleLine', messageConsoleState.lines.map((line) => ({ line: esc(line) })));
      log.scrollTop = log.scrollHeight;
    }

    extractUserPrefix(raw) {
      const txt = String(raw || '').trimStart();
      const normalized = txt.startsWith('/') ? txt.slice(1) : txt;
      const match = normalized.match(/^(msg|dm)\s+([^\s]*)$/i);
      return match ? String(match[2] || '') : '';
    }

    autocompleteCommand(raw, hints) {
      const text = String(raw || '');
      const leadSlash = text.startsWith('/');
      const normalized = leadSlash ? text.slice(1) : text;
      const match = normalized.match(/^(msg|dm)\s+([^\s]*)(\s*)$/i);
      if (!match) return null;
      const cmd = match[1];
      const prefix = String(match[2] || '');
      if (!prefix) return null;
      const list = Array.isArray(hints) ? hints : [];
      const hit = list.find((u) => String(u).toLowerCase().startsWith(prefix.toLowerCase()));
      if (!hit) return null;
      return `${leadSlash ? '/' : ''}${cmd} ${hit} `;
    }

    async refreshUserHints(root, prefix = '') {
      const datalist = root?.querySelector('#msg-terminal-users');
      if (!datalist) return;
      try {
        const response = await API.messageUsers(prefix || '');
        const users = response?.success && Array.isArray(response.users)
          ? Array.from(new Set(response.users.map((u) => String(u || '').trim()).filter(Boolean))).slice(0, 12)
          : [];
        messageConsoleState.userHints = users;
        datalist.innerHTML = this.renderTemplateList('userHintOption', users.map((u) => ({ value: esc(u) })));
      } catch (_) {
        messageConsoleState.userHints = [];
        datalist.innerHTML = '';
      }
    }

    showMessageDetail(root, message) {
      const listEl = root.querySelector('#messages-list-wm');
      if (!listEl) return;
      let detail = root.querySelector('.msg-detail');
      if (!detail) {
        detail = document.createElement('div');
        detail.className = 'msg-detail';
        listEl.before(detail);
      }
      detail.innerHTML = this.renderTemplate('detail', {
        subject: esc(message.subject),
        sender: esc(message.sender),
        sentAt: esc(new Date(message.sent_at).toLocaleString()),
        body: esc(message.body),
      });
      detail.querySelector('.close-msg-btn')?.addEventListener('click', () => detail.remove());
    }

    async loadMessagesList(root) {
      const el = root.querySelector('#messages-list-wm');
      if (!el) return;
      el.innerHTML = uiKitTemplateHTML('tpl-ui-skeleton-list') || '<p class="text-muted">LoadingÔÇª</p>';
      try {
        const data = await API.inbox();
        if (!data.success) {
          el.innerHTML = '<p class="text-red">Error.</p>';
          return;
        }
        if (!data.messages.length) {
          el.innerHTML = uiKitEmptyStateHTML('Inbox empty', 'New diplomatic and tactical messages will appear here.');
          return;
        }

        el.innerHTML = this.renderTemplateList('row', data.messages.map((message) => ({
          id: Number(message.id || 0),
          unreadClass: message.is_read ? '' : 'unread',
          unreadDot: message.is_read ? '' : '<div class="msg-unread-dot"></div>',
          subject: esc(message.subject),
          sender: esc(message.sender),
          date: esc(new Date(message.sent_at).toLocaleDateString()),
        })));

        el.querySelectorAll('.msg-row').forEach((row) => {
          row.addEventListener('click', async (e) => {
            if (e.target.classList.contains('del-msg-btn')) return;
            const mid = parseInt(row.dataset.mid, 10);
            const detail = await API.readMsg(mid);
            if (!detail.success) return;
            const message = detail.message;
            this.showMessageDetail(root, message);
            if (audioManager && typeof audioManager.playMessageRead === 'function') audioManager.playMessageRead();
            this.consolePush(`[read] #${mid} from ${message.sender || 'Unknown'}: ${message.subject || '(no subject)'}`);
            this.renderConsoleLog(root);
            row.classList.remove('unread');
            await this.loadBadge();
          });
        });

        el.querySelectorAll('.del-msg-btn').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const response = await API.deleteMsg(parseInt(btn.dataset.mid, 10));
            if (response.success) {
              if (audioManager && typeof audioManager.playMessageDelete === 'function') audioManager.playMessageDelete();
              this.consolePush(`[ok] Deleted message #${btn.dataset.mid}.`);
              this.renderConsoleLog(root);
              await this.loadMessagesList(root);
              await this.loadBadge();
            }
          });
        });
      } catch (_) {
        el.innerHTML = '<p class="text-red">Failed to load messages.</p>';
      }
    }

    async runConsoleCommand(root, rawCommand) {
      const raw = String(rawCommand || '').trim();
      if (!raw) return;
      this.consolePush(`> ${raw}`);
      this.renderConsoleLog(root);

      const normalized = raw.startsWith('/') ? raw.slice(1).trim() : raw;
      const parts = normalized.split(/\s+/).filter(Boolean);
      const cmd = String(parts[0] || '').toLowerCase();

      if (!cmd) {
        this.consolePush('[system] Empty command.');
        this.renderConsoleLog(root);
        return;
      }

      if (cmd === 'help' || cmd === '?') {
        this.consolePush('[help] msg <user> <text>  -> sends direct message (subject auto).');
        this.consolePush('[help] msg <user> <subject> | <body>  -> custom subject/body.');
        this.consolePush('[help] inbox  -> reload inbox list.');
        this.consolePush('[help] read <id>  -> open message detail.');
        this.consolePush('[help] delete <id>  -> delete message.');
        this.consolePush('[help] clear  -> clear console output.');
        this.renderConsoleLog(root);
        return;
      }

      if (cmd === 'clear') {
        messageConsoleState.lines = ['[system] Console cleared.'];
        this.renderConsoleLog(root);
        return;
      }

      if (cmd === 'inbox') {
        await this.loadMessagesList(root);
        this.consolePush('[ok] Inbox refreshed.');
        this.renderConsoleLog(root);
        return;
      }

      if (cmd === 'read') {
        const id = Number(parts[1] || 0);
        if (!Number.isFinite(id) || id <= 0) {
          this.consolePush('[error] Usage: read <id>');
          this.renderConsoleLog(root);
          return;
        }
        const detail = await API.readMsg(id);
        if (!detail.success || !detail.message) {
          this.consolePush(`[error] ${detail.error || 'Message not found.'}`);
          this.renderConsoleLog(root);
          return;
        }
        this.showMessageDetail(root, detail.message);
        if (audioManager && typeof audioManager.playMessageRead === 'function') audioManager.playMessageRead();
        this.consolePush(`[ok] Opened message #${id} from ${detail.message.sender || 'Unknown'}.`);
        await this.loadMessagesList(root);
        await this.loadBadge();
        this.renderConsoleLog(root);
        return;
      }

      if (cmd === 'delete') {
        const id = Number(parts[1] || 0);
        if (!Number.isFinite(id) || id <= 0) {
          this.consolePush('[error] Usage: delete <id>');
          this.renderConsoleLog(root);
          return;
        }
        const response = await API.deleteMsg(id);
        if (!response.success) {
          this.consolePush(`[error] ${response.error || 'Delete failed.'}`);
          this.renderConsoleLog(root);
          return;
        }
        await this.loadMessagesList(root);
        if (audioManager && typeof audioManager.playMessageDelete === 'function') audioManager.playMessageDelete();
        this.consolePush(`[ok] Deleted message #${id}.`);
        await this.loadBadge();
        this.renderConsoleLog(root);
        return;
      }

      if (cmd === 'msg' || cmd === 'dm') {
        if (parts.length < 3) {
          this.consolePush('[error] Usage: msg <user> <text>');
          this.renderConsoleLog(root);
          return;
        }
        const to = parts[1];
        const payload = normalized.split(/\s+/).slice(2).join(' ').trim();
        if (!payload) {
          this.consolePush('[error] Message text missing.');
          this.renderConsoleLog(root);
          return;
        }
        let subject = 'Direct Message';
        let body = payload;
        if (payload.includes('|')) {
          const payloadParts = payload.split('|');
          subject = String(payloadParts.shift() || '').trim() || 'Direct Message';
          body = payloadParts.join('|').trim();
        }
        if (!body) {
          this.consolePush('[error] Message body missing after subject separator.');
          this.renderConsoleLog(root);
          return;
        }

        const response = await API.sendMsg(to, subject, body);
        if (!response.success) {
          this.consolePush(`[error] ${response.error || 'Send failed.'}`);
          this.renderConsoleLog(root);
          return;
        }
        if (audioManager && typeof audioManager.playMessageSend === 'function') audioManager.playMessageSend();
        this.consolePush(`[ok] Sent message to ${to} (subject: ${subject}).`);
        showToast(`Message sent to ${to}.`, 'success');
        this.renderConsoleLog(root);
        return;
      }

      this.consolePush(`[error] Unknown command: ${cmd}. Type "help".`);
      this.renderConsoleLog(root);
    }

    async loadBadge() {
      try {
        const data = await API.inbox();
        if (!data.success) return;
        const list = Array.isArray(data.messages) ? data.messages : [];
        const unread = list.filter((message) => !parseInt(message.is_read, 10)).length;
        const badge = document.getElementById('msg-badge');
        if (unread > 0) {
          badge.textContent = unread;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
        updateMessageSignalsFromInbox(list);
      } catch (_) {}
    }

    bindComposeControls(root) {
      root.querySelector('#compose-toggle-btn')?.addEventListener('click', () => {
        root.querySelector('#compose-form-wm')?.classList.toggle('hidden');
      });

      root.querySelector('#msg-send-btn-wm')?.addEventListener('click', async () => {
        const res = root.querySelector('#msg-send-result-wm');
        const to = root.querySelector('#msg-to-wm')?.value.trim();
        const subject = root.querySelector('#msg-subject-wm')?.value.trim();
        const body = root.querySelector('#msg-body-wm')?.value.trim();
        if (!to || !subject || !body) {
          res.className = 'form-error';
          res.textContent = 'Fill in all fields.';
          return;
        }
        const response = await API.sendMsg(to, subject, body);
        if (response.success) {
          if (audioManager && typeof audioManager.playMessageSend === 'function') audioManager.playMessageSend();
          res.className = 'form-info';
          res.textContent = 'Message sent!';
          root.querySelector('#msg-to-wm').value = '';
          root.querySelector('#msg-subject-wm').value = '';
          root.querySelector('#msg-body-wm').value = '';
          showToast('Message sent!', 'success');
        } else {
          res.className = 'form-error';
          res.textContent = response.error || 'Failed.';
        }
      });
    }

    bindTerminalControls(root) {
      const runTerminalCommand = async () => {
        const input = root.querySelector('#msg-terminal-input');
        if (!input) return;
        const command = String(input.value || '').trim();
        if (!command) return;
        input.value = '';
        await this.runConsoleCommand(root, command);
      };

      root.querySelector('#msg-terminal-run')?.addEventListener('click', runTerminalCommand);
      root.querySelector('#msg-terminal-input')?.addEventListener('keydown', async (e) => {
        if (e.key === 'Tab') {
          const input = e.currentTarget;
          if (!(input instanceof HTMLInputElement)) return;
          const next = this.autocompleteCommand(input.value, messageConsoleState.userHints || []);
          if (next && next !== input.value) {
            e.preventDefault();
            input.value = next;
            input.setSelectionRange(next.length, next.length);
            return;
          }
        }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        await runTerminalCommand();
      });

      root.querySelector('#msg-terminal-input')?.addEventListener('input', async (e) => {
        const input = e.currentTarget;
        if (!(input instanceof HTMLInputElement)) return;
        const prefix = this.extractUserPrefix(input.value);
        await this.refreshUserHints(root, prefix);
      });
    }

    async render() {
      const root = WM.body('messages');
      if (!root) return;

      root.innerHTML = this.renderTemplate('shell', {
        composeToggle: this.templates.composeToggle,
        composeForm: this.templates.composeForm,
        terminalPanel: this.templates.terminalPanel,
        messagesList: this.templates.messagesList,
      });

      this.bindComposeControls(root);

      this.renderConsoleLog(root);
      await this.refreshUserHints(root, '');
      this.bindTerminalControls(root);

      await this.loadMessagesList(root);
    }
  }

  const messagesController = new MessagesController();
  window.GQMessagesController = messagesController;

  // ÔöÇÔöÇ Messages window ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function renderMessages() {
    await messagesController.render();
  }

  class IntelController {
    constructor() {
      this.lastMatchupScan = null;
      this.battleDetailCache = new Map();
    }

    renderCombatSummary(report) {
      const ctx = report?.simulation_context || {};
      const power = ctx.power_rating || {};
      const winLabel = ctx.attacker_wins === null || typeof ctx.attacker_wins === 'undefined'
        ? 'n/a'
        : (ctx.attacker_wins ? 'Attacker victory' : 'Defender hold');
      const diceVar = Number(ctx.dice_variance_index || 0);

      return `
        <div class="system-row small" style="margin-top:0.45rem; color:#b8c7d9;">
          <span style="display:inline-block; margin-right:0.7rem;">Seed: ${esc(String(ctx.seed || 'n/a').slice(0, 12))}</span>
          <span style="display:inline-block; margin-right:0.7rem;">Var: ${fmt(diceVar)}</span>
          <span style="display:inline-block; margin-right:0.7rem;">PWR A/D: ${fmt(power.attacker || 0)} / ${fmt(power.defender || 0)}</span>
          <span style="display:inline-block;">${esc(winLabel)}</span>
        </div>`;
    }

    renderSpyReportCard(report) {
      if (!report || !report.report) return '';
      const r = report.report;
      const createdAt = new Date(report.created_at).toLocaleString();
      const status = r.status || 'unknown';

      if (status === 'uninhabited') {
        return `
          <div class="system-card" style="margin-bottom:1rem">
            <div class="system-row"><strong>­ƒöì Uninhabited Planet</strong></div>
            <div class="system-row text-muted small">${createdAt}</div>
            ${r.planet ? `<div class="system-row">Class: ${esc(r.planet.planet_class || '?')}</div>` : ''}
            ${r.planet && r.planet.deposit_metal ? `<div class="system-row">Ô¼í Metal: ${esc(r.planet.richness_metal || '?')}</div>` : ''}
            ${r.planet && r.planet.deposit_crystal ? `<div class="system-row">­ƒÆÄ Crystal: ${esc(r.planet.richness_crystal || '?')}</div>` : ''}
          </div>`;
      }

      if (status !== 'inhabited') return '';

      return `
        <div class="system-card" style="margin-bottom:1rem">
          <div class="system-row"><strong>­ƒöì Spy Report: ${esc(r.owner || '?')}</strong></div>
          <div class="system-row" style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <strong>­ƒöì Spy Report: ${esc(r.owner || '?')}</strong>
            ${!report.is_own && report.owner_username ? `<span class="lb-alliance-tag">via ${esc(report.owner_username)}</span>` : ''}
          </div>
          <div class="system-row text-muted small">${createdAt}</div>
          
          <div class="system-row" style="margin-top:0.5rem"><strong>Resources</strong></div>
          ${r.resources ? `
            <div class="system-row small">
              Ô¼í ${fmt(r.resources.metal || 0)} ┬À ­ƒÆÄ ${fmt(r.resources.crystal || 0)} ┬À 
              ­ƒöÁ ${fmt(r.resources.deuterium || 0)} ┬À ­ƒîƒ ${fmt(r.resources.rare_earth || 0)}
            </div>
          ` : ''}
          
          <div class="system-row" style="margin-top:0.5rem"><strong>Welfare</strong></div>
          ${r.welfare ? `
            <div class="welfare-bar" style="margin-top:0.3rem">
              <span title="Happiness ${r.welfare.happiness || 0}%">­ƒÿè</span>
              <div class="bar-wrap"><div class="bar-fill bar-happiness" style="width:${r.welfare.happiness || 0}%"></div></div>
              <span style="font-size:0.7rem;min-width:28px">${r.welfare.happiness || 0}%</span>
            </div>
            <div class="welfare-bar">
              <span title="Population">­ƒæÑ</span>
              <div class="bar-wrap"><div class="bar-fill bar-population" style="width:${Math.min(100, Math.round((r.welfare.population || 0) / (r.welfare.max_population || 500) * 100))}%"></div></div>
              <span style="font-size:0.7rem;min-width:38px">${fmt(r.welfare.population || 0)}</span>
            </div>
            <div class="welfare-bar">
              <span title="Public Services">­ƒÅÑ</span>
              <div class="bar-wrap"><div class="bar-fill bar-services" style="width:${r.welfare.public_services || 0}%"></div></div>
              <span style="font-size:0.7rem;min-width:28px">${r.welfare.public_services || 0}%</span>
            </div>
          ` : ''}

          ${r.stealth_masked ? `
            <div class="system-row" style="margin-top:0.5rem"><strong>Stealth</strong></div>
            <div class="system-row small text-muted">${esc(r.stealth_note || 'Fleet intel is hidden by active stealth technology.')}</div>
          ` : ''}

          ${r.ships && Object.keys(r.ships).length ? `
            <div class="system-row" style="margin-top:0.5rem"><strong>Ships</strong></div>
            <div class="system-row small">
              ${Object.entries(r.ships).map(([ship, count]) => esc(fmtName(ship)) + ': ' + fmt(count)).join(' ┬À ')}
            </div>
          ` : ''}

          ${r.leaders && r.leaders.length ? `
            <div class="system-row" style="margin-top:0.5rem"><strong>Leaders</strong></div>
            <div class="system-row small">
              ${r.leaders.map((l) => esc(l.name || '?') + ' (' + esc(l.role || '?') + ') Lv' + (l.level || 0)).join(' ┬À ')}
            </div>
          ` : ''}
        </div>`;
    }

    renderBattleReportCard(report) {
      if (!report || !report.report) return '';
      const r = report.report || {};
      const createdAt = new Date(report.created_at).toLocaleString();
      const explain = Array.isArray(r.explainability?.top_factors) ? r.explainability.top_factors : [];
      const loot = r.loot || {};
      const attackerWins = !!r.attacker_wins;
      const accent = attackerWins ? '#3e8f5a' : '#9a4b4b';

      return `
        <div class="system-card" style="margin-bottom:1rem; border-color:${accent};">
          <div class="system-row"><strong>ÔÜö Battle Report #${report.id}</strong></div>
          <div class="system-row text-muted small">${createdAt} ┬À Role: ${esc(report.role || '?')}</div>
          <div class="system-row" style="margin-top:0.35rem; color:${accent}; font-weight:700;">
            ${attackerWins ? 'Attacker succeeded' : 'Defender held'}
          </div>
          ${this.renderCombatSummary(report)}
          <div class="system-row small" style="margin-top:0.5rem;">
            Loot: Ô¼í ${fmt(loot.metal || 0)} ┬À ­ƒÆÄ ${fmt(loot.crystal || 0)} ┬À ­ƒöÁ ${fmt(loot.deuterium || 0)} ┬À ­ƒîƒ ${fmt(loot.rare_earth || 0)}
          </div>
          ${explain.length ? `
            <div class="system-row" style="margin-top:0.55rem;"><strong>Top Factors</strong></div>
            <div class="system-row small" style="color:#d7dfef;">
              ${explain.map((f) => `${esc(fmtName(String(f.factor || 'factor')))} ${fmt(Number(f.impact_pct || 0))}%`).join(' ┬À ')}
            </div>
          ` : ''}
          <div style="margin-top:0.65rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
            <button class="btn btn-sm" data-battle-detail="${Number(report.id || 0)}">Open Detail</button>
          </div>
        </div>`;
    }

    renderBattleDetailBody(detailResponse) {
      const battle = detailResponse?.battle_report || {};
      const report = battle.report || {};
      const meta = battle.meta || {};
      const explain = Array.isArray(report.explainability?.top_factors) ? report.explainability.top_factors : [];
      const rounds = Array.isArray(report.rounds) ? report.rounds : [];
      const modifierBreakdown = report.modifier_breakdown || {};
      const loot = report.loot || {};
      const tech = report.tech || {};
      const attackerLost = report.attacker_lost || {};
      const defenderLost = report.defender_lost || {};
      const renderModifierRows = (sideKey, label) => {
        const buckets = modifierBreakdown?.[sideKey] || {};
        const entries = Object.entries(buckets);
        if (!entries.length) {
          return `<div class="small">${label}: none</div>`;
        }

        return `
          <div class="small" style="display:grid; gap:0.25rem;">
            <div style="font-weight:700; color:#eef4ff;">${label}</div>
            ${entries.map(([key, value]) => `
              <div>
                ${esc(fmtName(String(key || 'modifier')))}:
                +${fmt(Number(value?.add_pct || 0) * 100)}% pct ┬À
                +${fmt(Number(value?.add_flat || 0))} flat ┬À
                x${fmt(Number(value?.mult || 1))}
              </div>`).join('')}
          </div>`;
      };

      return `
        <div style="display:grid; gap:0.8rem; color:#dfe7f5;">
          <div>
            <div style="font-weight:700; font-size:1.05rem;">Battle Report #${fmt(battle.id || 0)}</div>
            <div class="small text-muted">${esc(String(battle.created_at || ''))} ┬À Role: ${esc(String(battle.role || '?'))}</div>
          </div>
          <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
            <div><strong>Combat Meta</strong></div>
            <div class="small" style="margin-top:0.35rem;">Seed: ${esc(String(meta.battle_seed || report.seed || 'n/a'))}</div>
            <div class="small">Version: ${fmt(meta.report_version || report.version || 0)} ┬À Dice Var: ${fmt(meta.dice_variance_index || report.dice_variance_index || 0)}</div>
            <div class="small">Power A/D: ${fmt(meta.attacker_power_rating || report.power_rating?.attacker || 0)} / ${fmt(meta.defender_power_rating || report.power_rating?.defender || 0)}</div>
          </div>
          <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
            <div><strong>Tech Snapshot</strong></div>
            <div class="small" style="margin-top:0.35rem;">Atk Wpn/Shld: ${fmt(tech.atk_wpn || 0)} / ${fmt(tech.atk_shld || 0)}</div>
            <div class="small">Def Wpn/Shld: ${fmt(tech.def_wpn || 0)} / ${fmt(tech.def_shld || 0)}</div>
          </div>
          ${(() => {
            const ec = report.energy_context;
            const dc = report.damage_channels;
            if (!ec && !dc) return '';
            const atkBudget = ec?.attacker || {};
            const defBudget = ec?.defender || {};
            const atkCh = dc?.attacker || {};
            const defCh = dc?.defender || {};
            return `
              <div style="padding:0.65rem; border:1px solid #2a4563; border-radius:10px; background:#0d1824;">
                <div><strong>ÔÜí Energy Economy</strong></div>
                <div style="margin-top:0.45rem; display:grid; grid-template-columns:1fr 1fr; gap:0.55rem;">
                  <div class="small">
                    <div style="font-weight:700; color:#7ec8e3; margin-bottom:0.2rem;">Attacker</div>
                    ${atkBudget.generated != null ? `<div>Generated: ${fmt(atkBudget.generated)}</div>` : ''}
                    ${atkBudget.upkeep != null ? `<div>Upkeep: ${fmt(atkBudget.upkeep)}</div>` : ''}
                    ${atkBudget.weapon_factor != null ? `<div>Wpn Factor: ${fmt(atkBudget.weapon_factor)}</div>` : ''}
                    ${atkBudget.shield_factor != null ? `<div>Shld Factor: ${fmt(atkBudget.shield_factor)}</div>` : ''}
                    ${atkBudget.weapon_efficiency != null ? `<div>Wpn Eff: ${fmt(atkBudget.weapon_efficiency)}</div>` : ''}
                    ${atkBudget.shield_efficiency != null ? `<div>Shld Eff: ${fmt(atkBudget.shield_efficiency)}</div>` : ''}
                    ${(atkCh.energy != null || atkCh.kinetic != null) ? `
                      <div style="margin-top:0.2rem; border-top:1px solid #2a4060; padding-top:0.2rem;">
                        <span style="color:#f09c30;">ÔÜí Energy: ${fmt(atkCh.energy || 0)}</span>
                        &nbsp;┬À&nbsp;
                        <span style="color:#c0c8d8;">­ƒÆÑ Kinetic: ${fmt(atkCh.kinetic || 0)}</span>
                      </div>` : ''}
                  </div>
                  <div class="small">
                    <div style="font-weight:700; color:#e38080; margin-bottom:0.2rem;">Defender</div>
                    ${defBudget.generated != null ? `<div>Generated: ${fmt(defBudget.generated)}</div>` : ''}
                    ${defBudget.upkeep != null ? `<div>Upkeep: ${fmt(defBudget.upkeep)}</div>` : ''}
                    ${defBudget.weapon_factor != null ? `<div>Wpn Factor: ${fmt(defBudget.weapon_factor)}</div>` : ''}
                    ${defBudget.shield_factor != null ? `<div>Shld Factor: ${fmt(defBudget.shield_factor)}</div>` : ''}
                    ${defBudget.weapon_efficiency != null ? `<div>Wpn Eff: ${fmt(defBudget.weapon_efficiency)}</div>` : ''}
                    ${defBudget.shield_efficiency != null ? `<div>Shld Eff: ${fmt(defBudget.shield_efficiency)}</div>` : ''}
                    ${(defCh.energy != null || defCh.kinetic != null) ? `
                      <div style="margin-top:0.2rem; border-top:1px solid #2a4060; padding-top:0.2rem;">
                        <span style="color:#f09c30;">ÔÜí Energy: ${fmt(defCh.energy || 0)}</span>
                        &nbsp;┬À&nbsp;
                        <span style="color:#c0c8d8;">­ƒÆÑ Kinetic: ${fmt(defCh.kinetic || 0)}</span>
                      </div>` : ''}
                  </div>
                </div>
              </div>`;
          })()}
          <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
            <div><strong>Losses</strong></div>
            <div class="small" style="margin-top:0.35rem;">Attacker: ${Object.keys(attackerLost).length ? Object.entries(attackerLost).map(([k, v]) => `${esc(fmtName(k))} ${fmt(v)}`).join(' ┬À ') : 'none'}</div>
            <div class="small">Defender: ${Object.keys(defenderLost).length ? Object.entries(defenderLost).map(([k, v]) => `${esc(fmtName(k))} ${fmt(v)}`).join(' ┬À ') : 'none'}</div>
          </div>
          <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
            <div><strong>Loot</strong></div>
            <div class="small" style="margin-top:0.35rem;">Ô¼í ${fmt(loot.metal || 0)} ┬À ­ƒÆÄ ${fmt(loot.crystal || 0)} ┬À ­ƒöÁ ${fmt(loot.deuterium || 0)} ┬À ­ƒîƒ ${fmt(loot.rare_earth || 0)}</div>
          </div>
          <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
            <div><strong>Modifier Breakdown</strong></div>
            <div class="small" style="margin-top:0.35rem; display:grid; gap:0.55rem;">
              ${renderModifierRows('attacker', 'Attacker')}
              ${renderModifierRows('defender', 'Defender')}
            </div>
          </div>
          ${rounds.length ? `
            <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
              <div><strong>Round Flow</strong></div>
              <div class="small" style="margin-top:0.35rem; display:grid; gap:0.35rem;">
                ${rounds.map((round) => `
                  <div style="padding:0.45rem 0.55rem; border:1px solid #314154; border-radius:8px; background:#0d1420;">
                    <div style="font-weight:700; color:#eef4ff;">Round ${fmt(round.round || 0)}${round.decisive ? ' ┬À Decisive' : ''}</div>
                    <div>Pressure A/D: ${fmt(round.attacker_pressure || 0)} / ${fmt(round.defender_pressure || 0)}</div>
                    <div>Integrity A/D: ${fmt(round.attacker_integrity_remaining || 0)} / ${fmt(round.defender_integrity_remaining || 0)}</div>
                    <div>Swing: ${esc(fmtName(String(round.swing || 'neutral')))}${round.outcome ? ' ┬À Outcome: ' + esc(fmtName(String(round.outcome))) : ''}</div>
                  </div>`).join('')}
              </div>
            </div>
          ` : ''}
          ${explain.length ? `
            <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
              <div><strong>Explainability</strong></div>
              <div class="small" style="margin-top:0.35rem; display:grid; gap:0.25rem;">
                ${explain.map((item) => `<div>${esc(fmtName(String(item.factor || 'factor')))}: ${fmt(Number(item.impact_pct || 0))}%</div>`).join('')}
              </div>
            </div>
          ` : ''}
        </div>`;
    }

    closeBattleDetailOverlay() {
      document.getElementById('intel-battle-detail-overlay')?.remove();
    }

    async openBattleDetail(reportId) {
      const id = Number(reportId || 0);
      if (!id) return;

      this.closeBattleDetailOverlay();

      const overlay = document.createElement('div');
      overlay.id = 'intel-battle-detail-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(5,8,14,0.76);z-index:10020;display:flex;align-items:center;justify-content:center;padding:20px;';
      overlay.innerHTML = `
        <div style="width:min(860px, 100%); max-height:88vh; overflow:auto; background:#0f1724; border:1px solid #4d6078; border-radius:14px; padding:18px; box-shadow:0 24px 80px rgba(0,0,0,0.45);">
          <div style="display:flex; justify-content:space-between; gap:1rem; align-items:center; margin-bottom:0.9rem;">
            <div style="font-weight:800; font-size:1.1rem; color:#eef4ff;">Battle Detail</div>
            <button id="intel-battle-detail-close" class="btn btn-sm">Close</button>
          </div>
          <div id="intel-battle-detail-body" class="text-muted small">Loading battle detail...</div>
        </div>`;
      document.body.appendChild(overlay);

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          this.closeBattleDetailOverlay();
        }
      });
      overlay.querySelector('#intel-battle-detail-close')?.addEventListener('click', () => this.closeBattleDetailOverlay());

      try {
        let payload = this.battleDetailCache.get(id);
        if (!payload) {
          payload = await API.battleReportDetail(id);
          if (payload?.success) {
            this.battleDetailCache.set(id, payload);
          }
        }
        if (!payload?.success) {
          throw new Error(payload?.error || 'Failed to load battle detail.');
        }
        const body = overlay.querySelector('#intel-battle-detail-body');
        if (body) {
          body.innerHTML = this.renderBattleDetailBody(payload);
        }
      } catch (err) {
        const body = overlay.querySelector('#intel-battle-detail-body');
        if (body) {
          body.innerHTML = `<div class="text-red">${esc(String(err?.message || 'Failed to load battle detail.'))}</div>`;
        }
        showToast(String(err?.message || 'Failed to load battle detail.'), 'error');
      }
    }

    renderMatchupScanPanel(fleets = []) {
      const options = fleets.length
        ? fleets.map((fleet) => `<option value="${Number(fleet.id || 0)}">Fleet #${Number(fleet.id || 0)} ┬À ${esc(String(fleet.mission || 'unknown'))}</option>`).join('')
        : '<option value="">No fleets available</option>';
      const last = this.lastMatchupScan;
      let resultHtml = '<div class="text-muted small">Run a scan to estimate winrate and loss expectations against one or more target colonies.</div>';
      if (last && Array.isArray(last.ranking)) {
        resultHtml = `
          <div class="system-row small" style="margin-top:0.45rem; color:#b8c7d9;">
            Seed: ${esc(String(last.seed || '').slice(0, 12))} ┬À Targets: ${fmt(last.targets_scanned || 0)} ┬À Iterations: ${fmt(last.iterations || 0)}
          </div>
          <div style="margin-top:0.55rem; display:grid; gap:0.45rem;">
            ${last.ranking.map((row) => `
              <div style="padding:0.45rem 0.55rem; border:1px solid #45556d; border-radius:8px; background:#111927;">
                <div style="font-weight:700;">Target Colony #${fmt(row.target_colony_id || 0)}</div>
                <div class="small" style="color:#d7dfef; margin-top:0.2rem;">
                  Winrate: ${fmt((Number(row.attacker_winrate_estimate || 0) * 100).toFixed(2))}% ┬À
                  Dice Var: ${fmt(row.dice_variance_avg || 0)} ┬À
                  Loss A/D: ${fmt((Number(row.expected_loss_fraction_avg?.attacker || 0) * 100).toFixed(2))}% / ${fmt((Number(row.expected_loss_fraction_avg?.defender || 0) * 100).toFixed(2))}%
                </div>
              </div>
            `).join('')}
          </div>`;
      }

      return `
        <div class="system-card" style="margin-bottom:1rem;">
          <div class="system-row"><strong>Combat Matchup Scan</strong></div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:0.6rem; margin-top:0.65rem;">
            <label class="small" style="display:flex; flex-direction:column; gap:0.25rem;">
              <span>Attacker Fleet</span>
              <select id="intel-matchup-fleet" class="input">${options}</select>
            </label>
            <label class="small" style="display:flex; flex-direction:column; gap:0.25rem;">
              <span>Target Colony IDs</span>
              <input id="intel-matchup-targets" class="input" placeholder="195,196,197" />
            </label>
            <label class="small" style="display:flex; flex-direction:column; gap:0.25rem;">
              <span>Iterations</span>
              <input id="intel-matchup-iterations" class="input" type="number" min="1" max="2000" value="200" />
            </label>
            <label class="small" style="display:flex; flex-direction:column; gap:0.25rem;">
              <span>Seed</span>
              <input id="intel-matchup-seed" class="input" placeholder="scan_v1" />
            </label>
          </div>
          <div style="margin-top:0.65rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
            <button id="intel-run-matchup-scan" class="btn">Run Scan</button>
            <button id="intel-clear-matchup-scan" class="btn btn-sm">Clear</button>
          </div>
          <div id="intel-matchup-results" style="margin-top:0.8rem;">${resultHtml}</div>
        </div>`;
    }

    attachEventListeners(root) {
      root.querySelectorAll('[data-battle-detail]').forEach((btn) => {
        btn.addEventListener('click', async (event) => {
          const reportId = Number(event.currentTarget?.dataset?.battleDetail || 0);
          await this.openBattleDetail(reportId);
        });
      });

      root.querySelector('#intel-run-matchup-scan')?.addEventListener('click', async () => {
        const fleetId = Number(root.querySelector('#intel-matchup-fleet')?.value || 0);
        const targetsRaw = String(root.querySelector('#intel-matchup-targets')?.value || '');
        const iterations = Number(root.querySelector('#intel-matchup-iterations')?.value || 200);
        const seed = String(root.querySelector('#intel-matchup-seed')?.value || '').trim();
        const targetIds = targetsRaw.split(',').map((v) => Number(String(v).trim())).filter((v) => Number.isFinite(v) && v > 0);

        if (!fleetId) {
          showToast('Select an attacker fleet first.', 'warning');
          return;
        }
        if (!targetIds.length) {
          showToast('Enter at least one target colony id.', 'warning');
          return;
        }

        const resultRoot = root.querySelector('#intel-matchup-results');
        if (resultRoot) resultRoot.innerHTML = '<div class="text-muted small">Running scan...</div>';

        try {
          const response = await API.matchupScan({
            attacker_fleet_id: fleetId,
            target_colony_ids: targetIds,
            iterations: Math.max(1, Math.min(2000, iterations || 200)),
            deterministic_seed: seed || undefined,
          });
          if (!response.success || !response.scan) {
            throw new Error(response.error || 'Matchup scan failed.');
          }
          this.lastMatchupScan = response.scan;
          await this.render();
          showToast('Combat matchup scan complete.', 'success');
        } catch (err) {
          if (resultRoot) resultRoot.innerHTML = '<div class="text-red small">Scan failed.</div>';
          showToast(String(err?.message || 'Matchup scan failed.'), 'error');
        }
      });

      root.querySelector('#intel-clear-matchup-scan')?.addEventListener('click', async () => {
        this.lastMatchupScan = null;
        await this.render();
      });
    }

    async render() {
      const root = WM.body('intel');
      if (!root) return;

      root.innerHTML = uiKitSkeletonHTML();

      try {
        const [spyResponse, battleResponse, fleetsResponse] = await Promise.all([
          API.spyReports(),
          API.battleReports(),
          API.fleets(),
        ]);
        if (!spyResponse.success || !Array.isArray(spyResponse.spy_reports)) {
          root.innerHTML = '<p class="text-red">Failed to load intel reports.</p>';
          return;
        }

        const battleReports = battleResponse?.success && Array.isArray(battleResponse.battle_reports)
          ? battleResponse.battle_reports
          : [];
        const fleets = fleetsResponse?.success && Array.isArray(fleetsResponse.fleets)
          ? fleetsResponse.fleets
          : [];

        const spyReports = spyResponse.spy_reports;
        if (!spyReports.length && !battleReports.length) {
          root.innerHTML = this.renderMatchupScanPanel(fleets) + uiKitEmptyStateHTML('No intel reports yet', 'Launch reconnaissance or battle missions to collect fresh intel.');
          this.attachEventListeners(root);
          return;
        }

        let html = '<div>';
        html += this.renderMatchupScanPanel(fleets);
        const sharedBadge = spyResponse.alliance_shared ? ' <span class="lb-alliance-tag">Alliance shared</span>' : '';
        html += `<div class="system-card" style="margin-bottom:1rem"><div class="system-row"><strong>­ƒöì Spy Reports (${spyReports.length})</strong>${sharedBadge}</div></div>`;
        for (const report of spyReports) {
          html += this.renderSpyReportCard(report);
        }
        html += `<div class="system-card" style="margin:1rem 0"><div class="system-row"><strong>ÔÜö Battle Reports (${battleReports.length})</strong></div></div>`;
        for (const report of battleReports) {
          html += this.renderBattleReportCard(report);
        }
        html += '</div>';
        root.innerHTML = html;
        this.attachEventListeners(root);
      } catch (e) {
        root.innerHTML = '<p class="text-red">Error: ' + esc(String(e.message || 'Unknown error')) + '</p>';
      }
    }
  }

  const intelController = new IntelController();
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
      } catch (_) {
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
      html += '<button id="btn-create-route" class="btn" style="width: 100%;">Ô×ò New Trade Route</button>';
      html += '</div>';
      html += '</div>';

      root.innerHTML = html;
      this.attachEventListeners();
    }

    renderRouteCard(route) {
      const routeId = route.id;
      const html = `
        <div class="route-card" style="padding: 8px; border: 1px solid #777; border-radius: 4px; background: #1a1a1a;">
          <div style="font-weight: bold; margin-bottom: 4px;">
            ${esc(route.origin_name)} ÔåÆ ${esc(route.target_name)}
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
          <div style="display: flex; gap: 4px;">
            <button data-toggle-route="${routeId}" class="btn" style="flex: 1; padding: 4px;">
              ${route.is_active ? 'ÔÅ©' : 'ÔûÂ'}
            </button>
            <button data-delete-route="${routeId}" class="btn" style="flex: 1; padding: 4px; color: #f55;">­ƒùæ</button>
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

  class AlliancesController {
    constructor() {
      this.alliances = [];
      this.userAlliance = null;
      this.allianceDetails = null;
    }

    async render() {
      const root = WM.body('alliances');
      if (!root) return;

      root.innerHTML = uiKitSkeletonHTML();

      try {
        const data = await API.alliances();
        this.alliances = data.alliances || [];
        this.userAlliance = data.user_alliance_id;

        let html = '<div style="padding: 8px;">';

        if (this.userAlliance) {
          // Show user's alliance details
          html += `<div style="margin-bottom: 12px; padding: 8px; background: #1a3a2a; border: 1px solid #4a8;border-radius:4px;">
            <button class="btn" onclick="GQAlliancesController.showAllianceDetails(${this.userAlliance})" style="width:100%;text-align:left;">
              ­ƒæÑ View My Alliance
            </button>
            <button class="btn btn-sm" style="margin-top:4px;width:100%;background:#8b4444;" onclick="GQAlliancesController.showLeaveDialog();">Leave Alliance</button>
          </div>`;
        } else {
          // Show create alliance button
          html += `<div style="margin-bottom: 12px;">
            <button class="btn" onclick="GQAlliancesController.showCreateDialog()" style="width:100%;">Ô×ò Create Alliance</button>
          </div>`;
        }

        // List all alliances
        html += '<div style="margin-top: 12px; border-top: 1px solid #555; padding-top: 8px;"><strong>­ƒîì All Alliances</strong></div>';
        if (this.alliances.length === 0) {
          html += uiKitEmptyStateHTML('No alliances found', 'Start a new alliance and invite trusted commanders.');
        } else {
          html += '<div style="display: grid; gap: 6px; margin-top: 6px;">';
          for (const alliance of this.alliances) {
            html += this.renderAllianceCard(alliance);
          }
          html += '</div>';
        }

        html += '</div>';
        root.innerHTML = html;
      } catch (e) {
        root.innerHTML = '<p class="text-red">Error: ' + esc(String(e.message || 'Unknown error')) + '</p>';
      }
    }

    renderAllianceCard(alliance) {
      const canJoin = !this.userAlliance;
      return `
        <div style="padding:8px;border:1px solid #666;border-radius:4px;background:#0a0a0a;">
          <div style="font-weight:bold;">[${esc(alliance.tag)}] ${esc(alliance.name)}</div>
          <div style="font-size:0.85em;color:#bbb;margin:4px 0;">­ƒæñ ${esc(alliance.leader_name)} ┬À ­ƒæÑ ${alliance.member_count} members</div>
          ${alliance.description ? `<div style="font-size:0.8em;color:#aaa;margin:4px 0;max-height:2.5em;overflow:hidden;">${esc(alliance.description)}</div>` : ''}
          <div style="display:flex;gap:4px;margin-top:6px;">
            <button class="btn btn-sm" onclick="GQAlliancesController.showAllianceDetails(${alliance.id})" style="flex:1;">View</button>
            ${canJoin ? `<button class="btn btn-sm" onclick="GQAlliancesController.joinAlliance(${alliance.id})" style="flex:1;background:#3a4;">Join</button>` : ''}
          </div>
        </div>
      `;
    }

    async showAllianceDetails(allianceId) {
      try {
        const data = await API.allianceDetails(allianceId);
        const alliance = data.alliance;
        const members = data.members || [];
        const isMember = data.is_member;
        const isLeader = isMember && data.user_role === 'leader';

        // Load relations if member
        let relations = [];
        if (isMember) {
          try {
            const relData = await API.allianceRelations(allianceId);
            relations = relData.relations || [];
          } catch (e) {
            console.warn('Failed to load relations:', e);
          }
        }

        let html = `
          <div style="padding:12px;overflow-y:auto;max-height:100%;font-size:0.9em;">
            <div style="font-size:1.1em;font-weight:bold;margin-bottom:8px;">
              [${esc(alliance.tag)}] ${esc(alliance.name)}
            </div>
            ${alliance.description ? `<div style="color:#bbb;margin-bottom:8px;">${esc(alliance.description)}</div>` : ''}
            <div style="border-bottom:1px solid #555;padding-bottom:8px;margin-bottom:8px;font-size:0.85em;color:#aaa;">
              ­ƒæñ Leader: ID ${alliance.leader_id} ┬À Founded: ${new Date(alliance.created_at).toLocaleDateString()}
            </div>
            
            ${isMember ? `
              <div style="background:#1a3a2a;padding:6px;border-radius:4px;margin-bottom:8px;font-size:0.85em;">
                <div style="font-weight:bold;color:#4f8;">Ô£ô Member (${esc(data.user_role)})</div>
              </div>
            ` : ''}

            <div style="margin-bottom:8px;">
              <strong>­ƒÆ╝ Treasury</strong>
              <div style="font-size:0.8em;color:#bbb;margin-top:4px;">
                Ô¼í ${fmt(alliance.treasury.metal)} ┬À ­ƒÆÄ ${fmt(alliance.treasury.crystal)} ┬À ­ƒöÁ ${fmt(alliance.treasury.deuterium)} ┬À Ô¡É ${fmt(alliance.treasury.dark_matter)}
              </div>
            </div>

            <div style="margin-bottom:8px;">
              <strong>­ƒæÑ Members (${members.length})</strong>
              <div style="background:#0a0a0a;border:1px solid #555;border-radius:4px;max-height:120px;overflow-y:auto;margin-top:4px;font-size:0.8em;">
                ${members.map(m => `
                  <div style="padding:3px 6px;border-bottom:1px solid #333;">
                    <strong style="color:${m.role === 'leader' ? '#ff8' : m.role === 'diplomat' ? '#8ff' : '#fff'};">${esc(m.username)}</strong>
                    <span style="color:#999;"> (${esc(m.role)})</span>
                  </div>
                `).join('')}
              </div>
            </div>

            ${relations.length > 0 ? `
              <div style="margin-bottom:8px;">
                <strong>­ƒñØ Diplomacy Relations</strong>
                <div style="background:#0a0a0a;border:1px solid #555;border-radius:4px;max-height:120px;overflow-y:auto;margin-top:4px;font-size:0.8em;">
                  ${relations.map(r => {
                    const icon = {
                      'war': 'ÔÜö',
                      'enemy': '­ƒÆÇ',
                      'alliance': 'Ô£ª',
                      'nap': 'Ô£ï',
                      'neutral': 'ÔÇô'
                    }[r.relation_type] || '?';
                    const color = {
                      'war': '#f44',
                      'enemy': '#f44',
                      'alliance': '#4f4',
                      'nap': '#ff8',
                      'neutral': '#888'
                    }[r.relation_type] || '#fff';
                    const label = r.other_alliance_name ? `[${r.other_alliance_tag}] ${r.other_alliance_name}` : `Player: ${r.other_user_name}`;
                    return `<div style="padding:3px 6px;border-bottom:1px solid #333;color:${color};">${icon} ${esc(label)} (${r.relation_type})</div>`;
                  }).join('')}
                </div>
              </div>
            ` : ''}

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:12px;font-size:0.85em;">
              ${isMember ? `
                <button class="btn btn-sm" onclick="GQAlliancesController.showChatDialog(${allianceId})" style="background:#448;">­ƒÆ¼</button>
                <button class="btn btn-sm" onclick="GQAlliancesController.showContributeDialog(${allianceId})" style="background:#484;">­ƒÆ░</button>
              ` : ''}
              ${isLeader ? `
                <button class="btn btn-sm" onclick="GQAlliancesController.showDiplomacyDialog(${allianceId})" style="background:#844;">ÔÜö</button>
                <button class="btn btn-sm" onclick="GQAlliancesController.showManageMembersDialog(${allianceId})" style="background:#448;">­ƒæÑ</button>
              ` : ''}
              ${isMember ? `
                <button class="btn btn-sm" onclick="GQAlliancesController.showLeaveDialog()" style="background:#844;">Ô£ò Leave</button>
              ` : `
                <button class="btn btn-sm" onclick="GQAlliancesController.joinAlliance(${allianceId})" style="background:#3a4;">Join</button>
              `}
              <button class="btn btn-sm" onclick="GQAlliancesController.render()" style="background:#555;">ÔåÉ Back</button>
            </div>
          </div>
        `;

        const root = WM.body('alliances');
        if (root) root.innerHTML = html;
      } catch (e) {
        showToast('Error loading alliance: ' + String(e.message), 'error');
      }
    }

    showCreateDialog() {
      const dialog = document.createElement('div');
      dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#222;border:2px solid #777;border-radius:4px;padding:16px;z-index:10000;width:90%;max-width:420px;';
      dialog.innerHTML = `
        <h3 style="margin: 0 0 12px 0;">Create Alliance</h3>
        <label style="display:block;margin-bottom:8px;">
          Name <span style="color:#f88;">*</span>
          <input type="text" id="alliance-name-input" placeholder="e.g., Unified Empire" style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" maxlength="64" />
        </label>
        <label style="display:block;margin-bottom:8px;">
          Tag <span style="color:#f88;">*</span>
          <input type="text" id="alliance-tag-input" placeholder="e.g., UE" style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" maxlength="4" />
        </label>
        <label style="display:block;margin-bottom:12px;">
          Description
          <textarea id="alliance-desc-input" placeholder="Optional..." style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;height:80px;resize:none;" maxlength="500"></textarea>
        </label>
        <div style="display:flex;gap:8px;">
          <button class="btn" onclick="GQAlliancesController.doCreateAlliance()" style="flex:1;">Ô£ô Create</button>
          <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">Ô£ò Cancel</button>
        </div>
      `;
      document.body.appendChild(dialog);
    }

    async doCreateAlliance() {
      try {
        const name = document.getElementById('alliance-name-input')?.value || '';
        const tag = document.getElementById('alliance-tag-input')?.value || '';
        const description = document.getElementById('alliance-desc-input')?.value || '';

        const response = await API.createAlliance({ name, tag, description });
        document.querySelector('[style*="position:fixed"]')?.remove();
        showToast(`Alliance "${response.name}" created! [${response.tag}]`, 'success');
        _invalidateGetCache([/api\/alliances\.php/i]);
        await this.render();
      } catch (e) {
        showToast('Error: ' + String(e.message), 'error');
      }
    }

    async joinAlliance(allianceId) {
      if (!confirm('Join this alliance?')) return;
      try {
        await API.joinAlliance(allianceId);
        showToast('Joined alliance!', 'success');
        _invalidateGetCache([/api\/alliances\.php/i]);
        await this.render();
      } catch (e) {
        showToast('Error: ' + String(e.message), 'error');
      }
    }

    showLeaveDialog() {
      if (!confirm('Leave your alliance?')) return;
      // TODO: implement
      showToast('Not yet ready', 'warning');
    }

    async showChatDialog(allianceId) {
      try {
        const data = await API.allianceMessages(allianceId);
        const messages = data.messages || [];

        let html = `
          <div style="padding:12px;">
            <h4 style="margin:0 0 12px 0;">Alliance Chat</h4>
            <div style="background:#0a0a0a;border:1px solid #555;border-radius:4px;height:300px;overflow-y:auto;margin-bottom:8px;padding:8px;">
              ${messages.length === 0 ? '<div class="text-muted">No messages yet.</div>' : messages.map(m => `
                <div style="margin-bottom:6px;padding:4px;border-bottom:1px solid #333;">
                  <div style="font-weight:bold;color:#8f8;">${esc(m.author_name)}</div>
                  <div style="color:#ccc;font-size:0.9em;margin:2px 0;">${esc(m.text)}</div>
                  <div style="color:#666;font-size:0.75em;">${new Date(m.created_at).toLocaleTimeString()}</div>
                </div>
              `).join('')}
            </div>
            <div style="display:flex;gap:4px;">
              <input type="text" id="alliance-chat-input" placeholder="Message..." style="flex:1;padding:6px;border:1px solid #666;background:#0a0a0a;color:#fff;" />
              <button class="btn btn-sm" onclick="GQAlliancesController.doSendChatMessage(${allianceId})">Send</button>
            </div>
            <button class="btn btn-sm" onclick="GQAlliancesController.showAllianceDetails(${allianceId})" style="margin-top:8px;width:100%;">ÔåÉ Close</button>
          </div>
        `;

        const root = WM.body('alliances');
        if (root) root.innerHTML = html;
      } catch (e) {
        showToast('Error: ' + String(e.message), 'error');
      }
    }

    async doSendChatMessage(allianceId) {
      const input = document.getElementById('alliance-chat-input');
      const msg = input?.value || '';
      if (!msg.trim()) return;

      try {
        await API.sendAllianceMessage(allianceId, msg);
        input.value = '';
        _invalidateGetCache([/api\/alliances\.php\?action=get_messages/i]);
        await this.showChatDialog(allianceId);
      } catch (e) {
        showToast('Error: ' + String(e.message), 'error');
      }
    }

    showContributeDialog(allianceId) {
      const dialog = document.createElement('div');
      dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#222;border:2px solid #777;border-radius:4px;padding:16px;z-index:10000;width:90%;max-width:380px;font-size:0.9em;';
      dialog.innerHTML = `
        <h3 style="margin: 0 0 12px 0;">Contribute to Treasury</h3>
        <label style="display:block;margin-bottom:8px;">
          Metal <input type="number" id="contrib-metal" value="0" min="0" style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" />
        </label>
        <label style="display:block;margin-bottom:8px;">
          Crystal <input type="number" id="contrib-crystal" value="0" min="0" style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" />
        </label>
        <label style="display:block;margin-bottom:12px;">
          Deuterium <input type="number" id="contrib-deuterium" value="0" min="0" style="width:100%;margin-top:4px;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" />
        </label>
        <div style="display:flex;gap:8px;">
          <button class="btn" onclick="GQAlliancesController.doContribute(${allianceId})" style="flex:1;">Ô£ô Contribute</button>
          <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">Ô£ò Cancel</button>
        </div>
      `;
      document.body.appendChild(dialog);
    }

    async doContribute(allianceId) {
      const metal = parseFloat(document.getElementById('contrib-metal')?.value || 0);
      const crystal = parseFloat(document.getElementById('contrib-crystal')?.value || 0);
      const deuterium = parseFloat(document.getElementById('contrib-deuterium')?.value || 0);

      if (metal < 0 || crystal < 0 || deuterium < 0) {
        showToast('Resources must be non-negative.', 'error');
        return;
      }

      try {
        await API.contributeAlliance({ alliance_id: allianceId, metal, crystal, deuterium });
        document.querySelector('[style*="position:fixed"]')?.remove();
        showToast('Resources contributed!', 'success');
        _invalidateGetCache([/api\/alliances\.php/i]);
        await this.showAllianceDetails(allianceId);
      } catch (e) {
        showToast('Error: ' + String(e.message), 'error');
      }
    }

    showDiplomacyDialog(allianceId) {
      const dialog = document.createElement('div');
      dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#222;border:2px solid #777;border-radius:4px;padding:16px;z-index:10000;width:90%;max-width:400px;font-size:0.9em;';
      dialog.innerHTML = `
        <h3 style="margin: 0 0 12px 0;">­ƒñØ Diplomacy</h3>
        <div style="margin-bottom:12px;">
          <div style="color:#aaa;margin-bottom:8px;"><strong>Target Type</strong></div>
          <select id="diplo-target-type" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;">
            <option value="alliance">Alliance</option>
            <option value="player">Player</option>
          </select>
        </div>
        <div style="margin-bottom:12px;">
          <div style="color:#aaa;margin-bottom:8px;"><strong>Target ID</strong></div>
          <input type="number" id="diplo-target-id" min="1" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" placeholder="Alliance/Player ID" />
        </div>
        <div style="margin-bottom:12px;">
          <div style="color:#aaa;margin-bottom:8px;"><strong>Action</strong></div>
          <select id="diplo-action" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;">
            <option value="war">ÔÜö Declare War</option>
            <option value="nap">Ô£ï Non-Aggression Pact</option>
            <option value="alliance">Ô£ª Propose Alliance</option>
            <option value="enemy">­ƒÆÇ Mark as Enemy</option>
            <option value="neutral">ÔÇô Neutral</option>
          </select>
        </div>
        <div id="diplo-nap-days" style="display:none;margin-bottom:12px;">
          <div style="color:#aaa;margin-bottom:8px;"><strong>Duration (days)</strong></div>
          <input type="number" id="diplo-nap-value" value="7" min="1" max="365" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" />
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn" onclick="GQAlliancesController.doDiplomacy(${allianceId})" style="flex:1;">Ô£ô Execute</button>
          <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">Ô£ò Cancel</button>
        </div>
      `;
      document.body.appendChild(dialog);

      // Show NAP days input only for NAP
      document.getElementById('diplo-action').addEventListener('change', (e) => {
        const napDaysDiv = document.getElementById('diplo-nap-days');
        if (napDaysDiv) {
          napDaysDiv.style.display = e.target.value === 'nap' ? 'block' : 'none';
        }
      });
    }

    async doDiplomacy(allianceId) {
      const targetType = document.getElementById('diplo-target-type')?.value || 'alliance';
      const targetId = parseInt(document.getElementById('diplo-target-id')?.value || 0);
      const action = document.getElementById('diplo-action')?.value || 'war';
      const napDays = parseInt(document.getElementById('diplo-nap-value')?.value || 7);

      if (!targetId || targetId <= 0) {
        showToast('Invalid target ID.', 'error');
        return;
      }

      try {
        const payload = { alliance_id: allianceId };
        if (targetType === 'alliance') {
          payload.target_alliance_id = targetId;
        } else {
          payload.target_user_id = targetId;
        }

        if (action === 'war') {
          await API.declareWar(payload);
          showToast('War declared!', 'success');
        } else if (action === 'nap') {
          payload.days = napDays;
          await API.declareNap(payload);
          showToast(`NAP declared for ${napDays} days!`, 'success');
        } else if (action === 'alliance') {
          await API.declareAllianceDiplomacy(payload);
          showToast('Alliance proposed!', 'success');
        } else {
          // Use legacy set_relation for enemy/neutral
          payload.relation_type = action;
          await API.setAllianceRelation(payload);
          showToast(`Relation set to ${action}.`, 'success');
        }

        document.querySelector('[style*="position:fixed"]')?.remove();
        _invalidateGetCache([/api\/alliances\.php/i]);
        await this.showAllianceDetails(allianceId);
      } catch (e) {
        showToast('Error: ' + String(e.message), 'error');
      }
    }

    showManageMembersDialog(allianceId) {
      const dialog = document.createElement('div');
      dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#222;border:2px solid #777;border-radius:4px;padding:16px;z-index:10000;width:90%;max-width:420px;font-size:0.9em;';
      dialog.innerHTML = `
        <h3 style="margin: 0 0 12px 0;">­ƒæÑ Manage Members</h3>
        <div style="margin-bottom:12px;">
          <div style="color:#aaa;margin-bottom:8px;"><strong>Member ID/Username</strong></div>
          <input type="text" id="member-id-input" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" placeholder="User ID (numeric)" />
        </div>
        <div style="margin-bottom:12px;">
          <div style="color:#aaa;margin-bottom:8px;"><strong>Action</strong></div>
          <select id="member-action" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;">
            <option value="set_role">Change Role</option>
            <option value="remove">Remove Member</option>
          </select>
        </div>
        <div id="member-role-div" style="margin-bottom:12px;">
          <div style="color:#aaa;margin-bottom:8px;"><strong>New Role</strong></div>
          <select id="member-role" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;">
            <option value="diplomat">Diplomat</option>
            <option value="officer">Officer</option>
            <option value="member">Member</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn" onclick="GQAlliancesController.doManageMember(${allianceId})" style="flex:1;">Ô£ô Execute</button>
          <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">Ô£ò Cancel</button>
        </div>
      `;
      document.body.appendChild(dialog);

      document.getElementById('member-action').addEventListener('change', (e) => {
        const roleDiv = document.getElementById('member-role-div');
        if (roleDiv) {
          roleDiv.style.display = e.target.value === 'set_role' ? 'block' : 'none';
        }
      });
    }

    async doManageMember(allianceId) {
      const userId = parseInt(document.getElementById('member-id-input')?.value || 0);
      const action = document.getElementById('member-action')?.value || 'set_role';

      if (!userId || userId <= 0) {
        showToast('Invalid user ID.', 'error');
        return;
      }

      try {
        if (action === 'remove') {
          if (!confirm('Remove this member?')) return;
          await API.removeAllianceMember({ alliance_id: allianceId, user_id: userId });
          showToast('Member removed!', 'success');
        } else {
          const role = document.getElementById('member-role')?.value || 'member';
          await API.setAllianceMemberRole({ alliance_id: allianceId, user_id: userId, role });
          showToast(`Member role set to ${role}!`, 'success');
        }

        document.querySelector('[style*="position:fixed"]')?.remove();
        _invalidateGetCache([/api\/alliances\.php/i]);
        await this.showAllianceDetails(allianceId);
      } catch (e) {
        showToast('Error: ' + String(e.message), 'error');
      }
    }
  }

  const alliancesController = new AlliancesController();
  window.GQAlliancesController = alliancesController;

  async function renderAlliances() {
    await alliancesController.render();
  }

  // ÔöÇÔöÇ Trade Proposals Controller ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  class TradeProposalsController {
        constructor() {
          this._tab = 'inbox'; // 'inbox' | 'outbox'
        }

        async render() {
          const root = WM.body('trade');
          if (!root) return;
          root.innerHTML = '<div class="text-muted" style="padding:8px;">LoadingÔÇª</div>';
          try {
            const data = await API.listTradeProposals();
            const proposals = data.proposals || [];
            const inbox  = proposals.filter(p => !p.is_mine);
            const outbox = proposals.filter(p =>  p.is_mine);

            const pendingInbox = inbox.filter(p => p.status === 'pending').length;
            const pendingTab = pendingInbox > 0 ? ` <span style="background:#c44;border-radius:8px;padding:1px 6px;font-size:0.78em;">${pendingInbox}</span>` : '';

            const tab = this._tab;
            const items = tab === 'inbox' ? inbox : outbox;

            let html = `<div style="padding:8px;">
              <div style="display:flex;gap:6px;margin-bottom:10px;">
                <button class="btn btn-sm${tab==='inbox'?'':' btn-secondary'}" style="flex:1;" onclick="GQTradeProposalsController._tab='inbox';GQTradeProposalsController.render()">
                  ­ƒôÑ Inbox${pendingTab}
                </button>
                <button class="btn btn-sm${tab==='outbox'?'':' btn-secondary'}" style="flex:1;" onclick="GQTradeProposalsController._tab='outbox';GQTradeProposalsController.render()">
                  ­ƒôñ Outbox
                </button>
                <button class="btn btn-sm btn-secondary" onclick="GQTradeProposalsController.showProposeDialog()" title="New Proposal">Ô×ò</button>
              </div>`;

            if (items.length === 0) {
              html += `<div class="text-muted" style="padding:8px;text-align:center;">No proposals.</div>`;
            } else {
              for (const p of items) {
                html += this._renderCard(p);
              }
            }
            html += '</div>';
            root.innerHTML = html;
          } catch (e) {
            root.innerHTML = `<div class="text-muted" style="padding:8px;">Error: ${esc(e.message)}</div>`;
          }
        }

        _statusBadge(status) {
          const map = { pending:'#bb8822', accepted:'#3a8', rejected:'#844', cancelled:'#555', expired:'#444' };
          return `<span style="background:${map[status]??'#555'};border-radius:4px;padding:1px 6px;font-size:0.8em;">${esc(status)}</span>`;
        }

        _fmtRes(r) {
          const parts = [];
          if (r.metal     > 0) parts.push(`ÔÜÖ ${r.metal.toLocaleString()}`);
          if (r.crystal   > 0) parts.push(`­ƒÆÄ ${r.crystal.toLocaleString()}`);
          if (r.deuterium > 0) parts.push(`­ƒÆº ${r.deuterium.toLocaleString()}`);
          return parts.length ? parts.join('  ') : 'ÔÇö';
        }

        _renderCard(p) {
          const other = p.is_mine ? p.target_name : p.initiator_name;
          const expires = new Date(p.expires_at).toLocaleDateString();
          const actions = [];
          if (p.status === 'pending') {
            if (!p.is_mine) {
              actions.push(`<button class="btn btn-sm" style="background:#3a8;" onclick="GQTradeProposalsController.doAccept(${p.id})">Ô£ô Accept</button>`);
              actions.push(`<button class="btn btn-sm" style="background:#844;" onclick="GQTradeProposalsController.doReject(${p.id})">Ô£ù Reject</button>`);
            } else {
              actions.push(`<button class="btn btn-sm btn-secondary" onclick="GQTradeProposalsController.doCancel(${p.id})">Ô£ò Cancel</button>`);
            }
          }
          return `<div style="border:1px solid #444;border-radius:6px;padding:8px;margin-bottom:6px;font-size:0.88em;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <strong>${esc(other)}</strong>
              ${this._statusBadge(p.status)}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px;">
              <div><span style="color:#aaa;">Offers:</span><br>${this._fmtRes(p.offer)}</div>
              <div><span style="color:#aaa;">Wants:</span><br>${this._fmtRes(p.request)}</div>
            </div>
            ${p.message ? `<div style="color:#aaa;font-size:0.85em;margin-bottom:4px;">"${esc(p.message)}"</div>` : ''}
            <div style="color:#666;font-size:0.8em;">Expires ${esc(expires)}</div>
            ${actions.length ? `<div style="display:flex;gap:4px;margin-top:6px;">${actions.join('')}</div>` : ''}
          </div>`;
        }

        showProposeDialog(targetId = 0, targetName = '', options = {}) {
          const existing = document.getElementById('trade-propose-dialog');
          if (existing) existing.remove();

          const config = getResourceInsightConfig(options.resourceKey);
          const focusMode = String(options.mode || 'request');
          const focusAmount = getSuggestedTradeAmount(config?.key || '', focusMode);
          const offerDefaults = { metal: 0, crystal: 0, deuterium: 0 };
          const requestDefaults = { metal: 0, crystal: 0, deuterium: 0 };
          if (config?.tradeable && ['offer', 'request'].includes(focusMode)) {
            if (focusMode === 'offer') offerDefaults[config.key] = focusAmount;
            else requestDefaults[config.key] = focusAmount;
          }

          const div = document.createElement('div');
          div.id = 'trade-propose-dialog';
          div.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:#1a1a2e;border:1px solid #444;border-radius:8px;padding:16px;min-width:320px;max-width:400px;';
          div.innerHTML = `
            <h3 style="margin:0 0 12px;">­ƒÆ▒ New Trade Proposal</h3>
            ${config?.tradeable ? `<div style="margin:-4px 0 10px;color:#9fb3d1;font-size:0.82em;">Fokus: ${esc(config.icon)} ${esc(config.label)} ┬À Bei Annahme starten echte Transportflotten. Flugzeit und Deuterium-Frachtkosten werden sofort gebunden.</div>` : ''}
            <label class="system-row">Target Player (username)</label>
            <input id="tp-target-name" type="text" placeholder="username" value="${esc(targetName)}" style="width:100%;box-sizing:border-box;" />
            <div style="margin-top:10px;font-weight:bold;">You Offer</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:4px;">
              <div><label style="font-size:0.8em;">ÔÜÖ Metal</label><input id="tp-om" type="number" min="0" value="${Math.round(offerDefaults.metal)}" style="width:100%;box-sizing:border-box;"/></div>
              <div><label style="font-size:0.8em;">­ƒÆÄ Crystal</label><input id="tp-oc" type="number" min="0" value="${Math.round(offerDefaults.crystal)}" style="width:100%;box-sizing:border-box;"/></div>
              <div><label style="font-size:0.8em;">­ƒÆº Deuterium</label><input id="tp-od" type="number" min="0" value="${Math.round(offerDefaults.deuterium)}" style="width:100%;box-sizing:border-box;"/></div>
            </div>
            <div style="margin-top:10px;font-weight:bold;">You Want</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:4px;">
              <div><label style="font-size:0.8em;">ÔÜÖ Metal</label><input id="tp-rm" type="number" min="0" value="${Math.round(requestDefaults.metal)}" style="width:100%;box-sizing:border-box;"/></div>
              <div><label style="font-size:0.8em;">­ƒÆÄ Crystal</label><input id="tp-rc" type="number" min="0" value="${Math.round(requestDefaults.crystal)}" style="width:100%;box-sizing:border-box;"/></div>
              <div><label style="font-size:0.8em;">­ƒÆº Deuterium</label><input id="tp-rd" type="number" min="0" value="${Math.round(requestDefaults.deuterium)}" style="width:100%;box-sizing:border-box;"/></div>
            </div>
            <label class="system-row" style="margin-top:10px;">Message (optional)</label>
            <input id="tp-msg" type="text" maxlength="500" placeholder="ÔÇª" style="width:100%;box-sizing:border-box;" />
            <label class="system-row" style="margin-top:10px;">Expires in (days)</label>
            <select id="tp-days" style="width:100%;box-sizing:border-box;">
              <option value="1">1 day</option>
              <option value="2" selected>2 days</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
            </select>
            <div id="tp-err" style="color:#d66;font-size:0.85em;margin-top:6px;min-height:1em;"></div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              <button class="btn" style="flex:1;" onclick="GQTradeProposalsController.doPropose()">Ô£ô Send</button>
              <button class="btn btn-secondary" onclick="document.getElementById('trade-propose-dialog').remove()">Cancel</button>
            </div>`;
          document.body.appendChild(div);
        }

        async doPropose() {
          const err = v => { const el = document.getElementById('tp-err'); if (el) el.textContent = v; };
          const targetName = (document.getElementById('tp-target-name')?.value ?? '').trim();
          if (!targetName) return err('Please enter a target player.');

          // Resolve username ÔåÆ id via leaderboard / players list
          let targetId = 0;
          try {
            const lb = await API.get('api/game.php?action=leaderboard');
            const match = (lb.leaderboard || lb.players || []).find(u =>
              (u.username || u.name || '').toLowerCase() === targetName.toLowerCase()
            );
            if (!match) return err('Player not found.');
            targetId = match.id || match.user_id;
          } catch (e) { return err('Could not resolve player: ' + e.message); }

          const data = {
            target_id:        targetId,
            offer_metal:      parseFloat(document.getElementById('tp-om')?.value || 0),
            offer_crystal:    parseFloat(document.getElementById('tp-oc')?.value || 0),
            offer_deuterium:  parseFloat(document.getElementById('tp-od')?.value || 0),
            request_metal:    parseFloat(document.getElementById('tp-rm')?.value || 0),
            request_crystal:  parseFloat(document.getElementById('tp-rc')?.value || 0),
            request_deuterium:parseFloat(document.getElementById('tp-rd')?.value || 0),
            message:          document.getElementById('tp-msg')?.value || '',
            expire_days:      parseInt(document.getElementById('tp-days')?.value || 2),
          };

          try {
            await API.proposeTrade(data);
            document.getElementById('trade-propose-dialog')?.remove();
            this.render();
          } catch (e) {
            err(e.message || 'Failed to send proposal.');
          }
        }

        async doAccept(id) {
          try {
            const response = await API.acceptTrade(id);
            const deliveries = Array.isArray(response?.deliveries) ? response.deliveries : [];
            if (response?.success) {
              const headline = deliveries.length
                ? deliveries.map((entry) => `${entry.resource_label || 'Transport'} ETA ${new Date(entry.arrival_time).toLocaleTimeString()}`).join(' ┬À ')
                : 'Transportauftrag gestartet.';
              showToast(headline, 'success');
              if (audioManager) audioManager.playUiConfirm();
              await loadOverview();
              WM.refresh('fleet');
            }
            this.render();
          } catch (e) {
            alert('Accept failed: ' + e.message);
          }
        }

        async doReject(id) {
          if (!confirm('Reject this trade proposal?')) return;
          try {
            await API.rejectTrade(id);
            this.render();
          } catch (e) {
            alert('Reject failed: ' + e.message);
          }
        }

        async doCancel(id) {
          if (!confirm('Cancel this proposal?')) return;
          try {
            await API.cancelTrade(id);
            this.render();
          } catch (e) {
            alert('Cancel failed: ' + e.message);
          }
        }
      }

      const tradeProposalsController = new TradeProposalsController();
      window.GQTradeProposalsController = tradeProposalsController;

  async function renderTradeProposals() {
    await tradeProposalsController.render();
  }

  class LeadersController {
    constructor() {
      this._tab = 'my_leaders'; // 'my_leaders' | 'marketplace'
      this.roleLabel = {
        colony_manager:    '­ƒÅù Colony Manager',
        fleet_commander:   'ÔÜö Fleet Commander',
        science_director:  '­ƒö¼ Science Director',
        diplomacy_officer: '­ƒòè Diplomacy Officer',
        trade_director:    '­ƒÆ░ Trade Director',
        advisor:           '­ƒºÖ Advisor',
      };
      this.rarityLabel = {
        common:    'Common',
        uncommon:  'Uncommon',
        rare:      'Rare',
        legendary: 'Ô£¿ Legendary',
      };
      this._styleInjected = false;
    }

    _injectCardStyles() {
      if (this._styleInjected) return;
      this._styleInjected = true;
      const s = document.createElement('style');
      s.textContent = `
        .leader-tab-bar { display:flex; gap:0.5rem; margin-bottom:0.9rem; border-bottom:1px solid var(--border,#333); padding-bottom:0.4rem; }
        .leader-tab-btn { background:none; border:none; color:var(--text-secondary,#aaa); cursor:pointer; padding:0.3rem 0.8rem; border-radius:4px 4px 0 0; font-size:0.85rem; }
        .leader-tab-btn.active { background:var(--accent,#4a9eff22); color:var(--accent,#4a9eff); border-bottom:2px solid var(--accent,#4a9eff); }
        .mkt-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:0.75rem; }
        .leader-card { background:var(--panel-bg,#1a1a2e); border:1px solid var(--border,#333); border-radius:8px; padding:0.75rem; display:flex; flex-direction:column; gap:0.3rem; position:relative; }
        .leader-card.rarity-uncommon { border-color:#4fc3f7; }
        .leader-card.rarity-rare     { border-color:#a78bfa; }
        .leader-card.rarity-legendary { border-color:#f59e0b; box-shadow:0 0 10px #f59e0b44; }
        .leader-card.is-hired { opacity:0.55; }
        .leader-portrait-lg { font-size:2.2rem; line-height:1; display:block; text-align:center; }
        .rarity-badge { font-size:0.64rem; font-weight:700; text-transform:uppercase; padding:1px 5px; border-radius:3px; position:absolute; top:0.45rem; right:0.45rem; }
        .rarity-badge.rarity-common    { background:#555; color:#ddd; }
        .rarity-badge.rarity-uncommon  { background:#0c4a6e; color:#7dd3fc; }
        .rarity-badge.rarity-rare      { background:#3b0764; color:#c4b5fd; }
        .rarity-badge.rarity-legendary { background:#78350f; color:#fcd34d; }
        .leader-card-name { font-weight:700; font-size:0.95rem; margin-top:0.2rem; }
        .leader-card-role { font-size:0.72rem; color:var(--text-secondary,#aaa); }
        .leader-card-tagline { font-size:0.74rem; font-style:italic; color:var(--accent,#4a9eff); margin-top:0.2rem; line-height:1.3; }
        .leader-card-traits { display:flex; flex-wrap:wrap; gap:0.25rem; margin-top:0.25rem; }
        .chip-trait { font-size:0.66rem; background:#333; color:#ccc; padding:1px 6px; border-radius:20px; }
        .skill-bar-row { display:flex; align-items:center; gap:0.3rem; margin-bottom:0.1rem; }
        .skill-bar-label { font-size:0.65rem; color:var(--text-secondary,#aaa); width:72px; flex-shrink:0; }
        .skill-bar-track { flex:1; height:4px; background:#333; border-radius:2px; overflow:hidden; }
        .skill-bar-fill  { height:100%; background:var(--accent,#4a9eff); border-radius:2px; transition:width 0.3s; }
        .leader-card-cost { font-size:0.75rem; color:#ccc; margin-top:0.3rem; }
        .leader-card-free { color:#4ade80; font-style:italic; }
        .advisor-hint-card { background:var(--panel-bg,#1a1a2e); border-left:3px solid var(--accent,#4a9eff); border-radius:0 6px 6px 0; padding:0.6rem 0.75rem; margin-bottom:0.5rem; }
        .advisor-hint-card.hint-warning  { border-left-color:#f59e0b; }
        .advisor-hint-card.hint-quest_hint { border-left-color:#a78bfa; }
        .advisor-hint-card.hint-action_required { border-left-color:#ef4444; }
        .advisor-hint-title { font-weight:700; font-size:0.85rem; }
        .advisor-hint-body  { font-size:0.78rem; color:var(--text-secondary,#aaa); margin-top:0.2rem; }
        #advisor-widget { position:fixed; bottom:3.2rem; left:0.8rem; z-index:900; }
        #advisor-bubble { background:var(--panel-bg,#1a1a2e); border:1px solid var(--accent,#4a9eff); border-radius:10px; padding:0.4rem 0.65rem; display:flex; align-items:center; gap:0.5rem; cursor:pointer; box-shadow:0 2px 12px #00000066; min-width:48px; }
        #advisor-bubble:hover { border-color:#7dd3fc; }
        #advisor-bubble-portrait { font-size:1.4rem; }
        #advisor-bubble-info { display:flex; flex-direction:column; line-height:1.2; }
        #advisor-bubble-name { font-size:0.7rem; font-weight:700; color:#ccc; }
        #advisor-bubble-badge { font-size:0.65rem; color:var(--accent,#4a9eff); }
      `;
      document.head.appendChild(s);
    }

    renderTabs(active) {
      return `<div class="leader-tab-bar">
        <button class="leader-tab-btn ${active === 'my_leaders' ? 'active' : ''}" data-tab="my_leaders">­ƒæñ My Leaders</button>
        <button class="leader-tab-btn ${active === 'marketplace' ? 'active' : ''}" data-tab="marketplace">­ƒøÆ Marketplace</button>
      </div>`;
    }

    renderMyLeaders(leaders) {
      const hasAdvisor = leaders.some((l) => l.role === 'advisor');
      const nonAdvisors = leaders.filter((l) => l.role !== 'advisor');
      const advisors    = leaders.filter((l) => l.role === 'advisor');

      return `
        ${!hasAdvisor ? `<div style="background:#1e3a2f;border:1px solid #4ade8066;border-radius:6px;padding:0.5rem 0.75rem;margin-bottom:0.75rem;font-size:0.8rem;">
          ­ƒºÖ <strong>No Advisor yet.</strong> Visit the <span style="color:var(--accent)">Marketplace</span> tab to hire a free Advisor who will guide you through the game.
        </div>` : ''}

        ${advisors.length ? `<div style="margin-bottom:0.75rem">
          <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.05em">Advisor</div>
          ${advisors.map((l) => `
            <div style="display:flex;align-items:center;gap:0.6rem;background:var(--panel-bg,#1a1a2e);border:1px solid var(--accent,#4a9eff);border-radius:7px;padding:0.5rem 0.75rem;">
              <span style="font-size:1.6rem">${esc(l.portrait || '­ƒºÖ')}</span>
              <div style="flex:1">
                <div style="font-weight:700">${esc(l.name)}</div>
                <div style="font-size:0.72rem;color:var(--text-secondary)">${this.rarityLabel[l.rarity] || ''} ┬À Lv ${l.level}</div>
                ${l.tagline ? `<div style="font-size:0.73rem;font-style:italic;color:var(--accent)">${esc(l.tagline)}</div>` : ''}
              </div>
              <button class="btn btn-danger btn-sm dismiss-btn" data-lid="${l.id}" title="Dismiss">Ô£ò</button>
            </div>`).join('')}
        </div>` : ''}

        <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.05em">Officers</div>
        <table class="data-table" style="width:100%;font-size:0.8rem">
          <thead><tr>
            <th></th><th>Name</th><th>Role</th><th>Lv</th><th>Assignment</th>
            <th>Autonomy</th><th>Last Action</th><th></th>
          </tr></thead>
          <tbody>
          ${nonAdvisors.length ? nonAdvisors.map((l) => `
            <tr>
              <td style="font-size:1.2rem;text-align:center">${esc(l.portrait || '­ƒæñ')}</td>
              <td>
                ${esc(l.name)}
                ${l.rarity && l.rarity !== 'common' ? `<span class="rarity-badge rarity-${l.rarity}" style="position:static;margin-left:4px">${this.rarityLabel[l.rarity]}</span>` : ''}
              </td>
              <td>${this.roleLabel[l.role] ?? l.role}</td>
              <td>${l.level}</td>
              <td>${l.colony_name
                ? `${esc(l.colony_name)} [${esc(l.colony_coords || '?')}]`
                : l.fleet_id ? `Fleet #${l.fleet_id}` : '<em>Unassigned</em>'}</td>
              <td>
                <select class="input-sm autonomy-sel" data-lid="${l.id}">
                  <option value="0" ${+l.autonomy === 0 ? 'selected' : ''}>Off</option>
                  <option value="1" ${+l.autonomy === 1 ? 'selected' : ''}>Suggest</option>
                  <option value="2" ${+l.autonomy === 2 ? 'selected' : ''}>Full Auto</option>
                </select>
              </td>
              <td style="font-size:0.72rem;max-width:170px;overflow:hidden;text-overflow:ellipsis"
                  title="${esc(l.last_action || '')}">
                ${l.last_action ? esc(l.last_action.substring(0, 55)) + 'ÔÇª' : 'ÔÇö'}
              </td>
              <td style="white-space:nowrap">
                <select class="input-sm assign-col-sel" data-lid="${l.id}">
                  <option value="">ÔÇö Colony ÔÇö</option>
                  ${colonies.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
                </select>
                <button class="btn btn-secondary btn-sm assign-col-btn" data-lid="${l.id}">Assign</button>
                <button class="btn btn-danger btn-sm dismiss-btn" data-lid="${l.id}">Ô£ò</button>
              </td>
            </tr>`).join('')
          : '<tr><td colspan="8" class="text-muted">No officers hired yet ÔÇö visit the Marketplace.</td></tr>'}
          </tbody>
        </table>
        <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="ai-tick-btn">ÔûÂ Run AI Tick</button>
        </div>`;
    }

    renderMarketplace(candidates) {
      const available = candidates.filter((c) => !c.is_hired);
      const hired     = candidates.filter((c) =>  c.is_hired);
      const expiresAt = candidates[0]?.expires_at;

      return `
        <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:0.65rem">
          ­ƒøÆ <strong>Marketplace</strong> ÔÇö ${available.length} candidate(s) available.
          ${expiresAt ? `Refreshes at <strong>${String(expiresAt).substring(0, 16)}</strong>.` : ''}
        </div>
        ${available.length === 0 ? '<p class="text-muted">Marketplace is empty. Come back in 24 hours.</p>' : ''}
        <div class="mkt-grid">
          ${[...available, ...hired].map((c) => this.renderCard(c)).join('')}
        </div>`;
    }

    renderCard(c) {
      const isHired = !!+c.is_hired;
      const skills  = this._skillsForRole(c.role, c);
      const mt = +c.hire_metal, cr = +c.hire_crystal, dt = +c.hire_deuterium;
      const free = mt === 0 && cr === 0 && dt === 0;
      return `
        <div class="leader-card rarity-${c.rarity} ${isHired ? 'is-hired' : ''}">
          <span class="rarity-badge rarity-${c.rarity}">${this.rarityLabel[c.rarity]}</span>
          <span class="leader-portrait-lg">${esc(c.portrait || '­ƒæñ')}</span>
          <div class="leader-card-name">${esc(c.name)}</div>
          <div class="leader-card-role">${this.roleLabel[c.role] ?? c.role}</div>
          <div class="leader-card-tagline">${esc(c.tagline)}</div>
          <div class="leader-card-traits">
            ${c.trait_1 ? `<span class="chip-trait">${esc(c.trait_1)}</span>` : ''}
            ${c.trait_2 ? `<span class="chip-trait">${esc(c.trait_2)}</span>` : ''}
          </div>
          <div style="margin-top:0.3rem">
            ${skills.map((s) => `
              <div class="skill-bar-row">
                <span class="skill-bar-label">${esc(s.label)}</span>
                <div class="skill-bar-track"><div class="skill-bar-fill" style="width:${Math.round(+s.val / 10 * 100)}%"></div></div>
                <span style="font-size:0.65rem;color:#aaa;width:16px;text-align:right">${s.val}</span>
              </div>`).join('')}
          </div>
          <details style="margin-top:0.35rem">
            <summary style="cursor:pointer;font-size:0.7rem;color:var(--text-secondary)">­ƒôû Background</summary>
            <p style="font-size:0.73rem;color:var(--text-secondary);margin-top:0.25rem;line-height:1.35">${esc(c.backstory)}</p>
          </details>
          <div class="leader-card-cost" style="margin-top:0.4rem">
            ${free
              ? '<span class="leader-card-free">Free</span>'
              : [mt > 0 ? `${(mt/1000).toFixed(0)}k Ô¼í` : '',
                 cr > 0 ? `${(cr/1000).toFixed(0)}k ­ƒÆÄ` : '',
                 dt > 0 ? `${(dt/1000).toFixed(0)}k ­ƒöÁ` : ''].filter(Boolean).join(' ')}
          </div>
          ${isHired
            ? `<button class="btn btn-secondary btn-sm" style="margin-top:0.4rem" disabled>Ô£ô Hired</button>`
            : `<button class="btn btn-primary btn-sm hire-candidate-btn" data-cid="${c.id}" style="margin-top:0.4rem">Hire</button>`
          }
        </div>`;
    }

    _skillsForRole(role, c) {
      const map = {
        colony_manager:    [{ label: 'Production',   val: c.skill_production   },
                            { label: 'Construction', val: c.skill_construction }],
        fleet_commander:   [{ label: 'Tactics',      val: c.skill_tactics      },
                            { label: 'Navigation',   val: c.skill_navigation   }],
        science_director:  [{ label: 'Research',     val: c.skill_research     },
                            { label: 'Efficiency',   val: c.skill_efficiency   }],
        diplomacy_officer: [{ label: 'Efficiency',   val: c.skill_efficiency   },
                            { label: 'Guidance',     val: c.skill_guidance     }],
        trade_director:    [{ label: 'Efficiency',   val: c.skill_efficiency   },
                            { label: 'Production',   val: c.skill_production   }],
        advisor:           [{ label: 'Guidance',     val: c.skill_guidance     },
                            { label: 'Research',     val: c.skill_research     }],
      };
      return map[role] || [{ label: 'Skill', val: 1 }];
    }

    bindTabs(root) {
      root.querySelectorAll('.leader-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._tab = btn.dataset.tab;
          WM.refresh('leaders');
        });
      });
    }

    bindHireButtons(root) {
      root.querySelectorAll('.hire-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const role    = btn.dataset.role;
          const nameEl  = root.querySelector(`.hire-name[data-role="${role}"]`);
          const name    = nameEl?.value.trim();
          if (!name) { showToast('Enter a name first.', 'error'); return; }
          const res = await API.hireLeader(name, role);
          if (res.success) {
            showToast(res.message, 'success');
            WM.refresh('leaders');
          } else {
            showToast(res.error || 'Failed', 'error');
          }
        });
      });
    }

    bindHireCandidateButtons(root) {
      root.querySelectorAll('.hire-candidate-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const cid = parseInt(btn.dataset.cid, 10);
          btn.disabled = true;
          const res = await API.hireCandidate(cid);
          if (res.success) {
            showToast(res.message, 'success');
            WM.refresh('leaders');
            AdvisorWidget.maybeRefresh();
          } else {
            showToast(res.error || 'Hire failed.', 'error');
            btn.disabled = false;
          }
        });
      });
    }

    bindAutonomyControls(root) {
      root.querySelectorAll('.autonomy-sel').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const res = await API.setAutonomy(parseInt(sel.dataset.lid, 10), parseInt(sel.value, 10));
          if (res.success) showToast(res.message, 'info');
          else showToast(res.error, 'error');
        });
      });
    }

    bindAssignmentControls(root) {
      root.querySelectorAll('.assign-col-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const lid = parseInt(btn.dataset.lid, 10);
          const sel = root.querySelector(`.assign-col-sel[data-lid="${lid}"]`);
          const cid = sel?.value ? parseInt(sel.value, 10) : null;
          const res = await API.assignLeader(lid, cid, null);
          if (res.success) {
            showToast(res.message, 'success');
            WM.refresh('leaders');
          } else {
            showToast(res.error, 'error');
          }
        });
      });
    }

    bindDismissControls(root) {
      root.querySelectorAll('.dismiss-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Dismiss this leader?')) return;
          const res = await API.dismissLeader(parseInt(btn.dataset.lid, 10));
          if (res.success) {
            showToast(res.message, 'success');
            WM.refresh('leaders');
            AdvisorWidget.maybeRefresh();
          } else {
            showToast(res.error, 'error');
          }
        });
      });
    }

    bindAiTick(root) {
      root.querySelector('#ai-tick-btn')?.addEventListener('click', async () => {
        const res = await API.aiTick();
        if (res.success) {
          const acts = res.actions || [];
          showToast(acts.length ? `AI: ${acts[0]}` : 'AI: No actions taken.', 'info');
          WM.refresh('leaders');
        }
      });
    }

    bindActions(root) {
      this.bindHireButtons(root);
      this.bindAutonomyControls(root);
      this.bindAssignmentControls(root);
      this.bindDismissControls(root);
      this.bindAiTick(root);
    }

    async render() {
      const root = WM.body('leaders');
      if (!root) return;
      this._injectCardStyles();
      root.innerHTML = '<p class="text-muted">LoadingÔÇª</p>';
      try {
        if (this._tab === 'marketplace') {
          const mkt = await API.leaderMarketplace();
          if (!mkt.success) { root.innerHTML = '<p class="error">Marketplace unavailable.</p>'; return; }
          root.innerHTML = this.renderTabs('marketplace') + this.renderMarketplace(mkt.candidates || []);
          this.bindTabs(root);
          this.bindHireCandidateButtons(root);
        } else {
          const data = await API.leaders();
          if (!data.success) { root.innerHTML = '<p class="error">Failed to load leaders.</p>'; return; }
          root.innerHTML = this.renderTabs('my_leaders') + this.renderMyLeaders(data.leaders || []);
          this.bindTabs(root);
          this.bindActions(root);
        }
      } catch (e) {
        root.innerHTML = `<p class="error">${esc(String(e))}</p>`;
      }
    }
  }

  const leadersController = new LeadersController();
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
      document.getElementById('advisor-bubble-portrait').textContent = _advisor.portrait || '­ƒºÖ';
      document.getElementById('advisor-bubble-name').textContent     = _advisor.name     || 'Advisor';
      const badge = document.getElementById('advisor-bubble-badge');
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

  class FactionsController {
    constructor() {
      this.conversations = new Map();
      this.lastFactions = [];
    }

    standingClass(value) {
      if (value >= 50) return 'chip-allied';
      if (value >= 10) return 'chip-friendly';
      if (value >= -10) return 'chip-neutral';
      if (value >= -50) return 'chip-hostile';
      return 'chip-war';
    }

    standingLabel(value) {
      if (value >= 50) return 'Allied';
      if (value >= 10) return 'Friendly';
      if (value >= -10) return 'Neutral';
      if (value >= -50) return 'Hostile';
      return 'War';
    }

    formatEffect(key, value) {
      const n = Number(value || 0);
      const sign = n > 0 ? '+' : '';
      const percentKeys = ['resource_output_mult', 'food_output_mult', 'pop_growth_mult', 'research_speed_mult', 'fleet_readiness_mult'];
      if (percentKeys.includes(String(key))) {
        return `${sign}${Math.round(n * 1000) / 10}%`;
      }
      return `${sign}${Math.round(n * 100) / 100}`;
    }

    effectLabel(key) {
      return ({
        resource_output_mult: 'Resource Output',
        food_output_mult: 'Food Output',
        pop_growth_mult: 'Population Growth',
        happiness_flat: 'Happiness',
        public_services_flat: 'Public Services',
        research_speed_mult: 'Research Speed',
        fleet_readiness_mult: 'Fleet Readiness',
      }[String(key)] || String(key));
    }

    buildMainView({ factions, politicsProfile, dynamicEffects, presets, activeUnrest, activeEvent }) {
      const effectRows = Object.entries(dynamicEffects || {})
        .filter(([key, value]) => !['faction_pressure_score', 'unrest_active', 'unrest_severity'].includes(String(key))
          && Number(value || 0) !== 0)
        .sort((a, b) => Math.abs(Number(b[1] || 0)) - Math.abs(Number(a[1] || 0)));

      const eventBanner = activeEvent
        ? `<div style="background:rgba(255,180,0,0.13);border:1px solid rgba(255,180,0,0.45);border-radius:6px;padding:0.55rem 0.8rem;margin-bottom:0.75rem;display:flex;gap:0.6rem;align-items:center">
            <span style="font-size:1.4rem">${esc(activeEvent.icon)}</span>
            <div>
              <strong>${esc(activeEvent.label)}</strong> ÔÇö galactic event active
              <div style="font-size:0.76rem;color:var(--text-secondary)">Ends in ~${esc(String(activeEvent.ends_in_min))} min ┬À Faction stats temporarily modified</div>
            </div>
          </div>`
        : '';

      return `
        ${eventBanner}
        <div class="system-card" style="margin-bottom:0.85rem">
          <h4 style="margin:0 0 0.35rem">Empire Politics</h4>
          ${politicsProfile ? `
            <div class="system-row">Species: <strong>${esc(politicsProfile.primary_species_key || 'n/a')}</strong></div>
            <div class="system-row">Government: <strong>${esc(politicsProfile.government_key || 'n/a')}</strong></div>
            <div class="system-row">Civics: ${(politicsProfile.civics || []).map((c) => esc(c.civic_key)).join(', ') || '<span class="text-muted">none</span>'}</div>
          ` : '<div class="system-row text-muted">Politics profile unavailable.</div>'}
          <div class="system-row" style="display:flex;gap:0.45rem;align-items:center;flex-wrap:wrap">
            <select id="politics-preset-select" class="input-sm" style="min-width:220px">
              <option value="">Preset w├ñhlenÔÇª</option>
              ${presets.map((p) => `<option value="${esc(p.preset_key)}">${esc(p.name)}</option>`).join('')}
            </select>
            <button id="politics-apply-preset-btn" class="btn btn-secondary btn-sm" type="button">Preset anwenden</button>
            <button id="politics-refresh-btn" class="btn btn-secondary btn-sm" type="button">Aktualisieren</button>
          </div>
          <div class="system-row" style="font-size:0.78rem;color:var(--text-muted)">
            Faction Pressure: <strong>${esc(String(dynamicEffects?.faction_pressure_score ?? 'n/a'))}</strong>
            ${Number(dynamicEffects?.unrest_active || 0) ? ` ┬À Unrest aktiv (Severity ${esc(String(Math.round(Number(dynamicEffects?.unrest_severity || 0) * 100) / 100))})` : ''}
          </div>
          <div style="margin-top:0.55rem">
            <table class="data-table" style="width:100%">
              <thead><tr><th>Effect</th><th>Value</th></tr></thead>
              <tbody>
                ${effectRows.length
                  ? effectRows.map(([key, value]) => `<tr><td>${esc(this.effectLabel(key))}</td><td>${esc(this.formatEffect(key, value))}</td></tr>`).join('')
                  : '<tr><td colspan="2" class="text-muted">Keine aktiven Modifikatoren.</td></tr>'}
              </tbody>
            </table>
          </div>
          ${activeUnrest ? `
            <div class="system-row" style="margin-top:0.55rem">
              <strong>Unrest Approach:</strong>
              Stage ${esc(String(activeUnrest.stage || '?'))} ┬À Progress ${esc(String(activeUnrest.progress || '?'))}
            </div>
            <div style="display:flex;gap:0.35rem;flex-wrap:wrap">
              <button class="btn btn-warning btn-sm unrest-approach-btn" data-approach="conciliation" data-sid="${esc(String(activeUnrest.id))}">Conciliation</button>
              <button class="btn btn-warning btn-sm unrest-approach-btn" data-approach="reforms" data-sid="${esc(String(activeUnrest.id))}">Reforms</button>
              <button class="btn btn-warning btn-sm unrest-approach-btn" data-approach="repression" data-sid="${esc(String(activeUnrest.id))}">Repression</button>
              <button class="btn btn-secondary btn-sm" id="unrest-tick-btn" data-sid="${esc(String(activeUnrest.id))}">Situation Tick</button>
            </div>
          ` : '<div class="system-row text-muted" style="margin-top:0.55rem">Kein aktiver Faction-Unrest.</div>'}
        </div>

        <div class="factions-grid">
          ${factions.map((faction) => `
            <div class="faction-card" data-fid="${faction.id}" style="border-color:${esc(faction.color)}">
              <div class="faction-header">
                <span class="faction-icon">${esc(faction.icon)}</span>
                <span class="faction-name" style="color:${esc(faction.color)}">${esc(faction.name)}</span>
                <span class="status-chip faction-standing-chip ${this.standingClass(faction.standing)}">
                  ${this.standingLabel(faction.standing)} (${faction.standing > 0 ? '+' : ''}${faction.standing})
                </span>
              </div>
              <p style="font-size:0.8rem;color:var(--text-secondary);margin:0.3rem 0 0.6rem">
                ${esc(faction.description)}
              </p>
              <div style="font-size:0.75rem;color:var(--text-muted)">
                ÔÜö Aggression: ${faction.aggression}/100 &nbsp;
                ­ƒÆ░ Trade: ${faction.trade_willingness}/100 &nbsp;
                Ô£à Quests done: ${faction.quests_done}
              </div>
              <div class="faction-last-event" style="font-size:0.72rem;color:var(--text-muted);margin-top:0.3rem">${faction.last_event ? esc(faction.last_event) : ''}</div>
              <div class="faction-actions" style="margin-top:0.6rem;display:flex;gap:0.4rem">
                <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="trade">­ƒÆ▒ Trade</button>
                <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="quests">­ƒôï Quests</button>
                <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="contact">­ƒù¿ Contact</button>
              </div>
            </div>`).join('')}
        </div>

        <div id="faction-detail" style="margin-top:1rem"></div>`;
    }

    bindMainActions(root) {
      root.querySelector('#politics-refresh-btn')?.addEventListener('click', async () => {
        await loadOverview();
        WM.refresh('factions');
      });

      root.querySelector('#politics-apply-preset-btn')?.addEventListener('click', async () => {
        const sel = root.querySelector('#politics-preset-select');
        const key = String(sel?.value || '').trim();
        if (!key) {
          showToast('Bitte ein Preset ausw├ñhlen.', 'warning');
          return;
        }
        const result = await API.applyPoliticsPreset(key);
        if (!result?.success) {
          showToast(result?.error || 'Preset konnte nicht angewendet werden.', 'error');
          return;
        }
        showToast('Politik-Preset angewendet.', 'success');
        await loadOverview();
        WM.refresh('factions');
      });

      root.querySelectorAll('.unrest-approach-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const sid = Number(btn.getAttribute('data-sid') || 0);
          const approach = String(btn.getAttribute('data-approach') || '').trim();
          if (!sid || !approach) return;
          const result = await API.setSituationApproach(sid, approach);
          if (!result?.success) {
            showToast(result?.error || 'Approach konnte nicht gesetzt werden.', 'error');
            return;
          }
          showToast(`Unrest-Approach auf ${approach} gesetzt.`, 'success');
          await API.tickSituations(sid).catch(() => null);
          await loadOverview();
          WM.refresh('factions');
        });
      });

      root.querySelector('#unrest-tick-btn')?.addEventListener('click', async () => {
        const sid = Number(root.querySelector('#unrest-tick-btn')?.getAttribute('data-sid') || 0);
        const result = await API.tickSituations(sid || undefined);
        if (!result?.success) {
          showToast(result?.error || 'Situation tick fehlgeschlagen.', 'error');
          return;
        }
        showToast('Situation getickt.', 'info');
        await loadOverview();
        WM.refresh('factions');
      });

      root.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => this.renderDetail(root, parseInt(btn.dataset.fid, 10), btn.dataset.act));
      });
    }

    getFactionById(fid) {
      return (this.lastFactions || []).find((faction) => Number(faction?.id || 0) === Number(fid || 0)) || null;
    }

    getConversationState(fid) {
      return this.conversations.get(Number(fid || 0)) || null;
    }

    setConversationState(fid, state) {
      this.conversations.set(Number(fid || 0), Object.assign({
        history: [],
        suggestedReplies: [],
        model: '',
        fallback: false,
        standingChange: null,
        questHook: null,
        loading: false,
      }, state || {}));
    }

    updateFactionSnapshot(fid, patch = {}) {
      const faction = this.getFactionById(fid);
      if (!faction || !patch || typeof patch !== 'object') return;
      Object.assign(faction, patch);
    }

    syncFactionCard(root, fid) {
      const card = root?.querySelector(`.faction-card[data-fid="${Number(fid || 0)}"]`);
      const faction = this.getFactionById(fid);
      if (!card || !faction) return;

      const chip = card.querySelector('.faction-standing-chip');
      if (chip) {
        chip.className = `status-chip faction-standing-chip ${this.standingClass(faction.standing)}`;
        chip.textContent = `${this.standingLabel(faction.standing)} (${faction.standing > 0 ? '+' : ''}${faction.standing})`;
      }

      const lastEvent = card.querySelector('.faction-last-event');
      if (lastEvent) {
        lastEvent.textContent = String(faction.last_event || '');
      }
    }

    buildConversationDetail(fid) {
      const faction = this.getFactionById(fid);
      const state = this.getConversationState(fid) || { history: [], suggestedReplies: [], model: '', fallback: false, standingChange: null, questHook: null, loading: true };
      const factionName = faction?.name || `Faction ${fid}`;
      const factionColor = faction?.color || '#88aaff';
      const factionIcon = faction?.icon || '­ƒæ¥';
      const standingChange = state.standingChange && typeof state.standingChange === 'object' ? state.standingChange : null;
      const standingDelta = Number(standingChange?.delta || 0);
      const questHook = state.questHook && typeof state.questHook === 'object' ? state.questHook : null;

      const transcriptHtml = state.history.length
        ? state.history.map((entry) => {
            const isNpc = entry.speaker === 'npc';
            const align = isNpc ? 'flex-start' : 'flex-end';
            const bg = isNpc ? 'rgba(80,120,255,0.16)' : 'rgba(255,255,255,0.08)';
            const border = isNpc ? factionColor : 'rgba(255,255,255,0.18)';
            const label = isNpc ? `${factionIcon} ${factionName}` : 'You';
            return `
              <div style="display:flex;justify-content:${align};margin-bottom:0.55rem;">
                <div style="max-width:85%;border:1px solid ${esc(border)};background:${bg};border-radius:10px;padding:0.55rem 0.7rem;">
                  <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:0.22rem">${esc(label)}</div>
                  <div style="line-height:1.4">${esc(entry.text)}</div>
                </div>
              </div>`;
          }).join('')
        : '<div class="text-muted">Opening channelÔÇª</div>';

      const standingEffectHtml = standingChange
        ? `
          <div style="margin-bottom:0.7rem;border:1px solid ${standingDelta >= 0 ? 'rgba(90,200,140,0.45)' : 'rgba(220,110,110,0.45)'};background:${standingDelta >= 0 ? 'rgba(90,200,140,0.12)' : 'rgba(220,110,110,0.12)'};border-radius:10px;padding:0.6rem 0.75rem;">
            <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.18rem">Diplomatic Shift</div>
            <div style="font-weight:600">Standing ${standingDelta >= 0 ? '+' : ''}${standingDelta} ÔåÆ ${esc(String(standingChange.after ?? faction?.standing ?? ''))}</div>
            <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:0.18rem">${esc(String(standingChange.reason || ''))}</div>
          </div>`
        : '';

      const questHookHtml = questHook
        ? `
          <div style="margin-bottom:0.7rem;border:1px solid rgba(255,210,90,0.38);background:rgba(255,210,90,0.08);border-radius:10px;padding:0.7rem 0.75rem;display:flex;justify-content:space-between;gap:0.8rem;align-items:center;">
            <div>
              <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.18rem">Quest Hook</div>
              <div style="font-weight:600">${esc(String(questHook.title || 'Available Assignment'))}</div>
              <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:0.18rem">${esc(String(questHook.description || ''))}</div>
              <div style="font-size:0.74rem;color:var(--text-muted);margin-top:0.18rem">${esc(String(questHook.hook_text || ''))}${Number(questHook.reward_standing || 0) ? ` Reward standing: +${esc(String(questHook.reward_standing))}` : ''}</div>
            </div>
            <button class="btn btn-primary btn-sm" id="faction-dialog-start-hook" data-fid="${fid}" data-fqid="${Number(questHook.quest_id || 0)}" type="button" ${questHook.started ? 'disabled' : ''}>${questHook.started ? 'Quest Started' : 'Start Quest'}</button>
          </div>`
        : '';

      const suggestionsHtml = (state.suggestedReplies || []).map((reply, index) => `
        <button class="btn btn-secondary btn-sm faction-dialog-suggestion" data-fid="${fid}" data-index="${index}" style="text-align:left;justify-content:flex-start">${esc(reply)}</button>
      `).join('');

      return `
        <div class="system-card">
          <div style="display:flex;justify-content:space-between;gap:0.8rem;align-items:center;margin-bottom:0.65rem">
            <div>
              <h4 style="margin:0">${esc(factionIcon)} Contact: ${esc(factionName)}</h4>
              <div style="font-size:0.74rem;color:var(--text-muted)">NPC opens first. Then you get 3 RPG-style responses plus free input.${state.model ? ` Model: ${esc(state.model)}` : ''}${state.fallback ? ' ┬À fallback reply' : ''}</div>
            </div>
            <button class="btn btn-secondary btn-sm" id="faction-dialog-restart" data-fid="${fid}" type="button">Restart</button>
          </div>
          ${standingEffectHtml}
          ${questHookHtml}
          <div style="background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:0.75rem;max-height:360px;overflow:auto;margin-bottom:0.7rem">
            ${transcriptHtml}
          </div>
          <div style="display:grid;gap:0.45rem;margin-bottom:0.7rem">
            ${suggestionsHtml || '<div class="text-muted">No suggested replies available.</div>'}
          </div>
          <div style="display:flex;gap:0.45rem;align-items:center">
            <input id="faction-dialog-input" type="text" maxlength="280" placeholder="Type your own responseÔÇª" style="flex:1;padding:0.55rem 0.7rem;border:1px solid #666;background:#0a0a0a;color:#fff;border-radius:8px;" ${state.loading ? 'disabled' : ''} />
            <button class="btn btn-primary btn-sm" id="faction-dialog-send" data-fid="${fid}" type="button" ${state.loading ? 'disabled' : ''}>Send</button>
          </div>
        </div>`;
    }

    bindConversationActions(root, fid) {
      const detail = root.querySelector('#faction-detail');
      if (!detail) return;

      detail.querySelectorAll('.faction-dialog-suggestion').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const state = this.getConversationState(fid);
          const index = Number(btn.getAttribute('data-index') || -1);
          const reply = state?.suggestedReplies?.[index] || '';
          if (!reply) return;
          await this.advanceConversation(root, fid, reply, false);
        });
      });

      detail.querySelector('#faction-dialog-send')?.addEventListener('click', async () => {
        const input = detail.querySelector('#faction-dialog-input');
        const value = String(input?.value || '').trim();
        if (!value) return;
        if (input) input.value = '';
        await this.advanceConversation(root, fid, value, false);
      });

      detail.querySelector('#faction-dialog-input')?.addEventListener('keydown', async (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const input = event.currentTarget;
        const value = String(input?.value || '').trim();
        if (!value) return;
        input.value = '';
        await this.advanceConversation(root, fid, value, false);
      });

      detail.querySelector('#faction-dialog-restart')?.addEventListener('click', async () => {
        await this.advanceConversation(root, fid, '', true);
      });

      detail.querySelector('#faction-dialog-start-hook')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        const fqid = Number(btn?.getAttribute('data-fqid') || 0);
        if (!fqid) return;
        btn.disabled = true;
        const response = await API.startFactionQuest(fqid);
        if (response?.success) {
          const current = this.getConversationState(fid) || {};
          const nextHook = current.questHook ? Object.assign({}, current.questHook, { started: true }) : null;
          this.setConversationState(fid, Object.assign({}, current, { questHook: nextHook }));
          detail.innerHTML = this.buildConversationDetail(fid);
          this.bindConversationActions(root, fid);
          showToast(response.message || 'Quest started.', 'success');
        } else {
          btn.disabled = false;
          showToast(response?.error || 'Quest could not be started.', 'error');
        }
      });
    }

    async advanceConversation(root, fid, playerInput = '', reset = false) {
      const detail = root.querySelector('#faction-detail');
      if (!detail) return;

      const current = reset ? null : this.getConversationState(fid);
      const history = reset ? [] : (current?.history || []);
      this.setConversationState(fid, Object.assign({}, current || {}, { loading: true, history }));
      detail.innerHTML = this.buildConversationDetail(fid);

      try {
        const response = await API.factionDialogue({
          faction_id: fid,
          history,
          player_input: reset ? '' : playerInput,
        });

        if (!response?.success) {
          throw new Error(response?.error || 'Dialogue request failed.');
        }

        this.setConversationState(fid, {
          history: Array.isArray(response.history) ? response.history : [],
          suggestedReplies: Array.isArray(response.suggested_replies) ? response.suggested_replies : [],
          model: String(response.model || ''),
          fallback: !!response.fallback,
          standingChange: response.standing_change && typeof response.standing_change === 'object' ? response.standing_change : null,
          questHook: response.quest_hook && typeof response.quest_hook === 'object' ? Object.assign({ started: false }, response.quest_hook) : null,
          loading: false,
        });
        if (response?.faction && Number.isFinite(Number(response.faction.standing))) {
          const standingChange = response.standing_change && typeof response.standing_change === 'object' ? response.standing_change : null;
          this.updateFactionSnapshot(fid, {
            standing: Number(response.faction.standing),
            last_event: standingChange?.reason ? `[dialogue] ${standingChange.reason}` : String(this.getFactionById(fid)?.last_event || ''),
          });
          this.syncFactionCard(root, fid);
        }
        detail.innerHTML = this.buildConversationDetail(fid);
        this.bindConversationActions(root, fid);
      } catch (err) {
        this.setConversationState(fid, Object.assign({}, current || {}, { loading: false }));
        detail.innerHTML = `<p class="error">${esc(String(err?.message || err || 'Dialogue failed.'))}</p>`;
        showToast('Faction dialogue failed.', 'error');
      }
    }

    async renderDetail(root, fid, mode) {
      const detail = root.querySelector('#faction-detail');
      if (!detail) return;
      detail.innerHTML = '<p class="text-muted">LoadingÔÇª</p>';

      if (mode === 'contact') {
        const existing = this.getConversationState(fid);
        if (existing) {
          detail.innerHTML = this.buildConversationDetail(fid);
          this.bindConversationActions(root, fid);
        } else {
          await this.advanceConversation(root, fid, '', true);
        }
        return;
      }

      if (mode === 'trade') {
        const data = await API.tradeOffers(fid);
        if (!data.success || !data.offers.length) {
          detail.innerHTML = '<p class="text-muted">No active trade offers from this faction.</p>';
          return;
        }
        detail.innerHTML = `
          <h4>Trade Offers (Standing: ${data.standing})</h4>
          <table class="data-table" style="width:100%">
            <thead><tr><th>They Offer</th><th>They Want</th><th>Expires</th><th>Claims</th><th></th></tr></thead>
            <tbody>${data.offers.map((offer) => `
              <tr>
                <td>Ô¼í ${offer.offer_amount.toLocaleString()} ${offer.offer_resource}</td>
                <td>Ô¼í ${offer.request_amount.toLocaleString()} ${offer.request_resource}</td>
                <td style="font-size:0.75rem">${new Date(offer.valid_until).toLocaleString()}</td>
                <td>${offer.claims_count}/${offer.max_claims}</td>
                <td><button class="btn btn-primary btn-sm trade-accept-btn" data-oid="${offer.id}">Accept</button></td>
              </tr>`).join('')}
            </tbody>
          </table>`;

        detail.querySelectorAll('.trade-accept-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!currentColony) {
              showToast('Select a colony first.', 'error');
              return;
            }
            const response = await API.acceptTrade(parseInt(btn.dataset.oid, 10), currentColony.id);
            if (response.success) {
              showToast(response.message, 'success');
              await loadOverview();
              await this.renderDetail(root, fid, 'trade');
            } else {
              showToast(response.error || 'Trade failed', 'error');
            }
          });
        });
        return;
      }

      const data = await API.factionQuests(fid);
      if (!data.success) {
        detail.innerHTML = '<p class="error">Failed to load quests.</p>';
        return;
      }
      const quests = data.quests || [];
      detail.innerHTML = `
        <h4>Faction Quests (Standing: ${data.standing})</h4>
        <div style="display:flex;flex-wrap:wrap;gap:0.75rem">
          ${quests.map((quest) => `
            <div class="quest-card" style="min-width:240px;max-width:320px">
              <div style="font-weight:bold">${esc(quest.title)}</div>
              <div style="font-size:0.75rem;color:var(--text-secondary);margin:0.2rem 0">${esc(quest.description)}</div>
              <div style="font-size:0.72rem">
                Difficulty: <strong>${quest.difficulty}</strong> &nbsp;
                Type: ${quest.quest_type}
              </div>
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem">
                Reward: ${quest.reward_metal ? 'Ô¼í' + quest.reward_metal + ' ' : ''} ${quest.reward_crystal ? '­ƒÆÄ' + quest.reward_crystal + ' ' : ''}
                        ${quest.reward_rank_points ? 'Ôÿà' + quest.reward_rank_points : ''} ${quest.reward_standing ? '+' + quest.reward_standing + ' ­ƒñØ' : ''}
              </div>
              ${quest.taken
                ? '<span class="status-chip chip-neutral">Active / Done</span>'
                : `<button class="btn btn-primary btn-sm start-fq-btn" data-fqid="${quest.id}" style="margin-top:0.4rem">Start Quest</button>`}
            </div>`).join('')}
          ${!quests.length ? '<p class="text-muted">No quests available at your current standing.</p>' : ''}
        </div>`;

      detail.querySelectorAll('.start-fq-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const response = await API.startFactionQuest(parseInt(btn.dataset.fqid, 10));
          if (response.success) {
            showToast(response.message, 'success');
            await this.renderDetail(root, fid, 'quests');
          } else {
            showToast(response.error || 'Failed', 'error');
          }
        });
      });
    }

    async render() {
      const root = WM.body('factions');
      if (!root) return;
      root.innerHTML = uiKitSkeletonHTML();
      try {
        const [factionsData, politicsData, presetsData, unrestData] = await Promise.all([
          API.factions(),
          API.politicsStatus().catch(() => ({ success: false })),
          API.politicsPresets().catch(() => ({ success: false })),
          API.situations('active', 100).catch(() => ({ success: false })),
        ]);
        if (!factionsData.success) {
          root.innerHTML = '<p class="error">Failed.</p>';
          return;
        }
        const factions = factionsData.factions || [];
        this.lastFactions = factions;
        const activeEvent = factionsData.active_event || null;
        const politicsProfile = politicsData?.profile || null;
        const dynamicEffects = politicsData?.dynamic_effects || window._GQ_politics?.effects || {};
        const presets = Array.isArray(presetsData?.presets) ? presetsData.presets : [];
        const activeUnrest = (unrestData?.situations || []).find((s) => String(s?.situation_type || '') === 'faction_unrest') || null;
        root.innerHTML = this.buildMainView({ factions, politicsProfile, dynamicEffects, presets, activeUnrest, activeEvent });
        if (!factions.length) {
          const detail = root.querySelector('#faction-detail');
          if (detail) {
            detail.innerHTML = uiKitEmptyStateHTML('No factions available', 'Faction data is currently unavailable in this sector.');
          }
        }
        this.bindMainActions(root);
      } catch (e) {
        root.innerHTML = `<p class="error">${esc(String(e))}</p>`;
      }
    }
  }

  const factionsController = new FactionsController();
  window.GQFactionsController = factionsController;

  async function renderFactions() {
    await factionsController.render();
  }

  class LeaderboardController {
    async render() {
      const root = WM.body('leaderboard');
      if (!root) return;
      root.innerHTML = uiKitSkeletonHTML();
      try {
        const data = await API.leaderboard();
        if (!data.success) {
          root.innerHTML = '<p class="text-red">Error.</p>';
          return;
        }
        if (!data.leaderboard.length) {
          root.innerHTML = uiKitEmptyStateHTML('No players yet', 'Leaderboard will populate as commanders expand their empires.');
          return;
        }

        root.innerHTML = data.leaderboard.map((row, index) => `
          <div class="lb-row">
            <span class="lb-rank">${index + 1}</span>
            <span class="lb-name">${esc(row.username)} ${row.username === currentUser.username ? '(You)' : ''}${row.alliance_tag ? ` <span class="lb-alliance-tag">[${esc(row.alliance_tag)}]</span>` : ''}</span>
            <span class="lb-stat">Ôÿà ${fmt(row.rank_points)} RP</span>
            <span class="lb-stat">­ƒîì ${row.planet_count}</span>
            <span class="lb-stat">Ôùå ${fmt(row.dark_matter)}</span>
          </div>`).join('');
      } catch (_) {
        root.innerHTML = '<p class="text-red">Failed to load leaderboard.</p>';
      }
    }
  }

  const leaderboardController = new LeaderboardController();
  window.GQLeaderboardController = leaderboardController;

  async function renderLeaderboard() {
    await leaderboardController.render();
  }

  // ÔöÇÔöÇ Minimap ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const MINIMAP_PAD = 14;           // canvas padding in px
  const MINIMAP_GRID_DIVS = 5;     // number of grid lines per axis
  const MINIMAP_CLICK_RADIUS = 18; // max click distance in px to select a star

  function renderMinimap(root) {
    if (!root) return;

    // Ensure wrapper exists
    let wrap = root.querySelector('.minimap-wrap');
    if (!wrap) {
      root.innerHTML = '';
      wrap = document.createElement('div');
      wrap.className = 'minimap-wrap';
      root.appendChild(wrap);
    }

    // Ensure canvas exists
    let canvas = wrap.querySelector('.minimap-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'minimap-canvas';
      wrap.appendChild(canvas);

      // Click-to-navigate: find closest star and open galaxy map at it
      canvas.addEventListener('click', (e) => {
        const state = canvas.__minimapState;
        if (!state || !state.stars.length) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        let best = null;
        let bestDist = Infinity;
        for (const star of state.stars) {
          const cx = state.offX + (Number(star.x_ly || 0) - state.minX) * state.scale;
          const cy = state.offY + (Number(star.y_ly || 0) - state.minY) * state.scale;
          const d = Math.hypot(mx - cx, my - cy);
          if (d < bestDist) { bestDist = d; best = star; }
        }
        if (best && bestDist < MINIMAP_CLICK_RADIUS) {
          WM.open('galaxy');
          window.dispatchEvent(new CustomEvent('gq:minimap-navigate', {
            detail: { galaxy: Number(best.galaxy_index || uiState.activeGalaxy || 1), system: Number(best.system_index || 0), star: best },
          }));
        }
      });
    }

    // Size canvas to wrapper
    const w = Math.max(100, wrap.clientWidth || 260);
    const h = Math.max(100, wrap.clientHeight || 260);
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background
    ctx.fillStyle = '#050d1e';
    ctx.fillRect(0, 0, w, h);

    const stars = Array.isArray(galaxyStars) ? galaxyStars.filter((s) => s.x_ly != null && s.y_ly != null) : [];

    if (!stars.length) {
      ctx.fillStyle = 'rgba(80, 140, 200, 0.6)';
      ctx.font = '11px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Galaxy data loadingÔÇª', w / 2, h / 2);
      canvas.__minimapState = null;
      return;
    }

    // Compute bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
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

    // Store transform state for click handler
    canvas.__minimapState = { minX, minY, scale, offX, offY, stars };

    // Subtle grid lines
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

    // Build lookup sets for own colonies and current system
    const ownColonySystems = new Set(
      (Array.isArray(colonies) ? colonies : []).map((col) => Number(col.system || col.system_index || 0)).filter(Boolean)
    );
    const currentSysIdx = Number(currentColony?.system || currentColony?.system_index || 0);

    // Draw stars
    for (const star of stars) {
      const sx = Number(star.x_ly);
      const sy = Number(star.y_ly);
      const cx = offX + (sx - minX) * scale;
      const cy = offY + (sy - minY) * scale;
      const sysIdx = Number(star.system_index || 0);
      const isOwn = sysIdx > 0 && ownColonySystems.has(sysIdx);
      const isCurrent = currentSysIdx > 0 && sysIdx === currentSysIdx;

      if (isCurrent) {
        // Current system: bright yellow with outer ring
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffe066';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 224, 102, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (isOwn) {
        // Own colony: green dot
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#44ee88';
        ctx.fill();
      } else {
        // Regular star: colour by spectral class
        ctx.beginPath();
        ctx.arc(cx, cy, 1, 0, Math.PI * 2);
        ctx.fillStyle = starClassColor(star.spectral_class);
        ctx.fill();
      }
    }

    // Legend (bottom-left)
    ctx.font = '9px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(100, 160, 220, 0.6)';
    ctx.fillText(`${stars.length} stars`, 5, h - 5);
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
      renderGalaxySystemDetails(root, target, !!galaxy3d?.systemMode);
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
      applyRuntimeSettings();
      saveUiSettings();
    });

    const fleetVectors = root.querySelector('#set-galaxy-fleet-vectors');
    fleetVectors?.addEventListener('change', () => {
      settingsState.galaxyFleetVectorsVisible = !!fleetVectors.checked;
      applyRuntimeSettings();
      saveUiSettings();
      const galaxyRoot = WM.body('galaxy');
      if (galaxyRoot?.querySelector('#galaxy-system-details')) {
        const activeStar = pinnedStar || uiState.activeStar || null;
        renderGalaxySystemDetails(galaxyRoot, activeStar, !!galaxy3d?.systemMode);
      }
    });

    const homeEnterSystem = root.querySelector('#set-home-enter-system');
    homeEnterSystem?.addEventListener('change', () => {
      settingsState.homeEnterSystem = !!homeEnterSystem.checked;
      saveUiSettings();
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
      applyRuntimeSettings();
      saveUiSettings();
    });

    bindRange('#set-hover-distance', '#set-hover-distance-value', (v) => {
      settingsState.persistentHoverDistance = Math.max(120, v);
      applyRuntimeSettings();
      saveUiSettings();
    });

    bindRange('#set-transition-ms', '#set-transition-ms-value', (v) => {
      settingsState.transitionStableMinMs = Math.max(80, v);
      applyRuntimeSettings();
      saveUiSettings();
    });

    const masterMute = root.querySelector('#set-master-mute');
    masterMute?.addEventListener('change', () => {
      settingsState.masterMuted = !!masterMute.checked;
      if (audioManager) audioManager.setMasterMuted(settingsState.masterMuted);
      saveUiSettings();
      refreshAudioUi();
    });
    const musicMute = root.querySelector('#set-music-mute');
    musicMute?.addEventListener('change', () => {
      settingsState.musicMuted = !!musicMute.checked;
      if (audioManager) audioManager.setMusicMuted(settingsState.musicMuted);
      saveUiSettings();
    });
    const sfxMute = root.querySelector('#set-sfx-mute');
    sfxMute?.addEventListener('change', () => {
      settingsState.sfxMuted = !!sfxMute.checked;
      if (audioManager) audioManager.setSfxMuted(settingsState.sfxMuted);
      saveUiSettings();
    });

    bindRange('#set-master-vol', '#set-master-vol-value', (v) => {
      settingsState.masterVolume = Math.max(0, Math.min(1, v / 100));
      if (audioManager) audioManager.setMasterVolume(settingsState.masterVolume);
      saveUiSettings();
    });
    bindRange('#set-music-vol', '#set-music-vol-value', (v) => {
      settingsState.musicVolume = Math.max(0, Math.min(1, v / 100));
      if (audioManager) audioManager.setMusicVolume(settingsState.musicVolume);
      saveUiSettings();
    });
    bindRange('#set-sfx-vol', '#set-sfx-vol-value', (v) => {
      settingsState.sfxVolume = Math.max(0, Math.min(1, v / 100));
      if (audioManager) audioManager.setSfxVolume(settingsState.sfxVolume);
      saveUiSettings();
    });

    root.querySelector('#set-audio-test')?.addEventListener('click', () => {
      if (audioManager) audioManager.playUiConfirm();
    });

    const transitionModeSelect = root.querySelector('#set-music-transition-mode');
    transitionModeSelect?.addEventListener('change', () => {
      const mode = String(transitionModeSelect.value || 'fade').toLowerCase() === 'cut' ? 'cut' : 'fade';
      settingsState.musicTransitionMode = mode;
      if (audioManager && typeof audioManager.setMusicTransitionMode === 'function') {
        audioManager.setMusicTransitionMode(mode);
      }
      saveUiSettings();
    });

    root.querySelector('#set-music-preset')?.addEventListener('change', () => {
      const preset = String(root.querySelector('#set-music-preset')?.value || '').trim();
      if (!preset) return;
      const urlInput = root.querySelector('#set-music-url');
      if (urlInput) urlInput.value = preset;
      const playerSelect = root.querySelector('#set-player-track');
      if (playerSelect) playerSelect.value = preset;
      ['galaxy', 'system', 'battle', 'ui'].forEach((sceneKey) => {
        const input = root.querySelector(`#set-scene-${sceneKey}`);
        if (input && !String(input.value || '').trim()) {
          input.value = preset;
        }
      });
    });

    const playerSelect = root.querySelector('#set-player-track');
    const playerToggleBtn = root.querySelector('#set-player-toggle');
    const playerPrevBtn = root.querySelector('#set-player-prev');
    const playerNextBtn = root.querySelector('#set-player-next');

    const setActiveTrack = (url, autoplay = false) => {
      const next = String(url || '').trim();
      if (!next) return;
      settingsState.musicUrl = next;
      const urlInput = root.querySelector('#set-music-url');
      if (urlInput) urlInput.value = next;
      if (playerSelect) playerSelect.value = next;
      if (audioManager) {
        audioManager.setMusicTrack(next, autoplay);
      }
      saveUiSettings();
    };

    const updatePlayerToggleLabel = () => {
      if (!playerToggleBtn) return;
      const isPlaying = !!(audioManager && audioManager.snapshot && audioManager.snapshot().musicPlaying);
      playerToggleBtn.textContent = isPlaying ? 'Pause' : 'Play';
    };

    const shiftTrack = async (dir) => {
      if (!audioTrackOptions.length) return;
      if (audioManager && typeof audioManager.playNextInPlaylist === 'function') {
        const ok = await audioManager.playNextInPlaylist(dir, true);
        if (!ok) showToast('Track konnte nicht gestartet werden.', 'warning');
        const snap = audioManager.snapshot ? audioManager.snapshot() : null;
        const currentUrl = String(snap?.musicUrl || '').trim();
        if (currentUrl) {
          settingsState.musicUrl = currentUrl;
          if (playerSelect) playerSelect.value = currentUrl;
        }
        saveUiSettings();
        refreshAudioUi();
        updatePlayerToggleLabel();
        return;
      }
      const currentUrl = String(playerSelect?.value || settingsState.musicUrl || '').trim();
      let idx = audioTrackOptions.findIndex((entry) => String(entry.value) === currentUrl);
      if (idx < 0) idx = 0;
      const nextIdx = (idx + dir + audioTrackOptions.length) % audioTrackOptions.length;
      const nextTrack = String(audioTrackOptions[nextIdx]?.value || '').trim();
      if (!nextTrack) return;
      setActiveTrack(nextTrack, false);
      if (audioManager) {
        const ok = await audioManager.playMusic();
        if (!ok) showToast('Track konnte nicht gestartet werden.', 'warning');
      }
      updatePlayerToggleLabel();
    };

    if (playerSelect) {
      const preselect = String(audioState.musicUrl || settingsState.musicUrl || audioTrackOptions[0]?.value || '').trim();
      if (preselect) playerSelect.value = preselect;
      playerSelect.addEventListener('change', () => {
        const selected = String(playerSelect.value || '').trim();
        if (!selected) return;
        setActiveTrack(selected, false);
      });
    }

    playerPrevBtn?.addEventListener('click', async () => {
      await shiftTrack(-1);
    });

    playerNextBtn?.addEventListener('click', async () => {
      await shiftTrack(1);
    });

    playerToggleBtn?.addEventListener('click', async () => {
      if (!audioManager) {
        showToast('Audio-Manager nicht verf├╝gbar.', 'warning');
        return;
      }

      const hasTrack = String(playerSelect?.value || settingsState.musicUrl || '').trim();
      if (hasTrack && String(audioManager.snapshot()?.musicUrl || '').trim() !== hasTrack) {
        setActiveTrack(hasTrack, false);
      }

      const isPlaying = !!audioManager.snapshot()?.musicPlaying;
      if (isPlaying) {
        if (typeof audioManager.pauseMusic === 'function') {
          audioManager.pauseMusic(false);
        } else {
          audioManager.stopMusic();
        }
      } else {
        const ok = await audioManager.playMusic();
        if (!ok) showToast('Musik konnte nicht gestartet werden.', 'warning');
      }
      updatePlayerToggleLabel();
    });

    updatePlayerToggleLabel();

    loadAudioTrackCatalog();

    const autoSceneMusic = root.querySelector('#set-auto-scene-music');
    autoSceneMusic?.addEventListener('change', () => {
      settingsState.autoSceneMusic = !!autoSceneMusic.checked;
      if (audioManager && typeof audioManager.setAutoSceneMusic === 'function') {
        audioManager.setAutoSceneMusic(settingsState.autoSceneMusic);
      }
      saveUiSettings();
    });

    root.querySelector('#set-scene-apply')?.addEventListener('click', () => {
      const galaxyTrack = String(root.querySelector('#set-scene-galaxy')?.value || '').trim();
      const systemTrack = String(root.querySelector('#set-scene-system')?.value || '').trim();
      const battleTrack = String(root.querySelector('#set-scene-battle')?.value || '').trim();
      const uiTrack = String(root.querySelector('#set-scene-ui')?.value || '').trim();
      settingsState.sceneTracks = Object.assign({}, settingsState.sceneTracks, {
        galaxy: galaxyTrack,
        system: systemTrack,
        battle: battleTrack,
        ui: uiTrack,
      });
      if (audioManager && typeof audioManager.setSceneTrack === 'function') {
        audioManager.setSceneTrack('galaxy', galaxyTrack);
        audioManager.setSceneTrack('system', systemTrack);
        audioManager.setSceneTrack('battle', battleTrack);
        audioManager.setSceneTrack('ui', uiTrack);
      }
      saveUiSettings();
      showToast('Szenenmusik gespeichert.', 'success');
    });

    root.querySelector('#set-sfx-apply')?.addEventListener('click', () => {
      const nextMap = Object.assign({}, settingsState.sfxMap);
      root.querySelectorAll('.set-sfx-select').forEach((node) => {
        const key = String(node.getAttribute('data-sfx-key') || '').trim();
        if (!key) return;
        nextMap[key] = String(node.value || '').trim();
      });
      settingsState.sfxMap = nextMap;
      if (audioManager && typeof audioManager.setSfxTrack === 'function') {
        Object.entries(nextMap).forEach(([key, track]) => audioManager.setSfxTrack(key, track));
      }
      saveUiSettings();
      showToast('SFX-Zuordnung gespeichert.', 'success');
    });

    root.querySelector('#set-audio-reset')?.addEventListener('click', () => {
      settingsState.musicUrl = '';
      settingsState.autoSceneMusic = true;
      settingsState.sceneTracks = {
        galaxy: 'music/Nebula_Overture.mp3',
        system: 'music/Nebula_Overture.mp3',
        battle: 'music/Nebula_Overture.mp3',
        ui: 'music/Nebula_Overture.mp3',
      };
      settingsState.sfxMap = {
        uiClick: 'sfx/mixkit-video-game-retro-click-237.wav',
        uiConfirm: 'sfx/mixkit-quick-positive-video-game-notification-interface-265.wav',
        uiError: 'sfx/mixkit-negative-game-notification-249.wav',
        uiNotify: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
        navigation: 'sfx/mixkit-sci-fi-warp-slide-3113.wav',
        pvpToggle: 'sfx/mixkit-horn-suspense-transition-3112.wav',
        researchStart: 'sfx/mixkit-unlock-new-item-game-notification-254.wav',
        researchComplete: 'sfx/mixkit-casino-bling-achievement-2067.wav',
        fleetRecall: 'sfx/mixkit-space-shot-whoosh-3001.wav',
        messageSend: 'sfx/mixkit-space-coin-win-notification-271.wav',
        messageRead: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
        messageDelete: 'sfx/mixkit-falling-hit-757.wav',
        fleetAttack: 'sfx/mixkit-laser-gun-shot-3110.wav',
        fleetTransport: 'sfx/mixkit-space-deploy-whizz-3003.wav',
        fleetSpy: 'sfx/mixkit-night-vision-starting-2476.wav',
        fleetColonize: 'sfx/mixkit-medieval-show-fanfare-announcement-226.wav',
        fleetHarvest: 'sfx/mixkit-space-plasma-shot-3002.wav',
        buildComplete: 'sfx/mixkit-bonus-earned-in-video-game-2058.wav',
        fleetLaunch: 'sfx/mixkit-space-deploy-whizz-3003.wav',
      };
      if (audioManager) {
        if (typeof audioManager.resetAudioDefaults === 'function') {
          audioManager.resetAudioDefaults();
        }
        if (typeof audioManager.setAutoSceneMusic === 'function') {
          audioManager.setAutoSceneMusic(true);
        }
      }
      saveUiSettings();
      renderSettings();
      showToast('Audio auf Standardwerte zur├╝ckgesetzt.', 'success');
    });

    root.querySelectorAll('.set-sfx-test').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!audioManager) return;
        const method = String(btn.getAttribute('data-sfx-test') || '').trim();
        if (method && typeof audioManager[method] === 'function') {
          audioManager[method]();
        }
      });
    });

    root.querySelector('#set-scene-preview-galaxy')?.addEventListener('click', async () => {
      if (!audioManager || typeof audioManager.setScene !== 'function') return;
      audioManager.setScene('galaxy', { autoplay: true, transition: 'dramatic', force: true });
      const ok = await audioManager.playMusic();
      if (!ok) showToast('Galaxy-Track konnte nicht gestartet werden.', 'warning');
    });
    root.querySelector('#set-scene-preview-system')?.addEventListener('click', async () => {
      if (!audioManager || typeof audioManager.setScene !== 'function') return;
      audioManager.setScene('system', { autoplay: true, transition: 'dramatic', force: true });
      const ok = await audioManager.playMusic();
      if (!ok) showToast('System-Track konnte nicht gestartet werden.', 'warning');
    });
    root.querySelector('#set-scene-preview-battle')?.addEventListener('click', async () => {
      if (!audioManager || typeof audioManager.setScene !== 'function') return;
      audioManager.setScene('battle', { autoplay: true, transition: 'dramatic', force: true });
      const ok = await audioManager.playMusic();
      if (!ok) showToast('Battle-Track konnte nicht gestartet werden.', 'warning');
    });
    root.querySelector('#set-scene-preview-ui')?.addEventListener('click', async () => {
      if (!audioManager || typeof audioManager.setScene !== 'function') return;
      audioManager.setScene('ui', { autoplay: true, transition: 'dramatic', force: true });
      const ok = await audioManager.playMusic();
      if (!ok) showToast('UI-Track konnte nicht gestartet werden.', 'warning');
    });

    root.querySelector('#set-music-apply')?.addEventListener('click', () => {
      const urlInput = root.querySelector('#set-music-url');
      const next = String(urlInput?.value || '').trim();
      settingsState.musicUrl = next;
      if (audioManager) audioManager.setMusicTrack(next, false);
      saveUiSettings();
      showToast(next ? 'Musik-URL gespeichert.' : 'Musik-URL entfernt.', 'info');
    });
    root.querySelector('#set-music-play')?.addEventListener('click', async () => {
      if (!audioManager) return;
      const ok = await audioManager.playMusic();
      if (!ok) showToast('Musik konnte nicht gestartet werden (Autoplay/URL).', 'warning');
    });
    root.querySelector('#set-music-stop')?.addEventListener('click', () => {
      if (audioManager) audioManager.stopMusic();
    });

    const llmProfileSelect = root.querySelector('#set-llm-profile');
    const llmInputVars = root.querySelector('#set-llm-input-vars');
    const llmOutput = root.querySelector('#set-llm-output');
    const npcStatusLine = root.querySelector('#set-npc-status-line');
    const npcSummaryHours = root.querySelector('#set-npc-summary-hours');
    const npcSummaryOut = root.querySelector('#set-npc-summary');
    const npcDecisions = root.querySelector('#set-npc-decisions');

    const writeLlmOutput = (value) => {
      if (!llmOutput) return;
      llmOutput.value = String(value || '');
    };

    const writeNpcDecisions = (value) => {
      if (!npcDecisions) return;
      npcDecisions.value = String(value || '');
    };

    const writeNpcSummary = (value) => {
      if (!npcSummaryOut) return;
      npcSummaryOut.textContent = String(value || '');
    };

    const loadNpcControllerStatus = async () => {
      const res = await API.npcControllerStatus();
      if (!res.success) {
        if (npcStatusLine) npcStatusLine.textContent = `Fehler: ${String(res.error || 'Status konnte nicht geladen werden.')}`;
        return;
      }
      const c = res.controller || {};
      const t = res.tick || {};
      const m = res.metrics || {};
      const parts = [
        `enabled=${c.enabled ? 'yes' : 'no'}`,
        `ollama=${c.ollama_enabled ? 'yes' : 'no'}`,
        `cooldown=${Number(c.cooldown_seconds || 0)}s`,
        `min_conf=${Number(c.min_confidence || 0)}`,
        `last_tick=${t.last_npc_tick || 'n/a'}`,
        `decisions_24h=${Number(m.decisions_last_24h || 0)}`,
      ];
      if (npcStatusLine) npcStatusLine.textContent = parts.join(' | ');
    };

    const loadNpcDecisions = async () => {
      const res = await API.npcControllerDecisions({ limit: 10 });
      writeNpcDecisions(JSON.stringify(res, null, 2));
      if (!res.success) showToast(res.error || 'NPC decisions konnten nicht geladen werden.', 'error');
    };

    const loadNpcSummary = async () => {
      const hours = Math.max(1, Math.min(168, Number(npcSummaryHours?.value || 24)));
      const res = await API.npcControllerSummary({ hours });
      if (!res.success) {
        writeNpcSummary(JSON.stringify(res, null, 2));
        showToast(res.error || 'NPC summary konnte nicht geladen werden.', 'error');
        return;
      }

      const metrics = res.metrics || {};
      const byAction = Array.isArray(res.by_action) ? res.by_action : [];
      const recentErrors = Array.isArray(res.recent_errors) ? res.recent_errors : [];
      const actionRows = byAction.map((row) => {
        const key = String(row.action_key || 'none');
        return `${key.padEnd(16, ' ')} total=${Number(row.total || 0)} exec=${Number(row.executed || 0)} err=${Number(row.errors || 0)} conf=${Number(row.avg_confidence || 0).toFixed(3)}`;
      });

      const errorRows = recentErrors.map((row) => {
        const when = String(row.created_at || 'n/a');
        const msg = String(row.error_message || row.reasoning || 'error').replace(/\s+/g, ' ').slice(0, 140);
        return `- [${when}] ${msg}`;
      });

      writeNpcSummary([
        `window_hours=${Number(res.window_hours || hours)}`,
        `faction_id=${Number(res.faction_id || 0)}`,
        `total=${Number(metrics.total || 0)} | executed=${Number(metrics.executed || 0)} | blocked=${Number(metrics.blocked || 0)} | errors=${Number(metrics.errors || 0)}`,
        `avg_confidence=${Number(metrics.avg_confidence || 0).toFixed(3)} | executed_ratio=${(Number(metrics.executed_ratio || 0) * 100).toFixed(1)}%`,
        '',
        'by_action:',
        ...(actionRows.length ? actionRows : ['(no rows)']),
        '',
        'recent_errors:',
        ...(errorRows.length ? errorRows : ['(none)']),
      ].join('\n'));
    };

    const loadLlmProfiles = async () => {
      if (!llmProfileSelect) return;
      llmProfileSelect.innerHTML = '<option value="">Lade...</option>';
      const res = await API.llmProfiles();
      if (!res.success) {
        llmProfileSelect.innerHTML = '<option value="">Fehler beim Laden</option>';
        writeLlmOutput(res.error || 'LLM profile load failed.');
        return;
      }
      const profiles = Array.isArray(res.profiles) ? res.profiles : [];
      llmProfileSelect.innerHTML = profiles.length
        ? profiles.map((p) => `<option value="${esc(p.profile_key)}">${esc(p.name)} (${esc(p.profile_key)})</option>`).join('')
        : '<option value="">Keine Profile gefunden</option>';
      if (profiles.length && llmInputVars && !String(llmInputVars.value || '').trim()) {
        const first = profiles[0];
        const required = Array.isArray(first?.input_schema?.required) ? first.input_schema.required : [];
        const sample = {};
        required.forEach((key) => { sample[String(key)] = ''; });
        llmInputVars.value = JSON.stringify(sample, null, 2);
      }
      writeLlmOutput(JSON.stringify({ loaded_profiles: profiles.length }, null, 2));
    };

    const readLlmInputVars = () => {
      const raw = String(llmInputVars?.value || '').trim();
      if (raw === '') return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Input vars must be a JSON object.');
      }
      return parsed;
    };

    root.querySelector('#set-llm-profiles-load')?.addEventListener('click', async () => {
      try {
        await loadLlmProfiles();
      } catch (err) {
        writeLlmOutput(String(err?.message || err || 'Failed to load profiles'));
      }
    });

    root.querySelector('#set-llm-compose')?.addEventListener('click', async () => {
      try {
        const profile_key = String(llmProfileSelect?.value || '').trim();
        if (!profile_key) {
          showToast('Bitte ein LLM-Profil auswaehlen.', 'warning');
          return;
        }
        const input_vars = readLlmInputVars();
        const res = await API.llmCompose({ profile_key, input_vars });
        writeLlmOutput(JSON.stringify(res, null, 2));
        if (!res.success) showToast(res.error || 'Compose fehlgeschlagen.', 'error');
      } catch (err) {
        writeLlmOutput(String(err?.message || err || 'Compose failed'));
        showToast('Compose fehlgeschlagen.', 'error');
      }
    });

    root.querySelector('#set-llm-run')?.addEventListener('click', async () => {
      try {
        const profile_key = String(llmProfileSelect?.value || '').trim();
        if (!profile_key) {
          showToast('Bitte ein LLM-Profil auswaehlen.', 'warning');
          return;
        }
        const input_vars = readLlmInputVars();
        writeLlmOutput('LLM Anfrage laeuft...');
        const res = await API.llmChatProfile({ profile_key, input_vars });
        writeLlmOutput(JSON.stringify(res, null, 2));
        if (res.success) showToast('LLM Antwort erhalten.', 'success');
        else showToast(res.error || 'LLM Anfrage fehlgeschlagen.', 'error');
      } catch (err) {
        writeLlmOutput(String(err?.message || err || 'LLM request failed'));
        showToast('LLM Anfrage fehlgeschlagen.', 'error');
      }
    });

    root.querySelector('#set-npc-refresh')?.addEventListener('click', async () => {
      try {
        await loadNpcControllerStatus();
        await loadNpcSummary();
      } catch (err) {
        if (npcStatusLine) npcStatusLine.textContent = String(err?.message || err || 'Status-Fehler');
      }
    });

    root.querySelector('#set-npc-load-summary')?.addEventListener('click', async () => {
      try {
        await loadNpcSummary();
      } catch (err) {
        writeNpcSummary(String(err?.message || err || 'Summary load failed'));
      }
    });

    root.querySelector('#set-npc-load-decisions')?.addEventListener('click', async () => {
      try {
        await loadNpcDecisions();
      } catch (err) {
        writeNpcDecisions(String(err?.message || err || 'Decision load failed'));
      }
    });

    root.querySelector('#set-npc-run-once')?.addEventListener('click', async () => {
      try {
        const res = await API.npcControllerRunOnce();
        if (res.success) {
          showToast(`NPC tick ausgefuehrt (+${Number(res.new_decision_logs || 0)} logs).`, 'success');
        } else {
          showToast(res.error || 'NPC tick fehlgeschlagen.', 'error');
        }
        await loadNpcControllerStatus();
        await loadNpcSummary();
        await loadNpcDecisions();
      } catch (err) {
        showToast('NPC tick fehlgeschlagen.', 'error');
      }
    });

    loadLlmProfiles().catch(() => {
      writeLlmOutput('LLM profile preload failed.');
    });
    loadNpcControllerStatus().catch(() => {
      if (npcStatusLine) npcStatusLine.textContent = 'NPC status preload failed.';
    });
    loadNpcSummary().catch(() => {
      writeNpcSummary('NPC summary preload failed.');
    });
    loadNpcDecisions().catch(() => {
      writeNpcDecisions('NPC decisions preload failed.');
    });

    // ÔöÇÔöÇ FTL Drive Selection ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    const ftlCurrentEl  = root.querySelector('#set-ftl-current');
    const ftlResultEl   = root.querySelector('#set-ftl-result');
    const ftlButtons    = root.querySelectorAll('.set-ftl-drive-btn');

    // Load and display current FTL drive
    API.ftlStatus().then((ftlData) => {
      if (!ftlCurrentEl) return;
      const driveType = ftlData?.ftl_drive_type || 'aereth';
      const dm = window._GQ_meta?.dark_matter ?? '?';
      const isDefault = driveType === 'aereth';
      ftlCurrentEl.textContent = `Aktueller Antrieb: ${driveType}${isDefault ? ' (Standard ÔÇö Auswahl kostenlos)' : ''} ┬À Ôùå ${fmt(dm)} DM`;
      // Highlight current drive button
      ftlButtons.forEach((btn) => {
        const d = btn.getAttribute('data-drive');
        btn.style.borderColor = d === driveType ? '#88ccff' : '';
        btn.style.background  = d === driveType ? 'rgba(136,204,255,0.12)' : '';
      });
    }).catch(() => {
      if (ftlCurrentEl) ftlCurrentEl.textContent = 'FTL-Status konnte nicht geladen werden.';
    });

    ftlButtons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const drive = btn.getAttribute('data-drive');
        if (!drive) return;
        ftlButtons.forEach((b) => { b.disabled = true; });
        if (ftlResultEl) ftlResultEl.textContent = 'Wird gesetztÔÇª';
        try {
          const res = await API.setFtlDrive(drive);
          if (res?.success) {
            if (ftlResultEl) ftlResultEl.innerHTML = `<span style="color:#88ff88">Ô£ô ${esc(res.message || 'Drive gesetzt.')}</span>`;
            // Update current label
            if (ftlCurrentEl) ftlCurrentEl.textContent = `Aktueller Antrieb: ${drive}`;
            ftlButtons.forEach((b) => {
              const d = b.getAttribute('data-drive');
              b.style.borderColor = d === drive ? '#88ccff' : '';
              b.style.background  = d === drive ? 'rgba(136,204,255,0.12)' : '';
            });
            if (res.dm_spent > 0) showToast(`FTL Drive gewechselt. ${res.dm_spent} Ôùå DM abgezogen.`, 'info');
            else showToast(`FTL Drive auf ${drive} gesetzt.`, 'success');
            WM.refresh('fleet');
          } else {
            if (ftlResultEl) ftlResultEl.innerHTML = `<span style="color:#ff6666">Ô£ù ${esc(res?.error || 'Fehler')}</span>`;
            showToast(res?.error || 'Drive-Wechsel fehlgeschlagen.', 'error');
          }
        } catch {
          if (ftlResultEl) ftlResultEl.innerHTML = '<span style="color:#ff6666">Ô£ù Netzwerkfehler</span>';
          showToast('Drive-Wechsel fehlgeschlagen.', 'error');
        }
        ftlButtons.forEach((b) => { b.disabled = false; });
      });
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
  document.getElementById('logout-btn').addEventListener('click', async () => {
    if (audioManager) audioManager.playUiClick();
    
    // Attempt graceful logout
    try {
      const res = await API.logout();
      if (res && res.success) {
        // Clear session-related storage
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (_) {}
        
        // Close EventSource if active
        if (typeof window.__gqSSE !== 'undefined' && window.__gqSSE?.close) {
          try { window.__gqSSE.close(); } catch (_) {}
        }
        
        // Hard redirect after brief delay to ensure cookies are sent
        setTimeout(() => {
          window.location.href = 'index.html?logout=1&nocache=' + Date.now();
        }, 200);
        return;
      }
    } catch (_) {}
    
    // Fallback: redirect immediately if logout failed
    window.location.href = 'index.html?logout=1&nocache=' + Date.now();
  });

  // ÔöÇÔöÇ Badge refresh (messages) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  async function loadBadge() {
    await messagesController.loadBadge();
  }

  // ÔöÇÔöÇ Server-Sent Events ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  (function initSSE() {
    if (!window.EventSource) return; // Not supported

    let es;
    let reconnectDelay = 3000;
    const MAX_RECONNECT_DELAY = 60000;

    function connect() {
      es = new EventSource('api/events.php');

      es.addEventListener('connected', () => {
        reconnectDelay = 3000; // Reset on successful connect
      });

      es.addEventListener('new_messages', (e) => {
        try {
          const data = JSON.parse(e.data);
          const unread = parseInt(data.unread, 10) || 0;
          const badge = document.getElementById('msg-badge');
          if (badge) {
            if (unread > 0) {
              badge.textContent = unread;
              badge.classList.remove('hidden');
            } else {
              badge.classList.add('hidden');
            }
          }
          if ((parseInt(data.new, 10) || 0) > 0) {
            showToast(`Ô£ë ${data.new} new message${data.new > 1 ? 's' : ''}`, 'info');
          }
        } catch (_) {}
      });

      es.addEventListener('fleet_arrived', async (e) => {
        try {
          const data = JSON.parse(e.data);
          const mission = data.mission || '';
          const target = data.target || '';
          const icons = { attack: 'ÔÜö', transport: '­ƒôª', colonize: '­ƒÅø', spy: '­ƒöì', harvest: 'ÔøÅ', recall: 'Ôå®' };
          const icon = icons[mission] || 'ÔÜí';
          showToast(`${icon} Fleet arrived at ${target} (${mission})`, mission === 'attack' ? 'success' : 'info');
          await loadOverview();
          _invalidateGetCache([/api\/fleet\.php/, /api\/game\.php/]);
          ['fleet', 'shipyard', 'buildings'].forEach(id => WM.refresh(id));
        } catch (_) {}
      });

      es.addEventListener('fleet_returning', async (e) => {
        try {
          const data = JSON.parse(e.data);
          showToast(`Ôå® Fleet returned home (${data.mission || ''})`, 'info');
          await loadOverview();
          _invalidateGetCache([/api\/fleet\.php/, /api\/game\.php/]);
          WM.refresh('fleet');
        } catch (_) {}
      });

      es.addEventListener('incoming_attack', (e) => {
        try {
          const data = JSON.parse(e.data);
          const arrival = data.arrival_time ? new Date(data.arrival_time).toLocaleTimeString() : '?';
          const msg = data.mission === 'spy'
            ? `­ƒöì Spy fleet from ${data.attacker} inbound ÔåÆ ${data.target} (${arrival})`
            : `ÔÜá INCOMING ATTACK from ${data.attacker} ÔåÆ ${data.target} at ${arrival}!`;
          showToast(msg, 'danger');
        } catch (_) {}
      });

      es.addEventListener('reconnect', () => {
        es.close();
        setTimeout(connect, 1000);
      });

      es.onerror = () => {
        es.close();
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        setTimeout(connect, reconnectDelay);
      };
    }

    connect();
  })();

  // ÔöÇÔöÇ Countdown ticker ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  // Guard sets ÔÇô keyed by unique string to prevent repeated triggers
  const _tickerFleetArrived     = new Set(); // arr-timestamp strings already triggered
  const _tickerWindowRefreshed  = {};        // windowId -> last trigger ms (debounce 8 s)

  setInterval(() => {
    const nowMs = Date.now();

    // ÔöÇÔöÇ Countdown text spans (data-end only) ÔöÇÔöÇ
    document.querySelectorAll('[data-end]:not([data-start])').forEach(el => {
      const text = countdown(el.dataset.end);
      el.textContent = text;
      // When a building / research / shipyard timer hits zero, auto-refresh its window
      if (text === '00:00:00') {
        const win = el.closest('.wm-window[data-winid]');
        if (win) {
          const wid = win.dataset.winid;
          const last = _tickerWindowRefreshed[wid] || 0;
          if (nowMs - last > 8000) {
            _tickerWindowRefreshed[wid] = nowMs;
            WM.refresh(wid);
          }
        }
      }
    });

    // ÔöÇÔöÇ Live building / research progress bars (data-start + data-end) ÔöÇÔöÇ
    document.querySelectorAll('.progress-bar[data-start][data-end]').forEach(bar => {
      const start = new Date(bar.dataset.start).getTime();
      const end   = new Date(bar.dataset.end).getTime();
      const total = end - start;
      if (!total || total <= 0 || isNaN(total)) return;
      const pct = Math.max(0, Math.min(100, ((nowMs - start) / total) * 100));
      bar.style.width = pct.toFixed(1) + '%';
    });

    // ÔöÇÔöÇ Live fleet progress bars + auto-refresh on arrival ÔöÇÔöÇ
    document.querySelectorAll('.fleet-progress-bar[data-dep][data-arr]').forEach(bar => {
      const dep = new Date(bar.dataset.dep).getTime();
      const arr = new Date(bar.dataset.arr).getTime();
      const total = arr - dep;
      if (!total || total <= 0) return;
      const pct = Math.max(0, Math.min(100, ((nowMs - dep) / total) * 100));
      bar.style.width = pct.toFixed(1) + '%';
      // Trigger overview reload once when fleet has arrived and SSE might be unavailable
      if (pct >= 100 && !_tickerFleetArrived.has(bar.dataset.arr)) {
        _tickerFleetArrived.add(bar.dataset.arr);
        loadOverview();
        _invalidateGetCache([/api\/fleet\.php/, /api\/game\.php/]);
        WM.refresh('fleet');
      }
    });
  }, 1000);

  // ÔöÇÔöÇ Periodic refresh (fallback polling when SSE is unavailable) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  setInterval(async () => {
    await loadOverview();
    await loadBadge();
    ['buildings','research','shipyard'].forEach(id => WM.refresh(id));
  }, 60000); // Reduced from 30 s ÔÇô SSE handles fleet/message events in real-time

  setInterval(async () => {
    // Fallback badge sync every 30 s (SSE handles instant updates)
    await loadBadge();
  }, 30000);

  setInterval(() => {
    const root = WM.body('galaxy');
    if (!root) return;
    refreshGalaxyDensityMetrics(root);
  }, 1500);

  // ÔöÇÔöÇ Boot: keep galaxy fixed in main desktop area and preload overview data ÔöÇÔöÇ
  WM.open('galaxy');
  if (audioManager && typeof audioManager.setScene === 'function') {
    audioManager.setScene('galaxy', { autoplay: true, transition: 'fast', force: true });

    if (!window.__GQ_AUDIO_UNLOCK_INSTALLED) {
      window.__GQ_AUDIO_UNLOCK_INSTALLED = true;
      let unlocked = false;
      const listeners = [];

      const clearListeners = () => {
        listeners.forEach(({ type, handler, opts }) => {
          try { window.removeEventListener(type, handler, opts); } catch (_) {}
        });
        listeners.length = 0;
      };

      const resumeOnInteract = async () => {
        if (unlocked) return;
        try {
          const snap = audioManager.snapshot ? audioManager.snapshot() : null;
          const muted = !!(snap?.masterMuted || snap?.musicMuted);
          const hasTrack = String(snap?.musicUrl || '').trim() !== '';
          if (muted || !hasTrack) return;
          const ok = await audioManager.playMusic();
          if (ok) {
            unlocked = true;
            clearListeners();
          }
        } catch (_) {}
      };

      const bind = (type, opts) => {
        window.addEventListener(type, resumeOnInteract, opts);
        listeners.push({ type, handler: resumeOnInteract, opts });
      };

      bind('pointerdown', { passive: true });
      bind('click', { passive: true });
      bind('touchstart', { passive: true });
      bind('keydown', false);
    }
  }

  // ÔöÇÔöÇ Footer actions init ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  updateFooterQuickNavBadge();

  document.getElementById('footer-quicknav-btn')?.addEventListener('click', () => {
    if (WM.isOpen('quicknav')) WM.close('quicknav');
    else WM.open('quicknav');
    document.getElementById('footer-quicknav-btn')?.classList.toggle('active', WM.isOpen('quicknav'));
  });

  document.getElementById('footer-overview-btn')?.addEventListener('click', () => {
    if (WM.isOpen('overview')) WM.close('overview');
    else WM.open('overview');
    document.getElementById('footer-overview-btn')?.classList.toggle('active', WM.isOpen('overview'));
  });

  document.getElementById('footer-minimap-btn')?.addEventListener('click', () => {
    if (WM.isOpen('minimap')) WM.close('minimap');
    else WM.open('minimap');
    document.getElementById('footer-minimap-btn')?.classList.toggle('active', WM.isOpen('minimap'));
  });

  refreshAudioUi();
  loadAudioTrackCatalog().catch(() => {});

  // Advisor widget: register WM window + mount floating bubble
  AdvisorWidget.register();
  AdvisorWidget.load().catch(() => {});

  await loadOverview();

  try {
    const bootHomeFlight = window.__GQ_BOOT_HOME_FLIGHT;
    if (bootHomeFlight) {
      const root = WM.body('galaxy');
      if (root) {
        const introMode = String(settingsState.introFlightMode || 'cinematic');
        const shouldPlayIntro = introMode !== 'off';
        await focusHomeSystemInGalaxy(root, {
          silent: true,
          cinematic: shouldPlayIntro && introMode === 'cinematic',
          enterSystem: bootHomeFlight.enterSystem !== false,
          focusPlanet: shouldPlayIntro && bootHomeFlight.focusPlanet !== false,
        });
      }
    }
  } catch (_) {
    // Keep startup resilient if intro camera flight fails.
  } finally {
    try { window.__GQ_BOOT_HOME_FLIGHT = null; } catch (_) {}
  }

  await loadBadge();
})();
