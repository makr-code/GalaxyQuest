<?php
/**
 * Poll TRELLIS2 for job completion and save results
 * This checks the TRELLIS2 output directory for completed GLB files
 */

require_once __DIR__ . '/../api/helpers.php';

$db = get_db();
$TRELLIS2_OUTPUT_DIR = '/home/gradio/.gradio/file=output';  // Inside container
$LOCAL_GENERATED_DIR = __DIR__ . '/../generated/trellis2';

echo "\n🔄 [TRELLIS2 Status Checker] Starting...\n\n";

// Ensure local directory exists
@mkdir($LOCAL_GENERATED_DIR, 0755, true);

// Get all processing jobs
$stmt = $db->prepare('
    SELECT queue_id, design_id, user_id, metadata, updated_at
    FROM generation_queue
    WHERE status = "processing"
    ORDER BY updated_at ASC
');
$stmt->execute();
$processing = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo "🔍 Found " . count($processing) . " processing jobs\n\n";

$completed_count = 0;
$failed_count = 0;

foreach ($processing as $job) {
    $queueId = $job['queue_id'];
    $metadata = json_decode($job['metadata'] ?? '{}', true);
    $eventId = $metadata['trellis2_event_id'] ?? null;
    $submittedAt = strtotime($metadata['submitted_at'] ?? $job['updated_at']);
    $elapsedSec = time() - $submittedAt;
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    echo "🔄 Checking: $queueId\n";
    echo "   Event ID: " . ($eventId ? $eventId : '(none)') . "\n";
    echo "   Elapsed: ${elapsedSec}s\n";
    
    // Try to detect completion
    $glbPath = tryFindGeneratedGLB($queueId, $eventId, $LOCAL_GENERATED_DIR);
    
    if ($glbPath) {
        echo "   ✅ GLB file found! ($glbPath)\n";
        
        // Save asset record and mark as completed
        $generationId = bin2hex(random_bytes(8));
        
        try {
            $stmt = $db->prepare(<<<'SQL'
                INSERT INTO asset_generations 
                (generation_id, user_id, design_id, queue_id, model_path, status, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            SQL);
            $stmt->execute([
                $generationId,
                $job['user_id'],
                $job['design_id'],
                $queueId,
                $glbPath,
                'completed',
                json_encode([
                    'source' => 'trellis2',
                    'trellis2_event_id' => $eventId,
                    'processing_time_seconds' => $elapsedSec,
                    'file_size_bytes' => filesize(realpath(__DIR__ . '/..' . $glbPath))
                ])
            ]);
            
            // Update queue
            $stmt = $db->prepare('UPDATE generation_queue SET status = ?, generation_id = ?, updated_at = NOW() WHERE queue_id = ?');
            $stmt->execute(['completed', $generationId, $queueId]);
            
            echo "   ✅ Asset saved! Generation ID: $generationId\n";
            $completed_count++;
        } catch (Exception $e) {
            echo "   ❌ Failed to save asset: " . $e->getMessage() . "\n";
            $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE queue_id = ?');
            $stmt->execute(['failed', $queueId]);
            $failed_count++;
        }
    } elseif ($elapsedSec > 300) {  // 5 minute timeout
        echo "   ⏰ Timeout (${elapsedSec}s > 300s)\n";
        $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE queue_id = ?');
        $stmt->execute(['failed', $queueId]);
        $failed_count++;
    } else {
        echo "   ⏳ Still waiting...\n";
    }
}

echo "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
echo "✅ Status check complete!\n";
echo "   Completed: $completed_count\n";
echo "   Failed: $failed_count\n\n";

// ─────────────────────────────────────────────────────────────────
// Helper: Look for generated GLB file
// ─────────────────────────────────────────────────────────────────

function tryFindGeneratedGLB(string $queueId, ?string $eventId, string $generatedDir): ?string {
    // Strategy 1: Look for recently modified GLB files
    $glbFiles = glob($generatedDir . '/*.glb');
    
    if (!empty($glbFiles)) {
        // Sort by modification time (newest first)
        usort($glbFiles, fn($a, $b) => filemtime($b) - filemtime($a));
        
        // Check if the most recent file is large enough (> 1KB means not procedural fallback)
        foreach ($glbFiles as $file) {
            $size = filesize($file);
            $mtime = filemtime($file);
            $ageSec = time() - $mtime;
            
            // If file is newer than job submission and > 1KB, likely our result
            if ($ageSec < 600 && $size > 1024) {
                // Rename to include queue_id for tracking
                $basename = basename($file);
                if (strpos($basename, $queueId) === false) {
                    $newName = substr($queueId, 0, 8) . '_' . $basename;
                    $newPath = $generatedDir . '/' . $newName;
                    
                    if (rename($file, $newPath)) {
                        return '/generated/trellis2/' . $newName;
                    }
                }
                return '/generated/trellis2/' . $basename;
            }
        }
    }
    
    return null;
}
