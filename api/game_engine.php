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

// ─── Fleet 3-D Newtonian physics ─────────────────────────────────────────────

/**
 * Ship speed-unit → ly/h conversion factor.
 * A Light Fighter (12 500 units) travels at 2 500 ly/h.
 * An Espionage Probe (500 000 units) travels at 100 000 ly/h.
 */
const FLEET_SPEED_FACTOR = 0.2;

/**
 * Return fleet speed in ly/h from a ships map {type => count}.
 * The slowest ship type determines the fleet speed (bottleneck).
 */
function fleet_speed_ly_h(array $ships): float {
    $min = PHP_INT_MAX;
    foreach ($ships as $type => $count) {
        if ($count > 0) $min = min($min, ship_speed($type));
    }
    $units = ($min === PHP_INT_MAX) ? 1000 : $min;
    return max(0.001, $units * FLEET_SPEED_FACTOR * GAME_SPEED);
}

/** Euclidean 3-D distance in light-years between two points. */
function fleet_3d_distance(float $x1, float $y1, float $z1,
                            float $x2, float $y2, float $z2): float {
    return sqrt(($x2-$x1)**2 + ($y2-$y1)**2 + ($z2-$z1)**2);
}

/** Travel time in seconds given a 3-D distance (ly) and speed (ly/h). */
function fleet_travel_time_3d(float $distance_ly, float $speed_ly_h): int {
    if ($speed_ly_h <= 0) return 86400; // fallback: 1 day
    // Intra-system hops (< 0.01 ly) get a minimum of 30 s
    return max(30, (int)round($distance_ly / $speed_ly_h * 3600));
}

/**
 * Interpolate current 3-D fleet position based on elapsed time.
 * Returns ['x' => float, 'y' => float, 'z' => float, 'progress' => 0..1].
 */
function fleet_current_position(array $fleet, ?int $now = null): array {
    $now       = $now ?? time();
    $departure = strtotime($fleet['departure_time']);
    $arrival   = strtotime($fleet['arrival_time']);
    $total     = max(1, $arrival - $departure);
    $elapsed   = $now - $departure;
    $t         = max(0.0, min(1.0, $elapsed / $total));

    $ox = (float)($fleet['origin_x_ly'] ?? 0);
    $oy = (float)($fleet['origin_y_ly'] ?? 0);
    $oz = (float)($fleet['origin_z_ly'] ?? 0);
    $tx = (float)($fleet['target_x_ly'] ?? 0);
    $ty = (float)($fleet['target_y_ly'] ?? 0);
    $tz = (float)($fleet['target_z_ly'] ?? 0);

    return [
        'x'        => round($ox + ($tx - $ox) * $t, 2),
        'y'        => round($oy + ($ty - $oy) * $t, 2),
        'z'        => round($oz + ($tz - $oz) * $t, 2),
        'progress' => round($t, 4),
    ];
}

/**
 * Look up cached 3-D galactic coordinates for a game-grid (galaxy, system).
 * Queries star_systems first; falls back to a fast deterministic approximation
 * so fleet.php never needs to include the full galaxy generator.
 *
 * The fallback uses the same logarithmic-spiral geometry as galaxy_gen.php
 * but is self-contained (no extra includes required).
 */
function get_system_3d_coords(PDO $db, int $g, int $s): array {
    $row = $db->prepare('SELECT x_ly, y_ly, z_ly FROM star_systems WHERE galaxy_index=? AND system_index=?');
    $row->execute([$g, $s]);
    $cached = $row->fetch();
    if ($cached) {
        return [(float)$cached['x_ly'], (float)$cached['y_ly'], (float)$cached['z_ly']];
    }
    // Fast deterministic approximation (logarithmic spiral, same constants as galaxy_gen.php)
    $arms      = 4;
    $b         = tan(deg2rad(14.0));
    $r0        = 3500.0;
    $rEnd      = 45000.0;
    $armIdx    = ($g - 1) % $arms;
    $bandFrac  = (int)(($g - 1) / $arms) / 2.0;
    $rMin      = $r0 + $bandFrac * ($rEnd - $r0) * 0.5;
    $rMax      = $rMin + ($rEnd - $r0) * 0.5;
    $sysMax    = defined('SYSTEM_MAX') ? SYSTEM_MAX : 499;
    $t         = ($sysMax > 1) ? ($s - 1) / ($sysMax - 1) : 0.5;
    $r         = $rMin + $t * ($rMax - $rMin);
    $theta     = log($r / $r0) / $b + $armIdx * (2.0 * M_PI / $arms);
    return [round($r * cos($theta), 2), round($r * sin($theta), 2), 0.0];
}

