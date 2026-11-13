# GalaxyQuest Auto-Update System

## Overview

The auto-update system provides safe, automated checking and installation of released packages from GitHub. It includes rollback capability, health checks, and comprehensive audit logging.

The installed version is read and SemVer-validated from the repository-root `VERSION.txt`. Update commands do not accept an `APP_VERSION` override or substitute a fallback version. The `version` field in `config/update-config.json` is legacy template metadata and is not authoritative at runtime.

## Features

- **Automatic Release Checking** – Periodically fetch latest releases from GitHub API
- **Secure Downloads** – SHA256 checksum verification for all artifacts
- **Health Checks** – Validate system readiness before updates
- **Backup & Rollback** – Keep previous versions for quick rollback
- **Admin Dashboard** – Check for updates via web API
- **CLI Tools** – Full command-line interface for updates
- **Audit Trail** – Complete history of all update operations
- **Pre-release Support** – Optional beta/canary releases

## Quick Start

### Check for Updates

```bash
# Check for stable updates
php bin/update.php check

# Check including pre-release versions
php bin/update.php check --prerelease
```

### Install an Update

```bash
# Download version 1.2.0
php bin/update.php download 1.2.0

# Install version 1.2.0
php bin/update.php install 1.2.0

# Dry-run (preview without making changes)
php bin/update.php install 1.2.0 --dry-run
```

### Rollback

```bash
# Rollback to previous version
php bin/update.php rollback

# Rollback to specific version
php bin/update.php rollback 1.1.0
```

### Check Status

```bash
# Get current update status
php bin/update.php status

# View update history (last 50 operations)
php bin/update.php history 50
```

## Configuration

Configuration is stored in two places:

### 1. JSON Config (`config/update-config.json`)

Top-level settings for the update system:

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
| `current_version` | `1.0.0` | string | Currently installed version |
| `last_check_at` | ISO 8601 timestamp | string | Last update check time |
| `check_interval_hours` | `24` | integer | How often to check for updates |
| `auto_update_enabled` | `false` | boolean | Enable automatic updates |
| `github_owner` | `makr-code` | string | GitHub repository owner |
| `github_repo` | `GalaxyQuest` | string | GitHub repository name |
| `minimum_version` | `1.0.0` | string | Minimum required version |
| `notify_admins_on_update` | `true` | boolean | Send admin notifications |

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

Tracks version backups for rollback:

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

`VERSION.txt` is the canonical application version. The tag workflow first validates the exact tag/commit and changelog, then runs the packager and uploads the archive and checksum as a 30-day GitHub Actions artifact for operator review. It does not publish a GitHub Release or deploy the application.

To prepare the same archive locally, use a writable output directory outside the repository:

```bash
php scripts/prepare_release.php "$(cat VERSION.txt)" --output-dir=/path/to/releases
```

The packager rejects a version that differs from `VERSION.txt`, an unavailable or unwritable output directory, and existing artifacts with the same version. It writes `galaxyquest-<version>.tar.gz` and its SHA-256 checksum.

The tag workflows run quality and security checks, and the release-metadata workflow prepares validated notes and a package artifact. These preparation outputs are not release approval. Publication is handled separately as described below; staging and production deployment remain outside these workflows.

### Publishing GitHub Releases

The `GitHub Release Publication` workflow has two entry points. Manual workflow dispatch is accepted only when run from `main`:

- **Operator release:** Run `github-release.yml` manually with an existing `v<version>` tag. Stable versions must point to a commit contained in `main`. The publisher uses the `github-release` environment.
- **Automated developer release:** Push a SemVer prerelease tag such as `v0.9.0-alpha.1`, matching `VERSION.txt`, package mirrors and a dated changelog section. The tagged commit must be contained in `develop`. Successful tag-workflow completion events recheck the gates; unfinished gates explicitly defer publication until a later completion event. The result is a GitHub prerelease with `latest=false`, leaving the stable updater channel unchanged.

Developer automation does **not** invent versions, create tags, or publish on every untagged `develop` push. Stable tags are never automatically published.

Both paths require the latest push run for the **same tag and full commit SHA** to succeed in all six workflows: main CI, Security Scans, Python Quality, CodeQL, WebGPU Shader Validation and Release Metadata Preparation. Missing, failed, skipped or cancelled gates cannot authorize publication. A read-only job installs locked frontend dependencies, builds Vite, checks the bundle budget and includes the built `dist` in the package; only a separate publishing job receives `contents: write`.

For an operator release, after preparing the version and tag and obtaining green tag runs:

