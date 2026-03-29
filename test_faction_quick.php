<?php
require_once 'api/helpers.php';
require_once 'api/character_profile_generator.php';

$db = get_db();

// Simply test profile generation
$userId = 20;  // From previous test registration
$username = 'faction_test_testuser';

echo "=== Testing Profile Generation ===\n";
echo "User ID: $userId\n";
echo "Username: $username\n\n";

try {
    // Generate profile
    $profile = ensure_user_character_profile($db, $userId, false, $username);
    
    echo "Status: " . ($profile['generation_status'] ?? 'N/A') . "\n";
    echo "Race: " . ($profile['race'] ?? 'N/A') . "\n";
    echo "Profession: " . ($profile['profession'] ?? 'N/A') . "\n";
    echo "Last Error: " . ($profile['last_error'] ?? 'None') . "\n\n";
    
    // Read the JSON file to verify faction data was used
    $jsonPath = dirname('/var/www/html') . '/' . ($profile['json_path'] ?? '');
    if (is_file($jsonPath)) {
        $data = json_decode(file_get_contents($jsonPath), true);
        if (isset($data['portrait_prompt'])) {
            echo "Portrait Prompt includes faction specs:\n";
            $prompt = $data['portrait_prompt'];
            
            // Check if prompt includes faction-specific descriptors
            if (strpos($prompt, 'material') !== false) {
                echo "✓ Material description included\n";
            }
            if (strpos($prompt, 'color') !== false || strpos($prompt, 'palette') !== false) {
                echo "✓ Color hints included\n";
            }
            if (strpos($prompt, 'silhouette') !== false) {
                echo "✓ Silhouette description included\n";
            }
            
            echo "\nFirst 300 chars of prompt:\n";
            echo substr($prompt, 0, 300) . "...\n";
        }
    }
    
    echo "\n✓ Test completed successfully!\n";
} catch (Throwable $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
}
