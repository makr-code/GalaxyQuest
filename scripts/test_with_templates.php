#!/usr/bin/env php
<?php
/**
 * Test Suite 3: Fresh Jobs with Real Template Images
 * Uses images from 3dmodell-vorlagen/ for realistic Image→3D testing
 */

require_once __DIR__ . '/../api/helpers.php';

$db = get_db();
$templateDir = __DIR__ . '/../3dmodell-vorlagen';

echo "\n╔════════════════════════════════════════════════════════════╗\n";
echo "║  TEST SUITE 3: Real Template Images                        ║\n";
echo "╚════════════════════════════════════════════════════════════╝\n\n";

// Get available template images
$images = array_values(array_filter(
    scandir($templateDir),
    fn($f) => preg_match('/\.(jpg|jpeg|png|webp)$/i', $f)
));

if (empty($images)) {
    echo "❌ No template images found in $templateDir\n";
    exit(1);
}

echo "Found " . count($images) . " template images\n";
echo "Sample images:\n";
foreach (array_slice($images, 0, 5) as $img) {
    echo "  - $img\n";
}
echo "\n";

// Clean up old test jobs
echo "Cleaning up old test jobs...";
$db->exec("DELETE FROM generation_queue WHERE id >= 20");
echo " ✅\n\n";

// CREATE 3 fresh jobs with real images
$jobs = [];
$selectedImages = array_slice($images, 0, 3);

echo "Creating Test Jobs with Real Template Images:\n";
echo "─────────────────────────────────────────────────────\n";

// Job 1: Text→3D (baseline)
$stmt = $db->prepare(<<<'SQL'
    INSERT INTO generation_queue
    (user_id, prompt_text, input_mode, priority, status)
    VALUES (1, 'A sleek sci-fi military destroyer with angular hull design', 'text', 1, 'pending')
SQL);
$stmt->execute();
$jobs['text'] = $db->lastInsertId();
echo "✓ Text→3D job created: ID={$jobs['text']}\n";

// Job 2: Image→3D using real template
$imagePath = $templateDir . '/' . $selectedImages[0];
$imageData = file_get_contents($imagePath);
$imageBase64 = base64_encode($imageData);
$imageSize = round(filesize($imagePath) / 1024, 1);

$stmt = $db->prepare(<<<'SQL'
    INSERT INTO generation_queue
    (user_id, prompt_text, input_mode, input_image_base64, priority, status)
    VALUES (1, 'Generate 3D model from reference image', 'image', ?, 2, 'pending')
SQL);
$stmt->execute([$imageBase64]);
$jobs['image'] = $db->lastInsertId();
echo "✓ Image→3D job created: ID={$jobs['image']}\n";
echo "  └─ Template: {$selectedImages[0]} ({$imageSize}KB)\n";

// Job 3: Hybrid using real template + refinement
$imagePath2 = $templateDir . '/' . $selectedImages[1];
$imageData2 = file_get_contents($imagePath2);
$imageBase642 = base64_encode($imageData2);
$imageSize2 = round(filesize($imagePath2) / 1024, 1);

$stmt = $db->prepare(<<<'SQL'
    INSERT INTO generation_queue
    (user_id, prompt_text, input_mode, input_image_base64, priority, status)
    VALUES (1, '[HYBRID] Base from image, then: Add glowing energy core at center, make more aerodynamic', 'hybrid', ?, 3, 'pending')
SQL);
$stmt->execute([$imageBase642]);
$jobs['hybrid'] = $db->lastInsertId();
echo "✓ Hybrid job created: ID={$jobs['hybrid']}\n";
echo "  └─ Template: {$selectedImages[1]} ({$imageSize2}KB)\n\n";

// Show created jobs
echo "Created Job Summary:\n";
echo "─────────────────────────────────────────────────────\n";
$stmt = $db->query(<<<'SQL'
    SELECT id, input_mode, status, created_at 
    FROM generation_queue 
    WHERE id IN (20, 21, 22)
    ORDER BY id
SQL);

foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $row) {
    printf("  ID %2d: %-6s | %-10s | %s\n", 
        $row['id'], 
        strtoupper($row['input_mode']),
        '✓ ' . $row['status'],
        $row['created_at']
    );
}

echo "\n✅ Test Suite 3 Complete - Ready for daemon processing\n";
echo "   (Daemon will pick these up in next 30-second cycle)\n";
