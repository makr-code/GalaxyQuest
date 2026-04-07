<?php

/**
 * mysql_to_themis_export.php – GalaxyQuest → ThemisDB bulk export tool.
 *
 * Migration Phase 0/1: reads every table from MySQL and exports it as a JSONL
 * (JSON Lines) file, one document per line, ready for ThemisDB's bulk-import API.
 *
 * Usage (CLI):
 *   php tools/mysql_to_themis_export.php [options]
 *
 * Options:
 *   --output-dir=<path>    Directory to write JSONL files (default: /tmp/themis_export)
 *   --tables=<t1,t2,...>   Comma-separated table list (default: all tables)
 *   --batch-size=<N>       Rows per batch SELECT (default: 5000)
 *   --push                 Immediately push each JSONL to ThemisDB after export
 *   --push-url=<url>       ThemisDB base URL for --push (default: THEMISDB_BASE_URL env)
 *   --push-token=<tok>     ThemisDB API token for --push
 *   --validate             After export compare row counts (MySQL vs ThemisDB)
 *   --dry-run              Print stats without writing any files or pushing
 *   --help                 Show this help
 *
 * Each JSONL file is named <table_name>.jsonl and contains one JSON object per line.
 * The MySQL primary key is mapped to the ThemisDB _key field as a string.
 * JSON/JSONB columns are decoded to native PHP arrays.
 *
 * Example:
 *   php tools/mysql_to_themis_export.php --output-dir=/tmp/gq_export --batch-size=1000
 *   php tools/mysql_to_themis_export.php --tables=users,colonies --push
 *
 * @see docs/technical/THEMISDB_MIGRATION_ROADMAP.md – Phase 1.2
 */

declare(strict_types=1);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('This script must be run from the command line.' . PHP_EOL);
}

$scriptDir = dirname(__DIR__);
require_once $scriptDir . '/config/config.php';
require_once $scriptDir . '/config/db.php';
require_once $scriptDir . '/lib/ThemisDbClient.php';

// ── Parse CLI options ─────────────────────────────────────────────────────────

$opts = getopt('', [
    'output-dir:',
    'tables:',
    'batch-size:',
    'push',
    'push-url:',
    'push-token:',
    'validate',
    'dry-run',
    'help',
]);

if (isset($opts['help'])) {
    echo <<<'HELP'
mysql_to_themis_export.php – GalaxyQuest → ThemisDB bulk export tool.

Usage:
  php tools/mysql_to_themis_export.php [options]

Options:
  --output-dir=<path>    Directory to write JSONL files (default: /tmp/themis_export)
  --tables=<t1,t2,...>   Comma-separated table list (default: all tables)
  --batch-size=<N>       Rows per batch SELECT, default 5000
  --push                 Immediately push each JSONL to ThemisDB after export
  --push-url=<url>       ThemisDB base URL for --push (default: THEMISDB_BASE_URL env)
  --push-token=<tok>     ThemisDB API token for --push
  --validate             After push compare row counts (MySQL vs ThemisDB)
  --dry-run              Print stats without writing files or pushing
  --help                 Show this help

Examples:
  php tools/mysql_to_themis_export.php --output-dir=/tmp/gq_export
  php tools/mysql_to_themis_export.php --tables=users,colonies --push
  php tools/mysql_to_themis_export.php --push --push-url=http://localhost:8090 --validate

See docs/technical/THEMISDB_MIGRATION_ROADMAP.md for full migration plan.
HELP;
    exit(0);
}

$outputDir  = (string) ($opts['output-dir']  ?? '/tmp/themis_export');
$batchSize  = (int)    ($opts['batch-size']  ?? 5000);
$doPush     = isset($opts['push']);
$doValidate = isset($opts['validate']);
$dryRun     = isset($opts['dry-run']);
$pushUrl    = (string) ($opts['push-url']   ?? (defined('THEMISDB_BASE_URL')  ? THEMISDB_BASE_URL  : 'http://localhost:8090'));
$pushToken  = (string) ($opts['push-token'] ?? (defined('THEMISDB_API_TOKEN') ? THEMISDB_API_TOKEN : ''));

if ($batchSize < 1) {
    $batchSize = 5000;
}

