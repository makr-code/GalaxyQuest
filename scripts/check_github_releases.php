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
 *   php scripts/check_github_releases.php [--store-releases]
 *   --notify is unavailable until notifications are implemented.
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script must be run from CLI.\n");
    exit(1);
}

if (in_array('--notify', $argv, true)) {
    fwrite(STDERR, "[check-releases] Notifications are not implemented.\n");
    exit(1);
}

$root = dirname(__DIR__);
require_once $root . '/config/config.php';
require_once $root . '/lib/app_version.php';
require_once $root . '/lib/GithubReleaseChecker.php';

$storeReleases = in_array('--store-releases', $argv);

try {
    $currentVersion = gq_read_app_version($root);
} catch (RuntimeException $e) {
    fwrite(STDERR, "[check-releases] " . $e->getMessage() . "\n");
    exit(1);
}

try {
    $db = get_db();
} catch (Throwable $e) {
    fwrite(STDERR, "Database connection failed: " . $e->getMessage() . "\n");
    exit(1);
}

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
} else {
    echo "[check-releases] No updates available (current: {$currentVersion})\n";
}

exit(0);
