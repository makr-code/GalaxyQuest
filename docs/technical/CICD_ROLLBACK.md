# CI/CD Pipeline — Rollback & Failure Runbook

This document describes how to investigate CI/CD failures and roll back a
broken deployment to the last known-good state.

---

## Pipeline Overview

The main CI/CD workflow (`.github/workflows/ci.yml`) runs on every push to
`main` and on every pull request targeting `main`.

| Job | What it does | Blocks deploy? |
|-----|-------------|---------------|
| `phpunit` | PHPUnit unit tests (PHP 8.2 + MySQL 8.4) | ✅ Yes |
| `vitest` | Vitest JavaScript unit tests | ✅ Yes |
| `playwright-smoke` | Playwright end-to-end smoke (full stack) | ⚠️ No¹ |
| `docker-build` | Build & push Docker image to GHCR | — (runs after phpunit + vitest pass) |

> ¹ The E2E smoke job is advisory. A failure surfaces in the GitHub status
> check but does not block the Docker image push. Treat persistent E2E
> failures as P1 bugs.

---

## Identifying a Failure

1. Open the **Actions** tab of the repository on GitHub.
2. Click the failing workflow run.
3. Expand the failed job and step to read the error log.
4. Common failure causes and fixes:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| PHPUnit: `PDOException` / `Access denied` | DB service not ready | Re-run job; check MySQL healthcheck in workflow |
| PHPUnit: `Class not found` | Missing `composer install` or autoload issue | Run `composer install` locally; verify `composer.lock` is committed |
| Vitest: `Cannot find module` | Missing `npm ci` or changed import paths | Run `npm ci` locally; check import paths |
| Playwright: `net::ERR_CONNECTION_REFUSED` | Docker stack did not start in time | Increase `timeout-minutes` on the startup step; check `docker compose logs` in the artifact |
| Docker push: `unauthorized` | Missing/expired `GITHUB_TOKEN` | Verify `permissions: packages: write` in the job |

---

## Rollback Procedure

### Option A — Revert via GitHub UI (fastest)

1. Open **Commits** on `main`.
2. Find the last green commit (CI badge = ✅).
3. Click the commit SHA → **Revert** button (top-right of the diff view).
4. Merge the generated revert PR; CI re-runs automatically.

### Option B — Revert via Git CLI

```bash
# Identify the last good commit
git log --oneline main | head -10

# Create a revert commit for a specific commit or the last one
git revert --no-edit HEAD~1           # revert the last commit
# — or —
git revert <BAD_SHA>                   # revert a specific commit
git push origin main
```

> **Never** force-push `main`. Use `git revert` to create an explicit
> rollback commit so the history remains auditable.

### Option C — Re-deploy last good Docker image

If `main` is temporarily broken and you need to restore production quickly:

```bash
# List published images
docker pull ghcr.io/makr-code/galaxyquest:<GOOD_SHA_TAG>

# Update the deployment (example with docker compose)
IMAGE_TAG=<GOOD_SHA_TAG> docker compose up -d web
```

Each image is tagged with the Git commit SHA (`sha-<7-char>`) so you can
pinpoint exactly which code is running.

---

## Database Migration Rollback

GalaxyQuest uses forward-only SQL migrations.  There is currently no
automated down-migration script.  If a migration causes a production
incident:

1. **Identify** the offending migration file (e.g. `sql/migrate_foo_v2.sql`).
2. **Write** a compensating migration (e.g. `sql/migrate_foo_v2_rollback.sql`)
   that reverses the schema change.
3. **Apply** it via the web container:
   ```bash
   docker compose exec -T web \
     mysql -h db -u galaxyquest_user -pgalaxquest_dev galaxyquest \
     < sql/migrate_foo_v2_rollback.sql
   ```
4. **Deploy** a revert of the application code (see Option A/B above).
5. **Document** the incident in the PR / issue tracker.

---

## Artifact Retention

| Artifact | Storage | Retention |
|----------|---------|-----------|
| Docker images (GHCR) | `ghcr.io/makr-code/galaxyquest` | Indefinite (tagged) |
| Playwright failure reports | GitHub Actions artifacts | 7 days |

Old Docker images can be cleaned up via the **Packages** settings of the
GitHub organisation/account.

---

## Contacts

Escalate unresolved CI failures to the current sprint lead via the project
issue tracker.