// ── Table list ────────────────────────────────────────────────────────────────

/**
 * All GalaxyQuest tables with their ThemisDB collection type and primary key column.
 * 'doc_fields' lists JSON/TEXT columns that should be decoded to native PHP arrays.
 *
 * collection_type:
 *   relational  – AQL collection (SQL-equivalent)
 *   document    – Document collection (schema-flexible)
 *   graph_node  – Will become a graph vertex in Phase 3
 *   graph_edge  – Will become a graph edge in Phase 3 (exported as docs in Phase 0/1)
 */
$TABLE_MAP = [
    // ── Core entities (relational) ──────────────────────────────────────────
    'users'                    => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'user_character_profiles'  => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => ['profile_json']],
    'remember_tokens'          => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'app_state'                => ['collection_type' => 'relational', 'pk' => 'state_key', 'doc_fields' => []],

    // ── Astronomy ───────────────────────────────────────────────────────────
    'galaxies'                 => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'star_systems'             => ['collection_type' => 'graph_node', 'pk' => 'id',  'doc_fields' => []],
    'binary_systems'           => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'planets'                  => ['collection_type' => 'graph_node', 'pk' => 'id',  'doc_fields' => ['species_affinity_json']],
    'celestial_bodies'         => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['metadata_json']],

    // ── Travel & FTL ────────────────────────────────────────────────────────
    'wormholes'                => ['collection_type' => 'graph_edge', 'pk' => 'id',  'doc_fields' => []],
    'user_wormhole_unlocks'    => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'ftl_gates'                => ['collection_type' => 'graph_node', 'pk' => 'id',  'doc_fields' => []],
    'ftl_resonance_nodes'      => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],

    // ── Colonisation & Economy ───────────────────────────────────────────────
    'colonies'                 => ['collection_type' => 'graph_node', 'pk' => 'id',  'doc_fields' => []],
    'buildings'                => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'building_upgrade_queue'   => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'research'                 => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'ships'                    => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'fleets'                   => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['ships_json', 'cargo_payload']],
    'colony_events'            => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => ['payload_json']],

    // ── Vessels & Blueprints ─────────────────────────────────────────────────
    'vessel_hulls'             => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['stats_json']],
    'vessel_blueprints'        => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['modules_json']],
    'vessel_blueprint_modules' => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'built_vessels'            => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'fleet_vessel_assignments' => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'modules'                  => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['stats_json']],
    'module_groups'            => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'hull_module_compatibility'=> ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],

    // ── Factions & Diplomacy ─────────────────────────────────────────────────
    'npc_factions'             => ['collection_type' => 'graph_node', 'pk' => 'id',  'doc_fields' => []],
    'diplomacy'                => ['collection_type' => 'graph_edge', 'pk' => 'id',  'doc_fields' => []],
    'trade_offers'             => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'faction_quests'           => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['requirements_json']],
    'user_faction_quests'      => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['progress_json']],
    'faction_species'          => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'faction_tech_affinities'  => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'faction_approval_history' => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'user_faction_state'       => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['state_json']],
    'species_profiles'         => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => ['traits_json']],

    // ── Alliances ────────────────────────────────────────────────────────────
    'alliances'                => ['collection_type' => 'graph_node', 'pk' => 'id',  'doc_fields' => []],
    'alliance_members'         => ['collection_type' => 'graph_edge', 'pk' => 'id',  'doc_fields' => []],
    'alliance_relations'       => ['collection_type' => 'graph_edge', 'pk' => 'id',  'doc_fields' => []],
    'alliance_messages'        => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => []],

    // ── Combat & Intel ───────────────────────────────────────────────────────
    'battle_reports'           => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => ['attacker_fleet_json', 'defender_fleet_json', 'rounds_json']],
    'spy_reports'              => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => ['report_json']],
    'wars'                     => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'war_goals'                => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'peace_offers'             => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'combat_modifiers'         => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'user_combat_modifiers'    => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],

    // ── Trade ────────────────────────────────────────────────────────────────
    'trade_routes'             => ['collection_type' => 'graph_edge', 'pk' => 'id',  'doc_fields' => []],
    'trade_opportunities'      => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'trade_proposals'          => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'npc_traders'              => ['collection_type' => 'graph_node', 'pk' => 'id',  'doc_fields' => ['config_json']],
    'trader_routes'            => ['collection_type' => 'graph_edge', 'pk' => 'id',  'doc_fields' => []],
    'trader_transactions'      => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => []],

    // ── Economy ──────────────────────────────────────────────────────────────
    'economy_policies'         => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'economy_market_prices'    => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'economy_market_events'    => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'economy_market_transactions' => ['collection_type' => 'document', 'pk' => 'id', 'doc_fields' => []],
    'economy_faction_contracts'=> ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'economy_pop_classes'      => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'economy_production_methods' => ['collection_type' => 'relational', 'pk' => 'id','doc_fields' => []],
    'economy_processed_goods'  => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'market_supply_demand'     => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],

    // ── Politics & Government ────────────────────────────────────────────────
    'government_forms'         => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['bonuses_json']],
    'government_civics'        => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['effects_json']],
    'user_empire_profile'      => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => ['policy_json']],
    'user_empire_civics'       => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'user_empire_modifiers'    => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'situation_states'         => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['state_json']],
    'situation_stage_log'      => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],

    // ── Leaders ──────────────────────────────────────────────────────────────
    'leaders'                  => ['collection_type' => 'graph_node', 'pk' => 'id',  'doc_fields' => ['stats_json', 'traits_json']],
    'leader_marketplace'       => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],

    // ── Messages ─────────────────────────────────────────────────────────────
    'messages'                 => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => []],

    // ── Achievements ─────────────────────────────────────────────────────────
    'achievements'             => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['criteria_json']],
    'user_achievements'        => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],

    // ── LLM / AI ─────────────────────────────────────────────────────────────
    'llm_prompt_profiles'      => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => ['input_schema_json']],
    'llm_request_log'          => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => []],
    'npc_llm_decision_log'     => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => ['context_json']],
    'advisor_hints'            => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => []],

    // ── Security / Auth ──────────────────────────────────────────────────────
    'login_attempts'           => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'totp_pending_sessions'    => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'rbac_profiles'            => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => ['permissions_json']],
    'rbac_groups'              => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'rbac_group_profiles'      => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'rbac_user_groups'         => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
    'player_system_visibility' => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],

    // ── Projections (read-models) ────────────────────────────────────────────
    'projection_user_overview' => ['collection_type' => 'document',   'pk' => 'id',  'doc_fields' => ['overview_json']],
    'projection_system_snapshot' => ['collection_type' => 'document', 'pk' => 'id',  'doc_fields' => ['snapshot_json']],
    'projection_dirty_queue'   => ['collection_type' => 'relational', 'pk' => 'id',  'doc_fields' => []],
];