// ─── Leader bonus helpers ─────────────────────────────────────────────────────

/**
 * Apply colony-manager production bonus.
 * +3% per skill_production level (max 10 → +30%).
 */
function leader_production_bonus(float $base, int $skillLevel): float {
    return $base * (1.0 + 0.03 * min(10, $skillLevel));
}

/**
 * Apply colony-manager construction time reduction.
 * -2% per skill_construction level (max 10 → -20%).
 */
function leader_build_time(int $secs, int $skillLevel): int {
    return max(1, (int)round($secs * (1.0 - 0.02 * min(10, $skillLevel))));
}

/**
 * Apply science-director research time reduction.
 * -3% per skill_research level (max 10 → -30%).
 */
function leader_research_time(int $secs, int $skillLevel): int {
    return max(1, (int)round($secs * (1.0 - 0.03 * min(10, $skillLevel))));
}

/**
 * Apply science-director cost reduction.
 * -2% per skill_efficiency level (max 10 → -20%).
 */
function leader_research_cost(array $cost, int $skillLevel): array {
    $f = max(0.01, 1.0 - 0.02 * min(10, $skillLevel));
    return [
        'metal'     => (int)round($cost['metal']     * $f),
        'crystal'   => (int)round($cost['crystal']   * $f),
        'deuterium' => (int)round($cost['deuterium'] * $f),
    ];
}

/**
 * Apply fleet-commander speed bonus to ly/h.
 * +2% per skill_navigation level (max 10 → +20%).
 */
function leader_fleet_speed(float $speed_ly_h, int $skillLevel): float {
    return $speed_ly_h * (1.0 + 0.02 * min(10, $skillLevel));
}

/**
 * Apply fleet-commander combat attack bonus.
 * +3% per skill_tactics level (max 10 → +30%).
 */
function leader_combat_attack(float $attack, int $skillLevel): float {
    return $attack * (1.0 + 0.03 * min(10, $skillLevel));
}

/**
 * Award XP to a leader and level them up if the threshold is reached.
 * Level threshold: level^2 * 100 XP.
 */
function leader_award_xp(PDO $db, int $leaderId, int $xp): void {
    $row = $db->prepare('SELECT level, xp FROM leaders WHERE id = ?');
    $row->execute([$leaderId]);
    $l = $row->fetch();
    if (!$l) return;
    $newXp    = (int)$l['xp'] + $xp;
    $newLevel = (int)$l['level'];
    while ($newXp >= $newLevel * $newLevel * 100 && $newLevel < 10) {
        $newXp   -= $newLevel * $newLevel * 100;
        $newLevel++;
    }
    $db->prepare('UPDATE leaders SET xp=?, level=? WHERE id=?')
       ->execute([$newXp, $newLevel, $leaderId]);
}

/**
 * Get the leader assigned to a colony for a given role, or null.
 */
function get_colony_leader(PDO $db, int $colonyId, string $role): ?array {
    $stmt = $db->prepare(
        'SELECT * FROM leaders WHERE colony_id = ? AND role = ? AND autonomy > 0 LIMIT 1'
    );
    $stmt->execute([$colonyId, $role]);
    $r = $stmt->fetch();
    return $r ?: null;
}

/**
 * Get the leader assigned to a fleet, or null.
 */
function get_fleet_leader(PDO $db, int $fleetId): ?array {
    $stmt = $db->prepare(
        'SELECT * FROM leaders WHERE fleet_id = ? AND role = \'fleet_commander\' LIMIT 1'
    );
    $stmt->execute([$fleetId]);
    $r = $stmt->fetch();
    return $r ?: null;
}

// ─── Colony resource update ───────────────────────────────────────────────────

// ─── Food & population production helpers ────────────────────────────────────

/** Hydroponic farm food output (units/h). Level 1 → 40/h, +30/h per level. */
function food_production(int $level): float {
    return $level > 0 ? 10 * $level * (1 + 0.3 * $level) : 0;
}

