<?php
/**
 * ComfyUI Mock API Server for Testing
 * Simulates ComfyUI endpoints for local testing without full deployment
 * 
 * Run: php -S 0.0.0.0:8188 docker/comfyui-mock-server.php
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Health check / System stats (multiple endpoints)
if (($path === '/system_stats' || $path === '/system/status' || $path === '/system/info') && $method === 'GET') {
    echo json_encode([
        'system' => [
            'os' => 'Linux',
            'python_version' => '3.10.12',
            'comfyui_version' => '0.2.4 (mock)',
            'pytorch_version' => '2.0.1+cu118',
            'version' => '0.2.4'
        ],
        'devices' => [
            [
                'name' => 'cuda:0 (NVIDIA GeForce RTX 3090)',
                'type' => 'cuda',
                'index' => 0
            ]
        ],
        'status' => 'ok'
    ]);
    exit;
}

// Model list endpoint
if (($path === '/models' || $path === '/api/checkpoints' || $path === '/api/loras' || $path === '/api/vae') && $method === 'GET') {
    $response = [];
    
    if ($path === '/api/checkpoints' || $path === '/models') {
        $response = [
            'dreamshaper_8-pruned.safetensors',
            'deliberate_v3.safetensors',
            'DreamShaperXL_Lightning.safetensors',
            'Juggernaut-XL_v9_RunDiffusionPhoto.safetensors'
        ];
    } elseif ($path === '/api/loras') {
        $response = [
            'GoodHands-beta2.safetensors',
            'add_details.safetensors',
            'TrolleyArtStyle.safetensors'
        ];
    } elseif ($path === '/api/vae') {
        $response = [
            'vae-ft-mse-840000-ema-pruned.safetensors',
            'blessed2.vae.pt',
            'xl.vae.safetensors'
        ];
    }
    
    echo json_encode($response);
    exit;
}

// Workflow validation endpoint
if ($path === '/workflow/validate' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (empty($input)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Empty workflow']);
        exit;
    }
    
    // Basic validation - check for required nodes
    $workflow = $input['workflow'] ?? [];
    $isValid = !empty($workflow) && is_array($workflow);
    
    if (!$isValid) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Invalid workflow structure']);
        exit;
    }
    
    echo json_encode(['ok' => true, 'valid' => true, 'message' => 'Workflow is valid']);
    exit;
}

// Queue management endpoints
if ($path === '/queue' && $method === 'GET') {
    echo json_encode([
        'queue_pending' => [
            [1, ['sample_workflow', ['ckpt_name' => 'model.safetensors']]],
            [2, ['another_workflow', []]]
        ],
        'queue_running' => []
    ]);
    exit;
}

// Execute workflow / Generate image
if ($path === '/prompt' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (empty($input)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'No workflow provided']);
        exit;
    }
    
    // Generate mock execution ID
    $promptId = bin2hex(random_bytes(8));
    $number = rand(1, 1000);
    
    echo json_encode([
        'prompt_id' => $promptId,
        'number' => $number,
        'ok' => true
    ]);
    exit;
}

// History / Results endpoint
if (($path === '/history' || $path === '/workflow/history') && $method === 'GET') {
    $limit = $_GET['limit'] ?? 10;
    
    $history = [];
    for ($i = 0; $i < min($limit, 5); $i++) {
        $history[] = [
            'prompt_id' => bin2hex(random_bytes(8)),
            'number' => $i + 1,
            'outputs' => [
                'images' => [
                    ['filename' => "ComfyUI_' . $i . '_generated.png", 'subfolder' => '', 'type' => 'output']
                ]
            ],
            'status' => ['status_str' => 'success']
        ];
    }
    
    echo json_encode($history);
    exit;
}

// Image retrieval endpoint
if (preg_match('/^\/view\/(.+)$/', $path, $matches)) {
    $filename = $matches[1];
    
    // Generate a 1x1 PNG for testing (8 bytes: PNG signature + IHDR + IEND)
    $png = base64_decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    );
    
    header('Content-Type: image/png');
    header('Content-Length: ' . strlen($png));
    echo $png;
    exit;
}

// Default 404
http_response_code(404);
echo json_encode(['ok' => false, 'error' => 'Endpoint not found: ' . $path]);

