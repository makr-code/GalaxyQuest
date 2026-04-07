<?php
/**
 * Shared TTS client for the GalaxyQuest TTS microservice.
 *
 * Intended usage:
 *   require_once __DIR__ . '/tts_client.php';
 *   $result = tts_synthesise('Willkommen, Kommandant!');
 *   if ($result['ok']) {
 *       // $result['audio_url'] is the web-accessible path to the cached MP3
 *   }
 */
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/cache.php';

// ── Directory for cached audio files (web-accessible) ────────────────────────
// Files are stored in generated/tts/ so they can be served directly by
// Apache / nginx.  The directory must be listed in .htaccess / vhost config.
define('TTS_AUDIO_DIR', __DIR__ . '/../generated/tts');
define('TTS_AUDIO_WEB', 'generated/tts');

function tts_is_enabled(): bool
{
    return (int) TTS_ENABLED === 1;
}

/**
 * Synthesise text to speech and return a web-accessible audio URL.
 *
 * The result is cached permanently (TTL = TTS_CACHE_TTL) on the filesystem
 * under generated/tts/<hash>.mp3.  Identical (text + voice) pairs never hit the
 * microservice twice.
 *
 * @param  string $text    The text to synthesise.
 * @param  array  $options {
 *     voice?     string   Voice name (default: TTS_DEFAULT_VOICE)
 *     lang?      string   Language for XTTS engine (default: 'de')
 *     no_cache?  bool     Bypass PHP-level cache (default: false)
 * }
 * @return array{ok:bool, audio_url?:string, error?:string, status?:int}
 */
function tts_synthesise(string $text, array $options = []): array
{
    if (!tts_is_enabled()) {
        return ['ok' => false, 'status' => 503, 'error' => 'TTS is disabled.'];
    }

    $text = trim($text);
    if ($text === '') {
        return ['ok' => false, 'status' => 400, 'error' => 'text must not be empty.'];
    }
    if (mb_strlen($text) > (int) TTS_MAX_CHARS) {
        return [
            'ok'     => false,
            'status' => 400,
            'error'  => 'Text too long (max ' . TTS_MAX_CHARS . ' chars).',
        ];
    }

    $voice    = trim((string) ($options['voice'] ?? TTS_DEFAULT_VOICE));
    if ($voice === '') {
        $voice = (string) TTS_DEFAULT_VOICE;
    }
    $lang     = trim((string) ($options['lang'] ?? 'de'));
    $noCache  = (bool) ($options['no_cache'] ?? false);

    // ── PHP-level filesystem cache ────────────────────────────────────────────
    $cacheKey = hash('sha256', $voice . '|' . $text);
    $cacheFile = rtrim(TTS_AUDIO_DIR, '/\\') . DIRECTORY_SEPARATOR . $cacheKey . '.mp3';
    $webUrl    = TTS_AUDIO_WEB . '/' . $cacheKey . '.mp3';

    if (!$noCache && is_file($cacheFile)) {
        $stat = @stat($cacheFile);
        $mtime = $stat ? (int) $stat['mtime'] : 0;
        $ttl   = (int) TTS_CACHE_TTL;
        $valid = ($ttl === 0) || (time() - $mtime < $ttl);
        if ($valid) {
            return ['ok' => true, 'audio_url' => $webUrl, 'cached' => true];
        }
        @unlink($cacheFile);
    }

    // ── Call TTS microservice ─────────────────────────────────────────────────
    $result = tts_request('/synthesize', [
        'text'     => $text,
        'voice'    => $voice,
        'lang'     => $lang,
        'no_cache' => false,
    ], $options);

    if (!$result['ok']) {
        return $result;
    }

    // ── Persist MP3 to filesystem cache ───────────────────────────────────────
    _tts_ensure_audio_dir();
    $tmp = $cacheFile . '.tmp.' . getmypid();
    if (file_put_contents($tmp, $result['bytes'], LOCK_EX) === false) {
        @unlink($tmp);
        return ['ok' => false, 'status' => 500, 'error' => 'Failed to write TTS audio cache.'];
    }
    if (!rename($tmp, $cacheFile)) {
        @unlink($tmp);
        return ['ok' => false, 'status' => 500, 'error' => 'Failed to rename TTS audio cache file.'];
    }

    return ['ok' => true, 'audio_url' => $webUrl, 'cached' => false];
}

/**
 * Check that the TTS microservice is reachable.
 *
 * @return array{ok:bool, engine?:string, default_voice?:string, error?:string}
 */
function tts_health(): array
{
    $result = tts_request('/health', null, [], 'GET');
    if (!$result['ok']) {
        return $result;
    }
    $data = $result['data'] ?? [];
    return [
        'ok'            => true,
        'engine'        => (string) ($data['engine'] ?? ''),
        'default_voice' => (string) ($data['default_voice'] ?? ''),
    ];
}

