# TTS System Design – GalaxyQuest

## Overview

GalaxyQuest uses a self-hosted Text-to-Speech (TTS) pipeline to voice Ollama-generated
NPC and narrator texts.  The pipeline is intentionally **offline-first**: no API key,
no cloud, no usage cost.  It runs alongside the existing Ollama and SwarmUI services.

```
┌────────────────────────────────────────────────────────────┐
│  Browser (JS)                                              │
│    window.GQTTS.speak("Willkommen, Kommandant!")           │
│         │  POST /api/tts.php?action=synthesise             │
│  PHP (api/tts.php + api/tts_client.php)                    │
│         │  PHP filesystem cache hit? → return URL          │
│         │  cache miss → POST http://tts:5500/synthesize    │
│  Python FastAPI (tts_service/main.py)                      │
│         │  Python audio cache hit? → return MP3 bytes      │
│         │  cache miss → Piper TTS (or XTTS v2)             │
│         │  WAV → ffmpeg → MP3 bytes                        │
│  PHP writes MP3 → cache/tts/<sha256>.mp3                   │
│  JS plays via Audio API (volume-controlled by GQAudioMgr)  │
└────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Python TTS Microservice (`tts_service/`)

| File              | Purpose                                         |
|-------------------|-------------------------------------------------|
| `main.py`         | FastAPI application with synthesis endpoints    |
| `requirements.txt`| Python dependencies                             |
| `Dockerfile`      | Container image (python:3.11-slim + espeak-ng)  |

**Endpoints**

| Method | Path               | Description                              |
|--------|--------------------|------------------------------------------|
| GET    | `/health`          | Liveness probe                           |
| GET    | `/voices`          | List available voices                    |
| POST   | `/synthesize`      | Synthesise text → MP3 response           |
| POST   | `/preload/{voice}` | Eagerly download a Piper voice model     |

**POST `/synthesize` body**

```json
{
  "text":       "Text to speak",
  "voice":      "de_DE-thorsten-high",
  "lang":       "de",
  "speaker_wav": null,
  "no_cache":   false
}
```

**Engines**

| Engine | Env var value | Quality | VRAM | Voice cloning |
|--------|--------------|---------|------|---------------|
| Piper  | `piper`      | Good    | None | No            |
| XTTS v2| `xtts`       | Excellent | ~4 GB | Yes (6 s sample) |

Set `TTS_ENGINE=xtts` to switch.  The `speaker_wav` field in the request enables
voice cloning: pass the server-local path to a 6-second WAV sample of the target speaker.

**Available Piper voices (pre-configured)**

| Voice name              | Language | Gender | Quality |
|-------------------------|----------|--------|---------|
| `de_DE-thorsten-high`   | German   | Male   | High    |
| `de_DE-thorsten-medium` | German   | Male   | Medium  |
| `en_US-lessac-high`     | English  | Female | High    |
| `en_GB-alba-medium`     | English  | Female | Medium  |

Additional voices from <https://huggingface.co/rhasspy/piper-voices> can be added
to the `PIPER_VOICES` dict in `main.py`.

**Caching** (Python layer)

Audio files are cached as `<sha256(engine|voice|text)>.mp3` under
`/app/audio_cache` (Docker volume `galaxyquest-tts-audio-cache`).  Voice model
`.onnx` files are cached under `/app/voice_cache` (Docker volume
`galaxyquest-tts-voice-cache`).

**Security**

Set `TTS_SECRET` (env var) to a shared secret.  The service then requires an
`X-TTS-Key: <secret>` header on every request.  The PHP client sends this header
automatically when `TTS_SECRET` is defined in `config/config.php`.

---

### 2. PHP TTS Client (`api/tts_client.php`)

Follows the same pattern as `ollama_client.php` / `swarmui_client.php`.

**Primary function**

```php
tts_synthesise(string $text, array $options = []): array
// Returns: ['ok' => true, 'audio_url' => 'cache/tts/<hash>.mp3', 'cached' => bool]
//       or ['ok' => false, 'error' => '...', 'status' => int]
```

**Options**

| Key        | Type    | Default                | Description                   |
|------------|---------|------------------------|-------------------------------|
| `voice`    | string  | `TTS_DEFAULT_VOICE`    | Piper voice name              |
| `lang`     | string  | `'de'`                 | Language code (XTTS only)     |
| `no_cache` | bool    | `false`                | Bypass PHP-level cache        |

**PHP-level cache**

Synthesised MP3 files are stored in `cache/tts/<sha256(voice|text)>.mp3` inside
the web root so they can be served directly by Apache/nginx without any PHP
overhead on subsequent requests.  The cache is permanent by default
(`TTS_CACHE_TTL = 0`).  Set `TTS_CACHE_TTL` to a positive integer (seconds) for
time-based expiry.

---

### 3. PHP API Endpoint (`api/tts.php`)

| Action        | Method | Description                           |
|---------------|--------|---------------------------------------|
| `status`      | GET    | Service status + enabled flag         |
| `voices`      | GET    | List voices from microservice         |
| `synthesise`  | POST   | Synthesise text, return audio URL     |

All actions require an authenticated session (`require_auth()`).  The `synthesise`
action additionally requires a valid CSRF token.

---

### 4. JavaScript TTS Client (`js/runtime/tts.js`)

Exposed as `window.GQTTS`.

```javascript
// Speak text using the default voice
await window.GQTTS.speak('Willkommen, Kommandant!');

