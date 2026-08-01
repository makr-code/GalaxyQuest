"""GalaxyQuest TTS Service – application configuration."""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
