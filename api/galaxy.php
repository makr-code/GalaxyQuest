<?php
/**
 * Galaxy map API
 *
 * GET /api/galaxy.php?galaxy=1&system=1
 *
 * Returns the star-system descriptor (spectral class, 3-D position,
 * habitable zone, frost line, scientifically generated planets) together
 * with any player-colonised planets in this system.
 *
 * The star system is generated deterministically on first access and then
 * cached in the star_systems table for subsequent queries.
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/galaxy_gen.php';
require_once __DIR__ . '/galaxy_seed.php';
require_once __DIR__ . '/game_engine.php';

only_method('GET');
require_auth();

$action = (string)($_GET['action'] ?? 'system');
$g = max(1, min(GALAXY_MAX, (int)($_GET['galaxy'] ?? 1)));
$s = max(1, min(galaxy_system_limit(), (int)($_GET['system'] ?? 1)));

$db = get_db();
ensure_galaxy_bootstrap_progress($db, true);

if ($action === 'stars') {
    $from = max(1, min(galaxy_system_limit(), (int)($_GET['from'] ?? 1)));
    $to = max($from, min(galaxy_system_limit(), (int)($_GET['to'] ?? galaxy_system_limit())));
    $maxPoints = max(100, min(50000, (int)($_GET['max_points'] ?? 1500)));

    // Make sure the requested range is generated and cached.
    ensure_star_system($db, $g, $from);
    ensure_star_system($db, $g, $to);

    $span = max(1, $to - $from + 1);
    $stride = max(1, (int)ceil($span / $maxPoints));

    $stmt = $db->prepare(
                                'SELECT id, galaxy_index, system_index, name,
                                COALESCE(NULLIF(catalog_name, ""), name) AS catalog_name,
                spectral_class, subtype, x_ly, y_ly, z_ly,
                                planet_count, hz_inner_au, hz_outer_au
         FROM star_systems
         WHERE galaxy_index = ?
           AND system_index BETWEEN ? AND ?
           AND MOD(system_index - ?, ?) = 0
         ORDER BY system_index ASC'
    );
    $stmt->execute([$g, $from, $to, $from, $stride]);
    $stars = $stmt->fetchAll();

    json_ok([
        'action' => 'stars',
        'galaxy' => $g,
        'from' => $from,
        'to' => $to,
        'stride' => $stride,
        'count' => count($stars),
        'server_ts' => gmdate('c'),
        'server_ts_ms' => (int)round(microtime(true) * 1000),
        'stars' => $stars,
    ]);
    exit;
}

// ── 1. Ensure star system is generated and cached ─────────────────────────────
$starSystem = ensure_star_system($db, $g, $s);
if (!isset($starSystem['catalog_name']) || $starSystem['catalog_name'] === '') {
    $starSystem['catalog_name'] = (string)($starSystem['name'] ?? '');
}

// ── 2. Query player-colonised planets ─────────────────────────────────────────
$stmt = $db->prepare(
    'SELECT p.id, p.position, p.type, p.planet_class, p.diameter,
            p.temp_min, p.temp_max, p.in_habitable_zone,
            p.semi_major_axis_au, p.orbital_period_days,
            p.surface_gravity_g, p.atmosphere_type,
            p.composition_family, p.dominant_surface_material,
            p.surface_pressure_bar, p.water_state, p.methane_state,
            p.ammonia_state, p.dominant_surface_liquid, p.radiation_level,
            p.habitability_score, p.life_friendliness, p.species_affinity_json,
            c.name, c.id AS colony_id, c.user_id,
            u.username AS owner
     FROM colonies c
     JOIN planets p ON p.id = c.planet_id
     JOIN users u   ON u.id = c.user_id
    WHERE p.galaxy = ? AND p.`system` = ?
     ORDER BY p.position ASC'
);
$stmt->execute([$g, $s]);
$rows = $stmt->fetchAll();

// Build a slot map keyed by position
$playerSlots = [];
foreach ($rows as $row) {
    $playerSlots[(int)$row['position']] = $row;
}

$colonyIds = array_values(array_filter(array_map(static fn(array $row): int => (int)($row['colony_id'] ?? 0), $rows)));
$buildingsByColony = [];
$shipsByColony = [];
if ($colonyIds) {
    $placeholders = implode(',', array_fill(0, count($colonyIds), '?'));
    $buildingStmt = $db->prepare("SELECT colony_id, type, level FROM buildings WHERE colony_id IN ($placeholders) ORDER BY colony_id, type");
    $buildingStmt->execute($colonyIds);
    foreach ($buildingStmt->fetchAll() as $buildingRow) {
        $buildingsByColony[(int)$buildingRow['colony_id']][] = $buildingRow;
    }
    $shipStmt = $db->prepare("SELECT colony_id, type, count FROM ships WHERE colony_id IN ($placeholders) ORDER BY colony_id, type");
    $shipStmt->execute($colonyIds);
    foreach ($shipStmt->fetchAll() as $shipRow) {
        $shipsByColony[(int)$shipRow['colony_id']][(string)$shipRow['type']] = (int)$shipRow['count'];
    }
}

foreach ($playerSlots as $position => &$slotRow) {
    $colonyId = (int)($slotRow['colony_id'] ?? 0);
    $slotRow['orbital_facilities'] = summarize_orbital_facilities($buildingsByColony[$colonyId] ?? [], $shipsByColony[$colonyId] ?? []);
}
unset($slotRow);

// Merge generated planets with player slots (player data takes precedence)
$posMax  = defined('POSITION_MAX') ? POSITION_MAX : 15;
$mergedPlanets = [];
for ($pos = 1; $pos <= $posMax; $pos++) {
    $genPlanet = null;
    foreach ($starSystem['planets'] as $gp) {
        if ((int)$gp['position'] === $pos) {
            $genPlanet = $gp;
            break;
        }
    }
    $mergedPlanets[] = [
        'position'         => $pos,
        'player_planet'    => $playerSlots[$pos] ?? null,
        'generated_planet' => $genPlanet,
    ];
}

$fleetStmt = $db->prepare(
    'SELECT f.id, f.user_id, f.origin_colony_id, f.target_galaxy, f.target_system, f.target_position,
            f.mission, f.ships_json, f.departure_time, f.arrival_time, f.return_time, f.returning,
            f.origin_x_ly, f.origin_y_ly, f.origin_z_ly, f.target_x_ly, f.target_y_ly, f.target_z_ly,
            p.galaxy AS origin_galaxy, p.`system` AS origin_system, p.position AS origin_position,
            u.username AS owner
     FROM fleets f
     JOIN colonies c ON c.id = f.origin_colony_id
     JOIN planets p ON p.id = c.planet_id
     JOIN users u ON u.id = f.user_id
     WHERE (p.galaxy = ? AND p.`system` = ?) OR (f.target_galaxy = ? AND f.target_system = ?)
     ORDER BY f.arrival_time ASC'
);
$fleetStmt->execute([$g, $s, $g, $s]);
$fleetsInSystem = [];
foreach ($fleetStmt->fetchAll() as $fleetRow) {
    $ships = json_decode((string)$fleetRow['ships_json'], true);
    $fleetRow['ships'] = is_array($ships) ? $ships : [];
    $fleetRow['vessels'] = vessel_manifest($fleetRow['ships']);
    unset($fleetRow['ships_json']);
    $fleetRow['current_pos'] = fleet_current_position($fleetRow);
    $fleetsInSystem[] = $fleetRow;
}

json_ok([
    'galaxy'      => $g,
    'system'      => $s,
    'system_max'  => galaxy_system_limit(),
    'server_ts'   => gmdate('c'),
    'server_ts_ms'=> (int)round(microtime(true) * 1000),
    'star_system' => $starSystem,
    'planets'     => $mergedPlanets,
    'fleets_in_system' => $fleetsInSystem,
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

require_once __DIR__ . '/planet_helper.php';

/**
 * Return the star system row from DB, generating and inserting it first if needed.
 */
function ensure_star_system(PDO $db, int $galaxyIdx, int $systemIdx): array
{
    return cache_generated_system($db, $galaxyIdx, $systemIdx, true);
}

