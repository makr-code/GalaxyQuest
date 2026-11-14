<?php

declare(strict_types=1);

/**
 * Writes ended wars and visible galactic events into the WordPress history book (chronology).
 * Idempotent: stable slugs (chronik-krieg-<id>, chronik-ereignis-<id>); existing posts are skipped.
 *
 *   docker compose exec -T web php scripts/sync_galaxy_chronicle.php [--dry-run] [--status=publish] [--limit=50]
 *
 * Needs BLOG_WORDPRESS_USER / BLOG_WORDPRESS_APP_PASSWORD, category "galaxiegeschichte", tag "game-start".
 * Run on demand/cron; not a game tick.
 */

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../lib/GalaxyChronicle.php';
require_once __DIR__ . '/../lib/WordPressNewsPublisher.php';

function chronicle_fail(string $message): never
{
    fwrite(STDERR, $message . "\n");
    exit(1);
}

$opts = getopt('', ['status:', 'limit:', 'dry-run']);
$status = (string)($opts['status'] ?? GALAXY_NEWS_PUBLISH_STATUS);
$limit = (int)($opts['limit'] ?? 50);
$dryRun = isset($opts['dry-run']);
if (!in_array($status, ['draft', 'publish'], true)) {
    chronicle_fail('--status muss draft oder publish sein.');
}

try {
    $entries = GalaxyChronicle::entries(get_db(), $limit);
    if ($dryRun) {
        foreach ($entries as $entry) {
            echo "{$entry['slug']} [{$entry['date']}] {$entry['summary']}\n";
        }
        echo count($entries) . " Einträge.\n";
        exit(0);
    }
    $publisher = new WordPressNewsPublisher(BLOG_WORDPRESS_REST_URL, BLOG_WORDPRESS_USER, BLOG_WORDPRESS_APP_PASSWORD);
    $category = $publisher->termId('category', 'galaxiegeschichte');
    $tag = $publisher->termId('tag', 'game-start');
    $created = 0;
    foreach ($entries as $entry) {
        if ($publisher->existingPostId($entry['slug']) !== null) {
            continue;
        }
        $publisher->createChronicleEntry($entry['slug'], $entry['title'], $entry['summary'], $entry['date'], $status, $category, $tag);
        $created++;
    }
    echo "$created neue Chronikeinträge ($status).\n";
} catch (InvalidArgumentException | RuntimeException $error) {
    chronicle_fail('Chronik-Sync fehlgeschlagen: ' . $error->getMessage());
}
