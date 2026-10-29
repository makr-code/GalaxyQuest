<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/../api/tts_client.php';

$content = json_decode(file_get_contents(__DIR__ . '/../config/onboarding_prologue.json'), true, 512, JSON_THROW_ON_ERROR);
$clips = $content['teaser'];
foreach ($content['factions'] as $faction) $clips[] = ['id' => $faction['code'], 'text' => $faction['text']];
foreach ($clips as $clip) {
    $result = tts_synthesise($clip['text'], ['lang' => $content['language']]);
    if (!($result['ok'] ?? false)) {
        fwrite(STDERR, $clip['id'] . ': ' . ($result['error'] ?? 'Narration synthesis failed.') . PHP_EOL);
        exit(1);
    }
    fwrite(STDOUT, $clip['id'] . ': ' . $result['audio_url'] . PHP_EOL);
}
