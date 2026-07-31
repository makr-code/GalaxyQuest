# GalaxyQuest Auto-Update System

## Overview

The auto-update system provides safe, automated checking and installation of released packages from GitHub. It includes rollback capability, health checks, and comprehensive audit logging.

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

To create a release that works with this system:

1. **Tag your release** with semantic versioning:
   ```bash
   git tag -a v1.2.0 -m "Release v1.2.0: New features and bugfixes"
   git push origin v1.2.0
   ```

2. **Create GitHub Release** with:
   - Tag: `v1.2.0`
   - Release name: `Version 1.2.0`
   - Description: Changelog (in Markdown)
   - Artifacts:
     - `galaxyquest-1.2.0.tar.gz` (application files)
     - `galaxyquest-1.2.0.sha256` (checksum file)

3. **Checksum File Format** (`galaxyquest-1.2.0.sha256`):
   ```
   a1b2c3d4e5f6... galaxyquest-1.2.0.tar.gz
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
export APP_VERSION=1.2.0

php bin/update.php check
```

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

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Create Release Archive
        run: |
          tar -czf galaxyquest-${VERSION}.tar.gz \
            --exclude=.git \
            --exclude=.github \
            --exclude=node_modules \
            --exclude=updates \
            .
          
      - name: Generate Checksum
        run: |
          sha256sum galaxyquest-${VERSION}.tar.gz > galaxyquest-${VERSION}.sha256
      
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            galaxyquest-*.tar.gz
            galaxyquest-*.sha256
```

## Next Steps

- [ ] Set up automatic release creation in GitHub Actions
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