/** Food storage capacity from food_silo buildings. */
function food_storage_cap(int $siloLevel): float {
    return 1000 + $siloLevel * 500;
}

/** Rare-earth drill output (units/h). */
function rare_earth_production(int $level): float {
    return $level > 0 ? 2 * $level * (1 + 0.2 * $level) : 0;
}

/** Habitat building capacity contribution: +200 population per level. */
function habitat_capacity(int $level): int {
    return 200 * $level;
}

/**
 * Compute colony happiness (0–100) from food coverage, energy balance,
 * and public-services index.
 *
 * @param float $foodCoverage  ratio of food produced / food consumed (0..2+, clamped)
 * @param int   $energyBalance surplus energy (negative = brownout)
 * @param int   $publicServices  0–100 public-services index
 */
function compute_happiness(float $foodCoverage, int $energyBalance, int $publicServices): int {
    // Food satisfaction: 0 = starving (-30), 1 = neutral, 2 = abundant (+15)
    $foodScore  = min(100, max(0, (int)round(50 + ($foodCoverage - 1.0) * 40)));
    // Energy satisfaction: shortage reduces happiness
    $energyScore = $energyBalance >= 0 ? 100 : max(0, 100 + $energyBalance * 2);
    // Blend: food 40%, energy 30%, services 30%
    return min(100, max(0, (int)round($foodScore * 0.4 + $energyScore * 0.3 + $publicServices * 0.3)));
}

/**
 * Compute public-services index (0–100) from hospital, school, security_post
 * building levels relative to population.
 */
function compute_public_services(int $hospitalL, int $schoolL, int $securityL, int $population): int {
    if ($population <= 0) return 100;
    // Each level covers ~200 people
    $coverage = min(1.0, ($hospitalL + $schoolL + $securityL) * 200 / $population);
    return (int)round($coverage * 100);
}

/**
 * Productivity multiplier from happiness (0.5 at 0%, 1.0 at 70%, 1.25 at 100%).
 */
function happiness_productivity(int $happiness): float {
    if ($happiness >= 70) return 1.0 + ($happiness - 70) / 120.0;
    return max(0.5, 0.5 + $happiness / 140.0);
}

/**
 * Population growth per hour.
 * Growth is logistic: fast when population << max_population, slows near cap.
 * Requires happiness >= 40 and food coverage >= 0.8.
 *
 * @return int  people added per hour (can be negative if starving)
 */
function population_growth(int $population, int $maxPopulation, int $happiness, float $foodCoverage): int {
    if ($population <= 0 || $maxPopulation <= 0) return 0;
    if ($foodCoverage < 0.3) {
        // Starvation: population shrinks
        return -(int)round($population * 0.005);
    }
    if ($happiness < 30) {
        return -(int)round($population * 0.002);
    }
    $roomFraction = max(0.0, 1.0 - $population / $maxPopulation);
    $base         = $population * 0.002 * $roomFraction; // 0.2% per hour max
    $happinessF   = max(0.0, ($happiness - 40) / 60.0);  // 0 at 40%, 1 at 100%
    $foodF        = min(1.0, ($foodCoverage - 0.8) / 0.7); // 0 at 80% food, 1 at 150%
    return (int)round($base * $happinessF * max(0.0, $foodF));
}

