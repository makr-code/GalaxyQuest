<?php
/**
 * Situations API
 * GET  /api/situations.php?action=list&status=active|resolved|failed|cancelled|all
 * POST /api/situations.php?action=start         body: {type, target_type, target_id, colony_id?, approach_key?, progress?, monthly_deltas?, payload?}
 * POST /api/situations.php?action=set_approach  body: {situation_id, approach_key}
 * POST /api/situations.php?action=tick          body: {situation_id?}
 * POST /api/situations.php?action=resolve       body: {situation_id, outcome: resolved|failed|cancelled, note?}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/buildings.php';

$action = $_GET['action'] ?? '';
$uid = require_auth();
$db = get_db();
ensure_situations_tables($db);

switch ($action) {
    case 'list':
        only_method('GET');
        $status = strtolower((string)($_GET['status'] ?? 'active'));
        $limit = max(1, min(200, (int)($_GET['limit'] ?? 50)));

        if ($status === 'all') {
            $stmt = $db->prepare(
                'SELECT id, user_id, colony_id, target_type, target_id, situation_type, status,
                        progress, stage, approach_key, approach_locked, payload_json,
                        monthly_deltas_json, started_at, last_tick_at, ended_at, updated_at
                 FROM situation_states
                 WHERE user_id = ?
                 ORDER BY updated_at DESC, id DESC
                 LIMIT ' . $limit
            );
            $stmt->execute([$uid]);
        } else {
            if (!in_array($status, ['active', 'resolved', 'failed', 'cancelled'], true)) {
                json_error('Invalid status filter.');
            }
            $stmt = $db->prepare(
                'SELECT id, user_id, colony_id, target_type, target_id, situation_type, status,
                        progress, stage, approach_key, approach_locked, payload_json,
                        monthly_deltas_json, started_at, last_tick_at, ended_at, updated_at
                 FROM situation_states
                 WHERE user_id = ? AND status = ?
                 ORDER BY updated_at DESC, id DESC
                 LIMIT ' . $limit
            );
            $stmt->execute([$uid, $status]);
        }

        $rows = $stmt->fetchAll();
        foreach ($rows as &$row) {
            $row['id'] = (int)$row['id'];
            $row['user_id'] = (int)$row['user_id'];
            $row['colony_id'] = $row['colony_id'] === null ? null : (int)$row['colony_id'];
            $row['target_id'] = $row['target_id'] === null ? null : (int)$row['target_id'];
            $row['progress'] = (float)$row['progress'];
            $row['stage'] = (int)$row['stage'];
            $row['approach_locked'] = (int)$row['approach_locked'];
            $row['payload'] = decode_json_field($row['payload_json']);
            $row['monthly_deltas'] = decode_json_field($row['monthly_deltas_json']);
            unset($row['payload_json'], $row['monthly_deltas_json']);
        }
        unset($row);

        json_ok(['situations' => $rows]);
        break;

    case 'start':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();

        $type = trim((string)($body['type'] ?? ''));
        $targetType = (string)($body['target_type'] ?? 'empire');
        $targetId = isset($body['target_id']) ? (int)$body['target_id'] : null;
        $colonyId = isset($body['colony_id']) ? (int)$body['colony_id'] : null;
        $approach = trim((string)($body['approach_key'] ?? 'maintain'));
        $progress = isset($body['progress']) ? (float)$body['progress'] : 0.0;
        $payload = is_array($body['payload'] ?? null) ? $body['payload'] : [];
        $monthlyDeltas = is_array($body['monthly_deltas'] ?? null)
            ? $body['monthly_deltas']
            : ['progress_per_hour' => 1.0];

        if ($type === '') {
            json_error('type is required.');
        }
        if (!in_array($targetType, ['empire', 'colony', 'system'], true)) {
            json_error('target_type must be empire, colony or system.');
        }
        if ($targetType === 'colony') {
            $effectiveColony = $colonyId ?? $targetId;
            if (!$effectiveColony || $effectiveColony <= 0) {
                json_error('colony target requires colony_id or target_id.');
            }
            verify_colony_ownership($db, (int)$effectiveColony, $uid);
            $colonyId = (int)$effectiveColony;
            $targetId = (int)$effectiveColony;
        } elseif ($colonyId !== null && $colonyId > 0) {
            verify_colony_ownership($db, $colonyId, $uid);
        }

        $progress = clamp_progress($progress);
        $stage = stage_from_progress($progress);

        $stmt = $db->prepare(
            'INSERT INTO situation_states
             (user_id, colony_id, target_type, target_id, situation_type, status,
              progress, stage, approach_key, approach_locked, payload_json,
              monthly_deltas_json, started_at, last_tick_at, ended_at)
             VALUES (?, ?, ?, ?, ?, \'active\', ?, ?, ?, 0, ?, ?, NOW(), NOW(), NULL)'
        );
        $stmt->execute([
            $uid,
            $colonyId,
            $targetType,
            $targetId,
            $type,
            $progress,
            $stage,
            $approach,
            json_encode($payload),
            json_encode($monthlyDeltas),
        ]);

        $sid = (int)$db->lastInsertId();
        json_ok(['situation_id' => $sid, 'stage' => $stage, 'progress' => $progress]);
        break;

    case 'set_approach':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $sid = (int)($body['situation_id'] ?? 0);
        $approach = trim((string)($body['approach_key'] ?? ''));

        if ($sid <= 0 || $approach === '') {
            json_error('situation_id and approach_key are required.');
        }

        $row = load_user_situation($db, $sid, $uid);
        if (!$row) {
            json_error('Situation not found.', 404);
        }
        if ((string)$row['status'] !== 'active') {
            json_error('Only active situations can change approach.');
        }
        if ((int)$row['approach_locked'] === 1) {
            json_error('Approach is locked for this situation.');
        }

        $db->prepare(
            'UPDATE situation_states
             SET approach_key = ?, updated_at = NOW()
             WHERE id = ? AND user_id = ?'
        )->execute([$approach, $sid, $uid]);

        json_ok(['situation_id' => $sid, 'approach_key' => $approach]);
        break;

    case 'tick':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $sid = isset($body['situation_id']) ? (int)$body['situation_id'] : 0;

        if ($sid > 0) {
            $rows = [];
            $one = load_user_situation($db, $sid, $uid);
            if ($one && (string)$one['status'] === 'active') {
                $rows[] = $one;
            }
        } else {
            $stmt = $db->prepare(
                'SELECT * FROM situation_states
                 WHERE user_id = ? AND status = \'active\''
            );
            $stmt->execute([$uid]);
            $rows = $stmt->fetchAll();
        }

        $ticked = [];
        foreach ($rows as $s) {
            $tickResult = tick_situation($db, $s, $uid);
            if ($tickResult !== null) {
                $ticked[] = $tickResult;
            }
        }

        json_ok(['ticked' => $ticked]);
        break;

    case 'resolve':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $sid = (int)($body['situation_id'] ?? 0);
        $outcome = strtolower((string)($body['outcome'] ?? 'resolved'));
        $note = trim((string)($body['note'] ?? ''));

        if ($sid <= 0) {
            json_error('situation_id is required.');
        }
        if (!in_array($outcome, ['resolved', 'failed', 'cancelled'], true)) {
            json_error('outcome must be resolved, failed, or cancelled.');
        }

        $row = load_user_situation($db, $sid, $uid);
        if (!$row) {
            json_error('Situation not found.', 404);
        }
        if ((string)$row['status'] !== 'active') {
            json_error('Situation is not active.');
        }

        $payload = decode_json_field((string)($row['payload_json'] ?? ''));
        if ($note !== '') {
            $payload['resolution_note'] = $note;
        }

        $db->prepare(
            'UPDATE situation_states
             SET status = ?, ended_at = NOW(), payload_json = ?, updated_at = NOW()
             WHERE id = ? AND user_id = ?'
        )->execute([$outcome, json_encode($payload), $sid, $uid]);

        json_ok(['situation_id' => $sid, 'status' => $outcome]);
        break;

    default:
        json_error('Unknown action');
}

function ensure_situations_tables(PDO $db): void {
    static $ready = false;
    if ($ready) {
        return;
    }

    $db->exec(
        'CREATE TABLE IF NOT EXISTS situation_states (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            colony_id INT DEFAULT NULL,
            target_type ENUM(\'empire\',\'colony\',\'system\') NOT NULL DEFAULT \'empire\',
            target_id INT DEFAULT NULL,
            situation_type VARCHAR(64) NOT NULL,
            status ENUM(\'active\',\'resolved\',\'failed\',\'cancelled\') NOT NULL DEFAULT \'active\',
            progress DECIMAL(6,2) NOT NULL DEFAULT 0,
            stage TINYINT UNSIGNED NOT NULL DEFAULT 1,
            approach_key VARCHAR(64) NOT NULL DEFAULT \'maintain\',
            approach_locked TINYINT(1) NOT NULL DEFAULT 0,
            payload_json JSON DEFAULT NULL,
            monthly_deltas_json JSON DEFAULT NULL,
            started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_tick_at DATETIME DEFAULT NULL,
            ended_at DATETIME DEFAULT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE SET NULL,
            INDEX idx_situation_user_status (user_id, status),
            INDEX idx_situation_target (target_type, target_id),
            INDEX idx_situation_tick (status, last_tick_at)
        ) ENGINE=InnoDB'
    );

    $db->exec(
        'CREATE TABLE IF NOT EXISTS situation_stage_log (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            situation_id BIGINT NOT NULL,
            user_id INT NOT NULL,
            old_stage TINYINT UNSIGNED NOT NULL,
            new_stage TINYINT UNSIGNED NOT NULL,
            reason VARCHAR(128) NOT NULL DEFAULT \'progress_update\',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (situation_id) REFERENCES situation_states(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_stage_log_situation (situation_id, created_at),
            INDEX idx_stage_log_user (user_id, created_at)
        ) ENGINE=InnoDB'
    );

    $ready = true;
}

function load_user_situation(PDO $db, int $situationId, int $userId): ?array {
    $stmt = $db->prepare('SELECT * FROM situation_states WHERE id = ? AND user_id = ? LIMIT 1');
    $stmt->execute([$situationId, $userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function tick_situation(PDO $db, array $row, int $userId): ?array {
    $sid = (int)$row['id'];
    $progress = (float)$row['progress'];
    $oldStage = (int)$row['stage'];
    $locked = (int)$row['approach_locked'] === 1;

    $lastTickStr = (string)($row['last_tick_at'] ?: $row['started_at']);
    $lastTickTs = strtotime($lastTickStr);
    if (!is_int($lastTickTs)) {
        $lastTickTs = time();
    }
    $nowTs = time();
    $elapsedSec = max(0, $nowTs - $lastTickTs);
    if ($elapsedSec === 0) {
        return [
            'situation_id' => $sid,
            'progress' => round($progress, 2),
            'stage' => $oldStage,
            'status' => (string)$row['status'],
        ];
    }

    $deltaCfg = decode_json_field((string)($row['monthly_deltas_json'] ?? ''));
    $progressPerHour = (float)($deltaCfg['progress_per_hour'] ?? 1.0);

    // Approach can override progress speed via a compact map in monthly_deltas_json.
    // Example: {"progress_per_hour":1.0, "approach_multipliers":{"contain":-0.8,"exploit":1.5}}
    $approach = (string)$row['approach_key'];
    if (isset($deltaCfg['approach_multipliers']) && is_array($deltaCfg['approach_multipliers'])) {
        $mul = $deltaCfg['approach_multipliers'][$approach] ?? 1.0;
        $progressPerHour *= (float)$mul;
    }

    $progress += ($elapsedSec / 3600.0) * $progressPerHour;
    $progress = clamp_progress($progress);
    $newStage = stage_from_progress($progress);

    if ($newStage !== $oldStage) {
        $db->prepare(
            'INSERT INTO situation_stage_log (situation_id, user_id, old_stage, new_stage, reason)
             VALUES (?, ?, ?, ?, \'progress_update\')'
        )->execute([$sid, $userId, $oldStage, $newStage]);
    }

    $newLocked = $locked;
    if (!$newLocked && $newStage >= 3) {
        $newLocked = true;
    }

    $newStatus = 'active';
    $endedAtSql = 'NULL';
    if ($progress >= 100.0) {
        $newStatus = 'resolved';
        $endedAtSql = 'NOW()';
    } elseif ($progress <= 0.0 && $progressPerHour < 0) {
        $newStatus = 'failed';
        $endedAtSql = 'NOW()';
    }

    $sql =
        'UPDATE situation_states
         SET progress = ?,
             stage = ?,
             approach_locked = ?,
             status = ?,
             last_tick_at = NOW(),
             updated_at = NOW(),
             ended_at = ' . $endedAtSql . '
         WHERE id = ? AND user_id = ?';

    $db->prepare($sql)->execute([
        $progress,
        $newStage,
        $newLocked ? 1 : 0,
        $newStatus,
        $sid,
        $userId,
    ]);

    return [
        'situation_id' => $sid,
        'progress' => round($progress, 2),
        'stage' => $newStage,
        'approach_locked' => $newLocked,
        'status' => $newStatus,
    ];
}

function decode_json_field(?string $json): array {
    if ($json === null || trim($json) === '') {
        return [];
    }
    $data = json_decode($json, true);
    return is_array($data) ? $data : [];
}

function clamp_progress(float $progress): float {
    if ($progress < 0.0) {
        return 0.0;
    }
    if ($progress > 100.0) {
        return 100.0;
    }
    return $progress;
}

function stage_from_progress(float $progress): int {
    if ($progress >= 80.0) {
        return 4;
    }
    if ($progress >= 50.0) {
        return 3;
    }
    if ($progress >= 25.0) {
        return 2;
    }
    return 1;
}
