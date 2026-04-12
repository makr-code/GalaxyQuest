<?php
/**
 * Test: System planets generation and API response
 * Überprüft, ob Planeten-Daten korrekt geladen und gesendet werden
 */

require_once __DIR__ . '/../../api/helpers.php';
require_once __DIR__ . '/../../api/galaxy_gen.php';
require_once __DIR__ . '/../../api/galaxy_seed.php';
require_once __DIR__ . '/../../api/planet_helper.php';

$db = get_db();

// Test verschiedene Systeme
$testSystems = [
    [1, 1, 'System 1-1'],
    [1, 100, 'System 1-100'],
    [1, 500, 'System 1-500'],
];

foreach ($testSystems as [$g, $s, $label]) {
    echo "\n=== $label (Galaxy $g, System $s) ===\n";
    
    // Generate full system
    $starSystem = cache_generated_system($db, $g, $s, true);
    
    echo "Stars name: " . $starSystem['name'] . "\n";
    echo "Planet count from DB: " . $starSystem['planet_count'] . "\n";
    echo "Generated planets in array: " . count($starSystem['planets'] ?? []) . "\n";
    
    if (is_array($starSystem['planets'])) {
        foreach ($starSystem['planets'] as $p) {
            $semi = $p['semi_major_axis_au'] ?? 'N/A';
            $period = $p['orbital_period_days'] ?? 'N/A';
            $class = $p['planet_class'] ?? 'N/A';
            $moons = is_array($p['moons'] ?? null) ? count($p['moons']) : 0;
            echo sprintf(
                "  Planet %d: %s, %.2f AU, %.1f days, %d moons\n",
                $p['position'] ?? 0,
                $class,
                $semi,
                $period,
                $moons
            );
        }
    }
    
    // Now check what the API would send
    $playerSlots = [];
    $mergedPlanets = [];
    $posMax = 15;
    
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
    
    $validCount = count(array_filter($mergedPlanets, fn($p) => $p['generated_planet'] !== null));
    echo "Merged planets (with data): $validCount\n";
    
    // Show first 3
    for ($i = 0; $i < min(3, count($mergedPlanets)); $i++) {
        $p = $mergedPlanets[$i];
        if ($p['generated_planet']) {
            echo sprintf("  Slot %d: HAS DATA (semi_major=%.2f)\n", 
                $p['position'],
                $p['generated_planet']['semi_major_axis_au'] ?? 0
            );
        } else {
            echo sprintf("  Slot %d: EMPTY\n", $p['position']);
        }
    }
}

echo "\n✓ Test abgeschlossen\n";
