/**
 * GalaxyQuest Boot Loader
 * Sequentially loads scripts from window.__GQ_BOOT.gameScripts
 * Ensures dependencies are available before auth starfield init.
 */
(async function () {
  const manifest = window.__GQ_BOOT || {};
  const scripts = Array.isArray(manifest.gameScripts) ? manifest.gameScripts : [];

  // Only skip if all scripts were already loaded by index.html (direct <script> tags)
  const alreadyLoadedBoot = window.__GQ_DIRECT_BOOT_COMPLETE || false;
  if (alreadyLoadedBoot) {
    window.__GQ_BOOT_LOADER_READY = true;
    return;
  }

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
        resolve();
      };
      script.onerror = () => {
        const err = new Error(`Script load failed: ${src}`);
        reject(err);
      };
      document.head.appendChild(script);
    });
  }

  async function loadAllScripts() {
    if (scripts.length === 0) {
      return;
    }

    for (let i = 0; i < scripts.length; i += 1) {
      const src = scripts[i];
      try {
        await loadScript(src);
      } catch (err) {
        // Continue loading remaining scripts even if one fails
      }
    }
  }

  // Load game scripts on all pages (both auth and game pages)
  await loadAllScripts();

  window.__GQ_BOOT_LOADER_READY = true;
})();

