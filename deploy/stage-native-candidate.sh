#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'NATIVE CANDIDATE STAGE: %s\n' "$*" >&2; exit 1; }
[[ $# == 4 ]] || fail 'Usage: stage-native-candidate.sh CANDIDATE_ZIP sha256:DIGEST FULL_COMMIT_SHA ABSOLUTE_PRIVATE_CANDIDATE_ROOT'
candidate_zip=$1
expected_digest=$2
commit=$3
candidate_root=$4

[[ "$candidate_zip" == /* && -f "$candidate_zip" && ! -L "$candidate_zip" ]] ||
  fail 'Candidate ZIP must be an existing absolute regular file, not a symlink.'
[[ "$expected_digest" =~ ^sha256:[a-f0-9]+$ && ${#expected_digest} -eq 71 ]] ||
  fail 'Expected digest must be a full lowercase SHA-256.'
[[ "$commit" =~ ^[a-f0-9]+$ && ${#commit} -eq 40 ]] || fail 'Commit must be a full lowercase Git SHA-1.'
[[ "$candidate_root" == /* && -d "$candidate_root" && ! -L "$candidate_root" &&
  -O "$candidate_root" && -w "$candidate_root" ]] ||
  fail 'Candidate root must be an existing absolute, writable directory owned by this account.'
command -v stat >/dev/null || fail 'Missing tool: stat'
root_mode=$(stat -c '%a' -- "$candidate_root") || fail 'Cannot inspect candidate-root permissions.'
[[ "$root_mode" =~ ^[0-7]{3,4}$ ]] || fail 'Cannot verify candidate-root permissions.'
(( (8#$root_mode & 077) == 0 )) || fail 'Candidate-root permissions must exclude group and other access.'

for tool in sha256sum unzip tar mktemp awk find chmod mv; do
  command -v "$tool" >/dev/null || fail "Missing tool: $tool"
done
actual_digest=$(sha256sum -- "$candidate_zip") || fail 'Cannot calculate candidate ZIP SHA-256.'
actual_digest=${actual_digest%% *}
[[ "sha256:$actual_digest" == "$expected_digest" ]] || fail 'Candidate ZIP SHA-256 does not match GitHub evidence.'

output="$candidate_root/$commit"
[[ ! -e "$output" && ! -L "$output" ]] || fail 'Candidate destination already exists.'
tmp=$(mktemp -d -- "$candidate_root/.native-stage-$commit.XXXXXXXX") ||
  fail 'Cannot create private staging directory.'
cleanup() {
  local status=$?
  rm -rf -- "$tmp" || status=1
  return "$status"
}
trap cleanup EXIT

zip_entries=$(unzip -Z1 "$candidate_zip") || fail 'Candidate ZIP is not readable.'
[[ "$zip_entries" == native-plesk-candidate.tar.gz ]] ||
  fail 'Candidate ZIP must contain only native-plesk-candidate.tar.gz.'
unzip -p "$candidate_zip" native-plesk-candidate.tar.gz > "$tmp/release.tar.gz" ||
  fail 'Cannot read the inner release archive.'

tar -tzf "$tmp/release.tar.gz" > "$tmp/entries" || fail 'Inner release archive is not a readable gzip tar.'
while IFS= read -r entry; do
  [[ "$entry" == ./ || "$entry" == ./* ]] || fail 'Archive contains a path outside its release root.'
  relative=${entry#./}
  [[ "$relative" != *'\'* && "$relative" != *$'\t'* && "$relative" != *$'\r'* ]] ||
    fail 'Archive contains an unsupported path character.'
  case "/$relative" in
    */../*|*/..|*/./*|*/.|*//*)
      fail 'Archive contains a traversal or ambiguous path.'
      ;;
  esac
done < "$tmp/entries"

tar -tvzf "$tmp/release.tar.gz" > "$tmp/types" || fail 'Cannot inspect archive entry types.'
while IFS= read -r detail; do
  case "${detail:0:1}" in
    -|d) ;;
    *) fail 'Archive may contain only regular files and directories.' ;;
  esac
done < "$tmp/types"

mkdir "$tmp/tree"
tar -xzf "$tmp/release.tar.gz" -C "$tmp/tree" --no-same-owner --no-same-permissions --no-overwrite-dir ||
  fail 'Cannot extract candidate into the private staging directory.'
[[ -z "$(find "$tmp/tree" -type l -print -quit)" ]] || fail 'Staged candidate unexpectedly contains a symlink.'
[[ -s "$tmp/tree/index.php" && -s "$tmp/tree/dist/index.html" &&
  -d "$tmp/tree/dist/assets" && -s "$tmp/tree/native-release.json" ]] ||
  fail 'Candidate is missing required runtime files.'

manifest=$(cat -- "$tmp/tree/native-release.json") || fail 'Cannot read candidate release manifest.'
manifest_prefix="{\"commit\":\"$commit\",\"web_image_id\":\""
manifest_suffix="\",\"status\":\"not-deployable\"}"
[[ "$manifest" == "$manifest_prefix"*"$manifest_suffix" ]] ||
  fail 'Candidate manifest does not match the requested commit or non-deployable status.'
web_image=${manifest#"$manifest_prefix"}
web_image=${web_image%"$manifest_suffix"}
[[ "$web_image" =~ ^sha256:[a-f0-9]+$ && ${#web_image} -eq 71 ]] ||
  fail 'Candidate manifest has an invalid web image ID.'

find "$tmp/tree" -type d -exec chmod 700 {} + || fail 'Cannot secure candidate directories.'
find "$tmp/tree" -type f -exec chmod 600 {} + || fail 'Cannot secure candidate files.'
mv -T -n -- "$tmp/tree" "$output" || fail 'Cannot publish candidate without overwriting an existing directory.'
[[ ! -e "$tmp/tree" && -d "$output" && ! -L "$output" ]] ||
  fail 'Candidate destination changed during publication.'
printf '{"commit":"%s","directory":"%s","status":"staged-private-not-deployable"}\n' \
  "$commit" "$commit"
