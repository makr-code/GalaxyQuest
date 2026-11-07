/*
 * GalaxyQuest audio manager
 * Lightweight bus-based audio controls for music and SFX.
 */
(function () {
  const DEFAULT_MUSIC_TRACK = 'music/Nebula_Overture.mp3';
  const DEFAULT_SCENE_TRACKS = {
    galaxy: DEFAULT_MUSIC_TRACK,
    system: DEFAULT_MUSIC_TRACK,
    battle: DEFAULT_MUSIC_TRACK,
    ui: DEFAULT_MUSIC_TRACK,
  };
  const DEFAULT_SFX = {
    uiClick: 'sfx/mixkit-video-game-retro-click-237.wav',
    uiConfirm: 'sfx/mixkit-quick-positive-video-game-notification-interface-265.wav',
    uiError: 'sfx/mixkit-negative-game-notification-249.wav',
    uiNotify: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
    navigation: 'sfx/mixkit-sci-fi-warp-slide-3113.wav',
    researchStart: 'sfx/mixkit-unlock-new-item-game-notification-254.wav',
    researchComplete: 'sfx/mixkit-casino-bling-achievement-2067.wav',
    fleetRecall: 'sfx/mixkit-space-shot-whoosh-3001.wav',
    messageSend: 'sfx/mixkit-space-coin-win-notification-271.wav',
    messageRead: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
    messageDelete: 'sfx/mixkit-falling-hit-757.wav',
    pvpToggle: 'sfx/mixkit-horn-suspense-transition-3112.wav',
    fleetAttack: 'sfx/mixkit-laser-gun-shot-3110.wav',
    fleetTransport: 'sfx/mixkit-space-deploy-whizz-3003.wav',
    fleetSpy: 'sfx/mixkit-night-vision-starting-2476.wav',
    fleetColonize: 'sfx/mixkit-medieval-show-fanfare-announcement-226.wav',
    fleetHarvest: 'sfx/mixkit-space-plasma-shot-3002.wav',
    buildComplete: 'sfx/mixkit-bonus-earned-in-video-game-2058.wav',
    fleetLaunch: 'sfx/mixkit-space-deploy-whizz-3003.wav',
  };

  const AUDIO_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 180;
  const MAX_SFX_COOLDOWN_ENTRIES = 128;
  const AUDIO_PERSIST_KEYS = [
    'masterVolume',
    'musicVolume',
    'sfxVolume',
    'teaserVolume',
    'ttsVolume',
    'masterMuted',
    'musicMuted',
    'sfxMuted',
    'teaserMuted',
    'ttsMuted',
    'musicTransitionMode',
    'musicDuckingEnabled',
    'musicDuckingStrength',
    'musicUrl',
    'autoSceneMusic',
    'currentScene',
    'musicPaused',
  ];

  class GQAudioManager {
    constructor(opts = {}) {
      this.storageKey = String(opts.storageKey || 'gq_audio_settings');
      this.cookieKey = String(opts.cookieKey || this.storageKey);
      this.sessionKey = String(opts.sessionKey || `${this.storageKey}_session`);
      this.state = {
        masterVolume: 0.8,
        musicVolume: 0.55,
        sfxVolume: 0.8,
        teaserVolume: 0.9,
        ttsVolume: 0.95,
        masterMuted: false,
        musicMuted: false,
        sfxMuted: false,
        teaserMuted: false,
        ttsMuted: false,
        musicTransitionMode: 'fade',
        musicDuckingEnabled: true,
        musicDuckingStrength: 0.55,
        musicUrl: '',
        autoSceneMusic: true,
        currentScene: 'ui',
        musicPaused: false,
        sceneTracks: Object.assign({}, DEFAULT_SCENE_TRACKS),
        sfxMap: Object.assign({}, DEFAULT_SFX),
      };

      this._musicA = new Audio();
      this._musicB = new Audio();
      this._music = this._musicA;
      [this._musicA, this._musicB].forEach((el) => {
        el.loop = true;
        el.preload = 'none';
        el.crossOrigin = 'anonymous';
      });
      this._playlist = [];
      this._playlistIndex = -1;
      this._playlistMode = 'shuffle';
      this._musicTransitionToken = 0;
      this._musicDeckTransitionTokens = new Map([[this._musicA, 0], [this._musicB, 0]]);
      this._sceneFadeMs = 460;
      this._sceneTransitionFades = {
        fast: 260,
        normal: 460,
        soft: 720,
        dramatic: 980,
      };
      this._fadeRaf = 0;
      this._fadeToken = 0;
      this._fadeResolve = null;
      this._isFading = false;
      this._duckFactor = 1;
      this._duckTimer = 0;
      this._speakingAudio = new Set();
      this._ttsAudioCleanup = new Map();
      this._transientAudioCleanup = new Map();
      this._transientAudioLevels = new Map();
      this._scheduledTimeouts = new Set();
      this._musicElementHandlers = new Map();
      this._activeToneOscillators = new Map();
      this._disposed = false;
      this._disposePromise = null;
      this._lastSceneChangeMs = 0;
      this._audioContext = null;
      this._gain = null;
      this._synth = null;
      this._musicPlayToken = 0;
      this._musicPlayIntent = false;
      this._sfxLastPlayAt = new Map();
      this._sfxTeaserLastPlayAt = new Map();
      this._lastAudioEvent = null;

      this._logPrefix = '[GQ][Audio]';

      this._bindMusicElement(this._musicA);
      this._bindMusicElement(this._musicB);

      this._load();
      this._bootstrapDefaultMedia();
      this._applyVolumes();
      if (this.state.musicUrl) {
        this.setMusicTrack(this.state.musicUrl, false);
      }
    }

    _bindMusicElement(el) {
      if (!el) return;
      const onError = () => {
        const mediaError = el.error;
        this._log('error', 'Media-Element Fehler beim Laden/Abspielen', {
          track: this._prettyTrack(el.currentSrc || el.src || ''),
          code: mediaError ? mediaError.code : null,
          message: this._mediaErrorMessage(mediaError ? mediaError.code : null),
        });
      };

      const onEnded = () => {
        if (el !== this._music) return;
        this._onMusicEnded();
      };
      el.addEventListener('error', onError);
      el.addEventListener('ended', onEnded);
      this._musicElementHandlers.set(el, { onError, onEnded });
    }

    _scheduleTimeout(callback, delayMs) {
      if (this._disposed) return 0;
      let timeoutId = 0;
      timeoutId = window.setTimeout(() => {
        this._scheduledTimeouts.delete(timeoutId);
        if (!this._disposed) callback();
      }, delayMs);
      this._scheduledTimeouts.add(timeoutId);
      return timeoutId;
    }

    _trackTransientAudio(audio, channel, gain = 1) {
      const release = () => {
        audio.removeEventListener('ended', release);
        audio.removeEventListener('error', release);
        this._transientAudioCleanup.delete(audio);
        this._transientAudioLevels.delete(audio);
      };
      audio.addEventListener('ended', release);
      audio.addEventListener('error', release);
      this._transientAudioCleanup.set(audio, release);
      this._transientAudioLevels.set(audio, { channel, gain });
      return audio;
    }

    _releaseTransientAudio(audio, stopPlayback = false) {
      const release = this._transientAudioCleanup.get(audio);
      if (!release) return;
      release();
      if (!stopPlayback) return;
      try {
        if (typeof audio.pause === 'function') audio.pause();
      } finally {
        audio.removeAttribute('src');
        audio.load();
      }
    }

    _handleTransientAudioFailure(audio, message, error) {
      if (audio) {
        try {
          this._releaseTransientAudio(audio, true);
        } catch (cleanupError) {
          this._log('error', 'Transient-Audio-Cleanup fehlgeschlagen', { error: String(cleanupError) });
        }
      }
      this._log('warn', message, { error: String(error) });
    }

    _otherMusicDeck(el = this._music) {
      return el === this._musicA ? this._musicB : this._musicA;
    }

    _bootstrapDefaultMedia() {
      if (!this.state.sceneTracks || typeof this.state.sceneTracks !== 'object') {
        this.state.sceneTracks = Object.assign({}, DEFAULT_SCENE_TRACKS);
      }

      const keys = ['galaxy', 'system', 'battle', 'ui'];
      let hasAnyTrack = false;
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        const existing = String(this.state.sceneTracks[key] || '').trim();
        if (existing) hasAnyTrack = true;
      }

      if (!hasAnyTrack) {
        this.state.sceneTracks = Object.assign({}, DEFAULT_SCENE_TRACKS);
      }

      if (!this.state.sfxMap || typeof this.state.sfxMap !== 'object') {
        this.state.sfxMap = Object.assign({}, DEFAULT_SFX);
      } else {
        this.state.sfxMap = Object.assign({}, DEFAULT_SFX, this.state.sfxMap);
      }

      this.state.musicPaused = !!this.state.musicPaused;

      this._save();
    }

    _resolveSfxTrack(key) {
      const map = this.state.sfxMap || {};
      const name = String(key || '').trim();
      return String(map[name] || DEFAULT_SFX[name] || '').trim();
    }

    _isSfxRateLimited(history, src, now, minIntervalMs) {
      const interval = Number(minIntervalMs);
      const cooldownMs = Number.isFinite(interval) ? Math.max(0, interval) : 0;
      const previous = history.get(src);
      if (previous !== undefined && (now - previous) < cooldownMs) return true;

      history.delete(src);
      while (history.size >= MAX_SFX_COOLDOWN_ENTRIES) {
        history.delete(history.keys().next().value);
      }
      history.set(src, now);
      return false;
    }

    _rememberAudioEvent(key) {
      const name = String(key || '').trim();
      if (!name) return;
      this._lastAudioEvent = {
        key: name,
        ts: Date.now(),
      };
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('gq:audio-event', { detail: Object.assign({}, this._lastAudioEvent) }));
        }
      } catch (_) {}
    }

    _prettyTrack(url) {
      const raw = String(url || '').trim();
      if (!raw) return '(kein Track)';
      try {
        const parsed = new URL(raw, window.location.href);
        const marker = '/music/';
        const idx = parsed.pathname.toLowerCase().indexOf(marker);
        if (idx >= 0) return parsed.pathname.slice(idx + 1);
        return parsed.pathname.replace(/^\/+/, '') || parsed.href;
      } catch (_) {
        return raw;
      }
    }

    _mediaErrorMessage(code) {
      if (code === 1) return 'MEDIA_ERR_ABORTED';
      if (code === 2) return 'MEDIA_ERR_NETWORK';
      if (code === 3) return 'MEDIA_ERR_DECODE';
      if (code === 4) return 'MEDIA_ERR_SRC_NOT_SUPPORTED';
      return 'MEDIA_ERR_UNKNOWN';
    }

    _toAbsoluteTrackUrl(url) {
      const raw = String(url || '').trim();
      if (!raw) return '';
      try {
        return new URL(raw, window.location.href).href;
      } catch (_) {
        return raw;
      }
    }

    _log(level, message, data = null) {
      try {
        const method = (level === 'error' || level === 'warn' || level === 'info') ? level : 'log';
        if (data && typeof console[method] === 'function') {
          console[method](this._logPrefix, message, data);
        } else if (typeof console[method] === 'function') {
          console[method](this._logPrefix, message);
        }
      } catch (_) {}
    }

    _emitStateChange() {
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('gq:audio-state', { detail: this.snapshot() }));
        }
      } catch (_) {}
    }

    _loadPersistedStateFromCookie() {
      try {
        const cookieText = String(document.cookie || '');
        if (!cookieText) return null;
        const safeName = String(this.cookieKey || this.storageKey).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = cookieText.match(new RegExp(`(?:^|;\\s*)${safeName}=([^;]*)`));
        if (!m || !m[1]) return null;
        const jsonText = decodeURIComponent(m[1]);
        const parsed = JSON.parse(jsonText);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch (_) {
        return null;
      }
    }

    _loadPersistedStateFromSession() {
      try {
        const raw = sessionStorage.getItem(this.sessionKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch (_) {
        return null;
      }
    }

    _buildPortableState() {
      const compact = {};
      for (let i = 0; i < AUDIO_PERSIST_KEYS.length; i += 1) {
        const key = AUDIO_PERSIST_KEYS[i];
        if (Object.prototype.hasOwnProperty.call(this.state, key)) {
          compact[key] = this.state[key];
        }
      }
      return compact;
    }

    _savePortableState() {
      const compact = this._buildPortableState();
      try {
        sessionStorage.setItem(this.sessionKey, JSON.stringify(compact));
      } catch (_) {}

      try {
        const serialized = encodeURIComponent(JSON.stringify(compact));
        document.cookie = `${this.cookieKey}=${serialized}; Max-Age=${AUDIO_COOKIE_MAX_AGE_SEC}; Path=/; SameSite=Lax`;
      } catch (_) {}
    }

    _load() {
      const merged = {};
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            Object.assign(merged, parsed);
          }
        }
      } catch (_) {}

      const cookieState = this._loadPersistedStateFromCookie();
      if (cookieState) Object.assign(merged, cookieState);

      const sessionState = this._loadPersistedStateFromSession();
      if (sessionState) Object.assign(merged, sessionState);

      if (Object.keys(merged).length) {
        this.state = Object.assign({}, this.state, merged);
      }
    }

    _save() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.state));
      } catch (_) {}
      this._savePortableState();
    }

    _applyVolumes() {
      for (const [audio, { channel, gain }] of this._transientAudioLevels) {
        audio.volume = this._targetTransientVolume(channel, gain);
      }
      if (this._isFading) return;
      const active = this._music;
      const inactive = this._otherMusicDeck(active);
      if (active) active.volume = this._targetMusicVolume();
      if (inactive && inactive !== active) inactive.volume = 0;
    }

    _targetTransientVolume(channel, gain = 1) {
      const master = this.state.masterMuted ? 0 : Number(this.state.masterVolume || 0);
      const channelMuted = this.state[`${channel}Muted`];
      const channelVolume = channelMuted ? 0 : Number(this.state[`${channel}Volume`] || 0);
      const eventGain = Number(gain);
      const volume = master * channelVolume * eventGain;
      return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    }

    _syncMusicLoopMode() {
      const shouldLoop = this._playlist.length <= 1;
      this._musicA.loop = shouldLoop;
      this._musicB.loop = shouldLoop;
    }

    _syncPlaylistIndexFromCurrentTrack() {
      if (!this._playlist.length) {
        this._playlistIndex = -1;
        this._syncMusicLoopMode();
        return;
      }
      const currentAbs = this._toAbsoluteTrackUrl(this._music.currentSrc || this._music.src || this.state.musicUrl || '');
      if (!currentAbs) {
        if (this._playlistIndex < 0 || this._playlistIndex >= this._playlist.length) this._playlistIndex = 0;
        this._syncMusicLoopMode();
        return;
      }
      let found = -1;
      for (let i = 0; i < this._playlist.length; i += 1) {
        if (this._toAbsoluteTrackUrl(this._playlist[i]) === currentAbs) {
          found = i;
          break;
        }
      }
      this._playlistIndex = found;
      this._syncMusicLoopMode();
    }

    _pickRandomPlaylistIndex(current) {
      const count = this._playlist.length;
      if (count <= 1) return 0;
      let next = current;
      let guard = 0;
      while (next === current && guard < 24) {
        next = Math.floor(Math.random() * count);
        guard += 1;
      }
      if (next === current) next = (current + 1) % count;
      return next;
    }

    async _onMusicEnded() {
      if (this._playlist.length <= 1) return;
      await this.playNextInPlaylist(1, true);
    }

    _targetMusicVolume() {
      const master = this.state.masterMuted ? 0 : Number(this.state.masterVolume || 0);
      const music = this.state.musicMuted ? 0 : Number(this.state.musicVolume || 0);
      const speaking = this.state.musicDuckingEnabled && !this.state.ttsMuted
        && this.state.ttsVolume > 0 && this._speakingAudio.size > 0;
      const speechFactor = speaking
        ? Math.max(0.05, 1 - Math.min(0.92, this.state.musicDuckingStrength * 1.65)) : 1;
      return Math.max(0, Math.min(1, master * music * Math.min(this._duckFactor, speechFactor)));
    }

    _cancelFade() {
      this._fadeToken += 1;
      if (this._fadeRaf) {
        window.cancelAnimationFrame(this._fadeRaf);
        this._fadeRaf = 0;
      }
      this._isFading = false;
      const resolve = this._fadeResolve;
      this._fadeResolve = null;
      if (resolve) resolve(false);
    }

    _fadeMusicTo(targetVolume, durationMs = 220, el = this._music) {
      this._cancelFade();
      const token = this._fadeToken;
      const player = el || this._music;
      const startVolume = Number(player.volume || 0);
      const endVolume = Math.max(0, Math.min(1, Number(targetVolume || 0)));
      const ms = Math.max(0, Number(durationMs || 0));
      if (ms <= 0 || Math.abs(endVolume - startVolume) < 0.001) {
        player.volume = endVolume;
        return Promise.resolve(true);
      }

      this._isFading = true;
      const t0 = (window.performance && performance.now) ? performance.now() : Date.now();

      return new Promise((resolve) => {
        this._fadeResolve = resolve;
        const complete = (result) => {
          if (this._fadeResolve === resolve) this._fadeResolve = null;
          resolve(result);
        };
        const step = () => {
          if (token !== this._fadeToken) {
            this._isFading = false;
            complete(false);
            return;
          }
          const now = (window.performance && performance.now) ? performance.now() : Date.now();
          const p = Math.max(0, Math.min(1, (now - t0) / ms));
          const eased = 1 - Math.pow(1 - p, 3);
          player.volume = Math.min(this._targetMusicVolume(), startVolume + (endVolume - startVolume) * eased);
          if (p >= 1) {
            player.volume = Math.min(endVolume, this._targetMusicVolume());
            this._isFading = false;
            this._fadeRaf = 0;
            complete(true);
            return;
          }
          this._fadeRaf = window.requestAnimationFrame(step);
        };
        this._fadeRaf = window.requestAnimationFrame(step);
      });
    }

    async _crossfadeToTrack(url, fadeMs, targetVol, transitionToken = this._musicTransitionToken) {
      if (this._disposed) return false;
      const current = this._music;
      const next = this._otherMusicDeck(current);
      if (!current || !next) return false;

      this._cancelFade();

      this._musicDeckTransitionTokens.set(next, transitionToken);
      next.src = String(url || '').trim();
      next.currentTime = 0;
      next.volume = 0;

      try {
        await next.play();
      } catch (err) {
        this._log('warn', 'Crossfade-Start fehlgeschlagen, fallback auf normalen Wechsel', {
          to: this._prettyTrack(url),
          error: String(err && err.message ? err.message : err || 'unknown'),
        });
        return false;
      }
      if (transitionToken !== this._musicTransitionToken) {
        if (this._musicDeckTransitionTokens.get(next) === transitionToken && next !== this._music) {
          next.pause();
          next.currentTime = 0;
          next.volume = 0;
        }
        return false;
      }
      if (this._disposed) {
        next.pause();
        return false;
      }

      const token = ++this._fadeToken;
      this._isFading = true;
      const startCurrent = Math.max(0, Math.min(1, Number(current.volume || this._targetMusicVolume() || 0)));
      const endNext = Math.max(0, Math.min(1, Number(targetVol || 0)));
      const ms = Math.max(120, Number(fadeMs || this._sceneFadeMs || 460));
      const t0 = (window.performance && performance.now) ? performance.now() : Date.now();

      return new Promise((resolve) => {
        this._fadeResolve = resolve;
        const complete = (result) => {
          if (this._fadeResolve === resolve) this._fadeResolve = null;
          resolve(result);
        };
        const step = () => {
          if (token !== this._fadeToken) {
            this._isFading = false;
            complete(false);
            return;
          }
          const now = (window.performance && performance.now) ? performance.now() : Date.now();
          const p = Math.max(0, Math.min(1, (now - t0) / ms));
          const eased = 1 - Math.pow(1 - p, 3);
          const limit = this._targetMusicVolume();
          current.volume = Math.min(startCurrent, limit) * (1 - eased);
          next.volume = Math.min(endNext, limit) * eased;

          if (p >= 1) {
            current.pause();
            current.currentTime = 0;
            current.volume = 0;
            this._music = next;
            this._isFading = false;
            this._fadeRaf = 0;
            this._applyVolumes();
            complete(true);
            return;
          }

          this._fadeRaf = window.requestAnimationFrame(step);
        };

        this._fadeRaf = window.requestAnimationFrame(step);
      });
    }

    _resolveSceneTrack(scene) {
      const tracks = this.state.sceneTracks || {};
      const key = String(scene || 'ui').toLowerCase();
      const fallbacks = {
        galaxy: ['galaxy', 'ui', 'system', 'battle'],
        system: ['system', 'galaxy', 'ui', 'battle'],
        battle: ['battle', 'system', 'galaxy', 'ui'],
        ui: ['ui', 'galaxy', 'system', 'battle'],
      };
      const order = fallbacks[key] || fallbacks.ui;
      for (let i = 0; i < order.length; i += 1) {
        const candidate = String(tracks[order[i]] || '').trim();
        if (candidate) return candidate;
      }
      return '';
    }

    _resolveTransitionFadeMs(name) {
      const key = String(name || 'normal').toLowerCase();
      return Number(this._sceneTransitionFades[key] || this._sceneTransitionFades.normal || this._sceneFadeMs || 460);
    }

    async _switchMusicTrack(url, autoplay = false, smooth = false, fadeMsOverride = null, transitionModeOverride = null) {
      if (this._disposed) return false;
      const transitionToken = ++this._musicTransitionToken;
      const next = String(url || '').trim();
      if (!next) {
        this._log('warn', 'Leerer Track gesetzt, stoppe Musik.');
        this.stopMusic();
        return false;
      }

      this._duckFactor = 1;
      if (this._duckTimer) {
        window.clearTimeout(this._duckTimer);
        this._duckTimer = 0;
      }

      const current = String(this._music.src || '').trim();
      const currentAbs = this._toAbsoluteTrackUrl(current);
      const nextAbs = this._toAbsoluteTrackUrl(next);
      const sameTrack = !!currentAbs && currentAbs === nextAbs;
      if (sameTrack) {
        this._log('info', 'Track bereits aktiv', {
          track: this._prettyTrack(next),
          autoplay,
        });
        if (autoplay) return (await this.playMusic()) && transitionToken === this._musicTransitionToken;
        this._applyVolumes();
        return true;
      }

      this._log('info', 'Trackwechsel', {
        from: this._prettyTrack(current),
        to: this._prettyTrack(next),
        autoplay,
        smooth: !!smooth,
        transitionMode: String(transitionModeOverride || this.state.musicTransitionMode || 'fade'),
      });

      const fadeMs = Number.isFinite(Number(fadeMsOverride)) ? Math.max(120, Number(fadeMsOverride)) : this._sceneFadeMs;
      const targetVol = this._targetMusicVolume();
      const transitionMode = String(transitionModeOverride || this.state.musicTransitionMode || 'fade').toLowerCase();
      const canFade = !!smooth && !!autoplay && !this._music.paused && this._music.currentTime > 0.05;

      if (canFade && transitionMode === 'fade') {
        const ok = await this._crossfadeToTrack(next, fadeMs, targetVol, transitionToken);
        if (ok) return true;
        if (this._disposed || transitionToken !== this._musicTransitionToken) return false;
      }

      if (canFade) {
        await this._fadeMusicTo(0, Math.round(fadeMs * 0.5), this._music);
        if (this._disposed || transitionToken !== this._musicTransitionToken) return false;
      } else {
        this._cancelFade();
      }

      if (this._disposed || transitionToken !== this._musicTransitionToken) return false;
      if (!autoplay) {
        this._musicPlayToken += 1;
        this._musicPlayIntent = false;
        this._musicA.pause();
        this._musicB.pause();
        this.state.musicPaused = true;
      }
      this._music.src = next;
      if (!autoplay) {
        this._log('info', 'Track vorbereitet (ohne Autoplay)', {
          track: this._prettyTrack(next),
        });
        this._isFading = false;
        this._applyVolumes();
        this._save();
        this._emitStateChange();
        return true;
      }

      const playbackStarted = await this.playMusic();
      if (!playbackStarted || this._disposed || transitionToken !== this._musicTransitionToken) return false;

      if (canFade && targetVol > 0) {
        this._music.volume = 0;
        const completed = await this._fadeMusicTo(targetVol, fadeMs, this._music);
        if (!completed || transitionToken !== this._musicTransitionToken) return false;
      } else {
        this._isFading = false;
        this._applyVolumes();
      }
      return true;
    }

    _ensureContext() {
      if (this._disposed) return null;
      if (this._audioContext) return this._audioContext;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      let ctx;
      let gain;
      try {
        ctx = new Ctx();
        gain = ctx.createGain();
        gain.connect(ctx.destination);
      } catch (error) {
        if (gain) {
          try {
            gain.disconnect();
          } catch (cleanupError) {
            this._log('warn', 'AudioContext Gain Cleanup fehlgeschlagen', { error: String(cleanupError) });
          }
        }
        if (ctx && ctx.state !== 'closed' && typeof ctx.close === 'function') {
          try {
            Promise.resolve(ctx.close()).catch((cleanupError) => {
              this._log('warn', 'Fehlerhafter AudioContext konnte nicht geschlossen werden', {
                error: String(cleanupError),
              });
            });
          } catch (cleanupError) {
            this._log('warn', 'Fehlerhafter AudioContext konnte nicht geschlossen werden', {
              error: String(cleanupError),
            });
          }
        }
        this._log('warn', 'AudioContext Initialisierung fehlgeschlagen', { error: String(error) });
        return null;
      }
      this._audioContext = ctx;
      this._gain = gain;
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        try {
          Promise.resolve(ctx.resume()).catch((error) => {
            this._log('warn', 'AudioContext konnte nicht aktiviert werden', { error: String(error) });
          });
        } catch (error) {
          this._log('warn', 'AudioContext konnte nicht aktiviert werden', { error: String(error) });
        }
      }
      return ctx;
    }

    _playTone(freq = 680, duration = 0.05, type = 'triangle') {
      const frequency = Number(freq);
      const seconds = Number(duration);
      const waveform = String(type);
      if (this._disposed || !Number.isFinite(frequency) || frequency <= 0 || frequency > 20000
        || !Number.isFinite(seconds) || seconds <= 0 || seconds > 30
        || !['sine', 'square', 'sawtooth', 'triangle'].includes(waveform)) return false;
      if (this.state.masterMuted || this.state.sfxMuted) return false;
      const master = Math.max(0, Math.min(1, Number(this.state.masterVolume || 0)));
      const sfx = Math.max(0, Math.min(1, Number(this.state.sfxVolume || 0)));
      const amp = master * sfx;
      if (amp <= 0) return false;

      let ctx;
      try {
        ctx = this._ensureContext();
      } catch (error) {
        this._log('warn', 'Fallback-Sound konnte keinen AudioContext erzeugen', { error: String(error) });
        return false;
      }
      if (!ctx || !this._gain) return false;

      let osc = null;
      let env = null;
      let started = false;
      let released = false;
      const release = (stop = false) => {
        if (released) return;
        released = true;
        if (osc) this._activeToneOscillators.delete(osc);
        const errors = [];
        if (osc) {
          try {
            osc.removeEventListener('ended', onEnded);
          } catch (error) {
            errors.push(error);
          }
          if (stop && started) {
            try {
              osc.stop();
            } catch (error) {
              errors.push(error);
            }
          }
          try {
            osc.disconnect();
          } catch (error) {
            errors.push(error);
          }
        }
        if (env) {
          try {
            env.disconnect();
          } catch (error) {
            errors.push(error);
          }
        }
        for (const error of errors) {
          this._log('warn', 'Fallback-Sound Cleanup fehlgeschlagen', { error: String(error) });
        }
      };
      const onEnded = () => release();

      try {
        osc = ctx.createOscillator();
        env = ctx.createGain();
        osc.type = waveform;
        osc.frequency.value = frequency;
        env.gain.value = 0;
        osc.connect(env);
        env.connect(this._gain);
        osc.addEventListener('ended', onEnded, { once: true });
        this._activeToneOscillators.set(osc, { env, onEnded });

        const now = ctx.currentTime;
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(0.06 * amp, now + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

        osc.start(now);
        started = true;
        osc.stop(now + seconds + 0.01);
        return true;
      } catch (error) {
        release(true);
        this._log('warn', 'Fallback-Sound konnte nicht gestartet werden', { error: String(error) });
        return false;
      }
    }

    _playSfx(url, gain = 1, minIntervalMs = 55) {
      if (this._disposed) return false;
      const src = String(url || '').trim();
      if (!src) return false;
      if (this.state.masterMuted || this.state.sfxMuted) return false;

      const now = Date.now();
      if (this._isSfxRateLimited(this._sfxLastPlayAt, src, now, minIntervalMs)) return false;

      const vol = this._targetTransientVolume('sfx', gain);
      if (vol <= 0) return false;

      let audio = null;
      try {
        audio = this._trackTransientAudio(new Audio(src), 'sfx', gain);
        audio.preload = 'auto';
        audio.volume = vol;
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch((error) => {
            this._handleTransientAudioFailure(audio, 'Soundeffekt konnte nicht gestartet werden', error);
          });
        }
        return true;
      } catch (error) {
        this._handleTransientAudioFailure(audio, 'Soundeffekt konnte nicht gestartet werden', error);
        return false;
      }
    }

    _playTeaserAudio(url, gain = 1, minIntervalMs = 100) {
      if (this._disposed) return null;
      const src = String(url || '').trim();
      if (!src) return null;
      if (this.state.masterMuted || this.state.teaserMuted) return null;

      const now = Date.now();
      if (this._isSfxRateLimited(this._sfxTeaserLastPlayAt, src, now, minIntervalMs)) return null;

      const vol = this._targetTransientVolume('teaser', gain);
      if (vol <= 0) return null;

      let audio = null;
      try {
        audio = this._trackTransientAudio(new Audio(src), 'teaser', gain);
        audio.preload = 'auto';
        audio.volume = vol;
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch((error) => {
            this._handleTransientAudioFailure(audio, 'Teaser-Audio konnte nicht gestartet werden', error);
          });
        }
        return audio;
      } catch (error) {
        this._handleTransientAudioFailure(audio, 'Teaser-Audio konnte nicht gestartet werden', error);
        return null;
      }
    }

    _playTtsAudio(url, gain = 1) {
      if (this._disposed) return null;
      const src = String(url || '').trim();
      if (!src) return null;
      if (this.state.masterMuted || this.state.ttsMuted) return null;

      const vol = this._targetTransientVolume('tts', gain);
      if (vol <= 0) return null;

      let audio = null;
      let untrack = null;
      try {
        audio = this._trackTransientAudio(new Audio(src), 'tts', gain);
        audio.preload = 'auto';
        audio.volume = vol;
        untrack = this.trackTtsAudio(audio);
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch((error) => {
            untrack();
            this._handleTransientAudioFailure(audio, 'Sprachausgabe konnte nicht gestartet werden', error);
            audio.dispatchEvent(new Event('error'));
          });
        }
        return audio;
      } catch (error) {
        untrack?.();
        this._handleTransientAudioFailure(audio, 'Sprachausgabe konnte nicht gestartet werden', error);
        return null;
      }
    }

    playUiClick() {
      this._rememberAudioEvent('uiClick');
      if (this._playSfx(this._resolveSfxTrack('uiClick'), 0.7, 40)) return;
      this._playTone(620, 0.045, 'triangle');
    }

    playUiConfirm() {
      this._rememberAudioEvent('uiConfirm');
      if (this._playSfx(this._resolveSfxTrack('uiConfirm'), 0.72, 120)) return;
      this._playTone(820, 0.055, 'sine');
    }

    playUiError() {
      this._rememberAudioEvent('uiError');
      this.duckMusic();
      if (this._playSfx(this._resolveSfxTrack('uiError'), 0.95, 140)) return;
      this._playTone(280, 0.07, 'sawtooth');
      this._scheduleTimeout(() => this._playTone(220, 0.08, 'sawtooth'), 34);
    }

    playUiNotify() {
      this._rememberAudioEvent('uiNotify');
      this.duckMusic();
      if (this._playSfx(this._resolveSfxTrack('uiNotify'), 0.8, 110)) return;
      this._playTone(740, 0.042, 'triangle');
      this._scheduleTimeout(() => this._playTone(980, 0.05, 'triangle'), 40);
    }

    playNavigation() {
      this._rememberAudioEvent('navigation');
      this.duckMusic(180);
      if (this._playSfx(this._resolveSfxTrack('navigation'), 0.72, 85)) return;
      this._playTone(690, 0.045, 'triangle');
      this._scheduleTimeout(() => this._playTone(840, 0.05, 'sine'), 34);
    }

    playResearchStart() {
      this._rememberAudioEvent('researchStart');
      this.duckMusic(260);
      if (this._playSfx(this._resolveSfxTrack('researchStart'), 0.8, 150)) return;
      this._playTone(760, 0.04, 'triangle');
      this._scheduleTimeout(() => this._playTone(920, 0.055, 'triangle'), 38);
    }

    playResearchComplete() {
      this._rememberAudioEvent('researchComplete');
      this.duckMusic(280);
      if (this._playSfx(this._resolveSfxTrack('researchComplete'), 0.86, 180)) return;
      this._playTone(880, 0.05, 'triangle');
      this._scheduleTimeout(() => this._playTone(1120, 0.07, 'triangle'), 42);
    }

    playFleetRecall() {
      this._rememberAudioEvent('fleetRecall');
      this.duckMusic(190);
      if (this._playSfx(this._resolveSfxTrack('fleetRecall'), 0.76, 120)) return;
      this._playTone(520, 0.038, 'sine');
      this._scheduleTimeout(() => this._playTone(430, 0.05, 'triangle'), 28);
    }

    playMessageSend() {
      this._rememberAudioEvent('messageSend');
      this.duckMusic(180);
      if (this._playSfx(this._resolveSfxTrack('messageSend'), 0.78, 110)) return;
      this._playTone(720, 0.04, 'triangle');
      this._scheduleTimeout(() => this._playTone(900, 0.05, 'sine'), 30);
    }

    playMessageRead() {
      this._rememberAudioEvent('messageRead');
      this.duckMusic(120);
      if (this._playSfx(this._resolveSfxTrack('messageRead'), 0.66, 90)) return;
      this._playTone(640, 0.035, 'triangle');
      this._scheduleTimeout(() => this._playTone(780, 0.04, 'triangle'), 24);
    }

    playMessageDelete() {
      this._rememberAudioEvent('messageDelete');
      this.duckMusic(140);
      if (this._playSfx(this._resolveSfxTrack('messageDelete'), 0.72, 100)) return;
      this._playTone(360, 0.045, 'sawtooth');
      this._scheduleTimeout(() => this._playTone(280, 0.05, 'triangle'), 20);
    }

    playPvpToggle() {
      this._rememberAudioEvent('pvpToggle');
      this.duckMusic(220);
      if (this._playSfx(this._resolveSfxTrack('pvpToggle'), 0.82, 180)) return;
      this._playTone(510, 0.045, 'square');
      this._scheduleTimeout(() => this._playTone(690, 0.06, 'triangle'), 36);
    }

    playFleetAttack() {
      this._rememberAudioEvent('fleetAttack');
      this.duckMusic(220);
      if (this._playSfx(this._resolveSfxTrack('fleetAttack'), 0.84, 140)) return;
      this._playTone(420, 0.04, 'sawtooth');
      this._scheduleTimeout(() => this._playTone(560, 0.055, 'square'), 24);
    }

    playFleetTransport() {
      this._rememberAudioEvent('fleetTransport');
      this.duckMusic(180);
      if (this._playSfx(this._resolveSfxTrack('fleetTransport'), 0.78, 140)) return;
      this._playTone(460, 0.04, 'sine');
      this._scheduleTimeout(() => this._playTone(620, 0.05, 'triangle'), 28);
    }

    playFleetSpy() {
      this._rememberAudioEvent('fleetSpy');
      this.duckMusic(160);
      if (this._playSfx(this._resolveSfxTrack('fleetSpy'), 0.76, 140)) return;
      this._playTone(930, 0.03, 'triangle');
      this._scheduleTimeout(() => this._playTone(780, 0.035, 'sine'), 18);
    }

    playFleetColonize() {
      this._rememberAudioEvent('fleetColonize');
      this.duckMusic(260);
      if (this._playSfx(this._resolveSfxTrack('fleetColonize'), 0.82, 180)) return;
      this._playTone(580, 0.05, 'square');
      this._scheduleTimeout(() => this._playTone(760, 0.07, 'triangle'), 38);
    }

    playFleetHarvest() {
      this._rememberAudioEvent('fleetHarvest');
      this.duckMusic(180);
      if (this._playSfx(this._resolveSfxTrack('fleetHarvest'), 0.78, 150)) return;
      this._playTone(520, 0.04, 'triangle');
      this._scheduleTimeout(() => this._playTone(680, 0.05, 'triangle'), 26);
    }

    playBuildComplete() {
      this._rememberAudioEvent('buildComplete');
      this.duckMusic();
      if (this._playSfx(this._resolveSfxTrack('buildComplete'), 0.88, 180)) return;
      this._playTone(510, 0.04, 'square');
      this._scheduleTimeout(() => this._playTone(640, 0.05, 'square'), 36);
      this._scheduleTimeout(() => this._playTone(790, 0.06, 'triangle'), 78);
    }

    playFleetLaunch() {
      this._rememberAudioEvent('fleetLaunch');
      this.duckMusic();
      if (this._playSfx(this._resolveSfxTrack('fleetLaunch'), 0.82, 140)) return;
      this._playTone(430, 0.04, 'sine');
      this._scheduleTimeout(() => this._playTone(520, 0.045, 'sine'), 28);
      this._scheduleTimeout(() => this._playTone(640, 0.06, 'triangle'), 60);
    }

    playFleetMission(mission) {
      const kind = String(mission || '').toLowerCase();
      if (kind === 'attack') return this.playFleetAttack();
      if (kind === 'transport') return this.playFleetTransport();
      if (kind === 'spy') return this.playFleetSpy();
      if (kind === 'colonize') return this.playFleetColonize();
      if (kind === 'harvest') return this.playFleetHarvest();
      return this.playFleetLaunch();
    }

    setMusicDuckingEnabled(value) {
      this.state.musicDuckingEnabled = !!value;
      if (!this.state.musicDuckingEnabled) {
        this._duckFactor = 1;
        if (this._duckTimer) {
          window.clearTimeout(this._duckTimer);
          this._duckTimer = 0;
        }
      }
      this._applyVolumes();
      this._save();
      this._emitStateChange();
    }

    setMusicDuckingStrength(value) {
      this.state.musicDuckingStrength = Math.max(0.1, Math.min(0.9, Number(value || 0.55)));
      this._applyVolumes();
      this._save();
      this._emitStateChange();
    }

    trackTtsAudio(audio) {
      if (this._disposed) return () => {};
      if (this._ttsAudioCleanup.has(audio)) return this._ttsAudioCleanup.get(audio);
      const update = () => {
        if (!audio.paused && !audio.ended && !audio.muted && audio.volume > 0) this._speakingAudio.add(audio);
        else this._speakingAudio.delete(audio);
        this._applyVolumes();
      };
      const pause = () => {
        this._speakingAudio.delete(audio);
        this._applyVolumes();
      };
      const dispose = () => {
        if (!this._ttsAudioCleanup.has(audio)) return;
        for (const event of ['playing', 'volumechange']) audio.removeEventListener(event, update);
        audio.removeEventListener('pause', pause);
        for (const event of ['ended', 'error', 'emptied']) audio.removeEventListener(event, dispose);
        this._ttsAudioCleanup.delete(audio);
        pause();
      };
      for (const event of ['playing', 'volumechange']) audio.addEventListener(event, update);
      audio.addEventListener('pause', pause);
      for (const event of ['ended', 'error', 'emptied']) audio.addEventListener(event, dispose);
      this._ttsAudioCleanup.set(audio, dispose);
      return dispose;
    }

    duckMusic(holdMs = 280) {
      if (this._disposed || !this.state.musicDuckingEnabled) return;
      if (!this._music.src || this._music.paused) return;
      const strength = Math.max(0.1, Math.min(0.9, Number(this.state.musicDuckingStrength || 0.55)));
      this._duckFactor = Math.max(0.12, 1 - strength);
      this._fadeMusicTo(this._targetMusicVolume(), 90);

      if (this._duckTimer) window.clearTimeout(this._duckTimer);
      this._duckTimer = window.setTimeout(() => {
        this._duckTimer = 0;
        this._duckFactor = 1;
        this._fadeMusicTo(this._targetMusicVolume(), 220);
      }, Math.max(120, Number(holdMs || 280)));
    }

    duckMusicForTts(holdMs = 1800) {
      if (this._disposed || !this.state.musicDuckingEnabled) return;
      if (!this._music.src || this._music.paused) return;
      const baseStrength = Math.max(0.1, Math.min(0.9, Number(this.state.musicDuckingStrength || 0.55)));
      const strength = Math.min(0.92, baseStrength * 1.65);
      this._duckFactor = Math.max(0.05, 1 - strength);
      this._fadeMusicTo(this._targetMusicVolume(), 80);

      if (this._duckTimer) window.clearTimeout(this._duckTimer);
      this._duckTimer = window.setTimeout(() => {
        this._duckTimer = 0;
        this._duckFactor = 1;
        this._fadeMusicTo(this._targetMusicVolume(), 320);
      }, Math.max(200, Number(holdMs || 1800)));
    }

    setMasterVolume(value) {
      this.state.masterVolume = Math.max(0, Math.min(1, Number(value || 0)));
      this._applyVolumes();
      this._save();
      this._emitStateChange();
    }

    setMusicVolume(value) {
      this.state.musicVolume = Math.max(0, Math.min(1, Number(value || 0)));
      this._applyVolumes();
      this._save();
      this._emitStateChange();
    }

    setSfxVolume(value) {
      this.state.sfxVolume = Math.max(0, Math.min(1, Number(value || 0)));
      this._applyVolumes();
      this._save();
    }

    setTeaserVolume(value) {
      this.state.teaserVolume = Math.max(0, Math.min(1, Number(value || 0)));
      this._applyVolumes();
      this._save();
    }

    setTtsVolume(value) {
      this.state.ttsVolume = Math.max(0, Math.min(1, Number(value || 0)));
      this._applyVolumes();
      this._save();
    }

    setMasterMuted(value) {
      this.state.masterMuted = !!value;
      this._applyVolumes();
      this._save();
      this._emitStateChange();
    }

    setMusicMuted(value) {
      this.state.musicMuted = !!value;
      this._applyVolumes();
      this._save();
      this._emitStateChange();
    }

    setMusicTransitionMode(mode) {
      const next = String(mode || '').toLowerCase();
      this.state.musicTransitionMode = (next === 'cut') ? 'cut' : 'fade';
      this._save();
      this._emitStateChange();
    }

    setSfxMuted(value) {
      this.state.sfxMuted = !!value;
      this._applyVolumes();
      this._save();
    }

    setTeaserMuted(value) {
      this.state.teaserMuted = !!value;
      this._applyVolumes();
      this._save();
    }

    setTtsMuted(value) {
      this.state.ttsMuted = !!value;
      this._applyVolumes();
      this._save();
    }

    playTeaser(url, opts = {}) {
      const src = String(url || '').trim();
      if (!src) return null;
      const gain = typeof opts.gain === 'number' ? Math.max(0, Math.min(1, opts.gain)) : 1;
      const duck = opts.duck !== false;
      if (duck) this.duckMusic(opts.duckHoldMs || 400);
      return this._playTeaserAudio(src, gain, opts.minIntervalMs ?? 100);
    }

    playTtsAudio(url, opts = {}) {
      const src = String(url || '').trim();
      if (!src) return null;
      if (this.state.masterMuted || this.state.ttsMuted) return null;
      const gain = typeof opts.gain === 'number' ? Math.max(0, Math.min(1, opts.gain)) : 1;
      return this._playTtsAudio(src, gain);
    }

    setMusicTrack(url, autoplay = false, opts = {}) {
      this.state.musicUrl = String(url || '').trim();
      this._log('info', 'setMusicTrack aufgerufen', {
        track: this._prettyTrack(this.state.musicUrl),
        autoplay: !!autoplay,
      });
      this._syncPlaylistIndexFromCurrentTrack();
      const nextAbs = this._toAbsoluteTrackUrl(this.state.musicUrl);
      if (nextAbs && this._playlist.length) {
        const found = this._playlist.findIndex((entry) => this._toAbsoluteTrackUrl(entry) === nextAbs);
        if (found >= 0) this._playlistIndex = found;
      }
      this._save();
      if (!this.state.musicUrl) {
        this.stopMusic();
        return;
      }
      const smooth = !!opts.smooth;
      const fadeMs = Number.isFinite(Number(opts.fadeMs)) ? Number(opts.fadeMs) : null;
      const transitionMode = String(opts.transitionMode || '').trim() || null;
      const result = this._switchMusicTrack(this.state.musicUrl, autoplay, smooth, fadeMs, transitionMode);
      if (result && typeof result.then === 'function') {
        return result.finally(() => this._emitStateChange());
      }
      this._emitStateChange();
      return result;
    }

    setMusicPlaylist(list = [], opts = {}) {
      const mode = String(opts.mode || this._playlistMode || 'shuffle').toLowerCase();
      this._playlistMode = (mode === 'sequential') ? 'sequential' : 'shuffle';
      const next = [];
      const seen = new Set();
      const incoming = Array.isArray(list) ? list : [];
      for (let i = 0; i < incoming.length; i += 1) {
        const url = String(incoming[i] || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        next.push(url);
      }
      this._playlist = next;
      this._syncPlaylistIndexFromCurrentTrack();
      if (this._playlist.length && this._playlistIndex < 0) {
        const fallback = this._toAbsoluteTrackUrl(this.state.musicUrl || '');
        if (fallback) {
          const found = this._playlist.findIndex((entry) => this._toAbsoluteTrackUrl(entry) === fallback);
          this._playlistIndex = found >= 0 ? found : 0;
        } else {
          this._playlistIndex = 0;
        }
      }
      this._syncMusicLoopMode();
      this._emitStateChange();
    }

    async playNextInPlaylist(direction = 1, autoplay = true) {
      if (!this._playlist.length) return false;
      this._syncPlaylistIndexFromCurrentTrack();

      let current = this._playlistIndex;
      if (current < 0 || current >= this._playlist.length) current = 0;

      let nextIndex = current;
      if (this._playlist.length > 1) {
        if (this._playlistMode === 'shuffle') {
          nextIndex = this._pickRandomPlaylistIndex(current);
        } else {
          const dir = direction < 0 ? -1 : 1;
          nextIndex = (current + dir + this._playlist.length) % this._playlist.length;
        }
      }

      const nextTrack = String(this._playlist[nextIndex] || '').trim();
      if (!nextTrack) return false;

      this._playlistIndex = nextIndex;
      return this.setMusicTrack(nextTrack, autoplay, {
        smooth: !!autoplay,
        fadeMs: this._resolveTransitionFadeMs('normal'),
      });
    }

    setSceneTrack(scene, url) {
      const key = String(scene || '').toLowerCase();
      if (!this.state.sceneTracks || typeof this.state.sceneTracks !== 'object') {
        this.state.sceneTracks = { galaxy: '', system: '', battle: '', ui: '' };
      }
      this.state.sceneTracks[key] = String(url || '').trim();
      this._save();
    }

    setSfxTrack(name, url) {
      const key = String(name || '').trim();
      if (!key) return;
      if (!this.state.sfxMap || typeof this.state.sfxMap !== 'object') {
        this.state.sfxMap = Object.assign({}, DEFAULT_SFX);
      }
      this.state.sfxMap[key] = String(url || '').trim() || String(DEFAULT_SFX[key] || '');
      this._save();
    }

    setAutoSceneMusic(enabled) {
      this.state.autoSceneMusic = !!enabled;
      this._save();
    }

    resetAudioDefaults() {
      this.state.musicUrl = '';
      this.state.autoSceneMusic = true;
      this.state.sceneTracks = Object.assign({}, DEFAULT_SCENE_TRACKS);
      this.state.sfxMap = Object.assign({}, DEFAULT_SFX);
      this._lastAudioEvent = null;
      this._save();
      this.stopMusic();
    }

    setScene(scene, autoplayOrOpts = true, optsMaybe = {}) {
      const key = String(scene || 'ui').toLowerCase();
      const opts = typeof autoplayOrOpts === 'object'
        ? Object.assign({ autoplay: true }, autoplayOrOpts)
        : Object.assign({ autoplay: !!autoplayOrOpts }, optsMaybe || {});
      const respectPausePreference = !opts.ignorePauseState;
      const autoplay = !!opts.autoplay && (!respectPausePreference || !this.state.musicPaused);
      const force = !!opts.force;
      const transition = String(opts.transition || 'normal').toLowerCase();
      const minHoldMs = Math.max(0, Number(opts.minHoldMs ?? 900));
      const now = (window.performance && performance.now) ? performance.now() : Date.now();
      const sceneChanged = key !== this.state.currentScene;

      if (!force && sceneChanged && (now - this._lastSceneChangeMs) < minHoldMs) {
        return false;
      }

      if (sceneChanged) this._lastSceneChangeMs = now;
      this.state.currentScene = key;
      const sceneTrack = this._resolveSceneTrack(key);
      if (this.state.autoSceneMusic && sceneTrack) {
        const sameTrack = String(this.state.musicUrl || '').trim() === sceneTrack;
        if (!sameTrack) {
          this.setMusicTrack(sceneTrack, autoplay, {
            smooth: autoplay,
            fadeMs: this._resolveTransitionFadeMs(transition),
          });
        }
        else if (autoplay) this.playMusic();
      }
      this._save();
      return true;
    }

    async playMusic() {
      if (this._disposed) return false;
      if (!this._music.src) {
        this._log('warn', 'playMusic ohne gesetzte Quelle abgebrochen.');
        return false;
      }
      const playToken = ++this._musicPlayToken;
      const player = this._music;
      this._musicPlayIntent = true;
      try {
        if (this._audioContext && this._audioContext.state === 'suspended') {
          await this._audioContext.resume();
        }
        if (this._disposed || playToken !== this._musicPlayToken) return false;
        this._applyVolumes();
        this._log('info', 'Play-Versuch', {
          track: this._prettyTrack(player.currentSrc || player.src || ''),
          muted: !!this.state.musicMuted || !!this.state.masterMuted,
          volume: Number(player.volume || 0),
        });
        await player.play();
        if (this._disposed || playToken !== this._musicPlayToken) {
          if (!this._musicPlayIntent && player === this._music) player.pause();
          return false;
        }
        this.state.musicPaused = false;
        this._save();
        this._log('info', 'Musik läuft', {
          track: this._prettyTrack(player.currentSrc || player.src || ''),
          currentTime: Number(player.currentTime || 0),
        });
        this._emitStateChange();
        return true;
      } catch (err) {
        if (playToken !== this._musicPlayToken) return false;
        this._musicPlayIntent = false;
        this._log('error', 'playMusic fehlgeschlagen', {
          track: this._prettyTrack(player.currentSrc || player.src || ''),
          error: String(err && err.message ? err.message : err || 'unknown'),
          name: String(err && err.name ? err.name : ''),
        });
        this._emitStateChange();
        return false;
      }
    }

    pauseMusic(resetPosition = false) {
      this._musicPlayToken += 1;
      this._musicPlayIntent = false;
      this._musicTransitionToken += 1;
      this._cancelFade();
      this._musicA.pause();
      this._musicB.pause();
      if (resetPosition) {
        this._musicA.currentTime = 0;
        this._musicB.currentTime = 0;
      }
      this.state.musicPaused = true;
      this._save();
      this._emitStateChange();
      return true;
    }

    async toggleMusic() {
      if (this._music.paused) {
        return this.playMusic();
      }
      this.pauseMusic(false);
      return true;
    }

    stopMusic() {
      this._musicPlayToken += 1;
      this._musicPlayIntent = false;
      this._musicTransitionToken += 1;
      this._cancelFade();
      if (this._duckTimer) {
        window.clearTimeout(this._duckTimer);
        this._duckTimer = 0;
      }
      this._duckFactor = 1;
      this._musicA.pause();
      this._musicB.pause();
      this._musicA.currentTime = 0;
      this._musicB.currentTime = 0;
      this._musicA.volume = 0;
      this._musicB.volume = 0;
      this.state.musicPaused = true;
      this._save();
      this._applyVolumes();
      this._emitStateChange();
    }

    /**
     * Attach an optional procedural synth engine (e.g. GQAudioSynth).
     * When set, SFX events triggered through this manager can delegate to the
     * synth for procedural synthesis instead of (or in addition to) file playback.
     *
     * Call with `null` to detach.
     * The caller owns the synth lifecycle and must dispose it when no longer used.
     *
     * @param {Object|null} synth  — Object with a `playProcedural(type, opts)` method
     */
    setSynthEngine(synth) {
      if (synth !== null && (typeof synth !== 'object' || typeof synth.playProcedural !== 'function')) {
        throw new TypeError('[GQAudioManager] setSynthEngine: synth must have a playProcedural(type, opts) method');
      }
      this._synth = synth ?? null;
    }

    /**
     * Play a procedural sound via the attached synth engine (if any).
     * Volume is gated by masterMuted / sfxMuted / masterVolume / sfxVolume.
     *
     * @param {string} type   — sound type, e.g. 'warp_charge', 'laser_fire'
     * @param {Object} [opts] — forwarded to synth.playProcedural()
     * @returns {boolean}  true if the synth was invoked
     */
    playProceduralSfx(type, opts = {}) {
      if (!this._synth) return false;
      if (this.state.masterMuted || this.state.sfxMuted) return false;
      const requestedVolume = Number(opts.volume ?? 1);
      const eventGain = Number.isFinite(requestedVolume)
        ? Math.max(0, Math.min(1, requestedVolume)) : 0;
      const vol = this._targetTransientVolume('sfx', eventGain);
      if (vol <= 0) return false;
      try {
        const result = this._synth.playProcedural(type, { ...opts, volume: vol });
        return result === true;
      } catch (error) {
        this._log('warn', 'Prozeduraler Sound konnte nicht abgespielt werden', {
          type: String(type || ''),
          error: String(error),
        });
        return false;
      }
    }

    snapshot() {
      return Object.assign({}, this.state, {
        playlist: this._playlist.slice(),
        lastAudioEvent: this._lastAudioEvent ? Object.assign({}, this._lastAudioEvent) : null,
        musicPlaying: !this._music.paused,
        musicPaused: !!this.state.musicPaused,
      });
    }

    dispose() {
      if (!this._disposePromise) this._disposePromise = this._disposeResources();
      return this._disposePromise;
    }

    async _disposeResources() {
      this._disposed = true;
      this._musicPlayToken += 1;
      this._musicPlayIntent = false;
      const errors = [];
      const attempt = (cleanup) => {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      };

      attempt(() => this._cancelFade());
      if (this._duckTimer) {
        attempt(() => window.clearTimeout(this._duckTimer));
        this._duckTimer = 0;
      }
      for (const timeoutId of this._scheduledTimeouts) {
        attempt(() => window.clearTimeout(timeoutId));
      }
      this._scheduledTimeouts.clear();

      for (const cleanup of Array.from(this._ttsAudioCleanup.values())) {
        attempt(cleanup);
      }
      for (const audio of Array.from(this._transientAudioCleanup.keys())) {
        attempt(() => this._releaseTransientAudio(audio, true));
      }
      for (const [audio, handlers] of this._musicElementHandlers) {
        attempt(() => audio.removeEventListener('error', handlers.onError));
        attempt(() => audio.removeEventListener('ended', handlers.onEnded));
      }
      this._musicElementHandlers.clear();

      for (const audio of [this._musicA, this._musicB]) {
        attempt(() => audio.pause());
        attempt(() => audio.removeAttribute('src'));
        attempt(() => audio.load());
      }
      this._speakingAudio.clear();
      this._synth = null;
      this._sfxLastPlayAt.clear();
      this._sfxTeaserLastPlayAt.clear();

      for (const [oscillator, { env, onEnded }] of this._activeToneOscillators) {
        attempt(() => oscillator.removeEventListener('ended', onEnded));
        attempt(() => oscillator.stop());
        attempt(() => oscillator.disconnect());
        attempt(() => env.disconnect());
      }
      this._activeToneOscillators.clear();
      if (this._gain) attempt(() => this._gain.disconnect());

      const context = this._audioContext;
      this._audioContext = null;
      this._gain = null;
      if (context && context.state !== 'closed' && typeof context.close === 'function') {
        try {
          await context.close();
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length) {
        throw new AggregateError(errors, 'Audio manager disposal failed');
      }
    }
  }

  window.GQAudioManager = GQAudioManager;
})();
