<?php

declare(strict_types=1);

namespace GalaxyQuest\Combat;

use DomainException;
use PDO;
use RuntimeException;

final class FleetDispatchReceipt
{
    public function __construct(private PDO $db)
    {
    }

    /** @param array<string, mixed> $body */
    public static function requestKey(array $body): ?string
    {
        if (!array_key_exists('request_id', $body)) {
            return null;
        }
        $key = $body['request_id'];
        if (!is_string($key) || !preg_match('/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/D', $key)) {
            throw new DomainException('Invalid fleet request ID.', 400);
        }
        return $key;
    }

    /** @param array<string, mixed> $body */
    public static function fingerprint(array $body): string
    {
        unset($body['request_id']);
        return hash('sha256', json_encode(self::canonicalize($body), JSON_THROW_ON_ERROR));
    }

    private static function canonicalize(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (!array_is_list($value)) {
            ksort($value, SORT_STRING);
        }
        return array_map(self::canonicalize(...), $value);
    }

    /**
     * Called while ResourceLedger holds the initiating user's lock.
     * @return array{fleet_id: int, arrival_time: string}|null
     */
    public function replay(int $userId, string $key, string $fingerprint): ?array
    {
        $this->assertTransactionalStorage();
        $query = $this->db->prepare(
            'SELECT payload_hash, fleet_id, arrival_time FROM fleet_dispatch_receipts
             WHERE user_id = ? AND request_id = ?'
        );
        $query->execute([$userId, $key]);
        $receipt = $query->fetch(PDO::FETCH_ASSOC);
        if (!$receipt) {
            return null;
        }
        if (!hash_equals($receipt['payload_hash'], $fingerprint)) {
            throw new DomainException('Fleet request ID was already used for a different order.', 409);
        }
        return ['fleet_id' => (int)$receipt['fleet_id'], 'arrival_time' => (string)$receipt['arrival_time']];
    }

    /** @param array{fleet_id: int, arrival_time: string} $result */
    public function record(int $userId, string $key, string $fingerprint, array $result): void
    {
        $this->db->prepare(
            'INSERT INTO fleet_dispatch_receipts (user_id, request_id, payload_hash, fleet_id, arrival_time)
             VALUES (?, ?, ?, ?, ?)'
        )->execute([$userId, $key, $fingerprint, $result['fleet_id'], $result['arrival_time']]);
    }

    private function assertTransactionalStorage(): void
    {
        if (!$this->db->inTransaction()) {
            throw new RuntimeException('Fleet dispatch receipts require a transaction and user lock.');
        }
        if ($this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
            $query = $this->db->query(
                "SELECT ENGINE FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleet_dispatch_receipts'"
            );
            if ($query->fetchColumn() !== 'InnoDB') {
                throw new RuntimeException('Fleet dispatch receipts require the InnoDB migration before use.');
            }
        }
    }
}
