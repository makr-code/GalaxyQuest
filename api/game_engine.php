<?php
/**
 * Core game engine: resource production, building costs, ship stats, etc.
 */

// ─── Resource production (per hour) ─────────────────────────────────────────

function metal_production(int $level): float {
    return 30 * $level * pow(1.1, $level) * GAME_SPEED;
}

function crystal_production(int $level): float {
    return 20 * $level * pow(1.1, $level) * GAME_SPEED;
}

function deuterium_production(int $level, int $tempMax): float {
    return max(0, 10 * $level * pow(1.1, $level) * (1.44 - 0.004 * $tempMax)) * GAME_SPEED;
}

function solar_energy(int $level): float {
    return 20 * $level * pow(1.1, $level);
}

function fusion_energy(int $level): float {
    return 30 * $level * pow(1.05 + 0.01 * $level, $level);
}

// ─── Storage caps ────────────────────────────────────────────────────────────

function storage_cap(int $level): float {
    return 5000 * round(2.5 * exp(20 * $level / 33));
}

// ─── Building costs ──────────────────────────────────────────────────────────

function building_cost(string $type, int $nextLevel): array {
    $base = BUILDING_BASE_COST[$type] ?? ['metal' => 60, 'crystal' => 15, 'deuterium' => 0];
    $f    = BUILDING_COST_FACTOR[$type] ?? 1.5;
    return [
        'metal'     => (int)round($base['metal']     * pow($f, $nextLevel - 1)),
        'crystal'   => (int)round($base['crystal']   * pow($f, $nextLevel - 1)),
        'deuterium' => (int)round($base['deuterium'] * pow($f, $nextLevel - 1)),
    ];
}

function building_build_time(array $cost, int $robotics, int $nanite): int {
    $hours = ($cost['metal'] + $cost['crystal'])
           / (2500 * (1 + $robotics) * pow(2, $nanite) * GAME_SPEED);
    return max(1, (int)round($hours * 3600));
}

// ─── Research costs ──────────────────────────────────────────────────────────

function research_cost(string $type, int $nextLevel): array {
    $base = RESEARCH_BASE_COST[$type] ?? ['metal' => 0, 'crystal' => 800, 'deuterium' => 400];
    $f    = 2.0;
    return [
        'metal'     => (int)round($base['metal']     * pow($f, $nextLevel - 1)),
        'crystal'   => (int)round($base['crystal']   * pow($f, $nextLevel - 1)),
        'deuterium' => (int)round($base['deuterium'] * pow($f, $nextLevel - 1)),
    ];
}

function research_time(array $cost, int $labLevel): int {
    $hours = ($cost['metal'] + $cost['crystal'])
           / (1000 * (1 + $labLevel) * GAME_SPEED);
    return max(1, (int)round($hours * 3600));
}

// ─── Ship costs / stats ──────────────────────────────────────────────────────

function ship_cost(string $type): array {
    return SHIP_STATS[$type]['cost'] ?? ['metal' => 0, 'crystal' => 0, 'deuterium' => 0];
}

function ship_cargo(string $type): int {
    return SHIP_STATS[$type]['cargo'] ?? 0;
}

function ship_speed(string $type): int {
    return SHIP_STATS[$type]['speed'] ?? 1000;
}

function fleet_speed(array $ships): int {
    $min = PHP_INT_MAX;
    foreach ($ships as $type => $count) {
        if ($count > 0) {
            $min = min($min, ship_speed($type));
        }
    }
    return $min === PHP_INT_MAX ? 1000 : $min;
}

function fleet_travel_time(int $distance, int $speed): int {
    return max(1, (int)round(35000 / GAME_SPEED * sqrt($distance * 10 / $speed) + 10));
}

function coordinate_distance(int $g1, int $s1, int $p1, int $g2, int $s2, int $p2): int {
    if ($g1 !== $g2) return 20000 + abs($g1 - $g2) * 40000 / GALAXY_MAX;
    if ($s1 !== $s2) return 2700 + abs($s1 - $s2) * 95;
    return 1000 + abs($p1 - $p2) * 5;
}

// ─── Planet resource update ───────────────────────────────────────────────────

