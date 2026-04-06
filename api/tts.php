<?php
/**
 * TTS (Text-to-Speech) API endpoint.
 *
 * GET  /api/tts.php?action=status          – service status + enabled flag
 * GET  /api/tts.php?action=voices          – list available voices
 * POST /api/tts.php?action=synthesise      – synthesise text, return audio URL
 *
 * POST body for 'synthesise':
 * {
 *   "text":     string   required – text to speak (max TTS_MAX_CHARS chars)
 *   "voice":    string   optional – voice name (default: TTS_DEFAULT_VOICE)
 *   "lang":     string   optional – language code for XTTS engine (default: "de")
 *   "no_cache": bool     optional – bypass PHP cache and re-render (default: false)
 * }
 *
 * Success response for 'synthesise':
 * {
 *   "ok":        true,
 *   "audio_url": "cache/tts/<hash>.mp3",   // web-accessible path
 *   "cached":    bool
 * }
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/tts_client.php';

$action = strtolower((string) ($_GET['action'] ?? 'status'));
$uid    = require_auth();

switch ($action) {
    case 'status':
        only_method('GET');
        if (!tts_is_enabled()) {
            json_ok([
                'enabled'       => false,
                'service_url'   => '',
                'default_voice' => '',
                'reachable'     => false,
            ]);
        }
        $health = tts_health();
        json_ok([
            'enabled'       => tts_is_enabled(),
            'service_url'   => (string) TTS_SERVICE_URL,
            'default_voice' => (string) TTS_DEFAULT_VOICE,
            'reachable'     => (bool) ($health['ok'] ?? false),
            'engine'        => (string) ($health['engine'] ?? ''),
        ]);
        break;

    case 'voices':
        only_method('GET');
        if (!tts_is_enabled()) {
            json_error('TTS is disabled.', 503);
        }
        $result = tts_list_voices();
        if (!($result['ok'] ?? false)) {
            json_error((string) ($result['error'] ?? 'Failed to retrieve voice list.'), (int) ($result['status'] ?? 502));
        }
        json_ok([
            'engine' => (string) ($result['engine'] ?? ''),
            'voices' => (array) ($result['voices'] ?? []),
        ]);
        break;

    case 'synthesise':
    case 'synthesize':
        only_method('POST');
        verify_csrf();

        if (!tts_is_enabled()) {
            json_error('TTS is disabled.', 503);
        }

        $body = get_json_body();

        $text = trim((string) ($body['text'] ?? ''));
        if ($text === '') {
            json_error('text is required.');
        }

        $result = tts_synthesise($text, [
            'voice'    => $body['voice'] ?? null,
            'lang'     => $body['lang'] ?? 'de',
            'no_cache' => (bool) ($body['no_cache'] ?? false),
        ]);

        if (!($result['ok'] ?? false)) {
            json_error(
                (string) ($result['error'] ?? 'TTS synthesis failed.'),
                (int) ($result['status'] ?? 502)
            );
        }

        json_ok([
            'audio_url' => (string) ($result['audio_url'] ?? ''),
            'cached'    => (bool) ($result['cached'] ?? false),
        ]);
        break;

    default:
        json_error('Unknown action.');
}
