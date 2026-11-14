<?php
declare(strict_types=1);

require_once __DIR__ . '/character_profile_generator.php';
require_once __DIR__ . '/../lib/RegistrationPortraitService.php';

function registration_comfyui_prompt_id(string $attempt): string {
    if (!preg_match('/^[a-f0-9]{32}$/D', $attempt)) {
        throw new InvalidArgumentException('Invalid portrait attempt identifier.');
    }
    return substr($attempt, 0, 8) . '-' . substr($attempt, 8, 4) . '-' . substr($attempt, 12, 4)
        . '-' . substr($attempt, 16, 4) . '-' . substr($attempt, 20, 12);
}

function registration_portrait_workflow(array $snapshot, string $attempt): array {
    $design = character_profile_load_species_designs_from_files($snapshot['species_code']);
    if ($design === null) throw new RuntimeException('Selected species design is not available.', 503);
    $profile = [
        'username' => $snapshot['character']['name'], 'race' => $design['display_name'],
        'profession' => 'colony commander', 'stance' => 'resolute', 'is_npc' => false,
    ];
    $prompt = character_profile_build_prompt_with_designs($design, $profile)
        . ', ' . $design['portrait_prompt_base'] . ', ' . $design['silhouette_desc'];

    return [
        '1' => ['class_type' => 'CheckpointLoaderSimple', 'inputs' => ['ckpt_name' => COMFYUI_PORTRAIT_MODEL]],
        '2' => ['class_type' => 'CLIPTextEncode', 'inputs' => ['text' => $prompt, 'clip' => ['1', 1]]],
        '3' => ['class_type' => 'CLIPTextEncode', 'inputs' => [
            'text' => 'text, watermark, logo, lowres, blurry, duplicate face, extra limbs, cropped',
            'clip' => ['1', 1],
        ]],
        '4' => ['class_type' => 'EmptyLatentImage', 'inputs' => ['width' => 768, 'height' => 1024, 'batch_size' => 1]],
        '5' => ['class_type' => 'KSampler', 'inputs' => [
            'seed' => (int) hexdec(substr($attempt, 0, 13)), 'steps' => 30, 'cfg' => 7.5,
            'sampler_name' => 'euler', 'scheduler' => 'normal', 'denoise' => 1.0,
            'model' => ['1', 0], 'positive' => ['2', 0], 'negative' => ['3', 0], 'latent_image' => ['4', 0],
        ]],
        '6' => ['class_type' => 'VAEDecode', 'inputs' => ['samples' => ['5', 0], 'vae' => ['1', 2]]],
        '7' => ['class_type' => 'PreviewImage', 'inputs' => ['images' => ['6', 0]]],
    ];
}

function registration_comfyui_request(string $method, string $path, ?array $payload = null, int $maxBytes = 1048576): string {
    $parts = parse_url((string) COMFYUI_BASE_URL);
    $host = strtolower((string) ($parts['host'] ?? ''));
    if ((int) COMFYUI_PORTRAIT_ENABLED !== 1
        || !is_array($parts)
        || !in_array($parts['scheme'] ?? '', ['http', 'https'], true)
        || $host === ''
        || isset($parts['user']) || isset($parts['pass'])
        || isset($parts['query']) || isset($parts['fragment'])
        || ((int) COMFYUI_LOCAL_ONLY === 1
            && !in_array($host, ['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal', 'comfyui'], true))) {
        throw new RuntimeException('Local ComfyUI portrait generation is disabled or misconfigured.', 503);
    }
    if (!function_exists('curl_init')) throw new RuntimeException('The portrait HTTP client is unavailable.', 503);

    $body = null;
    if ($payload !== null) {
        try {
            $body = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } catch (JsonException $error) {
            throw new RuntimeException('Cannot encode the portrait request.', 503, $error);
        }
    }
    $curl = curl_init((string) COMFYUI_BASE_URL . $path);
    if ($curl === false) throw new RuntimeException('The portrait HTTP client could not start.', 503);
    $response = '';
    $tooLarge = false;
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => ['Accept: application/json, image/png', 'Content-Type: application/json'],
        CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$response, &$tooLarge, $maxBytes): int {
            if (strlen($response) + strlen($chunk) > $maxBytes) {
                $tooLarge = true;
                return 0;
            }
            $response .= $chunk;
            return strlen($chunk);
        },
    ]);
    if ($body !== null) curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
    $ok = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error = curl_error($curl);
    curl_close($curl);
    if ($tooLarge) throw new LengthException('Portrait service response exceeds the supported size.');
    if ($ok === false || $status < 200 || $status >= 300) {
        error_log('registration_comfyui_request_failed status=' . $status . ' error=' . $error);
        throw new RuntimeException(
            $status === 400
                ? 'ComfyUI rejected the portrait workflow. Check the configured model.'
                : 'The local ComfyUI portrait service is unavailable. Please retry later.',
            503
        );
    }
    return $response;
}

