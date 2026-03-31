<?php
/**
 * Server-Sent Events endpoint
 *
 * GET /api/events.php
 *
 * Streams real-time events to the client:
 *   - ping            heartbeat every 20 s (keep-alive)
 *   - new_messages    unread message count changed
 *   - fleet_arrived   one of the user's outbound fleets just arrived
 *   - fleet_returning one of the user's return fleets just arrived home
 *   - incoming_attack a hostile fleet will arrive at a player colony within 5 min
 *
 * The connection is held open for up to MAX_RUNTIME seconds. The browser's
 * EventSource API reconnects automatically.
 *
 * Session handling: session is read once, then write-closed immediately so
 * other requests from the same user are not blocked by file locking.
 */
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/helpers.php';

// ─── Auth (read session, release lock immediately) ────────────────────────
$uid = current_user_id();
session_write_close(); // Release session file lock – critical for SSE

if ($uid === null) {
    http_response_code(401);
    echo "data: {\"error\":\"unauthenticated\"}\n\n";
    exit;
}

// ─── CLI dev-server guard ─────────────────────────────────────────────────
// `php -S` is single-threaded on Windows: a 90-second SSE connection blocks
// every other API request (galaxy binary fetch, overview, etc.).
// On cli-server we emit one quick snapshot and exit with retry:60000 so the
// browser reconnects every 60 s – effectively degrading to a long-poll without
// tying up the PHP worker.
if (php_sapi_name() === 'cli-server') {
    header('Content-Type: text/event-stream; charset=utf-8');
    header('Cache-Control: no-cache');
    header('X-Accel-Buffering: no');
    // Tell EventSource to wait 60 s before reconnecting.
    echo "retry: 60000\n";
    try {
        $cliDb = get_db();
        $cliSt = $cliDb->prepare(
            'SELECT COUNT(*) FROM messages WHERE recipient_id = ? AND is_read = 0'
        );
        $cliSt->execute([$uid]);
        $cliUnread = (int)$cliSt->fetchColumn();
        echo 'event: connected' . "\n";
        echo 'data: ' . json_encode(
            ['uid' => $uid, 'unread' => $cliUnread, 'ts' => time(), 'mode' => 'cli-poll'],
            JSON_UNESCAPED_SLASHES
        ) . "\n\n";
    } catch (Throwable $cliEx) {
        echo ": db-unavailable\n\n";
    }
    flush();
    exit;
}

// ─── SSE headers ──────────────────────────────────────────────────────────
header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');   // Disable nginx proxy buffering
header('Connection: keep-alive');

// Disable output buffering at every layer
if (function_exists('apache_setenv')) {
    apache_setenv('no-gzip', '1');
}
@ini_set('zlib.output_compression', '0');
@ini_set('implicit_flush', '1');

while (ob_get_level() > 0) {
    ob_end_flush();
}
ob_implicit_flush(true);

// ─── Runtime settings ──────────────────────────────────────────────────────
const MAX_RUNTIME    = 90;   // seconds before closing (client reconnects)
const POLL_INTERVAL  = 4;    // seconds between DB checks
const PING_INTERVAL  = 20;   // seconds between heartbeat pings

$startTime   = time();
$lastPing    = 0;

// State snapshots to detect changes
$snapshot = [
    'unread_count'      => -1,
    'fleet_ids'         => [],   // pending outbound fleet IDs
    'return_fleet_ids'  => [],   // pending return fleet IDs
    'warned_attacks'    => [],   // incoming attack fleet IDs already notified
];

$db = get_db();

// ─── Helper: send one SSE event ────────────────────────────────────────────
function sse_event(string $type, array $data): void {
    echo "event: $type\n";
    echo 'data: ' . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
    flush();
}

function sse_ping(): void {
    echo ": ping\n\n";
    flush();
}

// ─── Initial snapshots ────────────────────────────────────────────────────
try {
    // Unread messages at connection time
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM messages WHERE recipient_id = ? AND is_read = 0'
    );
    $stmt->execute([$uid]);
    $snapshot['unread_count'] = (int)$stmt->fetchColumn();

    // Pending outbound fleets (not yet arrived, not returning)
    $stmt = $db->prepare(
        'SELECT id FROM fleets WHERE user_id = ? AND arrival_time > NOW() AND returning = 0'
    );
    $stmt->execute([$uid]);
    $snapshot['fleet_ids'] = array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'id');

    // Pending return fleets
    $stmt = $db->prepare(
        'SELECT id FROM fleets WHERE user_id = ? AND return_time > NOW() AND returning = 1'
    );
    $stmt->execute([$uid]);
    $snapshot['return_fleet_ids'] = array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'id');
} catch (Throwable $e) {
    sse_event('error', ['message' => 'Snapshot init failed']);
    exit;
}

// Send initial connection confirmation
sse_event('connected', ['uid' => $uid, 'ts' => time()]);

