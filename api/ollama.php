<?php
/**
 * Local LLM gateway (Ollama).
 *
 * GET  /api/ollama.php?action=status
 * POST /api/ollama.php?action=chat      body: {messages[]|prompt, model?, temperature?, options?}
 * POST /api/ollama.php?action=generate  body: {prompt, model?, temperature?, options?}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/ollama_client.php';

$action = strtolower((string) ($_GET['action'] ?? 'status'));
$uid = require_auth();

switch ($action) {
    case 'status':
        only_method('GET');
        $models = ollama_list_models(['timeout' => 10]);
        json_ok([
            'enabled' => ollama_is_enabled(),
            'local_only' => (int) OLLAMA_LOCAL_ONLY === 1,
            'base_url' => (string) OLLAMA_BASE_URL,
            'default_model' => (string) OLLAMA_DEFAULT_MODEL,
            'reachable' => (bool) ($models['ok'] ?? false),
            'models' => (array) ($models['models'] ?? []),
            'user_id' => $uid,
        ]);
        break;

    case 'chat':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();

        $messages = normalize_messages($body);
        if (!$messages) {
            json_error('messages or prompt is required.');
        }

        $result = ollama_chat($messages, [
            'model' => $body['model'] ?? null,
            'temperature' => $body['temperature'] ?? null,
            'options' => is_array($body['options'] ?? null) ? $body['options'] : null,
            'timeout' => isset($body['timeout']) ? (int) $body['timeout'] : null,
        ]);

        if (!($result['ok'] ?? false)) {
            json_error((string) ($result['error'] ?? 'Ollama chat failed.'), (int) ($result['status'] ?? 502));
        }

        json_ok([
            'model' => (string) ($result['model'] ?? OLLAMA_DEFAULT_MODEL),
            'text' => (string) ($result['text'] ?? ''),
            'raw' => $result['raw'] ?? [],
        ]);
        break;

    case 'generate':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();

        $prompt = trim((string) ($body['prompt'] ?? ''));
        if ($prompt === '') {
            json_error('prompt is required.');
        }

        $result = ollama_generate($prompt, [
            'model' => $body['model'] ?? null,
            'temperature' => $body['temperature'] ?? null,
            'options' => is_array($body['options'] ?? null) ? $body['options'] : null,
            'timeout' => isset($body['timeout']) ? (int) $body['timeout'] : null,
        ]);

        if (!($result['ok'] ?? false)) {
            json_error((string) ($result['error'] ?? 'Ollama generation failed.'), (int) ($result['status'] ?? 502));
        }

        json_ok([
            'model' => (string) ($result['model'] ?? OLLAMA_DEFAULT_MODEL),
            'text' => (string) ($result['text'] ?? ''),
            'raw' => $result['raw'] ?? [],
        ]);
        break;

    default:
        json_error('Unknown action');
}

function normalize_messages(array $body): array {
    if (isset($body['messages']) && is_array($body['messages'])) {
        $out = [];
        foreach ($body['messages'] as $msg) {
            if (!is_array($msg)) {
                continue;
            }
            $role = strtolower(trim((string) ($msg['role'] ?? 'user')));
            if (!in_array($role, ['system', 'user', 'assistant'], true)) {
                $role = 'user';
            }
            $content = trim((string) ($msg['content'] ?? ''));
            if ($content === '') {
                continue;
            }
            $out[] = [
                'role' => $role,
                'content' => $content,
            ];
        }
        if ($out) {
            return $out;
        }
    }

    $prompt = trim((string) ($body['prompt'] ?? ''));
    if ($prompt === '') {
        return [];
    }

    $system = trim((string) ($body['system'] ?? ''));
    $messages = [];
    if ($system !== '') {
        $messages[] = ['role' => 'system', 'content' => $system];
    }
    $messages[] = ['role' => 'user', 'content' => $prompt];
    return $messages;
}
