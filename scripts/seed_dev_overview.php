<?php

/**
 * Dev-Overview Seed
 *
 * Füllt die Datenbank so auf, dass alle relevanten Ansichten
 * für Entwickler sofort etwas Sinnvolles zeigen:
 *
 *  1. Galaxy-Rotation / Shader-Metadaten  → galaxies-Tabelle sicherstellen
 *  2. Monde, Ringe, Kometen, vagabundierende Planeten → celestial_bodies
 *  3. NPC-Händler, -Piraten, -Kolonisten mit Heimatwelten (30 NPCs)
 *  4. Flotten in Bewegung (Transport, Angriff, Aufklärung)
 *  5. Admin-Nutzer (administrator / Admin!23456) → is_admin=1, FoW-Bypass
 *
 * Nutzung:
 *   docker compose exec -T web php scripts/seed_dev_overview.php [--fleets=40] [--verbose]
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/galaxy_seed.php';
require_once __DIR__ . '/../api/game_engine.php';

// ── CLI-Optionen ─────────────────────────────────────────────────────────────
$fleetTarget = 40;
$verbose     = false;
foreach (array_slice($argv, 1) as $arg) {
    if (preg_match('/^--fleets=(\d+)$/', $arg, $m)) {
        $fleetTarget = max(5, (int)$m[1]);
    }
    if ($arg === '--verbose') {
        $verbose = true;
    }
}

function vlog(string $msg, bool $verbose): void {
    if ($verbose) {
        echo '  ' . $msg . PHP_EOL;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Galaxy-Rotation / Shader-Metadaten
// ─────────────────────────────────────────────────────────────────────────────
function ensure_galaxy_metadata(PDO $db, bool $verbose): string {
    // Tabelle anlegen, falls migrate_galaxies_metadata.sql noch nicht lief
    $db->exec("
        CREATE TABLE IF NOT EXISTS galaxies (
            id TINYINT UNSIGNED PRIMARY KEY,
            name VARCHAR(64) NOT NULL DEFAULT 'Milky Way Core',
            arm_count TINYINT UNSIGNED NOT NULL DEFAULT 4,
            pitch_angle_deg DECIMAL(5,2) NOT NULL DEFAULT 14.00,
            pitch_tangent DECIMAL(8,6) NOT NULL DEFAULT 0.249328,
            radius_ly DECIMAL(10,1) NOT NULL DEFAULT 50000.0,
            arm_start_ly DECIMAL(10,1) NOT NULL DEFAULT 3500.0,
            arm_end_ly DECIMAL(10,1) NOT NULL DEFAULT 45000.0,
            arm_width_ly DECIMAL(8,1) NOT NULL DEFAULT 1500.0,
            disk_height_ly DECIMAL(8,1) NOT NULL DEFAULT 300.0,
            bulge_radius_ly DECIMAL(8,1) NOT NULL DEFAULT 4500.0,
            bulge_fraction DECIMAL(4,3) NOT NULL DEFAULT 0.080,
            rotation_direction_ccw TINYINT(1) NOT NULL DEFAULT 1,
            rotation_period_myr DECIMAL(8,2) NOT NULL DEFAULT 230.0,
            galactic_radius_ly DECIMAL(10,1) NOT NULL DEFAULT 26000.0,
            orbital_velocity_kms DECIMAL(8,1) NOT NULL DEFAULT 220.0,
            escape_velocity_center_kms DECIMAL(8,1) NOT NULL DEFAULT 8000.0,
            escape_velocity_sun_kms DECIMAL(8,1) NOT NULL DEFAULT 500.0,
            smbh_mass_solar DECIMAL(10,1) NOT NULL DEFAULT 4100000.0,
            smbh_tidal_radius_ly DECIMAL(8,1) NOT NULL DEFAULT 0.15,
            seed INT UNSIGNED NOT NULL DEFAULT 42,
            systems_per_galaxy INT UNSIGNED NOT NULL DEFAULT 499,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_name (name)
        ) ENGINE=InnoDB
    ");

    $db->exec("
        INSERT IGNORE INTO galaxies (
            id, name, arm_count, pitch_angle_deg, pitch_tangent,
            radius_ly, arm_start_ly, arm_end_ly, arm_width_ly, disk_height_ly,
            bulge_radius_ly, bulge_fraction,
            rotation_direction_ccw, rotation_period_myr, galactic_radius_ly,
            orbital_velocity_kms, escape_velocity_center_kms, escape_velocity_sun_kms,
            smbh_mass_solar, smbh_tidal_radius_ly, seed, systems_per_galaxy
        ) VALUES (
            1, 'Milky Way Core', 4, 14.00, 0.249328,
            50000.0, 3500.0, 45000.0, 1500.0, 300.0, 4500.0, 0.080,
            1, 230.0, 26000.0,
            220.0, 8000.0, 500.0,
            4100000.0, 0.15, 42, 499
        )
    ");

    $row = $db->query("SELECT name, rotation_direction_ccw FROM galaxies WHERE id = 1 LIMIT 1")
              ->fetch(PDO::FETCH_ASSOC);
    $dir = $row ? ($row['rotation_direction_ccw'] ? 'CCW ↺' : 'CW ↻') : '?';
    vlog('Galaxy "' . ($row['name'] ?? '?') . '" rotation: ' . $dir, $verbose);
    return $dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Monde, Ringe, Kometen, vagabundierende Planeten
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bestimmt, wie viele Monde eine Planetenklasse realistischerweise haben kann.
 */
