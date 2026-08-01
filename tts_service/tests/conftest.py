"""Shared pytest fixtures for TTS service tests."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# main.py is importable because pyproject.toml adds tts_service/ to PYTHONPATH
from cache import AudioCache
from main import app, get_cache, get_engine

# ── Mock engine ────────────────────────────────────────────────────────────────


class _MockEngine:
    name = "mock"

    def list_voices(self) -> list[dict[str, object]]:
        return [{"name": "mock-voice", "lang": "de", "description": "Mock TTS voice"}]

    async def synthesise_mp3(
        self,
        text: str,
        voice: str,
        lang: str,
        speaker_wav: str | None,
    ) -> bytes:
        # Return minimal valid-looking MP3 header bytes for test assertions
        return b"ID3\x00\x00\x00\x00\x00\x00\x00"


# ── Fixtures ───────────────────────────────────────────────────────────────────


@pytest.fixture()
def mock_engine() -> _MockEngine:
    return _MockEngine()


@pytest.fixture()
def audio_cache(tmp_path: Path) -> AudioCache:
    return AudioCache(tmp_path / "audio_cache")


@pytest.fixture()
def client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mock_engine: _MockEngine,
    audio_cache: AudioCache,
) -> Iterator[TestClient]:
    monkeypatch.setenv("TTS_CACHE_DIR", str(tmp_path / "voice_cache"))
    monkeypatch.setenv("TTS_AUDIO_CACHE_DIR", str(tmp_path / "audio_cache"))
    monkeypatch.setenv("TTS_SECRET", "")
    monkeypatch.setenv("TTS_ENGINE", "piper")

    app.dependency_overrides[get_engine] = lambda: mock_engine
    app.dependency_overrides[get_cache] = lambda: audio_cache

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.dependency_overrides.clear()
