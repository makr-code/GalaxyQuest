<?php
/**
 * Admin statistics endpoint.
 *
 * GET /api/admin_stats.php
 *
 * Returns a live server-health snapshot for administrators:
 *   - User counts (total, NPC, active in last 15 min / 1 h)
 *   - Colony counts by type
 *   - Fleets in motion / returning
 *   - NPC tick lag (seconds since last global tick)
 *   - Active faction event summary
 *   - Slow-query threshold config
 *
 * Requires: authenticated admin session.
 */
require_once __DIR__ . '/helpers.php';

only_method('GET');
$uid = require_auth();
$db  = get_db();

if (!is_admin_user($db, $uid)) {
    json_error('Admin access required.', 403);
}

// ── Users ─────────────────────────────────────────────────────────────────────
$userCounts = $db->query(
    "SELECT
        COUNT(*)                                                      AS total,
        SUM(is_npc = 1)                                               AS npc,
        SUM(is_npc = 0)                                               AS human,
        SUM(is_npc = 0 AND last_login >= NOW() - INTERVAL 15 MINUTE) AS active_15m,
        SUM(is_npc = 0 AND last_login >= NOW() - INTERVAL 1 HOUR)    AS active_1h
     FROM users"
)->fetch(PDO::FETCH_ASSOC);

// ── Colonies ──────────────────────────────────────────────────────────────────
$colonyTotal = (int)$db->query('SELECT COUNT(*) FROM colonies')->fetchColumn();

$colonyByType = [];
$rows = $db->query(
    "SELECT colony_type, COUNT(*) AS cnt FROM colonies GROUP BY colony_type ORDER BY colony_type"
)->fetchAll(PDO::FETCH_ASSOC);
foreach ($rows as $row) {
    $colonyByType[$row['colony_type']] = (int)$row['cnt'];
}

// ── Fleets ────────────────────────────────────────────────────────────────────
$fleetRow = $db->query(
    "SELECT
        SUM(returning = 0 AND arrival_time > NOW()) AS in_motion,
        SUM(returning = 1 AND return_time  > NOW()) AS returning,
        SUM(arrival_time <= NOW() AND return_time IS NULL AND returning = 0) AS pending_resolve
     FROM fleets"
)->fetch(PDO::FETCH_ASSOC);

// ── NPC tick lag ──────────────────────────────────────────────────────────────
$now = time();

$npcPlayerTickLast = (int)($db->query(
    "SELECT state_value FROM app_state WHERE state_key = 'npc_player_tick:last_unix' LIMIT 1"
)->fetchColumn() ?: 0);

$factionEventActiveType = (int)($db->query(
    "SELECT state_value FROM app_state WHERE state_key = 'faction_event:active_type' LIMIT 1"
)->fetchColumn() ?: 0);

$factionEventEndsAt = (int)($db->query(
    "SELECT state_value FROM app_state WHERE state_key = 'faction_event:ends_at' LIMIT 1"
)->fetchColumn() ?: 0);

$factionEventActiveSince = (int)($db->query(
    "SELECT state_value FROM app_state WHERE state_key = 'faction_event:active_since' LIMIT 1"
)->fetchColumn() ?: 0);

// ── NPC user with the most overdue tick ───────────────────────────────────────
$oldestNpcTickRow = $db->query(
    "SELECT id, username, last_npc_tick
     FROM users
     WHERE is_npc = 1 AND last_npc_tick IS NOT NULL
     ORDER BY last_npc_tick ASC
     LIMIT 1"
)->fetch(PDO::FETCH_ASSOC);

$stalestNpcTickAgoS = $oldestNpcTickRow
    ? max(0, $now - strtotime($oldestNpcTickRow['last_npc_tick']))
    : null;

// ── Response ──────────────────────────────────────────────────────────────────
json_ok([
    'generated_at' => date('Y-m-d\TH:i:s\Z'),
    'users' => [
        'total'     => (int)$userCounts['total'],
        'human'     => (int)$userCounts['human'],
        'npc'       => (int)$userCounts['npc'],
        'active_15m' => (int)$userCounts['active_15m'],
        'active_1h'  => (int)$userCounts['active_1h'],
    ],
    'colonies' => [
        'total'   => $colonyTotal,
        'by_type' => $colonyByType,
    ],
    'fleets' => [
        'in_motion'       => (int)($fleetRow['in_motion'] ?? 0),
        'returning'       => (int)($fleetRow['returning'] ?? 0),
        'pending_resolve' => (int)($fleetRow['pending_resolve'] ?? 0),
    ],
    'npc_ticks' => [
        'global_player_tick_ago_s'  => $npcPlayerTickLast > 0 ? ($now - $npcPlayerTickLast) : null,
        'stalest_npc_tick_ago_s'    => $stalestNpcTickAgoS,
        'stalest_npc_id'            => $oldestNpcTickRow ? (int)$oldestNpcTickRow['id'] : null,
    ],
    'faction_event' => [
        'active_type'  => $factionEventActiveType > 0 ? $factionEventActiveType : null,
        'active_since' => $factionEventActiveSince > 0 ? $factionEventActiveSince : null,
        'ends_at'      => $factionEventEndsAt > 0 ? $factionEventEndsAt : null,
        'ends_in_s'    => $factionEventEndsAt > $now ? ($factionEventEndsAt - $now) : null,
    ],
    'config' => [
        'slow_query_threshold_ms' => SLOW_QUERY_THRESHOLD_MS,
        'login_max_attempts'      => LOGIN_MAX_ATTEMPTS,
        'login_lockout_seconds'   => LOGIN_LOCKOUT_SECONDS,
    ],
]);
