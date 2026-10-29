#!/usr/bin/env php
<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script must be run from the CLI.\n");
    exit(1);
}

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/npc_ai_decision_queue.php';
require_once __DIR__ . '/../api/npc_llm_controller.php';

$limit = (int) NPC_LLM_ASYNC_QUEUE_BATCH_SIZE;
$workerId = 'local-cli-worker';
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--limit=')) {
        $limit = (int) substr($arg, 8);
    }
    if (str_starts_with($arg, '--worker-id=')) {
        $workerId = trim(substr($arg, 12));
    }
}
$limit = max(1, min(100, $limit));
if (!preg_match('/^[a-zA-Z0-9:_-]{3,64}$/', $workerId)) {
    fwrite(STDERR, "Invalid --worker-id format.\n");
    exit(1);
}

$db = null;
try {
    $db = get_db();
} catch (Throwable $e) {
    fwrite(STDERR, "Database connection failed: " . $e->getMessage() . PHP_EOL);
    exit(1);
}
$jobs = npc_ai_decision_queue_claim($db, $limit, $workerId);

$processed = 0;
$success = 0;
$failed = 0;

foreach ($jobs as $job) {
    $processed++;
    $queueId = (int) ($job['id'] ?? 0);
    $userId = (int) ($job['user_id'] ?? 0);
    $factionId = (int) ($job['faction_id'] ?? 0);
    $claimToken = strtolower((string) ($job['claim_token'] ?? ''));

    try {
        $stmt = $db->prepare('SELECT * FROM npc_factions WHERE id = ? LIMIT 1');
        $stmt->execute([$factionId]);
        $faction = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$faction) {
            if ($claimToken !== '') {
                npc_ai_decision_queue_complete_claimed(
                    $db,
                    $queueId,
                    $workerId,
                    $claimToken,
                    false,
                    ['handled' => false, 'reason' => 'faction_not_found'],
                    'faction_not_found'
                );
            } else {
                npc_ai_decision_queue_complete(
                    $db,
                    $queueId,
                    false,
                    ['handled' => false, 'reason' => 'faction_not_found'],
                    'faction_not_found'
                );
            }
            $failed++;
            continue;
        }

        $decision = npc_pve_llm_controller_try($db, $userId, $faction);
        $ok = !in_array((string) ($decision['reason'] ?? ''), ['llm_error', 'invalid_json'], true);
        if ($claimToken !== '') {
            npc_ai_decision_queue_complete_claimed(
                $db,
                $queueId,
                $workerId,
                $claimToken,
                $ok,
                $decision,
                $ok ? '' : (string) ($decision['reason'] ?? 'decision_error')
            );
        } else {
            npc_ai_decision_queue_complete(
                $db,
                $queueId,
                $ok,
                $decision,
                $ok ? '' : (string) ($decision['reason'] ?? 'decision_error')
            );
        }

        if ($ok) {
            $success++;
        } else {
            $failed++;
        }
    } catch (Throwable $e) {
        $safeError = preg_replace('/\s+/', ' ', (string) $e->getMessage());
        $safeError = substr((string) $safeError, 0, 200);
        if ($claimToken !== '') {
            npc_ai_decision_queue_complete_claimed(
                $db,
                $queueId,
                $workerId,
                $claimToken,
                false,
                ['handled' => false, 'reason' => 'worker_exception'],
                $safeError
            );
        } else {
            npc_ai_decision_queue_complete(
                $db,
                $queueId,
                false,
                ['handled' => false, 'reason' => 'worker_exception'],
                $safeError
            );
        }
        $failed++;
    }
}

echo json_encode([
    'ok' => true,
    'processed' => $processed,
    'success' => $success,
    'failed' => $failed,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
