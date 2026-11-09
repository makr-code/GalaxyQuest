<?php

declare(strict_types=1);

use GalaxyQuest\Combat\LiveBattleJournalRead;

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/../src/Combat/LiveBattleJournalRead.php';
require_once __DIR__ . '/../src/Combat/LiveBattleRules.php';
require_once __DIR__ . '/../src/Combat/LiveBattleJournal.php';
require_once __DIR__ . '/../src/Combat/LiveBattleLossProjection.php';
require_once __DIR__ . '/../src/Combat/LiveBattleLossProjectionReader.php';

session_cache_limiter('');
header('Cache-Control: private, no-store');
header('Pragma: no-cache');
only_method('GET');
$userId = require_auth();
if (LIVE_BATTLE_JOURNAL_READ_ENABLED !== 1) {
    json_error('Live battle journal reads are not enabled.', 404);
}

$action = $_GET['action'] ?? null;
if (!is_string($action) || !in_array($action, ['snapshot', 'ticks', 'loss_projection'], true)) {
    json_error('Invalid journal read action.', 400);
}
$allowed = $action === 'ticks'
    ? ['action', 'journal_id', 'after_tick', 'limit'] : ['action', 'journal_id'];
if (array_diff(array_keys($_GET), $allowed) !== []) {
    json_error('Unexpected journal read parameter.', 400);
}

$parseInt = static function (mixed $value, int $min, int $max): ?int {
    if (!is_string($value) || preg_match('/\A(?:0|[1-9][0-9]*)\z/D', $value) !== 1) {
        return null;
    }
    $number = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => $min, 'max_range' => $max]]);
    return $number === false ? null : $number;
};
$journalId = $parseInt($_GET['journal_id'] ?? null, 1, PHP_INT_MAX);
if ($journalId === null) {
    json_error('Invalid journal_id.', 400);
}

$afterTick = null;
$limit = null;
if ($action === 'ticks') {
    $afterTick = $parseInt($_GET['after_tick'] ?? null, 0, PHP_INT_MAX);
    $limit = $parseInt($_GET['limit'] ?? '50', 1, LiveBattleJournalRead::MAX_PAGE_SIZE);
    if ($afterTick === null || $limit === null) {
        json_error('Invalid tick cursor or page limit.', 400);
    }
}

try {
    $reader = new LiveBattleJournalRead(get_db());
    if ($action === 'snapshot') {
        json_ok(['snapshot' => $reader->snapshot($userId, $journalId)]);
    }
    if ($action === 'loss_projection') {
        json_ok(['projection' => $reader->lossProjection($userId, $journalId)]);
    }
    json_ok(['page' => $reader->ticks($userId, $journalId, $afterTick, $limit)]);
} catch (DomainException $error) {
    json_error($error->getMessage(), $error->getCode());
}
