"""Request / response Pydantic models for the TTS API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PiperProsody(BaseModel):
    """Bounded controls supported by Piper; omitted values use voice defaults."""

    length_scale: float | None = Field(default=None, ge=0.5, le=2.0)
    noise_scale: float | None = Field(default=None, ge=0.0, le=1.5)
    noise_w_scale: float | None = Field(default=None, ge=0.0, le=1.5)
    sentence_silence: float | None = Field(default=None, ge=0.0, le=2.0)
    volume: float | None = Field(default=None, ge=0.1, le=2.0)


class SynthesiseRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Text to synthesise")
    voice: str = Field("", description="Voice name (Piper) or language code (XTTS)")
    lang: str = Field("de", description="Language code for XTTS engine")
    speaker_wav: str | None = Field(None, description="Path to a WAV sample for XTTS voice cloning")
    prosody: PiperProsody = Field(
        default_factory=PiperProsody, description="Optional bounded Piper prosody controls"
    )
    no_cache: bool = Field(False, description="Bypass cache and re-synthesise")