function moon_count_for_class(string $class, int $seed): int {
    srand($seed);
    return match (true) {
        in_array($class, ['gas_giant', 'hot_jupiter']) => rand(1, 4),
        in_array($class, ['ice_giant'])                => rand(1, 3),
        in_array($class, ['super_earth', 'ocean'])     => rand(0, 1),
        in_array($class, ['rocky', 'lava'])             => rand(0, 1),
        default                                         => 0,
    };
}

/**
 * Gibt an, ob eine Planetenklasse ein Ringsystem haben kann.
 */
function may_have_rings(string $class, int $seed): bool {
    srand($seed + 999);
    return match (true) {
        in_array($class, ['gas_giant', 'hot_jupiter', 'ice_giant']) => rand(0, 2) < 2,
        in_array($class, ['super_earth'])                           => rand(0, 9) === 0,
        default                                                      => false,
    };
}

function seed_secondary_bodies(PDO $db, bool $verbose): array {
    $stats = ['planets_checked' => 0, 'moons' => 0, 'rings' => 0, 'skipped' => 0];

    // 1. Colonized planets (have celestial_bodies entry already)
    $colonized = $db->query(
        "SELECT p.id, p.galaxy, p.`system`, p.position, p.planet_class,
                cb.id AS body_id
         FROM planets p
         JOIN celestial_bodies cb
           ON cb.body_uid = CONCAT('legacy-p-', p.galaxy, '-', p.`system`, '-', p.position)
         WHERE p.planet_class IS NOT NULL
         LIMIT 5000"
    )->fetchAll(PDO::FETCH_ASSOC);

    // 2. Pick up to 200 gas/ice giants that don't have a celestial_bodies entry yet
    $gasGiants = $db->query(
        "SELECT p.id, p.galaxy, p.`system`, p.position, p.planet_class
         FROM planets p
         WHERE p.planet_class IN ('gas_giant','ice_giant','hot_jupiter')
           AND NOT EXISTS (
               SELECT 1 FROM celestial_bodies cb
               WHERE cb.body_uid = CONCAT('legacy-p-', p.galaxy, '-', p.`system`, '-', p.position)
           )
         ORDER BY RAND()
         LIMIT 200"
    )->fetchAll(PDO::FETCH_ASSOC);

    // Create celestial_bodies entries for gas giants + fetch their ids
    if (!empty($gasGiants)) {
        $cbIns = $db->prepare(
            "INSERT IGNORE INTO celestial_bodies
                (body_uid, galaxy_index, system_index, position, body_type, parent_body_type,
                 name, planet_class, can_colonize, payload_json)
             VALUES (?, ?, ?, ?, 'planet', 'star', ?, ?, 0,
                     JSON_OBJECT('origin','dev_seed_gas_giant'))"
        );
        foreach ($gasGiants as &$gg) {
            $uid = sprintf('legacy-p-%d-%d-%d', $gg['galaxy'], $gg['system'], $gg['position']);
            $cbIns->execute([
                $uid, $gg['galaxy'], $gg['system'], $gg['position'],
                'Planet ' . $gg['position'],
                $gg['planet_class'],
            ]);
            $gg['body_id'] = (int)($db->lastInsertId() ?: $db->query(
                "SELECT id FROM celestial_bodies WHERE body_uid='$uid' LIMIT 1"
            )->fetchColumn());
        }
        unset($gg);
    }

    $planets = array_merge($colonized, $gasGiants);

    $moonInsert = $db->prepare(
        "INSERT IGNORE INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position, parent_body_id,
             body_type, parent_body_type, name, planet_class, can_colonize,
             semi_major_axis_parent_r, orbital_period_days, orbital_eccentricity,
             mass_earth, diameter_km, surface_gravity_g, eq_temp_k, payload_json)
         VALUES (?,?,?,NULL,?, 'moon','planet', ?, NULL, 0,
                 ?, ?, ?, ?, ?, ?, ?, JSON_OBJECT('origin','dev_seed'))"
    );

    $ringInsert = $db->prepare(
        "INSERT IGNORE INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position, parent_body_id,
             body_type, parent_body_type, name, can_colonize,
             ring_inner_radius_planet_r, ring_outer_radius_planet_r,
             ring_optical_depth, ring_tilt_deg, ring_composition, payload_json)
         VALUES (?,?,?,NULL,?, 'ring_system','planet', ?, 0,
                 ?, ?, ?, ?, ?, JSON_OBJECT('origin','dev_seed'))"
    );

    // Prüft, ob für diesen Planet schon Monde/Ringe existieren
    $existCheck = $db->prepare(
        "SELECT COUNT(*) FROM celestial_bodies
         WHERE parent_body_id = ? AND body_type IN ('moon','ring_system')"
    );

    foreach ($planets as $planet) {
        $stats['planets_checked']++;
        $g   = (int)$planet['galaxy'];
        $s   = (int)$planet['system'];
        $pos = (int)$planet['position'];
        $bodyId    = (int)$planet['body_id'];
        $class     = (string)$planet['planet_class'];
        $positionSeed = $g * 100000 + $s * 100 + $pos;

        $existCheck->execute([$bodyId]);
        if ((int)$existCheck->fetchColumn() > 0) {
            $stats['skipped']++;
            continue;
        }

        // Monde hinzufügen
        $moonCount = moon_count_for_class($class, $positionSeed);
        for ($mi = 1; $mi <= $moonCount; $mi++) {
            srand($positionSeed * 31 + $mi * 7);
            $moonUid = sprintf('moon-%d-%d-%d-%d', $g, $s, $pos, $mi);
            $sma     = round(5.0 + $mi * rand(3, 8) + rand(0, 5), 1);   // in Planetenradien
            $period  = round(pow($sma / 6.0, 1.5) * 12.0 + rand(0, 10), 2);  // Tage (vereinfacht)
            $ecc     = round(rand(0, 150) / 1000.0, 3);
            $diam    = rand(500, 4000);
            $mass    = round($diam / 12742.0 * 0.07, 5);
            $grav    = round(0.03 + $mass * 8.0, 2);
            $temp    = rand(50, 280);
            $moonName = 'Moon ' . chr(64 + $mi);  // Moon A, Moon B, ...

            $moonInsert->execute([
                $moonUid, $g, $s, $bodyId,
                $moonName,
                $sma, $period, $ecc,
                $mass, $diam, $grav, $temp,
            ]);
            $stats['moons']++;
        }

        // Ring-System
        if (may_have_rings($class, $positionSeed)) {
            srand($positionSeed * 53);
            $ringUid    = sprintf('ring-%d-%d-%d', $g, $s, $pos);
            $innerR     = round(1.5 + rand(0, 10) / 10, 1);
            $outerR     = round($innerR + 0.5 + rand(0, 20) / 10, 1);
            $opacity    = round(0.1 + rand(0, 8) / 10, 2);
            $tilt       = round(rand(0, 27), 1);
            $compositions = ['ice', 'rock', 'dust', 'mixed'];
            $comp       = $compositions[rand(0, 3)];

            $ringInsert->execute([
                $ringUid, $g, $s, $bodyId,
                'Ring System',
                $innerR, $outerR, $opacity, $tilt, $comp,
            ]);
            $stats['rings']++;
        }
    }

    vlog('  Monde: ' . $stats['moons'] . ', Ringe: ' . $stats['rings']
         . ' (' . $stats['planets_checked'] . ' Planeten geprüft, '
         . $stats['skipped'] . ' bereits vorhanden)', $verbose);

    return $stats;
}

