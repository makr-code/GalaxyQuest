<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/tts_client.php';

only_method('GET', 'POST');
$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST') {
    verify_csrf();
    $body = get_json_body();
    $id = $body['clip'] ?? '';
} else {
    $id = $_GET['clip'] ?? '';
}
if (!is_string($id)) json_error('Invalid narration clip.');
$content = json_decode(file_get_contents(__DIR__ . '/../config/onboarding_prologue.json'), true, 512, JSON_THROW_ON_ERROR);
$narration = json_decode(file_get_contents(__DIR__ . '/../config/onboarding_narration.json'), true, 512, JSON_THROW_ON_ERROR);
$clips = array_merge($content['teaser'], $content['registration_steps'] ?? []);
foreach ($content['factions'] as $faction) $clips[] = ['id' => $faction['code'], 'text' => $faction['text']];
$clip = null;
$voice = (string) TTS_DEFAULT_VOICE;
$language = (string) ($content['language'] ?? 'de');
$prosody = ['length_scale' => 0.97, 'sentence_silence' => 0.22];
foreach ($clips as $candidate) {
    if ($candidate['id'] === $id) $clip = $candidate;
}
if ($clip === null && isset($narration['clips'][$id]) && is_array($narration['clips'][$id])) {
    $requestedVoice = $method === 'POST' ? ($body['voice'] ?? TTS_DEFAULT_VOICE) : ($_GET['voice'] ?? TTS_DEFAULT_VOICE);
    if (!is_string($requestedVoice) || !isset($narration['voices'][$requestedVoice])) {
        json_error('Unsupported narration voice.', 400);
    }
    $voice = $requestedVoice;
    $language = (string) $narration['voices'][$voice];
    $text = $narration['clips'][$id][$language] ?? null;
    if (!is_string($text) || trim($text) === '') json_error('Narration clip is unavailable.', 404);
    $clip = ['id' => $id, 'text' => $text];
    $prosody = ['length_scale' => 1.02, 'sentence_silence' => 0.35];
}
if ($clip === null && preg_match('/^mentor-([a-z0-9_]{2,30})$/D', $id, $matches) === 1) {
    $mentorCode = $matches[1];
    if (!in_array($mentorCode, get_playable_faction_codes(), true)) json_error('Unknown narration clip.', 404);
    session_start_secure();
    $sessionOwner = $_SESSION['registration_owner'] ?? null;
    if (!is_string($sessionOwner) || $sessionOwner === '') json_error('Mentor draft not found.', 404);
    $statement = get_db()->prepare(
        'SELECT snapshot_json FROM registration_drafts
         WHERE session_hash = ? AND mentor_code = ? AND expires_at > UTC_TIMESTAMP() LIMIT 1'
    );
    $statement->execute([hash('sha256', $sessionOwner), $mentorCode]);
    $rawSnapshot = $statement->fetchColumn();
    if (!is_string($rawSnapshot)) json_error('Mentor draft not found.', 404);
    $snapshot = json_decode($rawSnapshot, true, 512, JSON_THROW_ON_ERROR);
    $species = json_decode(
        file_get_contents(__DIR__ . '/../fractions/' . $mentorCode . '/spec.json'), true, 512, JSON_THROW_ON_ERROR
    );
    $planet = null;
    foreach (($snapshot['planets'] ?? []) as $candidate) {
        if ((int)($candidate['position'] ?? 0) === (int)($snapshot['position']['position'] ?? 0)) {
            $planet = $candidate;
            break;
        }
    }
    $clip = [
        'id' => $id,
        'text' => 'Ich bin der Herold der ' . $species['display_name'] . '. ' . $species['species_type']
            . "\n\nMein System heißt " . $snapshot['system_name'] . '. Die mögliche Heimatwelt ist '
            . (string)($planet['name'] ?? $snapshot['colony_name']) . '.',
    ];
}
if ($clip === null) json_error('Unknown narration clip.', 404);
if (session_status() === PHP_SESSION_ACTIVE && !session_write_close()) {
    error_log('registration_narration_session_close_failed');
    json_error('Narration session could not be released.', 503);
}
$hash = tts_cache_key($voice, trim($clip['text']), $prosody);
$path = TTS_AUDIO_DIR . DIRECTORY_SEPARATOR . $hash . '.mp3';
$cached = false;
if (is_file($path) && filesize($path) > 0) {
    $mtime = filemtime($path);
    $ttl = (int)TTS_CACHE_TTL;
    $cached = $mtime !== false && ($ttl === 0 || time() - $mtime < $ttl);
}
$generated = false;
if (!$cached && $method === 'GET') {
    json_error('Narration audio is not cached or has expired.', 404);
}
if (!$cached) {
    $result = tts_synthesise($clip['text'], [
        'voice' => $voice,
        'lang' => $language,
        'prosody' => $prosody,
        'timeout' => max(210, (int)TTS_TIMEOUT_SECONDS),
    ]);
    if (!($result['ok'] ?? false)) {
        error_log('registration_narration_synthesis_failed clip=' . $id
            . ' status=' . (int)($result['status'] ?? 502)
            . ' error=' . (string)($result['error'] ?? 'unknown'));
        json_error('Narration audio is currently unavailable.', 503);
    }
    if (!is_file($path) || filesize($path) === 0) {
        error_log('registration_narration_cache_missing clip=' . $id . ' hash=' . $hash);
        json_error('Narration audio is currently unavailable.', 503);
    }
    $generated = true;
}
header('Cache-Control: no-store');
json_ok([
    'clip' => $id,
    'text' => $clip['text'],
    'voice' => $voice,
    'language' => $language,
    'audio_url' => TTS_AUDIO_WEB . '/' . $hash . '.mp3',
    'cached' => !$generated,
]);
