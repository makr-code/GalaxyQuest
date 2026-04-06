/**
 * RuntimeAudioCatalog.js
 *
 * Audio track catalog loading and topbar/settings playlist UI helpers.
 *
 * License: MIT - makr-code/GalaxyQuest
 */

'use strict';

(function () {
  const runtimeCtx = {
    getAudioTrackOptions: () => [],
    setAudioTrackOptions: () => {},
    getAudioTrackCatalogLoaded: () => false,
    setAudioTrackCatalogLoaded: () => {},
    getAudioTrackCatalogPromise: () => null,
    setAudioTrackCatalogPromise: () => {},
    getSettingsState: () => null,
    getAudioManager: () => null,
    getApi: () => null,
    getSettingsController: () => null,
    esc: (value) => String(value || ''),
    gameLog: () => {},
    documentRef: (typeof document !== 'undefined' ? document : null),
    windowRef: (typeof window !== 'undefined' ? window : null),
  };

  function configureAudioCatalogRuntime(opts = {}) {
    if (!opts || typeof opts !== 'object') return;
    Object.assign(runtimeCtx, opts);
  }

  function normalizeAudioTrackCatalog(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    const seen = new Set();

    for (let i = 0; i < items.length; i += 1) {
      const row = items[i] || {};
      const value = String(row.value || '').trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      const label = String(row.label || row.file || value).trim() || value;
      out.push({ value, label });
    }

    return out;
  }

  function resolveAudioTrackLabel(url) {
    const options = runtimeCtx.getAudioTrackOptions();
    const value = String(url || '').trim();
    if (!value) return '-';
    const fromCatalog = options.find((entry) => String(entry.value || '') === value);
    if (fromCatalog && fromCatalog.label) return String(fromCatalog.label);
    const parts = value.split('/');
    const file = String(parts[parts.length - 1] || value);
    return file.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || file;
  }

  function updateTopbarTrackTicker(label) {
    const documentRef = runtimeCtx.documentRef;
    const windowRef = runtimeCtx.windowRef;
    const host = documentRef?.getElementById('topbar-player-current');
    if (!host) return;

    const text = String(label || '-').trim() || '-';
    host.textContent = '';
    const node = documentRef.createElement('span');
    node.className = 'topbar-player-current-text';
    node.textContent = text;
    host.appendChild(node);

    host.classList.remove('is-overflow');
    host.style.removeProperty('--marquee-shift');
    host.style.removeProperty('--marquee-duration');

    const checkOverflow = () => {
      const overflow = node.scrollWidth - host.clientWidth;
      if (overflow > 6) {
        const shift = Math.ceil(overflow + 18);
        const duration = Math.max(6, Math.min(18, shift / 18));
        host.style.setProperty('--marquee-shift', `${shift}px`);
        host.style.setProperty('--marquee-duration', `${duration.toFixed(2)}s`);
        host.classList.add('is-overflow');
      }
    };

    windowRef?.requestAnimationFrame?.(checkOverflow);
  }

  function renderTopbarTrackQuickList(activeTrackUrl = '') {
    const documentRef = runtimeCtx.documentRef;
    const esc = runtimeCtx.esc;
    const list = documentRef?.getElementById('topbar-player-track-list');
    if (!list) return;

    const options = runtimeCtx.getAudioTrackOptions();
    const active = String(activeTrackUrl || '').trim();
    if (!Array.isArray(options) || !options.length) {
      list.innerHTML = '<div class="topbar-player-track-empty">Keine Titel verfuegbar.</div>';
      return;
    }

    list.innerHTML = options.map((entry) => {
      const value = String(entry?.value || '').trim();
      const label = String(entry?.label || value || '-').trim() || '-';
      const isActive = !!value && value === active;
      return `<button type="button" class="topbar-player-track-item${isActive ? ' is-active' : ''}" data-track="${esc(value)}" role="option" aria-selected="${isActive ? 'true' : 'false'}" title="${esc(label)}">${esc(label)}</button>`;
    }).join('');
  }

  function refreshSettingsMusicPresetOptions() {
    const documentRef = runtimeCtx.documentRef;
    const settingsState = runtimeCtx.getSettingsState() || {};
    const options = runtimeCtx.getAudioTrackOptions();
    const esc = runtimeCtx.esc;
    const select = documentRef?.querySelector('#set-music-preset');
    const miniSelect = documentRef?.querySelector('#set-player-track');
    const topbarSelect = documentRef?.querySelector('#topbar-player-track');
    const current = select ? String(select.value || '') : '';
    const miniCurrent = miniSelect ? String(miniSelect.value || '') : '';
    const topbarCurrent = topbarSelect ? String(topbarSelect.value || '') : '';
    const optionsHtml = options
      .map((entry) => `<option value="${esc(entry.value)}">${esc(entry.label)}</option>`)
      .join('');

    if (select) {
      select.innerHTML = `<option value="">Keine Vorlage</option>${optionsHtml}`;
      if (current && options.some((entry) => String(entry.value) === current)) {
        select.value = current;
      }
    }

    if (miniSelect) {
      miniSelect.innerHTML = optionsHtml;
      if (miniCurrent && options.some((entry) => String(entry.value) === miniCurrent)) {
        miniSelect.value = miniCurrent;
      }
    }

    if (topbarSelect) {
      topbarSelect.innerHTML = optionsHtml;
      if (topbarCurrent && options.some((entry) => String(entry.value) === topbarCurrent)) {
        topbarSelect.value = topbarCurrent;
      }
    }

    renderTopbarTrackQuickList(topbarCurrent || settingsState.musicUrl || '');
  }

  function applyAudioPlaylistFromCatalog() {
    const options = runtimeCtx.getAudioTrackOptions();
    const audioManager = runtimeCtx.getAudioManager();
    if (!audioManager || typeof audioManager.setMusicPlaylist !== 'function') return;
    const playlist = options
      .map((entry) => String(entry.value || '').trim())
      .filter((value, idx, arr) => value && arr.indexOf(value) === idx);
    audioManager.setMusicPlaylist(playlist, { mode: 'shuffle' });
  }

  async function loadAudioTrackCatalog(force = false) {
    const loaded = !!runtimeCtx.getAudioTrackCatalogLoaded();
    const promise = runtimeCtx.getAudioTrackCatalogPromise();
    if (!force && loaded) return runtimeCtx.getAudioTrackOptions();
    if (!force && promise) return promise;

    const nextPromise = (async () => {
      try {
        const api = runtimeCtx.getApi();
        if (!api || typeof api.audioTracks !== 'function') {
          runtimeCtx.setAudioTrackCatalogLoaded(true);
          return runtimeCtx.getAudioTrackOptions();
        }
        const data = await api.audioTracks();
        const nextOptions = normalizeAudioTrackCatalog(data?.tracks);
        const settingsState = runtimeCtx.getSettingsState() || {};
        const audioManager = runtimeCtx.getAudioManager();
        const settingsController = runtimeCtx.getSettingsController();
        if (nextOptions.length > 0) {
          runtimeCtx.setAudioTrackOptions(nextOptions);
          const firstTrack = String(nextOptions[0].value || '').trim();
          const sceneTracks = settingsState.sceneTracks || {};
          const hasSceneTrack = ['galaxy', 'system', 'battle', 'ui'].some((k) => String(sceneTracks[k] || '').trim() !== '');
          const hasMusicUrl = String(settingsState.musicUrl || '').trim() !== '';

          if (firstTrack && !hasMusicUrl && !hasSceneTrack) {
            settingsState.musicUrl = firstTrack;
            settingsState.sceneTracks = {
              galaxy: firstTrack,
              system: firstTrack,
              battle: firstTrack,
              ui: firstTrack,
            };

            if (audioManager) {
              if (typeof audioManager.setMusicTrack === 'function') {
                audioManager.setMusicTrack(firstTrack, false);
              }
              if (typeof audioManager.setSceneTrack === 'function') {
                audioManager.setSceneTrack('galaxy', firstTrack);
                audioManager.setSceneTrack('system', firstTrack);
                audioManager.setSceneTrack('battle', firstTrack);
                audioManager.setSceneTrack('ui', firstTrack);
              }
            }

            settingsController?.saveUiSettings?.();
          }
        }
        runtimeCtx.setAudioTrackCatalogLoaded(true);
        applyAudioPlaylistFromCatalog();
        refreshSettingsMusicPresetOptions();
        settingsController?.refreshAudioUi?.();
        return runtimeCtx.getAudioTrackOptions();
      } catch (_) {
        runtimeCtx.gameLog('warn', 'Audio-Track-Katalog konnte nicht geladen werden, fallback aktiv');
        runtimeCtx.setAudioTrackCatalogLoaded(true);
        applyAudioPlaylistFromCatalog();
        refreshSettingsMusicPresetOptions();
        runtimeCtx.getSettingsController()?.refreshAudioUi?.();
        return runtimeCtx.getAudioTrackOptions();
      } finally {
        runtimeCtx.setAudioTrackCatalogPromise(null);
      }
    })();

    runtimeCtx.setAudioTrackCatalogPromise(nextPromise);
    return nextPromise;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      configureAudioCatalogRuntime,
      normalizeAudioTrackCatalog,
      resolveAudioTrackLabel,
      updateTopbarTrackTicker,
      renderTopbarTrackQuickList,
      refreshSettingsMusicPresetOptions,
      applyAudioPlaylistFromCatalog,
      loadAudioTrackCatalog,
    };
  } else {
    window.GQRuntimeAudioCatalog = {
      configureAudioCatalogRuntime,
      normalizeAudioTrackCatalog,
      resolveAudioTrackLabel,
      updateTopbarTrackTicker,
      renderTopbarTrackQuickList,
      refreshSettingsMusicPresetOptions,
      applyAudioPlaylistFromCatalog,
      loadAudioTrackCatalog,
    };
  }
})();
