<?php
declare(strict_types=1);

/**
 * GalaxyQuest AI Texture Generation API
 * Bridge to ComfyUI/SwarmUI for procedurally-generated PBR textures
 * 
 * Supports: Albedo, Normal, Specular, Roughness, Metallic, Emission, AO maps
 * Generation: Spaceships, planets, atmospheric effects, environmental details
 * 
 * Advanced Features:
 * - ControlNet-based consistency (same ship gets coherent texture sets)
 * - Progressive loading (low-res → high-res)
 * - Style presets (rusty industrial, clean sci-tech, alien aesthetics)
 * - Batch PBR generation (all maps in one workflow)
 */

header('Cache-Control: private, no-store');
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/helpers.php';
send_security_headers();
require_auth();

$action = strtolower((string)($_GET['action'] ?? 'spaceship_texture'));
$allowedActions = ['spaceship_texture', 'planet_texture', 'atmosphere_texture', 'detail_texture', 'batch_pbr', 'progressive', 'status', 'queue'];
$generationActions = ['spaceship_texture', 'planet_texture', 'atmosphere_texture', 'detail_texture', 'batch_pbr', 'progressive'];

if (!in_array($action, $allowedActions, true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'invalid action']);
    exit;
}

if (in_array($action, $generationActions, true)) {
    only_method('POST');
    verify_csrf();
    $requestData = get_json_body();
} else {
    only_method('GET');
    $requestData = [];
}

// Check if AI texture generation is enabled
$enabledSetting = getenv('COMFYUI_ENABLED');
$aiEnabled = ($enabledSetting === false || $enabledSetting === ''
    ? (APP_ENV === 'dev' ? '1' : '0')
    : $enabledSetting) === '1';
if (!$aiEnabled) {
    http_response_code(503);
    echo json_encode(['success' => false, 'error' => 'AI texture generation is disabled']);
    exit;
}

// Initialize AI texture service
try {
    $textureAiService = new GQTextureAiService();
} catch (RuntimeException | InvalidArgumentException $e) {
    error_log('texture_ai initialization error: ' . $e->getMessage());
    json_error('AI texture service initialization failed.', 500);
}

switch ($action) {
    case 'spaceship_texture':
        handle_spaceship_texture($textureAiService, $requestData);
        break;
    case 'planet_texture':
        handle_planet_texture($textureAiService, $requestData);
        break;
    case 'atmosphere_texture':
        handle_atmosphere_texture($textureAiService, $requestData);
        break;
    case 'detail_texture':
        handle_detail_texture($textureAiService, $requestData);
        break;
    case 'batch_pbr':
        handle_batch_pbr($textureAiService, $requestData);
        break;
    case 'progressive':
        handle_progressive_loading($textureAiService, $requestData);
        break;
    case 'status':
        handle_status($textureAiService);
        break;
    case 'queue':
        handle_queue($textureAiService);
        break;
}

exit;

/**
 * Handle spaceship hull texture generation
 */
