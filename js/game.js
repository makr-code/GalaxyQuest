/**
 * GalaxyQuest – Main game UI controller
 * All views are rendered as floating windows via the WM (window manager).
 */
(async function () {

  // ── Auth guard ───────────────────────────────────────────
  let currentUser;
  try {
    const meData = await API.me();
    if (!meData.success) { window.location.href = 'index.html'; return; }
    currentUser = meData.user;
  } catch (_) { window.location.href = 'index.html'; return; }

  function updateCommanderButtonLabel() {
    const commanderBtn = document.getElementById('commander-name');
    if (commanderBtn) commanderBtn.textContent = `⚙ ${currentUser.username} ▾`;
  }
  updateCommanderButtonLabel();

  // ── State ────────────────────────────────────────────────
  let colonies       = [];
  let currentColony  = null;
  let galaxySystemMax = 499;
  let galaxy3d = null;
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
    colonyViewFocus: null,
    fleetPrefill: null,
    intelCache: new Map(),
    territory: [],
    rawClusters: [],
    clusterSummary: [],
  };
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
    showToast('Session abgelaufen. Weiterleitung zum Login…', 'warning');
    window.setTimeout(() => {
      window.location.href = target;
    }, 450);
  }
  const AUDIO_TRACK_OPTIONS = [
    { value: 'music/Nebula_Overture.mp3', label: 'Nebula Overture' },
  ];
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
    clusterDensityMode: 'auto',
    clusterBoundsVisible: true,
    magnetPreset: 'balanced',
    hoverMagnetEnabled: true,
    clickMagnetEnabled: true,
    hoverMagnetStarPx: 24,
    hoverMagnetPlanetPx: 30,
    hoverMagnetClusterPx: 28,
    persistentHoverDistance: 220,
    transitionStableMinMs: 160,
    homeEnterSystem: false,
    masterVolume: 0.8,
    musicVolume: 0.55,
    sfxVolume: 0.8,
    masterMuted: false,
    musicMuted: false,
    sfxMuted: false,
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
  const BUILDING_UI_META = {
    metal_mine:       { cat:'Extraction', icon:'⬡', desc:'Mines metal from the planet crust. Output scales with richness.' },
    crystal_mine:     { cat:'Extraction', icon:'💎', desc:'Extracts crystal formations. Higher levels deplete deposits faster.' },
    deuterium_synth:  { cat:'Extraction', icon:'🔵', desc:'Synthesises deuterium from surface water or atmosphere.' },
    rare_earth_drill: { cat:'Extraction', icon:'💜', desc:'Extracts rare earth elements — finite deposit, high value.' },
    solar_plant:      { cat:'Energy', icon:'☀', desc:'Converts sunlight to energy. Output depends on star type.' },
    fusion_reactor:   { cat:'Energy', icon:'🔆', desc:'High-output fusion reactor. Consumes deuterium.' },
    hydroponic_farm:  { cat:'Life Support', icon:'🌾', desc:'Grows food for the population. Required to prevent starvation.' },
    food_silo:        { cat:'Life Support', icon:'🏚', desc:'Increases food storage capacity.' },
    habitat:          { cat:'Population', icon:'🏠', desc:'+200 max population per level.' },
    hospital:         { cat:'Population', icon:'🏥', desc:'Improves healthcare. Raises happiness and public services index.' },
    school:           { cat:'Population', icon:'🎓', desc:'Education facility. Improves public services and colony productivity.' },
    security_post:    { cat:'Population', icon:'🔒', desc:'Maintains order. Reduces unrest and deters pirate raids.' },
    robotics_factory: { cat:'Industry', icon:'🤖', desc:'Reduces building construction time.' },
    shipyard:         { cat:'Industry', icon:'🚀', desc:'Required to build spacecraft.' },
    metal_storage:    { cat:'Storage', icon:'📦', desc:'Increases metal storage cap.' },
    crystal_storage:  { cat:'Storage', icon:'📦', desc:'Increases crystal storage cap.' },
    deuterium_tank:   { cat:'Storage', icon:'📦', desc:'Increases deuterium storage cap.' },
    research_lab:     { cat:'Science', icon:'🔬', desc:'Enables and accelerates research.' },
    missile_silo:     { cat:'Military', icon:'🚀', desc:'Launches defensive missiles.' },
    nanite_factory:   { cat:'Advanced', icon:'⚙', desc:'Nano-assemblers that dramatically cut build times.' },
    terraformer:      { cat:'Advanced', icon:'🌍', desc:'Reshapes planetary geology to expand available tiles.' },
    colony_hq:        { cat:'Advanced', icon:'🏛', desc:'Colony administration. Raises colony level cap.' },
    solar_satellite:  { cat:'Orbital', icon:'🛰', desc:'Orbital solar collectors supporting planetary energy output.' },
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
  const audioManager = window.GQAudioManager
    ? new window.GQAudioManager({ storageKey: 'gq_audio_settings' })
    : null;
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
      : (pending > 1 ? `Lade Daten (${pending})…` : 'Lade Daten…');

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
    return BUILDING_UI_META[String(type || '')] || { cat:'Other', icon:'🏗', desc:'' };
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

  // ── Utilities ────────────────────────────────────────────
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

  function countdown(endTime) {
    const secs = Math.max(0, Math.round((new Date(endTime) - Date.now()) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  }

  function showToast(msg, type = 'info') {
    const el = document.getElementById('toast');
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
      toggleBtn.textContent = open ? '⌃ Console' : '⌄ Console';
      if (open) {
        this.render();
        input.focus();
      }
    }

    init() {
      if (this.initialized) return true;
      const panel = document.getElementById('ui-console-panel');
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

      this.setOpen(false, panel, toggleBtn, input);

      window.__gqUiConsoleReady = true;
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('gq:ui-console-ready', {
          detail: { panelId: 'ui-console-panel', logId: 'ui-console-log' },
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

  class UIConsoleCommandController {
    async execute(raw) {
      const input = String(raw || '').trim();
      if (!input) return;
      uiConsolePush(`> ${input}`);

      const parts = input.split(/\s+/).filter(Boolean);
      const cmd = String(parts[0] || '').toLowerCase();

      if (cmd === 'help' || cmd === '?') {
        uiConsolePush('[help] refresh | home | galaxy | open <window> | transitions on/off/status | term debug on/off/status | term clear | term download | msg <user> <text> | copy | clear');
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
      if (!btn) return;
      if (!audioManager) {
        btn.disabled = true;
        btn.textContent = '🔇';
        btn.title = 'Audio nicht verfuegbar';
        return;
      }
      const state = audioManager.snapshot();
      const muted = !!state.masterMuted;
      btn.disabled = false;
      btn.textContent = muted ? '🔇' : '🔊';
      btn.title = muted ? 'Audio aktivieren' : 'Audio stummschalten';
    }

    loadUiSettings() {
      try {
        const raw = localStorage.getItem('gq_ui_settings');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        Object.assign(settingsState, parsed);
      } catch (_) {}
      applyTransitionPreset(settingsState.transitionPreset);
      settingsState.magnetPreset = ['precise', 'balanced', 'sticky', 'custom'].includes(String(settingsState.magnetPreset || 'balanced'))
        ? String(settingsState.magnetPreset)
        : 'balanced';
      settingsState.hoverMagnetEnabled = settingsState.hoverMagnetEnabled !== false;
      settingsState.clickMagnetEnabled = settingsState.clickMagnetEnabled !== false;
      settingsState.hoverMagnetStarPx = Math.max(8, Math.min(64, Number(settingsState.hoverMagnetStarPx || 24)));
      settingsState.hoverMagnetPlanetPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetPlanetPx || 30)));
      settingsState.hoverMagnetClusterPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetClusterPx || 28)));
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
        audioManager.setMasterVolume(settingsState.masterVolume);
        audioManager.setMusicVolume(settingsState.musicVolume);
        audioManager.setSfxVolume(settingsState.sfxVolume);
        audioManager.setMasterMuted(settingsState.masterMuted);
        audioManager.setMusicMuted(settingsState.musicMuted);
        audioManager.setSfxMuted(settingsState.sfxMuted);
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
    }

    saveUiSettings() {
      try {
        localStorage.setItem('gq_ui_settings', JSON.stringify(settingsState));
      } catch (_) {}
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

      menu.innerHTML = `
        <button class="user-menu-item" type="button" data-user-action="open-settings" role="menuitem">⚙ Benutzereinstellungen öffnen</button>
        <button class="user-menu-item" type="button" data-user-action="toggle-master-mute" role="menuitem">${masterMuted ? '🔈 Ton aktivieren' : '🔇 Ton stummschalten'}</button>
        <button class="user-menu-item" type="button" data-user-action="cycle-transition" role="menuitem">🎬 Transition: ${esc(transitionPreset)}</button>
        <button class="user-menu-item" type="button" data-user-action="toggle-home-enter" role="menuitem">🏠 Home-Öffnung: ${homeEnterSystem ? 'Systemansicht' : 'Galaxieansicht'}</button>
        <hr class="user-menu-sep" />
        <button class="user-menu-item" type="button" data-user-action="toggle-pvp" role="menuitem">⚔ PvP: ${pvpOn ? 'aktiv (klicken zum Deaktivieren)' : 'inaktiv (klicken zum Aktivieren)'}</button>
        <button class="user-menu-item" type="button" data-user-action="refresh-profile" role="menuitem">🔄 Profildaten neu laden</button>
        <hr class="user-menu-sep" />
        <button class="user-menu-item user-menu-item-danger" type="button" data-user-action="logout" role="menuitem">⎋ Logout</button>`;
    }

    closeUserMenu() {
      const wrap = document.getElementById('user-menu-wrap');
      const menu = document.getElementById('user-menu');
      const btn = document.getElementById('commander-name');
      if (menu) menu.classList.add('hidden');
      if (wrap) wrap.classList.remove('open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    openUserMenu() {
      const wrap = document.getElementById('user-menu-wrap');
      const menu = document.getElementById('user-menu');
      const btn = document.getElementById('commander-name');
      if (!menu || !btn) return;
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
      if (action === 'toggle-pvp') {
        const response = await API.togglePvp();
        if (response.success) {
          if (audioManager && typeof audioManager.playPvpToggle === 'function') audioManager.playPvpToggle();
          showToast(response.pvp_mode ? '⚔ PvP enabled!' : '🛡 PvP disabled.', 'info');
          await loadOverview();
          this.renderUserMenu();
        } else {
          showToast(response.error || 'PvP konnte nicht geändert werden.', 'error');
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
    // Accept any payload that has a star_system or a non-empty planets array —
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
    const input = document.getElementById('topbar-search-input');
    const overlay = document.getElementById('topbar-search-overlay');
    return { wrap, input, overlay };
  }

  function closeTopbarSearchOverlay() {
    topbarSearchStore.closeOverlay();
    renderTopbarSearchOverlay();
  }

  const TOPBAR_SEARCH_TEMPLATES = {
    item: '<button type="button" class="topbar-search-item" data-search-source="{{{source}}}" data-search-index="{{{index}}}" role="option"><div class="topbar-search-title">{{{name}}}</div><div class="topbar-search-meta">{{{coords}}} · {{{starClass}}} · {{{origin}}}</div></button>',
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
      ? '<div class="topbar-search-empty">Server-Suche läuft...</div>'
      : (serverRows.length
        ? serverRows.map((star, idx) => renderRow(star, 'server', idx)).join('')
        : '<div class="topbar-search-empty">Keine zusätzlichen Server-Treffer.</div>');

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
    const { wrap, input, overlay } = getTopbarSearchDom();
    if (!wrap || !input || !overlay) return;

    input.addEventListener('input', () => runTopbarSearch(input.value));
    input.addEventListener('focus', () => {
      if (!String(input.value || '').trim()) return;
      topbarSearchStore.openOverlay();
      renderTopbarSearchOverlay();
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
        if (candidate) await jumpToSearchStar(candidate);
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
    if (cls.includes('gas')) return '🪐';
    if (cls.includes('ice') || cls.includes('frozen')) return '🧊';
    if (cls.includes('lava') || cls.includes('volcan')) return '🌋';
    if (cls.includes('ocean')) return '🌊';
    if (cls.includes('desert')) return '🏜';
    if (cls.includes('terra') || cls.includes('hab')) return '🌍';
    if (cls.includes('toxic')) return '☣';
    return '●';
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
        ['overview', { title: '🌍 Overview', w: 460, h: 620, defaultDock: 'right', defaultY: 12, onRender: () => renderOverview() }],
        ['buildings', { title: '🏗 Buildings', w: 480, h: 560, defaultDock: 'right', defaultY: 38, onRender: () => renderBuildings() }],
        ['colony', { title: '🏛 Colony', w: 620, h: 620, defaultDock: 'right', defaultY: 24, onRender: () => renderColonyView() }],
        ['research', { title: '🔬 Research', w: 480, h: 560, defaultDock: 'right', defaultY: 58, onRender: () => renderResearch() }],
        ['shipyard', { title: '🚀 Shipyard', w: 500, h: 560, defaultDock: 'right', defaultY: 78, onRender: () => renderShipyard() }],
        ['fleet', { title: '⚡ Fleet', w: 500, h: 620, defaultDock: 'right', defaultY: 98, onRender: () => renderFleetForm() }],
        ['galaxy', { title: '🌌 Galaxy Map', fullscreenDesktop: true, hideTaskButton: true, onRender: () => renderGalaxyWindow() }],
        ['messages', { title: '✉ Messages', w: 500, h: 520, defaultDock: 'right', defaultY: 118, onRender: () => renderMessages() }],
        ['intel', { title: '🔍 Intel', w: 520, h: 560, defaultDock: 'right', defaultY: 128, onRender: () => renderIntel() }],
        ['trade-routes', { title: '🚀 Trade Routes', w: 520, h: 560, defaultDock: 'right', defaultY: 138, onRender: () => renderTradeRoutes() }],
          ['trade', { title: '💱 Trade', w: 540, h: 580, defaultDock: 'right', defaultY: 148, onRender: () => renderTradeProposals() }],
        ['quests', { title: '📋 Quests', w: 540, h: 620, defaultDock: 'right', defaultY: 28, onRender: () => renderQuests() }],
        ['leaderboard', { title: '🏆 Leaderboard', w: 420, h: 480, defaultDock: 'right', defaultY: 138, onRender: () => renderLeaderboard() }],
        ['leaders', { title: '👤 Leaders', w: 540, h: 560, defaultDock: 'right', defaultY: 44, onRender: () => renderLeaders() }],
        ['factions', { title: '🌐 Factions', w: 560, h: 620, defaultDock: 'right', defaultY: 24, onRender: () => renderFactions() }],
        ['alliances', { title: '🤝 Alliances', w: 560, h: 620, defaultDock: 'right', defaultY: 54, onRender: () => renderAlliances() }],
        ['settings', { title: '⚙ Settings', w: 460, h: 560, defaultDock: 'right', defaultY: 12, onRender: () => renderSettings() }],
        ['quicknav', { title: '⭐ QuickNav', w: 370, h: 520, defaultDock: 'left', defaultY: 12, onRender: () => renderQuickNav() }],
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
        ['overview','colony','buildings','research','shipyard','fleet','messages','quests','leaders','factions','leaderboard'].forEach((id) => {
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
      this.bindColonySelector();
      this.bound = true;
    }
  }

  // ── Colony selector ──────────────────────────────────────
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
    if (currentColony) planetSelect.value = String(currentColony.id);
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
        const metal = Math.min(Number(currentColony.metal || 0), Math.round(cargoCap * 0.45));
        const crystal = Math.min(Number(currentColony.crystal || 0), Math.round(cargoCap * 0.3));
        const deut = Math.min(Number(currentColony.deuterium || 0), Math.round(cargoCap * 0.15));
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
        const threat = fallbackPrefill.threatLevel ? ` · Bedrohung: ${esc(fallbackPrefill.threatLevel)}` : '';
        const scan = fallbackPrefill.intel?.intel?.latest_scan_at
          ? ` · Scan: ${esc(new Date(fallbackPrefill.intel.intel.latest_scan_at).toLocaleString())}`
          : '';
        hint.innerHTML = `${owner}${threat}${scan} · Missionsdefaults gesetzt.`;
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
          <div id="fleet-ship-select-wm"><p class="text-muted">Loading ships…</p></div>

          <h3>2. Select Mission</h3>
          <div class="mission-grid">
            <label><input type="radio" name="mission" value="attack" /> ⚔️ Attack colony</label>
            <label><input type="radio" name="mission" value="transport" checked /> 📦 Transport resources</label>
            <label><input type="radio" name="mission" value="spy" /> 🔭 Spy on colony</label>
            <label><input type="radio" name="mission" value="colonize" /> 🌍 Colonize planet</label>
            <label><input type="radio" name="mission" value="harvest" /> ⛏ Harvest deposits</label>
          </div>

          <h3>3. Target Coordinates</h3>
          <div class="coord-inputs">
            <label>Galaxy  <input type="number" id="f-galaxy"   min="1" max="9"   value="1" /></label>
            <label>System  <input type="number" id="f-system"   min="1" max="499" value="1" /></label>
            <label>Position<input type="number" id="f-position" min="1" max="15"  value="1" /></label>
          </div>

          <h3>4. Cargo (optional)</h3>
          <div class="cargo-inputs">
            <label>Metal    <input type="number" id="f-cargo-metal"   min="0" value="0" /></label>
            <label>Crystal  <input type="number" id="f-cargo-crystal" min="0" value="0" /></label>
            <label>Deuterium<input type="number" id="f-cargo-deut"    min="0" value="0" /></label>
          </div>

          <div id="fleet-default-hint" class="form-info"></div>

          <button type="submit" class="btn btn-primary">🚀 Launch Fleet</button>
          <div id="fleet-send-result-wm" class="form-info" aria-live="polite"></div>
        </form>`;

      try {
        const data = await API.ships(currentColony.id);
        const shipEl = root.querySelector('#fleet-ship-select-wm');
        if (!data.success) {
          shipEl.innerHTML = '<p class="text-red">Error.</p>';
          return;
        }
        const avail = data.ships.filter((ship) => ship.count > 0);
        if (!avail.length) {
          shipEl.innerHTML = '<p class="text-muted">No ships on this planet.</p>';
          return;
        }
        shipEl.innerHTML = `<div class="ship-selector-grid">${avail.map((ship) => `
          <div class="ship-selector-row">
            <span>${fmtName(ship.type)} (${ship.count})</span>
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
            showToast('🚀 Fleet launched!', 'success');
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

  class GalaxyController {
    triggerNavAction(action, rootRef = null) {
      if (!galaxy3d) return;
      const root = rootRef || WM.body('galaxy');
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
      if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') {
        galaxy3d.focusOnStar(target, true);
      }
      toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
      renderGalaxySystemDetails(root, target, !!galaxy3d?.systemMode);
      showToast(`Navigation: ${target.name || target.catalog_name || `System ${s}`}`, 'info');
    }

    async render2DMap(root) {
      // Fetch stars from current gallery view or load defaults
      const from = parseInt(root.querySelector('#gal-from')?.value || 1);
      const to = parseInt(root.querySelector('#gal-to')?.value || 499);
      const galaxy = parseInt(root.querySelector('#gal-galaxy')?.value || 1);

      try {
        const stars = Array.isArray(galaxyStars) ? galaxyStars : [];
        const canvas = root.querySelector('#galaxy-2d-map-canvas');
        if (canvas) {
          // Set canvas size to match container
          const rect = canvas.parentElement?.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          canvas.width = (rect?.width || 800) * dpr;
          canvas.height = (rect?.height || 600) * dpr;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.scale(dpr, dpr);
          }

          await galaxy2dMap.initialize(canvas, stars, { galaxy, from, to });
        }
      } catch (e) {
        console.warn('[GQ] render2DMap failed:', e);
      }
    }

    async focusHomeSystem(root) {
      if (!root || !currentColony) {
        showToast('Kein Heimatplanet verfügbar.', 'warning');
        return;
      }
      const g = Math.max(1, Number(currentColony.galaxy || 1));
      const s = Math.max(1, Number(currentColony.system || 1));
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
        showToast('Heimatsystem nicht im aktuellen Sternbereich gefunden.', 'warning');
        return;
      }

      pinnedStar = target;
      uiState.activeStar = target;
      if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') {
        galaxy3d.focusOnStar(target, true);
      }
      const shouldEnterSystem = !!settingsState.homeEnterSystem;
      if (shouldEnterSystem && !galaxy3d?.systemMode) {
        renderGalaxySystemDetails(root, target, true);
        await loadStarSystemPlanets(root, target);
      } else {
        renderGalaxySystemDetails(root, target, !!galaxy3d?.systemMode);
      }
      showToast(`Heimatnavigation: ${target.name || target.catalog_name || `System ${s}`}`, 'success');
    }

    init3D(root) {
      const holder = root.querySelector('#galaxy-3d-canvas');
      if (!holder) {
        galaxy3dInitReason = 'Missing #galaxy-3d-canvas container';
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

      try {
        galaxy3d = new window.Galaxy3DRenderer(holder, {
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
            if (panel && star) panel.innerHTML = '<p class="text-muted">Zur Galaxieansicht ausgezoomt. Für Systemdetails wieder hineinzoomen oder doppelklicken.</p>';
          },
          onPlanetZoomOut: (star) => {
            if (audioManager && typeof audioManager.setScene === 'function') {
              audioManager.setScene('system', { autoplay: true, transition: 'normal', minHoldMs: 500 });
            }
            if (star) renderGalaxySystemDetails(root, star, true);
          },
        });
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

      if (!root.querySelector('.galaxy-3d-stage')) {
        root.innerHTML = `
          <div class="galaxy-tabs" style="display:flex;gap:0;border-bottom:1px solid #555;margin-bottom:4px;">
            <button class="galaxy-tab-btn galaxy-tab-active" data-tab="3d" style="padding:6px 12px;background:#1a1a1a;border:none;border-bottom:2px solid #4488ff;color:#fff;cursor:pointer;">3D View</button>
            <button class="galaxy-tab-btn" data-tab="2d" style="padding:6px 12px;background:#0a0a0a;border:none;color:#999;cursor:pointer;">2D Map</button>
          </div>
          <div class="galaxy-3d-stage galaxy-tab-content" data-tab-id="3d" style="display:block;">
            <div class="galaxy-3d-wrap">
              <div id="galaxy-3d-canvas" class="galaxy-3d-canvas"></div>
              <div id="galaxy-hover-card" class="galaxy-hover-card hidden"></div>
            </div>

            <div id="galaxy-controls-overlay" class="galaxy-overlay-window hidden">
              <div class="galaxy-overlay-head">
                <strong>Galaxy Controls</strong>
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
              <div id="galaxy-system-details" class="text-muted">Overlay hidden. Press I to open details.</div>
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
                  <button class="galaxy-nav-btn" type="button" data-nav-action="rotate-up" title="Rotate up">▲</button>
                  <div class="galaxy-nav-orb-row">
                    <button class="galaxy-nav-btn" type="button" data-nav-action="rotate-left" title="Rotate left">◀</button>
                    <button class="galaxy-nav-btn galaxy-nav-btn-center" type="button" data-nav-action="focus" title="Focus selection">◎</button>
                    <button class="galaxy-nav-btn" type="button" data-nav-action="rotate-right" title="Rotate right">▶</button>
                  </div>
                  <button class="galaxy-nav-btn" type="button" data-nav-action="rotate-down" title="Rotate down">▼</button>
                </div>
                <button class="galaxy-nav-btn zoom" type="button" data-nav-action="zoom-out" title="Zoom out">−</button>
              </div>
              <div class="galaxy-nav-strip">
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-up-left" title="Pan up-left">↖</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-up" title="Pan up">↑</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-up-right" title="Pan up-right">↗</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-left" title="Pan left">←</button>
                <button class="galaxy-nav-mini-btn galaxy-nav-mini-btn-center galaxy-nav-reset-btn" type="button" data-nav-action="reset" title="Reset view">Reset</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-right" title="Pan right">→</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-down-left" title="Pan down-left">↙</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-down" title="Pan down">↓</button>
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="pan-down-right" title="Pan down-right">↘</button>
              </div>
              <div class="galaxy-nav-strip" style="margin-top:0.3rem;grid-template-columns:1fr;">
                <button class="galaxy-nav-mini-btn" type="button" data-nav-action="home" title="Jump to home system">🏠 Home</button>
              </div>
            </div>
          </div>
          
          <div class="galaxy-tab-content" data-tab-id="2d" style="display:none;width:100%;height:100%;overflow:hidden;">
            <canvas id="galaxy-2d-map-canvas" style="display:block;width:100%;height:100%;background:#0a0a0a;"></canvas>
          </div>
        `;

        // Tab switching
        root.querySelectorAll('.galaxy-tab-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const tabId = e.target.dataset.tab;
            root.querySelectorAll('.galaxy-tab-btn').forEach(b => {
              b.classList.toggle('galaxy-tab-active', b.dataset.tab === tabId);
              b.style.borderBottom = b.dataset.tab === tabId ? '2px solid #4488ff' : 'none';
              b.style.background = b.dataset.tab === tabId ? '#1a1a1a' : '#0a0a0a';
              b.style.color = b.dataset.tab === tabId ? '#fff' : '#999';
            });
            root.querySelectorAll('.galaxy-tab-content').forEach(content => {
              content.style.display = content.dataset.tabId === tabId ? 'block' : 'none';
            });
            if (tabId === '2d') {
              this.render2DMap(root);
            }
          });
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
        this.updateMagnetUi(root);
        renderGalaxyDebugPanel(root);
      }

      if (root.querySelector('#gal-health-badge') && (Date.now() - galaxyHealthLastCheckMs) > 60 * 1000) {
        refreshGalaxyHealth(root, false);
      }

      if (!galaxy3d && root.querySelector('#galaxy-3d-canvas')) {
        this.init3D(root);
        this.loadStars3D(root);
      }

      refreshGalaxyDensityMetrics(root);
      updateGalaxyFollowUi(root);
      updateClusterBoundsUi(root);
      this.updateMagnetUi(root);
    }

    async loadStars3D(root) {
      const details = root.querySelector('#galaxy-system-details');
      if (activePolicyMode === 'auto') {
        applyPolicyMode('auto');
        refreshPolicyUi(root);
      }
      const g = parseInt(root.querySelector('#gal-galaxy').value, 10) || 1;
      const from = Math.max(1, parseInt(root.querySelector('#gal-from').value, 10) || 1);
      const to = Math.max(from, parseInt(root.querySelector('#gal-to').value, 10) || from);
      if (galaxyStars.length && Number(galaxyStars[0]?.galaxy_index || 0) !== g) {
        galaxyStars = [];
      }
      uiState.activeRange = { from, to };
      setGalaxyContext(g, uiState.activeSystem || from, uiState.activeStar);
      const starsPolicy = LEVEL_POLICIES.galaxy.stars;

      if (details) details.innerHTML = '<span class="text-muted">Loading star cloud...</span>';

      const applyStarsToRenderer = (stars, clusterSummary, contextLabel = 'render') => {
        if (!galaxy3d) return true;
        try {
          galaxy3d.setStars(stars);
          if (typeof galaxy3d.setClusterColorPalette === 'function') {
            galaxy3d.setClusterColorPalette(resolveClusterColorPalette(uiState.territory));
          }
          if (typeof galaxy3d.setClusterAuras === 'function') {
            galaxy3d.setClusterAuras(clusterSummary || []);
          }
          return true;
        } catch (err) {
          const msg = String(err?.message || err || 'renderer error');
          console.error('[GQ] Galaxy renderer failed', { context: contextLabel, error: err });
          pushGalaxyDebugError('galaxy-render', msg, contextLabel);
          return false;
        }
      };

      let cachedStars = galaxyModel ? galaxyModel.listStars(g, from, to) : [];
      const fullRangeInModel = galaxyModel
        ? galaxyModel.hasLoadedStarRange(g, from, to, starsPolicy.cacheMaxAgeMs)
        : false;
      if ((!cachedStars || cachedStars.length === 0) && galaxyDB) {
        try {
          const dbStars = await galaxyDB.getStars(g, from, to, { maxAgeMs: starsPolicy.cacheMaxAgeMs });
          if (dbStars.length && galaxyModel) {
            cachedStars = galaxyModel.upsertStarBatch(g, dbStars);
            if (hasDenseSystemCoverage(dbStars, g, from, to)) {
              galaxyModel.addLoadedStarRange(g, from, to, Date.now());
            }
          } else {
            cachedStars = dbStars;
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
        }
        if (details) {
          details.innerHTML = `<span class="text-cyan">Cache: ${galaxyStars.length} stars loaded${fullRangeInModel ? ' (complete range)' : ''}. Syncing live data...</span>`;
        }
        refreshGalaxyDensityMetrics(root);
      }

      const shouldRefreshNetwork = starsPolicy.alwaysRefreshNetwork || !fullRangeInModel;
      if (!shouldRefreshNetwork && cachedStars && cachedStars.length) {
        if (details) {
          details.innerHTML = `<span class="text-cyan">Policy hit: fresh range from cache (${from}-${to}), network refresh skipped.</span>`;
        }
        hydrateGalaxyRangeInBackground(root, g, 1, galaxySystemMax).catch(() => {});
        return;
      }

      try {
        const data = (typeof API.galaxyStars === 'function')
          ? await API.galaxyStars(g, from, to, starsPolicy.maxPoints)
          : await API.galaxy(g, from);
        if (!data.success) {
          if (details) details.innerHTML = '<span class="text-red">Could not load stars.</span>';
          return;
        }

        if (Array.isArray(data.stars)) {
          galaxyStars = mergeGalaxyStarsBySystem(galaxyStars, data.stars, g);
        } else if (data.star_system) {
          const single = Object.assign({}, data.star_system, {
            galaxy_index: Number(data.galaxy || g),
            system_index: Number(data.system || from),
          });
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
        }

        if (details) {
          details.innerHTML = `<span class="text-cyan">Loaded ${galaxyStars.length} stars from systems ${from}..${to} (stride ${data.stride}).</span>`;
        }
        const toInput = root.querySelector('#gal-to');
        const fromInput = root.querySelector('#gal-from');
        if (toInput) toInput.max = String(galaxySystemMax);
        if (fromInput) fromInput.max = String(galaxySystemMax);
        refreshGalaxyDensityMetrics(root);
        hydrateGalaxyRangeInBackground(root, g, 1, galaxySystemMax).catch(() => {});
      } catch (err) {
        pushGalaxyDebugError('galaxy-stars', String(err?.message || err || 'unknown error'), `${from}..${to}`);
        if (details) details.innerHTML = `<span class="text-red">Failed to load stars: ${esc(String(err?.message || err || 'unknown error'))}</span>`;
        renderGalaxyFallbackList(root, galaxyStars, from, to, String(err?.message || err || 'network error'));
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
      label.textContent = `Density: ${visible}/${raw} (${ratioPct}%) · target ${target} · ${clusters} clusters · ${clusterLabel} · ${String(stats.densityMode || 'auto').toUpperCase()} · ${String(stats.lodProfile || 'n/a')}`;
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

  // ─── Galaxy 2D Map Controller ─────────────────────────────────────────────

  class GalaxyMap2DController {
    constructor() {
      this.stars = [];
      this.playerColonies = new Map();
      this.territoryClaimsBySystem = new Map();
      this.territorySummary = { own: 0, war: 0 };
      this.canvas = null;
      this.ctx = null;
      this.scale = 1;
      this.panX = 0;
      this.panY = 0;
      this.hoverStar = null;
      this.hoveredName = '';
    }

    // Spectral class → Color mapping
    spectralClassToColor(spectralClass) {
      const colors = {
        'O': '#3366ff',  // Blue
        'B': '#7744ff',  // Violet-blue
        'A': '#ccccff',  // Gray-white
        'F': '#ffffee',  // White
        'G': '#ffff44',  // Yellow
        'K': '#ffaa44',  // Orange
        'M': '#ff4444',  // Red
      };
      return colors[String(spectralClass || 'G')[0]] || '#ffff44';
    }

    // Luminosity → star radius (visual)
    luminosityToRadius(luminosity, baseRadius = 2) {
      const lum = Number(luminosity || 1);
      // Log scale: brightness ranges typically 0.01 to 100+
      return Math.max(1, Math.min(8, baseRadius + Math.log10(Math.max(0.1, lum)) * 1.2));
    }

    // Setup canvas & load data
    async initialize(canvas, stars, context = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.stars = stars || [];
      this.territoryClaimsBySystem.clear();
      this.territorySummary = { own: 0, war: 0 };

      // Fetch player colonies to mark them
      try {
        const overview = await API.gameOverview();
        this.playerColonies.clear();
        if (Array.isArray(overview.overview?.colonies)) {
          for (const col of overview.overview.colonies) {
            const key = `${Number(col.galaxy || 0)},${Number(col.system || 0)},${Number(col.position || 0)}`;
            this.playerColonies.set(key, col);
          }
        }
      } catch (_) {
        // Silent fail
      }

      // Fetch alliance war territory claims for current range
      try {
        const g = Number(context.galaxy || uiState.activeGalaxy || 1);
        const from = Number(context.from || uiState.activeRange?.from || 1);
        const to = Number(context.to || uiState.activeRange?.to || from);
        const warMap = await API.allianceWarMap(g, from, to);
        const claims = Array.isArray(warMap?.claims) ? warMap.claims : [];
        for (const claim of claims) {
          const key = `${Number(claim.galaxy || 0)},${Number(claim.system || 0)}`;
          const prev = this.territoryClaimsBySystem.get(key);
          const relation = String(claim.relation || 'neutral');
          if (!prev || (prev.relation !== 'war' && relation === 'war')) {
            this.territoryClaimsBySystem.set(key, {
              relation,
              allianceTag: claim.alliance_tag || '',
              allianceName: claim.alliance_name || '',
            });
          }
        }
        this.territorySummary = {
          own: claims.filter((c) => String(c.relation) === 'own').length,
          war: claims.filter((c) => String(c.relation) === 'war').length,
        };
      } catch (_) {
        // Silent fail when no alliance/war data is available
      }

      this.fitToView();
      this.attachCanvasEvents();
      this.render();
    }

    // Calculate bounds and fit to canvas
    fitToView() {
      if (!this.stars.length) return;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const star of this.stars) {
        if (typeof star.x_ly === 'number' && typeof star.y_ly === 'number') {
          minX = Math.min(minX, star.x_ly);
          maxX = Math.max(maxX, star.x_ly);
          minY = Math.min(minY, star.y_ly);
          maxY = Math.max(maxY, star.y_ly);
        }
      }

      if (!isFinite(minX)) return;

      const padding = 50;
      const width = this.canvas.width - 2 * padding;
      const height = this.canvas.height - 2 * padding;
      const dataWidth = maxX - minX || 1;
      const dataHeight = maxY - minY || 1;

      this.scale = Math.min(width / dataWidth, height / dataHeight) * 0.95;
      this.panX = padding - minX * this.scale + width / 2 - dataWidth / 2 * this.scale;
      this.panY = padding - minY * this.scale + height / 2 - dataHeight / 2 * this.scale;
    }

    // Render map
    render() {
      if (!this.ctx || !this.canvas) return;

      const w = this.canvas.width;
      const h = this.canvas.height;

      // Clear
      this.ctx.fillStyle = '#0a0a0a';
      this.ctx.fillRect(0, 0, w, h);

      // Grid
      this.drawGrid();

      // Territory backdrop
      this.drawTerritoryOverlay();

      // Stars
      for (const star of this.stars) {
        this.drawStar(star);
      }

      // Hover card
      if (this.hoverStar) {
        this.drawHoverCard(this.hoverStar);
      }

      // Mini-map (top-right inset)
      this.drawMinimap();

      // Legend
      this.drawTerritoryLegend();
    }

    drawTerritoryOverlay() {
      if (!this.territoryClaimsBySystem.size) return;
      for (const star of this.stars) {
        if (typeof star.x_ly !== 'number' || typeof star.y_ly !== 'number') continue;
        const key = `${Number(star.galaxy_index || 0)},${Number(star.system_index || 0)}`;
        const claim = this.territoryClaimsBySystem.get(key);
        if (!claim) continue;
        const x = star.x_ly * this.scale + this.panX;
        const y = star.y_ly * this.scale + this.panY;
        if (x < -32 || x > this.canvas.width + 32 || y < -32 || y > this.canvas.height + 32) continue;
        const relation = String(claim.relation || 'neutral');
        if (relation !== 'own' && relation !== 'war') continue;
        const color = relation === 'war' ? 'rgba(231,76,60,0.22)' : 'rgba(46,204,113,0.20)';
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(x, y, 18, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    drawGrid() {
      this.ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      this.ctx.lineWidth = 1;

      const gridSpacing = 50;
      for (let x = 0; x < this.canvas.width; x += gridSpacing) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, this.canvas.height);
        this.ctx.stroke();
      }
      for (let y = 0; y < this.canvas.height; y += gridSpacing) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(this.canvas.width, y);
        this.ctx.stroke();
      }
    }

    drawStar(star) {
      if (typeof star.x_ly !== 'number' || typeof star.y_ly !== 'number') return;

      const x = star.x_ly * this.scale + this.panX;
      const y = star.y_ly * this.scale + this.panY;

      // Skip off-screen
      if (x < -20 || x > this.canvas.width + 20 || y < -20 || y > this.canvas.height + 20) return;

      const radius = this.luminosityToRadius(star.luminosity_solar);
      const color = this.spectralClassToColor(star.spectral_class);

      // Star glow
      const glow = this.ctx.createRadialGradient(x, y, 0, x, y, radius * 1.5);
      glow.addColorStop(0, color + 'cc');
      glow.addColorStop(1, color + '00');
      this.ctx.fillStyle = glow;
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2);
      this.ctx.fill();

      // Star core
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fill();

      // Player colony marker
      const colKey = `${Number(star.galaxy_index || 0)},${Number(star.system_index || 0)},1`;
      if (this.playerColonies.has(colKey)) {
        this.ctx.strokeStyle = '#00ff00';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        this.ctx.stroke();
      }

      // Alliance territory marker (own / war)
      const claimKey = `${Number(star.galaxy_index || 0)},${Number(star.system_index || 0)}`;
      const claim = this.territoryClaimsBySystem.get(claimKey);
      if (claim && (claim.relation === 'own' || claim.relation === 'war')) {
        this.ctx.strokeStyle = claim.relation === 'war' ? '#e74c3c' : '#2ecc71';
        this.ctx.lineWidth = claim.relation === 'war' ? 2.2 : 1.8;
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
        this.ctx.stroke();
      }

      // Store for hover
      star._screenX = x;
      star._screenY = y;
      star._screenRadius = radius;
    }

    drawHoverCard(star) {
      const x = star._screenX || 0;
      const y = star._screenY || 0;
      const padding = 8;
      const lineHeight = 14;

      const name = esc(star.name || star.catalog_name || `System ${star.system_index}`);
      const spec = String(star.spectral_class || 'G') + String(star.subtype || 0);
      const claimKey = `${Number(star.galaxy_index || 0)},${Number(star.system_index || 0)}`;
      const claim = this.territoryClaimsBySystem.get(claimKey);
      const relationTxt = claim?.relation === 'war'
        ? ' [WAR]'
        : (claim?.relation === 'own' ? ' [OWN]' : '');
      const tagTxt = claim?.allianceTag ? ` <${esc(claim.allianceTag)}>` : '';
      const text = `${name} (${spec})${relationTxt}${tagTxt}`;

      this.ctx.font = '12px monospace';
      const metrics = this.ctx.measureText(text);
      const w = metrics.width + padding * 2;
      const h = lineHeight + padding * 2;

      const cardX = Math.min(x + 12, this.canvas.width - w - 4);
      const cardY = Math.min(y - h - 4, this.canvas.height - h - 4);

      // Card background
      this.ctx.fillStyle = 'rgba(32,32,64,0.9)';
      this.ctx.fillRect(cardX, cardY, w, h);
      this.ctx.strokeStyle = '#4488ff';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(cardX, cardY, w, h);

      // Text
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillText(text, cardX + padding, cardY + padding + 10);
    }

    drawTerritoryLegend() {
      const own = Number(this.territorySummary.own || 0);
      const war = Number(this.territorySummary.war || 0);
      if (own <= 0 && war <= 0) return;

      const x = 10;
      const y = this.canvas.height - 66;
      const w = 210;
      const h = 56;
      this.ctx.fillStyle = 'rgba(22,22,32,0.82)';
      this.ctx.fillRect(x, y, w, h);
      this.ctx.strokeStyle = 'rgba(120,140,180,0.55)';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x, y, w, h);

      this.ctx.font = '12px monospace';
      this.ctx.fillStyle = '#9fd3ff';
      this.ctx.fillText('Alliance Territory', x + 8, y + 14);
      this.ctx.fillStyle = '#2ecc71';
      this.ctx.fillText(`OWN claims: ${own}`, x + 8, y + 31);
      this.ctx.fillStyle = '#e74c3c';
      this.ctx.fillText(`WAR claims: ${war}`, x + 8, y + 47);
    }

    drawMinimap() {
      const minimapW = 120;
      const minimapH = 100;
      const minimapX = this.canvas.width - minimapW - 8;
      const minimapY = 8;

      // Background
      this.ctx.fillStyle = 'rgba(32,32,64,0.7)';
      this.ctx.fillRect(minimapX, minimapY, minimapW, minimapH);
      this.ctx.strokeStyle = '#4488ff';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(minimapX, minimapY, minimapW, minimapH);

      // Minimap stars (tiny dots)
      for (const star of this.stars) {
        if (!this.stars.length) continue;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const s of this.stars) {
          if (typeof s.x_ly === 'number' && typeof s.y_ly === 'number') {
            minX = Math.min(minX, s.x_ly);
            maxX = Math.max(maxX, s.x_ly);
            minY = Math.min(minY, s.y_ly);
            maxY = Math.max(maxY, s.y_ly);
          }
        }
        if (!isFinite(minX)) return;

        const dataW = maxX - minX || 1;
        const dataH = maxY - minY || 1;
        const miniScale = Math.min(minimapW, minimapH) / Math.max(dataW, dataH) * 0.9;

        const mmx = minimapX + (star.x_ly - minX) * miniScale + (minimapW - dataW * miniScale) / 2;
        const mmy = minimapY + (star.y_ly - minY) * miniScale + (minimapH - dataH * miniScale) / 2;

        this.ctx.fillStyle = this.spectralClassToColor(star.spectral_class);
        this.ctx.beginPath();
        this.ctx.arc(mmx, mmy, 1, 0, Math.PI * 2);
        this.ctx.fill();

        // Player colonies in minimap
        const colKey = `${Number(star.galaxy_index || 0)},${Number(star.system_index || 0)},1`;
        if (this.playerColonies.has(colKey)) {
          this.ctx.strokeStyle = '#00ff00';
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.ctx.arc(mmx, mmy, 3, 0, Math.PI * 2);
          this.ctx.stroke();
        }
      }
    }

    attachCanvasEvents() {
      if (!this.canvas) return;

      this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
      this.canvas.addEventListener('mouseleave', () => this.onMouseLeave());
      this.canvas.addEventListener('click', (e) => this.onClick(e));
    }

    onMouseMove(e) {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      this.hoverStar = null;
      for (const star of this.stars) {
        if (!star._screenX) continue;
        const dx = mx - star._screenX;
        const dy = my - star._screenY;
        const dist = Math.hypot(dx, dy);
        if (dist <= star._screenRadius + 6) {
          this.hoverStar = star;
          this.canvas.style.cursor = 'pointer';
          this.render();
          return;
        }
      }
      this.canvas.style.cursor = 'default';
      this.render();
    }

    onMouseLeave() {
      this.hoverStar = null;
      this.render();
    }

    onClick(e) {
      if (!this.hoverStar) return;
      const g = Number(this.hoverStar.galaxy_index || 1);
      const s = Number(this.hoverStar.system_index || 1);
      galaxyController.jumpToSearchStar(this.hoverStar);
    }
  }

  const galaxyController = new GalaxyController();
  window.GQGalaxyController = galaxyController;

  const galaxy2dMap = new GalaxyMap2DController();
  window.GQGalaxy2DMap = galaxy2dMap;

  async function focusHomeSystemInGalaxy(root) {
    await galaxyController.focusHomeSystem(root);
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
      <div class="planet-detail-row">Bedrohungsgrad: <span class="threat-chip threat-${esc(intel.threat.level)}">${esc(intel.threat.label)} · ${esc(String(intel.threat.score))}</span></div>
      <div class="planet-detail-row">Letzter Scan: ${intel.latest_scan_at ? esc(new Date(intel.latest_scan_at).toLocaleString()) : 'Kein Scan vorhanden'}</div>
      <div class="planet-detail-row">Scanlage: ${scan ? `${esc(String(scan.ship_count))} Schiffe · Kampfkraft ${esc(String(scan.combat_power_estimate))} · Leader ${esc(String(scan.leader_count))}` : 'Erstspionage empfohlen'}</div>
      <div class="planet-detail-row">Diplomatie: ${esc(payload.diplomacy_hint || 'Keine Einschätzung verfügbar.')}</div>
      <div class="territory-mini-list">${territory.slice(0, 3).map((f) => `
        <span class="territory-chip" style="--territory-color:${esc(f.color)}">${esc(f.icon)} ${esc(f.name)} · ${esc(f.government?.icon || '🏳')} ${esc(f.government?.label || 'Herrschaft')}</span>`).join('') || '<span class="text-muted">Keine Sektoransprüche</span>'}
      </div>
      ${clusters.length ? `<div class="planet-detail-row">Cluster: ${clusters.slice(0, 2).map((cluster) => `${esc(cluster.label)} ${esc(String(cluster.from))}-${esc(String(cluster.to))}`).join(' · ')}</div>` : ''}`;
  }

  class OverviewController {
    constructor() {
      this.templates = {
        fleetRow: `
          <div class="fleet-row">
            <span class="fleet-mission">{{{mission}}}</span>
            <span class="fleet-target">→ [{{{targetGalaxy}}}:{{{targetSystem}}}:{{{targetPosition}}}]</span>
            {{{positionHtml}}}
            <span class="fleet-timer" data-end="{{{arrivalTimeRaw}}}">{{{arrivalCountdown}}}</span>
            <div class="progress-bar-wrap fleet-progress-wrap" style="width:80px">
              <div class="progress-bar fleet-progress-bar" style="width:{{{progressPct}}}%" data-dep="{{{departureTimeRaw}}}" data-arr="{{{arrivalTimeRaw}}}"></div>
            </div>
            {{{vesselListHtml}}}
            {{{returningBadgeHtml}}}
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
      planetSelect.innerHTML = colonies.map((colony) =>
        `<option value="${colony.id}">${esc(colony.name)} [${colony.galaxy}:${colony.system}:${colony.position}]</option>`
      ).join('');
      if (!currentColony && colonies.length) {
        selectColonyById(colonies[0].id);
      }
    }

    updateResourceBar() {
      if (!currentColony) return;
      document.getElementById('res-metal').textContent = fmt(currentColony.metal);
      document.getElementById('res-crystal').textContent = fmt(currentColony.crystal);
      document.getElementById('res-deuterium').textContent = fmt(currentColony.deuterium);
      document.getElementById('res-energy').textContent = currentColony.energy ?? '—';
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
          if (root) root.innerHTML = `<p class="text-muted" style="color:#e74c3c">⚠ ${data.error || 'Nicht eingeloggt. Bitte neu laden.'}</p>`;
          return;
        }

        colonies = data.colonies || [];
        window._GQ_battles = data.battles || [];
        window._GQ_politics = data.politics || null;
        window._GQ_meta = data.user_meta || {};
        window._GQ_fleets = data.fleets || [];
        window._GQ_offline = data.offline_progress || null;

        this.populatePlanetSelect();
        this.updateResourceBar();
        this.applyBadges(data);
        WM.refresh('overview');
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
          root.innerHTML = `<p class="text-muted" style="color:#e74c3c">⚠ Fehler beim Laden: ${e.message || e}</p>`;
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
        showToast('Kostenprüfung nicht möglich (Netzwerk). Auto-Upgrade aus Sicherheitsgründen abgebrochen.', 'warning');
        return;
      }
      if (!buildingsPayload?.success) {
        showToast(buildingsPayload?.error || 'Kostenprüfung fehlgeschlagen. Auto-Upgrade abgebrochen.', 'warning');
        return;
      }

      const buildingEntry = (buildingsPayload.buildings || []).find((b) => String(b.type || '') === String(focusBuilding || ''));
      if (!buildingEntry) {
        showToast(`Gebäude ${fmtName(focusBuilding)} nicht verfügbar.`, 'warning');
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
              return `⚠ ${esc(String(risk.colony_name || 'Colony'))}: ${this.riskLabel(risk.status)} · Score ${esc(String(risk.risk_score || 0))} · 🌾 ${esc(String(risk.food_rate_per_hour || 0))}/h · ⚡ ${esc(String(risk.energy || 0))}${flags ? ` · ${esc(flags)}` : ''} <button type="button" class="btn btn-secondary btn-sm" data-risk-action="focus" data-risk-cid="${cid}" data-risk-focus="${esc(focus)}" style="margin-left:0.35rem;padding:0.2rem 0.45rem;font-size:0.7rem">Fix</button><button type="button" class="btn btn-primary btn-sm" data-risk-action="auto" data-risk-cid="${cid}" data-risk-focus="${esc(focus)}" style="margin-left:0.25rem;padding:0.2rem 0.45rem;font-size:0.7rem">Auto +1</button>`;
            }).join('<br>')}
          </div>`
        : '<div class="system-row text-cyan" style="font-size:0.8rem">Keine akuten Wirtschaftsrisiken erkannt.</div>';

      return `
        <div class="system-card" style="margin:0.75rem 0 0.6rem">
          <div class="system-row"><strong>Ökonomie-Snapshot</strong>${hadOfflineTime ? ` · Offline-Zeit: ${Math.max(1, Math.round((Number(offline?.max_elapsed_seconds || 0) / 60)))} min` : ''}</div>
          <div class="system-row" style="font-size:0.8rem;color:var(--text-secondary)">
            ⬡ ${this.signed(netRates?.metal, 1)}/h · 💎 ${this.signed(netRates?.crystal, 1)}/h · 🔵 ${this.signed(netRates?.deuterium, 1)}/h · 🌾 ${this.signed(netRates?.food, 1)}/h · 👥 ${this.signed(netRates?.population, 2)}/h
          </div>
          <div class="system-row" style="font-size:0.8rem;color:var(--text-secondary)">
            Stabil: ${statusCounts.stable || 0} · Beobachten: ${statusCounts.watch || 0} · Kritisch: ${statusCounts.strain || 0}
            ${economy ? ` · Wohlfahrt Ø ${(Number(economy.avg_welfare || 0)).toFixed(1)}%` : ''}
          </div>
          ${topRiskHtml}
        </div>`;
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
          ? `<span class="fleet-pos" title="3D position">📍 ${esc(String(pos.x.toFixed(0)))}, ${esc(String(pos.y.toFixed(0)))}, ${esc(String(pos.z.toFixed(0)))} ly</span>`
          : '';
        const vesselChips = (fleet.vessels || [])
          .slice(0, 5)
          .map((vessel) => `<span class="fleet-vessel-chip">${esc(fmtName(vessel.type))} x${esc(String(vessel.count))}</span>`)
          .join('');
        const vesselListHtml = vesselChips ? `<div class="fleet-vessel-list">${vesselChips}</div>` : '';
        const progressPct = ((pos.progress || 0) * 100).toFixed(0);
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
          returningBadgeHtml: fleet.returning ? '<span class="fleet-returning">↩ Returning</span>' : '',
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
          loot.metal > 0 ? `⬡${fmt(loot.metal)}` : '',
          loot.crystal > 0 ? `💎${fmt(loot.crystal)}` : '',
          loot.deuterium > 0 ? `🔵${fmt(loot.deuterium)}` : '',
          loot.rare_earth > 0 ? `💜${fmt(loot.rare_earth)}` : '',
        ].filter(Boolean).join(' ');
        return {
          battleClass: won ? 'battle-win' : 'battle-loss',
          resultLabel: won ? '⚔ Victory' : '💀 Defeat',
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
          planetSelect.value = String(cid);
          this.updateResourceBar();
          this.render();
        });
      });

      root.querySelector('#open-leaders-btn')?.addEventListener('click', () => WM.open('leaders'));

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
          showToast(response.pvp_mode ? '⚔ PvP enabled!' : '🛡 PvP disabled.', 'info');
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
        root.innerHTML = '<p class="text-muted">No colonies yet.</p>';
        return;
      }

      const meta = window._GQ_meta || {};
      const protUntil = meta.protection_until ? new Date(meta.protection_until) : null;
      const protected_ = protUntil && protUntil > Date.now();
      const pvpOn = !!parseInt(meta.pvp_mode, 10);
      const protText = protected_ ? `🛡 Newbie protection until ${protUntil.toLocaleDateString()}` : '🛡 No protection';
      const colonyTypeLabels = {
        balanced: '⚖ Balanced', mining: '⛏ Mining', industrial: '🏭 Industrial',
        research: '🔬 Research', agricultural: '🌾 Agricultural', military: '⚔ Military'
      };
      const offline = window._GQ_offline || null;

      root.innerHTML = `
        <div class="status-bar">
          <span class="status-chip ${protected_ ? 'chip-shield' : 'chip-neutral'}">${protText}</span>
          <span class="status-chip ${pvpOn ? 'chip-pvp-on' : 'chip-pvp-off'}">⚔ PvP: ${pvpOn ? 'ON' : 'OFF'}</span>
          <button id="pvp-toggle-btn" class="btn btn-sm ${pvpOn ? 'btn-warning' : 'btn-secondary'}" ${protected_ ? 'disabled' : ''}>
            ${pvpOn ? 'Disable PvP' : 'Enable PvP'}
          </button>
          <span class="status-chip chip-rank">★ ${fmt(meta.rank_points ?? 0)} RP</span>
          <span class="status-chip chip-dm">◆ ${fmt(meta.dark_matter ?? 0)} DM</span>
          <button class="btn btn-secondary btn-sm" id="open-leaders-btn">👤 Leaders</button>
        </div>

        ${this.buildOfflineSummaryHtml(offline)}

        <h3 style="margin:0.75rem 0 0.5rem">Your Colonies</h3>
        <div class="overview-grid">
          ${colonies.map((colony) => {
            const leaderChips = (colony.leaders || []).map((leader) =>
              `<span class="leader-chip" title="${esc(leader.role)} Lv${leader.level} – ${leader.last_action || 'idle'}">
                 ${leader.role === 'colony_manager' ? '🏗' : leader.role === 'science_director' ? '🔬' : '⚔'} ${esc(leader.name)}
               </span>`
            ).join('');
            return `
            <div class="planet-card ${currentColony && colony.id === currentColony.id ? 'selected' : ''}" data-cid="${colony.id}">
              <div class="planet-card-name">${esc(colony.name)}
                ${colony.is_homeworld ? '<span class="hw-badge">🏠</span>' : ''}
              </div>
              <div class="planet-card-coords">[${colony.galaxy}:${colony.system}:${colony.position}]</div>
              <div class="planet-card-type">
                <span class="colony-type-badge">${colonyTypeLabels[colony.colony_type] || colony.colony_type}</span>
                • ${fmtName(colony.planet_type || 'terrestrial')}
                ${colony.in_habitable_zone ? '<span class="hz-badge" title="Habitable Zone">🌿</span>' : ''}
              </div>
              <div style="margin-top:0.4rem;font-size:0.78rem;color:var(--text-secondary)">
                ⬡ ${fmt(colony.metal)} &nbsp; 💎 ${fmt(colony.crystal)} &nbsp; 🔵 ${fmt(colony.deuterium)}
                ${parseFloat(colony.rare_earth || 0) > 0 ? `&nbsp; 💜 ${fmt(colony.rare_earth)}` : ''}
              </div>
              <div style="margin-top:0.2rem;font-size:0.75rem;color:var(--text-secondary)">
                🌾 ${fmt(colony.food || 0)} &nbsp; ⚡ ${colony.energy ?? 0}
              </div>
              <div class="welfare-bar" style="margin-top:0.4rem">
                <span title="Happiness ${colony.happiness ?? 70}%">😊</span>
                <div class="bar-wrap"><div class="bar-fill bar-happiness" style="width:${colony.happiness ?? 70}%"></div></div>
                <span style="font-size:0.7rem;min-width:28px">${colony.happiness ?? 70}%</span>
              </div>
              <div class="welfare-bar">
                <span title="Population ${colony.population ?? 0}/${colony.max_population ?? 500}">👥</span>
                <div class="bar-wrap"><div class="bar-fill bar-population" style="width:${Math.min(100, Math.round((colony.population ?? 0) / (colony.max_population || 500) * 100))}%"></div></div>
                <span style="font-size:0.7rem;min-width:28px">${fmt(colony.population ?? 0)}</span>
              </div>
              <div class="welfare-bar">
                <span title="Public Services ${colony.public_services ?? 0}%">🏥</span>
                <div class="bar-wrap"><div class="bar-fill bar-services" style="width:${colony.public_services ?? 0}%"></div></div>
                <span style="font-size:0.7rem;min-width:28px">${colony.public_services ?? 0}%</span>
              </div>
              ${colony.deposit_metal >= 0 ? `
                <div style="margin-top:0.3rem;font-size:0.7rem">
                  <span class="deposit-chip ${colony.deposit_metal < 100000 ? 'depleted' : ''}" title="Metal deposit remaining">⬡ ${fmt(colony.deposit_metal)}</span>
                  <span class="deposit-chip ${colony.deposit_crystal < 50000 ? 'depleted' : ''}" title="Crystal deposit">💎 ${fmt(colony.deposit_crystal)}</span>
                  <span class="deposit-chip rare-earth-chip" title="Rare Earth deposit">💜 ${fmt(colony.deposit_rare_earth)}</span>
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

  // ── Resource bar ─────────────────────────────────────────
  function updateResourceBar() {
    overviewController.updateResourceBar();
  }

  // ── Overview data load ────────────────────────────────────
  async function loadOverview() {
    await overviewController.load();
  }

  // ── Overview window ───────────────────────────────────────
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
            <div class="colony-view-meta">${esc(fmtName(currentColony.planet_class || currentColony.planet_type || 'planet'))} · ${esc(String(currentColony.diameter || layout?.planet_scale?.diameter || 0))} km · ${esc(layout?.planet_scale?.tier || 'standard')}</div>
          </div>
          <div class="colony-view-actions">
            <button class="btn btn-secondary btn-sm" id="colony-open-buildings-btn">Buildings</button>
            <button class="btn btn-secondary btn-sm" id="colony-open-shipyard-btn">Shipyard</button>
          </div>
        </div>
        ${buildingFocus ? `<div class="build-focus-banner">Rasterfokus: ${esc(fmtName(buildingFocus))}${uiState.colonyViewFocus?.source ? ` · Quelle: ${esc(uiState.colonyViewFocus.source)}` : ''}</div>` : ''}
        <div class="colony-capacity-row">${Object.entries(classCaps).map(([key, value]) => `<span class="colony-cap-chip">${esc(buildingZoneLabel(key))}: ${esc(String(value))}</span>`).join('')}</div>
        <div class="colony-grid" style="grid-template-columns:repeat(${grid.cols}, minmax(0, 1fr));">
          ${grid.cells.map((cell) => {
            const building = cell.building;
            const anchor = !!building && cell.fill === 0;
            const focusType = building ? String(building.type || '') : pickZoneBuildFocus(cell.zone, currentColony, buildings);
            return `<button type="button" class="colony-cell colony-zone-${esc(cell.zone)} ${building ? 'occupied' : 'empty'} ${anchor ? 'anchor' : ''} ${buildingFocus && focusType === buildingFocus ? 'colony-cell-focus' : ''}" data-focus-building="${esc(focusType)}" data-cell-zone="${esc(cell.zone)}" data-cell-state="${building ? 'occupied' : 'empty'}" title="${building ? esc(building.meta?.label || fmtName(building.type)) : esc(buildingZoneLabel(cell.zone))}">
              ${building ? `<span class="colony-cell-icon">${esc(building.meta?.icon || '🏗')}</span><span class="colony-cell-label">${esc(fmtName(building.type))}</span><span class="colony-cell-level">Lv ${esc(String(building.level || 0))}</span>` : `<span class="colony-cell-icon">${esc(getBuildingUiMeta(focusType).icon || '🏗')}</span><span class="colony-cell-label">${esc(fmtName(focusType))}</span><span class="colony-cell-empty">${esc(buildingZoneLabel(cell.zone))}</span>`}
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
      root.innerHTML = '<p class="text-muted">Loading colony view…</p>';

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
          ${active ? `<div class="system-row">🔧 Aktiv: ${esc(fmtName(active.type || 'building'))} -> Lv ${esc(String(active.target_level || '?'))} · ETA <span data-end="${esc(active.eta)}">${countdown(active.eta)}</span></div>` : '<div class="system-row text-muted">Aktuell kein aktiver Auftrag.</div>'}
          ${queued.length ? `<div class="system-row">📋 Wartend: ${queued.map((q) => `${esc(fmtName(q.type || 'building'))} -> Lv ${esc(String(q.target_level || '?'))}`).join(' · ')}</div>` : '<div class="system-row text-muted">Keine weiteren Aufträge in Warteschlange.</div>'}
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
                ${cost.metal ? `<span class="cost-metal">⬡ ${fmt(cost.metal)}</span>` : ''}
                ${cost.crystal ? `<span class="cost-crystal">💎 ${fmt(cost.crystal)}</span>` : ''}
                ${cost.deuterium ? `<span class="cost-deut">🔵 ${fmt(cost.deuterium)}</span>` : ''}
              </div>
              ${busy
                ? `<div class="item-timer">⏳ <span data-end="${esc(building.upgrade_end)}">${countdown(building.upgrade_end)}</span></div><div class="progress-bar-wrap"><div class="progress-bar" data-start="${esc(building.upgrade_start||'')}" data-end="${esc(building.upgrade_end)}" style="width:0%"></div></div>`
                : `<button class="btn btn-primary btn-sm upgrade-btn" data-type="${esc(building.type)}">↑ Upgrade</button>`}
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
        else showToast(`Upgrading ${fmtName(type)} -> Lv ${targetLevel}…`, 'success');
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
      root.innerHTML = '<p class="text-muted">Loading…</p>';
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
          html += `<div class="build-focus-banner">Fokus: ${fmtName(buildingFocus)}${uiState.colonyViewFocus?.source ? ` · Quelle: ${esc(uiState.colonyViewFocus.source)}` : ''}</div>`;
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

  // ── Buildings window ──────────────────────────────────────
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
            ${locked ? `<div class="item-locked-badge">🔒 Locked</div>` : ''}
            <div class="item-cost">
              ${cost.metal ? `<span class="cost-metal">⬡ ${fmt(cost.metal)}</span>` : ''}
              ${cost.crystal ? `<span class="cost-crystal">💎 ${fmt(cost.crystal)}</span>` : ''}
              ${cost.deuterium ? `<span class="cost-deut">🔵 ${fmt(cost.deuterium)}</span>` : ''}
            </div>
            ${locked && missing.length ? `<div class="item-prereq-hint" title="Prerequisites">Requires: ${esc(missingText)}</div>` : ''}
            ${busy
              ? `<div class="item-timer">🔬 <span data-end="${esc(row.research_end)}">${countdown(row.research_end)}</span></div><div class="progress-bar-wrap"><div class="progress-bar" data-start="${esc(row.research_start||'')}" data-end="${esc(row.research_end)}" style="width:0%"></div></div>`
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
            showToast(`Researching ${fmtName(btn.dataset.type)}…`, 'success');
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
      root.innerHTML = '<p class="text-muted">Loading…</p>';

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

  // ── Research window ───────────────────────────────────────
  async function renderResearch() {
    await researchController.render();
  }

  class ShipyardController {
    buildCardsHtml(ships) {
      return `<div class="card-grid">${ships.map((ship) => `
        <div class="item-card">
          <div class="item-card-header">
            <span class="item-name">${fmtName(ship.type)}</span>
            <span class="item-level">${ship.count} owned</span>
          </div>
          <div class="item-cost">
            ${ship.cost.metal ? `<span class="cost-metal">⬡ ${fmt(ship.cost.metal)}</span>` : ''}
            ${ship.cost.crystal ? `<span class="cost-crystal">💎 ${fmt(ship.cost.crystal)}</span>` : ''}
            ${ship.cost.deuterium ? `<span class="cost-deut">🔵 ${fmt(ship.cost.deuterium)}</span>` : ''}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted)">
            �� ${fmt(ship.cargo)} &nbsp; ⚡ ${fmt(ship.speed)}
          </div>
          <div class="ship-build-row">
            <input type="number" class="ship-qty" data-type="${esc(ship.type)}" min="1" value="1" />
            <button class="btn btn-primary btn-sm build-btn" data-type="${esc(ship.type)}">Build</button>
          </div>
        </div>`).join('')}</div>`;
    }

    bindActions(root) {
      root.querySelectorAll('.build-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const type = btn.dataset.type;
          const qty = parseInt(root.querySelector(`.ship-qty[data-type="${type}"]`).value, 10) || 1;
          btn.disabled = true;
          const res = await API.buildShip(currentColony.id, type, qty);
          if (res.success) {
            showToast(`Built ${qty}× ${fmtName(type)}`, 'success');
            if (audioManager && typeof audioManager.playBuildComplete === 'function') audioManager.playBuildComplete();
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
    }

    async render() {
      const root = WM.body('shipyard');
      if (!root) return;
      if (!currentColony) {
        root.innerHTML = '<p class="text-muted">Select a colony first.</p>';
        return;
      }
      root.innerHTML = '<p class="text-muted">Loading…</p>';

      try {
        const data = await API.ships(currentColony.id);
        if (!data.success) {
          root.innerHTML = '<p class="text-red">Error.</p>';
          return;
        }
        root.innerHTML = this.buildCardsHtml(data.ships || []);
        this.bindActions(root);
      } catch (_) {
        root.innerHTML = '<p class="text-red">Failed to load shipyard.</p>';
      }
    }
  }

  const shipyardController = new ShipyardController();
  window.GQShipyardController = shipyardController;

  // ── Shipyard window ───────────────────────────────────────
  async function renderShipyard() {
    await shipyardController.render();
  }

  // ── Fleet window ──────────────────────────────────────────
  async function renderFleetForm() {
    await fleetController.renderForm();
  }

  // ── Galaxy window (3D) ───────────────────────────────────
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
        const card = root.querySelector('#galaxy-hover-card');
        if (card) card.classList.add('hidden');
      } else if (k === 'l') {
        e.preventDefault();
        const enabled = galaxy3d && typeof galaxy3d.toggleFollowSelection === 'function'
          ? galaxy3d.toggleFollowSelection()
          : false;
        updateGalaxyFollowUi(root);
        showToast(`Selection follow ${enabled ? 'enabled' : 'disabled'} (L to toggle).`, 'info');
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
      hasCanvas: !!root?.querySelector?.('#galaxy-3d-canvas'),
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
          Galaxy3DRenderer: ${esc(diag.rendererGlobal)} · THREE: ${esc(diag.threeGlobal)} (${esc(diag.threeRevision)})<br/>
          Canvas: ${diag.hasCanvas ? 'yes' : 'no'} · WebGL: ${esc(diag.webglSupport)} · Last reason: ${esc(diag.reason)} · ${esc(diag.time)}
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
    const card = root.querySelector('#galaxy-hover-card');
    if (!card) return;
    if (!star || !pos) {
      if (!pinnedStar || !pinned) card.classList.add('hidden');
      return;
    }
    if (star.__kind === 'planet') {
      const sourceStar = star.__sourceStar || {};
      const title = star.name || fmtName(String(star.planet_class || 'planet'));
      const owner = star.owner ? ` · ${esc(star.owner)}` : '';
      card.innerHTML = `
        <div class="hover-title hover-title-planet"><span class="hover-planet-icon">${planetIcon(star.planet_class)}</span>${esc(title)}</div>
        <div class="hover-meta">${esc(star.planet_class || 'Planet')} · slot ${esc(String(star.__slot?.position || star.position || '?'))}${owner}</div>
        <div class="hover-meta">around ${esc(sourceStar.name || sourceStar.catalog_name || 'system star')}</div>`;
    } else if (star.__kind === 'cluster') {
      const systems = Array.isArray(star.__clusterSystems) ? star.__clusterSystems : [];
      const from = systems.length ? Math.min(...systems) : Number(star.from || 0);
      const to = systems.length ? Math.max(...systems) : Number(star.to || 0);
      const clusterColor = String(star.__clusterColor || '#ff7b72');
      card.innerHTML = `
        <div class="hover-title"><span class="hover-star-dot" style="background:${esc(clusterColor)};box-shadow:0 0 10px ${esc(clusterColor)};"></span>${esc(star.label || star.name || `Cluster ${Number(star.__clusterIndex || 0) + 1}`)}</div>
        <div class="hover-meta">Systeme: ${esc(String(from || '?'))} - ${esc(String(to || '?'))}</div>
        <div class="hover-meta">Hover/Klick selektiert · Doppelklick zoomt in die Bounding Box</div>`;
    } else {
      const starColor = starClassColor(star.spectral_class);
      card.innerHTML = `
        <div class="hover-title"><span class="hover-star-dot" style="background:${starColor};box-shadow:0 0 8px ${starColor};"></span>${esc(star.name)}</div>
        <div class="hover-meta">${esc(star.spectral_class)}${esc(String(star.subtype ?? ''))} · ${star.galaxy_index}:${star.system_index}</div>`;
    }

    card.style.left = `${Math.max(10, Math.min(pos.x, root.clientWidth - 10))}px`;
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
    const followEnabled = !galaxy3d || typeof galaxy3d.isFollowingSelection !== 'function'
      ? true
      : galaxy3d.isFollowingSelection();
    const quickNavActions = [
      { action: 'home', label: '🏠', title: 'Jump to home system' },
      { action: 'zoom-in', label: '+', title: 'Zoom in' },
      { action: 'zoom-out', label: '−', title: 'Zoom out' },
      { action: 'rotate-left', label: '◀', title: 'Rotate left' },
      { action: 'rotate-right', label: '▶', title: 'Rotate right' },
      { action: 'rotate-up', label: '▲', title: 'Rotate up' },
      { action: 'rotate-down', label: '▼', title: 'Rotate down' },
      { action: 'focus', label: '◎', title: 'Focus selection' },
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
    if (!star) {
      details.innerHTML = `${navButtons}<span class="text-muted">Press I for this overlay. Camera: mouse drag + wheel, keyboard WASD/QE + arrows, F fit, R reset, L follow ${followEnabled ? 'off' : 'on'}.</span>`;
      details.querySelectorAll('[data-nav-action]').forEach((button) => {
        button.addEventListener('click', () => triggerGalaxyNavAction(button.getAttribute('data-nav-action'), root));
      });
      return;
    }

    if (star.__kind === 'cluster') {
      const systems = Array.isArray(star.__clusterSystems) ? star.__clusterSystems : [];
      const from = systems.length ? Math.min(...systems) : Number(star.from || 0);
      const to = systems.length ? Math.max(...systems) : Number(star.to || 0);
      const factionName = star?.faction?.name ? ` · ${esc(star.faction.name)}` : '';
      details.innerHTML = `
        <div class="system-card">
          <div class="system-title">${esc(star.label || `Cluster ${Number(star.__clusterIndex || 0) + 1}`)}</div>
          ${navButtons}
          <div class="system-row">Clusterbereich: ${esc(String(from || '?'))} - ${esc(String(to || '?'))}${factionName}</div>
          <div class="system-row">Bounding Box: ${Number(star.__clusterSize?.x || 0).toFixed(1)} × ${Number(star.__clusterSize?.y || 0).toFixed(1)} × ${Number(star.__clusterSize?.z || 0).toFixed(1)}</div>
          <div class="system-row">Center: ${Number(star.__clusterCenter?.x || 0).toFixed(1)}, ${Number(star.__clusterCenter?.y || 0).toFixed(1)}, ${Number(star.__clusterCenter?.z || 0).toFixed(1)}</div>
          <div class="system-row">Cluster gebunden, rotiert mit der Sternwolke und ist per Mouse hover-/selektierbar.</div>
          <div class="system-row">Klick fokussiert die Box, Doppelklick zoomt clusterweise hinein.</div>
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

    // FoW visibility indicator
    const fowLevel = star.visibility_level || 'unknown';
    const fowLabels = { own: '🏠 Eigene Kolonie', active: '🛸 Flotte aktiv', stale: '⏳ Veraltete Aufklärung', unknown: '🌑 Unerforscht' };
    const fowHtml = `<div class="system-row ${fowLevel === 'unknown' ? 'fow-unknown-badge' : ''}" style="${fowLevel === 'stale' ? 'color:#e8c843' : ''}">${esc(fowLabels[fowLevel] || fowLevel)}</div>`;

    details.innerHTML = `
      <div class="system-card">
        <div class="system-title">${esc(star.name)}</div>
        ${navButtons}
        <div class="system-row">Catalog: ${esc(star.catalog_name || '—')}</div>
        <div class="system-row">Galaxy/System: ${star.galaxy_index}:${star.system_index}</div>
        <div class="system-row">Class: ${esc(star.spectral_class)}${esc(String(star.subtype ?? ''))}</div>
        <div class="system-row">Coordinates: ${Number(star.x_ly || 0).toFixed(0)}, ${Number(star.y_ly || 0).toFixed(0)}, ${Number(star.z_ly || 0).toFixed(0)} ly</div>
        <div class="system-row">Habitable Zone: ${Number(star.hz_inner_au || 0).toFixed(2)} - ${Number(star.hz_outer_au || 0).toFixed(2)} AU</div>
        <div class="system-row">Planets: ${planetCountHtml}</div>
        ${fowHtml}
        <div class="system-row">Selection Follow: ${followEnabled ? 'locked' : 'free'} (L)</div>
        <div class="system-row">${zoomed ? 'System view active. Esc/F/R returns to galaxy overview.' : 'Double click to zoom into the system and show planets.'}</div>
        <div class="system-row" style="margin-top:0.4rem">
          <button id="gal-quicknav-fav-btn" type="button" class="btn btn-secondary btn-sm${isFav ? ' active' : ''}">${isFav ? '★ Favorit entfernen' : '☆ Favorit hinzufügen'}</button>
        </div>
      </div>`;
    details.querySelectorAll('[data-nav-action]').forEach((button) => {
      button.addEventListener('click', () => triggerGalaxyNavAction(button.getAttribute('data-nav-action'), root));
    });
    details.querySelector('#gal-quicknav-fav-btn')?.addEventListener('click', () => {
      const btn = details.querySelector('#gal-quicknav-fav-btn');
      if (isFavoriteStar(star)) {
        removeFavorite(`${Number(star.galaxy_index)}:${Number(star.system_index)}`);
        if (btn) { btn.textContent = '☆ Favorit hinzufügen'; btn.classList.remove('active'); }
        showToast(`${star.name} aus Favoriten entfernt.`, 'info');
      } else {
        addFavorite(star);
        if (btn) { btn.textContent = '★ Favorit entfernen'; btn.classList.add('active'); }
        showToast(`${star.name} als Favorit gespeichert.`, 'success');
      }
      updateFooterQuickNavBadge();
      WM.refresh('quicknav');
    });
  }

  // ── QuickNav / Favoriten ──────────────────────────────────────────────────
  const QUICKNAV_KEY = 'gq_quicknav';
  const QUICKNAV_RIBBONS = [
    { id: '', label: 'Keine' },
    { id: 'home',   label: '🏠 Home'   },
    { id: 'colony', label: '🌍 Kolonie' },
    { id: 'combat', label: '⚔ Kampf'   },
    { id: 'watch',  label: '👁 Beobachten' },
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
        <input id="qn-search" class="quicknav-search" type="search" placeholder="Name oder Koordinate suchen…" value="${esc(prevSearch)}" autocomplete="off" />
        <select id="qn-sort" class="quicknav-sort" title="Sortierung">
          <option value="recent"   ${prevSort === 'recent'   ? 'selected' : ''}>↓ Hinzugefügt</option>
          <option value="name"     ${prevSort === 'name'     ? 'selected' : ''}>A–Z Name</option>
          <option value="name-z"   ${prevSort === 'name-z'   ? 'selected' : ''}>Z–A Name</option>
          <option value="system"   ${prevSort === 'system'   ? 'selected' : ''}>System-Nr.</option>
          <option value="ribbon"   ${prevSort === 'ribbon'   ? 'selected' : ''}>Ribbon</option>
        </select>
        <div class="quicknav-ribbon-filter">
          <button class="quicknav-ribbon-pill${prevRibbon === 'all' ? ' active' : ''}" data-ribbon="all">Alle</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'home' ? ' active' : ''}" data-ribbon="home">🏠</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'colony' ? ' active' : ''}" data-ribbon="colony">🌍</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'combat' ? ' active' : ''}" data-ribbon="combat">⚔</button>
          <button class="quicknav-ribbon-pill${prevRibbon === 'watch' ? ' active' : ''}" data-ribbon="watch">👁</button>
          <button class="quicknav-ribbon-pill${prevRibbon === '' ? ' active' : ''}" data-ribbon="">◌</button>
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
          Keine Favoriten${ribbon !== 'all' || search ? ' für diese Auswahl' : ''}.<br/>
          <span style="font-size:0.77rem">Stern im Galaxy-Detail-Panel mit <strong>☆ Favorit</strong> markieren.</span>
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
            <button class="quicknav-item-btn go" data-fav-key="${esc(fav.key)}" title="Ansteuern">→</button>
            <button class="quicknav-item-btn remove" data-fav-key="${esc(fav.key)}" title="Aus Favoriten entfernen">✕</button>
          </div>
        </div>`;
      }).join('');
    };

    renderList();

    // ── Events ─────────────────────────────────────────────────────────────
    const navigateToFav = (key) => {
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
      if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') galaxy3d.focusOnStar(starData, true);
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
      if (goBtn) { navigateToFav(goBtn.dataset.favKey); return; }
      if (removeBtn) {
        removeFavorite(removeBtn.dataset.favKey);
        updateFooterQuickNavBadge();
        renderList();
        const galaxyRoot = WM.body('galaxy');
        if (galaxyRoot && pinnedStar) renderGalaxySystemDetails(galaxyRoot, pinnedStar, !!galaxy3d?.systemMode);
        return;
      }
      if (itemRow && !e.target.closest('select') && !e.target.closest('button')) {
        navigateToFav(itemRow.dataset.favKey);
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
      if (key > 0) map.set(key, s);
    });
    (Array.isArray(incomingStars) ? incomingStars : []).forEach((s) => {
      if (Number(s?.galaxy_index || g) !== g) return;
      const key = Number(s?.system_index || 0);
      if (key > 0) map.set(key, s);
    });
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value);
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
        data = await API.galaxyStars(g, start, end, chunkSize);
      } catch (netErr) {
        console.warn('[GQ] hydrateGalaxyRangeInBackground: chunk request failed', { g, start, end, error: netErr });
        continue;
      }
      if (!data?.success || !Array.isArray(data.stars)) continue;

      const responseTs = Number(data.server_ts_ms || Date.now());
      galaxyStars = mergeGalaxyStarsBySystem(galaxyStars, data.stars, g);
      loadedChunks += 1;
      loadedSystems += data.stars.length;

      if (galaxyModel) {
        galaxyModel.upsertStarBatch(g, data.stars);
        galaxyModel.addLoadedStarRange(g, start, end, responseTs);
      }
      if (galaxyDB) {
        galaxyDB.upsertStars(data.stars, responseTs).catch(() => {});
      }

      if (uiState.activeGalaxy === g) {
        if (Array.isArray(data.clusters)) uiState.rawClusters = data.clusters;
        uiState.clusterSummary = assignClusterFactions(uiState.rawClusters || [], uiState.territory);
        if (galaxy3d) {
          galaxy3d.setStars(galaxyStars);
          if (typeof galaxy3d.setClusterAuras === 'function') {
            galaxy3d.setClusterAuras(uiState.clusterSummary || []);
          }
        }
        const details = root.querySelector('#galaxy-system-details');
        if (details) {
          details.innerHTML = `<span class="text-cyan">Lazy full-load: ${loadedSystems} Systeme nachgeladen (${start}-${end}/${to}, chunk ${loadedChunks}).</span>`;
        }
      }
    }
  }

  async function loadGalaxyStars3D(root) {
    await galaxyController.loadStars3D(root);
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
      panel.innerHTML = `<p class="text-yellow">Systemansicht geöffnet. Planetendaten konnten nicht geladen werden.</p>
        <button class="btn btn-secondary btn-sm" style="margin-top:0.4rem" id="planet-retry-btn">↺ Erneut laden</button>`;
      const retryBtn = panel.querySelector('#planet-retry-btn');
      if (retryBtn) retryBtn.addEventListener('click', () => loadStarSystemPlanets(root, star));
      showToast('Planetendaten nicht verfügbar – bitte Retry klicken oder Doppelklick wiederholen.', 'warning');
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
    const allowStaleFirst = !!opts.allowStaleFirst;
    const maxAgeMs = Number(opts.maxAgeMs || SYSTEM_CACHE_MAX_AGE_MS);
    const onStaleData = typeof opts.onStaleData === 'function' ? opts.onStaleData : null;

    const currentState = galaxyModel ? galaxyModel.getSystemLoadState(g, s) : null;
    // Note: do NOT check currentState.pending here — the caller may have set it already.
    const alreadyLoaded = currentState && currentState.payload === 'loaded';
    const systemNode = galaxyModel ? galaxyModel.read('system', { galaxy_index: g, system_index: s }) : null;

    if (alreadyLoaded && systemNode?.payload && hasPlanetTextureManifest(systemNode.payload)) {
      return { source: 'model', payload: systemNode.payload, fresh: true };
    }

    if (allowStaleFirst && systemNode?.payload && onStaleData) {
      onStaleData(systemNode.payload);
    }

    let staleFallbackPayload = systemNode?.payload || null;

    if (galaxyDB) {
      try {
        const dbPayload = await galaxyDB.getSystemPayload(g, s, { maxAgeMs });
        if (dbPayload && hasPlanetTextureManifest(dbPayload)) {
          if (galaxyModel) {
            galaxyModel.attachSystemPayload(g, s, dbPayload);
            galaxyModel.setSystemLoadState(g, s, {
              payload: 'loaded',
              planets: 'loaded',
              pending: false,
              fetched_at: Date.now(),
            });
          }
          return { source: 'db', payload: dbPayload, fresh: true };
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

      if (galaxyModel) {
        galaxyModel.attachSystemPayload(g, s, data);
        galaxyModel.setSystemLoadState(g, s, {
          payload: 'loaded',
          planets: 'loaded',
          pending: false,
          fetched_at: responseTs,
        });
      }
      if (galaxyDB) {
        galaxyDB.upsertSystemPayload(g, s, data, responseTs).catch(() => {});
      }
      return { source: 'network', payload: data, fresh: true };
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
      const targetGalaxy = Number(pp.galaxy || ownColony?.galaxy || uiState.activeGalaxy || 0);
      const targetSystem = Number(pp.system || ownColony?.system || uiState.activeSystem || 0);
      const targetPosition = Number(pp.position || ownColony?.position || pos || 0);
      detail.dataset.ownerName = String(pp.owner || '');
      detail.innerHTML = `
        <h5>Planet #${pos} - ${esc(pp.name)}</h5>
        <div class="planet-detail-row">Owner: ${esc(pp.owner || 'Unknown')}</div>
        <div class="planet-detail-row">Class: ${esc(pp.planet_class || pp.type || '—')}</div>
        <div class="planet-detail-row">Colony ID: ${esc(String(pp.colony_id || '—'))}</div>
        <div class="planet-detail-row">Orbit: ${Number(pp.semi_major_axis_au || 0).toFixed(3)} AU</div>
        <div class="planet-detail-row">Habitable Zone: ${pp.in_habitable_zone ? 'Yes' : 'No'}</div>
        ${isOwnedColony ? `
          <div class="planet-detail-row">Colony Type: ${esc(fmtName(ownColony.colony_type || 'balanced'))}</div>
          <div class="planet-detail-row">Population: ${fmt(ownColony.population || 0)} / ${fmt(ownColony.max_population || 0)}</div>
          <div class="planet-detail-row">Happiness: ${esc(String(ownColony.happiness ?? '—'))}% · Energy: ${esc(String(ownColony.energy ?? '—'))}</div>
          <div class="planet-detail-actions">
            <button class="btn btn-secondary btn-sm" data-colony-action="overview">Overview</button>
            <button class="btn btn-secondary btn-sm" data-colony-action="colony">Colony</button>
            <button class="btn btn-secondary btn-sm" data-colony-action="buildings">Buildings</button>
            <button class="btn btn-primary btn-sm" data-colony-action="open">Build Focus</button>
          </div>
          <div class="planet-detail-extra text-muted">Loading colony data…</div>` : `
          <div class="planet-detail-actions">
            <button class="btn btn-secondary btn-sm" data-fleet-action="spy" data-target-galaxy="${targetGalaxy}" data-target-system="${targetSystem}" data-target-position="${targetPosition}">Spy</button>
            <button class="btn btn-secondary btn-sm" data-fleet-action="attack" data-target-galaxy="${targetGalaxy}" data-target-system="${targetSystem}" data-target-position="${targetPosition}">Attack</button>
            <button class="btn btn-primary btn-sm" data-fleet-action="transport" data-target-galaxy="${targetGalaxy}" data-target-system="${targetSystem}" data-target-position="${targetPosition}">Fleet</button>
          </div>
          <div class="planet-detail-extra text-muted">Lade Scan- und Sektorinformationen…</div>`}`;
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
            <div class="planet-detail-row">Metal: ${fmt(resources.metal || ownColony.metal || 0)} · Crystal: ${fmt(resources.crystal || ownColony.crystal || 0)}</div>
            <div class="planet-detail-row">Deuterium: ${fmt(resources.deuterium || ownColony.deuterium || 0)} · Food: ${fmt(resources.food || ownColony.food || 0)}</div>
            <div class="planet-detail-row">Rare Earth: ${fmt(resources.rare_earth || ownColony.rare_earth || 0)} · Services: ${esc(String(resources.public_services || ownColony.public_services || '—'))}</div>
            <div class="planet-detail-row">Top Buildings: ${buildings.length ? buildings.map((b) => `${esc(fmtName(b.type))} Lv ${esc(String(b.level || 0))}`).join(' · ') : 'No building data'}</div>
            <div class="planet-detail-row">Grid: ${esc(String(layout?.grid?.cols || 0))} × ${esc(String(layout?.grid?.rows || 0))} · Orbital slots: ${esc(String(layout?.grid?.orbital_slots || 0))}</div>
            <div class="planet-detail-row">Orbitals: ${orbitalFacilities.length ? orbitalFacilities.map((facility) => `${esc(facility.icon)} ${esc(facility.label)}`).join(' · ') : 'No orbital facilities online'}</div>`;
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
          if (extra) extra.innerHTML = '<div class="planet-detail-row">Intel-Daten derzeit nicht verfügbar.</div>';
        }
      }
      return;
    }

    if (gp) {
      detail.innerHTML = `
        <h5>Planet #${pos} - ${esc(gp.name || fmtName(gp.planet_class))}</h5>
        <div class="planet-detail-row">Class: ${esc(gp.planet_class || '—')}</div>
        <div class="planet-detail-row">Semi-major axis: ${Number(gp.semi_major_axis_au || 0).toFixed(3)} AU</div>
        <div class="planet-detail-row">Habitable Zone: ${gp.in_habitable_zone ? 'Yes' : 'No'}</div>
        <div class="planet-detail-row">Composition: ${esc(gp.composition_family || '—')}</div>
        <div class="planet-detail-row">Pressure: ${Number(gp.surface_pressure_bar || 0).toFixed(2)} bar</div>
        <div class="planet-detail-row">Water: ${esc(gp.water_state || '—')} · Methane: ${esc(gp.methane_state || '—')}</div>
        <div class="planet-detail-row">Radiation: ${esc(gp.radiation_level || '—')} · Habitability: ${Number(gp.habitability_score || 0).toFixed(1)}</div>`;
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
    const vis        = data?.visibility || {};
    const visLevel   = vis.level || 'unknown';
    const scoutedAt  = vis.scouted_at ? new Date(vis.scouted_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : null;
    const staleBanner = visLevel === 'stale'
      ? `<div class="fow-stale-banner">Veraltete Aufklärung${scoutedAt ? ` · Stand: ${esc(scoutedAt)}` : ''} · Daten können veraltet sein.</div>`
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
            return `<div class="planet-item own${staleClass}" data-pos="${slot.position}">
              <span>#${slot.position}</span>
              <strong>${esc(pp.colony_name || pp.name || '?')}</strong>
              <span>${esc(pp.owner || '?')}</span>
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
        composeToggle: '<div style="margin-bottom:0.75rem"><button class="btn btn-secondary btn-sm" id="compose-toggle-btn">✉ Compose</button></div>',
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
            <textarea id="msg-body-wm" rows="3" placeholder="Your message…"></textarea>
          </div>
          <button class="btn btn-primary btn-sm" id="msg-send-btn-wm">Send</button>
          <div id="msg-send-result-wm" class="form-info" aria-live="polite"></div>
        </div>`,
        terminalPanel: `
        <div class="msg-terminal" style="margin-bottom:0.9rem;border:1px solid rgba(150,180,230,0.25);border-radius:10px;padding:0.55rem;background:rgba(7,14,28,0.55)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem">
            <strong style="font-size:0.82rem;color:#b8cff3">Terminal Console</strong>
            <span style="font-size:0.72rem;color:var(--text-muted)">Direktbefehle für Messages</span>
          </div>
          <div id="msg-terminal-log" style="height:140px;overflow:auto;background:rgba(5,10,18,0.82);border-radius:8px;padding:0.45rem;font-family:Consolas, 'Courier New', monospace;font-size:0.74rem;line-height:1.35;color:#d7e4ff"></div>
          <div style="display:flex;gap:0.45rem;margin-top:0.45rem">
            <input id="msg-terminal-input" type="text" list="msg-terminal-users" placeholder="help | msg <user> <text> | inbox | read <id> | delete <id> | clear" style="flex:1" />
            <datalist id="msg-terminal-users"></datalist>
            <button class="btn btn-secondary btn-sm" id="msg-terminal-run">Run</button>
          </div>
        </div>`,
        messagesList: '<div id="messages-list-wm"><p class="text-muted">Loading…</p></div>',
        consoleLine: '<div>{{{line}}}</div>',
        userHintOption: '<option value="{{{value}}}"></option>',
        detail: `
        <div class="msg-detail-header">
          <div>
            <strong>{{{subject}}}</strong>
            <div class="msg-detail-meta">From: {{{sender}}} &nbsp;•&nbsp; {{{sentAt}}}</div>
          </div>
          <button class="btn btn-secondary btn-sm close-msg-btn">✕ Close</button>
        </div>
        <hr class="separator" />
        <div class="msg-detail-body">{{{body}}}</div>`,
        row: `
          <div class="msg-row {{{unreadClass}}}" data-mid="{{{id}}}">
            {{{unreadDot}}}
            <span class="msg-subject">{{{subject}}}</span>
            <span class="msg-sender">From: {{{sender}}}</span>
            <span class="msg-date">{{{date}}}</span>
            <button class="btn btn-danger btn-sm del-msg-btn" data-mid="{{{id}}}">🗑</button>
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
      try {
        const data = await API.inbox();
        if (!data.success) {
          el.innerHTML = '<p class="text-red">Error.</p>';
          return;
        }
        if (!data.messages.length) {
          el.innerHTML = '<p class="text-muted">Inbox empty.</p>';
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

  // ── Messages window ───────────────────────────────────────
  async function renderMessages() {
    await messagesController.render();
  }

  class IntelController {
    renderSpyReportCard(report) {
      if (!report || !report.report) return '';
      const r = report.report;
      const createdAt = new Date(report.created_at).toLocaleString();
      const status = r.status || 'unknown';

      if (status === 'uninhabited') {
        return `
          <div class="system-card" style="margin-bottom:1rem">
            <div class="system-row"><strong>🔍 Uninhabited Planet</strong></div>
            <div class="system-row text-muted small">${createdAt}</div>
            ${r.planet ? `<div class="system-row">Class: ${esc(r.planet.planet_class || '?')}</div>` : ''}
            ${r.planet && r.planet.deposit_metal ? `<div class="system-row">⬡ Metal: ${esc(r.planet.richness_metal || '?')}</div>` : ''}
            ${r.planet && r.planet.deposit_crystal ? `<div class="system-row">💎 Crystal: ${esc(r.planet.richness_crystal || '?')}</div>` : ''}
          </div>`;
      }

      if (status !== 'inhabited') return '';

      return `
        <div class="system-card" style="margin-bottom:1rem">
          <div class="system-row"><strong>🔍 Spy Report: ${esc(r.owner || '?')}</strong></div>
          <div class="system-row text-muted small">${createdAt}</div>
          
          <div class="system-row" style="margin-top:0.5rem"><strong>Resources</strong></div>
          ${r.resources ? `
            <div class="system-row small">
              ⬡ ${fmt(r.resources.metal || 0)} · 💎 ${fmt(r.resources.crystal || 0)} · 
              🔵 ${fmt(r.resources.deuterium || 0)} · 🌟 ${fmt(r.resources.rare_earth || 0)}
            </div>
          ` : ''}
          
          <div class="system-row" style="margin-top:0.5rem"><strong>Welfare</strong></div>
          ${r.welfare ? `
            <div class="welfare-bar" style="margin-top:0.3rem">
              <span title="Happiness ${r.welfare.happiness || 0}%">😊</span>
              <div class="bar-wrap"><div class="bar-fill bar-happiness" style="width:${r.welfare.happiness || 0}%"></div></div>
              <span style="font-size:0.7rem;min-width:28px">${r.welfare.happiness || 0}%</span>
            </div>
            <div class="welfare-bar">
              <span title="Population">👥</span>
              <div class="bar-wrap"><div class="bar-fill bar-population" style="width:${Math.min(100, Math.round((r.welfare.population || 0) / (r.welfare.max_population || 500) * 100))}%"></div></div>
              <span style="font-size:0.7rem;min-width:38px">${fmt(r.welfare.population || 0)}</span>
            </div>
            <div class="welfare-bar">
              <span title="Public Services">🏥</span>
              <div class="bar-wrap"><div class="bar-fill bar-services" style="width:${r.welfare.public_services || 0}%"></div></div>
              <span style="font-size:0.7rem;min-width:28px">${r.welfare.public_services || 0}%</span>
            </div>
          ` : ''}

          ${r.ships && Object.keys(r.ships).length ? `
            <div class="system-row" style="margin-top:0.5rem"><strong>Ships</strong></div>
            <div class="system-row small">
              ${Object.entries(r.ships).map(([ship, count]) => esc(fmtName(ship)) + ': ' + fmt(count)).join(' · ')}
            </div>
          ` : ''}

          ${r.leaders && r.leaders.length ? `
            <div class="system-row" style="margin-top:0.5rem"><strong>Leaders</strong></div>
            <div class="system-row small">
              ${r.leaders.map((l) => esc(l.name || '?') + ' (' + esc(l.role || '?') + ') Lv' + (l.level || 0)).join(' · ')}
            </div>
          ` : ''}
        </div>`;
    }

    async render() {
      const root = WM.body('intel');
      if (!root) return;

      root.innerHTML = '<p class="text-muted">Loading…</p>';

      try {
        const response = await API.spyReports();
        if (!response.success || !Array.isArray(response.spy_reports)) {
          root.innerHTML = '<p class="text-red">Failed to load spy reports.</p>';
          return;
        }

        const reports = response.spy_reports;
        if (!reports.length) {
          root.innerHTML = '<p class="text-muted">No spy reports yet.</p>';
          return;
        }

        let html = '<div>';
        html += `<div class="system-card" style="margin-bottom:1rem"><div class="system-row"><strong>🔍 Intel Reports (${reports.length})</strong></div></div>`;
        for (const report of reports) {
          html += this.renderSpyReportCard(report);
        }
        html += '</div>';
        root.innerHTML = html;
      } catch (e) {
        root.innerHTML = '<p class="text-red">Error: ' + esc(String(e.message || 'Unknown error')) + '</p>';
      }
    }
  }

  const intelController = new IntelController();
  window.GQIntelController = intelController;

  // ── Intel window ──────────────────────────────────────────
  async function renderIntel() {
    await intelController.render();
  }

  // ── Trade Routes Controller ────────────────────────────────
  class TradeRoutesController {
    constructor() {
      this.routes = [];
    }

    async render() {
      const data = await API.tradeRoutes();
      this.routes = data.trade_routes || [];

      const root = WM.body('trade-routes');
      if (!root) return;

      let html = '<div class="trade-routes-list">';

      if (this.routes.length === 0) {
        html += '<p style="padding: 10px; color: #999;">No trade routes yet.</p>';
      } else {
        html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px;">';
        for (const route of this.routes) {
          html += this.renderRouteCard(route);
        }
        html += '</div>';
      }

      html += '<div style="margin-top: 12px; padding: 8px; border-top: 1px solid #555;">';
      html += '<button id="btn-create-route" class="btn" style="width: 100%;">➕ New Trade Route</button>';
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
            ${esc(route.origin_name)} → ${esc(route.target_name)}
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
              ${route.is_active ? '⏸' : '▶'}
            </button>
            <button data-delete-route="${routeId}" class="btn" style="flex: 1; padding: 4px; color: #f55;">🗑</button>
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

    showCreateDialog() {
      // Simple dialog for creating a new trade route (simplified UI)
      const dialog = document.createElement('div');
      dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #222; border: 2px solid #777; border-radius: 4px; padding: 16px; z-index: 10000; width: 90%; max-width: 400px;';
      dialog.innerHTML = `
        <h3 style="margin-top: 0;">Create Trade Route</h3>
        <p style="color: #aaa; font-size: 0.9em;">Select origin colony, target, and cargo amount from the Trade Routes panel or use the overlay UI.</p>
        <p style="color: #aaa; font-size: 0.85em;">This feature requires clicking on colonies to select. You can also use the command line API:</p>
        <code style="display: block; background: #1a1a1a; padding: 8px; border-radius: 2px; margin: 8px 0; font-size: 0.8em; word-break: break-all;">
          await API.createTradeRoute({ origin_colony_id: 1, target_colony_id: 2, cargo_metal: 1000, cargo_crystal: 500, cargo_deuterium: 100, interval_hours: 24 })
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

  // ── Alliances Controller ────────────────────────────────────────────────────

  class AlliancesController {
    constructor() {
      this.alliances = [];
      this.userAlliance = null;
      this.allianceDetails = null;
    }

    async render() {
      const root = WM.body('alliances');
      if (!root) return;

      root.innerHTML = '<div class="text-muted">Loading alliances...</div>';

      try {
        const data = await API.alliances();
        this.alliances = data.alliances || [];
        this.userAlliance = data.user_alliance_id;

        let html = '<div style="padding: 8px;">';

        if (this.userAlliance) {
          // Show user's alliance details
          html += `<div style="margin-bottom: 12px; padding: 8px; background: #1a3a2a; border: 1px solid #4a8;border-radius:4px;">
            <button class="btn" onclick="GQAlliancesController.showAllianceDetails(${this.userAlliance})" style="width:100%;text-align:left;">
              👥 View My Alliance
            </button>
            <button class="btn btn-sm" style="margin-top:4px;width:100%;background:#8b4444;" onclick="GQAlliancesController.showLeaveDialog();">Leave Alliance</button>
          </div>`;
        } else {
          // Show create alliance button
          html += `<div style="margin-bottom: 12px;">
            <button class="btn" onclick="GQAlliancesController.showCreateDialog()" style="width:100%;">➕ Create Alliance</button>
          </div>`;
        }

        // List all alliances
        html += '<div style="margin-top: 12px; border-top: 1px solid #555; padding-top: 8px;"><strong>🌍 All Alliances</strong></div>';
        if (this.alliances.length === 0) {
          html += '<div class="text-muted" style="padding:8px;">No alliances found.</div>';
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
          <div style="font-size:0.85em;color:#bbb;margin:4px 0;">👤 ${esc(alliance.leader_name)} · 👥 ${alliance.member_count} members</div>
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
              👤 Leader: ID ${alliance.leader_id} · Founded: ${new Date(alliance.created_at).toLocaleDateString()}
            </div>
            
            ${isMember ? `
              <div style="background:#1a3a2a;padding:6px;border-radius:4px;margin-bottom:8px;font-size:0.85em;">
                <div style="font-weight:bold;color:#4f8;">✓ Member (${esc(data.user_role)})</div>
              </div>
            ` : ''}

            <div style="margin-bottom:8px;">
              <strong>💼 Treasury</strong>
              <div style="font-size:0.8em;color:#bbb;margin-top:4px;">
                ⬡ ${fmt(alliance.treasury.metal)} · 💎 ${fmt(alliance.treasury.crystal)} · 🔵 ${fmt(alliance.treasury.deuterium)} · ⭐ ${fmt(alliance.treasury.dark_matter)}
              </div>
            </div>

            <div style="margin-bottom:8px;">
              <strong>👥 Members (${members.length})</strong>
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
                <strong>🤝 Diplomacy Relations</strong>
                <div style="background:#0a0a0a;border:1px solid #555;border-radius:4px;max-height:120px;overflow-y:auto;margin-top:4px;font-size:0.8em;">
                  ${relations.map(r => {
                    const icon = {
                      'war': '⚔',
                      'enemy': '💀',
                      'alliance': '✦',
                      'nap': '✋',
                      'neutral': '–'
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
                <button class="btn btn-sm" onclick="GQAlliancesController.showChatDialog(${allianceId})" style="background:#448;">💬</button>
                <button class="btn btn-sm" onclick="GQAlliancesController.showContributeDialog(${allianceId})" style="background:#484;">💰</button>
              ` : ''}
              ${isLeader ? `
                <button class="btn btn-sm" onclick="GQAlliancesController.showDiplomacyDialog(${allianceId})" style="background:#844;">⚔</button>
                <button class="btn btn-sm" onclick="GQAlliancesController.showManageMembersDialog(${allianceId})" style="background:#448;">👥</button>
              ` : ''}
              ${isMember ? `
                <button class="btn btn-sm" onclick="GQAlliancesController.showLeaveDialog()" style="background:#844;">✕ Leave</button>
              ` : `
                <button class="btn btn-sm" onclick="GQAlliancesController.joinAlliance(${allianceId})" style="background:#3a4;">Join</button>
              `}
              <button class="btn btn-sm" onclick="GQAlliancesController.render()" style="background:#555;">← Back</button>
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
          <button class="btn" onclick="GQAlliancesController.doCreateAlliance()" style="flex:1;">✓ Create</button>
          <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">✕ Cancel</button>
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
            <button class="btn btn-sm" onclick="GQAlliancesController.showAllianceDetails(${allianceId})" style="margin-top:8px;width:100%;">← Close</button>
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
          <button class="btn" onclick="GQAlliancesController.doContribute(${allianceId})" style="flex:1;">✓ Contribute</button>
          <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">✕ Cancel</button>
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
        <h3 style="margin: 0 0 12px 0;">🤝 Diplomacy</h3>
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
            <option value="war">⚔ Declare War</option>
            <option value="nap">✋ Non-Aggression Pact</option>
            <option value="alliance">✦ Propose Alliance</option>
            <option value="enemy">💀 Mark as Enemy</option>
            <option value="neutral">– Neutral</option>
          </select>
        </div>
        <div id="diplo-nap-days" style="display:none;margin-bottom:12px;">
          <div style="color:#aaa;margin-bottom:8px;"><strong>Duration (days)</strong></div>
          <input type="number" id="diplo-nap-value" value="7" min="1" max="365" style="width:100%;padding:4px;border:1px solid #666;background:#0a0a0a;color:#fff;" />
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn" onclick="GQAlliancesController.doDiplomacy(${allianceId})" style="flex:1;">✓ Execute</button>
          <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">✕ Cancel</button>
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
        <h3 style="margin: 0 0 12px 0;">👥 Manage Members</h3>
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
          <button class="btn" onclick="GQAlliancesController.doManageMember(${allianceId})" style="flex:1;">✓ Execute</button>
          <button class="btn btn-sm" onclick="this.closest('div').remove();" style="flex:1;">✕ Cancel</button>
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

  class LeadersController {
      // ── Trade Proposals Controller ──────────────────────────────────────────────

      class TradeProposalsController {
        constructor() {
          this._tab = 'inbox'; // 'inbox' | 'outbox'
        }

        async render() {
          const root = WM.body('trade');
          if (!root) return;
          root.innerHTML = '<div class="text-muted" style="padding:8px;">Loading…</div>';
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
                  📥 Inbox${pendingTab}
                </button>
                <button class="btn btn-sm${tab==='outbox'?'':' btn-secondary'}" style="flex:1;" onclick="GQTradeProposalsController._tab='outbox';GQTradeProposalsController.render()">
                  📤 Outbox
                </button>
                <button class="btn btn-sm btn-secondary" onclick="GQTradeProposalsController.showProposeDialog()" title="New Proposal">➕</button>
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
          if (r.metal     > 0) parts.push(`⚙ ${r.metal.toLocaleString()}`);
          if (r.crystal   > 0) parts.push(`💎 ${r.crystal.toLocaleString()}`);
          if (r.deuterium > 0) parts.push(`💧 ${r.deuterium.toLocaleString()}`);
          return parts.length ? parts.join('  ') : '—';
        }

        _renderCard(p) {
          const other = p.is_mine ? p.target_name : p.initiator_name;
          const expires = new Date(p.expires_at).toLocaleDateString();
          const actions = [];
          if (p.status === 'pending') {
            if (!p.is_mine) {
              actions.push(`<button class="btn btn-sm" style="background:#3a8;" onclick="GQTradeProposalsController.doAccept(${p.id})">✓ Accept</button>`);
              actions.push(`<button class="btn btn-sm" style="background:#844;" onclick="GQTradeProposalsController.doReject(${p.id})">✗ Reject</button>`);
            } else {
              actions.push(`<button class="btn btn-sm btn-secondary" onclick="GQTradeProposalsController.doCancel(${p.id})">✕ Cancel</button>`);
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

        showProposeDialog(targetId = 0, targetName = '') {
          const existing = document.getElementById('trade-propose-dialog');
          if (existing) existing.remove();

          const div = document.createElement('div');
          div.id = 'trade-propose-dialog';
          div.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:#1a1a2e;border:1px solid #444;border-radius:8px;padding:16px;min-width:320px;max-width:400px;';
          div.innerHTML = `
            <h3 style="margin:0 0 12px;">💱 New Trade Proposal</h3>
            <label class="system-row">Target Player (username)</label>
            <input id="tp-target-name" type="text" placeholder="username" value="${esc(targetName)}" style="width:100%;box-sizing:border-box;" />
            <div style="margin-top:10px;font-weight:bold;">You Offer</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:4px;">
              <div><label style="font-size:0.8em;">⚙ Metal</label><input id="tp-om" type="number" min="0" value="0" style="width:100%;box-sizing:border-box;"/></div>
              <div><label style="font-size:0.8em;">💎 Crystal</label><input id="tp-oc" type="number" min="0" value="0" style="width:100%;box-sizing:border-box;"/></div>
              <div><label style="font-size:0.8em;">💧 Deuterium</label><input id="tp-od" type="number" min="0" value="0" style="width:100%;box-sizing:border-box;"/></div>
            </div>
            <div style="margin-top:10px;font-weight:bold;">You Want</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:4px;">
              <div><label style="font-size:0.8em;">⚙ Metal</label><input id="tp-rm" type="number" min="0" value="0" style="width:100%;box-sizing:border-box;"/></div>
              <div><label style="font-size:0.8em;">💎 Crystal</label><input id="tp-rc" type="number" min="0" value="0" style="width:100%;box-sizing:border-box;"/></div>
              <div><label style="font-size:0.8em;">💧 Deuterium</label><input id="tp-rd" type="number" min="0" value="0" style="width:100%;box-sizing:border-box;"/></div>
            </div>
            <label class="system-row" style="margin-top:10px;">Message (optional)</label>
            <input id="tp-msg" type="text" maxlength="500" placeholder="…" style="width:100%;box-sizing:border-box;" />
            <label class="system-row" style="margin-top:10px;">Expires in (days)</label>
            <select id="tp-days" style="width:100%;box-sizing:border-box;">
              <option value="1">1 day</option>
              <option value="2" selected>2 days</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
            </select>
            <div id="tp-err" style="color:#d66;font-size:0.85em;margin-top:6px;min-height:1em;"></div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              <button class="btn" style="flex:1;" onclick="GQTradeProposalsController.doPropose()">✓ Send</button>
              <button class="btn btn-secondary" onclick="document.getElementById('trade-propose-dialog').remove()">Cancel</button>
            </div>`;
          document.body.appendChild(div);
        }

        async doPropose() {
          const err = v => { const el = document.getElementById('tp-err'); if (el) el.textContent = v; };
          const targetName = (document.getElementById('tp-target-name')?.value ?? '').trim();
          if (!targetName) return err('Please enter a target player.');

          // Resolve username → id via leaderboard / players list
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
            await API.acceptTrade(id);
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
    constructor() {
      this.roleLabel = {
        colony_manager: '🏗 Colony Manager',
        fleet_commander: '⚔ Fleet Commander',
        science_director: '🔬 Science Director',
      };
      this.hireCost = {
        colony_manager: '5k ⬡ 3k 💎 1k 🔵',
        fleet_commander: '8k ⬡ 5k 💎 2k 🔵',
        science_director: '4k ⬡ 8k 💎 4k 🔵',
      };
    }

    renderTable(leaders) {
      return `
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem">
          ${Object.entries(this.roleLabel).map(([role, label]) => `
            <div class="hire-panel">
              <strong>${label}</strong>
              <div style="font-size:0.78rem;color:var(--text-secondary)">Cost: ${this.hireCost[role]}</div>
              <input class="input-sm hire-name" data-role="${role}" placeholder="Leader name" maxlength="48" style="width:140px"/>
              <button class="btn btn-primary btn-sm hire-btn" data-role="${role}">Hire</button>
            </div>`).join('')}
        </div>
        <table class="data-table" style="width:100%">
          <thead><tr>
            <th>Name</th><th>Role</th><th>Lv</th><th>Assigned to</th>
            <th>Autonomy</th><th>Last Action</th><th>Actions</th>
          </tr></thead>
          <tbody>
          ${leaders.length ? leaders.map((leader) => `
            <tr>
              <td>${esc(leader.name)}</td>
              <td>${this.roleLabel[leader.role] ?? leader.role}</td>
              <td>${leader.level}</td>
              <td>${leader.colony_name
                ? `${esc(leader.colony_name)} [${esc(leader.colony_coords || '?')}]`
                : leader.fleet_id ? `Fleet #${leader.fleet_id}` : '<em>Unassigned</em>'}</td>
              <td>
                <select class="input-sm autonomy-sel" data-lid="${leader.id}">
                  <option value="0" ${+leader.autonomy === 0 ? 'selected' : ''}>Off</option>
                  <option value="1" ${+leader.autonomy === 1 ? 'selected' : ''}>Suggest</option>
                  <option value="2" ${+leader.autonomy === 2 ? 'selected' : ''}>Full Auto</option>
                </select>
              </td>
              <td style="font-size:0.75rem;max-width:200px;overflow:hidden;text-overflow:ellipsis"
                  title="${esc(leader.last_action || '')}">
                ${leader.last_action ? esc(leader.last_action.substring(0, 60)) + '…' : '—'}
              </td>
              <td>
                <select class="input-sm assign-col-sel" data-lid="${leader.id}">
                  <option value="">— Colony —</option>
                  ${colonies.map((colony) => `<option value="${colony.id}">${esc(colony.name)}</option>`).join('')}
                </select>
                <button class="btn btn-secondary btn-sm assign-col-btn" data-lid="${leader.id}">Assign</button>
                <button class="btn btn-danger btn-sm dismiss-btn" data-lid="${leader.id}">✕</button>
              </td>
            </tr>`).join('')
          : '<tr><td colspan="7" class="text-muted">No leaders hired yet.</td></tr>'}
          </tbody>
        </table>
        <div style="margin-top:0.75rem">
          <button class="btn btn-secondary btn-sm" id="ai-tick-btn">▶ Run AI Tick</button>
        </div>`;
    }

    bindHireButtons(root) {
      root.querySelectorAll('.hire-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const role = btn.dataset.role;
          const nameEl = root.querySelector(`.hire-name[data-role="${role}"]`);
          const name = nameEl?.value.trim();
          if (!name) {
            showToast('Enter a name first.', 'error');
            return;
          }
          const response = await API.hireLeader(name, role);
          if (response.success) {
            showToast(response.message, 'success');
            WM.refresh('leaders');
          } else {
            showToast(response.error || 'Failed', 'error');
          }
        });
      });
    }

    bindAutonomyControls(root) {
      root.querySelectorAll('.autonomy-sel').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const response = await API.setAutonomy(parseInt(sel.dataset.lid, 10), parseInt(sel.value, 10));
          if (response.success) showToast(response.message, 'info');
          else showToast(response.error, 'error');
        });
      });
    }

    bindAssignmentControls(root) {
      root.querySelectorAll('.assign-col-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const lid = parseInt(btn.dataset.lid, 10);
          const sel = root.querySelector(`.assign-col-sel[data-lid="${lid}"]`);
          const cid = sel?.value ? parseInt(sel.value, 10) : null;
          const response = await API.assignLeader(lid, cid, null);
          if (response.success) {
            showToast(response.message, 'success');
            WM.refresh('leaders');
          } else {
            showToast(response.error, 'error');
          }
        });
      });
    }

    bindDismissControls(root) {
      root.querySelectorAll('.dismiss-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Dismiss this leader?')) return;
          const response = await API.dismissLeader(parseInt(btn.dataset.lid, 10));
          if (response.success) {
            showToast(response.message, 'success');
            WM.refresh('leaders');
          } else {
            showToast(response.error, 'error');
          }
        });
      });
    }

    bindAiTick(root) {
      root.querySelector('#ai-tick-btn')?.addEventListener('click', async () => {
        const response = await API.aiTick();
        if (response.success) {
          const actions = response.actions || [];
          showToast(actions.length ? `AI: ${actions[0]}` : 'AI: No actions taken.', 'info');
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
      root.innerHTML = '<p class="text-muted">Loading leaders…</p>';
      try {
        const data = await API.leaders();
        if (!data.success) {
          root.innerHTML = '<p class="error">Failed to load leaders.</p>';
          return;
        }
        const leaders = data.leaders || [];
        root.innerHTML = this.renderTable(leaders);
        this.bindActions(root);
      } catch (e) {
        root.innerHTML = `<p class="error">${esc(String(e))}</p>`;
      }
    }
  }

  const leadersController = new LeadersController();
  window.GQLeadersController = leadersController;

  // ── Leaderboard window ────────────────────────────────────
  async function renderLeaders() {
    await leadersController.render();
  }

  class FactionsController {
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

    buildMainView({ factions, politicsProfile, dynamicEffects, presets, activeUnrest }) {
      const effectRows = Object.entries(dynamicEffects || {})
        .filter(([key, value]) => !['faction_pressure_score', 'unrest_active', 'unrest_severity'].includes(String(key))
          && Number(value || 0) !== 0)
        .sort((a, b) => Math.abs(Number(b[1] || 0)) - Math.abs(Number(a[1] || 0)));

      return `
        <div class="system-card" style="margin-bottom:0.85rem">
          <h4 style="margin:0 0 0.35rem">Empire Politics</h4>
          ${politicsProfile ? `
            <div class="system-row">Species: <strong>${esc(politicsProfile.primary_species_key || 'n/a')}</strong></div>
            <div class="system-row">Government: <strong>${esc(politicsProfile.government_key || 'n/a')}</strong></div>
            <div class="system-row">Civics: ${(politicsProfile.civics || []).map((c) => esc(c.civic_key)).join(', ') || '<span class="text-muted">none</span>'}</div>
          ` : '<div class="system-row text-muted">Politics profile unavailable.</div>'}
          <div class="system-row" style="display:flex;gap:0.45rem;align-items:center;flex-wrap:wrap">
            <select id="politics-preset-select" class="input-sm" style="min-width:220px">
              <option value="">Preset wählen…</option>
              ${presets.map((p) => `<option value="${esc(p.preset_key)}">${esc(p.name)}</option>`).join('')}
            </select>
            <button id="politics-apply-preset-btn" class="btn btn-secondary btn-sm" type="button">Preset anwenden</button>
            <button id="politics-refresh-btn" class="btn btn-secondary btn-sm" type="button">Aktualisieren</button>
          </div>
          <div class="system-row" style="font-size:0.78rem;color:var(--text-muted)">
            Faction Pressure: <strong>${esc(String(dynamicEffects?.faction_pressure_score ?? 'n/a'))}</strong>
            ${Number(dynamicEffects?.unrest_active || 0) ? ` · Unrest aktiv (Severity ${esc(String(Math.round(Number(dynamicEffects?.unrest_severity || 0) * 100) / 100))})` : ''}
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
              Stage ${esc(String(activeUnrest.stage || '?'))} · Progress ${esc(String(activeUnrest.progress || '?'))}
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
            <div class="faction-card" style="border-color:${esc(faction.color)}">
              <div class="faction-header">
                <span class="faction-icon">${esc(faction.icon)}</span>
                <span class="faction-name" style="color:${esc(faction.color)}">${esc(faction.name)}</span>
                <span class="status-chip ${this.standingClass(faction.standing)}">
                  ${this.standingLabel(faction.standing)} (${faction.standing > 0 ? '+' : ''}${faction.standing})
                </span>
              </div>
              <p style="font-size:0.8rem;color:var(--text-secondary);margin:0.3rem 0 0.6rem">
                ${esc(faction.description)}
              </p>
              <div style="font-size:0.75rem;color:var(--text-muted)">
                ⚔ Aggression: ${faction.aggression}/100 &nbsp;
                💰 Trade: ${faction.trade_willingness}/100 &nbsp;
                ✅ Quests done: ${faction.quests_done}
              </div>
              ${faction.last_event ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.3rem">${esc(faction.last_event)}</div>` : ''}
              <div class="faction-actions" style="margin-top:0.6rem;display:flex;gap:0.4rem">
                <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="trade">💱 Trade</button>
                <button class="btn btn-secondary btn-sm" data-fid="${faction.id}" data-act="quests">📋 Quests</button>
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
          showToast('Bitte ein Preset auswählen.', 'warning');
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

    async renderDetail(root, fid, mode) {
      const detail = root.querySelector('#faction-detail');
      if (!detail) return;
      detail.innerHTML = '<p class="text-muted">Loading…</p>';

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
                <td>⬡ ${offer.offer_amount.toLocaleString()} ${offer.offer_resource}</td>
                <td>⬡ ${offer.request_amount.toLocaleString()} ${offer.request_resource}</td>
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
                Reward: ${quest.reward_metal ? '⬡' + quest.reward_metal + ' ' : ''} ${quest.reward_crystal ? '💎' + quest.reward_crystal + ' ' : ''}
                        ${quest.reward_rank_points ? '★' + quest.reward_rank_points : ''} ${quest.reward_standing ? '+' + quest.reward_standing + ' 🤝' : ''}
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
      root.innerHTML = '<p class="text-muted">Loading factions…</p>';
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
        const politicsProfile = politicsData?.profile || null;
        const dynamicEffects = politicsData?.dynamic_effects || window._GQ_politics?.effects || {};
        const presets = Array.isArray(presetsData?.presets) ? presetsData.presets : [];
        const activeUnrest = (unrestData?.situations || []).find((s) => String(s?.situation_type || '') === 'faction_unrest') || null;
        root.innerHTML = this.buildMainView({ factions, politicsProfile, dynamicEffects, presets, activeUnrest });
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
      root.innerHTML = '<p class="text-muted">Loading…</p>';
      try {
        const data = await API.leaderboard();
        if (!data.success) {
          root.innerHTML = '<p class="text-red">Error.</p>';
          return;
        }
        if (!data.leaderboard.length) {
          root.innerHTML = '<p class="text-muted">No players yet.</p>';
          return;
        }

        root.innerHTML = data.leaderboard.map((row, index) => `
          <div class="lb-row">
            <span class="lb-rank">${index + 1}</span>
            <span class="lb-name">${esc(row.username)} ${row.username === currentUser.username ? '(You)' : ''}</span>
            <span class="lb-stat">★ ${fmt(row.rank_points)} RP</span>
            <span class="lb-stat">🌍 ${row.planet_count}</span>
            <span class="lb-stat">◆ ${fmt(row.dark_matter)}</span>
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

  function renderSettings() {
    const root = WM.body('settings');
    if (!root) return;
    const audioState = audioManager ? audioManager.snapshot() : settingsState;
    settingsState.sfxMap = Object.assign({}, settingsState.sfxMap || {}, audioState.sfxMap || {});
    const musicTrackOptions = AUDIO_TRACK_OPTIONS
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
          <input type="checkbox" id="set-home-enter-system" ${settingsState.homeEnterSystem ? 'checked' : ''} />
          Home-Navigation öffnet direkt Systemansicht
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

    root.querySelector('#set-music-preset')?.addEventListener('change', () => {
      const preset = String(root.querySelector('#set-music-preset')?.value || '').trim();
      if (!preset) return;
      const urlInput = root.querySelector('#set-music-url');
      if (urlInput) urlInput.value = preset;
      ['galaxy', 'system', 'battle', 'ui'].forEach((sceneKey) => {
        const input = root.querySelector(`#set-scene-${sceneKey}`);
        if (input && !String(input.value || '').trim()) {
          input.value = preset;
        }
      });
    });

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
      showToast('Audio auf Standardwerte zurückgesetzt.', 'success');
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
  }

  // ── Quests window ─────────────────────────────────────────
  async function renderQuests() {
    const root = WM.body('quests');
    if (!root) return;
    root.innerHTML = '<p class="text-muted">Loading…</p>';
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
        tutorial:  '📘 Tutorial – New Player Quests',
        economy:   '💰 Economy', expansion: '🌍 Expansion',
        combat:    '⚔ Combat',   milestone: '🏆 Veteran Milestones',
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
          if (q.reward_metal)       rewards.push(`⬡ ${fmt(q.reward_metal)}`);
          if (q.reward_crystal)     rewards.push(`💎 ${fmt(q.reward_crystal)}`);
          if (q.reward_deuterium)   rewards.push(`🔵 ${fmt(q.reward_deuterium)}`);
          if (q.reward_dark_matter) rewards.push(`◆ ${fmt(q.reward_dark_matter)} DM`);
          if (q.reward_rank_points) rewards.push(`★ ${fmt(q.reward_rank_points)} RP`);

          html += `
            <div class="quest-card quest-${state}" data-aid="${q.id}">
              <div class="quest-header">
                <span class="quest-icon">${state==='claimed'?'✅':state==='claimable'?'🎁':'○'}</span>
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
                  ? `<button class="btn btn-primary btn-sm claim-btn" data-aid="${q.id}">✨ Claim</button>`
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
            showToast(r.message || '🏆 Reward claimed!', 'success');
            await loadOverview();
            renderQuests();
          } else { showToast(r.error || 'Could not claim reward.', 'error'); btn.disabled = false; }
        });
      });
    } catch (e) { root.innerHTML = '<p class="text-red">Failed to load quests.</p>'; }
  }

  // ── Logout ────────────────────────────────────────────────
  document.getElementById('logout-btn').addEventListener('click', async () => {
    if (audioManager) audioManager.playUiClick();
    await API.logout();
    window.location.href = 'index.html';
  });

  // ── Badge refresh (messages) ──────────────────────────────
  async function loadBadge() {
    await messagesController.loadBadge();
  }

  // ── Server-Sent Events ────────────────────────────────────
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
            showToast(`✉ ${data.new} new message${data.new > 1 ? 's' : ''}`, 'info');
          }
        } catch (_) {}
      });

      es.addEventListener('fleet_arrived', async (e) => {
        try {
          const data = JSON.parse(e.data);
          const mission = data.mission || '';
          const target = data.target || '';
          const icons = { attack: '⚔', transport: '📦', colonize: '🏛', spy: '🔍', harvest: '⛏', recall: '↩' };
          const icon = icons[mission] || '⚡';
          showToast(`${icon} Fleet arrived at ${target} (${mission})`, mission === 'attack' ? 'success' : 'info');
          await loadOverview();
          _invalidateGetCache([/api\/fleet\.php/, /api\/game\.php/]);
          ['fleet', 'shipyard', 'buildings'].forEach(id => WM.refresh(id));
        } catch (_) {}
      });

      es.addEventListener('fleet_returning', async (e) => {
        try {
          const data = JSON.parse(e.data);
          showToast(`↩ Fleet returned home (${data.mission || ''})`, 'info');
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
            ? `🔍 Spy fleet from ${data.attacker} inbound → ${data.target} (${arrival})`
            : `⚠ INCOMING ATTACK from ${data.attacker} → ${data.target} at ${arrival}!`;
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

  // ── Countdown ticker ─────────────────────────────────────
  setInterval(() => {
    // Countdown text spans only (elements with data-end but without data-start)
    document.querySelectorAll('[data-end]:not([data-start])').forEach(el => {
      el.textContent = countdown(el.dataset.end);
    });
    const nowMs = Date.now();
    // Live building / research progress bars (data-start + data-end)
    document.querySelectorAll('.progress-bar[data-start][data-end]').forEach(bar => {
      const start = new Date(bar.dataset.start).getTime();
      const end   = new Date(bar.dataset.end).getTime();
      const total = end - start;
      if (!total || total <= 0 || isNaN(total)) return;
      const pct = Math.max(0, Math.min(100, ((nowMs - start) / total) * 100));
      bar.style.width = pct.toFixed(1) + '%';
    });
    // Live fleet progress bars
    document.querySelectorAll('.fleet-progress-bar[data-dep][data-arr]').forEach(bar => {
      const dep = new Date(bar.dataset.dep).getTime();
      const arr = new Date(bar.dataset.arr).getTime();
      const total = arr - dep;
      if (!total || total <= 0) return;
      const pct = Math.max(0, Math.min(100, ((nowMs - dep) / total) * 100));
      bar.style.width = pct.toFixed(1) + '%';
    });
  }, 1000);

  // ── Periodic refresh (fallback polling when SSE is unavailable) ──────────
  setInterval(async () => {
    await loadOverview();
    await loadBadge();
    ['buildings','research','shipyard'].forEach(id => WM.refresh(id));
  }, 60000); // Reduced from 30 s – SSE handles fleet/message events in real-time

  setInterval(async () => {
    // Fallback badge sync every 30 s (SSE handles instant updates)
    await loadBadge();
  }, 30000);

  setInterval(() => {
    const root = WM.body('galaxy');
    if (!root) return;
    refreshGalaxyDensityMetrics(root);
  }, 1500);

  // ── Boot: keep galaxy fixed in main desktop area and preload overview data ──
  WM.open('galaxy');
  if (audioManager && typeof audioManager.setScene === 'function') {
    audioManager.setScene('galaxy', { autoplay: false, transition: 'fast', force: true });
  }

  // ── Footer actions init ───────────────────────────────────────────────────
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

  refreshAudioUi();
  await loadOverview();
  await loadBadge();
})();
