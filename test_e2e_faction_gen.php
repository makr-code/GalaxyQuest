<?php
require_once 'api/helpers.php';
require_once 'api/character_profile_generator.php';

$db = get_db();

// Register a new test user
$suffix = (int)(microtime(true) * 1000);
$testUser = "faction_test_" . $suffix;
$testEmail = "faction_test_$suffix@example.com";
$testPass = "Test!1234";

echo "=== Creating test user: $testUser ===\n";

// Create user directly in DB
$hashPwd = password_hash($testPass, PASSWORD_BCRYPT);
$stmt = $db->prepare(
    "INSERT INTO users (username, email, password_hash, created_at)
     VALUES (?, ?, ?, NOW())"
);
$stmt->execute([$testUser, $testEmail, $hashPwd]);
$userId = (int)$db->lastInsertId();
echo "User ID: $userId\n\n";

// Generate profile
echo "=== Generating character profile ===\n";
try {
    $profile = ensure_user_character_profile($db, $userId, false, $testUser);
    
    echo "Generation Status: " . ($profile['generation_status'] ?? 'N/A') . "\n";
    echo "Is NPC: " . ($profile['is_npc'] ?? 0) . "\n";
    echo "Race: " . ($profile['race'] ?? 'N/A') . "\n";
    echo "Profession: " . ($profile['profession'] ?? 'N/A') . "\n";
    echo "Stance: " . ($profile['stance'] ?? 'N/A') . "\n";
    echo "YAML Path: " . ($profile['yaml_path'] ?? 'N/A') . "\n";
    echo "JSON Path: " . ($profile['json_path'] ?? 'N/A') . "\n";
    echo "\n";
    
    // Check if files exist
    $jsonAbs = dirname('/var/www/html') . '/' . $profile['json_path'];
    $yamlAbs = dirname('/var/www/html') . '/' . $profile['yaml_path'];
    
    echo "JSON file exists: " . (is_file($jsonAbs) ? 'YES' : 'NO') . "\n";
    echo "YAML file exists: " . (is_file($yamlAbs) ? 'YES' : 'NO') . "\n";
    echo "\n";
    
    // If JSON exists, show portrait prompt
    if (is_file($jsonAbs)) {
        $jsonContent = json_decode(file_get_contents($jsonAbs), true);
        if (isset($jsonContent['portrait_prompt'])) {
            echo "=== Portrait Prompt (first 200 chars) ===\n";
            echo substr($jsonContent['portrait_prompt'], 0, 200) . "...\n\n";
        }
    }
    
    echo "✓ Character profile generated successfully!\n";
} catch (Throwable $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
}
