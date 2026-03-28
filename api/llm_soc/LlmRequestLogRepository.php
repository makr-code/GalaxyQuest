<?php

declare(strict_types=1);

final class LlmRequestLogRepository {
    /**
     * @param array<string, mixed> $payload
     */
    public function log(PDO $db, array $payload): void {
        $sql = <<<'SQL'
INSERT INTO llm_request_log (
    user_id,
    profile_key,
    model,
    prompt_hash,
    prompt_preview,
    response_preview,
    latency_ms,
    status,
    error_message,
    created_at
)
VALUES (
    :user_id,
    :profile_key,
    :model,
    :prompt_hash,
    :prompt_preview,
    :response_preview,
    :latency_ms,
    :status,
    :error_message,
    NOW()
)
SQL;

        try {
            $stmt = $db->prepare($sql);
            $stmt->execute([
                ':user_id' => (int) ($payload['user_id'] ?? 0),
                ':profile_key' => (string) ($payload['profile_key'] ?? ''),
                ':model' => (string) ($payload['model'] ?? ''),
                ':prompt_hash' => (string) ($payload['prompt_hash'] ?? ''),
                ':prompt_preview' => (string) ($payload['prompt_preview'] ?? ''),
                ':response_preview' => (string) ($payload['response_preview'] ?? ''),
                ':latency_ms' => (int) ($payload['latency_ms'] ?? 0),
                ':status' => (string) ($payload['status'] ?? 'ok'),
                ':error_message' => (string) ($payload['error_message'] ?? ''),
            ]);
        } catch (Throwable $e) {
            // Do not break game flow when logging fails.
        }
    }
}
