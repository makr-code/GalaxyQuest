"""TTSEngine protocol – structural interface every engine must satisfy."""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class TTSEngine(Protocol):
    """Structural interface every TTS engine must satisfy."""

    name: str

    async def synthesise_mp3(
        self,
        text: str,
        voice: str,
        lang: str,
        speaker_wav: str | None,
    ) -> bytes:
        """Return MP3 bytes for the given text and voice parameters."""
        ...

    def list_voices(self) -> list[dict[str, object]]:
        """Return a list of available voice metadata dicts."""
        ...
