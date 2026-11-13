# GalaxyQuest Update Helpers

## Overview

The existing helpers can check GitHub releases, download an asset and display update status. They are not a production auto-updater: installation, backup, rollback and notifications are not implemented. Both install and rollback, including dry runs, fail explicitly instead of reporting success.

The installed version is read and SemVer-validated from the repository-root `VERSION.txt`. Update commands do not accept an `APP_VERSION` override or substitute a fallback version. The `version` field in `config/update-config.json` is legacy template metadata and is not authoritative at runtime.

## Features

- **Release checking** – The CLI checks GitHub's latest stable release by default and can search paginated releases for the highest valid SemVer prerelease with `--prerelease`.
- **Downloads** – A single archive is downloadable only with its matching `.sha256` sidecar and a valid checksum line naming that archive. Missing, malformed, mismatched, or unverifiable checksums block the download. SHA-256 comparison detects artifact corruption but does not authenticate the publisher or replace a signature.
- **Status** – CLI status/history and a legacy admin-only status handler exist; audit writes are best effort.
- **Not available** – Automatic installation, rollback, notifications and cryptographic release-signature verification.

## Quick Start

### Check for Updates

```bash
# Check for stable updates
php bin/update.php check

```

`check --prerelease` searches the GitHub releases list (up to 1,000 entries) because `/releases/latest` does not return prereleases. Drafts and invalid SemVer tags are ignored; if the API fails or the result set exceeds the safety limit, discovery fails instead of selecting from an incomplete list.

### Download a Release

```bash
php bin/update.php download 1.2.0
```

Do not treat a download as approved for deployment. `install` and `rollback` commands, with or without `--dry-run` or `--force`, exit with an error before connecting to the database or changing files. Historical marker-only “backups” are not restorable backups; use a separately verified deployment and recovery process.

### Check Status

```bash
# Get current update status
php bin/update.php status

# View update history (last 50 operations)
php bin/update.php history 50
```

## Configuration

The database contains runtime configuration. The JSON file below is a legacy example, not an active auto-update controller.

### 1. JSON Config (`config/update-config.json`)

Example template:

```json
{
  "version": "1.0.0",
  "githubOwner": "makr-code",
  "githubRepo": "GalaxyQuest",
  "checkIntervalHours": 24,
  "autoUpdateEnabled": false,
  "releaseChannels": {
    "stable": { "enabled": true, "prerelease": false },
    "beta": { "enabled": false, "prerelease": true }
  }
}
```

The JSON template's `version` field is not used to determine the installed application version.

### 2. Database Configuration (`update_configuration` table)

Runtime configuration stored in the database:

```sql
SELECT config_key, config_value FROM update_configuration;
```

Key configuration options:

| Key | Value | Type | Description |
|-----|-------|------|-------------|
| `current_version` | `1.0.0` | string | Legacy metadata; runtime version comes from `VERSION.txt` |
| `last_check_at` | ISO 8601 timestamp | string | Last update check time |
| `check_interval_hours` | `24` | integer | Legacy metadata; scheduling is configured separately |
| `auto_update_enabled` | `false` | boolean | Legacy setting; does not enable installation |
| `github_owner` | `makr-code` | string | GitHub repository owner |
| `github_repo` | `GalaxyQuest` | string | GitHub repository name |
| `minimum_version` | `1.0.0` | string | Legacy metadata; not enforced by the helpers |
| `notify_admins_on_update` | `true` | boolean | Legacy metadata; notifications are not implemented |

## Database Schema

### update_releases

Stores information about available releases from GitHub:

```sql
CREATE TABLE update_releases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(50) NOT NULL UNIQUE,
    release_name VARCHAR(255),
    description LONGTEXT,
    release_url VARCHAR(500),
    download_url VARCHAR(500),
    checksum_sha256 VARCHAR(64),
    file_size BIGINT,
    is_prerelease BOOLEAN,
    released_at DATETIME,
    fetched_at DATETIME
);
```

### update_history

Tracks all update operations:

```sql
CREATE TABLE update_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    operation_type ENUM('check', 'download', 'install', 'rollback', 'verify'),
    from_version VARCHAR(50),
    to_version VARCHAR(50),
    status ENUM('pending', 'in_progress', 'success', 'failed'),
    admin_user_id INT,
    error_message TEXT,
    details JSON,
    started_at DATETIME,
    completed_at DATETIME
);
```

### update_configuration

Runtime configuration storage:

