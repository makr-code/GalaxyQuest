# GalaxyQuest: GitHub -> Plesk deployment

## Status and scope

This is the supported deployment preparation, not evidence that the remote host
has been installed. Remote installation was deferred until its SSH host key is
independently verified. No local or remote player database is copied.

| Environment | Domain | Compose project | Web / Grafana loopback ports |
|---|---|---|---|
| Staging | staging-galaxyquest.themisdb.org | galaxyquest-staging | 8082 / 3001 |
| Production | galaxyquest.themisdb.org | galaxyquest-production | 8081 / 3000 |

Both use production application settings, separate credentials, databases,
sessions, generated assets, monitoring and GPU volumes. Do not copy production
player data into staging. All images are pinned by digest.

Architecture:

```text
local development -> reviewed GitHub push -> CI quality gates
  -> build web + TTS -> scan exact candidates -> fresh-database acceptance
  -> GHCR digests -> staging deployment -> public HTTPS smoke
  -> [main only: production Environment approval] -> production deployment

Plesk nginx + TLS -> 127.0.0.1:8081/8082 -> Apache/PHP -> MySQL + TTS
                                                  -> ComfyUI + TRELLIS2
Prometheus -> exporters + internal app metrics + readiness -> Alertmanager
Grafana -> Prometheus (operator access only)
```

The local developer Compose file is not merged into production. There are no
source-code bind mounts or production builds on the Plesk host. Plesk manages
domains/TLS; Compose, not individual Plesk container edits, owns service lifecycle.
Do not configure an independent Plesk Git auto-deployment or Watchtower.

## 1. Host prerequisites

An administrator must first verify:

- Supported 64-bit Linux Plesk host, x86-64 for the current GPU wheel set.
- Docker Engine, Compose v2 with multiple `--env-file` support, `bash`, `jq`,
  `flock`, `gzip`, `sha256sum`, `curl` and GNU coreutils.
- Deployment account allowed to use Docker. Docker group membership is effectively
  root access; use a dedicated account, not ordinary shared-hosting access.
- Server NVIDIA GPU, compatible driver and NVIDIA Container Toolkit. Verify
  `nvidia-smi` and a CUDA container. A hostname is not proof of available hardware.
- Capacity for Plesk plus two MySQL/TTS/app/monitoring stacks, GPU models and a full
  temporary database restore. The restore checker uses RAM-backed storage:
  sufficient additional RAM is required for the uncompressed database.
- Sufficient VRAM for the accepted workflows. Staging and production share the
  physical GPU; do not assume two inference workloads fit simultaneously.
- DNS and valid certificates for both domains, SSH access restricted appropriately.
  Do not expose Docker API ports 2375/2376, MySQL, ComfyUI, TTS or exporters.
- Mailbox `galaxyquest@themisdb.org`, STARTTLS submission on `themisdb.org:587`,
  valid certificate, SMTP authentication, SPF/DKIM/DMARC and actual receipt tested.

Do not install Docker over an existing host installation without an administrator
review. Plesk's paid Remote Docker feature is unnecessary when Docker runs on the
Plesk server itself.

Verify the host key independently through the provider/Plesk console before
adding it to `known_hosts`; do not trust a network `ssh-keyscan` result by itself.
Never disable strict SSH host-key checking.

## 2. GPU image and models

The combined service uses [Dockerfile.production](../../docker/comfyui/Dockerfile.production)
and the committed `tools/comfyui-trellis2` submodule revision. Local uncommitted
submodule patches are deliberately not published by GitHub.

The separate legacy TRELLIS Gradio container is not deployed: its old image did
not install the TRELLIS pipeline. ComfyUI includes TRELLIS2 as custom nodes.

Configure a dedicated disposable Linux x64 NVIDIA GitHub runner with label
`galaxyquest-gpu`, then protect Environment `gpu-build` and restrict it to trusted
branches. Manually run [gpu-image.yml](../../.github/workflows/gpu-image.yml).
It builds dependencies/wheels into the image, scans before registry login,
requires CUDA and the actual TRELLIS2 node catalogue, and publishes only that
accepted image ID. No dependency installation occurs during service startup.

Use the resulting `gpu-release.env` digest as `GPU_IMAGE`. Node loading alone is
not proof of model inference: before release, run a representative API workflow
through image -> model load -> generation -> GLB export, verify the exported GLB,
record model/workflow versions and VRAM use. Provision the licensed/gated model
files into the environment's `gpu-models` volume, including any required DINOv3
access. Do not bake Hugging Face tokens or model access credentials into images.
Workflow-specific background workers remain subject to their own acceptance;
deploying ComfyUI does not automatically start a game generation queue worker.

