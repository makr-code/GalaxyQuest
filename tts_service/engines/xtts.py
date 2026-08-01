"""Coqui XTTS v2 engine implementation."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import structlog
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from audio import wav_to_mp3

log: structlog.BoundLogger = structlog.get_logger("gq-tts.xtts")

_xtts_model: object = None
_xtts_lock = asyncio.Lock()


class XTTSEngine:
    """TTS engine backed by Coqui XTTS v2 (multilingual, voice clonable)."""

    name = "xtts"

    def list_voices(self) -> list[dict[str, object]]:
        return [
            {"name": "xtts_v2", "description": "Coqui XTTS v2 – multilingual, voice clonable"},
        ]

    async def synthesise_mp3(
        self,
        text: str,
        voice: str,
        lang: str,
        speaker_wav: str | None,
    ) -> bytes:
        model = await _load_xtts_model()
        wav = await run_in_threadpool(_synthesise_xtts_wav, model, text, lang, speaker_wav)
        return await run_in_threadpool(wav_to_mp3, wav)


async def _load_xtts_model() -> object:
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
                detail=f"Coqui TTS package not installed: {exc}",
            ) from exc
        except (RuntimeError, OSError, ValueError) as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Could not load XTTS model: {exc}",
            ) from exc


def _synthesise_xtts_wav(
    tts: object,
    text: str,
    lang: str,
    speaker_wav: str | None,
) -> bytes:
    """Blocking XTTS synthesis helper – always called via run_in_threadpool."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    try:
        kwargs: dict[str, object] = {
            "text": text,
            "language": lang,
            "file_path": str(tmp_path),
        }
        if speaker_wav:
            kwargs["speaker_wav"] = speaker_wav
        tts.tts_to_file(**kwargs)  # type: ignore[attr-defined]
        return tmp_path.read_bytes()
    except (RuntimeError, OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"XTTS synthesis failed: {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)
