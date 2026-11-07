/**
 * tests/js/audio.test.js
 *
 * Unit tests for the GQAudioManager multi-channel extensions:
 *   - Teaser sound channel (teaserVolume, teaserMuted, playTeaser)
 *   - TTS audio channel (ttsVolume, ttsMuted, playTtsAudio, duckMusicForTts)
 *   - Snapshot includes new channel fields
 *
 * The module writes window.GQAudioManager (a class). We load it with eval() to
 * mirror browser loading, then instantiate it with a minimal Audio mock.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ── Load helper ───────────────────────────────────────────────────────────────

const audioPath = path.resolve(process.cwd(), 'js/runtime/audio.js');

function loadAudioScript() {
  delete window.GQAudioManager;
  window.eval(fs.readFileSync(audioPath, 'utf8'));
  return window.GQAudioManager;
}

// ── Audio element mock ────────────────────────────────────────────────────────

function makeAudioMock() {
  return vi.fn(function AudioMock(src) {
    this.src = src || '';
    this.volume = 1;
    this.loop = false;
    this.preload = 'none';
    this.crossOrigin = null;
    this.paused = true;
    this.currentTime = 0;
    this.currentSrc = src || '';
    this.play = vi.fn().mockResolvedValue(undefined);
    this.pause = vi.fn();
    this.removeAttribute = vi.fn((name) => {
      if (name === 'src') this.src = '';
    });
    this.load = vi.fn();
    const events = new EventTarget();
    this.addEventListener = events.addEventListener.bind(events);
    this.removeEventListener = events.removeEventListener.bind(events);
    this.dispatchEvent = events.dispatchEvent.bind(events);
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Clear the cookie used by test managers (cookieKey = 'test_audio')
  document.cookie = 'test_audio=; Max-Age=0; Path=/';

  // Provide Audio mock
  vi.stubGlobal('Audio', makeAudioMock());

  // Provide minimal window properties that GQAudioManager needs
  vi.stubGlobal('performance', { now: vi.fn(() => Date.now()) });
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('clearTimeout', vi.fn());
  vi.stubGlobal('setTimeout', vi.fn((cb, ms) => {
    // Return a fake timer id; do not auto-fire
    return 1;
  }));
});

// ── Factory ───────────────────────────────────────────────────────────────────

function createManager(overrides = {}) {
  const GQAudioManager = loadAudioScript();
  return new GQAudioManager({
    storageKey: 'test_audio',
    cookieKey: 'test_audio',
    sessionKey: 'test_audio_session',
    ...overrides,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Teaser channel
// ═════════════════════════════════════════════════════════════════════════════

describe('teaserVolume default', () => {
  it('defaults to 0.9', () => {
    const mgr = createManager();
    expect(mgr.state.teaserVolume).toBeCloseTo(0.9);
  });
});

describe('setTeaserVolume()', () => {
  it('sets teaserVolume within [0, 1]', () => {
    const mgr = createManager();
    mgr.setTeaserVolume(0.6);
    expect(mgr.state.teaserVolume).toBeCloseTo(0.6);
  });

  it('clamps values below 0 to 0', () => {
    const mgr = createManager();
    mgr.setTeaserVolume(-1);
    expect(mgr.state.teaserVolume).toBe(0);
  });

  it('clamps values above 1 to 1', () => {
    const mgr = createManager();
    mgr.setTeaserVolume(2);
    expect(mgr.state.teaserVolume).toBe(1);
  });

  it('persists to localStorage', () => {
    const mgr = createManager();
    mgr.setTeaserVolume(0.4);
    const stored = JSON.parse(localStorage.getItem('test_audio') || '{}');
    expect(stored.teaserVolume).toBeCloseTo(0.4);
  });
});

describe('setTeaserMuted()', () => {
  it('defaults to false', () => {
    const mgr = createManager();
    expect(mgr.state.teaserMuted).toBe(false);
  });

  it('mutes the teaser channel', () => {
    const mgr = createManager();
    mgr.setTeaserMuted(true);
    expect(mgr.state.teaserMuted).toBe(true);
  });

  it('unmutes the teaser channel', () => {
    const mgr = createManager();
    mgr.setTeaserMuted(true);
    mgr.setTeaserMuted(false);
    expect(mgr.state.teaserMuted).toBe(false);
  });
});

describe('playTeaser()', () => {
  it('returns null for empty URL', () => {
    const mgr = createManager();
    expect(mgr.playTeaser('')).toBeNull();
  });

  it('returns an Audio element for a valid URL', () => {
    const mgr = createManager();
    const result = mgr.playTeaser('sfx/test.wav');
    expect(result).not.toBeNull();
  });

  it('creates Audio with the correct src', () => {
    const mgr = createManager();
    mgr.playTeaser('sfx/teaser.wav');
    const AudioMock = window.Audio;
    expect(AudioMock).toHaveBeenCalledWith('sfx/teaser.wav');
  });

  it('plays the Audio element', () => {
    const mgr = createManager();
    const el = mgr.playTeaser('sfx/teaser.wav');
    expect(el.play).toHaveBeenCalled();
  });

  it('returns null when teaserMuted is true', () => {
    const mgr = createManager();
    mgr.setTeaserMuted(true);
    expect(mgr.playTeaser('sfx/teaser.wav')).toBeNull();
  });

  it('returns null when masterMuted is true', () => {
    const mgr = createManager();
    mgr.setMasterMuted(true);
    expect(mgr.playTeaser('sfx/teaser.wav')).toBeNull();
  });

  it('sets volume = master * teaser * gain', () => {
    const mgr = createManager();
    mgr.setMasterVolume(1);
    mgr.setTeaserVolume(0.5);
    const el = mgr.playTeaser('sfx/teaser.wav', { gain: 0.8 });
    expect(el.volume).toBeCloseTo(0.4); // 1 * 0.5 * 0.8
  });

  it('respects minimum interval (returns null when called again too soon)', () => {
    const mgr = createManager();
    mgr.playTeaser('sfx/teaser.wav', { minIntervalMs: 500 });
    // Second immediate call should be rejected
    const second = mgr.playTeaser('sfx/teaser.wav', { minIntervalMs: 500 });
    expect(second).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TTS channel
// ═════════════════════════════════════════════════════════════════════════════

describe('ttsVolume default', () => {
  it('defaults to 0.95', () => {
    const mgr = createManager();
    expect(mgr.state.ttsVolume).toBeCloseTo(0.95);
  });
});

describe('setTtsVolume()', () => {
  it('sets ttsVolume within [0, 1]', () => {
    const mgr = createManager();
    mgr.setTtsVolume(0.7);
    expect(mgr.state.ttsVolume).toBeCloseTo(0.7);
  });

  it('clamps below 0', () => {
    const mgr = createManager();
    mgr.setTtsVolume(-0.5);
    expect(mgr.state.ttsVolume).toBe(0);
  });

  it('clamps above 1', () => {
    const mgr = createManager();
    mgr.setTtsVolume(1.5);
    expect(mgr.state.ttsVolume).toBe(1);
  });

  it('persists to localStorage', () => {
    const mgr = createManager();
    mgr.setTtsVolume(0.8);
    const stored = JSON.parse(localStorage.getItem('test_audio') || '{}');
    expect(stored.ttsVolume).toBeCloseTo(0.8);
  });
});

describe('setTtsMuted()', () => {
  it('defaults to false', () => {
    const mgr = createManager();
    expect(mgr.state.ttsMuted).toBe(false);
  });

  it('mutes the TTS channel', () => {
    const mgr = createManager();
    mgr.setTtsMuted(true);
    expect(mgr.state.ttsMuted).toBe(true);
  });

  it('unmutes the TTS channel', () => {
    const mgr = createManager();
    mgr.setTtsMuted(true);
    mgr.setTtsMuted(false);
    expect(mgr.state.ttsMuted).toBe(false);
  });
});

describe('playTtsAudio()', () => {
  it('returns null for empty URL', () => {
    const mgr = createManager();
    expect(mgr.playTtsAudio('')).toBeNull();
  });

  it('returns an Audio element for a valid URL', () => {
    const mgr = createManager();
    const result = mgr.playTtsAudio('/generated/tts/line.mp3');
    expect(result).not.toBeNull();
  });

  it('plays the Audio element', () => {
    const mgr = createManager();
    const el = mgr.playTtsAudio('/generated/tts/line.mp3');
    expect(el.play).toHaveBeenCalled();
  });

  it('returns null when ttsMuted is true', () => {
    const mgr = createManager();
    mgr.setTtsMuted(true);
    expect(mgr.playTtsAudio('/generated/tts/line.mp3')).toBeNull();
  });

  it('returns null when masterMuted is true', () => {
    const mgr = createManager();
    mgr.setMasterMuted(true);
    expect(mgr.playTtsAudio('/generated/tts/line.mp3')).toBeNull();
  });

  it('sets volume = master * tts * gain', () => {
    const mgr = createManager();
    mgr.setMasterVolume(1);
    mgr.setTtsVolume(0.8);
    const el = mgr.playTtsAudio('/generated/tts/line.mp3', { gain: 0.5 });
    expect(el.volume).toBeCloseTo(0.4); // 1 * 0.8 * 0.5
  });

  it('tracks actual TTS playback instead of a fixed ducking timeout', () => {
    const mgr = createManager();
    const spy = vi.spyOn(mgr, 'trackTtsAudio');
    mgr.playTtsAudio('/generated/tts/line.mp3');
    expect(spy).toHaveBeenCalled();
  });

  it('keeps long and overlapping speech ducked until the last clip stops, using current music volume', () => {
    const mgr = createManager();
    const baseline = mgr._targetMusicVolume();
    const first = mgr.playTtsAudio('/first.mp3');
    const second = mgr.playTtsAudio('/second.mp3');
    expect(mgr._targetMusicVolume()).toBeCloseTo(baseline);
    first.paused = false;
    first.dispatchEvent(new Event('playing'));
    expect(mgr._targetMusicVolume()).toBeLessThan(baseline * 0.2);
    expect(mgr._music.volume).toBeCloseTo(mgr._targetMusicVolume());
    second.paused = false;
    second.dispatchEvent(new Event('playing'));
    first.dispatchEvent(new Event('ended'));
    expect(mgr._targetMusicVolume()).toBeLessThan(baseline * 0.2);
    mgr.duckMusic(120);
    mgr._duckFactor = 1;
    expect(mgr._targetMusicVolume()).toBeLessThan(baseline * 0.2);
    mgr.setMusicVolume(0.3);
    second.paused = true;
    second.dispatchEvent(new Event('pause'));
    expect(mgr._targetMusicVolume()).toBeCloseTo(0.8 * 0.3);
    second.paused = false;
    second.dispatchEvent(new Event('playing'));
    expect(mgr._targetMusicVolume()).toBeLessThan(0.8 * 0.3);
    second.dispatchEvent(new Event('error'));
    expect(mgr._targetMusicVolume()).toBeCloseTo(0.8 * 0.3);
    expect(mgr._music.volume).toBeCloseTo(0.8 * 0.3);
  });

  it('applies live ducking preferences and excludes muted or silent speech', () => {
    const mgr = createManager();
    const baseline = mgr._targetMusicVolume();
    expect(mgr.playTtsAudio('/silent.mp3', { gain: 0 })).toBeNull();
    const el = mgr.playTtsAudio('/line.mp3');
    el.paused = false;
    el.dispatchEvent(new Event('playing'));
    mgr.setMusicDuckingEnabled(false);
    expect(mgr._targetMusicVolume()).toBeCloseTo(baseline);
    mgr.setMusicDuckingEnabled(true);
    const strong = mgr._targetMusicVolume();
    mgr.setMusicDuckingStrength(0.1);
    expect(mgr._targetMusicVolume()).toBeGreaterThan(strong);
    const restored = createManager();
    expect(restored.state.musicDuckingEnabled).toBe(true);
    expect(restored.state.musicDuckingStrength).toBeCloseTo(0.1);
    el.muted = true;
    el.dispatchEvent(new Event('volumechange'));
    expect(mgr._targetMusicVolume()).toBeCloseTo(baseline);
    el.muted = false;
    el.dispatchEvent(new Event('volumechange'));
    expect(mgr._targetMusicVolume()).toBeLessThan(baseline);
    mgr.setTtsMuted(true);
    expect(mgr._targetMusicVolume()).toBeCloseTo(baseline);
    mgr.setTtsMuted(false);
    expect(mgr._targetMusicVolume()).toBeLessThan(baseline);
    el.dispatchEvent(new Event('emptied'));
    expect(mgr._targetMusicVolume()).toBeCloseTo(baseline);
  });

  it('cleans up rejected playback and logs the failure', async () => {
    const mgr = createManager();
    const log = vi.spyOn(mgr, '_log');
    Audio.mockImplementationOnce(function () {
      const el = new EventTarget();
      el.paused = false;
      el.removeAttribute = vi.fn();
      el.load = vi.fn();
      el.play = () => {
        el.dispatchEvent(new Event('playing'));
        return Promise.reject(new Error('Autoplay blocked'));
      };
      return el;
    });
    const el = mgr.playTtsAudio('/blocked.mp3');
    expect(el).not.toBeNull();
    expect(mgr._speakingAudio.size).toBe(1);
    await Promise.resolve();
    expect(mgr._speakingAudio.size).toBe(0);
    expect(log).toHaveBeenCalledWith('warn', 'Sprachausgabe konnte nicht gestartet werden', { error: 'Error: Autoplay blocked' });
  });

  it('does NOT duck music when ttsMuted is true', () => {
    const mgr = createManager();
    mgr.setTtsMuted(true);
    const spy = vi.spyOn(mgr, 'duckMusicForTts');
    mgr.playTtsAudio('/generated/tts/line.mp3');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT duck music when masterMuted is true', () => {
    const mgr = createManager();
    mgr.setMasterMuted(true);
    const spy = vi.spyOn(mgr, 'duckMusicForTts');
    mgr.playTtsAudio('/generated/tts/line.mp3');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT duck music for empty URL', () => {
    const mgr = createManager();
    const spy = vi.spyOn(mgr, 'duckMusicForTts');
    mgr.playTtsAudio('');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// duckMusicForTts()
// ═════════════════════════════════════════════════════════════════════════════

describe('duckMusicForTts()', () => {
  it('does nothing when musicDuckingEnabled is false', () => {
    const mgr = createManager();
    mgr.state.musicDuckingEnabled = false;
    // Should not throw
    expect(() => mgr.duckMusicForTts()).not.toThrow();
  });

  it('does nothing when music src is empty', () => {
    const mgr = createManager();
    mgr.state.musicDuckingEnabled = true;
    mgr._music.src = '';
    expect(() => mgr.duckMusicForTts()).not.toThrow();
  });

  it('does nothing when music is paused', () => {
    const mgr = createManager();
    mgr.state.musicDuckingEnabled = true;
    mgr._music.src = 'music/test.mp3';
    mgr._music.paused = true;
    expect(() => mgr.duckMusicForTts()).not.toThrow();
  });

  it('applies stronger duck than duckMusic (lower duckFactor)', () => {
    const mgr = createManager();
    mgr.state.musicDuckingEnabled = true;
    mgr.state.musicDuckingStrength = 0.55;
    mgr._music.src = 'music/test.mp3';
    mgr._music.paused = false;

    // Regular duck
    mgr.duckMusic();
    const regularFactor = mgr._duckFactor;

    // Reset
    mgr._duckFactor = 1;

    // TTS duck
    mgr.duckMusicForTts();
    const ttsFactor = mgr._duckFactor;

    expect(ttsFactor).toBeLessThan(regularFactor);
  });
});

describe('dispose()', () => {
  it('stops tracked transient audio, clears listeners and is idempotent', async () => {
    const mgr = createManager();
    mgr._playSfx('sfx/dispose-test.wav');
    const sfx = Audio.mock.results[2].value;
    const teaser = mgr.playTeaser('/teaser/dispose-test.mp3', { duck: false });
    const tts = mgr.playTtsAudio('/tts/dispose-test.mp3');
    const onMusicEnded = vi.spyOn(mgr, '_onMusicEnded');

    await mgr.dispose();
    await mgr.dispose();
    tts.paused = false;
    tts.dispatchEvent(new Event('playing'));
    mgr._musicA.dispatchEvent(new Event('ended'));

    expect(sfx.pause).toHaveBeenCalledOnce();
    expect(teaser.pause).toHaveBeenCalledOnce();
    expect(tts.pause).toHaveBeenCalledOnce();
    expect(sfx.src).toBe('');
    expect(teaser.src).toBe('');
    expect(tts.src).toBe('');
    expect(sfx.load).toHaveBeenCalledOnce();
    expect(teaser.load).toHaveBeenCalledOnce();
    expect(tts.load).toHaveBeenCalledOnce();
    expect(mgr._transientAudioCleanup.size).toBe(0);
    expect(mgr._ttsAudioCleanup.size).toBe(0);
    expect(mgr._speakingAudio.size).toBe(0);
    expect(onMusicEnded).not.toHaveBeenCalled();
    expect(mgr._musicA.pause).toHaveBeenCalledOnce();
    expect(mgr._musicB.pause).toHaveBeenCalledOnce();
    expect(mgr._disposed).toBe(true);
    expect(mgr.playTtsAudio('/after-dispose.mp3')).toBeNull();
  });

  it('cancels delayed SFX and resolves an in-flight music fade', async () => {
    const mgr = createManager();
    vi.spyOn(mgr, '_playSfx').mockReturnValue(false);
    mgr.playUiNotify();
    expect(mgr._scheduledTimeouts.size).toBe(1);

    const fade = mgr._fadeMusicTo(0, 200);
    await mgr.dispose();

    expect(await fade).toBe(false);
    expect(mgr._scheduledTimeouts.size).toBe(0);
    expect(window.clearTimeout).toHaveBeenCalled();
  });

  it('stops active oscillators and closes its owned AudioContext', async () => {
    const previousAudioContext = window.AudioContext;
    const gainNodes = [];
    const makeGain = () => {
      const gain = {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      };
      const node = { gain, connect: vi.fn(), disconnect: vi.fn() };
      gainNodes.push(node);
      return node;
    };
    const oscillator = new EventTarget();
    Object.assign(oscillator, {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    });
    const context = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createGain: vi.fn(makeGain),
      createOscillator: vi.fn(() => oscillator),
      close: vi.fn(async () => { context.state = 'closed'; }),
    };
    window.AudioContext = vi.fn(function () { return context; });

    try {
      const mgr = createManager();
      mgr._playTone();
      await mgr.dispose();

      expect(oscillator.stop).toHaveBeenCalledTimes(2);
      expect(gainNodes[0].disconnect).toHaveBeenCalledOnce();
      expect(gainNodes[1].disconnect).toHaveBeenCalledOnce();
      expect(context.close).toHaveBeenCalledOnce();
    } finally {
      window.AudioContext = previousAudioContext;
    }
  });

  it('resumes a suspended AudioContext on the first procedural sound request', async () => {
    const previousAudioContext = window.AudioContext;
    const context = {
      state: 'suspended',
      destination: {},
      createGain: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
      resume: vi.fn(async () => { context.state = 'running'; }),
      close: vi.fn(async () => { context.state = 'closed'; }),
    };
    window.AudioContext = vi.fn(function () { return context; });

    try {
      const mgr = createManager();
      mgr._ensureContext();
      await Promise.resolve();

      expect(context.resume).toHaveBeenCalledOnce();
      expect(context.state).toBe('running');
      await mgr.dispose();
    } finally {
      window.AudioContext = previousAudioContext;
    }
  });

  it('rejects invalid fallback tone parameters before creating an AudioContext', () => {
    const previousAudioContext = window.AudioContext;
    window.AudioContext = vi.fn();

    try {
      const mgr = createManager();
      expect(mgr._playTone(Number.NaN)).toBe(false);
      expect(mgr._playTone(440, Number.POSITIVE_INFINITY)).toBe(false);
      expect(mgr._playTone(440, 0.05, 'invalid')).toBe(false);
      expect(window.AudioContext).not.toHaveBeenCalled();
    } finally {
      window.AudioContext = previousAudioContext;
    }
  });

  it('cleans up a partially initialized AudioContext when gain setup fails', async () => {
    const previousAudioContext = window.AudioContext;
    const gain = { connect: vi.fn(() => { throw new Error('Gain connection failed'); }), disconnect: vi.fn() };
    const context = {
      state: 'running',
      destination: {},
      createGain: vi.fn(() => gain),
      close: vi.fn(async () => { context.state = 'closed'; }),
    };
    window.AudioContext = vi.fn(function () { return context; });

    try {
      const mgr = createManager();
      expect(mgr._playTone()).toBe(false);
      await Promise.resolve();

      expect(gain.disconnect).toHaveBeenCalledOnce();
      expect(context.close).toHaveBeenCalledOnce();
      expect(mgr._audioContext).toBeNull();
      expect(mgr._gain).toBeNull();
    } finally {
      window.AudioContext = previousAudioContext;
    }
  });

  it('disconnects partially started fallback tones when Web Audio throws', () => {
    const previousAudioContext = window.AudioContext;
    const gainParam = {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    };
    const env = { gain: gainParam, connect: vi.fn(), disconnect: vi.fn() };
    const masterGain = { connect: vi.fn(), disconnect: vi.fn() };
    const oscillator = new EventTarget();
    Object.assign(oscillator, {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(() => { throw new Error('Oscillator start failed'); }),
      stop: vi.fn(),
      disconnect: vi.fn(),
    });
    const context = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createGain: vi.fn()
        .mockReturnValueOnce(masterGain)
        .mockReturnValueOnce(env),
      createOscillator: vi.fn(() => oscillator),
    };
    window.AudioContext = vi.fn(function () { return context; });

    try {
      const mgr = createManager();
      expect(mgr._playTone()).toBe(false);
      expect(mgr._activeToneOscillators.size).toBe(0);
      expect(oscillator.start).toHaveBeenCalledOnce();
      expect(oscillator.stop).not.toHaveBeenCalled();
      expect(oscillator.disconnect).toHaveBeenCalledOnce();
      expect(env.disconnect).toHaveBeenCalledOnce();
    } finally {
      window.AudioContext = previousAudioContext;
    }
  });

  it('attempts both oscillator and envelope cleanup when one ended handler cleanup fails', () => {
    const previousAudioContext = window.AudioContext;
    const gainParam = {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    };
    const env = { gain: gainParam, connect: vi.fn(), disconnect: vi.fn() };
    const masterGain = { connect: vi.fn(), disconnect: vi.fn() };
    const oscillator = new EventTarget();
    Object.assign(oscillator, {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(() => { throw new Error('Oscillator disconnect failed'); }),
    });
    const context = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createGain: vi.fn()
        .mockReturnValueOnce(masterGain)
        .mockReturnValueOnce(env),
      createOscillator: vi.fn(() => oscillator),
    };
    window.AudioContext = vi.fn(function () { return context; });

    try {
      const mgr = createManager();
      expect(mgr._playTone()).toBe(true);
      oscillator.dispatchEvent(new Event('ended'));

      expect(mgr._activeToneOscillators.size).toBe(0);
      expect(oscillator.disconnect).toHaveBeenCalledOnce();
      expect(env.disconnect).toHaveBeenCalledOnce();
    } finally {
      window.AudioContext = previousAudioContext;
    }
  });

  it('shares pending context shutdown and its errors with every dispose caller', async () => {
    const mgr = createManager();
    let rejectClose;
    mgr._audioContext = {
      state: 'running',
      close: vi.fn(() => new Promise((_resolve, reject) => { rejectClose = reject; })),
    };
    const first = mgr.dispose();
    const second = mgr.dispose();
    expect(second).toBe(first);
    const failure = new Error('Context shutdown failed');
    const rejection = expect(first).rejects.toMatchObject({ errors: [failure] });
    rejectClose(failure);
    await rejection;
    expect(mgr.dispose()).toBe(first);
    expect(mgr._musicA.load).toHaveBeenCalledOnce();
    expect(mgr._musicB.load).toHaveBeenCalledOnce();
  });

  it('deduplicates borrowed TTS tracking without stopping external playback', async () => {
    const mgr = createManager();
    const external = new Audio('/external.wav');
    external.paused = false;
    const first = mgr.trackTtsAudio(external);
    expect(mgr.trackTtsAudio(external)).toBe(first);
    external.dispatchEvent(new Event('playing'));
    expect(mgr._speakingAudio.has(external)).toBe(true);

    await mgr.dispose();
    external.dispatchEvent(new Event('playing'));
    expect(mgr._speakingAudio.size).toBe(0);
    expect(external.pause).not.toHaveBeenCalled();
    expect(external.src).toBe('/external.wav');
  });
});

describe('live transient channel levels', () => {
  it('updates active SFX, teaser, and TTS when channel or master settings change', () => {
    const mgr = createManager();
    expect(mgr._playSfx('/sfx/live.wav')).toBe(true);
    const sfx = Audio.mock.results.at(-1).value;
    const teaser = mgr.playTeaser('/teaser/live.wav', { duck: false });
    const tts = mgr.playTtsAudio('/tts/live.mp3');

    expect(sfx.volume).toBeCloseTo(0.8 * 0.8);
    expect(teaser.volume).toBeCloseTo(0.8 * 0.9);
    expect(tts.volume).toBeCloseTo(0.8 * 0.95);

    mgr.setSfxMuted(true);
    expect(sfx.volume).toBe(0);
    expect(teaser.volume).toBeCloseTo(0.8 * 0.9);

    mgr.setTeaserVolume(0.25);
    expect(teaser.volume).toBeCloseTo(0.8 * 0.25);

    mgr.setMasterMuted(true);
    expect(sfx.volume).toBe(0);
    expect(teaser.volume).toBe(0);
    expect(tts.volume).toBe(0);

    mgr.setMasterMuted(false);
    expect(sfx.volume).toBe(0);
    expect(teaser.volume).toBeCloseTo(0.8 * 0.25);
    expect(tts.volume).toBeCloseTo(0.8 * 0.95);

    mgr.setSfxMuted(false);
    expect(sfx.volume).toBeCloseTo(0.8 * 0.8);
  });

  it('releases channel-level tracking when a transient clip ends', () => {
    const mgr = createManager();
    mgr._playSfx('/sfx/finished.wav');
    const audio = Audio.mock.results.at(-1).value;

    audio.dispatchEvent(new Event('ended'));

    expect(mgr._transientAudioLevels.has(audio)).toBe(false);
    mgr.setMasterMuted(true);
    expect(audio.volume).toBeCloseTo(0.8 * 0.8);
  });

  it('releases a transient clip when playback throws synchronously', () => {
    const mgr = createManager();
    const audio = new Audio('/sfx/failure.wav');
    audio.play.mockImplementation(() => { throw new Error('Playback failed'); });
    vi.stubGlobal('Audio', vi.fn(function AudioFailure() { return audio; }));

    expect(mgr._playSfx('/sfx/failure.wav')).toBe(false);
    expect(mgr._transientAudioCleanup.size).toBe(0);
    expect(mgr._transientAudioLevels.size).toBe(0);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.src).toBe('');
  });
});

describe('SFX rate-limit history', () => {
  it('keeps SFX and teaser cooldown history bounded across unique URLs', () => {
    const mgr = createManager();

    for (let index = 0; index < 300; index += 1) {
      expect(mgr._playSfx(`/sfx/${index}.wav`, 1, 0)).toBe(true);
      Audio.mock.results.at(-1).value.dispatchEvent(new Event('ended'));
      expect(mgr.playTeaser(`/teaser/${index}.wav`, { duck: false, minIntervalMs: 0 })).not.toBeNull();
      Audio.mock.results.at(-1).value.dispatchEvent(new Event('ended'));
    }

    expect(mgr._sfxLastPlayAt.size).toBe(128);
    expect(mgr._sfxTeaserLastPlayAt.size).toBe(128);
  });

  it('preserves duplicate suppression and clears cooldown history on dispose', async () => {
    const mgr = createManager();
    expect(mgr._playSfx('/sfx/repeated.wav')).toBe(true);
    expect(mgr._playSfx('/sfx/repeated.wav')).toBe(false);
    expect(mgr.playTeaser('/teaser/repeated.wav', { duck: false })).not.toBeNull();
    expect(mgr.playTeaser('/teaser/repeated.wav', { duck: false })).toBeNull();

    await mgr.dispose();
    expect(mgr._sfxLastPlayAt.size).toBe(0);
    expect(mgr._sfxTeaserLastPlayAt.size).toBe(0);
  });
});

describe('playProceduralSfx()', () => {
  it('applies manager and per-event volume and returns the synth result', () => {
    const mgr = createManager();
    const playProcedural = vi.fn(() => true);
    mgr.setSynthEngine({ playProcedural });
    mgr.setMasterVolume(0.5);
    mgr.setSfxVolume(0.4);

    expect(mgr.playProceduralSfx('laser_fire', { volume: 0.5, freq: 500 })).toBe(true);
    expect(playProcedural).toHaveBeenCalledWith('laser_fire', { volume: 0.1, freq: 500 });

    playProcedural.mockReturnValue(false);
    expect(mgr.playProceduralSfx('unsupported')).toBe(false);
  });

  it('does not invoke the synth for zero or invalid event volume', () => {
    const mgr = createManager();
    const playProcedural = vi.fn(() => true);
    mgr.setSynthEngine({ playProcedural });

    expect(mgr.playProceduralSfx('laser_fire', { volume: 0 })).toBe(false);
    expect(mgr.playProceduralSfx('laser_fire', { volume: Number.NaN })).toBe(false);
    expect(playProcedural).not.toHaveBeenCalled();
  });

  it('logs procedural playback exceptions and returns failure', () => {
    const mgr = createManager();
    const failure = new Error('Tone node unavailable');
    const log = vi.spyOn(mgr, '_log').mockImplementation(() => {});
    mgr.setSynthEngine({ playProcedural: vi.fn(() => { throw failure; }) });

    expect(mgr.playProceduralSfx('laser_fire')).toBe(false);
    expect(log).toHaveBeenCalledWith('warn', 'Prozeduraler Sound konnte nicht abgespielt werden', {
      type: 'laser_fire',
      error: String(failure),
    });
  });
});

describe('music track transitions', () => {
  it('does not let a pending play result undo a user pause', async () => {
    const mgr = createManager();
    vi.spyOn(mgr, '_log').mockImplementation(() => {});
    mgr._musicA.src = 'music/pending.mp3';
    let resolvePlay;
    mgr._musicA.play.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePlay = resolve;
    }));

    const pendingPlay = mgr.playMusic();
    mgr.pauseMusic();
    mgr._musicA.paused = true;
    resolvePlay();

    await expect(pendingPlay).resolves.toBe(false);
    expect(mgr.state.musicPaused).toBe(true);
    expect(mgr._musicPlayIntent).toBe(false);
    expect(mgr._musicA.pause).toHaveBeenCalledTimes(2);
  });

  it('does not let a pending play result overwrite a newer play request', async () => {
    const mgr = createManager();
    vi.spyOn(mgr, '_log').mockImplementation(() => {});
    mgr._musicA.src = 'music/pending.mp3';
    let resolveFirstPlay;
    mgr._musicA.play
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstPlay = resolve; }))
      .mockResolvedValueOnce(undefined);

    const firstPlay = mgr.playMusic();
    await expect(mgr.playMusic()).resolves.toBe(true);
    resolveFirstPlay();

    await expect(firstPlay).resolves.toBe(false);
    expect(mgr.state.musicPaused).toBe(false);
    expect(mgr._musicPlayIntent).toBe(true);
    expect(mgr._musicA.pause).not.toHaveBeenCalled();
  });

  it('keeps a newly selected non-autoplay track paused after an older play resolves', async () => {
    const mgr = createManager();
    vi.spyOn(mgr, '_log').mockImplementation(() => {});
    mgr._musicA.src = 'music/old.mp3';
    let resolvePlay;
    mgr._musicA.play.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePlay = resolve;
    }));

    const pendingPlay = mgr.playMusic();
    await expect(mgr.setMusicTrack('music/prepared.mp3', false)).resolves.toBe(true);
    resolvePlay();

    await expect(pendingPlay).resolves.toBe(false);
    expect(mgr._musicA.src).toBe('music/prepared.mp3');
    expect(mgr._musicPlayIntent).toBe(false);
    expect(mgr.state.musicPaused).toBe(true);
    expect(mgr._musicA.pause).toHaveBeenCalledTimes(2);
  });

  it('does not let a delayed older track start replace a newer selection', async () => {
    const mgr = createManager();
    vi.spyOn(mgr, '_log').mockImplementation(() => {});
    mgr._musicA.src = 'music/previous.mp3';
    mgr._musicA.paused = false;
    mgr._musicA.currentTime = 1;

    let resolveOlderPlay;
    mgr._musicB.play.mockReturnValueOnce(new Promise((resolve) => {
      resolveOlderPlay = resolve;
    }));

    const olderTransition = mgr.setMusicTrack('music/older.mp3', true, { smooth: true });
    await Promise.resolve();
    const newerTransition = mgr.setMusicTrack('music/newer.mp3', true);

    await expect(newerTransition).resolves.toBe(true);
    resolveOlderPlay();

    await expect(olderTransition).resolves.toBe(false);
    expect(mgr._musicA.src).toBe('music/newer.mp3');
    expect(mgr._musicB.pause).toHaveBeenCalledOnce();
  });

  it('reports a failed autoplay track change as unsuccessful', async () => {
    const mgr = createManager();
    vi.spyOn(mgr, '_log').mockImplementation(() => {});
    mgr._musicA.play.mockRejectedValueOnce(new Error('Playback blocked'));

    await expect(mgr.setMusicTrack('music/blocked.mp3', true)).resolves.toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// snapshot() includes new channel fields
// ═════════════════════════════════════════════════════════════════════════════

describe('snapshot() multi-channel fields', () => {
  it('includes teaserVolume', () => {
    const mgr = createManager();
    mgr.setTeaserVolume(0.75);
    expect(mgr.snapshot().teaserVolume).toBeCloseTo(0.75);
  });

  it('includes ttsVolume', () => {
    const mgr = createManager();
    mgr.setTtsVolume(0.6);
    expect(mgr.snapshot().ttsVolume).toBeCloseTo(0.6);
  });

  it('includes teaserMuted', () => {
    const mgr = createManager();
    mgr.setTeaserMuted(true);
    expect(mgr.snapshot().teaserMuted).toBe(true);
  });

  it('includes ttsMuted', () => {
    const mgr = createManager();
    mgr.setTtsMuted(true);
    expect(mgr.snapshot().ttsMuted).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Persistence: teaser/tts fields survive reload
// ═════════════════════════════════════════════════════════════════════════════

describe('persistence of new channel settings', () => {
  it('persists and restores teaserVolume + ttsVolume from localStorage', () => {
    const mgr1 = createManager();
    mgr1.setTeaserVolume(0.42);
    mgr1.setTtsVolume(0.77);

    // Simulate page reload: create a second instance with same storageKey
    const mgr2 = createManager();
    expect(mgr2.state.teaserVolume).toBeCloseTo(0.42);
    expect(mgr2.state.ttsVolume).toBeCloseTo(0.77);
  });

  it('persists and restores teaserMuted + ttsMuted from localStorage', () => {
    const mgr1 = createManager();
    mgr1.setTeaserMuted(true);
    mgr1.setTtsMuted(true);

    const mgr2 = createManager();
    expect(mgr2.state.teaserMuted).toBe(true);
    expect(mgr2.state.ttsMuted).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Multi-channel simultaneity: all channels can coexist
// ═════════════════════════════════════════════════════════════════════════════

describe('multi-channel audio coexistence', () => {
  it('plays a teaser and a TTS audio element at the same time (independent Audio instances)', () => {
    const mgr = createManager();
    const teaser = mgr.playTeaser('sfx/alarm.wav');
    const tts = mgr.playTtsAudio('/generated/tts/alert.mp3');
    // Both should be separate Audio instances
    expect(teaser).not.toBeNull();
    expect(tts).not.toBeNull();
    expect(teaser).not.toBe(tts);
  });

  it('TTS mute does not affect teaser channel', () => {
    const mgr = createManager();
    mgr.setTtsMuted(true);
    const teaser = mgr.playTeaser('sfx/teaser.wav');
    const tts = mgr.playTtsAudio('/generated/tts/line.mp3');
    expect(teaser).not.toBeNull();
    expect(tts).toBeNull();
  });

  it('teaser mute does not affect TTS channel', () => {
    const mgr = createManager();
    mgr.setTeaserMuted(true);
    const teaser = mgr.playTeaser('sfx/teaser.wav');
    const tts = mgr.playTtsAudio('/generated/tts/line.mp3');
    expect(teaser).toBeNull();
    expect(tts).not.toBeNull();
  });

  it('master mute silences all channels', () => {
    const mgr = createManager();
    mgr.setMasterMuted(true);
    expect(mgr.playTeaser('sfx/teaser.wav')).toBeNull();
    expect(mgr.playTtsAudio('/generated/tts/line.mp3')).toBeNull();
  });
});
