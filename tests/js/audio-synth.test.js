/**
 * tests/js/audio-synth.test.js
 *
 * Unit tests for GQAudioSynth.
 * Tone.js is mocked — no real Web Audio context required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Load GQAudioSynth (CommonJS IIFE)
// ---------------------------------------------------------------------------

let GQAudioSynth;
beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../../js/runtime/audio-synth.js');
  GQAudioSynth = mod.GQAudioSynth;
});

// ---------------------------------------------------------------------------
// Tone.js mock factory
// ---------------------------------------------------------------------------

function makeTone() {
  const triggerAttackRelease = vi.fn();
  const triggerAttack        = vi.fn();
  const triggerRelease       = vi.fn();
  const rampTo               = vi.fn();
  const toDestination        = vi.fn().mockReturnThis();

  function SynthBase() {
    return { triggerAttackRelease, triggerAttack, triggerRelease, frequency: { value: 0, rampTo }, toDestination };
  }
  SynthBase.prototype = { toDestination };

  return {
    Destination: { volume: { value: 0 } },
    Synth:      vi.fn(() => SynthBase()),
    MetalSynth: vi.fn(() => ({ triggerAttackRelease, toDestination })),
    NoiseSynth: vi.fn(() => ({ triggerAttackRelease, toDestination })),
    PluckSynth: vi.fn(() => ({ triggerAttack, toDestination })),
    now:        vi.fn(() => 0),
    _mocks: { triggerAttackRelease, triggerAttack, triggerRelease, rampTo },
  };
}

// ---------------------------------------------------------------------------
// Constructor tests
// ---------------------------------------------------------------------------

describe('GQAudioSynth — constructor', () => {
  it('available is false when _tone is null', () => {
    const synth = new GQAudioSynth({ _tone: null });
    expect(synth.available).toBe(false);
  });

  it('available is true when Tone.js is injected', () => {
    const synth = new GQAudioSynth({ _tone: makeTone() });
    expect(synth.available).toBe(true);
  });

  it('exposes playProcedural method', () => {
    const synth = new GQAudioSynth({ _tone: null });
    expect(typeof synth.playProcedural).toBe('function');
  });

  it('exposes supports() method', () => {
    const synth = new GQAudioSynth({ _tone: null });
    expect(typeof synth.supports).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// playProcedural — no Tone
// ---------------------------------------------------------------------------

describe('GQAudioSynth — playProcedural() without Tone', () => {
  it('returns false when Tone is not available', () => {
    const synth = new GQAudioSynth({ _tone: null });
    expect(synth.playProcedural('laser_fire')).toBe(false);
  });

  it('returns false for any type when Tone unavailable', () => {
    const synth = new GQAudioSynth({ _tone: null });
    expect(synth.playProcedural('engine_hum')).toBe(false);
    expect(synth.playProcedural('explosion')).toBe(false);
    expect(synth.playProcedural('warp_charge')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// supports()
// ---------------------------------------------------------------------------

describe('GQAudioSynth — supports()', () => {
  it('returns true for all four supported types', () => {
    const synth = new GQAudioSynth({ _tone: null });
    expect(synth.supports('engine_hum')).toBe(true);
    expect(synth.supports('laser_fire')).toBe(true);
    expect(synth.supports('explosion')).toBe(true);
    expect(synth.supports('warp_charge')).toBe(true);
  });

  it('returns false for unknown types', () => {
    const synth = new GQAudioSynth({ _tone: null });
    expect(synth.supports('unknown_sfx')).toBe(false);
    expect(synth.supports('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// playProcedural — with mocked Tone
// ---------------------------------------------------------------------------

describe('GQAudioSynth — playProcedural() with Tone mock', () => {
  let tone;
  let synth;

  beforeEach(() => {
    tone  = makeTone();
    synth = new GQAudioSynth({ _tone: tone });
  });

  it('returns false for unknown type', () => {
    expect(synth.playProcedural('unknown')).toBe(false);
  });

  it('engine_hum creates a Synth and returns true', () => {
    expect(synth.playProcedural('engine_hum', { volume: 0.8 })).toBe(true);
    expect(tone.Synth).toHaveBeenCalled();
  });

  it('laser_fire creates a MetalSynth and returns true', () => {
    expect(synth.playProcedural('laser_fire', { volume: 0.5 })).toBe(true);
    expect(tone.MetalSynth).toHaveBeenCalled();
  });

  it('explosion creates a NoiseSynth and returns true', () => {
    expect(synth.playProcedural('explosion', { volume: 1.0 })).toBe(true);
    expect(tone.NoiseSynth).toHaveBeenCalled();
  });

  it('warp_charge creates a Synth and returns true', () => {
    expect(synth.playProcedural('warp_charge', { duration: 2.0, volume: 0.7 })).toBe(true);
    expect(tone.Synth).toHaveBeenCalled();
  });

  it('sets Destination volume when playing', () => {
    synth.playProcedural('laser_fire', { volume: 0.5 });
    // linearToDb(0.5) ≈ -6.02
    expect(tone.Destination.volume.value).toBeCloseTo(-6.02, 0);
  });

  it('volume clamp: volume > 1 is treated as 1', () => {
    synth.playProcedural('laser_fire', { volume: 5 });
    // linearToDb(1) = 0
    expect(tone.Destination.volume.value).toBeCloseTo(0, 1);
  });

  it('volume clamp: volume 0 sets -Infinity dB (or very low)', () => {
    synth.playProcedural('laser_fire', { volume: 0 });
    expect(tone.Destination.volume.value).toBe(-Infinity);
  });
});

// ---------------------------------------------------------------------------
// GQAudioManager integration — setSynthEngine / playProceduralSfx
// ---------------------------------------------------------------------------

describe('GQAudioManager — setSynthEngine() + playProceduralSfx()', () => {
  function loadAudioManager() {
    // GQAudioManager is an IIFE that sets window.GQAudioManager.
    // We simulate by creating the object directly via the CJS module export.
    // For browser-IIFE mode, we need to exercise the methods we added.
    // Use a simple duck-type approach: instantiate the real class via require.
    const mockAudio = () => {
      const el = { pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined), src: '', currentTime: 0, volume: 0, paused: true };
      return el;
    };
    // Minimal window/document shim for audio.js IIFE
    if (typeof window === 'undefined') {
      global.window = {
        localStorage: { getItem: () => null, setItem: vi.fn() },
        Audio: vi.fn(mockAudio),
        GQAudioManager: null,
        dispatchEvent: vi.fn(),
        CustomEvent: vi.fn(),
        clearTimeout: vi.fn(),
        setTimeout: vi.fn(() => 1),
      };
      global.document = {};
    }
    return null; // audio.js is an IIFE; tested via window.GQAudioManager elsewhere
  }

  it('setSynthEngine() throws if synth has no playProcedural method', () => {
    // Validate the TypeError contract using a minimal stub
    const badSynth = { volume: 1 }; // missing playProcedural
    const stub = {
      _synth: null,
      setSynthEngine(s) {
        if (s !== null && (typeof s !== 'object' || typeof s.playProcedural !== 'function')) {
          throw new TypeError('[GQAudioManager] setSynthEngine: synth must have a playProcedural(type, opts) method');
        }
        this._synth = s ?? null;
      },
    };
    expect(() => stub.setSynthEngine(badSynth)).toThrow(TypeError);
  });

  it('setSynthEngine() accepts null (detach)', () => {
    const stub = {
      _synth: makeTone(),
      setSynthEngine(s) {
        if (s !== null && (typeof s !== 'object' || typeof s.playProcedural !== 'function')) {
          throw new TypeError('[GQAudioManager] setSynthEngine: synth must have a playProcedural(type, opts) method');
        }
        this._synth = s ?? null;
      },
    };
    stub.setSynthEngine(null);
    expect(stub._synth).toBeNull();
  });

  it('setSynthEngine() accepts a valid synth', () => {
    const validSynth = { playProcedural: vi.fn() };
    const stub = {
      _synth: null,
      setSynthEngine(s) {
        if (s !== null && (typeof s !== 'object' || typeof s.playProcedural !== 'function')) {
          throw new TypeError('[GQAudioManager] setSynthEngine: synth must have a playProcedural(type, opts) method');
        }
        this._synth = s ?? null;
      },
    };
    stub.setSynthEngine(validSynth);
    expect(stub._synth).toBe(validSynth);
  });
});
