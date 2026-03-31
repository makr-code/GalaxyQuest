<?php

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/galaxy_seed.php';
require_once __DIR__ . '/../api/game_engine.php';

function parse_args(array $argv): array {
    $opts = [
        'username' => 'default_user',
        'password' => 'User!23456',
        'email' => 'default_user@local.test',
    ];

    foreach ($argv as $arg) {
        if (preg_match('/^--username=(.+)$/', $arg, $m)) {
            $opts['username'] = trim((string)$m[1]);
        } elseif (preg_match('/^--password=(.+)$/', $arg, $m)) {
            $opts['password'] = (string)$m[1];
        } elseif (preg_match('/^--email=(.+)$/', $arg, $m)) {
            $opts['email'] = trim((string)$m[1]);
        }
    }

    return $opts;
}

function default_buildings(): array {
    return [
        'metal_mine' => 2,
        'crystal_mine' => 2,
        'deuterium_synth' => 1,
        'solar_plant' => 2,
        'metal_storage' => 1,
        'crystal_storage' => 1,
        'deuterium_tank' => 1,
        'robotics_factory' => 1,
        'shipyard' => 1,
        'research_lab' => 1,
    ];
}

function default_research(): array {
    return [
        'energy_tech', 'laser_tech', 'ion_tech', 'hyperspace_tech',
        'plasma_tech', 'combustion_drive', 'impulse_drive', 'hyperspace_drive',
        'espionage_tech', 'computer_tech', 'astrophysics', 'intergalactic_network',
        'graviton_tech', 'weapons_tech', 'shielding_tech', 'armor_tech',
        'nano_materials', 'genetic_engineering', 'quantum_computing',
        'dark_energy_tap', 'wormhole_theory', 'terraforming_tech', 'stealth_tech',
    ];
}

function default_ships(): array {
    return [
        'small_cargo' => 5,
        'light_fighter' => 8,
        'spy_probe' => 2,
    ];
}

function find_free_position(PDO $db): array {
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

function ensure_planet_body(PDO $db, int $g, int $s, int $p, int $planetId): int {
    $bodyUid = sprintf('legacy-p-%d-%d-%d', $g, $s, $p);
    $stmt = $db->prepare('SELECT id FROM celestial_bodies WHERE body_uid = ? LIMIT 1');
    $stmt->execute([$bodyUid]);
    $bodyId = (int)($stmt->fetchColumn() ?: 0);
    if ($bodyId > 0) {
        return $bodyId;
    }
    $db->prepare(
        'INSERT INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position, body_type, parent_body_type,
             name, planet_class, can_colonize, payload_json)
         VALUES (?, ?, ?, ?, \'planet\', \'star\', ?, \'terrestrial\', 1, JSON_OBJECT(\'legacy_planet_id\', ?))'
    )->execute([$bodyUid, $g, $s, $p, 'Planet ' . $p, $planetId]);
    return (int)$db->lastInsertId();
}

function ensure_homeworld(PDO $db, int $userId, string $username): bool {
    $cSel = $db->prepare('SELECT id FROM colonies WHERE user_id = ? AND is_homeworld = 1 LIMIT 1');
    $cSel->execute([$userId]);
    $existing = $cSel->fetch(PDO::FETCH_ASSOC);
    if ($existing) {
        return false;
    }

    ensure_galaxy_bootstrap_progress($db, true);

    [$g, $s, $p] = find_free_position($db);
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
    $bodyId = ensure_planet_body($db, $g, $s, $p, $planetId);

    $db->prepare(
        'INSERT INTO colonies
            (planet_id, body_id, user_id, name, colony_type, is_homeworld,
             metal, crystal, deuterium, rare_earth, food, energy,
             population, max_population, happiness, public_services, last_update)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())'
    )->execute([
        $planetId,
        $bodyId,
        $userId,
        $username . "'s Homeworld",
        'balanced',
        1000.0,
        800.0,
        500.0,
        0.0,
        600.0,
        30,
        180,
        900,
        75,
        40,
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
    foreach (default_ships() as $type => $count) {
        $shipIns->execute([$colonyId, $type, $count]);
    }

    return true;
}

$options = parse_args(array_slice($argv, 1));
$username = trim((string)$options['username']);
$password = (string)$options['password'];
$email = trim((string)$options['email']);

if ($username === '' || strlen($username) < 3) {
    fwrite(STDERR, "Invalid --username\n");
    exit(2);
}
if (strlen($password) < 8) {
    fwrite(STDERR, "Invalid --password (min 8 chars)\n");
    exit(2);
}
if ($email === '') {
    $email = $username . '@local.test';
}

$db = get_db();

try {
    $sel = $db->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
    $sel->execute([$username]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);

    $userCreated = false;
    if ($row) {
        $userId = (int)$row['id'];
        $db->prepare('UPDATE users SET is_npc = 0, control_type = ?, auth_enabled = 1, deleted_at = NULL, password_hash = ? WHERE id = ?')
           ->execute(['human', password_hash($password, PASSWORD_BCRYPT), $userId]);
    } else {
        $db->prepare(
            'INSERT INTO users (username, email, password_hash, is_npc, control_type, auth_enabled, protection_until, created_at)
             VALUES (?, ?, ?, 0, ?, 1, DATE_ADD(NOW(), INTERVAL 7 DAY), NOW())'
        )->execute([$username, $email, password_hash($password, PASSWORD_BCRYPT), 'human']);
        $userId = (int)$db->lastInsertId();
        $userCreated = true;
    }

    $homeworldCreated = ensure_homeworld($db, $userId, $username);

    echo json_encode([
        'success' => true,
        'username' => $username,
        'user_created' => $userCreated,
        'homeworld_created' => $homeworldCreated,
    ], JSON_UNESCAPED_SLASHES) . PHP_EOL;
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'ensure_default_e2e_user failed: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