// ── Filter table list ─────────────────────────────────────────────────────────

$requestedTables = isset($opts['tables'])
    ? array_map('trim', explode(',', (string) $opts['tables']))
    : array_keys($TABLE_MAP);

$tablesToExport = [];
foreach ($requestedTables as $t) {
    if (!isset($TABLE_MAP[$t])) {
        log_warn("Table '{$t}' is not in the export map – skipping.");
        continue;
    }
    $tablesToExport[$t] = $TABLE_MAP[$t];
}

if (empty($tablesToExport)) {
    log_error('No valid tables to export. Use --tables=<list> or fix the table map.');
    exit(1);
}

// ── Prepare output directory ─────────────────────────────────────────────────

if (!$dryRun && !is_dir($outputDir) && !mkdir($outputDir, 0755, true)) {
    log_error("Cannot create output directory: {$outputDir}");
    exit(1);
}

// ── Open DB connection ────────────────────────────────────────────────────────

$db = get_db();

// ── ThemisDB client (for --push) ─────────────────────────────────────────────

$themis = ThemisDbClient::create($pushUrl, 30, $pushToken);

// ── Export loop ───────────────────────────────────────────────────────────────

log_info(sprintf(
    "Starting export: %d tables, batch-size=%d, output-dir=%s, push=%s, validate=%s, dry-run=%s",
    count($tablesToExport),
    $batchSize,
    $outputDir,
    $doPush     ? 'yes' : 'no',
    $doValidate ? 'yes' : 'no',
    $dryRun     ? 'yes' : 'no'
));

