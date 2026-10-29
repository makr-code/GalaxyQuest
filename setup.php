<?php

declare(strict_types=1);

require_once __DIR__ . '/api/helpers.php';
require_once __DIR__ . '/api/galaxy_seed.php';
require_once __DIR__ . '/api/game_engine.php';
require_once __DIR__ . '/api/character_profile_generator.php';
require_once __DIR__ . '/lib/FactionHomeworldSeeder.php';

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
    __DIR__ . '/sql/migrate_gameplay_model_v1.sql',
    __DIR__ . '/sql/migrate_politics_model_v1.sql',
    __DIR__ . '/sql/migrate_llm_soc_v1.sql',
    __DIR__ . '/sql/migrate_security_v1.sql',
    __DIR__ . '/sql/migrate_security_v2_totp.sql',
    __DIR__ . '/sql/migrate_admin_user_crud_v1.sql',
    __DIR__ . '/sql/migrate_rbac_v1.sql',
    __DIR__ . '/sql/migrate_npc_pve_controller_v1.sql',
    __DIR__ . '/sql/migrate_npc_pve_controller_v2.sql',
    __DIR__ . '/sql/migrate_fog_of_war.sql',
    __DIR__ . '/sql/migrate_galaxies_metadata.sql',
    __DIR__ . '/sql/migrate_actor_model_v1.sql',
    __DIR__ . '/sql/migrate_actor_model_v2_drop_is_npc.sql',
    __DIR__ . '/sql/migrate_faction_homeworlds_v1.sql',
];

$existingRuntimeSchema = is_existing_runtime_schema($db);
if (!$existingRuntimeSchema) {
    array_unshift($defaultMigrations, __DIR__ . '/sql/schema.sql');
}

// Legacy upgrade path: migrate_v2 contains MySQL-version-sensitive ALTER syntax
// and should only run when v2 markers are actually missing.
if ($existingRuntimeSchema && !has_v2_schema_markers($db)) {
    array_splice($defaultMigrations, 1, 0, [__DIR__ . '/sql/migrate_v2.sql']);
}

if ($opts['regenGalaxy']) {
    $defaultMigrations[] = __DIR__ . '/sql/migrate_regen_spiral.sql';
}

$totalStatements = 0;
$migrationsRun = [];
$defaultIdentityResult = null;
$bootstrapResult = null;
$npcSeedResult = null;
$factionWorldResult = null;

