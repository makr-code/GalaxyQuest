/**
 * RuntimeTopbarAudioControls.js
 *
 * Binds audio-related controls in the top bar player.
 */

'use strict';

(function () {
  function bindAudioToggle(opts = {}) {
    const {
      audioManager = null,
      settingsState = {},
      saveUiSettings = () => {},
      refreshAudioUi = () => {},
      documentRef = (typeof document !== 'undefined' ? document : null),
    } = opts;

    documentRef?.getElementById('audio-toggle-btn')?.addEventListener('click', () => {
      if (!audioManager) return;
      const snapshot = audioManager.snapshot?.() || {};
      settingsState.masterMuted = !snapshot.masterMuted;
      audioManager.setMasterMuted?.(settingsState.masterMuted);
      if (!settingsState.masterMuted) audioManager.playUiClick?.();
      saveUiSettings();
      refreshAudioUi();
    });
  }

  function bindTopbarPlayer(opts = {}) {
    const {
      audioManager = null,
      settingsState = {},
      audioTrackOptions = [],
      closeTopbarPlayerMenu = () => {},
      closeTopbarSearchOverlay = () => {},
      closeCommanderMenuPanel = () => {},
      setTopbarMenuFocusTrap = () => {},
      syncTopbarBottomSheetState = () => {},
      focusFirstInTopbarMenu = () => {},
      loadAudioTrackCatalog = () => Promise.resolve(),
      saveUiSettings = () => {},
      refreshAudioUi = () => {},
      showToast = () => {},
      gameLog = () => {},
      documentRef = (typeof document !== 'undefined' ? document : null),
      windowRef = (typeof window !== 'undefined' ? window : null),
    } = opts;

    const trackSelect = documentRef?.getElementById('topbar-player-track');
    const trackList = documentRef?.getElementById('topbar-player-track-list');
    const prevBtn = documentRef?.getElementById('topbar-player-prev');
    const nextBtn = documentRef?.getElementById('topbar-player-next');
    const nextQuickBtn = documentRef?.getElementById('topbar-player-next-quick');
    const toggleBtn = documentRef?.getElementById('topbar-player-toggle');
    const menuWrap = documentRef?.getElementById('topbar-player');
    const menuToggle = documentRef?.getElementById('topbar-player-menu-toggle');
    const menu = documentRef?.getElementById('topbar-player-menu');
    if (!trackSelect || !toggleBtn || !menuWrap || !menuToggle || !menu) return;

    const setActiveTrack = (url, autoplay = false) => {
      const next = String(url || '').trim();
      if (!next || !audioManager) return;
      settingsState.musicUrl = next;
      audioManager.setMusicTrack?.(next, autoplay);
      saveUiSettings();
    };

    const shiftTrack = async (dir) => {
      if (!audioManager || !audioTrackOptions.length) return;
      if (typeof audioManager.playNextInPlaylist === 'function') {
        const ok = await audioManager.playNextInPlaylist(dir, true);
        if (!ok) showToast('Track konnte nicht gestartet werden.', 'warning');
        const snapshot = audioManager.snapshot ? audioManager.snapshot() : null;
        const currentUrl = String(snapshot?.musicUrl || '').trim();
        if (currentUrl) settingsState.musicUrl = currentUrl;
        saveUiSettings();
        refreshAudioUi();
        return;
      }

      const currentUrl = String(trackSelect.value || settingsState.musicUrl || '').trim();
      let index = audioTrackOptions.findIndex((entry) => String(entry.value) === currentUrl);
      if (index < 0) index = 0;
      const nextIndex = (index + dir + audioTrackOptions.length) % audioTrackOptions.length;
      const nextTrack = String(audioTrackOptions[nextIndex]?.value || '').trim();
      if (!nextTrack) return;
      setActiveTrack(nextTrack, false);
      const ok = await audioManager.playMusic();
      if (!ok) showToast('Track konnte nicht gestartet werden.', 'warning');
      refreshAudioUi();
    };

    menuToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = menu.classList.contains('hidden');
      if (!willOpen) {
        closeTopbarPlayerMenu();
        return;
      }
      closeTopbarSearchOverlay();
      closeCommanderMenuPanel();
      menu.classList.remove('hidden');
      menuWrap.classList.add('open');
      menuToggle.setAttribute('aria-expanded', 'true');
      setTopbarMenuFocusTrap(menu, menuToggle);
      syncTopbarBottomSheetState();
      focusFirstInTopbarMenu(menu, '#topbar-player-prev');
    });

    documentRef?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuWrap.contains(target)) return;
      closeTopbarPlayerMenu();
    });

    windowRef?.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      closeTopbarPlayerMenu();
    });

    trackSelect.addEventListener('change', () => {
      const selected = String(trackSelect.value || '').trim();
      if (!selected) return;
      setActiveTrack(selected, false);
      refreshAudioUi();
    });

    trackList?.addEventListener('click', async (event) => {
      const target = event.target;
      const button = (target instanceof Element) ? target.closest('.topbar-player-track-item') : null;
      if (!(button instanceof HTMLElement)) return;
      const selected = String(button.getAttribute('data-track') || '').trim();
      if (!selected || !audioManager) return;
      const wasPlaying = !!audioManager.snapshot?.()?.musicPlaying;
      setActiveTrack(selected, wasPlaying);
      if (wasPlaying && !audioManager.snapshot?.()?.musicPlaying) {
        const ok = await audioManager.playMusic();
        if (!ok) showToast('Track konnte nicht gestartet werden.', 'warning');
      }
      refreshAudioUi();
    });

    prevBtn?.addEventListener('click', async () => {
      await shiftTrack(-1);
    });
    nextBtn?.addEventListener('click', async () => {
      await shiftTrack(1);
    });
    nextQuickBtn?.addEventListener('click', async () => {
      await shiftTrack(1);
    });

    toggleBtn.addEventListener('click', async () => {
      if (!audioManager) return;
      const hasTrack = String(trackSelect.value || settingsState.musicUrl || '').trim();
      if (hasTrack && String(audioManager.snapshot?.()?.musicUrl || '').trim() !== hasTrack) {
        setActiveTrack(hasTrack, false);
      }

      const isPlaying = !!audioManager.snapshot?.()?.musicPlaying;
      if (isPlaying) {
        if (typeof audioManager.pauseMusic === 'function') audioManager.pauseMusic(false);
        else audioManager.stopMusic?.();
      } else {
        const ok = await audioManager.playMusic();
        if (!ok) showToast('Musik konnte nicht gestartet werden.', 'warning');
      }
      refreshAudioUi();
    });

    loadAudioTrackCatalog().catch((err) => {
      gameLog('info', 'Audio-Track-Katalog Laden in Settings fehlgeschlagen', err);
    });
    refreshAudioUi();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { bindAudioToggle, bindTopbarPlayer };
  } else {
    window.GQRuntimeTopbarAudioControls = { bindAudioToggle, bindTopbarPlayer };
  }
})();