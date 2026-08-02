<?php
declare(strict_types=1);

/**
 * TRELLIS2 Async Generation Worker
 * Polls generation_queue and processes TRELLIS2 jobs
 * 
 * Usage: php scripts/trellis2_worker.php [--poll-interval=10] [--max-retries=3]
 * 
 * Production: Run as Docker service or cron job (every 10 seconds)
 */

// Error handling
set_error_handler(function ($errno, $errstr, $errfile, $errline) {
    error_log("[ERROR] [$errno] $errstr in $errfile:$errline");
    return false;
});

set_exception_handler(function (Throwable $e) {
    error_log("[FATAL] " . $e->getMessage() . " at " . $e->getFile() . ":" . $e->getLine());
    exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

define('WORKER_ID', gethostname() . '_' . getmypid() . '_' . uniqid());
define('TRELLIS2_API_URL', getenv('TRELLIS2_API_URL') ?: 'http://trellis2:7862/api/predict');
define('TRELLIS2_TIMEOUT_SECONDS', (int)(getenv('TRELLIS2_TIMEOUT_SECONDS') ?: 300));
define('MODELS_BASE_PATH', getenv('MODELS_BASE_PATH') ?: __DIR__ . '/../generated/trellis2/models');
define('POLL_INTERVAL_SECONDS', (int)(getenv('POLL_INTERVAL_SECONDS') ?: 10));
define('MAX_RETRIES', (int)(getenv('MAX_RETRIES') ?: 3));
define('BATCH_SIZE', (int)(getenv('BATCH_SIZE') ?: 1)); // Process N jobs per loop

// Database config from environment
$db_config = [
    'host' => getenv('DB_HOST') ?: 'db',
    'port' => (int)(getenv('DB_PORT') ?: 3306),
    'name' => getenv('DB_NAME') ?: 'galaxyquest',
    'user' => getenv('DB_USER') ?: 'root',
    'pass' => getenv('DB_PASS') ?: 'root',
];

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

error_log("[INIT] TRELLIS2 Worker starting (ID: " . WORKER_ID . ")");
error_log("[INIT] Config: API={TRELLIS2_API_URL}, Poll={POLL_INTERVAL_SECONDS}s, Max Retries={MAX_RETRIES}");

// Connect to database
try {
    $pdo = new PDO(
        sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $db_config['host'],
            $db_config['port'],
            $db_config['name']
        ),
        $db_config['user'],
        $db_config['pass'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 30,
        ]
    );
    error_log("[OK] Database connected");
} catch (PDOException $e) {
    error_log("[FATAL] Database connection failed: " . $e->getMessage());
    exit(1);
}

// Verify TRELLIS2 API is reachable
try {
    $ch = curl_init(TRELLIS2_API_URL);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_NOBODY, true);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($http_code >= 400 && $http_code !== 405) { // 405 is OK (HEAD not allowed)
        error_log("[WARN] TRELLIS2 API returned HTTP {$http_code}, but worker will continue");
    } else {
        error_log("[OK] TRELLIS2 API is reachable");
    }
} catch (Exception $e) {
    error_log("[WARN] Could not verify TRELLIS2 API: " . $e->getMessage());
}