function update_colony_resources(PDO $db, int $colonyId): void {
    $stmt = $db->prepare(
        'SELECT c.id, c.metal, c.crystal, c.deuterium, c.rare_earth, c.food,
                c.energy, c.population, c.max_population, c.happiness,
                c.public_services, c.last_update, c.colony_type,
                p.temp_max, p.richness_metal, p.richness_crystal,
                p.richness_deuterium, p.richness_rare_earth,
                p.deposit_metal, p.deposit_crystal,
                p.deposit_deuterium, p.deposit_rare_earth,
                b_mm.level  AS metal_mine_level,
                b_cm.level  AS crystal_mine_level,
                b_ds.level  AS deuterium_synth_level,
                b_sp.level  AS solar_plant_level,
                b_fr.level  AS fusion_reactor_level,
                b_ms.level  AS metal_storage_level,
                b_cs.level  AS crystal_storage_level,
                b_dt.level  AS deuterium_tank_level,
                b_re.level  AS rare_earth_drill_level,
                b_hf.level  AS hydroponic_farm_level,
                b_fs.level  AS food_silo_level,
                b_ha.level  AS habitat_level,
                b_ho.level  AS hospital_level,
                b_sc.level  AS school_level,
                b_se.level  AS security_post_level
         FROM colonies c
         JOIN planets p ON p.id = c.planet_id
         LEFT JOIN buildings b_mm ON b_mm.colony_id = c.id AND b_mm.type = \'metal_mine\'
         LEFT JOIN buildings b_cm ON b_cm.colony_id = c.id AND b_cm.type = \'crystal_mine\'
         LEFT JOIN buildings b_ds ON b_ds.colony_id = c.id AND b_ds.type = \'deuterium_synth\'
         LEFT JOIN buildings b_sp ON b_sp.colony_id = c.id AND b_sp.type = \'solar_plant\'
         LEFT JOIN buildings b_fr ON b_fr.colony_id = c.id AND b_fr.type = \'fusion_reactor\'
         LEFT JOIN buildings b_ms ON b_ms.colony_id = c.id AND b_ms.type = \'metal_storage\'
         LEFT JOIN buildings b_cs ON b_cs.colony_id = c.id AND b_cs.type = \'crystal_storage\'
         LEFT JOIN buildings b_dt ON b_dt.colony_id = c.id AND b_dt.type = \'deuterium_tank\'
         LEFT JOIN buildings b_re ON b_re.colony_id = c.id AND b_re.type = \'rare_earth_drill\'
         LEFT JOIN buildings b_hf ON b_hf.colony_id = c.id AND b_hf.type = \'hydroponic_farm\'
         LEFT JOIN buildings b_fs ON b_fs.colony_id = c.id AND b_fs.type = \'food_silo\'
         LEFT JOIN buildings b_ha ON b_ha.colony_id = c.id AND b_ha.type = \'habitat\'
         LEFT JOIN buildings b_ho ON b_ho.colony_id = c.id AND b_ho.type = \'hospital\'
         LEFT JOIN buildings b_sc ON b_sc.colony_id = c.id AND b_sc.type = \'school\'
         LEFT JOIN buildings b_se ON b_se.colony_id = c.id AND b_se.type = \'security_post\'
         WHERE c.id = ?'
    );
    $stmt->execute([$colonyId]);
    $row = $stmt->fetch();
    if (!$row) return;

    $last   = strtotime($row['last_update']);
    $now    = time();
    $deltaH = ($now - $last) / 3600.0;
    if ($deltaH <= 0) return;

    // ── Building levels ───────────────────────────────────────────────────
    $mmL  = (int)($row['metal_mine_level']      ?? 0);
    $cmL  = (int)($row['crystal_mine_level']     ?? 0);
    $dsL  = (int)($row['deuterium_synth_level']  ?? 0);
    $spL  = (int)($row['solar_plant_level']      ?? 0);
    $frL  = (int)($row['fusion_reactor_level']   ?? 0);
    $msL  = (int)($row['metal_storage_level']    ?? 0);
    $csL  = (int)($row['crystal_storage_level']  ?? 0);
    $dtL  = (int)($row['deuterium_tank_level']   ?? 0);
    $reL  = (int)($row['rare_earth_drill_level'] ?? 0);
    $hfL  = (int)($row['hydroponic_farm_level']  ?? 0);
    $fsL  = (int)($row['food_silo_level']        ?? 0);
    $haL  = (int)($row['habitat_level']          ?? 0);
    $hoL  = (int)($row['hospital_level']         ?? 0);
    $scL  = (int)($row['school_level']           ?? 0);
    $seL  = (int)($row['security_post_level']    ?? 0);

    $population    = max(1, (int)($row['population']    ?? 100));
    $maxPopulation = max(500, (int)($row['max_population'] ?? 500));
    $happiness     = (int)($row['happiness']       ?? 70);

    // ── Planet richness multipliers ───────────────────────────────────────
    $richM  = max(0.1, (float)($row['richness_metal']      ?? 1.0));
    $richC  = max(0.1, (float)($row['richness_crystal']    ?? 1.0));
    $richD  = max(0.1, (float)($row['richness_deuterium']  ?? 1.0));
    $richRE = max(0.1, (float)($row['richness_rare_earth'] ?? 0.5));

    // Deposits (-1 = unlimited, 0 = depleted)
    $depM  = (int)($row['deposit_metal']       ?? -1);
    $depC  = (int)($row['deposit_crystal']     ?? -1);
    $depD  = (int)($row['deposit_deuterium']   ?? -1);
    $depRE = (int)($row['deposit_rare_earth']  ?? -1);

    // ── Energy balance ────────────────────────────────────────────────────
    $energyProd = solar_energy($spL) + fusion_energy($frL);
    $energyReq  = metal_production_energy($mmL)
                + crystal_production_energy($cmL)
                + deuterium_production_energy($dsL)
                + ($reL > 0 ? $reL * 15 : 0)       // rare-earth drill draws energy
                + ($hfL > 0 ? $hfL * 10 : 0);       // hydroponic farm draws energy
    $energyBalance = (int)round($energyProd - $energyReq);
    $efficiency    = $energyReq > 0 ? min(1.0, $energyProd / $energyReq) : 1.0;

    // ── Food system ───────────────────────────────────────────────────────
    $foodProdPerH   = food_production($hfL);
    // Agricultural colony type bonus
    $colonyType = $row['colony_type'] ?? 'balanced';
    if ($colonyType === 'agricultural') $foodProdPerH *= 1.5;
    // Population consumes 1 food/h per 100 people
    $foodConsumedPerH = $population / 100.0;
    $foodCoverage     = $foodConsumedPerH > 0
        ? min(2.0, $foodProdPerH / $foodConsumedPerH)
        : 1.0;
    $foodCap          = food_storage_cap($fsL);

    // ── Raw-resource production (richness + efficiency + happiness productivity) ──
    $prodMulti     = happiness_productivity($happiness) * $efficiency;
    $metalProdH    = metal_production($mmL)                               * $richM  * $prodMulti;
    $crystalProdH  = crystal_production($cmL)                             * $richC  * $prodMulti;
    $deutProdH     = deuterium_production($dsL, (int)($row['temp_max'] ?? 20)) * $richD  * $prodMulti;
    $rareProdH     = rare_earth_production($reL)                           * $richRE * $prodMulti;

    // ── Deposit cap: limit production if deposit nearly exhausted ─────────
    if ($depM  >= 0) $metalProdH   = min($metalProdH,   $depM  / max($deltaH, 1) * $deltaH);
    if ($depC  >= 0) $crystalProdH = min($crystalProdH, $depC  / max($deltaH, 1) * $deltaH);
    if ($depD  >= 0) $deutProdH    = min($deutProdH,    $depD  / max($deltaH, 1) * $deltaH);
    if ($depRE >= 0) $rareProdH    = min($rareProdH,    $depRE / max($deltaH, 1) * $deltaH);

    // ── Colony-type production bonuses ────────────────────────────────────
    switch ($colonyType) {
        case 'mining':
            $metalProdH   *= 1.3;
            $crystalProdH *= 1.3;
            break;
        case 'industrial':
        case 'research':
            $metalProdH   *= 0.9;
            $crystalProdH *= 0.9;
            $deutProdH    *= 0.9;
            break;
    }

    // ── Colony manager bonus ──────────────────────────────────────────────
    $manager = get_colony_leader($db, $colonyId, 'colony_manager');
    if ($manager) {
        $sk            = (int)$manager['skill_production'];
        $metalProdH    = leader_production_bonus($metalProdH,   $sk);
        $crystalProdH  = leader_production_bonus($crystalProdH, $sk);
        $deutProdH     = leader_production_bonus($deutProdH,    $sk);
        $rareProdH     = leader_production_bonus($rareProdH,    $sk);
        $foodProdPerH  = leader_production_bonus($foodProdPerH, $sk);
    }

    // ── Storage caps ─────────────────────────────────────────────────────
    $metalCap    = storage_cap($msL);
    $crystalCap  = storage_cap($csL);
    $deutCap     = storage_cap($dtL);

    // ── New stockpile values ──────────────────────────────────────────────
    $newMetal    = min($metalCap,   (float)($row['metal']      ?? 0) + $metalProdH   * $deltaH);
    $newCrystal  = min($crystalCap, (float)($row['crystal']    ?? 0) + $crystalProdH * $deltaH);
    $newDeut     = min($deutCap,    (float)($row['deuterium']  ?? 0) + $deutProdH    * $deltaH);
    $newRareEarth= min(50000,       (float)($row['rare_earth'] ?? 0) + $rareProdH    * $deltaH);
    $newFood     = min($foodCap,    max(0, (float)($row['food'] ?? 0) + ($foodProdPerH - $foodConsumedPerH) * $deltaH));

    // ── Deposit depletion ─────────────────────────────────────────────────
    $mined_metal    = $metalProdH   * $deltaH;
    $mined_crystal  = $crystalProdH * $deltaH;
    $mined_deut     = $deutProdH    * $deltaH;
    $mined_rare     = $rareProdH    * $deltaH;

    // ── Public services index ─────────────────────────────────────────────
    $newPublicServices = compute_public_services($hoL, $scL, $seL, $population);

    // ── Happiness ────────────────────────────────────────────────────────
    $newHappiness = compute_happiness($foodCoverage, $energyBalance, $newPublicServices);

    // ── Population max (500 base + habitat buildings) ─────────────────────
    $newMaxPop = 500 + habitat_capacity($haL);

    // ── Population growth ─────────────────────────────────────────────────
    $growthPerH     = population_growth($population, $newMaxPop, $newHappiness, $foodCoverage);
    $newPopulation  = max(1, min($newMaxPop, $population + (int)round($growthPerH * $deltaH)));

    // ── Persist ───────────────────────────────────────────────────────────
    $db->prepare(
        'UPDATE colonies
         SET metal=?, crystal=?, deuterium=?, rare_earth=?, food=?,
             energy=?, population=?, max_population=?, happiness=?,
             public_services=?, last_update=FROM_UNIXTIME(?)
         WHERE id=?'
    )->execute([
        $newMetal, $newCrystal, $newDeut, $newRareEarth, $newFood,
        $energyBalance, $newPopulation, $newMaxPop, $newHappiness,
        $newPublicServices, $now, $colonyId,
    ]);

    // Deplete planet deposits (skip if unlimited = -1)
    if ($depM  > 0) $db->prepare('UPDATE planets SET deposit_metal=GREATEST(0,deposit_metal-?)       WHERE id=(SELECT planet_id FROM colonies WHERE id=?)')->execute([(int)$mined_metal,   $colonyId]);
    if ($depC  > 0) $db->prepare('UPDATE planets SET deposit_crystal=GREATEST(0,deposit_crystal-?)   WHERE id=(SELECT planet_id FROM colonies WHERE id=?)')->execute([(int)$mined_crystal, $colonyId]);
    if ($depD  > 0) $db->prepare('UPDATE planets SET deposit_deuterium=GREATEST(0,deposit_deuterium-?) WHERE id=(SELECT planet_id FROM colonies WHERE id=?)')->execute([(int)$mined_deut,    $colonyId]);
    if ($depRE > 0) $db->prepare('UPDATE planets SET deposit_rare_earth=GREATEST(0,deposit_rare_earth-?) WHERE id=(SELECT planet_id FROM colonies WHERE id=?)')->execute([(int)$mined_rare,    $colonyId]);
}

