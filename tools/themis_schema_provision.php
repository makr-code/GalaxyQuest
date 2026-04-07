<?php

declare(strict_types=1);

/**
 * ThemisDB Schema Provisioner
 *
 * Creates all collections, indexes, graph definitions, and seed data in
 * ThemisDB so it mirrors the MySQL schema exactly.  Designed to be run once
 * on a fresh ThemisDB instance – or repeatedly (idempotent).
 *
 * MySQL parallel:
 *   sql/schema.sql + all sql/migrate_*.sql → this script
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   # Provision against local ThemisDB (uses THEMISDB_BASE_URL from config)
 *   php tools/themis_schema_provision.php
 *
 *   # Override URL and API token
 *   php tools/themis_schema_provision.php \
 *       --url=http://localhost:8090 \
 *       --token=my_secret_token
 *
 *   # Dry-run: print every AQL/REST call without executing
 *   php tools/themis_schema_provision.php --dry-run
 *
 *   # Seed static data (NPC factions, achievements) after schema creation
 *   php tools/themis_schema_provision.php --seed
 *
 *   # Full setup: schema + seed
 *   php tools/themis_schema_provision.php --seed --url=http://themisdb:8080
 *
 * ── Exit codes ───────────────────────────────────────────────────────────────
 *   0  All steps succeeded (or nothing to do)
 *   1  One or more collections/indexes/graphs failed to provision
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 *
 *   1. Read themisdb/schema/collections.json  (declarative catalogue)
 *   2. For each collection: PUT /api/collection/{name}  (idempotent)
 *   3. For each index:      POST /api/index/{collection} (idempotent)
 *   4. For each graph:      PUT /api/graph/{name}        (idempotent)
 *   5. Optionally: POST seed data (npc_factions, achievements)
 *
 * @see themisdb/schema/collections.json
 * @see lib/ThemisDbClient.php
 * @see docs/technical/THEMISDB_MIGRATION_ROADMAP.md
 */

// ── Bootstrap ─────────────────────────────────────────────────────────────────

$root = dirname(__DIR__);

require_once $root . '/config/config.php';
require_once $root . '/lib/ThemisDbClient.php';

// ── CLI options ───────────────────────────────────────────────────────────────

$opts = getopt('', [
    'url:',
    'token:',
    'dry-run',
    'seed',
    'skip-indexes',
    'skip-graphs',
    'skip-seed-data',
    'only-collection:',
    'help',
]);

if (isset($opts['help'])) {
    fwrite(STDOUT, <<<'HELP'
themis_schema_provision.php – Create ThemisDB schema parallel to MySQL.

Usage:
  php tools/themis_schema_provision.php [options]

Options:
  --url=<url>            ThemisDB base URL (default: THEMISDB_BASE_URL env/config)
  --token=<tok>          ThemisDB API token
  --dry-run              Print every operation without executing
  --seed                 Insert static seed data (npc_factions, achievements)
  --skip-indexes         Skip index creation (faster but no query optimization)
  --skip-graphs          Skip graph definition creation
  --skip-seed-data       Skip seed data even when --seed is set
  --only-collection=<n>  Provision a single named collection (useful for debugging)
  --help                 Show this help

Examples:
  php tools/themis_schema_provision.php --seed
  php tools/themis_schema_provision.php --dry-run
  php tools/themis_schema_provision.php --url=http://localhost:8090 --seed
  php tools/themis_schema_provision.php --only-collection=users

Exit codes:
  0  All steps succeeded
  1  One or more steps failed

HELP
    );
    exit(0);
}

$baseUrl   = (string)($opts['url']   ?? (defined('THEMISDB_BASE_URL')   ? THEMISDB_BASE_URL   : 'http://localhost:8090'));
$apiToken  = (string)($opts['token'] ?? (defined('THEMISDB_API_TOKEN')  ? THEMISDB_API_TOKEN  : ''));
$dryRun    = isset($opts['dry-run']);
$doSeed    = isset($opts['seed']) && !isset($opts['skip-seed-data']);
$skipIdx   = isset($opts['skip-indexes']);
$skipGraph = isset($opts['skip-graphs']);
$onlyCol   = (string)($opts['only-collection'] ?? '');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * @param string $level  INFO|WARN|ERROR|OK
 */