// Ensure models directory exists
if (!is_dir(MODELS_BASE_PATH)) {
    mkdir(MODELS_BASE_PATH, 0755, true);
    error_log("[OK] Created models directory: " . MODELS_BASE_PATH);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN WORKER LOOP
// ─────────────────────────────────────────────────────────────────────────────

$stats = [
    'processed' => 0,
    'completed' => 0,
    'failed' => 0,
    'retried' => 0,
    'start_time' => time(),
];

error_log("[START] Worker loop starting (batch size: {BATCH_SIZE}, interval: {POLL_INTERVAL_SECONDS}s)");

while (true) {
    try {
        // Get next batch of queued jobs
        $stmt = $pdo->prepare('
            SELECT gq.id, gq.prompt_text, gq.user_id, gq.vessel_design_id, gq.retry_count, gq.max_retries
            FROM generation_queue gq
            WHERE gq.status = "queued"
            ORDER BY gq.priority DESC, gq.created_at ASC
            LIMIT :batch_size
        ');
        $stmt->bindValue(':batch_size', BATCH_SIZE, PDO::PARAM_INT);
        $stmt->execute();
        $queue_jobs = $stmt->fetchAll();
        
        if (empty($queue_jobs)) {
            // No jobs, sleep and continue
            usleep(POLL_INTERVAL_SECONDS * 1000000); // Convert to microseconds
            continue;
        }
        
        error_log("[BATCH] Found " . count($queue_jobs) . " job(s) to process");
        
        foreach ($queue_jobs as $job) {
            processJob($pdo, $job, $stats);
        }
        
    } catch (Exception $e) {
        error_log("[ERROR] Worker loop error: " . $e->getMessage());
        sleep(POLL_INTERVAL_SECONDS);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a single generation job
 */
function processJob(PDO $pdo, array $job, array &$stats): void {
    $queue_id = $job['id'];
    $prompt_text = $job['prompt_text'];
    $user_id = $job['user_id'];
    $vessel_design_id = $job['vessel_design_id'];
    $retry_count = (int)$job['retry_count'];
    $max_retries = (int)$job['max_retries'];
    
    $start_time = microtime(true);
    
    error_log("[JOB #{$queue_id}] Starting | User: {$user_id} | Retry: {$retry_count}/{$max_retries}");
    
    try {
        // Update status to 'processing'
        $stmt = $pdo->prepare('
            UPDATE generation_queue 
            SET status = "processing", worker_id = :worker_id, started_at = NOW()
            WHERE id = :id
        ');
        $stmt->execute([
            ':worker_id' => WORKER_ID,
            ':id' => $queue_id,
        ]);
        
        // Generate UUID for output directory
        $generation_uuid = generateUUID();
        $model_dir = MODELS_BASE_PATH . '/' . $generation_uuid;
        
        if (!mkdir($model_dir, 0755, true) && !is_dir($model_dir)) {
            throw new RuntimeException("Failed to create model directory: {$model_dir}");
        }
        
        error_log("[JOB #{$queue_id}] Calling TRELLIS2 API...");
        
        // Call TRELLIS2 API
        $glb_content = callTRELLIS2API($prompt_text);
        
        if (empty($glb_content)) {
            throw new RuntimeException("TRELLIS2 API returned empty response");
        }
        
        // Save GLB file
        $glb_path = "{$model_dir}/model.glb";
        $bytes_written = file_put_contents($glb_path, $glb_content);
        
        if ($bytes_written === false || $bytes_written === 0) {
            throw new RuntimeException("Failed to write GLB file to {$glb_path}");
        }
        
        $glb_file_size = filesize($glb_path);
        error_log("[JOB #{$queue_id}] GLB saved | Size: " . formatBytes($glb_file_size));
        
        // Generate thumbnail (simple: extract first frame or create placeholder)
        $thumbnail_path = "{$model_dir}/model.thumbnail.png";
        generateThumbnail($glb_path, $thumbnail_path);
        
        // Extract metadata from GLB
        $metadata = extractGLBMetadata($glb_path);
        
        // Calculate generation time
        $generation_time_ms = (int)((microtime(true) - $start_time) * 1000);
        
        // Register generation in database
        $stmt = $pdo->prepare('
            INSERT INTO asset_generations (
                generation_uuid, status, vessel_design_id, user_id, 
                prompt_text, prompt_hash, glb_path, glb_file_size, thumbnail_path,
                metadata_json, trellis2_model_variant, generation_time_ms,
                created_at, completed_at
            ) VALUES (
                :uuid, "complete", :design_id, :user_id,
                :prompt, :prompt_hash, :glb_path, :glb_size, :thumbnail_path,
                :metadata, "text-large", :gen_time,
                NOW(), NOW()
            )
        ');
        
        $stmt->execute([
            ':uuid' => $generation_uuid,
            ':design_id' => $vessel_design_id,
            ':user_id' => $user_id,
            ':prompt' => $prompt_text,
            ':prompt_hash' => hash('sha256', $prompt_text),
            ':glb_path' => str_replace('\\', '/', $glb_path),
            ':glb_size' => $glb_file_size,
            ':thumbnail_path' => str_replace('\\', '/', $thumbnail_path),
            ':metadata' => json_encode($metadata),
            ':gen_time' => $generation_time_ms,
        ]);
        
        $generation_id = (int)$pdo->lastInsertId();
        
        // Update queue to reference generation
        $stmt = $pdo->prepare('
            UPDATE generation_queue 
            SET status = "complete", generation_id = :gen_id, completed_at = NOW()
            WHERE id = :id
        ');
        $stmt->execute([
            ':gen_id' => $generation_id,
            ':id' => $queue_id,
        ]);
        
        // Update vessel_designs to link to latest generation
        if ($vessel_design_id) {
            $stmt = $pdo->prepare('
                UPDATE vessel_designs 
                SET latest_generation_id = :gen_id
                WHERE id = :design_id
            ');
            $stmt->execute([
                ':gen_id' => $generation_id,
                ':design_id' => $vessel_design_id,
            ]);
        }
        
        // Log audit event
        $stmt = $pdo->prepare('
            INSERT INTO generation_audit_log (event_type, generation_id, queue_id, user_id, event_message, event_data_json, created_at)
            VALUES ("completed", :gen_id, :queue_id, :user_id, :msg, :data, NOW())
        ');
        $stmt->execute([
            ':gen_id' => $generation_id,
            ':queue_id' => $queue_id,
            ':user_id' => $user_id,
            ':msg' => "Generation completed in {$generation_time_ms}ms by " . WORKER_ID,
            ':data' => json_encode([
                'glb_size_bytes' => $glb_file_size,
                'worker_id' => WORKER_ID,
                'metadata' => $metadata,
            ]),
        ]);
        
        error_log("[JOB #{$queue_id}] ✅ COMPLETED | Gen: {$generation_id} | Time: {$generation_time_ms}ms");
        
        $stats['completed']++;
        $stats['processed']++;
        
    } catch (Exception $e) {
        error_log("[JOB #{$queue_id}] ❌ FAILED | Error: " . $e->getMessage());
        
        // Handle retry logic
        if ($retry_count < $max_retries) {
            // Requeue for retry
            $stmt = $pdo->prepare('
                UPDATE generation_queue 
                SET status = "queued", retry_count = retry_count + 1, worker_id = NULL, started_at = NULL
                WHERE id = :id
            ');
            $stmt->execute([':id' => $queue_id]);
            
            error_log("[JOB #{$queue_id}] Requeued for retry ({$retry_count}/{$max_retries})");
            $stats['retried']++;
            
        } else {
            // Mark as failed (exhausted retries)
            $stmt = $pdo->prepare('
                UPDATE generation_queue 
                SET status = "failed", error_message = :error
                WHERE id = :id
            ');
            $stmt->execute([
                ':error' => substr($e->getMessage(), 0, 500),
                ':id' => $queue_id,
            ]);
            
            error_log("[JOB #{$queue_id}] ❌ FAILED PERMANENTLY (retries exhausted)");
            $stats['failed']++;
        }
        
        $stats['processed']++;
    }
}

/**
 * Call TRELLIS2 API and return GLB content
 */
function callTRELLIS2API(string $prompt): string {
    $ch = curl_init(TRELLIS2_API_URL);
    
    $payload = json_encode([
        'prompt' => $prompt,
        'guidance_scale' => 7.5,
        'num_steps' => 50,
        'seed' => random_int(0, 2147483647),
    ]);
    
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => TRELLIS2_TIMEOUT_SECONDS,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Content-Length: ' . strlen($payload),
        ],
    ]);
    
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        throw new RuntimeException("TRELLIS2 API curl error: {$error}");
    }
    
    if ($http_code !== 200) {
        throw new RuntimeException("TRELLIS2 API returned HTTP {$http_code}");
    }
    
    if (empty($response)) {
        throw new RuntimeException("TRELLIS2 API returned empty response");
    }
    
    // Response might be JSON with 'model' key or raw binary
    if (strlen($response) < 1000) {
        $json = json_decode($response, true);
        if (isset($json['error'])) {
            throw new RuntimeException("TRELLIS2 API error: " . $json['error']);
        }
        if (isset($json['model'])) {
            // Base64-encoded GLB
            $glb = base64_decode($json['model']);
            if ($glb === false) {
                throw new RuntimeException("Failed to decode base64 GLB from API");
            }
            return $glb;
        }
    }
    
    // Assume it's raw GLB binary
    return $response;
}

/**
 * Generate a thumbnail from GLB (placeholder implementation)
 */
function generateThumbnail(string $glb_path, string $thumbnail_path): void {
    // Placeholder: Create a simple black PNG placeholder
    // In production, use Blender or similar to render the GLB
    
    $png = base64_decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    );
    
    file_put_contents($thumbnail_path, $png);
}

/**
 * Extract metadata from GLB file
 */
function extractGLBMetadata(string $glb_path): array {
    $filesize = filesize($glb_path);
    
    // Read GLB header (first 20 bytes)
    $handle = fopen($glb_path, 'rb');
    $header = fread($handle, 20);
    fclose($handle);
    
    if (strlen($header) < 20) {
        return [
            'width_cm' => 0,
            'height_cm' => 0,
            'triangle_count' => 0,
            'material_count' => 0,
            'file_size_bytes' => $filesize,
            'note' => 'Invalid GLB header',
        ];
    }
    
    // Simple GLB structure: magic (4) + version (4) + length (4) + chunk type (4) + chunk length (4)
    $magic = unpack('N', substr($header, 0, 4))[1];
    $version = unpack('N', substr($header, 4, 4))[1];
    $length = unpack('N', substr($header, 8, 4))[1];
    
    return [
        'width_cm' => 0,  // Would need full GLB parsing
        'height_cm' => 0,
        'triangle_count' => 0,
        'material_count' => 0,
        'file_size_bytes' => $filesize,
        'glb_version' => $version,
        'glb_total_length' => $length,
    ];
}

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
    return sprintf(
        '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(int $bytes): string {
    $units = ['B', 'KB', 'MB', 'GB'];
    $bytes = max($bytes, 0);
    $pow = floor(($bytes ? log($bytes) : 0) / log(1024));
    $pow = min($pow, count($units) - 1);
    $bytes /= (1 << (10 * $pow));
    
    return round($bytes, 2) . ' ' . $units[$pow];
}