function update_all_colonies(PDO $db, int $userId): void {
    $stmt = $db->prepare('SELECT id FROM colonies WHERE user_id = ?');
    $stmt->execute([$userId]);
    foreach ($stmt->fetchAll() as $row) {
        update_colony_resources($db, (int)$row['id']);
    }
}

/**
 * Returns emoji+name label for a colony type.
 */
function get_colony_type_label(string $type): string {
    return match ($type) {
        'balanced'     => '⚖ Balanced',
        'mining'       => '⛏ Mining',
        'industrial'   => '🏭 Industrial',
        'research'     => '🔬 Research',
        'agricultural' => '🌾 Agricultural',
        'military'     => '⚔ Military',
        default        => $type,
    };
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
    // ── Raw-resource extraction ────────────────────────────────────────────
    'metal_mine'       => ['metal' =>    60, 'crystal' =>    15, 'deuterium' =>  0],
    'crystal_mine'     => ['metal' =>    48, 'crystal' =>    24, 'deuterium' =>  0],
    'deuterium_synth'  => ['metal' =>   225, 'crystal' =>    75, 'deuterium' =>  0],
    'rare_earth_drill' => ['metal' =>  2000, 'crystal' =>  1000, 'deuterium' => 500],
    // ── Energy production ─────────────────────────────────────────────────
    'solar_plant'      => ['metal' =>    75, 'crystal' =>    30, 'deuterium' =>  0],
    'fusion_reactor'   => ['metal' =>   900, 'crystal' =>   360, 'deuterium' => 180],
    // ── Food / life support ───────────────────────────────────────────────
    'hydroponic_farm'  => ['metal' =>   300, 'crystal' =>   150, 'deuterium' =>  50],
    'food_silo'        => ['metal' =>   500, 'crystal' =>   200, 'deuterium' =>   0],
    // ── Population & public services ──────────────────────────────────────
    'habitat'          => ['metal' =>   800, 'crystal' =>   400, 'deuterium' => 100],
    'hospital'         => ['metal' =>  1000, 'crystal' =>   500, 'deuterium' => 200],
    'school'           => ['metal' =>   600, 'crystal' =>   400, 'deuterium' => 100],
    'security_post'    => ['metal' =>   800, 'crystal' =>   300, 'deuterium' =>   0],
    // ── Industry / infrastructure ─────────────────────────────────────────
    'robotics_factory' => ['metal' =>   400, 'crystal' =>   120, 'deuterium' =>  0],
    'shipyard'         => ['metal' =>   400, 'crystal' =>   200, 'deuterium' => 100],
    'metal_storage'    => ['metal' =>  1000, 'crystal' =>     0, 'deuterium' =>  0],
    'crystal_storage'  => ['metal' =>  1000, 'crystal' =>   500, 'deuterium' =>  0],
    'deuterium_tank'   => ['metal' =>  1000, 'crystal' =>  1000, 'deuterium' =>  0],
    'research_lab'     => ['metal' =>   200, 'crystal' =>   400, 'deuterium' => 200],
    'missile_silo'     => ['metal' =>  20000,'crystal' => 20000, 'deuterium' =>  0],
    'nanite_factory'   => ['metal' =>1000000,'crystal' =>500000, 'deuterium' =>100000],
    'terraformer'      => ['metal' =>  0,    'crystal' =>50000,  'deuterium' =>100000],
    'colony_hq'        => ['metal' =>   200, 'crystal' =>   400, 'deuterium' => 200],
];

