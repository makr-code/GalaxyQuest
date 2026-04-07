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
    this.addEventListener = vi.fn();
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

  it('calls duckMusicForTts internally', () => {
    const mgr = createManager();
    const spy = vi.spyOn(mgr, 'duckMusicForTts');
    mgr.playTtsAudio('/generated/tts/line.mp3');
    expect(spy).toHaveBeenCalled();
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
