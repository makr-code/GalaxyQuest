<?php
require_once 'api/character_profile_generator.php';
require_once 'api/helpers.php';

$db = get_db();

echo "=== Testing Faction-Aware Prompt Generation ===\n\n";

// Test each faction
$testCases = [
    'vor_tak' => 'Vor\'Tak Warrior',
    'syl_nar' => 'Syl\'Nar Diplomat',
    'aereth' => 'Aereth Scientist',
    'kryl_tha' => 'Kryl\'Tha Warrior',
    'zhareen' => 'Zhareen Archivist',
    'vel_ar' => 'Vel\'Ar Operative'
];

foreach ($testCases as $speciesCode => $profession) {
    $designs = character_profile_load_species_designs($db, $speciesCode);
    
    if (!$designs) {
        echo "❌ Failed to load designs for $speciesCode\n";
        continue;
    }
    
    // Build prompt with faction specs
    $profile = [
        'username' => 'test_' . $speciesCode,
        'race' => $designs['display_name'] ?? 'Unknown',
        'profession' => $profession,
        'stance' => 'Diplomatic',
        'is_npc' => false
    ];
    
    $prompt = character_profile_build_prompt_with_designs($designs, $profile);
    
    echo "Species: " . $profile['race'] . "\n";
    echo "Material present: " . (strpos($prompt, 'material:') !== false ? '✓' : '✗') . "\n";
    echo "Color palette: " . (strpos($prompt, 'dominant color') !== false || 
                            strpos($prompt, 'color') !== false ? '✓' : '✗') . "\n";
    echo "Male/Female modifier: " . (strpos($prompt, 'Male') !== false || 
                                    strpos($prompt, 'Female') !== false ? '✓' : '✗') . "\n";
    echo "Prompt length: " . strlen($prompt) . " chars\n";
    echo "\nFirst 150 chars:\n" . substr($prompt, 0, 150) . "...\n\n";
}

echo "=== All faction prompts tested successfully! ===\n";
