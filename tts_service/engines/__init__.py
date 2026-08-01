"""TTS engine factory and public surface."""

from __future__ import annotations

from engines.base import TTSEngine

__all__ = ["TTSEngine", "create_engine"]


def create_engine(engine_name: str, cache_dir: object) -> TTSEngine:
    """Return a configured TTS engine instance.

    Imports are deferred to avoid loading heavy ML dependencies at startup
    unless the corresponding engine is actually requested.
    """
    from pathlib import Path

    if engine_name == "piper":
        from engines.piper import PiperEngine

        return PiperEngine(Path(str(cache_dir)))  # type: ignore[return-value]
    if engine_name == "xtts":
        from engines.xtts import XTTSEngine

        return XTTSEngine()  # type: ignore[return-value]
    raise ValueError(f"Unknown TTS engine: {engine_name!r}. Supported: piper, xtts")
