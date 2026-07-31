#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * GalaxyQuest – Update System CLI
 * 
 * Manages application updates: checking for releases, downloading, installing, and rolling back.
 * 
 * Usage:
 *   php bin/update.php <command> [options]
 * 
 * Commands:
 *   check                    Check for available updates from GitHub
 *   download <version>       Download a specific version
 *   install <version>        Install a downloaded version
 *   rollback [version]       Rollback to previous version
 *   status                   Show current update status
 *   history [limit]          Show update history
 * 
 * Options:
 *   --dry-run               Preview without making changes
 *   --force                 Skip confirmations
 *   --prerelease            Include pre-release versions
 *   --help, -h              Show this help
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "[update] This tool must be run from CLI.\n");
    exit(1);
}

$root = dirname(__DIR__);
require_once $root . '/config/config.php';
require_once $root . '/lib/GithubReleaseChecker.php';
require_once $root . '/lib/UpdateManager.php';

// ──────────────────────────────────────────────────────────────────────────────

$command = null;
$args = [];
$dryRun = false;
$force = false;
$prerelease = false;

// Parse arguments
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--help' || $arg === '-h') {
        print_help();
        exit(0);
    } elseif ($arg === '--dry-run') {
        $dryRun = true;
    } elseif ($arg === '--force') {
        $force = true;
    } elseif ($arg === '--prerelease') {
        $prerelease = true;
    } elseif ($command === null && !str_starts_with($arg, '--')) {
        $command = $arg;
    } else {
        $args[] = $arg;
    }
}

if ($command === null) {
    fwrite(STDERR, "[update] Error: no command specified.\n\n");
    print_help();
    exit(1);
}

// ──────────────────────────────────────────────────────────────────────────────

try {
    $db = get_db();
} catch (Throwable $e) {
    fwrite(STDERR, "[update] Database connection failed: " . $e->getMessage() . "\n");
    exit(1);
}

// Get current version
$currentVersion = getenv('APP_VERSION') ?: file_get_contents($root . '/VERSION.txt') ?: '1.0.0';
$currentVersion = trim($currentVersion);

$manager = new UpdateManager($db, $root, $currentVersion);

// ──────────────────────────────────────────────────────────────────────────────

switch ($command) {
    case 'check':
        cmd_check($manager, $prerelease);
        break;

    case 'download':
        $version = $args[0] ?? null;
        if (!$version) {
            fwrite(STDERR, "[update] Error: version argument required\n");
            exit(1);
        }
        cmd_download($manager, $version);
        break;

    case 'install':
        $version = $args[0] ?? null;
        if (!$version) {
            fwrite(STDERR, "[update] Error: version argument required\n");
            exit(1);
        }
        cmd_install($manager, $version, $dryRun, $force);
        break;

    case 'rollback':
        $version = $args[0] ?? null;
        cmd_rollback($manager, $version, $dryRun, $force);
        break;

    case 'status':
        cmd_status($manager);
        break;

    case 'history':
        $limit = (int)($args[0] ?? 20);
        cmd_history($db, $limit);
        break;

    default:
        fwrite(STDERR, "[update] Unknown command: {$command}\n\n");
        print_help();
        exit(1);
}

exit(0);

// ──────────────────────────────────────────────────────────────────────────────
// Command implementations
// ──────────────────────────────────────────────────────────────────────────────

function cmd_check(UpdateManager $manager, bool $includePrerelease): void
{
    echo "[update] Checking for available updates...\n";

    $release = $manager->checkForUpdates($includePrerelease);

    if (!$release) {
        echo "[update] No updates available.\n";
        return;
    }

    echo "[update] ✓ Update available!\n";
    echo "  Version: " . $release['version'] . "\n";
    echo "  Released: " . $release['released_at'] . "\n";
    echo "  URL: " . $release['release_url'] . "\n";
    echo "\nChangelog:\n";
    echo "  " . substr($release['description'], 0, 200) . (strlen($release['description']) > 200 ? "..." : "") . "\n";
    echo "\nTo download: php bin/update.php download " . $release['version'] . "\n";
}

function cmd_download(UpdateManager $manager, string $version): void
{
    echo "[update] Downloading version {$version}...\n";

    $result = $manager->downloadRelease($version);

    if (!$result) {
        fwrite(STDERR, "[update] Download failed\n");
        exit(1);
    }

    echo "[update] ✓ Download completed\n";
    echo "  File: " . $result['filename'] . "\n";
    echo "  Size: " . format_bytes($result['size']) . "\n";
    echo "  Checksum: " . substr($result['checksum'] ?? 'N/A', 0, 16) . "...\n";
    echo "\nTo install: php bin/update.php install {$version}\n";
}