```bash
gh workflow run github-release.yml --ref main -f tag=v1.2.0
```

Install the workflow and trusted release helpers on the repository's default branch before using automatic `workflow_run` publication. Configure required reviewers and allowed branches for the `github-release` environment in GitHub if an additional operator approval is required; these repository settings are not created by the workflow. The separate `developer-release` environment must not require manual approval for automation.

After environment approval and publication serialization, the publisher rechecks the gates using the pinned trusted helper, then verifies the remote tag commit and package checksum, uploads the archive, checksum and a tag/version/commit manifest into a draft, and only then publishes it. Stable operator releases become latest; developer prereleases do not. Repeated events verify that the existing release's manifest matches the tag and commit and that its downloaded archive passes its published checksum before leaving it unchanged. Existing drafts or releases with different source manifest, notes, prerelease status or asset metadata fail closed; no assets are replaced. A failed upload or final publication can leave a draft requiring operator inspection, not an automatically approved release.

No workflow is dispatched and no live release is created merely by adding this implementation. First remote-run acceptance, production-package validation, staging and rollback remain required.

**Checksum File Format** (`galaxyquest-<version>.sha256`):
   ```
   a1b2c3d4e5f6...  galaxyquest-<version>.tar.gz
   ```

### Archive Contents

The release archive must contain the complete application with this directory structure:

```
galaxyquest-1.2.0/
├── index.php
├── config/
│   └── config.php
├── lib/
│   ├── UpdateManager.php
│   └── GithubReleaseChecker.php
├── bin/
│   └── update.php
├── sql/
│   └── migrate_*.sql
├── package.json
└── ... (rest of application)
```

## Admin API

### Check Update Status

```
GET /api/v1/admin/update-status
```

Returns current version, available updates, and recent history:

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

Configure a cron job to check for updates regularly:

```bash
# Check every day at 2 AM
0 2 * * * php /var/www/galaxyquest/scripts/check_github_releases.php --notify --store-releases
```

This command:
- Fetches the latest release from GitHub
- Stores it in the database
- Notifies admins if a new update is available

## Security Considerations

1. **Authentication** – Update operations require admin authentication
2. **Checksums** – All downloads are verified with SHA256
3. **SSL/TLS** – GitHub API calls use HTTPS
4. **Database** – All operations are logged in the database
5. **File Permissions** – Update directories should have restricted permissions
6. **Backups** – Previous versions are kept for rollback capability

## Troubleshooting

### Update Check Fails

```bash
# Enable GitHub authentication (increases API rate limits)
export GITHUB_TOKEN=your_github_pat
php bin/update.php check
```

### Installation Fails

1. Check disk space: `php bin/update.php status` (see health checks)
2. Verify database connectivity
3. Check error message in update history: `php bin/update.php history`

### Rollback Issues

```bash
# See available backups
php bin/update.php history

# Dry-run rollback first
php bin/update.php rollback --dry-run

# Perform rollback
php bin/update.php rollback
```

## Advanced Usage

### Environment Variables

```bash
# Override GitHub settings
export GITHUB_OWNER=your-org
export GITHUB_REPO=your-repo
export GITHUB_TOKEN=ghp_...

php bin/update.php check
```

The current version is always loaded from the repository-root `VERSION.txt`.

### Database Configuration

Update configuration at runtime:

```php
<?php
require_once 'config/config.php';
$db = get_db();

// Enable auto-updates
$stmt = $db->prepare("
    INSERT INTO update_configuration (config_key, config_value, config_type)
    VALUES ('auto_update_enabled', 'true', 'boolean')
    ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
");
$stmt->execute();
?>
```

## Best Practices

1. **Test Updates in Staging** – Always test in a staging environment first
2. **Schedule Maintenance Window** – Perform updates during low-traffic times
3. **Backup Database** – Always backup your database before updating
4. **Check Release Notes** – Review changelog for breaking changes
5. **Monitor After Update** – Check application logs after installation
6. **Keep Backups** – Don't delete old backups until you're confident
7. **Use Dry-Run** – Test updates with `--dry-run` before committing

## Integration with CI/CD

### GitHub Actions Workflow

The metadata workflow prepares review artifacts; `github-release.yml` publishes GitHub Releases under the operator/developer policy above, only after the exact tag's quality/security gates. These release workflows do not deploy to staging or publish production container images.

## Next Steps

- [x] Implement manual operator releases and automatic tagged developer prereleases
- [ ] Verify the first release workflow run and configure operator environment protection
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
