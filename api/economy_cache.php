<?php

declare(strict_types=1);

require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/projection.php';

function invalidate_economy_views(PDO $db, int $uid, ?int $colonyId = null): void
{
    gq_cache_delete('game_overview', ['uid' => $uid]);
    $colonies = $db->prepare('SELECT id FROM colonies WHERE user_id = ? AND (? IS NULL OR id = ?)');
    $colonies->execute([$uid, $colonyId, $colonyId]);
    foreach ($colonies->fetchAll(PDO::FETCH_COLUMN) as $cid) {
        gq_cache_delete('game_resources', ['uid' => $uid, 'cid' => (int)$cid]);
        gq_cache_delete('buildings_list', ['uid' => $uid, 'cid' => (int)$cid]);
    }
    if (defined('PROJECTION_OVERVIEW_ENABLED') && PROJECTION_OVERVIEW_ENABLED) {
        mark_projection_stale($db, $uid);
        enqueue_dirty_user($db, $uid, 'economy_updated');
    }
}
