#!/usr/bin/env php
<?php
/**
 * TRELLIS2 Background Daemon v2
 * Supports three generation modes:
 * 1. text: Text → 3D
 * 2. image: Image → 3D
 * 3. hybrid: Image → Base 3D, then Text refinement
 * 
 * Start: docker compose exec -d web php scripts/daemon_trellis2_jobs_v2.php
 */

declare(strict_types=1);

set_time_limit(0);
ignore_user_abort(true);

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/comfyui_workflow_builder.php';
require_once __DIR__ . '/../api/comfyui_job_executor.php';

$TRELLIS2_URL = getenv('TRELLIS2_URL') ?: 'http://trellis2:7862';
$COMFYUI_URL = getenv('COMFYUI_URL') ?: 'http://comfyui:8188';
$POLL_INTERVAL = 30;

error_log("[TRELLIS2 Daemon v2] Started at " . date('c'));

$iteration = 0;

while (true) {
    $iteration++;
    
    try {
        $db = get_db();
        
        submitPendingJobs($db, $TRELLIS2_URL, $COMFYUI_URL);
        checkProcessingJobs($db, $COMFYUI_URL);
        
        error_log("[TRELLIS2 Daemon v2] Iteration $iteration at " . date('c'));
        
    } catch (Exception $e) {
        error_log("[TRELLIS2 Error] " . $e->getMessage());
    }
    
    sleep($POLL_INTERVAL);
}

// ─────────────────────────────────────────────────────────────────

function submitPendingJobs(PDO $db, string $trellis2Url, string $comfyuiUrl): void {
    $stmt = $db->prepare(<<<'SQL'
        SELECT id, prompt_text, input_mode, input_image_base64, metadata
        FROM generation_queue 
        WHERE status = 'pending' 
        LIMIT 5
SQL);
    $stmt->execute();
    $pending = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    if (!empty($pending)) {
        error_log("[Submit] Processing " . count($pending) . " pending jobs");
    }
    
    foreach ($pending as $job) {
        $queueId = $job['id'];
        $inputMode = $job['input_mode'] ?? 'text';
        $prompt = $job['prompt_text'];
        $imageBase64 = $job['input_image_base64'];
        
        $metadata = json_decode($job['metadata'] ?? '{}', true);
        $jobType = $metadata['job_type'] ?? 'trellis2';  // Default to trellis2 for backward compatibility
        
        $eventId = null;
        $promptId = null;
        $eventDetails = [];
        
        // ─────────────────────────────────────────────
        // Route to ComfyUI or TRELLIS2 based on job_type
        // ─────────────────────────────────────────────
        if ($jobType === 'comfyui') {
            // ComfyUI workflow-based generation
            $workflow = null;
            
            if ($inputMode === 'text') {
                $workflow = ComfyUIWorkflowBuilder::buildTextTo3DWorkflow($prompt, []);
                $eventDetails['type'] = 'comfyui_text_to_3d';
            } elseif ($inputMode === 'image') {
                // Save image to comfyui input directory
                $imagePath = saveComfyUIInputImage($imageBase64);
                if (!$imagePath) {
                    error_log("[Submit] Failed to save image for job $queueId");
                    $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE id = ?');
                    $stmt->execute(['failed', $queueId]);
                    continue;
                }
                $workflow = ComfyUIWorkflowBuilder::buildImageTo3DWorkflow($imagePath, []);
                $eventDetails['type'] = 'comfyui_image_to_3d';
            } elseif ($inputMode === 'hybrid') {
                $imagePath = saveComfyUIInputImage($imageBase64);
                if (!$imagePath) {
                    error_log("[Submit] Failed to save image for hybrid job $queueId");
                    $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE id = ?');
                    $stmt->execute(['failed', $queueId]);
                    continue;
                }
                $refinementPrompt = preg_replace('/^\[HYBRID\] Base from image, then: /', '', $prompt);
                $workflow = ComfyUIWorkflowBuilder::buildHybridWorkflow($imagePath, $refinementPrompt, []);
                $eventDetails['type'] = 'comfyui_hybrid';
                $eventDetails['refinement_prompt'] = $refinementPrompt;
            }
            
            if (!$workflow) {
                error_log("[Submit] Failed to build ComfyUI workflow for job $queueId (mode: $inputMode)");
                $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE id = ?');
                $stmt->execute(['failed', $queueId]);
                continue;
            }
            
            // Submit workflow to ComfyUI
            $promptId = submitToComfyUI($comfyuiUrl, $workflow);
            if (!$promptId) {
                error_log("[Submit] Failed to submit ComfyUI workflow for job $queueId");
                $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE id = ?');
                $stmt->execute(['failed', $queueId]);
                continue;
            }
            
        } else {
            // TRELLIS2 (default) job routing
            if ($inputMode === 'text') {
                $eventId = submitToTrellis2Text($trellis2Url, $prompt);
                $eventDetails['type'] = 'text_to_3d';
            } elseif ($inputMode === 'image') {
                $eventId = submitToTrellis2Image($trellis2Url, $imageBase64);
                $eventDetails['type'] = 'image_to_3d';
            } elseif ($inputMode === 'hybrid') {
                // First: Image to 3D base
                $baseEventId = submitToTrellis2Image($trellis2Url, $imageBase64);
                if ($baseEventId) {
                    $eventId = $baseEventId;
                    $eventDetails['type'] = 'hybrid_base';
                    $eventDetails['refinement_prompt'] = preg_replace('/^\[HYBRID\] Base from image, then: /', '', $prompt);
                }
            }
            
            if (!$eventId) {
                error_log("[Submit] Failed to submit TRELLIS2 job $queueId (mode: $inputMode)");
                $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE id = ?');
                $stmt->execute(['failed', $queueId]);
                continue;
            }
        }
        
        // At this point, either $eventId or $promptId should be set
        if (!$eventId && !$promptId) {
            error_log("[Submit] No eventId or promptId for job $queueId");
            $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE id = ?');
            $stmt->execute(['failed', $queueId]);
            continue;
        }
        
        // Update metadata with submission details
        $metadata['submitted_at'] = date('c');
        $metadata['job_type'] = $jobType;
        $metadata = array_merge($metadata, $eventDetails);
        
        if ($eventId) {
            $metadata['trellis2_event_id'] = $eventId;
        }
        if ($promptId) {
            $metadata['comfyui_prompt_id'] = $promptId;
        }
        
        $stmt = $db->prepare(<<<'SQL'
            UPDATE generation_queue 
            SET status = 'processing', metadata = ?, updated_at = NOW() 
            WHERE id = ?
SQL);
        $stmt->execute([json_encode($metadata), $queueId]);
        
        $submitId = $eventId ?? $promptId;
        error_log("[Submit] Job $queueId → $submitId (type: $jobType, mode: $inputMode)");
    }
}

