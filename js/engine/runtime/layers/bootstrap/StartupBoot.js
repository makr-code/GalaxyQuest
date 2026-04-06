/**
 * StartupBoot.js
 *
 * Handles startup galaxy open, initial audio scene, and unlock listeners.
 */

'use strict';

(function () {
  function initStartupBoot(opts = {}) {
    const {
      wm = null,
      audioManager = null,
      loadAudioTrackCatalog = () => Promise.resolve(),
      refreshAudioUi = () => {},
      gameLog = () => {},
      windowRef = (typeof window !== 'undefined' ? window : null),
    } = opts;

    wm?.open?.('galaxy');

    if (audioManager && typeof audioManager.setScene === 'function') {
      audioManager.setScene('galaxy', { autoplay: true, transition: 'fast', force: true });

      if (!windowRef.__GQ_AUDIO_UNLOCK_INSTALLED) {
        windowRef.__GQ_AUDIO_UNLOCK_INSTALLED = true;
        let unlocked = false;
        const listeners = [];

        const clearListeners = () => {
          listeners.forEach(({ type, handler, opts: listenerOpts }) => {
            try {
              windowRef.removeEventListener(type, handler, listenerOpts);
            } catch (err) {
              gameLog('info', `Audio-Unlock Listener-Entfernung fehlgeschlagen (${type})`, err);
            }
          });
          listeners.length = 0;
        };

        const resumeOnInteract = async () => {
          if (unlocked) return;
          try {
            const snapshot = audioManager.snapshot ? audioManager.snapshot() : null;
            const muted = !!(snapshot?.masterMuted || snapshot?.musicMuted);
            const hasTrack = String(snapshot?.musicUrl || '').trim() !== '';
            if (muted || !hasTrack) return;
            const ok = await audioManager.playMusic();
            if (ok) {
              unlocked = true;
              clearListeners();
            }
          } catch (err) {
            gameLog('info', 'Audio resume on interaction fehlgeschlagen', err);
          }
        };

        const bind = (type, listenerOpts) => {
          windowRef.addEventListener(type, resumeOnInteract, listenerOpts);
          listeners.push({ type, handler: resumeOnInteract, opts: listenerOpts });
        };

        bind('pointerdown', { passive: true });
        bind('click', { passive: true });
        bind('touchstart', { passive: true });
        bind('keydown', false);
      }
    }

    refreshAudioUi();
    loadAudioTrackCatalog().catch((err) => {
      gameLog('info', 'Initiales Laden des Audio-Track-Katalogs fehlgeschlagen', err);
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initStartupBoot };
  } else {
    window.GQRuntimeStartupBoot = { initStartupBoot };
  }
})();
