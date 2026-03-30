/**
 * GalaxyQuest Boot Loader
 * Sequentially loads scripts from window.__GQ_BOOT.gameScripts
 * Ensures dependencies are available before auth starfield init.
 */
(async function () {
  const manifest = window.__GQ_BOOT || {};
  const scripts = Array.isArray(manifest.gameScripts) ? manifest.gameScripts : [];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (!src || typeof src !== 'string') {
        return reject(new Error('Invalid script src'));
      }

      // Check if already loaded
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        return resolve(); // Already loaded
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = false; // Load sequentially
      script.onload = () => {
        if (window.GQLog && typeof window.GQLog.debug === 'function') {
          window.GQLog.debug(`[boot-loader] Loaded: ${src.split('/').pop()}`);
        }
        resolve();
      };
      script.onerror = () => {
        const err = new Error(`Script load failed: ${src}`);
        if (window.GQLog && typeof window.GQLog.error === 'function') {
          window.GQLog.error(`[boot-loader] ${err.message}`);
        }
        reject(err);
      };
      document.head.appendChild(script);
    });
  }

  async function loadAllScripts() {
    if (scripts.length === 0) {
      if (window.GQLog && typeof window.GQLog.warn === 'function') {
        window.GQLog.warn('[boot-loader] No gameScripts found in __GQ_BOOT');
      }
      return;
    }

    if (window.GQLog && typeof window.GQLog.info === 'function') {
      window.GQLog.info(`[boot-loader] Starting sequential load of ${scripts.length} scripts`);
    }

    for (let i = 0; i < scripts.length; i += 1) {
      const src = scripts[i];
      try {
        await loadScript(src);
      } catch (err) {
        if (window.GQLog && typeof window.GQLog.error === 'function') {
          window.GQLog.error(`[boot-loader] Script ${i}/${scripts.length} failed: ${src}`, err.message);
        }
        // Continue loading remaining scripts even if one fails
      }
    }

    if (window.GQLog && typeof window.GQLog.info === 'function') {
      window.GQLog.info('[boot-loader] All gameScripts loaded');
    }
  }

  // Only load if we're on auth page and not game page
  if (!document.body.classList.contains('game-page')) {
    await loadAllScripts();
  }

  window.__GQ_BOOT_LOADER_READY = true;
})();
