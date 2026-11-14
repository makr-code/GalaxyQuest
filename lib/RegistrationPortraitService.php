<?php
declare(strict_types=1);

final class RegistrationPortraitService {
    public const MAX_BYTES = 2097152;

    public function __construct(private PDO $db) {}

    private function draft(string $owner, ?string $token = null, bool $lock = false): array {
        $stmt = $this->db->prepare(
            'SELECT token, snapshot_json FROM registration_drafts WHERE session_hash = ? AND expires_at > UTC_TIMESTAMP()'
            . ($lock ? ' FOR UPDATE' : '')
        );
        $stmt->execute([$owner]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row || ($token !== null && !hash_equals($row['token'], $token))) {
            throw new RuntimeException('Registration draft expired or unavailable.', 410);
        }
        $snapshot = json_decode($row['snapshot_json'], true, 512, JSON_THROW_ON_ERROR);
        if (!isset($snapshot['species_code'], $snapshot['character']['name'], $snapshot['character']['background'])) {
            throw new RuntimeException('Save your species and character before generating a portrait.', 409);
        }
        return [
            'token' => $row['token'], 'snapshot' => $snapshot,
            'hash' => hash('sha256', json_encode([
                $snapshot['species_code'], $snapshot['character']['name'], $snapshot['character']['background'],
                $snapshot['character_revision'] ?? null,
            ], JSON_THROW_ON_ERROR)),
        ];
    }

