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
      this._sceneFadeMs = 460;
      this._sceneTransitionFades = {
        fast: 260,
        normal: 460,
        soft: 720,
        dramatic: 980,
      };
      this._fadeRaf = 0;
      this._fadeToken = 0;
      this._isFading = false;
      this._duckFactor = 1;
      this._duckTimer = 0;
      this._lastSceneChangeMs = 0;
      this._audioContext = null;
      this._gain = null;
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
      el.addEventListener('error', () => {
        const mediaError = el.error;
        this._log('error', 'Media-Element Fehler beim Laden/Abspielen', {
          track: this._prettyTrack(el.currentSrc || el.src || ''),
          code: mediaError ? mediaError.code : null,
          message: this._mediaErrorMessage(mediaError ? mediaError.code : null),
        });
      });

      el.addEventListener('ended', () => {
        if (el !== this._music) return;
        this._onMusicEnded();
      });
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
      if (this._isFading) return;
      const active = this._music;
      const inactive = this._otherMusicDeck(active);
      if (active) active.volume = this._targetMusicVolume();
      if (inactive && inactive !== active) inactive.volume = 0;
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
      return Math.max(0, Math.min(1, master * music * this._duckFactor));
    }

    _cancelFade() {
      this._fadeToken += 1;
      if (this._fadeRaf) {
        window.cancelAnimationFrame(this._fadeRaf);
        this._fadeRaf = 0;
      }
      this._isFading = false;
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
        const step = () => {
          if (token !== this._fadeToken) {
            this._isFading = false;
            resolve(false);
            return;
          }
          const now = (window.performance && performance.now) ? performance.now() : Date.now();
          const p = Math.max(0, Math.min(1, (now - t0) / ms));
          const eased = 1 - Math.pow(1 - p, 3);
          player.volume = startVolume + (endVolume - startVolume) * eased;
          if (p >= 1) {
            player.volume = endVolume;
            this._isFading = false;
            this._fadeRaf = 0;
            resolve(true);
            return;
          }
          this._fadeRaf = window.requestAnimationFrame(step);
        };
        this._fadeRaf = window.requestAnimationFrame(step);
      });
    }

    async _crossfadeToTrack(url, fadeMs, targetVol) {
      const current = this._music;
      const next = this._otherMusicDeck(current);
      if (!current || !next) return false;

      this._cancelFade();

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

      const token = ++this._fadeToken;
      this._isFading = true;
      const startCurrent = Math.max(0, Math.min(1, Number(current.volume || this._targetMusicVolume() || 0)));
      const endNext = Math.max(0, Math.min(1, Number(targetVol || 0)));
      const ms = Math.max(120, Number(fadeMs || this._sceneFadeMs || 460));
      const t0 = (window.performance && performance.now) ? performance.now() : Date.now();

      return new Promise((resolve) => {
        const step = () => {
          if (token !== this._fadeToken) {
            this._isFading = false;
            resolve(false);
            return;
          }
          const now = (window.performance && performance.now) ? performance.now() : Date.now();
          const p = Math.max(0, Math.min(1, (now - t0) / ms));
          const eased = 1 - Math.pow(1 - p, 3);
          current.volume = startCurrent * (1 - eased);
          next.volume = endNext * eased;

          if (p >= 1) {
            current.pause();
            current.currentTime = 0;
            current.volume = 0;
            this._music = next;
            this._isFading = false;
            this._fadeRaf = 0;
            this._applyVolumes();
            resolve(true);
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
        if (autoplay) return this.playMusic();
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
        const ok = await this._crossfadeToTrack(next, fadeMs, targetVol);
        if (ok) return true;
      }

      if (canFade) {
        await this._fadeMusicTo(0, Math.round(fadeMs * 0.5), this._music);
      } else {
        this._cancelFade();
      }

      this._music.src = next;
      if (!autoplay) {
        this._log('info', 'Track vorbereitet (ohne Autoplay)', {
          track: this._prettyTrack(next),
        });
        this._isFading = false;
        this._applyVolumes();
        return true;
      }

      try {
        await this.playMusic();
      } catch (_) {}

      if (canFade && targetVol > 0) {
        this._music.volume = 0;
        await this._fadeMusicTo(targetVol, fadeMs, this._music);
      } else {
        this._isFading = false;
        this._applyVolumes();
      }
      return true;
    }

    _ensureContext() {
      if (this._audioContext) return this._audioContext;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      this._audioContext = ctx;
      this._gain = gain;
      return ctx;
    }

    _playTone(freq = 680, duration = 0.05, type = 'triangle') {
      const ctx = this._ensureContext();
      if (!ctx || !this._gain) return;
      if (this.state.masterMuted || this.state.sfxMuted) return;
      const master = Math.max(0, Math.min(1, Number(this.state.masterVolume || 0)));
      const sfx = Math.max(0, Math.min(1, Number(this.state.sfxVolume || 0)));
      const amp = master * sfx;
      if (amp <= 0) return;

      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      env.gain.value = 0;
      osc.connect(env);
      env.connect(this._gain);

      const now = ctx.currentTime;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.06 * amp, now + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.start(now);
      osc.stop(now + duration + 0.01);
    }

    _playSfx(url, gain = 1, minIntervalMs = 55) {
      const src = String(url || '').trim();
      if (!src) return false;
      if (this.state.masterMuted || this.state.sfxMuted) return false;

      const now = Date.now();
      const previous = Number(this._sfxLastPlayAt.get(src) || 0);
      if ((now - previous) < Math.max(0, Number(minIntervalMs || 0))) {
        return false;
      }
      this._sfxLastPlayAt.set(src, now);

      const master = Math.max(0, Math.min(1, Number(this.state.masterVolume || 0)));
      const sfx = Math.max(0, Math.min(1, Number(this.state.sfxVolume || 0)));
      const vol = Math.max(0, Math.min(1, master * sfx * Math.max(0, Number(gain || 1))));
      if (vol <= 0) return false;

      try {
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.volume = vol;
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
        return true;
      } catch (_) {
        return false;
      }
    }

    _playTeaserAudio(url, gain = 1, minIntervalMs = 100) {
      const src = String(url || '').trim();
      if (!src) return null;
      if (this.state.masterMuted || this.state.teaserMuted) return null;

      const now = Date.now();
      const previous = Number(this._sfxTeaserLastPlayAt.get(src) || 0);
      if ((now - previous) < Math.max(0, Number(minIntervalMs || 0))) {
        return null;
      }
      this._sfxTeaserLastPlayAt.set(src, now);

      const master = Math.max(0, Math.min(1, Number(this.state.masterVolume || 0)));
      const teaser = Math.max(0, Math.min(1, Number(this.state.teaserVolume || 0)));
      const vol = Math.max(0, Math.min(1, master * teaser * Math.max(0, Number(gain || 1))));
      if (vol <= 0) return null;

      try {
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.volume = vol;
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
        return audio;
      } catch (_) {
        return null;
      }
    }

    _playTtsAudio(url, gain = 1) {
      const src = String(url || '').trim();
      if (!src) return null;
      if (this.state.masterMuted || this.state.ttsMuted) return null;

      const master = Math.max(0, Math.min(1, Number(this.state.masterVolume || 0)));
      const tts = Math.max(0, Math.min(1, Number(this.state.ttsVolume || 0)));
      const vol = Math.max(0, Math.min(1, master * tts * Math.max(0, Number(gain || 1))));
      if (vol <= 0) return null;

      try {
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.volume = vol;
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
        return audio;
      } catch (_) {
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
      window.setTimeout(() => this._playTone(220, 0.08, 'sawtooth'), 34);
    }

    playUiNotify() {
      this._rememberAudioEvent('uiNotify');
      this.duckMusic();
      if (this._playSfx(this._resolveSfxTrack('uiNotify'), 0.8, 110)) return;
      this._playTone(740, 0.042, 'triangle');
      window.setTimeout(() => this._playTone(980, 0.05, 'triangle'), 40);
    }

    playNavigation() {
      this._rememberAudioEvent('navigation');
      this.duckMusic(180);
      if (this._playSfx(this._resolveSfxTrack('navigation'), 0.72, 85)) return;
      this._playTone(690, 0.045, 'triangle');
      window.setTimeout(() => this._playTone(840, 0.05, 'sine'), 34);
    }

    playResearchStart() {
      this._rememberAudioEvent('researchStart');
      this.duckMusic(260);
      if (this._playSfx(this._resolveSfxTrack('researchStart'), 0.8, 150)) return;
      this._playTone(760, 0.04, 'triangle');
      window.setTimeout(() => this._playTone(920, 0.055, 'triangle'), 38);
    }

    playResearchComplete() {
      this._rememberAudioEvent('researchComplete');
      this.duckMusic(280);
      if (this._playSfx(this._resolveSfxTrack('researchComplete'), 0.86, 180)) return;
      this._playTone(880, 0.05, 'triangle');
      window.setTimeout(() => this._playTone(1120, 0.07, 'triangle'), 42);
    }

    playFleetRecall() {
      this._rememberAudioEvent('fleetRecall');
      this.duckMusic(190);
      if (this._playSfx(this._resolveSfxTrack('fleetRecall'), 0.76, 120)) return;
      this._playTone(520, 0.038, 'sine');
      window.setTimeout(() => this._playTone(430, 0.05, 'triangle'), 28);
    }

    playMessageSend() {
      this._rememberAudioEvent('messageSend');
      this.duckMusic(180);
      if (this._playSfx(this._resolveSfxTrack('messageSend'), 0.78, 110)) return;
      this._playTone(720, 0.04, 'triangle');
      window.setTimeout(() => this._playTone(900, 0.05, 'sine'), 30);
    }

    playMessageRead() {
      this._rememberAudioEvent('messageRead');
      this.duckMusic(120);
      if (this._playSfx(this._resolveSfxTrack('messageRead'), 0.66, 90)) return;
      this._playTone(640, 0.035, 'triangle');
      window.setTimeout(() => this._playTone(780, 0.04, 'triangle'), 24);
    }

    playMessageDelete() {
      this._rememberAudioEvent('messageDelete');
      this.duckMusic(140);
      if (this._playSfx(this._resolveSfxTrack('messageDelete'), 0.72, 100)) return;
      this._playTone(360, 0.045, 'sawtooth');
      window.setTimeout(() => this._playTone(280, 0.05, 'triangle'), 20);
    }

    playPvpToggle() {
      this._rememberAudioEvent('pvpToggle');
      this.duckMusic(220);
      if (this._playSfx(this._resolveSfxTrack('pvpToggle'), 0.82, 180)) return;
      this._playTone(510, 0.045, 'square');
      window.setTimeout(() => this._playTone(690, 0.06, 'triangle'), 36);
    }

    playFleetAttack() {
      this._rememberAudioEvent('fleetAttack');
      this.duckMusic(220);
      if (this._playSfx(this._resolveSfxTrack('fleetAttack'), 0.84, 140)) return;
      this._playTone(420, 0.04, 'sawtooth');
      window.setTimeout(() => this._playTone(560, 0.055, 'square'), 24);
    }

    playFleetTransport() {
      this._rememberAudioEvent('fleetTransport');
      this.duckMusic(180);
      if (this._playSfx(this._resolveSfxTrack('fleetTransport'), 0.78, 140)) return;
      this._playTone(460, 0.04, 'sine');
      window.setTimeout(() => this._playTone(620, 0.05, 'triangle'), 28);
    }

    playFleetSpy() {
      this._rememberAudioEvent('fleetSpy');
      this.duckMusic(160);
      if (this._playSfx(this._resolveSfxTrack('fleetSpy'), 0.76, 140)) return;
      this._playTone(930, 0.03, 'triangle');
      window.setTimeout(() => this._playTone(780, 0.035, 'sine'), 18);
    }

    playFleetColonize() {
      this._rememberAudioEvent('fleetColonize');
      this.duckMusic(260);
      if (this._playSfx(this._resolveSfxTrack('fleetColonize'), 0.82, 180)) return;
      this._playTone(580, 0.05, 'square');
      window.setTimeout(() => this._playTone(760, 0.07, 'triangle'), 38);
    }

    playFleetHarvest() {
      this._rememberAudioEvent('fleetHarvest');
      this.duckMusic(180);
      if (this._playSfx(this._resolveSfxTrack('fleetHarvest'), 0.78, 150)) return;
      this._playTone(520, 0.04, 'triangle');
      window.setTimeout(() => this._playTone(680, 0.05, 'triangle'), 26);
    }

    playBuildComplete() {
      this._rememberAudioEvent('buildComplete');
      this.duckMusic();
      if (this._playSfx(this._resolveSfxTrack('buildComplete'), 0.88, 180)) return;
      this._playTone(510, 0.04, 'square');
      window.setTimeout(() => this._playTone(640, 0.05, 'square'), 36);
      window.setTimeout(() => this._playTone(790, 0.06, 'triangle'), 78);
    }

    playFleetLaunch() {
      this._rememberAudioEvent('fleetLaunch');
      this.duckMusic();
      if (this._playSfx(this._resolveSfxTrack('fleetLaunch'), 0.82, 140)) return;
      this._playTone(430, 0.04, 'sine');
      window.setTimeout(() => this._playTone(520, 0.045, 'sine'), 28);
      window.setTimeout(() => this._playTone(640, 0.06, 'triangle'), 60);
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
        this._applyVolumes();
      }
      this._save();
    }

    setMusicDuckingStrength(value) {
      this.state.musicDuckingStrength = Math.max(0.1, Math.min(0.9, Number(value || 0.55)));
      this._save();
    }

    duckMusic(holdMs = 280) {
      if (!this.state.musicDuckingEnabled) return;
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
      if (!this.state.musicDuckingEnabled) return;
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
    }

    setMusicVolume(value) {
      this.state.musicVolume = Math.max(0, Math.min(1, Number(value || 0)));
      this._applyVolumes();
      this._save();
    }

    setSfxVolume(value) {
      this.state.sfxVolume = Math.max(0, Math.min(1, Number(value || 0)));
      this._save();
    }

    setTeaserVolume(value) {
      this.state.teaserVolume = Math.max(0, Math.min(1, Number(value || 0)));
      this._save();
    }

    setTtsVolume(value) {
      this.state.ttsVolume = Math.max(0, Math.min(1, Number(value || 0)));
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
      this._save();
    }

    setTeaserMuted(value) {
      this.state.teaserMuted = !!value;
      this._save();
    }

    setTtsMuted(value) {
      this.state.ttsMuted = !!value;
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
      const gain = typeof opts.gain === 'number' ? Math.max(0, Math.min(1, opts.gain)) : 1;
      const holdMs = typeof opts.holdMs === 'number' ? opts.holdMs : 1800;
      this.duckMusicForTts(holdMs);
      return this._playTtsAudio(src, gain);
    }


    setMasterVolume(value) {
      this.state.masterVolume = Math.max(0, Math.min(1, Number(value || 0)));
      this._applyVolumes();
      this._save();
    }

    setMusicVolume(value) {
      this.state.musicVolume = Math.max(0, Math.min(1, Number(value || 0)));
      this._applyVolumes();
      this._save();
    }

    setSfxVolume(value) {
      this.state.sfxVolume = Math.max(0, Math.min(1, Number(value || 0)));
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
      this._save();
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
      if (!this._music.src) {
        this._log('warn', 'playMusic ohne gesetzte Quelle abgebrochen.');
        return false;
      }
      try {
        if (this._audioContext && this._audioContext.state === 'suspended') {
          await this._audioContext.resume();
        }
        this._applyVolumes();
        this._log('info', 'Play-Versuch', {
          track: this._prettyTrack(this._music.currentSrc || this._music.src || ''),
          muted: !!this.state.musicMuted || !!this.state.masterMuted,
          volume: Number(this._music.volume || 0),
        });
        await this._music.play();
        this.state.musicPaused = false;
        this._save();
        this._log('info', 'Musik läuft', {
          track: this._prettyTrack(this._music.currentSrc || this._music.src || ''),
          currentTime: Number(this._music.currentTime || 0),
        });
        this._emitStateChange();
        return true;
      } catch (err) {
        this._log('error', 'playMusic fehlgeschlagen', {
          track: this._prettyTrack(this._music.currentSrc || this._music.src || ''),
          error: String(err && err.message ? err.message : err || 'unknown'),
          name: String(err && err.name ? err.name : ''),
        });
        this._emitStateChange();
        return false;
      }
    }

    pauseMusic(resetPosition = false) {
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

    snapshot() {
      return Object.assign({}, this.state, {
        lastAudioEvent: this._lastAudioEvent ? Object.assign({}, this._lastAudioEvent) : null,
        musicPlaying: !this._music.paused,
        musicPaused: !!this.state.musicPaused,
      });
    }
  }

  window.GQAudioManager = GQAudioManager;
})();