/**
 * Fügt vagabundierende Planeten (rogue_planet) und Kometen (comet) ein.
 */
function seed_rogue_bodies(PDO $db, int $count, bool $verbose): int {
    $systemLimit = galaxy_system_limit();
    $insert = $db->prepare(
        "INSERT IGNORE INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position, parent_body_id,
             body_type, parent_body_type, name, planet_class, can_colonize,
             mass_earth, diameter_km, eq_temp_k, payload_json)
         VALUES (?,?,?,NULL,NULL, ?,  'none', ?,  ?, 0, ?, ?, ?, JSON_OBJECT('origin','dev_seed','wanderer',1))"
    );

    $added = 0;
    for ($i = 1; $i <= $count; $i++) {
        srand(0xDEAD0000 + $i);
        $g     = rand(1, GALAXY_MAX);
        $s     = rand(1, $systemLimit);
        $isRogue = ($i % 3 !== 0);
        $type  = $isRogue ? 'rogue_planet' : 'comet';
        $uid   = sprintf('%s-dev-%d', $type, $i);

        if ($type === 'rogue_planet') {
            $name   = 'Rogue-' . strtoupper(base_convert((string)(0xABCD + $i), 10, 36));
            $class  = ['rocky', 'ice_dwarf', 'super_earth'][($i - 1) % 3];
            $diam   = rand(3000, 15000);
            $mass   = round($diam / 12742.0, 4);
            $temp   = rand(20, 80);
        } else {
            $name   = 'Comet-' . strtoupper(base_convert((string)(0xCCCC + $i), 10, 36));
            $class  = 'comet_belt';
            $diam   = rand(5, 500);
            $mass   = 0.0001;
            $temp   = rand(30, 100);
        }

        $insert->execute([$uid, $g, $s, $type, $name, $class, $mass, $diam, $temp]);
        if ($db->lastInsertId() > 0) {
            $added++;
        }
    }

    vlog('Vagabundierende Körper eingefügt: ' . $added . '/' . $count, $verbose);
    return $added;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. NPC seeden (Händler, Piraten, Kolonisten)
