(function attachRuntimeHints(global) {
  'use strict';

  const runtimeConfig = {
    galaxyFleetHintKey: 'gq_hint_galaxy_fleet_colors_v1',
    orbitBadgeHintSessionKey: 'gq_hint_orbit_badge_v1',
    galaxyFleetHintCookieDays: 365,
    showToast: null,
    showToastWithAction: null,
    gameLog: null,
    documentRef: null,
    windowRef: null,
  };

  const sessionState = {
    galaxyFleetHintShown: false,
    galaxyFleetHintScheduled: false,
    galaxyShortcutsHintShown: false,
  };

  function configureHintsRuntime(options = {}) {
    Object.assign(runtimeConfig, options || {});
  }

  function log(level, message, payload) {
    if (typeof runtimeConfig.gameLog === 'function') {
      runtimeConfig.gameLog(level, message, payload);
    }
  }

  function getDocumentRef() {
    return runtimeConfig.documentRef || global.document || null;
  }

  function getWindowRef() {
    return runtimeConfig.windowRef || global.window || global || null;
  }

  function readCookieValue(name) {
    try {
      const cookieText = String(getDocumentRef()?.cookie || '');
      if (!cookieText) return '';
      const safeName = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = cookieText.match(new RegExp(`(?:^|;\\s*)${safeName}=([^;]*)`));
      return match?.[1] ? decodeURIComponent(match[1]) : '';
    } catch (err) {
      log('warn', 'Cookie konnte nicht gelesen werden', { name, error: err });
      return '';
    }
  }

  function writeCookieValue(name, value, maxAgeSec) {
    try {
      const documentRef = getDocumentRef();
      if (!documentRef) return;
      const safeAge = Math.max(60, Number(maxAgeSec || 0));
      documentRef.cookie = `${name}=${encodeURIComponent(String(value || ''))}; Max-Age=${safeAge}; Path=/; SameSite=Lax`;
    } catch (err) {
      log('warn', 'Cookie konnte nicht geschrieben werden', { name, error: err });
    }
  }

  function hasSeenGalaxyFleetHint() {
    try {
      if (getWindowRef()?.localStorage?.getItem(runtimeConfig.galaxyFleetHintKey) === '1') {
        return true;
      }
    } catch (err) {
      log('info', 'Fleet-Hint Status nicht aus localStorage lesbar', err);
    }
    return readCookieValue(runtimeConfig.galaxyFleetHintKey) === '1';
  }

  function markGalaxyFleetHintSeen() {
    try {
      getWindowRef()?.localStorage?.setItem(runtimeConfig.galaxyFleetHintKey, '1');
    } catch (err) {
      log('info', 'Fleet-Hint Status nicht in localStorage schreibbar', err);
    }
    writeCookieValue(
      runtimeConfig.galaxyFleetHintKey,
      '1',
      Number(runtimeConfig.galaxyFleetHintCookieDays || 365) * 24 * 60 * 60
    );
  }

  function showOrbitModeHintOnce() {
    try {
      const sessionStorage = getWindowRef()?.sessionStorage;
      if (!sessionStorage) return;
      if (sessionStorage.getItem(runtimeConfig.orbitBadgeHintSessionKey)) return;
      runtimeConfig.showToast?.('Orbit-Badge: Klick/Enter/Space wechselt AUTO -> SIMPLE -> COMPLEX.', 'info');
      sessionStorage.setItem(runtimeConfig.orbitBadgeHintSessionKey, '1');
    } catch (_) {
      // Session storage can be unavailable in restricted contexts.
    }
  }

  function showGalaxyShortcutsHintOnce() {
    if (sessionState.galaxyShortcutsHintShown) return;
    runtimeConfig.showToast?.('Galaxy-Shortcuts: O Controls, I Info, L Follow, V Vectors.', 'info');
    sessionState.galaxyShortcutsHintShown = true;
  }

  function showFleetLegendHintOnce() {
    if (sessionState.galaxyFleetHintShown) return;
    if (hasSeenGalaxyFleetHint()) {
      sessionState.galaxyFleetHintShown = true;
      return;
    }

    runtimeConfig.showToastWithAction?.(
      'Tipp: Fleet-Richtungsfarben und Marker findest du in Settings unter "Galaxy: Fleet-Marker und Fluglinien anzeigen".',
      'info',
      'Nicht mehr anzeigen',
      () => {
        markGalaxyFleetHintSeen();
      },
      8500
    );
    sessionState.galaxyFleetHintShown = true;
  }

  function scheduleFleetLegendHint(delayMs = 1300) {
    if (sessionState.galaxyFleetHintShown || sessionState.galaxyFleetHintScheduled) return;
    sessionState.galaxyFleetHintScheduled = true;
    getWindowRef()?.setTimeout(() => {
      showFleetLegendHintOnce();
    }, Math.max(0, Number(delayMs || 0)));
  }

  global.GQRuntimeHints = {
    configureHintsRuntime,
    readCookieValue,
    writeCookieValue,
    hasSeenGalaxyFleetHint,
    markGalaxyFleetHintSeen,
    showOrbitModeHintOnce,
    showGalaxyShortcutsHintOnce,
    showFleetLegendHintOnce,
    scheduleFleetLegendHint,
  };
})(typeof window !== 'undefined' ? window : globalThis);