function cmd_install(UpdateManager $manager, string $version, bool $dryRun, bool $force): void
{
    $status = $manager->performHealthChecks();
    if (!$status['healthy']) {
        fwrite(STDERR, "[update] System is not healthy for updates:\n");
        foreach ($status['checks'] as $check => $result) {
            if (is_array($result) && !($result['status'] ?? false)) {
                fwrite(STDERR, "  ✗ {$check}: " . ($result['error'] ?? 'Failed') . "\n");
            }
        }
        exit(1);
    }

    echo "[update] Installing version {$version}...\n";
    if ($dryRun) {
        echo "[update] DRY-RUN mode — no changes will be made.\n";
    }

    if (!$force) {
        echo "[update] This will update your application. Continue? (yes/no): ";
        $input = trim(fgets(STDIN));
        if ($input !== 'yes') {
            echo "[update] Cancelled.\n";
            exit(0);
        }
    }

    $result = $manager->installRelease($version, dirname(__DIR__) . '/updates/downloads/' . basename($version) . '.tar.gz', $dryRun);

    if (!$result) {
        fwrite(STDERR, "[update] Installation failed\n");
        exit(1);
    }

    if ($dryRun) {
        echo "[update] ✓ DRY-RUN: Installation would succeed\n";
    } else {
        echo "[update] ✓ Installation completed\n";
        echo "  Installed version: " . $result['version'] . "\n";
        echo "  Previous version: " . $result['previous_version'] . "\n";
        echo "  Installed at: " . $result['installed_at'] . "\n";
    }
}

function cmd_rollback(UpdateManager $manager, ?string $version, bool $dryRun, bool $force): void
{
    if (!$force) {
        echo "[update] This will revert to a previous version. Continue? (yes/no): ";
        $input = trim(fgets(STDIN));
        if ($input !== 'yes') {
            echo "[update] Cancelled.\n";
            exit(0);
        }
    }

    echo "[update] Rolling back" . ($version ? " to {$version}" : "") . "...\n";
    if ($dryRun) {
        echo "[update] DRY-RUN mode — no changes will be made.\n";
    }

    $result = $manager->rollback($version);

    if (!$result) {
        fwrite(STDERR, "[update] Rollback failed\n");
        exit(1);
    }

    if ($dryRun) {
        echo "[update] ✓ DRY-RUN: Rollback would succeed\n";
    } else {
        echo "[update] ✓ Rollback completed\n";
        echo "  Restored version: " . $result['restored_version'] . "\n";
        echo "  Previous version: " . $result['previous_version'] . "\n";
    }
}

function cmd_status(UpdateManager $manager): void
{
    $status = $manager->getStatus();

    echo "[update] Update Status\n";
    echo "  Current version: " . $status['current_version'] . "\n";
    echo "  Update available: " . ($status['update_available'] ? 'Yes' : 'No') . "\n";

    if ($status['latest_release']) {
        echo "  Latest version: " . $status['latest_release']['version'] . "\n";
        echo "  Released: " . $status['latest_release']['released_at'] . "\n";
    }

    echo "  Last check: " . ($status['last_check'] ?? 'Never') . "\n";
    echo "\nSystem Health:\n";

    foreach ($status['health']['checks'] as $check => $result) {
        $ok = $result['status'] ?? ($result === true);
        echo "  " . ($ok ? "✓" : "✗") . " {$check}\n";
    }
}

function cmd_history(PDO $db, int $limit): void
{
    $stmt = $db->prepare("
        SELECT operation_type, from_version, to_version, status, started_at, error_message
        FROM update_history
        ORDER BY started_at DESC
        LIMIT ?
    ");
    $stmt->execute([$limit]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (empty($rows)) {
        echo "[update] No history available.\n";
        return;
    }

    echo "[update] Update History (last {$limit})\n";
    echo str_repeat("-", 120) . "\n";
    printf(
        "%-12s %-8s %-12s %-12s %-20s %s\n",
        "Operation",
        "Status",
        "From",
        "To",
        "Time",
        "Error"
    );
    echo str_repeat("-", 120) . "\n";

    foreach ($rows as $row) {
        $error = $row['status'] === 'failed' ? substr($row['error_message'] ?? '', 0, 30) : '';
        printf(
            "%-12s %-8s %-12s %-12s %-20s %s\n",
            $row['operation_type'],
            $row['status'],
            $row['from_version'] ?? '—',
            $row['to_version'] ?? '—',
            substr($row['started_at'], 0, 19),
            $error
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function print_help(): void
{
    echo <<<'HELP'
GalaxyQuest Update System

Usage:
  php bin/update.php <command> [options]

Commands:
  check                    Check for available updates from GitHub
  download <version>       Download a specific version
  install <version>        Install a downloaded version
  rollback [version]       Rollback to previous version
  status                   Show current update status
  history [limit]          Show update history (default: 20)

Options:
  --dry-run               Preview without making changes
  --force                 Skip confirmations
  --prerelease            Include pre-release versions
  --help, -h              Show this help

Examples:
  php bin/update.php check
  php bin/update.php check --prerelease
  php bin/update.php download 1.2.0
  php bin/update.php install 1.2.0
  php bin/update.php install 1.2.0 --dry-run
  php bin/update.php rollback
  php bin/update.php status
  php bin/update.php history 50

HELP;
}

function format_bytes(int $bytes): string
{
    $units = ['B', 'KB', 'MB', 'GB'];
    $bytes = max($bytes, 0);
    $pow = floor(($bytes ? log($bytes) : 0) / log(1024));
    $pow = min($pow, count($units) - 1);
    $bytes /= (1 << (10 * $pow));

    return round($bytes, 2) . ' ' . $units[$pow];
}
