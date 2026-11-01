# Contributing to GalaxyQuest

## Before opening a pull request

1. Check the [production-readiness roadmap](ROADMAP.md) and relevant
   [technical documentation](docs/INDEX.md) before starting broad changes.
2. Keep changes focused. Add or update tests for behavior changes and explain
   migration or operational effects in the pull request.
3. Never commit credentials, session material, user data, generated runtime
   output, or local environment files.

## Branches and pull requests

- Use a descriptive branch name such as `feature/<topic>`, `fix/<topic>`, or
  `docs/<topic>`.
- Target `develop` for normal changes. Target `main` only for an explicitly
  coordinated release or urgent fix.
- Open a pull request with a concise summary, linked issue or roadmap finding
  when applicable, test results, and screenshots for user-visible changes.
- Keep the pull request reviewable and address CI failures before requesting
  final review.

Branch protection and required reviewer policies are not yet configured;
these instructions do not imply that GitHub currently enforces them.

## Quality checks

Run the relevant checks from the repository root before submitting:

```powershell
npm ci
npm run lint:js
npm run check:repository-artifacts
npm run check:release-metadata
npm run check:docker-context
npm run test:unit:js -- --reporter=dot
npm run vite:build
npm run check:bundle-budget
actionlint
```

The repository artifact check inspects the Git index (stage changes before
running it). Generated texture-cache PNGs and lockfiles must remain untracked.
Git blobs above 100 MiB are rejected; keep large generated files outside Git
or use an agreed asset-storage/Git LFS workflow. This check does not scan
earlier commits, so an oversized file must never be committed even temporarily.

For Python changes:

```powershell
ruff check tts_service/ scripts/
ruff format --check tts_service/ scripts/
```

Run the TTS service tests from `tts_service/` with `pytest tests/ -v`.
Python type checks are defined in
[`.github/workflows/python-quality.yml`](.github/workflows/python-quality.yml).

For PHP changes, run `php -l` on changed files and `composer analyse` after
`composer install`. PHPStan checks `api/`, `lib/`, `config/` and `src/` at level 5
with PHP 8.2 semantics. The counted, path-specific `phpstan-baseline.neon`
records existing findings, not a clean bill of health. New findings and stale
baseline entries fail CI; remove resolved entries instead of regenerating the
whole baseline to hide regressions. `.phpstan-cache/` is local and ignored.

Run `composer lint:php` for the PSR-12 style gate covering `api/`, `lib/` and
`config/`, configured in [`phpcs.xml`](phpcs.xml). PHP_CodeSniffer 4 is locked
through Composer; PHP needs `tokenizer`, `simplexml` and `xmlwriter`. The initial
[`phpcs-baseline.json`](phpcs-baseline.json) records 6,847 violations
(6,213 errors, 634 warnings), grouped into 4,999 fingerprints across 152 files.
This is an existing-debt inventory, not a claim that the backend conforms to
PSR-12.

Both new violations and stale exceptions fail the gate. Each fingerprint binds
the relative path, sniff, severity, message, column and SHA256 of the offending
source line, with an exact occurrence count. Source text is not copied into the
baseline. Line-number shifts and CRLF/LF representation do not change the line
hash; file renames or edits to a violating line require resolving the violations
or explicitly reviewing changed exceptions. PHPCS suppression annotations are
ignored, so inline `phpcs:ignore` cannot bypass this gate. Tool errors, malformed
reports and invalid baseline data also fail rather than being suppressed.

Use `php vendor/bin/phpcs --standard=phpcs.xml -s --ignore-annotations` to locate
the underlying violations (a nonzero exit is expected for existing debt). Fix
new violations and delete resolved fingerprints or lower their counts in the
baseline. `php scripts/check_phpcs.php --write-baseline` is available for initial
capture or an explicitly approved baseline update only: review its full diff,
and never regenerate routinely to hide a regression. The checker itself is a
CLI utility outside the application style scope; it intentionally combines
importable test functions with a guarded entrypoint.

After installing Composer
dependencies, run the database-independent unit gate with PHP's `pdo_sqlite`
and `gd` extensions:

```powershell
php vendor/bin/phpunit --testsuite "GalaxyQuest Unit" --no-coverage --do-not-cache-result --fail-on-warning --fail-on-risky --fail-on-phpunit-deprecation
```

