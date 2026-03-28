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

  class GQAudioManager {
    constructor(opts = {}) {
      this.storageKey = String(opts.storageKey || 'gq_audio_settings');
      this.state = {
        masterVolume: 0.8,
        musicVolume: 0.55,
        sfxVolume: 0.8,
        masterMuted: false,
        musicMuted: false,
        sfxMuted: false,
        musicDuckingEnabled: true,
        musicDuckingStrength: 0.55,
        musicUrl: '',
        autoSceneMusic: true,
        currentScene: 'ui',
        sceneTracks: Object.assign({}, DEFAULT_SCENE_TRACKS),
        sfxMap: Object.assign({}, DEFAULT_SFX),
      };

      this._music = new Audio();
      this._music.loop = true;
      this._music.preload = 'none';
      this._music.crossOrigin = 'anonymous';
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
      this._lastAudioEvent = null;

      this._load();
      this._bootstrapDefaultMedia();
      this._applyVolumes();
      if (this.state.musicUrl) {
        this.setMusicTrack(this.state.musicUrl, false);
      }
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

    _load() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        this.state = Object.assign({}, this.state, parsed);
      } catch (_) {}
    }

    _save() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.state));
      } catch (_) {}
    }

    _applyVolumes() {
      if (this._isFading) return;
      this._music.volume = this._targetMusicVolume();
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

    _fadeMusicTo(targetVolume, durationMs = 220) {
      this._cancelFade();
      const token = this._fadeToken;
      const startVolume = Number(this._music.volume || 0);
      const endVolume = Math.max(0, Math.min(1, Number(targetVolume || 0)));
      const ms = Math.max(0, Number(durationMs || 0));
      if (ms <= 0 || Math.abs(endVolume - startVolume) < 0.001) {
        this._music.volume = endVolume;
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
          this._music.volume = startVolume + (endVolume - startVolume) * eased;
          if (p >= 1) {
            this._music.volume = endVolume;
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

    async _switchMusicTrack(url, autoplay = false, smooth = false, fadeMsOverride = null) {
      const next = String(url || '').trim();
      if (!next) {
        this.stopMusic();
        return false;
      }

      this._duckFactor = 1;
      if (this._duckTimer) {
        window.clearTimeout(this._duckTimer);
        this._duckTimer = 0;
      }

      const current = String(this._music.src || '').trim();
      const sameTrack = current === next;
      if (sameTrack) {
        if (autoplay) return this.playMusic();
        this._applyVolumes();
        return true;
      }

      const fadeMs = Number.isFinite(Number(fadeMsOverride)) ? Math.max(120, Number(fadeMsOverride)) : this._sceneFadeMs;
      const targetVol = this._targetMusicVolume();
      const canFade = !!smooth && !!autoplay && !this._music.paused && this._music.currentTime > 0.05;
      if (canFade) {
        await this._fadeMusicTo(0, Math.round(fadeMs * 0.5));
      } else {
        this._cancelFade();
      }

      this._music.src = next;
      if (!autoplay) {
        this._isFading = false;
        this._applyVolumes();
        return true;
      }

      try {
        await this.playMusic();
      } catch (_) {}

      if (canFade && targetVol > 0) {
        this._music.volume = 0;
        await this._fadeMusicTo(targetVol, fadeMs);
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
    }

    setMusicMuted(value) {
      this.state.musicMuted = !!value;
      this._applyVolumes();
      this._save();
    }

    setSfxMuted(value) {
      this.state.sfxMuted = !!value;
      this._save();
    }

    setMusicTrack(url, autoplay = false, opts = {}) {
      this.state.musicUrl = String(url || '').trim();
      this._save();
      if (!this.state.musicUrl) {
        this.stopMusic();
        return;
      }
      const smooth = !!opts.smooth;
      const fadeMs = Number.isFinite(Number(opts.fadeMs)) ? Number(opts.fadeMs) : null;
      this._switchMusicTrack(this.state.musicUrl, autoplay, smooth, fadeMs);
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
      const autoplay = !!opts.autoplay;
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
      if (!this._music.src) return false;
      try {
        if (this._audioContext && this._audioContext.state === 'suspended') {
          await this._audioContext.resume();
        }
        this._applyVolumes();
        await this._music.play();
        return true;
      } catch (_) {
        return false;
      }
    }

    stopMusic() {
      this._cancelFade();
      if (this._duckTimer) {
        window.clearTimeout(this._duckTimer);
        this._duckTimer = 0;
      }
      this._duckFactor = 1;
      this._music.pause();
      this._music.currentTime = 0;
      this._applyVolumes();
    }

    snapshot() {
      return Object.assign({}, this.state, {
        lastAudioEvent: this._lastAudioEvent ? Object.assign({}, this._lastAudioEvent) : null,
        musicPlaying: !this._music.paused,
      });
    }
  }

  window.GQAudioManager = GQAudioManager;
})();
