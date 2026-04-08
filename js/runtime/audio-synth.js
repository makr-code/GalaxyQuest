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
    try {
      // Test doubles often expose callable factories instead of class ctors.
      return Ctor(options);
    } catch (_) {
      return new Ctor(options);
    }
  }

  class GQAudioSynth {
    /**
     * @param {object}      [opts]
     * @param {object|null} [opts._tone]  Inject Tone.js for testing
     */
    constructor(opts = {}) {
      this._tone   = opts._tone !== undefined ? opts._tone : getTone();
      this.available = this._tone !== null;
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
      if (!this._tone) return false;

      const Tone   = this._tone;
      const volume = Math.max(0, Math.min(1, Number(opts.volume ?? 1)));

      try {
        if (Tone.Destination && typeof Tone.Destination.volume === 'object') {
          Tone.Destination.volume.value = linearToDb(volume);
        }
      } catch (_) {}

      switch (type) {
        case 'engine_hum':  return this._playEngineHum(Tone, opts);
        case 'laser_fire':  return this._playLaserFire(Tone, opts);
        case 'explosion':   return this._playExplosion(Tone, opts);
        case 'warp_charge': return this._playWarpCharge(Tone, opts);
        default:            return false;
      }
    }

    /** Whether a given type is supported. */
    supports(type) {
      return ['engine_hum', 'laser_fire', 'explosion', 'warp_charge'].includes(type);
    }

    // ── Private sound generators ──────────────────────────────────────────────

    _playEngineHum(Tone, opts) {
      try {
        const freq     = Number(opts.freq ?? 80);
        const duration = Number(opts.duration ?? 1.2);
        const synth    = createToneNode(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope:   { attack: 0.3, decay: 0.1, sustain: 0.7, release: 0.5 },
        }).toDestination();
        synth.triggerAttackRelease(freq, duration);
        return true;
      } catch (_) {
        return false;
      }
    }

    _playLaserFire(Tone, opts) {
      try {
        const synth = createToneNode(Tone.MetalSynth, {
          frequency:  Number(opts.freq ?? 400),
          envelope:   { attack: 0.001, decay: 0.1, release: 0.05 },
          harmonicity: 5.1,
          modulationIndex: 32,
          resonance: 4000,
          octaves: 1.5,
        }).toDestination();
        synth.triggerAttackRelease('16n');
        return true;
      } catch (_) {
        return false;
      }
    }

    _playExplosion(Tone, opts) {
      try {
        const duration = Number(opts.duration ?? 0.8);
        const synth    = createToneNode(Tone.NoiseSynth, {
          noise:    { type: 'brown' },
          envelope: { attack: 0.005, decay: duration * 0.6, sustain: 0, release: duration * 0.4 },
        }).toDestination();
        synth.triggerAttackRelease(duration);

        // Low thud via PluckSynth
        const pluck = createToneNode(Tone.PluckSynth, { attackNoise: 2, dampening: 2800, resonance: 0.9 }).toDestination();
        pluck.triggerAttack('C2');
        return true;
      } catch (_) {
        return false;
      }
    }

    _playWarpCharge(Tone, opts) {
      try {
        const duration = Number(opts.duration ?? 2.0);
        const synth    = createToneNode(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope:   { attack: duration * 0.6, decay: 0.1, sustain: 0.5, release: duration * 0.3 },
        }).toDestination();
        // Rising sweep: start at 120 Hz, ramp to 960 Hz
        synth.frequency.value = 120;
        synth.triggerAttack(120);
        synth.frequency.rampTo(960, duration * 0.7);
        // Schedule release
        try {
          const now = Tone.now ? Tone.now() : 0;
          synth.triggerRelease(now + duration);
        } catch (_) {}
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GQAudioSynth };
  } else {
    window.GQAudioSynth = GQAudioSynth;
  }
})();
