<?php

declare(strict_types=1);

namespace GalaxyQuest\Combat;

use DomainException;
use InvalidArgumentException;
use PDO;
use RuntimeException;

/**
 * Inert persistence preparation; callers must own the encounter transaction.
 */
final class ShipWreckStore
{
    public function __construct(private PDO $db)
    {
    }

    /**
     * Persist explicit contents against an existing server-written loss event.
     *
     * @param array<array-key, mixed> $contents
     * @return array<string, mixed>
     */
    public function record(int $encounterId, int $sequence, array $contents): array
    {
        if ($encounterId <= 0 || $sequence <= 0) {
            throw new InvalidArgumentException('A wreck requires a positive encounter ID and event sequence.');
        }
        $this->requireTransactionalStorage();
        $encounter = $this->db->prepare('SELECT rule_version FROM battle_encounters WHERE id=? FOR UPDATE');
        $encounter->execute([$encounterId]);
        if ($encounter->fetchColumn() !== LiveBattleRules::RULE_VERSION) {
            throw new DomainException('Live battle encounter not found or unsupported.', 404);
        }
        $event = $this->db->prepare(
            'SELECT event_type, payload_json FROM battle_encounter_events
             WHERE encounter_id=? AND sequence=? FOR UPDATE'
        );
        $event->execute([$encounterId, $sequence]);
        $row = $event->fetch(PDO::FETCH_ASSOC);
        if (!$row || $row['event_type'] !== 'ship_group_loss') {
            throw new DomainException('Persisted ship loss event not found.', 404);
        }
        $payload = json_decode($row['payload_json'], true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($payload)) {
            throw new RuntimeException('Persisted ship loss event has an invalid payload.');
        }
        $manifest = ShipWreckManifest::fromLoss($encounterId, $sequence, $payload, $contents);
        $json = json_encode($manifest, JSON_THROW_ON_ERROR);
        $hash = hash('sha256', $json);
        $existing = $this->db->prepare(
            'SELECT manifest_sha256 FROM ship_wreck_fields WHERE encounter_id=? AND event_sequence=? FOR UPDATE'
        );
        $existing->execute([$encounterId, $sequence]);
        $storedHash = $existing->fetchColumn();
        if ($storedHash !== false) {
            if (!hash_equals($storedHash, $hash)) {
                throw new DomainException('Wreck source already has different contents.', 409);
            }
            return $manifest;
        }
        $insert = $this->db->prepare(
            'INSERT INTO ship_wreck_fields (encounter_id,event_sequence,manifest_json,manifest_sha256) VALUES (?,?,?,?)'
        );
        $insert->execute([$encounterId, $sequence, $json, $hash]);
        return $manifest;
    }

    /**
     * @return array<string, mixed>
     */
    public function readForParticipant(int $userId, int $encounterId, int $sequence): array
    {
        if ($userId <= 0 || $encounterId <= 0 || $sequence <= 0) {
            throw new InvalidArgumentException('Wreck lookup requires positive identifiers.');
        }
        $query = $this->db->prepare(
            'SELECT w.manifest_json FROM ship_wreck_fields w
             WHERE w.encounter_id=? AND w.event_sequence=? AND EXISTS (
                 SELECT 1 FROM battle_encounter_participants p
                 WHERE p.encounter_id=w.encounter_id AND p.user_id=?
             )'
        );
        $query->execute([$encounterId, $sequence, $userId]);
        $json = $query->fetchColumn();
        if ($json === false) {
            throw new DomainException('Wreck field not found.', 404);
        }
        $manifest = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($manifest)) {
            throw new RuntimeException('Persisted wreck manifest is invalid.');
        }
        return $manifest;
    }

    private function requireTransactionalStorage(): void
    {
        if (!$this->db->inTransaction()) {
            throw new RuntimeException('Wreck creation requires the encounter transaction.');
        }
        $tables = $this->db->query(
            "SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
             ('battle_encounters', 'battle_encounter_events', 'ship_wreck_fields')"
        )->fetchAll(PDO::FETCH_KEY_PAIR);
        if (count($tables) !== 3 || array_unique(array_values($tables)) !== ['InnoDB']) {
            throw new RuntimeException('Wreck creation requires all three InnoDB tables.');
        }
    }
}