    private function portrait(string $token): ?array {
        $stmt = $this->db->prepare(
            'SELECT identity_hash, attempt_id, status, attempts, last_error,
                    TIMESTAMPDIFF(SECOND, started_at, UTC_TIMESTAMP()) AS age
             FROM registration_portraits WHERE draft_token = ?'
        );
        $stmt->execute([$token]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public function status(string $owner): array {
        $draft = $this->draft($owner);
        $row = $this->portrait($draft['token']);
        $matches = $row && hash_equals($row['identity_hash'], $draft['hash']);
        $state = $matches ? $row['status'] : 'not_generated';
        $error = $matches ? $row['last_error'] : '';
        return [
            'status' => $state, 'error' => $error,
            'attempts_remaining' => max(0, 3 - (int)($row['attempts'] ?? 0)),
            'retry_after' => $row && $state !== 'pending' ? max(0, 30 - (int)$row['age']) : 0,
            'image_url' => $state === 'generated'
                ? 'api/auth.php?action=register_portrait_image&revision=' . $row['attempt_id'] : null,
        ];
    }

    public function generate(string $owner, string $token, string $ipHash, Closure $enqueue): array {
        $this->db->beginTransaction();
        try {
            $draft = $this->draft($owner, $token, true);
            $row = $this->portrait($token);
            if ($row && in_array($row['status'], ['generated', 'pending'], true)
                && hash_equals($row['identity_hash'], $draft['hash'])) {
                $this->db->commit();
                return $this->status($owner);
            }
            if ($row && ((int)$row['attempts'] >= 3 || (int)$row['age'] < 30)) {
                throw new RuntimeException('Portrait retry limit reached or cooldown still active. Check portrait status.', 429);
            }
            $this->db->prepare(
                'INSERT INTO registration_limits (ip_hash, attempts) VALUES (?, 1)
                 ON DUPLICATE KEY UPDATE attempts = IF(window_start <= DATE_SUB(NOW(), INTERVAL 1 HOUR), 1, attempts + 1),
                 window_start = IF(window_start <= DATE_SUB(NOW(), INTERVAL 1 HOUR), NOW(), window_start)'
            )->execute([$ipHash]);
            $limit = $this->db->prepare('SELECT attempts FROM registration_limits WHERE ip_hash = ?');
            $limit->execute([$ipHash]);
            if ((int)$limit->fetchColumn() > 10) throw new RuntimeException('Too many portrait requests. Try again later.', 429);
            $attempt = bin2hex(random_bytes(16));
            $this->db->prepare(
                "INSERT INTO registration_portraits (draft_token, identity_hash, attempt_id, status)
                 VALUES (?, ?, ?, 'pending') ON DUPLICATE KEY UPDATE
                 identity_hash = VALUES(identity_hash), attempt_id = VALUES(attempt_id), status = 'pending',
                 attempts = attempts + 1, started_at = UTC_TIMESTAMP(), last_error = '', image = NULL"
            )->execute([$token, $draft['hash'], $attempt]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }

        try {
            $enqueue($draft['snapshot'], $attempt);
        } catch (RuntimeException | ErrorException | LengthException $error) {
            $message = mb_substr($error->getMessage(), 0, 255);
            error_log('registration_portrait_enqueue_failed message=' . $message);
            $this->complete($owner, $token, $draft['hash'], $attempt, 'failed', $message, null);
            throw new RuntimeException($message, 503, $error);
        }
        return $this->status($owner);
    }

    public function progress(string $owner, string $token, Closure $poll): array {
        $draft = $this->draft($owner, $token);
        $row = $this->portrait($token);
        if (!$row || $row['status'] !== 'pending' || !hash_equals($row['identity_hash'], $draft['hash'])) {
            return $this->status($owner);
        }

        try {
            $result = $poll($row['attempt_id'], (int)$row['age']);
        } catch (LengthException $error) {
            $result = ['status' => 'failed', 'error' => $error->getMessage()];
        } catch (RuntimeException | ErrorException $error) {
            error_log('registration_portrait_progress_failed message=' . $error->getMessage());
            throw new RuntimeException('Portrait status is temporarily unavailable. Please retry.', 503, $error);
        }
        if (!is_array($result) || !in_array($result['status'] ?? null, ['pending', 'generated', 'failed'], true)) {
            error_log('registration_portrait_progress_invalid_result');
            throw new RuntimeException('Portrait status is temporarily unavailable. Please retry.', 503);
        }
        if ($result['status'] === 'pending') return $this->status($owner);

        $bytes = $result['image'] ?? null;
        $failure = '';
        if ($result['status'] === 'failed') {
            $failure = is_string($result['error'] ?? null) && $result['error'] !== ''
                ? $result['error'] : 'Portrait generation failed. Please retry.';
            $bytes = null;
        } elseif (!is_string($bytes) || strlen($bytes) > self::MAX_BYTES) {
            $failure = 'Portrait exceeds the supported image size.';
            $bytes = null;
        } else {
            $image = @getimagesizefromstring($bytes);
            if (!$image || $image[2] !== IMAGETYPE_PNG || $image[0] !== 768 || $image[1] !== 1024) {
                $failure = 'Portrait generator did not return a valid 768 x 1024 PNG.';
                $bytes = null;
            }
        }
        if ($failure !== '') {
            $failure = mb_substr($failure, 0, 255);
            error_log('registration_portrait_failed message=' . $failure);
        }
        $this->complete($owner, $token, $draft['hash'], $row['attempt_id'],
            $failure === '' ? 'generated' : 'failed', $failure, $bytes);
        return $this->status($owner);
    }

    private function complete(
        string $owner, string $token, string $identityHash, string $attempt, string $status, string $failure, ?string $bytes
    ): void {
        $this->db->beginTransaction();
        try {
            $current = $this->draft($owner, $token, true);
            if (!hash_equals($current['hash'], $identityHash)) {
                throw new RuntimeException('Character changed during generation. The old portrait was discarded.', 409);
            }
            $stmt = $this->db->prepare(
                "UPDATE registration_portraits SET status = ?, last_error = ?, image = ?
                 WHERE draft_token = ? AND identity_hash = ? AND attempt_id = ? AND status = 'pending'"
            );
            $stmt->execute([$status, $failure, $bytes, $token, $identityHash, $attempt]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }

    public function image(string $owner, string $revision): string {
        $draft = $this->draft($owner);
        $stmt = $this->db->prepare(
            "SELECT image FROM registration_portraits
             WHERE draft_token = ? AND identity_hash = ? AND attempt_id = ? AND status = 'generated'"
        );
        $stmt->execute([$draft['token'], $draft['hash'], $revision]);
        $bytes = $stmt->fetchColumn();
        if (!is_string($bytes)) throw new RuntimeException('Private portrait not found.', 404);
        return $bytes;
    }
}
