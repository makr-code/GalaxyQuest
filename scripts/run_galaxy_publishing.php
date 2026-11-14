<?php

declare(strict_types=1);

/**
 * Cron entry for all WordPress publishing jobs (daily news, specials, chronicle).
 * One failing job does not stop the others; exit code is 1 if any job failed.
 * Overlapping runs are prevented with a file lock.
 *
 *   # e.g. hourly: specials are rare, news/chronicle skip existing posts
 *   0 * * * * docker compose -f /path/docker-compose.yml exec -T web php scripts/run_galaxy_publishing.php
 */

$lock = fopen(sys_get_temp_dir() . '/galaxy_publishing.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    echo "Läuft bereits; übersprungen.\n";
    exit(0);
}

$jobs = ['generate_galaxy_special.php', 'generate_galaxy_news.php', 'sync_galaxy_chronicle.php'];
$failed = 0;
foreach ($jobs as $job) {
    echo "== $job\n";
    passthru(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/' . $job) . ' ' . implode(' ', array_map('escapeshellarg', array_slice($argv, 1))), $code);
    if ($code !== 0) {
        $failed++;
    }
}
flock($lock, LOCK_UN);
exit($failed > 0 ? 1 : 0);
