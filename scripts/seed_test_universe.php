<?php

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/galaxy_seed.php';
require_once __DIR__ . '/../api/game_engine.php';
require_once __DIR__ . '/../api/character_profile_generator.php';

function parse_args(array $argv): array {
    $opts = [
        'users' => 100,
        'npcs' => 20,
        'profiles' => 0,
    ];

    foreach ($argv as $arg) {
        if (preg_match('/^--users=(\d+)$/', $arg, $m)) {
            $opts['users'] = max(0, (int)$m[1]);
        } elseif (preg_match('/^--npcs=(\d+)$/', $arg, $m)) {
            $opts['npcs'] = max(0, (int)$m[1]);
        } elseif (preg_match('/^--profiles=(0|1)$/', $arg, $m)) {
            $opts['profiles'] = (int)$m[1];
        }
    }

    return $opts;
}

function default_buildings(): array {
    return [
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
}

function default_research(): array {
    return [
        'energy_tech', 'laser_tech', 'ion_tech', 'hyperspace_tech',
        'plasma_tech', 'combustion_drive', 'impulse_drive', 'hyperspace_drive',
        'espionage_tech', 'computer_tech', 'astrophysics', 'intergalactic_network',
        'graviton_tech', 'weapons_tech', 'shielding_tech', 'armor_tech',
    ];
}

function default_ships_for_user(): array {
    return [
        'small_cargo' => 3,
        'light_fighter' => 5,
        'spy_probe' => 1,
    ];
}

function default_ships_for_npc(): array {
    return [
        'small_cargo' => 5,
        'light_fighter' => 10,
        'heavy_fighter' => 2,
        'spy_probe' => 2,
    ];
}

function find_free_position_seed(PDO $db): array {
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
        if (!$check->fetch()) {
            return [$g, $s, $p];
        }
    }

    for ($g = 1; $g <= GALAXY_MAX; $g++) {
        for ($s = 1; $s <= $systemLimit; $s++) {
            for ($p = 1; $p <= POSITION_MAX; $p++) {
                $check->execute([$g, $s, $p]);
                if (!$check->fetch()) {
                    return [$g, $s, $p];
                }
            }
        }
    }

    throw new RuntimeException('Galaxy is full.');
}

function create_seed_homeworld(PDO $db, int $userId, string $username, bool $isNpc): int {
    ensure_galaxy_bootstrap_progress($db, true);

    [$g, $s, $p] = find_free_position_seed($db);
    seed_user_start_region($db, $g, $s);

    $pCheck = $db->prepare('SELECT id FROM planets WHERE galaxy=? AND `system`=? AND position=?');
    $pCheck->execute([$g, $s, $p]);
    $existingPlanet = $pCheck->fetch(PDO::FETCH_ASSOC);
    if ($existingPlanet) {
        $planetId = (int)$existingPlanet['id'];
    } else {
        $db->prepare('INSERT INTO planets (galaxy, `system`, position, type) VALUES (?, ?, ?, \'terrestrial\')')
           ->execute([$g, $s, $p]);
        $planetId = (int)$db->lastInsertId();
    }

    $colonyName = $username . ($isNpc ? ' Nexus' : "'s Homeworld");
    $colonyType = $isNpc ? 'industrial' : 'balanced';

    $db->prepare(
        'INSERT INTO colonies
            (planet_id, user_id, name, colony_type, is_homeworld,
             metal, crystal, deuterium, rare_earth, food, energy,
             population, max_population, happiness, public_services, last_update)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())'
    )->execute([
        $planetId,
        $userId,
        $colonyName,
        $colonyType,
        $isNpc ? 1200.0 : 800.0,
        $isNpc ? 800.0 : 600.0,
        $isNpc ? 500.0 : 300.0,
        0.0,
        $isNpc ? 500.0 : 400.0,
        $isNpc ? 30 : 20,
        $isNpc ? 220 : 140,
        $isNpc ? 850 : 600,
        $isNpc ? 68 : 72,
        $isNpc ? 30 : 35,
    ]);
    $colonyId = (int)$db->lastInsertId();

    touch_system_visibility($db, $userId, $g, $s, 'own', null, null);

    $bIns = $db->prepare(
        'INSERT INTO buildings (colony_id, type, level) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE level=VALUES(level)'
    );
    foreach (default_buildings() as $type => $level) {
        $bIns->execute([$colonyId, $type, $level]);
    }

    $rIns = $db->prepare('INSERT IGNORE INTO research (user_id, type, level) VALUES (?, ?, 0)');
    foreach (default_research() as $type) {
        $rIns->execute([$userId, $type]);
    }

    $shipIns = $db->prepare(
        'INSERT INTO ships (colony_id, type, count) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE count=VALUES(count)'
    );
    $ships = $isNpc ? default_ships_for_npc() : default_ships_for_user();
    foreach ($ships as $type => $count) {
        $shipIns->execute([$colonyId, $type, $count]);
    }

    return $colonyId;
}

