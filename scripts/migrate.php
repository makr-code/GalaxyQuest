#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * GalaxyQuest – database migration CLI tool.
 *
 * Provides safe, transactional, versioned database migrations for all
 * environments (DEV, PROD).
 *
 * Usage:
 *   php scripts/migrate.php <command> [options]
 *
 * Commands:
 *   status                       Show which migrations are applied / pending.
 *   up      [--step=N] [--dry-run]  Apply pending migrations (default: all).
 *   rollback [--step=N] [--dry-run] Roll back the last N applied migrations.
 *
 * Options:
 *   --step=N        Limit the number of migrations to apply or roll back.
 *   --dry-run       Preview what would happen; make no DB changes.
 *   --env=LABEL     Override the environment label recorded in schema_migrations
 *                   (default: value of GQ_ENV env-var, or "DEV").
 *   --sql-dir=PATH  Override the path to the sql/ directory.
 *   --help, -h      Show this help text.
 *
 * Examples:
 *   php scripts/migrate.php status
 *   php scripts/migrate.php up
 *   php scripts/migrate.php up --step=5
 *   php scripts/migrate.php up --dry-run
 *   php scripts/migrate.php rollback
 *   php scripts/migrate.php rollback --step=3 --dry-run
 *   GQ_ENV=PROD php scripts/migrate.php up
 *
 * See also:
 *   docs/technical/DATABASE_MIGRATIONS.md
 *   lib/MigrationRunner.php
 *   config/migrations_manifest.php
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "migrate.php must be run from CLI.\n");
    exit(1);
}

$root = dirname(__DIR__);
require_once $root . '/config/config.php';
require_once $root . '/lib/MigrationRunner.php';

// ── Parse CLI arguments ───────────────────────────────────────────────────────

$command = null;
$step    = null;
$dryRun  = false;
$env     = getenv('GQ_ENV') !== false ? (string)getenv('GQ_ENV') : 'DEV';
$sqlDir  = $root . '/sql';

$args = array_slice($argv, 1);
foreach ($args as $arg) {
    if ($arg === '--help' || $arg === '-h') {
        print_help();
        exit(0);
    } elseif ($arg === '--dry-run') {
        $dryRun = true;
    } elseif (preg_match('/^--step=(\d+)$/', $arg, $m)) {
        $step = max(1, (int)$m[1]);
    } elseif (preg_match('/^--env=(\S+)$/', $arg, $m)) {
        $env = $m[1];
    } elseif (preg_match('/^--sql-dir=(.+)$/', $arg, $m)) {
        $sqlDir = rtrim($m[1], '/\\');
    } elseif ($command === null && !str_starts_with($arg, '--')) {
        $command = $arg;
    }
}

if ($command === null) {
    fwrite(STDERR, "Error: no command specified.\n\n");
    print_help();
    exit(1);
}

// ── Connect to database ───────────────────────────────────────────────────────

try {
    $db = get_db();
} catch (Throwable $e) {
    fwrite(STDERR, "Database connection failed: " . $e->getMessage() . "\n");
    exit(1);
}

// ── Build runner ──────────────────────────────────────────────────────────────

$runner = new MigrationRunner($db, $sqlDir, strtoupper($env));

// ── Dispatch command ──────────────────────────────────────────────────────────

switch ($command) {
    case 'status':
        cmd_status($runner);
        break;

    case 'up':
        cmd_up($runner, $step, $dryRun);
        break;

    case 'rollback':
        cmd_rollback($runner, $step ?? 1, $dryRun);
        break;

    default:
        fwrite(STDERR, "Unknown command: {$command}\n\n");
        print_help();
        exit(1);
}

exit(0);

// ── Command implementations ───────────────────────────────────────────────────