```sql
CREATE TABLE update_configuration (
    id INT AUTO_INCREMENT PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE,
    config_value LONGTEXT,
    config_type ENUM('string', 'integer', 'boolean', 'json'),
    updated_by INT,
    updated_at DATETIME
);
```

### update_backups

Historical backup metadata; existing marker-only entries are not usable restores:

```sql
CREATE TABLE update_backups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(50),
    backup_path VARCHAR(500),
    backup_size BIGINT,
    created_at DATETIME,
    expires_at DATETIME,
    is_available BOOLEAN
);
```

## Release Management

### Preparing a Release

`VERSION.txt` is the canonical application version. The release-metadata tag workflow validates the exact tag/commit and changelog and uploads reviewed notes only. It neither rebuilds the frontend nor prepares a second release package. The native candidate is already built and HTTP-tested by branch CI.

The legacy source-only packager remains available for local inspection, using a writable output directory outside the repository; its output is **not** the accepted native CI package:

```bash
php scripts/prepare_release.php "$(cat VERSION.txt)" --output-dir=/path/to/releases
```

The packager rejects a version that differs from `VERSION.txt`, an unavailable or unwritable output directory, and existing artifacts with the same version. It writes `galaxyquest-<version>.tar.gz` and its SHA-256 checksum.

The tag workflows run quality and security checks. These preparation outputs are not release approval. Native draft creation is handled separately as described below; staging and production installation remain outside these workflows.

### Publishing GitHub Releases

The `GitHub Release Publication` workflow has two entry points. Manual workflow dispatch is accepted only when run from `main`:

- **Operator draft:** Run `github-release.yml` manually with an existing `v<version>` tag. Stable versions must point to a commit contained in `main` with successful same-commit production/main CI. The publisher uses the `github-release` environment.
- **Automated developer draft:** Push a SemVer prerelease tag such as `v0.9.0-alpha.1`, matching `VERSION.txt`, package mirrors and a dated changelog section. The tagged commit must be contained in `develop` with successful same-commit staging/develop CI. Successful tag-workflow completion events recheck the gates; unfinished tag gates explicitly defer draft creation until a later completion event. The result is a draft marked prerelease with `latest=false`, not a published release.

Developer automation does **not** invent versions, create tags, or publish on every untagged `develop` push. Stable tags are never automatically published.

Both paths require the latest push run for the **same tag and full commit SHA** to succeed in all six workflows: main CI, Security Scans, Python Quality, CodeQL, WebGPU Shader Validation and Release Metadata Preparation. Missing, failed, skipped or cancelled gates cannot authorize draft creation. The read-only preparation job selects the latest same-commit branch CI run, verifies its required jobs and unique unexpired native candidate, checks the downloaded Actions ZIP digest and validates the inner archive. It copies that archive byte-for-byte to the versioned filename and records its SHA-256, image identity and source run/attempt/artifact provenance. There is no Vite rebuild or archive repacking; only a separate publishing job receives `contents: write`.

Finish branch CI **before tagging**. Missing, running or failed latest branch CI, an expired artifact or a changed attempt fails closed; the workflow never substitutes an older successful run. Retry the draft workflow after the required evidence is available.

For an operator release, after preparing the version and tag and obtaining green tag runs:

```bash
gh workflow run github-release.yml --ref main -f tag=v1.2.0
```

Install the workflow and trusted release helpers on the repository's default branch before using automatic `workflow_run` publication. Configure required reviewers and allowed branches for the `github-release` environment in GitHub if an additional operator approval is required; these repository settings are not created by the workflow. The separate `developer-release` environment must not require manual approval for automation.

After environment approval and serialization, the publisher rechecks the tag gates and pinned native source CI evidence using trusted helpers. It verifies the remote tag commit, archive checksum and provenance against that fresh evidence, then uploads the archive, checksum and manifest into a **draft only**. Native and publication manifests retain `not-deployable`. No draft is published or made latest, including stable-tag operator drafts. Repeated events require a matching existing draft with identical notes, prerelease status, asset metadata and all three downloaded asset bytes. Published releases and differing drafts fail closed; no assets are replaced. A failed upload can leave a partial draft requiring operator inspection.

No workflow is dispatched and no live release is created merely by adding this implementation. First remote-run acceptance, production-package validation, staging and rollback remain required.

**Checksum File Format** (`galaxyquest-<version>.sha256`):
   ```
   a1b2c3d4e5f6...  galaxyquest-<version>.tar.gz
   ```

### Archive Contents

