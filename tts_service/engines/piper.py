"""Piper TTS engine implementation."""

from __future__ import annotations

import hashlib
import re
import subprocess
import tempfile
import urllib.parse
from pathlib import Path

import httpx
import structlog
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from audio import wav_to_mp3

log: structlog.BoundLogger = structlog.get_logger("gq-tts.piper")

# Model files are downloaded on first use. Add more voices here as needed.
PIPER_VOICES: dict[str, dict[str, str]] = {
    "de_DE-thorsten-high": {
        "model_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx",
        "config_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json",
        "lang": "de",
        "description": "German male – Thorsten (high quality)",
    },
    "de_DE-thorsten-medium": {
        "model_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx",
        "config_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json",
        "lang": "de",
        "description": "German male – Thorsten (medium quality)",
    },
    "en_US-lessac-high": {
        "model_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/high/en_US-lessac-high.onnx",
        "config_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/high/en_US-lessac-high.onnx.json",
        "lang": "en",
        "description": "English (US) female – Lessac (high quality)",
    },
    "en_GB-alba-medium": {
        "model_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alba/medium/en_GB-alba-medium.onnx",
        "config_url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json",
        "lang": "en",
        "description": "English (GB) female – Alba (medium quality)",
    },
}

_SAFE_VOICE_RE = re.compile(r"^[a-zA-Z0-9_\-]{1,80}$")


def _validate_voice_name(voice: str) -> str:
    """Reject voice names that contain characters unsafe for filesystem paths.

    Only ASCII alphanumerics, hyphens, and underscores are allowed.
    This is checked *before* the voice name touches the filesystem.
    """
    if not _SAFE_VOICE_RE.match(voice):
        raise HTTPException(
            status_code=400,
            detail=(
                "Voice name contains invalid characters. "
                "Only letters, digits, hyphens and underscores are allowed."
            ),
        )
    return voice


def _download_file(url: str, dest: Path) -> None:
    """Download *url* to *dest* using httpx with an explicit timeout."""
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        with client.stream("GET", url) as resp:
            resp.raise_for_status()
            tmp = dest.with_suffix(".tmp")
            try:
                with open(tmp, "wb") as fh:
                    for chunk in resp.iter_bytes(chunk_size=65536):
                        fh.write(chunk)
                tmp.rename(dest)
            except Exception:
                tmp.unlink(missing_ok=True)
                raise


class PiperEngine:
    """TTS engine backed by the Piper CLI binary."""

    name = "piper"

    def __init__(self, cache_dir: Path) -> None:
        self._cache_dir = cache_dir

    def list_voices(self) -> list[dict[str, object]]:
        return [
            {
                "name": k,
                **{kk: vv for kk, vv in v.items() if kk not in ("model_url", "config_url")},
            }
            for k, v in PIPER_VOICES.items()
        ]

    async def synthesise_mp3(
        self,
        text: str,
        voice: str,
        lang: str,
        speaker_wav: str | None,
    ) -> bytes:
        wav = await run_in_threadpool(self._synthesise_wav, text, voice)
        return await run_in_threadpool(wav_to_mp3, wav)

    def ensure_model(self, voice: str) -> tuple[Path, Path]:
        """Download Piper voice model files if not already cached.

        File paths are derived entirely from the hardcoded PIPER_VOICES registry
        (never from user input) to prevent path-traversal vulnerabilities.
        """
        _validate_voice_name(voice)
        if voice not in PIPER_VOICES:
            raise HTTPException(status_code=400, detail=f"Unknown Piper voice: {voice!r}")

        info = PIPER_VOICES[voice]

        # Derive filenames from the hardcoded registry URLs – NOT from user input.
        model_filename = Path(urllib.parse.urlparse(info["model_url"]).path).name
        config_filename = Path(urllib.parse.urlparse(info["config_url"]).path).name

        # Use a SHA-256 of the whitelisted key as the directory name so that the
        # filesystem path is fully under our control.
        dir_name = hashlib.sha256(info["model_url"].encode()).hexdigest()
        voice_dir = self._cache_dir / dir_name
        voice_dir.mkdir(parents=True, exist_ok=True)

        onnx = voice_dir / model_filename
        voice_cfg = voice_dir / config_filename

        if not onnx.exists():
            log.info("downloading_piper_model", voice=voice)
            _download_file(info["model_url"], onnx)

        if not voice_cfg.exists():
            log.info("downloading_piper_config", voice=voice)
            _download_file(info["config_url"], voice_cfg)

        return onnx, voice_cfg

    def _synthesise_wav(self, text: str, voice: str) -> bytes:
        """Run the Piper CLI and return raw WAV bytes."""
        onnx, voice_cfg = self.ensure_model(voice)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = Path(tmp.name)

        try:
            subprocess.run(
                [
                    "piper",
                    "--model",
                    str(onnx),
                    "--config",
                    str(voice_cfg),
                    "--output_file",
                    str(tmp_path),
                ],
                input=text.encode("utf-8"),
                capture_output=True,
                timeout=60,
                check=True,
            )
            return tmp_path.read_bytes()
        except subprocess.CalledProcessError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Piper synthesis failed: {exc.stderr.decode(errors='replace')}",
            ) from exc
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=500,
                detail="piper binary not found. Ensure the piper-tts package is installed.",
            ) from exc
        finally:
            tmp_path.unlink(missing_ok=True)
