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

Environment variables (see TTSSettings below for full list and defaults)
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import shutil
import subprocess
import tempfile
import urllib.parse
from pathlib import Path
from typing import Annotated

import aiofiles
import structlog
from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.concurrency import run_in_threadpool

# ── Config (pydantic-settings, no bare os.getenv) ─────────────────────────────


class TTSSettings(BaseSettings):
    """All TTS service configuration, loaded from environment / .env file."""

    engine: str = Field(default="piper", description="TTS engine: piper | xtts")
    cache_dir: Path = Field(default=Path("./voice_cache"), description="Voice model cache")
    audio_cache_dir: Path = Field(default=Path("./audio_cache"), description="Rendered MP3 cache")
    default_voice: str = Field(default="de_DE-thorsten-high", description="Fallback voice name")
    max_chars: int = Field(default=2000, description="Maximum input length (anti-abuse)")
    secret: str = Field(default="", description="Shared secret for X-TTS-Key header")
    cors_origins: str = Field(
        default="",
        description="Comma-separated allowed CORS origins. Empty = disabled.",
    )

    model_config = SettingsConfigDict(env_prefix="TTS_", env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        if not self.cors_origins or self.cors_origins == "*":
            return [self.cors_origins] if self.cors_origins else []
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


cfg = TTSSettings()
cfg.cache_dir.mkdir(parents=True, exist_ok=True)
cfg.audio_cache_dir.mkdir(parents=True, exist_ok=True)

# ── Logging (structlog) ────────────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.BoundLogger,
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)
log: structlog.BoundLogger = structlog.get_logger("gq-tts")

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

if cfg.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origin_list,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

# ── Auth helper ────────────────────────────────────────────────────────────────

def _check_secret(x_tts_key: str | None) -> None:
    """Reject request when TTS_SECRET is configured and the header mismatches."""
    if not cfg.secret:
        return
    if not x_tts_key or x_tts_key != cfg.secret:
        raise HTTPException(status_code=401, detail="Invalid TTS secret.")


# ── Piper helpers ───────────────────────────────────────────────────────────────

