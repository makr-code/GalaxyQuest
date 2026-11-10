#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'DEPLOY ERROR: %s\n' "$*" >&2; exit 1; }
[[ $# -ge 2 ]] || fail "Usage: stack.sh ABSOLUTE_ROOT preflight|bootstrap|deploy|backup|verify|rollback [arguments]"
ROOT=$(realpath "$1")
COMMAND=$2
shift 2
[[ "$ROOT" != / && -d "$ROOT" ]] || fail "Use a dedicated existing deployment directory."
BUNDLE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
export DEPLOY_ROOT="$ROOT"
for tool in docker jq flock curl gzip sha256sum stat sed awk grep; do command -v "$tool" >/dev/null || fail "Missing tool: $tool"; done
exec 9>"$ROOT/deployment.lock"
flock -n 9 || fail "Another deployment/backup is running."
[[ -f "$ROOT/.env" ]] || fail "Missing server .env"
[[ -f "$ROOT/current.env" ]] || printf '# Initial release\n' > "$ROOT/current.env"
RELEASE="$ROOT/current.env"
compose() { docker compose --env-file "$ROOT/.env" --env-file "$RELEASE" -f "$BUNDLE/compose.yml" "$@"; }
cleanup_container=""
cleanup() {
  if [[ -n "$cleanup_container" ]]; then docker rm -f "$cleanup_container" >/dev/null || printf 'Restore-check cleanup failed: %s\n' "$cleanup_container" >&2; fi
}
trap cleanup EXIT
trap 'printf "Deployment failed at line %s; no automatic database rollback was attempted.\n" "$LINENO" >&2' ERR

preflight() {
  [[ "$(uname -s)" == Linux ]] || fail "Linux Docker host required."
  for file in .env runtime.env database.env tts.env grafana.env mysql-exporter.cnf alertmanager.yml current.env; do
    [[ -s "$ROOT/$file" ]] || fail "Missing/empty $file"
    if [[ "$file" == mysql-exporter.cnf || "$file" == alertmanager.yml ]]; then
      [[ "$(stat -c '%a' "$ROOT/$file")" == 640 ]] || fail "$file must have mode 640 for the container supplementary group."
    else
      [[ "$(stat -c '%a' "$ROOT/$file")" =~ ^[46]00$ ]] || fail "$file must have mode 600 or 400."
    fi
    ! grep -Eq 'REPLACE_WITH|CHANGEME' "$ROOT/$file" || fail "Unconfigured placeholder in $file"
  done
  local config
  config=$(compose config --format json)
  jq -e '[.services[].image | test("^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$")] | all' <<< "$config" >/dev/null ||
    fail "Every image must be pinned by digest."
  jq -e '.services.web.environment.APP_ENV == "production" and
    .services.web.environment.DB_PASS == .services.db.environment.MYSQL_PASSWORD and
    .services.web.environment.DB_USER == .services.db.environment.MYSQL_USER and
    .services.web.environment.TTS_SECRET == .services.tts.environment.TTS_SECRET and
    (.services.web.environment.TTS_SECRET | length) >= 32 and
    (.services.db.environment.MYSQL_ROOT_PASSWORD | length) >= 32 and
    (.services.web.environment.DB_PASS | length) >= 32 and
    (.services.web.environment.SMTP_PASSWORD | length) > 0 and
    (.services.web.environment.REGISTRATION_PUBLIC_URL | startswith("https://"))' <<< "$config" >/dev/null ||
    fail "Database/TTS secrets do not match, are too short, or SMTP/public HTTPS URL is missing."
  local expected_project expected_url expected_port expected_grafana
  case "${ROOT##*/}" in
    production)
      expected_project=galaxyquest-production
      expected_url=https://galaxyquest.themisdb.org
      expected_port=8081
      expected_grafana=3000
      ;;
    staging)
      expected_project=galaxyquest-staging
      expected_url=https://staging-galaxyquest.themisdb.org
      expected_port=8082
      expected_grafana=3001
      ;;
    *) fail "Deployment root must end in staging or production." ;;
  esac
  jq -e --arg project "$expected_project" --arg url "$expected_url" --arg port "$expected_port" --arg grafana "$expected_grafana" \
    '.name == $project and .services.web.environment.REGISTRATION_PUBLIC_URL == $url and
    .services.web.ports[0].published == $port and .services.grafana.ports[0].published == $grafana' <<< "$config" >/dev/null ||
    fail "Project, domain or ports do not match this deployment root. Refusing cross-environment writes."
  for file in mysql-exporter.cnf alertmanager.yml; do
    [[ "$(stat -c '%g' "$ROOT/$file")" == "$(jq -r '.services["mysql-exporter"].group_add[0]' <<< "$config")" ]] ||
      fail "$file group must match DEPLOY_GID."
  done
  local metrics_password
  metrics_password=$(sed -n 's/^password=//p' "$ROOT/mysql-exporter.cnf")
  [[ "$metrics_password" =~ ^[a-f0-9]{64}$ ]] || fail "Metrics password must be 64 random lowercase hex characters."
  grep -qx 'host=db' "$ROOT/mysql-exporter.cnf" && grep -qx 'user=metrics' "$ROOT/mysql-exporter.cnf" ||
    fail "Use the dedicated metrics user on host db."
  docker info >/dev/null
  if jq -e '.services | has("comfyui")' <<< "$config" >/dev/null; then
    command -v nvidia-smi >/dev/null || fail "NVIDIA driver is required for the GPU profile."
    [[ "$(uname -m)" == x86_64 ]] || fail "The GPU image requires Linux x86-64 wheels."
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
    [[ "$(docker info --format '{{json .Runtimes}}')" == *nvidia* ]] || fail "Install/configure NVIDIA Container Toolkit."
  elif [[ "$(jq -r '.services.web.environment.COMFYUI_ENABLED' <<< "$config")" != 0 ]]; then
    fail "COMFYUI_ENABLED requires the gpu Compose profile."
  fi
  printf 'Preflight passed for %s\n' "$(jq -r '.name' <<< "$config")"
}