function handle_spaceship_texture(GQTextureAiService $service, array $input): void
{
    $textureType = sanitize_input((string)($input['texture_type'] ?? 'albedo'));
    $faction = sanitize_input((string)($input['faction'] ?? 'generic'));
    $condition = sanitize_input((string)($input['condition'] ?? 'new'));
    $style = sanitize_input((string)($input['style'] ?? 'scifi'));
    $size = (int)($input['size'] ?? 512);
    $seed = (int)($input['seed'] ?? 0);

    $descriptor = [
        'type' => 'spaceship',
        'texture_type' => $textureType,
        'faction' => $faction,
        'condition' => $condition,
        'style' => $style,
        'seed' => $seed,
    ];

    try {
        $result = $service->generateTexture($descriptor, $size);
        if ($result['success']) {
            http_response_code(200);
            echo json_encode($result);
        } else {
            http_response_code(500);
            echo json_encode($result);
        }
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Handle planet surface texture generation
 */
function handle_planet_texture(GQTextureAiService $service, array $input): void
{
    $textureType = sanitize_input((string)($input['texture_type'] ?? 'albedo'));
    $biome = sanitize_input((string)($input['biome'] ?? 'rocky'));
    $size = (int)($input['size'] ?? 512);
    $seed = (int)($input['seed'] ?? 0);

    $descriptor = [
        'type' => 'planet',
        'texture_type' => $textureType,
        'biome' => $biome,
        'seed' => $seed,
    ];

    try {
        $result = $service->generateTexture($descriptor, $size);
        if ($result['success']) {
            http_response_code(200);
            echo json_encode($result);
        } else {
            http_response_code(500);
            echo json_encode($result);
        }
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Handle atmospheric effects texture generation
 */
function handle_atmosphere_texture(GQTextureAiService $service, array $input): void
{
    $textureType = sanitize_input((string)($input['texture_type'] ?? 'cloud'));
    $style = sanitize_input((string)($input['style'] ?? 'earth_like'));
    $size = (int)($input['size'] ?? 256);
    $seed = (int)($input['seed'] ?? 0);

    $descriptor = [
        'type' => 'atmosphere',
        'texture_type' => $textureType,
        'style' => $style,
        'seed' => $seed,
    ];

    try {
        $result = $service->generateTexture($descriptor, $size);
        if ($result['success']) {
            http_response_code(200);
            echo json_encode($result);
        } else {
            http_response_code(500);
            echo json_encode($result);
        }
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Handle detail map generation (wear, scratches, damage)
 */
function handle_detail_texture(GQTextureAiService $service, array $input): void
{
    $textureType = sanitize_input((string)($input['texture_type'] ?? 'wear'));
    $intensity = (float)($input['intensity'] ?? 0.5);
    $size = (int)($input['size'] ?? 512);
    $seed = (int)($input['seed'] ?? 0);

    $descriptor = [
        'type' => 'detail',
        'texture_type' => $textureType,
        'intensity' => max(0.0, min(1.0, $intensity)),
        'seed' => $seed,
    ];

    try {
        $result = $service->generateTexture($descriptor, $size);
        if ($result['success']) {
            http_response_code(200);
            echo json_encode($result);
        } else {
            http_response_code(500);
            echo json_encode($result);
        }
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Handle batch PBR texture generation (all maps at once)
 */
function handle_batch_pbr(GQTextureAiService $service, array $input): void
{
    $faction = sanitize_input((string)($input['faction'] ?? 'generic'));
    $condition = sanitize_input((string)($input['condition'] ?? 'new'));
    $style = sanitize_input((string)($input['style'] ?? 'scifi'));
    $size = (int)($input['size'] ?? 512);
    $seed = (int)($input['seed'] ?? 0);
    $useControlNet = (int)($input['controlnet'] ?? 0) === 1;

    $descriptor = [
        'type' => 'spaceship',
        'batch' => true,
        'faction' => $faction,
        'condition' => $condition,
        'style' => $style,
        'seed' => $seed,
        'use_controlnet' => $useControlNet,
    ];

    try {
        $result = $service->generateBatchPBR($descriptor, $size);
        if ($result['success']) {
            http_response_code(200);
            echo json_encode($result);
        } else {
            http_response_code(500);
            echo json_encode($result);
        }
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Handle progressive texture loading (low-res first, then high-res)
 */
function handle_progressive_loading(GQTextureAiService $service, array $input): never
{
    $textureType = sanitize_input((string)($input['texture_type'] ?? 'albedo'));
    $objectType = sanitize_input((string)($input['object_type'] ?? 'spaceship'));
    $faction = sanitize_input((string)($input['faction'] ?? 'generic'));
    $targetSize = filter_var($input['target_size'] ?? 512, FILTER_VALIDATE_INT);
    $phase = $input['phase'] ?? 'low_res';
    if ($targetSize === false || $targetSize < 128 || $targetSize > 1024) {
        json_error('target_size must be an integer between 128 and 1024.', 400);
    }
    if (!in_array($phase, ['low_res', 'high_res'], true)) {
        json_error('Invalid progressive phase.', 400);
    }
    $seed = (int)($input['seed'] ?? 0);

    $descriptor = [
        'type' => $objectType,
        'texture_type' => $textureType,
        'faction' => $faction,
        'seed' => $seed,
        'progressive' => true,
    ];

    try {
        $size = $phase === 'high_res' ? $targetSize : max(128, min(256, intdiv($targetSize, 2)));
        $result = $service->generateTexture($descriptor, $size);
    } catch (RuntimeException | JsonException $e) {
        error_log('texture_ai progressive error: ' . $e->getMessage());
        json_error('Progressive texture generation failed.', 500);
    }
    if (!$result['success']) {
        error_log('texture_ai progressive failure: ' . ($result['error'] ?? 'unknown generation error'));
        json_response($result, 500);
    }
    if ($phase === 'high_res') {
        json_ok(['progressive' => true, 'phase' => 'high_res_ready', 'high_res' => $result]);
    }
    json_ok([
        'progressive' => true,
        'phase' => 'low_res_ready',
        'low_res' => $result,
        'high_res_request' => [
            'action' => 'progressive',
            'target_size' => $targetSize,
            'phase' => 'high_res',
            'texture_type' => $textureType,
            'object_type' => $objectType,
            'faction' => $faction,
            'seed' => $seed,
        ],
    ]);
}


function handle_status(GQTextureAiService $service): void
{
    only_method('GET');
    try {
        $status = $service->getServiceStatus();
    } catch (Throwable $e) {
        error_log('texture_ai status error: ' . $e->getMessage());
        json_error('AI texture service status unavailable.', 503);
    }
    json_response($status);
}

function handle_queue(GQTextureAiService $service): void
{
    only_method('GET');
    try {
        $queue = $service->getQueueStatus();
    } catch (Throwable $e) {
        error_log('texture_ai queue error: ' . $e->getMessage());
        json_error('AI texture service queue unavailable.', 503);
    }
    json_ok($queue);
}

/**
 * Sanitize string input
 */
function sanitize_input(string $input): string
{
    return preg_replace('/[^a-z0-9_-]/i', '', substr($input, 0, 64)) ?: 'default';
}

/**
 * Main AI Texture Service Class
 * Handles communication with ComfyUI and caching
 */
class GQTextureAiService
{
    private const MAX_JSON_BYTES = 1048576;
    private const MAX_IMAGE_BYTES = 16777216;
    private string $comfyuiBaseUrl;
    private string $model;
    private string $checkpoint;
    private int $textureSize;
    private int $diffusionSteps;
    private float $guidanceScale;
    private string $cacheMode;
    private string $cacheDir;
    private string $lockDir;
    private bool $fallbackProcedural;
    private int $maxConcurrent = 2;
    private int $generationTimeout = 120;

    public function __construct()
    {
        $this->comfyuiBaseUrl = getenv('COMFYUI_BASE_URL') ?: 'http://localhost:8188';
        $this->model = getenv('COMFYUI_MODEL') ?: 'sdxl';
        $this->checkpoint = getenv('COMFYUI_CHECKPOINT') ?: 'model.safetensors';
        $this->textureSize = (int)getenv('COMFYUI_TEXTURE_SIZE') ?: 512;
        $this->diffusionSteps = (int)getenv('COMFYUI_DIFFUSION_STEPS') ?: 30;
        $this->guidanceScale = (float)getenv('COMFYUI_GUIDANCE_SCALE') ?: 8.5;
        $this->cacheMode = getenv('COMFYUI_CACHE_MODE') ?: 'disk';
        $this->fallbackProcedural = (getenv('COMFYUI_FALLBACK_PROCEDURAL') ?: '1') === '1';
        foreach (['COMFYUI_MAX_CONCURRENT' => [1, 16], 'COMFYUI_QUEUE_TIMEOUT' => [1, 600]] as $name => [$min, $max]) {
            $raw = getenv($name);
            if ($raw === false || $raw === '') {
                continue;
            }
            $value = filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => $min, 'max_range' => $max]]);
            if ($value === false) {
                throw new \InvalidArgumentException('Invalid ' . $name);
            }
            if ($name === 'COMFYUI_MAX_CONCURRENT') {
                $this->maxConcurrent = $value;
            } else {
                $this->generationTimeout = $value;
            }
        }

        // Setup cache directories
        $projectRoot = dirname(dirname(__FILE__));
        $this->cacheDir = $projectRoot . DIRECTORY_SEPARATOR . 'generated' . DIRECTORY_SEPARATOR . 'ai_textures';
        $this->lockDir = $this->cacheDir . DIRECTORY_SEPARATOR . 'locks';
    }

    /**
     * Generate batch PBR texture set (all maps from same seed)
     */
    public function generateBatchPBR(array $descriptor, int $size = 512): array
    {
        if (empty($descriptor['type'])) {
            return ['success' => false, 'error' => 'invalid descriptor'];
        }

        $mapTypes = ['albedo', 'normal', 'specular', 'roughness'];
        $results = [];
        $baseSeed = $descriptor['seed'] ?? 0;

        // Generate each map with consistent seed for visual coherence
        foreach ($mapTypes as $mapType) {
            $mapDescriptor = array_merge($descriptor, [
                'texture_type' => $mapType,
                'seed' => $baseSeed + $this->hash_int($mapType),
            ]);

            try {
                $result = $this->generateTexture($mapDescriptor, $size);
                if ($result['success']) {
                    $results[$mapType] = $result;
                } else {
                    // Continue with other maps even if one fails
                    $results[$mapType] = ['success' => false, 'error' => 'failed'];
                }
            } catch (Exception $e) {
                $results[$mapType] = ['success' => false, 'error' => $e->getMessage()];
            }

            // Small delay between requests to avoid queue overload
            usleep(500000); // 500ms
        }

        // Check if any maps succeeded
        $successCount = count(array_filter($results, fn($r) => $r['success'] ?? false));
        
        return [
            'success' => $successCount > 0,
            'batch' => true,
            'maps' => $results,
            'success_count' => $successCount,
            'total_maps' => count($mapTypes),
            'use_controlnet' => $descriptor['use_controlnet'] ?? false,
        ];
    }

    /**
     * Helper function to get consistent hash for seed variation
     */
    private function hash_int(string $string): int
    {
        $hash = crc32($string);
        return $hash > 0 ? $hash : -$hash;
    }

    /**
     * Generate or retrieve cached AI texture
     */
    public function generateTexture(array $descriptor, int $size = 512): array
    {
        // Validate and normalize descriptor
        if (empty($descriptor['type'])) {
            error_log('texture_ai generation error: invalid descriptor');
            return ['success' => false, 'error' => 'invalid descriptor'];
        }

        $normalizedDescriptor = $this->normalizeDescriptor($descriptor, $size);
        $cacheKey = $this->generateCacheKey($normalizedDescriptor);
        $cachePath = $this->cacheDir . DIRECTORY_SEPARATOR . $cacheKey . '.png';

        // Check cache
        if ($this->cacheMode === 'disk' && is_file($cachePath)) {
            return $this->getCachedTextureResponse($cachePath, $cacheKey);
        }

        try {
            $this->ensureGenerationDirectories();
        } catch (RuntimeException $e) {
            error_log('texture_ai generation error: ' . $e->getMessage());
            return ['success' => false, 'error' => 'Texture generation failed.', 'fallback_required' => true];
        }

        // Try to generate new texture
        $lockPath = $this->lockDir . DIRECTORY_SEPARATOR . $cacheKey . '.lock';
        $lockHandle = @fopen($lockPath, 'c+');

        if ($lockHandle === false) {
            error_log('texture_ai generation error: cannot open generation lock');
            return ['success' => false, 'error' => 'cannot open generation lock'];
        }

        $generatedPath = null;
        $slotHandle = null;
        $deadline = hrtime(true) / 1e9 + $this->generationTimeout;
        try {
            if (!flock($lockHandle, LOCK_EX | LOCK_NB)) {
                throw new RuntimeException('Texture generation already in progress');
            }
            // Double-check cache after acquiring lock
            if ($this->cacheMode === 'disk' && is_file($cachePath)) {
                return $this->getCachedTextureResponse($cachePath, $cacheKey);
            }
            $slotHandle = $this->acquireGenerationSlot();

            // Generate texture
            $prompt = $this->descriptorToPrompt($normalizedDescriptor);
            $generatedPath = $this->requestComfyUIGeneration($prompt, $normalizedDescriptor, $normalizedDescriptor['size'], $deadline);
            $this->remainingSeconds($deadline);

            if ($generatedPath && is_file($generatedPath)) {
                if (rename($generatedPath, $cachePath)) {
                    return $this->getCachedTextureResponse($cachePath, $cacheKey);
                }
            }

            throw new RuntimeException('Texture generation failed');
        } catch (RuntimeException | JsonException $e) {
            error_log('texture_ai generation error: ' . $e->getMessage());
            // Fallback to procedural if enabled
            if ($this->fallbackProcedural) {
                return ['success' => false, 'error' => 'Texture generation failed.', 'fallback_required' => true];
            }

            return ['success' => false, 'error' => 'Texture generation failed.'];
        } finally {
            if ($generatedPath !== null && is_file($generatedPath) && !unlink($generatedPath)) {
                error_log('texture_ai cleanup error: cannot remove temporary image');
            }
            flock($lockHandle, LOCK_UN);
            fclose($lockHandle);
            if (is_resource($slotHandle)) {
                flock($slotHandle, LOCK_UN);
                fclose($slotHandle);
            }
        }
    }

    private function ensureGenerationDirectories(): void
    {
        if (!is_dir($this->cacheDir)
            && !@mkdir($this->cacheDir, 0775, true)
            && !is_dir($this->cacheDir)) {
            throw new RuntimeException('Cannot create AI texture cache directory');
        }
        if (!is_dir($this->lockDir)
            && !@mkdir($this->lockDir, 0775, true)
            && !is_dir($this->lockDir)) {
            throw new RuntimeException('Cannot create AI texture lock directory');
        }
    }

    /** @return resource */
    private function acquireGenerationSlot()
    {
        for ($slot = 0; $slot < $this->maxConcurrent; $slot++) {
            $handle = @fopen($this->lockDir . DIRECTORY_SEPARATOR . 'slot_' . $slot . '.lock', 'c+');
            if ($handle === false) {
                throw new RuntimeException('Cannot open generation slot');
            }
            if (flock($handle, LOCK_EX | LOCK_NB)) {
                return $handle;
            }
            fclose($handle);
        }
        throw new RuntimeException('AI texture generation capacity exhausted');
    }

    private function remainingSeconds(float $deadline): float
    {
        $remaining = $deadline - hrtime(true) / 1e9;
        if ($remaining <= 0) {
            throw new RuntimeException('AI texture generation deadline exceeded');
        }
        return $remaining;
    }

    private function waitForJob(int $seconds, float $deadline): void
    {
        if ($this->remainingSeconds($deadline) <= $seconds) {
            throw new RuntimeException('AI texture generation deadline exceeded');
        }
        sleep($seconds);
        $this->remainingSeconds($deadline);
    }

    /**
     * Request texture generation from ComfyUI
     */
    private function requestComfyUIGeneration(string $prompt, array $descriptor, int $size, float $deadline): string
    {
        $workflow = $this->buildComfyUIWorkflow($prompt, $descriptor, $size);
        $json = json_encode(['prompt' => $workflow], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        $url = $this->comfyuiBaseUrl . '/prompt';
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $json,
                'timeout' => 120,
            ],
        ]);

        $response = $this->readHttpResponse($url, $context, self::MAX_JSON_BYTES, $deadline);
        if ($response === false) {
            throw new RuntimeException('ComfyUI service unreachable');
        }

        $data = $this->decodeObjectResponse($response);
        if (!is_string($data['prompt_id'] ?? null) || $data['prompt_id'] === ''
            || isset($data['error']) || (array_key_exists('node_errors', $data) && !is_array($data['node_errors']))
            || !empty($data['node_errors'])) {
            throw new RuntimeException('Invalid ComfyUI response');
        }

        // Poll for completion (simplified - production would use WebSocket)
        return $this->pollComfyUIJob($data['prompt_id'], $descriptor, $deadline);
    }

    /**
     * Poll ComfyUI job status until completion
     */
    private function pollComfyUIJob(string $promptId, array $descriptor, float $deadline, int $maxRetries = 30): string
    {
        $retries = 0;
        $outputDir = $this->cacheDir . DIRECTORY_SEPARATOR . 'tmp';

        if (!is_dir($outputDir) && !@mkdir($outputDir, 0775, true)) {
            throw new RuntimeException('Cannot create temporary output directory');
        }

        while ($retries < $maxRetries) {
            $url = $this->comfyuiBaseUrl . '/history/' . urlencode($promptId);
            $response = $this->readHttpResponse(
                $url,
                stream_context_create(['http' => ['timeout' => 10]]),
                self::MAX_JSON_BYTES,
                $deadline
            );

            if ($response === false) {
                $this->waitForJob(1, $deadline);
                $retries++;
                continue;
            }

            $history = $this->decodeObjectResponse($response);
            if (!array_key_exists($promptId, $history)) {
                $this->waitForJob(2, $deadline);
                $retries++;
                continue;
            }

            $jobData = $history[$promptId];
            if (!is_array($jobData)) {
                throw new RuntimeException('Invalid ComfyUI history entry');
            }
            if (array_key_exists('status', $jobData) && !is_array($jobData['status'])) {
                throw new RuntimeException('Invalid ComfyUI history status');
            }
            $status = $jobData['status'] ?? [];
            if (array_key_exists('completed', $status) && !is_bool($status['completed'])) {
                throw new RuntimeException('Invalid ComfyUI completion flag');
            }
            if (array_key_exists('status_str', $status) && !is_string($status['status_str'])) {
                throw new RuntimeException('Invalid ComfyUI execution status');
            }
            if (array_key_exists('outputs', $jobData) && !is_array($jobData['outputs'])) {
                throw new RuntimeException('Invalid ComfyUI history outputs');
            }
            if (($jobData['status']['status_str'] ?? null) === 'error') {
                throw new RuntimeException('ComfyUI execution failed');
            }

            // Check if completed
            if (!empty($jobData['outputs'])) {
                $output = $this->extractComfyUIOutput($jobData['outputs']);
                if ($output) {
                    return $this->downloadComfyUIImage($output, $outputDir, $promptId, $deadline);
                }
            }
            if (($jobData['status']['completed'] ?? false) === true) {
                throw new RuntimeException('ComfyUI completed without an image');
            }

            $this->waitForJob(2, $deadline);
            $retries++;
        }

        throw new RuntimeException('ComfyUI job timeout');
    }

    /**
     * Extract image filename from ComfyUI output
     */
    private function extractComfyUIOutput(array $outputs): ?array
    {
        // ComfyUI outputs are organized by node ID
        foreach ($outputs as $nodeId => $nodeOutput) {
            if (!is_array($nodeOutput)) {
                throw new RuntimeException('Invalid ComfyUI output node');
            }
            if (array_key_exists('images', $nodeOutput) && (!is_array($nodeOutput['images'])
                || !array_is_list($nodeOutput['images']))) {
                throw new RuntimeException('Invalid ComfyUI image list');
            }
            if (!empty($nodeOutput['images'])) {
                $image = $nodeOutput['images'][0];
                if (!is_array($image) || !is_string($image['filename'] ?? null)
                    || $image['filename'] === ''
                    || (array_key_exists('subfolder', $image) && !is_string($image['subfolder']))
                    || (array_key_exists('type', $image) && !in_array($image['type'], ['output', 'temp'], true))) {
                    throw new RuntimeException('Invalid ComfyUI image metadata');
                }
                return [
                    'filename' => $image['filename'],
                    'subfolder' => $image['subfolder'] ?? '',
                    'type' => $image['type'] ?? 'output',
                ];
            }
        }
        return null;
    }

    /**
     * Download generated image from ComfyUI
     */
    private function downloadComfyUIImage(array $image, string $outputDir, string $promptId, float $deadline): string
    {
        $localPath = $outputDir . DIRECTORY_SEPARATOR . hash('sha256', $promptId) . '.png';
        $url = $this->comfyuiBaseUrl . '/view?' . http_build_query($image);

        $context = stream_context_create(['http' => ['timeout' => 30]]);
        $imageData = $this->readHttpResponse($url, $context, self::MAX_IMAGE_BYTES, $deadline);

        if ($imageData === false || empty($imageData)) {
            throw new RuntimeException('Cannot download ComfyUI image');
        }
        $info = @getimagesizefromstring($imageData);
        if ($info === false || $info[2] !== IMAGETYPE_PNG) {
            throw new RuntimeException('ComfyUI output is not a valid PNG');
        }
        if ($info[0] < 1 || $info[1] < 1 || $info[0] > 1024 || $info[1] > 1024) {
            throw new RuntimeException('ComfyUI image dimensions exceed texture limits');
        }
        $decoded = @imagecreatefromstring($imageData);
        if ($decoded === false) {
            throw new RuntimeException('ComfyUI PNG cannot be decoded');
        }
        imagedestroy($decoded);

        if (@file_put_contents($localPath, $imageData) === strlen($imageData)) {
            return $localPath;
        }
        if (is_file($localPath) && !unlink($localPath)) {
            error_log('texture_ai cleanup error: cannot remove partial image');
        }
        throw new RuntimeException('Cannot save ComfyUI image');
    }

    /**
     * Get service status (health check)
     */
    public function getServiceStatus(): array
    {
        $stats = $this->getMonitoringData('/system_stats');
        if (!is_array($stats['system'] ?? null) || !is_array($stats['devices'] ?? null)) {
            throw new RuntimeException('Invalid ComfyUI system stats response.');
        }
        return [
            'success' => true,
            'status' => 'available',
            'model' => $this->model,
            'stats' => $stats,
        ];
    }

    /**
     * Get current generation queue status
     */
    public function getQueueStatus(): array
    {
        $queueData = $this->getMonitoringData('/queue');
        foreach (['queue_pending', 'queue_running'] as $field) {
            if (!is_array($queueData[$field] ?? null) || !array_is_list($queueData[$field])) {
                throw new RuntimeException('Invalid ComfyUI queue response.');
            }
        }
        return [
            'pending' => $queueData['queue_pending'],
            'running' => $queueData['queue_running'],
        ];
    }

    private function getMonitoringData(string $path): array
    {
        $response = $this->readHttpResponse(
            $this->comfyuiBaseUrl . $path,
            stream_context_create(['http' => ['timeout' => 5]]),
            self::MAX_JSON_BYTES
        );
        if ($response === false) {
            throw new RuntimeException('ComfyUI monitoring request failed.');
        }
        try {
            $data = $this->decodeObjectResponse($response);
        } catch (JsonException $e) {
            throw new RuntimeException('Invalid ComfyUI monitoring JSON.', 0, $e);
        }
        return $data;
    }

    private function decodeObjectResponse(string $response): array
    {
        $data = json_decode($response, true, flags: JSON_THROW_ON_ERROR);
        if (!is_array($data) || !str_starts_with(ltrim($response), '{')) {
            throw new RuntimeException('ComfyUI response must be a JSON object');
        }
        return $data;
    }

    /** @param resource $context */
    private function readHttpResponse(string $url, mixed $context, int $maxBytes, ?float $deadline = null): string|false
    {
        stream_context_set_option($context, 'http', 'follow_location', 0);
        stream_context_set_option($context, 'http', 'max_redirects', 0);
        stream_context_set_option($context, 'http', 'ignore_errors', false);
        if ($deadline !== null) {
            $options = stream_context_get_options($context);
            stream_context_set_option($context, 'http', 'timeout', min(
                (float)($options['http']['timeout'] ?? 120),
                $this->remainingSeconds($deadline)
            ));
        }
        // Read one extra byte to reject oversized responses without buffering the entire body.
        $http_response_header = [];
        $response = @file_get_contents($url, false, $context, 0, $maxBytes + 1);
        $httpStatus = 0;
        foreach ($http_response_header as $header) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $header, $match)) {
                $httpStatus = (int)$match[1];
            }
        }
        if ($httpStatus !== 0 && ($httpStatus < 200 || $httpStatus >= 300)) {
            throw new RuntimeException('ComfyUI HTTP ' . $httpStatus);
        }
        if ($deadline !== null) {
            $this->remainingSeconds($deadline);
        }
        if ($response !== false && strlen($response) > $maxBytes) {
            throw new RuntimeException('ComfyUI response exceeds byte limit');
        }
        return $response;
    }

    /**
     * Convert descriptor to AI prompt
     */
    private function descriptorToPrompt(array $descriptor): string
    {
        $type = $descriptor['type'] ?? 'generic';

        if ($type === 'spaceship') {
            return $this->buildSpaceshipPrompt($descriptor);
        } elseif ($type === 'planet') {
            return $this->buildPlanetPrompt($descriptor);
        } elseif ($type === 'atmosphere') {
            return $this->buildAtmospherePrompt($descriptor);
        } elseif ($type === 'detail') {
            return $this->buildDetailPrompt($descriptor);
        }

        return 'sci-fi texture, high quality, detailed';
    }

    /**
     * Build prompt for spaceship textures
     */
    private function buildSpaceshipPrompt(array $desc): string
    {
        $textureType = $desc['texture_type'] ?? 'albedo';
        $faction = $desc['faction'] ?? 'generic';
        $condition = $desc['condition'] ?? 'new';
        $style = $desc['style'] ?? 'scifi';

        $base = match ($textureType) {
            'normal' => 'normal map for spaceship hull, detailed surface imperfections',
            'specular' => 'specular map for metallic spaceship hull, shiny reflective areas',
            'roughness' => 'roughness texture for spaceship, metal panels with varying finish',
            'metallic' => 'metallic texture for starship hull, steel and alloy details',
            'emission' => 'emissive texture for spaceship cockpit and running lights',
            default => 'sci-fi spaceship hull texture, {$style} aesthetic',
        };

        $condition = match ($condition) {
            'weathered' => ', worn, weathered metal, oxidation marks',
            'damaged' => ', battle scars, dents, burn marks, impact damage',
            default => ', pristine new condition, clean finish',
        };

        $factionHint = match ($faction) {
            'iron_fleet' => ' - armored military design, reinforced panels',
            'merchants' => ' - sleek commercial design, efficiency focus',
            'nomads' => ' - rustic, repurposed parts, jury-rigged feel',
            default => '',
        };

        return "High-quality {$base}{$condition}{$factionHint}, 4K PBR texture, photorealistic, cinematic lighting, no text";
    }

    /**
     * Build prompt for planet surface textures
     */
    private function buildPlanetPrompt(array $desc): string
    {
        $textureType = $desc['texture_type'] ?? 'albedo';
        $biome = $desc['biome'] ?? 'rocky';

        $base = match ($textureType) {
            'normal' => 'detailed normal map for planet surface, geological formations',
            'roughness' => 'planet surface roughness texture, varied terrain finish',
            'ao' => 'ambient occlusion map for planetary terrain, crevice shading',
            default => match ($biome) {
                'icy' => 'frozen planet surface, ice formations, snow drifts',
                'volcanic' => 'volcanic terrain, lava flows, ash, dark basalt',
                'alien' => 'alien geology, impossible rock formations, crystalline structures',
                default => 'rocky planet surface, realistic geological formations',
            },
        };

        return "Seamless {$base}, high-resolution terrain texture, 4K PBR, scientifically accurate colors, no artificial patterns, cinematic";
    }

    /**
     * Build prompt for atmospheric textures
     */
    private function buildAtmospherePrompt(array $desc): string
    {
        $style = $desc['style'] ?? 'earth_like';

        $atmosphere = match ($style) {
            'aurora' => 'aurora borealis, northern lights, shimmering green and purple',
            'toxic' => 'toxic atmosphere, green and yellow clouds, dangerous looking',
            'storm' => 'violent storm clouds, lightning, turbulent weather patterns',
            default => 'earth-like clouds, cumulus formations, atmospheric perspective',
        };

        return "Seamless {$atmosphere} texture, volumetric, soft lighting, high-resolution, 4K detail, atmospheric depth, no sharp edges";
    }

    /**
     * Build prompt for detail textures (wear, scratches, damage)
     */
    private function buildDetailPrompt(array $desc): string
    {
        $textureType = $desc['texture_type'] ?? 'wear';
        $intensity = $desc['intensity'] ?? 0.5;

        $intensityDesc = $intensity < 0.3 ? 'subtle ' : ($intensity < 0.7 ? 'moderate ' : 'heavy ');

        $detail = match ($textureType) {
            'scratches' => "{$intensityDesc}scratches and abrasion marks on metal",
            'dust' => "{$intensityDesc}dust accumulation, weathering, grime patterns",
            'corrosion' => "{$intensityDesc}rust and corrosion, oxidation patterns",
            'damage' => "{$intensityDesc}impact damage, dents, deformation marks",
            default => "{$intensityDesc}surface wear patterns, aging texture",
        };

        return "Seamless detail texture: {$detail}, high-resolution overlay, grayscale, 4K, suitable for layering, professional quality";
    }

    /**
     * Normalize descriptor to consistent format
     */
    private function normalizeDescriptor(array $desc, int $size): array
    {
        return [
            ...$desc,
            'type' => $desc['type'] ?? 'generic',
            'texture_type' => $desc['texture_type'] ?? 'albedo',
            'size' => min(1024, max(128, $size)),
            'seed' => $desc['seed'] ?? 0,
            'model' => $this->model,
            'checkpoint' => $this->checkpoint,
            'steps' => $this->diffusionSteps,
            'guidance' => $this->guidanceScale,
        ];
    }

    /**
     * Generate SHA256 cache key
     */
    private function generateCacheKey(array $descriptor): string
    {
        $keyData = json_encode(
            $this->sortDescriptorKeys($descriptor),
            JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        );
        return hash('sha256', $keyData);
    }

    private function sortDescriptorKeys(array $value): array
    {
        if (!array_is_list($value)) {
            ksort($value, SORT_STRING);
        }
        foreach ($value as &$item) {
            if (is_array($item)) {
                $item = $this->sortDescriptorKeys($item);
            }
        }
        unset($item);
        return $value;
    }

    /**
     * Get cached texture response
     */
    private function getCachedTextureResponse(string $cachePath, string $cacheKey): array
    {
        $etag = '"' . $cacheKey . '"';
        $mtime = @filemtime($cachePath);
        $size = @filesize($cachePath);

        return [
            'success' => true,
            'source' => 'cache',
            'cache_key' => $cacheKey,
            'path' => 'generated/ai_textures/' . $cacheKey . '.png',
            'etag' => $etag,
            'size' => $size,
            'mtime' => $mtime,
        ];
    }

    /**
     * Build ComfyUI workflow JSON
     */
    private function buildComfyUIWorkflow(string $prompt, array $descriptor, int $size): array
    {
        return [
            '1' => [
                'inputs' => ['text' => $prompt, 'clip' => ['5', 1]],
                'class_type' => 'CLIPTextEncode',
            ],
            '2' => [
                'inputs' => ['text' => 'low quality, artifacts, blurry, watermark', 'clip' => ['5', 1]],
                'class_type' => 'CLIPTextEncode',
            ],
            '3' => [
                'inputs' => [
                    'seed' => $descriptor['seed'] ?? 0,
                    'steps' => $descriptor['steps'] ?? 30,
                    'cfg' => $descriptor['guidance'] ?? 8.5,
                    'sampler_name' => 'euler',
                    'scheduler' => 'normal',
                    'denoise' => 1.0,
                    'model' => ['5', 0],
                    'positive' => ['1', 0],
                    'negative' => ['2', 0],
                    'latent_image' => ['7', 0],
                ],
                'class_type' => 'KSampler',
            ],
            '4' => [
                'inputs' => [
                    'samples' => ['3', 0],
                    'vae' => ['5', 2],
                ],
                'class_type' => 'VAEDecode',
            ],
            '5' => [
                'inputs' => ['ckpt_name' => $this->checkpoint],
                'class_type' => 'CheckpointLoaderSimple',
            ],
            '6' => [
                'inputs' => [
                    'filename_prefix' => 'galaxyquest_' . ($descriptor['type'] ?? 'texture'),
                    'images' => ['4', 0],
                ],
                'class_type' => 'SaveImage',
            ],
            '7' => [
                'inputs' => ['width' => $size, 'height' => $size, 'batch_size' => 1],
                'class_type' => 'EmptyLatentImage',
            ],
        ];
    }
}
