/**
 * RuntimePostBootFlow.js
 *
 * Executes post-startup boot tasks after core runtime init.
 */

'use strict';

(function () {
  async function runPostBootFlow(opts = {}) {
    const {
      wm = null,
      settingsState = {},
      focusHomeSystemInGalaxy = async () => {},
      loadOverview = async () => {},
      loadBadge = async () => {},
      initSystemBreadcrumb = () => {},
      advisorWidget = null,
      gameLog = () => {},
      windowRef = (typeof window !== 'undefined' ? window : null),
    } = opts;

    advisorWidget?.register?.();
    advisorWidget?.load?.().catch((err) => {
      gameLog('info', 'AdvisorWidget Load fehlgeschlagen', err);
    });

    initSystemBreadcrumb();

    await loadOverview();

    try {
      const bootHomeFlight = windowRef?.__GQ_BOOT_HOME_FLIGHT;
      if (bootHomeFlight) {
        const root = wm?.body?.('galaxy');
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
    } catch (err) {
      gameLog('info', 'Intro camera flight bootstrap fehlgeschlagen (non-blocking)', err);
    } finally {
      try {
        if (windowRef) windowRef.__GQ_BOOT_HOME_FLIGHT = null;
      } catch (err) {
        gameLog('info', 'Konnte __GQ_BOOT_HOME_FLIGHT nicht zuruecksetzen', err);
      }
    }

    await loadBadge();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runPostBootFlow };
  } else {
    window.GQRuntimePostBootFlow = { runPostBootFlow };
  }
})();