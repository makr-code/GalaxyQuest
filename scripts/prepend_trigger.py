#!/usr/bin/env python3
"""
prepend_trigger.py — LoRA Training Helper

Prepends a trigger word to all .txt caption files in a directory.
Used to prepare datasets for LoRA training with Kohya SS or OneTrainer.

Usage:
    python scripts/prepend_trigger.py datasets/vortak/filtered/ "vortak_race"
    python scripts/prepend_trigger.py datasets/sylnar/filtered/ "sylnar_race"
    python scripts/prepend_trigger.py datasets/aereth/filtered/ "aereth_race"
    python scripts/prepend_trigger.py datasets/kryltha/filtered/ "kryltha_race"
    python scripts/prepend_trigger.py datasets/zhareen/filtered/ "zhareen_race"
    python scripts/prepend_trigger.py datasets/velar/filtered/ "velar_race"

    # Dry-run (preview without modifying):
    python scripts/prepend_trigger.py datasets/vortak/filtered/ "vortak_race" --dry-run

    # Force overwrite even if trigger already present:
    python scripts/prepend_trigger.py datasets/vortak/filtered/ "vortak_race" --force
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def prepend_trigger(
    directory: Path,
    trigger_word: str,
    dry_run: bool = False,
    force: bool = False,
) -> None:
    """Prepend trigger_word to every .txt caption file in directory.

    :param directory:    Path to directory containing .txt caption files
    :param trigger_word: The LoRA trigger word to prepend (e.g. "vortak_race")
    :param dry_run:      If True, print actions without writing any files
    :param force:        If True, re-prepend even if trigger_word already present
    :raises FileNotFoundError: When *directory* does not exist
    """
    if not directory.is_dir():
        raise FileNotFoundError(f"Directory not found: {directory}")

    txt_files = sorted(directory.glob("*.txt"))

    if not txt_files:
        print(f"[WARN]  No .txt files found in: {directory}")
        return

    updated = 0
    skipped = 0

    for file_path in txt_files:
        content = file_path.read_text(encoding="utf-8").strip()

        if content.startswith(trigger_word) and not force:
            print(f"  [SKIP] {file_path.name} (trigger already present)")
            skipped += 1
            continue

        new_content = f"{trigger_word}, {content}" if content else trigger_word

        if dry_run:
            print(f"  [DRY]  {file_path.name}")
            print(f"         Before: {content[:80]}{'...' if len(content) > 80 else ''}")
            print(f"         After:  {new_content[:80]}{'...' if len(new_content) > 80 else ''}")
        else:
            file_path.write_text(new_content, encoding="utf-8")
            print(f"  [ OK ] {file_path.name}")

        updated += 1

    print()
    if dry_run:
        print(f"[DRY-RUN] Would update {updated} file(s), skip {skipped} file(s).")
    else:
        print(f"[DONE]  Updated {updated} file(s), skipped {skipped} file(s).")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepend a LoRA trigger word to all .txt caption files in a dataset directory."
    )
    parser.add_argument("directory", help="Path to dataset directory containing .txt caption files")
    parser.add_argument("trigger_word", help='LoRA trigger word to prepend (e.g. "vortak_race")')
    parser.add_argument(
        "--dry-run", action="store_true", help="Preview changes without modifying files"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-prepend even if trigger already present",
    )

    args = parser.parse_args()

    print(f"[INFO]  Directory:    {args.directory}")
    print(f"[INFO]  Trigger word: {args.trigger_word}")
    if args.dry_run:
        print("[INFO]  Mode: DRY-RUN (no files will be modified)")
    print()

    try:
        prepend_trigger(
            directory=Path(args.directory),
            trigger_word=args.trigger_word,
            dry_run=args.dry_run,
            force=args.force,
        )
    except FileNotFoundError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
