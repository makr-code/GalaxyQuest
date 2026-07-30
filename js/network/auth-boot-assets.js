/**
 * Auth Bootstrap Assets Module
 * Handles asset versioning, script/package preloading, and boot constants.
 * Provides centralized management of asset paths and versions for the auth flow.
 */

const AuthBootAssets = (() => {
  // Asset version resolver: uses window.GQResolveAssetVersion if available,
  // otherwise falls back to direct version lookup from __GQ_ASSET_VERSIONS
  const withAssetVersion = typeof window.GQResolveAssetVersion === 'function'
    ? window.GQResolveAssetVersion.bind(window)
    : function fallbackAssetVersion(path, versionKey, fallbackVersion) {
        const assetVersions = window.__GQ_ASSET_VERSIONS || {};
        const version = String(assetVersions?.[versionKey] || fallbackVersion || '').trim();
        return version ? `${path}?v=${version}` : path;
      };

  // Main runtime scripts loaded during auth flow
  const AUDIO_SCRIPT = withAssetVersion('js/runtime/audio.js', 'audio', '20260404p50');
  const GQUI_SCRIPT = withAssetVersion('js/ui/gq-ui.js', 'gqui', '20260330p1');
  const WM_SCRIPT = withAssetVersion('js/runtime/wm.js', 'wm', '20260406p2');
  const WM_WIDGETS_SCRIPT = withAssetVersion('js/runtime/wm-widgets.js', 'wmWidgets', '20260406p2');
  const GQWM_SCRIPT = withAssetVersion('js/runtime/gqwm.js', 'gqwm', '20260406p2');

  // Audio assets to preload during auth
  const AUDIO_PRELOAD = [
    'music/Nebula_Overture.mp3',
    'sfx/mixkit-video-game-retro-click-237.wav',
    'sfx/mixkit-quick-positive-video-game-notification-interface-265.wav',
    'sfx/mixkit-negative-game-notification-249.wav',
    'sfx/mixkit-sci-fi-positive-notification-266.wav',
    'sfx/mixkit-sci-fi-warp-slide-3113.wav',
  ];

  // Local storage keys for auth state
  const LAST_TITLE_TRACK_KEY = 'gq_last_title_track';
  const FLIGHT_PROFILE_KEY = 'gq_auth_flight_profile';
  const DEFAULT_FLIGHT_PROFILE = 'cinematic';

  /**
   * Get the versioned path for a given asset
   * @param {string} path - Relative asset path (e.g., 'js/runtime/audio.js')
   * @param {string} versionKey - Key in __GQ_ASSET_VERSIONS (e.g., 'audio')
   * @param {string} fallbackVersion - Fallback version string
   * @returns {string} Versioned asset path
   */
  const getAssetPath = (path, versionKey, fallbackVersion) => {
    return withAssetVersion(path, versionKey, fallbackVersion);
  };

  /**
   * Load a script tag dynamically
   * @param {string} src - Script source URL
   * @param {object} options - Options (async, defer, integrity, etc.)
   * @returns {Promise<void>} Resolves when script loads
   */
  const loadScript = (src, options = {}) => {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = options.async !== false;
      if (options.defer) script.defer = true;
      if (options.integrity) script.integrity = options.integrity;
      if (options.type) script.type = options.type;
      if (options.attributes) {
        Object.entries(options.attributes).forEach(([key, val]) => {
          script.setAttribute(key, val);
        });
      }

      const handleLoad = () => {
        script.removeEventListener('load', handleLoad);
        script.removeEventListener('error', handleError);
        resolve();
      };

      const handleError = () => {
        script.removeEventListener('load', handleLoad);
        script.removeEventListener('error', handleError);
        reject(new Error(`Failed to load script: ${src}`));
      };

      script.addEventListener('load', handleLoad);
      script.addEventListener('error', handleError);

      if (document.head) {
        document.head.appendChild(script);
      } else {
        reject(new Error('document.head not available'));
      }
    });
  };

  /**
   * Preload audio assets
   * @param {Array<string>} audioUrls - Array of audio URLs to preload
   * @returns {Promise<void>} Resolves when preload completes
   */
  const preloadAudioAssets = async (audioUrls = AUDIO_PRELOAD) => {
    if (!Array.isArray(audioUrls) || audioUrls.length === 0) {
      return;
    }

    const promises = audioUrls.map((url) => {
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

    return Promise.all(promises).then(() => {
      // Preload complete
    });
  };

  /**
   * Get stored flight profile preference
   * @returns {string} Flight profile ('cinematic', etc.)
   */
  const getFlightProfile = () => {
    try {
      return localStorage.getItem(FLIGHT_PROFILE_KEY) || DEFAULT_FLIGHT_PROFILE;
    } catch (_) {
      return DEFAULT_FLIGHT_PROFILE;
    }
  };

  /**
   * Set and store flight profile preference
   * @param {string} profile - Flight profile name
   */
  const setFlightProfile = (profile) => {
    try {
      if (profile && typeof profile === 'string') {
        localStorage.setItem(FLIGHT_PROFILE_KEY, profile);
      }
    } catch (_) {
      // Ignore localStorage errors
    }
  };

  /**
   * Get the last title track played
   * @returns {string|null} Last title track URL or null
   */
  const getLastTitleTrack = () => {
    try {
      return localStorage.getItem(LAST_TITLE_TRACK_KEY) || null;
    } catch (_) {
      return null;
    }
  };

  /**
   * Store the title track being played
   * @param {string} trackUrl - Track URL
   */
  const setLastTitleTrack = (trackUrl) => {
    try {
      if (trackUrl && typeof trackUrl === 'string') {
        localStorage.setItem(LAST_TITLE_TRACK_KEY, trackUrl);
      }
    } catch (_) {
      // Ignore localStorage errors
    }
  };

  // Public exports
  return {
    // Scripts
    AUDIO_SCRIPT,
    GQUI_SCRIPT,
    WM_SCRIPT,
    WM_WIDGETS_SCRIPT,
    GQWM_SCRIPT,

    // Assets
    AUDIO_PRELOAD,

    // Keys
    LAST_TITLE_TRACK_KEY,
    FLIGHT_PROFILE_KEY,
    DEFAULT_FLIGHT_PROFILE,

    // Functions
    getAssetPath,
    loadScript,
    preloadAudioAssets,
    getFlightProfile,
    setFlightProfile,
    getLastTitleTrack,
    setLastTitleTrack,
  };
})();

// Export for use in browser
if (typeof window !== 'undefined') {
  window.AuthBootAssets = AuthBootAssets;
}
