"""
GalaxyQuest TTS Microservice
============================
FastAPI service that converts text to speech using Piper TTS (default, fast,
low-resource) or Coqui XTTS v2 (optional, supports voice cloning).

Endpoints
---------
GET  /health                       – liveness probe
GET  /voices                       – list available voices
POST /synthesize                   – synthesise text → MP3 bytes
POST /preload/{voice}              – eagerly load a voice model

Environment variables
---------------------
TTS_ENGINE          piper | xtts        (default: piper)
TTS_CACHE_DIR       directory for voice model files  (default: ./voice_cache)
TTS_AUDIO_CACHE_DIR directory for rendered MP3s       (default: ./audio_cache)
TTS_DEFAULT_VOICE   voice name used when none given   (default: de_DE-thorsten-high)
TTS_MAX_CHARS       max input length (anti-abuse)     (default: 2000)
TTS_SECRET          shared secret sent in X-TTS-Key   (default: empty = disabled)
"""

from __future__ import annotations

import hashlib
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Annotated

import aiofiles
from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── Config ─────────────────────────────────────────────────────────────────────
ENGINE: str = os.getenv("TTS_ENGINE", "piper").lower()
CACHE_DIR = Path(os.getenv("TTS_CACHE_DIR", "./voice_cache"))
AUDIO_CACHE_DIR = Path(os.getenv("TTS_AUDIO_CACHE_DIR", "./audio_cache"))
DEFAULT_VOICE: str = os.getenv("TTS_DEFAULT_VOICE", "de_DE-thorsten-high")
MAX_CHARS: int = int(os.getenv("TTS_MAX_CHARS", "2000"))
TTS_SECRET: str = os.getenv("TTS_SECRET", "")

CACHE_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("gq-tts")

# ── Piper voice registry ────────────────────────────────────────────────────────
# Model files are downloaded on first use.  Add more voices as needed.
PIPER_VOICES: dict[str, dict] = {
    "de_DE-thorsten-high": {
        "model_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx",
        "config_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json",
        "lang": "de",
        "description": "German male – Thorsten (high quality)",
    },
    "de_DE-thorsten-medium": {
        "model_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx",
        "config_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json",
        "lang": "de",
        "description": "German male – Thorsten (medium quality)",
    },
    "en_US-lessac-high": {
        "model_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/high/en_US-lessac-high.onnx",
        "config_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/high/en_US-lessac-high.onnx.json",
        "lang": "en",
        "description": "English (US) female – Lessac (high quality)",
    },
    "en_GB-alba-medium": {
        "model_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alba/medium/en_GB-alba-medium.onnx",
        "config_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json",
        "lang": "en",
        "description": "English (GB) female – Alba (medium quality)",
    },
}

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="GalaxyQuest TTS Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Auth helper ────────────────────────────────────────────────────────────────

def _check_secret(x_tts_key: str | None) -> None:
    """Reject request when TTS_SECRET is configured and the header mismatches."""
    if not TTS_SECRET:
        return
    if not x_tts_key or x_tts_key != TTS_SECRET:
        raise HTTPException(status_code=401, detail="Invalid TTS secret.")


# ── Piper helpers ───────────────────────────────────────────────────────────────

import hashlib as _hashlib
import re as _re
import urllib.parse as _urlparse

_SAFE_VOICE_RE = _re.compile(r'^[a-zA-Z0-9_\-]{1,80}$')


def _validate_voice_name(voice: str) -> str:
    """Reject voice names that contain characters unsafe for filesystem paths.

    Only ASCII alphanumerics, hyphens, and underscores are allowed.  This is
    checked *before* the voice name touches the filesystem.
    """
    if not _SAFE_VOICE_RE.match(voice):
        raise HTTPException(
            status_code=400,
            detail="Voice name contains invalid characters. "
                   "Only letters, digits, hyphens and underscores are allowed.",
        )
    return voice


def _piper_ensure_model(voice: str) -> tuple[Path, Path]:
    """Download Piper voice model files if not already cached.

    File paths are derived entirely from the hardcoded PIPER_VOICES registry
    (never from user input) to prevent path-traversal vulnerabilities.
    """
    _validate_voice_name(voice)
    if voice not in PIPER_VOICES:
        raise HTTPException(status_code=400, detail=f"Unknown Piper voice: {voice!r}")

    info = PIPER_VOICES[voice]

    # Derive filenames from the hardcoded registry URLs – NOT from user input.
    model_filename = Path(_urlparse.urlparse(info["model_url"]).path).name
    config_filename = Path(_urlparse.urlparse(info["config_url"]).path).name

    # Use a SHA-256 of the whitelisted key (never user input) as the directory
    # name so that the filesystem path is fully under our control.
    dir_name = _hashlib.sha256(info["model_url"].encode()).hexdigest()
    voice_dir = CACHE_DIR / dir_name
    voice_dir.mkdir(parents=True, exist_ok=True)

    onnx = voice_dir / model_filename
    cfg  = voice_dir / config_filename

    import urllib.request  # stdlib – no extra deps for download

    if not onnx.exists():
        log.info("Downloading Piper model %s …", voice)
        urllib.request.urlretrieve(info["model_url"], str(onnx))

    if not cfg.exists():
        log.info("Downloading Piper config %s …", voice)
        urllib.request.urlretrieve(info["config_url"], str(cfg))

    return onnx, cfg


