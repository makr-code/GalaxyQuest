/**
 * tests/js/tts.test.js
 *
 * Unit tests for js/runtime/tts.js  (window.GQTTS).
 *
 * The module is a self-contained IIFE that writes to window.GQTTS.
 * We load it with window.eval() to mirror how it is loaded in the browser,
 * then exercise the public API with mocked fetch and Audio.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ttsPath = path.resolve(process.cwd(), 'js/runtime/tts.js');

function loadTtsScript() {
  delete window.GQTTS;
  window.eval(fs.readFileSync(ttsPath, 'utf8'));
  return window.GQTTS;
}

/** Return a minimal fetch response that resolves to `data` as JSON. */
function okJson(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  };
}

/** Return a minimal failing fetch response (HTTP error). */
function errResponse(status = 500) {
  return { ok: false, status, json: async () => ({ error: `HTTP ${status}` }) };
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();

  // Install a CSRF meta tag so _csrfToken() finds something
  document.head.innerHTML = '<meta name="csrf-token" content="test-csrf">';

  // Default Audio mock – records play() calls without error
  vi.stubGlobal('Audio', vi.fn(function AudioMock() {
    this.volume = 1;
    this.play = vi.fn().mockResolvedValue(undefined);
    this.addEventListener = vi.fn();
  }));

  // Default fetch mock – returns a successful TTS synthesise response
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url || '');
    if (u.includes('action=synthesise')) {
      return okJson({ ok: true, audio_url: '/cache/tts/abc123.mp3' });
    }
    if (u.includes('action=status')) {
      return okJson({ enabled: true, engine: 'piper' });
    }
    if (u.includes('action=voices')) {
      return okJson({ engine: 'piper', voices: ['de_DE-thorsten-high'] });
    }
    return okJson({});
  }));
});

// ── Auto-voice preference ─────────────────────────────────────────────────────

describe('isAutoVoiceEnabled / setAutoVoice', () => {
  it('returns true by default (no localStorage entry)', () => {
    const GQTTS = loadTtsScript();
    expect(GQTTS.isAutoVoiceEnabled()).toBe(true);
  });

  it('returns false after setAutoVoice(false)', () => {
    const GQTTS = loadTtsScript();
    GQTTS.setAutoVoice(false);
    expect(GQTTS.isAutoVoiceEnabled()).toBe(false);
  });

  it('returns true after setAutoVoice(true)', () => {
    const GQTTS = loadTtsScript();
    GQTTS.setAutoVoice(false);
    GQTTS.setAutoVoice(true);
    expect(GQTTS.isAutoVoiceEnabled()).toBe(true);
  });

  it('persists preference to localStorage key gq_tts_auto_voice', () => {
    const GQTTS = loadTtsScript();
    GQTTS.setAutoVoice(false);
    expect(localStorage.getItem('gq_tts_auto_voice')).toBe('0');
    GQTTS.setAutoVoice(true);
    expect(localStorage.getItem('gq_tts_auto_voice')).toBe('1');
  });
});

// ── speak() ──────────────────────────────────────────────────────────────────

describe('speak()', () => {
  it('returns null for empty text', async () => {
    const GQTTS = loadTtsScript();
    const result = await GQTTS.speak('');
    expect(result).toBeNull();
  });

  it('returns null for whitespace-only text', async () => {
    const GQTTS = loadTtsScript();
    const result = await GQTTS.speak('   ');
    expect(result).toBeNull();
  });

  it('calls /api/tts.php?action=synthesise and returns Audio element', async () => {
    const GQTTS = loadTtsScript();
    const el = await GQTTS.speak('Willkommen, Kommandant!');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('action=synthesise'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(el).not.toBeNull();
    expect(el.play).toHaveBeenCalled();
  });

  it('includes the CSRF token in the request', async () => {
    const GQTTS = loadTtsScript();
    await GQTTS.speak('Test text');
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers['X-CSRF-Token']).toBe('test-csrf');
  });

  it('returns null and does not throw when fetch returns an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errResponse(503)));
    const GQTTS = loadTtsScript();
    const result = await GQTTS.speak('Hull breach!');
    expect(result).toBeNull();
  });

  it('returns null when server returns ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ ok: false, error: 'disabled' })));
    const GQTTS = loadTtsScript();
    const result = await GQTTS.speak('Test');
    expect(result).toBeNull();
  });

  it('caches the resolved URL so subsequent speak() skips fetch', async () => {
    const GQTTS = loadTtsScript();
    await GQTTS.speak('Cached text');
    const callCount = global.fetch.mock.calls.length;
    // Second call for identical text should hit sessionStorage cache
    await GQTTS.speak('Cached text');
    expect(global.fetch.mock.calls.length).toBe(callCount); // no new fetch
  });

  it('passes voice option to the request body', async () => {
    const GQTTS = loadTtsScript();
    await GQTTS.speak('Voice test', { voice: 'en_US-lessac-high' });
    const [, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.voice).toBe('en_US-lessac-high');
  });

  it('bypasses cache when noCache:true', async () => {
    const GQTTS = loadTtsScript();
    await GQTTS.speak('NoCache text');
    const count1 = global.fetch.mock.calls.length;
    await GQTTS.speak('NoCache text', { noCache: true });
    expect(global.fetch.mock.calls.length).toBeGreaterThan(count1);
  });
});

// ── preload() ────────────────────────────────────────────────────────────────

