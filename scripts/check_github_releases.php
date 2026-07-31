#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Check GitHub Releases
 * 
 * Periodic background task to check for available updates.
 * Can be run by cron job or admin panel.
 * 
 * Usage:
 *   php scripts/check_github_releases.php [--notify] [--store-releases]
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script must be run from CLI.\n");
    exit(1);
}

$root = dirname(__DIR__);
require_once $root . '/config/config.php';
require_once $root . '/lib/GithubReleaseChecker.php';

$notify = in_array('--notify', $argv);
$storeReleases = in_array('--store-releases', $argv);

try {
    $db = get_db();
} catch (Throwable $e) {
    fwrite(STDERR, "Database connection failed: " . $e->getMessage() . "\n");
    exit(1);
}

// Get current version
$currentVersion = file_get_contents($root . '/VERSION.txt');
if ($currentVersion === false) {
    $currentVersion = '1.0.0';
}
$currentVersion = trim($currentVersion);

// Get configuration
$owner = env_value('GITHUB_OWNER', 'makr-code');
$repo = env_value('GITHUB_REPO', 'GalaxyQuest');
$token = getenv('GITHUB_TOKEN') ?: null;

echo "[check-releases] Checking for updates from {$owner}/{$repo}...\n";

$checker = new GithubReleaseChecker($owner, $repo, $token);
$release = $checker->fetchLatestRelease(false);

if (!$release) {
    fwrite(STDERR, "[check-releases] Failed to fetch latest release\n");
    exit(1);
}

echo "[check-releases] ✓ Latest release: {$release['version']}\n";

if ($storeReleases) {
    try {
        $stmt = $db->prepare("
            INSERT INTO update_releases 
            (version, release_name, description, release_url, download_url, checksum_sha256, is_prerelease, released_at, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                release_name = VALUES(release_name),
                description = VALUES(description),
                download_url = VALUES(download_url),
                checksum_sha256 = VALUES(checksum_sha256),
                fetched_at = NOW()
        ");

        $stmt->execute([
            $release['version'],
            $release['name'],
            substr($release['description'], 0, 5000),
            $release['release_url'],
            $release['download_url'],
            $release['checksum_sha256'],
            $release['is_prerelease'] ? 1 : 0,
            $release['released_at'],
        ]);

        echo "[check-releases] ✓ Stored release in database\n";
    } catch (Throwable $e) {
        fwrite(STDERR, "[check-releases] Error storing release: " . $e->getMessage() . "\n");
        exit(1);
    }

    // Update last check time
    try {
        $stmt = $db->prepare("
            INSERT INTO update_configuration (config_key, config_value, config_type)
            VALUES ('last_check_at', ?, 'string')
            ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()
        ");
        $stmt->execute([date('c')]);
    } catch (Throwable) {
        // Silently ignore
    }
}

// Check if update is available
$comparison = GithubReleaseChecker::compareVersions($release['version'], $currentVersion);

if ($comparison > 0) {
    echo "[check-releases] Update available: {$currentVersion} → {$release['version']}\n";

    if ($notify) {
        notify_admins($db, $release, $currentVersion);
    }
} else {
    echo "[check-releases] No updates available (current: {$currentVersion})\n";
}

exit(0);

// ──────────────────────────────────────────────────────────────────────────────

function notify_admins(PDO $db, array $release, string $currentVersion): void
{
    try {
        // Get all admin users
        $stmt = $db->prepare("
            SELECT id, email FROM actor
            WHERE has_admin_role = 1
            LIMIT 100
        ");
        $stmt->execute();
        $admins = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($admins)) {
            return;
        }

        // Create notification record (application-specific, adjust as needed)
        $message = sprintf(
            "Update available: %s → %s\n%s",
            $currentVersion,
            $release['version'],
            substr($release['description'], 0, 500)
        );

        foreach ($admins as $admin) {
            // Log in system or send email
            // This is a placeholder for your notification system
            echo "[notify] Would notify admin {$admin['id']}: {$release['version']}\n";
        }
    } catch (Throwable) {
        // Silently fail
    }
}

function env_value(string $key, $default)
{
    $value = getenv($key);
    return ($value === false || $value === '') ? $default : $value;
}
