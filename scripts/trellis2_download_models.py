#!/usr/bin/env python3
"""
Standalone HuggingFace model downloader fuer TRELLIS2 (GalaxyQuest dev toolset).
Benoetigt nur: huggingface_hub (kein TRELLIS-Repo-Import noetig).

Verwendung:
    python trellis2_download_models.py --models image-large --cache-dir tools/trellis2/models
"""

from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Sequence

AVAILABLE_MODELS: dict[str, str] = {
    "image-large":  "microsoft/TRELLIS-image-large",
    "text-base":    "microsoft/TRELLIS-text-base",
    "text-large":   "microsoft/TRELLIS-text-large",
    "text-xlarge":  "microsoft/TRELLIS-text-xlarge",
}
DEFAULT_MODELS = ["image-large"]


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Laedt TRELLIS2-Modelle von HuggingFace lokal herunter.")
    parser.add_argument(
        "--models",
        default=",".join(DEFAULT_MODELS),
        help=(
            "Kommagetrennte Model-Schluessel. "
            f"Erlaubt: {', '.join(AVAILABLE_MODELS)}. "
            "Default: image-large"
        ),
    )
    parser.add_argument(
        "--cache-dir",
        default="tools/trellis2/models",
        help="Lokales Basisverzeichnis fuer den HF-Cache (HF_HOME).",
    )
    parser.add_argument(
        "--token",
        default="",
        help="HuggingFace-API-Token (optional, fuer gated Models).",
    )
    parser.add_argument(
        "--revision",
        default="main",
        help="Git-Revision / Branch. Default: main",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Verfuegbare Models auflisten und beenden.",
    )
    return parser.parse_args(argv)


def ensure_hf_hub() -> None:
    try:
        import huggingface_hub  # noqa: F401
    except ImportError:
        print("[TRELLIS2] huggingface_hub nicht installiert.")
        print("[TRELLIS2] Installation: pip install huggingface_hub")
        sys.exit(1)


def download_model(
    model_key: str,
    cache_dir: pathlib.Path,
    token: str,
    revision: str,
) -> pathlib.Path:
    from huggingface_hub import snapshot_download

    if model_key not in AVAILABLE_MODELS:
        raise ValueError(
            f"Unbekannter Model-Schluessel '{model_key}'. "
            f"Erlaubt: {', '.join(AVAILABLE_MODELS)}"
        )

    repo_id = AVAILABLE_MODELS[model_key]
    local_dir = cache_dir / model_key

    print(f"[TRELLIS2] Lade Modell: {repo_id}")
    print(f"[TRELLIS2] Zielverzeichnis: {local_dir}")

    kwargs: dict = {
        "repo_id": repo_id,
        "local_dir": str(local_dir),
        "revision": revision,
    }
    if token:
        kwargs["token"] = token

    snapshot_download(**kwargs)

    print(f"[TRELLIS2] ✓ {model_key} heruntergeladen nach {local_dir}")
    return local_dir


def write_model_registry(cache_dir: pathlib.Path, downloaded: dict[str, pathlib.Path]) -> None:
    """Schreibt models.json mit lokalen Pfaden fuer schnellen Zugriff durch generate-Skripte."""
    import json

    registry: dict = {}
    for key, local_dir in downloaded.items():
        registry[key] = {
            "repo_id": AVAILABLE_MODELS[key],
            "local_dir": str(local_dir),
        }

    registry_path = cache_dir / "models.json"
    registry_path.write_text(
        json.dumps(registry, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"[TRELLIS2] Model-Registry geschrieben: {registry_path}")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)

    if args.list:
        print("Verfuegbare TRELLIS2-Modelle:")
        for key, repo_id in AVAILABLE_MODELS.items():
            default_mark = " [default]" if key in DEFAULT_MODELS else ""
            print(f"  {key:<18}  {repo_id}{default_mark}")
        return 0

    ensure_hf_hub()

    cache_dir = pathlib.Path(args.cache_dir).resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)

    requested = [m.strip() for m in args.models.split(",") if m.strip()]
    if not requested:
        print("[TRELLIS2] Keine Modelle angegeben.")
        return 1

    unknown = [m for m in requested if m not in AVAILABLE_MODELS]
    if unknown:
        print(f"[TRELLIS2] Unbekannte Modelle: {unknown}")
        print(f"[TRELLIS2] Erlaubt: {', '.join(AVAILABLE_MODELS)}")
        return 1

    downloaded: dict[str, pathlib.Path] = {}
    failed: list[str] = []

    for model_key in requested:
        try:
            local_dir = download_model(model_key, cache_dir, args.token, args.revision)
            downloaded[model_key] = local_dir
        except Exception as exc:
            print(f"[TRELLIS2] ✗ Fehler bei '{model_key}': {exc}")
            failed.append(model_key)

    if downloaded:
        write_model_registry(cache_dir, downloaded)

    print("")
    print(f"[TRELLIS2] Abgeschlossen: {len(downloaded)} OK, {len(failed)} Fehler.")
    if failed:
        print(f"[TRELLIS2] Fehlgeschlagen: {failed}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