$summary = [];

foreach ($tablesToExport as $table => $meta) {
    $pk        = (string) $meta['pk'];
    $docFields = (array)  $meta['doc_fields'];
    $collType  = (string) $meta['collection_type'];
    $jsonlFile = $outputDir . '/' . $table . '.jsonl';

    log_info("Exporting [{$collType}] {$table} ...");

    // Count rows.
    try {
        $countStmt = $db->query("SELECT COUNT(*) FROM `{$table}`");
        if ($countStmt === false) {
            throw new RuntimeException("COUNT query returned false.");
        }
        $totalRows = (int) $countStmt->fetchColumn();
    } catch (Throwable $e) {
        log_warn("  Skipping {$table}: " . $e->getMessage());
        $summary[$table] = ['rows' => 0, 'status' => 'skipped', 'error' => $e->getMessage()];
        continue;
    }

    if ($dryRun) {
        log_info("  [DRY-RUN] Would export {$totalRows} rows from {$table}.");
        $summary[$table] = ['rows' => $totalRows, 'status' => 'dry-run'];
        continue;
    }

    // Open JSONL file.
    $fh = fopen($jsonlFile, 'w');
    if ($fh === false) {
        log_warn("  Cannot open {$jsonlFile} for writing – skipping.");
        $summary[$table] = ['rows' => 0, 'status' => 'file-error'];
        continue;
    }

    $exported    = 0;
    $batchBuffer = [];

    // Determine if we can use keyset pagination (requires a single integer PK).
    // Keyset is O(log n) per batch; OFFSET is O(n) and degrades on large tables.
    $useKeyset  = ($pk !== 'state_key'); // state_key is VARCHAR; all others are INT
    $lastPkVal  = 0;

    do {
        if ($useKeyset) {
            // Keyset: WHERE pk > last_seen ORDER BY pk LIMIT batch
            $stmt = $db->prepare(
                "SELECT * FROM `{$table}` WHERE `{$pk}` > ? ORDER BY `{$pk}` LIMIT {$batchSize}"
            );
            $stmt->execute([$lastPkVal]);
        } else {
            // Fallback OFFSET for non-integer PKs (rare; only app_state uses state_key).
            $stmt = $db->prepare(
                "SELECT * FROM `{$table}` ORDER BY `{$pk}` LIMIT {$batchSize} OFFSET {$exported}"
            );
            $stmt->execute([]);
        }

        if ($stmt === false) {
            break;
        }
        $batch = $stmt->fetchAll();
        if (empty($batch)) {
            break;
        }

        foreach ($batch as $row) {
            $doc = build_document($row, $pk, $docFields, $table);
            $line = json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($line !== false) {
                fwrite($fh, $line . "\n");
                $batchBuffer[] = $doc;
                $exported++;
            }
        }

        // Advance keyset cursor to last seen PK value.
        if ($useKeyset) {
            $lastRow   = end($batch);
            $lastPkVal = $lastRow[$pk] ?? $lastPkVal;
        }

        // If --push, flush each batch to ThemisDB immediately to avoid memory pressure.
        if ($doPush && !empty($batchBuffer)) {
            push_batch($themis, $table, $batchBuffer, $meta);
            $batchBuffer = [];
        }
    } while (count($batch) === $batchSize);

    fclose($fh);

    // Push any remaining buffer (when batch-size doesn't divide evenly).
    if ($doPush && !empty($batchBuffer)) {
        push_batch($themis, $table, $batchBuffer, $meta);
    }

    $status = 'exported';

    // Validate: compare MySQL row count vs ThemisDB collection count.
    if ($doValidate && $doPush) {
        $status = validate_collection($themis, $table, $totalRows) ? 'validated' : 'mismatch';
    }

    log_info("  → {$exported}/{$totalRows} rows  [{$status}]  {$jsonlFile}");
    $summary[$table] = ['rows' => $exported, 'total' => $totalRows, 'status' => $status];
}

