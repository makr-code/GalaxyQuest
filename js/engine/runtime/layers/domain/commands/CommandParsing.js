/**
 * RuntimeCommandParsing.js
 *
 * Shared parser helpers for console-like commands.
 */

'use strict';

(function () {
  function parseCommandInput(rawInput, opts = {}) {
    const {
      stripLeadingSlash = false,
    } = opts;

    const raw = String(rawInput || '').trim();
    if (!raw) {
      return {
        raw,
        normalized: '',
        normalizedLower: '',
        parts: [],
        cmd: '',
      };
    }

    const normalized = stripLeadingSlash && raw.startsWith('/')
      ? raw.slice(1).trim()
      : raw;
    const parts = normalized.split(/\s+/).filter(Boolean);
    const cmd = String(parts[0] || '').toLowerCase();

    return {
      raw,
      normalized,
      normalizedLower: normalized.toLowerCase(),
      parts,
      cmd,
    };
  }

  const api = {
    parseCommandInput,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeCommandParsing = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();