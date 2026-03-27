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

only_method('GET');
require_auth();

$g = max(1, min(GALAXY_MAX, (int)($_GET['galaxy'] ?? 1)));
$s = max(1, min(SYSTEM_MAX, (int)($_GET['system'] ?? 1)));

$db = get_db();

// ── 1. Ensure star system is generated and cached ─────────────────────────────
$starSystem = ensure_star_system($db, $g, $s);

// ── 2. Query player-colonised planets ─────────────────────────────────────────
$stmt = $db->prepare(
    'SELECT p.id, p.position, p.type, p.planet_class, p.diameter,
            p.temp_min, p.temp_max, p.in_habitable_zone,
            p.semi_major_axis_au, p.orbital_period_days,
            p.surface_gravity_g, p.atmosphere_type,
            c.name, c.id AS colony_id, c.user_id,
            u.username AS owner
     FROM colonies c
     JOIN planets p ON p.id = c.planet_id
     JOIN users u   ON u.id = c.user_id
     WHERE p.galaxy = ? AND p.system = ?
     ORDER BY p.position ASC'
);
$stmt->execute([$g, $s]);
$rows = $stmt->fetchAll();

// Build a slot map keyed by position
$playerSlots = [];
foreach ($rows as $row) {
    $playerSlots[(int)$row['position']] = $row;
}

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

json_ok([
    'galaxy'      => $g,
    'system'      => $s,
    'star_system' => $starSystem,
    'planets'     => $mergedPlanets,
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return the star system row from DB, generating and inserting it first if needed.
 */
function ensure_star_system(PDO $db, int $galaxyIdx, int $systemIdx): array
{
    $stmt = $db->prepare(
        'SELECT * FROM star_systems WHERE galaxy_index = ? AND system_index = ?'
    );
    $stmt->execute([$galaxyIdx, $systemIdx]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        // Reattach generated planets (not stored in DB, computed on demand)
        $system          = $row;
        $system['planets'] = generate_planets(
            [
                'spectral_class'   => $row['spectral_class'],
                'subtype'          => (int)$row['subtype'],
                'luminosity_class' => $row['luminosity_class'],
                'mass_solar'       => (float)$row['mass_solar'],
                'radius_solar'     => (float)$row['radius_solar'],
                'temperature_k'    => (int)$row['temperature_k'],
                'luminosity_solar' => (float)$row['luminosity_solar'],
            ],
            $galaxyIdx,
            $systemIdx
        );
        return $system;
    }

    // Generate and cache
    $system = generate_star_system($galaxyIdx, $systemIdx);
    $db->prepare(
        'INSERT IGNORE INTO star_systems
             (galaxy_index, system_index, x_ly, y_ly, z_ly,
              spectral_class, subtype, luminosity_class,
              mass_solar, radius_solar, temperature_k, luminosity_solar,
              hz_inner_au, hz_outer_au, frost_line_au, name)
         VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?,?)'
    )->execute([
        $galaxyIdx, $systemIdx,
        $system['x_ly'], $system['y_ly'], $system['z_ly'],
        $system['spectral_class'], $system['subtype'], $system['luminosity_class'],
        $system['mass_solar'], $system['radius_solar'],
        $system['temperature_k'], $system['luminosity_solar'],
        $system['hz_inner_au'], $system['hz_outer_au'],
        $system['frost_line_au'], $system['name'],
    ]);

    return $system;
}