// ── Summary ───────────────────────────────────────────────────────────────────

echo PHP_EOL;
log_info('─── Export Summary ───────────────────────────────────────────────');
$totalExported = 0;
$errors = 0;
foreach ($summary as $tbl => $info) {
    $rows   = $info['rows']   ?? 0;
    $status = $info['status'] ?? '?';
    $total  = $info['total']  ?? $rows;
    $err    = isset($info['error']) ? '  ERROR: ' . $info['error'] : '';
    printf("  %-40s %6d / %6d  [%s]%s\n", $tbl, $rows, $total, $status, $err);
    $totalExported += $rows;
    if (in_array($status, ['skipped', 'file-error', 'mismatch'], true)) {
        $errors++;
    }
}
log_info('──────────────────────────────────────────────────────────────────');
log_info(sprintf('Total rows exported: %d  |  Errors/warnings: %d', $totalExported, $errors));
log_info('JSONL files: ' . $outputDir);

exit($errors > 0 ? 1 : 0);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a raw MySQL row array to a ThemisDB document.
 *
 * @param  array<string, mixed> $row       Raw PDO row.
 * @param  string               $pk        Primary key column name.
 * @param  string[]             $docFields Column names that contain JSON strings.
 * @param  string               $table     Table name (added as _collection metadata).
 * @return array<string, mixed>
 */
function build_document(array $row, string $pk, array $docFields, string $table): array
{
    // Map MySQL PK to ThemisDB _key (must be a string).
    $keyValue = isset($row[$pk]) ? (string) $row[$pk] : '';
    $doc = ['_key' => $keyValue, '_collection' => $table];

    foreach ($row as $col => $value) {
        if (in_array($col, $docFields, true) && is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);
            $doc[$col] = (json_last_error() === JSON_ERROR_NONE) ? $decoded : $value;
        } else {
            $doc[$col] = $value;
        }
    }

    return $doc;
}

/**
 * Push a batch of documents to a ThemisDB collection.
 *
 * @param  ThemisDbClient             $client  Configured ThemisDB client.
 * @param  string                     $table   Table / collection name.
 * @param  array<int, array<string, mixed>> $docs Batch of documents.
 * @param  array<string, mixed>       $meta    Table metadata (collection_type etc.).
 */
function push_batch(ThemisDbClient $client, string $table, array $docs, array $meta): void
{
    $result = $client->bulkImport($table, $docs, 'update');
    if (!$result['ok']) {
        log_warn(sprintf(
            "  [PUSH] Failed to push %d docs to '%s': HTTP %d – %s",
            count($docs),
            $table,
            $result['status'],
            $result['error'] ?? 'unknown error'
        ));
    }
}

/**
 * Validate that the ThemisDB collection row count matches the expected MySQL count.
 *
 * @param  ThemisDbClient $client   Configured ThemisDB client.
 * @param  string         $table   Collection name.
 * @param  int            $expected Expected row count.
 * @return bool True on match, false on mismatch or error.
 */
function validate_collection(ThemisDbClient $client, string $table, int $expected): bool
{
    $result = $client->queryAql(
        'FOR d IN @@col COLLECT WITH COUNT INTO n RETURN n',
        ['@col' => $table]
    );

    if (!$result['ok']) {
        log_warn("  [VALIDATE] Cannot count ThemisDB collection '{$table}': " . ($result['error'] ?? 'error'));
        return false;
    }

    $actual = (int) ($result['data']['result'][0] ?? -1);
    if ($actual !== $expected) {
        log_warn("  [VALIDATE] Row count mismatch for '{$table}': MySQL={$expected}, ThemisDB={$actual}");
        return false;
    }

    return true;
}

function log_info(string $msg): void
{
    echo '[' . date('H:i:s') . '] ' . $msg . PHP_EOL;
}

function log_warn(string $msg): void
{
    fwrite(STDERR, '[' . date('H:i:s') . '] WARN  ' . $msg . PHP_EOL);
}

function log_error(string $msg): void
{
    fwrite(STDERR, '[' . date('H:i:s') . '] ERROR ' . $msg . PHP_EOL);
}
