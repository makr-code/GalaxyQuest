/*
 * GalaxyQuest TTS client
 *
 * Thin browser-side wrapper around /api/tts.php.
 * Fetches synthesised audio URLs from the PHP backend and hands them off to the
 * existing GQAudioManager for volume control, ducking, and playback.
 *
 * Usage (after audio.js is loaded):
 *   await window.GQTTS.speak('Willkommen, Kommandant!');
 *   await window.GQTTS.speak('Hull integrity critical.', { voice: 'en_US-lessac-high' });
 *
 * The module caches resolved audio URLs in sessionStorage so that the same
 * text+voice pair only triggers one HTTP round-trip per browser session.
 */
(function () {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────────────
  const SESSION_CACHE_KEY = 'gq_tts_url_cache';
  const MAX_SESSION_CACHE = 200; // entries kept in sessionStorage

  // ── Simple FNV-1a-like hash for session cache keys (no crypto needed) ───────
  function _hashKey(voice, text) {
    let h = 2166136261;
    const s = voice + '\x00' + text;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    }
    return h.toString(16);
  }

  // ── Session storage cache helpers ───────────────────────────────────────────
  function _cacheLoad() {
    try {
      const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {};
  }

  function _cacheSave(obj) {
    try {
      const keys = Object.keys(obj);
      if (keys.length > MAX_SESSION_CACHE) {
        // Evict oldest half
        const keep = keys.slice(keys.length - MAX_SESSION_CACHE / 2);
        const pruned = {};
        keep.forEach((k) => { pruned[k] = obj[k]; });
        sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(pruned));
        return;
      }
      sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(obj));
    } catch (_) {}
  }

  function _cacheGet(voice, text) {
    return _cacheLoad()[_hashKey(voice, text)] || null;
  }

  function _cacheSet(voice, text, url) {
    const obj = _cacheLoad();
    obj[_hashKey(voice, text)] = url;
    _cacheSave(obj);
  }

  // ── CSRF helper (mirrors existing API calls in game.js) ──────────────────────
  function _csrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  // ── Core API ────────────────────────────────────────────────────────────────

  /**
   * Synthesise text and return a web-accessible audio URL.
   *
   * @param {string} text
   * @param {{ voice?: string, lang?: string, noCache?: boolean }} [opts]
   * @returns {Promise<string>} Resolved audio URL
   */
  async function _resolveAudioUrl(text, opts = {}) {
    const voice = String(opts.voice || '');
    const lang  = String(opts.lang  || 'de');
    const noCache = !!opts.noCache;

    if (!noCache) {
      const cached = _cacheGet(voice, text);
      if (cached) return cached;
    }

    const resp = await fetch('api/tts.php?action=synthesise', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': _csrfToken(),
      },
      body: JSON.stringify({ text, voice, lang, no_cache: noCache }),
    });

    if (!resp.ok) {
      let msg = `TTS API error ${resp.status}`;
      try {
        const j = await resp.json();
        msg = j.error || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    const data = await resp.json();
    if (!data.ok || !data.audio_url) {
      throw new Error(data.error || 'TTS synthesis returned no audio URL.');
    }

    _cacheSet(voice, text, data.audio_url);
    return data.audio_url;
  }

  /**
   * Synthesise text and play it back through the GQAudioManager SFX channel.
   * Falls back to a standalone Audio element when GQAudioManager is unavailable.
   *
   * @param {string} text
   * @param {{ voice?: string, lang?: string, noCache?: boolean, volume?: number }} [opts]
   * @returns {Promise<HTMLAudioElement|null>}
   */
  async function speak(text, opts = {}) {
    text = String(text || '').trim();
    if (!text) return null;

    let audioUrl;
    try {
      audioUrl = await _resolveAudioUrl(text, opts);
    } catch (err) {
      console.warn('[GQTTS] speak() failed to resolve audio URL:', err);
      return null;
    }

    return _playAudio(audioUrl, opts);
  }

  /**
   * Preload (resolve + cache) a TTS URL without playing it.
   * Useful for warming up the cache before a cutscene.
   *
   * @param {string} text
   * @param {{ voice?: string, lang?: string }} [opts]
   * @returns {Promise<string|null>} Resolved URL or null on error
   */
  async function preload(text, opts = {}) {
    text = String(text || '').trim();
    if (!text) return null;
    try {
      return await _resolveAudioUrl(text, opts);
    } catch (err) {
      console.warn('[GQTTS] preload() failed:', err);
      return null;
    }
  }

  /**
   * Speak a sequence of lines one after another.
   *
   * @param {Array<string|{text:string, voice?:string, lang?:string}>} lines
   * @param {{ voice?: string, lang?: string, gapMs?: number }} [opts]
   * @returns {Promise<void>}
   */
  async function speakSequence(lines, opts = {}) {
    const gapMs = Math.max(0, Number(opts.gapMs ?? 200));
    for (const line of lines) {
      const item = typeof line === 'string' ? { text: line } : line;
      const merged = Object.assign({}, opts, item);
      const el = await speak(merged.text, merged);
      if (el) {
        await new Promise((resolve) => {
          el.addEventListener('ended', resolve, { once: true });
          el.addEventListener('error', resolve, { once: true });
        });
      }
      if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  /**
   * Return the /api/tts.php?action=status payload.
   * @returns {Promise<object>}
   */
  async function status() {
    const resp = await fetch('api/tts.php?action=status');
    if (!resp.ok) throw new Error(`TTS status HTTP ${resp.status}`);
    return resp.json();
  }

  /**
   * Return the list of voices from /api/tts.php?action=voices.
   * @returns {Promise<{engine:string, voices:Array}>}
   */
  async function voices() {
    const resp = await fetch('api/tts.php?action=voices');
    if (!resp.ok) throw new Error(`TTS voices HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Internal playback helper ────────────────────────────────────────────────

  function _playAudio(url, opts = {}) {
    // Duck background music while the TTS line plays if GQAudioManager present
    const mgr = window.GQAudioManager
      ? (window._gqAudioInstance || null)
      : null;

    const vol = typeof opts.volume === 'number'
      ? Math.max(0, Math.min(1, opts.volume))
      : 1;

    const el = new Audio(url);
    el.volume = vol;

    if (mgr && typeof mgr.duckMusic === 'function') {
      mgr.duckMusic(2500);
    }

    el.play().catch((err) => {
      console.warn('[GQTTS] Audio.play() blocked:', err);
    });

    return el;
  }

  // ── Auto-Voice preference ───────────────────────────────────────────────────
  // Persisted in localStorage so the player's choice survives page reloads.
  const AUTO_VOICE_KEY = 'gq_tts_auto_voice';

  /**
   * Returns true when TTS auto-voice is enabled (default: true).
   * Players can toggle this via the Settings → Audio panel.
   * @returns {boolean}
   */
  function isAutoVoiceEnabled() {
    try {
      const v = localStorage.getItem(AUTO_VOICE_KEY);
      // Default ON when key is absent
      return v === null ? true : v === '1';
    } catch (_) {
      return true;
    }
  }

  /**
   * Enable or disable TTS auto-voice and persist the preference.
   * @param {boolean} enabled
   */
  function setAutoVoice(enabled) {
    try {
      localStorage.setItem(AUTO_VOICE_KEY, enabled ? '1' : '0');
    } catch (_) {}
  }

  /**
   * Play a pre-rendered audio URL directly (bypasses the /api/tts.php round-trip).
   * Falls back gracefully to speak() when the URL is absent.
   *
   * @param {string|null} audioUrl  Server-rendered MP3 URL (may be null)
   * @param {string} text           Fallback text to synthesise if audioUrl is absent
   * @param {{ voice?: string, volume?: number }} [opts]
   * @returns {Promise<HTMLAudioElement|null>}
   */
  async function playOrSpeak(audioUrl, text, opts = {}) {
    if (!isAutoVoiceEnabled()) return null;
    if (audioUrl) {
      return _playAudio(audioUrl, opts);
    }
    return speak(text, opts);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  const GQTTS = {
    speak,
    preload,
    speakSequence,
    playOrSpeak,
    status,
    voices,
    isAutoVoiceEnabled,
    setAutoVoice,
  };

  window.GQTTS = GQTTS;
})();
