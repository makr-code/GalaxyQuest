<?php

declare(strict_types=1);

require_once __DIR__ . '/api/helpers.php';
require_once __DIR__ . '/api/galaxy_seed.php';

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "setup.php must be run from CLI.\n");
    exit(1);
}

$opts = parse_setup_options($argv);
if ($opts['help']) {
    print_help();
    exit(0);
}

$db = get_db();

$defaultMigrations = [
    __DIR__ . '/sql/schema.sql',
    __DIR__ . '/sql/migrate_gameplay_model_v1.sql',
    __DIR__ . '/sql/migrate_politics_model_v1.sql',
    __DIR__ . '/sql/migrate_llm_soc_v1.sql',
    __DIR__ . '/sql/migrate_npc_pve_controller_v1.sql',
    __DIR__ . '/sql/migrate_npc_pve_controller_v2.sql',
    __DIR__ . '/sql/migrate_fog_of_war.sql',
];

// Legacy upgrade path: migrate_v2 contains MySQL-version-sensitive ALTER syntax
// and should only run when v2 markers are actually missing.
if (!has_v2_schema_markers($db)) {
    array_splice($defaultMigrations, 1, 0, [__DIR__ . '/sql/migrate_v2.sql']);
}

if ($opts['regenGalaxy']) {
    $defaultMigrations[] = __DIR__ . '/sql/migrate_regen_spiral.sql';
}

$totalStatements = 0;
$migrationsRun = [];
$bootstrapResult = null;

try {
    if (!$opts['skipMigrations']) {
        foreach ($defaultMigrations as $sqlFile) {
            $count = execute_sql_file($db, $sqlFile, $opts['dryRun']);
            $totalStatements += $count;
            $migrationsRun[] = [
                'file' => basename($sqlFile),
                'statements' => $count,
            ];
        }
    }

    if (!$opts['skipBootstrap']) {
        if (!$opts['dryRun'] && $opts['regenGalaxy']) {
            // Force bootstrap to start from the beginning after cache reset.
            $db->exec("DELETE FROM app_state WHERE state_key = 'galaxy_bootstrap:1:last_seeded_system'");
        }

        if ($opts['dryRun']) {
            $bootstrapResult = ['dry_run' => true, 'note' => 'bootstrap would run with forceComplete=true'];
        } else {
            $bootstrapResult = ensure_galaxy_bootstrap_progress($db, true);
        }
    }
} catch (Throwable $e) {
    fwrite(STDERR, "[setup] ERROR: " . $e->getMessage() . "\n");
    exit(1);
}

print_summary($migrationsRun, $totalStatements, $bootstrapResult, $opts);
exit(0);

function parse_setup_options(array $argv): array
{
    $opts = [
        'help' => false,
        'dryRun' => false,
        'skipMigrations' => false,
        'skipBootstrap' => false,
        'regenGalaxy' => false,
    ];

    foreach ($argv as $arg) {
        if ($arg === '--help' || $arg === '-h') {
            $opts['help'] = true;
        } elseif ($arg === '--dry-run') {
            $opts['dryRun'] = true;
        } elseif ($arg === '--skip-migrations') {
            $opts['skipMigrations'] = true;
        } elseif ($arg === '--skip-bootstrap') {
            $opts['skipBootstrap'] = true;
        } elseif ($arg === '--bootstrap-only') {
            $opts['skipMigrations'] = true;
            $opts['skipBootstrap'] = false;
        } elseif ($arg === '--migrations-only') {
            $opts['skipMigrations'] = false;
            $opts['skipBootstrap'] = true;
        } elseif ($arg === '--regen-galaxy') {
            $opts['regenGalaxy'] = true;
        }
    }

    return $opts;
}

function print_help(): void
{
    echo "GalaxyQuest setup\n";
    echo "Usage:\n";
    echo "  php setup.php [options]\n\n";
    echo "Options:\n";
    echo "  --regen-galaxy      Include spiral-regeneration migration (clears star_systems + generated planets).\n";
    echo "  --skip-migrations   Skip SQL setup steps.\n";
    echo "  --skip-bootstrap    Skip galaxy bootstrap warmup.\n";
    echo "  --bootstrap-only    Run only bootstrap warmup.\n";
    echo "  --migrations-only   Run only SQL migrations.\n";
    echo "  --dry-run           Show what would run without changing DB state.\n";
    echo "  --help, -h          Show this help.\n\n";
    echo "Examples:\n";
    echo "  php setup.php\n";
    echo "  php setup.php --regen-galaxy\n";
    echo "  php setup.php --migrations-only\n";
}

function execute_sql_file(PDO $db, string $sqlFile, bool $dryRun = false): int
{
    if (!is_file($sqlFile)) {
        throw new RuntimeException('SQL file not found: ' . $sqlFile);
    }

    $raw = file_get_contents($sqlFile);
    if ($raw === false) {
        throw new RuntimeException('Failed to read SQL file: ' . $sqlFile);
    }

    $statements = split_sql_statements($raw);

    echo '[setup] SQL ' . basename($sqlFile) . ': ' . count($statements) . " statements";
    if ($dryRun) {
        echo " (dry-run)";
    }
    echo "\n";

    if (!$dryRun) {
        foreach ($statements as $statement) {
            $stmt = $db->prepare($statement);
            $stmt->execute();
            if ($stmt->columnCount() > 0) {
                $stmt->fetchAll();
            }
            $stmt->closeCursor();
        }
    }

    return count($statements);
}