// Speak with a specific voice
await window.GQTTS.speak('Hull integrity critical.', { voice: 'en_US-lessac-high' });

// Preload (cache) without playing
await window.GQTTS.preload('Sie werden angegriffen!');

// Speak a sequence of lines with a gap between them
await window.GQTTS.speakSequence([
  'Initialisierung abgeschlossen.',
  'Kalibrierung der Antriebssysteme.',
  { text: 'Bereit zum Flug.', voice: 'de_DE-thorsten-high' },
], { gapMs: 400 });

// Service status
const st = await window.GQTTS.status();
console.log(st.enabled, st.engine);

// Available voices
const { voices } = await window.GQTTS.voices();
```

URL resolution is cached in `sessionStorage` (key `gq_tts_url_cache`, max 200
entries) so that the same text+voice pair only hits `/api/tts.php` once per
browser session.  Playback uses the `Audio` API.  If `window.GQAudioManager` is
present and has a `duckMusic()` method, background music is ducked automatically
during speech.

---

## Configuration Reference

All values are defined in `config/config.php` and can be overridden via environment
variables (see `docker-compose.yml`).

| Constant            | Env var              | Default                    | Description                               |
|---------------------|----------------------|----------------------------|-------------------------------------------|
| `TTS_ENABLED`       | `TTS_ENABLED`        | `0`                        | Feature flag (set to `1` to enable)       |
| `TTS_SERVICE_URL`   | `TTS_SERVICE_URL`    | `http://localhost:5500`    | Base URL of Python microservice           |
| `TTS_SECRET`        | `TTS_SECRET`         | `''`                       | Shared auth secret (empty = disabled)     |
| `TTS_DEFAULT_VOICE` | `TTS_DEFAULT_VOICE`  | `de_DE-thorsten-high`      | Default Piper voice name                  |
| `TTS_TIMEOUT_SECONDS`| `TTS_TIMEOUT_SECONDS`| `30`                      | HTTP timeout for microservice calls       |
| `TTS_MAX_CHARS`     | `TTS_MAX_CHARS`      | `2000`                     | Max input length (anti-abuse)             |
| `TTS_CACHE_TTL`     | `TTS_CACHE_TTL`      | `0` (permanent)            | PHP-level MP3 cache TTL in seconds        |

---

## Docker Setup

The TTS service is defined as the `tts` service in `docker-compose.yml`.
The PHP `web` container connects to it as `http://tts:5500`.

```bash
# Build and start all services including TTS
docker compose up --build

# Preload the default German voice (downloads ~60 MB on first run)
curl -X POST http://localhost:5500/preload/de_DE-thorsten-high

# Quick smoke test
curl -X POST http://localhost:5500/synthesize \
     -H 'Content-Type: application/json' \
     -d '{"text":"Galaxie erkundet.","voice":"de_DE-thorsten-high"}' \
     --output /tmp/test.mp3 && open /tmp/test.mp3
```

---

## Pre-rendering Known Texts (Recommended)

For frequently-used texts (NPC greetings, system announcements, faction intros),
pre-render them at deploy time to eliminate synthesis latency in gameplay:

```php
// scripts/prerender_tts.php
require_once __DIR__ . '/../api/tts_client.php';

$texts = [
    'Willkommen in der Galaxie.',
    'Angriff eingeleitet.',
    'Kolonie gegründet.',
    // … load from your NPC/lore data
];

foreach ($texts as $text) {
    $result = tts_synthesise($text);
    echo $result['ok']
        ? "OK  {$result['audio_url']}\n"
        : "ERR {$result['error']}\n";
}
```

Run once per deployment:
```bash
php scripts/prerender_tts.php
```
