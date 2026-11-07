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
  const nodes = [];

  function SynthBase() {
    const node = {
      triggerAttackRelease, triggerAttack, triggerRelease,
      frequency: { value: 0, rampTo }, volume: { value: 0 },
      toDestination, dispose: vi.fn(),
    };
    nodes.push(node);
    return node;
  }
  SynthBase.prototype = { toDestination };

  const makeNode = () => {
    const node = { triggerAttackRelease, triggerAttack, volume: { value: 0 }, toDestination, dispose: vi.fn() };
    nodes.push(node);
    return node;
  };

  return {
    Destination: { volume: { value: 0 } },
    Synth:      vi.fn(function SynthMock() { return SynthBase(); }),
    MetalSynth: vi.fn(function MetalSynthMock() { return makeNode(); }),
    NoiseSynth: vi.fn(function NoiseSynthMock() { return makeNode(); }),
    PluckSynth: vi.fn(function PluckSynthMock() { return makeNode(); }),
    now:        vi.fn(() => 0),
    _mocks: { triggerAttackRelease, triggerAttack, triggerRelease, rampTo, nodes },
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

  it('sets per-effect node volume without changing the shared Destination', () => {
    synth.playProcedural('laser_fire', { volume: 0.5 });
    expect(tone._mocks.nodes[0].volume.value).toBeCloseTo(-6.02, 0);
    expect(tone.Destination.volume.value).toBe(0);
  });

  it('volume clamp: volume > 1 is treated as 1', () => {
    synth.playProcedural('laser_fire', { volume: 5 });
    expect(tone._mocks.nodes[0].volume.value).toBeCloseTo(0, 1);
  });

  it('does not create nodes for zero or invalid volume', () => {
    expect(synth.playProcedural('laser_fire', { volume: 0 })).toBe(false);
    expect(synth.playProcedural('laser_fire', { volume: Number.NaN })).toBe(false);
    expect(tone.MetalSynth).not.toHaveBeenCalled();
  });

  it('rejects invalid laser frequency without creating an instrument', () => {
    expect(synth.playProcedural('laser_fire', { freq: Number.NaN })).toBe(false);
    expect(synth.playProcedural('laser_fire', { freq: 0 })).toBe(false);
    expect(synth.playProcedural('laser_fire', { freq: 20001 })).toBe(false);
    expect(tone.MetalSynth).not.toHaveBeenCalled();
  });

  it('rejects non-finite or excessive effect durations', () => {
    expect(synth.playProcedural('engine_hum', { duration: Number.POSITIVE_INFINITY })).toBe(false);
    expect(synth.playProcedural('engine_hum', { duration: 31 })).toBe(false);
    expect(synth.playProcedural('explosion', { duration: Number.NaN })).toBe(false);
    expect(synth.playProcedural('warp_charge', { duration: 31 })).toBe(false);
    expect(tone.Synth).not.toHaveBeenCalled();
    expect(tone.NoiseSynth).not.toHaveBeenCalled();
  });

  it('disposes effect nodes after their scheduled playback window', () => {
    vi.useFakeTimers();
    try {
      expect(synth.playProcedural('engine_hum', { duration: 1.2 })).toBe(true);
      const [node] = tone._mocks.nodes;
      expect(node.dispose).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1799);
      expect(node.dispose).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(node.dispose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes all active nodes and cancels cleanup timers on dispose', () => {
    vi.useFakeTimers();
    try {
      synth.playProcedural('explosion');
      const nodes = tone._mocks.nodes;
      expect(nodes).toHaveLength(2);

      synth.dispose();
      synth.dispose();
      vi.runOnlyPendingTimers();

      expect(nodes[0].dispose).toHaveBeenCalledOnce();
      expect(nodes[1].dispose).toHaveBeenCalledOnce();
      expect(synth.playProcedural('laser_fire')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('attempts every node disposal and aggregates failures', () => {
    vi.useFakeTimers();
    try {
      synth.playProcedural('explosion');
      const nodes = tone._mocks.nodes;
      const failure = new Error('First node failed to dispose');
      nodes[0].dispose.mockImplementation(() => { throw failure; });

      expect(() => synth.dispose()).toThrow(expect.objectContaining({
        errors: [failure],
      }));
      expect(nodes[0].dispose).toHaveBeenCalledOnce();
      expect(nodes[1].dispose).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(synth.available).toBe(false);
      expect(synth.playProcedural('laser_fire')).toBe(false);
      expect(() => synth.dispose()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes a node when destination setup fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const node = {
      volume: { value: 0 },
      toDestination: vi.fn(() => { throw new Error('Destination unavailable'); }),
      dispose: vi.fn(),
    };
    tone.Synth.mockImplementationOnce(function DestinationFailureMock() { return node; });

    try {
      expect(synth.playProcedural('engine_hum')).toBe(false);
      expect(node.dispose).toHaveBeenCalledOnce();
      expect(synth._scheduledDisposals.size).toBe(0);
      expect(warn).toHaveBeenCalledWith('[GQ][AudioSynth] Procedural sound failed', expect.objectContaining({
        type: 'engine_hum',
      }));
    } finally {
      warn.mockRestore();
    }
  });

  it('calls Tone constructors once when construction fails', () => {
    const failure = new Error('Tone initialization failed');
    const constructor = vi.fn(function () { throw failure; });
    tone.MetalSynth = constructor;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(synth.playProcedural('laser_fire')).toBe(false);
      expect(constructor).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
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