// ─── Main poll loop ────────────────────────────────────────────────────────
while (true) {
    // Max runtime guard – client will auto-reconnect
    if ((time() - $startTime) >= MAX_RUNTIME) {
        sse_event('reconnect', ['reason' => 'max_runtime']);
        break;
    }

    // Check if client disconnected
    if (connection_aborted()) {
        break;
    }

    sleep(POLL_INTERVAL);

    // Heartbeat ping
    if ((time() - $lastPing) >= PING_INTERVAL) {
        sse_ping();
        $lastPing = time();
    }

    // Check client again after sleep
    if (connection_aborted()) {
        break;
    }

    try {
        // ── Check unread messages ────────────────────────────────────────
        $stmt = $db->prepare(
            'SELECT COUNT(*) FROM messages WHERE recipient_id = ? AND is_read = 0'
        );
        $stmt->execute([$uid]);
        $newUnread = (int)$stmt->fetchColumn();

        if ($newUnread !== $snapshot['unread_count']) {
            $delta = $newUnread - $snapshot['unread_count'];
            sse_event('new_messages', [
                'unread'   => $newUnread,
                'new'      => max(0, $delta),
            ]);
            $snapshot['unread_count'] = $newUnread;
        }

        // ── Check for outbound fleet arrivals ────────────────────────────
        if (!empty($snapshot['fleet_ids'])) {
            $placeholders = implode(',', array_fill(0, count($snapshot['fleet_ids']), '?'));
            $params = array_merge([$uid], $snapshot['fleet_ids']);
            $stmt = $db->prepare(
                "SELECT id, mission, target_galaxy, target_system, target_position
                 FROM fleets
                 WHERE user_id = ? AND id IN ($placeholders)
                   AND arrival_time <= NOW() AND returning = 0"
            );
            $stmt->execute($params);
            $arrived = $stmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($arrived as $fleet) {
                sse_event('fleet_arrived', [
                    'fleet_id' => (int)$fleet['id'],
                    'mission'  => $fleet['mission'],
                    'target'   => "{$fleet['target_galaxy']}:{$fleet['target_system']}:{$fleet['target_position']}",
                ]);
                // Remove from pending list
                $snapshot['fleet_ids'] = array_values(
                    array_filter($snapshot['fleet_ids'], fn($id) => $id !== $fleet['id'])
                );
                // Add to return fleet watch if it will return
                $snapshot['return_fleet_ids'][] = (int)$fleet['id'];
            }
        }

        // Re-check for any new outbound fleets launched since connection
        $stmt = $db->prepare(
            'SELECT id FROM fleets WHERE user_id = ? AND arrival_time > NOW() AND returning = 0'
        );
        $stmt->execute([$uid]);
        $currentOutbound = array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'id');
        // Add newly launched fleets to watch list (as integers)
        foreach ($currentOutbound as $fid) {
            $fid = (int)$fid;
            if (!in_array($fid, $snapshot['fleet_ids'], true)) {
                $snapshot['fleet_ids'][] = $fid;
            }
        }

        // ── Check for return fleet arrivals ──────────────────────────────
        if (!empty($snapshot['return_fleet_ids'])) {
            $placeholders = implode(',', array_fill(0, count($snapshot['return_fleet_ids']), '?'));
            $params = array_merge([$uid], $snapshot['return_fleet_ids']);
            $stmt = $db->prepare(
                "SELECT id, mission FROM fleets
                 WHERE user_id = ? AND id IN ($placeholders)
                   AND (return_time IS NULL OR return_time <= NOW())
                   AND returning = 1"
            );
            $stmt->execute($params);
            $returned = $stmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($returned as $fleet) {
                sse_event('fleet_returning', [
                    'fleet_id' => (int)$fleet['id'],
                    'mission'  => $fleet['mission'],
                ]);
                $snapshot['return_fleet_ids'] = array_values(
                    array_filter($snapshot['return_fleet_ids'], fn($id) => $id !== (int)$fleet['id'])
                );
            }
        }

        // ── Check for incoming attacks on user's colonies ─────────────────
        // Look for hostile fleets heading for any of the user's planets
        $stmt = $db->prepare(
            "SELECT f.id, f.mission, f.arrival_time,
                    f.target_galaxy, f.target_system, f.target_position,
                    u.username AS attacker_name
             FROM fleets f
             JOIN users u ON u.id = f.user_id
             JOIN colonies c ON c.user_id = ?
                         JOIN celestial_bodies cb ON cb.id = c.body_id
                             AND cb.galaxy_index = f.target_galaxy
                             AND cb.system_index = f.target_system
                             AND cb.position     = f.target_position
             WHERE f.user_id <> ?
               AND f.mission IN ('attack','spy')
               AND f.arrival_time > NOW()
               AND f.arrival_time <= DATE_ADD(NOW(), INTERVAL 5 MINUTE)
               AND f.returning = 0
             GROUP BY f.id"
        );
        $stmt->execute([$uid, $uid]);
        $incoming = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($incoming as $fleet) {
            $fid = (int)$fleet['id'];
            if (!in_array($fid, $snapshot['warned_attacks'], true)) {
                sse_event('incoming_attack', [
                    'fleet_id'     => $fid,
                    'mission'      => $fleet['mission'],
                    'attacker'     => $fleet['attacker_name'],
                    'arrival_time' => $fleet['arrival_time'],
                    'target'       => "{$fleet['target_galaxy']}:{$fleet['target_system']}:{$fleet['target_position']}",
                ]);
                $snapshot['warned_attacks'][] = $fid;
            }
        }

    } catch (Throwable $e) {
        // Log but don't crash the SSE stream
        error_log('[events.php] Poll error uid=' . $uid . ': ' . $e->getMessage());
    }
}

exit;