## 3. Initial server configuration

Run these examples on the Linux server, not Windows PowerShell. Use separate
roots `/srv/galaxyquest/staging` and `/srv/galaxyquest/production` or an equivalent
account-owned path ending in `/galaxyquest/<environment>`.

Place the reviewed contents of [deploy/](../../deploy/) in a versioned directory,
for example `/srv/galaxyquest/production/releases/initial`. Keep this directory
immutable after activation. Repeat for staging.

```bash
root=/srv/galaxyquest/production
bundle="$root/releases/initial"
umask 077
mkdir -p "$root/backups"
chmod 700 "$root" "$root/backups"
cp "$bundle/environment.example" "$root/.env"
for name in runtime.env database.env tts.env grafana.env mysql-exporter.cnf alertmanager.yml; do
  cp "$bundle/$name.example" "$root/$name"
done
chmod 600 "$root/.env" "$root/"*.env
chmod 640 "$root/mysql-exporter.cnf" "$root/alertmanager.yml"
id -g
```

Edit these files privately on the host. Do not paste credentials into chat, GitHub
variables, command arguments, screenshots or commits.

- `.env`: set `DEPLOY_GID` to the deployment account's group; pin every image as
  `repository@sha256:<64 hexadecimal characters>`. Obtain infrastructure digests
  from a reviewed version using `docker buildx imagetools inspect IMAGE:VERSION`.
  The web/TTS digests come from CI's `container-release` artifact; GPU from its
  separate accepted artifact.
- Match `DB_USER`/`DB_PASS` in `runtime.env` with `MYSQL_USER`/`MYSQL_PASSWORD` in
  `database.env`. Use separate random passwords of at least 32 characters for the
  application and root account.
- Match the random `TTS_SECRET` in `runtime.env` and `tts.env`.
- `REGISTRATION_PUBLIC_URL`, `TTS_CORS_ORIGINS`, `PUBLIC_URL` must match this
  environment's HTTPS domain.
- Set SMTP mailbox credentials and the actual operator recipient in Alertmanager.
  Keep Grafana on loopback; use an SSH tunnel, or a separately protected Plesk
  domain with a matching `GF_SERVER_ROOT_URL`.
- Set a separate random 64-character lowercase hex exporter password in
  `mysql-exporter.cnf` (for example generated with `openssl rand -hex 32`).
  Its process and Alertmanager
  get the supplementary `DEPLOY_GID`, allowing read-only group access to these
  two mode-640 files without running them as root.
- Staging: project `galaxyquest-staging`, web port 8082, Grafana port 3001.
  Production: project `galaxyquest-production`, ports 8081 and 3000.
- Optional non-GPU acceptance only: clear `COMPOSE_PROFILES` and explicitly set
  `COMFYUI_ENABLED=0`. Do not claim GPU readiness in this mode.

Use separate credentials per environment. Infrastructure/GPU images are operator
pinned; routine app deployments update only web/TTS. Database major-version and
GPU/model upgrades are separate maintenance operations.

```bash
bash "$bundle/stack.sh" "$root" preflight
bash "$bundle/stack.sh" "$root" bootstrap --approve-empty-database
```

Bootstrap rejects a nonempty database, imports the base schema from the pinned
image, makes a restore-tested recovery point, applies only the canonical
migration runner, verifies all checksums, and seeds the new world. Full galaxy
warmup can take time. It does not import developer accounts or a developer DB.
Do not rerun `setup.php` without `--skip-migrations` as a release upgrade path.

**Bootstrap recovery:** a failure after base import leaves a nonempty database.
Do not bypass the guard or delete volumes. Inspect the error, keep the backup,
then continue the reviewed canonical migration/bootstrap steps manually with the
same pinned image. Adopt historical migrations only via existing verified
contracts and explicit approval; do not edit migration sources or checksums.

Bootstrap creates the dedicated metrics DB user from
[metrics-user.sql.example](../../deploy/metrics-user.sql.example), taking its
password privately from `mysql-exporter.cnf` through mysql stdin. The exporter
is not a root user. On an existing installation, provisioning or rotating this
user is an explicit administrator operation; app deployments do not reset it.

