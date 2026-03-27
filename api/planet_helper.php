<?php
/**
 * Planet DB helper — shared between galaxy.php, fleet.php, npc_ai.php.
 *
 * Special deposit values:
 *   -1 (DEPOSIT_UNLIMITED) = inexhaustible resource (e.g. deuterium on gas giants)
 *    0                     = fully depleted
 *   >0                     = remaining units
 */

/** Sentinel value for inexhaustible planet deposits (e.g. gas-giant deuterium). */
const DEPOSIT_UNLIMITED = -1;

/**
 * Ensure a planet row exists for (galaxy, system, position).
 *
 * If the planet is not yet in the DB, this function:
 *  1. Generates the full star system (may also INSERT into `star_systems`)
 *  2. Finds the matching planet by position
 *  3. INSERTs a `planets` row with proper richness + deposit values
 *
 * Side effects: may write to `star_systems` and `planets` tables.
 *
 * @param PDO $db
 * @param int $galaxy   1-based galaxy index
 * @param int $system   1-based system index
 * @param int $position 1-based planet position
 * @return int          DB id of the planet row
 */

/**
 * Map a planet_class to the legacy `type` enum column.
 * type ENUM('terrestrial','gas_giant','ice','desert','volcanic')
 */
function planet_class_to_type(string $planetClass): string {
    return match ($planetClass) {
        'lava'                    => 'volcanic',
        'gas_giant', 'hot_jupiter'=> 'gas_giant',
        'ice_giant', 'ice_dwarf',
        'comet_belt'              => 'ice',
        default                   => 'terrestrial',
    };
}

/**
 * Ensure a planet row exists for (galaxy, system, position).
 * Generates the full star-system if not yet cached, inserts the planet with
 * proper richness + deposit values derived from planet class.
 * Returns the planet DB id.
 */
function ensure_planet(PDO $db, int $galaxy, int $system, int $position): int {
    $row = $db->prepare('SELECT id FROM planets WHERE galaxy=? AND `system`=? AND position=?');
    $row->execute([$galaxy, $system, $position]);
    if ($r = $row->fetch()) return (int)$r['id'];

    require_once __DIR__ . '/galaxy_gen.php';
    $sys = generate_star_system($galaxy, $system);

    $genPlanet = null;
    foreach ($sys['planets'] as $gp) {
        if ((int)$gp['position'] === $position) { $genPlanet = $gp; break; }
    }

    if (!$genPlanet) {
        $db->prepare(
            'INSERT INTO planets (galaxy,`system`,position,type,planet_class) VALUES (?,?,?,\'terrestrial\',\'rocky\')'
        )->execute([$galaxy, $system, $position]);
        return (int)$db->lastInsertId();
    }

    $pClass = $genPlanet['planet_class'];
    $pType  = planet_class_to_type($pClass);

    if (function_exists('ensure_planet_science_columns')) {
        ensure_planet_science_columns($db);
    }

    $db->prepare(
        'INSERT INTO planets
         (galaxy, `system`, position, type, planet_class, diameter,
          temp_min, temp_max, in_habitable_zone, semi_major_axis_au,
          orbital_period_days, orbital_eccentricity, surface_gravity_g, atmosphere_type,
          richness_metal, richness_crystal, richness_deuterium, richness_rare_earth,
          deposit_metal, deposit_crystal, deposit_deuterium, deposit_rare_earth,
          composition_family, dominant_surface_material, surface_pressure_bar,
          water_state, methane_state, ammonia_state, dominant_surface_liquid,
          radiation_level, habitability_score, life_friendliness, species_affinity_json)
         VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?)'
    )->execute([
        $galaxy, $system, $position,
        $pType, $pClass,
        $genPlanet['diameter_km'] ?? 12742,
        $genPlanet['temp_min'] ?? -20, $genPlanet['temp_max'] ?? 40,
        $genPlanet['in_habitable_zone'] ?? 0,
        $genPlanet['semi_major_axis_au']   ?? 1.0,
        $genPlanet['orbital_period_days']  ?? 365.0,
        $genPlanet['orbital_eccentricity'] ?? 0.02,
        $genPlanet['surface_gravity_g']    ?? 1.0,
        $genPlanet['atmosphere_type']      ?? 'nitrogen_oxygen',
        $genPlanet['richness_metal']       ?? 1.0,
        $genPlanet['richness_crystal']     ?? 1.0,
        $genPlanet['richness_deuterium']   ?? 1.0,
        $genPlanet['richness_rare_earth']  ?? 0.5,
        $genPlanet['deposit_metal']        ?? 5000000,
        $genPlanet['deposit_crystal']      ?? 2000000,
        $genPlanet['deposit_deuterium']    ?? 1000000,
        $genPlanet['deposit_rare_earth']   ?? 200000,
        $genPlanet['composition_family']   ?? 'silicate_metal',
        $genPlanet['dominant_surface_material'] ?? 'basaltic_regolith',
        $genPlanet['surface_pressure_bar'] ?? 0.0,
        $genPlanet['water_state']          ?? 'solid',
        $genPlanet['methane_state']        ?? 'gas',
        $genPlanet['ammonia_state']        ?? 'gas',
        $genPlanet['dominant_surface_liquid'] ?? 'none',
        $genPlanet['radiation_level']      ?? 'moderate',
        $genPlanet['habitability_score']   ?? 0,
        $genPlanet['life_friendliness']    ?? 'life_hostile',
        json_encode($genPlanet['species_suitability'] ?? [], JSON_UNESCAPED_SLASHES),
    ]);
    return (int)$db->lastInsertId();
}