function update_planet_resources(PDO $db, int $planetId): void {
    $planet = $db->prepare(
        'SELECT p.*, b_mm.level AS metal_mine_level,
                b_cm.level AS crystal_mine_level,
                b_ds.level AS deuterium_synth_level,
                b_sp.level AS solar_plant_level,
                b_fr.level AS fusion_reactor_level,
                b_ms.level AS metal_storage_level,
                b_cs.level AS crystal_storage_level,
                b_dt.level AS deuterium_tank_level
         FROM planets p
         LEFT JOIN buildings b_mm ON b_mm.planet_id = p.id AND b_mm.type = \'metal_mine\'
         LEFT JOIN buildings b_cm ON b_cm.planet_id = p.id AND b_cm.type = \'crystal_mine\'
         LEFT JOIN buildings b_ds ON b_ds.planet_id = p.id AND b_ds.type = \'deuterium_synth\'
         LEFT JOIN buildings b_sp ON b_sp.planet_id = p.id AND b_sp.type = \'solar_plant\'
         LEFT JOIN buildings b_fr ON b_fr.planet_id = p.id AND b_fr.type = \'fusion_reactor\'
         LEFT JOIN buildings b_ms ON b_ms.planet_id = p.id AND b_ms.type = \'metal_storage\'
         LEFT JOIN buildings b_cs ON b_cs.planet_id = p.id AND b_cs.type = \'crystal_storage\'
         LEFT JOIN buildings b_dt ON b_dt.planet_id = p.id AND b_dt.type = \'deuterium_tank\'
         WHERE p.id = ?'
    );
    $planet->execute([$planetId]);
    $row = $planet->fetch();
    if (!$row) return;

    $last   = strtotime($row['last_update']);
    $now    = time();
    $deltaH = ($now - $last) / 3600.0;
    if ($deltaH <= 0) return;

    $mmL = (int)($row['metal_mine_level']       ?? 0);
    $cmL = (int)($row['crystal_mine_level']      ?? 0);
    $dsL = (int)($row['deuterium_synth_level']   ?? 0);
    $spL = (int)($row['solar_plant_level']       ?? 0);
    $frL = (int)($row['fusion_reactor_level']    ?? 0);
    $msL = (int)($row['metal_storage_level']     ?? 0);
    $csL = (int)($row['crystal_storage_level']   ?? 0);
    $dtL = (int)($row['deuterium_tank_level']    ?? 0);

    $energyProd = solar_energy($spL) + fusion_energy($frL);
    $energyReq  = metal_production_energy($mmL)
                + crystal_production_energy($cmL)
                + deuterium_production_energy($dsL);
    $efficiency = $energyReq > 0 ? min(1.0, $energyProd / $energyReq) : 1.0;

    $metalProd     = metal_production($mmL)                         * $efficiency;
    $crystalProd   = crystal_production($cmL)                       * $efficiency;
    $deuteriumProd = deuterium_production($dsL, $row['temp_max'])   * $efficiency;

    $metalCap     = storage_cap($msL);
    $crystalCap   = storage_cap($csL);
    $deuteriumCap = storage_cap($dtL);

    $newMetal     = min($metalCap,     (float)$row['metal']     + $metalProd    * $deltaH);
    $newCrystal   = min($crystalCap,   (float)$row['crystal']   + $crystalProd  * $deltaH);
    $newDeuterium = min($deuteriumCap, (float)$row['deuterium'] + $deuteriumProd * $deltaH);
    $newEnergy    = (int)round($energyProd - $energyReq);

    $db->prepare(
        'UPDATE planets SET metal = ?, crystal = ?, deuterium = ?, energy = ?,
                            last_update = FROM_UNIXTIME(?)
         WHERE id = ?'
    )->execute([$newMetal, $newCrystal, $newDeuterium, $newEnergy, $now, $planetId]);
}

function update_all_planets(PDO $db, int $userId): void {
    $stmt = $db->prepare('SELECT id FROM planets WHERE user_id = ?');
    $stmt->execute([$userId]);
    foreach ($stmt->fetchAll() as $row) {
        update_planet_resources($db, (int)$row['id']);
    }
}

