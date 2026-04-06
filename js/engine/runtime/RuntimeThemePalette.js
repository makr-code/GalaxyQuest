/**
 * RuntimeThemePalette.js
 *
 * Theme palette math, faction theme cache and CSS application helpers.
 *
 * License: MIT - makr-code/GalaxyQuest
 */

'use strict';

(function () {
  const runtimeCtx = {
    uiThemeDefaultAccent: '#3aa0ff',
    uiThemeModeValues: new Set(['auto', 'faction', 'custom']),
    uiThemeDynamicVars: [],
    getCurrentUser: () => null,
    getUiState: () => null,
    getSettingsState: () => null,
    showToast: () => {},
    documentRef: (typeof document !== 'undefined' ? document : null),
  };

  function configureThemeRuntime(opts = {}) {
    if (!opts || typeof opts !== 'object') return;
    Object.assign(runtimeCtx, opts);
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value || 0)));
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value || 0))));
  }

  function normalizeHexColor(value, fallback = runtimeCtx.uiThemeDefaultAccent) {
    const raw = String(value || '').trim();
    const match = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return String(fallback || runtimeCtx.uiThemeDefaultAccent);
    const hex = String(match[1] || '').toLowerCase();
    if (hex.length === 3) {
      return `#${hex.split('').map((c) => c + c).join('')}`;
    }
    return `#${hex}`;
  }

  function hexToRgb(hex) {
    const safeHex = normalizeHexColor(hex, runtimeCtx.uiThemeDefaultAccent);
    const body = safeHex.slice(1);
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16),
    };
  }

  function rgbToHex(r, g, b) {
    const toHex = (value) => clampByte(value).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function rgbToHsl(r, g, b) {
    const rn = clampByte(r) / 255;
    const gn = clampByte(g) / 255;
    const bn = clampByte(b) / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs((2 * l) - 1));
    if (d !== 0) {
      if (max === rn) h = ((gn - bn) / d) % 6;
      else if (max === gn) h = ((bn - rn) / d) + 2;
      else h = ((rn - gn) / d) + 4;
    }
    return {
      h: (h * 60 + 360) % 360,
      s,
      l,
    };
  }

  function hueToRgb(p, q, t) {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * ((2 / 3) - x) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    const hn = ((Number(h || 0) % 360) + 360) % 360;
    const sn = clamp01(s);
    const ln = clamp01(l);
    if (sn === 0) {
      const gray = Math.round(ln * 255);
      return { r: gray, g: gray, b: gray };
    }
    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - (ln * sn);
    const p = 2 * ln - q;
    const hk = hn / 360;
    return {
      r: Math.round(hueToRgb(p, q, hk + (1 / 3)) * 255),
      g: Math.round(hueToRgb(p, q, hk) * 255),
      b: Math.round(hueToRgb(p, q, hk - (1 / 3)) * 255),
    };
  }

  function shiftHueHex(hex, hueShiftDeg = 0, satMul = 1, lightMul = 1) {
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const shifted = hslToRgb(
      (hsl.h + Number(hueShiftDeg || 0) + 360) % 360,
      clamp01(hsl.s * Number(satMul || 1)),
      clamp01(hsl.l * Number(lightMul || 1))
    );
    return rgbToHex(shifted.r, shifted.g, shifted.b);
  }

  function mixHex(a, b, ratio = 0.5) {
    const pa = hexToRgb(a);
    const pb = hexToRgb(b);
    const t = clamp01(ratio);
    return rgbToHex(
      Math.round(pa.r + (pb.r - pa.r) * t),
      Math.round(pa.g + (pb.g - pa.g) * t),
      Math.round(pa.b + (pb.b - pa.b) * t)
    );
  }

  function hexToRgba(hex, alpha = 1) {
    const rgb = hexToRgb(hex);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp01(alpha)})`;
  }

  function createThemePaletteFromAccent(accentHex) {
    const accent = normalizeHexColor(accentHex, runtimeCtx.uiThemeDefaultAccent);
    const complement = shiftHueHex(accent, 180, 0.94, 1.02);
    const accentStrong = mixHex(accent, '#ffffff', 0.2);
    const accentSoft = mixHex(accent, '#0b1526', 0.52);
    const complementSoft = mixHex(complement, '#0b1526', 0.5);
    const borderLit = mixHex(accent, '#d8ebff', 0.34);
    return {
      accent,
      accentStrong,
      accentSoft,
      complement,
      complementSoft,
      borderLit,
    };
  }

  function getRootStyle() {
    const documentRef = runtimeCtx.documentRef;
    return documentRef?.documentElement ? documentRef.documentElement.style : null;
  }

  function applyThemePaletteToCss(palette) {
    const style = getRootStyle();
    if (!style || !palette) return;
    style.setProperty('--accent-blue', palette.accent);
    style.setProperty('--accent-cyan', palette.complement);
    style.setProperty('--accent-purple', palette.complementSoft);
    style.setProperty('--border-lit', palette.borderLit);
    style.setProperty('--theme-accent', palette.accent);
    style.setProperty('--theme-accent-soft', hexToRgba(palette.accentSoft, 0.78));
    style.setProperty('--theme-accent-strong', palette.accentStrong);
    style.setProperty('--theme-complement', palette.complement);
    style.setProperty('--theme-complement-soft', hexToRgba(palette.complementSoft, 0.7));
  }

  function clearThemePaletteCssOverrides() {
    const style = getRootStyle();
    if (!style) return;
    const vars = Array.isArray(runtimeCtx.uiThemeDynamicVars) ? runtimeCtx.uiThemeDynamicVars : [];
    vars.forEach((name) => style.removeProperty(name));
  }

  function resolvePlayerFactionThemeSeed() {
    const currentUser = runtimeCtx.getCurrentUser();
    const uiState = runtimeCtx.getUiState();
    const currentUserCandidates = [
      { id: currentUser?.faction_id, color: currentUser?.faction_color },
      { id: currentUser?.home_faction_id, color: currentUser?.home_faction_color },
      { id: currentUser?.primary_faction_id, color: currentUser?.primary_faction_color },
      { id: currentUser?.faction?.id, color: currentUser?.faction?.color },
    ];
    for (const row of currentUserCandidates) {
      const id = Number(row?.id || 0);
      const color = normalizeHexColor(row?.color || '', '');
      if (id > 0 && color) return { factionId: id, color };
    }

    const playerClaim = (Array.isArray(uiState?.territory) ? uiState.territory : []).find((f) => f?.__isPlayer);
    if (playerClaim) {
      const id = Number(playerClaim?.id || playerClaim?.faction_id || 0);
      const color = normalizeHexColor(playerClaim?.color || '', '');
      if (id > 0 && color) return { factionId: id, color };
    }
    return { factionId: 0, color: '' };
  }

  function findFactionColorById(factionId) {
    const currentUser = runtimeCtx.getCurrentUser();
    const uiState = runtimeCtx.getUiState();
    const settingsState = runtimeCtx.getSettingsState();
    const targetId = Number(factionId || 0);
    if (targetId <= 0) return '';

    const currentUserCandidates = [
      { id: currentUser?.faction_id, color: currentUser?.faction_color },
      { id: currentUser?.home_faction_id, color: currentUser?.home_faction_color },
      { id: currentUser?.primary_faction_id, color: currentUser?.primary_faction_color },
      { id: currentUser?.faction?.id, color: currentUser?.faction?.color },
    ];
    for (const row of currentUserCandidates) {
      const id = Number(row?.id || 0);
      const color = normalizeHexColor(row?.color || '', '');
      if (id === targetId && color) return color;
    }

    const fromTerritory = (Array.isArray(uiState?.territory) ? uiState.territory : []).find((f) => Number(f?.id || f?.faction_id || 0) === targetId);
    const territoryColor = normalizeHexColor(fromTerritory?.color || '', '');
    if (territoryColor) return territoryColor;

    const cached = settingsState?.factionThemeCache?.[String(targetId)];
    const cachedColor = normalizeHexColor(cached?.base || '', '');
    return cachedColor || '';
  }

  function ensureFactionThemeCacheEntry(factionId, baseColor) {
    const settingsState = runtimeCtx.getSettingsState();
    const id = Number(factionId || 0);
    const color = normalizeHexColor(baseColor || '', '');
    if (id <= 0 || !color || !settingsState) return null;
    if (!settingsState.factionThemeCache || typeof settingsState.factionThemeCache !== 'object') {
      settingsState.factionThemeCache = {};
    }
    const key = String(id);
    const existing = settingsState.factionThemeCache[key];
    if (existing && String(existing.base || '').toLowerCase() === color.toLowerCase()) {
      return existing;
    }
    const palette = createThemePaletteFromAccent(color);
    const next = Object.assign({
      factionId: id,
      base: color,
      generatedAt: Date.now(),
    }, palette);
    settingsState.factionThemeCache[key] = next;
    return next;
  }

  function warmFactionThemeCacheFromTerritory(territoryList) {
    if (!Array.isArray(territoryList) || !territoryList.length) return false;
    let changed = false;
    territoryList.forEach((faction) => {
      const id = Number(faction?.id || faction?.faction_id || 0);
      const color = normalizeHexColor(faction?.color || '', '');
      if (id <= 0 || !color) return;
      const settingsState = runtimeCtx.getSettingsState();
      const before = settingsState?.factionThemeCache?.[String(id)]?.base || '';
      const after = ensureFactionThemeCacheEntry(id, color)?.base || '';
      if (before !== after) changed = true;
    });
    return changed;
  }

  function resolveThemePaletteForSelection(modeInput, customAccentInput, factionIdInput) {
    const modeValues = runtimeCtx.uiThemeModeValues instanceof Set
      ? runtimeCtx.uiThemeModeValues
      : new Set(Array.isArray(runtimeCtx.uiThemeModeValues) ? runtimeCtx.uiThemeModeValues : ['auto', 'faction', 'custom']);
    const mode = modeValues.has(String(modeInput || '').toLowerCase())
      ? String(modeInput || '').toLowerCase()
      : 'auto';
    const customAccent = normalizeHexColor(customAccentInput || '', runtimeCtx.uiThemeDefaultAccent);
    if (mode === 'custom') {
      return Object.assign({ source: 'custom', factionId: 0 }, createThemePaletteFromAccent(customAccent));
    }

    const preferredFactionId = Math.max(0, Number(factionIdInput || 0));
    const selectedFactionSeed = preferredFactionId > 0
      ? { factionId: preferredFactionId, color: findFactionColorById(preferredFactionId) }
      : null;
    const factionSeed = mode === 'faction'
      ? (selectedFactionSeed && selectedFactionSeed.color ? selectedFactionSeed : resolvePlayerFactionThemeSeed())
      : resolvePlayerFactionThemeSeed();
    if (factionSeed.factionId > 0 && factionSeed.color) {
      const cached = ensureFactionThemeCacheEntry(factionSeed.factionId, factionSeed.color);
      if (cached) return Object.assign({ source: 'faction', factionId: factionSeed.factionId }, cached);
    }

    return Object.assign({ source: 'fallback', factionId: 0 }, createThemePaletteFromAccent(runtimeCtx.uiThemeDefaultAccent));
  }

  function resolveActiveThemePalette() {
    const settingsState = runtimeCtx.getSettingsState();
    return resolveThemePaletteForSelection(
      settingsState?.uiThemeMode,
      settingsState?.uiThemeCustomAccent,
      settingsState?.uiThemeFactionId
    );
  }

  function applyUiTheme(reason = 'runtime') {
    const settingsState = runtimeCtx.getSettingsState();
    const palette = resolveActiveThemePalette();
    if (!palette) {
      clearThemePaletteCssOverrides();
      return;
    }
    applyThemePaletteToCss(palette);
    if (settingsState) {
      settingsState.uiThemeLastSource = String(palette.source || 'fallback');
      settingsState.uiThemeLastFactionId = Number(palette.factionId || 0);
    }
    if (reason === 'user-change') {
      const root = runtimeCtx.documentRef?.documentElement;
      if (root) {
        root.classList.remove('is-theme-changing');
        void root.offsetHeight;
        root.classList.add('is-theme-changing');
        setTimeout(() => root.classList.remove('is-theme-changing'), 420);
      }
      runtimeCtx.showToast(`UI Theme aktiv: ${settingsState?.uiThemeLastSource === 'faction' ? 'Fraktion' : settingsState?.uiThemeLastSource === 'custom' ? 'Benutzerdefiniert' : 'Standard'}`, 'info');
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      configureThemeRuntime,
      normalizeHexColor,
      hexToRgb,
      rgbToHex,
      rgbToHsl,
      hslToRgb,
      shiftHueHex,
      mixHex,
      hexToRgba,
      createThemePaletteFromAccent,
      applyThemePaletteToCss,
      clearThemePaletteCssOverrides,
      resolvePlayerFactionThemeSeed,
      findFactionColorById,
      ensureFactionThemeCacheEntry,
      warmFactionThemeCacheFromTerritory,
      resolveThemePaletteForSelection,
      resolveActiveThemePalette,
      applyUiTheme,
    };
  } else {
    window.GQRuntimeThemePalette = {
      configureThemeRuntime,
      normalizeHexColor,
      hexToRgb,
      rgbToHex,
      rgbToHsl,
      hslToRgb,
      shiftHueHex,
      mixHex,
      hexToRgba,
      createThemePaletteFromAccent,
      applyThemePaletteToCss,
      clearThemePaletteCssOverrides,
      resolvePlayerFactionThemeSeed,
      findFactionColorById,
      ensureFactionThemeCacheEntry,
      warmFactionThemeCacheFromTerritory,
      resolveThemePaletteForSelection,
      resolveActiveThemePalette,
      applyUiTheme,
    };
  }
})();
