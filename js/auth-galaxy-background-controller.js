/*
 * @deprecated 2026-03-29 — Diese Datei ist nicht mehr im aktiven Ladepfad.
 * Wird nicht ueber index.html geladen. Nachfolger: starfield.js.
 * Kann nach Migrationsperiode entfernt werden.
 */
/*
 * Auth Galaxy Background Controller
 * Single-responsibility adapter: reuses Galaxy3DRenderer for login background mode.
 */
(function () {
  const canvas = document.getElementById('starfield');
  const host = document.getElementById('galaxy-3d-host');
  if (!canvas || !host) return;

  const runtime = window.__GQ_AUTH_GALAXY_BG_RUNTIME = Object.assign(
    window.__GQ_AUTH_GALAXY_BG_RUNTIME || {},
    {
      releaseRequested: false,
      released: false,
      renderer: null,
      stars: [],
      destroy: null,
    }
  );

  function bootLog(level, message) {
    const text = String(message || '');
    try {
      if (window.GQLog && typeof window.GQLog[level] === 'function') {
        window.GQLog[level]('[auth-bg]', text);
        return;
      }
    } catch (_) {}
    try {
      if (window.__GQ_BOOT_PROBE?.log) {
        window.__GQ_BOOT_PROBE.log(`[auth-bg] ${text}`, level);
      }
    } catch (_) {}
  }

  const controlApi = {
    releaseCanvasForGame() {
      runtime.releaseRequested = true;
      try {
        if (typeof runtime.destroy === 'function') runtime.destroy();
      } catch (_) {}
      runtime.released = true;
    },
    destroy() {
      this.releaseCanvasForGame();
    },
    isActive() {
      return !!runtime.renderer && !runtime.released;
    },
  };

  window.GQAuthGalaxyBackgroundControl = controlApi;
  // Backward compatibility for existing game bootstrap code.
  window.GQStarfieldControl = Object.assign(window.GQStarfieldControl || {}, controlApi);

  function scriptLoaded(src) {
    return !!document.querySelector(`script[src="${src}"]`);
  }

  function loadScript(src) {
    const key = String(src || '').trim();
    if (!key) return Promise.reject(new Error('missing script src'));
    if (scriptLoaded(key)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = key;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`script load failed: ${key}`));
      document.head.appendChild(s);
    });
  }

  async function ensureRendererDeps() {
    if (!window.THREE) {
      await loadScript('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js');
    }
    if (!window.Galaxy3DRenderer) {
      await loadScript('js/galaxy-renderer-core.js?v=20260329p83');
    }
    if (!window.GQAuthGalaxyAnimationProfile) {
      await loadScript('js/auth-galaxy-animation-profile.js?v=20260329p83');
    }
    if (!window.Galaxy3DRenderer) {
      throw new Error('Galaxy3DRenderer unavailable');
    }
    if (!window.GQAuthGalaxyAnimationProfile) {
      throw new Error('GQAuthGalaxyAnimationProfile unavailable');
    }
  }

  async function start() {
    if (runtime.releaseRequested || document.body.classList.contains('game-page')) return;
    try {
      await ensureRendererDeps();
      if (runtime.releaseRequested || document.body.classList.contains('game-page')) return;

      runtime.stars = window.GQAuthGalaxyAnimationProfile.generateStars(8200, 5600);

      const renderer = new window.Galaxy3DRenderer(host, {
        externalCanvas: canvas,
        interactive: false,
        onHover: null,
        onClick: null,
        onDoubleClick: null,
      });

      runtime.renderer = renderer;

      window.GQAuthGalaxyAnimationProfile.applyRendererProfile(renderer, runtime.stars);

      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '1';

      runtime.destroy = () => {
        if (!runtime.renderer) return;
        try {
          runtime.renderer.destroy();
        } catch (_) {}
        runtime.renderer = null;
        runtime.released = true;
      };

      bootLog('info', 'auth background renderer active (shared Galaxy3DRenderer core)');
    } catch (err) {
      bootLog('warn', `auth background renderer failed: ${String(err?.message || err || 'unknown')}`);
    }
  }

  start();
})();