CI runs this unit suite independently of MySQL initialization. The additional
MySQL job runs `vendor/bin/phpunit --no-coverage --fail-on-warning --fail-on-risky --fail-on-phpunit-deprecation`
and Composer's locked dependency audit. Both PHPUnit jobs reject warnings,
risky tests and PHPUnit deprecations. Name test methods with the `test` prefix
and use `PHPUnit\Framework\Attributes\DataProvider` for data providers; do not
introduce deprecated doc-comment test metadata.

The MySQL job also runs the
[MigrationRunner regression gate](docs/technical/DATABASE_MIGRATIONS.md#mysql-regression-gate)
before schema initialization. It uses an explicitly configured test server and
creates/drops a separate randomly named database per test; never point it at a
production server. It validates the complete canonical manifest on a fresh
schema, including tracking checksums and a no-op second run. CI then installs
`sql/schema.sql` in its application test database and applies only manifest
entries using `php scripts/migrate.php up --env=TEST`; do not use an alphabetical
`sql/migrate_*.sql` loop, which also includes down, maintenance and example files.

The Playwright smoke-test job uses [`docker-compose.ci.yml`](docker-compose.ci.yml)
to run only web and database. The override requires Docker Compose 2.24.4+
(`!override` / `!reset` support). Fixed base-service container names are removed;
`COMPOSE_PROJECT_NAME=gq-ci-<run-id>-<attempt>` isolates CI volumes and networks.
The database has no published host port and imports only `sql/schema.sql`;
legacy individual init migrations are removed from the merged CI mount list.
Canonical `scripts/migrate.php up --env=TEST` runs inside the built web image
before user seeding, followed by a second up run and status output.
The read-only `scripts/migrate.php verify --env=TEST` gate then checks complete
manifest membership and applied SQL checksums under the migration advisory lock;
pending, changed or foreign migration history blocks the smoke job.
The MySQL healthcheck uses TCP explicitly: the temporary socket-only init server
must not announce readiness before the final server accepts web connections.

The web service has no checkout bind mount: E2E therefore exercises the image
instead of masking missing contents with host files. The Docker build publishes
`dist/index.html` and hashed `dist/assets` into the Apache document root; merely
keeping a build under `dist` would still serve the uncompiled source entry.
It stays loopback-bound on port 8081, uses explicit `APP_ENV=dev` for
synthetic gameplay tests, disables TTS, NPC LLM, ComfyUI, ThemisDB and Xdebug,
and waits for its own HTTP healthcheck plus healthy MySQL. This HTTP probe is
liveness only. Separate DB/migration readiness is required after canonical
migrations and before user seeding; it is not worker readiness.

Failure logs are captured before unconditional `docker compose down --volumes
--remove-orphans`, scoped to that run's project. Never use this teardown command
on a production or shared developer project. Concurrent local executions still
need distinct web host ports; the override's fixed 8081 suits isolated hosted
CI runners, not concurrent stacks on one host.

CI seeds with `scripts/ensure_default_e2e_user.php --skip-bootstrap`: the existing
schema/faction/diplomacy preflight and per-user start region are preserved, while
the forced full 25,000-system bootstrap is skipped. Without that flag, the
helper retains its previous full-bootstrap behavior. This is a synthetic smoke
dataset, not evidence of large-galaxy performance or production initialization.

CI runs [`ci-stack.test.js`](tests/js/ci-stack.test.js) with
`GQ_DOCKER_CONTEXT_TESTS=1` to inspect actual Compose JSON for mount isolation,
canonical initialization, disabled flags and project-scoped volumes.
Workflow tests check migration/seed order and cleanup. These configuration
checks passed locally. Actual local acceptance also built the image, verified
Apache loads hashed JS, created a fresh MySQL volume, applied all 64 canonical
migrations (second up: no pending), seeded 50 start-region systems and ran
Chromium smoke: two passed, one runtime-dependent test skipped.
The main view flow used its existing system fallback and logged missing
WebGPU/runtime dependencies; this is not strict native-renderer certification.
The project containers, network, volume and tagged test image were removed.
Remote CI and production/GPU readiness remain unproven.

If a local tool, database, Docker daemon, or platform-specific capability is
unavailable, state that explicitly instead of reporting the check as passed.

## Application health probes

| Route | Success | Failure | Dependencies |
|---|---|---|---|
| `/health/live` | 200 `{"status":"alive"}` | PHP/HTTP cannot serve the probe | PHP and packaged probe code only |
| `/health/ready` | 200 `{"status":"ready"}` | 503 `{"status":"unavailable"}` | DB credentials, `SELECT 1`, tracking table and every entry of the image's canonical migration manifest |

Both routes are intentionally public, anonymous and session-free. GET and HEAD
are supported; HEAD has the same status/headers but no body. Other methods
return 405 with `Allow: GET, HEAD`; unknown probe paths (including direct
`/health.php`) return JSON 404. Responses use `Cache-Control: no-store`,
JSON content type and `nosniff`; unavailable readiness includes `Retry-After: 5`.
Query parameters cannot change the selected probe. Neither route runs migration
bootstrap, DDL, seeding, workers, AI requests or gameplay initialization.

[`HealthProbe.php`](lib/HealthProbe.php) uses the existing MigrationRunner's
read-only status snapshot. A fresh DB without tracking is unavailable and stays
unchanged. Readiness requires applied manifest entries, **not** checksum
verification, full schema reconstruction, gameplay correctness or worker
heartbeats. Run the migration integrity gates separately. Additional tracking
entries outside the manifest do not block this snapshot.
For deployment integrity, use `php scripts/migrate.php verify` separately:
unlike the public readiness snapshot it rejects foreign history and checksum
drift and requires complete tracking without bootstrapping it. See
[Database Migrations](docs/technical/DATABASE_MIGRATIONS.md) for operator recovery
instructions and the limits of migration-record verification.

HTTP readiness runs [`check_health.php`](scripts/check_health.php) in a supervised
PHP CLI child with a three-second execution deadline. The child uses a separate
short-lived PDO connection with two-second connection/mysqlnd read timeouts;
gameplay `get_db()` behavior is unchanged. Socket timeouts alone did not bound
Docker DNS resolution in a real outage test, so deadline expiry terminates and
reaps that child and returns 503. Both diagnostic pipes are drained in bounded
chunks; output cannot block the watchdog or reach the public response.
Process-launch failures, unsuccessful checks and deadlines are logged without DB credentials or
internal exception text. The standalone CLI helper additionally logs categorized
DB/migration failures and exits 0 (ready) or 1 (unavailable).
The HTTP path requires the PHP CLI at `PHP_BINDIR` and enabled `proc_open`,
`proc_get_status` and `proc_terminate`; removing these capabilities requires a
replacement bounded probe mechanism, not ignoring readiness.

The image `HEALTHCHECK` and CI Compose use **liveness**, never DB readiness:
a DB outage should not trigger repeated web restarts. CI checks the real HTTP
contract before migrations (unavailable) and after migrations (ready), with
five-second client deadlines. Run those opt-in tests against an owned test stack:

```powershell
$env:GQ_HEALTH_HTTP_TESTS = '1'
$env:GQ_HEALTH_EXPECT_READY = '1' # '0' for unmigrated or unavailable DB
$env:GQ_BASE_URL = 'http://localhost:8081'
npx vitest run tests\js\health-http.test.js --testTimeout=10000
```

Local validation: 22 PHP tests / 88 assertions, nine real HTTP tests in fresh,
migrated and DB-outage states, unchanged PHPCS/PHPStan gates and image build.
The outage returned 503 in approximately 3.1 seconds while liveness remained
200; fresh probes created no tracking table. These are local observations,
not remote CI or production SLO evidence. Worker heartbeat/readiness, a
production reverse-proxy probe allowlist/rate limit, monitoring/alerts and the
production image remain roadmap work. Avoid high-frequency public readiness
polling: each request uses an isolated process and DB connection.

## Release metadata and preparation

[`VERSION.txt`](VERSION.txt) is authoritative for release metadata.
The tooling version fields in [`package.json`](package.json) and
[`package-lock.json`](package-lock.json) must mirror it; CI runs
`npm run check:release-metadata` to reject divergence. The existing `1.0.0`
value is historical metadata, not proof of production readiness.
Runtime update helpers still have independent overrides/fallbacks; unifying
those and securing the update subsystem remain roadmap work.

Prepare a release in a reviewed change, not by running `npm version` to create
an automatic commit/tag:

1. Select a SemVer version in accordance with the roadmap and edit
   `VERSION.txt`. Do not include `v` or use leading-zero numeric components.
   Pre-release identifiers such as `0.9.0-alpha.1` are supported.
2. Mirror that value without creating a tag:

   ```powershell
   $version = (Get-Content -Raw VERSION.txt).Trim()
   npm version $version --no-git-tag-version --allow-same-version
   ```

3. Keep exactly one `[Unreleased]` section in [`CHANGELOG.md`](CHANGELOG.md).
   Move the reviewed release changes into one dated heading, for example
   `## [0.9.0-alpha.1] - 2026-11-01`, with actual change bullets.
4. Run `npm run check:release-metadata -- --tag v0.9.0-alpha.1` using the selected
   version, plus all release quality/security checks. Tag format must exactly
   match `v` plus `VERSION.txt`. Build metadata (`+...`) is accepted for local
   development metadata but rejected for release tags to avoid ambiguous
   version precedence.
5. Only after review and the required release approvals, create/push the tag
   through the agreed maintainer process.

[`release-metadata.yml`](.github/workflows/release-metadata.yml) runs for `v*`
tags or manual dispatch with an existing tag. It verifies the checked-out
commit matches the tag, validates version/changelog metadata, and uploads only
the selected release notes as a 30-day artifact for operator review.
It has read-only repository permissions and does **not** create a GitHub Release,
build/publish a production image or deploy. Manual dispatch checks the script
from the selected tag, so the tag must include this tooling.

Green metadata preparation is not a release approval. Blocking full CI/security
checks on the tagged commit, reproducible production packaging, staging,
rollback/restore evidence and a complete release-publishing workflow remain
mandatory and not yet proven. Existing main-branch Docker publication is a
separate workflow and is not certified by this metadata gate.

### Existing main-branch image publication

The main CI Docker job now requires `lint-php`, `lint-js`, `phpunit-unit`,
`phpunit`, `vitest` and `playwright-smoke` to succeed before it runs.
It builds and locally loads one `galaxyquest:publish-candidate` image with
publishing disabled. Trivy scans that candidate for HIGH/CRITICAL OS/library
vulnerabilities and secrets, including unfixed vulnerabilities; scan failures
block registry login and push. This is intentionally stricter than the
separate historical security workflow's fixable-only image scan.

After the scan, the job verifies the local image ID still matches the build
output, tags that exact ID and pushes the metadata-generated tags without
rebuilding. Missing image IDs/tags, identity mismatch and Docker tag/push
failures stop the job. Registry pushes for multiple tags are not atomic: a
later failure can leave earlier tags published and requires operator review.

The workflow is configured and tested locally (including the actual Bash
commands with isolated Docker fixtures), not yet proven by a live GHCR run.
It does not make the current development Dockerfile production-ready and
does not replace separate repository-history/CodeQL scans, SBOM, signatures,
staging approval, restore rehearsal or tagged release gates. No image was
published during this remediation.

### Docker build context

The root [`.dockerignore`](.dockerignore) excludes local environment files
(including nested `.env.*` and templates), private-key/certificate files,
host dependency trees, editor/language caches, test reports, known cookie/header
and test-user SQL dumps, and mutable runtime audio/texture caches. Local `dist/`
is excluded because the Dockerfile builds it inside the image. This does not
delete host files or change runtime mounts.

Runtime source/configuration, migration SQL, Apache/PHP configuration, music,
ordinary assets, generated SVG fallbacks, deployment GLB models and legacy
JavaScript gzip bundles remain available to `COPY .`. Exclusions target named
runtime/development outputs, not the entire `generated/` tree. Environment
values must be supplied at runtime or through a reviewed build configuration;
local `.env` values no longer implicitly influence Vite inside Docker.

`npm run check:docker-context` requires Docker and builds a tiny **synthetic**
`FROM scratch` context using the actual root ignore policy, with no image pull
or application/secret contents. It verifies 56 excluded paths and 26 retained
inputs (including exact fixture bytes), then removes only its own temporary
image, container and directories. CI additionally runs real-Docker negative
regressions to reject weakened secret exclusions or missing application code:

```powershell
$env:GQ_DOCKER_CONTEXT_TESTS = '1'
npx vitest run tests/js/docker-context.test.js
```

These three integration tests are explicitly skipped in ordinary Vitest runs
unless opted in. The CI lint job opts in and fails if Docker/build/inspection
is unavailable. This is a build-context contract, not a complete application
image build, exhaustive secret discovery, provenance or production-readiness
certificate. Unrecognized filenames and secrets embedded in retained source
still need repository/image scans. Runtime volumes can independently expose
host material and are outside this context policy.

## Security-sensitive changes

Do not disclose suspected vulnerabilities in a public pull request. Follow
[`SECURITY.md`](SECURITY.md) for private reporting.
