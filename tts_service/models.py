"""Request / response Pydantic models for the TTS API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SynthesiseRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Text to synthesise")
    voice: str = Field("", description="Voice name (Piper) or language code (XTTS)")
    lang: str = Field("de", description="Language code for XTTS engine")
    speaker_wav: str | None = Field(None, description="Path to a WAV sample for XTTS voice cloning")
    no_cache: bool = Field(False, description="Bypass cache and re-synthesise")