function registration_comfyui_json(string $method, string $path, ?array $payload = null): array {
    try {
        $data = json_decode(registration_comfyui_request($method, $path, $payload), true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException $error) {
        throw new RuntimeException('ComfyUI returned an invalid response.', 503, $error);
    }
    if (!is_array($data)) throw new RuntimeException('ComfyUI returned an invalid response.', 503);
    return $data;
}

function registration_queue_portrait(array $snapshot, string $attempt): void {
    $promptId = registration_comfyui_prompt_id($attempt);
    $result = registration_comfyui_json('POST', '/prompt', [
        'prompt_id' => $promptId,
        'client_id' => $promptId,
        'prompt' => registration_portrait_workflow($snapshot, $attempt),
    ]);
    if (!is_string($result['prompt_id'] ?? null) || !hash_equals($promptId, $result['prompt_id'])
        || !empty($result['node_errors'])) {
        throw new RuntimeException('ComfyUI did not accept the portrait request.', 503);
    }
}

function registration_poll_portrait(string $attempt, int $age): array {
    $promptId = registration_comfyui_prompt_id($attempt);
    $path = '/history/' . rawurlencode($promptId);
    $history = registration_comfyui_json('GET', $path);
    if (!isset($history[$promptId])) {
        $queue = registration_comfyui_json('GET', '/queue');
        foreach (['queue_running', 'queue_pending'] as $name) {
            if (!is_array($queue[$name] ?? null)) throw new RuntimeException('ComfyUI returned an invalid queue.', 503);
            foreach ($queue[$name] as $entry) {
                if (is_array($entry) && ($entry[1] ?? null) === $promptId) return ['status' => 'pending'];
            }
        }
        if ($age < 30) return ['status' => 'pending'];
        $history = registration_comfyui_json('GET', $path);
        if (!isset($history[$promptId])) {
            return ['status' => 'failed', 'error' => 'The portrait request is no longer in the ComfyUI queue. Please retry.'];
        }
    }

    $job = $history[$promptId];
    if (!is_array($job) || !is_array($job['status'] ?? null)) {
        throw new RuntimeException('ComfyUI returned an invalid portrait status.', 503);
    }
    if (($job['status']['status_str'] ?? '') === 'error') {
        return ['status' => 'failed', 'error' => 'ComfyUI could not generate the portrait. Please retry.'];
    }
    $image = $job['outputs']['7']['images'][0] ?? null;
    if ($image === null && ($job['status']['completed'] ?? false) !== true) return ['status' => 'pending'];
    if (!is_array($image) || !is_string($image['filename'] ?? null)
        || !preg_match('/^[A-Za-z0-9_.-]+\.png$/Di', $image['filename'])
        || ($image['subfolder'] ?? '') !== '' || ($image['type'] ?? '') !== 'temp') {
        return ['status' => 'failed', 'error' => 'ComfyUI completed without a valid portrait image.'];
    }
    $query = http_build_query([
        'filename' => $image['filename'], 'subfolder' => '', 'type' => 'temp',
    ], '', '&', PHP_QUERY_RFC3986);
    return [
        'status' => 'generated',
        'image' => registration_comfyui_request('GET', '/view?' . $query, null, RegistrationPortraitService::MAX_BYTES + 1),
    ];
}
