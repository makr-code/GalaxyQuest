"""Tests for Piper voice registration."""

from __future__ import annotations

from pathlib import Path

from engines.piper import PiperEngine


def test_lists_german_female_kerstin_voice(tmp_path: Path) -> None:
    voices = PiperEngine(tmp_path).list_voices()
    kerstin = next(voice for voice in voices if voice["name"] == "de_DE-kerstin-low")

    assert kerstin["lang"] == "de"
    assert "female" in str(kerstin["description"]).lower()


def test_lists_english_male_ryan_voice(tmp_path: Path) -> None:
    voices = PiperEngine(tmp_path).list_voices()
    ryan = next(voice for voice in voices if voice["name"] == "en_US-ryan-high")

    assert ryan["lang"] == "en"
    assert "male" in str(ryan["description"]).lower()
