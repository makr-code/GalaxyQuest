<?php

declare(strict_types=1);

namespace GalaxyQuest\Combat;

use DomainException;
use InvalidArgumentException;
use PDO;
use RuntimeException;

/**
 * Read-only, participant-scoped synchronization of isolated journals.
 */
final class LiveBattleJournalRead
{
    public const MAX_PAGE_SIZE = 100;

    public function __construct(private PDO $db)
    {
    }

    /** @return array<string, mixed> */
    public function lossProjection(int $userId, int $id): array
    {
        $this->validateIdentifiers($userId, $id);
        $this->requireCommittedReads();
        $this->db->beginTransaction();
        try {
            $projection = (new LiveBattleLossProjectionReader($this->db))->readForParticipant($userId, $id);
            $this->db->commit();
            return $projection;
        } finally {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
        }
    }

    /** @return array<string, mixed> */
    public function snapshot(int $userId, int $id): array
    {
        $this->validateIdentifiers($userId, $id);
        $this->requireCommittedReads();
        $query = $this->db->prepare(
            'SELECT j.id,j.rule_version,j.tick,j.status,j.state_json,j.next_tick_at
             FROM live_battle_journals j
             WHERE j.id=? AND EXISTS (
                 SELECT 1 FROM live_battle_journal_participants p
                 WHERE p.journal_id=j.id AND p.user_id=?
             )'
        );
        $query->execute([$id, $userId]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new DomainException('Live battle journal not found.', 404);
        }
        $state = json_decode($row['state_json'], true, 512, JSON_THROW_ON_ERROR);
        if (
            !is_array($state) || ($state['tick'] ?? null) !== (int)$row['tick']
            || ($state['rule_version'] ?? null) !== $row['rule_version']
            || ($state['status'] ?? null) !== $row['status']
        ) {
            throw new RuntimeException('Live battle journal snapshot does not match its revision.');
        }
        return [
            'schema_version' => 1,
            'journal_id' => (int)$row['id'],
            'tick' => (int)$row['tick'],
            'state' => $state,
            'next_tick_at_utc' => $row['next_tick_at'],
        ];
    }

    /** @return array<string, mixed> */
    public function ticks(int $userId, int $id, int $afterTick, int $limit): array
    {
        $this->validateIdentifiers($userId, $id);
        if ($afterTick < 0 || $limit < 1 || $limit > self::MAX_PAGE_SIZE) {
            throw new InvalidArgumentException('Invalid tick cursor or page limit.');
        }
        $this->requireCommittedReads();
        $query = $this->db->prepare(
            'SELECT j.rule_version,j.tick AS latest_tick,t.tick,t.state_json,t.events_json
             FROM live_battle_journals j
             LEFT JOIN live_battle_journal_ticks t
                 ON t.journal_id=j.id AND t.tick>? AND t.tick<=j.tick
             WHERE j.id=? AND EXISTS (
                 SELECT 1 FROM live_battle_journal_participants p
                 WHERE p.journal_id=j.id AND p.user_id=?
             ) ORDER BY t.tick LIMIT ' . $limit
        );
        $query->execute([$afterTick, $id, $userId]);
        $rows = $query->fetchAll(PDO::FETCH_ASSOC);
        if ($rows === []) {
            throw new DomainException('Live battle journal not found.', 404);
        }
        $latest = (int)$rows[0]['latest_tick'];
        if ($afterTick > $latest) {
            throw new DomainException('Tick cursor is ahead of the journal.', 409);
        }
        $next = $afterTick;
        $ticks = [];
        foreach ($rows as $row) {
            if ($row['tick'] === null) {
                continue;
            }
            if ((int)$row['tick'] !== $next + 1) {
                throw new RuntimeException('Live battle tick history contains a gap.');
            }
            $state = json_decode($row['state_json'], true, 512, JSON_THROW_ON_ERROR);
            $events = json_decode($row['events_json'], true, 512, JSON_THROW_ON_ERROR);
            if (
                !is_array($state) || ($state['tick'] ?? null) !== (int)$row['tick']
                || ($state['rule_version'] ?? null) !== $row['rule_version']
                || !is_array($events) || !array_is_list($events)
            ) {
                throw new RuntimeException('Live battle tick history is invalid.');
            }
            $next++;
            $ticks[] = ['tick' => $next, 'state' => $state, 'events' => $events];
        }
        if ($next < $latest && count($ticks) < $limit) {
            throw new RuntimeException('Live battle tick history contains a gap.');
        }
        return [
            'schema_version' => 1,
            'journal_id' => $id,
            'latest_tick' => $latest,
            'next_cursor' => $next,
            'has_more' => $next < $latest,
            'ticks' => $ticks,
        ];
    }

    private function validateIdentifiers(int $userId, int $id): void
    {
        if ($userId <= 0 || $id <= 0) {
            throw new InvalidArgumentException('Journal lookup requires positive identifiers.');
        }
    }

    private function requireCommittedReads(): void
    {
        if ($this->db->inTransaction()) {
            throw new RuntimeException('Live battle reads require a connection without an active transaction.');
        }
        if ($this->db->query('SELECT @@transaction_isolation')->fetchColumn() === 'READ-UNCOMMITTED') {
            throw new RuntimeException('Live battle reads require committed transaction isolation.');
        }
    }
}
