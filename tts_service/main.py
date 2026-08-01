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
POST /preload/{voice}              – eagerly load a voice model (Piper only)

Environment variables (see TTSSettings in config.py for full list and defaults)
"""

from __future__ import annotations

import shutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

import structlog
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from auth import check_secret
from cache import AudioCache
from config import TTSSettings
from engines import TTSEngine, create_engine
from models import SynthesiseRequest

# ── Logging ────────────────────────────────────────────────────────────────────
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

# ── Module-level config (read-only; used only for CORS middleware setup) ───────
_cfg = TTSSettings()

# ── Lifespan ───────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    cfg = TTSSettings()
    cfg.cache_dir.mkdir(parents=True, exist_ok=True)
    cfg.audio_cache_dir.mkdir(parents=True, exist_ok=True)

    app.state.cfg = cfg
    app.state.engine = create_engine(cfg.engine, cfg.cache_dir)
    app.state.cache = AudioCache(cfg.audio_cache_dir)

    log.info("tts_service_started", engine=cfg.engine, default_voice=cfg.default_voice)
    yield
    log.info("tts_service_stopped")


# ── App + middleware ───────────────────────────────────────────────────────────
app = FastAPI(title="GalaxyQuest TTS Service", version="1.0.0", lifespan=lifespan)

if _cfg.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cfg.cors_origin_list,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

# ── Dependency helpers (injectable / overridable in tests) ─────────────────────


def get_cfg(request: Request) -> TTSSettings:
    return request.app.state.cfg  # type: ignore[no-any-return]


def get_engine(request: Request) -> TTSEngine:
    return request.app.state.engine  # type: ignore[no-any-return]


def get_cache(request: Request) -> AudioCache:
    return request.app.state.cache  # type: ignore[no-any-return]


# ── Routes ─────────────────────────────────────────────────────────────────────


@app.get("/health")
def health(cfg: Annotated[TTSSettings, Depends(get_cfg)]) -> dict[str, object]:
    extra: dict[str, object] = {}
    if cfg.engine == "piper":
        extra["piper_available"] = shutil.which("piper") is not None
    return {"ok": True, "engine": cfg.engine, "default_voice": cfg.default_voice, **extra}


@app.get("/voices")
def list_voices(
    engine: Annotated[TTSEngine, Depends(get_engine)],
    cfg: Annotated[TTSSettings, Depends(get_cfg)],
    x_tts_key: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    check_secret(cfg.secret, x_tts_key)
    return {"engine": engine.name, "voices": engine.list_voices()}


@app.post("/synthesize")
async def synthesize(
    req: SynthesiseRequest,
    engine: Annotated[TTSEngine, Depends(get_engine)],
    cache: Annotated[AudioCache, Depends(get_cache)],
    cfg: Annotated[TTSSettings, Depends(get_cfg)],
    x_tts_key: Annotated[str | None, Header()] = None,
) -> Response:
    check_secret(cfg.secret, x_tts_key)

    text = req.text.strip()
    if len(text) > cfg.max_chars:
        raise HTTPException(
            status_code=400,
            detail=f"Text too long ({len(text)} chars, max {cfg.max_chars}).",
        )
    if not text:
        raise HTTPException(status_code=400, detail="text must not be empty.")

    voice = req.voice.strip() or cfg.default_voice
    cache_key = cache.key(text, voice, engine.name)

    if not req.no_cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            log.info("tts_cache_hit", key=cache_key[:16])
            return Response(content=cached, media_type="audio/mpeg")

    log.info("tts_synthesising", engine=engine.name, voice=voice, chars=len(text))
    mp3 = await engine.synthesise_mp3(text, voice, req.lang, req.speaker_wav)
    await cache.set(cache_key, mp3)

    return Response(content=mp3, media_type="audio/mpeg")


@app.post("/preload/{voice}")
async def preload_voice(
    voice: str,
    engine: Annotated[TTSEngine, Depends(get_engine)],
    cfg: Annotated[TTSSettings, Depends(get_cfg)],
    x_tts_key: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    """Eagerly download and cache a Piper voice model."""
    check_secret(cfg.secret, x_tts_key)
    if engine.name != "piper":
        raise HTTPException(
            status_code=400,
            detail="Preload is only supported for the Piper engine.",
        )
    from engines.piper import PiperEngine

    assert isinstance(engine, PiperEngine)
    await run_in_threadpool(engine.ensure_model, voice)
    return {"ok": True, "voice": voice}
