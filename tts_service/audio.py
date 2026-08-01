"""Shared audio-processing utilities (WAV → MP3 via ffmpeg)."""

from __future__ import annotations

import subprocess

import structlog
from fastapi import HTTPException

log: structlog.BoundLogger = structlog.get_logger("gq-tts.audio")


def wav_to_mp3(wav_bytes: bytes) -> bytes:
    """Convert WAV bytes to MP3 using ffmpeg (compact output for browser streaming)."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "wav",
            "-i",
            "pipe:0",
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "4",
            "-f",
            "mp3",
            "pipe:1",
        ],
        input=wav_bytes,
        capture_output=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"ffmpeg conversion failed: {result.stderr.decode(errors='replace')}",
        )
    return result.stdout
