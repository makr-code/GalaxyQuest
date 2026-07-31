# Auto-Update System - Integration Guide

## What's New

The auto-update system has been implemented with MVP features (Phase 1-2):

### ✓ Completed Components

1. **Core Libraries**
   - `lib/GithubReleaseChecker.php` – Fetches releases from GitHub API with version comparison and checksum verification
   - `lib/UpdateManager.php` – Manages update operations: checking, downloading, installing, and rollback

2. **CLI Tools**
   - `bin/update.php` – Full command-line interface for all update operations
   - `scripts/check_github_releases.php` – Background task for periodic update checks
   - `scripts/prepare_release.php` – Helper to prepare release artifacts for GitHub

3. **Database Schema**
   - `sql/migrate_updates_system_v1.sql` – Tables for releases, history, configuration, and backups

4. **Configuration**
   - `config/update-config.json` – JSON configuration for update system settings
   - `VERSION.txt` – Current application version

5. **API & Documentation**
   - `api/v1/admin/update-status.php` – Admin API endpoint for update status
   - `docs/UPDATE_SYSTEM.md` – Comprehensive documentation

## First-Time Setup

### 1. Run Database Migration

```bash
# Apply the new migration
docker compose exec -T web php scripts/migrate.php up

# Or verify all migrations are up to date
docker compose exec -T web php scripts/migrate.php status
```

### 2. Verify Installation

```bash
# Check current version and system health
php bin/update.php status

# Check for available updates (from GitHub)
php bin/update.php check
```

## Usage Examples

### For Administrators

```bash
# Daily: Check for available updates
php bin/update.php check

# When ready: Download and install an update
php bin/update.php download 1.2.0
php bin/update.php install 1.2.0

# If something goes wrong: Rollback
php bin/update.php rollback

# Review update history
php bin/update.php history 50
```

### For Automation (Cron Job)

```bash
# Add to crontab to check for updates daily at 2 AM
0 2 * * * cd /var/www/galaxyquest && php scripts/check_github_releases.php --notify --store-releases
```

### For Release Engineering

```bash
# When releasing a new version
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0

# Prepare release artifacts
php scripts/prepare_release.php 1.2.0 --output-dir=/tmp/releases

# Upload to GitHub Releases:
# - galaxyquest-1.2.0.tar.gz
# - galaxyquest-1.2.0.sha256
```

## Key Features

✅ **Version Checking** – Automatic detection of newer versions from GitHub
✅ **Secure Downloads** – SHA256 checksum verification
✅ **Health Checks** – Disk space, database, and permissions validation
✅ **Backup & Rollback** – Automatic backups with quick rollback capability
✅ **Audit Trail** – Complete history of all update operations
✅ **CLI & API** – Both command-line and web API interfaces
✅ **Dry-Run Mode** – Preview updates before installing
✅ **Pre-release Support** – Optional beta/canary releases

## Database Tables

Four new tables were created:

| Table | Purpose |
|-------|---------|
| `update_releases` | Stores available releases from GitHub |
| `update_history` | Logs all update operations |
| `update_configuration` | Runtime configuration storage |
| `update_backups` | Tracks version backups for rollback |

## Next Steps (Future Phases)

- [ ] **Phase 3**: Blue-green deployment for zero-downtime updates
- [ ] **Phase 4**: Admin dashboard UI for update management
- [ ] **Phase 5**: Automatic scheduled updates (opt-in)
- [ ] **Phase 6**: Email notifications for admins
- [ ] **Phase 7**: Multi-environment support (dev/staging/prod)

## Troubleshooting

**Migration fails?**
```bash
php scripts/migrate.php status  # Check what's pending
php scripts/migrate.php up --dry-run  # Preview without changes
```

**Update check fails?**
```bash
# Enable GitHub authentication for higher API limits
export GITHUB_TOKEN=ghp_your_token
php bin/update.php check
```

**Need help?**
```bash
php bin/update.php --help  # Show all commands
grep -r "UPDATE_SYSTEM" . --include="*.md"  # Find documentation
```

## Files Added

```
config/
├── update-config.json           # Configuration
├── migrations_manifest.php       # Updated with new migration

lib/
├── GithubReleaseChecker.php      # GitHub API integration
└── UpdateManager.php             # Core update logic

bin/
└── update.php                    # CLI tool

scripts/
├── check_github_releases.php     # Periodic check task
└── prepare_release.php           # Release preparation helper

api/v1/admin/
└── update-status.php             # Admin API endpoint

sql/
└── migrate_updates_system_v1.sql  # Database schema

docs/
└── UPDATE_SYSTEM.md              # Full documentation

VERSION.txt                        # Current version file (NEW)
```

## Security Notes

- All downloads are verified with SHA256 checksums
- GitHub API calls use HTTPS
- Update operations require admin permissions (when integrated with auth)
- All operations are logged in the database
- Previous versions are backed up before updates
- File operations use secure, restricted permissions

## Configuration Reference

See `docs/UPDATE_SYSTEM.md` for:
- Detailed configuration options
- Database schema documentation
- Release preparation guide
- CI/CD integration examples
- Advanced usage and troubleshooting

---

**Status**: MVP Implementation Complete ✓
**Database Migrations**: 1 new migration (updates_system_v1)
**CLI Commands**: 6 main commands (check, download, install, rollback, status, history)
**Test Coverage**: Ready for integration tests
