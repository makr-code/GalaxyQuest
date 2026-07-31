<?php
declare(strict_types=1);

/**
 * GalaxyQuest Admin - AI Texture Management
 * Admin panel for regenerating textures, testing prompts, and batch operations
 */

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');

// Load environment configuration
require_once dirname(__DIR__) . '/config/config.php';

// TODO: Add admin authentication check here
// if (!isUserAdmin($_SESSION['user_id'])) { http_response_code(403); exit; }

$action = strtolower((string)($_GET['action'] ?? 'list'));
$allowedActions = ['list', 'regenerate', 'test_prompt', 'batch_regenerate', 'clear_cache', 'cache_stats'];

if (!in_array($action, $allowedActions, true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'invalid action']);
    exit;
}

$textureAdmin = new GQTextureAdminService();

switch ($action) {
    case 'list':
        handle_list_textures($textureAdmin);
        break;
    case 'regenerate':
        handle_regenerate_texture($textureAdmin);
        break;
    case 'test_prompt':
        handle_test_prompt($textureAdmin);
        break;
    case 'batch_regenerate':
        handle_batch_regenerate($textureAdmin);
        break;
    case 'clear_cache':
        handle_clear_cache($textureAdmin);
        break;
    case 'cache_stats':
        handle_cache_stats($textureAdmin);
        break;
}

exit;

/**
 * List cached textures
 */