_SAFE_VOICE_RE = re.compile(r'^[a-zA-Z0-9_\-]{1,80}$')


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
    Uses httpx with an explicit timeout instead of the deprecated urllib.request.urlretrieve.
    """
    _validate_voice_name(voice)
    if voice not in PIPER_VOICES:
        raise HTTPException(status_code=400, detail=f"Unknown Piper voice: {voice!r}")

    info = PIPER_VOICES[voice]

    # Derive filenames from the hardcoded registry URLs – NOT from user input.
    model_filename = Path(urllib.parse.urlparse(info["model_url"]).path).name
    config_filename = Path(urllib.parse.urlparse(info["config_url"]).path).name

    # Use a SHA-256 of the whitelisted key (never user input) as the directory
    # name so that the filesystem path is fully under our control.
    dir_name = hashlib.sha256(info["model_url"].encode()).hexdigest()
    voice_dir = cfg.cache_dir / dir_name
    voice_dir.mkdir(parents=True, exist_ok=True)

    onnx = voice_dir / model_filename
    voice_cfg = voice_dir / config_filename

    if not onnx.exists():
        log.info("downloading_piper_model", voice=voice)
        _download_file(info["model_url"], onnx)

    if not voice_cfg.exists():
        log.info("downloading_piper_config", voice=voice)
        _download_file(info["config_url"], voice_cfg)

    return onnx, voice_cfg


def _download_file(url: str, dest: Path) -> None:
    """Download *url* to *dest* using httpx with an explicit timeout."""
    import httpx

    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        with client.stream("GET", url) as resp:
            resp.raise_for_status()
            tmp = dest.with_suffix(".tmp")
            try:
                with open(tmp, "wb") as fh:
                    for chunk in resp.iter_bytes(chunk_size=65536):
                        fh.write(chunk)
                tmp.rename(dest)
            except Exception:
                tmp.unlink(missing_ok=True)
                raise


def _piper_synthesise_wav(text: str, voice: str) -> bytes:
    """Run piper CLI and return raw WAV bytes."""
    onnx, voice_cfg = _piper_ensure_model(voice)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        subprocess.run(
            [
                "piper",
                "--model", str(onnx),
                "--config", str(voice_cfg),
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
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail="piper binary not found. Ensure the piper-tts package is installed."
        ) from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ── Coqui XTTS helpers ─────────────────────────────────────────────────────────

_xtts_model = None
_xtts_lock = asyncio.Lock()


async def _xtts_model_load() -> object:
    """Load the Coqui XTTS v2 model exactly once; thread-safe via asyncio.Lock."""
    global _xtts_model
    async with _xtts_lock:
        if _xtts_model is not None:
            return _xtts_model
        try:
            from TTS.api import TTS as CoquiTTS  # type: ignore[import]

            log.info("loading_xtts_model")
            _xtts_model = await run_in_threadpool(
                lambda: CoquiTTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2")
            )
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


def _xtts_synthesise_wav_sync(
    tts: object,
    text: str,
    lang: str,
    speaker_wav: str | None,
) -> bytes:
    """Blocking helper – always called via run_in_threadpool."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        kwargs: dict[str, object] = {"text": text, "language": lang, "file_path": tmp_path}
        if speaker_wav:
            kwargs["speaker_wav"] = speaker_wav
        tts.tts_to_file(**kwargs)  # type: ignore[attr-defined]
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
    return cfg.audio_cache_dir / f"{key}.mp3"


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
def health() -> dict[str, object]:
    extra: dict[str, object] = {}
    if cfg.engine == "piper":
        extra["piper_available"] = shutil.which("piper") is not None
    return {"ok": True, "engine": cfg.engine, "default_voice": cfg.default_voice, **extra}


@app.get("/voices")
def list_voices(x_tts_key: Annotated[str | None, Header()] = None) -> dict[str, object]:
    _check_secret(x_tts_key)
    if cfg.engine == "piper":
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
) -> Response:
    _check_secret(x_tts_key)

    text = req.text.strip()
    if len(text) > cfg.max_chars:
        raise HTTPException(
            status_code=400,
            detail=f"Text too long ({len(text)} chars, max {cfg.max_chars})."
        )
    if not text:
        raise HTTPException(status_code=400, detail="text must not be empty.")

    voice = req.voice.strip() or cfg.default_voice
    engine_key = cfg.engine

    cache_key = _audio_cache_key(text, voice, engine_key)

    if not req.no_cache:
        cached = await _audio_cache_get(cache_key)
        if cached is not None:
            log.info("tts_cache_hit", key=cache_key[:16])
            return Response(content=cached, media_type="audio/mpeg")

    log.info("tts_synthesising", engine=engine_key, voice=voice, chars=len(text))

    if engine_key == "piper":
        # Run blocking subprocess in a thread pool to avoid blocking the event loop.
        wav = await run_in_threadpool(_piper_synthesise_wav, text, voice)
    else:
        tts = await _xtts_model_load()
        wav = await run_in_threadpool(_xtts_synthesise_wav_sync, tts, text, req.lang, req.speaker_wav)

    mp3 = await run_in_threadpool(_wav_to_mp3, wav)

    await _audio_cache_set(cache_key, mp3)

    return Response(content=mp3, media_type="audio/mpeg")


@app.post("/preload/{voice}")
async def preload_voice(
    voice: str,
    x_tts_key: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    """Eagerly download and cache a Piper voice model."""
    _check_secret(x_tts_key)
    if cfg.engine != "piper":
        raise HTTPException(
            status_code=400,
            detail="Preload is only supported for the Piper engine."
        )
    await run_in_threadpool(_piper_ensure_model, voice)
    return {"ok": True, "voice": voice}
