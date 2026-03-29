<?php

declare(strict_types=1);

require_once __DIR__ . '/api/helpers.php';
require_once __DIR__ . '/api/galaxy_seed.php';
require_once __DIR__ . '/api/game_engine.php';
require_once __DIR__ . '/api/character_profile_generator.php';

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
$npcSeedResult = null;

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

    if (!$opts['skipNpcSeed']) {
        if ($opts['dryRun']) {
            $npcSeedResult = [
                'dry_run' => true,
                'count' => $opts['npcCount'],
                'profiles' => $opts['npcProfiles'],
            ];
        } else {
            $npcSeedResult = seed_relevant_npcs($db, $opts['npcCount'], $opts['npcProfiles']);
        }
    }
} catch (Throwable $e) {
    fwrite(STDERR, "[setup] ERROR: " . $e->getMessage() . "\n");
    exit(1);
}

print_summary($migrationsRun, $totalStatements, $bootstrapResult, $npcSeedResult, $opts);
exit(0);

function parse_setup_options(array $argv): array
{
    $opts = [
        'help' => false,
        'dryRun' => false,
        'skipMigrations' => false,
        'skipBootstrap' => false,
        'regenGalaxy' => false,
        'skipNpcSeed' => false,
        'npcCount' => 12,
        'npcProfiles' => false,
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
        } elseif ($arg === '--skip-npc-seed') {
            $opts['skipNpcSeed'] = true;
        } elseif (preg_match('/^--npc-count=(\d+)$/', $arg, $m)) {
            $opts['npcCount'] = max(0, (int)$m[1]);
        } elseif ($arg === '--npc-profiles') {
            $opts['npcProfiles'] = true;
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
    echo "  --skip-npc-seed     Skip relevant NPC account seeding.\n";
    echo "  --npc-count=N       Number of relevant NPC accounts to ensure (default: 12).\n";
    echo "  --npc-profiles      Also generate NPC character profiles during setup.\n";
    echo "  --dry-run           Show what would run without changing DB state.\n";
    echo "  --help, -h          Show this help.\n\n";
    echo "Examples:\n";
    echo "  php setup.php\n";
    echo "  php setup.php --regen-galaxy\n";
    echo "  php setup.php --migrations-only\n";
    echo "  php setup.php --npc-count=20 --npc-profiles\n";
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

function print_summary(array $migrationsRun, int $totalStatements, ?array $bootstrapResult, ?array $npcSeedResult, array $opts): void
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

    if ($npcSeedResult === null) {
        echo "- Relevant NPC seed: skipped\n";
    } elseif (($npcSeedResult['dry_run'] ?? false) === true) {
        $count = (int)($npcSeedResult['count'] ?? 0);
        $profiles = !empty($npcSeedResult['profiles']) ? 'yes' : 'no';
        echo "- Relevant NPC seed: dry-run (count={$count}, profiles={$profiles})\n";
    } else {
        echo "- Relevant NPC seed: created=" . (int)($npcSeedResult['created'] ?? 0)
            . ", reused=" . (int)($npcSeedResult['reused'] ?? 0)
            . ", homeworlds_created=" . (int)($npcSeedResult['homeworlds_created'] ?? 0)
            . ", total_npc_users=" . (int)($npcSeedResult['total_npc_users'] ?? 0)
            . "\n";
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

function seed_relevant_npcs(PDO $db, int $count, bool $withProfiles): array
{
    $count = max(0, $count);
    $created = 0;
    $reused = 0;
    $homeworldsCreated = 0;
    $nameRules = load_npc_name_generation_rules(__DIR__ . '/FACTION_RELATIONS.yaml');
    $factions = load_npc_factions_for_setup($db);
    $factionCount = max(1, count($factions));

    for ($i = 1; $i <= $count; $i++) {
        $faction = $factions[($i - 1) % $factionCount];
        [$username, $displayName] = build_npc_identity($i, $faction, $nameRules);
        $email = $username . '@seed.local';

        $sel = $db->prepare('SELECT id, is_npc FROM users WHERE username = ? LIMIT 1');
        $sel->execute([$username]);
        $row = $sel->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            $hash = password_hash(bin2hex(random_bytes(10)), PASSWORD_BCRYPT);
            $db->prepare(
                'INSERT INTO users (username, email, password_hash, is_npc, protection_until, created_at)
                 VALUES (?, ?, ?, 1, DATE_ADD(NOW(), INTERVAL 7 DAY), NOW())'
            )->execute([$username, $email, $hash]);
            $uid = (int)$db->lastInsertId();
            $created++;
        } else {
            $uid = (int)$row['id'];
            $reused++;
            if ((int)$row['is_npc'] !== 1) {
                $db->prepare('UPDATE users SET is_npc = 1 WHERE id = ?')->execute([$uid]);
            }
        }

        $cSel = $db->prepare('SELECT id FROM colonies WHERE user_id = ? AND is_homeworld = 1 LIMIT 1');
        $cSel->execute([$uid]);
        if (!$cSel->fetch(PDO::FETCH_ASSOC)) {
            create_seed_npc_homeworld($db, $uid, $displayName . ' Nexus');
            $homeworldsCreated++;
        }

        if ($withProfiles) {
            try {
                ensure_user_character_profile($db, $uid, true, $displayName);
            } catch (Throwable $e) {
                // Keep setup resilient if local generation backends are unavailable.
            }
        }
    }

    $totalNpc = (int)$db->query('SELECT COUNT(*) FROM users WHERE is_npc = 1')->fetchColumn();

    return [
        'created' => $created,
        'reused' => $reused,
        'homeworlds_created' => $homeworldsCreated,
        'total_npc_users' => $totalNpc,
    ];
}

function create_seed_npc_homeworld(PDO $db, int $userId, string $username): int
{
    ensure_galaxy_bootstrap_progress($db, true);

    [$g, $s, $p] = find_free_position_for_seed($db);
    seed_user_start_region($db, $g, $s);

    $pCheck = $db->prepare('SELECT id FROM planets WHERE galaxy=? AND `system`=? AND position=?');
    $pCheck->execute([$g, $s, $p]);
    $planet = $pCheck->fetch(PDO::FETCH_ASSOC);
    if ($planet) {
        $planetId = (int)$planet['id'];
    } else {
        $db->prepare('INSERT INTO planets (galaxy, `system`, position, type) VALUES (?, ?, ?, \'terrestrial\')')
           ->execute([$g, $s, $p]);
        $planetId = (int)$db->lastInsertId();
    }

    $db->prepare(
        'INSERT INTO colonies
            (planet_id, user_id, name, colony_type, is_homeworld,
             metal, crystal, deuterium, rare_earth, food, energy,
             population, max_population, happiness, public_services, last_update)
         VALUES (?, ?, ?, ?, 1, 1200, 800, 500, 0, 500, 30, 220, 850, 68, 30, NOW())'
    )->execute([
        $planetId,
        $userId,
        $username,
        'industrial',
    ]);
    $colonyId = (int)$db->lastInsertId();

    touch_system_visibility($db, $userId, $g, $s, 'own', null, null);

    $buildings = [
        'metal_mine' => 1,
        'crystal_mine' => 1,
        'deuterium_synth' => 0,
        'solar_plant' => 1,
        'metal_storage' => 1,
        'crystal_storage' => 1,
        'deuterium_tank' => 1,
        'robotics_factory' => 0,
        'shipyard' => 0,
        'research_lab' => 0,
        'terraformer' => 0,
        'nanite_factory' => 0,
        'fusion_reactor' => 0,
        'alliance_depot' => 0,
        'missile_silo' => 0,
    ];
    $bIns = $db->prepare(
        'INSERT INTO buildings (colony_id, type, level) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE level=VALUES(level)'
    );
    foreach ($buildings as $type => $level) {
        $bIns->execute([$colonyId, $type, $level]);
    }

    $research = [
        'energy_tech', 'laser_tech', 'ion_tech', 'hyperspace_tech',
        'plasma_tech', 'combustion_drive', 'impulse_drive', 'hyperspace_drive',
        'espionage_tech', 'computer_tech', 'astrophysics', 'intergalactic_network',
        'graviton_tech', 'weapons_tech', 'shielding_tech', 'armor_tech',
        'nano_materials', 'genetic_engineering', 'quantum_computing',
        'dark_energy_tap', 'wormhole_theory', 'terraforming_tech', 'stealth_tech',
    ];
    $rIns = $db->prepare('INSERT IGNORE INTO research (user_id, type, level) VALUES (?, ?, 0)');
    foreach ($research as $type) {
        $rIns->execute([$userId, $type]);
    }

    $ships = [
        'small_cargo' => 5,
        'light_fighter' => 10,
        'heavy_fighter' => 2,
        'spy_probe' => 2,
    ];
    $sIns = $db->prepare(
        'INSERT INTO ships (colony_id, type, count) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE count=VALUES(count)'
    );
    foreach ($ships as $type => $shipCount) {
        $sIns->execute([$colonyId, $type, $shipCount]);
    }

    return $colonyId;
}

function find_free_position_for_seed(PDO $db): array
{
    $systemLimit = galaxy_system_limit();
    $check = $db->prepare(
        'SELECT c.id FROM colonies c
         JOIN planets p ON p.id = c.planet_id
         WHERE p.galaxy = ? AND p.`system` = ? AND p.position = ?'
    );

    for ($attempt = 0; $attempt < 120; $attempt++) {
        $g = random_int(1, GALAXY_MAX);
        $s = random_int(1, $systemLimit);
        $p = random_int(1, POSITION_MAX);
        $check->execute([$g, $s, $p]);
        if (!$check->fetch(PDO::FETCH_ASSOC)) {
            return [$g, $s, $p];
        }
    }

    for ($g = 1; $g <= GALAXY_MAX; $g++) {
        for ($s = 1; $s <= $systemLimit; $s++) {
            for ($p = 1; $p <= POSITION_MAX; $p++) {
                $check->execute([$g, $s, $p]);
                if (!$check->fetch(PDO::FETCH_ASSOC)) {
                    return [$g, $s, $p];
                }
            }
        }
    }

    throw new RuntimeException('Galaxy is full.');
}

function load_npc_factions_for_setup(PDO $db): array
{
    $rows = $db->query('SELECT code, name, faction_type FROM npc_factions ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    if (is_array($rows) && count($rows) > 0) {
        return $rows;
    }
    return [
        ['code' => 'empire', 'name' => 'Galactic Empire', 'faction_type' => 'military'],
        ['code' => 'guild', 'name' => 'Merchant Guild', 'faction_type' => 'trade'],
        ['code' => 'science', 'name' => 'Science Collective', 'faction_type' => 'science'],
        ['code' => 'pirates', 'name' => 'Pirate Clans', 'faction_type' => 'pirate'],
        ['code' => 'precursors', 'name' => 'Ancient Precursors', 'faction_type' => 'ancient'],
    ];
}

function load_npc_name_generation_rules(string $yamlPath): array
{
    $rules = [
        'prompt_template' => 'Generate one unique NPC name for faction {faction_name} ({faction_type}). Use 2-3 alien syllables, no human names, no titles, only the name.',
        'username_prefix' => 'gqnpc',
        'default_syllables' => ['ka', 'vor', 'zen', 'thal', 'mir', 'dra', 'sol', 'vek', 'nor', 'ix', 'ul', 'ra'],
        'joiners' => ['', '-', "'"],
        'type_syllables' => [
            'military' => ['vor', 'krag', 'drax', 'tor', 'vek', 'zar', 'khan', 'ruk'],
            'trade' => ['mer', 'sel', 'vak', 'dor', 'lin', 'qua', 'rix', 'pel'],
            'science' => ['ae', 'ion', 'syn', 'quar', 'thel', 'nex', 'or', 'phi'],
            'pirate' => ['skar', 'rag', 'mok', 'uth', 'kr', 'zog', 'vak', 'th'],
            'ancient' => ['soe', 'qir', 'ath', 'ul', 'vyr', 'zen', 'or', 'kael'],
        ],
        'faction_code_syllables' => [
            'empire' => ['vor', 'kran', 'dax', 'tor', 'rex', 'gar'],
            'guild' => ['mer', 'sel', 'tor', 'lin', 'vak', 'dor'],
            'science' => ['syn', 'thel', 'nex', 'ion', 'ae', 'phi'],
            'pirates' => ['skar', 'rag', 'mok', 'uth', 'zog', 'vak'],
            'precursors' => ['soe', 'qir', 'ath', 'vyr', 'kael', 'ul'],
            'pve_evil_*' => ['dred', 'skim', 'vein', 'kraul', 'drak', 'mor'],
            'pve_raider_*' => ['mar', 'uin', 'vru', 'thar', 'keth', 'rag'],
            'pve_merchant_*' => ['ex', 'gri', 'krold', 'sel', 'pel', 'dor'],
            'pve_helpers_*' => ['aid', 'stel', 'kan', 'gard', 'lume', 'siv'],
            'pve_ancient_*' => ['soe', 'cus', 'tor', 'prae', 'qel', 'ath'],
        ],
    ];

    if (!is_file($yamlPath)) {
        return $rules;
    }

    $lines = file($yamlPath, FILE_IGNORE_NEW_LINES);
    if (!is_array($lines)) {
        return $rules;
    }

    $inBlock = false;
    $inType = false;
    $inCode = false;
    foreach ($lines as $line) {
        $raw = rtrim((string)$line, "\r\n");
        $trim = trim($raw);
        if ($trim === '' || strpos($trim, '#') === 0) {
            continue;
        }

        if (!$inBlock && $trim === 'npc_name_generation:') {
            $inBlock = true;
            continue;
        }
        if (!$inBlock) {
            continue;
        }

        if (preg_match('/^[A-Za-z0-9_]+:\s*$/', $trim)) {
            break;
        }

        if (preg_match('/^\s{2}prompt_template:\s*"(.*)"\s*$/', $raw, $m)) {
            $rules['prompt_template'] = stripcslashes($m[1]);
            $inType = false;
            continue;
        }
        if (preg_match('/^\s{2}username_prefix:\s*"([^"]+)"\s*$/', $raw, $m)) {
            $rules['username_prefix'] = strtolower(trim($m[1]));
            $inType = false;
            continue;
        }
        if (preg_match('/^\s{2}default_syllables:\s*"([^"]+)"\s*$/', $raw, $m)) {
            $rules['default_syllables'] = parse_csv_tokens($m[1]);
            $inType = false;
            continue;
        }
        if (preg_match('/^\s{2}joiners:\s*"([^"]+)"\s*$/', $raw, $m)) {
            $rules['joiners'] = parse_joiners($m[1]);
            $inType = false;
            continue;
        }
        if (preg_match('/^\s{2}type_syllables:\s*$/', $raw)) {
            $inType = true;
            $inCode = false;
            continue;
        }
        if (preg_match('/^\s{2}faction_code_syllables:\s*$/', $raw)) {
            $inCode = true;
            $inType = false;
            continue;
        }
        if ($inType && preg_match('/^\s{4}([a-z0-9_]+):\s*"([^"]+)"\s*$/', $raw, $m)) {
            $rules['type_syllables'][$m[1]] = parse_csv_tokens($m[2]);
            continue;
        }
        if ($inCode && preg_match('/^\s{4}([a-z0-9_*]+):\s*"([^"]+)"\s*$/', $raw, $m)) {
            $rules['faction_code_syllables'][$m[1]] = parse_csv_tokens($m[2]);
            continue;
        }
    }

    return $rules;
}

function parse_csv_tokens(string $input): array
{
    $tokens = array_values(array_filter(array_map(static function (string $v): string {
        return strtolower(trim($v));
    }, explode(',', $input)), static function (string $v): bool {
        return $v !== '';
    }));

    return count($tokens) > 0 ? $tokens : ['zen', 'vor', 'ka'];
}

function parse_joiners(string $input): array
{
    $raw = array_map(static function (string $v): string {
        return strtolower(trim($v));
    }, explode(',', $input));

    $mapped = [];
    foreach ($raw as $token) {
        if ($token === 'none' || $token === 'empty' || $token === '') {
            $mapped[] = '';
        } elseif ($token === 'hyphen' || $token === '-') {
            $mapped[] = '-';
        } elseif ($token === 'apostrophe' || $token === "'") {
            $mapped[] = "'";
        }
    }

    if (count($mapped) === 0) {
        return ['', '-', "'"];
    }
    return array_values(array_unique($mapped));
}

function build_npc_identity(int $slot, array $faction, array $rules): array
{
    $type = strtolower((string)($faction['faction_type'] ?? 'military'));
    $code = strtolower((string)($faction['code'] ?? 'npc'));
    $syllables = resolve_syllables_for_faction($code, $type, $rules);
    if (!is_array($syllables) || count($syllables) === 0) {
        $syllables = $rules['default_syllables'];
    }

    $joiners = $rules['joiners'];
    if (!is_array($joiners) || count($joiners) === 0) {
        $joiners = ['', '-', "'"];
    }

    $seed = (string)$slot . ':' . (string)($faction['code'] ?? 'npc');
    $partsCount = (deterministic_value($seed . ':parts') % 2) + 2; // 2..3

    $parts = [];
    $max = count($syllables);
    for ($i = 0; $i < $partsCount; $i++) {
        $idx = deterministic_value($seed . ':syll:' . $i) % $max;
        $parts[] = (string)$syllables[$idx];
    }

    $joiner = (string)$joiners[deterministic_value($seed . ':joiner') % count($joiners)];
    $displayName = ucfirst(implode($joiner, $parts));

    $promptTemplate = (string)($rules['prompt_template'] ?? '');
    $promptText = str_replace(
        ['{faction_name}', '{faction_type}', '{seed_name}'],
        [(string)($faction['name'] ?? 'Unknown Faction'), $type, $displayName],
        $promptTemplate
    );
    // Prompt wird für spätere LLM-Namensgeneration vorbereitet; fallback bleibt deterministisch.
    $displayName = trim($displayName) !== '' ? $displayName : 'Npc' . $slot;

    $prefix = preg_replace('/[^a-z0-9_]/', '', strtolower((string)($rules['username_prefix'] ?? 'gqnpc')));
    if ($prefix === '') {
        $prefix = 'gqnpc';
    }
    $factionToken = preg_replace('/[^a-z0-9]/', '', strtolower((string)($faction['code'] ?? 'npc')));
    $nameToken = preg_replace('/[^a-z0-9]/', '', strtolower($displayName));
    $username = sprintf('%s_%s_%03d_%s',
        substr($prefix, 0, 8),
        substr($factionToken, 0, 6),
        $slot,
        substr($nameToken, 0, 8)
    );
    $username = trim($username, '_');
    if ($username === '') {
        $username = sprintf('gqnpc_%03d', $slot);
    }
    if (strlen($username) > 32) {
        $username = substr($username, 0, 32);
    }

    return [$username, $displayName];
}

function deterministic_value(string $seed): int
{
    $h = crc32($seed);
    if (!is_int($h)) {
        $h = 0;
    }
    return abs($h);
}

function resolve_syllables_for_faction(string $code, string $type, array $rules): array
{
    $byCode = $rules['faction_code_syllables'] ?? [];
    if (is_array($byCode) && count($byCode) > 0) {
        if (isset($byCode[$code]) && is_array($byCode[$code]) && count($byCode[$code]) > 0) {
            return $byCode[$code];
        }
        foreach ($byCode as $pattern => $set) {
            if (!is_array($set) || count($set) === 0) {
                continue;
            }
            if (code_matches_pattern($code, (string)$pattern)) {
                return $set;
            }
        }
    }

    $byType = $rules['type_syllables'] ?? [];
    if (isset($byType[$type]) && is_array($byType[$type]) && count($byType[$type]) > 0) {
        return $byType[$type];
    }

    return $rules['default_syllables'] ?? ['zen', 'vor', 'ka'];
}

function code_matches_pattern(string $code, string $pattern): bool
{
    $pattern = strtolower(trim($pattern));
    if ($pattern === '') {
        return false;
    }
    if (strpos($pattern, '*') === false) {
        return $code === $pattern;
    }
    // Support prefix wildcard, e.g. pve_raider_*
    if (substr($pattern, -1) === '*') {
        $prefix = substr($pattern, 0, -1);
        return $prefix === '' || strncmp($code, $prefix, strlen($prefix)) === 0;
    }
    return false;
}
