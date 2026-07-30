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

header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=31536000, immutable');
header('Content-Type: application/json; charset=utf-8');

// Load environment configuration
require_once dirname(__DIR__) . '/config/config.php';

$action = strtolower((string)($_GET['action'] ?? 'spaceship_texture'));
$allowedActions = ['spaceship_texture', 'planet_texture', 'atmosphere_texture', 'detail_texture', 'batch_pbr', 'progressive', 'status', 'queue'];

if (!in_array($action, $allowedActions, true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'invalid action']);
    exit;
}

// Check if AI texture generation is enabled
$aiEnabled = (getenv('COMFYUI_ENABLED') ?: '1') === '1';
if (!$aiEnabled) {
    http_response_code(503);
    echo json_encode(['success' => false, 'error' => 'AI texture generation is disabled']);
    exit;
}

// Initialize AI texture service
$textureAiService = new GQTextureAiService();

switch ($action) {
    case 'spaceship_texture':
        handle_spaceship_texture($textureAiService);
        break;
    case 'planet_texture':
        handle_planet_texture($textureAiService);
        break;
    case 'atmosphere_texture':
        handle_atmosphere_texture($textureAiService);
        break;
    case 'detail_texture':
        handle_detail_texture($textureAiService);
        break;
    case 'batch_pbr':
        handle_batch_pbr($textureAiService);
        break;
    case 'progressive':
        handle_progressive_loading($textureAiService);
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
function handle_spaceship_texture(GQTextureAiService $service): void
{
    $textureType = sanitize_input((string)($_GET['texture_type'] ?? 'albedo'));
    $faction = sanitize_input((string)($_GET['faction'] ?? 'generic'));
    $condition = sanitize_input((string)($_GET['condition'] ?? 'new')); // new, weathered, damaged
    $style = sanitize_input((string)($_GET['style'] ?? 'scifi')); // scifi, industrial, alien
    $size = (int)($_GET['size'] ?? 512);
    $seed = (int)($_GET['seed'] ?? 0);

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
function handle_planet_texture(GQTextureAiService $service): void
{
    $textureType = sanitize_input((string)($_GET['texture_type'] ?? 'albedo'));
    $biome = sanitize_input((string)($_GET['biome'] ?? 'rocky')); // rocky, icy, volcanic, alien
    $size = (int)($_GET['size'] ?? 512);
    $seed = (int)($_GET['seed'] ?? 0);

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
function handle_atmosphere_texture(GQTextureAiService $service): void
{
    $textureType = sanitize_input((string)($_GET['texture_type'] ?? 'cloud'));
    $style = sanitize_input((string)($_GET['style'] ?? 'earth_like')); // earth_like, toxic, aurora, etc.
    $size = (int)($_GET['size'] ?? 256);
    $seed = (int)($_GET['seed'] ?? 0);

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
function handle_detail_texture(GQTextureAiService $service): void
{
    $textureType = sanitize_input((string)($_GET['texture_type'] ?? 'wear'));
    $intensity = (float)($_GET['intensity'] ?? 0.5);
    $size = (int)($_GET['size'] ?? 512);
    $seed = (int)($_GET['seed'] ?? 0);

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
function handle_batch_pbr(GQTextureAiService $service): void
{
    $faction = sanitize_input((string)($_GET['faction'] ?? 'generic'));
    $condition = sanitize_input((string)($_GET['condition'] ?? 'new'));
    $style = sanitize_input((string)($_GET['style'] ?? 'scifi'));
    $size = (int)($_GET['size'] ?? 512);
    $seed = (int)($_GET['seed'] ?? 0);
    $useControlNet = (int)($_GET['controlnet'] ?? 0) === 1;

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
function handle_progressive_loading(GQTextureAiService $service): void
{
    $textureType = sanitize_input((string)($_GET['texture_type'] ?? 'albedo'));
    $objectType = sanitize_input((string)($_GET['object_type'] ?? 'spaceship'));
    $faction = sanitize_input((string)($_GET['faction'] ?? 'generic'));
    $targetSize = (int)($_GET['target_size'] ?? 512);
    $seed = (int)($_GET['seed'] ?? 0);

    $descriptor = [
        'type' => $objectType,
        'texture_type' => $textureType,
        'faction' => $faction,
        'seed' => $seed,
        'progressive' => true,
    ];

    try {
        // Generate low-res first (fast)
        $lowResSize = max(128, min(256, $targetSize / 2));
        $lowResResult = $service->generateTexture($descriptor, $lowResSize);

        if (!$lowResResult['success']) {
            http_response_code(500);
            echo json_encode($lowResResult);
            exit;
        }

        http_response_code(200);
        echo json_encode([
            'success' => true,
            'progressive' => true,
            'phase' => 'low_res_ready',
            'low_res' => $lowResResult,
            'high_res_url' => 'api/textures-ai.php?action=' . $_GET['action'] . '&target_size=' . $targetSize . '&phase=high_res&' . http_build_query(array_filter([
                'texture_type' => $textureType,
                'object_type' => $objectType,
                'faction' => $faction,
                'seed' => $seed,
            ])),
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
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
    private string $comfyuiBaseUrl;
    private string $model;
    private int $textureSize;
    private int $diffusionSteps;
    private float $guidanceScale;
    private string $cacheMode;
    private string $cacheDir;
    private string $lockDir;
    private bool $fallbackProcedural;

    public function __construct()
    {
        $this->comfyuiBaseUrl = getenv('COMFYUI_BASE_URL') ?: 'http://localhost:8188';
        $this->model = getenv('COMFYUI_MODEL') ?: 'sdxl';
        $this->textureSize = (int)getenv('COMFYUI_TEXTURE_SIZE') ?: 512;
        $this->diffusionSteps = (int)getenv('COMFYUI_DIFFUSION_STEPS') ?: 30;
        $this->guidanceScale = (float)getenv('COMFYUI_GUIDANCE_SCALE') ?: 8.5;
        $this->cacheMode = getenv('COMFYUI_CACHE_MODE') ?: 'disk';
        $this->fallbackProcedural = (getenv('COMFYUI_FALLBACK_PROCEDURAL') ?: '1') === '1';

        // Setup cache directories
        $projectRoot = dirname(dirname(__FILE__));
        $this->cacheDir = $projectRoot . DIRECTORY_SEPARATOR . 'generated' . DIRECTORY_SEPARATOR . 'ai_textures';
        $this->lockDir = $this->cacheDir . DIRECTORY_SEPARATOR . 'locks';

        if (!is_dir($this->cacheDir) && !@mkdir($this->cacheDir, 0775, true)) {
            throw new RuntimeException('Cannot create AI texture cache directory');
        }
        if (!is_dir($this->lockDir) && !@mkdir($this->lockDir, 0775, true)) {
            throw new RuntimeException('Cannot create AI texture lock directory');
        }
    }

    /**
     * Generate batch PBR texture set (all maps from same seed)
     */
    public function generateBatchPBR(array $descriptor, int $size = 512): array
    {
        if (!is_array($descriptor) || empty($descriptor['type'])) {
            return ['success' => false, 'error' => 'invalid descriptor'];
        }

        $mapTypes = ['albedo', 'normal', 'specular', 'roughness'];
        $results = [];
        $baseSeed = $descriptor['seed'] ?? 0;

        // Generate each map with consistent seed for visual coherence
        foreach ($mapTypes as $mapType) {
            $mapDescriptor = array_merge($descriptor, [
                'texture_type' => $mapType,
                'seed' => $baseSeed + hash_int($mapType),
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
        if (!is_array($descriptor) || empty($descriptor['type'])) {
            return ['success' => false, 'error' => 'invalid descriptor'];
        }

        $normalizedDescriptor = $this->normalizeDescriptor($descriptor, $size);
        $cacheKey = $this->generateCacheKey($normalizedDescriptor);
        $cachePath = $this->cacheDir . DIRECTORY_SEPARATOR . $cacheKey . '.png';

        // Check cache
        if ($this->cacheMode === 'disk' && is_file($cachePath)) {
            return $this->getCachedTextureResponse($cachePath, $cacheKey);
        }

        // Try to generate new texture
        $lockPath = $this->lockDir . DIRECTORY_SEPARATOR . $cacheKey . '.lock';
        $lockHandle = @fopen($lockPath, 'c+');

        if ($lockHandle !== false) {
            if (!@flock($lockHandle, LOCK_EX)) {
                @fclose($lockHandle);
                return ['success' => false, 'error' => 'cannot acquire generation lock'];
            }
        }

        try {
            // Double-check cache after acquiring lock
            if (is_file($cachePath)) {
                if ($lockHandle !== false) {
                    @flock($lockHandle, LOCK_UN);
                    @fclose($lockHandle);
                }
                return $this->getCachedTextureResponse($cachePath, $cacheKey);
            }

            // Generate texture
            $prompt = $this->descriptorToPrompt($normalizedDescriptor);
            $generatedPath = $this->requestComfyUIGeneration($prompt, $normalizedDescriptor, $size);

            if ($generatedPath && is_file($generatedPath)) {
                if (rename($generatedPath, $cachePath)) {
                    if ($lockHandle !== false) {
                        @flock($lockHandle, LOCK_UN);
                        @fclose($lockHandle);
                    }
                    return $this->getCachedTextureResponse($cachePath, $cacheKey);
                }
            }

            throw new RuntimeException('Texture generation failed');
        } catch (Exception $e) {
            if ($lockHandle !== false) {
                @flock($lockHandle, LOCK_UN);
                @fclose($lockHandle);
            }

            // Fallback to procedural if enabled
            if ($this->fallbackProcedural) {
                return ['success' => false, 'error' => $e->getMessage(), 'fallback_required' => true];
            }

            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Request texture generation from ComfyUI
     */
    private function requestComfyUIGeneration(string $prompt, array $descriptor, int $size): ?string
    {
        $workflow = $this->buildComfyUIWorkflow($prompt, $descriptor, $size);
        $json = json_encode($workflow, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if ($json === false) {
            throw new RuntimeException('Cannot encode ComfyUI workflow');
        }

        $url = $this->comfyuiBaseUrl . '/prompt';
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $json,
                'timeout' => 120,
            ],
        ]);

        $response = @file_get_contents($url, false, $context);
        if ($response === false) {
            throw new RuntimeException('ComfyUI service unreachable');
        }

        $data = json_decode($response, true);
        if (!is_array($data) || empty($data['prompt_id'])) {
            throw new RuntimeException('Invalid ComfyUI response');
        }

        // Poll for completion (simplified - production would use WebSocket)
        return $this->pollComfyUIJob($data['prompt_id'], $descriptor);
    }

    /**
     * Poll ComfyUI job status until completion
     */
    private function pollComfyUIJob(string $promptId, array $descriptor, int $maxRetries = 30): ?string
    {
        $retries = 0;
        $outputDir = $this->cacheDir . DIRECTORY_SEPARATOR . 'tmp';

        if (!is_dir($outputDir) && !@mkdir($outputDir, 0775, true)) {
            throw new RuntimeException('Cannot create temporary output directory');
        }

        while ($retries < $maxRetries) {
            $url = $this->comfyuiBaseUrl . '/history/' . urlencode($promptId);
            $response = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 10]]));

            if ($response === false) {
                sleep(1);
                $retries++;
                continue;
            }

            $history = json_decode($response, true);
            if (!is_array($history) || empty($history[$promptId])) {
                sleep(2);
                $retries++;
                continue;
            }

            $jobData = $history[$promptId];

            // Check if completed
            if (!empty($jobData['outputs'])) {
                $output = $this->extractComfyUIOutput($jobData['outputs']);
                if ($output) {
                    return $this->downloadComfyUIImage($output, $outputDir, $promptId);
                }
            }

            sleep(2);
            $retries++;
        }

        throw new RuntimeException('ComfyUI job timeout');
    }

    /**
     * Extract image filename from ComfyUI output
     */
    private function extractComfyUIOutput(array $outputs): ?string
    {
        // ComfyUI outputs are organized by node ID
        foreach ($outputs as $nodeId => $nodeOutput) {
            if (is_array($nodeOutput) && !empty($nodeOutput['images'])) {
                $images = $nodeOutput['images'];
                if (is_array($images) && !empty($images[0])) {
                    return $images[0]['filename'] ?? null;
                }
            }
        }
        return null;
    }

    /**
     * Download generated image from ComfyUI
     */
    private function downloadComfyUIImage(string $filename, string $outputDir, string $promptId): ?string
    {
        $localPath = $outputDir . DIRECTORY_SEPARATOR . $promptId . '.png';
        $url = $this->comfyuiBaseUrl . '/view?filename=' . urlencode($filename);

        $context = stream_context_create(['http' => ['timeout' => 30]]);
        $imageData = @file_get_contents($url, false, $context);

        if ($imageData === false || empty($imageData)) {
            return null;
        }

        if (@file_put_contents($localPath, $imageData) !== false) {
            return $localPath;
        }

        return null;
    }

    /**
     * Get service status (health check)
     */
    public function getServiceStatus(): array
    {
        $url = $this->comfyuiBaseUrl . '/system_stats';
        $response = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 5]]));

        if ($response === false) {
            return ['success' => false, 'status' => 'unavailable'];
        }

        $stats = json_decode($response, true);
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
        $url = $this->comfyuiBaseUrl . '/queue';
        $response = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 5]]));

        if ($response === false) {
            return [];
        }

        $queueData = json_decode($response, true);
        return [
            'pending' => $queueData['queue'] ?? [],
            'running' => $queueData['executing'] ?? null,
        ];
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
            'type' => $desc['type'] ?? 'generic',
            'texture_type' => $desc['texture_type'] ?? 'albedo',
            'size' => min(1024, max(128, $size)),
            'seed' => $desc['seed'] ?? 0,
            'model' => $this->model,
            'steps' => $this->diffusionSteps,
            'guidance' => $this->guidanceScale,
            // Keep additional fields as-is
            ...$desc,
        ];
    }

    /**
     * Generate SHA256 cache key
     */
    private function generateCacheKey(array $descriptor): string
    {
        $keyData = json_encode($descriptor, JSON_UNESCAPED_SLASHES | JSON_SORT_KEYS);
        return hash('sha256', $keyData);
    }

    /**
     * Get cached texture response
     */
    private function getCachedTextureResponse(string $cachePath, string $cacheKey): array
    {
        $etag = '"' . $cacheKey . '"';
        $mtime = @filemtime($cachePath);
        $size = @filesize($cachePath);

        // Check ETag
        $clientEtag = trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
        if ($clientEtag === $etag) {
            http_response_code(304);
            exit;
        }

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
        // This is a simplified workflow structure
        // Production would use more sophisticated ComfyUI nodes for PBR generation
        return [
            '1' => [
                'inputs' => ['text' => $prompt],
                'class_type' => 'CLIPTextEncode(positive)',
            ],
            '2' => [
                'inputs' => ['text' => 'low quality, artifacts, blurry, watermark'],
                'class_type' => 'CLIPTextEncode(negative)',
            ],
            '3' => [
                'inputs' => [
                    'seed' => $descriptor['seed'] ?? 0,
                    'steps' => $descriptor['steps'] ?? 30,
                    'cfg' => $descriptor['guidance'] ?? 8.5,
                    'sampler_name' => 'euler',
                    'scheduler' => 'normal',
                    'denoise' => 1.0,
                ],
                'class_type' => 'KSampler',
            ],
            '4' => [
                'inputs' => [
                    'samples' => ['3', 0],
                    'vae' => ['5', 0],
                ],
                'class_type' => 'VAEDecode',
            ],
            '5' => [
                'inputs' => ['ckpt_name' => 'model.safetensors'],
                'class_type' => 'CheckpointLoaderSimple',
            ],
            '6' => [
                'inputs' => [
                    'filename_prefix' => 'galaxyquest_' . ($descriptor['type'] ?? 'texture'),
                    'images' => ['4', 0],
                ],
                'class_type' => 'SaveImage',
            ],
        ];
    }
}