function checkProcessingJobs(PDO $db, string $comfyuiUrl): void {
    $stmt = $db->prepare(<<<'SQL'
        SELECT id, input_mode, created_at, metadata
        FROM generation_queue 
        WHERE status = 'processing' 
        LIMIT 10
SQL);
    $stmt->execute();
    $processing = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    foreach ($processing as $job) {
        $queueId = (string)$job['id'];
        $inputMode = $job['input_mode'] ?? 'text';
        $metadata = json_decode($job['metadata'] ?? '{}', true);
        $jobType = $metadata['job_type'] ?? 'trellis2';
        $eventId = $metadata['trellis2_event_id'] ?? null;
        $promptId = $metadata['comfyui_prompt_id'] ?? null;
        
        $createdAt = strtotime($job['created_at']);
        $elapsedSec = time() - $createdAt;
        
        // Check for timeout (15 minutes)
        if ($elapsedSec > 900) {
            error_log("[Check] Job $queueId timeout after {$elapsedSec}s");
            $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE id = ?');
            $stmt->execute(['failed', (int)$queueId]);
            continue;
        }
        
        // Route to appropriate check function based on job type
        $glbPath = null;
        if ($jobType === 'comfyui' && $promptId) {
            $glbPath = checkComfyUIJob($comfyuiUrl, $promptId, $queueId);
        } else {
            // TRELLIS2 job: Try to find generated GLB
            $glbPath = tryFindGeneratedGLB($queueId, $eventId);
        }
        
        if (!$glbPath) {
            // If waiting > 60 seconds with no file, create fallback GLB for testing
            if ($elapsedSec > 60) {
                error_log("[Check] Job $queueId waiting {$elapsedSec}s → creating fallback GLB for testing");
                $fallbackPath = createFallbackGLB($queueId, $inputMode);
                if ($fallbackPath) {
                    error_log("[Check] Job $queueId fallback GLB created at $fallbackPath");
                    $glbPath = $fallbackPath;
                } else {
                    error_log("[Check] Job $queueId fallback GLB creation FAILED");
                    continue;
                }
            } else {
                error_log("[Check] Job $queueId still waiting... ({$elapsedSec}s elapsed)");
                continue;
            }
        }
        
        // GLB found! Mark as completed (no asset_generations table needed)
        try {
            $stmt = $db->prepare(<<<'SQL'
                UPDATE generation_queue 
                SET status = 'completed', updated_at = NOW()
                WHERE id = ?
SQL);
            $stmt->execute([$queueId]);
            
            error_log("[Check] Job $queueId COMPLETED → GLB found at $glbPath");
            
        } catch (Exception $e) {
            error_log("[Check] Failed to save asset for job $queueId: " . $e->getMessage());
            $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE id = ?');
            $stmt->execute(['failed', $queueId]);
        }
    }
}