function handle_list_textures(GQTextureAdminService $admin): void
{
    $filter = sanitize_input((string)($_GET['filter'] ?? 'all'));
    
    try {
        $textures = $admin->getCachedTextures($filter);
        http_response_code(200);
        echo json_encode(['success' => true, 'textures' => $textures]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Regenerate specific texture
 */
function handle_regenerate_texture(GQTextureAdminService $admin): void
{
    $cacheKey = sanitize_input((string)($_GET['cache_key'] ?? ''));
    $force = (int)($_GET['force'] ?? 0) === 1;

    if (!$cacheKey) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'cache_key required']);
        exit;
    }

    try {
        $result = $admin->regenerateTexture($cacheKey, $force);
        http_response_code($result['success'] ? 200 : 500);
        echo json_encode($result);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Test custom prompt
 */
function handle_test_prompt(GQTextureAdminService $admin): void
{
    $prompt = (string)($_POST['prompt'] ?? '');
    $negativePrompt = (string)($_POST['negative_prompt'] ?? '');
    $size = (int)($_POST['size'] ?? 512);
    $steps = (int)($_POST['steps'] ?? 30);

    if (!$prompt) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'prompt required']);
        exit;
    }

    try {
        $result = $admin->testPrompt($prompt, $negativePrompt, $size, $steps);
        http_response_code($result['success'] ? 200 : 500);
        echo json_encode($result);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Batch regenerate textures by faction or type
 */
function handle_batch_regenerate(GQTextureAdminService $admin): void
{
    $faction = sanitize_input((string)($_GET['faction'] ?? ''));
    $textureType = sanitize_input((string)($_GET['texture_type'] ?? ''));
    $dry_run = (int)($_GET['dry_run'] ?? 0) === 1;

    try {
        $result = $admin->batchRegenerate($faction, $textureType, $dry_run);
        http_response_code($result['success'] ? 200 : 500);
        echo json_encode($result);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Clear texture cache
 */
function handle_clear_cache(GQTextureAdminService $admin): void
{
    $pattern = sanitize_input((string)($_GET['pattern'] ?? ''));
    $confirm = sanitize_input((string)($_GET['confirm'] ?? ''));

    if ($confirm !== 'yes_clear_all') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'confirmation required']);
        exit;
    }

    try {
        $result = $admin->clearCache($pattern);
        http_response_code($result['success'] ? 200 : 500);
        echo json_encode($result);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Get cache statistics
 */
function handle_cache_stats(GQTextureAdminService $admin): void
{
    try {
        $stats = $admin->getCacheStats();
        http_response_code(200);
        echo json_encode(['success' => true, 'stats' => $stats]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Sanitize input string
 */
function sanitize_input(string $input): string
{
    return preg_replace('/[^a-z0-9_-]/i', '', substr($input, 0, 64)) ?: 'default';
}

/**
 * Admin Service for Texture Management
 */
class GQTextureAdminService
{
    private string $cacheDir;
    private string $comfyuiBaseUrl;

    public function __construct()
    {
        $projectRoot = dirname(dirname(__FILE__));
        $this->cacheDir = $projectRoot . DIRECTORY_SEPARATOR . 'generated' . DIRECTORY_SEPARATOR . 'ai_textures';
        $this->comfyuiBaseUrl = getenv('COMFYUI_BASE_URL') ?: 'http://localhost:8188';
    }

    /**
     * Get all cached textures with metadata
     */
    public function getCachedTextures(string $filter = 'all'): array
    {
        $textures = [];
        
        if (!is_dir($this->cacheDir)) {
            return [];
        }

        $files = @glob($this->cacheDir . DIRECTORY_SEPARATOR . '*.png') ?: [];
        
        foreach ($files as $file) {
            $basename = basename($file);
            $cacheKey = substr($basename, 0, -4); // Remove .png

            $stat = @stat($file);
            if ($stat === false) continue;

            $texture = [
                'cache_key' => $cacheKey,
                'filename' => $basename,
                'size_bytes' => $stat['size'] ?? 0,
                'created' => $stat['mtime'] ?? 0,
                'path' => 'generated/ai_textures/' . $basename,
            ];

            // Estimate type from cache (simplified)
            if (strpos($cacheKey, 'spaceship') !== false) $texture['type'] = 'spaceship';
            elseif (strpos($cacheKey, 'planet') !== false) $texture['type'] = 'planet';
            elseif (strpos($cacheKey, 'atmosphere') !== false) $texture['type'] = 'atmosphere';
            else $texture['type'] = 'unknown';

            $textures[] = $texture;
        }

        // Sort by creation time (newest first)
        usort($textures, fn($a, $b) => $b['created'] <=> $a['created']);

        return $textures;
    }

    /**
     * Regenerate specific texture by cache key
     */
    public function regenerateTexture(string $cacheKey, bool $force = false): array
    {
        $cachePath = $this->cacheDir . DIRECTORY_SEPARATOR . $cacheKey . '.png';

        // Delete existing if force=true
        if ($force && is_file($cachePath)) {
            @unlink($cachePath);
        }

        // Try to regenerate via API
        // This is a simplified implementation - production would retry generation
        return [
            'success' => true,
            'message' => 'Regeneration queued',
            'cache_key' => $cacheKey,
            'url' => 'api/textures-ai.php?action=spaceship_texture&size=512&seed=' . rand(0, 1000000),
        ];
    }

    /**
     * Test custom prompt
     */
    public function testPrompt(string $prompt, string $negativePrompt, int $size, int $steps): array
    {
        // Build ComfyUI request
        $workflow = [
            '1' => [
                'inputs' => ['text' => $prompt],
                'class_type' => 'CLIPTextEncode(positive)',
            ],
            '2' => [
                'inputs' => ['text' => $negativePrompt ?: 'low quality, artifacts'],
                'class_type' => 'CLIPTextEncode(negative)',
            ],
            '3' => [
                'inputs' => [
                    'seed' => rand(0, 1000000),
                    'steps' => max(1, min(50, $steps)),
                    'cfg' => 8.5,
                    'sampler_name' => 'dpmpp_2m',
                    'scheduler' => 'exponential',
                    'denoise' => 1.0,
                ],
                'class_type' => 'KSampler',
            ],
            '4' => [
                'inputs' => ['samples' => ['3', 0], 'vae' => ['5', 0]],
                'class_type' => 'VAEDecode',
            ],
            '5' => [
                'inputs' => ['ckpt_name' => 'model.safetensors'],
                'class_type' => 'CheckpointLoaderSimple',
            ],
            '6' => [
                'inputs' => [
                    'filename_prefix' => 'admin_test_' . time(),
                    'images' => ['4', 0],
                ],
                'class_type' => 'SaveImage',
            ],
        ];

        $json = json_encode($workflow, JSON_UNESCAPED_SLASHES);

        // Send to ComfyUI
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => 'Content-Type: application/json',
                'content' => $json,
                'timeout' => 10,
            ],
        ]);

        $response = @file_get_contents($this->comfyuiBaseUrl . '/prompt', false, $context);
        
        if ($response === false) {
            return ['success' => false, 'error' => 'ComfyUI service unavailable'];
        }

        $data = json_decode($response, true);
        
        return [
            'success' => !empty($data['prompt_id']),
            'prompt_id' => $data['prompt_id'] ?? null,
            'message' => 'Test prompt submitted to queue',
            'monitor_url' => $this->comfyuiBaseUrl . '/queue',
        ];
    }

    /**
     * Batch regenerate textures
     */
    public function batchRegenerate(string $faction = '', string $textureType = '', bool $dryRun = false): array
    {
        $textures = $this->getCachedTextures();
        
        // Filter by faction/type
        $filtered = array_filter($textures, function($t) use ($faction, $textureType) {
            if ($faction && strpos($t['filename'], $faction) === false) return false;
            if ($textureType && strpos($t['filename'], $textureType) === false) return false;
            return true;
        });

        if ($dryRun) {
            return [
                'success' => true,
                'dry_run' => true,
                'count' => count($filtered),
                'would_regenerate' => $filtered,
            ];
        }

        // Delete matched textures to force regeneration
        $deleted = 0;
        foreach ($filtered as $texture) {
            $path = dirname($this->cacheDir) . DIRECTORY_SEPARATOR . $texture['path'];
            if (@unlink($path)) {
                $deleted++;
            }
        }

        return [
            'success' => true,
            'deleted' => $deleted,
            'message' => "Queued $deleted textures for regeneration",
        ];
    }

    /**
     * Clear cache matching pattern
     */
    public function clearCache(string $pattern = ''): array
    {
        if (!is_dir($this->cacheDir)) {
            return ['success' => true, 'deleted' => 0, 'message' => 'Cache directory not found'];
        }

        $files = @glob($this->cacheDir . DIRECTORY_SEPARATOR . '*.png') ?: [];
        $deleted = 0;

        foreach ($files as $file) {
            if ($pattern && strpos(basename($file), $pattern) === false) {
                continue;
            }
            if (@unlink($file)) {
                $deleted++;
            }
        }

        // Also clean up lock files
        $lockDir = $this->cacheDir . DIRECTORY_SEPARATOR . 'locks';
        if (is_dir($lockDir)) {
            $lockFiles = @glob($lockDir . DIRECTORY_SEPARATOR . '*.lock') ?: [];
            foreach ($lockFiles as $lockFile) {
                @unlink($lockFile);
            }
        }

        return [
            'success' => true,
            'deleted' => $deleted,
            'message' => "Deleted $deleted cache files",
        ];
    }

    /**
     * Get cache statistics
     */
    public function getCacheStats(): array
    {
        $textures = $this->getCachedTextures();
        $totalSize = 0;
        $typeStats = [];

        foreach ($textures as $texture) {
            $totalSize += $texture['size_bytes'];
            $type = $texture['type'];
            if (!isset($typeStats[$type])) {
                $typeStats[$type] = ['count' => 0, 'size' => 0];
            }
            $typeStats[$type]['count']++;
            $typeStats[$type]['size'] += $texture['size_bytes'];
        }

        return [
            'total_textures' => count($textures),
            'total_size_mb' => round($totalSize / 1024 / 1024, 2),
            'by_type' => $typeStats,
            'oldest_texture' => $textures[count($textures) - 1]['created'] ?? null,
            'newest_texture' => $textures[0]['created'] ?? null,
        ];
    }
}
