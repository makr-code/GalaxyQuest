<?php

declare(strict_types=1);

namespace GalaxyQuest\Combat;

use DomainException;
use InvalidArgumentException;
use PDO;
use RuntimeException;

/**
 * Internal locked read of an isolated journal; this is not a settlement service.
 */
final class LiveBattleLossProjectionReader
{
    public function __construct(private PDO $db)
    {
    }

    /**
     * The user identity must come from trusted server-side authentication.
     * The caller owns the transaction and must commit or roll back.
     *
     * @return array<string, mixed>
     */
    public function readForParticipant(int $userId, int $journalId): array
    {
        if ($userId <= 0 || $journalId <= 0) {
            throw new InvalidArgumentException('Positive participant and journal IDs are required.');
        }
        (new LiveBattleJournal($this->db))->requireTransactionalStorage();
        $engine = $this->db->query(
            "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
             AND TABLE_NAME='live_battle_journal_participants'"
        )->fetchColumn();
        if ($engine !== 'InnoDB') {
            throw new RuntimeException('Live battle participant authorization requires InnoDB storage.');
        }
        $foreignKey = $this->db->query(
            "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='live_battle_journal_participants'
             GROUP BY CONSTRAINT_NAME
             HAVING COUNT(*)=1 AND MAX(COLUMN_NAME)='journal_id'
                 AND MAX(REFERENCED_TABLE_SCHEMA)=DATABASE()
                 AND MAX(REFERENCED_TABLE_NAME)='live_battle_journals'
                 AND MAX(REFERENCED_COLUMN_NAME)='id'"
        )->fetchColumn();
        if ($foreignKey === false) {
            throw new RuntimeException('Live battle participants require their journal foreign key.');
        }
        $journal = $this->db->prepare('SELECT id FROM live_battle_journals WHERE id=? FOR UPDATE');
        $journal->execute([$journalId]);
        if ($journal->fetchColumn() === false) {
            throw new DomainException('Live battle journal not found.', 404);
        }
        $participants = $this->db->prepare(
            'SELECT side,user_id FROM live_battle_journal_participants WHERE journal_id=? ORDER BY side FOR UPDATE'
        );
        $participants->execute([$journalId]);
        $authorized = false;
        foreach ($participants->fetchAll(PDO::FETCH_ASSOC) as $participant) {
            if ((int)$participant['user_id'] === $userId) {
                $authorized = true;
            }
        }
        if (!$authorized) {
            throw new DomainException('Live battle journal not found.', 404);
        }
        return $this->read($journalId);
    }

    /**
     * Unscoped trusted-server read. The caller owns and must finish the transaction.
     *
     * @return array<string, mixed>
     */
    public function read(int $journalId): array
    {
        if ($journalId <= 0) {
            throw new InvalidArgumentException('A positive journal ID is required.');
        }
        (new LiveBattleJournal($this->db))->requireTransactionalStorage();
        $foreignKey = $this->db->query(
            "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='live_battle_journal_ticks'
             GROUP BY CONSTRAINT_NAME
             HAVING COUNT(*)=1 AND MAX(COLUMN_NAME)='journal_id'
                 AND MAX(REFERENCED_TABLE_SCHEMA)=DATABASE()
                 AND MAX(REFERENCED_TABLE_NAME)='live_battle_journals'
                 AND MAX(REFERENCED_COLUMN_NAME)='id'"
        )->fetchColumn();
        if ($foreignKey === false) {
            throw new RuntimeException('Live battle history requires its journal foreign key.');
        }
        $query = $this->db->prepare(
            'SELECT rule_version,tick,status,next_tick_at,initial_state_json,state_json
             FROM live_battle_journals WHERE id=? FOR UPDATE'
        );
        $query->execute([$journalId]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            throw new DomainException('Live battle journal not found.', 404);
        }
        if ($row['rule_version'] !== LiveBattleRules::RULE_VERSION) {
            throw new RuntimeException('Unsupported live battle rule version.');
        }
        if ($row['status'] !== 'resolved') {
            throw new DomainException('Live battle journal is not resolved.', 409);
        }
        $tick = (int)$row['tick'];
        if ($tick < 1 || $tick > LiveBattleRules::MAX_TICKS || $row['next_tick_at'] !== null) {
            throw new RuntimeException('Invalid terminal live battle journal revision.');
        }
        $initial = json_decode($row['initial_state_json'], true, 512, JSON_THROW_ON_ERROR);
        $current = json_decode($row['state_json'], true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($initial) || !is_array($current) || ($current['tick'] ?? null) !== $tick) {
            throw new RuntimeException('Invalid terminal live battle journal snapshot.');
        }
        $history = $this->db->prepare(
            'SELECT tick,state_json,events_json FROM live_battle_journal_ticks
             WHERE journal_id=? ORDER BY tick LIMIT 301 FOR UPDATE'
        );
        $history->execute([$journalId]);
        $rows = $history->fetchAll(PDO::FETCH_ASSOC);
        if (count($rows) !== $tick) {
            throw new RuntimeException('Live battle journal history does not match its revision.');
        }
        $ticks = [];
        foreach ($rows as $item) {
            $state = json_decode($item['state_json'], true, 512, JSON_THROW_ON_ERROR);
            $events = json_decode($item['events_json'], true, 512, JSON_THROW_ON_ERROR);
            if (!is_array($state) || !is_array($events)) {
                throw new RuntimeException('Invalid persisted live battle tick.');
            }
            $ticks[] = ['tick' => (int)$item['tick'], 'state' => $state, 'events' => $events];
        }
        return LiveBattleLossProjection::project($journalId, $initial, $ticks, $current);
    }
}
