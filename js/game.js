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

  document.getElementById('commander-name').textContent = '⚙ ' + currentUser.username;

  // ── State ────────────────────────────────────────────────
  let colonies       = [];
  let currentColony  = null;
  let galaxySystemMax = 499;
  let galaxy3d = null;
  let galaxyStars = [];
  let pinnedStar = null;
  let galaxyHealthLast = null;
  let galaxyHealthLastCheckMs = 0;
  let galaxyHealthWarned = false;
  let galaxyOverlayHotkeysBound = false;
  const uiState = {
    activeGalaxy: 1,
    activeSystem: 1,
    activeStar: null,
    activeRange: { from: 1, to: 499 },
    selectedFactionId: null,
    colonyViewFocus: null,
    fleetPrefill: null,
    intelCache: new Map(),
    territory: [],
    clusterSummary: [],
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
  const STAR_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const SYSTEM_CACHE_MAX_AGE_MS = 20 * 60 * 1000;
  const POLICY_PROFILES = {
    balanced: {
      label: 'Balanced',
      galaxy: { stars: { maxPoints: 25000, cacheMaxAgeMs: 6 * 60 * 60 * 1000, alwaysRefreshNetwork: false } },
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
      galaxy: { stars: { maxPoints: 25000, cacheMaxAgeMs: 60 * 1000, alwaysRefreshNetwork: true } },
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
        maxPoints: 25000,
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

  function computeClusterSummary(stars, territory) {
    const list = Array.isArray(stars) ? stars : [];
    if (!list.length) return [];
    const claims = Array.isArray(territory) ? territory : [];

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    list.forEach((star) => {
      const x = Number(star.x_ly || 0);
      const y = Number(star.y_ly || 0);
      const z = Number(star.z_ly || 0);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    });
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const spanZ = Math.max(1, maxZ - minZ);
    const diagonal = Math.sqrt(spanX * spanX + spanY * spanY + spanZ * spanZ);
    const cellSize = Math.max(40, Math.min(420, diagonal / 16));

    const toCell = (star) => {
      const x = Math.floor((Number(star.x_ly || 0) - minX) / cellSize);
      const y = Math.floor((Number(star.y_ly || 0) - minY) / cellSize);
      const z = Math.floor((Number(star.z_ly || 0) - minZ) / cellSize);
      return `${x}|${y}|${z}`;
    };

    const cellMap = new Map();
    list.forEach((star) => {
      const key = toCell(star);
      if (!cellMap.has(key)) cellMap.set(key, []);
      cellMap.get(key).push(star);
    });

    const parseKey = (key) => key.split('|').map((n) => Number(n || 0));
    const neighbors = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          neighbors.push([dx, dy, dz]);
        }
      }
    }

    const visited = new Set();
    const components = [];
    for (const key of cellMap.keys()) {
      if (visited.has(key)) continue;
      const queue = [key];
      visited.add(key);
      const cells = [];
      while (queue.length) {
        const current = queue.shift();
        cells.push(current);
        const [cx, cy, cz] = parseKey(current);
        neighbors.forEach(([dx, dy, dz]) => {
          const next = `${cx + dx}|${cy + dy}|${cz + dz}`;
          if (!visited.has(next) && cellMap.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        });
      }
      const starsInComponent = [];
      cells.forEach((cellKey) => {
        starsInComponent.push(...(cellMap.get(cellKey) || []));
      });
      if (starsInComponent.length) components.push(starsInComponent);
    }

    const sorted = components.sort((a, b) => b.length - a.length).slice(0, 18);
    return sorted.map((component, index) => {
      const systems = Array.from(new Set(component.map((star) => Number(star.system_index || 0)).filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
      const sum = component.reduce((acc, star) => {
        acc.x += Number(star.x_ly || 0);
        acc.y += Number(star.y_ly || 0);
        acc.z += Number(star.z_ly || 0);
        return acc;
      }, { x: 0, y: 0, z: 0 });
      const center = {
        x_ly: sum.x / component.length,
        y_ly: sum.y / component.length,
        z_ly: sum.z / component.length,
      };
      const faction = claims.length ? claims[index % claims.length] : null;
      return {
        key: systems.length ? `cluster-${systems[0]}-${systems[systems.length - 1]}-${index}` : `cluster-${index}`,
        label: `Cluster ${index + 1}`,
        from: systems.length ? systems[0] : 0,
        to: systems.length ? systems[systems.length - 1] : 0,
        systems,
        stars: component.length,
        center,
        faction,
      };
    });
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
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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

  // ── WM window registrations ──────────────────────────────
  WM.register('overview',    {
    title: '🌍 Overview', w: 460, h: 620, defaultDock: 'right', defaultY: 12,
    onRender: () => renderOverview(),
  });
  WM.register('buildings',   {
    title: '🏗 Buildings', w: 480, h: 560, defaultDock: 'right', defaultY: 38,
    onRender: () => renderBuildings(),
  });
  WM.register('colony',   {
    title: '🏛 Colony', w: 620, h: 620, defaultDock: 'right', defaultY: 24,
    onRender: () => renderColonyView(),
  });
  WM.register('research',    {
    title: '🔬 Research', w: 480, h: 560, defaultDock: 'right', defaultY: 58,
    onRender: () => renderResearch(),
  });
  WM.register('shipyard',    {
    title: '🚀 Shipyard', w: 500, h: 560, defaultDock: 'right', defaultY: 78,
    onRender: () => renderShipyard(),
  });
  WM.register('fleet',       {
    title: '⚡ Fleet', w: 500, h: 620, defaultDock: 'right', defaultY: 98,
    onRender: () => renderFleetForm(),
  });
  WM.register('galaxy',      {
    title: '🌌 Galaxy Map',
    fullscreenDesktop: true,
    hideTaskButton: true,
    onRender: () => renderGalaxyWindow(),
  });
  WM.register('messages',    {
    title: '✉ Messages', w: 500, h: 520, defaultDock: 'right', defaultY: 118,
    onRender: () => renderMessages(),
  });
  WM.register('quests',      {
    title: '📋 Quests', w: 540, h: 620, defaultDock: 'right', defaultY: 28,
    onRender: () => renderQuests(),
  });
  WM.register('leaderboard', {
    title: '🏆 Leaderboard', w: 420, h: 480, defaultDock: 'right', defaultY: 138,
    onRender: () => renderLeaderboard(),
  });
  WM.register('leaders',     {
    title: '👤 Leaders', w: 540, h: 560, defaultDock: 'right', defaultY: 44,
    onRender: () => renderLeaders(),
  });
  WM.register('factions', {
    title: '🌐 Factions', w: 560, h: 620, defaultDock: 'right', defaultY: 24,
    onRender: () => renderFactions(),
  });

  // ── Nav buttons → open windows ───────────────────────────
  document.querySelectorAll('.nav-btn[data-win]').forEach(btn => {
    btn.addEventListener('click', () => WM.open(btn.dataset.win));
  });

  // ── Colony selector ──────────────────────────────────────
  const planetSelect = document.getElementById('planet-select');
  planetSelect.addEventListener('change', () => {
    const cid = parseInt(planetSelect.value, 10);
    selectColonyById(cid);
  });

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

  function prefillFleetTarget(coords, mission, defaults = {}) {
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

  function pickFleetDefaultShips(mission, avail, intel) {
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

  function applyFleetMissionDefaults(root, avail, prefill) {
    if (!root) return;
    const fallbackPrefill = prefill || {};
    const mission = String(root.querySelector('input[name="mission"]:checked')?.value || fallbackPrefill.mission || 'transport');
    const selectedShips = pickFleetDefaultShips(mission, avail, fallbackPrefill.intel);
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

  function populatePlanetSelect() {
    planetSelect.innerHTML = colonies.map(c =>
      `<option value="${c.id}">${esc(c.name)} [${c.galaxy}:${c.system}:${c.position}]</option>`
    ).join('');
    if (!currentColony && colonies.length) {
      selectColonyById(colonies[0].id);
    }
  }

  // ── Resource bar ─────────────────────────────────────────
  function updateResourceBar() {
    if (!currentColony) return;
    document.getElementById('res-metal').textContent     = fmt(currentColony.metal);
    document.getElementById('res-crystal').textContent   = fmt(currentColony.crystal);
    document.getElementById('res-deuterium').textContent = fmt(currentColony.deuterium);
    document.getElementById('res-energy').textContent    = currentColony.energy ?? '—';
    const foodEl = document.getElementById('res-food');
    if (foodEl) foodEl.textContent = fmt(currentColony.food ?? 0);
    const reEl = document.getElementById('res-rare-earth');
    if (reEl) reEl.textContent = fmt(currentColony.rare_earth ?? 0);
    const popEl = document.getElementById('res-population');
    if (popEl) popEl.textContent =
      `${fmt(currentColony.population ?? 0)}/${fmt(currentColony.max_population ?? 500)}`;
    const happEl = document.getElementById('res-happiness');
    if (happEl) {
      const h = parseInt(currentColony.happiness ?? 70);
      happEl.textContent = h + '%';
      happEl.style.color = h >= 70 ? '#2ecc71' : h >= 40 ? '#f1c40f' : '#e74c3c';
    }
    document.getElementById('topbar-coords').textContent =
      `[${currentColony.galaxy}:${currentColony.system}:${currentColony.position}]`;
    if (window._GQ_meta) {
      document.getElementById('res-dark-matter').textContent =
        fmt(window._GQ_meta.dark_matter ?? 0);
    }
  }

  // ── Overview data load ────────────────────────────────────
  async function loadOverview() {
    try {
      const data = await API.overview();
      if (!data.success) {
        console.error('Overview API error:', data.error);
        showToast(data.error || 'Overview konnte nicht geladen werden.', 'error');
        const root = WM.body('overview');
        if (root) root.innerHTML = `<p class="text-muted" style="color:#e74c3c">⚠ ${data.error || 'Nicht eingeloggt. Bitte neu laden.'}</p>`;
        return;
      }
      colonies = data.colonies || [];
      window._GQ_battles = data.battles || [];
      populatePlanetSelect();
      updateResourceBar();

      window._GQ_meta = data.user_meta || {};
      updateResourceBar();

      // Message badge
      const msgBadge = document.getElementById('msg-badge');
      if (data.unread_msgs > 0) {
        msgBadge.textContent = data.unread_msgs;
        msgBadge.classList.remove('hidden');
      } else {
        msgBadge.classList.add('hidden');
      }

      // Quest badge
      const qBadge = document.getElementById('quest-badge');
      const unclaimed = data.user_meta?.unclaimed_quests ?? 0;
      if (unclaimed > 0) {
        qBadge.textContent = unclaimed;
        qBadge.classList.remove('hidden');
      } else {
        qBadge.classList.add('hidden');
      }

      window._GQ_fleets = data.fleets || [];
      WM.refresh('overview');
    } catch (e) {
      console.error('Overview load failed', e);
      showToast('Overview konnte nicht geladen werden. Bitte Seite neu laden.', 'error');
      const root = WM.body('overview');
      if (root && !root.innerHTML.trim()) {
        root.innerHTML = `<p class="text-muted" style="color:#e74c3c">⚠ Fehler beim Laden: ${e.message || e}</p>`;
      }
    }
  }

  // ── Overview window ───────────────────────────────────────
  function renderOverview() {
    const root = WM.body('overview');
    if (!root) return;
    if (!colonies.length) {
      root.innerHTML = '<p class="text-muted">No colonies yet.</p>';
      return;
    }

    const meta       = window._GQ_meta || {};
    const protUntil  = meta.protection_until ? new Date(meta.protection_until) : null;
    const protected_ = protUntil && protUntil > Date.now();
    const pvpOn      = !!parseInt(meta.pvp_mode, 10);
    const protText   = protected_
      ? `🛡 Newbie protection until ${protUntil.toLocaleDateString()}`
      : '🛡 No protection';

    const colonyTypeLabels = {
      balanced:'⚖ Balanced', mining:'⛏ Mining', industrial:'🏭 Industrial',
      research:'🔬 Research', agricultural:'🌾 Agricultural', military:'⚔ Military'
    };

    root.innerHTML = `
      <div class="status-bar">
        <span class="status-chip ${protected_ ? 'chip-shield' : 'chip-neutral'}">${protText}</span>
        <span class="status-chip ${pvpOn ? 'chip-pvp-on' : 'chip-pvp-off'}">⚔ PvP: ${pvpOn ? 'ON' : 'OFF'}</span>
        <button id="pvp-toggle-btn" class="btn btn-sm ${pvpOn ? 'btn-warning' : 'btn-secondary'}"
                ${protected_ ? 'disabled' : ''}>
          ${pvpOn ? 'Disable PvP' : 'Enable PvP'}
        </button>
        <span class="status-chip chip-rank">★ ${fmt(meta.rank_points ?? 0)} RP</span>
        <span class="status-chip chip-dm">◆ ${fmt(meta.dark_matter ?? 0)} DM</span>
        <button class="btn btn-secondary btn-sm" id="open-leaders-btn">👤 Leaders</button>
      </div>

      <h3 style="margin:0.75rem 0 0.5rem">Your Colonies</h3>
      <div class="overview-grid">
        ${colonies.map(c => {
          const leaderChips = (c.leaders || []).map(l =>
            `<span class="leader-chip" title="${esc(l.role)} Lv${l.level} – ${l.last_action||'idle'}">
               ${l.role==='colony_manager'?'🏗':l.role==='science_director'?'🔬':'⚔'} ${esc(l.name)}
             </span>`
          ).join('');
          return `
          <div class="planet-card ${currentColony && c.id === currentColony.id ? 'selected' : ''}"
               data-cid="${c.id}">
            <div class="planet-card-name">${esc(c.name)}
              ${c.is_homeworld ? '<span class="hw-badge">🏠</span>' : ''}
            </div>
            <div class="planet-card-coords">[${c.galaxy}:${c.system}:${c.position}]</div>
            <div class="planet-card-type">
              <span class="colony-type-badge">${colonyTypeLabels[c.colony_type] || c.colony_type}</span>
              • ${fmtName(c.planet_type||'terrestrial')}
              ${c.in_habitable_zone ? '<span class="hz-badge" title="Habitable Zone">🌿</span>' : ''}
            </div>
            <div style="margin-top:0.4rem;font-size:0.78rem;color:var(--text-secondary)">
              ⬡ ${fmt(c.metal)} &nbsp; 💎 ${fmt(c.crystal)} &nbsp; 🔵 ${fmt(c.deuterium)}
              ${parseFloat(c.rare_earth||0)>0 ? `&nbsp; 💜 ${fmt(c.rare_earth)}` : ''}
            </div>
            <div style="margin-top:0.2rem;font-size:0.75rem;color:var(--text-secondary)">
              🌾 ${fmt(c.food||0)} &nbsp; ⚡ ${c.energy??0}
            </div>
            <div class="welfare-bar" style="margin-top:0.4rem">
              <span title="Happiness ${c.happiness??70}%">😊</span>
              <div class="bar-wrap"><div class="bar-fill bar-happiness" style="width:${c.happiness??70}%"></div></div>
              <span style="font-size:0.7rem;min-width:28px">${c.happiness??70}%</span>
            </div>
            <div class="welfare-bar">
              <span title="Population ${c.population??0}/${c.max_population??500}">👥</span>
              <div class="bar-wrap"><div class="bar-fill bar-population"
                style="width:${Math.min(100,Math.round((c.population??0)/(c.max_population||500)*100))}%">
              </div></div>
              <span style="font-size:0.7rem;min-width:28px">${fmt(c.population??0)}</span>
            </div>
            <div class="welfare-bar">
              <span title="Public Services ${c.public_services??0}%">🏥</span>
              <div class="bar-wrap"><div class="bar-fill bar-services" style="width:${c.public_services??0}%"></div></div>
              <span style="font-size:0.7rem;min-width:28px">${c.public_services??0}%</span>
            </div>
            ${c.deposit_metal >= 0 ? `
            <div style="margin-top:0.3rem;font-size:0.7rem">
              <span class="deposit-chip ${c.deposit_metal<100000?'depleted':''}"
                    title="Metal deposit remaining">⬡ ${fmt(c.deposit_metal)}</span>
              <span class="deposit-chip ${c.deposit_crystal<50000?'depleted':''}"
                    title="Crystal deposit">💎 ${fmt(c.deposit_crystal)}</span>
              <span class="deposit-chip rare-earth-chip"
                    title="Rare Earth deposit">💜 ${fmt(c.deposit_rare_earth)}</span>
            </div>` : ''}
            ${leaderChips ? `<div class="leader-chips">${leaderChips}</div>` : ''}
          </div>`;
        }).join('')}
      </div>

      <h3 style="margin:1rem 0 0.5rem">Fleets in Motion</h3>
      <div id="fleet-list-wm"></div>

      <h3 style="margin:1rem 0 0.5rem">Recent Battles</h3>
      <div id="battle-log-wm"></div>`;

    // Colony card clicks
    root.querySelectorAll('.planet-card').forEach(card => {
      card.addEventListener('click', () => {
        const cid = parseInt(card.dataset.cid, 10);
        currentColony = colonies.find(c => c.id === cid);
        planetSelect.value = cid;
        updateResourceBar();
        renderOverview();
      });
    });

    root.querySelector('#open-leaders-btn')?.addEventListener('click', () => WM.open('leaders'));

    // PvP toggle
    root.querySelector('#pvp-toggle-btn')?.addEventListener('click', async () => {
      const r = await API.togglePvp();
      if (r.success) {
        showToast(r.pvp_mode ? '⚔ PvP enabled!' : '🛡 PvP disabled.', 'info');
        await loadOverview();
      } else {
        showToast(r.error || 'Could not toggle PvP.', 'error');
      }
    });

    // Fleets
    const fleetList = root.querySelector('#fleet-list-wm');
    const fleets = window._GQ_fleets || [];
    if (!fleets.length) {
      fleetList.innerHTML = '<p class="text-muted">No active fleets.</p>';
    } else {
      fleetList.innerHTML = fleets.map(f => {
        const pos = f.current_pos || {};
        const posStr = (pos.x !== undefined)
          ? `<span class="fleet-pos" title="3D position">📍 ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)} ly</span>`
          : '';
        const vesselChips = (f.vessels || []).slice(0, 5).map((v) => `<span class="fleet-vessel-chip">${esc(fmtName(v.type))} x${esc(String(v.count))}</span>`).join('');
        const pct  = ((pos.progress || 0) * 100).toFixed(0);
        return `
        <div class="fleet-row">
          <span class="fleet-mission">${esc(f.mission.toUpperCase())}</span>
          <span class="fleet-target">→ [${f.target_galaxy}:${f.target_system}:${f.target_position}]</span>
          ${posStr}
          <span class="fleet-timer" data-end="${esc(f.arrival_time)}">${countdown(f.arrival_time)}</span>
          <div class="progress-bar-wrap" style="width:80px">
            <div class="progress-bar" style="width:${pct}%"></div>
          </div>
          ${vesselChips ? `<div class="fleet-vessel-list">${vesselChips}</div>` : ''}
          ${f.returning ? '<span class="fleet-returning">↩ Returning</span>' : ''}
          ${!f.returning ? `<button class="btn btn-warning btn-sm recall-btn" data-fid="${f.id}">Recall</button>` : ''}
        </div>`;
      }).join('');

      fleetList.querySelectorAll('.recall-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const r = await API.recallFleet(parseInt(btn.dataset.fid, 10));
          if (r.success) { showToast('Fleet recalled.', 'success'); loadOverview(); }
          else showToast(r.error || 'Recall failed', 'error');
        });
      });
    }

    // Battle log
    const battleLog = root.querySelector('#battle-log-wm');
    if (battleLog) {
      const battles = window._GQ_battles || [];
      if (!battles.length) {
        battleLog.innerHTML = '<p class="text-muted">No battles yet.</p>';
      } else {
        battleLog.innerHTML = battles.map(b => {
          const r = b.report || {};
          const won = r.attacker_wins;
          const loot = r.loot || {};
          const lootStr = [
            loot.metal   > 0 ? `⬡${fmt(loot.metal)}`   : '',
            loot.crystal > 0 ? `💎${fmt(loot.crystal)}` : '',
            loot.deuterium > 0 ? `🔵${fmt(loot.deuterium)}` : '',
            loot.rare_earth > 0 ? `💜${fmt(loot.rare_earth)}` : '',
          ].filter(Boolean).join(' ');
          return `<div class="battle-row ${won ? 'battle-win' : 'battle-loss'}">
            <span class="battle-result">${won ? '⚔ Victory' : '💀 Defeat'}</span>
            <span class="battle-vs">vs ${esc(b.defender_name)}</span>
            <span class="battle-time" style="font-size:0.75rem;color:var(--text-muted)">${new Date(b.created_at).toLocaleString()}</span>
            ${won && lootStr ? `<span class="battle-loot">${lootStr}</span>` : ''}
          </div>`;
        }).join('');
      }
    }
  }

  async function renderColonyView() {
    const root = WM.body('colony');
    if (!root) return;
    if (!currentColony) { root.innerHTML = '<p class="text-muted">Select a colony first.</p>'; return; }
    root.innerHTML = '<p class="text-muted">Loading colony view…</p>';

    try {
      const data = await API.buildings(currentColony.id);
      if (!data.success) {
        root.innerHTML = '<p class="text-red">Failed to load colony view.</p>';
        return;
      }
      const layout = data.layout || currentColony.layout || null;
      const buildings = data.buildings || [];
      const orbitalFacilities = data.orbital_facilities || [];
      const grid = buildColonyGridCells(layout, buildings);
      const classCaps = layout?.class_caps || {};
      const buildingFocus = uiState.colonyViewFocus && Number(uiState.colonyViewFocus.colonyId) === Number(currentColony.id)
        ? String(uiState.colonyViewFocus.focusBuilding || '')
        : '';

      root.innerHTML = `
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
    } catch (_) {
      root.innerHTML = '<p class="text-red">Failed to render colony view.</p>';
    }
  }

  // ── Buildings window ──────────────────────────────────────
  async function renderBuildings() {
    const root = WM.body('buildings');
    if (!root) return;
    if (!currentColony) { root.innerHTML = '<p class="text-muted">Select a colony first.</p>'; return; }
    root.innerHTML = '<p class="text-muted">Loading…</p>';
    const buildingFocus = uiState.colonyViewFocus && Number(uiState.colonyViewFocus.colonyId) === Number(currentColony.id)
      ? String(uiState.colonyViewFocus.focusBuilding || '')
      : '';

    try {
      await API.finishBuilding(currentColony.id);
      const data = await API.buildings(currentColony.id);
      if (!data.success) { root.innerHTML = '<p class="text-red">Error loading buildings.</p>'; return; }

      // Group by category
      const byCategory = {};
      for (const b of data.buildings) {
        const meta = getBuildingUiMeta(b.type);
        (byCategory[meta.cat] ??= []).push({ ...b, meta });
      }

      const catOrder = ['Extraction','Energy','Life Support','Population','Industry','Storage','Science','Military','Advanced','Other'];
      let html = '';
      if (buildingFocus) {
        html += `<div class="build-focus-banner">Fokus: ${fmtName(buildingFocus)}${uiState.colonyViewFocus?.source ? ` · Quelle: ${esc(uiState.colonyViewFocus.source)}` : ''}</div>`;
      }
      for (const cat of catOrder) {
        const items = byCategory[cat];
        if (!items?.length) continue;
        html += `<div class="building-category">
          <h4 class="building-cat-title">${cat}</h4>
          <div class="card-grid">`;
        for (const b of items) {
          const busy = !!b.upgrade_end;
          const c = b.next_cost;
          html += `
            <div class="item-card ${buildingFocus === b.type ? 'item-card-focus' : ''}" data-building-type="${esc(b.type)}">
              <div class="item-card-header">
                <span class="item-name">${b.meta.icon} ${fmtName(b.type)}</span>
                <span class="item-level">Lv ${b.level}</span>
              </div>
              <div class="item-desc">${b.meta.desc}</div>
              <div class="item-cost">
                ${c.metal     ? `<span class="cost-metal">⬡ ${fmt(c.metal)}</span>` : ''}
                ${c.crystal   ? `<span class="cost-crystal">💎 ${fmt(c.crystal)}</span>` : ''}
                ${c.deuterium ? `<span class="cost-deut">🔵 ${fmt(c.deuterium)}</span>` : ''}
              </div>
              ${busy
                ? `<div class="item-timer">⏳ <span data-end="${esc(b.upgrade_end)}">${countdown(b.upgrade_end)}</span></div>
                   <div class="progress-bar-wrap"><div class="progress-bar" style="width:50%"></div></div>`
                : `<button class="btn btn-primary btn-sm upgrade-btn" data-type="${esc(b.type)}">↑ Upgrade</button>`
              }
            </div>`;
        }
        html += '</div></div>';
      }
      root.innerHTML = html;

      root.querySelectorAll('.upgrade-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const r = await API.upgrade(currentColony.id, btn.dataset.type);
          if (r.success) {
            showToast(`Upgrading ${fmtName(btn.dataset.type)}…`, 'success');
            const res = await API.resources(currentColony.id);
            if (res.success) Object.assign(currentColony, res.resources);
            updateResourceBar();
            renderBuildings();
          } else { showToast(r.error || 'Upgrade failed', 'error'); btn.disabled = false; }
        });
      });
      if (buildingFocus) {
        const focusEl = root.querySelector(`.item-card[data-building-type="${buildingFocus}"]`);
        if (focusEl) focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (e) { root.innerHTML = '<p class="text-red">Failed to load buildings.</p>'; }
  }

  // ── Research window ───────────────────────────────────────
  async function renderResearch() {
    const root = WM.body('research');
    if (!root) return;
    if (!currentColony) { root.innerHTML = '<p class="text-muted">Select a colony first.</p>'; return; }
    root.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      await API.finishResearch();
      const data = await API.research(currentColony.id);
      if (!data.success) { root.innerHTML = '<p class="text-red">Error.</p>'; return; }

      root.innerHTML = `<div class="card-grid">${data.research.map(r => {
        const busy = !!r.research_end;
        const c    = r.next_cost;
        return `
          <div class="item-card">
            <div class="item-card-header">
              <span class="item-name">${fmtName(r.type)}</span>
              <span class="item-level">Lv ${r.level}</span>
            </div>
            <div class="item-cost">
              ${c.metal     ? `<span class="cost-metal">⬡ ${fmt(c.metal)}</span>` : ''}
              ${c.crystal   ? `<span class="cost-crystal">💎 ${fmt(c.crystal)}</span>` : ''}
              ${c.deuterium ? `<span class="cost-deut">🔵 ${fmt(c.deuterium)}</span>` : ''}
            </div>
            ${busy
              ? `<div class="item-timer">🔬 <span data-end="${esc(r.research_end)}">${countdown(r.research_end)}</span></div>`
              : `<button class="btn btn-primary btn-sm research-btn" data-type="${esc(r.type)}">Research</button>`
            }
          </div>`;
      }).join('')}</div>`;

      root.querySelectorAll('.research-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const res = await API.doResearch(currentColony.id, btn.dataset.type);
          if (res.success) { showToast(`Researching ${fmtName(btn.dataset.type)}…`, 'success'); renderResearch(); }
          else { showToast(res.error || 'Research failed', 'error'); btn.disabled = false; }
        });
      });
    } catch (e) { root.innerHTML = '<p class="text-red">Failed to load research.</p>'; }
  }

  // ── Shipyard window ───────────────────────────────────────
  async function renderShipyard() {
    const root = WM.body('shipyard');
    if (!root) return;
    if (!currentColony) { root.innerHTML = '<p class="text-muted">Select a colony first.</p>'; return; }
    root.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
      const data = await API.ships(currentColony.id);
      if (!data.success) { root.innerHTML = '<p class="text-red">Error.</p>'; return; }

      root.innerHTML = `<div class="card-grid">${data.ships.map(s => `
        <div class="item-card">
          <div class="item-card-header">
            <span class="item-name">${fmtName(s.type)}</span>
            <span class="item-level">${s.count} owned</span>
          </div>
          <div class="item-cost">
            ${s.cost.metal     ? `<span class="cost-metal">⬡ ${fmt(s.cost.metal)}</span>` : ''}
            ${s.cost.crystal   ? `<span class="cost-crystal">💎 ${fmt(s.cost.crystal)}</span>` : ''}
            ${s.cost.deuterium ? `<span class="cost-deut">🔵 ${fmt(s.cost.deuterium)}</span>` : ''}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted)">
            �� ${fmt(s.cargo)} &nbsp; ⚡ ${fmt(s.speed)}
          </div>
          <div class="ship-build-row">
            <input type="number" class="ship-qty" data-type="${esc(s.type)}" min="1" value="1" />
            <button class="btn btn-primary btn-sm build-btn" data-type="${esc(s.type)}">Build</button>
          </div>
        </div>`).join('')}</div>`;

      root.querySelectorAll('.build-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const type = btn.dataset.type;
          const qty  = parseInt(root.querySelector(`.ship-qty[data-type="${type}"]`).value, 10) || 1;
          btn.disabled = true;
          const res = await API.buildShip(currentColony.id, type, qty);
          if (res.success) {
            showToast(`Built ${qty}× ${fmtName(type)}`, 'success');
            const r2 = await API.resources(currentColony.id);
            if (r2.success) Object.assign(currentColony, r2.resources);
            updateResourceBar();
            renderShipyard();
          } else { showToast(res.error || 'Build failed', 'error'); btn.disabled = false; }
        });
      });
    } catch (e) { root.innerHTML = '<p class="text-red">Failed to load shipyard.</p>'; }
  }

  // ── Fleet window ──────────────────────────────────────────
  async function renderFleetForm() {
    const root = WM.body('fleet');
    if (!root) return;
    if (!currentColony) { root.innerHTML = '<p class="text-muted">Select a colony first.</p>'; return; }

    // Build the form HTML (self-contained in window)
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

    // Load available ships
    try {
      const data = await API.ships(currentColony.id);
      const shipEl = root.querySelector('#fleet-ship-select-wm');
      if (!data.success) { shipEl.innerHTML = '<p class="text-red">Error.</p>'; return; }
      const avail = data.ships.filter(s => s.count > 0);
      if (!avail.length) { shipEl.innerHTML = '<p class="text-muted">No ships on this planet.</p>'; return; }
      shipEl.innerHTML = `<div class="ship-selector-grid">${avail.map(s => `
        <div class="ship-selector-row">
          <span>${fmtName(s.type)} (${s.count})</span>
          <input type="number" class="fleet-ship-qty" data-type="${esc(s.type)}"
                 min="0" max="${s.count}" value="0" />
        </div>`).join('')}</div>`;
      root.querySelectorAll('input[name="mission"]').forEach((input) => {
        input.addEventListener('change', () => applyFleetMissionDefaults(root, avail, uiState.fleetPrefill));
      });
      applyFleetMissionDefaults(root, avail, uiState.fleetPrefill);
    } catch (_) {}

    // Form submit
    root.querySelector('#fleet-form-wm').addEventListener('submit', async e => {
      e.preventDefault();
      const resultEl = root.querySelector('#fleet-send-result-wm');
      resultEl.textContent = '';

      const ships = {};
      root.querySelectorAll('.fleet-ship-qty').forEach(inp => {
        const cnt = parseInt(inp.value, 10);
        if (cnt > 0) ships[inp.dataset.type] = cnt;
      });

      const mission = root.querySelector('input[name="mission"]:checked')?.value;
      const tg = parseInt(root.querySelector('#f-galaxy').value,   10);
      const ts = parseInt(root.querySelector('#f-system').value,   10);
      const tp = parseInt(root.querySelector('#f-position').value, 10);

      const payload = {
        origin_colony_id: currentColony.id,
        target_galaxy: tg, target_system: ts, target_position: tp,
        mission,
        ships,
        cargo: {
          metal:     parseFloat(root.querySelector('#f-cargo-metal').value)   || 0,
          crystal:   parseFloat(root.querySelector('#f-cargo-crystal').value) || 0,
          deuterium: parseFloat(root.querySelector('#f-cargo-deut').value)    || 0,
        },
      };

      const submitBtn = root.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        const r = await API.sendFleet(payload);
        if (r.success) {
          resultEl.className = 'form-info';
          resultEl.textContent = `Fleet launched! ETA: ${new Date(r.arrival_time).toLocaleString()}`;
          showToast('🚀 Fleet launched!', 'success');
          await loadOverview();
        } else {
          resultEl.className = 'form-error';
          resultEl.textContent = r.error || 'Failed to send fleet.';
        }
      } catch (_) {
        resultEl.className = 'form-error';
        resultEl.textContent = 'Network error.';
      }
      submitBtn.disabled = false;
    });
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

  function flashGalaxyActivity(root, color = 'rgba(122, 194, 255, 0.22)') {
    const stage = root?.querySelector('.galaxy-3d-wrap');
    if (!stage) return;
    const flash = document.createElement('div');
    flash.className = 'galaxy-action-flash';
    flash.style.setProperty('--flash-color', color);
    stage.appendChild(flash);
    window.setTimeout(() => flash.remove(), 520);
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
    if (!galaxy3d) return;
    const root = rootRef || WM.body('galaxy');
    const normalized = String(action || '');
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
    const root = WM.body('galaxy');
    if (!root) return;

    if (!root.querySelector('.galaxy-3d-stage')) {
      root.innerHTML = `
        <div class="galaxy-3d-stage">
          <div class="galaxy-3d-wrap">
            <div id="galaxy-3d-canvas" class="galaxy-3d-canvas"></div>
            <canvas id="galaxy-2d-overlay" class="galaxy-2d-overlay"></canvas>
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
              <span id="gal-policy-hint" class="text-muted"></span>
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
            <div id="galaxy-territory-panel" class="galaxy-territory-panel text-muted">Keine Sektoransprüche geladen.</div>
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
          </div>
        </div>`;

      bindGalaxyOverlayHotkeys();
      makeGalaxyOverlayDraggable(root, '#galaxy-controls-overlay');
      makeGalaxyOverlayDraggable(root, '#galaxy-info-overlay');
      makeGalaxyOverlayDraggable(root, '#galaxy-nav-orb-overlay');
      bindGalaxyNavOrb(root);

      root.querySelector('#gal-load-3d-btn').addEventListener('click', () => loadGalaxyStars3D(root));
      root.querySelector('#gal-follow-toggle-btn').addEventListener('click', () => {
        if (!galaxy3d || typeof galaxy3d.toggleFollowSelection !== 'function') return;
        galaxy3d.toggleFollowSelection();
        updateGalaxyFollowUi(root);
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
        loadGalaxyStars3D(root);
      });
      root.querySelector('#gal-clear-cache-btn').addEventListener('click', async () => {
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
      updateGalaxyFollowUi(root);
    }

    if (root.querySelector('#gal-health-badge') && (Date.now() - galaxyHealthLastCheckMs) > 60 * 1000) {
      refreshGalaxyHealth(root, false);
    }

    if (!galaxy3d && root.querySelector('#galaxy-3d-canvas')) {
      initGalaxy3D(root);
      loadGalaxyStars3D(root);
    }

    updateGalaxyFollowUi(root);
    renderGalaxyTerritorySummary(root);
  }

  function updateGalaxyFollowUi(root) {
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

  function renderGalaxyTerritorySummary(root) {
    const panel = root?.querySelector('#galaxy-territory-panel');
    if (!panel) return;
    const territory = Array.isArray(uiState.territory) ? uiState.territory : [];
    const clusters = Array.isArray(uiState.clusterSummary) ? uiState.clusterSummary : [];
    if (!territory.length && !clusters.length) {
      panel.innerHTML = '<div class="text-muted">Keine aktiven Staatsgebiete oder Cluster für die aktuelle Auswahl.</div>';
      return;
    }
    panel.innerHTML = `
      <div class="territory-section-title">Staatgebiete · Galaxie ${esc(String(uiState.activeGalaxy || 1))}</div>
      <div class="territory-mini-list">${territory.slice(0, 4).map((f) => `
        <button type="button" class="territory-chip territory-chip-select ${Number(uiState.selectedFactionId || 0) === Number(f.id || 0) ? 'territory-chip-active' : ''}" data-faction-select="${esc(String(f.id || 0))}" style="--territory-color:${esc(f.color)}">${esc(f.icon)} ${esc(f.name)} · ${esc(f.government?.icon || '🏳')} ${esc(f.government?.label || 'Herrschaft')} · Macht ${esc(String(f.power_level || 'n/a'))}</button>`).join('')}</div>
      ${clusters.length ? `<div class="territory-section-title">Cluster</div>
      <div class="cluster-mini-list">${clusters.slice(0, 4).map((cluster) => `
        <span class="cluster-chip">${esc(cluster.label)} ${esc(String(cluster.from))}-${esc(String(cluster.to))}${cluster.faction ? ` · ${esc(cluster.faction.icon)} ${esc(cluster.faction.name)}` : ''}</span>`).join('')}</div>` : ''}`;

    panel.querySelectorAll('[data-faction-select]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const factionId = Number(btn.getAttribute('data-faction-select') || 0);
        const nextFaction = Number(uiState.selectedFactionId || 0) === factionId ? null : factionId;
        uiState.selectedFactionId = nextFaction;
        if (galaxy3d && typeof galaxy3d.setEmpireHeartbeatFaction === 'function') {
          galaxy3d.setEmpireHeartbeatFaction(nextFaction);
        }
        renderGalaxyTerritorySummary(root);
        flashGalaxyActivity(root, nextFaction ? 'rgba(122, 194, 255, 0.24)' : 'rgba(166, 177, 201, 0.20)');
        showToast(nextFaction ? 'Imperiums-Heartbeat aktiviert.' : 'Imperiums-Heartbeat deaktiviert.', 'info');
      });
    });
  }

  async function refreshGalaxyHealth(root, force) {
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
      badge.textContent = 'Health: unavailable';
      badge.className = 'text-muted';
    }
  }

  function initGalaxy3D(root) {
    const holder = root.querySelector('#galaxy-3d-canvas');
    if (!holder || !window.Galaxy3DRenderer) {
      root.querySelector('#galaxy-system-details').innerHTML = '<span class="text-red">3D engine failed to load.</span>';
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
          pinnedStar = star;
          toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
          updateGalaxyHoverCard(root, star, pos, true);
          renderGalaxySystemDetails(root, star, true);
          await loadStarSystemPlanets(root, star);
        },
        onSystemZoomOut: (star) => {
          if (galaxy3d && typeof galaxy3d.exitSystemView === 'function') {
            galaxy3d.exitSystemView(true);
          }
          pinnedStar = star || null;
          renderGalaxySystemDetails(root, star, false);
          const panel = root.querySelector('#galaxy-planets-panel');
          if (panel && star) panel.innerHTML = '<p class="text-muted">Zur Galaxieansicht ausgezoomt. Für Systemdetails wieder hineinzoomen oder doppelklicken.</p>';
        },
        onPlanetZoomOut: (star) => {
          if (star) renderGalaxySystemDetails(root, star, true);
        },
      });
    } catch (_) {
      galaxy3d = null;
      root.querySelector('#galaxy-system-details').innerHTML = '<span class="text-red">3D renderer unavailable. Fallback list active.</span>';
      toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
    }
  }

  function renderGalaxyFallbackList(root, stars, from, to) {
    const panel = root.querySelector('#galaxy-planets-panel');
    if (!panel) return;
    const rows = (stars || []).slice(0, 40).map((s) => {
      return `<div class="planet-detail-row">#${Number(s.system_index)} - ${esc(s.name || s.catalog_name || 'Unnamed')} (${esc(String(s.spectral_class || '?'))}${esc(String(s.subtype ?? ''))})</div>`;
    }).join('');
    panel.innerHTML = `
      <h4>Fallback Star List</h4>
      <div class="planet-detail-3d">
        <div class="planet-detail-row">Range ${from}..${to}</div>
        <div class="planet-detail-row">Loaded stars: ${Number((stars || []).length)}</div>
        ${rows || '<div class="planet-detail-row">No stars returned.</div>'}
      </div>`;
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

  function renderGalaxySystemDetails(root, star, zoomed) {
    const details = root.querySelector('#galaxy-system-details');
    if (!details) return;
    const followEnabled = !galaxy3d || typeof galaxy3d.isFollowingSelection !== 'function'
      ? true
      : galaxy3d.isFollowingSelection();
    const quickNavActions = [
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

    const countRaw = Number(star.planet_count);
    const hasKnownPlanetCount = Number.isFinite(countRaw) && countRaw > 0;
    const planetCountHtml = hasKnownPlanetCount
      ? String(Math.round(countRaw))
      : '<span class="text-muted" title="legacy cache/no count">n/a</span>';

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
        <div class="system-row">Selection Follow: ${followEnabled ? 'locked' : 'free'} (L)</div>
        <div class="system-row">${zoomed ? 'System view active. Esc/F/R returns to galaxy overview.' : 'Double click to zoom into the system and show planets.'}</div>
      </div>`;
    details.querySelectorAll('[data-nav-action]').forEach((button) => {
      button.addEventListener('click', () => triggerGalaxyNavAction(button.getAttribute('data-nav-action'), root));
    });
  }

  async function loadGalaxyStars3D(root) {
    const details = root.querySelector('#galaxy-system-details');
    if (activePolicyMode === 'auto') {
      applyPolicyMode('auto');
      refreshPolicyUi(root);
    }
    const g = parseInt(root.querySelector('#gal-galaxy').value, 10) || 1;
    const from = Math.max(1, parseInt(root.querySelector('#gal-from').value, 10) || 1);
    const to = Math.max(from, parseInt(root.querySelector('#gal-to').value, 10) || from);
    uiState.activeRange = { from, to };
    setGalaxyContext(g, uiState.activeSystem || from, uiState.activeStar);
    const starsPolicy = LEVEL_POLICIES.galaxy.stars;

    if (details) details.innerHTML = '<span class="text-muted">Loading star cloud...</span>';

    // 1) Cache-first from model/IndexedDB
    let cachedStars = galaxyModel ? galaxyModel.listStars(g, from, to) : [];
    const fullRangeInModel = galaxyModel
      ? galaxyModel.hasLoadedStarRange(g, from, to, starsPolicy.cacheMaxAgeMs)
      : false;
    if ((!cachedStars || cachedStars.length === 0) && galaxyDB) {
      try {
        const dbStars = await galaxyDB.getStars(g, from, to, { maxAgeMs: starsPolicy.cacheMaxAgeMs });
        if (dbStars.length && galaxyModel) {
          cachedStars = galaxyModel.upsertStarBatch(g, dbStars);
          galaxyModel.addLoadedStarRange(g, from, to, Date.now());
        } else {
          cachedStars = dbStars;
        }
      } catch (_) {}
    }

    if (cachedStars && cachedStars.length) {
      galaxyStars = cachedStars;
      uiState.clusterSummary = computeClusterSummary(galaxyStars, uiState.territory);
      renderGalaxyTerritorySummary(root);
      if (galaxy3d) {
        galaxy3d.setStars(galaxyStars);
        if (typeof galaxy3d.setClusterAuras === 'function') {
          galaxy3d.setClusterAuras(uiState.clusterSummary || []);
        }
        if (typeof galaxy3d.setEmpireHeartbeatFaction === 'function') {
          galaxy3d.setEmpireHeartbeatFaction(uiState.selectedFactionId);
        }
      }
      renderGalaxy2DOverlay(root, galaxyStars);
      if (details) {
        details.innerHTML = `<span class="text-cyan">Cache: ${galaxyStars.length} stars loaded${fullRangeInModel ? ' (complete range)' : ''}. Syncing live data...</span>`;
      }
    }

    const shouldRefreshNetwork = starsPolicy.alwaysRefreshNetwork || !fullRangeInModel;
    if (!shouldRefreshNetwork && cachedStars && cachedStars.length) {
      if (details) {
        details.innerHTML = `<span class="text-cyan">Policy hit: fresh range from cache (${from}-${to}), network refresh skipped.</span>`;
      }
      return;
    }

    // 2) Network refresh and persistence
    try {
      const data = (typeof API.galaxyStars === 'function')
        ? await API.galaxyStars(g, from, to, starsPolicy.maxPoints)
        : await API.galaxy(g, from);
      if (!data.success) {
        if (details) details.innerHTML = '<span class="text-red">Could not load stars.</span>';
        return;
      }

      if (Array.isArray(data.stars)) {
        galaxyStars = data.stars;
      } else if (data.star_system) {
        const single = Object.assign({}, data.star_system, {
          galaxy_index: Number(data.galaxy || g),
          system_index: Number(data.system || from),
        });
        galaxyStars = [single];
      } else {
        galaxyStars = [];
      }
      const territoryData = await API.factions().catch(() => null);
      uiState.territory = territoryData?.success
        ? (territoryData.factions || []).filter((f) => g >= Number(f.home_galaxy_min || 1) && g <= Number(f.home_galaxy_max || 0))
        : [];
      uiState.clusterSummary = computeClusterSummary(galaxyStars, uiState.territory);
      renderGalaxyTerritorySummary(root);
      const responseTs = Number(data.server_ts_ms || Date.now());
      if (galaxyModel) {
        galaxyModel.upsertStarBatch(g, galaxyStars);
        galaxyModel.addLoadedStarRange(g, from, to, responseTs);
      }
      if (galaxyDB) {
        galaxyDB.upsertStars(galaxyStars, responseTs).catch(() => {});
      }

      if (galaxy3d) {
        galaxy3d.setStars(galaxyStars);
        if (typeof galaxy3d.setClusterAuras === 'function') {
          galaxy3d.setClusterAuras(uiState.clusterSummary || []);
        }
        if (typeof galaxy3d.setEmpireHeartbeatFaction === 'function') {
          galaxy3d.setEmpireHeartbeatFaction(uiState.selectedFactionId);
        }
      }
      renderGalaxy2DOverlay(root, galaxyStars);
      if (!galaxy3d) renderGalaxyFallbackList(root, galaxyStars, from, to);

      if (details) {
        details.innerHTML = `<span class="text-cyan">Loaded ${galaxyStars.length} stars from systems ${from}..${to} (stride ${data.stride}).</span>`;
      }
      const toInput = root.querySelector('#gal-to');
      const fromInput = root.querySelector('#gal-from');
      if (toInput) toInput.max = String(galaxySystemMax);
      if (fromInput) fromInput.max = String(galaxySystemMax);
    } catch (err) {
      if (details) details.innerHTML = `<span class="text-red">Failed to load stars: ${esc(String(err?.message || err || 'unknown error'))}</span>`;
      renderGalaxy2DOverlay(root, []);
      renderGalaxyFallbackList(root, [], from, to);
    }
  }

  function renderGalaxy2DOverlay(root, stars) {
    const canvas = root.querySelector('#galaxy-2d-overlay');
    const host = root.querySelector('#galaxy-3d-canvas');
    if (!canvas || !host) return;

    const w = Math.max(320, host.clientWidth || 320);
    const h = Math.max(220, host.clientHeight || 220);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const list = Array.isArray(stars) ? stars : [];
    const territory = Array.isArray(uiState.territory) ? uiState.territory : [];
    const clusters = Array.isArray(uiState.clusterSummary) ? uiState.clusterSummary : [];
    if (!list.length && !territory.length && !clusters.length) {
      canvas.style.display = 'none';
      return;
    }

    canvas.style.display = 'block';
    const rangeFrom = Number(uiState.activeRange?.from || 1);
    const rangeTo = Math.max(rangeFrom, Number(uiState.activeRange?.to || rangeFrom));
    const padX = 22;
    const padY = 18;
    const plotTop = padY + 20;
    const plotBottom = h - 54;
    const plotHeight = Math.max(40, plotBottom - plotTop);
    const plotWidth = Math.max(80, w - padX * 2);
    const systemSpan = Math.max(1, rangeTo - rangeFrom);
    const yValues = list.map((star) => Number(star.y_ly || 0));
    const minY = yValues.length ? Math.min(...yValues) : 0;
    const maxY = yValues.length ? Math.max(...yValues) : 1;
    const ySpan = Math.max(1, maxY - minY);
    const xForSystem = (systemIndex) => padX + ((Number(systemIndex || rangeFrom) - rangeFrom) / systemSpan) * plotWidth;
    const yForStar = (star) => plotBottom - (((Number(star.y_ly || 0) - minY) / ySpan) * plotHeight);

    ctx.fillStyle = 'rgba(7, 17, 32, 0.14)';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i <= 4; i++) {
      const ratio = i / 4;
      const x = padX + plotWidth * ratio;
      const systemValue = Math.round(rangeFrom + systemSpan * ratio);
      ctx.strokeStyle = 'rgba(116, 154, 199, 0.12)';
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
      ctx.fillStyle = 'rgba(168, 196, 231, 0.55)';
      ctx.font = '11px Segoe UI';
      ctx.fillText(String(systemValue), x - 10, h - 34);
    }

    list.forEach((star) => {
      const x = xForSystem(Number(star.system_index || rangeFrom));
      const y = yForStar(star);
      const size = Math.max(1.2, Math.min(4.5, 1.2 + Math.log2(Math.max(1, Number(star.cluster_size || 1)))));
      ctx.fillStyle = 'rgba(207, 229, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    });

    territory.slice(0, 5).forEach((faction, index) => {
      const x = padX + index * 140;
      const y = 16;
      ctx.fillStyle = 'rgba(5, 12, 24, 0.72)';
      ctx.fillRect(x, y, 132, 18);
      ctx.strokeStyle = String(faction.color || '#6a8cc9');
      ctx.strokeRect(x, y, 132, 18);
      ctx.fillStyle = 'rgba(228, 239, 255, 0.88)';
      ctx.font = '11px Segoe UI';
      ctx.fillText(`${faction.icon || '🏳'} ${faction.name}`, x + 6, y + 12);
    });
  }

  async function loadStarSystemPlanets(root, star) {
    const panel = root.querySelector('#galaxy-planets-panel');
    if (!panel || !star) return;

    panel.innerHTML = '<p class="text-muted">Loading planets...</p>';

    const g = Number(star.galaxy_index || 1);
    const s = Number(star.system_index || 1);
    setGalaxyContext(g, s, star);
    const systemPolicy = LEVEL_POLICIES.system.payload;

    if (galaxyModel) {
      galaxyModel.setSystemLoadState(g, s, { pending: true });
    }
    const loadResult = await ensureSystemPayloadLazy(g, s, {
      allowStaleFirst: systemPolicy.allowStaleFirst,
      maxAgeMs: systemPolicy.cacheMaxAgeMs,
      onStaleData: (payload) => {
        renderPlanetPanel(panel, star, payload);
        if (galaxy3d && typeof galaxy3d.enterSystemView === 'function') {
          galaxy3d.enterSystemView(star, payload);
        }
      },
    });

    if (!loadResult || !loadResult.payload) {
      panel.innerHTML = '<p class="text-red">Failed to load planets.</p>';
      if (galaxyModel) {
        galaxyModel.setSystemLoadState(g, s, { pending: false, payload: 'error' });
      }
      return;
    }

    renderPlanetPanel(panel, star, loadResult.payload);
    if (galaxy3d && typeof galaxy3d.enterSystemView === 'function') {
      galaxy3d.enterSystemView(star, loadResult.payload);
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
    const alreadyLoaded = currentState && currentState.payload === 'loaded' && currentState.pending === false;
    const systemNode = galaxyModel ? galaxyModel.read('system', { galaxy_index: g, system_index: s }) : null;

    if (alreadyLoaded && systemNode?.payload) {
      return { source: 'model', payload: systemNode.payload, fresh: true };
    }

    if (allowStaleFirst && systemNode?.payload && onStaleData) {
      onStaleData(systemNode.payload);
    }

    if (galaxyDB) {
      try {
        const dbPayload = await galaxyDB.getSystemPayload(g, s, { maxAgeMs });
        if (dbPayload) {
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
      } catch (_) {}
    }

    try {
      const data = await API.galaxy(g, s);
      if (!data.success) return null;
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
    } catch (_) {
      return null;
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
    panel.innerHTML = `
      <h4>${esc(star.name)} Planets</h4>
      <div class="planet-list-3d">
        ${(data.planets || []).map(slot => {
          const pp = slot.player_planet;
          const gp = slot.generated_planet;
          if (pp) {
            return `<div class="planet-item own" data-pos="${slot.position}">
              <span>#${slot.position}</span>
              <strong>${esc(pp.name)}</strong>
              <span>${esc(pp.owner)}</span>
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

  // ── Messages window ───────────────────────────────────────
  async function renderMessages() {
    const root = WM.body('messages');
    if (!root) return;

    root.innerHTML = `
      <div style="margin-bottom:0.75rem">
        <button class="btn btn-secondary btn-sm" id="compose-toggle-btn">✉ Compose</button>
      </div>
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
      </div>
      <div id="messages-list-wm"><p class="text-muted">Loading…</p></div>`;

    root.querySelector('#compose-toggle-btn').addEventListener('click', () => {
      root.querySelector('#compose-form-wm').classList.toggle('hidden');
    });

    root.querySelector('#msg-send-btn-wm').addEventListener('click', async () => {
      const res = root.querySelector('#msg-send-result-wm');
      const to      = root.querySelector('#msg-to-wm').value.trim();
      const subject = root.querySelector('#msg-subject-wm').value.trim();
      const body    = root.querySelector('#msg-body-wm').value.trim();
      if (!to || !subject || !body) { res.className='form-error'; res.textContent='Fill in all fields.'; return; }
      const r = await API.sendMsg(to, subject, body);
      if (r.success) {
        res.className='form-info'; res.textContent='Message sent!';
        root.querySelector('#msg-to-wm').value = '';
        root.querySelector('#msg-subject-wm').value = '';
        root.querySelector('#msg-body-wm').value = '';
        showToast('Message sent!', 'success');
      } else { res.className='form-error'; res.textContent=r.error||'Failed.'; }
    });

    await _loadMessagesList(root);
  }

  async function _loadMessagesList(root) {
    const el = root.querySelector('#messages-list-wm');
    if (!el) return;
    try {
      const data = await API.inbox();
      if (!data.success) { el.innerHTML = '<p class="text-red">Error.</p>'; return; }
      if (!data.messages.length) { el.innerHTML = '<p class="text-muted">Inbox empty.</p>'; return; }

      el.innerHTML = data.messages.map(m => `
        <div class="msg-row ${m.is_read ? '' : 'unread'}" data-mid="${m.id}">
          ${m.is_read ? '' : '<div class="msg-unread-dot"></div>'}
          <span class="msg-subject">${esc(m.subject)}</span>
          <span class="msg-sender">From: ${esc(m.sender)}</span>
          <span class="msg-date">${new Date(m.sent_at).toLocaleDateString()}</span>
          <button class="btn btn-danger btn-sm del-msg-btn" data-mid="${m.id}">🗑</button>
        </div>`).join('');

      el.querySelectorAll('.msg-row').forEach(row => {
        row.addEventListener('click', async e => {
          if (e.target.classList.contains('del-msg-btn')) return;
          const mid  = parseInt(row.dataset.mid, 10);
          const d    = await API.readMsg(mid);
          if (!d.success) return;
          const m    = d.message;
          // Show detail above list
          let detail = root.querySelector('.msg-detail');
          if (!detail) { detail = document.createElement('div'); detail.className='msg-detail'; el.before(detail); }
          detail.innerHTML = `
            <div class="msg-detail-header">
              <div>
                <strong>${esc(m.subject)}</strong>
                <div class="msg-detail-meta">From: ${esc(m.sender)} &nbsp;•&nbsp; ${new Date(m.sent_at).toLocaleString()}</div>
              </div>
              <button class="btn btn-secondary btn-sm close-msg-btn">✕ Close</button>
            </div>
            <hr class="separator" />
            <div class="msg-detail-body">${esc(m.body)}</div>`;
          detail.querySelector('.close-msg-btn').addEventListener('click', () => detail.remove());
          row.classList.remove('unread');
          loadBadge();
        });
      });

      el.querySelectorAll('.del-msg-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const r = await API.deleteMsg(parseInt(btn.dataset.mid, 10));
          if (r.success) _loadMessagesList(root);
        });
      });
    } catch (e) { el.innerHTML = '<p class="text-red">Failed to load messages.</p>'; }
  }

  // ── Leaderboard window ────────────────────────────────────
  async function renderLeaders() {
    const root = WM.body('leaders');
    if (!root) return;
    root.innerHTML = '<p class="text-muted">Loading leaders…</p>';
    try {
      const data = await API.leaders();
      if (!data.success) { root.innerHTML = '<p class="error">Failed to load leaders.</p>'; return; }
      const leaders = data.leaders || [];

      const roleLabel = {
        colony_manager:   '🏗 Colony Manager',
        fleet_commander:  '⚔ Fleet Commander',
        science_director: '🔬 Science Director',
      };
      const hireCost = {
        colony_manager:   '5k ⬡ 3k 💎 1k 🔵',
        fleet_commander:  '8k ⬡ 5k 💎 2k 🔵',
        science_director: '4k ⬡ 8k 💎 4k 🔵',
      };

      root.innerHTML = `
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem">
          ${Object.entries(roleLabel).map(([role, label]) => `
            <div class="hire-panel">
              <strong>${label}</strong>
              <div style="font-size:0.78rem;color:var(--text-secondary)">Cost: ${hireCost[role]}</div>
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
          ${leaders.length ? leaders.map(l => `
            <tr>
              <td>${esc(l.name)}</td>
              <td>${roleLabel[l.role] ?? l.role}</td>
              <td>${l.level}</td>
              <td>${l.colony_name
                ? `${esc(l.colony_name)} [${esc(l.colony_coords||'?')}]`
                : l.fleet_id ? `Fleet #${l.fleet_id}` : '<em>Unassigned</em>'}</td>
              <td>
                <select class="input-sm autonomy-sel" data-lid="${l.id}">
                  <option value="0" ${+l.autonomy===0?'selected':''}>Off</option>
                  <option value="1" ${+l.autonomy===1?'selected':''}>Suggest</option>
                  <option value="2" ${+l.autonomy===2?'selected':''}>Full Auto</option>
                </select>
              </td>
              <td style="font-size:0.75rem;max-width:200px;overflow:hidden;text-overflow:ellipsis"
                  title="${esc(l.last_action||'')}">
                ${l.last_action ? esc(l.last_action.substring(0,60))+'…' : '—'}
              </td>
              <td>
                <select class="input-sm assign-col-sel" data-lid="${l.id}">
                  <option value="">— Colony —</option>
                  ${colonies.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}
                </select>
                <button class="btn btn-secondary btn-sm assign-col-btn" data-lid="${l.id}">Assign</button>
                <button class="btn btn-danger btn-sm dismiss-btn" data-lid="${l.id}">✕</button>
              </td>
            </tr>`).join('')
          : '<tr><td colspan="7" class="text-muted">No leaders hired yet.</td></tr>'}
          </tbody>
        </table>
        <div style="margin-top:0.75rem">
          <button class="btn btn-secondary btn-sm" id="ai-tick-btn">▶ Run AI Tick</button>
        </div>`;

      // Hire buttons
      root.querySelectorAll('.hire-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const role = btn.dataset.role;
          const nameEl = root.querySelector(`.hire-name[data-role="${role}"]`);
          const name = nameEl?.value.trim();
          if (!name) { showToast('Enter a name first.', 'error'); return; }
          const r = await API.hireLeader(name, role);
          if (r.success) { showToast(r.message, 'success'); WM.refresh('leaders'); }
          else showToast(r.error || 'Failed', 'error');
        });
      });

      // Autonomy selects
      root.querySelectorAll('.autonomy-sel').forEach(sel => {
        sel.addEventListener('change', async () => {
          const r = await API.setAutonomy(parseInt(sel.dataset.lid), parseInt(sel.value));
          if (r.success) showToast(r.message, 'info');
          else showToast(r.error, 'error');
        });
      });

      // Assign to colony
      root.querySelectorAll('.assign-col-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const lid = parseInt(btn.dataset.lid);
          const sel = root.querySelector(`.assign-col-sel[data-lid="${lid}"]`);
          const cid = sel?.value ? parseInt(sel.value) : null;
          const r = await API.assignLeader(lid, cid, null);
          if (r.success) { showToast(r.message, 'success'); WM.refresh('leaders'); }
          else showToast(r.error, 'error');
        });
      });

      // Dismiss
      root.querySelectorAll('.dismiss-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Dismiss this leader?')) return;
          const r = await API.dismissLeader(parseInt(btn.dataset.lid));
          if (r.success) { showToast(r.message, 'success'); WM.refresh('leaders'); }
          else showToast(r.error, 'error');
        });
      });

      // AI tick
      root.querySelector('#ai-tick-btn')?.addEventListener('click', async () => {
        const r = await API.aiTick();
        if (r.success) {
          const actions = r.actions || [];
          showToast(actions.length ? `AI: ${actions[0]}` : 'AI: No actions taken.', 'info');
          WM.refresh('leaders');
        }
      });

    } catch (e) {
      root.innerHTML = `<p class="error">${esc(String(e))}</p>`;
    }
  }

  async function renderFactions() {
    const root = WM.body('factions');
    if (!root) return;
    root.innerHTML = '<p class="text-muted">Loading factions…</p>';
    try {
      const data = await API.factions();
      if (!data.success) { root.innerHTML = '<p class="error">Failed.</p>'; return; }
      const factions = data.factions || [];

      const standingClass = (s) => s >= 50 ? 'chip-allied' : s >= 10 ? 'chip-friendly'
                                          : s >= -10 ? 'chip-neutral' : s >= -50 ? 'chip-hostile' : 'chip-war';
      const standingLabel = (s) => s >= 50 ? 'Allied' : s >= 10 ? 'Friendly'
                                          : s >= -10 ? 'Neutral' : s >= -50 ? 'Hostile' : 'War';

      root.innerHTML = `
        <div class="factions-grid">
          ${factions.map(f => `
            <div class="faction-card" style="border-color:${esc(f.color)}">
              <div class="faction-header">
                <span class="faction-icon">${esc(f.icon)}</span>
                <span class="faction-name" style="color:${esc(f.color)}">${esc(f.name)}</span>
                <span class="status-chip ${standingClass(f.standing)}">
                  ${standingLabel(f.standing)} (${f.standing > 0 ? '+' : ''}${f.standing})
                </span>
              </div>
              <p style="font-size:0.8rem;color:var(--text-secondary);margin:0.3rem 0 0.6rem">
                ${esc(f.description)}
              </p>
              <div style="font-size:0.75rem;color:var(--text-muted)">
                ⚔ Aggression: ${f.aggression}/100 &nbsp;
                💰 Trade: ${f.trade_willingness}/100 &nbsp;
                ✅ Quests done: ${f.quests_done}
              </div>
              ${f.last_event ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.3rem">${esc(f.last_event)}</div>` : ''}
              <div class="faction-actions" style="margin-top:0.6rem;display:flex;gap:0.4rem">
                <button class="btn btn-secondary btn-sm" data-fid="${f.id}" data-act="trade">💱 Trade</button>
                <button class="btn btn-secondary btn-sm" data-fid="${f.id}" data-act="quests">📋 Quests</button>
              </div>
            </div>`).join('')}
        </div>

        <div id="faction-detail" style="margin-top:1rem"></div>`;

      // Trade / Quest buttons
      root.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', () => renderFactionDetail(root, parseInt(btn.dataset.fid), btn.dataset.act));
      });

    } catch (e) { root.innerHTML = `<p class="error">${esc(String(e))}</p>`; }
  }

  async function renderFactionDetail(root, fid, mode) {
    const detail = root.querySelector('#faction-detail');
    if (!detail) return;
    detail.innerHTML = '<p class="text-muted">Loading…</p>';

    if (mode === 'trade') {
      const d = await API.tradeOffers(fid);
      if (!d.success || !d.offers.length) {
        detail.innerHTML = '<p class="text-muted">No active trade offers from this faction.</p>';
        return;
      }
      detail.innerHTML = `
        <h4>Trade Offers (Standing: ${d.standing})</h4>
        <table class="data-table" style="width:100%">
          <thead><tr><th>They Offer</th><th>They Want</th><th>Expires</th><th>Claims</th><th></th></tr></thead>
          <tbody>${d.offers.map(o => `
            <tr>
              <td>⬡ ${o.offer_amount.toLocaleString()} ${o.offer_resource}</td>
              <td>⬡ ${o.request_amount.toLocaleString()} ${o.request_resource}</td>
              <td style="font-size:0.75rem">${new Date(o.valid_until).toLocaleString()}</td>
              <td>${o.claims_count}/${o.max_claims}</td>
              <td><button class="btn btn-primary btn-sm trade-accept-btn"
                    data-oid="${o.id}">Accept</button></td>
            </tr>`).join('')}
          </tbody>
        </table>`;

      detail.querySelectorAll('.trade-accept-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!currentColony) { showToast('Select a colony first.', 'error'); return; }
          const r = await API.acceptTrade(parseInt(btn.dataset.oid), currentColony.id);
          if (r.success) {
            showToast(r.message, 'success');
            await loadOverview();
            renderFactionDetail(root, fid, 'trade');
          } else showToast(r.error || 'Trade failed', 'error');
        });
      });

    } else {
      const d = await API.factionQuests(fid);
      if (!d.success) { detail.innerHTML = '<p class="error">Failed to load quests.</p>'; return; }
      const quests = d.quests || [];

      // Also fetch user's active faction quests to show status
      detail.innerHTML = `
        <h4>Faction Quests (Standing: ${d.standing})</h4>
        <div style="display:flex;flex-wrap:wrap;gap:0.75rem">
          ${quests.map(q => `
            <div class="quest-card" style="min-width:240px;max-width:320px">
              <div style="font-weight:bold">${esc(q.title)}</div>
              <div style="font-size:0.75rem;color:var(--text-secondary);margin:0.2rem 0">${esc(q.description)}</div>
              <div style="font-size:0.72rem">
                Difficulty: <strong>${q.difficulty}</strong> &nbsp;
                Type: ${q.quest_type}
              </div>
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem">
                Reward: ${q.reward_metal?'⬡'+q.reward_metal+' ':''} ${q.reward_crystal?'💎'+q.reward_crystal+' ':''}
                        ${q.reward_rank_points?'★'+q.reward_rank_points:''} ${q.reward_standing?'+'+q.reward_standing+' 🤝':''}
              </div>
              ${q.taken
                ? '<span class="status-chip chip-neutral">Active / Done</span>'
                : `<button class="btn btn-primary btn-sm start-fq-btn" data-fqid="${q.id}" style="margin-top:0.4rem">Start Quest</button>`}
            </div>`).join('')}
          ${!quests.length ? '<p class="text-muted">No quests available at your current standing.</p>' : ''}
        </div>`;

      detail.querySelectorAll('.start-fq-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const r = await API.startFactionQuest(parseInt(btn.dataset.fqid));
          if (r.success) { showToast(r.message, 'success'); renderFactionDetail(root, fid, 'quests'); }
          else showToast(r.error || 'Failed', 'error');
        });
      });
    }
  }

  async function renderLeaderboard() {
    const root = WM.body('leaderboard');
    if (!root) return;
    root.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
      const data = await API.leaderboard();
      if (!data.success) { root.innerHTML = '<p class="text-red">Error.</p>'; return; }
      if (!data.leaderboard.length) { root.innerHTML = '<p class="text-muted">No players yet.</p>'; return; }

      root.innerHTML = data.leaderboard.map((row, i) => `
        <div class="lb-row">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${esc(row.username)} ${row.username === currentUser.username ? '(You)' : ''}</span>
          <span class="lb-stat">★ ${fmt(row.rank_points)} RP</span>
          <span class="lb-stat">🌍 ${row.planet_count}</span>
          <span class="lb-stat">◆ ${fmt(row.dark_matter)}</span>
        </div>`).join('');
    } catch (e) { root.innerHTML = '<p class="text-red">Failed to load leaderboard.</p>'; }
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
    await API.logout();
    window.location.href = 'index.html';
  });

  // ── Badge refresh (messages) ──────────────────────────────
  async function loadBadge() {
    try {
      const data = await API.inbox();
      if (!data.success) return;
      const unread = data.messages.filter(m => !parseInt(m.is_read, 10)).length;
      const badge  = document.getElementById('msg-badge');
      if (unread > 0) { badge.textContent = unread; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    } catch (_) {}
  }

  // ── Countdown ticker ─────────────────────────────────────
  setInterval(() => {
    document.querySelectorAll('[data-end]').forEach(el => {
      el.textContent = countdown(el.dataset.end);
    });
  }, 1000);

  // ── Periodic refresh ──────────────────────────────────────
  setInterval(async () => {
    await loadOverview();
    ['buildings','research','shipyard'].forEach(id => WM.refresh(id));
  }, 30000);

  // ── Boot: keep galaxy fixed in main desktop area and preload overview data ──
  WM.open('galaxy');
  await loadOverview();
})();