// ─────────────────────────────────────────────────────────────────────────────
function seed_npc_cohort(PDO $db, bool $verbose): array {
    // NPC-Typen mit je 10 Exemplaren
    $cohorts = [
        'trader'   => 10,
        'pirate'   => 10,
        'colonist' => 10,
    ];

    $stats = ['created' => 0, 'reused' => 0];

    foreach ($cohorts as $role => $count) {
        for ($i = 1; $i <= $count; $i++) {
            $username = sprintf('dev_npc_%s_%02d', $role, $i);
            $email    = $username . '@dev.local';

            $sel = $db->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
            $sel->execute([$username]);
            $existing = $sel->fetch(PDO::FETCH_ASSOC);

            if ($existing) {
                // Tags in payload für spätere Identifikation
                     $db->prepare("UPDATE users SET is_npc=1, control_type='npc_engine', auth_enabled=0, last_npc_tick=NULL WHERE id=?")
                   ->execute([(int)$existing['id']]);
                $stats['reused']++;
                continue;
            }

            $hash = password_hash('NpcPass!' . $i, PASSWORD_BCRYPT);
            $db->prepare(
                "INSERT INTO users (username, email, password_hash, is_npc, control_type, auth_enabled, protection_until, created_at)
                 VALUES (?, ?, ?, 1, 'npc_engine', 0, DATE_ADD(NOW(), INTERVAL 7 DAY), NOW())"
            )->execute([$username, $email, $hash]);
            $userId = (int)$db->lastInsertId();

            // Homeworld anlegen
            create_seed_homeworld_for_npc($db, $userId, $username, $role);
            $stats['created']++;
        }
    }

    vlog('NPCs: ' . $stats['created'] . ' neu, ' . $stats['reused'] . ' bereits vorhanden', $verbose);
    return $stats;
}