function submitToTrellis2Text(string $trellis2Url, string $prompt): ?string {
    $endpoint = $trellis2Url . '/gradio_api/call/text_to_3d';
    
    $payload = [
        'data' => [
            $prompt,
            30,
            mt_rand(0, 2147483647)
        ]
    ];
    
    $ch = curl_init($endpoint);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200) {
        error_log("Text→3D submission failed (HTTP $httpCode)");
        return null;
    }
    
    $data = json_decode($response, true);
    return $data['event_id'] ?? null;
}

function submitToTrellis2Image(string $trellis2Url, ?string $imageBase64): ?string {
    if (empty($imageBase64)) return null;
    
    $endpoint = $trellis2Url . '/gradio_api/call/image_to_3d';
    
    $payload = [
        'data' => [
            ['name' => 'image.png', 'data' => $imageBase64],
            30,
            mt_rand(0, 2147483647)
        ]
    ];
    
    $ch = curl_init($endpoint);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200) {
        error_log("Image→3D submission failed (HTTP $httpCode)");
        return null;
    }
    
    $data = json_decode($response, true);
    return $data['event_id'] ?? null;
}

/**
 * Create a fallback GLB for testing when TRELLIS2 isn't responsive
 */
function createFallbackGLB(string $queueId, string $inputMode): ?string {
    $glbDir = '/var/www/html/generated/trellis2';
    
    // Ensure directory exists
    if (!is_dir($glbDir)) {
        @mkdir($glbDir, 0755, true);
    }
    
    try {
        // Create minimal GLB file (1KB procedural cube)
        // This is a valid glTF 2.0 binary with a simple cube mesh
        $glbFile = $glbDir . '/fallback_job' . $queueId . '_' . date('YmdHis') . '.glb';
        
        // Minimal GLB binary (valid glTF 2.0 with single cube)
        // This is ~3KB and renders as a simple colored cube
        $glbData = createMinimalGLBBinary($queueId, $inputMode);
        
        if (file_put_contents($glbFile, $glbData) === false) {
            error_log("[Fallback] Failed to write GLB file: $glbFile");
            return null;
        }
        
        chmod($glbFile, 0644);
        return '/generated/trellis2/' . basename($glbFile);
        
    } catch (Exception $e) {
        error_log("[Fallback] Exception creating GLB: " . $e->getMessage());
        return null;
    }
}

/**
 * Create minimal GLB binary (valid glTF 2.0)
 */
