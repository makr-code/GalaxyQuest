/**
 * audio-synth.js  — GQAudioSynth
 *
 * Procedural audio synthesis for GalaxyQuest using Tone.js.
 *
 * This module is a non-breaking *extension* of the existing static-file
 * audio system (GQAudioManager).  It adds browser-side procedural synthesis
 * for dynamic in-game events (combat, warp, ambient) without touching the
 * existing file-playback pipeline.
 *
 * Integration with GQAudioManager
 * ─────────────────────────────────
 *   const synth = new GQAudioSynth();
 *   audioManager.setSynthEngine(synth);
 *   audioManager.playProceduralSfx('warp_charge');
 *   synth.dispose();
 *
 * Supported sound types
 * ─────────────────────
 *   'engine_hum'    — low oscillator drone for ship engines
 *   'laser_fire'    — short metallic attack via MetalSynth
 *   'explosion'     — noise burst with low-frequency pluck
 *   'warp_charge'   — rising pitch sweep before FTL jump
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

(function () {
  function getTone() {
    if (typeof require !== 'undefined') {
      try { return require('tone'); } catch (_) {}
    }
    if (typeof window !== 'undefined' && window.Tone) return window.Tone;
    return null;
  }

  function linearToDb(linear) {
    if (linear <= 0) return -Infinity;
    return 20 * Math.log10(Math.max(1e-6, linear));
  }

  function createToneNode(Ctor, options) {
    if (typeof Ctor !== 'function') {
      throw new TypeError('Invalid Tone constructor');
    }
    return new Ctor(options);
  }

  const MAX_DURATION_SECONDS = 30;
  const MAX_FREQUENCY_HZ = 20000;

  class GQAudioSynth {
    /**
     * @param {object}      [opts]
     * @param {object|null} [opts._tone]  Inject Tone.js for testing
     */
    constructor(opts = {}) {
      this._tone   = opts._tone !== undefined ? opts._tone : getTone();
      this.available = this._tone !== null;
      this._scheduledDisposals = new Map();
      this._disposed = false;
    }

    _createNode(Tone, Ctor, options, volume) {
      let synth;
      try {
        synth = createToneNode(Ctor, options);
        if (synth.volume && typeof synth.volume.value === 'number') {
          synth.volume.value = linearToDb(volume);
        }
        return synth.toDestination();
      } catch (error) {
        if (synth && typeof synth.dispose === 'function') {
          try {
            synth.dispose();
          } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Tone node setup and cleanup failed');
          }
        }
        throw error;
      }
    }

    _disposeNodes(nodes) {
      const errors = [];
      for (const node of nodes) {
        if (typeof node.dispose !== 'function') continue;
        try {
          node.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, 'Tone node disposal failed');
    }

    _handlePlaybackFailure(type, error, nodes = []) {
      const errors = [error];
      try {
        this._disposeNodes(nodes);
      } catch (cleanupError) {
        errors.push(...(cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError]));
      }
      console.warn('[GQ][AudioSynth] Procedural sound failed', {
        type,
        errors: errors.map(String),
      });
      return false;
    }

    _scheduleDisposal(nodes, delayMs) {
      const timeout = setTimeout(() => {
        this._scheduledDisposals.delete(timeout);
        try {
          this._disposeNodes(nodes);
        } catch (error) {
          console.warn('[GQ][AudioSynth] Scheduled node cleanup failed', { error: String(error) });
        }
      }, Math.max(0, Math.ceil(delayMs)));
      this._scheduledDisposals.set(timeout, nodes);
    }

    _playNodes(nodes, durationMs, trigger) {
      trigger();
      this._scheduleDisposal(nodes, durationMs);
      return true;
    }

    /**
     * Play a procedural sound effect.
     *
     * @param {string} type   — 'engine_hum' | 'laser_fire' | 'explosion' | 'warp_charge'
     * @param {object} [opts]
     * @param {number} [opts.volume=1]  — linear 0–1
     * @returns {boolean}
     */
    playProcedural(type, opts = {}) {
      if (!this._tone || this._disposed || !this.supports(type)) return false;

      const Tone   = this._tone;
      const requestedVolume = Number(opts.volume ?? 1);
      const volume = Number.isFinite(requestedVolume) ? Math.max(0, Math.min(1, requestedVolume)) : 0;
      if (volume <= 0) return false;
      const effectOptions = { ...opts, volume };

      switch (type) {
        case 'engine_hum':  return this._playEngineHum(Tone, effectOptions);
        case 'laser_fire':  return this._playLaserFire(Tone, effectOptions);
        case 'explosion':   return this._playExplosion(Tone, effectOptions);
        case 'warp_charge': return this._playWarpCharge(Tone, effectOptions);
        default:            return false;
      }
    }

    /** Whether a given type is supported. */
    supports(type) {
      return ['engine_hum', 'laser_fire', 'explosion', 'warp_charge'].includes(type);
    }

    // ── Private sound generators ──────────────────────────────────────────────

    _playEngineHum(Tone, opts) {
      let synth;
      try {
        const freq     = Number(opts.freq ?? 80);
        const duration = Number(opts.duration ?? 1.2);
        if (!Number.isFinite(freq) || freq <= 0 || freq > MAX_FREQUENCY_HZ
          || !Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) return false;
        synth = this._createNode(Tone, Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope:   { attack: 0.3, decay: 0.1, sustain: 0.7, release: 0.5 },
        }, Number(opts.volume ?? 1));
        return this._playNodes([synth], (duration + 0.6) * 1000, () => synth.triggerAttackRelease(freq, duration));
      } catch (error) {
        return this._handlePlaybackFailure('engine_hum', error, synth ? [synth] : []);
      }
    }

    _playLaserFire(Tone, opts) {
      let synth;
      try {
        const frequency = Number(opts.freq ?? 400);
        if (!Number.isFinite(frequency) || frequency <= 0 || frequency > MAX_FREQUENCY_HZ) return false;
        synth = this._createNode(Tone, Tone.MetalSynth, {
          frequency,
          envelope:   { attack: 0.001, decay: 0.1, release: 0.05 },
          harmonicity: 5.1,
          modulationIndex: 32,
          resonance: 4000,
          octaves: 1.5,
        }, Number(opts.volume ?? 1));
        return this._playNodes([synth], 500, () => synth.triggerAttackRelease('16n'));
      } catch (error) {
        return this._handlePlaybackFailure('laser_fire', error, synth ? [synth] : []);
      }
    }

    _playExplosion(Tone, opts) {
      const nodes = [];
      try {
        const duration = Number(opts.duration ?? 0.8);
        if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) return false;
        const synth = this._createNode(Tone, Tone.NoiseSynth, {
          noise:    { type: 'brown' },
          envelope: { attack: 0.005, decay: duration * 0.6, sustain: 0, release: duration * 0.4 },
        }, Number(opts.volume ?? 1));
        nodes.push(synth);

        // Low thud via PluckSynth
        const pluck = this._createNode(Tone, Tone.PluckSynth, {
          attackNoise: 2, dampening: 2800, resonance: 0.9,
        }, Number(opts.volume ?? 1));
        nodes.push(pluck);
        return this._playNodes(nodes, (duration * 1.6 + 0.5) * 1000, () => {
          synth.triggerAttackRelease(duration);
          pluck.triggerAttack('C2');
        });
      } catch (error) {
        return this._handlePlaybackFailure('explosion', error, nodes);
      }
    }

    _playWarpCharge(Tone, opts) {
      let synth;
      try {
        const duration = Number(opts.duration ?? 2.0);
        if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) return false;
        synth = this._createNode(Tone, Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope:   { attack: duration * 0.6, decay: 0.1, sustain: 0.5, release: duration * 0.3 },
        }, Number(opts.volume ?? 1));
        return this._playNodes([synth], (duration * 1.4 + 0.2) * 1000, () => {
          synth.frequency.value = 120;
          synth.triggerAttack(120);
          synth.frequency.rampTo(960, duration * 0.7);
          const now = Tone.now ? Tone.now() : 0;
          synth.triggerRelease(now + duration);
        });
      } catch (error) {
        return this._handlePlaybackFailure('warp_charge', error, synth ? [synth] : []);
      }
    }

    dispose() {
      if (this._disposed) return;
      this._disposed = true;
      this.available = false;
      const errors = [];
      for (const [timeout, nodes] of this._scheduledDisposals) {
        try {
          clearTimeout(timeout);
        } catch (error) {
          errors.push(error);
        }
        try {
          this._disposeNodes(nodes);
        } catch (error) {
          errors.push(...(error instanceof AggregateError ? error.errors : [error]));
        }
      }
      this._scheduledDisposals.clear();
      if (errors.length) throw new AggregateError(errors, 'Audio synth disposal failed');
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GQAudioSynth };
  } else {
    window.GQAudioSynth = GQAudioSynth;
  }
})();
