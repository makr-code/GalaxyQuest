<?php
/**
 * Quick test: Verify white dwarf generation
 */
require_once 'api/galaxy_gen.php';

// Test 20 star systems to see if WDs appear
$wd_count = 0;
$ms_count = 0;

echo "Testing star system generation (20 systems):\n";
echo "────────────────────────────────────────────\n";

for ($i = 1; $i <= 20; $i++) {
    $sys = generate_star_system(1, $i);
    $is_wd = ($sys['stellar_type'] === 'white_dwarf');
    
    if ($is_wd) $wd_count++;
    else $ms_count++;
    
    printf(
        "System 1-%02d: %-15s [%s] L=%.6f T=%dK Age=%.1f Gy %-4s\n",
        $i,
        $sys['stellar_type'],
        $sys['spectral_class'],
        $sys['luminosity_solar'],
        $sys['temperature_k'],
        $sys['age_gyr'],
        $is_wd ? "✓WD" : "MS"
    );
}

echo "────────────────────────────────────────────\n";
printf("Summary: %d WDs (expected ~6%s), %d Main-Sequence (94%%)\n", 
       $wd_count, (6*20/100)===int($wd_count%5) ? "✓" : "~", $ms_count);
?>