function ensure_seed_user(PDO $db, string $username, string $email, bool $isNpc, bool $withProfile): array {
    $sel = $db->prepare('SELECT id, username, is_npc FROM users WHERE username = ? LIMIT 1');
    $sel->execute([$username]);
    $user = $sel->fetch(PDO::FETCH_ASSOC);

    $created = false;
    if (!$user) {
        $hash = password_hash(bin2hex(random_bytes(10)), PASSWORD_BCRYPT);
        try {
            $db->prepare(
                'INSERT INTO users (username, email, password_hash, is_npc, protection_until, created_at)
                 VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), NOW())'
            )->execute([$username, $email, $hash, $isNpc ? 1 : 0]);
            $userId = (int)$db->lastInsertId();
            $created = true;
        } catch (PDOException $e) {
            // Parallel seed runs can race here. If another process created the user,
            // just resolve it by selecting the existing row.
            if ((string)$e->getCode() !== '23000') {
                throw $e;
            }
            $sel->execute([$username]);
            $existingAfterRace = $sel->fetch(PDO::FETCH_ASSOC);
            if (!$existingAfterRace) {
                throw $e;
            }
            $userId = (int)$existingAfterRace['id'];
            $user = $existingAfterRace;
        }
    } else {
        $userId = (int)$user['id'];
        if ((int)$user['is_npc'] !== ($isNpc ? 1 : 0)) {
            $db->prepare('UPDATE users SET is_npc = ? WHERE id = ?')->execute([$isNpc ? 1 : 0, $userId]);
        }
    }

    $cSel = $db->prepare('SELECT id FROM colonies WHERE user_id = ? AND is_homeworld = 1 LIMIT 1');
    $cSel->execute([$userId]);
    $colony = $cSel->fetch(PDO::FETCH_ASSOC);

    $homeworldCreated = false;
    if (!$colony) {
        create_seed_homeworld($db, $userId, $username, $isNpc);
        $homeworldCreated = true;
    }

    if ($withProfile) {
        try {
            ensure_user_character_profile($db, $userId, $isNpc, $username);
        } catch (Throwable $e) {
            // Keep seeding robust even when external generation endpoints are unavailable.
        }
    }

    return [
        'user_id' => $userId,
        'created' => $created,
        'homeworld_created' => $homeworldCreated,
    ];
}

$options = parse_args(array_slice($argv, 1));
$db = get_db();

$start = microtime(true);
$stats = [
    'users_created' => 0,
    'users_reused' => 0,
    'homeworlds_created' => 0,
    'npc_created' => 0,
    'npc_reused' => 0,
    'npc_homeworlds_created' => 0,
];

try {
    for ($i = 1; $i <= $options['users']; $i++) {
        $username = sprintf('gq_seed_user_%04d', $i);
        $email = $username . '@seed.local';
        $res = ensure_seed_user($db, $username, $email, false, (bool)$options['profiles']);
        if ($res['created']) {
            $stats['users_created']++;
        } else {
            $stats['users_reused']++;
        }
        if ($res['homeworld_created']) {
            $stats['homeworlds_created']++;
        }
    }

    for ($i = 1; $i <= $options['npcs']; $i++) {
        $username = sprintf('gq_seed_npc_%04d', $i);
        $email = $username . '@seed.local';
        $res = ensure_seed_user($db, $username, $email, true, (bool)$options['profiles']);
        if ($res['created']) {
            $stats['npc_created']++;
        } else {
            $stats['npc_reused']++;
        }
        if ($res['homeworld_created']) {
            $stats['npc_homeworlds_created']++;
        }
    }

    $counts = [
        'users_total' => (int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn(),
        'npc_total' => (int)$db->query('SELECT COUNT(*) FROM users WHERE is_npc = 1')->fetchColumn(),
        'colonies_total' => (int)$db->query('SELECT COUNT(*) FROM colonies')->fetchColumn(),
        'systems_total' => (int)$db->query('SELECT COUNT(*) FROM star_systems')->fetchColumn(),
    ];

    echo json_encode([
        'success' => true,
        'options' => $options,
        'stats' => $stats,
        'counts' => $counts,
        'duration_seconds' => round(microtime(true) - $start, 3),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit(0);
} catch (Throwable $e) {
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit(1);
}