function split_sql_statements(string $sql): array
{
    $len = strlen($sql);
    $parts = [];
    $buf = '';

    $inSingle = false;
    $inDouble = false;
    $inBacktick = false;
    $inLineComment = false;
    $inBlockComment = false;

    for ($i = 0; $i < $len; $i++) {
        $ch = $sql[$i];
        $next = ($i + 1 < $len) ? $sql[$i + 1] : '';

        if ($inLineComment) {
            if ($ch === "\n") {
                $inLineComment = false;
                $buf .= $ch;
            }
            continue;
        }

        if ($inBlockComment) {
            if ($ch === '*' && $next === '/') {
                $inBlockComment = false;
                $i++;
            }
            continue;
        }

        if (!$inSingle && !$inDouble && !$inBacktick) {
            if ($ch === '-' && $next === '-') {
                $prev = ($i > 0) ? $sql[$i - 1] : "\n";
                $next2 = ($i + 2 < $len) ? $sql[$i + 2] : ' ';
                if (($prev === "\n" || $prev === "\r" || $prev === ' ' || $prev === "\t") && ($next2 === ' ' || $next2 === "\t")) {
                    $inLineComment = true;
                    $i++;
                    continue;
                }
            }
            if ($ch === '#') {
                $inLineComment = true;
                continue;
            }
            if ($ch === '/' && $next === '*') {
                $inBlockComment = true;
                $i++;
                continue;
            }
        }

        if (!$inDouble && !$inBacktick && $ch === "'" && !$inLineComment && !$inBlockComment) {
            $escaped = ($i > 0 && $sql[$i - 1] === '\\');
            if (!$escaped) {
                $inSingle = !$inSingle;
            }
            $buf .= $ch;
            continue;
        }

        if (!$inSingle && !$inBacktick && $ch === '"' && !$inLineComment && !$inBlockComment) {
            $escaped = ($i > 0 && $sql[$i - 1] === '\\');
            if (!$escaped) {
                $inDouble = !$inDouble;
            }
            $buf .= $ch;
            continue;
        }

        if (!$inSingle && !$inDouble && $ch === '`' && !$inLineComment && !$inBlockComment) {
            $inBacktick = !$inBacktick;
            $buf .= $ch;
            continue;
        }

        if (!$inSingle && !$inDouble && !$inBacktick && $ch === ';') {
            $stmt = trim($buf);
            if ($stmt !== '') {
                $parts[] = $stmt;
            }
            $buf = '';
            continue;
        }

        $buf .= $ch;
    }

    $tail = trim($buf);
    if ($tail !== '') {
        $parts[] = $tail;
    }

    return $parts;
}

function print_summary(array $migrationsRun, int $totalStatements, ?array $bootstrapResult, array $opts): void
{
    echo "\n[setup] Summary\n";

    if (count($migrationsRun) === 0) {
        echo "- SQL migrations: skipped\n";
    } else {
        echo "- SQL migrations: " . count($migrationsRun) . ' files, ' . $totalStatements . " statements\n";
        foreach ($migrationsRun as $entry) {
            echo '  - ' . $entry['file'] . ': ' . $entry['statements'] . "\n";
        }
    }

    if ($bootstrapResult === null) {
        echo "- Bootstrap: skipped\n";
    } elseif (($bootstrapResult['dry_run'] ?? false) === true) {
        echo "- Bootstrap: dry-run\n";
    } else {
        $galaxy = (int)($bootstrapResult['galaxy'] ?? 0);
        $target = (int)($bootstrapResult['target'] ?? 0);
        $seeded = (int)($bootstrapResult['seeded'] ?? 0);
        $last = (int)($bootstrapResult['last_seeded_system'] ?? $target);
        $complete = !empty($bootstrapResult['complete']) ? 'yes' : 'no';

        echo "- Bootstrap: galaxy {$galaxy}, seeded {$seeded}, last {$last}, target {$target}, complete={$complete}\n";
    }

    if ($opts['regenGalaxy']) {
        echo "- Galaxy regeneration: enabled\n";
    }
}

function has_v2_schema_markers(PDO $db): bool
{
    return table_exists($db, 'remember_tokens')
        && table_exists($db, 'star_systems')
        && column_exists($db, 'users', 'dark_matter')
        && column_exists($db, 'users', 'rank_points');
}

function table_exists(PDO $db, string $table): bool
{
    $stmt = $db->prepare(
        'SELECT COUNT(*)
           FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name = ?'
    );
    $stmt->execute([$table]);
    return ((int)$stmt->fetchColumn()) > 0;
}

function column_exists(PDO $db, string $table, string $column): bool
{
    $stmt = $db->prepare(
        'SELECT COUNT(*)
           FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name = ?
            AND column_name = ?'
    );
    $stmt->execute([$table, $column]);
    return ((int)$stmt->fetchColumn()) > 0;
}
