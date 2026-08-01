"""Unit tests for AudioCache."""

from __future__ import annotations

from pathlib import Path

import pytest

from cache import AudioCache


@pytest.fixture()
def cache(tmp_path: Path) -> AudioCache:
    return AudioCache(tmp_path / "audio_cache")


def test_cache_dir_created(tmp_path: Path) -> None:
    d = tmp_path / "subdir" / "cache"
    AudioCache(d)
    assert d.is_dir()


def test_key_is_deterministic(cache: AudioCache) -> None:
    k1 = cache.key("hello world", "voice-a", "piper")
    k2 = cache.key("hello world", "voice-a", "piper")
    assert k1 == k2


def test_key_differs_by_text(cache: AudioCache) -> None:
    assert cache.key("foo", "v", "e") != cache.key("bar", "v", "e")


def test_key_differs_by_voice(cache: AudioCache) -> None:
    assert cache.key("t", "v1", "e") != cache.key("t", "v2", "e")


def test_key_differs_by_engine(cache: AudioCache) -> None:
    assert cache.key("t", "v", "piper") != cache.key("t", "v", "xtts")


def test_path_uses_mp3_extension(cache: AudioCache) -> None:
    p = cache.path("abc123")
    assert p.suffix == ".mp3"


@pytest.mark.asyncio
async def test_get_returns_none_for_missing(cache: AudioCache) -> None:
    result = await cache.get("nonexistent_key_xyz")
    assert result is None


@pytest.mark.asyncio
async def test_set_then_get_roundtrip(cache: AudioCache) -> None:
    key = cache.key("test text", "de_DE-thorsten-high", "piper")
    data = b"\xff\xfb\x90\x00" * 16  # fake MP3 bytes

    await cache.set(key, data)
    result = await cache.get(key)

    assert result == data


@pytest.mark.asyncio
async def test_set_is_atomic(cache: AudioCache) -> None:
    """Writing uses a .tmp file; the final .mp3 must exist, no .tmp left."""
    key = cache.key("atomic", "v", "e")
    await cache.set(key, b"some bytes")

    mp3_path = cache.path(key)
    tmp_path = mp3_path.with_suffix(".tmp")

    assert mp3_path.exists()
    assert not tmp_path.exists()
