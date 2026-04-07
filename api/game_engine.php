<?php
/**
 * Core game engine: resource production, building costs, ship stats, etc.
 */

require_once __DIR__ . '/galaxy_seed.php';

if (!function_exists('normalize_angle_rad')) {
    function normalize_angle_rad(float $angle): float {
        $twoPi = 2.0 * M_PI;
        $angle = fmod($angle, $twoPi);
        if ($angle < 0) {
            $angle += $twoPi;
        }
        return $angle;
    }
}

if (!function_exists('galactic_polar_from_cartesian')) {
    function galactic_polar_from_cartesian(float $x, float $y, float $z): array {
        $radius = hypot($x, $y);
        $theta = $radius > 0.0 ? normalize_angle_rad(atan2($y, $x)) : 0.0;
        return [
            'radius_ly' => round($radius, 2),
            'theta_rad' => round($theta, 6),
            'height_ly' => round($z, 2),
        ];
    }
}

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

function ship_definitions(): array {
    return SHIP_STATS;
}

function building_definitions(): array {
    return [
        'metal_mine'       => ['category' => 'extraction', 'label' => 'Metal Mine',       'icon' => '⬡', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'industrial'],
        'crystal_mine'     => ['category' => 'extraction', 'label' => 'Crystal Mine',     'icon' => '💎', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'industrial'],
        'deuterium_synth'  => ['category' => 'extraction', 'label' => 'Deuterium Synth',  'icon' => '🔵', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'industrial'],
        'rare_earth_drill' => ['category' => 'extraction', 'label' => 'Rare Earth Drill', 'icon' => '💜', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'industrial'],
        'solar_plant'      => ['category' => 'energy',     'label' => 'Solar Plant',      'icon' => '☀', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'utility'],
        'fusion_reactor'   => ['category' => 'energy',     'label' => 'Fusion Reactor',   'icon' => '🔆', 'zone' => 'surface', 'footprint' => 3, 'class_key' => 'utility'],
        'hydroponic_farm'  => ['category' => 'life',       'label' => 'Hydroponic Farm',  'icon' => '🌾', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'civic'],
        'food_silo'        => ['category' => 'life',       'label' => 'Food Silo',        'icon' => '🥫', 'zone' => 'surface', 'footprint' => 1, 'class_key' => 'utility'],
        'habitat'          => ['category' => 'population', 'label' => 'Habitat',          'icon' => '🏠', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'civic'],
        'hospital'         => ['category' => 'population', 'label' => 'Hospital',         'icon' => '🏥', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'civic'],
        'school'           => ['category' => 'population', 'label' => 'School',           'icon' => '🎓', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'civic'],
        'security_post'    => ['category' => 'population', 'label' => 'Security Post',    'icon' => '🛡', 'zone' => 'surface', 'footprint' => 1, 'class_key' => 'military'],
        'robotics_factory' => ['category' => 'industry',   'label' => 'Robotics Factory', 'icon' => '🤖', 'zone' => 'surface', 'footprint' => 3, 'class_key' => 'industrial'],
        'shipyard'         => ['category' => 'industry',   'label' => 'Shipyard',         'icon' => '🛰', 'zone' => 'orbital', 'footprint' => 2, 'class_key' => 'orbital'],
        'metal_storage'    => ['category' => 'storage',    'label' => 'Metal Storage',    'icon' => '📦', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'utility'],
        'crystal_storage'  => ['category' => 'storage',    'label' => 'Crystal Storage',  'icon' => '📦', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'utility'],
        'deuterium_tank'   => ['category' => 'storage',    'label' => 'Deuterium Tank',   'icon' => '🛢', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'utility'],
        'research_lab'     => ['category' => 'science',    'label' => 'Research Lab',     'icon' => '🔬', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'science'],
        'missile_silo'     => ['category' => 'defense',    'label' => 'Missile Silo',     'icon' => '🚀', 'zone' => 'orbital', 'footprint' => 2, 'class_key' => 'orbital'],
        'nanite_factory'   => ['category' => 'advanced',   'label' => 'Nanite Factory',   'icon' => '⚙', 'zone' => 'surface', 'footprint' => 3, 'class_key' => 'science'],
        'terraformer'      => ['category' => 'advanced',   'label' => 'Terraformer',      'icon' => '🌍', 'zone' => 'surface', 'footprint' => 4, 'class_key' => 'utility'],
        'colony_hq'        => ['category' => 'command',    'label' => 'Colony HQ',        'icon' => '🏛', 'zone' => 'surface', 'footprint' => 3, 'class_key' => 'civic'],
        // ── Star-orbit installations (orbit the star, not a planet) ──────────────
        'stargate'         => ['category' => 'infrastructure', 'label' => 'Stargate',      'icon' => '⭕', 'zone' => 'star_orbit', 'footprint' => 0, 'class_key' => 'orbital', 'min_level' => 1],
        'jump_inhibitor'   => ['category' => 'defense',    'label' => 'Jump Inhibitor',   'icon' => '🛑', 'zone' => 'star_orbit', 'footprint' => 0, 'class_key' => 'orbital', 'min_level' => 1],
        'relay_station'    => ['category' => 'infrastructure', 'label' => 'Relay Station', 'icon' => '📡', 'zone' => 'star_orbit', 'footprint' => 0, 'class_key' => 'orbital', 'min_level' => 1],
        'deep_space_radar' => ['category' => 'surveillance','label' => 'Deep Space Radar','icon' => '📶', 'zone' => 'star_orbit', 'footprint' => 0, 'class_key' => 'orbital', 'min_level' => 1],
    ];
}

function colony_layout_profile(array $planet): array {
    $diameter = max(800, (int)($planet['diameter'] ?? 10000));
    $planetClass = (string)($planet['planet_class'] ?? 'rocky');
    $cols = max(5, min(12, (int)floor($diameter / 2200) + 3));
    $rows = max(4, min(10, (int)floor($diameter / 3200) + 2));
    $surfaceSlots = $cols * $rows;

    $classWeights = [
        'industrial' => 0.22,
        'utility' => 0.16,
        'civic' => 0.18,
        'science' => 0.12,
        'military' => 0.12,
        'orbital' => 0.10,
    ];
    if (str_contains($planetClass, 'gas')) {
        $classWeights['orbital'] = 0.24;
        $classWeights['industrial'] = 0.10;
    } elseif (str_contains($planetClass, 'ocean')) {
        $classWeights['civic'] = 0.22;
        $classWeights['industrial'] = 0.17;
    } elseif (str_contains($planetClass, 'lava')) {
        $classWeights['military'] = 0.18;
        $classWeights['utility'] = 0.20;
    }

    $classCaps = [];
    $allocated = 0;
    foreach ($classWeights as $classKey => $weight) {
        $cap = max(2, (int)floor($surfaceSlots * $weight));
        $classCaps[$classKey] = $cap;
        $allocated += $cap;
    }
    $classCaps['flex'] = max(2, $surfaceSlots - $allocated);
    $orbitalSlots = max(2, min(12, (int)floor($diameter / 7000) + (str_contains($planetClass, 'gas') ? 3 : 1)));

    return [
        'grid' => ['cols' => $cols, 'rows' => $rows, 'surface_slots' => $surfaceSlots, 'orbital_slots' => $orbitalSlots],
        'class_caps' => $classCaps,
        'planet_scale' => [
            'diameter' => $diameter,
            'tier' => $diameter >= 60000 ? 'colossal' : ($diameter >= 24000 ? 'large' : ($diameter >= 12000 ? 'medium' : 'small')),
            'planet_class' => $planetClass,
        ],
    ];
}

function summarize_orbital_facilities(array $buildings, array $ships = []): array {
    $defs = building_definitions();
    $facilities = [];
    foreach ($buildings as $building) {
        $type = (string)($building['type'] ?? '');
        $def = $defs[$type] ?? null;
        if (!$def || ($def['zone'] ?? 'surface') !== 'orbital') {
            continue;
        }
        $facilities[] = [
            'type' => $type,
            'label' => $def['label'],
            'icon' => $def['icon'],
            'level' => (int)($building['level'] ?? 0),
            'category' => $def['category'],
        ];
    }
    $solarSatellites = (int)($ships['solar_satellite'] ?? 0);
    if ($solarSatellites > 0) {
        $facilities[] = [
            'type' => 'solar_satellite',
            'label' => 'Solar Satellites',
            'icon' => '🛰',
            'level' => $solarSatellites,
            'category' => 'orbital-energy',
        ];
    }
    return $facilities;
}

/**
 * Collect star-orbit installations from a colony's buildings.
 * These are returned separately as they orbit the star, not the planet.
 *
 * @param  array $buildings  Building rows for this colony
 * @param  int   $colonyId   Colony ID (for origin tracking)
 * @param  int   $position   Planet position in system (for orbit slot assignment)
 * @return array<array>      Star-orbit facility descriptors
 */
function summarize_star_orbit_facilities(array $buildings, int $colonyId, int $position): array {
    $defs = building_definitions();
    $facilities = [];
    foreach ($buildings as $building) {
        $type = (string)($building['type'] ?? '');
        $def = $defs[$type] ?? null;
        if (!$def || ($def['zone'] ?? 'surface') !== 'star_orbit') {
            continue;
        }
        $level = (int)($building['level'] ?? 0);
        if ($level < ($def['min_level'] ?? 1)) {
            continue;
        }
        $facilities[] = [
            'type'       => $type,
            'label'      => $def['label'],
            'icon'       => $def['icon'],
            'level'      => $level,
            'category'   => $def['category'],
            'colony_id'  => $colonyId,
            'position'   => $position,
        ];
    }
    return $facilities;
}

/**
 * Return a deterministic empire color for a player based on their user_id.
 * Uses a palette of 10 visually distinct hues suitable for faction auras.
 */
function user_empire_color(int $userId): string {
    $palette = [
        '#4af9ff', // cyan
        '#ffa94a', // amber
        '#ff4a7a', // rose
        '#4affa0', // mint
        '#d04aff', // violet
        '#c8ff4a', // lime
        '#4a7aff', // cobalt
        '#ffef4a', // yellow
        '#ff9c4a', // orange
        '#4affd4', // teal
    ];
    return $palette[abs($userId) % count($palette)];
}

// ─── Fog of War ──────────────────────────────────────────────────────────────

/**
 * Check whether Fog-of-War persistence table is available.
 * Falls back to legacy behavior when migrations are not applied yet.
 */
