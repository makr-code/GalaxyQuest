<?php

declare(strict_types=1);

/**
 * Galaxy News "Sondernachrichten": only for very rare events (big wars, market crashes).
 * Run on demand/cron; never part of a game tick.
 *
 *   docker compose exec -T web php scripts/generate_galaxy_special.php [--dry-run] [--status=publish]
 *
 * At most one special per type and UTC day (slug galaxy-special-<type>-YYYY-MM-DD).
 * Thresholds: GALAXY_SPECIAL_WAR_MIN_PLAYERS, GALAXY_SPECIAL_CRASH_MIN_GOODS, GALAXY_SPECIAL_CRASH_PRICE_MULT.
 * Needs the WordPress tags "game-start" and "hero" and category "galaxy-news-radio".
 */

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/ollama_client.php';
require_once __DIR__ . '/../api/tts_client.php';
require_once __DIR__ . '/../lib/GalaxyNewsWriter.php';
require_once __DIR__ . '/../lib/GalaxySpecialDetector.php';
require_once __DIR__ . '/../lib/WordPressNewsPublisher.php';

function special_fail(string $message): never
{
    fwrite(STDERR, $message . "\n");
    exit(1);
}

$opts = getopt('', ['status:', 'model:', 'dry-run']);
$status = (string)($opts['status'] ?? GALAXY_NEWS_PUBLISH_STATUS);
$model = trim((string)($opts['model'] ?? GALAXY_NEWS_MODEL));
$dryRun = isset($opts['dry-run']);
if (!in_array($status, ['draft', 'publish'], true)) {
    special_fail('--status muss draft oder publish sein.');
}
$date = gmdate('Y-m-d');

try {
    $specials = GalaxySpecialDetector::detect(get_db(), [
        'war_min_players' => GALAXY_SPECIAL_WAR_MIN_PLAYERS,
        'crash_min_goods' => GALAXY_SPECIAL_CRASH_MIN_GOODS,
        'crash_price_mult' => GALAXY_SPECIAL_CRASH_PRICE_MULT,
    ]);
    if ($specials === []) {
        echo "Keine außergewöhnliche Lage; kein Special.\n";
        exit(0);
    }
    $publisher = $dryRun ? null
        : new WordPressNewsPublisher(BLOG_WORDPRESS_REST_URL, BLOG_WORDPRESS_USER, BLOG_WORDPRESS_APP_PASSWORD);
    foreach ($specials as $special) {
        $slug = "galaxy-special-{$special['type']}-$date";
        if ($publisher !== null && $publisher->existingPostId($slug) !== null) {
            echo "Beitrag $slug existiert bereits; übersprungen.\n";
            continue;
        }
        $answer = ollama_chat(GalaxySpecialDetector::messages($special, $date), [
            'model' => $model, 'format' => 'json', 'temperature' => 0.3, 'timeout' => 240,
        ]);
        if (!$answer['ok']) {
            special_fail('LLM-Anfrage fehlgeschlagen: ' . ($answer['error'] ?? 'unbekannt'));
        }
        $lines = GalaxyNewsWriter::parseLines($answer['text'], (int)TTS_MAX_CHARS, 3);
        $script = GalaxyNewsWriter::script($lines, GalaxyNewsWriter::SPECIAL_INTRO);
        if ($publisher === null) {
            echo "[{$special['type']}] $script\n";
            continue;
        }
        $speech = tts_synthesise($script, ['lang' => 'de', 'timeout' => 180]);
        if (!$speech['ok'] || !preg_match('#^generated/tts/([a-f0-9]{64}\.mp3)$#D', (string)($speech['audio_url'] ?? ''), $match)) {
            special_fail('Vertonung fehlgeschlagen: ' . ($speech['error'] ?? 'ungültige Audiodatei'));
        }
        $bytes = file_get_contents(rtrim(TTS_AUDIO_DIR, '/\\') . DIRECTORY_SEPARATOR . $match[1]);
        if (!is_string($bytes) || $bytes === '') {
            special_fail('Audiodatei konnte nicht gelesen werden.');
        }
        $audio = $publisher->uploadAudio($bytes, $slug . '.mp3');
        $post = $publisher->createPost(
            $slug,
            $special['title'],
            $lines,
            $script,
            $audio,
            $status,
            $publisher->termId('category', 'galaxy-news-radio'),
            $publisher->termId('tag', 'game-start'),
            [$publisher->termId('tag', 'hero')]
        );
        echo "Special {$post['id']} ({$post['status']}): {$post['link']}\n";
    }
} catch (InvalidArgumentException | UnexpectedValueException | RuntimeException $error) {
    special_fail('Special-Erzeugung fehlgeschlagen: ' . $error->getMessage());
}