The native publication archive has a root-layout package containing selected PHP/runtime files, `VERSION.txt`, `native-release.json` and the already-built Vite `dist/`. WordPress, generated data and caches are excluded and must remain separately managed. The legacy local source packager instead uses a checkout-name wrapper directory and is not interchangeable with this candidate. Compatibility with a future installer and the production package contract still require end-to-end validation.

## Admin API

### Legacy Update Status Handler

```
GET api/v1/admin/update-status.php
```

The PHP handler requires an authenticated admin and GET. Apache preserves this exact nested `.php` path ahead of the canonical `/api/v1/` rewrite, so the handler is reachable at the documented URL. It returns current version, available updates, and recent history:

```json
{
  "success": true,
  "status": {
    "current_version": "1.0.0",
    "update_available": true,
    "latest_release": {
      "version": "1.2.0",
      "released_at": "2026-07-31T00:00:00Z"
    },
    "health": {
      "healthy": true,
      "checks": {
        "disk_space": { "status": true, "free_bytes": 5368709120 },
        "database": { "status": true },
        "writable_dirs": { "status": true, "paths": {...} }
      }
    }
  },
  "history": [...]
}
```

## Background Tasks

### Periodic Update Check

After validating database configuration, operators can schedule the checker separately; no scheduler is enabled by this repository:

```bash
# Check every day at 2 AM
0 2 * * * php /var/www/galaxyquest/scripts/check_github_releases.php --store-releases
```

This command:
- Fetches the latest release from GitHub
- Stores it in the database
- Does not notify admins; `--notify` is rejected until notifications are implemented.

## Security Considerations

1. **Authentication** – The legacy status handler requires an admin; CLI access depends on OS permissions.
2. **Checksums** – Downloads require a valid SHA-256 sidecar whose filename and contents match the selected archive. This is an integrity check only, not a signature or authenticity guarantee.
3. **SSL/TLS** – GitHub API calls use HTTPS
4. **Database** – Update history writes are best effort and may fail silently.
5. **File Permissions** – Update directories should have restricted permissions
6. **Backups** – The updater does not create usable backups or restore them.

## Troubleshooting

### Update Check Fails

```bash
# Enable GitHub authentication (increases API rate limits)
export GITHUB_TOKEN=your_github_pat
php bin/update.php check
```

### Installation or Rollback Is Disabled

This is intentional until a reviewed installer, real backup/restore and staging validation exist. Do not remove the guard or treat historical marker files as backups.

## Advanced Usage

### Environment Variables

```bash
# Authentication for GitHub API access
export GITHUB_TOKEN=ghp_...
php bin/update.php check

# Repository overrides apply to the standalone release checker
export GITHUB_OWNER=your-org
export GITHUB_REPO=your-repo
php scripts/check_github_releases.php --store-releases
```

The current version is always loaded from the repository-root `VERSION.txt`.

### Database Configuration

The CLI checker reads its GitHub owner/repository from database configuration. Changing `auto_update_enabled` does not implement or enable installation.

## Best Practices

1. **Test Updates in Staging** – Always test in a staging environment first
2. **Schedule Maintenance Window** – Perform updates during low-traffic times
3. **Backup Database** – Always backup your database before updating
4. **Check Release Notes** – Review changelog for breaking changes
5. **Monitor After Update** – Check application logs after installation
6. **Keep Backups** – Don't delete old backups until you're confident
7. **Verify Recovery** – Test the separate deployment and restore procedure; updater dry runs are disabled.

## Integration with CI/CD

### GitHub Actions Workflow

The metadata workflow prepares reviewed notes; `github-release.yml` creates non-deployable native GitHub Release drafts under the operator/developer policy above, only after the exact tag gates and same-commit branch CI evidence pass. These workflows do not publish final releases, install staging/production or publish production container images.

## Next Steps

- [x] Implement manual operator and automatic tagged developer native release drafts
- [ ] Verify the first release workflow run and configure operator environment protection
- [ ] Implement and validate installation, real backups and restore before enabling updater mutation commands
- [ ] Require signed/trusted checksums and validate prerelease discovery in a remote release workflow
- [ ] Configure production update schedule (cron job)
- [ ] Integrate with admin dashboard UI
- [ ] Add email notifications for admins
- [ ] Implement blue-green deployment for zero-downtime updates
- [ ] Create staging environment for pre-release testing
- [ ] Document rollback procedures for your team

## Support

For issues or questions:

1. Check update history: `php bin/update.php history 100`
2. Review database logs: `SELECT * FROM update_history ORDER BY started_at DESC`
3. Check system health: `php bin/update.php status`
4. Review release artifacts: https://github.com/makr-code/GalaxyQuest/releases
