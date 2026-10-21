<?php

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/npc_ai_decision_queue.php';

only_method('POST');

if ((int) NPC_AI_WORKER_API_ENABLED !== 1) {
    json_error('NPC AI worker API disabled.', 404);
}

$sharedSecret = (string) NPC_AI_WORKER_SHARED_SECRET;
if ($sharedSecret === '') {
    json_error('NPC AI worker API misconfigured.', 503);
}

/**
 * @return array{worker_id:string,timestamp:int,nonce:string,signature:string}
 */
function npc_ai_worker_auth_headers(): array
{
    $workerId = trim((string) ($_SERVER['HTTP_X_WORKER_ID'] ?? ''));
    $timestamp = (int) ($_SERVER['HTTP_X_WORKER_TIMESTAMP'] ?? 0);
    $nonce = trim((string) ($_SERVER['HTTP_X_WORKER_NONCE'] ?? ''));
    $signature = strtolower(trim((string) ($_SERVER['HTTP_X_WORKER_SIGNATURE'] ?? '')));

    if (
        $workerId === '' ||
        $timestamp <= 0 ||
        $nonce === '' ||
        $signature === ''
    ) {
        json_error('Missing worker authentication headers.', 401);
    }

    if (!preg_match('/^[a-zA-Z0-9:_-]{3,64}$/', $workerId)) {
        json_error('Invalid worker id format.', 401);
    }
    if (!preg_match('/^[A-Za-z0-9_-]{8,128}$/', $nonce)) {
        json_error('Invalid nonce format.', 401);
    }
    if (!preg_match('/^[a-f0-9]{64}$/', $signature)) {
        json_error('Invalid signature format.', 401);
    }

    return [
        'worker_id' => $workerId,
        'timestamp' => $timestamp,
        'nonce' => $nonce,
        'signature' => $signature,
    ];
}

function npc_ai_worker_nonce_table_available(PDO $db): bool
{
    static $available = null;
    if ($available !== null) {
        return $available;
    }

    try {
        $stmt = $db->query("SHOW TABLES LIKE 'npc_ai_worker_nonce'");
        $available = (bool) $stmt->fetchColumn();
    } catch (Throwable $e) {
        $available = false;
    }

    return $available;
}

function npc_ai_worker_nonce_retention_seconds(): int
{
    $skew = max(30, (int) NPC_AI_WORKER_SIGNATURE_MAX_SKEW_SECONDS);
    return max(600, $skew * 2);
}

/**
 * @return 'ok'|'missing'|'replay'
 */
function npc_ai_worker_nonce_consume_status(PDO $db, string $workerId, string $nonce): string
{
    if (!npc_ai_worker_nonce_table_available($db)) {
        return 'missing';
    }
    $nonceHash = hash('sha256', $workerId . ':' . $nonce);
    $retentionSeconds = npc_ai_worker_nonce_retention_seconds();
    $cutoffUnix = time() - $retentionSeconds;

    $cleanup = $db->prepare(
        'DELETE FROM npc_ai_worker_nonce WHERE created_at < FROM_UNIXTIME(?)'
    );
    $cleanup->execute([$cutoffUnix]);

    $insert = $db->prepare(
        'INSERT IGNORE INTO npc_ai_worker_nonce (nonce_hash, worker_id) VALUES (?, ?)'
    );
    $insert->execute([$nonceHash, $workerId]);
    return $insert->rowCount() === 1 ? 'ok' : 'replay';
}

/**
 * @return array{worker_id:string}
 */
function npc_ai_worker_authenticate(PDO $db, string $rawBody, string $sharedSecret): array
{
    $headers = npc_ai_worker_auth_headers();
    $maxSkew = max(30, (int) NPC_AI_WORKER_SIGNATURE_MAX_SKEW_SECONDS);
    $drift = abs(time() - (int) $headers['timestamp']);
    if ($drift > $maxSkew) {
        json_error('Worker request timestamp outside allowed skew.', 401);
    }

    $canonical = $headers['worker_id'] . "\n"
        . $headers['timestamp'] . "\n"
        . $headers['nonce'] . "\n"
        . $rawBody;
    $expected = hash_hmac('sha256', $canonical, $sharedSecret);
    if (!hash_equals($expected, $headers['signature'])) {
        json_error('Invalid worker request signature.', 401);
    }

    $nonceStatus = npc_ai_worker_nonce_consume_status($db, $headers['worker_id'], $headers['nonce']);
    if ($nonceStatus === 'missing') {
        json_error('Worker nonce table missing.', 503);
    }
    if ($nonceStatus !== 'ok') {
        json_error('Worker request replay detected.', 409);
    }

    return [
        'worker_id' => $headers['worker_id'],
    ];
}

$rawBody = (string) file_get_contents('php://input');
$db = get_db();
$auth = npc_ai_worker_authenticate($db, $rawBody, $sharedSecret);
$body = json_decode($rawBody, true);
if (!is_array($body)) {
    $body = [];
}

$action = strtolower(trim((string)($_GET['action'] ?? ($body['action'] ?? 'claim'))));

if ($action === 'claim') {
    $limit = (int) ($body['limit'] ?? NPC_LLM_ASYNC_QUEUE_BATCH_SIZE);
    $limit = min(
        npc_ai_decision_queue_normalize_limit($limit),
        max(1, (int) NPC_AI_WORKER_MAX_CLAIM_LIMIT)
    );

    $jobs = npc_ai_decision_queue_claim($db, $limit, $auth['worker_id']);
    $out = [];
    foreach ($jobs as $job) {
        $out[] = [
            'queue_id' => (int) ($job['id'] ?? 0),
            'user_id' => (int) ($job['user_id'] ?? 0),
            'faction_id' => (int) ($job['faction_id'] ?? 0),
            'attempts' => (int) ($job['attempts'] ?? 0),
            'max_attempts' => (int) ($job['max_attempts'] ?? 0),
            'payload' => is_array($job['payload'] ?? null) ? $job['payload'] : [],
            'claim_token' => (string) ($job['claim_token'] ?? ''),
        ];
    }

    json_ok([
        'worker_id' => $auth['worker_id'],
        'claimed' => count($out),
        'jobs' => $out,
    ]);
}

if ($action === 'complete') {
    $queueId = (int) ($body['queue_id'] ?? 0);
    $claimToken = strtolower(trim((string) ($body['claim_token'] ?? '')));
    $ok = !empty($body['ok']);
    $result = is_array($body['result'] ?? null) ? $body['result'] : [];
    $errorMessage = trim((string) ($body['error_message'] ?? ''));

    if ($queueId <= 0 || $claimToken === '') {
        json_error('queue_id and claim_token are required.', 400);
    }

    $updated = npc_ai_decision_queue_complete_claimed(
        $db,
        $queueId,
        $auth['worker_id'],
        $claimToken,
        $ok,
        $result,
        $errorMessage
    );
    if (!$updated) {
        json_error('Queue claim invalid or expired.', 409);
    }

    json_ok([
        'worker_id' => $auth['worker_id'],
        'queue_id' => $queueId,
        'accepted' => true,
    ]);
}

json_error('Unknown action', 404);
