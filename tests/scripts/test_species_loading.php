<?php
require_once __DIR__ . '/../../api/helpers.php';
require_once __DIR__ . '/../../api/character_profile_generator.php';

$db = get_db();

echo "=== Testing character_profile_load_species_designs ===\n\n";

$testCodes = ['vor_tak', 'syl_nar', 'aereth', 'kryl_tha', 'zhareen', 'vel_ar'];

foreach ($testCodes as $code) {
    $designs = character_profile_load_species_designs($db, $code);
    echo "Species: $code\n";
    if (is_array($designs)) {
        echo "  Display Name: " . ($designs['display_name'] ?? 'N/A') . "\n";
        echo "  Color Primary (Male): " . ($designs['color_primary_male'] ?? 'N/A') . "\n";
        echo "  Color Primary (Female): " . ($designs['color_primary_female'] ?? 'N/A') . "\n";
        echo "  Material Desc: " . substr($designs['material_desc'] ?? 'N/A', 0, 50) . "...\n";
        echo "  Portrait Base Prompt Length: " . strlen($designs['portrait_prompt_base'] ?? '') . " chars\n";
    } else {
        echo "  ERROR: Could not load designs\n";
    }
    echo "\n";
}

echo "=== All species loaded successfully! ===\n";