const BUILDING_COST_FACTOR = [
    'metal_mine'       => 1.5,
    'crystal_mine'     => 1.6,
    'deuterium_synth'  => 1.5,
    'rare_earth_drill' => 1.8,
    'solar_plant'      => 1.5,
    'fusion_reactor'   => 1.8,
    'hydroponic_farm'  => 1.5,
    'food_silo'        => 1.8,
    'habitat'          => 1.6,
    'hospital'         => 1.8,
    'school'           => 1.8,
    'security_post'    => 1.6,
    'robotics_factory' => 2.0,
    'shipyard'         => 2.0,
    'metal_storage'    => 2.0,
    'crystal_storage'  => 2.0,
    'deuterium_tank'   => 2.0,
    'research_lab'     => 2.0,
    'missile_silo'     => 2.0,
    'nanite_factory'   => 2.0,
    'terraformer'      => 2.0,
    'colony_hq'        => 3.0,
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
    'espionage_probe'  => ['cost' => ['metal' =>    0, 'crystal' =>  1000, 'deuterium' =>    0], 'cargo' =>     5, 'speed' => 500000, 'attack' =>0,'shield' =>0.01,'hull' =>1000],
    'solar_satellite'  => ['cost' => ['metal' =>    0, 'crystal' =>  2000, 'deuterium' =>  500], 'cargo' =>     0, 'speed' =>     0, 'attack' =>   1, 'shield' =>   1, 'hull' =>  2000],
    'colony_ship'      => ['cost' => ['metal' =>10000, 'crystal' =>20000, 'deuterium' =>10000], 'cargo' =>  7500, 'speed' =>  2500, 'attack' =>  50, 'shield' => 100, 'hull' => 30000],
    'recycler'         => ['cost' => ['metal' =>10000, 'crystal' => 6000, 'deuterium' =>  2000], 'cargo' => 20000, 'speed' =>  2000, 'attack' =>   1, 'shield' =>  10, 'hull' => 16000],
];