function log_msg(string $level, string $msg): void
{
    $ts = date('H:i:s');
    $prefix = match ($level) {
        'OK'    => "\033[32m[OK]\033[0m",
        'WARN'  => "\033[33m[WARN]\033[0m",
        'ERROR' => "\033[31m[ERROR]\033[0m",
        default => "[INFO]",
    };
    fwrite(STDOUT, "{$ts} {$prefix} {$msg}\n");
}

// ── Load catalogue ────────────────────────────────────────────────────────────

$cataloguePath = $root . '/themisdb/schema/collections.json';
if (!file_exists($cataloguePath)) {
    log_msg('ERROR', "Collection catalogue not found: {$cataloguePath}");
    exit(1);
}

$catalogue = json_decode((string)file_get_contents($cataloguePath), true);
if (!is_array($catalogue)) {
    log_msg('ERROR', "Failed to parse collections.json: " . json_last_error_msg());
    exit(1);
}

$collections = (array)($catalogue['collections'] ?? []);
$graphs      = (array)($catalogue['graphs']      ?? []);

// ── ThemisDB client ───────────────────────────────────────────────────────────

$themis = ThemisDbClient::create($baseUrl, 30, $apiToken);

if (!$dryRun) {
    log_msg('INFO', "Waiting for ThemisDB at {$baseUrl} …");
    $attempts = 0;
    while (!$themis->isHealthy()) {
        $attempts++;
        if ($attempts > 30) {
            log_msg('ERROR', "ThemisDB not reachable after 30 attempts. Aborting.");
            exit(1);
        }
        sleep(2);
    }
    log_msg('OK', "ThemisDB is healthy.");
}

// ── Stats counters ────────────────────────────────────────────────────────────

$stats = [
    'collections_created'  => 0,
    'collections_existed'  => 0,
    'indexes_created'      => 0,
    'graphs_created'       => 0,
    'seed_docs_inserted'   => 0,
    'errors'               => 0,
];

// ── Phase 1: Collections ──────────────────────────────────────────────────────

log_msg('INFO', sprintf("Provisioning %d collections …", count($collections)));

foreach ($collections as $col) {
    $name = (string)($col['name'] ?? '');
    $type = (string)($col['type'] ?? 'collection');

    if ($name === '') {
        continue;
    }
    if ($onlyCol !== '' && $name !== $onlyCol) {
        continue;
    }

    // Map catalogue type → ThemisDB collection type
    $themisType = match ($type) {
        'edge'     => 'edge',
        'document' => 'document',
        default    => 'collection',
    };

    $comment = (string)($col['comment'] ?? '');
    $label   = "{$name} [{$type}]";

    if ($dryRun) {
        log_msg('INFO', "[DRY-RUN] Would create collection: {$label}");
        continue;
    }

    $result = $themis->ensureCollection($name, $themisType);

    if ($result['ok']) {
        $existed = !($result['data']['new'] ?? false);
        if ($existed) {
            log_msg('INFO', "  {$label} – already exists.");
            $stats['collections_existed']++;
        } else {
            log_msg('OK', "  {$label} – created.");
            $stats['collections_created']++;
        }
    } else {
        log_msg('ERROR', "  {$label} – FAILED: " . ($result['error'] ?? 'unknown'));
        $stats['errors']++;
    }
}

// ── Phase 2: Indexes ──────────────────────────────────────────────────────────

