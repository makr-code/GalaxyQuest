<?php
/**
 * Test endpoint for Ollama integration
 * GET /api/test_ollama.php?action=health
 * POST /api/test_ollama.php?action=test_chat (body: {prompt: "...", model?: "mistral"})
 * GET /api/test_ollama.php?action=models
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/ollama_client.php';

header('Content-Type: application/json');

$action = strtolower((string) ($_GET['action'] ?? 'health'));

try {
    switch ($action) {
        case 'health':
            // Check if Ollama is reachable
            $ch = curl_init((string) OLLAMA_BASE_URL . '/api/tags');
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
            curl_setopt($ch, CURLOPT_TIMEOUT, 5);
            $response = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($response === false || $status !== 200) {
                http_response_code(503);
                echo json_encode([
                    'ok' => false,
                    'status' => $status ?: 503,
                    'error' => 'Ollama service unreachable',
                    'base_url' => OLLAMA_BASE_URL,
                ]);
            } else {
                $data = json_decode($response, true);
                echo json_encode([
                    'ok' => true,
                    'base_url' => OLLAMA_BASE_URL,
                    'models' => $data['models'] ?? [],
                    'model_count' => count($data['models'] ?? []),
                ]);
            }
            break;

        case 'models':
            // List all models
            $result = ollama_list_models(['timeout' => 10]);
            http_response_code(($result['ok'] ?? false) ? 200 : 503);
            echo json_encode($result);
            break;

        case 'test_chat':
            // Test chat completion
            only_method('POST');

            $body = get_json_body();
            $prompt = trim((string) ($body['prompt'] ?? 'Who are you?'));
            if ($prompt === '') {
                json_error('prompt is required');
            }

            $model = trim((string) ($body['model'] ?? OLLAMA_DEFAULT_MODEL));
            if ($model === '') {
                $model = (string) OLLAMA_DEFAULT_MODEL;
            }

            $messages = [
                ['role' => 'user', 'content' => $prompt],
            ];

            $start = microtime(true);
            $result = ollama_chat($messages, ['model' => $model, 'timeout' => 30]);
            $latency_ms = (int) round((microtime(true) - $start) * 1000);

            $result['latency_ms'] = $latency_ms;
            $result['input_prompt'] = $prompt;
            $result['model'] = $model;

            http_response_code(($result['ok'] ?? false) ? 200 : 503);
            echo json_encode($result);
            break;

        default:
            http_response_code(400);
            echo json_encode(['error' => 'Unknown action: ' . $action]);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage(),
    ]);
}
