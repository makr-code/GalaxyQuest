<?php
/**
 * Shared SwarmUI client for local Stable Diffusion image generation.
 *
 * Intended usage:
 *   require_once __DIR__ . '/swarmui_client.php';
 *   $result = swarmui_generate($prompt, ['width' => 720, 'height' => 1024]);
 *   if ($result['ok']) {
 *       swarmui_download_image($result['image_path'], '/path/to/save.png');
 *   }
 *
 * API flow:
 *   1. POST /API/GetNewSession  → session_id
 *   2. POST /API/GenerateText2Image { session_id, prompt, model, ... } → image paths
 *   3. GET  /[image_path] → binary PNG
 */
require_once __DIR__ . '/../config/config.php';

// ── Session cache (per-process) ───────────────────────────────────────────────
$_swarmui_session_id = null;

function swarmui_is_enabled(): bool
{
    return (int) SWARMUI_ENABLED === 1;
}

/**
 * Get (or refresh) a SwarmUI session ID.
 * Sessions are cached for the lifetime of the PHP process.
 */
function swarmui_get_session(bool $force = false): string
{
    global $_swarmui_session_id;

    if (!$force && $_swarmui_session_id !== null) {
        return $_swarmui_session_id;
    }

    $resp = swarmui_http_request('/API/GetNewSession', [], 10);
    if ($resp['ok'] && isset($resp['data']['session_id'])) {
        $_swarmui_session_id = (string) $resp['data']['session_id'];
    } else {
        $_swarmui_session_id = '';
    }

    return $_swarmui_session_id;
}

/**
 * Generate one image via SwarmUI Text2Image.
 *
 * Options:
 *   model      string  – safetensors path (default: SWARMUI_DEFAULT_MODEL)
 *   turbo      bool    – use SWARMUI_TURBO_MODEL instead
 *   loras      array   – LoRA adapters to apply, e.g. ['vortak_lora:0.85', 'style_lora:0.5']
 *                        Each entry is "filename:weight" or just "filename" (weight defaults to 1.0)
 *   width      int     – image width  (default: 720)
 *   height     int     – image height (default: 1024)
 *   steps      int     – sampling steps (default: SWARMUI_DEFAULT_STEPS)
 *   cfgscale   float   – CFG scale (default: SWARMUI_DEFAULT_CFG)
 *   seed       int     – -1 for random (default: -1)
 *   negativeprompt  string  – negative prompt
 *   timeout    int     – override timeout in seconds
 *
 * Returns ['ok' => true, 'image_path' => '...', 'image_url' => '...']
 *      or ['ok' => false, 'error' => '...', 'status' => int]
 */
function swarmui_generate(string $prompt, array $options = []): array
{
    if (!swarmui_is_enabled()) {
        return ['ok' => false, 'status' => 503, 'error' => 'SwarmUI is disabled.'];
    }

    $session_id = swarmui_get_session();
    if ($session_id === '') {
        return ['ok' => false, 'status' => 503, 'error' => 'Could not obtain SwarmUI session.'];
    }

    $model = (bool) ($options['turbo'] ?? false)
        ? (string) SWARMUI_TURBO_MODEL
        : (string) ($options['model'] ?? SWARMUI_DEFAULT_MODEL);

    $payload = [
        'session_id'     => $session_id,
        'images'         => 1,
        'prompt'         => $prompt,
        'model'          => $model,
        'width'          => (int) ($options['width']    ?? 720),
        'height'         => (int) ($options['height']   ?? 1024),
        'steps'          => (int) ($options['steps']    ?? SWARMUI_DEFAULT_STEPS),
        'cfgscale'       => (float) ($options['cfgscale'] ?? SWARMUI_DEFAULT_CFG),
        'seed'           => (int) ($options['seed']     ?? -1),
    ];

    if (!empty($options['negativeprompt'])) {
        $payload['negativeprompt'] = (string) $options['negativeprompt'];
    }

    // LoRA adapters: each entry is "filename:weight" or just "filename"
    if (!empty($options['loras']) && is_array($options['loras'])) {
        $loraWeights = [];
        foreach ($options['loras'] as $lora) {
            $lora = (string) $lora;
            if ($lora === '') {
                continue;
            }
            $parts  = explode(':', $lora, 2);
            $name   = trim($parts[0]);
            $weight = isset($parts[1]) ? (float) $parts[1] : 1.0;
            if ($name !== '') {
                $loraWeights[] = ['model' => $name, 'weight' => $weight];
            }
        }
        if (!empty($loraWeights)) {
            $payload['loraweights'] = $loraWeights;
        }
    }

    $timeout = (int) ($options['timeout'] ?? SWARMUI_TIMEOUT_SECONDS);
    $resp    = swarmui_http_request('/API/GenerateText2Image', $payload, $timeout);

    if (!$resp['ok']) {
        return $resp;
    }

    $images = $resp['data']['images'] ?? [];
    if (empty($images) || !is_array($images)) {
        return ['ok' => false, 'status' => 500, 'error' => 'SwarmUI returned no images.', 'raw' => $resp['data']];
    }

    $path = (string) $images[0];
    $base = rtrim((string) SWARMUI_BASE_URL, '/');
    $url  = $base . '/' . ltrim(rawurlencode_path($path), '/');

    return [
        'ok'         => true,
        'image_path' => $path,
        'image_url'  => $url,
        'model'      => $model,
        'raw'        => $resp['data'],
    ];
}