/**
 * List voices available in the microservice.
 *
 * @return array{ok:bool, voices?:list<array>, error?:string}
 */
function tts_list_voices(): array
{
    $result = tts_request('/voices', null, [], 'GET');
    if (!$result['ok']) {
        return $result;
    }
    $data = $result['data'] ?? [];
    return [
        'ok'     => true,
        'engine' => (string) ($data['engine'] ?? ''),
        'voices' => (array) ($data['voices'] ?? []),
    ];
}

// ── Internal HTTP helper ──────────────────────────────────────────────────────

/**
 * @internal
 * @return array{ok:bool, bytes?:string, data?:array, status?:int, error?:string}
 */
function tts_request(
    string $path,
    ?array $payload,
    array $options = [],
    string $method  = 'POST'
): array {
    if (!tts_is_enabled()) {
        return ['ok' => false, 'status' => 503, 'error' => 'TTS is disabled.'];
    }

    $timeout = max(3, (int) ($options['timeout'] ?? TTS_TIMEOUT_SECONDS));
    $url     = rtrim((string) TTS_SERVICE_URL, '/') . $path;

    $headers = ['Content-Type: application/json', 'Accept: */*'];
    $secret  = (string) TTS_SECRET;
    if ($secret !== '') {
        $headers[] = 'X-TTS-Key: ' . $secret;
    }

    $body = null;
    if ($payload !== null) {
        $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE);
        if ($encoded === false) {
            return ['ok' => false, 'status' => 400, 'error' => 'Failed to encode TTS request payload.'];
        }
        $body = $encoded;
    }

    if (function_exists('curl_init')) {
        return _tts_curl($url, $method, $headers, $body, $timeout);
    }

    return _tts_stream($url, $method, $headers, $body, $timeout);
}

/** @internal */
function _tts_curl(
    string $url,
    string $method,
    array  $headers,
    ?string $body,
    int    $timeout
): array {
    $ch = curl_init($url);
    if ($ch === false) {
        return ['ok' => false, 'status' => 500, 'error' => 'Failed to initialise cURL for TTS request.'];
    }

    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, min(8, $timeout));
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }

    $raw     = curl_exec($ch);
    $status  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $ctype   = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($raw === false) {
        return ['ok' => false, 'status' => 502, 'error' => 'TTS request failed: ' . ($curlErr ?: 'unknown cURL error')];
    }

    return _tts_decode($raw, $status, $ctype);
}

/** @internal */
function _tts_stream(
    string $url,
    string $method,
    array  $headers,
    ?string $body,
    int    $timeout
): array {
    $ctx = stream_context_create([
        'http' => [
            'method'        => strtoupper($method),
            'timeout'       => $timeout,
            'header'        => implode("\r\n", $headers) . "\r\n",
            'content'       => $body ?? '',
            'ignore_errors' => true,
        ],
    ]);

    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        $err = error_get_last();
        return ['ok' => false, 'status' => 502, 'error' => 'TTS request failed: ' . (string) ($err['message'] ?? 'stream error')];
    }

    $status = 200;
    $ctype  = '';
    if (isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $line) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})\b/i', $line, $m)) {
                $status = (int) $m[1];
            }
            if (preg_match('/^Content-Type:\s*(.+)$/i', $line, $m)) {
                $ctype = strtolower(trim($m[1]));
            }
        }
    }

    return _tts_decode($raw, $status, $ctype);
}

/** @internal */
function _tts_decode(string $raw, int $status, string $ctype): array
{
    // Audio response – return raw bytes
    if (str_contains($ctype, 'audio/') || str_contains($ctype, 'octet-stream')) {
        if ($status >= 200 && $status < 300) {
            return ['ok' => true, 'status' => $status, 'bytes' => $raw];
        }
    }

    // JSON error / info response
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return ['ok' => false, 'status' => $status, 'error' => trim($raw) ?: ('TTS service responded with HTTP ' . $status)];
    }

    if ($status < 200 || $status >= 300) {
        $msg = (string) ($decoded['detail'] ?? $decoded['error'] ?? ('TTS service HTTP ' . $status));
        return ['ok' => false, 'status' => $status, 'error' => $msg, 'data' => $decoded];
    }

    return ['ok' => true, 'status' => $status, 'data' => $decoded];
}

/** @internal */
function _tts_ensure_audio_dir(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $dir = rtrim(TTS_AUDIO_DIR, '/\\');
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        error_log('[GQ TTS] Konnte Audio-Cache-Verzeichnis nicht anlegen: ' . $dir);
    }
    $done = true;
}
