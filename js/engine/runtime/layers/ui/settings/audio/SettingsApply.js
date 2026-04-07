/**
 * RuntimeAudioSettingsApply.js
 *
 * Syncs loaded runtime settings into AudioManager.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

(function () {
  function applyLoadedAudioSettings(opts = {}) {
    const {
      audioManager = null,
      settingsState = null,
    } = opts;

    if (!audioManager || !settingsState || typeof settingsState !== 'object') return;

    const audioSnapshot = audioManager.snapshot?.() || null;
    if (audioSnapshot?.sfxMap && typeof audioSnapshot.sfxMap === 'object') {
      settingsState.sfxMap = Object.assign({}, settingsState.sfxMap || {}, audioSnapshot.sfxMap);
    }
    if (audioSnapshot?.musicTransitionMode) {
      settingsState.musicTransitionMode = String(audioSnapshot.musicTransitionMode || 'fade').toLowerCase() === 'cut' ? 'cut' : 'fade';
    }

    audioManager.setMasterVolume(settingsState.masterVolume);
    audioManager.setMusicVolume(settingsState.musicVolume);
    audioManager.setSfxVolume(settingsState.sfxVolume);
    audioManager.setMasterMuted(settingsState.masterMuted);
    audioManager.setMusicMuted(settingsState.musicMuted);
    audioManager.setSfxMuted(settingsState.sfxMuted);

    if (typeof audioManager.setMusicTransitionMode === 'function') {
      audioManager.setMusicTransitionMode(settingsState.musicTransitionMode);
    }
    if (typeof audioManager.setAutoSceneMusic === 'function') {
      audioManager.setAutoSceneMusic(!!settingsState.autoSceneMusic);
    }
    if (typeof audioManager.setSceneTrack === 'function') {
      ['galaxy', 'system', 'battle', 'ui'].forEach((sceneKey) => {
        audioManager.setSceneTrack(sceneKey, settingsState.sceneTracks?.[sceneKey] || '');
      });
    }
    if (typeof audioManager.setSfxTrack === 'function') {
      Object.entries(settingsState.sfxMap || {}).forEach(([eventKey, trackUrl]) => {
        audioManager.setSfxTrack(eventKey, trackUrl || '');
      });
    }
    if (settingsState.musicUrl) {
      audioManager.setMusicTrack(settingsState.musicUrl, false);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { applyLoadedAudioSettings };
  } else {
    window.GQRuntimeAudioSettingsApply = { applyLoadedAudioSettings };
  }
})();