/**
 * Download a generated image from SwarmUI and save it to $dest_path.
 *
 * @param  string $image_path  Relative path as returned by swarmui_generate() (e.g. "View/local/raw/...")
 * @param  string $dest_path   Absolute local filesystem path to save the PNG
 */
function swarmui_download_image(string $image_path, string $dest_path): array
{
    $base = rtrim((string) SWARMUI_BASE_URL, '/');
    $url  = $base . '/' . ltrim(rawurlencode_path($image_path), '/');

    $dir = dirname($dest_path);
    if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
        return ['ok' => false, 'error' => "Cannot create directory: $dir"];
    }

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $fh = fopen($dest_path, 'wb');

        if ($ch === false || $fh === false) {
            return ['ok' => false, 'error' => 'Failed to initialize download.'];
        }

        curl_setopt_array($ch, [
            CURLOPT_FILE           => $fh,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => 60,
            CURLOPT_FAILONERROR    => true,
        ]);

        $success = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err      = curl_error($ch);
        curl_close($ch);
        fclose($fh);

        if (!$success || $httpCode !== 200) {
            @unlink($dest_path);
            return ['ok' => false, 'status' => $httpCode, 'error' => $err ?: "HTTP $httpCode"];
        }
    } else {
        // fallback: file_get_contents
        $data = @file_get_contents($url);
        if ($data === false) {
            return ['ok' => false, 'error' => "Could not download: $url"];
        }
        if (file_put_contents($dest_path, $data) === false) {
            return ['ok' => false, 'error' => "Could not write: $dest_path"];
        }
    }

    return [
        'ok'        => true,
        'path'      => $dest_path,
        'bytes'     => filesize($dest_path),
    ];
}

/**
 * List available models in SwarmUI.
 * Returns ['ok' => true, 'models' => ['path' => ..., 'title' => ...], ...]
 */
function swarmui_list_models(): array
{
    if (!swarmui_is_enabled()) {
        return ['ok' => false, 'status' => 503, 'error' => 'SwarmUI is disabled.'];
    }

    $session_id = swarmui_get_session();
    if ($session_id === '') {
        return ['ok' => false, 'status' => 503, 'error' => 'Could not obtain SwarmUI session.'];
    }

    $resp = swarmui_http_request('/API/ListModels', ['session_id' => $session_id, 'path' => '', 'depth' => 2], 10);
    if (!$resp['ok']) {
        return $resp;
    }

    $files  = $resp['data']['files'] ?? [];
    $models = [];
    foreach ((array) $files as $f) {
        if (!is_array($f)) {
            continue;
        }
        $models[] = ['path' => (string) ($f['name'] ?? ''), 'title' => (string) ($f['title'] ?? '')];
    }

    return ['ok' => true, 'models' => $models, 'raw' => $resp['data']];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * URL-encode only path segments (keep slashes intact).
 */
function rawurlencode_path(string $path): string
{
    return implode('/', array_map('rawurlencode', explode('/', $path)));
}

/**
 * Low-level HTTP POST to SwarmUI API.
 */
function swarmui_http_request(string $path, array $payload, int $timeout = 30): array
{
    $url = rtrim((string) SWARMUI_BASE_URL, '/') . $path;

    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);
        // json_encode([]) produces "[]" (JSON array); SwarmUI always expects a JSON object.
        if ($body === '[]') {
            $body = '{}';
        }
    if ($body === false) {
        return ['ok' => false, 'status' => 400, 'error' => 'JSON encode failed.'];
    }

    $headers = ['Content-Type: application/json', 'Accept: application/json'];

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) {
            return ['ok' => false, 'status' => 500, 'error' => 'curl_init failed.'];
        }

        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);

        $raw      = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            return ['ok' => false, 'status' => 0, 'error' => "cURL error: $curlErr"];
        }
    } else {
        $context = stream_context_create([
            'http' => [
                'method'  => 'POST',
                'header'  => implode("\r\n", $headers),
                'content' => $body,
                'timeout' => $timeout,
            ],
        ]);
        $raw = @file_get_contents($url, false, $context);
        if ($raw === false) {
            return ['ok' => false, 'status' => 0, 'error' => "file_get_contents failed for $url"];
        }
        $httpCode = 200;
    }

    $data = json_decode((string) $raw, true);
    if (!is_array($data)) {
        return ['ok' => false, 'status' => $httpCode, 'error' => 'Invalid JSON response from SwarmUI.', 'raw_body' => $raw];
    }

    if (isset($data['error'])) {
        return ['ok' => false, 'status' => $httpCode, 'error' => (string) $data['error'], 'raw' => $data];
    }

    return ['ok' => true, 'status' => $httpCode, 'data' => $data];
}
