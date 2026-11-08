<?php

declare(strict_types=1);

namespace GalaxyQuest\Combat;

use DomainException;
use PDO;
use RuntimeException;

/**
 * Journals legacy resolution inside the caller's fleet-arrival transaction.
 * No independently committed phase or gameplay clock is introduced.
 */
final class BattleEncounterService
{
    public function __construct(private PDO $db)
    {
    }

    private function assertTransactionalStorage(): void
    {
        if (!$this->db->inTransaction()) {
            throw new RuntimeException('Battle encounters require the fleet arrival transaction.');
        }
        $tables = $this->db->query(
            "SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
             ('battle_encounters', 'battle_encounter_participants', 'battle_encounter_events')"
        )->fetchAll(PDO::FETCH_KEY_PAIR);
        if (count($tables) !== 3 || array_unique(array_values($tables)) !== ['InnoDB']) {
            throw new RuntimeException('Battle encounters require all three InnoDB tables before activation.');
        }
    }

    /**
     * @param array<string, mixed> $fleet
     * @param array<string, mixed> $target
     * @param array<string, int> $attackerShips
     * @param array<string, int> $defenderShips
     */
    public function begin(
        array $fleet,
        array $target,
        array $attackerShips,
        array $defenderShips,
        string $seed
    ): int {
        $this->assertTransactionalStorage();
        $claim = $this->db->prepare('SELECT returning, mission FROM fleets WHERE id=? FOR UPDATE');
        $claim->execute([$fleet['id']]);
        $current = $claim->fetch(PDO::FETCH_ASSOC);
        if (!$current || (int)$current['returning'] !== 0 || $current['mission'] !== 'attack') {
            throw new RuntimeException('Encounter source must be a locked outbound attack fleet.');
        }
        $duplicate = $this->db->prepare('SELECT id FROM battle_encounters WHERE source_fleet_id=?');
        $duplicate->execute([$fleet['id']]);
        if ($duplicate->fetchColumn() !== false) {
            throw new RuntimeException('Battle encounter already exists for this fleet; refusing repeated effects.');
        }
        $this->db->prepare(
            "INSERT INTO battle_encounters
             (source_fleet_id,target_colony_id,target_body_id,rule_version,seed,status,revision)
             VALUES (?,?,?,'legacy-v1',?,'resolving',1)"
        )->execute([$fleet['id'], $target['id'], $target['body_id'], $seed]);
        $id = (int)$this->db->lastInsertId();
        $user = $this->db->prepare('SELECT control_type FROM users WHERE id=?');
        $participant = $this->db->prepare(
            'INSERT INTO battle_encounter_participants
             (encounter_id,side,user_id,controller_kind,initial_ships_json) VALUES (?,?,?,?,?)'
        );
        foreach (
            ['attacker' => [(int)$fleet['user_id'], $attackerShips],
             'defender' => [(int)$target['user_id'], $defenderShips]] as $side => [$userId, $ships]
        ) {
            $user->execute([$userId]);
            $controller = $user->fetchColumn();
            if (!in_array($controller, ['human', 'npc_engine'], true)) {
                throw new RuntimeException('Encounter participant requires a supported server controller identity.');
            }
            $participant->execute([$id, $side, $userId, $controller, json_encode($ships, JSON_THROW_ON_ERROR)]);
        }
        $this->event($id, 1, 'encounter_created', [
            'rule_version' => 'legacy-v1', 'source_fleet_id' => (int)$fleet['id'],
            'target_body_id' => (int)$target['body_id'],
            'target' => ['galaxy' => (int)$fleet['target_galaxy'],
                'system' => (int)$fleet['target_system'], 'position' => (int)$fleet['target_position']],
        ]);
        return $id;
    }

