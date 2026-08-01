"""Request-authentication helpers."""

from __future__ import annotations

from fastapi import HTTPException


def check_secret(secret: str, x_tts_key: str | None) -> None:
    """Reject the request when a shared secret is configured and the header mismatches."""
    if not secret:
        return
    if not x_tts_key or x_tts_key != secret:
        raise HTTPException(status_code=401, detail="Invalid TTS secret.")
