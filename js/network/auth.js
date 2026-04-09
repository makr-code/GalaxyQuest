/**
 * Unified shell bootstrap (index.html).
 * Handles auth section, game section, and progressive runtime loading.
 */
(async function () {
  if (window.__GQ_AUTH_BOOTSTRAP_LOCK === true) {
    if (window.GQLog && typeof window.GQLog.warn === 'function') {
      window.GQLog.warn('[auth]', 'bootstrap skipped: already initialized');
    }
    return;
  }
  window.__GQ_AUTH_BOOTSTRAP_LOCK = true;

  const withAssetVersion = typeof window.GQResolveAssetVersion === 'function'
    ? window.GQResolveAssetVersion.bind(window)
    : function fallbackAssetVersion(path, versionKey, fallbackVersion) {
        const assetVersions = window.__GQ_ASSET_VERSIONS || {};
        const version = String(assetVersions?.[versionKey] || fallbackVersion || '').trim();
        return version ? `${path}?v=${version}` : path;
      };

  const AUTH_AUDIO_SCRIPT = withAssetVersion('js/runtime/audio.js', 'audio', '20260404p50');
  const AUTH_GQUI_SCRIPT = withAssetVersion('js/ui/gq-ui.js', 'gqui', '20260330p1');
  const AUTH_WM_SCRIPT = withAssetVersion('js/runtime/wm.js', 'wm', '20260406p2');
  const AUTH_WM_WIDGETS_SCRIPT = withAssetVersion('js/runtime/wm-widgets.js', 'wmWidgets', '20260406p2');
  const AUTH_GQWM_SCRIPT = withAssetVersion('js/runtime/gqwm.js', 'gqwm', '20260406p2');
  const AUTH_AUDIO_PRELOAD = [
    'music/Nebula_Overture.mp3',
    'sfx/mixkit-video-game-retro-click-237.wav',
    'sfx/mixkit-quick-positive-video-game-notification-interface-265.wav',
    'sfx/mixkit-negative-game-notification-249.wav',
    'sfx/mixkit-sci-fi-positive-notification-266.wav',
    'sfx/mixkit-sci-fi-warp-slide-3113.wav',
  ];
  const AUTH_LAST_TITLE_TRACK_KEY = 'gq_last_title_track';

  const authReady = window.__GQ_AUTH_READY = Object.assign(window.__GQ_AUTH_READY || {}, {
    initialized: true,
    loginBound: false,
    registerBound: false,
    startedAt: Date.now(),
  });

  function authProbe(message, level = 'info') {
    if (window.__GQ_BOOT_PROBE?.log) {
      window.__GQ_BOOT_PROBE.log(`[auth] ${message}`, level);
    }
  }

  function authLog(level, ...parts) {
    const fn = window.GQLog && typeof window.GQLog[level] === 'function'
      ? window.GQLog[level]
      : null;
    if (fn) {
      fn('[auth]', ...parts);
      return;
    }
    if (window.__GQ_BOOT_TERMINAL_ADAPTER?.append) {
      window.__GQ_BOOT_TERMINAL_ADAPTER.append(level, `[auth] ${parts.join(' ')}`, '', 'auth-fallback');
    }
  }

  function authUiLog(level, ...parts) {
    authLog(level, '[login-ui]', ...parts);
  }

  function isShellDebugEnabled() {
    try {
      if (window.GQ_DEBUG_SHELL === true) return true;
      const params = new URLSearchParams(String(window.location?.search || ''));
      const qp = String(params.get('gqShellDebug') || '').toLowerCase();
      if (qp === '1' || qp === 'true' || qp === 'yes' || qp === 'on') return true;
      return localStorage.getItem('gq_shell_debug') === '1';
    } catch (_) {
      return false;
    }
  }

  authLog('info', 'bootstrap start');
  authProbe('bootstrap start');

  const authSection = document.getElementById('auth-section');
  function resolveGameSection() {
    return document.getElementById('game-section')
      || document.getElementById('wm-galaxy-section')
      || document.getElementById('wm-host-galaxy')
      || null;
  }
  const tabs = authSection
    ? authSection.querySelectorAll('.auth-tabs .tab-btn')
    : document.querySelectorAll('.auth-tabs .tab-btn');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const devTools = document.getElementById('dev-auth-tools');
  const devTabButton = document.getElementById('auth-dev-tab');
  const devResetBtn = document.getElementById('dev-reset-btn');
  const devResetUser = document.getElementById('dev-reset-username');
  const devResetPass = document.getElementById('dev-reset-password');
  const devResetResult = document.getElementById('dev-reset-result');
  const preloadPanel = document.getElementById('auth-preload-panel');
  const preloadBar = document.getElementById('auth-preload-bar');
  const preloadLabel = document.getElementById('auth-preload-label');
  const preloadMeta = document.getElementById('auth-preload-meta');
  const authActionModal = document.getElementById('auth-action-modal');
  const authActionSpinner = document.getElementById('auth-action-spinner');
  const authActionTitle = document.getElementById('auth-action-title');
  const authActionText = document.getElementById('auth-action-text');
  const authLoginConfirmSection = document.getElementById('auth-login-confirm-section');
  const authLoginConfirmTitle = document.getElementById('auth-login-confirm-title');
  const authLoginConfirmText = document.getElementById('auth-login-confirm-text');
  const authLoginConfirmBar = document.getElementById('auth-login-confirm-bar');
  const authLoginConfirmMeta = document.getElementById('auth-login-confirm-meta');
  const loginRemember = document.getElementById('login-remember');
  const regRemember = document.getElementById('reg-remember');
  const AUTH_FLIGHT_PROFILE_KEY = 'gq_auth_flight_profile';
  const AUTH_DEFAULT_FLIGHT_PROFILE = 'cinematic';

  let gameBootPromise = null;
  let startGameShellPromise = null;
  let sessionValidationBreaker = null;
  let loginSubmitInFlight = false;

  function stopSessionValidationBreaker() {
    if (sessionValidationBreaker) {
      clearInterval(sessionValidationBreaker);
      sessionValidationBreaker = null;
      authLog('info', 'session validation breaker stopped');
    }
  }

  async function checkSessionValidityForBreaker(tag) {
    try {
      const me = await fetchWithTimeout('api/auth.php?action=me&quiet=1', {
        method: 'GET',
        credentials: 'same-origin',
        timeoutMs: 5000,
        tag,
      });

      if (!me.ok) {
        const status = Number(me.status || 0);
        if (status === 401 || status === 403) {
          return { state: 'invalid', reason: `session check returned ${status}` };
        }
        return { state: 'transient', reason: `session check returned ${status}` };
      }

      const data = await me.json();
      if (data?.authenticated === true || !!data?.user) {
        return { state: 'valid' };
      }
      return { state: 'invalid', reason: 'session not authenticated' };
    } catch (err) {
      if (isTransientAuthFetchError(err)) {
        return {
          state: 'transient',
          reason: String(err?.message || err || 'transient auth check failure'),
        };
      }
      return {
        state: 'invalid',
        reason: String(err?.message || err || 'session validation failure'),
      };
    }
  }

  function installSessionValidationBreaker() {
    stopSessionValidationBreaker();

    let transientFailures = 0;
    
    authLog('info', 'installing session validation breaker');
    
    // Start immediate check
    const validateSessionImmediate = async () => {
      const result = await checkSessionValidityForBreaker('session-validation-breaker');
      if (result.state === 'valid') {
        authLog('debug', 'session validation breaker: session valid');
        return;
      }
      if (result.state === 'transient') {
        transientFailures += 1;
        const logLevel = transientFailures === 1 || (transientFailures % 6 === 0) ? 'warn' : 'debug';
        authLog(logLevel, 'session validation breaker transient failure', result.reason || 'unknown');
        return;
      }
      transientFailures = 0;
      authLog('error', 'session validation breaker: session invalid', result.reason || 'unknown');
      if (result.state === 'invalid') {
        returnToLoginPage();
      }
    };
    
    // Initial immediate check
    validateSessionImmediate();
    
    // Periodic checks every 30 seconds
    sessionValidationBreaker = setInterval(async () => {
      const result = await checkSessionValidityForBreaker('session-validation-periodic');
      if (result.state === 'valid') {
        authLog('debug', 'session validation breaker: periodic check passed');
        return;
      }
      if (result.state === 'transient') {
        transientFailures += 1;
        const logLevel = transientFailures === 1 || (transientFailures % 6 === 0) ? 'warn' : 'debug';
        authLog(logLevel, 'session validation breaker transient periodic failure', result.reason || 'unknown');
        return;
      }
      transientFailures = 0;
      authLog('warn', 'session validation breaker: session became invalid', result.reason || 'unknown');
      if (result.state === 'invalid') {
        returnToLoginPage();
      }
    }, 30000); // Check every 30 seconds
  }

  function returnToLoginPage(reason = 'session-invalid') {
    stopSessionValidationBreaker();
    
    authLog('error', 'returning to login page', reason);
    authUiLog('error', 'Deine Session ist ungültig. Melde dich erneut an.');
    
    // Hide game, show auth
    const gameSection = resolveGameSection();
    const stageSection = document.getElementById('wm-galaxy-section');
    
    document.body.classList.remove('game-page');
    document.body.classList.add('auth-page');
    
    if (stageSection) {
      stageSection.classList.remove('game-shell');
      stageSection.classList.add('auth-shell');
    }
    
    gameSection?.classList.add('hidden');
    gameSection?.setAttribute('aria-hidden', 'true');
    authSection?.classList.remove('hidden');
    authSection?.setAttribute('aria-hidden', 'false');
    
    setAuthVisible();
    showErrorBanner('Deine Session ist abgelaufen. Melde dich bitte erneut an.', 5000);
    
    // Reset app state
    gameBootPromise = null;
    startGameShellPromise = null;
  }
  
  function showErrorBanner(message, durationMs = 5000) {
    const banner = document.createElement('div');
    banner.className = 'session-error-banner';
    banner.textContent = message;
    Object.assign(banner.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      backgroundColor: '#cc4433',
      color: '#fff',
      padding: '12px 16px',
      zIndex: '9999',
      textAlign: 'center',
      fontWeight: 'bold',
    });
    
    document.body.appendChild(banner);
    
    setTimeout(() => {
      banner.remove();
    }, durationMs);
  }
  const scriptLoadPromises = new Map();
  const packageLoadPromises = new Map();
  let authDebugDetails = false;
  let authWindowIntegrationAttempted = false;
  let preloadPanelSuppressed = false;
  let lastPhaseBucket = -1;
  let homeworldTargetInflight = null;
  let homeworldTargetCache = null;
  let homeworldTargetCacheAt = 0;

  const HOMEWORLD_TARGET_CACHE_TTL_MS = 30000;

  // Keep remember-me enabled by default on the auth shell.
  if (loginRemember) loginRemember.checked = true;
  if (regRemember) regRemember.checked = false;

  try {
    localStorage.setItem(AUTH_FLIGHT_PROFILE_KEY, AUTH_DEFAULT_FLIGHT_PROFILE);
  } catch (err) {
    authLog('warn', 'auth flight profile write failed', String(err?.message || err || 'unknown'));
  }
  window.__GQ_AUTH_FLIGHT_PROFILE = AUTH_DEFAULT_FLIGHT_PROFILE;

  try {
    const host = String(window.location?.hostname || '').toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
    const forceFlag = localStorage.getItem('gq_auth_debug') === '1';
    const queryFlag = new URLSearchParams(window.location.search || '').get('authDebug') === '1';
    authDebugDetails = isLocalHost || forceFlag || queryFlag;
  } catch (err) {
    authLog('warn', 'auth debug mode detection failed', String(err?.message || err || 'unknown'));
  }

  function bindEnterSubmit(form) {
    if (!form || form.__gqEnterSubmitBound) return;
    form.__gqEnterSubmitBound = true;
    form.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented) return;
      if (ev.key !== 'Enter') return;
      const target = ev.target;
      if (!target) return;
      const tag = String(target.tagName || '').toLowerCase();
      if (tag === 'textarea') return;
      if (ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      ev.preventDefault();
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.submit();
      }
    });
  }

  function setPhase(label, pct) {
    const clamped = Math.max(0, Math.min(100, Number(pct || 0)));
    const authVisible = !!(authSection && !authSection.classList.contains('hidden'));
    const loginConfirmVisible = !!(authLoginConfirmSection && !authLoginConfirmSection.classList.contains('hidden'));
    if (preloadLabel) preloadLabel.textContent = String(label || 'Loading...');
    if (preloadMeta) preloadMeta.textContent = `${clamped.toFixed(0)}%`;
    if (preloadBar) preloadBar.style.width = `${clamped}%`;
    if (!preloadPanelSuppressed && !authVisible && !loginConfirmVisible) {
      preloadPanel?.classList.remove('hidden');
    } else {
      preloadPanel?.classList.add('hidden');
    }
    if (authLoginConfirmBar) {
      authLoginConfirmBar.style.width = `${clamped}%`;
    }
    if (authLoginConfirmSection) {
      authLoginConfirmSection.classList.toggle('is-complete', clamped >= 100);
    }
    if (authLoginConfirmSection && !authLoginConfirmSection.classList.contains('hidden') && authLoginConfirmMeta) {
      if (clamped >= 100) {
        if (authLoginConfirmTitle) authLoginConfirmTitle.textContent = 'Bereit';
        if (authLoginConfirmText) authLoginConfirmText.textContent = 'Uebergang in die Einsatzansicht...';
        authLoginConfirmMeta.textContent = '100% • Start';
      } else {
        authLoginConfirmMeta.textContent = `${clamped.toFixed(0)}% • ${String(label || 'Loading...')}`;
      }
    }

    // Log progress in coarse buckets to keep console readable.
    const bucket = Math.floor(clamped / 25);
    if (bucket !== lastPhaseBucket) {
      lastPhaseBucket = bucket;
      authUiLog('info', `boot progress ${clamped.toFixed(0)}%`, String(label || 'Loading...'));
    }
  }

  function hidePreloadPanel(reset = false) {
    preloadPanel?.classList.add('hidden');
    authUiLog('info', `auth preload panel hidden${reset ? ' (reset)' : ''}`);
    if (!reset) return;
    if (preloadBar) preloadBar.style.width = '0%';
    if (preloadLabel) preloadLabel.textContent = 'Systemcheck laeuft...';
    if (preloadMeta) preloadMeta.textContent = '0%';
  }

  function closeGameplayWindowsForAuthState() {
    try {
      const wm = window.WM;
      if (!wm || typeof wm.close !== 'function' || typeof wm.isOpen !== 'function') return;
      [
        'left-sidebar',
        'right-sidebar',
        'overview',
        'buildings',
        'colony',
        'research',
        'shipyard',
        'fleet',
        'wormholes',
        'messages',
        'intel',
        'trade-routes',
        'economy-flow',
        'trade',
        'quests',
        'leaderboard',
        'leaders',
        'factions',
        'alliances',
        'settings',
        'quicknav',
        'minimap',
      ].forEach((id) => {
        if (wm.isOpen(id)) wm.close(id);
      });
    } catch (err) {
      authLog('warn', 'closeGameplayWindowsForAuthState failed', String(err?.message || err || 'unknown'));
    }
  }

  function showLoginConfirmSection(title, text, meta = '') {
    if (authLoginConfirmTitle) authLoginConfirmTitle.textContent = String(title || 'Login ok');
    if (authLoginConfirmText) authLoginConfirmText.textContent = String(text || 'Lade Kommandostand...');
    if (authLoginConfirmMeta) authLoginConfirmMeta.textContent = String(meta || 'Session ok');
    if (authLoginConfirmBar) authLoginConfirmBar.style.width = '0%';
    preloadPanel?.classList.add('hidden');
    authLoginConfirmSection?.classList.remove('is-complete');
    authLoginConfirmSection?.classList.remove('is-exiting');
    authLoginConfirmSection?.classList.remove('hidden');
    authUiLog('info', 'login confirm section shown', `${String(title || '')} | ${String(meta || '')}`);
  }

  async function hideLoginConfirmSection(options = {}) {
    const animate = options?.animate === true;
    if (animate && authLoginConfirmSection && !authLoginConfirmSection.classList.contains('hidden')) {
      authLoginConfirmSection.classList.add('is-exiting');
      await sleep(300);
    }
    authLoginConfirmSection?.classList.remove('is-complete');
    authLoginConfirmSection?.classList.remove('is-exiting');
    if (authLoginConfirmBar) authLoginConfirmBar.style.width = '0%';
    authLoginConfirmSection?.classList.add('hidden');
    authUiLog('info', `login confirm section hidden${animate ? ' (fade)' : ''}`);
  }

  function reportBootFailure(context, err) {
    const msg = String(err?.message || err || 'unknown error');
    setPhase(`Boot failed (${context})`, 100);
    if (preloadMeta) preloadMeta.textContent = msg;
    const loginErr = document.getElementById('login-error');
    if (loginErr) loginErr.textContent = `${context}: ${msg}`;
    if (window.__GQ_BOOT_DIAG?.report) {
      window.__GQ_BOOT_DIAG.report('auth-bootstrap', msg, context);
    }
  }

  function showActionModal(title, text, busy = true) {
    if (authActionTitle) authActionTitle.textContent = String(title || 'Please wait...');
    if (authActionText) authActionText.textContent = String(text || 'Working...');
    if (authActionSpinner) authActionSpinner.classList.toggle('hidden', !busy);
    if (authActionModal) {
      authActionModal.classList.remove('hidden');
      authActionModal.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
  }

  function hideActionModal() {
    if (authActionModal) {
      authActionModal.classList.add('hidden');
      authActionModal.setAttribute('aria-busy', 'false');
    }
  }

  async function performLogoutCleanup() {
    stopSessionValidationBreaker();
    try {
      await fetchWithTimeout('api/auth.php?action=logout', {
        method: 'POST',
        credentials: 'same-origin',
        timeoutMs: 5000,
        tag: 'logout-cleanup',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch (err) {
      authLog('warn', 'logout cleanup failed (best effort)', String(err?.message || err || 'unknown'));
      // Best effort only: auth screen should still be usable offline or on transient failures.
    }
  }

  function emitInitDiag(stage) {
    try {
      const gameSection = resolveGameSection();
      const bodyClass = String(document.body?.className || '');
      const authVisible = !!(authSection && !authSection.classList.contains('hidden'));
      const gameSectionExists = !!gameSection;
      const gameVisible = !!(gameSection && !gameSection.classList.contains('hidden'));
      const wmReady = !!(window.WM && typeof window.WM.open === 'function');
      const registryReady = !!(window.GQWindowRegistry && window.GQWindowRegistry.registered);
      const galaxyOpen = !!(wmReady && typeof window.WM.isOpen === 'function' && window.WM.isOpen('galaxy'));
      const hasOrb = !!document.getElementById('galaxy-nav-orb-overlay');
      const starfield = document.getElementById('starfield');
      const starfieldReady = !!(starfield && Number(starfield.width || 0) > 0 && Number(starfield.height || 0) > 0);
      const terminalReady = !!window.__gqUiConsoleReady;

      const parts = [
        `stage=${String(stage || 'unknown')}`,
        `body=${bodyClass || '(none)'}`,
        `authVisible=${authVisible}`,
        `gameSectionExists=${gameSectionExists}`,
        `gameVisible=${gameVisible}`,
        `wmReady=${wmReady}`,
        `registryReady=${registryReady}`,
        `galaxyOpen=${galaxyOpen}`,
        `orb=${hasOrb}`,
        `starfieldReady=${starfieldReady}`,
        `terminalReady=${terminalReady}`,
      ];
      const line = `[initdiag] ${parts.join(' ')}`;
      authLog('info', line);
      if (window.__GQ_BOOT_DIAG?.log) {
        window.__GQ_BOOT_DIAG.log('info', line, 'auth-init');
      }
    } catch (err) {
      authLog('warn', 'emitInitDiag failed', String(err?.message || err || 'unknown'));
    }
  }

  function emitShellDebugConsole(stage, extra = {}) {
    if (!isShellDebugEnabled()) {
      return;
    }
    try {
      const gameSection = resolveGameSection();
      const bodyClass = String(document.body?.className || '');
      const stageSection = document.getElementById('wm-galaxy-section');
      const hostWrapper = document.getElementById('galaxy-host-wrapper');
      const host = document.getElementById('galaxy-3d-host');
      const starfield = document.getElementById('starfield');
      const authVisible = !!(authSection && !authSection.classList.contains('hidden'));
      const gameVisible = !!(gameSection && !gameSection.classList.contains('hidden'));
      const renderTelemetry = Array.isArray(window.__GQ_RENDER_TELEMETRY) ? window.__GQ_RENDER_TELEMETRY : [];
      const lastRenderEvent = renderTelemetry.length ? renderTelemetry[renderTelemetry.length - 1] : null;
      const snapshot = {
        stage: String(stage || 'unknown'),
        ts: Date.now(),
        bodyClass,
        authVisible,
        gameSectionExists: !!gameSection,
        gameSectionId: String(gameSection?.id || ''),
        gameVisible,
        stageSectionClass: String(stageSection?.className || ''),
        hostWrapper: !!hostWrapper,
        host: !!host,
        starfield: !!starfield,
        starfieldSize: starfield ? `${Number(starfield.width || 0)}x${Number(starfield.height || 0)}` : 'missing',
        hostRect: host ? {
          w: Math.round(Number(host.getBoundingClientRect()?.width || 0)),
          h: Math.round(Number(host.getBoundingClientRect()?.height || 0)),
        } : null,
        hostStyle: host ? {
          display: window.getComputedStyle(host).display,
          visibility: window.getComputedStyle(host).visibility,
          opacity: window.getComputedStyle(host).opacity,
        } : null,
        starfieldStyle: starfield ? {
          display: window.getComputedStyle(starfield).display,
          visibility: window.getComputedStyle(starfield).visibility,
          opacity: window.getComputedStyle(starfield).opacity,
        } : null,
        wmReady: !!(window.WM && typeof window.WM.open === 'function'),
        galaxyOpen: !!(window.WM && typeof window.WM.isOpen === 'function' && window.WM.isOpen('galaxy')),
        rendererReady: !!window.galaxy3d,
        rendererInitReason: String(window.galaxy3dInitReason || ''),
        renderTelemetryReason: String(lastRenderEvent?.reason || ''),
        rendererBootstrapReady: !!window.GQGalaxyRendererBootstrap,
        extra,
      };
      console.info('[GQ][ShellDebug]', snapshot);
    } catch (err) {
      console.warn('[GQ][ShellDebug] emit failed', String(err?.message || err || 'unknown'));
    }
  }

  function installShellDebugObservers() {
    if (!isShellDebugEnabled()) return;
    if (window.__GQ_SHELL_DEBUG_OBSERVERS_INSTALLED) return;
    window.__GQ_SHELL_DEBUG_OBSERVERS_INSTALLED = true;

    try {
      const bodyObserver = new MutationObserver((mutations) => {
        const changed = mutations.map((m) => ({
          type: m.type,
          attr: m.attributeName || '',
        }));
        emitShellDebugConsole('observer:body-mutation', { changed });
      });
      if (document.body) {
        bodyObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ['class', 'style'],
        });
      }
      window.__GQ_SHELL_DEBUG_BODY_OBSERVER = bodyObserver;
    } catch (err) {
      console.warn('[GQ][ShellDebug] body observer failed', String(err?.message || err || 'unknown'));
    }

    try {
      const watchIds = ['wm-galaxy-section', 'galaxy-bg-wrapper', 'galaxy-host-wrapper', 'galaxy-3d-host', 'starfield'];
      watchIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const observer = new MutationObserver((mutations) => {
          const changed = mutations.map((m) => ({
            id,
            type: m.type,
            attr: m.attributeName || '',
            className: String(el.className || ''),
            style: el.getAttribute('style') || '',
          }));
          emitShellDebugConsole('observer:stage-mutation', { changed });
        });
        observer.observe(el, {
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden'],
        });
      });
    } catch (err) {
      console.warn('[GQ][ShellDebug] stage observer failed', String(err?.message || err || 'unknown'));
    }

    try {
      let ticks = 0;
      const timer = window.setInterval(() => {
        ticks += 1;
        emitShellDebugConsole('observer:interval-snapshot', { tick: ticks });
        if (ticks >= 12) {
          window.clearInterval(timer);
        }
      }, 1500);
    } catch (err) {
      console.warn('[GQ][ShellDebug] interval snapshot failed', String(err?.message || err || 'unknown'));
    }
  }

  function setAuthVisible() {
    const gameSection = resolveGameSection();
    const stageSection = document.getElementById('wm-galaxy-section');
    document.body.classList.remove('game-page');
    document.body.classList.add('auth-page');
    if (stageSection) {
      stageSection.classList.add('auth-shell');
      stageSection.classList.remove('game-shell');
    }
    preloadPanelSuppressed = false;
    hidePreloadPanel(true);
    hideLoginConfirmSection();
    authSection?.classList.remove('hidden');
    authSection?.setAttribute('aria-hidden', 'false');
    gameSection?.classList.add('hidden');
    gameSection?.setAttribute('aria-hidden', 'true');
    closeGameplayWindowsForAuthState();
    // Try once UI is visible so prepared auth container can be adapted into a WM window.
    Promise.resolve().then(() => {
      try {
        ensureAuthWindowManaged();
      } catch (err) {
        authLog('warn', 'ensureAuthWindowManaged failed', String(err?.message || err || 'unknown'));
      }
    });
    emitInitDiag('setAuthVisible');
    emitShellDebugConsole('setAuthVisible');
  }

  function ensureSharedGalaxyStageVisible() {
    const ids = ['wm-galaxy-section', 'galaxy-bg-wrapper', 'galaxy-host-wrapper', 'galaxy-3d-host', 'starfield'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('hidden');
      el.removeAttribute('hidden');
      el.style.display = 'block';
      el.style.visibility = 'visible';
      el.style.opacity = '1';
    });
  }

  function ensureGalaxyUiMounted(attempt = 0) {
    const maxAttempts = 8;
    try {
      ensureSharedGalaxyStageVisible();
      const hostWrapper = document.getElementById('galaxy-host-wrapper');
      const host = document.getElementById('galaxy-3d-host');
      const starfield = document.getElementById('starfield');
      const hasNavOrbDom = !!document.getElementById('galaxy-nav-orb-overlay');
      const hasRenderer = !!window.galaxy3d;
      const wm = window.WM;
      const hasGameWindowRegistry = !!(window.GQWindowRegistry && window.GQWindowRegistry.registered);

      if (hostWrapper) {
        hostWrapper.style.display = 'block';
        hostWrapper.style.visibility = 'visible';
        hostWrapper.style.opacity = '1';
      }
      if (host) {
        host.style.display = 'block';
        host.style.visibility = 'visible';
        host.style.opacity = '1';
      }
      if (starfield) {
        starfield.style.display = 'block';
        starfield.style.visibility = 'visible';
        starfield.style.opacity = '1';
      }

      // Only open the WM galaxy window after game.js has registered the proper
      // fullscreen/background config. Otherwise WM falls back to DEFAULTS and
      // creates a normal draggable "Galaxy Map" window.
      if (hasGameWindowRegistry && wm && typeof wm.open === 'function') {
        const isGalaxyOpen = (typeof wm.isOpen === 'function') ? !!wm.isOpen('galaxy') : false;
        if (!isGalaxyOpen) {
          wm.open('galaxy');
        }
        if (!hasRenderer && attempt >= 2 && typeof wm.refresh === 'function') {
          wm.refresh('galaxy');
        }
      }
      if (attempt === 0 || attempt >= maxAttempts || !hasGameWindowRegistry) {
        emitShellDebugConsole('ensureGalaxyUiMounted', {
          attempt,
          hasNavOrbDom,
          navOrbOpen: !!wm?.isOpen?.('nav-orb'),
          hasRenderer,
          hasGameWindowRegistry,
        });
      }
    } catch (err) {
      authLog('warn', 'ensureGalaxyUiMounted failed', String(err?.message || err || 'unknown'));
      emitShellDebugConsole('ensureGalaxyUiMounted:error', {
        attempt,
        error: String(err?.message || err || 'unknown'),
      });
    }

    if (attempt >= maxAttempts) return;
    if (window.GQWindowRegistry && window.GQWindowRegistry.registered) return;
    window.setTimeout(() => ensureGalaxyUiMounted(attempt + 1), 240);
  }

  function setGameVisible() {
    const gameSection = resolveGameSection();
    const stageSection = document.getElementById('wm-galaxy-section');
    document.body.classList.remove('auth-page');
    document.body.classList.add('game-page');
    if (stageSection) {
      stageSection.classList.remove('auth-shell');
      stageSection.classList.add('game-shell');
    }
    ensureSharedGalaxyStageVisible();
    authSection?.classList.add('hidden');
    authSection?.setAttribute('aria-hidden', 'true');
    gameSection?.classList.remove('hidden');
    gameSection?.setAttribute('aria-hidden', 'false');
    try {
      if (window.WM && typeof window.WM.isOpen === 'function' && window.WM.isOpen('auth')) {
        window.WM.close('auth');
      }
    } catch (err) {
      authLog('warn', 'WM close(auth) failed', String(err?.message || err || 'unknown'));
    }

    // Safety net: if the galaxy background/orb was not mounted yet, retry briefly.
    Promise.resolve().then(() => ensureGalaxyUiMounted(0));
    emitInitDiag('setGameVisible');
    emitShellDebugConsole('setGameVisible');
  }

  function hideAuthWindowForBootProgress() {
    authSection?.classList.add('hidden');
    authSection?.setAttribute('aria-hidden', 'true');
    try {
      if (window.WM && typeof window.WM.isOpen === 'function' && window.WM.isOpen('auth')) {
        window.WM.close('auth');
      }
    } catch (err) {
      authLog('warn', 'WM close(auth) during boot progress failed', String(err?.message || err || 'unknown'));
    }
  }

  function queueHomeworldIntroFlight(payload = {}) {
    try {
      window.__GQ_BOOT_HOME_FLIGHT = Object.assign({
        requestedAt: Date.now(),
        enterSystem: true,
        focusPlanet: true,
      }, payload || {});
    } catch (err) {
      authLog('warn', 'queueHomeworldIntroFlight failed', String(err?.message || err || 'unknown'));
    }
  }

  function applyAuthFlightTarget(target) {
    try {
      const bridgeControl = window.GQGalaxyEngineBridge && typeof window.GQGalaxyEngineBridge.getAdapter === 'function'
        ? (window.GQGalaxyEngineBridge.getAdapter('auth-background') || window.GQGalaxyEngineBridge.getAdapter('starfield'))
        : null;
      const control = bridgeControl || window.GQAuthGalaxyBackgroundControl || window.GQStarfieldControl;
      if (control && typeof control.setNavigationTarget === 'function') {
        control.setNavigationTarget(target);
      }
    } catch (err) {
      authLog('warn', 'applyAuthFlightTarget failed', String(err?.message || err || 'unknown'));
    }
  }

  function releaseAuthBackgroundForGame() {
    try {
      const bridgeControl = window.GQGalaxyEngineBridge && typeof window.GQGalaxyEngineBridge.getAdapter === 'function'
        ? (window.GQGalaxyEngineBridge.getAdapter('auth-background') || window.GQGalaxyEngineBridge.getAdapter('starfield'))
        : null;
      const control = bridgeControl || window.GQAuthGalaxyBackgroundControl || window.GQStarfieldControl;
      if (control && typeof control.releaseCanvasForGame === 'function') {
        control.releaseCanvasForGame();
      }
    } catch (err) {
      authLog('warn', 'releaseAuthBackgroundForGame failed', String(err?.message || err || 'unknown'));
    }
  }

  function isTimeoutError(err) {
    const code = String(err?.code || '').toUpperCase();
    const msg = String(err?.message || '').toLowerCase();
    return code === 'ETIMEOUT' || msg.includes('timeout');
  }

  async function fetchWithTimeoutRetry(url, opts = {}) {
    const retries = Math.max(0, Number(opts.retries || 0));
    const retryDelayMs = Math.max(0, Number(opts.retryDelayMs || 300));
    const baseOpts = { ...opts };
    delete baseOpts.retries;
    delete baseOpts.retryDelayMs;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fetchWithTimeout(url, baseOpts);
      } catch (err) {
        const lastAttempt = attempt >= retries;
        const shouldRetry = !lastAttempt && isTimeoutError(err);
        if (!shouldRetry) throw err;
        const tag = String(baseOpts.tag || 'fetch');
        authLog('warn', `${tag} timeout retry ${attempt + 1}/${retries}`);
        await sleep(retryDelayMs);
      }
    }

    throw new Error('fetchWithTimeoutRetry reached unreachable branch');
  }

  async function resolveHomeworldFlightTarget() {
    const now = Date.now();
    if (homeworldTargetCache && (now - homeworldTargetCacheAt) < HOMEWORLD_TARGET_CACHE_TTL_MS) {
      return homeworldTargetCache;
    }
    if (homeworldTargetInflight) {
      return homeworldTargetInflight;
    }

    homeworldTargetInflight = (async () => {
      const overviewRes = await fetchWithTimeoutRetry('api/game.php?action=overview', {
        credentials: 'same-origin',
        timeoutMs: 26000,
        tag: 'overview-home-target',
        cache: 'no-store',
        retries: 1,
        retryDelayMs: 450,
      });
      const overviewData = await parseApiJson(overviewRes, 'overview-home-target');
      const colonies = Array.isArray(overviewData?.colonies) ? overviewData.colonies : [];
      const home = colonies.find((c) => Number(c?.is_homeworld || 0) === 1) || colonies[0] || null;
      if (!home) return null;

      const g = Number(home?.galaxy || 0);
      const s = Number(home?.system || 0);
      if (!Number.isFinite(g) || !Number.isFinite(s) || g <= 0 || s <= 0) return null;

      const starInfoRes = await fetchWithTimeoutRetry(`api/v1/galaxy.php?action=star_info&galaxy=${g}&system=${s}`, {
        credentials: 'same-origin',
        timeoutMs: 16000,
        tag: 'star-info-home-target',
        cache: 'no-store',
        retries: 1,
        retryDelayMs: 350,
      });
      const starInfo = await parseApiJson(starInfoRes, 'star-info-home-target');
      const xy = starInfo?.star?.xy || {};

      const x = Number(xy.x_ly);
      const y = Number(xy.y_ly || 0);
      const z = Number(xy.z_ly);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return null;

      return {
        id: Number(starInfo?.id || s) || s,
        system_index: s,
        galaxy_index: g,
        x_ly: x,
        y_ly: y,
        z_ly: z,
        label: String(home?.name || 'Homeworld'),
        colony_id: Number(home?.id || 0) || 0,
        planet_position: Number(home?.position || 0) || 0,
      };
    })();

    try {
      const target = await homeworldTargetInflight;
      homeworldTargetCache = target;
      homeworldTargetCacheAt = Date.now();
      return target;
    } finally {
      homeworldTargetInflight = null;
    }
  }

  async function ensureAuthWindowManaged() {
    if (!authSection || authSection.classList.contains('hidden')) return;
    if (!window.GQUI) {
      try {
        await loadScript(AUTH_GQUI_SCRIPT);
      } catch (err) {
        if (!authWindowIntegrationAttempted) {
          authLog('warn', 'auth GQUI preload skipped', String(err?.message || err || 'unknown'));
        }
      }
    }
    if (!window.WM) {
      try {
        await loadScript(AUTH_WM_SCRIPT);
        await loadScript(AUTH_WM_WIDGETS_SCRIPT);
        await loadScript(AUTH_GQWM_SCRIPT);
      } catch (err) {
        if (!authWindowIntegrationAttempted) {
          authLog('warn', 'auth WM integration skipped', String(err?.message || err || 'unknown'));
        }
        authWindowIntegrationAttempted = true;
        return;
      }
    }

    if (!window.WM || typeof window.WM.adopt !== 'function') {
      authWindowIntegrationAttempted = true;
      return;
    }

    const desiredW = 440;
    const desiredH = 580;
    const defaultX = Math.max(18, Math.floor((window.innerWidth - desiredW) / 2));
    const defaultY = Math.max(14, Math.floor((window.innerHeight - desiredH) / 2));
    const authWindowCfg = {
      title: 'Commander Login',
      sectionId: 'auth-section',
      prebuiltSelector: '#auth-wrapper',
      adaptExisting: true,
      preserveOnClose: false,
      hideTaskButton: false,
      w: desiredW,
      h: desiredH,
      defaultX,
      defaultY,
    };

    try {
      if (!window.WM.isOpen('auth')) {
        window.WM.adopt('auth', authWindowCfg);
      } else {
        window.WM.open('auth');
      }
      if (typeof window.WM.refresh === 'function') {
        window.WM.refresh('auth');
      }
      authWindowIntegrationAttempted = true;
    } catch (err) {
      if (!authWindowIntegrationAttempted) {
        authLog('warn', 'auth WM adopt failed', String(err?.message || err || 'unknown'));
      }
      authWindowIntegrationAttempted = true;
    }
  }

  function canonicalScriptKey(src) {
    const raw = String(src || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, window.location.href);
      return `${url.origin}${url.pathname}`;
    } catch (_) {
      return raw.split('#')[0].split('?')[0];
    }
  }

  function scriptAlreadyLoaded(src) {
    const key = canonicalScriptKey(src);
    if (!key) return false;
    return Array.from(document.scripts || []).some((script) => {
      const scriptSrc = script.getAttribute('src') || script.src || '';
      return canonicalScriptKey(script.dataset?.gqScriptKey || scriptSrc) === key;
    });
  }

  function ensureSharedAudioManager() {
    if (window.__GQ_AUDIO_MANAGER) return window.__GQ_AUDIO_MANAGER;
    if (!window.GQAudioManager) return null;
    try {
      const manager = new window.GQAudioManager({ storageKey: 'gq_audio_settings' });
      window.__GQ_AUDIO_MANAGER = manager;
      return manager;
    } catch (err) {
      authLog('warn', 'audio manager init failed', String(err?.message || err || 'unknown'));
      return null;
    }
  }

  function installAudioUnlock(manager) {
    if (!manager) return;
    if (window.__GQ_AUDIO_UNLOCK_INSTALLED) return;
    window.__GQ_AUDIO_UNLOCK_INSTALLED = true;

    let unlocked = false;
    let resumeInFlight = false;
    let lastBlockedLogAt = 0;
    let lastAttemptAt = 0;
    const listeners = [];

    const clearListeners = () => {
      listeners.forEach(({ type, handler, opts }) => {
        try {
          window.removeEventListener(type, handler, opts);
        } catch (err) {
          authLog('warn', `audio unlock listener remove failed (${type})`, String(err?.message || err || 'unknown'));
        }
      });
      listeners.length = 0;
    };

    const attemptResume = async () => {
      if (unlocked) return;
      if (resumeInFlight) return;
      const now = Date.now();
      // Multiple DOM events can fire for one user gesture; debounce to avoid log spam.
      if ((now - lastAttemptAt) < 240) return;
      lastAttemptAt = now;
      try {
        resumeInFlight = true;
        const snap = manager.snapshot ? manager.snapshot() : null;
        const muted = !!(snap?.masterMuted || snap?.musicMuted);
        const hasTrack = String(snap?.musicUrl || '').trim() !== '';
        const pausedByUser = !!snap?.musicPaused;
        if (muted || !hasTrack || pausedByUser) return;
        const ok = await manager.playMusic();
        if (ok) {
          unlocked = true;
          clearListeners();
          authLog('info', 'audio resume after user interaction (ok)');
        } else {
          if ((now - lastBlockedLogAt) > 1200) {
            lastBlockedLogAt = now;
            authLog('warn', 'audio resume blocked, waiting for next interaction');
          }
        }
      } catch (err) {
        if ((now - lastBlockedLogAt) > 1200) {
          lastBlockedLogAt = now;
          authLog('warn', 'audio resume failed', String(err?.message || err || 'unknown'));
        }
      } finally {
        resumeInFlight = false;
      }
    };

    const bind = (type, opts) => {
      window.addEventListener(type, attemptResume, opts);
      listeners.push({ type, handler: attemptResume, opts });
    };

    bind('pointerdown', { passive: true });
    bind('click', { passive: true });
    bind('touchstart', { passive: true });
    bind('keydown', false);
  }

  function warmAudioAssets() {
    // Disabled: preload link hints produced noisy browser warnings and no measurable gain.
  }

  function pickRandomItem(list) {
    const items = Array.isArray(list) ? list : [];
    if (!items.length) return null;
    const idx = Math.floor(Math.random() * items.length);
    return items[idx] || null;
  }

  function pickRandomItemAvoiding(list, avoidedValue) {
    const items = Array.isArray(list) ? list : [];
    if (!items.length) return null;
    const avoid = String(avoidedValue || '').trim();
    if (!avoid) return pickRandomItem(items);
    const filtered = items.filter((item) => String(item || '').trim() !== avoid);
    if (!filtered.length) return pickRandomItem(items);
    return pickRandomItem(filtered);
  }

  async function pickRandomTitleTrack() {
    const fallback = String(AUTH_AUDIO_PRELOAD.find((entry) => String(entry || '').trim().startsWith('music/')) || 'music/Nebula_Overture.mp3').trim();
    let previous = '';
    try {
      previous = String(localStorage.getItem(AUTH_LAST_TITLE_TRACK_KEY) || '').trim();
    } catch (err) {
      authLog('warn', 'read last title track failed', String(err?.message || err || 'unknown'));
    }

    try {
      const res = await fetch('api/audio.php?action=list', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) {
        return pickRandomItemAvoiding([fallback], previous) || fallback;
      }
      const data = await res.json();
      const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
      const urls = tracks
        .map((entry) => String(entry?.value || '').trim())
        .filter((value) => value.startsWith('music/'));
      const selected = pickRandomItemAvoiding(urls, previous);
      const chosen = selected || fallback;
      try {
        localStorage.setItem(AUTH_LAST_TITLE_TRACK_KEY, chosen);
      } catch (err) {
        authLog('warn', 'persist last title track failed', String(err?.message || err || 'unknown'));
      }
      return chosen;
    } catch (err) {
      authLog('warn', 'audio list fetch failed, using fallback track', String(err?.message || err || 'unknown'));
      const selected = pickRandomItemAvoiding([fallback], previous) || fallback;
      try {
        localStorage.setItem(AUTH_LAST_TITLE_TRACK_KEY, selected);
      } catch (persistErr) {
        authLog('warn', 'persist fallback title track failed', String(persistErr?.message || persistErr || 'unknown'));
      }
      return selected;
    }
  }

  async function primeAuthAudio() {
    warmAudioAssets();
    try {
      await loadScript(AUTH_AUDIO_SCRIPT);
    } catch (err) {
      authLog('warn', 'audio lazy load failed', String(err?.message || err || 'unknown'));
      authProbe('audio lazy load failed', 'warn');
      return null;
    }

    const manager = ensureSharedAudioManager();
    if (!manager) return null;

    try {
      const randomTitleTrack = await pickRandomTitleTrack();
      // Keep autoplay restrictions intact; we only prime tracks and state.
      manager.setScene('ui', { autoplay: false, force: true, minHoldMs: 0 });
      if (typeof manager.setSceneTrack === 'function') {
        manager.setSceneTrack('ui', randomTitleTrack);
      }
      manager.setMusicTrack(randomTitleTrack, false);
      installAudioUnlock(manager);
      authLog('info', 'audio primed (lazy), random title track selected', randomTitleTrack);
      authProbe(`audio primed (lazy), random title track: ${randomTitleTrack}`);
    } catch (err) {
      authLog('warn', 'audio priming failed', String(err?.message || err || 'unknown'));
    }

    return manager;
  }

  function traceModule(state, src, detail = '') {
    const verboseTrace = isShellDebugEnabled();
    if (!verboseTrace) {
      return;
    }
    const mod = String(src || '').split('?')[0].split('/').pop() || String(src || 'unknown');
    const msg = state === 'done'
      ? `Init <${mod}> done.`
      : state === 'error'
        ? `Init <${mod}> failed.`
        : `Init <${mod}> ...`;
    const payload = detail ? `${msg} ${detail}` : msg;
    if (window.GQLog && typeof window.GQLog[state === 'error' ? 'error' : 'info'] === 'function') {
      window.GQLog[state === 'error' ? 'error' : 'info'](`[module] ${payload}`);
      return;
    }
    if (window.__GQ_BOOT_PROBE?.log) {
      window.__GQ_BOOT_PROBE.log(payload, state === 'error' ? 'error' : 'info');
    }
  }

  function loadScript(src) {
    const rawSrc = String(src || '').trim();
    const key = canonicalScriptKey(rawSrc);
    if (!rawSrc || !key) return Promise.reject(new Error('script src missing'));

    if (scriptLoadPromises.has(key)) {
      return scriptLoadPromises.get(key);
    }

    const job = new Promise((resolve, reject) => {
      if (scriptAlreadyLoaded(rawSrc)) {
        traceModule('done', rawSrc, '(cached)');
        resolve();
        return;
      }
      traceModule('init', rawSrc);
      const s = document.createElement('script');
      s.src = rawSrc;
      s.dataset.gqScriptKey = key;
      s.async = false;
      s.onload = () => {
        traceModule('done', rawSrc);
        resolve();
      };
      s.onerror = () => {
        const e = new Error(`script load failed: ${rawSrc}`);
        traceModule('error', rawSrc, '(onerror)');
        if (window.__GQ_BOOT_DIAG?.report) {
          window.__GQ_BOOT_DIAG.report('script-load', e.message, rawSrc);
        }
        reject(e);
      };
      document.body.appendChild(s);
    });

    const tracked = job.finally(() => {
      scriptLoadPromises.delete(key);
    });
    scriptLoadPromises.set(key, tracked);
    return tracked;
  }

  function supportsGzipDecompressionStream() {
    return typeof DecompressionStream !== 'undefined';
  }

  function getPackageCacheStrategy() {
    // In dev/test environments, use no-store for fresh content.
    // In production (when located at a CDN/minified URL pattern), use versioned caching.
    const isDev = (
      window.location.hostname === 'localhost'
      || window.location.hostname === '127.0.0.1'
      || window.location.hostname.includes('127.0.0.1')
      || window.location.hostname.includes('dev.')
    );
    return isDev ? 'no-store' : 'default';
  }

  async function loadGzipPackage(src) {
    const key = String(src || '').trim();
    if (!key) return Promise.reject(new Error('package src missing'));

    if (packageLoadPromises.has(key)) {
      return packageLoadPromises.get(key);
    }

    const job = (async () => {
      traceModule('init', key);
      if (!supportsGzipDecompressionStream()) {
        throw new Error('DecompressionStream(gzip) is not available in this browser');
      }

      const cacheStrategy = getPackageCacheStrategy();

      // Pro-active availability check: HEAD request to verify bundle exists before full download
      try {
        const headCheck = await fetch(key, { method: 'HEAD', cache: cacheStrategy, credentials: 'same-origin' });
        if (!headCheck.ok) {
          throw new Error(`bundle not available on server (status ${headCheck.status || 0})`);
        }
      } catch (headErr) {
        throw new Error(`package availability check failed: ${key} (${String(headErr?.message || headErr || 'unknown')})`);
      }

      const response = await fetch(key, { cache: cacheStrategy, credentials: 'same-origin' });
      if (!response.ok || !response.body) {
        throw new Error(`package fetch failed: ${key} (status ${response.status || 0})`);
      }

      const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
      const code = await new Response(decompressed).text();
      if (!String(code || '').trim()) {
        throw new Error(`package payload is empty: ${key}`);
      }

      const inline = document.createElement('script');
      inline.type = 'text/javascript';
      inline.setAttribute('data-gq-package', key);
      inline.text = `${code}\n//# sourceURL=${key}`;
      document.body.appendChild(inline);
      traceModule('done', key);
    })();

    const tracked = job.catch((err) => {
      traceModule('error', key, `(${String(err?.message || err || 'unknown')})`);
      if (window.__GQ_BOOT_DIAG?.report) {
        window.__GQ_BOOT_DIAG.report('package-load', String(err?.message || err || 'unknown'), key);
      }
      throw err;
    }).finally(() => {
      packageLoadPromises.delete(key);
    });

    packageLoadPromises.set(key, tracked);
    return tracked;
  }

  function loadBootAsset(src) {
    const key = String(src || '').trim();
    if (/\.js\.gz(?:\?|$)/i.test(key)) {
      return loadGzipPackage(key);
    }
    return loadScript(key);
  }

  async function preloadAssets() {
    const assets = Array.isArray(window.__GQ_BOOT?.preloadAssets) ? window.__GQ_BOOT.preloadAssets : [];
    authLog('info', `preload assets: ${assets.length}`);
    if (!assets.length) {
      setPhase('Ready', 100);
      return;
    }
    setPhase('Preloading assets...', 8);
    const total = assets.length;
    let done = 0;
    await Promise.all(assets.map(async (url) => {
      try {
        await fetch(url, { cache: 'force-cache', credentials: 'same-origin' });
      } catch (err) {
        authLog('warn', 'asset prefetch failed', `${String(url || '')} | ${String(err?.message || err || 'unknown')}`);
        // Keep shell resilient if prefetch fails.
      } finally {
        done += 1;
        setPhase('Preloading assets...', 8 + (done / total) * 42);
      }
    }));
  }

  async function preloadAssetsForAuthenticatedBoot() {
    setPhase('Preloading assets...', 8);
    await preloadAssets();
  }

  function isOptionalBootScript(src) {
    const raw = String(src || '').toLowerCase();
    return raw.includes('js/tests/')
      || raw.includes('js/vendor/dexie.min.js')
      || raw.includes('js/vendor/three.min.js')
      || raw.includes('js/vendor/mustache.min.js')
      || raw.includes('cdn.jsdelivr.net/npm/dexie')
      || raw.includes('cdn.jsdelivr.net/npm/three')
      || raw.includes('cdn.jsdelivr.net/npm/mustache');
  }

  async function bootGameRuntime() {
    if (gameBootPromise) return gameBootPromise;
    gameBootPromise = (async () => {
      const packageBundles = Array.isArray(window.__GQ_BOOT?.packageBundles)
        ? window.__GQ_BOOT.packageBundles.filter((v) => String(v || '').trim() !== '')
        : [];
      const scripts = Array.isArray(window.__GQ_BOOT?.gameScripts) ? window.__GQ_BOOT.gameScripts : [];
      authLog('info', `boot runtime scripts: ${scripts.length}, packages: ${packageBundles.length}`);
      if (!scripts.length) throw new Error('No game scripts configured.');

      if (packageBundles.length) {
        setPhase('Loading package bundles...', 52);
        let bundlesLoaded = 0;
        let bundlesFailed = 0;
        
        for (let i = 0; i < packageBundles.length; i += 1) {
          try {
            await loadBootAsset(packageBundles[i]);
            bundlesLoaded += 1;
          } catch (bundleErr) {
            bundlesFailed += 1;
            authLog('warn', `package bundle failed, will fall back to single scripts if all fail: ${String(packageBundles[i] || 'unknown')}`, String(bundleErr?.message || bundleErr || 'unknown'));
          }
          setPhase('Loading package bundles...', 52 + ((i + 1) / packageBundles.length) * 48);
        }
        
        if (bundlesLoaded > 0) {
          authLog('info', `package bootstrap partial (${bundlesLoaded}/${packageBundles.length} bundles loaded)`);
          authLog('info', 'loading latest single scripts after bundles to override stale package code');
        } else if (bundlesFailed > 0) {
          authLog('warn', `all ${bundlesFailed} package bundles failed, falling back exclusively to single scripts`);
        }
      }

      setPhase('Loading game modules...', 52);
      for (let i = 0; i < scripts.length; i += 1) {
        const scriptSrc = scripts[i];
        try {
          await loadBootAsset(scriptSrc);
        } catch (err) {
          if (!isOptionalBootScript(scriptSrc)) {
            throw err;
          }
          authLog('warn', 'optional boot script failed, continuing', String(scriptSrc || 'unknown script'));
        }
        setPhase('Loading game modules...', 52 + ((i + 1) / scripts.length) * 48);
      }
      setPhase('Boot complete', 100);
    })();
    return gameBootPromise;
  }

  async function startGameShell() {
    if (startGameShellPromise) {
      authLog('warn', 'startGameShell skipped (already in progress)');
      return startGameShellPromise;
    }

    startGameShellPromise = (async () => {
    authLog('info', 'startGameShell begin');
    authProbe('startGameShell begin', 'warn');
    hideActionModal();
    hideAuthWindowForBootProgress();
    preloadPanelSuppressed = false;
    setPhase('Aktive Session erkannt. Lade Kommandostand...', 8);
    showLoginConfirmSection(
      'Login ok',
      'Lade Kommandostand...',
      'Session ok'
    );
    authUiLog('info', 'preload panel enabled for active session flow');
    installShellDebugObservers();
    emitShellDebugConsole('startGameShell:begin');
    if (window.__GQ_RELEASE_AUTH_BG_ON_BOOT !== false) {
      releaseAuthBackgroundForGame();
    }
    emitInitDiag('startGameShell:beforePreloadAssets');
    await preloadAssetsForAuthenticatedBoot();
    emitInitDiag('startGameShell:afterPreloadAssets');
    emitInitDiag('startGameShell:beforeBootRuntime');
    await bootGameRuntime();
    emitInitDiag('startGameShell:afterBootRuntime');
    hidePreloadPanel(true);
    await hideLoginConfirmSection({ animate: true });
    hideActionModal();
    setGameVisible();
    installSessionValidationBreaker();
    emitInitDiag('startGameShell:complete');
    emitShellDebugConsole('startGameShell:complete');
    authLog('info', 'startGameShell complete');
    authProbe('startGameShell complete');
    })();

    try {
      return await startGameShellPromise;
    } finally {
      startGameShellPromise = null;
    }
  }

  async function checkSessionAndBoot() {
    preloadPanelSuppressed = false;
    lastPhaseBucket = -1;
    authUiLog('info', 'checking session state');
    hidePreloadPanel(true);
    try {
      const me = await fetch('api/auth.php?action=me&quiet=1', { credentials: 'same-origin' });
      if (!me.ok) {
        authUiLog('info', 'no valid session detected (HTTP)');
        setAuthVisible();
        hidePreloadPanel(true);
        return false;
      }
      const data = await me.json();
      const hasAuthSuccess = !!data?.success;
      const isAuthenticated = data?.authenticated === true || !!data?.user;
      if (!hasAuthSuccess || !isAuthenticated) {
        authUiLog('info', 'no valid session detected (payload)');
        setAuthVisible();
        hidePreloadPanel(true);
        return false;
      }
      authUiLog('info', 'valid session detected, booting game shell');
      await startGameShell();
      return true;
    } catch (err) {
      authUiLog('error', 'startGameShell failed with error', String(err?.message || err || 'unknown'));
      authLog('error', 'startGameShell stack:', err?.stack || 'no stack');
      authUiLog('warn', 'session check failed, staying on auth screen');
      setAuthVisible();
      hidePreloadPanel(true);
      return false;
    }
  }

  function activateAuthTab(tab) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    // Hide 2FA panel and restore normal forms whenever user switches tabs.
    const panel2fa = document.getElementById('auth-2fa-panel');
    if (panel2fa && !panel2fa.classList.contains('hidden')) {
      panel2fa.classList.add('hidden');
      panel2fa.setAttribute('hidden', 'hidden');
    }

    const setVisible = (el, visible) => {
      if (!el) return;
      el.classList.toggle('hidden', !visible);
      if (visible) {
        el.removeAttribute('hidden');
      } else {
        el.setAttribute('hidden', 'hidden');
      }
    };

    setVisible(loginForm, tab === 'login');
    setVisible(registerForm, tab === 'register');
    setVisible(devTools, tab === 'dev');
  }

  tabs.forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      activateAuthTab(btn.dataset.tab || 'login');
    });
  });

  const initiallyActiveTab = Array.from(tabs).find((btn) => btn.classList.contains('active'))?.dataset.tab || 'login';
  activateAuthTab(initiallyActiveTab);

  const csrfState = {
    token: '',
    fetchedAt: 0,
    inflight: null,
  };

  const authReachabilityState = {
    ok: false,
    checkedAt: 0,
    inflight: null,
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  function isTransientAuthFetchError(err) {
    const code = String(err?.code || '').toUpperCase();
    const status = Number(err?.status || 0);
    const msg = String(err?.message || '').toLowerCase();
    return code === 'ETIMEOUT'
      || code === 'EPARSE'
      || status >= 500
      || /failed to fetch|networkerror|network error|timeout/.test(msg);
  }

  async function ensureAuthApiReachable(options = {}) {
    const force = !!options.force;
    const softFail = options.softFail !== false;
    const now = Date.now();
    const cacheTtlMs = 15000;

    if (!force && authReachabilityState.ok && (now - authReachabilityState.checkedAt) < cacheTtlMs) {
      return true;
    }
    if (!force && authReachabilityState.inflight) {
      return authReachabilityState.inflight;
    }

    const run = async () => {
      const timeouts = [2200, 3500];
      let lastErr = null;

      for (let i = 0; i < timeouts.length; i += 1) {
        try {
          await fetchWithTimeout('api/auth.php?action=me&quiet=1', {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            timeoutMs: timeouts[i],
            tag: `auth-health#${i + 1}`,
          });
          authReachabilityState.ok = true;
          authReachabilityState.checkedAt = Date.now();
          return true;
        } catch (err) {
          lastErr = err;
          if (!isTransientAuthFetchError(err) || i === (timeouts.length - 1)) {
            break;
          }
          await sleep(300 * (i + 1));
        }
      }

      authReachabilityState.ok = false;
      const code = String(lastErr?.code || '').toUpperCase();
      const msg = String(lastErr?.message || '').toLowerCase();
      const status = Number(lastErr?.status || 0);
      const isNetwork = code === 'ETIMEOUT'
        || status === 0
        || /failed to fetch|networkerror|network error|timeout/.test(msg);
      if (!isNetwork) {
        return true;
      }
      if (softFail) {
        authLog('warn', 'auth api health soft-fail', String(lastErr?.message || lastErr || 'unreachable'));
        return false;
      }
      const reachabilityErr = new Error('auth api unreachable');
      reachabilityErr.code = 'EUNREACH';
      reachabilityErr.status = 0;
      reachabilityErr.endpoint = 'api/auth.php?action=me';
      reachabilityErr.cause = lastErr;
      throw reachabilityErr;
    };

    authReachabilityState.inflight = run();
    try {
      return await authReachabilityState.inflight;
    } finally {
      authReachabilityState.inflight = null;
    }
  }

  async function getCsrf(options = {}) {
    const force = !!options.force;
    const now = Date.now();
    const cacheTtlMs = 5 * 60 * 1000;

    if (!force && csrfState.token && (now - csrfState.fetchedAt) < cacheTtlMs) {
      return csrfState.token;
    }
    if (!force && csrfState.inflight) {
      return csrfState.inflight;
    }

    const run = async () => {
      const attempts = [2800, 5200, 7800];
      let lastErr = null;
      for (let i = 0; i < attempts.length; i += 1) {
        try {
          const r = await fetchWithTimeout('api/auth.php?action=csrf', {
            credentials: 'same-origin',
            timeoutMs: attempts[i],
            tag: `csrf#${i + 1}`,
          });
          const d = await parseApiJson(r, 'csrf');
          if (!d || !d.token) {
            const missing = new Error('csrf token missing');
            missing.code = 'ECSRF';
            throw missing;
          }
          csrfState.token = String(d.token);
          csrfState.fetchedAt = Date.now();
          return csrfState.token;
        } catch (err) {
          lastErr = err;
          if (!isTransientAuthFetchError(err) || i === (attempts.length - 1)) {
            throw err;
          }
          await sleep(350 * (i + 1));
        }
      }
      throw lastErr || new Error('csrf token fetch failed');
    };

    csrfState.inflight = run();
    try {
      return await csrfState.inflight;
    } finally {
      csrfState.inflight = null;
    }
  }

  async function parseApiJson(response, tag = 'request') {
    const endpoint = String(response?.url || tag || 'request');
    let data = null;
    let raw = '';

    try {
      raw = await response.text();
      data = raw ? JSON.parse(raw) : null;
    } catch (err) {
      const parseErr = new Error(`invalid server response (${tag})`);
      parseErr.code = 'EPARSE';
      parseErr.endpoint = endpoint;
      parseErr.status = Number(response?.status || 0);
      parseErr.statusText = String(response?.statusText || '');
      parseErr.rawPreview = String(raw || '').slice(0, 240);
      parseErr.cause = err;
      throw parseErr;
    }

    if (!response.ok) {
      const status = Number(response.status || 0);
      const statusText = String(response.statusText || '').trim();
      const msg = String(data?.error || data?.message || `HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
      const httpErr = new Error(msg);
      httpErr.code = status === 401 || status === 403 ? 'EAUTH' : 'EHTTP';
      httpErr.status = status;
      httpErr.statusText = statusText;
      httpErr.endpoint = endpoint;
      httpErr.payload = data;
      throw httpErr;
    }

    return data || {};
  }

  function userFacingAuthError(err) {
    const code = String(err?.code || '').toUpperCase();
    const status = Number(err?.status || 0);
    const msg = String(err?.message || '').trim();
    const msgLower = msg.toLowerCase();

    if (code === 'EUNREACH') {
      return 'Server derzeit nicht erreichbar. Bitte Verbindung pruefen und erneut versuchen.';
    }
    if (code === 'ETIMEOUT') {
      return 'Zeitueberschreitung beim Server. Bitte erneut versuchen.';
    }
    if (status === 429 || /too many failed login attempts/.test(msgLower)) {
      return msg || 'Zu viele fehlgeschlagene Anmeldeversuche. Bitte spaeter erneut versuchen.';
    }
    if (code === 'EAUTH' || status === 401 || status === 403) {
      if (/invalid username or password/.test(msgLower)) {
        return 'Anmeldung fehlgeschlagen. Bitte Benutzername oder E-Mail und Passwort pruefen.';
      }
      if (/username\/email and password required/.test(msgLower) || /username and password required/.test(msgLower)) {
        return 'Bitte Benutzername oder E-Mail sowie Passwort eingeben.';
      }
      if (/csrf/.test(msgLower)) {
        return 'Sitzung abgelaufen. Bitte erneut versuchen.';
      }
      return msg || 'Anmeldung fehlgeschlagen. Bitte Zugangsdaten pruefen.';
    }
    if (code === 'EPARSE') {
      return 'Serverantwort war ungueltig. Bitte spaeter erneut versuchen.';
    }
    if (code === 'EHTTP' && status > 0) {
      return msg || `Serverfehler (HTTP ${status}).`;
    }
    if (msg) {
      if (/failed to fetch|networkerror|network error/i.test(msg)) {
        return 'Netzwerkfehler. Bitte Verbindung pruefen und erneut versuchen.';
      }
      return msg;
    }
    return 'Netzwerkfehler. Bitte erneut versuchen.';
  }

  function formatAuthErrorDebug(err) {
    const code = String(err?.code || '').trim();
    const status = Number(err?.status || 0);
    const endpoint = String(err?.endpoint || '').trim();
    const statusText = String(err?.statusText || '').trim();
    const rawPreview = String(err?.rawPreview || '').trim();

    const parts = [];
    if (code) parts.push(`code=${code}`);
    if (status > 0) parts.push(`http=${status}${statusText ? ` ${statusText}` : ''}`);
    if (endpoint) parts.push(`endpoint=${endpoint}`);
    if (rawPreview) parts.push(`preview=${rawPreview.slice(0, 120)}`);
    return parts.join(' | ');
  }

  function setAuthError(targetEl, err, fallbackMessage = '') {
    if (!targetEl) return;
    const base = fallbackMessage || userFacingAuthError(err);
    if (!authDebugDetails) {
      targetEl.textContent = base;
      return;
    }
    const detail = formatAuthErrorDebug(err);
    targetEl.textContent = detail ? `${base} (${detail})` : base;
  }

  async function fetchWithTimeout(url, opts = {}) {
    const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 12000));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(`timeout after ${timeoutMs}ms`);
    }, timeoutMs);

    try {
      const res = await fetch(url, {
        ...opts,
        signal: controller.signal,
      });
      return res;
    } catch (err) {
      const tag = String(opts.tag || 'fetch');
      const isHealthProbe = /^auth-health#\d+$/i.test(tag);
      const isCsrfProbe = /^csrf#\d+$/i.test(tag);
      const isSessionValidationProbe = /^session-validation-(breaker|periodic)$/i.test(tag);
      const logLevel = (isHealthProbe || isCsrfProbe || isSessionValidationProbe) ? 'warn' : 'error';
      let wrapped = err;
      if (controller.signal.aborted) {
        wrapped = new Error(`request timeout after ${timeoutMs}ms`);
        wrapped.code = 'ETIMEOUT';
        wrapped.endpoint = String(url || tag);
        wrapped.cause = err;
      }
      const reason = String(wrapped?.message || wrapped || 'request failed');
      authLog(logLevel, `${tag} failed`, reason);
      authProbe(`${tag} failed: ${reason}`, logLevel);
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadDevToolsStatus() {
    try {
      const r = await fetch('api/auth.php?action=dev_tools_status');
      const d = await r.json();
      if (d.success && d.enabled) {
        devTabButton?.classList.remove('hidden');
        authDebugDetails = true;
      }
    } catch (err) {
      authLog('info', 'dev tools status unavailable', String(err?.message || err || 'unknown'));
      // Keep hidden on errors.
    }
  }

  devResetBtn?.addEventListener('click', async () => {
    devResetResult.textContent = '';
    const username = devResetUser.value.trim();
    const password = devResetPass.value;
    if (!username || password.length < 8) {
      devResetResult.textContent = 'Username and password (min 8 chars) required.';
      return;
    }
    devResetBtn.disabled = true;
    devResetBtn.textContent = 'Resetting...';
    try {
      const csrf = await getCsrf();
      const res = await fetch('api/auth.php?action=dev_reset_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ username, password }),
      });
      const data = await parseApiJson(res, 'dev_reset_password');
      if (data.success) {
        devResetResult.style.color = '#86efac';
        devResetResult.textContent = data.message || 'Password reset complete.';
      } else {
        devResetResult.style.color = '';
        devResetResult.textContent = data.error || 'Reset failed.';
      }
    } catch (err) {
      devResetResult.style.color = '';
      setAuthError(devResetResult, err, userFacingAuthError(err));
    } finally {
      devResetBtn.disabled = false;
      devResetBtn.textContent = 'Reset Password (Dev)';
    }
  });

  if (!loginForm) {
    authLog('error', 'login-form missing; submit handler not bound');
    authProbe('login-form missing; submit handler not bound', 'error');
  }
  bindEnterSubmit(loginForm);

  // Fire-and-forget: make music player and action SFX available during auth shell.
  primeAuthAudio();

  loginForm?.addEventListener('submit', async (e) => {
    if (loginSubmitInFlight) {
      authLog('warn', 'login submit ignored', 'request already in flight');
      e.preventDefault();
      return;
    }

    loginSubmitInFlight = true;
    authReady.lastLoginSubmitAt = Date.now();
    authProbe('login submit handler entered', 'warn');
    authLog('info', 'login submit fired');
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    if (errEl) {
      errEl.className = 'form-error';
      errEl.textContent = '';
    } else {
      authLog('warn', 'login-error element missing');
    }
    const btn = loginForm.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Launching...';
    }
    showActionModal('Signing in...', 'Session and permissions are being verified.', true);

    try {
      const usernameEl = document.getElementById('login-username');
      const passwordEl = document.getElementById('login-password');
      const rememberEl = document.getElementById('login-remember');
      if (!usernameEl || !passwordEl || !rememberEl) {
        throw new Error('Login form elements missing in DOM');
      }

      const loginPayload = {
        username: usernameEl.value.trim(),
        password: passwordEl.value,
        remember: rememberEl.checked,
      };

      try {
        const reachable = await ensureAuthApiReachable({ softFail: true });
        if (reachable === false) {
          authLog('warn', 'health check skip', 'continuing login without preflight reachability confirmation');
        }
      } catch (reachErr) {
        if (String(reachErr?.code || '').toUpperCase() !== 'EUNREACH') throw reachErr;
        authLog('warn', 'health check skip', 'proceeding with login attempt despite reachability failure');
      }

      const submitLogin = async (forceCsrfRefresh = false) => {
        const csrf = await getCsrf({ force: forceCsrfRefresh });
        const res = await fetchWithTimeout('api/auth.php?action=login', {
          method: 'POST',
          credentials: 'same-origin',
          timeoutMs: 22000,
          tag: forceCsrfRefresh ? 'login#retry' : 'login',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify(loginPayload),
        });
        return parseApiJson(res, forceCsrfRefresh ? 'login#retry' : 'login');
      };

      let data;
      try {
        data = await submitLogin(false);
      } catch (err) {
        const status = Number(err?.status || 0);
        const msg = String(err?.message || '').toLowerCase();
        const isCsrfMismatch = status === 403 && /csrf/.test(msg);
        if (!isCsrfMismatch) throw err;
        data = await submitLogin(true);
      }
      authProbe(`login response success=${!!data.success}`);
      authLog('info', `login response success=${!!data.success}`);
      if (data.success) {
        // ── TOTP 2FA challenge ─────────────────────────────────────────────
        if (data.requires_2fa) {
          hideActionModal();
          show2FAChallenge(data.totp_session, loginPayload.remember, errEl);
          return; // btn will be re-enabled by 2FA flow or cancel
        }
        // ── Normal login – proceed to game ────────────────────────────────
        const homeTargetTask = resolveHomeworldFlightTarget().catch((targetErr) => {
          authLog('warn', 'homeworld target resolve failed (login)', String(targetErr?.message || targetErr || 'unknown'));
          return null;
        });
        const homeTarget = await Promise.race([
          homeTargetTask,
          sleep(2200).then(() => null),
        ]);
        if (homeTarget) {
          queueHomeworldIntroFlight({ source: 'login', targetStar: homeTarget });
          applyAuthFlightTarget(homeTarget);
          await sleep(700);
        } else {
          authLog('warn', 'homeworld target skipped (login)', 'best-effort budget exceeded');
          queueHomeworldIntroFlight({ source: 'login' });
        }
        await startGameShell();
      } else {
        hideActionModal();
        if (errEl) errEl.textContent = data.error || 'Login failed.';
      }
    } catch (err) {
      const status = Number(err?.status || 0);
      const code = String(err?.code || '').toUpperCase();
      const msg = String(err?.message || '').toLowerCase();
      const isAuthFailure = code === 'EAUTH'
        || status === 401
        || status === 403
        || status === 429
        || /too many failed login attempts|lockout/.test(msg);
      const isReachabilityFailure = code === 'EUNREACH' || code === 'ETIMEOUT';
      if (isAuthFailure) {
        authProbe('login submit auth failure', 'warn');
        authLog('warn', 'login submit auth failure', String(err?.message || err || 'unknown'));
      } else if (isReachabilityFailure) {
        authProbe('login submit reachability failure', 'warn');
        authLog('warn', 'login submit reachability failure', String(err?.message || err || 'unknown'));
      } else {
        authProbe('login submit catch (network/parse)', 'error');
        authLog('error', 'login submit network/parse error', String(err?.message || err || 'unknown'));
      }
      hideActionModal();
      setAuthError(errEl, err, userFacingAuthError(err));
    } finally {
      loginSubmitInFlight = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Enter the Galaxy';
      }
    }
  });
  authReady.loginBound = !!loginForm;
  authProbe(`login handler bound=${authReady.loginBound}`);

  // ── TOTP 2FA challenge helper ──────────────────────────────────────────────
  /**
   * Show the inline 2FA code input box, handle submission and re-enable the
   * login button once the challenge is resolved (success or cancel).
   *
   * @param {string}  totpSession  Half-auth token returned by the login endpoint.
   * @param {boolean} remember     Whether "keep me signed in" was checked.
   * @param {Element} errEl        The login error display element.
   */
  function show2FAChallenge(totpSession, remember, errEl) {
    const loginBtn = loginForm ? loginForm.querySelector('button[type="submit"]') : null;
    const panel = document.getElementById('auth-2fa-panel');
    const codeInput = document.getElementById('auth-2fa-code');
    const submitBtn = document.getElementById('auth-2fa-submit');
    const cancelBtn = document.getElementById('auth-2fa-cancel');
    const panelErr = document.getElementById('auth-2fa-error');

    if (!panel || !codeInput || !submitBtn) {
      // Fallback: prompt() if the DOM panel is missing (should not happen).
      authLog('warn', '2FA panel elements missing; using fallback prompt');
      const code = window.prompt('Authenticator-Code eingeben (6 Ziffern):');
      if (!code || !/^\d{6}$/.test(code.trim())) {
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Enter the Galaxy'; }
        return;
      }
      doTotpChallenge(totpSession, code.trim(), remember, errEl, loginBtn);
      return;
    }

    // Show the panel, focus the input.
    loginForm?.classList.add('hidden');
    panel.classList.remove('hidden');
    if (panelErr) panelErr.textContent = '';
    codeInput.value = '';
    codeInput.focus();

    function cleanup() {
      panel.classList.add('hidden');
      loginForm?.classList.remove('hidden');
      if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Enter the Galaxy'; }
      submitBtn.removeEventListener('click', onSubmit);
      cancelBtn?.removeEventListener('click', onCancel);
      panel.removeEventListener('keydown', onKeydown);
    }

    async function onSubmit() {
      const code = codeInput.value.trim();
      if (!/^\d{6}$/.test(code)) {
        if (panelErr) panelErr.textContent = 'Bitte einen 6-stelligen Code eingeben.';
        codeInput.focus();
        return;
      }
      submitBtn.disabled = true;
      if (panelErr) panelErr.textContent = '';
      await doTotpChallenge(totpSession, code, remember, errEl, loginBtn, cleanup);
      submitBtn.disabled = false;
    }

    function onCancel() {
      authLog('info', '2FA challenge cancelled by user');
      cleanup();
    }

    function onKeydown(ev) {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey) {
        ev.preventDefault();
        onSubmit();
      }
    }

    submitBtn.addEventListener('click', onSubmit);
    cancelBtn?.addEventListener('click', onCancel);
    panel.addEventListener('keydown', onKeydown);
  }

  /**
   * POST the TOTP code + half-auth token to the server and on success
   * boot the game shell; on failure display an error and return.
   */
  async function doTotpChallenge(totpSession, code, remember, errEl, loginBtn, cleanup) {
    showActionModal('Bestätigen...', '2FA-Code wird geprüft.', true);
    try {
      const doChallenge = async (forceCsrf = false) => {
        const csrf = await getCsrf({ force: forceCsrf });
        const res = await fetchWithTimeout('api/auth.php?action=totp_login_challenge', {
          method: 'POST',
          credentials: 'same-origin',
          timeoutMs: 15000,
          tag: 'totp-challenge',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ totp_session: totpSession, code, remember }),
        });
        return parseApiJson(res, 'totp-challenge');
      };

      let data;
      try {
        data = await doChallenge(false);
      } catch (err) {
        const status = Number(err?.status || 0);
        const msg = String(err?.message || '').toLowerCase();
        if (status === 403 && /csrf/.test(msg)) {
          data = await doChallenge(true);
        } else {
          throw err;
        }
      }

      if (data.success) {
        if (cleanup) cleanup();
        const homeTargetTask = resolveHomeworldFlightTarget().catch(() => null);
        const homeTarget = await Promise.race([homeTargetTask, sleep(2200).then(() => null)]);
        if (homeTarget) {
          queueHomeworldIntroFlight({ source: 'login-2fa', targetStar: homeTarget });
          applyAuthFlightTarget(homeTarget);
          await sleep(700);
        } else {
          queueHomeworldIntroFlight({ source: 'login-2fa' });
        }
        await startGameShell();
      } else {
        hideActionModal();
        const panel2faErr = document.getElementById('auth-2fa-error');
        if (panel2faErr) panel2faErr.textContent = data.error || 'Ungültiger Code.';
        else if (errEl) errEl.textContent = data.error || 'Ungültiger Code.';
      }
    } catch (err) {
      hideActionModal();
      const panel2faErr = document.getElementById('auth-2fa-error');
      const msg = userFacingAuthError(err);
      if (panel2faErr) panel2faErr.textContent = msg;
      else if (errEl) errEl.textContent = msg;
      authLog('error', 'totp challenge error', String(err?.message || err || 'unknown'));
    }
  }

  if (!registerForm) {
    authLog('error', 'register-form missing; submit handler not bound');
    authProbe('register-form missing; submit handler not bound', 'error');
  }
  bindEnterSubmit(registerForm);
  registerForm?.addEventListener('submit', async (e) => {
    authReady.lastRegisterSubmitAt = Date.now();
    authProbe('register submit handler entered', 'warn');
    authLog('info', 'register submit fired');
    e.preventDefault();
    const errEl = document.getElementById('register-error');
    if (errEl) {
      errEl.textContent = '';
    } else {
      authLog('warn', 'register-error element missing');
    }
    const btn = registerForm.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Creating empire...';
    }
    showActionModal('Creating account...', 'Registering your empire profile.', true);

    try {
      const regUserEl = document.getElementById('reg-username');
      const regEmailEl = document.getElementById('reg-email');
      const regPassEl = document.getElementById('reg-password');
      const regRememberEl = document.getElementById('reg-remember');
      if (!regUserEl || !regEmailEl || !regPassEl || !regRememberEl) {
        throw new Error('Register form elements missing in DOM');
      }

      const registerPayload = {
        username: regUserEl.value.trim(),
        email: regEmailEl.value.trim(),
        password: regPassEl.value,
        remember: regRememberEl.checked,
      };

      const submitRegister = async (forceCsrfRefresh = false) => {
        const csrf = await getCsrf({ force: forceCsrfRefresh });
        const res = await fetchWithTimeout('api/auth.php?action=register', {
          method: 'POST',
          credentials: 'same-origin',
          timeoutMs: 22000,
          tag: forceCsrfRefresh ? 'register#retry' : 'register',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify(registerPayload),
        });
        return parseApiJson(res, forceCsrfRefresh ? 'register#retry' : 'register');
      };

      let data;
      try {
        data = await submitRegister(false);
      } catch (err) {
        const status = Number(err?.status || 0);
        const msg = String(err?.message || '').toLowerCase();
        const isCsrfMismatch = status === 403 && /csrf/.test(msg);
        if (!isCsrfMismatch) throw err;
        data = await submitRegister(true);
      }
      if (data.success) {
        const homeTargetTask = resolveHomeworldFlightTarget().catch((targetErr) => {
          authLog('warn', 'homeworld target resolve failed (register)', String(targetErr?.message || targetErr || 'unknown'));
          return null;
        });
        const homeTarget = await Promise.race([
          homeTargetTask,
          sleep(2200).then(() => null),
        ]);
        if (homeTarget) {
          queueHomeworldIntroFlight({ source: 'register', targetStar: homeTarget });
          applyAuthFlightTarget(homeTarget);
          await sleep(700);
        } else {
          authLog('warn', 'homeworld target skipped (register)', 'best-effort budget exceeded');
          queueHomeworldIntroFlight({ source: 'register' });
        }

        // Show narrative prologue for new registrations; fall back to direct launch
        // when GQProlog is unavailable (e.g. script failed to load).
        if (window.GQProlog && typeof window.GQProlog.show === 'function') {
          hideActionModal();
          authSection?.classList.add('hidden');
          window.GQProlog.show({
            username: String(registerPayload.username || ''),
            colonyName: String(data.colony_name || ''),
            onComplete: async () => { await startGameShell(); },
          });
        } else {
          await startGameShell();
        }
      } else {
        hideActionModal();
        if (errEl) errEl.textContent = data.error || 'Registration failed.';
      }
    } catch (err) {
      hideActionModal();
      setAuthError(errEl, err, userFacingAuthError(err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Launch into the Galaxy';
      }
    }
  });
  authReady.registerBound = !!registerForm;
  authProbe(`register handler bound=${authReady.registerBound}`);

  try {
    setPhase('Pruefe Session...', 8);
    const bootUrl = new URL(window.location.href);
    const skipAutoBootAfterLogout = bootUrl.searchParams.get('logout') === '1';
    if (skipAutoBootAfterLogout) {
      await performLogoutCleanup();
      bootUrl.searchParams.delete('logout');
      if (window.history?.replaceState) {
        window.history.replaceState({}, document.title, bootUrl.pathname + bootUrl.search + bootUrl.hash);
      }
      setAuthVisible();
      setPhase('Signed out. Please sign in again.', 0);
      const loginErr = document.getElementById('login-error');
      if (loginErr) {
        loginErr.className = 'form-success';
        loginErr.textContent = 'Du wurdest erfolgreich abgemeldet. Bitte melde dich erneut an.';
      }
    }

    const hasSession = skipAutoBootAfterLogout ? false : await checkSessionAndBoot();
    if (!hasSession) {
      getCsrf().catch((err) => {
        authLog('warn', 'background csrf warmup failed', String(err?.message || err || 'unknown'));
      });
    }
    loadDevToolsStatus();
    authLog('info', 'bootstrap ready');
  } catch (err) {
    authLog('error', `bootstrap failed: ${String(err?.message || err || 'unknown')}`);
    reportBootFailure('startup', err);
  }
})();
