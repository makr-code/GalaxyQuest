"""Async filesystem cache for rendered MP3 audio."""

from __future__ import annotations

import hashlib
from pathlib import Path

import aiofiles
import structlog

log: structlog.BoundLogger = structlog.get_logger("gq-tts.cache")


class AudioCache:
    """Async filesystem cache that stores synthesised MP3 files keyed by content hash."""

    def __init__(self, cache_dir: Path) -> None:
        self._dir = cache_dir
        self._dir.mkdir(parents=True, exist_ok=True)

    def key(self, text: str, voice: str, engine: str) -> str:
        return hashlib.sha256(f"{engine}|{voice}|{text}".encode()).hexdigest()

    def path(self, key: str) -> Path:
        return self._dir / f"{key}.mp3"

    async def get(self, key: str) -> bytes | None:
        p = self.path(key)
        if not p.exists():
            return None
        async with aiofiles.open(p, "rb") as fh:
            data: bytes = await fh.read()
        return data

    async def set(self, key: str, mp3: bytes) -> None:
        p = self.path(key)
        tmp = p.with_suffix(".tmp")
        async with aiofiles.open(tmp, "wb") as fh:
            await fh.write(mp3)
        tmp.rename(p)
        log.debug("audio_cache_written", key=key[:16])
