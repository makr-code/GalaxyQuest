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

import os
import sys
import argparse


def prepend_trigger(directory: str, trigger_word: str, dry_run: bool = False, force: bool = False) -> None:
    """
    Prepend trigger_word to every .txt caption file in directory.

    :param directory:   Path to directory containing .txt caption files
    :param trigger_word: The LoRA trigger word to prepend (e.g. "vortak_race")
    :param dry_run:     If True, print actions without writing any files
    :param force:       If True, re-prepend even if trigger_word already present
    """
    if not os.path.isdir(directory):
        print(f"[ERROR] Directory not found: {directory}", file=sys.stderr)
        sys.exit(1)

    txt_files = sorted(f for f in os.listdir(directory) if f.endswith('.txt'))

    if not txt_files:
        print(f"[WARN]  No .txt files found in: {directory}")
        return

    updated = 0
    skipped = 0

    for filename in txt_files:
        path = os.path.join(directory, filename)

        with open(path, 'r', encoding='utf-8') as fh:
            content = fh.read().strip()

        # Check if trigger word is already at the start
        already_present = content.startswith(trigger_word)

        if already_present and not force:
            print(f"  [SKIP] {filename} (trigger already present)")
            skipped += 1
            continue

        new_content = f"{trigger_word}, {content}" if content else trigger_word

        if dry_run:
            print(f"  [DRY]  {filename}")
            print(f"         Before: {content[:80]}{'...' if len(content) > 80 else ''}")
            print(f"         After:  {new_content[:80]}{'...' if len(new_content) > 80 else ''}")
        else:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(new_content)
            print(f"  [ OK ] {filename}")

        updated += 1

    print()
    if dry_run:
        print(f"[DRY-RUN] Would update {updated} file(s), skip {skipped} file(s).")
    else:
        print(f"[DONE]  Updated {updated} file(s), skipped {skipped} file(s).")


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Prepend a LoRA trigger word to all .txt caption files in a dataset directory.'
    )
    parser.add_argument('directory',    help='Path to dataset directory containing .txt caption files')
    parser.add_argument('trigger_word', help='LoRA trigger word to prepend (e.g. "vortak_race")')
    parser.add_argument('--dry-run',    action='store_true', help='Preview changes without modifying files')
    parser.add_argument('--force',      action='store_true', help='Re-prepend even if trigger already present')

    args = parser.parse_args()

    print(f"[INFO]  Directory:    {args.directory}")
    print(f"[INFO]  Trigger word: {args.trigger_word}")
    if args.dry_run:
        print("[INFO]  Mode: DRY-RUN (no files will be modified)")
    print()

    prepend_trigger(
        directory=args.directory,
        trigger_word=args.trigger_word,
        dry_run=args.dry_run,
        force=args.force,
    )


if __name__ == '__main__':
    main()