    /** @param array<string, mixed> $report */
    public function complete(int $id, int $reportId, array $report): void
    {
        $this->assertTransactionalStorage();
        $write = $this->db->prepare(
            "UPDATE battle_encounters SET status='resolved',revision=2,battle_report_id=?,
             outcome_json=?,resolved_at=NOW() WHERE id=? AND status='resolving' AND revision=1"
        );
        $write->execute([$reportId, json_encode($report, JSON_THROW_ON_ERROR), $id]);
        if ($write->rowCount() !== 1) {
            throw new RuntimeException('Encounter completion requires exactly one unresolved revision.');
        }
        $this->event($id, 2, 'encounter_resolved', [
            'battle_report_id' => $reportId, 'report_version' => 1,
            'attacker_wins' => $report['attacker_wins'],
            'illustrative_rounds' => true,
        ]);
    }

    /** @param array<string, mixed> $payload */
    private function event(int $id, int $sequence, string $type, array $payload): void
    {
        $this->db->prepare(
            'INSERT INTO battle_encounter_events (encounter_id,sequence,event_type,payload_json) VALUES (?,?,?,?)'
        )->execute([$id, $sequence, $type, json_encode($payload, JSON_THROW_ON_ERROR)]);
    }

    /** @return array<string, mixed> */
    public function read(int $userId, int $id): array
    {
        $query = $this->db->prepare(
            'SELECT e.* FROM battle_encounters e
             WHERE e.id=? AND EXISTS (SELECT 1 FROM battle_encounter_participants p
             WHERE p.encounter_id=e.id AND p.user_id=?)'
        );
        $query->execute([$id, $userId]);
        $encounter = $query->fetch(PDO::FETCH_ASSOC);
        if (!$encounter) {
            throw new DomainException('Battle encounter not found.', 404);
        }
        foreach (
            ['id', 'source_fleet_id', 'target_colony_id', 'target_body_id', 'revision', 'battle_report_id'] as $key
        ) {
            $encounter[$key] = $encounter[$key] === null ? null : (int)$encounter[$key];
        }
        $encounter['schema_version'] = 1;
        $encounter['outcome'] = $encounter['outcome_json'] === null
            ? null : json_decode($encounter['outcome_json'], true, 512, JSON_THROW_ON_ERROR);
        unset($encounter['outcome_json']);
        $participants = $this->db->prepare(
            'SELECT side,user_id,controller_kind,initial_ships_json
             FROM battle_encounter_participants WHERE encounter_id=? ORDER BY side'
        );
        $participants->execute([$id]);
        $encounter['participants'] = [];
        foreach ($participants->fetchAll(PDO::FETCH_ASSOC) as $participant) {
            $participant['user_id'] = (int)$participant['user_id'];
            $participant['initial_ships'] = json_decode(
                $participant['initial_ships_json'],
                true,
                512,
                JSON_THROW_ON_ERROR
            );
            unset($participant['initial_ships_json']);
            $encounter['participants'][] = $participant;
        }
        $events = $this->db->prepare(
            'SELECT sequence,event_type,payload_json,created_at FROM battle_encounter_events
             WHERE encounter_id=? ORDER BY sequence'
        );
        $events->execute([$id]);
        $encounter['events'] = [];
        foreach ($events->fetchAll(PDO::FETCH_ASSOC) as $event) {
            $event['sequence'] = (int)$event['sequence'];
            $event['payload'] = json_decode($event['payload_json'], true, 512, JSON_THROW_ON_ERROR);
            unset($event['payload_json']);
            $encounter['events'][] = $event;
        }
        return $encounter;
    }

    /** @return array<string, mixed> */
    public function readByReport(int $userId, int $reportId): array
    {
        $query = $this->db->prepare(
            'SELECT e.id FROM battle_encounters e
             WHERE e.battle_report_id=? AND EXISTS (
                 SELECT 1 FROM battle_encounter_participants p
                 WHERE p.encounter_id=e.id AND p.user_id=?
             )'
        );
        $query->execute([$reportId, $userId]);
        $id = $query->fetchColumn();
        if ($id === false) {
            throw new DomainException('Battle encounter not found.', 404);
        }
        return $this->read($userId, (int)$id);
    }
}
