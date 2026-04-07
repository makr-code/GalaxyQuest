/**
 * RuntimeThemeSettingsUi.js
 *
 * Theme settings panel UI sync and preview rendering.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

(function () {
  function refreshThemeSettingsUi(opts = {}) {
    const {
      settingsState = {},
      uiState = {},
      currentUser = null,
      resolvePlayerFactionThemeSeed = () => ({ factionId: 0 }),
      esc = (value) => String(value || ''),
      onModeChanged = null,
      onPreviewRequested = null,
    } = opts;

    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    const modeSelect = modal.querySelector('[data-setting="uiThemeMode"]');
    const factionSelect = modal.querySelector('[data-setting="uiThemeFactionId"]');
    const customAccentInput = modal.querySelector('[data-setting="uiThemeCustomAccent"]');
    if (!modeSelect || !factionSelect || !customAccentInput) return;

    const options = [];
    const seen = new Set();

    const pushFactionOption = (id, name, isPlayer = false) => {
      const factionId = Math.max(0, Number(id || 0));
      if (factionId <= 0 || seen.has(factionId)) return;
      seen.add(factionId);
      const label = String(name || `Faction #${factionId}`).trim() || `Faction #${factionId}`;
      options.push({
        id: factionId,
        label: isPlayer ? `${label} (Player)` : label,
      });
    };

    const playerSeed = resolvePlayerFactionThemeSeed();
    if (playerSeed.factionId > 0) {
      const playerName = String(currentUser?.faction?.name || currentUser?.faction_name || `Faction #${playerSeed.factionId}`);
      pushFactionOption(playerSeed.factionId, playerName, true);
    }

    (Array.isArray(uiState.territory) ? uiState.territory : []).forEach((f) => {
      pushFactionOption(f?.id || f?.faction_id, f?.name || f?.faction_name, !!f?.__isPlayer);
    });

    Object.keys(settingsState.factionThemeCache || {}).forEach((key) => {
      pushFactionOption(Number(key || 0), `Faction #${key}`);
    });

    options.sort((a, b) => String(a.label).localeCompare(String(b.label), 'en', { sensitivity: 'base' }));

    const selectedFactionId = Math.max(0, Number(settingsState.uiThemeFactionId || 0));
    const html = ['<option value="0">Player faction (auto)</option>']
      .concat(options.map((row) => `<option value="${row.id}">${esc(row.label)}</option>`))
      .join('');
    factionSelect.innerHTML = html;
    factionSelect.value = String(selectedFactionId);

    const mode = String(modeSelect.value || settingsState.uiThemeMode || 'auto').toLowerCase();
    const enableFactionSelect = mode === 'faction';
    factionSelect.disabled = !enableFactionSelect;
    factionSelect.title = enableFactionSelect
      ? 'Select which faction palette should drive the UI theme.'
      : 'Available when Theme Source is set to Faction Theme.';

    const enableCustomAccent = mode === 'custom';
    customAccentInput.disabled = !enableCustomAccent;
    customAccentInput.title = enableCustomAccent
      ? 'Select a custom accent color for the UI theme.'
      : 'Available when Theme Source is set to Custom Accent.';

    if (!modeSelect.__gqThemePreviewBound) {
      modeSelect.__gqThemePreviewBound = true;
      modeSelect.addEventListener('change', () => {
        if (typeof onModeChanged === 'function') onModeChanged();
      });
    }
    if (!factionSelect.__gqThemePreviewBound) {
      factionSelect.__gqThemePreviewBound = true;
      factionSelect.addEventListener('change', () => {
        if (typeof onPreviewRequested === 'function') onPreviewRequested();
      });
    }
    if (!customAccentInput.__gqThemePreviewBound) {
      customAccentInput.__gqThemePreviewBound = true;
      customAccentInput.addEventListener('input', () => {
        if (typeof onPreviewRequested === 'function') onPreviewRequested();
      });
      customAccentInput.addEventListener('change', () => {
        if (typeof onPreviewRequested === 'function') onPreviewRequested();
      });
    }

    if (typeof onPreviewRequested === 'function') onPreviewRequested();
  }

  function renderThemePreviewUi(opts = {}) {
    const {
      settingsState = {},
      normalizeHexColor = (value, fallback) => String(value || fallback || ''),
      resolveThemePaletteForSelection = () => null,
      uiThemeDefaultAccent = '#3aa0ff',
    } = opts;

    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    const modeSelect = modal.querySelector('[data-setting="uiThemeMode"]');
    const factionSelect = modal.querySelector('[data-setting="uiThemeFactionId"]');
    const customAccentInput = modal.querySelector('[data-setting="uiThemeCustomAccent"]');
    const sourceMeta = modal.querySelector('[data-theme-preview-source]');
    const detailMeta = modal.querySelector('[data-theme-preview-detail]');
    if (!modeSelect || !factionSelect || !customAccentInput || !sourceMeta || !detailMeta) return;

    const mode = String(modeSelect.value || settingsState.uiThemeMode || 'auto').toLowerCase();
    const customAccent = normalizeHexColor(customAccentInput.value || settingsState.uiThemeCustomAccent || uiThemeDefaultAccent, uiThemeDefaultAccent);
    const factionId = Math.max(0, Number(factionSelect.value || settingsState.uiThemeFactionId || 0));
    const palette = resolveThemePaletteForSelection(mode, customAccent, factionId);
    if (!palette) return;

    if (mode !== 'custom') {
      const resolvedAccent = normalizeHexColor(palette.accent, uiThemeDefaultAccent);
      if (resolvedAccent && customAccentInput.value !== resolvedAccent) {
        customAccentInput.value = resolvedAccent;
      }
    }

    const sourceLabel = palette.source === 'faction'
      ? `Faction${palette.factionId > 0 ? ` #${palette.factionId}` : ''}`
      : palette.source === 'custom'
        ? 'Custom'
        : 'Fallback';
    sourceMeta.textContent = `Source: ${sourceLabel}`;
    detailMeta.textContent = `Accent ${String(palette.accent || '').toUpperCase()} | Complement ${String(palette.complement || '').toUpperCase()}`;

    const swatchMap = {
      accent: normalizeHexColor(palette.accent || uiThemeDefaultAccent, uiThemeDefaultAccent),
      accentSoft: normalizeHexColor(palette.accentSoft || uiThemeDefaultAccent, uiThemeDefaultAccent),
      complement: normalizeHexColor(palette.complement || uiThemeDefaultAccent, uiThemeDefaultAccent),
      complementSoft: normalizeHexColor(palette.complementSoft || uiThemeDefaultAccent, uiThemeDefaultAccent),
    };

    modal.querySelectorAll('[data-theme-swatch]').forEach((node) => {
      const key = String(node.getAttribute('data-theme-swatch') || '').trim();
      const color = swatchMap[key];
      if (!color) return;
      node.style.background = color;
      node.setAttribute('title', `${key}: ${color}`);
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      refreshThemeSettingsUi,
      renderThemePreviewUi,
    };
  } else {
    window.GQRuntimeThemeSettingsUi = {
      refreshThemeSettingsUi,
      renderThemePreviewUi,
    };
  }
})();
