/**
 * RuntimeSettingsStorage.js
 *
 * Portable settings IO for local/session/cookie persistence.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

(function () {
  function readJsonFromCookie(name, logger = null) {
    try {
      const cookieText = String(document.cookie || '');
      if (!cookieText) return null;
      const safeName = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = cookieText.match(new RegExp(`(?:^|;\\s*)${safeName}=([^;]*)`));
      if (!match || !match[1]) return null;
      const raw = decodeURIComponent(match[1]);
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      if (typeof logger === 'function') logger('warn', 'JSON-Cookie konnte nicht geparst werden', { name, error: err });
      return null;
    }
  }

  function writeJsonCookie(name, data, maxAgeSec, logger = null) {
    try {
      const encoded = encodeURIComponent(JSON.stringify(data));
      document.cookie = `${name}=${encoded}; Max-Age=${Math.max(60, Number(maxAgeSec || 0))}; Path=/; SameSite=Lax`;
    } catch (err) {
      if (typeof logger === 'function') logger('warn', 'JSON-Cookie konnte nicht geschrieben werden', { name, error: err });
    }
  }

  function loadPortableUiSettings(opts = {}) {
    const {
      storageKey = 'gq_ui_settings',
      sessionKey = 'gq_ui_settings_session',
      cookieKey = 'gq_ui_settings',
      logger = null,
    } = opts;

    const merged = {};
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') Object.assign(merged, parsed);
      }
    } catch (err) {
      if (typeof logger === 'function') logger('info', 'UI-Settings localStorage read failed', err);
    }

    const cookieState = readJsonFromCookie(cookieKey, logger);
    if (cookieState && typeof cookieState === 'object') Object.assign(merged, cookieState);

    try {
      const rawSession = sessionStorage.getItem(sessionKey);
      if (rawSession) {
        const parsedSession = JSON.parse(rawSession);
        if (parsedSession && typeof parsedSession === 'object') Object.assign(merged, parsedSession);
      }
    } catch (err) {
      if (typeof logger === 'function') logger('info', 'UI-Settings sessionStorage read failed', err);
    }

    return merged;
  }

  function savePortableUiSettings(data, opts = {}) {
    const {
      storageKey = 'gq_ui_settings',
      sessionKey = 'gq_ui_settings_session',
      cookieKey = 'gq_ui_settings',
      cookieMaxAgeSec = 60 * 60 * 24 * 180,
      logger = null,
    } = opts;

    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch (err) {
      if (typeof logger === 'function') logger('warn', 'UI-Settings localStorage write failed', err);
    }
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify(data));
    } catch (err) {
      if (typeof logger === 'function') logger('info', 'UI-Settings sessionStorage write failed', err);
    }

    writeJsonCookie(cookieKey, data, cookieMaxAgeSec, logger);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      loadPortableUiSettings,
      savePortableUiSettings,
      readJsonFromCookie,
      writeJsonCookie,
    };
  } else {
    window.GQRuntimeSettingsStorage = {
      loadPortableUiSettings,
      savePortableUiSettings,
      readJsonFromCookie,
      writeJsonCookie,
    };
  }
})();