function has_player_system_visibility_table(PDO $db): bool {
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    try {
        $stmt = $db->query("SHOW TABLES LIKE 'player_system_visibility'");
        $cached = (bool)$stmt->fetchColumn();
    } catch (Throwable $e) {
        $cached = false;
    }

    return $cached;
}

/**
 * Resolve the current visibility level for a player in a specific system.
 *
 * Returns one of:
 *   'own'    – player has a colony here (full live data, permanent)
 *   'active' – player fleet currently present (full live data, temporary)
 *   'stale'  – previously visited but no forces present (returns intel snapshot)
 *   'unknown'– never seen (returns no planet/fleet data)
 *
 * Also returns the intel_json snapshot and scouted_at timestamp.
 *
 * @return array{ level: string, scouted_at: ?string, intel_json: ?array }
 */
function resolve_system_visibility(PDO $db, int $userId, int $galaxy, int $system): array {
    if (!has_player_system_visibility_table($db)) {
        // Legacy fallback: without FoW table expose full system data.
        return ['level' => 'own', 'scouted_at' => null, 'intel_json' => null];
    }

    // Check persistent visibility record
    $stmt = $db->prepare(
        'SELECT level, scouted_at, expires_at, intel_json
         FROM player_system_visibility
         WHERE user_id = ? AND galaxy = ? AND `system` = ?'
    );
    $stmt->execute([$userId, $galaxy, $system]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    // Check if player has a live fleet in this system right now
    $fleetStmt = $db->prepare(
        'SELECT f.id FROM fleets f
         JOIN colonies c ON c.id = f.origin_colony_id
                 JOIN celestial_bodies cb ON cb.id = c.body_id
         WHERE f.user_id = ?
           AND f.arrival_time <= NOW()
           AND f.return_time  >  NOW()
           AND (
                         (cb.galaxy_index = ? AND cb.system_index = ?)
             OR (f.target_galaxy = ? AND f.target_system = ?)
           )
         LIMIT 1'
    );
    $fleetStmt->execute([$userId, $galaxy, $system, $galaxy, $system]);
    $hasActiveFleet = (bool)$fleetStmt->fetchColumn();

    if ($hasActiveFleet) {
        return ['level' => 'active', 'scouted_at' => $row['scouted_at'] ?? null, 'intel_json' => null];
    }

    if (!$row) {
        return ['level' => 'unknown', 'scouted_at' => null, 'intel_json' => null];
    }

    // Check expiry for temporary records
    if ($row['expires_at'] !== null && strtotime($row['expires_at']) < time()) {
        // Expired active entry → demote to stale (keep intel_json)
        $db->prepare(
            'UPDATE player_system_visibility SET level = \'stale\', expires_at = NULL WHERE user_id = ? AND galaxy = ? AND `system` = ?'
        )->execute([$userId, $galaxy, $system]);
        $row['level'] = 'stale';
    }

    $intel = isset($row['intel_json']) && $row['intel_json'] !== null
        ? json_decode($row['intel_json'], true)
        : null;

    return [
        'level'      => $row['level'],
        'scouted_at' => $row['scouted_at'],
        'intel_json' => $intel,
    ];
}

/**
 * Write or update a visibility record for a player.
 * Calling this with level='own' or level='stale' (null expires) makes it permanent.
 *
 * @param array|null $intelSnapshot  Sanitised planet/fleet snapshot to store (optional)
 */
function touch_system_visibility(
    PDO $db,
    int $userId,
    int $galaxy,
    int $system,
    string $level = 'stale',
    ?string $expiresAt = null,
    ?array $intelSnapshot = null
): void {
    if (!has_player_system_visibility_table($db)) {
        return;
    }

    $intelJson = $intelSnapshot !== null ? json_encode($intelSnapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;
    $db->prepare(
        'INSERT INTO player_system_visibility (user_id, galaxy, `system`, level, scouted_at, expires_at, intel_json)
         VALUES (?, ?, ?, ?, NOW(), ?, ?)
         ON DUPLICATE KEY UPDATE
           level      = IF(VALUES(level) = \'own\' OR level = \'own\', \'own\', VALUES(level)),
           scouted_at = NOW(),
           expires_at = VALUES(expires_at),
           intel_json = COALESCE(VALUES(intel_json), intel_json)'
    )->execute([$userId, $galaxy, $system, $level, $expiresAt, $intelJson]);
}

/**
 * Build a sanitised intel snapshot from full system data.
 * Removes sensitive information (production rates, exact resource counts)
 * that the observing player should not see.
 *
 * Returns array suitable for storing in intel_json.
 */
function build_intel_snapshot(array $mergedPlanets, array $fleetsInSystem, array $starInstallations = []): array {
    $planets = [];
    foreach ($mergedPlanets as $slot) {
        $pp = $slot['player_planet'] ?? null;
        $gp = $slot['generated_planet'] ?? null;
        if ($pp) {
            // Keep structural data, strip production numbers
            $planets[] = [
                'position'          => $slot['position'],
                'planet_class'      => $pp['planet_class'] ?? null,
                'diameter'          => $pp['diameter'] ?? null,
                'owner'             => $pp['owner'] ?? null,
                'colony_name'       => $pp['name'] ?? null,
                'owner_color'       => $pp['owner_color'] ?? null,
                'orbital_facilities'=> $pp['orbital_facilities'] ?? [],
            ];
        } elseif ($gp) {
            $planets[] = [
                'position'    => $slot['position'],
                'planet_class'=> $gp['planet_class'] ?? null,
                'diameter'    => $gp['diameter'] ?? null,
                'owner'       => null,
            ];
        }
    }

    // Fleets: only count and mission visible, not ship details
    $fleets = [];
    foreach ($fleetsInSystem as $f) {
        $fleets[] = [
            'owner'   => $f['owner'] ?? null,
            'mission' => $f['mission'] ?? null,
            'size'    => count($f['ships'] ?? []),
        ];
    }

    return [
        'snapshot_ts'        => date('c'),
        'planets'            => $planets,
        'fleets'             => $fleets,
        'star_installations' => $starInstallations,
    ];
}

/**
 * Filter a full system response to what the player is allowed to see
 * based on their visibility level.
 *
 * @param array  $response   Full response array (mutated in-place)
 * @param string $level      'own'|'active'|'stale'|'unknown'
 * @param array|null $intel  Intel snapshot for stale/unknown views
 * @return array             Modified response with visibility metadata
 */
function apply_fog_of_war(array $response, string $level, ?string $scoutedAt, ?array $intel): array {
    $response['visibility'] = [
        'level'      => $level,
        'scouted_at' => $scoutedAt,
    ];

    if ($level === 'own' || $level === 'active') {
        // Full data - no filtering needed
        return $response;
    }

    if ($level === 'stale' && $intel !== null) {
        // Return frozen snapshot, strip live data
        foreach ($response['planets'] as $idx => $slot) {
            $pp     = $slot['player_planet'] ?? null;
            $snapPl = null;
            foreach ($intel['planets'] as $sp) {
                if ((int)$sp['position'] === (int)$slot['position']) { $snapPl = $sp; break; }
            }
            if ($pp && $snapPl) {
                // Replace live player_planet with snapshot (no resources)
                $response['planets'][$idx]['player_planet'] = $snapPl + ['_stale' => true];
            }
        }
        $response['fleets_in_system'] = $intel['fleets'] ?? [];
        $response['star_installations'] = $intel['star_installations'] ?? [];
        return $response;
    }

    // 'unknown' or stale with no intel: strip all player data
    foreach ($response['planets'] as $idx => $slot) {
        $response['planets'][$idx]['player_planet'] = null;
    }
    $response['fleets_in_system']   = [];
    $response['star_installations'] = [];
    return $response;
}

function vessel_manifest(array $ships, int $capPerType = 10): array {
    $manifest = [];
    foreach ($ships as $type => $count) {
        $count = max(0, (int)$count);
        if ($count <= 0) {
            continue;
        }
        $manifest[] = [
            'type' => (string)$type,
            'count' => $count,
            'sample_count' => min($capPerType, $count),
            'stats' => ship_runtime_definition((string)$type),
        ];
    }
    return $manifest;
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

function check_research_prereqs(PDO $db, int $uid, string $tech): array {
    $prereqs = RESEARCH_PREREQS[$tech] ?? [];
    if (empty($prereqs)) {
        return ['can_research' => true, 'missing_prereqs' => []];
    }
    $missing = [];
    foreach ($prereqs as [$reqTech, $reqLevel]) {
        $stmt = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=?');
        $stmt->execute([$uid, $reqTech]);
        $res = $stmt->fetch();
        $level = (int)($res['level'] ?? 0);
        if ($level < $reqLevel) {
            $missing[] = ['tech' => $reqTech, 'required_level' => $reqLevel, 'current_level' => $level];
        }
    }
    return [
        'can_research' => empty($missing),
        'missing_prereqs' => $missing,
    ];
}

// ─── Ship costs / stats ──────────────────────────────────────────────────────

function blueprint_ship_type_code(int $blueprintId): string {
    return 'bp_' . max(1, $blueprintId);
}

function blueprint_id_from_ship_type(string $type): ?int {
    if (!preg_match('/^bp_(\d+)$/', $type, $matches)) {
        return null;
    }

    $id = (int)($matches[1] ?? 0);
    return $id > 0 ? $id : null;
}

function is_blueprint_ship_type(string $type): bool {
    return blueprint_id_from_ship_type($type) !== null;
}

function vessel_blueprint_tables_exist(?PDO $db = null): bool {
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    $db ??= get_db();
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN (\'vessel_hulls\', \'modules\', \'vessel_blueprints\', \'vessel_blueprint_modules\')'
    );
    $stmt->execute();
    $cached = ((int)$stmt->fetchColumn() >= 4);
    return $cached;
}

function ship_runtime_definition(string $type, ?PDO $db = null): ?array {
    static $cache = [];

    if (array_key_exists($type, $cache)) {
        return $cache[$type];
    }

    if (isset(SHIP_STATS[$type])) {
        $cache[$type] = SHIP_STATS[$type];
        return $cache[$type];
    }

    $blueprintId = blueprint_id_from_ship_type($type);
    if ($blueprintId === null) {
        $cache[$type] = null;
        return null;
    }

    $db ??= get_db();
    if (!vessel_blueprint_tables_exist($db)) {
        $cache[$type] = null;
        return null;
    }

    $stmt = $db->prepare(
        'SELECT vb.id, vb.name, vb.compiled_stats_json, vb.compiled_cost_json, vh.label AS hull_label
         FROM vessel_blueprints vb
         JOIN vessel_hulls vh ON vh.id = vb.hull_id
         WHERE vb.id = ?
         LIMIT 1'
    );
    $stmt->execute([$blueprintId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        $cache[$type] = null;
        return null;
    }

    $compiledStats = json_decode((string)($row['compiled_stats_json'] ?? '{}'), true);
    $compiledCost = json_decode((string)($row['compiled_cost_json'] ?? '{}'), true);
    $compiledStats = is_array($compiledStats) ? $compiledStats : [];
    $compiledCost = is_array($compiledCost) ? $compiledCost : [];

    $cache[$type] = [
        'label' => (string)($row['name'] ?? $row['hull_label'] ?? $type),
        'attack' => (int)round((float)($compiledStats['attack'] ?? 0)),
        'shield' => (int)round((float)($compiledStats['shield'] ?? 0)),
        'hull' => (int)round((float)($compiledStats['hull'] ?? 0)),
        'cargo' => (int)round((float)($compiledStats['cargo'] ?? 0)),
        'speed' => (int)round((float)($compiledStats['speed'] ?? 1000)),
        'energy_output' => (float)($compiledStats['energy_output'] ?? 0.0),
        'energy_capacity' => (float)($compiledStats['energy_capacity'] ?? 0.0),
        'energy_upkeep' => (float)($compiledStats['energy_upkeep'] ?? 0.0),
        'weapon_efficiency' => (float)($compiledStats['weapon_efficiency'] ?? 1.0),
        'shield_efficiency' => (float)($compiledStats['shield_efficiency'] ?? 1.0),
        'attack_energy_share' => (float)($compiledStats['attack_energy_share'] ?? 0.5),
        'cost' => [
            'metal' => (int)round((float)($compiledCost['metal'] ?? 0)),
            'crystal' => (int)round((float)($compiledCost['crystal'] ?? 0)),
            'deuterium' => (int)round((float)($compiledCost['deuterium'] ?? 0)),
        ],
        'blueprint_id' => (int)$row['id'],
        'is_blueprint' => true,
    ];

    return $cache[$type];
}

function ship_exists_runtime(string $type, ?PDO $db = null): bool {
    return ship_runtime_definition($type, $db) !== null;
}

function ship_stat_value(string $type, string $key, $default = 0, ?PDO $db = null) {
    $def = ship_runtime_definition($type, $db);
    if (!is_array($def) || !array_key_exists($key, $def)) {
        return $default;
    }

    return $def[$key];
}

function ship_cost(string $type): array {
    $cost = ship_stat_value($type, 'cost', ['metal' => 0, 'crystal' => 0, 'deuterium' => 0]);
    return is_array($cost) ? $cost : ['metal' => 0, 'crystal' => 0, 'deuterium' => 0];
}

function ship_cargo(string $type): int {
    return (int)ship_stat_value($type, 'cargo', 0);
}

function ship_speed(string $type): int {
    return (int)ship_stat_value($type, 'speed', 1000);
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

// ─── Faction FTL Drive helpers ────────────────────────────────────────────────

/**
 * Return the FTL drive type for a given user.
 * Defaults to 'aereth' (Alcubierre Warp) when not set.
 * Valid values: aereth | vor_tak | syl_nar | vel_ar | zhareen | kryl_tha
 *
 * Note: no static cache — each PHP request is short-lived; caching across
 * requests in long-running workers would risk returning stale data.
 */
function get_user_ftl_type(PDO $db, int $uid): string {
    $stmt = $db->prepare('SELECT ftl_drive_type FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$uid]);
    return (string)($stmt->fetchColumn() ?: 'aereth');
}

/**
 * Resolve an active Syl'Nar gate between two systems (bidirectional).
 * Returns the gate row or null if no usable gate exists.
 */
function resolve_syl_nar_gate(PDO $db, int $uid, int $gA, int $sA, int $gB, int $sB): ?array {
    $stmt = $db->prepare(
        'SELECT id FROM ftl_gates
          WHERE owner_user_id = ? AND is_active = 1 AND health > 0
            AND ((galaxy_a=? AND system_a=? AND galaxy_b=? AND system_b=?)
              OR (galaxy_b=? AND system_b=? AND galaxy_a=? AND system_a=?))
          LIMIT 1'
    );
    $stmt->execute([$uid, $gA, $sA, $gB, $sB, $gA, $sA, $gB, $sB]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Return a charted Zhareen resonance node at a target system, or null.
 */
function get_zhareen_node(PDO $db, int $uid, int $galaxy, int $system): ?array {
    $stmt = $db->prepare(
        'SELECT id, cooldown_until FROM ftl_resonance_nodes
          WHERE owner_user_id = ? AND galaxy = ? AND `system` = ? LIMIT 1'
    );
    $stmt->execute([$uid, $galaxy, $system]);
    $row = $stmt->fetch();
    return $row ?: null;
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

    $x = $ox + ($tx - $ox) * $t;
    $y = $oy + ($ty - $oy) * $t;
    $z = $oz + ($tz - $oz) * $t;
    $polar = galactic_polar_from_cartesian($x, $y, $z);

    return [
        'x'        => round($x, 2),
        'y'        => round($y, 2),
        'z'        => round($z, 2),
        'radius_ly' => $polar['radius_ly'],
        'theta_rad' => $polar['theta_rad'],
        'height_ly' => $polar['height_ly'],
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
    $zoneCount = max(1, (int)ceil(9 / $arms));
    $radialZone = min($zoneCount - 1, (int)(($g - 1) / $arms));
    $zoneWidth = ($rEnd - $r0) / $zoneCount;
    $rMin      = $r0 + $radialZone * $zoneWidth;
    $rMax      = min($rEnd, $rMin + $zoneWidth);
    $sysMax    = galaxy_system_limit();
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

// ─── Shared fleet launch helper ───────────────────────────────────────────────

/**
 * Launch a fleet for any user (NPC bots, autonomous leaders, etc.).
 *
 * Validates ship availability, cargo capacity, and resource balance inside a
 * transaction.  Uses the same 3-D Newtonian travel time as the player-facing
 * fleet API.  Returns true on success, false (with error_log entry) on failure.
 */
function launch_fleet_for_user(
    PDO    $db,
    int    $userId,
    int    $originColonyId,
    int    $targetGalaxy,
    int    $targetSystem,
    int    $targetPosition,
    string $mission,
    array  $ships,
    array  $cargo
): bool {
    if ($targetGalaxy < 1 || $targetGalaxy > GALAXY_MAX
        || $targetSystem < 1 || $targetSystem > galaxy_system_limit()
        || $targetPosition < 1 || $targetPosition > POSITION_MAX) {
        return false;
    }

    try {
        $db->beginTransaction();

        update_colony_resources($db, $originColonyId);

        $originStmt = $db->prepare(
            'SELECT c.id, c.metal, c.crystal, c.deuterium,
                    cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position
             FROM colonies c
               JOIN celestial_bodies cb ON cb.id = c.body_id
             WHERE c.id = ? AND c.user_id = ?'
        );
        $originStmt->execute([$originColonyId, $userId]);
        $origin = $originStmt->fetch(PDO::FETCH_ASSOC);
        if (!$origin) {
            $db->rollBack();
            return false;
        }

        $shipsToSend = [];
        foreach ($ships as $type => $count) {
            $count = (int)$count;
            if ($count <= 0 || !ship_exists_runtime($type, $db)) continue;
            $sStmt = $db->prepare('SELECT count FROM ships WHERE colony_id = ? AND type = ?');
            $sStmt->execute([$originColonyId, $type]);
            $available = (int)($sStmt->fetchColumn() ?: 0);
            if ($available < $count) {
                $db->rollBack();
                return false;
            }
            $shipsToSend[$type] = $count;
        }
        if (empty($shipsToSend)) {
            $db->rollBack();
            return false;
        }

        $cMetal   = max(0.0, (float)($cargo['metal']     ?? 0));
        $cCrystal = max(0.0, (float)($cargo['crystal']   ?? 0));
        $cDeut    = max(0.0, (float)($cargo['deuterium'] ?? 0));
        $cargoSum = $cMetal + $cCrystal + $cDeut;
        $capacity = (float)array_sum(
            array_map(
                static fn(string $t, int $c): float => (float)ship_cargo($t) * $c,
                array_keys($shipsToSend),
                $shipsToSend
            )
        );
        if ($cargoSum > $capacity + 0.0001
            || (float)$origin['metal']     < $cMetal
            || (float)$origin['crystal']   < $cCrystal
            || (float)$origin['deuterium'] < $cDeut) {
            $db->rollBack();
            return false;
        }

        $dist  = coordinate_distance(
            (int)$origin['galaxy'], (int)$origin['system'], (int)$origin['position'],
            $targetGalaxy, $targetSystem, $targetPosition
        );
        $travel = fleet_travel_time($dist, fleet_speed($shipsToSend));

        [$ox, $oy, $oz] = get_system_3d_coords($db, (int)$origin['galaxy'], (int)$origin['system']);
        [$tx, $ty, $tz] = get_system_3d_coords($db, $targetGalaxy, $targetSystem);
        $distLy   = fleet_3d_distance($ox, $oy, $oz, $tx, $ty, $tz);
        $speedLyH = fleet_speed_ly_h($shipsToSend);
        if ($distLy > 0) {
            $travel = fleet_travel_time_3d($distLy, $speedLyH);
        }

        $now       = time();
        $departure = date('Y-m-d H:i:s', $now);
        $arrival   = date('Y-m-d H:i:s', $now + $travel);
        $returnT   = date('Y-m-d H:i:s', $now + $travel * 2);

        foreach ($shipsToSend as $type => $count) {
            $db->prepare('UPDATE ships SET count = count - ? WHERE colony_id = ? AND type = ?')
               ->execute([$count, $originColonyId, $type]);
        }
        $db->prepare('UPDATE colonies SET metal=metal-?, crystal=crystal-?, deuterium=deuterium-? WHERE id=?')
           ->execute([$cMetal, $cCrystal, $cDeut, $originColonyId]);

        $originPolar = galactic_polar_from_cartesian($ox, $oy, $oz);
        $targetPolar = galactic_polar_from_cartesian($tx, $ty, $tz);

        $db->prepare(
            'INSERT INTO fleets (user_id, origin_colony_id, target_galaxy, target_system,
                                 target_position, mission, ships_json,
                                 cargo_metal, cargo_crystal, cargo_deuterium,
                                 origin_x_ly, origin_y_ly, origin_z_ly,
                                 origin_radius_ly, origin_theta_rad, origin_height_ly,
                                 target_x_ly, target_y_ly, target_z_ly,
                                 target_radius_ly, target_theta_rad, target_height_ly,
                                 speed_ly_h, distance_ly,
                                 departure_time, arrival_time, return_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $userId, $originColonyId,
            $targetGalaxy, $targetSystem, $targetPosition,
            $mission, json_encode($shipsToSend),
            $cMetal, $cCrystal, $cDeut,
            $ox, $oy, $oz,
            $originPolar['radius_ly'], $originPolar['theta_rad'], $originPolar['height_ly'],
            $tx, $ty, $tz,
            $targetPolar['radius_ly'], $targetPolar['theta_rad'], $targetPolar['height_ly'],
            $speedLyH, $distLy,
            $departure, $arrival, $returnT,
        ]);

        $db->commit();
        return true;
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('launch_fleet_for_user failed: ' . $e->getMessage());
        return false;
    }
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

/**
 * Aggregate dynamic empire effects from species, government, civics and faction pressure.
 * Safe fallback: if politics tables are missing, returns neutral values.
 */
function empire_dynamic_effects(PDO $db, int $userId): array {
    static $cache = [];
    if (isset($cache[$userId])) {
        return $cache[$userId];
    }

    $effects = [
        'resource_output_mult' => 0.0,
        'food_output_mult' => 0.0,
        'pop_growth_mult' => 0.0,
        'happiness_flat' => 0.0,
        'public_services_flat' => 0.0,
        'research_speed_mult' => 0.0,
        'fleet_readiness_mult' => 0.0,
        'faction_pressure_mult' => 0.0,
        'faction_pressure_score' => 0.0,
        'unrest_active' => 0.0,
        'unrest_severity' => 0.0,
    ];

    try {
        $stmt = $db->prepare(
            'SELECT ep.primary_species_key, ep.government_key,
                    sp.effects_json AS species_effects,
                    gf.effects_json AS government_effects
             FROM user_empire_profile ep
             LEFT JOIN species_profiles sp ON sp.species_key = ep.primary_species_key
             LEFT JOIN government_forms gf ON gf.government_key = ep.government_key
             WHERE ep.user_id = ?
             LIMIT 1'
        );
        $stmt->execute([$userId]);
        $profile = $stmt->fetch();
        if ($profile) {
            $effects = merge_effect_bundle($effects, json_decode((string)($profile['species_effects'] ?? '{}'), true));
            $effects = merge_effect_bundle($effects, json_decode((string)($profile['government_effects'] ?? '{}'), true));
        }
    } catch (Throwable $e) {
        // Politics migration not applied yet -> keep neutral values.
    }

    try {
        $civicStmt = $db->prepare(
            'SELECT gc.effects_json
             FROM user_empire_civics uc
             JOIN government_civics gc ON gc.civic_key = uc.civic_key
             WHERE uc.user_id = ?'
        );
        $civicStmt->execute([$userId]);
        foreach ($civicStmt->fetchAll() as $row) {
            $effects = merge_effect_bundle($effects, json_decode((string)($row['effects_json'] ?? '{}'), true));
        }
    } catch (Throwable $e) {
        // Optional until migration is applied.
    }

    try {
        $fStmt = $db->prepare(
            'SELECT faction_key, approval, support
             FROM user_faction_state
             WHERE user_id = ?'
        );
        $fStmt->execute([$userId]);
        $rows = $fStmt->fetchAll();
        if ($rows) {
            $weighted = 0.0;
            $weightSum = 0.0;
            foreach ($rows as $row) {
                $approval = (float)($row['approval'] ?? 50.0);
                $support = max(1.0, (float)($row['support'] ?? 1.0));
                $weighted += $approval * $support;
                $weightSum += $support;

                $key = (string)($row['faction_key'] ?? '');
                if ($key === 'industrialists') {
                    if ($approval >= 60) $effects['resource_output_mult'] += 0.07;
                    if ($approval <= 40) $effects['resource_output_mult'] -= 0.05;
                } elseif ($key === 'scientists') {
                    if ($approval >= 60) $effects['research_speed_mult'] += 0.10;
                    if ($approval <= 40) $effects['research_speed_mult'] -= 0.08;
                } elseif ($key === 'civic_union') {
                    if ($approval >= 60) $effects['pop_growth_mult'] += 0.06;
                    if ($approval <= 45) $effects['pop_growth_mult'] -= 0.10;
                } elseif ($key === 'security_bloc') {
                    if ($approval >= 60) $effects['fleet_readiness_mult'] += 0.10;
                    if ($approval <= 40) $effects['happiness_flat'] -= 3.0;
                }
            }

            $pressure = $weightSum > 0 ? ($weighted / $weightSum) : 50.0;
            $effects['faction_pressure_score'] = round($pressure, 2);

            $pressureMult = max(-0.8, min(0.8, (float)$effects['faction_pressure_mult']));
            if ($pressure < 45.0) {
                $delta = min(18.0, (45.0 - $pressure) / 2.0);
                $effects['happiness_flat'] -= $delta * (1.0 + $pressureMult);
            } elseif ($pressure > 65.0) {
                $delta = min(10.0, ($pressure - 65.0) / 3.0);
                $effects['happiness_flat'] += $delta * (1.0 - $pressureMult);
            }
        }
    } catch (Throwable $e) {
        // Optional until migration is applied.
    }

    try {
        $uStmt = $db->prepare(
            'SELECT progress, stage, approach_key
             FROM situation_states
             WHERE user_id = ? AND situation_type = \'faction_unrest\' AND status = \'active\'
             ORDER BY id DESC
             LIMIT 1'
        );
        $uStmt->execute([$userId]);
        $unrest = $uStmt->fetch();
        if ($unrest) {
            $stage = max(1, min(4, (int)($unrest['stage'] ?? 1)));
            $progress = max(0.0, min(100.0, (float)($unrest['progress'] ?? 0.0)));
            $severity = max($stage / 4.0, $progress / 100.0);
            $approach = strtolower(trim((string)($unrest['approach_key'] ?? 'conciliation')));

            $effects['unrest_active'] = 1.0;
            $effects['unrest_severity'] = round($severity, 4);

            // Baseline unrest penalties to economy and welfare.
            $effects['resource_output_mult'] -= 0.08 * $severity;
            $effects['food_output_mult'] -= 0.05 * $severity;
            $effects['happiness_flat'] -= 7.0 * $severity;
            $effects['public_services_flat'] -= 4.0 * $severity;

            // Approach-specific tradeoffs (Stellaris-like policy dilemma).
            if ($approach === 'repression') {
                $effects['fleet_readiness_mult'] += 0.06 * $severity;
                $effects['happiness_flat'] -= 3.0 * $severity;
            } elseif ($approach === 'reforms') {
                $effects['happiness_flat'] += 2.5 * $severity;
                $effects['resource_output_mult'] -= 0.04 * $severity;
                $effects['pop_growth_mult'] += 0.03 * $severity;
            } else { // conciliation/default
                $effects['happiness_flat'] += 1.2 * $severity;
                $effects['resource_output_mult'] -= 0.02 * $severity;
            }
        }
    } catch (Throwable $e) {
        // Optional until migration is applied.
    }

    $effects['resource_output_mult'] = max(-0.50, min(0.80, (float)$effects['resource_output_mult']));
    $effects['food_output_mult'] = max(-0.50, min(0.80, (float)$effects['food_output_mult']));
    $effects['pop_growth_mult'] = max(-0.50, min(0.80, (float)$effects['pop_growth_mult']));
    $effects['happiness_flat'] = max(-30.0, min(30.0, (float)$effects['happiness_flat']));
    $effects['public_services_flat'] = max(-25.0, min(25.0, (float)$effects['public_services_flat']));
    $effects['research_speed_mult'] = max(-0.50, min(0.80, (float)$effects['research_speed_mult']));
    $effects['fleet_readiness_mult'] = max(-0.50, min(0.80, (float)$effects['fleet_readiness_mult']));

    $cache[$userId] = $effects;
    return $effects;
}

function merge_effect_bundle(array $base, $bundle): array {
    if (!is_array($bundle)) {
        return $base;
    }
    foreach ($bundle as $key => $value) {
        if (!array_key_exists($key, $base)) {
            continue;
        }
        $base[$key] = (float)$base[$key] + (float)$value;
    }
    return $base;
}

function clamp_int_range(int $value, int $min, int $max): int {
    if ($value < $min) return $min;
    if ($value > $max) return $max;
    return $value;
}

function update_colony_resources(PDO $db, int $colonyId): void {
    $stmt = $db->prepare(
        'SELECT c.id, c.user_id, c.metal, c.crystal, c.deuterium, c.rare_earth, c.food,
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
         LEFT JOIN planets p ON p.id = c.planet_id
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

    // ── Active planetary event ────────────────────────────────────────────
    $activeColonyEvent = null;
    try {
        $evStmt = $db->prepare(
            'SELECT event_type FROM colony_events WHERE colony_id = ? AND expires_at > NOW() LIMIT 1'
        );
        $evStmt->execute([$colonyId]);
        $evRow = $evStmt->fetch(PDO::FETCH_ASSOC);
        if ($evRow) $activeColonyEvent = $evRow['event_type'];
    } catch (Throwable $e) { /* table may not exist pre-migration */ }

    // disease event is cleared early once hospital reaches level 3
    if ($activeColonyEvent === 'disease' && $hoL >= 3) {
        try {
            $db->prepare('DELETE FROM colony_events WHERE colony_id = ? AND event_type = "disease"')
               ->execute([$colonyId]);
            $activeColonyEvent = null;
        } catch (Throwable $e) { /* ignore pre-migration */ }
    }

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

    // ── Research-derived modifiers ───────────────────────────────────────
    $researchLevels = [];
    try {
        $rStmt = $db->prepare(
            'SELECT type, level FROM research
             WHERE user_id = ?
               AND type IN ("genetic_engineering", "dark_energy_tap", "terraforming_tech")'
        );
        $rStmt->execute([(int)($row['user_id'] ?? 0)]);
        foreach ($rStmt->fetchAll(PDO::FETCH_ASSOC) as $rRow) {
            $researchLevels[(string)$rRow['type']] = (int)$rRow['level'];
        }
    } catch (Throwable $e) { /* pre-migration */ }

    $geneticLvl = (int)($researchLevels['genetic_engineering'] ?? 0);
    $darkTapLvl = (int)($researchLevels['dark_energy_tap'] ?? 0);
    $terraformLvl = (int)($researchLevels['terraforming_tech'] ?? 0);

    // ── Energy balance ────────────────────────────────────────────────────
    $energyProd = solar_energy($spL) + fusion_energy($frL);
    if ($activeColonyEvent === 'solar_flare') {
        $energyProd *= 0.70; // solar flare: energy output -30%
    }
    $energyReq  = metal_production_energy($mmL)
                + crystal_production_energy($cmL)
                + deuterium_production_energy($dsL)
                + ($reL > 0 ? $reL * 15 : 0)       // rare-earth drill draws energy
                + ($hfL > 0 ? $hfL * 10 : 0);       // hydroponic farm draws energy
    $energyBalance = (int)round($energyProd - $energyReq);
    $efficiency    = $energyReq > 0 ? min(1.0, $energyProd / $energyReq) : 1.0;

    // ── Food system ───────────────────────────────────────────────────────
    $foodProdPerH   = food_production($hfL);
    if ($geneticLvl >= 1) {
        $foodProdPerH *= 1.25;
    }
    // Agricultural colony type bonus
    $colonyType = $row['colony_type'] ?? 'balanced';
    if ($colonyType === 'agricultural') $foodProdPerH *= 1.5;

    $userId = (int)($row['user_id'] ?? 0);
    $dynamicEffects = $userId > 0 ? empire_dynamic_effects($db, $userId) : [
        'resource_output_mult' => 0.0,
        'food_output_mult' => 0.0,
        'pop_growth_mult' => 0.0,
        'happiness_flat' => 0.0,
        'public_services_flat' => 0.0,
    ];

    $foodProdPerH *= (1.0 + (float)($dynamicEffects['food_output_mult'] ?? 0.0));
    $foodProdPerH = max(0.0, $foodProdPerH);

    // Population consumes 1 food/h per 100 people
    $foodConsumedPerH = $population / 100.0;
    $foodCoverage     = $foodConsumedPerH > 0
        ? min(2.0, $foodProdPerH / $foodConsumedPerH)
        : 1.0;
    $foodCap          = food_storage_cap($fsL);

    // ── Raw-resource production (richness + efficiency + happiness productivity) ──
    $resourceOutputMult = (float)($dynamicEffects['resource_output_mult'] ?? 0.0);
    $prodMulti     = happiness_productivity($happiness) * $efficiency * (1.0 + $resourceOutputMult);
    $metalProdH    = metal_production($mmL)                               * $richM  * $prodMulti;
    $crystalProdH  = crystal_production($cmL)                             * $richC  * $prodMulti;
    $effectiveTempMax = (int)($row['temp_max'] ?? 20);
    if ($terraformLvl >= 1) {
        $effectiveTempMax += 10;
    }
    $deutProdH     = deuterium_production($dsL, $effectiveTempMax) * $richD  * $prodMulti;
    $rareProdH     = rare_earth_production($reL)                           * $richRE * $prodMulti;

    // ── Deposit cap: limit production if deposit nearly exhausted ─────────
    if ($depM  >= 0) $metalProdH   = min($metalProdH,   $depM  / max($deltaH, 1) * $deltaH);
    if ($depC  >= 0) $crystalProdH = min($crystalProdH, $depC  / max($deltaH, 1) * $deltaH);
    if ($depD  >= 0) $deutProdH    = min($deutProdH,    $depD  / max($deltaH, 1) * $deltaH);
    if ($depRE >= 0) $rareProdH    = min($rareProdH,    $depRE / max($deltaH, 1) * $deltaH);

    // ── Colony-type production bonuses ────────────────────────────────────
    switch ($colonyType) {
        case 'mining':
            // +20% to all extractable resources
            $metalProdH   *= 1.2;
            $crystalProdH *= 1.2;
            $deutProdH    *= 1.2;
            $rareProdH    *= 1.2;
            break;
        case 'agricultural':
            // +30% food (already applied above)
            // Agricultural colonies also get +15% happiness bonus (applied below)
            break;
        case 'research':
            // Research time bonus handled in research_time() function
            break;
        case 'industrial':
            // Industrial build time/cost bonus handled in building_time() / ship_cost() functions
            break;
        case 'military':
            // Military ship stat bonuses handled in ship combat calculations
            break;
        // balanced: no bonuses
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

    // mineral_vein: metal production +20 %
    if ($activeColonyEvent === 'mineral_vein') {
        $metalProdH *= 1.20;
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
    $newPublicServices = clamp_int_range(
        $newPublicServices + (int)round((float)($dynamicEffects['public_services_flat'] ?? 0.0)),
        0,
        100
    );

    // ── Happiness ────────────────────────────────────────────────────────
    $newHappiness = compute_happiness($foodCoverage, $energyBalance, $newPublicServices);
    $newHappiness = clamp_int_range(
        $newHappiness + (int)round((float)($dynamicEffects['happiness_flat'] ?? 0.0)),
        0,
        100
    );

    if ($activeColonyEvent === 'disease') {
        $newHappiness = clamp_int_range($newHappiness - 25, 0, 100);
    }
    
    // ── Colony-type happiness bonuses ─────────────────────────────────────
    if ($colonyType === 'agricultural') {
        $newHappiness = clamp_int_range($newHappiness + 15, 0, 100);
    }

    // ── Hospital Ship orbit bonus (+8 happiness per ship, max 3 ships) ────
    try {
        $hsStmt = $db->prepare(
            'SELECT COALESCE(SUM(count), 0) FROM ships WHERE colony_id = ? AND type = \'hospital_ship\''
        );
        $hsStmt->execute([$colonyId]);
        $hospitalShips = min(3, (int)$hsStmt->fetchColumn());
        if ($hospitalShips > 0) {
            $newHappiness = clamp_int_range($newHappiness + $hospitalShips * 8, 0, 100);
        }
    } catch (Throwable $e) { /* ignore pre-migration */ }

    // ── Population max (500 base + habitat buildings) ─────────────────────
    $newMaxPop = 500 + habitat_capacity($haL);
    if ($geneticLvl >= 1) {
        $newMaxPop = (int)round($newMaxPop * 1.10);
    }

    // ── Population growth ─────────────────────────────────────────────────
    $growthPerH     = population_growth($population, $newMaxPop, $newHappiness, $foodCoverage);
    $growthPerH     = (int)round($growthPerH * (1.0 + (float)($dynamicEffects['pop_growth_mult'] ?? 0.0)));
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

    if ($darkTapLvl >= 1 && $frL > 0 && $userId > 0) {
        $darkGain = (int)floor(($energyProd * 0.005) * $deltaH);
        if ($darkGain > 0) {
            $db->prepare('UPDATE users SET dark_matter = dark_matter + ? WHERE id = ?')
               ->execute([$darkGain, $userId]);
        }
    }

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
 * Start/resolve internal-politics situations from weighted faction approval.
 */
function apply_faction_pressure_situations(PDO $db, int $userId): array {
    $result = [
        'triggered' => false,
        'resolved' => false,
        'faction_pressure_score' => null,
        'active_situation_id' => null,
    ];

    try {
        $stmt = $db->prepare('SELECT approval, support FROM user_faction_state WHERE user_id = ?');
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();
        if (!$rows) {
            return $result;
        }

        $weighted = 0.0;
        $weightSum = 0.0;
        foreach ($rows as $row) {
            $approval = (float)($row['approval'] ?? 50.0);
            $support = max(1.0, (float)($row['support'] ?? 1.0));
            $weighted += $approval * $support;
            $weightSum += $support;
        }
        $score = $weightSum > 0 ? ($weighted / $weightSum) : 50.0;
        $result['faction_pressure_score'] = round($score, 2);

        $check = $db->prepare(
            'SELECT id, status
             FROM situation_states
             WHERE user_id = ? AND situation_type = \'faction_unrest\' AND status = \'active\'
             ORDER BY id DESC
             LIMIT 1'
        );
        $triggerThreshold = defined('POLITICS_UNREST_TRIGGER_APPROVAL')
            ? (float)POLITICS_UNREST_TRIGGER_APPROVAL
            : 45.0;
        $recoverThreshold = defined('POLITICS_UNREST_RECOVERY_APPROVAL')
            ? (float)POLITICS_UNREST_RECOVERY_APPROVAL
            : 62.0;
        $progressPerHour = defined('POLITICS_UNREST_PROGRESS_PER_HOUR')
            ? (float)POLITICS_UNREST_PROGRESS_PER_HOUR
            : 1.0;

        if ($score < $triggerThreshold && !$active) {
            $db->prepare(
                'INSERT INTO situation_states (
                    user_id, colony_id, target_type, target_id, situation_type, status,
                    progress, stage, approach_key, approach_locked,
                    payload_json, monthly_deltas_json,
                    started_at, last_tick_at, ended_at
                 )
                 VALUES (
                    ?, NULL, \'empire\', NULL, \'faction_unrest\', \'active\',
                    5.0, 1, \'conciliation\', 0,
                    ?, ?,
                    NOW(), NOW(), NULL
                 )'
            )->execute([
                $userId,
                json_encode([
                    'origin' => 'faction_pressure',
                    'trigger_score' => round($score, 2),
                ]),
                json_encode([
                    'progress_per_hour' => $progressPerHour,
                    'approach_multipliers' => [
                        'conciliation' => 0.85,
                        'repression' => 1.35,
                        'reforms' => 0.65,
                    ],
                ]),
            ]);
            $result['triggered'] = true;
            $result['active_situation_id'] = (int)$db->lastInsertId();
            return $result;
        }

        if ($active) {
            $result['active_situation_id'] = (int)$active['id'];
            if ($score >= $recoverThreshold) {
                $db->prepare(
                    'UPDATE situation_states
                     SET status = \'resolved\',
                         progress = LEAST(100, GREATEST(progress, 75)),
                         stage = GREATEST(stage, 3),
                         ended_at = NOW(),
                         updated_at = NOW()
                     WHERE id = ? AND user_id = ?'
                )->execute([(int)$active['id'], $userId]);
                $result['resolved'] = true;
            }
        }
    } catch (Throwable $e) {
        // Optional system until migrations are applied.
    }

    return $result;
}

/**
 * Check whether the war strategy schema is available.
 */
function has_war_runtime_schema(PDO $db): bool {
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    try {
        $tables = ['wars', 'war_goals', 'peace_offers'];
        foreach ($tables as $table) {
            $st = $db->prepare(
                'SELECT 1
                 FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                 LIMIT 1'
            );
            $st->execute([$table]);
            if (!$st->fetchColumn()) {
                $cached = false;
                return $cached;
            }
        }
    } catch (Throwable $e) {
        $cached = false;
        return $cached;
    }

    $cached = true;
    return $cached;
}

/**
 * Global war runtime tick.
 *
 * Applies passive war exhaustion drift, expires stale peace offers,
 * and enforces forced peace when exhaustion reaches threshold.
 *
 * @return array{
 *   processed:bool,
 *   schema_ready:bool,
 *   elapsed_seconds:int,
 *   passive_delta:float,
 *   touched_wars:int,
 *   expired_offers:int,
 *   forced_peace:int,
 *   active_wars:int,
 *   last_tick:int
 * }
 */
function process_war_runtime_tick(PDO $db, bool $force = false): array {
    $result = [
        'processed' => false,
        'schema_ready' => false,
        'elapsed_seconds' => 0,
        'passive_delta' => 0.0,
        'touched_wars' => 0,
        'expired_offers' => 0,
        'goal_score_delta_att' => 0,
        'goal_score_delta_def' => 0,
        'forced_peace' => 0,
        'active_wars' => 0,
        'last_tick' => 0,
    ];

    if (!has_war_runtime_schema($db)) {
        return $result;
    }
    $result['schema_ready'] = true;

    $now = time();
    $lastTick = $now;
    $stateKey = 'war_runtime:last_tick';

    if (function_exists('app_state_get_int')) {
        $lastTick = app_state_get_int($db, $stateKey, $now);
        if ($lastTick <= 0) {
            $lastTick = $now;
        }
    }

    $elapsed = max(0, $now - $lastTick);
    $result['elapsed_seconds'] = $elapsed;
    $result['last_tick'] = $lastTick;

    try {
        // Expire pending offers independently from exhaustion cadence.
        $db->prepare(
            'UPDATE peace_offers
             SET status = "expired", responded_at = NOW()
             WHERE status = "pending" AND expires_at <= NOW()'
        )->execute();
        $result['expired_offers'] = (int)$db->query('SELECT ROW_COUNT()')->fetchColumn();

        $delta = 0.0;
        if ($elapsed > 0) {
            $perDay = defined('WAR_EXHAUSTION_PASSIVE_PER_DAY')
                ? (float)WAR_EXHAUSTION_PASSIVE_PER_DAY
                : 0.5;
            $delta = ($elapsed / 86400.0) * $perDay;
        }

        // Keep a minimum cadence unless explicitly forced.
        if ($force || $elapsed >= 300) {
            if ($delta > 0.0) {
                $threshold = defined('WAR_EXHAUSTION_FORCED_PEACE')
                    ? (float)WAR_EXHAUSTION_FORCED_PEACE
                    : 100.0;

                $st = $db->prepare(
                    'UPDATE wars
                     SET exhaustion_att = LEAST(?, exhaustion_att + ?),
                         exhaustion_def = LEAST(?, exhaustion_def + ?)
                     WHERE status = "active"'
                );
                $st->execute([$threshold, $delta, $threshold, $delta]);
                $result['touched_wars'] = (int)$db->query('SELECT ROW_COUNT()')->fetchColumn();
                $result['passive_delta'] = round($delta, 4);
            }

            $goalDeltas = process_war_goal_progress($db, $elapsed);
            $result['goal_score_delta_att'] = (int)($goalDeltas['att'] ?? 0);
            $result['goal_score_delta_def'] = (int)($goalDeltas['def'] ?? 0);

            if (function_exists('app_state_set_int')) {
                app_state_set_int($db, $stateKey, $now);
            }
        }

        $forcedThreshold = defined('WAR_EXHAUSTION_FORCED_PEACE')
            ? (float)WAR_EXHAUSTION_FORCED_PEACE
            : 100.0;
        $forcedStmt = $db->prepare(
            'UPDATE wars
             SET status = "ended",
                 ended_at = NOW(),
                 ended_reason = "forced_peace_exhaustion"
             WHERE status = "active"
               AND (exhaustion_att >= ? OR exhaustion_def >= ?)'
        );
        $forcedStmt->execute([$forcedThreshold, $forcedThreshold]);
        $result['forced_peace'] = (int)$db->query('SELECT ROW_COUNT()')->fetchColumn();

        $activeCount = $db->query('SELECT COUNT(*) FROM wars WHERE status = "active"');
        $result['active_wars'] = $activeCount ? (int)$activeCount->fetchColumn() : 0;
        $result['processed'] = true;
    } catch (Throwable $e) {
        error_log('process_war_runtime_tick error: ' . $e->getMessage());
    }

    return $result;
}

/**
 * Process economy pop satisfaction tick.
 *
 * Calculates satisfaction_index based on:
 * - Employment level (availability of jobs)
 * - Wages relative to requirements
 * - Culture spending (happiness)
 * - Safety budget (protection from pirates)
 * - War status (morale effects)
 * - Production yields (affects satisfaction)
 *
 * Satisfaction drives:
 * - Production multiplier (0.5x to 1.5x based on 0-100 satisfaction)
 * - Population migration (between colonies, out of faction)
 * - Building efficiency (workshop, university, temples)
 */
function process_economy_pop_satisfaction_tick(PDO $db, bool $force = false): array {
    $result = [
        'processed'           => false,
        'schema_ready'        => false,
        'colonies_processed'  => 0,
        'pop_updates'         => 0,
        'migrations'          => 0,
        'elapsed_seconds'     => 0,
        'last_tick'           => 0,
    ];

    // Check if tables exist
    $stmt = $db->query("SHOW TABLES LIKE 'economy_pop_classes'");
    if (!$stmt->fetch()) {
        return $result;
    }
    $result['schema_ready'] = true;

    $now = time();
    /**
     * Process war attrition tick.
     *
     * Calculates attrition damage based on:
     * - Supply line efficiency (distance + blockades)
     * - War exhaustion (prolonged conflict morale)
     * - Troop conditions (supply shortage penalties)
     *
     * Attrition reduces unit counts without direct combat engagement.
     */
    function process_war_attrition_tick(PDO $db, bool $force = false): array {
        $result = [
            'processed'         => false,
            'wars_processed'    => 0,
            'attrition_events'  => 0,
            'total_losses'      => 0,
            'elapsed_seconds'   => 0,
        ];

        $now = time();
        $stateKey = 'war:attrition_last_tick';

        if (function_exists('app_state_get_int')) {
            $lastTick = app_state_get_int($db, $stateKey, $now);
            if ($lastTick <= 0) $lastTick = $now;
        } else {
            $lastTick = $now;
        }

        $elapsed = max(0, $now - $lastTick);
        $result['elapsed_seconds'] = $elapsed;

        try {
            // Get all active wars
            $stmt = $db->query('SELECT id, attacker_user_id, defender_user_id, exhaustion_att, exhaustion_def FROM wars WHERE status = "active"');
            $wars = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

            foreach ($wars as $war) {
                $warId = (int)$war['id'];
                $attackerId = (int)$war['attacker_user_id'];
                $defenderId = (int)$war['defender_user_id'];
                $exhaustionAtt = (float)$war['exhaustion_att'];
                $exhaustionDef = (float)$war['exhaustion_def'];

                // Calculate base attrition from exhaustion
                // Higher exhaustion = higher attrition (0.5% base + 0.1% per exhaustion point)
                $baseAttritionAtt = 0.5 + ($exhaustionAtt * 0.001);
                $baseAttritionDef = 0.5 + ($exhaustionDef * 0.001);

                // Check supply efficiency penalties
                $supplyStmt = $db->prepare(<<<SQL
                    SELECT 
                        COUNT(*) as total_lines,
                        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_lines,
                        AVG(supply_capacity - interdiction_level * 0.5) as avg_efficiency
                    FROM war_supply_lines
                    WHERE war_id = ?
                SQL);
                $supplyStmt->execute([$warId]);
                $supply = $supplyStmt->fetch(PDO::FETCH_ASSOC);

                $supplyPenalty = 0;
                if ((int)$supply['total_lines'] > 0) {
                    $avgEff = (float)($supply['avg_efficiency'] ?? 100);
                    $supplyPenalty = (100 - $avgEff) * 0.01; // 1% attrition per 1% supply loss
                }

                // Calculate final attrition rates
                $attritionAtt = min(50, $baseAttritionAtt + $supplyPenalty); // Cap at 50% per tick
                $attritionDef = min(50, $baseAttritionDef + $supplyPenalty);

                // Record attrition events
                $eventStmt = $db->prepare(<<<SQL
                    INSERT INTO war_attrition_events
                    (war_id, attacker_id, defender_id, attrition_rate, cause, attacker_losses, defender_losses)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                SQL);
                $eventStmt->execute([
                    $warId,
                    $attackerId,
                    $defenderId,
                    $attritionAtt,
                    'supply_shortage',
                    (int)($attritionAtt * 10), // Placeholder loss calculations
                    (int)($attritionDef * 10),
                ]);

                $result['total_losses'] += (int)($attritionAtt * 10) + (int)($attritionDef * 10);
                $result['attrition_events']++;
                $result['wars_processed']++;
            }

            $result['processed'] = true;

            if (function_exists('app_state_set_int')) {
                app_state_set_int($db, $stateKey, $now);
            }

        } catch (Throwable $e) {
            error_log('process_war_attrition_tick error: ' . $e->getMessage());
        }

        return $result;
    }

    /**
     * Parse war-goal location tuple.
     * target_id is treated as system index by default.
     * target_value may be:
     * - numeric galaxy index
     * - "galaxy:system"
     */
    $lastTick = $now;
    $stateKey = 'economy:pop_satisfaction_last_tick';

    if (function_exists('app_state_get_int')) {
        $lastTick = app_state_get_int($db, $stateKey, $now);
        if ($lastTick <= 0) {
            $lastTick = $now;
        }
    }

    $elapsed = max(0, $now - $lastTick);
    $result['elapsed_seconds'] = $elapsed;
    $result['last_tick'] = $lastTick;

    try {
        // Get all colonies with pop classes
        $stmt = $db->prepare(<<<SQL
            SELECT DISTINCT c.id, c.user_id, c.name
            FROM colonies c
            WHERE EXISTS (
                SELECT 1 FROM economy_pop_classes epc
                WHERE epc.colony_id = c.id
            )
        SQL);
        $stmt->execute();
        $colonies = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($colonies as $colony) {
            $colonyId = (int)$colony['id'];
            $userId = (int)$colony['user_id'];

            // Recalculate satisfaction for each pop class in this colony
            $popStmt = $db->prepare(<<<SQL
                SELECT id, pop_class, count, satisfaction_index, employment_level,
                       wage_requirement, last_satisfaction_calc
                FROM economy_pop_classes
                WHERE colony_id = ?
            SQL);
            $popStmt->execute([$colonyId]);
            $popClasses = $popStmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($popClasses as $pop) {
                $popId = (int)$pop['id'];
                $popCount = (int)$pop['count'];
                $currentSatisfaction = (float)$pop['satisfaction_index'];
                $employmentLevel = (float)$pop['employment_level'];
                $wageReq = (float)$pop['wage_requirement'];

                // Satisfaction drivers (simplified model for now)
                // Base: current satisfaction
                $newSatisfaction = $currentSatisfaction;

                // Employment boost (+2 per points over 80%)
                if ($employmentLevel > 80) {
                    $newSatisfaction += min(10, ($employmentLevel - 80) * 0.2);
                } elseif ($employmentLevel < 60) {
                    $newSatisfaction -= min(15, (60 - $employmentLevel) * 0.25);
                }

                // Wage index change (trend)
                // Assuming wages have changed relative to requirements
                // For now, apply decay towards population satisfaction equilibrium
                $satisfactionGap = 50 - $newSatisfaction; // 50 is neutral
                $newSatisfaction += $satisfactionGap * 0.02; // Drift towards middle

                // Clamp satisfaction to 0-100
                $newSatisfaction = max(0, min(100, $newSatisfaction));

                // Calculate migration rate (% of pop migrating per tick)
                $migrationRate = 0.0;
                if ($newSatisfaction < 30) {
                    $migrationRate = min(5, (30 - $newSatisfaction) * 0.1); // Up to 5% migrate
                } elseif ($newSatisfaction > 80) {
                    $migrationRate = -1.0; // Immigration / not leaving  
                }

                // Update pop class
                $updateStmt = $db->prepare(<<<SQL
                    UPDATE economy_pop_classes
                    SET satisfaction_index = ?,
                        migration_rate = ?,
                        last_satisfaction_calc = NOW()
                    WHERE id = ?
                SQL);
                $updateStmt->execute([$newSatisfaction, $migrationRate, $popId]);
                $result['pop_updates']++;

                // Log satisfaction history
                $historyStmt = $db->prepare(<<<SQL
                    INSERT INTO economy_pop_satisfaction_history
                    (colony_id, pop_class, tick_number, satisfaction_index, employment_level, migration_rate, reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                SQL);
                $historyStmt->execute([
                    $colonyId,
                    $pop['pop_class'],
                    floor($now / 3600),  // Tick number (hourly)
                    $newSatisfaction,
                    $employmentLevel,
                    $migrationRate,
                    'auto_tick',
                ]);

                // Handle migrations (simplified — just track for now)
                if ($migrationRate > 1.0 && $popCount > 0) {
                    $migrantCount = (int)round($popCount * ($migrationRate / 100));
                    if ($migrantCount > 0) {
                        $migrationStmt = $db->prepare(<<<SQL
                            INSERT INTO economy_pop_migrations
                            (from_colony_id, to_colony_id, pop_class, migrant_count, reason)
                            VALUES (?, NULL, ?, ?, ?)
                        SQL);
                        $migrationStmt->execute([
                            $colonyId,
                            $pop['pop_class'],
                            $migrantCount,
                            'low_satisfaction',
                        ]);
                        $result['migrations']++;
                    }
                }
            }

            $result['colonies_processed']++;
        }

        $result['processed'] = true;

        // Update last tick timestamp
        if (function_exists('app_state_set_int')) {
            app_state_set_int($db, $stateKey, $now);
        }

    } catch (Throwable $e) {
        error_log('process_economy_pop_satisfaction_tick error: ' . $e->getMessage());
    }

    return $result;
}

/**
 * Process pirate raid resolution tick.
 *
 * Resolves pending pirate raids against colonies:
 * - Checks defense budget and countermeasures
 * - Calculates raid success probability
 * - Applies damage if successful
 * - Tracks recovery process
 */
function process_pirate_raid_resolution_tick(PDO $db, bool $force = false): array {
    $result = [
        'processed'         => false,
        'raids_resolved'    => 0,
        'raids_successful'  => 0,
        'damage_total'      => 0.0,
        'defenses_destroyed' => 0,
    ];

    try {
        // Get pending raid events from messages (simplified detection)
        // In full implementation, would have dedicated raid_queue table
        $stmt = $db->query(<<<SQL
            SELECT cm.receiver_id as user_id, c.id as colony_id, c.defense_budget, c.countermeasure_level
            FROM messages cm
            JOIN colonies c ON c.user_id = cm.receiver_id
            WHERE cm.subject = 'Pirate Raid!' 
                            AND cm.sent_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
                            AND cm.is_read = 0
            LIMIT 100
        SQL);
        $pendingRaids = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        foreach ($pendingRaids as $raid) {
            $colonyId = (int)$raid['colony_id'];
            $defenseBudget = (float)($raid['defense_budget'] ?? 0);
            $countermeasureLevel = (int)($raid['countermeasure_level'] ?? 0);

            // Calculate defense effectiveness (0-100%)
            $baseDefense = $countermeasureLevel;
            $budgetBonus = min(50, ($defenseBudget / 1000) * 10); // Cap 50% from budget
            $totalDefense = min(100, $baseDefense + $budgetBonus);

            // Raid intensity (placeholder - should come from raid data)
            $raidIntensity = rand(30, 90);

            // Success probability = max(0, raidIntensity - totalDefense)
            $successChance = max(0, min(100, $raidIntensity - $totalDefense));
            $raidSucceeds = (rand(0, 100) < $successChance);

            if ($raidSucceeds) {
                // Calculate damage
                $damagePercent = round(($raidIntensity - $totalDefense) / 2, 2); // 0-50% damage
                $damagePercent = max(5, min(50, $damagePercent)); // Clamp 5-50%

                // Record raid history
                $historyStmt = $db->prepare(<<<SQL
                    INSERT INTO pirate_raid_history
                    (colony_id, pirate_faction_id, raid_intensity, defense_level, raid_success, damage_percent)
                    VALUES (?, 1, ?, ?, 1, ?)
                SQL);
                $historyStmt->execute([$colonyId, round($raidIntensity, 2), $totalDefense, $damagePercent]);

                // Start recovery process
                $recoveryStmt = $db->prepare(<<<SQL
                    INSERT INTO pirate_damage_recovery
                    (colony_id, initial_damage, recovery_cost)
                    VALUES (?, ?, ?)
                SQL);
                $recoveryCost = round($damagePercent * 500, 2); // ~500 credits per % damage
                $recoveryStmt->execute([$colonyId, $damagePercent, $recoveryCost]);

                $result['raids_successful']++;
                $result['damage_total'] += $damagePercent;
            }

            $result['raids_resolved']++;
        }

        $result['processed'] = true;

    } catch (Throwable $e) {
        error_log('process_pirate_raid_resolution_tick error: ' . $e->getMessage());
    }

    return $result;
}

/**
 * Parse war-goal location tuple.
 * target_id is treated as system index by default.
 * target_value may be:
 * - numeric galaxy index
 * - "galaxy:system"
 */
function parse_war_goal_location(int $targetId, ?string $targetValue): ?array {
    $system = $targetId > 0 ? $targetId : null;
    $galaxy = null;

    $tv = trim((string)$targetValue);
    if ($tv !== '') {
        if (ctype_digit($tv)) {
            $galaxy = (int)$tv;
        } elseif (preg_match('/^(\d+)\s*:\s*(\d+)$/', $tv, $m)) {
            $galaxy = (int)$m[1];
            $system = (int)$m[2];
        }
    }

    if ($galaxy === null || $galaxy <= 0 || $system === null || $system <= 0) {
        return null;
    }

    return ['galaxy' => $galaxy, 'system' => $system];
}

/**
 * Count user colonies in a star system.
 */
function count_user_colonies_in_system(PDO $db, int $userId, int $galaxy, int $system): int {
    $st = $db->prepare(
        'SELECT COUNT(*)
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         WHERE c.user_id = ?
           AND cb.galaxy_index = ?
           AND cb.system_index = ?'
    );
    $st->execute([$userId, $galaxy, $system]);
    return (int)$st->fetchColumn();
}

/**
 * Resolve side-specific war participants and current metrics.
 *
 * @return array{owner_user_id:int,enemy_user_id:int,own_exhaustion:float,enemy_exhaustion:float,own_score:int,enemy_score:int}
 */
function war_side_snapshot(array $warRow, string $side): array {
    $isAttacker = ($side === 'attacker');
    return [
        'owner_user_id' => $isAttacker ? (int)($warRow['attacker_user_id'] ?? 0) : (int)($warRow['defender_user_id'] ?? 0),
        'enemy_user_id' => $isAttacker ? (int)($warRow['defender_user_id'] ?? 0) : (int)($warRow['attacker_user_id'] ?? 0),
        'own_exhaustion' => $isAttacker ? (float)($warRow['exhaustion_att'] ?? 0.0) : (float)($warRow['exhaustion_def'] ?? 0.0),
        'enemy_exhaustion' => $isAttacker ? (float)($warRow['exhaustion_def'] ?? 0.0) : (float)($warRow['exhaustion_att'] ?? 0.0),
        'own_score' => $isAttacker ? (int)($warRow['war_score_att'] ?? 0) : (int)($warRow['war_score_def'] ?? 0),
        'enemy_score' => $isAttacker ? (int)($warRow['war_score_def'] ?? 0) : (int)($warRow['war_score_att'] ?? 0),
    ];
}

/**
 * Determine score gain in milli-points for one goal over elapsed time.
 */
function war_goal_progress_milli(PDO $db, array $warRow, array $goalRow, int $elapsedSeconds): int {
    if ($elapsedSeconds <= 0) {
        return 0;
    }

    $side = (string)($goalRow['side'] ?? '');
    if ($side !== 'attacker' && $side !== 'defender') {
        return 0;
    }

    $snapshot = war_side_snapshot($warRow, $side);
    $goalType = (string)($goalRow['goal_type'] ?? '');
    $ratePerDay = defined('WAR_SCORE_OCCUPY_PER_DAY')
        ? (float)WAR_SCORE_OCCUPY_PER_DAY
        : 2.0;
    $days = $elapsedSeconds / 86400.0;

    if ($goalType === 'annex_system') {
        $loc = parse_war_goal_location((int)($goalRow['target_id'] ?? 0), (string)($goalRow['target_value'] ?? ''));
        if ($loc === null) {
            return 0;
        }

        $ownerCols = count_user_colonies_in_system($db, $snapshot['owner_user_id'], (int)$loc['galaxy'], (int)$loc['system']);
        $enemyCols = count_user_colonies_in_system($db, $snapshot['enemy_user_id'], (int)$loc['galaxy'], (int)$loc['system']);
        if ($ownerCols <= $enemyCols) {
            return 0;
        }

        return (int)round($days * $ratePerDay * 1000.0);
    }

    if ($goalType === 'attrition') {
        $gap = max(0.0, $snapshot['enemy_exhaustion'] - $snapshot['own_exhaustion']);
        if ($gap <= 0.0) {
            return 0;
        }

        // Scales from 0..WAR_SCORE_OCCUPY_PER_DAY based on exhaustion advantage.
        $scaledRate = $ratePerDay * min(1.0, $gap / 100.0);
        return (int)round($days * $scaledRate * 1000.0);
    }

    return 0;
}

/**
 * Read score remainder (milli-points) used for fractional war-score accumulation.
 */
function war_goal_remainder_get(PDO $db, int $warId, string $side): int {
    if (!function_exists('app_state_get_int')) {
        return 0;
    }
    $key = 'war_goal:rem_milli:' . $warId . ':' . $side;
    return max(0, app_state_get_int($db, $key, 0));
}

/**
 * Persist score remainder (milli-points) used for fractional war-score accumulation.
 */
function war_goal_remainder_set(PDO $db, int $warId, string $side, int $milli): void {
    if (!function_exists('app_state_set_int')) {
        return;
    }
    $key = 'war_goal:rem_milli:' . $warId . ':' . $side;
    app_state_set_int($db, $key, max(0, $milli));
}

/**
 * Apply war-goal score progression for active wars.
 *
 * Currently supported:
 * - goal_type=annex_system
 *   target_id: system index
 *   target_value: galaxy index or "galaxy:system"
 *   scoring: side gains WAR_SCORE_OCCUPY_PER_DAY while controlling the target system
 *
 * @return array{att:int,def:int}
 */
function process_war_goal_progress(PDO $db, int $elapsedSeconds): array {
    $out = ['att' => 0, 'def' => 0];
    if ($elapsedSeconds <= 0) {
        return $out;
    }

    $ratePerDay = defined('WAR_SCORE_OCCUPY_PER_DAY')
        ? (float)WAR_SCORE_OCCUPY_PER_DAY
        : 2.0;
    if ($ratePerDay <= 0.0) {
        return $out;
    }

    $days = $elapsedSeconds / 86400.0;
    if ($days <= 0.0) {
        return $out;
    }

    try {
        $warsStmt = $db->query(
            'SELECT id,
                    attacker_user_id,
                    defender_user_id,
                    war_score_att,
                    war_score_def,
                    exhaustion_att,
                    exhaustion_def
             FROM wars
             WHERE status = "active"'
        );
        $wars = $warsStmt ? ($warsStmt->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];
    } catch (Throwable $e) {
        error_log('process_war_goal_progress load wars error: ' . $e->getMessage());
        return $out;
    }

    foreach ($wars as $war) {
        $warId = (int)($war['id'] ?? 0);
        if ($warId <= 0 || (int)($war['attacker_user_id'] ?? 0) <= 0 || (int)($war['defender_user_id'] ?? 0) <= 0) {
            continue;
        }

        $goalStmt = $db->prepare(
            'SELECT side, goal_type, target_id, target_value
             FROM war_goals
             WHERE war_id = ?'
        );
        $goalStmt->execute([$warId]);
        $goals = $goalStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        if (!$goals) {
            continue;
        }

        $milliAddAtt = 0;
        $milliAddDef = 0;

        foreach ($goals as $goal) {
            $side = (string)($goal['side'] ?? '');
            $milli = war_goal_progress_milli($db, $war, $goal, $elapsedSeconds);
            if ($milli <= 0) {
                continue;
            }
            if ($side === 'attacker') {
                $milliAddAtt += $milli;
            }
            if ($side === 'defender') {
                $milliAddDef += $milli;
            }
        }

        $carryAtt = war_goal_remainder_get($db, $warId, 'att');
        $carryDef = war_goal_remainder_get($db, $warId, 'def');

        $sumAtt = $carryAtt + $milliAddAtt;
        $sumDef = $carryDef + $milliAddDef;

        $pointsAtt = intdiv($sumAtt, 1000);
        $pointsDef = intdiv($sumDef, 1000);

        war_goal_remainder_set($db, $warId, 'att', $sumAtt % 1000);
        war_goal_remainder_set($db, $warId, 'def', $sumDef % 1000);

        if ($pointsAtt > 0 || $pointsDef > 0) {
            $up = $db->prepare(
                'UPDATE wars
                 SET war_score_att = war_score_att + ?,
                     war_score_def = war_score_def + ?
                 WHERE id = ? AND status = "active"'
            );
            $up->execute([$pointsAtt, $pointsDef, $warId]);
            $out['att'] += $pointsAtt;
            $out['def'] += $pointsDef;
        }
    }

    return $out;
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
    'nano_materials'          => ['metal' => 2000, 'crystal' => 6000, 'deuterium' => 2000],
    'genetic_engineering'     => ['metal' => 3000, 'crystal' => 5000, 'deuterium' => 3000],
    'quantum_computing'       => ['metal' => 8000, 'crystal' =>12000, 'deuterium' => 8000],
    'dark_energy_tap'         => ['metal' =>12000, 'crystal' =>16000, 'deuterium' =>14000],
    'wormhole_theory'         => ['metal' =>16000, 'crystal' =>22000, 'deuterium' =>18000],
    'terraforming_tech'       => ['metal' => 5000, 'crystal' => 9000, 'deuterium' => 5000],
    'stealth_tech'            => ['metal' => 7000, 'crystal' =>11000, 'deuterium' => 9000],
];

const RESEARCH_PREREQS = [
    // Base techs (no prerequisites)
    'energy_tech'        => [],
    'computer_tech'      => [],
    'weapons_tech'       => [],

    // Tier 1: depend on base techs
    'laser_tech'         => [['energy_tech', 1]],
    'combustion_drive'   => [['energy_tech', 1]],
    'espionage_tech'     => [['computer_tech', 1]],
    'shielding_tech'     => [['energy_tech', 2], ['weapons_tech', 1]],
    'armor_tech'         => [['weapons_tech', 2]],

    // Tier 2: depend on Tier 1
    'ion_tech'           => [['laser_tech', 2], ['energy_tech', 3]],
    'impulse_drive'      => [['combustion_drive', 2], ['energy_tech', 3]],
    'hyperspace_tech'    => [['impulse_drive', 2], ['computer_tech', 2]],
    'plasma_tech'        => [['energy_tech', 4], ['ion_tech', 2], ['weapons_tech', 3]],

    // Tier 3: depend on Tier 2
    'astrophysics'       => [['hyperspace_tech', 2], ['impulse_drive', 3]],
    'hyperspace_drive'   => [['impulse_drive', 5], ['hyperspace_tech', 3]],

    // Tier 4: depend on Tier 3
    'intergalactic_network' => [['astrophysics', 7], ['computer_tech', 10]],
    'graviton_tech'         => [['intergalactic_network', 5], ['hyperspace_drive', 8]],

    // Extended tier (Phase 5.1)
    'nano_materials'        => [['armor_tech', 3], ['computer_tech', 3]],
    'genetic_engineering'   => [['energy_tech', 4], ['astrophysics', 2]],
    'quantum_computing'     => [['computer_tech', 6], ['ion_tech', 4]],
    'dark_energy_tap'       => [['plasma_tech', 5], ['energy_tech', 8]],
    'wormhole_theory'       => [['hyperspace_drive', 6], ['astrophysics', 5]],
    'terraforming_tech'     => [['astrophysics', 3], ['energy_tech', 5]],
    'stealth_tech'          => [['espionage_tech', 6], ['hyperspace_tech', 4]],
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
    // ── Phase 5.2 additions ──────────────────────────────────────────────────────────
    'frigate'        => ['cost' => ['metal' =>  9000, 'crystal' =>  4000, 'deuterium' =>  1000], 'cargo' =>   200, 'speed' => 20000, 'attack' => 180, 'shield' =>  35, 'hull' => 10000],
    'carrier'        => ['cost' => ['metal' => 80000, 'crystal' => 60000, 'deuterium' => 25000], 'cargo' =>   800, 'speed' =>  5000, 'attack' => 800, 'shield' =>1500, 'hull' =>250000, 'fighter_wing_slots' => 12],
    'mining_drone'   => ['cost' => ['metal' => 12000, 'crystal' =>  2000, 'deuterium' =>  1500], 'cargo' => 55000, 'speed' =>   300, 'attack' =>   0, 'shield' =>   5, 'hull' =>  6000],
    'hospital_ship'  => ['cost' => ['metal' => 20000, 'crystal' => 25000, 'deuterium' =>  8000], 'cargo' =>   200, 'speed' =>  4000, 'attack' =>   0, 'shield' => 150, 'hull' => 18000],
    'science_vessel' => ['cost' => ['metal' => 25000, 'crystal' => 35000, 'deuterium' => 12000], 'cargo' =>   100, 'speed' =>  5000, 'attack' =>   0, 'shield' =>  80, 'hull' => 12000],
];
