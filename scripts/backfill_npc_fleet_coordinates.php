<?php
/**
 * Backfill 3D coordinates for NPC fleet records.
 * 
 * NPC fleets created by seed scripts may not have origin_x_ly, origin_y_ly, origin_z_ly,
 * target_x_ly, target_y_ly, target_z_ly populated. This script recalculates them from
 * the origin and target system IDs via get_system_3d_coords() and updates the fleet records.
 * 
 * Usage:
 *   php scripts/backfill_npc_fleet_coordinates.php [--all] [--limit N]
 * 
 * Options:
 *   --all      Update ALL fleet records (both player and NPC)
 *   --limit N  Limit to N fleets per batch (default: 100)
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/game_engine.php';

$all   = in_array('--all', $argv, true);
$limit = 100;
foreach ($argv as $arg) {
    if (strpos($arg, '--limit=') === 0) {
        $limit = (int)substr($arg, 8);
    }
}

$db = get_db();

try {
    // Find fleets that need coordinate backfill
    // Conditions: origin_x_ly=0 AND origin_y_ly=0 AND origin_z_ly=0
    // (indicating placeholder/uninitialized state)
    
    $query = 'SELECT f.id, f.user_id, c.id AS colony_id,
                     cb1.galaxy_index AS origin_galaxy, cb1.system_index AS origin_system, cb1.position AS origin_position,
                     f.target_galaxy, f.target_system, f.target_position,
                     f.origin_x_ly, f.origin_y_ly, f.origin_z_ly,
                     f.target_x_ly, f.target_y_ly, f.target_z_ly
              FROM fleets f
              JOIN colonies c ON c.id = f.origin_colony_id
              JOIN celestial_bodies cb1 ON cb1.id = c.body_id';
    
    if (!$all) {
        $query .= ' JOIN users u ON u.id = f.user_id';
    }
    
    $query .= ' WHERE f.origin_x_ly = 0 AND f.origin_y_ly = 0 AND f.origin_z_ly = 0';
    
    if (!$all) {
        $query .= ' AND u.control_type = \'npc_engine\'';
    }
    
    $query .= ' ORDER BY f.id ASC LIMIT ?';
    
    $stmt = $db->prepare($query);
    $stmt->execute([$limit]);
    $fleets = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    if (empty($fleets)) {
        echo "No fleets with missing coordinates found.\n";
        exit(0);
    }
    
    echo "Found " . count($fleets) . " fleet(s) with missing coordinates. Backfilling...\n";
    
    $updated = 0;
    foreach ($fleets as $fleet) {
        $fid = (int)$fleet['id'];
        
        try {
            // Get 3D coordinates for origin
            [$ox, $oy, $oz] = get_system_3d_coords(
                $db,
                (int)$fleet['origin_galaxy'],
                (int)$fleet['origin_system']
            );
            
            // Get 3D coordinates for target
            [$tx, $ty, $tz] = get_system_3d_coords(
                $db,
                (int)$fleet['target_galaxy'],
                (int)$fleet['target_system']
            );
            
            // Recalculate distance and polar coordinates
            $distLy = fleet_3d_distance($ox, $oy, $oz, $tx, $ty, $tz);
            $originPolar = galactic_polar_from_cartesian($ox, $oy, $oz);
            $targetPolar = galactic_polar_from_cartesian($tx, $ty, $tz);
            
            // Update the fleet record
            $updateStmt = $db->prepare(
                'UPDATE fleets SET
                    origin_x_ly = ?, origin_y_ly = ?, origin_z_ly = ?,
                    origin_radius_ly = ?, origin_theta_rad = ?, origin_height_ly = ?,
                    target_x_ly = ?, target_y_ly = ?, target_z_ly = ?,
                    target_radius_ly = ?, target_theta_rad = ?, target_height_ly = ?,
                    distance_ly = ?
                 WHERE id = ?'
            );
            
            $updateStmt->execute([
                $ox, $oy, $oz,
                $originPolar['radius_ly'], $originPolar['theta_rad'], $originPolar['height_ly'],
                $tx, $ty, $tz,
                $targetPolar['radius_ly'], $targetPolar['theta_rad'], $targetPolar['height_ly'],
                $distLy,
                $fid
            ]);
            
            $updated++;
            echo "  [✓] Fleet #$fid: origin ($ox, $oy, $oz) → target ($tx, $ty, $tz)\n";
        } catch (Throwable $e) {
            echo "  [✗] Fleet #$fid: " . $e->getMessage() . "\n";
        }
    }
    
    echo "\nBackfill complete. Updated $updated fleet(s).\n";
    echo "Dirty user queue will trigger projection cache invalidation.\n";
    
} catch (Throwable $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
    exit(1);
}
