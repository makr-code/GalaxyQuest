#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'NATIVE PACKAGE ERROR: %s\n' "$*" >&2; exit 1; }
[[ $# == 3 ]] || fail "Usage: package-native-release.sh IMAGE_ID FULL_COMMIT_SHA OUTPUT_ARCHIVE"
image=$1
commit=$2
output=$3
for tool in git docker tar gzip sha256sum mktemp find ln; do
  command -v "$tool" >/dev/null || fail "Missing tool: $tool"
done
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "IMAGE_ID must be an immutable local image ID."
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || fail "Use a full Git commit SHA."
[[ "$(git rev-parse --verify "${commit}^{commit}")" == "$commit" ]] || fail "Commit not found."
[[ ! -e "$output" && ! -L "$output" ]] || fail "Output already exists."
[[ -d "$(dirname -- "$output")" ]] || fail "Output directory does not exist."
[[ "$(docker image inspect --format '{{.Id}}' "$image")" == "$image" ]] || fail "Image ID mismatch."
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" == "$commit" ]] ||
  fail "Image revision label does not match the requested commit."

tmp=$(mktemp -d)
archive_tmp=''
container=''
cleanup() {
  local status=$?
  if [[ -n "$container" ]]; then
    docker rm "$container" >/dev/null || { printf 'NATIVE PACKAGE ERROR: cannot remove test container %s\n' "$container" >&2; status=1; }
  fi
  if [[ -n "$archive_tmp" ]]; then rm -f -- "$archive_tmp" || status=1; fi
  rm -rf -- "$tmp" || status=1
  return "$status"
}
trap cleanup EXIT
archive_tmp=$(mktemp "$(dirname -- "$output")/.gq-native-package.XXXXXXXX")
mkdir -p "$tmp/release/dist"

# Only tracked runtime inputs are exported; mutable/generated data and WordPress are excluded.
git archive "$commit" -- \
  .htaccess .build VERSION.txt api.php developer-blog-admin.php health.php index.php setup.php \
  ai api config css fractions gfx js lib models music scenarios scripts sfx sql src |
  tar -xf - -C "$tmp/release"

container=$(docker create "$image")
[[ "$container" =~ ^[a-f0-9]{64}$ ]] || fail "Invalid container ID."
docker cp "$container:/var/www/html/dist/." "$tmp/release/dist"
[[ -s "$tmp/release/dist/index.html" && -d "$tmp/release/dist/assets" ]] ||
  fail "Candidate image does not contain a built Vite frontend."
[[ -z "$(find "$tmp/release/dist" -type l -print -quit)" ]] || fail "Frontend contains symbolic links."
[[ ! -e "$tmp/release/wordpress" && ! -e "$tmp/release/generated" && ! -e "$tmp/release/cache" ]] ||
  fail "Mutable or WordPress content unexpectedly entered the release."

epoch=$(git show -s --format=%ct "$commit")
[[ "$epoch" =~ ^[0-9]+$ ]] || fail "Invalid commit timestamp."
printf '{"commit":"%s","web_image_id":"%s","status":"not-deployable"}\n' "$commit" "$image" > "$tmp/release/native-release.json"
tar --sort=name --mtime="@$epoch" --owner=0 --group=0 --numeric-owner \
  -C "$tmp/release" -cf - . | gzip -n > "$archive_tmp"
gzip -t "$archive_tmp"
# Never overwrite an existing operator file, including if it appeared during packaging.
ln "$archive_tmp" "$output" || fail "Cannot create output without overwriting an existing file."
printf 'Prepared non-deployable native package: %s\n' "$output"
sha256sum "$output"