db_sql() {
  compose exec -T db sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names galaxyquest' <<< "$1"
}

verify() {
  compose run --rm --no-deps -T web php scripts/migrate.php verify --env=DEPLOY
  compose exec -T web php scripts/check_health.php
  local port
  port=$(compose config --format json | jq -r '.services.web.ports[0].published')
  curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 3 --max-time 10 "http://127.0.0.1:$port/health/ready"
  if compose config --format json | jq -e '.services | has("comfyui")' >/dev/null; then
    compose exec -T comfyui curl --fail --silent --max-time 10 http://127.0.0.1:8188/object_info |
      jq -e 'has("Trellis2LoadModel") and has("Trellis2MeshWithVoxelGenerator") and has("Trellis2ExportMesh")' >/dev/null ||
      fail "Required TRELLIS2 nodes not loaded."
  fi
  local targets ready=0
  for ((i=0; i<12; i++)); do
    if targets=$(compose exec -T prometheus wget -q -O - http://127.0.0.1:9090/api/v1/targets); then
      if jq -e '.data.activeTargets | length >= 5 and all(.health == "up")' <<< "$targets" >/dev/null; then ready=1; break; fi
    fi
    sleep 5
  done
  [[ "$ready" == 1 ]] || fail "Prometheus targets are not all reachable."
  for expression in mysql_up 'probe_success{job="readiness"}'; do
    compose exec -T prometheus wget -q -O - "http://127.0.0.1:9090/api/v1/query?query=$(jq -rn --arg expression "$expression" '$expression|@uri')" |
      jq -e '.data.result | length > 0 and all(.value[1] == "1")' >/dev/null ||
      fail "Monitoring check failed: $expression"
  done
}

stop_writers() {
  compose stop web
  if compose config --format json | jq -e '.services | has("comfyui")' >/dev/null; then compose stop comfyui; fi
}

backup() {
  mkdir -p "$ROOT/backups"
  local stamp dump expected_tables actual_tables checks
  stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
  dump="$ROOT/backups/$stamp.sql.gz"
  compose exec -T db sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --events --triggers --hex-blob --set-gtid-purged=OFF galaxyquest' | gzip > "$dump"
  gzip -t "$dump"
  sha256sum "$dump" > "$dump.sha256"
  compose run --rm --no-deps -T web tar -czf - generated > "$dump.assets.tar.gz"
  gzip -t "$dump.assets.tar.gz"
  sha256sum "$dump.assets.tar.gz" > "$dump.assets.tar.gz.sha256"
  cp "$ROOT/current.env" "$dump.release.env"
  if [[ -s "$ROOT/current-bundle" ]]; then cp "$ROOT/current-bundle" "$dump.bundle"; fi
  expected_tables=$(db_sql 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = "BASE TABLE";')
  [[ "$expected_tables" =~ ^[1-9][0-9]*$ ]] || fail "Refusing an empty backup."
  cleanup_container="$(compose config --format json | jq -r '.name')-restorecheck-$stamp"
  compose --profile maintenance run -d --no-deps --name "$cleanup_container" restore-check >/dev/null
  local ready=0
  for ((i=0; i<90; i++)); do
    if docker exec "$cleanup_container" sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping --protocol=TCP -h 127.0.0.1 -uroot --silent' >/dev/null 2>&1; then ready=1; break; fi
    sleep 2
  done
  [[ "$ready" == 1 ]] || fail "Disposable restore-check database did not start."
  gzip -dc "$dump" | docker exec -i "$cleanup_container" sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot galaxyquest'
  actual_tables=$(docker exec "$cleanup_container" sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '\''galaxyquest'\'' AND table_type = '\''BASE TABLE'\'';"')
  [[ "$actual_tables" == "$expected_tables" ]] || fail "Backup restore table count mismatch."
  checks=$(docker exec -i "$cleanup_container" sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B galaxyquest' <<<'SELECT CONCAT("CHECK TABLE `", REPLACE(TABLE_NAME, "`", "``"), "`;") FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = "BASE TABLE";')
  docker exec -i "$cleanup_container" sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B galaxyquest' <<<"$checks" > "$dump.restore-check"
  [[ -s "$dump.restore-check" ]] || fail "No restored table checks returned."
  awk -F '\t' '$3 != "status" || $4 != "OK" { exit 1 }' "$dump.restore-check" || fail "Restored table integrity check failed."
  docker rm -f "$cleanup_container" >/dev/null
  cleanup_container=""
  printf 'Restored and checked %s tables from %s\n' "$actual_tables" "$dump" | tee -a "$dump.restore-check"
}

case "$COMMAND" in
  preflight) [[ $# == 0 ]] || fail "Unexpected arguments"; preflight ;;
  backup)
    [[ $# == 0 ]] || fail "Unexpected arguments"
    preflight
    stop_writers
    backup
    compose up -d --wait --wait-timeout 300 web
    if compose config --format json | jq -e '.services | has("comfyui")' >/dev/null; then compose up -d --wait --wait-timeout 300 comfyui; fi
    verify
    ;;
  verify) [[ $# == 0 ]] || fail "Unexpected arguments"; preflight; verify ;;
  bootstrap)
    [[ "${1:-}" == --approve-empty-database && $# == 1 ]] || fail "bootstrap requires --approve-empty-database"
    preflight
    compose pull
    compose up -d --wait --wait-timeout 240 db tts
    [[ "$(db_sql 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();')" == 0 ]] ||
      fail "Bootstrap accepts only an empty database. Existing installations require the normal backup/migration path."
    compose run --rm --no-deps -T web cat sql/schema.sql |
      compose exec -T db sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot galaxyquest'
    backup
    compose run --rm --no-deps -T web php scripts/migrate.php up --env=DEPLOY
    compose run --rm --no-deps -T web php scripts/migrate.php verify --env=DEPLOY
    compose run --rm --no-deps -T web php setup.php --skip-migrations --skip-npc-seed
    metrics_password=$(sed -n 's/^password=//p' "$ROOT/mysql-exporter.cnf")
    sed "s/REPLACE_WITH_SEPARATE_METRICS_PASSWORD/$metrics_password/" "$BUNDLE/metrics-user.sql.example" |
      compose exec -T db sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot galaxyquest'
    compose up -d --wait --wait-timeout 300
    verify
    printf '%s\n' "$BUNDLE" > "$ROOT/current-bundle"
    ;;
  deploy)
    [[ $# == 2 ]] || fail "deploy requires WEB_IMAGE TTS_IMAGE digest references"
    for image in "$@"; do [[ "$image" =~ ^ghcr\.io/makr-code/galaxyquest(-tts)?@sha256:[a-f0-9]{64}$ ]] || fail "Invalid release image"; done
    [[ "$1" == ghcr.io/makr-code/galaxyquest@* && "$2" == ghcr.io/makr-code/galaxyquest-tts@* ]] || fail "Wrong web/TTS repositories"
    RELEASE="$ROOT/candidate.env"
    printf 'WEB_IMAGE=%s\nTTS_IMAGE=%s\n' "$1" "$2" > "$RELEASE"
    preflight
    compose pull
    # Stop all application writers before taking the migration recovery point.
    stop_writers
    backup
    compose run --rm --no-deps -T web php scripts/migrate.php up --dry-run --env=DEPLOY
    compose run --rm --no-deps -T web php scripts/migrate.php up --env=DEPLOY
    compose run --rm --no-deps -T web php scripts/migrate.php verify --env=DEPLOY
    compose up -d --wait --wait-timeout 300
    verify
    cp "$ROOT/current.env" "$ROOT/previous.env"
    if [[ -s "$ROOT/current-bundle" ]]; then cp "$ROOT/current-bundle" "$ROOT/previous-bundle"; fi
    mv "$RELEASE" "$ROOT/current.env"
    printf '%s\n' "$BUNDLE" > "$ROOT/current-bundle"
    printf 'Release activated. Keep the backup and previous release for operator-controlled recovery.\n'
    ;;
  rollback)
    [[ "${1:-}" == --approve-compatible-schema && $# == 1 ]] || fail "rollback requires --approve-compatible-schema after reviewing schema compatibility"
    [[ -s "$ROOT/previous.env" ]] || fail "No previous image release recorded"
    [[ -s "$ROOT/previous-bundle" ]] || fail "No previous deployment bundle recorded"
    BUNDLE=$(cat "$ROOT/previous-bundle")
    [[ "$BUNDLE" == "$ROOT"/releases/* && -f "$BUNDLE/compose.yml" ]] || fail "Previous bundle is not in this deployment's releases directory."
    RELEASE="$ROOT/previous.env"
    preflight
    compose run --rm --no-deps -T web php scripts/migrate.php verify --env=DEPLOY
    compose up -d --wait --wait-timeout 300
    verify
    cp "$ROOT/current.env" "$ROOT/failed.env"
    cp "$ROOT/previous.env" "$ROOT/current.env"
    printf '%s\n' "$BUNDLE" > "$ROOT/current-bundle"
    printf 'Previous images restored; database was not rolled back.\n'
    ;;
  *) fail "Unknown command: $COMMAND" ;;
esac
