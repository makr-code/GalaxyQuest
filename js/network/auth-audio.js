/**
 * Auth Audio Module
 * Handles audio playback during authentication flow.
 * Manages title track preloading, audio warmup, and playlist randomization.
 */

const AuthAudio = (() => {
  let _audioManager = null;
  let _audioUnlockInstalled = false;

  /**
   * Get or create shared audio manager from runtime
   * @returns {object|null} Audio manager or null if not available
   */
  const ensureSharedAudioManager = () => {
    if (_audioManager) return _audioManager;

    // Try to get from window.audio (if audio.js is loaded)
    if (typeof window !== 'undefined' && window.audio) {
      _audioManager = window.audio;
      return _audioManager;
    }

    // Return null if not available
    return null;
  };

  /**
   * Install user gesture audio unlock handler
   * Some browsers require user interaction to play audio
   */
  const installAudioUnlock = () => {
    if (_audioUnlockInstalled) return;
    _audioUnlockInstalled = true;

    const unlock = async () => {
      const manager = ensureSharedAudioManager();
      if (!manager) return;

      try {
        // Create silent audio context interaction
        const audioContext = manager.getContext?.() || manager.audioContext;
        if (audioContext && audioContext.state === 'suspended') {
          await audioContext.resume();
          if (typeof window !== 'undefined' && window.GQLog?.debug) {
            window.GQLog.debug('[auth-audio]', 'Audio context resumed via user gesture');
          }
        }
      } catch (error) {
        if (typeof window !== 'undefined' && window.GQLog?.warn) {
          window.GQLog.warn('[auth-audio]', `Audio unlock failed: ${String(error?.message || error || 'unknown')}`);
        }
      }

      // Remove listeners after unlock
      ['click', 'keydown', 'touchstart'].forEach((event) => {
        document.removeEventListener(event, unlock);
      });
    };

    // Bind to multiple events for cross-browser compatibility
    ['click', 'keydown', 'touchstart'].forEach((event) => {
      document.addEventListener(event, unlock, { once: true, passive: true });
    });
  };

  /**
   * Warm up audio assets by preloading
   * @param {Array<string>} assetUrls - Audio URLs to preload
   * @returns {Promise<void>} Resolves when preload complete
   */
  const warmAudioAssets = async (assetUrls = []) => {
    if (!Array.isArray(assetUrls) || assetUrls.length === 0) {
      return;
    }

    const manager = ensureSharedAudioManager();
    if (!manager) return;

    // If manager has preload method, use it
    if (typeof manager.preload === 'function') {
      try {
        await manager.preload(assetUrls);
      } catch (error) {
        if (typeof window !== 'undefined' && window.GQLog?.debug) {
          window.GQLog.debug('[auth-audio]', `Audio preload warning: ${String(error?.message || error || 'unknown')}`);
        }
      }
      return;
    }

    // Fallback: preload via Audio objects
    const promises = assetUrls.map((url) => {
      return new Promise((resolve) => {
        const audio = new Audio();
        audio.preload = 'auto';
        const onComplete = () => {
          audio.removeEventListener('canplaythrough', onComplete);
          audio.removeEventListener('error', onComplete);
          resolve();
        };
        audio.addEventListener('canplaythrough', onComplete);
        audio.addEventListener('error', onComplete);
        audio.src = url;
      });
    });

    try {
      await Promise.all(promises);
    } catch (error) {
      if (typeof window !== 'undefined' && window.GQLog?.debug) {
        window.GQLog.debug('[auth-audio]', `Audio asset warmup partial failure: ${String(error?.message || error || 'unknown')}`);
      }
    }
  };

  /**
   * Pick a random item from an array
   * @param {Array} items - Array of items
   * @returns {any|null} Random item or null if array is empty
   */
  const pickRandomItem = (items) => {
    if (!Array.isArray(items) || items.length === 0) return null;
    return items[Math.floor(Math.random() * items.length)];
  };

  /**
   * Pick random item avoiding a specific value
   * @param {Array} items - Array of items
   * @param {any} avoid - Value to avoid
   * @returns {any|null} Random item (different from avoid)
   */
  const pickRandomItemAvoiding = (items, avoid) => {
    if (!Array.isArray(items) || items.length === 0) return null;
    const filtered = items.filter((item) => item !== avoid);
    return filtered.length > 0 ? pickRandomItem(filtered) : pickRandomItem(items);
  };

  /**
   * Pick a random title track, avoiding last one if stored
   * @param {Array<string>} titleTracks - Array of track URLs
   * @returns {string|null} Selected track URL
   */
  const pickRandomTitleTrack = (titleTracks) => {
    if (!Array.isArray(titleTracks) || titleTracks.length === 0) {
      return null;
    }

    if (titleTracks.length === 1) {
      return titleTracks[0];
    }

    // Try to get last track from boot assets
    let lastTrack = null;
    if (typeof AuthBootAssets !== 'undefined' && typeof AuthBootAssets.getLastTitleTrack === 'function') {
      lastTrack = AuthBootAssets.getLastTitleTrack();
    }

    const selected = lastTrack ? pickRandomItemAvoiding(titleTracks, lastTrack) : pickRandomItem(titleTracks);

    // Store selection for next time
    if (selected && typeof AuthBootAssets !== 'undefined' && typeof AuthBootAssets.setLastTitleTrack === 'function') {
      AuthBootAssets.setLastTitleTrack(selected);
    }

    return selected;
  };

  /**
   * Prime auth audio: unlock, warmup, select title track
   * @param {object} options - Options { titleTracks, assetUrls }
   * @returns {Promise<object>} Result { track, ready }
   */
  const primeAuthAudio = async (options = {}) => {
    try {
      // Unlock audio context on user interaction
      installAudioUnlock();

      // Ensure audio manager is ready
      ensureSharedAudioManager();

      // Warm up assets if provided
      if (Array.isArray(options.assetUrls) && options.assetUrls.length > 0) {
        await warmAudioAssets(options.assetUrls);
      }

      // Pick title track if available
      let track = null;
      if (Array.isArray(options.titleTracks) && options.titleTracks.length > 0) {
        track = pickRandomTitleTrack(options.titleTracks);
      }

      return {
        ready: true,
        track,
      };
    } catch (error) {
      if (typeof window !== 'undefined' && window.GQLog?.warn) {
        window.GQLog.warn('[auth-audio]', `Audio prime failed: ${String(error?.message || error || 'unknown')}`);
      }

      return {
        ready: false,
        error: String(error?.message || error || 'unknown'),
      };
    }
  };

  /**
   * Play a specific audio track
   * @param {string} trackUrl - Track URL
   * @returns {Promise<void>} Resolves when play starts
   */
  const playTrack = async (trackUrl) => {
    if (!trackUrl || typeof trackUrl !== 'string') {
      return;
    }

    const manager = ensureSharedAudioManager();
    if (!manager) return;

    try {
      if (typeof manager.play === 'function') {
        await manager.play(trackUrl);
      } else {
        // Fallback: create Audio element
        const audio = new Audio(trackUrl);
        audio.play();
      }
    } catch (error) {
      if (typeof window !== 'undefined' && window.GQLog?.debug) {
        window.GQLog.debug('[auth-audio]', `Play track failed: ${String(error?.message || error || 'unknown')}`);
      }
    }
  };

  /**
   * Stop any currently playing audio
   */
  const stopAudio = () => {
    const manager = ensureSharedAudioManager();
    if (!manager) return;

    try {
      if (typeof manager.stop === 'function') {
        manager.stop();
      }
    } catch (error) {
      // Ignore stop errors
    }
  };

  // Public exports
  return {
    ensureSharedAudioManager,
    installAudioUnlock,
    warmAudioAssets,
    pickRandomItem,
    pickRandomItemAvoiding,
    pickRandomTitleTrack,
    primeAuthAudio,
    playTrack,
    stopAudio,
  };
})();

// Export for use in browser
if (typeof window !== 'undefined') {
  window.AuthAudio = AuthAudio;
}
