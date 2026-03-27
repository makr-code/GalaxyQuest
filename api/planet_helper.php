<?php
/**
 * Planet DB helper — shared between galaxy.php, fleet.php, npc_ai.php.
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
    $row = $db->prepare('SELECT id FROM planets WHERE galaxy=? AND system=? AND position=?');
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
            'INSERT INTO planets (galaxy,system,position,type,planet_class) VALUES (?,?,?,\'terrestrial\',\'rocky\')'
        )->execute([$galaxy, $system, $position]);
        return (int)$db->lastInsertId();
    }

    $pClass = $genPlanet['planet_class'];
    $pType  = planet_class_to_type($pClass);

    $db->prepare(
        'INSERT INTO planets
         (galaxy, system, position, type, planet_class, diameter, mass_earth,
          temp_min, temp_max, in_habitable_zone, semi_major_axis_au,
          orbital_period_days, orbital_eccentricity, surface_gravity_g, atmosphere_type,
          richness_metal, richness_crystal, richness_deuterium, richness_rare_earth,
          deposit_metal, deposit_crystal, deposit_deuterium, deposit_rare_earth)
         VALUES (?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?)'
    )->execute([
        $galaxy, $system, $position,
        $pType, $pClass,
        $genPlanet['diameter_km'] ?? 12742,
        $genPlanet['mass_earth']  ?? 1.0,
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
    ]);
    return (int)$db->lastInsertId();
}