if (!$skipIdx) {
    log_msg('INFO', "Creating indexes …");

    foreach ($collections as $col) {
        $name    = (string)($col['name']    ?? '');
        $indexes = (array) ($col['indexes'] ?? []);

        if ($name === '' || empty($indexes)) {
            continue;
        }
        if ($onlyCol !== '' && $name !== $onlyCol) {
            continue;
        }

        foreach ($indexes as $idx) {
            $idxType   = (string)($idx['type']    ?? 'persistent');
            $fields    = (array) ($idx['fields']  ?? []);
            $unique    = (bool)  ($idx['unique']  ?? false);
            $sparse    = (bool)  ($idx['sparse']  ?? false);
            $geoJson   = (bool)  ($idx['geoJson'] ?? false);

            if (empty($fields)) {
                continue;
            }

            $fieldLabel = implode(',', $fields);
            $label      = "{$name}.{$idxType}({$fieldLabel})";

            if ($dryRun) {
                log_msg('INFO', "[DRY-RUN] Would create index: {$label}");
                continue;
            }

            $result = $themis->ensureIndex($name, $idxType, $fields, $unique, $sparse, $geoJson);

            if ($result['ok']) {
                $existed = !($result['data']['new'] ?? false);
                if ($existed) {
                    log_msg('INFO', "    {$label} – already exists.");
                } else {
                    log_msg('OK', "    {$label} – created.");
                    $stats['indexes_created']++;
                }
            } else {
                log_msg('ERROR', "    {$label} – FAILED: " . ($result['error'] ?? 'unknown'));
                $stats['errors']++;
            }
        }
    }
}

// ── Phase 3: Graphs ───────────────────────────────────────────────────────────

if (!$skipGraph && $onlyCol === '') {
    log_msg('INFO', sprintf("Provisioning %d graph definitions …", count($graphs)));

    foreach ($graphs as $graph) {
        $gName    = (string)($graph['name']             ?? '');
        $edgeDefs = (array) ($graph['edge_definitions'] ?? []);
        $comment  = (string)($graph['comment']          ?? '');

        if ($gName === '' || empty($edgeDefs)) {
            continue;
        }

        if ($dryRun) {
            log_msg('INFO', "[DRY-RUN] Would create graph: {$gName}");
            continue;
        }

        $result = $themis->ensureGraph($gName, $edgeDefs);

        if ($result['ok']) {
            $existed = !($result['data']['new'] ?? false);
            if ($existed) {
                log_msg('INFO', "  Graph {$gName} – already exists.");
            } else {
                log_msg('OK', "  Graph {$gName} – created.");
                $stats['graphs_created']++;
            }
        } else {
            log_msg('ERROR', "  Graph {$gName} – FAILED: " . ($result['error'] ?? 'unknown'));
            $stats['errors']++;
        }
    }
}

// ── Phase 4: Seed data ────────────────────────────────────────────────────────