function cmd_status(MigrationRunner $runner): void
{
    $runner->bootstrap();
    $rows = $runner->getStatus();

    $pending = 0;
    $applied = 0;

    echo str_pad('Migration', 60) . str_pad('Status', 12) . "Applied at\n";
    echo str_repeat('-', 100) . "\n";

    foreach ($rows as $row) {
        $appliedAt = $row['applied_at'] ?? '—';
        $status    = $row['status'];
        if ($status === 'applied') {
            $applied++;
        } else {
            $pending++;
        }
        printf("%-60s %-12s %s\n", $row['name'], $status, $appliedAt);
    }

    echo str_repeat('-', 100) . "\n";
    printf("Total: %d applied, %d pending\n", $applied, $pending);
}

function cmd_up(MigrationRunner $runner, ?int $step, bool $dryRun): void
{
    if ($dryRun) {
        echo "[migrate] DRY-RUN mode — no changes will be made.\n";
    }

    $results = $runner->runUp($step, $dryRun);

    if (count($results) === 0) {
        echo "[migrate] Nothing to apply — all migrations are up to date.\n";
        return;
    }

    $total = 0;
    foreach ($results as $r) {
        $label = $r['skipped']
            ? sprintf('  (dry-run, %d statement(s))', $r['statements'])
            : sprintf('  applied %d statement(s) in %d ms', $r['statements'], $r['execution_ms']);
        echo '[migrate] ' . $r['name'] . $label . "\n";
        $total += $r['statements'];
    }

    $verb = $dryRun ? 'Would apply' : 'Applied';
    printf("[migrate] %s %d migration(s), %d total statement(s).\n",
        $verb, count($results), $total);
}

function cmd_rollback(MigrationRunner $runner, int $step, bool $dryRun): void
{
    if ($dryRun) {
        echo "[migrate] DRY-RUN mode — no changes will be made.\n";
    }

    $results = $runner->runRollback($step, $dryRun);

    if (count($results) === 0) {
        echo "[migrate] Nothing to roll back — no applied migrations found.\n";
        return;
    }

    $rolledBack = 0;
    foreach ($results as $r) {
        switch ($r['status']) {
            case 'rolled_back':
                printf("[migrate] ROLLED BACK  %s (%d statements, %d ms)\n",
                    $r['name'], $r['statements'], $r['execution_ms']);
                $rolledBack++;
                break;
            case 'would_rollback':
                printf("[migrate] WOULD ROLL BACK  %s (%d statements)\n",
                    $r['name'], $r['statements']);
                $rolledBack++;
                break;
            case 'no_down_file':
                printf("[migrate] SKIP (no _down.sql)  %s\n", $r['name']);
                break;
            default:
                printf("[migrate] UNKNOWN STATUS (%s)  %s\n", $r['status'], $r['name']);
        }
    }

    $verb = $dryRun ? 'Would roll back' : 'Rolled back';
    printf("[migrate] %s %d migration(s).\n", $verb, $rolledBack);
}

// ── Help ──────────────────────────────────────────────────────────────────────

function print_help(): void
{
    echo <<<'HELP'
GalaxyQuest – database migration tool

Usage:
  php scripts/migrate.php <command> [options]

Commands:
  status                          Show applied / pending migrations.
  up      [--step=N] [--dry-run]  Apply pending migrations (default: all).
  rollback [--step=N] [--dry-run] Roll back the last N migrations (default: 1).

Options:
  --step=N        Max number of migrations to process.
  --dry-run       Preview actions; make no DB changes.
  --env=LABEL     Override environment label (default: GQ_ENV env-var or "DEV").
  --sql-dir=PATH  Override path to sql/ directory.
  --help, -h      Show this help.

Examples:
  php scripts/migrate.php status
  php scripts/migrate.php up
  php scripts/migrate.php up --step=5
  php scripts/migrate.php up --dry-run
  php scripts/migrate.php rollback --step=2
  php scripts/migrate.php rollback --dry-run
  GQ_ENV=PROD php scripts/migrate.php up

See also:
  docs/technical/DATABASE_MIGRATIONS.md

HELP;
}
