<?php
declare(strict_types=1);

final class RegistrationPortraitService {
    public const MAX_BYTES = 2097152;
    public const LEASE_SECONDS = 300;

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
        if ($state === 'pending' && (int)$row['age'] >= self::LEASE_SECONDS) {
            $state = 'failed';
            $error = 'Portrait generation timed out. You may retry.';
        }
        return [
            'status' => $state, 'error' => $error,
            'attempts_remaining' => max(0, 3 - (int)($row['attempts'] ?? 0)),
            'retry_after' => $row ? max(0, ($row['status'] === 'pending' && $matches ? self::LEASE_SECONDS : 30) - (int)$row['age']) : 0,
            'image_url' => $state === 'generated'
                ? 'api/auth.php?action=register_portrait_image&revision=' . $row['attempt_id'] : null,
        ];
    }

    public function generate(string $owner, string $token, string $ipHash, Closure $render): array {
        $this->db->beginTransaction();
        try {
            $draft = $this->draft($owner, $token, true);
            $row = $this->portrait($token);
            if ($row && $row['status'] === 'generated' && hash_equals($row['identity_hash'], $draft['hash'])) {
                $this->db->commit();
                return $this->status($owner);
            }
            if ($row && $row['status'] === 'pending' && hash_equals($row['identity_hash'], $draft['hash']) && (int)$row['age'] < self::LEASE_SECONDS) {
                throw new RuntimeException('A portrait is already being generated. Check its status shortly.', 409);
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

        $bytes = null;
        $failure = '';
        try {
            $bytes = $render($draft['snapshot']);
            if (!is_string($bytes) || strlen($bytes) > self::MAX_BYTES) {
                throw new RuntimeException('Portrait exceeds the supported image size.', 503);
            }
            $image = @getimagesizefromstring($bytes);
            if (!$image || $image[2] !== IMAGETYPE_PNG || $image[0] !== 768 || $image[1] !== 1024) {
                throw new RuntimeException('Portrait generator did not return a valid 768 x 1024 PNG.', 503);
            }
        } catch (RuntimeException | ErrorException $error) {
            $failure = mb_substr($error->getMessage(), 0, 255);
            $bytes = null;
            error_log('registration_portrait_failed message=' . $failure);
        }
        $this->db->beginTransaction();
        try {
            $current = $this->draft($owner, $token, true);
            if (!hash_equals($current['hash'], $draft['hash'])) {
                throw new RuntimeException('Character changed during generation. The old portrait was discarded.', 409);
            }
            $stmt = $this->db->prepare(
                "UPDATE registration_portraits SET status = ?, last_error = ?, image = ?
                 WHERE draft_token = ? AND attempt_id = ? AND status = 'pending'"
            );
            $stmt->execute([$failure === '' ? 'generated' : 'failed', $failure, $bytes, $token, $attempt]);
            if ($stmt->rowCount() !== 1) throw new RuntimeException('Portrait request was replaced. Reload its status.', 409);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
        if ($failure !== '') throw new RuntimeException($failure, 503);
        return $this->status($owner);
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
