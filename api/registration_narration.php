<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/tts_client.php';

only_method('GET');
$id = $_GET['clip'] ?? '';
if (!is_string($id)) json_error('Invalid narration clip.');
$content = json_decode(file_get_contents(__DIR__ . '/../config/onboarding_prologue.json'), true, 512, JSON_THROW_ON_ERROR);
$clips = array_merge($content['teaser'], $content['registration_steps'] ?? []);
foreach ($content['factions'] as $faction) $clips[] = ['id' => $faction['code'], 'text' => $faction['text']];
$clip = null;
foreach ($clips as $candidate) {
    if ($candidate['id'] === $id) $clip = $candidate;
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
$result = tts_synthesise($clip['text'], [
    'voice' => TTS_DEFAULT_VOICE,
    'lang' => $content['language'] ?? 'de',
    'prosody' => [
        'length_scale' => 0.97,
        'sentence_silence' => 0.22,
    ],
    'timeout' => max(210, (int)TTS_TIMEOUT_SECONDS),
]);
if (!($result['ok'] ?? false)) {
    error_log('registration_narration_synthesis_failed clip=' . $id
        . ' status=' . (int)($result['status'] ?? 502)
        . ' error=' . (string)($result['error'] ?? 'unknown'));
    json_error('Narration audio is currently unavailable.', 503);
}
$hash = tts_cache_key(TTS_DEFAULT_VOICE, trim($clip['text']), [
    'length_scale' => 0.97,
    'sentence_silence' => 0.22,
]);
$path = TTS_AUDIO_DIR . DIRECTORY_SEPARATOR . $hash . '.mp3';
if (!is_file($path) || filesize($path) === 0) {
    error_log('registration_narration_cache_missing clip=' . $id . ' hash=' . $hash);
    json_error('Narration audio is currently unavailable.', 503);
}
header('Cache-Control: no-store');
json_ok([
    'clip' => $id,
    'text' => $clip['text'],
    'audio_url' => TTS_AUDIO_WEB . '/' . $hash . '.mp3',
    'cached' => (bool)($result['cached'] ?? false),
]);
