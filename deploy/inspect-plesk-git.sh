#!/usr/bin/env bash
set -Eeuo pipefail

fail() { printf 'PLESK GIT INSPECT: %s\n' "$*" >&2; exit 1; }
[[ $# == 3 ]] || fail 'Usage: inspect-plesk-git.sh staging|production ABSOLUTE_BARE_REPOSITORY EXPECTED_COMMIT'
environment=$1
repository=$2
expected=$3
case "$environment" in
  staging) branch=develop ;;
  production) branch=main ;;
  *) fail 'Environment must be staging or production.' ;;
esac
[[ "$repository" == /* && -d "$repository" ]] || fail 'An existing absolute bare repository path is required.'
[[ "$expected" =~ ^[0-9a-f]{40}$ ]] || fail 'Expected commit must be a full lowercase SHA-1.'
command -v git >/dev/null || fail 'Git is unavailable.'
export GIT_OPTIONAL_LOCKS=0
[[ "$(git --git-dir="$repository" rev-parse --is-bare-repository)" == true ]] ||
  fail 'The repository must be bare.'
[[ "$(git --git-dir="$repository" remote get-url origin)" == https://github.com/makr-code/GalaxyQuest.git ]] ||
  fail 'Unexpected origin URL.'
actual=$(git --git-dir="$repository" rev-parse --verify "refs/heads/$branch^{commit}") ||
  fail "Missing branch $branch."
[[ "$actual" == "$expected" ]] || fail "Branch $branch does not match the expected commit."
printf '{"environment":"%s","branch":"%s","commit":"%s","status":"source-only"}\n' \
  "$environment" "$branch" "$actual"