describe('preload()', () => {
  it('returns the resolved audio URL string', async () => {
    const GQTTS = loadTtsScript();
    const url = await GQTTS.preload('Angriff eingeleitet.');
    expect(typeof url).toBe('string');
    expect(url).toContain('.mp3');
  });

  it('returns null for empty text', async () => {
    const GQTTS = loadTtsScript();
    const url = await GQTTS.preload('');
    expect(url).toBeNull();
  });

  it('does NOT call Audio() or play()', async () => {
    const GQTTS = loadTtsScript();
    await GQTTS.preload('No playback please');
    expect(global.Audio).not.toHaveBeenCalled();
  });

  it('returns null on fetch error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errResponse(500)));
    const GQTTS = loadTtsScript();
    const url = await GQTTS.preload('Will fail');
    expect(url).toBeNull();
  });
});

// ── playOrSpeak() ─────────────────────────────────────────────────────────────

describe('playOrSpeak()', () => {
  it('returns null when auto-voice is disabled', async () => {
    const GQTTS = loadTtsScript();
    GQTTS.setAutoVoice(false);
    const result = await GQTTS.playOrSpeak('/cache/tts/prerendered.mp3', 'Text');
    expect(result).toBeNull();
    expect(global.Audio).not.toHaveBeenCalled();
  });

  it('plays pre-rendered URL directly without calling fetch', async () => {
    const GQTTS = loadTtsScript();
    const result = await GQTTS.playOrSpeak('/cache/tts/prerendered.mp3', 'Fallback text');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result.play).toHaveBeenCalled();
  });

  it('falls back to speak() when audioUrl is null', async () => {
    const GQTTS = loadTtsScript();
    const result = await GQTTS.playOrSpeak(null, 'Fallback text');
    // Should have called fetch to synthesise
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('action=synthesise'),
      expect.anything()
    );
    expect(result).not.toBeNull();
  });

  it('falls back to speak() when audioUrl is empty string', async () => {
    const GQTTS = loadTtsScript();
    const result = await GQTTS.playOrSpeak('', 'Fallback text');
    expect(global.fetch).toHaveBeenCalled();
    expect(result).not.toBeNull();
  });
});

// ── speakSequence() ───────────────────────────────────────────────────────────

describe('speakSequence()', () => {
  it('plays each line in order and resolves after all lines', async () => {
    const GQTTS = loadTtsScript();
    const played = [];

    // When speakSequence calls el.addEventListener('ended', resolve), fire the
    // callback synchronously so the awaited promise resolves immediately.
    vi.stubGlobal('Audio', vi.fn(function AudioSeqMock() {
      this.volume = 1;
      this.play = vi.fn().mockResolvedValue(undefined);
      this.addEventListener = vi.fn((evt, cb) => {
        if (evt === 'ended') cb({ type: 'ended' });
      });
      played.push(this);
    }));

    await GQTTS.speakSequence(['Line one', 'Line two', 'Line three'], { gapMs: 0 });

    expect(played).toHaveLength(3);
    played.forEach((el) => expect(el.play).toHaveBeenCalled());
  });

  it('accepts mixed string / object entries', async () => {
    const GQTTS = loadTtsScript();
    vi.stubGlobal('Audio', vi.fn(function AudioMixedMock() {
      this.volume = 1;
      this.play = vi.fn().mockResolvedValue(undefined);
      this.addEventListener = vi.fn((evt, cb) => { if (evt === 'ended') cb({}); });
    }));

    await GQTTS.speakSequence(
      [
        'Plain string',
        { text: 'Object with voice', voice: 'en_US-lessac-high' },
      ],
      { gapMs: 0 }
    );

    // Two fetch calls expected (one per line)
    const synthCalls = global.fetch.mock.calls.filter(([u]) =>
      String(u || '').includes('action=synthesise')
    );
    expect(synthCalls).toHaveLength(2);
    const body = JSON.parse(synthCalls[1][1].body);
    expect(body.voice).toBe('en_US-lessac-high');
  });
});

// ── status() / voices() ───────────────────────────────────────────────────────

describe('status()', () => {
  it('fetches /api/tts.php?action=status and returns data', async () => {
    const GQTTS = loadTtsScript();
    const st = await GQTTS.status();
    expect(st.enabled).toBe(true);
    expect(st.engine).toBe('piper');
  });

  it('throws when the server returns an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errResponse(503)));
    const GQTTS = loadTtsScript();
    await expect(GQTTS.status()).rejects.toThrow();
  });
});

describe('voices()', () => {
  it('fetches /api/tts.php?action=voices and returns voice list', async () => {
    const GQTTS = loadTtsScript();
    const data = await GQTTS.voices();
    expect(data.engine).toBe('piper');
    expect(Array.isArray(data.voices)).toBe(true);
    expect(data.voices[0]).toBe('de_DE-thorsten-high');
  });
});

// ── Session-cache eviction ────────────────────────────────────────────────────

describe('session cache', () => {
  it('stores resolved URLs so identical requests skip fetch', async () => {
    const GQTTS = loadTtsScript();
    await GQTTS.speak('Cache me');
    const initialCalls = global.fetch.mock.calls.length;
    await GQTTS.speak('Cache me'); // Should use cache
    expect(global.fetch.mock.calls.length).toBe(initialCalls);
  });

  it('different voices are cached independently', async () => {
    const GQTTS = loadTtsScript();
    await GQTTS.speak('Same text', { voice: 'voice_a' });
    const countAfterFirst = global.fetch.mock.calls.length;
    await GQTTS.speak('Same text', { voice: 'voice_b' });
    // A new fetch should have been made for the new voice
    expect(global.fetch.mock.calls.length).toBeGreaterThan(countAfterFirst);
  });
});