try {
    $factionWorlds = FactionHomeworldSeeder::configuredWorlds(
        __DIR__ . '/config/faction_homeworlds.json', __DIR__ . '/fractions'
    );
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

    if (!$opts['skipFactionWorlds']) {
        if ($opts['dryRun']) {
            $factionWorldResult = ['dry_run' => true, 'configured' => count($factionWorlds)];
        } else {
            ensure_star_system_columns($db);
            ensure_binary_systems_table($db);
            ensure_pve_factions_seed($db);
            $factionWorldResult = (new FactionHomeworldSeeder($db))->seed($factionWorlds);
        }
    }

    if (!$opts['skipMigrations']) {
        $defaultIdentityResult = ensure_default_identities_after_rbac($db, $opts['dryRun'], !$opts['skipFactionWorlds']);
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

print_summary($migrationsRun, $totalStatements, $defaultIdentityResult, $bootstrapResult, $npcSeedResult, $opts, $factionWorldResult);
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
        'skipFactionWorlds' => false,
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
            $opts['skipFactionWorlds'] = true;
            $opts['skipNpcSeed'] = true;
        } elseif ($arg === '--homeworlds-only') {
            $opts['skipMigrations'] = true;
            $opts['skipBootstrap'] = true;
            $opts['skipNpcSeed'] = true;
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
    echo "  --skip-bootstrap    Skip global warmup; still prepare faction/NPC homeworld systems.\n";
    echo "  --bootstrap-only    Warm galaxy and seed homeworlds/NPCs without running migrations.\n";
    echo "  --migrations-only   Run only SQL migrations.\n";
    echo "  --homeworlds-only   Ensure faction capitals/footholds on an already migrated database.\n";
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

function print_summary(array $migrationsRun, int $totalStatements, ?array $defaultIdentityResult, ?array $bootstrapResult, ?array $npcSeedResult, array $opts, ?array $factionWorldResult): void
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

    if ($defaultIdentityResult === null) {
        echo "- RBAC default identities: skipped\n";
    } elseif (($defaultIdentityResult['dry_run'] ?? false) === true) {
        echo "- RBAC default identities: dry-run\n";
    } else {
        echo "- RBAC default identities: created=" . (int)($defaultIdentityResult['created'] ?? 0)
            . ", updated=" . (int)($defaultIdentityResult['updated'] ?? 0)
            . ", group_links=" . (int)($defaultIdentityResult['group_links'] ?? 0)
            . ", homeworlds_created=" . (int)($defaultIdentityResult['homeworlds_created'] ?? 0)
            . ", auto_assigned_existing=" . (int)($defaultIdentityResult['auto_assigned_existing'] ?? 0)
            . "\n";
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

    if ($factionWorldResult === null) {
        echo "- Faction homeworlds: skipped\n";
    } elseif (!empty($factionWorldResult['dry_run'])) {
        echo "- Faction homeworlds: dry-run (configured=" . $factionWorldResult['configured'] . ", plus DB NPC factions)\n";
    } else {
        echo "- Faction homeworlds: created={$factionWorldResult['created']}, reused={$factionWorldResult['reused']}\n";
        foreach ($factionWorldResult['worlds'] as $world) {
            echo "  - {$world['code']}: {$world['name']} [{$world['galaxy']}:{$world['system']}:{$world['position']}]"
                . " ({$world['kind']}, {$world['placement_version']}, provisional=" . (int)$world['provisional'] . ")\n";
        }
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

function ensure_default_identities_after_rbac(PDO $db, bool $dryRun, bool $withHomeworlds = true): array
{
    if ($dryRun) {
        return [
            'dry_run' => true,
            'defaults' => ['administrator', 'default_user'],
        ];
    }

    $requiredTables = ['rbac_groups', 'rbac_profiles', 'rbac_group_profiles', 'rbac_user_groups'];
    foreach ($requiredTables as $table) {
        if (!table_exists($db, $table)) {
            throw new RuntimeException('RBAC setup incomplete: missing table ' . $table);
        }
    }

    $groupIdByKey = [];
    $groupStmt = $db->query('SELECT id, group_key FROM rbac_groups');
    foreach ($groupStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $groupIdByKey[(string)$row['group_key']] = (int)$row['id'];
    }

    $mustGroups = ['root', 'users', 'service'];
    foreach ($mustGroups as $groupKey) {
        if (!isset($groupIdByKey[$groupKey])) {
            throw new RuntimeException('RBAC setup incomplete: missing standard group ' . $groupKey);
        }
    }

    $created = 0;
    $updated = 0;
    $groupLinks = 0;
    $homeworldsCreated = 0;
    $autoAssignedExisting = 0;

    $defaults = [
        [
            'username' => 'administrator',
            'email' => 'administrator@local.dev',
            'password' => 'Admin!23456',
            'is_admin' => 1,
            'control_type' => 'human',
            'auth_enabled' => 1,
            'groups' => ['root', 'users'],
        ],
        [
            'username' => 'default_user',
            'email' => 'default_user@local.dev',
            'password' => 'User!23456',
            'is_admin' => 0,
            'control_type' => 'human',
            'auth_enabled' => 1,
            'groups' => ['users'],
        ],
    ];

    $selectUser = $db->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
    $insertUser = $db->prepare(
        'INSERT INTO users (username, email, password_hash, is_admin, control_type, auth_enabled, protection_until, deleted_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), NULL, NOW())'
    );
    $updateUser = $db->prepare(
        'UPDATE users
            SET email = ?,
                password_hash = ?,
                is_admin = ?,
                control_type = ?,
                auth_enabled = ?,
                deleted_at = NULL,
                deleted_by = NULL,
                protection_until = COALESCE(protection_until, DATE_ADD(NOW(), INTERVAL 7 DAY))
          WHERE id = ?'
    );
    $insertUserGroup = $db->prepare(
        'INSERT IGNORE INTO rbac_user_groups (user_id, group_id, assigned_by, assigned_reason)
         VALUES (?, ?, NULL, ?)'
    );
    $homeworldCheck = $db->prepare('SELECT id FROM colonies WHERE user_id = ? AND is_homeworld = 1 LIMIT 1');

    foreach ($defaults as $spec) {
        $selectUser->execute([$spec['username']]);
        $row = $selectUser->fetch(PDO::FETCH_ASSOC);
        $hash = password_hash((string)$spec['password'], PASSWORD_BCRYPT);

        if (!$row) {
            $insertUser->execute([
                $spec['username'],
                $spec['email'],
                $hash,
                (int)$spec['is_admin'],
                $spec['control_type'],
                (int)$spec['auth_enabled'],
            ]);
            $userId = (int)$db->lastInsertId();
            $created++;
        } else {
            $userId = (int)$row['id'];
            $updateUser->execute([
                $spec['email'],
                $hash,
                (int)$spec['is_admin'],
                $spec['control_type'],
                (int)$spec['auth_enabled'],
                $userId,
            ]);
            $updated++;
        }

        foreach ($spec['groups'] as $groupKey) {
            $insertUserGroup->execute([$userId, (int)$groupIdByKey[$groupKey], 'setup-default']);
            $groupLinks += $insertUserGroup->rowCount();
        }

        $homeworldCheck->execute([$userId]);
        if ($withHomeworlds && !$homeworldCheck->fetch(PDO::FETCH_ASSOC)) {
            create_seed_npc_homeworld($db, $userId, $spec['username'] . ' Home');
            $homeworldsCreated++;
        }
    }

    $missingMembershipStmt = $db->query(
        'SELECT u.id, u.control_type
           FROM users u
      LEFT JOIN rbac_user_groups ug ON ug.user_id = u.id
          WHERE u.deleted_at IS NULL
            AND ug.user_id IS NULL'
    );
    foreach ($missingMembershipStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $uid = (int)$row['id'];
        $isHuman = ((string)($row['control_type'] ?? 'human') === 'human');
        $groupKey = $isHuman ? 'users' : 'service';
        $insertUserGroup->execute([$uid, (int)$groupIdByKey[$groupKey], 'setup-auto-assign']);
        $delta = $insertUserGroup->rowCount();
        $groupLinks += $delta;
        $autoAssignedExisting += $delta;
    }

    return [
        'created' => $created,
        'updated' => $updated,
        'group_links' => $groupLinks,
        'homeworlds_created' => $homeworldsCreated,
        'auto_assigned_existing' => $autoAssignedExisting,
    ];
}

function has_v2_schema_markers(PDO $db): bool
{
    return table_exists($db, 'remember_tokens')
        && table_exists($db, 'star_systems')
        && column_exists($db, 'users', 'dark_matter')
        && column_exists($db, 'users', 'rank_points');
}

function is_existing_runtime_schema(PDO $db): bool
{
    return table_exists($db, 'users')
        && table_exists($db, 'colonies')
        && table_exists($db, 'celestial_bodies');
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

        $db->beginTransaction();
        try {
            $sel = $db->prepare('SELECT id, control_type, auth_enabled FROM users WHERE username = ? LIMIT 1');
            $sel->execute([$username]);
            $row = $sel->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                $db->prepare(
                    "INSERT INTO users (username, email, password_hash, control_type, auth_enabled)
                     VALUES (?, ?, '', 'npc_engine', 0)"
                )->execute([$username, $email]);
                $uid = (int)$db->lastInsertId();
                $created++;
            } else {
                $uid = (int)$row['id'];
                $reused++;
                if ($row['control_type'] !== 'npc_engine' || (int)$row['auth_enabled'] !== 0) {
                    throw new RuntimeException('NPC seed username belongs to a login-capable actor: ' . $username);
                }
            }

            $cSel = $db->prepare('SELECT id FROM colonies WHERE user_id = ? AND is_homeworld = 1 LIMIT 1');
            $cSel->execute([$uid]);
            if (!$cSel->fetch(PDO::FETCH_ASSOC)) {
                (new FactionHomeworldSeeder($db))->createMemberHomeworld($uid, (int)$faction['id'], $displayName . ' Nexus');
                $homeworldsCreated++;
            }
            $membership = $db->prepare('SELECT faction_id FROM npc_faction_memberships WHERE user_id = ?');
            $membership->execute([$uid]);
            $linkedFaction = $membership->fetchColumn();
            if ($linkedFaction !== false && (int)$linkedFaction !== (int)$faction['id']) {
                throw new RuntimeException('NPC faction membership conflict: ' . $username);
            }
            if ($linkedFaction === false) {
                $db->prepare('INSERT INTO npc_faction_memberships (user_id, faction_id) VALUES (?, ?)')
                    ->execute([$uid, (int)$faction['id']]);
            }
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }

        if ($withProfiles) {
            try {
                ensure_user_character_profile($db, $uid, true, $displayName);
            } catch (Throwable $e) {
                fwrite(STDERR, '[setup] NPC profile generation failed: ' . $e->getMessage() . "\n");
            }
        }
    }

    $totalNpc = (int)$db->query("SELECT COUNT(*) FROM users WHERE control_type = 'npc_engine'")->fetchColumn();

    return [
        'created' => $created,
        'reused' => $reused,
        'homeworlds_created' => $homeworldsCreated,
        'total_npc_users' => $totalNpc,
    ];
}

function create_seed_npc_homeworld(PDO $db, int $userId, string $username): int
{
    [$g, $s, $p] = find_free_position_for_seed($db);
    seed_user_start_region($db, $g, $s);
    return (new FactionHomeworldSeeder($db))->createColony($userId, $username, [
        'galaxy' => $g, 'system' => $s, 'position' => $p,
    ]);
}

function find_free_position_for_seed(PDO $db): array
{
    $systemLimit = galaxy_system_limit();
    $check = $db->prepare(
        'SELECT c.id FROM colonies c
            JOIN celestial_bodies cb ON cb.id = c.body_id
            WHERE cb.galaxy_index = ? AND cb.system_index = ? AND cb.position = ?'
    );

    for ($attempt = 0; $attempt < 120; $attempt++) {
        $g = random_int(1, GALAXY_MAX);
        $s = random_int(1, $systemLimit);
        $p = random_int(1, POSITION_MAX);
        $check->execute([$g, $s, $p]);
        $generated = generate_star_system($g, $s);
        $colonizable = array_filter($generated['planets'], static fn(array $v): bool => (int)$v['position'] === $p && !empty($v['can_colonize']));
        if ($colonizable && !$check->fetch(PDO::FETCH_ASSOC)) {
            return [$g, $s, $p];
        }
    }

    for ($g = 1; $g <= GALAXY_MAX; $g++) {
        for ($s = 1; $s <= $systemLimit; $s++) {
            for ($p = 1; $p <= POSITION_MAX; $p++) {
                $check->execute([$g, $s, $p]);
                $generated = generate_star_system($g, $s);
                $colonizable = array_filter($generated['planets'], static fn(array $v): bool => (int)$v['position'] === $p && !empty($v['can_colonize']));
                if ($colonizable && !$check->fetch(PDO::FETCH_ASSOC)) {
                    return [$g, $s, $p];
                }
            }
        }
    }

    throw new RuntimeException('Galaxy is full.');
}

function load_npc_factions_for_setup(PDO $db): array
{
    $rows = $db->query('SELECT id, code, name, faction_type FROM npc_factions ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    if (is_array($rows) && count($rows) > 0) {
        return $rows;
    }
    throw new RuntimeException('No NPC factions found. Seed faction homeworlds first.');
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