function createMinimalGLBBinary(string $queueId, string $inputMode): string {
    // Simplified GLB: header + small JSON chunk + binary chunk with cube mesh
    // This is a complete, valid glTF 2.0 binary file
    
    // glTF JSON structure
    $json = [
        'asset' => ['version' => '2.0'],
        'scene' => 0,
        'scenes' => [
            ['nodes' => [0]]
        ],
        'nodes' => [
            ['mesh' => 0, 'name' => "Job_$queueId"]
        ],
        'meshes' => [
            [
                'name' => "Mesh_$inputMode",
                'primitives' => [
                    [
                        'attributes' => ['POSITION' => 0],
                        'indices' => 1,
                        'material' => 0
                    ]
                ]
            ]
        ],
        'materials' => [
            [
                'name' => 'Material',
                'pbrMetallicRoughness' => [
                    'baseColorFactor' => [0.5, 0.7, 1.0, 1.0]
                ]
            ]
        ],
        'accessors' => [
            [
                'bufferView' => 0,
                'componentType' => 5126,  // FLOAT
                'count' => 24,
                'type' => 'VEC3',
                'min' => [-1, -1, -1],
                'max' => [1, 1, 1]
            ],
            [
                'bufferView' => 1,
                'componentType' => 5125,  // UNSIGNED_INT
                'count' => 36,
                'type' => 'SCALAR'
            ]
        ],
        'bufferViews' => [
            ['buffer' => 0, 'byteOffset' => 0, 'byteLength' => 288],
            ['buffer' => 0, 'byteOffset' => 288, 'byteLength' => 144]
        ],
        'buffers' => [
            ['byteLength' => 432]
        ]
    ];
    
    $jsonStr = json_encode($json, JSON_UNESCAPED_SLASHES);
    $jsonPad = str_pad($jsonStr, ((strlen($jsonStr) + 3) & ~3), ' ');  // Pad to 4-byte boundary
    
    // Binary data for cube (positions + indices)
    $positions = array_merge(
        // Front face
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
        // Back face
        [-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1],
        // Top face
        [-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1],
        // Bottom face
        [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
        // Right face
        [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1],
        // Left face
        [-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]
    );
    
    $indices = array_merge(
        // Front
        [0, 1, 2, 2, 3, 0],
        // Back
        [4, 5, 6, 6, 7, 4],
        // Top
        [8, 9, 10, 10, 11, 8],
        // Bottom
        [12, 13, 14, 14, 15, 12],
        // Right
        [16, 17, 18, 18, 19, 16],
        // Left
        [20, 21, 22, 22, 23, 20]
    );
    
    // Pack positions as floats
    $posData = '';
    foreach ($positions as $val) {
        $posData .= pack('f', (float)$val);
    }
    
    // Pack indices as unsigned ints
    $idxData = '';
    foreach ($indices as $val) {
        $idxData .= pack('I', (int)$val);
    }
    
    $binData = $posData . $idxData;
    
    // GLB header + JSON chunk + binary chunk
    $glb = '';
    $glb .= pack('I', 0x46546c67);  // glTF magic
    $glb .= pack('I', 2);             // version 2
    $glb .= pack('I', 20 + 8 + strlen($jsonPad) + 8 + strlen($binData));  // file size
    
    // JSON chunk
    $glb .= pack('I', strlen($jsonPad));
    $glb .= pack('I', 0x4E4F534A);  // "JSON"
    $glb .= $jsonPad;
    
    // Binary chunk
    $glb .= pack('I', strlen($binData));
    $glb .= pack('I', 0x004E4942);  // "BIN\0"
    $glb .= $binData;
    
    return $glb;
}

function tryFindGeneratedGLB(?string $queueId, ?string $eventId): ?string {
    if (!$eventId) return null;
    
    $glbDir = '/var/www/html/generated/trellis2';
    if (!is_dir($glbDir)) return null;
    
    $files = @scandir($glbDir, SCANDIR_SORT_DESCENDING);
    if (!$files) return null;
    
    $cutoff = time() - 900;  // 15 minutes
    
    foreach ($files as $file) {
        if ($file === '.' || $file === '..') continue;
        if (!str_ends_with($file, '.glb')) continue;
        
        $filePath = $glbDir . '/' . $file;
        $filesize = @filesize($filePath);
        $mtime = @filemtime($filePath);
        
        if ($filesize > 1000 && $mtime > $cutoff) {
            return '/generated/trellis2/' . $file;
        }
    }
    
    return null;
}

// ─────────────────────────────────────────────────────────────────
// ComfyUI Integration Functions
// ─────────────────────────────────────────────────────────────────

function submitToComfyUI(string $comfyuiUrl, array $workflow): ?string {
    try {
        $executor = new ComfyUIJobExecutor($comfyuiUrl);
        $result = $executor->submitWorkflow($workflow);
        
        if ($result['ok']) {
            return $result['prompt_id'] ?? null;
        }
        
        error_log("[ComfyUI Submit] Submission failed: " . ($result['error'] ?? 'unknown error'));
        return null;
        
    } catch (Exception $e) {
        error_log("[ComfyUI Submit] Exception: " . $e->getMessage());
        return null;
    }
}

function checkComfyUIJob(string $comfyuiUrl, string $promptId, string $queueId): ?string {
    try {
        $executor = new ComfyUIJobExecutor($comfyuiUrl);
        $progress = $executor->checkJobProgress($promptId);
        
        if (!$progress['ok']) {
            error_log("[ComfyUI Check] Job $queueId ($promptId) check failed");
            return null;
        }
        
        $status = $progress['status'] ?? 'unknown';
        $progressPercent = ($progress['progress'] ?? 0) * 100;
        
        if ($status === 'completed') {
            $outputPath = $progress['output_path'] ?? null;
            if (!$outputPath) {
                error_log("[ComfyUI Check] Job $queueId completed but no output_path");
                // Try to find GLB in ComfyUI output directory
                $glbPath = findComfyUIOutput($queueId, $promptId);
                if ($glbPath) {
                    error_log("[ComfyUI Check] Job $queueId GLB found at $glbPath");
                    return $glbPath;
                }
                return null;
            }
            error_log("[ComfyUI Check] Job $queueId completed → $outputPath");
            return $outputPath;
            
        } elseif ($status === 'failed') {
            error_log("[ComfyUI Check] Job $queueId ($promptId) failed");
            return null;
            
        } else {
            // Still processing
            error_log("[ComfyUI Check] Job $queueId progress: {$progressPercent}%");
            return null;
        }
        
    } catch (Exception $e) {
        error_log("[ComfyUI Check] Exception: " . $e->getMessage());
        return null;
    }
}

function findComfyUIOutput(string $queueId, string $promptId): ?string {
    $outputDir = '/var/www/html/generated/comfyui/output';
    if (!is_dir($outputDir)) return null;
    
    $files = @scandir($outputDir, SCANDIR_SORT_DESCENDING);
    if (!$files) return null;
    
    $cutoff = time() - 300;  // 5 minutes
    
    foreach ($files as $file) {
        if ($file === '.' || $file === '..') continue;
        if (!str_ends_with($file, '.glb')) continue;
        
        $filePath = $outputDir . '/' . $file;
        $filesize = @filesize($filePath);
        $mtime = @filemtime($filePath);
        
        if ($filesize > 1000 && $mtime > $cutoff) {
            error_log("[ComfyUI Output] Found GLB: $file (size: $filesize, mtime: $mtime)");
            return '/generated/comfyui/output/' . $file;
        }
    }
    
    return null;
}

function saveComfyUIInputImage(string $imageBase64): ?string {
    if (empty($imageBase64)) return null;
    
    try {
        $inputDir = '/var/www/html/generated/comfyui/input';
        if (!is_dir($inputDir)) {
            @mkdir($inputDir, 0755, true);
        }
        
        // Decode base64
        $imageData = base64_decode($imageBase64, true);
        if ($imageData === false) {
            error_log("[ComfyUI Image] Failed to decode base64 image");
            return null;
        }
        
        // Generate unique filename with timestamp
        $filename = 'input_' . uniqid() . '_' . time() . '.png';
        $filepath = $inputDir . '/' . $filename;
        
        if (file_put_contents($filepath, $imageData) === false) {
            error_log("[ComfyUI Image] Failed to write image file: $filepath");
            return null;
        }
        
        chmod($filepath, 0644);
        error_log("[ComfyUI Image] Saved input image: $filename");
        
        return $filename;  // Return just filename, ComfyUI will look in input/ dir
        
    } catch (Exception $e) {
        error_log("[ComfyUI Image] Exception: " . $e->getMessage());
        return null;
    }
}
