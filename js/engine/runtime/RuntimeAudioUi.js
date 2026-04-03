/**
 * RuntimeAudioUi.js
 *
 * Audio UI refresh logic for settings/topbar controls.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

(function () {
  function refreshAudioUi(opts = {}) {
    const {
      audioManager = null,
      settingsState = {},
      audioTrackOptions = [],
      documentRef = (typeof document !== 'undefined' ? document : null),
      renderMonoIconButton = () => {},
      renderTopbarTrackQuickList = () => {},
      resolveAudioTrackLabel = (url) => String(url || ''),
      updateTopbarTrackTicker = () => {},
    } = opts;

    const btn = documentRef?.getElementById('audio-toggle-btn');
    const topbarTrack = documentRef?.getElementById('topbar-player-track');
    const topbarToggle = documentRef?.getElementById('topbar-player-toggle');
    const topbarCurrent = documentRef?.getElementById('topbar-player-current');
    const topbarMode = documentRef?.getElementById('topbar-player-mode');
    if (!btn) return;

    if (!audioManager) {
      btn.disabled = true;
      btn.textContent = 'M';
      btn.title = 'Audio nicht verfuegbar';
      renderMonoIconButton(btn, 'icon-volume-muted', 'Audio nicht verfuegbar');
      if (topbarTrack) topbarTrack.disabled = true;
      if (topbarToggle) {
        topbarToggle.disabled = true;
        topbarToggle.textContent = 'Play';
        topbarToggle.title = 'Musik nicht verfuegbar';
        topbarToggle.setAttribute('aria-label', 'Musik nicht verfuegbar');
        renderMonoIconButton(topbarToggle, 'icon-play', 'Musik nicht verfuegbar');
      }
      if (topbarCurrent) {
        topbarCurrent.textContent = '-';
        topbarCurrent.title = 'Kein aktiver Track';
      }
      if (topbarMode) {
        topbarMode.textContent = 'N/A';
        topbarMode.title = 'Transition-Modus nicht verfuegbar';
      }
      renderTopbarTrackQuickList('');
      return;
    }

    const state = audioManager.snapshot();
    const muted = !!state.masterMuted;
    btn.disabled = false;
    btn.textContent = muted ? 'M' : 'S';
    btn.title = muted ? 'Audio aktivieren' : 'Audio stummschalten';
    renderMonoIconButton(btn, muted ? 'icon-volume-muted' : 'icon-volume', muted ? 'Audio aktivieren' : 'Audio stummschalten');

    if (topbarTrack) {
      topbarTrack.disabled = false;
      const activeTrack = String(state.musicUrl || settingsState.musicUrl || '').trim();
      if (activeTrack && Array.isArray(audioTrackOptions) && audioTrackOptions.some((entry) => String(entry.value) === activeTrack)) {
        topbarTrack.value = activeTrack;
      }
    }

    const activeTrackForList = String(state.musicUrl || settingsState.musicUrl || '').trim();
    renderTopbarTrackQuickList(activeTrackForList);

    if (topbarCurrent) {
      const activeTrack = String(state.musicUrl || settingsState.musicUrl || '').trim();
      const label = resolveAudioTrackLabel(activeTrack);
      updateTopbarTrackTicker(label);
      topbarCurrent.title = activeTrack ? `Aktueller Track: ${label}` : 'Kein aktiver Track';
    }

    if (topbarToggle) {
      topbarToggle.disabled = false;
      const playing = !!state.musicPlaying;
      topbarToggle.textContent = playing ? 'Pause' : 'Play';
      topbarToggle.title = playing ? 'Musik pausieren' : 'Musik starten';
      topbarToggle.setAttribute('aria-label', playing ? 'Musik pausieren' : 'Musik starten');
      renderMonoIconButton(topbarToggle, playing ? 'icon-pause' : 'icon-play', playing ? 'Musik pausieren' : 'Musik starten');
    }

    if (topbarMode) {
      const mode = String(state.musicTransitionMode || settingsState.musicTransitionMode || 'fade').toLowerCase() === 'cut' ? 'cut' : 'fade';
      topbarMode.textContent = mode.toUpperCase();
      topbarMode.title = mode === 'fade' ? 'Transition-Modus: Fade (nahtlos)' : 'Transition-Modus: Cut (sofort)';
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { refreshAudioUi };
  } else {
    window.GQRuntimeAudioUi = { refreshAudioUi };
  }
})();
