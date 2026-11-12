#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'NATIVE CANDIDATE PULL: %s\n' "$*" >&2; exit 1; }
[[ $# == 4 ]] || fail 'Usage: pull-native-candidate.sh ARTIFACT_ID sha256:DIGEST FULL_COMMIT_SHA ABSOLUTE_PRIVATE_SPOOL'
artifact_id=$1
expected_digest=$2
commit=$3
spool=$4

[[ "$artifact_id" =~ ^[1-9][0-9]*$ && ${#artifact_id} -le 16 ]] ||
  fail 'Artifact ID must be a positive decimal integer.'
[[ "$expected_digest" =~ ^sha256:[a-f0-9]+$ && ${#expected_digest} -eq 71 ]] ||
  fail 'Expected digest must be a full lowercase SHA-256.'
[[ "$commit" =~ ^[a-f0-9]+$ && ${#commit} -eq 40 ]] || fail 'Commit must be a full lowercase Git SHA-1.'
[[ "$spool" == /* && -d "$spool" && ! -L "$spool" && -O "$spool" && -w "$spool" ]] ||
  fail 'Spool must be an existing absolute, writable directory owned by this account.'
command -v stat >/dev/null || fail 'Missing tool: stat'
spool_mode=$(stat -c '%a' -- "$spool") || fail 'Cannot inspect spool permissions.'
[[ "$spool_mode" =~ ^[0-7]{3,4}$ ]] || fail 'Cannot verify spool permissions.'
(( (8#$spool_mode & 077) == 0 )) || fail 'Spool permissions must exclude group and other access.'

for tool in curl unzip sha256sum tar mktemp awk ln; do
  command -v "$tool" >/dev/null || fail "Missing tool: $tool"
done
token=${GH_TOKEN:-}
[[ "$token" =~ ^[A-Za-z0-9_]+$ && ${#token} -ge 20 && ${#token} -le 512 ]] ||
  fail 'GH_TOKEN must contain an Actions-read credential; its value is never accepted as an argument.'

output="$spool/native-plesk-candidate-$commit-$artifact_id.zip"
[[ ! -e "$output" && ! -L "$output" ]] || fail 'Candidate output already exists.'

tmp=$(mktemp -d -- "$spool/.native-candidate-pull.XXXXXXXX") || fail 'Cannot create private temporary directory.'
cleanup() {
  local status=$?
  rm -rf -- "$tmp" || status=1
  return "$status"
}
trap cleanup EXIT

auth_config="$tmp/github-api.conf"
headers="$tmp/response.headers"
artifact_zip="$tmp/artifact.zip"
printf 'header = "Authorization: Bearer %s"\n' "$token" > "$auth_config"
unset GH_TOKEN
unset token

api_url="https://api.github.com/repos/makr-code/GalaxyQuest/actions/artifacts/$artifact_id/zip"
if ! status=$(curl --disable --config "$auth_config" --silent --show-error --max-time 30 --max-redirs 0 \
  --dump-header "$headers" --output /dev/null --write-out '%{http_code}' \
  --header 'Accept: application/vnd.github+json' "$api_url"); then
  fail 'GitHub artifact request failed.'
fi
[[ "$status" == 302 ]] || fail "GitHub returned HTTP $status instead of an artifact redirect."

mapfile -t locations < <(awk 'tolower($1) == "location:" { sub(/\r$/, ""); sub(/^[^:]*:[ \t]*/, ""); print }' "$headers")
[[ ${#locations[@]} == 1 ]] || fail 'GitHub did not return exactly one download location.'
location=${locations[0]}
[[ "$location" == https://* && "$location" != *$'\r'* && "$location" != *$'\n'* ]] ||
  fail 'GitHub returned an invalid HTTPS download location.'

curl_config_escape() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '%s' "$value"
}
download_config="$tmp/download.conf"
{
  printf 'url = "%s"\n' "$(curl_config_escape "$location")"
  printf 'output = "%s"\n' "$(curl_config_escape "$artifact_zip")"
  printf 'fail\nlocation\nsilent\nshow-error\nmax-time = 120\nmax-redirs = 3\nproto = "=https"\n'
} > "$download_config"
unset location
curl --disable --config "$download_config"
[[ -s "$artifact_zip" ]] || fail 'Downloaded artifact is empty.'

digest_output=$(sha256sum -- "$artifact_zip") || fail 'Cannot calculate artifact SHA-256.'
actual_digest=${digest_output%% *}
[[ "sha256:$actual_digest" == "$expected_digest" ]] || fail 'Downloaded artifact SHA-256 does not match GitHub evidence.'

entries=$(unzip -Z1 "$artifact_zip") || fail 'Downloaded artifact is not a readable ZIP archive.'
[[ "$entries" == native-plesk-candidate.tar.gz ]] ||
  fail 'Artifact ZIP must contain only native-plesk-candidate.tar.gz.'
unzip -p "$artifact_zip" native-plesk-candidate.tar.gz > "$tmp/release.tar.gz" ||
  fail 'Cannot read the candidate release archive.'
manifest_entries=$(tar -tzf "$tmp/release.tar.gz") || fail 'Candidate release archive is not a readable gzip tar.'
manifest_count=0
while IFS= read -r entry; do
  if [[ "$entry" == ./native-release.json ]]; then
    manifest_count=$((manifest_count + 1))
  fi
done <<< "$manifest_entries"
[[ "$manifest_count" == 1 ]] || fail 'Candidate must contain exactly one native-release.json manifest.'
manifest=$(tar -xOzf "$tmp/release.tar.gz" ./native-release.json) ||
  fail 'Cannot read candidate release manifest.'
manifest_prefix="{\"commit\":\"$commit\",\"web_image_id\":\""
manifest_suffix="\",\"status\":\"not-deployable\"}"
[[ "$manifest" == "$manifest_prefix"*"$manifest_suffix" ]] ||
  fail 'Candidate manifest does not match the requested commit or non-deployable status.'
web_image=${manifest#"$manifest_prefix"}
web_image=${web_image%"$manifest_suffix"}
[[ "$web_image" =~ ^sha256:[a-f0-9]+$ && ${#web_image} -eq 71 ]] ||
  fail 'Candidate manifest has an invalid web image ID.'
ln -- "$artifact_zip" "$output" || fail 'Cannot publish candidate without overwriting an existing file.'

printf '{"artifact_id":%s,"digest":"sha256:%s","commit":"%s","file":"native-plesk-candidate-%s-%s.zip","status":"downloaded-unexpanded-not-deployable"}\n' \
  "$artifact_id" "$actual_digest" "$commit" "$commit" "$artifact_id"