function create_seed_homeworld_for_npc(PDO $db, int $userId, string $username, string $role): void {
    // Galaxy ist bereits gebootstrappt – kein ensure_galaxy_bootstrap_progress nötig.
    $systemLimit = galaxy_system_limit();
    $check = $db->prepare(
        'SELECT c.id FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         WHERE cb.galaxy_index = ? AND cb.system_index = ? AND cb.position = ?'
    );

    $g = $s = $p = 0;
    for ($attempt = 0; $attempt < 60; $attempt++) {
        $g = random_int(1, GALAXY_MAX);
        $s = random_int(1, $systemLimit);
        $p = random_int(1, POSITION_MAX);
        $check->execute([$g, $s, $p]);
        if (!$check->fetch()) {
            break;
        }
        $g = 0;
    }
    if ($g === 0) {
        return; // kein freier Slot
    }

    // Nur das direkte Heimatsystem lazy seeden (nicht 50 umliegende Systeme)
    cache_generated_system($db, $g, $s, false);  // false = keine Planeten-Masseninsertion

    $pCheck = $db->prepare('SELECT id FROM planets WHERE galaxy=? AND `system`=? AND position=?');
    $pCheck->execute([$g, $s, $p]);
    $pRow = $pCheck->fetch(PDO::FETCH_ASSOC);

    if ($pRow) {
        $planetId = (int)$pRow['id'];
    } else {
        $db->prepare("INSERT INTO planets (galaxy, `system`, position, type) VALUES (?,?,?,'terrestrial')")
           ->execute([$g, $s, $p]);
        $planetId = (int)$db->lastInsertId();
    }

    $bodyUid = sprintf('legacy-p-%d-%d-%d', $g, $s, $p);
    $bSel = $db->prepare('SELECT id FROM celestial_bodies WHERE body_uid = ? LIMIT 1');
    $bSel->execute([$bodyUid]);
    $bodyId = (int)($bSel->fetchColumn() ?: 0);
    if ($bodyId === 0) {
        $db->prepare(
            "INSERT INTO celestial_bodies
                (body_uid, galaxy_index, system_index, position, body_type, parent_body_type,
                 name, planet_class, can_colonize, payload_json)
             VALUES (?,?,?,?,'planet','star',?,'terrestrial',1,JSON_OBJECT('legacy_planet_id',?))"
        )->execute([$bodyUid, $g, $s, $p, 'Planet ' . $p, $planetId]);
        $bodyId = (int)$db->lastInsertId();
    }

    $colonyType = match ($role) {
        'trader'  => 'industrial',
        'pirate'  => 'military',
        default   => 'balanced',
    };
    $metal    = match ($role) { 'trader' => 1500.0, 'pirate' => 800.0, default => 1000.0 };
    $crystal  = match ($role) { 'trader' => 1000.0, 'pirate' => 600.0, default => 700.0 };
    $deut     = match ($role) { 'trader' => 700.0,  'pirate' => 400.0, default => 300.0 };

    $db->prepare(
        "INSERT INTO colonies
            (planet_id, body_id, user_id, name, colony_type, is_homeworld,
             metal, crystal, deuterium, rare_earth, food, energy,
             population, max_population, happiness, public_services, last_update)
         VALUES (?,?,?,?,?,1, ?,?,?,0,400,25, 180,800,65,30, NOW())"
    )->execute([$planetId, $bodyId, $userId, $username . ' Base', $colonyType, $metal, $crystal, $deut]);

    $colonyId = (int)$db->lastInsertId();

    // Schiffe nach Rolle
    $ships = match ($role) {
        'trader'  => ['small_cargo' => 5, 'large_cargo' => 2, 'light_fighter' => 3],
        'pirate'  => ['light_fighter' => 8, 'heavy_fighter' => 4, 'cruiser' => 1, 'spy_probe' => 2],
        default   => ['small_cargo' => 3, 'light_fighter' => 4, 'spy_probe' => 1],
    };
    $sIns = $db->prepare(
        'INSERT INTO ships (colony_id, type, count) VALUES (?,?,?) ON DUPLICATE KEY UPDATE count=VALUES(count)'
    );
    foreach ($ships as $type => $count) {
        $sIns->execute([$colonyId, $type, $count]);
    }

    touch_system_visibility($db, $userId, $g, $s, 'own', null, null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Flotten in Bewegung
// ─────────────────────────────────────────────────────────────────────────────
function seed_in_flight_fleets(PDO $db, int $targetCount, bool $verbose): int {
    // Bestehende Dev-Flotten zählen (nicht abgelaufen)
    $existing = (int)$db->query(
        "SELECT COUNT(*) FROM fleets WHERE arrival_time > NOW()"
    )->fetchColumn();

    if ($existing >= $targetCount) {
        vlog('Flotten: ' . $existing . ' bereits aktiv, kein neuer Seed nötig', $verbose);
        return 0;
    }

    $needed = $targetCount - $existing;

    // Kolonien mit mindestens einer Schiffsreihe holen
    $colonies = $db->query(
        "SELECT c.id, c.user_id,
                cb.galaxy_index AS g, cb.system_index AS s, cb.position AS p
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         JOIN ships sh ON sh.colony_id = c.id AND sh.count > 0
         GROUP BY c.id
         ORDER BY RAND()
         LIMIT 150"
    )->fetchAll(PDO::FETCH_ASSOC);

    if (count($colonies) < 2) {
        vlog('Zu wenig Kolonien für Flottenseed', $verbose);
        return 0;
    }

    $systemLimit = galaxy_system_limit();
    $missions    = ['transport', 'transport', 'transport', 'attack', 'spy', 'survey'];
    $shipPresets = [
        'transport' => ['small_cargo' => 3],
        'attack'    => ['light_fighter' => 5, 'heavy_fighter' => 2],
        'spy'       => ['spy_probe' => 2],
        'survey'    => ['spy_probe' => 1, 'small_cargo' => 1],
    ];

    $insert = $db->prepare(
        "INSERT INTO fleets
            (user_id, origin_colony_id, target_galaxy, target_system, target_position,
             mission, ships_json,
             cargo_metal, cargo_crystal, cargo_deuterium,
             origin_x_ly, origin_y_ly, origin_z_ly,
             target_x_ly, target_y_ly, target_z_ly,
             speed_ly_h, distance_ly,
             departure_time, arrival_time, return_time)
         VALUES (?,?,?,?,?, ?,?, 0,0,0, 0,0,0, 0,0,0, 0.5,1.0, ?,?,?)"
    );

    $added = 0;
    $colCount = count($colonies);

    for ($i = 0; $i < $needed && $i < 200; $i++) {
        $origin = $colonies[$i % $colCount];

        // Zufälliges Ziel (anderes System)
        $tg = random_int(1, GALAXY_MAX);
        $ts = random_int(1, $systemLimit);
        $tp = random_int(1, POSITION_MAX);

        $mission = $missions[array_rand($missions)];
        $ships   = $shipPresets[$mission];

        // Abflug: 10-90 Minuten in der Vergangenheit
        $depOffset  = random_int(600, 5400);
        // Ankunft: 15-180 Minuten in der Zukunft (damit Flotten sichtbar sind)
        $arrOffset  = random_int(900, 10800);
        $retOffset  = $depOffset + $arrOffset * 2;

        $now  = time();
        $dep  = date('Y-m-d H:i:s', $now - $depOffset);
        $arr  = date('Y-m-d H:i:s', $now + $arrOffset);
        $ret  = date('Y-m-d H:i:s', $now + $retOffset);

        $insert->execute([
            (int)$origin['user_id'],
            (int)$origin['id'],
            $tg, $ts, $tp,
            $mission,
            json_encode($ships),
            $dep, $arr, $ret,
        ]);
        $added++;
    }

    vlog('Neue Flotten geseedet: ' . $added . ' (gesamt aktiv: ' . ($existing + $added) . ')', $verbose);
    return $added;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Administrator-User + omniszienter FoW-Bypass
// ─────────────────────────────────────────────────────────────────────────────
function ensure_administrator(PDO $db, bool $verbose): int {
    $sel = $db->prepare("SELECT id, is_admin FROM users WHERE username = 'administrator' LIMIT 1");
    $sel->execute();
    $user = $sel->fetch(PDO::FETCH_ASSOC);

    if ($user) {
        $adminId = (int)$user['id'];
        if ((int)$user['is_admin'] !== 1) {
            $db->prepare("UPDATE users SET is_admin=1 WHERE id=?")->execute([$adminId]);
            vlog('Administrator: is_admin auf 1 gesetzt', $verbose);
        } else {
            vlog('Administrator: bereits vorhanden (is_admin=1)', $verbose);
        }
    } else {
        $hash = password_hash('Admin!23456', PASSWORD_BCRYPT);
        $db->prepare(
            "INSERT INTO users (username, email, password_hash, is_admin, protection_until, created_at)
             VALUES ('administrator','administrator@local.dev',?,1,DATE_ADD(NOW(),INTERVAL 365 DAY),NOW())"
        )->execute([$hash]);
        $adminId = (int)$db->lastInsertId();
        vlog('Administrator: Nutzer neu angelegt', $verbose);
    }

    // Homeworld sicherstellen
    $hwCheck = $db->prepare("SELECT id FROM colonies WHERE user_id=? AND is_homeworld=1 LIMIT 1");
    $hwCheck->execute([$adminId]);
    if (!$hwCheck->fetch()) {
        create_seed_homeworld_for_npc($db, $adminId, 'administrator', 'colonist');
        vlog('Administrator: Homeworld angelegt', $verbose);
    }

    // Der FoW-Bypass ist code-seitig in api/galaxy.php bereits implementiert:
    // is_admin_user() → visibility_level = 'own' für alle Sterne.
    // Keine DB-Einträge nötig – der Admin sieht automatisch alles.

    return $adminId;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
$db  = get_db();
$t0  = microtime(true);

echo '═══════════════════════════════════════════════════════' . PHP_EOL;
echo '  GalaxyQuest – Dev-Overview Seed' . PHP_EOL;
echo '═══════════════════════════════════════════════════════' . PHP_EOL;

// 1. Galaxy-Metadaten
echo PHP_EOL . '[1/5] Galaxy-Rotation & Shader-Metadaten ...' . PHP_EOL;
$rotDir = ensure_galaxy_metadata($db, $verbose);
echo '      Rotation: ' . $rotDir . PHP_EOL;

// 2. Monde, Ringe, vagabundierende Körper
// 2. NPC-Kohorten ZUERST (damit celestial_bodies für Planeten existieren)
echo PHP_EOL . '[2/5] NPC-Kohorten (Händler / Piraten / Kolonisten) ...' . PHP_EOL;
$npcStats = seed_npc_cohort($db, $verbose);
echo sprintf(
    '      NPCs: %d neu, %d bereits vorhanden',
    $npcStats['created'], $npcStats['reused']
) . PHP_EOL;

// 3. Monde, Ringe, vagabundierende Körper (jetzt gibt es Planet-Bodies)
echo PHP_EOL . '[3/5] Monde, Ringe, Kometen, Vagabunden ...' . PHP_EOL;
$bodyStats = seed_secondary_bodies($db, $verbose);
$rogueAdded = seed_rogue_bodies($db, 30, $verbose);
echo sprintf(
    '      Monde: +%d | Ringe: +%d | Vagabunden: +%d',
    $bodyStats['moons'], $bodyStats['rings'], $rogueAdded
) . PHP_EOL;

// 4. Flotten in Bewegung
echo PHP_EOL . '[4/5] Flotten in Bewegung ...' . PHP_EOL;
$fleetAdded = seed_in_flight_fleets($db, $fleetTarget, $verbose);
$fleetTotal = (int)$db->query("SELECT COUNT(*) FROM fleets WHERE arrival_time > NOW()")->fetchColumn();
echo sprintf(
    '      Flotten: +%d neu | %d aktiv gesamt (Ziel: %d)',
    $fleetAdded, $fleetTotal, $fleetTarget
) . PHP_EOL;

// 5. Administrator
echo PHP_EOL . '[5/5] Administrator-Account (FoW-Bypass) ...' . PHP_EOL;
$adminId = ensure_administrator($db, $verbose);
echo '      User-ID: ' . $adminId . ' | Login: administrator / Admin!23456' . PHP_EOL;
echo '      FoW-Bypass: aktiv (is_admin_user() in api/galaxy.php zeigt alles)' . PHP_EOL;

// Zusammenfassung
$duration = round(microtime(true) - $t0, 2);
$totals = [
    'celestial_bodies' => (int)$db->query("SELECT COUNT(*) FROM celestial_bodies")->fetchColumn(),
    'moons'            => (int)$db->query("SELECT COUNT(*) FROM celestial_bodies WHERE body_type='moon'")->fetchColumn(),
    'rings'            => (int)$db->query("SELECT COUNT(*) FROM celestial_bodies WHERE body_type='ring_system'")->fetchColumn(),
    'rogue_planets'    => (int)$db->query("SELECT COUNT(*) FROM celestial_bodies WHERE body_type='rogue_planet'")->fetchColumn(),
    'comets'           => (int)$db->query("SELECT COUNT(*) FROM celestial_bodies WHERE body_type='comet'")->fetchColumn(),
    'npc_users'        => (int)$db->query("SELECT COUNT(*) FROM users WHERE control_type='npc_engine'")->fetchColumn(),
    'colonies'         => (int)$db->query("SELECT COUNT(*) FROM colonies")->fetchColumn(),
    'fleets_active'    => (int)$db->query("SELECT COUNT(*) FROM fleets WHERE arrival_time > NOW()")->fetchColumn(),
    'admin_users'      => (int)$db->query("SELECT COUNT(*) FROM users WHERE is_admin=1")->fetchColumn(),
];

echo PHP_EOL;
echo '═══════════════════════════════════════════════════════' . PHP_EOL;
echo '  Zusammenfassung (' . $duration . 's)' . PHP_EOL;
echo '═══════════════════════════════════════════════════════' . PHP_EOL;
echo json_encode($totals, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . PHP_EOL;