For the first administrator, the existing
[administrator CLI](../../scripts/ensure_default_admin.php) requires a unique
`DEFAULT_ADMIN_PASSWORD` of at least 16 characters, delivered as a temporary
environment variable (`docker compose run ... -e DEFAULT_ADMIN_PASSWORD web php
scripts/ensure_default_admin.php`), never a CLI password argument. Read it
privately using `read -rs` on the server and unset it immediately afterwards.
This helper resets the named administrator if rerun, so use it only deliberately;
review its local placeholder email and account/RBAC settings, replace contact
details as appropriate, log in over HTTPS and enable 2FA. Do not enable developer
auth helpers or seed shared default passwords.

## 4. Plesk reverse proxy

In each Plesk domain, install its certificate, enable HTTPS redirection and
disable Apache proxy mode before adding the reviewed
[nginx directives](../../deploy/plesk-nginx.conf.example) to Additional nginx
directives. Use 8081 for production, 8082 for staging. Validate the generated
nginx configuration with Plesk; existing custom `location /` blocks must be
reconciled rather than duplicated.

All paths must reach the container, not Plesk's old document root. Disable
Plesk's direct static-file serving for the application domain if it bypasses
this proxy. Forward the original Host and HTTPS scheme; SSE buffering is disabled.
Metrics endpoints remain reachable internally but return 403 publicly.

```bash
node scripts/check_deployment_http.mjs https://staging-galaxyquest.themisdb.org
node scripts/check_deployment_http.mjs https://galaxyquest.themisdb.org
```

Run this Node check from a checkout or CI runner. It requires real HTTPS,
liveness/readiness JSON, built Vite assets, security headers and denied
operational endpoints. Also accept registration mail, login/cookies, TTS,
SSE, representative game actions and actual GPU inference before opening access.
There is a short maintenance interval during updates; this is not blue/green
zero-downtime deployment.

## 5. GitHub configuration and release process

Create GitHub Environments `staging`, `production` and `gpu-build`.
**Production MUST require designated reviewers**, prevent self-review where
available, and allow deployments only from `main`. Staging accepts `develop`
and `main`. Use a repository plan which supports these protections.
Protect branch merges and require the existing quality gates. Never bypass
failed CI to obtain a production image.

Set these Environment variables separately:

| Variable | Value |
|---|---|
| `PLESK_HOST` | SSH host |
| `PLESK_USER` | dedicated deployment account |
| `PLESK_PORT` | SSH port, default 22 |
| `PLESK_DEPLOY_ROOT` | absolute account-owned root ending in `/galaxyquest/staging` or `/galaxyquest/production` |
| `PUBLIC_URL` | exact environment URL from the table above |

Environment secrets:

- `PLESK_SSH_KEY`: dedicated unencrypted automation key; restrict its server-side
  account and filesystem access appropriately.
- `PLESK_KNOWN_HOSTS`: independently verified OpenSSH host-key entry, including
  `[hostname]:port` for a nonstandard port.

For private GHCR packages, authenticate the server once using a scoped read-only
package credential via `docker login --password-stdin`. The workflow's
`GITHUB_TOKEN` publishes packages but is never copied to the server.

Only after both initial stacks and protections are accepted, set repository
variable `PLESK_DEPLOY_ENABLED=true`. It intentionally defaults to off while host
keys, server secrets or initial databases are missing.

The main [CI workflow](../../.github/workflows/ci.yml):

1. Requires all existing lint, PHP, JavaScript and browser gates.
2. Builds web and TTS candidates, scans both, tests the exact candidates against
   an empty isolated database, then publishes them without rebuilding.
3. Preserves commit + digest references in `container-release`.
4. On `develop`, deploys automatically to staging.
5. On `main`, deploys the **same main candidate digests** to staging first;
   production then waits for Environment approval.

[deploy-plesk.yml](../../.github/workflows/deploy-plesk.yml) transfers a bundle at
the triggering commit, uses strict SSH trust, serializes deployment per
environment, runs the server lifecycle, and requires public HTTPS acceptance.
The deployment evidence artifact identifies the commit and both app digests.
No live database writes were performed while implementing these files.

## 6. Backup, migration and failure policy

[stack.sh](../../deploy/stack.sh) holds a per-environment `flock` across all
deployment, backup and rollback operations. App writers are stopped before the
database/asset recovery point; do not add independent writers without extending
this lifecycle. External cron/projector/generation workers, if enabled later,
must also be stopped by the operator before maintenance.

Every app deployment:

