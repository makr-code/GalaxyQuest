#!/usr/bin/env php
<?php

declare(strict_types=1);

use GalaxyQuest\Combat\LiveBattleJournalWorker;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../src/Combat/LiveBattleRules.php';
require_once __DIR__ . '/../src/Combat/LiveBattleJournal.php';
require_once __DIR__ . '/../src/Combat/LiveBattleJournalWorker.php';

if (LIVE_BATTLE_JOURNAL_WORKER_ENABLED !== 1) {
    fwrite(STDERR, "Experimental live battle journal worker is disabled.\n");
    exit(1);
}
$match = [];
if (count($argv) > 2 || (count($argv) === 2 && !preg_match('/\A--limit=([1-9][0-9]{0,2})\z/D', $argv[1], $match))) {
    fwrite(STDERR, "Usage: php scripts/process_live_battle_journals.php [--limit=1..100]\n");
    exit(1);
}
$limit = count($argv) === 2 ? (int)$match[1] : 20;
if ($limit > LiveBattleJournalWorker::MAX_BATCH) {
    fwrite(STDERR, "Batch limit must be between 1 and 100.\n");
    exit(1);
}
try {
    $result = (new LiveBattleJournalWorker(get_db()))->runBatch($limit);
    fwrite(STDOUT, json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . PHP_EOL);
} catch (Throwable $error) {
    fwrite(STDERR, 'Live battle journal worker error: ' . $error->getMessage() . PHP_EOL);
    if ($error->getPrevious() !== null) {
        fwrite(STDERR, 'Cause: ' . $error->getPrevious()->getMessage() . PHP_EOL);
    }
    exit(1);
}
