<?php

declare(strict_types=1);

/**
 * Daily Galaxy News Radio job: public notices of a day -> Ollama news lines -> TTS MP3 -> WordPress post.
 *
 * Usage (needs BLOG_WORDPRESS_USER / BLOG_WORDPRESS_APP_PASSWORD):
 *   docker compose exec -T web php scripts/generate_galaxy_news.php
 *   docker compose exec -T web php scripts/generate_galaxy_news.php --date=2026-11-14 --status=publish
 *   docker compose exec -T web php scripts/generate_galaxy_news.php --dry-run
 *
 * One post per day (slug galaxy-news-YYYY-MM-DD); an existing post is never overwritten.
 * Default status is "draft" so LLM text can be reviewed before it reaches the radio.
 */

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/ollama_client.php';
require_once __DIR__ . '/../api/tts_client.php';
require_once __DIR__ . '/../lib/GalaxyNewsWriter.php';
require_once __DIR__ . '/../lib/WordPressNewsPublisher.php';

function news_fail(string $message): never
{
    fwrite(STDERR, $message . "\n");
    exit(1);
}

$opts = getopt('', ['date:', 'status:', 'model:', 'dry-run']);
$date = (string)($opts['date'] ?? gmdate('Y-m-d'));
$status = (string)($opts['status'] ?? GALAXY_NEWS_PUBLISH_STATUS);
$model = trim((string)($opts['model'] ?? GALAXY_NEWS_MODEL));
$dryRun = isset($opts['dry-run']);
if (!GalaxyNewsWriter::validDate($date)) {
    news_fail('Ungültiges --date (YYYY-MM-DD).');
}
if (!in_array($status, ['draft', 'publish'], true)) {
    news_fail('--status muss draft oder publish sein.');
}
$slug = 'galaxy-news-' . $date;

try {
    $publisher = null;
    if (!$dryRun) {
        $publisher = new WordPressNewsPublisher(BLOG_WORDPRESS_REST_URL, BLOG_WORDPRESS_USER, BLOG_WORDPRESS_APP_PASSWORD);
        if ($publisher->existingPostId($slug) !== null) {
            echo "Beitrag $slug existiert bereits; nichts zu tun.\n";
            exit(0);
        }
    }
    $items = GalaxyNewsWriter::itemsForDay(get_db(), $date);
    if ($items === []) {
        echo "Keine Mitteilungen für $date; kein Beitrag erstellt.\n";
        exit(0);
    }
    $answer = ollama_chat(GalaxyNewsWriter::messages($items, $date), [
        'model' => $model, 'format' => 'json', 'temperature' => 0.4, 'timeout' => 240,
    ]);
    if (!$answer['ok']) {
        news_fail('LLM-Anfrage fehlgeschlagen: ' . ($answer['error'] ?? 'unbekannt'));
    }
    $lines = GalaxyNewsWriter::parseLines($answer['text'], (int)TTS_MAX_CHARS);
    $script = GalaxyNewsWriter::script($lines);
    if ($dryRun) {
        echo $script . "\n";
        exit(0);
    }
    $speech = tts_synthesise($script, ['lang' => 'de', 'timeout' => 180]);
    if (!$speech['ok'] || !preg_match('#^generated/tts/([a-f0-9]{64}\.mp3)$#D', (string)($speech['audio_url'] ?? ''), $match)) {
        news_fail('Vertonung fehlgeschlagen: ' . ($speech['error'] ?? 'ungültige Audiodatei'));
    }
    $bytes = file_get_contents(rtrim(TTS_AUDIO_DIR, '/\\') . DIRECTORY_SEPARATOR . $match[1]);
    if (!is_string($bytes) || $bytes === '') {
        news_fail('Audiodatei konnte nicht gelesen werden.');
    }
    $audio = $publisher->uploadAudio($bytes, $slug . '.mp3');
    $post = $publisher->createPost(
        $slug,
        'Galaxy News Radio – ' . $date,
        $lines,
        $script,
        $audio,
        $status,
        $publisher->termId('category', 'galaxy-news-radio'),
        $publisher->termId('tag', 'game-start')
    );
    echo "Beitrag {$post['id']} ({$post['status']}): {$post['link']}\n";
} catch (InvalidArgumentException | UnexpectedValueException | RuntimeException $error) {
    news_fail('Galaxy-News-Erzeugung fehlgeschlagen: ' . $error->getMessage());
}