def _piper_synthesise_wav(text: str, voice: str) -> bytes:
    """Run piper CLI and return raw WAV bytes."""
    onnx, cfg = _piper_ensure_model(voice)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            [
                "piper",
                "--model", str(onnx),
                "--config", str(cfg),
                "--output_file", tmp_path,
            ],
            input=text.encode("utf-8"),
            capture_output=True,
            timeout=60,
            check=True,
        )
        with open(tmp_path, "rb") as fh:
            return fh.read()
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Piper synthesis failed: {exc.stderr.decode(errors='replace')}"
        ) from exc
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail="piper binary not found. Ensure the piper-tts package is installed."
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ── Coqui XTTS helpers ─────────────────────────────────────────────────────────

_xtts_model = None

def _xtts_model_load():
    global _xtts_model
    if _xtts_model is not None:
        return _xtts_model
    try:
        from TTS.api import TTS as CoquiTTS  # type: ignore
        log.info("Loading Coqui XTTS v2 model (first call) …")
        _xtts_model = CoquiTTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2")
        return _xtts_model
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Coqui TTS package not installed: {exc}"
        ) from exc
    except (RuntimeError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not load XTTS model: {exc}"
        ) from exc


def _xtts_synthesise_wav(text: str, lang: str = "de", speaker_wav: str | None = None) -> bytes:
    tts = _xtts_model_load()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        kwargs: dict = {"text": text, "language": lang, "file_path": tmp_path}
        if speaker_wav:
            kwargs["speaker_wav"] = speaker_wav
        tts.tts_to_file(**kwargs)
        with open(tmp_path, "rb") as fh:
            return fh.read()
    except (RuntimeError, OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"XTTS synthesis failed: {exc}") from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ── WAV → MP3 conversion ───────────────────────────────────────────────────────

def _wav_to_mp3(wav_bytes: bytes) -> bytes:
    """Convert WAV bytes to MP3 using ffmpeg (small output for browser streaming)."""
    result = subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "wav", "-i", "pipe:0",
            "-codec:a", "libmp3lame", "-q:a", "4",
            "-f", "mp3", "pipe:1",
        ],
        input=wav_bytes,
        capture_output=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"ffmpeg conversion failed: {result.stderr.decode(errors='replace')}"
        )
    return result.stdout


# ── Audio cache ────────────────────────────────────────────────────────────────

def _audio_cache_key(text: str, voice: str, engine: str) -> str:
    digest = hashlib.sha256(f"{engine}|{voice}|{text}".encode("utf-8")).hexdigest()
    return digest


def _audio_cache_path(key: str) -> Path:
    return AUDIO_CACHE_DIR / f"{key}.mp3"


async def _audio_cache_get(key: str) -> bytes | None:
    path = _audio_cache_path(key)
    if not path.exists():
        return None
    async with aiofiles.open(path, "rb") as fh:
        return await fh.read()


async def _audio_cache_set(key: str, mp3: bytes) -> None:
    path = _audio_cache_path(key)
    tmp = path.with_suffix(".tmp")
    async with aiofiles.open(tmp, "wb") as fh:
        await fh.write(mp3)
    tmp.rename(path)


# ── Request / Response models ──────────────────────────────────────────────────

class SynthesiseRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Text to synthesise")
    voice: str = Field("", description="Voice name (Piper) or language code (XTTS)")
    lang: str = Field("de", description="Language code for XTTS engine")
    speaker_wav: str | None = Field(
        None, description="Path to a WAV sample for XTTS voice cloning"
    )
    no_cache: bool = Field(False, description="Bypass cache and re-synthesise")


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "engine": ENGINE, "default_voice": DEFAULT_VOICE}


@app.get("/voices")
def list_voices(x_tts_key: Annotated[str | None, Header()] = None):
    _check_secret(x_tts_key)
    if ENGINE == "piper":
        return {
            "engine": "piper",
            "voices": [
                {"name": k, **{kk: vv for kk, vv in v.items() if kk not in ("model_url", "config_url")}}
                for k, v in PIPER_VOICES.items()
            ],
        }
    return {
        "engine": "xtts",
        "voices": [
            {"name": "xtts_v2", "description": "Coqui XTTS v2 – multilingual, voice clonable"},
        ],
    }


@app.post("/synthesize")
async def synthesize(
    req: SynthesiseRequest,
    x_tts_key: Annotated[str | None, Header()] = None,
):
    _check_secret(x_tts_key)

    text = req.text.strip()
    if len(text) > MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Text too long ({len(text)} chars, max {MAX_CHARS})."
        )
    if not text:
        raise HTTPException(status_code=400, detail="text must not be empty.")

    voice = req.voice.strip() or DEFAULT_VOICE
    engine_key = ENGINE

    cache_key = _audio_cache_key(text, voice, engine_key)

    if not req.no_cache:
        cached = await _audio_cache_get(cache_key)
        if cached is not None:
            log.info("TTS cache hit: %s", cache_key[:16])
            return Response(content=cached, media_type="audio/mpeg")

    log.info("Synthesising (%s / %s) %d chars …", engine_key, voice, len(text))

    if engine_key == "piper":
        wav = _piper_synthesise_wav(text, voice)
    else:
        wav = _xtts_synthesise_wav(text, lang=req.lang, speaker_wav=req.speaker_wav)

    mp3 = _wav_to_mp3(wav)

    await _audio_cache_set(cache_key, mp3)

    return Response(content=mp3, media_type="audio/mpeg")


@app.post("/preload/{voice}")
async def preload_voice(
    voice: str,
    x_tts_key: Annotated[str | None, Header()] = None,
):
    """Eagerly download and cache a Piper voice model."""
    _check_secret(x_tts_key)
    if ENGINE != "piper":
        raise HTTPException(
            status_code=400,
            detail="Preload is only supported for the Piper engine."
        )
    _piper_ensure_model(voice)
    return {"ok": True, "voice": voice}
