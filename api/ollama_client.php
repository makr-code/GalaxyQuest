<?php
/**
 * Shared Ollama client for local developer LLM usage.
 *
 * Intended usage:
 * - include this file in API handlers or backend modules
 * - call ollama_chat(...) for message-based completions
 * - call ollama_generate(...) for prompt-based completions
 */
require_once __DIR__ . '/../config/config.php';

function ollama_is_enabled(): bool {
    if ((int) OLLAMA_ENABLED !== 1) {
        return false;
    }
    return ollama_is_local_url((string) OLLAMA_BASE_URL);
}

function ollama_is_local_url(string $baseUrl): bool {
    if ((int) OLLAMA_LOCAL_ONLY !== 1) {
        return true;
    }

    $parts = parse_url($baseUrl);
    if (!is_array($parts)) {
        return false;
    }

    $host = strtolower((string) ($parts['host'] ?? ''));
    return in_array($host, ['127.0.0.1', 'localhost', '::1', 'host.docker.internal'], true);
}

function ollama_chat(array $messages, array $options = []): array {
    $model = trim((string) ($options['model'] ?? OLLAMA_DEFAULT_MODEL));
    if ($model === '') {
        $model = (string) OLLAMA_DEFAULT_MODEL;
    }

    $payload = [
        'model' => $model,
        'messages' => $messages,
        'stream' => false,
    ];

    if (array_key_exists('format', $options) && $options['format'] !== null) {
        $payload['format'] = $options['format'];
    }

    if (isset($options['temperature'])) {
        $payload['options'] = ['temperature' => (float) $options['temperature']];
    }
    if (isset($options['options']) && is_array($options['options'])) {
        $payload['options'] = array_merge($payload['options'] ?? [], $options['options']);
    }

    $response = ollama_request('/api/chat', $payload, $options);
    if (!$response['ok']) {
        return $response;
    }

    $data = $response['data'];
    $text = '';
    if (is_array($data) && isset($data['message']) && is_array($data['message'])) {
        $text = (string) ($data['message']['content'] ?? '');
    }

    return [
        'ok' => true,
        'model' => (string) ($data['model'] ?? $model),
        'text' => $text,
        'raw' => $data,
    ];
}

function ollama_generate(string $prompt, array $options = []): array {
    $model = trim((string) ($options['model'] ?? OLLAMA_DEFAULT_MODEL));
    if ($model === '') {
        $model = (string) OLLAMA_DEFAULT_MODEL;
    }

    $payload = [
        'model' => $model,
        'prompt' => $prompt,
        'stream' => false,
    ];

    if (isset($options['temperature'])) {
        $payload['options'] = ['temperature' => (float) $options['temperature']];
    }
    if (isset($options['options']) && is_array($options['options'])) {
        $payload['options'] = array_merge($payload['options'] ?? [], $options['options']);
    }

    $response = ollama_request('/api/generate', $payload, $options);
    if (!$response['ok']) {
        return $response;
    }

    $data = $response['data'];
    return [
        'ok' => true,
        'model' => (string) ($data['model'] ?? $model),
        'text' => (string) ($data['response'] ?? ''),
        'raw' => $data,
    ];
}

function ollama_list_models(array $options = []): array {
    $response = ollama_request('/api/tags', null, $options, 'GET');
    if (!$response['ok']) {
        return $response;
    }

    $data = $response['data'];
    $models = [];
    if (is_array($data) && isset($data['models']) && is_array($data['models'])) {
        foreach ($data['models'] as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $name = trim((string) ($entry['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $models[] = $name;
        }
    }

    return [
        'ok' => true,
        'models' => $models,
        'raw' => $data,
    ];
}

function ollama_request(string $path, ?array $payload = null, array $options = [], string $method = 'POST'): array {
    if (!ollama_is_enabled()) {
        return [
            'ok' => false,
            'status' => 503,
            'error' => 'Ollama is disabled or not configured for local access.',
        ];
    }

    $timeout = max(3, (int) ($options['timeout'] ?? OLLAMA_TIMEOUT_SECONDS));
    $url = (string) OLLAMA_BASE_URL . $path;

    $headers = [
        'Content-Type: application/json',
        'Accept: application/json',
    ];

    $body = null;
    if ($payload !== null) {
        $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE);
        if ($encoded === false) {
            return [
                'ok' => false,
                'status' => 400,
                'error' => 'Failed to encode Ollama request payload.',
            ];
        }
        $body = $encoded;
    }

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) {
            return [
                'ok' => false,
                'status' => 500,
                'error' => 'Failed to initialize cURL for Ollama request.',
            ];
        }

        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, min(8, $timeout));
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }

        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            return [
                'ok' => false,
                'status' => 502,
                'error' => 'Ollama request failed: ' . ($curlErr ?: 'unknown cURL error'),
            ];
        }

        return ollama_decode_response($raw, $status);
    }

    $streamHeaders = implode("\r\n", $headers) . "\r\n";
    $context = stream_context_create([
        'http' => [
            'method' => strtoupper($method),
            'timeout' => $timeout,
            'header' => $streamHeaders,
            'content' => $body ?? '',
            'ignore_errors' => true,
        ],
    ]);

    $raw = @file_get_contents($url, false, $context);
    if ($raw === false) {
        $err = error_get_last();
        return [
            'ok' => false,
            'status' => 502,
            'error' => 'Ollama request failed: ' . (string) ($err['message'] ?? 'stream error'),
        ];
    }

    $status = 200;
    if (isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $line) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})\b/i', $line, $m)) {
                $status = (int) $m[1];
                break;
            }
        }
    }

    return ollama_decode_response($raw, $status);
}

function ollama_decode_response(string $raw, int $status): array {
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        $trimmed = trim($raw);
        return [
            'ok' => false,
            'status' => $status,
            'error' => $trimmed !== '' ? $trimmed : 'Invalid JSON response from Ollama.',
        ];
    }

    if ($status < 200 || $status >= 300) {
        $message = (string) ($decoded['error'] ?? ('Ollama responded with HTTP ' . $status));
        return [
            'ok' => false,
            'status' => $status,
            'error' => $message,
            'data' => $decoded,
        ];
    }

    return [
        'ok' => true,
        'status' => $status,
        'data' => $decoded,
    ];
}
