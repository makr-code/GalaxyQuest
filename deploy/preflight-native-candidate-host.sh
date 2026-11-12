#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'NATIVE CANDIDATE PREFLIGHT: %s\n' "$*" >&2; exit 1; }
[[ $# -ge 3 ]] || fail 'Usage: preflight-native-candidate-host.sh ABSOLUTE_PRIVATE_SPOOL ABSOLUTE_PRIVATE_CANDIDATE_ROOT DOCUMENT_ROOT [OTHER_DOCUMENT_ROOT ...]'
(( EUID != 0 )) || fail 'Run as the non-root Plesk subscription account.'
(( BASH_VERSINFO[0] >= 4 )) || fail 'Bash 4 or newer is required.'

for tool in curl unzip sha256sum tar mktemp awk ln stat find chmod mv mkdir rm cat grep; do
  command -v "$tool" >/dev/null || fail "Missing tool: $tool"
done
tar --version 2>/dev/null | grep -Fq 'GNU tar' || fail 'GNU tar is required.'
stat --version 2>/dev/null | grep -Fq 'GNU coreutils' || fail 'GNU coreutils stat is required.'
mv --version 2>/dev/null | grep -Fq 'GNU coreutils' || fail 'GNU coreutils mv is required.'
unzip -v >/dev/null 2>&1 || fail 'Cannot run unzip.'
curl_help=$(curl --help all 2>/dev/null) || fail 'Cannot inspect curl options.'
for option in --disable --max-redirs --dump-header --write-out --proto --config; do
  [[ "$curl_help" == *"$option"* ]] || fail "curl does not support $option."
done

canonical_dir() {
  local label=$1 directory=$2 canonical
  [[ "$directory" == /* && -d "$directory" ]] || fail "$label must be an existing absolute directory."
  canonical=$(cd -- "$directory" && pwd -P) || fail "Cannot resolve $label."
  [[ "$canonical" != "/" ]] || fail "$label cannot be the filesystem root."
  printf '%s' "$canonical"
}

private_dir() {
  local label=$1 directory=$2 canonical mode
  [[ "$directory" == /* && -d "$directory" && ! -L "$directory" &&
    -O "$directory" && -w "$directory" ]] ||
    fail "$label must be an existing, writable directory owned by this account, not a symlink."
  canonical=$(canonical_dir "$label" "$directory")
  mode=$(stat -c '%a' -- "$canonical") || fail "Cannot inspect $label permissions."
  [[ "$mode" =~ ^[0-7]+$ && ${#mode} -ge 3 && ${#mode} -le 4 ]] ||
    fail "Cannot verify $label permissions."
  (( (8#$mode & 077) == 0 )) || fail "$label permissions must exclude group and other access."
  printf '%s' "$canonical"
}

paths_overlap() {
  local left=$1 right=$2
  [[ "$left" == "$right" || "$left" == "$right/"* || "$right" == "$left/"* ]]
}

spool=$(private_dir 'Private spool' "$1")
candidate_root=$(private_dir 'Private candidate root' "$2")
shift 2
paths_overlap "$spool" "$candidate_root" &&
  fail 'Private spool and candidate root must be separate, non-nested directories.'

document_roots=()
for supplied_root in "$@"; do
  document_root=$(canonical_dir 'Document root' "$supplied_root")
  paths_overlap "$spool" "$document_root" &&
    fail 'Private spool overlaps a supplied document root.'
  paths_overlap "$candidate_root" "$document_root" &&
    fail 'Private candidate root overlaps a supplied document root.'
  document_roots+=("$document_root")
done

printf '{"status":"native-candidate-host-preflight-passed","account_uid":%s,"document_roots_checked":%s,"downloaded":false,"staged":false,"activated":false}\n' \
  "$EUID" "${#document_roots[@]}"
