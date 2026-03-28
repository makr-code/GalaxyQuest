<?php
/**
 * NPC / PvE controller diagnostics + control API.
 *
 * GET  /api/npc_controller.php?action=status
 * GET  /api/npc_controller.php?action=summary&hours=24&faction_id=0
 * GET  /api/npc_controller.php?action=decisions&limit=20&faction_id=0
 * POST /api/npc_controller.php?action=run_once
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/npc_ai.php';

$uid = require_auth();
$action = strtolower((string) ($_GET['action'] ?? 'status'));
$db = get_db();

switch ($action) {
    case 'status':
        only_method('GET');

        $lastTick = null;
        $cooldownRemaining = 0;

        try {
            $stmt = $db->prepare('SELECT last_npc_tick FROM users WHERE id = ? LIMIT 1');
            $stmt->execute([$uid]);
            $lastTick = $stmt->fetchColumn() ?: null;
            if ($lastTick) {
                $elapsed = max(0, time() - (int) strtotime((string) $lastTick));
                $cooldownRemaining = max(0, 300 - $elapsed);
            }
        } catch (Throwable $e) {
            $lastTick = null;
            $cooldownRemaining = 0;
        }

        $logAvailable = npc_controller_log_table_exists($db);

        $recentCount = 0;
        if ($logAvailable) {
            try {
                $q = $db->prepare('SELECT COUNT(*) FROM npc_llm_decision_log WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)');
                $q->execute([$uid]);
                $recentCount = (int) $q->fetchColumn();
            } catch (Throwable $e) {
                $recentCount = 0;
            }
        }

        json_ok([
            'controller' => [
                'enabled' => (int) NPC_LLM_CONTROLLER_ENABLED === 1,
                'ollama_enabled' => ollama_is_enabled(),
                'timeout_seconds' => (int) NPC_LLM_CONTROLLER_TIMEOUT_SECONDS,
                'cooldown_seconds' => (int) NPC_LLM_CONTROLLER_COOLDOWN_SECONDS,
                'min_confidence' => (float) NPC_LLM_CONTROLLER_MIN_CONFIDENCE,
                'log_table_available' => $logAvailable,
            ],
            'tick' => [
                'last_npc_tick' => $lastTick,
                'cooldown_remaining_seconds' => $cooldownRemaining,
            ],
            'metrics' => [
                'decisions_last_24h' => $recentCount,
            ],
        ]);
        break;

    case 'summary':
        only_method('GET');

        if (!npc_controller_log_table_exists($db)) {
            json_ok([
                'window_hours' => 0,
                'faction_id' => 0,
                'metrics' => [
                    'total' => 0,
                    'executed' => 0,
                    'blocked' => 0,
                    'errors' => 0,
                    'avg_confidence' => 0.0,
                    'executed_ratio' => 0.0,
                ],
                'by_action' => [],
                'by_status' => [],
                'recent_errors' => [],
                'note' => 'npc_llm_decision_log table missing. Apply sql/migrate_npc_pve_controller_v1.sql',
            ]);
        }

        $hours = max(1, min(168, (int) ($_GET['hours'] ?? 24)));
        $factionId = max(0, (int) ($_GET['faction_id'] ?? 0));

        $baseSql = ' FROM npc_llm_decision_log WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)';
        $params = [$uid, $hours];
        if ($factionId > 0) {
            $baseSql .= ' AND faction_id = ?';
            $params[] = $factionId;
        }

        $metricsStmt = $db->prepare(
            'SELECT COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN executed = 1 THEN 1 ELSE 0 END), 0) AS executed,
                    COALESCE(SUM(CASE WHEN status = "error" THEN 1 ELSE 0 END), 0) AS errors,
                    COALESCE(AVG(confidence), 0) AS avg_confidence' .
            $baseSql
        );
        $metricsStmt->execute($params);
        $m = $metricsStmt->fetch() ?: [];

        $total = (int) ($m['total'] ?? 0);
        $executed = (int) ($m['executed'] ?? 0);
        $errors = (int) ($m['errors'] ?? 0);
        $blocked = max(0, $total - $executed - $errors);

        $actionStmt = $db->prepare(
            'SELECT action_key,
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN executed = 1 THEN 1 ELSE 0 END), 0) AS executed,
                    COALESCE(SUM(CASE WHEN status = "error" THEN 1 ELSE 0 END), 0) AS errors,
                    COALESCE(AVG(confidence), 0) AS avg_confidence' .
            $baseSql .
            ' GROUP BY action_key ORDER BY total DESC, action_key ASC'
        );
        $actionStmt->execute($params);
        $byActionRows = $actionStmt->fetchAll() ?: [];

        $statusStmt = $db->prepare(
            'SELECT status,
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN executed = 1 THEN 1 ELSE 0 END), 0) AS executed' .
            $baseSql .
            ' GROUP BY status ORDER BY total DESC, status ASC'
        );
        $statusStmt->execute($params);
        $byStatusRows = $statusStmt->fetchAll() ?: [];

        $errorsStmt = $db->prepare(
            'SELECT id, faction_id, faction_code, action_key, status, executed,
                    confidence, error_message, reasoning, created_at' .
            $baseSql .
            ' AND status = "error" ORDER BY id DESC LIMIT 5'
        );
        $errorsStmt->execute($params);

        json_ok([
            'window_hours' => $hours,
            'faction_id' => $factionId,
            'metrics' => [
                'total' => $total,
                'executed' => $executed,
                'blocked' => $blocked,
                'errors' => $errors,
                'avg_confidence' => round((float) ($m['avg_confidence'] ?? 0), 4),
                'executed_ratio' => $total > 0 ? round($executed / $total, 4) : 0.0,
            ],
            'by_action' => array_map(static function (array $row): array {
                return [
                    'action_key' => (string) ($row['action_key'] ?? 'none'),
                    'total' => (int) ($row['total'] ?? 0),
                    'executed' => (int) ($row['executed'] ?? 0),
                    'errors' => (int) ($row['errors'] ?? 0),
                    'avg_confidence' => round((float) ($row['avg_confidence'] ?? 0), 4),
                ];
            }, $byActionRows),
            'by_status' => array_map(static function (array $row): array {
                return [
                    'status' => (string) ($row['status'] ?? 'unknown'),
                    'total' => (int) ($row['total'] ?? 0),
                    'executed' => (int) ($row['executed'] ?? 0),
                ];
            }, $byStatusRows),
            'recent_errors' => $errorsStmt->fetchAll(),
        ]);
        break;

    case 'decisions':
        only_method('GET');

        if (!npc_controller_log_table_exists($db)) {
            json_ok([
                'decisions' => [],
                'note' => 'npc_llm_decision_log table missing. Apply sql/migrate_npc_pve_controller_v1.sql',
            ]);
        }

        $limit = max(1, min(100, (int) ($_GET['limit'] ?? 20)));
        $factionId = (int) ($_GET['faction_id'] ?? 0);

        if ($factionId > 0) {
            $stmt = $db->prepare(
                'SELECT id, faction_id, faction_code, action_key, confidence,
                        standing_before, standing_after, status, reasoning,
                        executed, error_message, created_at
                 FROM npc_llm_decision_log
                 WHERE user_id = ? AND faction_id = ?
                 ORDER BY id DESC
                 LIMIT ' . $limit
            );
            $stmt->execute([$uid, $factionId]);
        } else {
            $stmt = $db->prepare(
                'SELECT id, faction_id, faction_code, action_key, confidence,
                        standing_before, standing_after, status, reasoning,
                        executed, error_message, created_at
                 FROM npc_llm_decision_log
                 WHERE user_id = ?
                 ORDER BY id DESC
                 LIMIT ' . $limit
            );
            $stmt->execute([$uid]);
        }

        json_ok([
            'decisions' => $stmt->fetchAll(),
        ]);
        break;

    case 'run_once':
        only_method('POST');
        verify_csrf();

        $before = npc_controller_count_logs($db, $uid);
        npc_ai_tick($db, $uid, true);
        $after = npc_controller_count_logs($db, $uid);

        json_ok([
            'message' => 'NPC tick executed.',
            'new_decision_logs' => max(0, $after - $before),
        ]);
        break;

    default:
        json_error('Unknown action');
}

function npc_controller_log_table_exists(PDO $db): bool {
    try {
        $stmt = $db->query("SHOW TABLES LIKE 'npc_llm_decision_log'");
        return (bool) $stmt->fetchColumn();
    } catch (Throwable $e) {
        return false;
    }
}

function npc_controller_count_logs(PDO $db, int $userId): int {
    if (!npc_controller_log_table_exists($db)) {
        return 0;
    }

    try {
        $stmt = $db->prepare('SELECT COUNT(*) FROM npc_llm_decision_log WHERE user_id = ?');
        $stmt->execute([$userId]);
        return (int) $stmt->fetchColumn();
    } catch (Throwable $e) {
        return 0;
    }
}
