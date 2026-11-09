#!/usr/bin/env bash

set -u

if (($# > 1)) || { (($# == 1)) && [[ ! $1 =~ ^--limit=([1-9][0-9]{0,2})$ ]]; }; then
    printf '%s\n' 'Usage: bash scripts/run_live_battle_journal_worker.sh [--limit=1..100]' >&2
    exit 1
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 1
stopping=0
trap 'stopping=1' INT TERM

while ((stopping == 0)); do
    php "$script_dir/process_live_battle_journals.php" "$@" &
    child=$!
    wait "$child"
    status=$?
    if ((stopping != 0 && status > 128)); then
        wait "$child"
        status=$?
    fi
    if ((status != 0)); then
        printf 'Live battle journal worker batch exited with status %d.\n' "$status" >&2
        exit "$status"
    fi
    if ((stopping != 0)); then
        break
    fi
    sleep 1 &
    child=$!
    wait "$child"
    status=$?
    if ((stopping != 0 && status > 128)); then
        wait "$child"
        status=$?
    fi
    if ((status != 0)); then
        printf 'Live battle journal worker wait exited with status %d.\n' "$status" >&2
        exit "$status"
    fi
done
