/**
 * RuntimePolicyEngine.js
 *
 * Runtime policy profile selection + persistence + UI sync.
 */

'use strict';

(function () {
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

  const state = {
    activePolicyProfile: 'balanced',
    activePolicyMode: 'auto',
    activeAutoPolicyReason: '',
    getGalaxyDb: () => null,
    getLocalStorage: () => null,
    getNavigator: () => (typeof navigator !== 'undefined' ? navigator : null),
    logger: null,
  };

  function log(level, message, data = null) {
    if (typeof state.logger === 'function') {
      state.logger(level, message, data);
      return;
    }
    const method = (level === 'error' || level === 'warn' || level === 'info') ? level : 'log';
    if (data == null) console[method]('[policy]', message);
    else console[method]('[policy]', message, data);
  }

  function configurePolicyRuntime(opts = {}) {
    const {
      getGalaxyDb = null,
      getLocalStorage = null,
      getNavigator = null,
      logger = null,
    } = opts;

    state.getGalaxyDb = typeof getGalaxyDb === 'function' ? getGalaxyDb : () => null;
    state.getLocalStorage = typeof getLocalStorage === 'function' ? getLocalStorage : () => null;
    state.getNavigator = typeof getNavigator === 'function'
      ? getNavigator
      : () => (typeof navigator !== 'undefined' ? navigator : null);
    state.logger = logger;
  }

  function getStorage() {
    return state.getLocalStorage();
  }

  function getGalaxyDb() {
    return state.getGalaxyDb();
  }

  function applyPolicyProfile(name) {
    const profileName = POLICY_PROFILES[name] ? name : 'balanced';
    const profile = POLICY_PROFILES[profileName];
    LEVEL_POLICIES.galaxy.stars = Object.assign({}, profile.galaxy.stars);
    LEVEL_POLICIES.system.payload = Object.assign({}, profile.system.payload);
    LEVEL_POLICIES.planet.details = Object.assign({}, profile.planet.details);

    const galaxyDb = getGalaxyDb();
    if (galaxyDb && galaxyDb.policies) {
      galaxyDb.policies.starMaxAgeMs = Number(profile.galaxy.stars.cacheMaxAgeMs);
      galaxyDb.policies.systemMaxAgeMs = Number(profile.system.payload.cacheMaxAgeMs);
    }

    state.activePolicyProfile = profileName;
    try {
      getStorage()?.setItem('gq_policy_profile', profileName);
    } catch (err) {
      log('info', 'Policy-Profil konnte nicht persistiert werden', err);
    }
  }

  function detectAutoPolicyProfile() {
    try {
      const nav = state.getNavigator() || {};
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
    } catch (err) {
      log('warn', 'Auto-Policy-Erkennung fehlgeschlagen, verwende balanced', err);
      return {
        profile: 'balanced',
        reason: 'Auto rule: fallback (device capabilities unavailable).',
      };
    }
  }

  function currentPolicyHintText() {
    if (state.activePolicyMode === 'auto') {
      return `Auto active -> ${POLICY_PROFILES[state.activePolicyProfile].label}. ${state.activeAutoPolicyReason}`;
    }
    return `Manual policy: ${POLICY_PROFILES[state.activePolicyProfile].label}.`;
  }

  function refreshPolicyUi(root) {
    if (!root) return;
    const select = root.querySelector('#gal-policy-profile');
    if (select) {
      const autoOption = select.querySelector('option[value="auto"]');
      if (autoOption) autoOption.textContent = `Auto (${POLICY_PROFILES[state.activePolicyProfile].label})`;
      select.value = state.activePolicyMode === 'auto' ? 'auto' : state.activePolicyProfile;
    }
    const hint = root.querySelector('#gal-policy-hint');
    if (hint) hint.textContent = currentPolicyHintText();
  }

  function applyPolicyMode(mode, explicitProfile) {
    const normalizedMode = mode === 'manual' ? 'manual' : 'auto';
    state.activePolicyMode = normalizedMode;
    let nextProfile = 'balanced';

    if (normalizedMode === 'manual') {
      nextProfile = POLICY_PROFILES[explicitProfile] ? explicitProfile : state.activePolicyProfile;
      state.activeAutoPolicyReason = '';
    } else {
      const autoDecision = detectAutoPolicyProfile();
      nextProfile = autoDecision.profile;
      state.activeAutoPolicyReason = autoDecision.reason;
    }

    applyPolicyProfile(nextProfile);
    try {
      const storage = getStorage();
      storage?.setItem('gq_policy_mode', state.activePolicyMode);
      if (normalizedMode === 'manual' && POLICY_PROFILES[nextProfile]) {
        storage?.setItem('gq_policy_profile_manual', nextProfile);
      }
    } catch (err) {
      log('info', 'Policy-Modus konnte nicht persistiert werden', err);
    }
  }

  function initPolicyFromStorage() {
    try {
      const storage = getStorage();
      const savedMode = storage?.getItem('gq_policy_mode');
      const savedManual = storage?.getItem('gq_policy_profile_manual');
      const savedLegacy = storage?.getItem('gq_policy_profile');
      if (savedMode === 'manual' && savedManual && POLICY_PROFILES[savedManual]) {
        applyPolicyMode('manual', savedManual);
        return;
      }
      if (savedMode === 'manual' && savedLegacy && POLICY_PROFILES[savedLegacy]) {
        applyPolicyMode('manual', savedLegacy);
        return;
      }
      applyPolicyMode('auto');
    } catch (err) {
      log('warn', 'Policy-Init aus Storage fehlgeschlagen, fallback auto', err);
      applyPolicyMode('auto');
    }
  }

  function getPolicyProfiles() {
    return POLICY_PROFILES;
  }

  function getLevelPolicies() {
    return LEVEL_POLICIES;
  }

  function getActivePolicyProfile() {
    return String(state.activePolicyProfile || 'balanced');
  }

  function getActivePolicyMode() {
    return String(state.activePolicyMode || 'auto');
  }

  function isPolicyModeAuto() {
    return state.activePolicyMode === 'auto';
  }

  const api = {
    configurePolicyRuntime,
    applyPolicyProfile,
    applyPolicyMode,
    detectAutoPolicyProfile,
    currentPolicyHintText,
    refreshPolicyUi,
    initPolicyFromStorage,
    getPolicyProfiles,
    getLevelPolicies,
    getActivePolicyProfile,
    getActivePolicyMode,
    isPolicyModeAuto,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimePolicyEngine = api;
  }
})();