// Energy consumption of mines
function metal_production_energy(int $level): float {
    return 10 * $level * pow(1.1, $level);
}
function crystal_production_energy(int $level): float {
    return 10 * $level * pow(1.1, $level);
}
function deuterium_production_energy(int $level): float {
    return 20 * $level * pow(1.1, $level);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BUILDING_BASE_COST = [
    'metal_mine'       => ['metal' =>    60, 'crystal' =>    15, 'deuterium' =>  0],
    'crystal_mine'     => ['metal' =>    48, 'crystal' =>    24, 'deuterium' =>  0],
    'deuterium_synth'  => ['metal' =>   225, 'crystal' =>    75, 'deuterium' =>  0],
    'solar_plant'      => ['metal' =>    75, 'crystal' =>    30, 'deuterium' =>  0],
    'fusion_reactor'   => ['metal' =>   900, 'crystal' =>   360, 'deuterium' => 180],
    'robotics_factory' => ['metal' =>   400, 'crystal' =>   120, 'deuterium' =>  0],
    'shipyard'         => ['metal' =>   400, 'crystal' =>   200, 'deuterium' => 100],
    'metal_storage'    => ['metal' =>  1000, 'crystal' =>     0, 'deuterium' =>  0],
    'crystal_storage'  => ['metal' =>  1000, 'crystal' =>   500, 'deuterium' =>  0],
    'deuterium_tank'   => ['metal' =>  1000, 'crystal' =>  1000, 'deuterium' =>  0],
    'research_lab'     => ['metal' =>   200, 'crystal' =>   400, 'deuterium' => 200],
    'missile_silo'     => ['metal' =>  20000,'crystal' => 20000, 'deuterium' =>  0],
    'nanite_factory'   => ['metal' =>1000000,'crystal' =>500000, 'deuterium' =>100000],
    'terraformer'      => ['metal' =>  0,    'crystal' =>50000,  'deuterium' =>100000],
];

const BUILDING_COST_FACTOR = [
    'metal_mine'       => 1.5,
    'crystal_mine'     => 1.6,
    'deuterium_synth'  => 1.5,
    'solar_plant'      => 1.5,
    'fusion_reactor'   => 1.8,
    'robotics_factory' => 2.0,
    'shipyard'         => 2.0,
    'metal_storage'    => 2.0,
    'crystal_storage'  => 2.0,
    'deuterium_tank'   => 2.0,
    'research_lab'     => 2.0,
    'missile_silo'     => 2.0,
    'nanite_factory'   => 2.0,
    'terraformer'      => 2.0,
];

const RESEARCH_BASE_COST = [
    'energy_tech'             => ['metal' =>    0, 'crystal' =>  800, 'deuterium' =>  400],
    'laser_tech'              => ['metal' =>  200, 'crystal' =>  100, 'deuterium' =>    0],
    'ion_tech'                => ['metal' => 1000, 'crystal' =>  300, 'deuterium' =>  100],
    'hyperspace_tech'         => ['metal' =>    0, 'crystal' => 4000, 'deuterium' => 2000],
    'plasma_tech'             => ['metal' => 2000, 'crystal' => 4000, 'deuterium' => 1000],
    'combustion_drive'        => ['metal' =>  400, 'crystal' =>    0, 'deuterium' =>  600],
    'impulse_drive'           => ['metal' => 2000, 'crystal' => 4000, 'deuterium' =>  600],
    'hyperspace_drive'        => ['metal' => 10000,'crystal' =>20000, 'deuterium' =>  600],
    'espionage_tech'          => ['metal' =>  200, 'crystal' => 1000, 'deuterium' =>  200],
    'computer_tech'           => ['metal' =>    0, 'crystal' =>  400, 'deuterium' =>  600],
    'astrophysics'            => ['metal' => 4000, 'crystal' => 8000, 'deuterium' => 4000],
    'intergalactic_network'   => ['metal' =>240000,'crystal'=>400000, 'deuterium' =>160000],
    'graviton_tech'           => ['metal' =>    0, 'crystal' =>    0, 'deuterium' =>    0],
    'weapons_tech'            => ['metal' =>  800, 'crystal' =>  200, 'deuterium' =>    0],
    'shielding_tech'          => ['metal' =>  200, 'crystal' =>  600, 'deuterium' =>    0],
    'armor_tech'              => ['metal' =>  800, 'crystal' =>    0, 'deuterium' =>    0],
];

const SHIP_STATS = [
    'small_cargo'      => ['cost' => ['metal' => 2000, 'crystal' => 2000, 'deuterium' =>    0], 'cargo' =>  5000, 'speed' => 5000,  'attack' =>   5, 'shield' =>  10, 'hull' =>  4000],
    'large_cargo'      => ['cost' => ['metal' => 6000, 'crystal' => 6000, 'deuterium' =>    0], 'cargo' => 25000, 'speed' => 7500,  'attack' =>   5, 'shield' =>  25, 'hull' => 12000],
    'light_fighter'    => ['cost' => ['metal' => 3000, 'crystal' => 1000, 'deuterium' =>    0], 'cargo' =>    50, 'speed' =>12500,  'attack' =>  50, 'shield' =>  10, 'hull' =>  4000],
    'heavy_fighter'    => ['cost' => ['metal' => 6000, 'crystal' => 4000, 'deuterium' =>    0], 'cargo' =>   100, 'speed' =>10000,  'attack' => 150, 'shield' =>  25, 'hull' => 10000],
    'cruiser'          => ['cost' => ['metal' =>20000, 'crystal' => 7000, 'deuterium' => 2000], 'cargo' =>   800, 'speed' =>15000,  'attack' => 400, 'shield' =>  50, 'hull' => 27000],
    'battleship'       => ['cost' => ['metal' =>45000, 'crystal' =>15000, 'deuterium' =>    0], 'cargo' =>  1500, 'speed' =>10000,  'attack' =>1000, 'shield' => 200, 'hull' => 60000],
    'battlecruiser'    => ['cost' => ['metal' =>30000, 'crystal' =>40000, 'deuterium' =>15000], 'cargo' =>   750, 'speed' =>10000,  'attack' => 700, 'shield' => 400, 'hull' => 70000],
    'bomber'           => ['cost' => ['metal' =>50000, 'crystal' =>25000, 'deuterium' =>15000], 'cargo' =>   500, 'speed' =>  4000, 'attack' =>1000, 'shield' => 500, 'hull' => 75000],
    'destroyer'        => ['cost' => ['metal' =>60000, 'crystal' =>50000, 'deuterium' =>15000], 'cargo' =>  2000, 'speed' =>  5000, 'attack' =>2000, 'shield' => 500, 'hull' =>110000],
    'death_star'       => ['cost' => ['metal' =>5000000,'crystal'=>4000000,'deuterium'=>1000000],'cargo'=>1000000,'speed' =>   100, 'attack' =>200000,'shield'=>50000, 'hull' =>9000000],
    'reaper'           => ['cost' => ['metal' =>85000, 'crystal' =>55000, 'deuterium' =>20000], 'cargo' =>  7000, 'speed' =>  7000, 'attack' =>2800, 'shield' => 700, 'hull' =>140000],
    'pathfinder'       => ['cost' => ['metal' =>8000,  'crystal' => 15000, 'deuterium' =>  0],  'cargo' =>10000, 'speed' => 12000, 'attack' => 200, 'shield' => 100, 'hull' => 23000],
    'espionage_probe'  => ['cost' => ['metal' =>    0, 'crystal' =>  1000, 'deuterium' =>    0], 'cargo' =>     5, 'speed' => 500000 /* near-instant */, 'attack' =>0,'shield' =>0.01,'hull' =>1000],
    'solar_satellite'  => ['cost' => ['metal' =>    0, 'crystal' =>  2000, 'deuterium' =>  500], 'cargo' =>     0, 'speed' =>     0, 'attack' =>   1, 'shield' =>   1, 'hull' =>  2000],
    'colony_ship'      => ['cost' => ['metal' =>10000, 'crystal' =>20000, 'deuterium' =>10000], 'cargo' =>  7500, 'speed' =>  2500, 'attack' =>  50, 'shield' => 100, 'hull' => 30000],
    'recycler'         => ['cost' => ['metal' =>10000, 'crystal' => 6000, 'deuterium' =>  2000], 'cargo' => 20000, 'speed' =>  2000, 'attack' =>   1, 'shield' =>  10, 'hull' => 16000],
];
