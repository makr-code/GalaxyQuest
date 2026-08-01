"""Unit tests for TTSSettings."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from config import TTSSettings


def test_defaults() -> None:
    cfg = TTSSettings()
    assert cfg.engine == "piper"
    assert cfg.default_voice == "de_DE-thorsten-high"
    assert cfg.max_chars == 2000
    assert cfg.secret == ""
    assert cfg.cors_origins == ""


def test_cors_origin_list_empty() -> None:
    cfg = TTSSettings()
    assert cfg.cors_origin_list == []


def test_cors_origin_list_wildcard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TTS_CORS_ORIGINS", "*")
    cfg = TTSSettings()
    assert cfg.cors_origin_list == ["*"]


def test_cors_origin_list_multiple(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TTS_CORS_ORIGINS", "http://a.com, http://b.com , http://c.com")
    cfg = TTSSettings()
    assert cfg.cors_origin_list == ["http://a.com", "http://b.com", "http://c.com"]


def test_env_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TTS_ENGINE", "xtts")
    monkeypatch.setenv("TTS_MAX_CHARS", "500")
    cfg = TTSSettings()
    assert cfg.engine == "xtts"
    assert cfg.max_chars == 500


def test_max_chars_must_be_int(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TTS_MAX_CHARS", "not_a_number")
    with pytest.raises(ValidationError):
        TTSSettings()
