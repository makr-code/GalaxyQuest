/**
 * Unified shell bootstrap (index.html).
 * Handles auth section, game section, and progressive runtime loading.
 */
(async function () {
  const AUTH_AUDIO_SCRIPT = 'js/audio.js?v=20260328p53';
  const AUTH_WM_SCRIPT = 'js/wm.js?v=20260328p54';
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

  authLog('info', 'bootstrap start');
  authProbe('bootstrap start');

  const authSection = document.getElementById('auth-section');
  const gameSection = document.getElementById('game-section');
  const tabs = document.querySelectorAll('.tab-btn');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const devTools = document.getElementById('dev-auth-tools');
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
  const loginRemember = document.getElementById('login-remember');
  const regRemember = document.getElementById('reg-remember');

  let gameBootPromise = null;
  const scriptLoadPromises = new Map();
  let authDebugDetails = false;
  let authWindowIntegrationAttempted = false;

  // Keep remember-me enabled by default on the auth shell.
  if (loginRemember) loginRemember.checked = true;
  if (regRemember) regRemember.checked = false;

  try {
    const host = String(window.location?.hostname || '').toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
    const forceFlag = localStorage.getItem('gq_auth_debug') === '1';
    const queryFlag = new URLSearchParams(window.location.search || '').get('authDebug') === '1';
    authDebugDetails = isLocalHost || forceFlag || queryFlag;
  } catch (_) {}

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
    if (preloadLabel) preloadLabel.textContent = String(label || 'Loading...');
    if (preloadMeta) preloadMeta.textContent = `${clamped.toFixed(0)}%`;
    if (preloadBar) preloadBar.style.width = `${clamped}%`;
    preloadPanel?.classList.remove('hidden');
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

  function setAuthVisible() {
    document.body.classList.remove('game-page');
    document.body.classList.add('auth-page');
    authSection?.classList.remove('hidden');
    authSection?.setAttribute('aria-hidden', 'false');
    gameSection?.classList.add('hidden');
    gameSection?.setAttribute('aria-hidden', 'true');
    // Try once UI is visible so prepared auth container can be adapted into a WM window.
    Promise.resolve().then(() => {
      try {
        ensureAuthWindowManaged();
      } catch (_) {}
    });
  }

  function setGameVisible() {
    document.body.classList.remove('auth-page');
    document.body.classList.add('game-page');
    authSection?.classList.add('hidden');
    authSection?.setAttribute('aria-hidden', 'true');
    gameSection?.classList.remove('hidden');
    gameSection?.setAttribute('aria-hidden', 'false');
    try {
      if (window.WM && typeof window.WM.isOpen === 'function' && window.WM.isOpen('auth')) {
        window.WM.close('auth');
      }
    } catch (_) {}
  }

  function queueHomeworldIntroFlight(payload = {}) {
    try {
      window.__GQ_BOOT_HOME_FLIGHT = Object.assign({
        requestedAt: Date.now(),
        enterSystem: true,
        focusPlanet: true,
      }, payload || {});
    } catch (_) {}
  }

  async function ensureAuthWindowManaged() {
    if (!authSection || authSection.classList.contains('hidden')) return;
    if (!window.WM) {
      try {
        await loadScript(AUTH_WM_SCRIPT);
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

    try {
      if (!window.WM.isOpen('auth')) {
        window.WM.adopt('auth', {
          title: 'Commander Login',
          sectionId: 'auth-section',
          prebuiltSelector: '#auth-wrapper',
          adaptExisting: true,
          preserveOnClose: true,
          hideTaskButton: true,
          w: desiredW,
          h: desiredH,
          defaultX,
          defaultY,
        });
      } else if (typeof window.WM.refresh === 'function') {
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

  function scriptAlreadyLoaded(src) {
    return !!document.querySelector(`script[src="${src}"]`);
  }

  function ensureSharedAudioManager() {
    if (window.__GQ_AUDIO_MANAGER) return window.__GQ_AUDIO_MANAGER;
    if (!window.GQAudioManager) return null;
    try {
      const manager = new window.GQAudioManager({ storageKey: 'gq_audio_settings' });
      window.__GQ_AUDIO_MANAGER = manager;
      return manager;
    } catch (_) {
      return null;
    }
  }

  function installAudioUnlock(manager) {
    if (!manager) return;
    if (window.__GQ_AUDIO_UNLOCK_INSTALLED) return;
    window.__GQ_AUDIO_UNLOCK_INSTALLED = true;

    let unlocked = false;
    const listeners = [];

    const clearListeners = () => {
      listeners.forEach(({ type, handler, opts }) => {
        try { window.removeEventListener(type, handler, opts); } catch (_) {}
      });
      listeners.length = 0;
    };

    const attemptResume = async () => {
      if (unlocked) return;
      try {
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
          authLog('warn', 'audio resume blocked, waiting for next interaction');
        }
      } catch (err) {
        authLog('warn', 'audio resume failed', String(err?.message || err || 'unknown'));
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
    if (!Array.isArray(AUTH_AUDIO_PRELOAD) || !AUTH_AUDIO_PRELOAD.length) return;
    AUTH_AUDIO_PRELOAD.forEach((url) => {
      const href = String(url || '').trim();
      if (!href) return;
      try {
        const existing = document.querySelector(`link[rel="preload"][as="audio"][href="${href}"]`);
        if (existing) return;
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'audio';
        link.href = href;
        document.head.appendChild(link);
      } catch (_) {}
    });
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
    } catch (_) {}

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
      } catch (_) {}
      return chosen;
    } catch (_) {
      const selected = pickRandomItemAvoiding([fallback], previous) || fallback;
      try {
        localStorage.setItem(AUTH_LAST_TITLE_TRACK_KEY, selected);
      } catch (_) {}
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
    } catch (_) {}

    return manager;
  }

  function traceModule(state, src, detail = '') {
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
    const key = String(src || '').trim();
    if (!key) return Promise.reject(new Error('script src missing'));

    if (scriptLoadPromises.has(key)) {
      return scriptLoadPromises.get(key);
    }

    const job = new Promise((resolve, reject) => {
      if (scriptAlreadyLoaded(key)) {
        traceModule('done', key, '(cached)');
        resolve();
        return;
      }
      traceModule('init', key);
      const s = document.createElement('script');
      s.src = key;
      s.async = false;
      s.onload = () => {
        traceModule('done', key);
        resolve();
      };
      s.onerror = () => {
        const e = new Error(`script load failed: ${key}`);
        traceModule('error', key, '(onerror)');
        if (window.__GQ_BOOT_DIAG?.report) {
          window.__GQ_BOOT_DIAG.report('script-load', e.message, key);
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
      } catch (_) {
        // Keep shell resilient if prefetch fails.
      } finally {
        done += 1;
        setPhase('Preloading assets...', 8 + (done / total) * 42);
      }
    }));
  }

  async function bootGameRuntime() {
    if (gameBootPromise) return gameBootPromise;
    gameBootPromise = (async () => {
      const scripts = Array.isArray(window.__GQ_BOOT?.gameScripts) ? window.__GQ_BOOT.gameScripts : [];
      authLog('info', `boot runtime scripts: ${scripts.length}`);
      if (!scripts.length) throw new Error('No game scripts configured.');

      setPhase('Loading game modules...', 52);
      for (let i = 0; i < scripts.length; i += 1) {
        await loadScript(scripts[i]);
        setPhase('Loading game modules...', 52 + ((i + 1) / scripts.length) * 48);
      }
      setPhase('Boot complete', 100);
    })();
    return gameBootPromise;
  }

  async function startGameShell() {
    authLog('info', 'startGameShell begin');
    authProbe('startGameShell begin', 'warn');
    showActionModal('Login successful', 'Loading command bridge...', true);
    setGameVisible();
    await bootGameRuntime();
    hideActionModal();
    authLog('info', 'startGameShell complete');
    authProbe('startGameShell complete');
  }

  async function checkSessionAndBoot() {
    setPhase('Checking session...', 2);
    try {
      const me = await fetch('api/auth.php?action=me', { credentials: 'same-origin' });
      if (!me.ok) {
        setAuthVisible();
        setPhase('Please sign in', 0);
        return false;
      }
      const data = await me.json();
      if (!data.success) {
        setAuthVisible();
        setPhase('Please sign in', 0);
        return false;
      }
      await startGameShell();
      return true;
    } catch (_) {
      setAuthVisible();
      setPhase('Please sign in', 0);
      return false;
    }
  }

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      loginForm.classList.toggle('hidden', tab !== 'login');
      registerForm.classList.toggle('hidden', tab !== 'register');
    });
  });

  const csrfState = {
    token: '',
    fetchedAt: 0,
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
      const attempts = [12000, 18000, 26000];
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

    if (code === 'ETIMEOUT') {
      return 'Zeitueberschreitung beim Server. Bitte erneut versuchen.';
    }
    if (code === 'EAUTH' || status === 401 || status === 403) {
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
      let wrapped = err;
      if (controller.signal.aborted) {
        wrapped = new Error(`request timeout after ${timeoutMs}ms`);
        wrapped.code = 'ETIMEOUT';
        wrapped.endpoint = String(url || tag);
        wrapped.cause = err;
      }
      const reason = String(wrapped?.message || wrapped || 'request failed');
      authLog('error', `${tag} failed`, reason);
      authProbe(`${tag} failed: ${reason}`, 'error');
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
        devTools.classList.remove('hidden');
        authDebugDetails = true;
      }
    } catch (_) {
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
    authReady.lastLoginSubmitAt = Date.now();
    authProbe('login submit handler entered', 'warn');
    authLog('info', 'login submit fired');
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    const btn = loginForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Launching...';
    showActionModal('Signing in...', 'Session and permissions are being verified.', true);

    try {
      const loginPayload = {
        username: document.getElementById('login-username').value.trim(),
        password: document.getElementById('login-password').value,
        remember: document.getElementById('login-remember').checked,
      };

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
        queueHomeworldIntroFlight({ source: 'login' });
        showActionModal('Login successful', 'Preparing your command center...', true);
        await startGameShell();
      } else {
        hideActionModal();
        errEl.textContent = data.error || 'Login failed.';
      }
    } catch (err) {
      authProbe('login submit catch (network/parse)', 'error');
      authLog('error', 'login submit network/parse error', String(err?.message || err || 'unknown'));
      hideActionModal();
      setAuthError(errEl, err, userFacingAuthError(err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enter the Galaxy';
    }
  });
  authReady.loginBound = !!loginForm;
  authProbe(`login handler bound=${authReady.loginBound}`);

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
    errEl.textContent = '';
    const btn = registerForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Creating empire...';
    showActionModal('Creating account...', 'Registering your empire profile.', true);

    try {
      const registerPayload = {
        username: document.getElementById('reg-username').value.trim(),
        email: document.getElementById('reg-email').value.trim(),
        password: document.getElementById('reg-password').value,
        remember: document.getElementById('reg-remember').checked,
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
        queueHomeworldIntroFlight({ source: 'register' });
        showActionModal('Registration successful', 'Setting up your command center...', true);
        await startGameShell();
      } else {
        hideActionModal();
        errEl.textContent = data.error || 'Registration failed.';
      }
    } catch (err) {
      hideActionModal();
      setAuthError(errEl, err, userFacingAuthError(err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Launch into the Galaxy';
    }
  });
  authReady.registerBound = !!registerForm;
  authProbe(`register handler bound=${authReady.registerBound}`);

  try {
    await preloadAssets();
    const bootUrl = new URL(window.location.href);
    const skipAutoBootAfterLogout = bootUrl.searchParams.get('logout') === '1';
    if (skipAutoBootAfterLogout) {
      bootUrl.searchParams.delete('logout');
      if (window.history?.replaceState) {
        window.history.replaceState({}, document.title, bootUrl.pathname + bootUrl.search + bootUrl.hash);
      }
      setAuthVisible();
      setPhase('Signed out. Please sign in again.', 0);
    }

    const hasSession = skipAutoBootAfterLogout ? false : await checkSessionAndBoot();
    if (!hasSession) {
      getCsrf().catch(() => {});
    }
    loadDevToolsStatus();
    authLog('info', 'bootstrap ready');
  } catch (err) {
    authLog('error', `bootstrap failed: ${String(err?.message || err || 'unknown')}`);
    reportBootFailure('startup', err);
  }
})();