if ($doSeed && $onlyCol === '') {
    log_msg('INFO', "Inserting seed data …");

    // ── NPC factions (mirrors INSERT IGNORE in schema.sql) ───────────────────
    $npcFactions = [
        [
            '_key' => 'empire', 'code' => 'empire', 'name' => 'Galactic Empire',
            'description'        => 'A vast militaristic empire controlling the core systems. Aggressive toward newcomers but can be negotiated with.',
            'faction_type'       => 'military', 'aggression' => 70, 'trade_willingness' => 20,
            'base_diplomacy' => -20, 'power_level' => 5000,
            'home_galaxy_min' => 1, 'home_galaxy_max' => 3, 'color' => '#cc4444', 'icon' => '⚔',
        ],
        [
            '_key' => 'guild', 'code' => 'guild', 'name' => 'Merchant Guild',
            'description'        => 'The wealthiest trading consortium in the spiral arms. Always open for business — for the right price.',
            'faction_type'       => 'trade', 'aggression' => 10, 'trade_willingness' => 90,
            'base_diplomacy' => 20, 'power_level' => 1000,
            'home_galaxy_min' => 4, 'home_galaxy_max' => 6, 'color' => '#ddaa22', 'icon' => '💰',
        ],
        [
            '_key' => 'science', 'code' => 'science', 'name' => 'Science Collective',
            'description'        => 'A federation of researchers obsessed with ancient ruins and unexplored star systems.',
            'faction_type'       => 'science', 'aggression' => 20, 'trade_willingness' => 60,
            'base_diplomacy' => 10, 'power_level' => 2000,
            'home_galaxy_min' => 7, 'home_galaxy_max' => 8, 'color' => '#4488cc', 'icon' => '🔬',
        ],
        [
            '_key' => 'pirates', 'code' => 'pirates', 'name' => 'Pirate Clans',
            'description'        => 'Loosely affiliated criminal gangs operating from hidden asteroid bases. Will raid anyone who looks vulnerable.',
            'faction_type'       => 'pirate', 'aggression' => 85, 'trade_willingness' => 30,
            'base_diplomacy' => -50, 'power_level' => 800,
            'home_galaxy_min' => 1, 'home_galaxy_max' => 9, 'color' => '#aa2222', 'icon' => '☠',
        ],
        [
            '_key' => 'ancients', 'code' => 'ancients', 'name' => 'The Ancients',
            'description'        => 'A mysterious civilization rumored to predate the known universe. Their motives are inscrutable.',
            'faction_type'       => 'ancient', 'aggression' => 50, 'trade_willingness' => 10,
            'base_diplomacy' => 0, 'power_level' => 99999,
            'home_galaxy_min' => 9, 'home_galaxy_max' => 9, 'color' => '#9944ee', 'icon' => '🔮',
        ],
        [
            '_key' => 'vor_tak', 'code' => 'vor_tak', 'name' => "Vor'Tak",
            'description'        => "Warrior culture of the Kalytherion Convergence. Honor through strength.",
            'faction_type'       => 'military', 'aggression' => 65, 'trade_willingness' => 35,
            'base_diplomacy' => -5, 'power_level' => 4500,
            'home_galaxy_min' => 1, 'home_galaxy_max' => 3, 'color' => '#cc6622', 'icon' => '⚡',
        ],
        [
            '_key' => 'syl_nar', 'code' => 'syl_nar', 'name' => "Syl'Nar",
            'description'        => "Spiritual collective seeking harmony in the Convergence.",
            'faction_type'       => 'science', 'aggression' => 15, 'trade_willingness' => 75,
            'base_diplomacy' => 15, 'power_level' => 2800,
            'home_galaxy_min' => 4, 'home_galaxy_max' => 6, 'color' => '#44ccaa', 'icon' => '✨',
        ],
        [
            '_key' => 'aereth', 'code' => 'aereth', 'name' => 'Aereth',
            'description'        => "Pragmatic researchers pushing the boundaries of science.",
            'faction_type'       => 'science', 'aggression' => 20, 'trade_willingness' => 65,
            'base_diplomacy' => 5, 'power_level' => 3200,
            'home_galaxy_min' => 3, 'home_galaxy_max' => 5, 'color' => '#2288ee', 'icon' => '🔭',
        ],
        [
            '_key' => 'kryl_tha', 'code' => 'kryl_tha', 'name' => "Kryl'Tha",
            'description'        => "Swarm-minded collective, efficient and relentless.",
            'faction_type'       => 'military', 'aggression' => 60, 'trade_willingness' => 25,
            'base_diplomacy' => -10, 'power_level' => 4200,
            'home_galaxy_min' => 5, 'home_galaxy_max' => 7, 'color' => '#88cc22', 'icon' => '🦟',
        ],
        [
            '_key' => 'zhareen', 'code' => 'zhareen', 'name' => 'Zhareen',
            'description'        => "Archivists and keepers of galactic knowledge.",
            'faction_type'       => 'science', 'aggression' => 10, 'trade_willingness' => 80,
            'base_diplomacy' => 20, 'power_level' => 1800,
            'home_galaxy_min' => 6, 'home_galaxy_max' => 8, 'color' => '#cc44aa', 'icon' => '📚',
        ],
        [
            '_key' => 'vel_ar', 'code' => 'vel_ar', 'name' => "Vel'Ar",
            'description'        => "Information brokers and shadow manipulators.",
            'faction_type'       => 'trade', 'aggression' => 30, 'trade_willingness' => 60,
            'base_diplomacy' => 0, 'power_level' => 2200,
            'home_galaxy_min' => 2, 'home_galaxy_max' => 5, 'color' => '#664488', 'icon' => '🕵',
        ],
    ];

    if ($dryRun) {
        log_msg('INFO', "[DRY-RUN] Would insert " . count($npcFactions) . " NPC factions.");
    } else {
        $result = $themis->bulkImport('npc_factions', $npcFactions, 'ignore');
        if ($result['ok']) {
            $stats['seed_docs_inserted'] += count($npcFactions);
            log_msg('OK', "  npc_factions – " . count($npcFactions) . " records seeded.");
        } else {
            log_msg('ERROR', "  npc_factions seed FAILED: " . ($result['error'] ?? 'unknown'));
            $stats['errors']++;
        }
    }

    // ── Achievements (mirrors INSERT IGNORE in schema.sql) ───────────────────
    $achievements = [
        ['_key' => 'tutorial_mine_3',    'code' => 'tutorial_mine_3',    'category' => 'tutorial',   'sort_order' => 10,  'title' => 'First Dig',           'description' => 'Upgrade your Metal Mine to level 3.',             'reward_metal' => 500,   'reward_crystal' => 0,    'reward_deuterium' => 0,   'reward_dark_matter' => 0,  'reward_rank_points' => 10 ],
        ['_key' => 'tutorial_solar_3',   'code' => 'tutorial_solar_3',   'category' => 'tutorial',   'sort_order' => 20,  'title' => 'Let There Be Light',  'description' => 'Upgrade your Solar Plant to level 3.',            'reward_metal' => 0,     'reward_crystal' => 300,  'reward_deuterium' => 0,   'reward_dark_matter' => 0,  'reward_rank_points' => 10 ],
        ['_key' => 'tutorial_spy',       'code' => 'tutorial_spy',       'category' => 'tutorial',   'sort_order' => 30,  'title' => 'Eyes in the Sky',     'description' => 'Send your first Espionage Probe.',                'reward_metal' => 0,     'reward_crystal' => 500,  'reward_deuterium' => 0,   'reward_dark_matter' => 0,  'reward_rank_points' => 20 ],
        ['_key' => 'tutorial_transport', 'code' => 'tutorial_transport', 'category' => 'tutorial',   'sort_order' => 40,  'title' => 'First Supply Run',    'description' => 'Complete your first transport mission.',          'reward_metal' => 800,   'reward_crystal' => 400,  'reward_deuterium' => 0,   'reward_dark_matter' => 0,  'reward_rank_points' => 20 ],
        ['_key' => 'tutorial_research',  'code' => 'tutorial_research',  'category' => 'tutorial',   'sort_order' => 50,  'title' => 'Curious Mind',        'description' => 'Research any technology for the first time.',     'reward_metal' => 0,     'reward_crystal' => 0,    'reward_deuterium' => 200, 'reward_dark_matter' => 0,  'reward_rank_points' => 30 ],
        ['_key' => 'tutorial_colony',    'code' => 'tutorial_colony',    'category' => 'tutorial',   'sort_order' => 60,  'title' => 'New Horizons',        'description' => 'Found your first colony.',                        'reward_metal' => 2000,  'reward_crystal' => 1000, 'reward_deuterium' => 500, 'reward_dark_matter' => 5,  'reward_rank_points' => 100],
        ['_key' => 'eco_metal_100k',     'code' => 'eco_metal_100k',     'category' => 'economy',    'sort_order' => 110, 'title' => 'Metal Baron',         'description' => 'Accumulate 100 000 metal across all colonies.',   'reward_metal' => 0,     'reward_crystal' => 5000, 'reward_deuterium' => 0,   'reward_dark_matter' => 0,  'reward_rank_points' => 50 ],
        ['_key' => 'eco_planets_5',      'code' => 'eco_planets_5',      'category' => 'expansion',  'sort_order' => 120, 'title' => 'Small Empire',        'description' => 'Control 5 colonies simultaneously.',              'reward_metal' => 5000,  'reward_crystal' => 5000, 'reward_deuterium' => 2000,'reward_dark_matter' => 10, 'reward_rank_points' => 150],
        ['_key' => 'eco_planets_10',     'code' => 'eco_planets_10',     'category' => 'expansion',  'sort_order' => 130, 'title' => 'Galactic Domain',     'description' => 'Control 10 colonies simultaneously.',             'reward_metal' => 10000, 'reward_crystal' => 10000,'reward_deuterium' => 5000,'reward_dark_matter' => 25, 'reward_rank_points' => 300],
        ['_key' => 'combat_first_win',   'code' => 'combat_first_win',   'category' => 'combat',     'sort_order' => 210, 'title' => 'Baptism of Fire',     'description' => 'Win your first battle.',                          'reward_metal' => 1000,  'reward_crystal' => 500,  'reward_deuterium' => 0,   'reward_dark_matter' => 5,  'reward_rank_points' => 50 ],
        ['_key' => 'combat_10_wins',     'code' => 'combat_10_wins',     'category' => 'combat',     'sort_order' => 220, 'title' => 'Warlord',             'description' => 'Win 10 battles.',                                 'reward_metal' => 0,     'reward_crystal' => 0,    'reward_deuterium' => 0,   'reward_dark_matter' => 20, 'reward_rank_points' => 200],
        ['_key' => 'veteran_deathstar',  'code' => 'veteran_deathstar',  'category' => 'milestone',  'sort_order' => 910, 'title' => 'Doomsday Machine',    'description' => 'Build a Death Star.',                             'reward_metal' => 0,     'reward_crystal' => 0,    'reward_deuterium' => 0,   'reward_dark_matter' => 100,'reward_rank_points' => 1000],
        ['_key' => 'veteran_all_research','code' => 'veteran_all_research','category' => 'milestone', 'sort_order' => 920, 'title' => 'Omniscient',         'description' => 'Complete all research trees.',                    'reward_metal' => 0,     'reward_crystal' => 0,    'reward_deuterium' => 0,   'reward_dark_matter' => 50, 'reward_rank_points' => 500],
    ];

    if ($dryRun) {
        log_msg('INFO', "[DRY-RUN] Would insert " . count($achievements) . " achievements.");
    } else {
        $result = $themis->bulkImport('achievements', $achievements, 'ignore');
        if ($result['ok']) {
            $stats['seed_docs_inserted'] += count($achievements);
            log_msg('OK', "  achievements – " . count($achievements) . " records seeded.");
        } else {
            log_msg('ERROR', "  achievements seed FAILED: " . ($result['error'] ?? 'unknown'));
            $stats['errors']++;
        }
    }

    // ── app_state schema version marker ─────────────────────────────────────
    $schemaVersion = (string)($catalogue['_schema_version'] ?? '1.0.0');
    $stateDoc = [
        '_key'        => 'themis_schema_version',
        'state_key'   => 'themis_schema_version',
        'state_value' => $schemaVersion,
    ];

    if ($dryRun) {
        log_msg('INFO', "[DRY-RUN] Would set app_state.themis_schema_version={$schemaVersion}.");
    } else {
        $result = $themis->bulkImport('app_state', [$stateDoc], 'update');
        if ($result['ok']) {
            log_msg('OK', "  app_state.themis_schema_version={$schemaVersion}");
        } else {
            log_msg('WARN', "  app_state version marker FAILED: " . ($result['error'] ?? 'unknown'));
        }
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────

echo PHP_EOL;
log_msg('INFO', '─── Provisioning Summary ────────────────────────────');
log_msg('INFO', sprintf("  Collections created:  %d", $stats['collections_created']));
log_msg('INFO', sprintf("  Collections existed:  %d", $stats['collections_existed']));
log_msg('INFO', sprintf("  Indexes created:      %d", $stats['indexes_created']));
log_msg('INFO', sprintf("  Graphs created:       %d", $stats['graphs_created']));
log_msg('INFO', sprintf("  Seed docs inserted:   %d", $stats['seed_docs_inserted']));
log_msg('INFO', sprintf("  Errors:               %d", $stats['errors']));
log_msg('INFO', '─────────────────────────────────────────────────────');

exit($stats['errors'] > 0 ? 1 : 0);
