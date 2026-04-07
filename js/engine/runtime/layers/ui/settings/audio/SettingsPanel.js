/**
 * RuntimeAudioSettingsPanel.js
 *
 * Binds audio-related controls inside the settings panel.
 */

'use strict';

(function () {
  const DEFAULT_SCENE_TRACKS = {
    galaxy: 'music/Nebula_Overture.mp3',
    system: 'music/Nebula_Overture.mp3',
    battle: 'music/Nebula_Overture.mp3',
    ui: 'music/Nebula_Overture.mp3',
  };

  const DEFAULT_SFX_MAP = {
    uiClick: 'sfx/mixkit-video-game-retro-click-237.wav',
    uiConfirm: 'sfx/mixkit-quick-positive-video-game-notification-interface-265.wav',
    uiError: 'sfx/mixkit-negative-game-notification-249.wav',
    uiNotify: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
    navigation: 'sfx/mixkit-sci-fi-warp-slide-3113.wav',
    pvpToggle: 'sfx/mixkit-horn-suspense-transition-3112.wav',
    researchStart: 'sfx/mixkit-unlock-new-item-game-notification-254.wav',
    researchComplete: 'sfx/mixkit-casino-bling-achievement-2067.wav',
    fleetRecall: 'sfx/mixkit-space-shot-whoosh-3001.wav',
    messageSend: 'sfx/mixkit-space-coin-win-notification-271.wav',
    messageRead: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
    messageDelete: 'sfx/mixkit-falling-hit-757.wav',
    fleetAttack: 'sfx/mixkit-laser-gun-shot-3110.wav',
    fleetTransport: 'sfx/mixkit-space-deploy-whizz-3003.wav',
    fleetSpy: 'sfx/mixkit-night-vision-starting-2476.wav',
    fleetColonize: 'sfx/mixkit-medieval-show-fanfare-announcement-226.wav',
    fleetHarvest: 'sfx/mixkit-space-plasma-shot-3002.wav',
    buildComplete: 'sfx/mixkit-bonus-earned-in-video-game-2058.wav',
    fleetLaunch: 'sfx/mixkit-space-deploy-whizz-3003.wav',
  };

  function bindAudioSettingsPanel(opts = {}) {
    const {
      root = null,
      audioState = {},
      audioTrackOptions = [],
      settingsState = {},
      audioManager = null,
      bindRange = () => {},
      loadAudioTrackCatalog = () => {},
      showToast = () => {},
      saveUiSettings = () => {},
      refreshAudioUi = () => {},
      rerenderSettings = () => {},
    } = opts;

    if (!root) return;

    const setActiveTrack = (playerSelect, url, autoplay = false) => {
      const next = String(url || '').trim();
      if (!next) return;
      settingsState.musicUrl = next;
      const urlInput = root.querySelector('#set-music-url');
      if (urlInput) urlInput.value = next;
      if (playerSelect) playerSelect.value = next;
      if (audioManager && typeof audioManager.setMusicTrack === 'function') {
        audioManager.setMusicTrack(next, autoplay);
      }
      saveUiSettings();
    };

    const updatePlayerToggleLabel = (playerToggleBtn) => {
      if (!playerToggleBtn) return;
      const isPlaying = !!(audioManager && audioManager.snapshot && audioManager.snapshot().musicPlaying);
      playerToggleBtn.textContent = isPlaying ? 'Pause' : 'Play';
    };

    const previewSceneTrack = async (sceneKey, message) => {
      if (!audioManager || typeof audioManager.setScene !== 'function') return;
      audioManager.setScene(sceneKey, { autoplay: true, transition: 'dramatic', force: true });
      const ok = await audioManager.playMusic();
      if (!ok) showToast(message, 'warning');
    };

    const ttsApi = (typeof window !== 'undefined' && window.GQTTS) || null;

    const masterMute = root.querySelector('#set-master-mute');
    masterMute?.addEventListener('change', () => {
      settingsState.masterMuted = !!masterMute.checked;
      audioManager?.setMasterMuted?.(settingsState.masterMuted);
      saveUiSettings();
      refreshAudioUi();
    });

    const musicMute = root.querySelector('#set-music-mute');
    musicMute?.addEventListener('change', () => {
      settingsState.musicMuted = !!musicMute.checked;
      audioManager?.setMusicMuted?.(settingsState.musicMuted);
      saveUiSettings();
    });

    const sfxMute = root.querySelector('#set-sfx-mute');
    sfxMute?.addEventListener('change', () => {
      settingsState.sfxMuted = !!sfxMute.checked;
      audioManager?.setSfxMuted?.(settingsState.sfxMuted);
      saveUiSettings();
    });

    const ttsMute = root.querySelector('#set-tts-mute');
    ttsMute?.addEventListener('change', () => {
      settingsState.ttsMuted = !!ttsMute.checked;
      audioManager?.setTtsMuted?.(settingsState.ttsMuted);
      saveUiSettings();
    });

    const ttsAutoVoice = root.querySelector('#set-tts-auto-voice');
    ttsAutoVoice?.addEventListener('change', () => {
      settingsState.ttsAutoVoice = !!ttsAutoVoice.checked;
      if (ttsApi && typeof ttsApi.setAutoVoice === 'function') {
        ttsApi.setAutoVoice(settingsState.ttsAutoVoice);
      }
      saveUiSettings();
    });

    bindRange('#set-master-vol', '#set-master-vol-value', (value) => {
      settingsState.masterVolume = Math.max(0, Math.min(1, value / 100));
      audioManager?.setMasterVolume?.(settingsState.masterVolume);
      saveUiSettings();
    });

    bindRange('#set-music-vol', '#set-music-vol-value', (value) => {
      settingsState.musicVolume = Math.max(0, Math.min(1, value / 100));
      audioManager?.setMusicVolume?.(settingsState.musicVolume);
      saveUiSettings();
    });

    bindRange('#set-sfx-vol', '#set-sfx-vol-value', (value) => {
      settingsState.sfxVolume = Math.max(0, Math.min(1, value / 100));
      audioManager?.setSfxVolume?.(settingsState.sfxVolume);
      saveUiSettings();
    });

    bindRange('#set-tts-vol', '#set-tts-vol-value', (value) => {
      settingsState.ttsVolume = Math.max(0, Math.min(1, value / 100));
      audioManager?.setTtsVolume?.(settingsState.ttsVolume);
      saveUiSettings();
    });

    root.querySelector('#set-audio-test')?.addEventListener('click', () => {
      audioManager?.playUiConfirm?.();
    });

    root.querySelector('#set-tts-test')?.addEventListener('click', async () => {
      if (!ttsApi || typeof ttsApi.speak !== 'function') {
        showToast('TTS ist nicht verfuegbar.', 'warning');
        return;
      }
      const result = await ttsApi.speak('Systemcheck. Sprachausgabe aktiv.', { noCache: true });
      if (!result) {
        showToast('TTS-Test konnte nicht abgespielt werden.', 'warning');
      }
    });

    const transitionModeSelect = root.querySelector('#set-music-transition-mode');
    transitionModeSelect?.addEventListener('change', () => {
      const mode = String(transitionModeSelect.value || 'fade').toLowerCase() === 'cut' ? 'cut' : 'fade';
      settingsState.musicTransitionMode = mode;
      audioManager?.setMusicTransitionMode?.(mode);
      saveUiSettings();
    });

    root.querySelector('#set-music-preset')?.addEventListener('change', () => {
      const preset = String(root.querySelector('#set-music-preset')?.value || '').trim();
      if (!preset) return;
      const urlInput = root.querySelector('#set-music-url');
      if (urlInput) urlInput.value = preset;
      const playerSelect = root.querySelector('#set-player-track');
      if (playerSelect) playerSelect.value = preset;
      ['galaxy', 'system', 'battle', 'ui'].forEach((sceneKey) => {
        const input = root.querySelector(`#set-scene-${sceneKey}`);
        if (input && !String(input.value || '').trim()) {
          input.value = preset;
        }
      });
    });

    const playerSelect = root.querySelector('#set-player-track');
    const playerToggleBtn = root.querySelector('#set-player-toggle');
    const playerPrevBtn = root.querySelector('#set-player-prev');
    const playerNextBtn = root.querySelector('#set-player-next');

    const shiftTrack = async (dir) => {
      if (!audioTrackOptions.length) return;
      if (audioManager && typeof audioManager.playNextInPlaylist === 'function') {
        const ok = await audioManager.playNextInPlaylist(dir, true);
        if (!ok) showToast('Track konnte nicht gestartet werden.', 'warning');
        const snap = audioManager.snapshot ? audioManager.snapshot() : null;
        const currentUrl = String(snap?.musicUrl || '').trim();
        if (currentUrl) {
          settingsState.musicUrl = currentUrl;
          if (playerSelect) playerSelect.value = currentUrl;
        }
        saveUiSettings();
        refreshAudioUi();
        updatePlayerToggleLabel(playerToggleBtn);
        return;
      }

      const currentUrl = String(playerSelect?.value || settingsState.musicUrl || '').trim();
      let index = audioTrackOptions.findIndex((entry) => String(entry.value) === currentUrl);
      if (index < 0) index = 0;
      const nextIndex = (index + dir + audioTrackOptions.length) % audioTrackOptions.length;
      const nextTrack = String(audioTrackOptions[nextIndex]?.value || '').trim();
      if (!nextTrack) return;
      setActiveTrack(playerSelect, nextTrack, false);
      if (audioManager) {
        const ok = await audioManager.playMusic();
        if (!ok) showToast('Track konnte nicht gestartet werden.', 'warning');
      }
      updatePlayerToggleLabel(playerToggleBtn);
    };

    if (playerSelect) {
      const preselect = String(audioState.musicUrl || settingsState.musicUrl || audioTrackOptions[0]?.value || '').trim();
      if (preselect) playerSelect.value = preselect;
      playerSelect.addEventListener('change', () => {
        const selected = String(playerSelect.value || '').trim();
        if (!selected) return;
        setActiveTrack(playerSelect, selected, false);
      });
    }

    playerPrevBtn?.addEventListener('click', async () => {
      await shiftTrack(-1);
    });

    playerNextBtn?.addEventListener('click', async () => {
      await shiftTrack(1);
    });

    playerToggleBtn?.addEventListener('click', async () => {
      if (!audioManager) {
        showToast('Audio-Manager nicht verfuegbar.', 'warning');
        return;
      }

      const hasTrack = String(playerSelect?.value || settingsState.musicUrl || '').trim();
      if (hasTrack && String(audioManager.snapshot?.()?.musicUrl || '').trim() !== hasTrack) {
        setActiveTrack(playerSelect, hasTrack, false);
      }

      const isPlaying = !!audioManager.snapshot?.()?.musicPlaying;
      if (isPlaying) {
        if (typeof audioManager.pauseMusic === 'function') {
          audioManager.pauseMusic(false);
        } else {
          audioManager.stopMusic?.();
        }
      } else {
        const ok = await audioManager.playMusic();
        if (!ok) showToast('Musik konnte nicht gestartet werden.', 'warning');
      }
      updatePlayerToggleLabel(playerToggleBtn);
    });

    updatePlayerToggleLabel(playerToggleBtn);
    loadAudioTrackCatalog();

    const autoSceneMusic = root.querySelector('#set-auto-scene-music');
    autoSceneMusic?.addEventListener('change', () => {
      settingsState.autoSceneMusic = !!autoSceneMusic.checked;
      audioManager?.setAutoSceneMusic?.(settingsState.autoSceneMusic);
      saveUiSettings();
    });

    root.querySelector('#set-scene-apply')?.addEventListener('click', () => {
      const galaxyTrack = String(root.querySelector('#set-scene-galaxy')?.value || '').trim();
      const systemTrack = String(root.querySelector('#set-scene-system')?.value || '').trim();
      const battleTrack = String(root.querySelector('#set-scene-battle')?.value || '').trim();
      const uiTrack = String(root.querySelector('#set-scene-ui')?.value || '').trim();
      settingsState.sceneTracks = Object.assign({}, settingsState.sceneTracks, {
        galaxy: galaxyTrack,
        system: systemTrack,
        battle: battleTrack,
        ui: uiTrack,
      });
      audioManager?.setSceneTrack?.('galaxy', galaxyTrack);
      audioManager?.setSceneTrack?.('system', systemTrack);
      audioManager?.setSceneTrack?.('battle', battleTrack);
      audioManager?.setSceneTrack?.('ui', uiTrack);
      saveUiSettings();
      showToast('Szenenmusik gespeichert.', 'success');
    });

    root.querySelector('#set-sfx-apply')?.addEventListener('click', () => {
      const nextMap = Object.assign({}, settingsState.sfxMap);
      root.querySelectorAll('.set-sfx-select').forEach((node) => {
        const key = String(node.getAttribute('data-sfx-key') || '').trim();
        if (!key) return;
        nextMap[key] = String(node.value || '').trim();
      });
      settingsState.sfxMap = nextMap;
      if (audioManager && typeof audioManager.setSfxTrack === 'function') {
        Object.entries(nextMap).forEach(([key, track]) => audioManager.setSfxTrack(key, track));
      }
      saveUiSettings();
      showToast('SFX-Zuordnung gespeichert.', 'success');
    });

    root.querySelector('#set-audio-reset')?.addEventListener('click', () => {
      settingsState.musicUrl = '';
      settingsState.autoSceneMusic = true;
      settingsState.ttsVolume = 0.95;
      settingsState.ttsMuted = false;
      settingsState.ttsAutoVoice = true;
      settingsState.sceneTracks = Object.assign({}, DEFAULT_SCENE_TRACKS);
      settingsState.sfxMap = Object.assign({}, DEFAULT_SFX_MAP);
      if (audioManager) {
        audioManager.resetAudioDefaults?.();
        audioManager.setAutoSceneMusic?.(true);
        audioManager.setTtsVolume?.(0.95);
        audioManager.setTtsMuted?.(false);
      }
      if (ttsApi && typeof ttsApi.setAutoVoice === 'function') {
        ttsApi.setAutoVoice(true);
      }
      saveUiSettings();
      rerenderSettings();
      showToast('Audio auf Standardwerte zurueckgesetzt.', 'success');
    });

    root.querySelectorAll('.set-sfx-test').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!audioManager) return;
        const method = String(btn.getAttribute('data-sfx-test') || '').trim();
        if (method && typeof audioManager[method] === 'function') {
          audioManager[method]();
        }
      });
    });

    root.querySelector('#set-scene-preview-galaxy')?.addEventListener('click', async () => {
      await previewSceneTrack('galaxy', 'Galaxy-Track konnte nicht gestartet werden.');
    });
    root.querySelector('#set-scene-preview-system')?.addEventListener('click', async () => {
      await previewSceneTrack('system', 'System-Track konnte nicht gestartet werden.');
    });
    root.querySelector('#set-scene-preview-battle')?.addEventListener('click', async () => {
      await previewSceneTrack('battle', 'Battle-Track konnte nicht gestartet werden.');
    });
    root.querySelector('#set-scene-preview-ui')?.addEventListener('click', async () => {
      await previewSceneTrack('ui', 'UI-Track konnte nicht gestartet werden.');
    });

    root.querySelector('#set-music-apply')?.addEventListener('click', () => {
      const urlInput = root.querySelector('#set-music-url');
      const next = String(urlInput?.value || '').trim();
      settingsState.musicUrl = next;
      audioManager?.setMusicTrack?.(next, false);
      saveUiSettings();
      showToast(next ? 'Musik-URL gespeichert.' : 'Musik-URL entfernt.', 'info');
    });

    root.querySelector('#set-music-play')?.addEventListener('click', async () => {
      if (!audioManager) return;
      const ok = await audioManager.playMusic();
      if (!ok) showToast('Musik konnte nicht gestartet werden (Autoplay/URL).', 'warning');
    });

    root.querySelector('#set-music-stop')?.addEventListener('click', () => {
      audioManager?.stopMusic?.();
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { bindAudioSettingsPanel };
  } else {
    window.GQRuntimeAudioSettingsPanel = { bindAudioSettingsPanel };
  }
})();