1. Validates host, file permissions, placeholders, matching secrets and image pins.
2. Pulls candidates before stopping the application.
3. Stops writers, streams an InnoDB-consistent SQL dump and generated assets into
   private backup files and writes SHA-256 checksums.
4. Restores SQL into a separate temporary MySQL container, checks table counts and
   SQL `CHECK TABLE` results, then removes only that restore container.
5. Runs migration dry-run, canonical Up and deployment verification.
6. Starts the stack and checks application readiness and GPU node availability.
7. Records current/previous app digests and bundle directories only after success.

MySQL DDL is not transactionally reversible. A migration failure deliberately
leaves writers stopped; there is no success-shaped fallback or automatic
destructive DB rollback. Preserve logs, backup and `candidate.env`; investigate
before resuming. `up --dry-run` previews statements; it is not proof they will
execute successfully on every historical schema.

For a compatible schema, an operator may restore previous images and their
previous Compose bundle:

```bash
bash "$(cat "$root/current-bundle")/stack.sh" "$root" rollback --approve-compatible-schema
```

The old image's strict migration verification must pass before activation. If
the newer manifest introduced migrations, this may deliberately reject rollback;
use a reviewed forward fix or a coordinated DB recovery, not checksum editing.

For database recovery: stop all writers, verify the selected `.sql.gz.sha256`
and `.assets.tar.gz.sha256`, restore the dump into an isolated recovery MySQL
instance, verify data and migrations with the matching recorded app release,
and rehearse switching to that recovered state before touching the live DB.
Restore generated assets from the corresponding tar archive with the correct
app UID/GID. Restoring SQL over newer tables is not a clean schema rollback.
Production replacement/restoration remains an explicit administrator operation;
the release script intentionally does not issue `DROP DATABASE` or `down -v`.

Backups stored beside Docker are **not disaster recovery**. Copy encrypted backups
and deployment configuration to independent storage, protect credentials in the
operator secret store, define retention and test loss of the whole server.
TTS/model caches can be downloaded again; preserve required licensed model
versions separately. GPU outputs not yet imported into the game are separate
working data and must be retained/exported if needed.

Optional [backup service](../../deploy/backup.service.example) and
[timer](../../deploy/backup.timer.example) templates invoke the active bundle.
Install them only after replacing the user/root values and a successful manual
backup. Each backup includes a short maintenance interval and full restore test;
failure leaves writers stopped. Monitor systemd failures and backup age, and
test the external alert recipient. No automatic backup pruning is installed.

## 7. Monitoring and local verification

Production monitoring is in [deploy/monitoring/](../../deploy/monitoring/).
Prometheus uses service DNS, scrapes the app's correct `metrics_path`, probes
database/schema readiness through Blackbox, and forwards alerts to Alertmanager.
Grafana provisions the operations dashboard automatically. The production stack
does not mount the Docker socket or start privileged cAdvisor.

Query `up`, `mysql_up`, `probe_success{job="readiness"}` and Alertmanager delivery
errors after installation. A green container health flag alone is insufficient.

Local regression commands:

```powershell
$env:GQ_DOCKER_CONTEXT_TESTS = '1'
npx vitest run tests/js/production-deployment.test.js tests/js/ci-stack.test.js tests/js/image-publication-workflow.test.js
docker compose exec -T -e XDEBUG_MODE=off web php vendor/bin/phpunit --do-not-cache-result tests/Unit/RegistrationSmtpTest.php
docker build --tag galaxyquest:deployment-validation .
node scripts/check_production_stack.mjs
node scripts/check_smtp_delivery.mjs
```

The isolated acceptance starts only a unique disposable project, checks 503
before schema/migrations and 200 afterwards, repeats migrations, seeds faction
homeworlds, checks built assets/extensions, and removes only its own volumes.
It does not reset the developer database, publish images or contact Plesk.
The separate SMTP check uses an isolated Mailpit fixture and temporary
certificate, exercises STARTTLS and implicit TLS, and rejects an untrusted
certificate. It does not send mail through the actual Plesk mailbox.

Remaining external gates: trusted SSH key, Linux/GPU capacity, clean GPU image
build/inference, SMTP receipt, GitHub Environment protections/secrets, public
Plesk routing, encrypted off-host backup/restore, and a complete successful
GitHub deployment run. Do not label these as verified by local contract tests.

Official reference: [Plesk Docker administration](https://docs.plesk.com/en-US/obsidian/administrator-guide/plesk-administration/using-docker.75823/).
