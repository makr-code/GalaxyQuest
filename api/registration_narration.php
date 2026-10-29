<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/tts_client.php';

only_method('GET');
$id = $_GET['clip'] ?? '';
if (!is_string($id)) json_error('Invalid narration clip.');
$content = json_decode(file_get_contents(__DIR__ . '/../config/onboarding_prologue.json'), true, 512, JSON_THROW_ON_ERROR);
$clips = $content['teaser'];
foreach ($content['factions'] as $faction) $clips[] = ['id' => $faction['code'], 'text' => $faction['text']];
$clip = null;
foreach ($clips as $candidate) {
    if ($candidate['id'] === $id) $clip = $candidate;
}
if ($clip === null) json_error('Unknown narration clip.', 404);
$hash = hash('sha256', TTS_DEFAULT_VOICE . '|' . $clip['text']);
$path = TTS_AUDIO_DIR . DIRECTORY_SEPARATOR . $hash . '.mp3';
if (!is_file($path) || filesize($path) === 0) {
    json_error('Narration has not been prepared. Run scripts/render_onboarding_narration.php with the TTS service enabled.', 503);
}
header('Cache-Control: no-store');
json_ok(['clip' => $id, 'text' => $clip['text'], 'audio_url' => TTS_AUDIO_WEB . '/' . $hash . '.mp3']);
