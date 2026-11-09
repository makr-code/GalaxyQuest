<?php

declare(strict_types=1);

namespace GalaxyQuest\Combat;

use InvalidArgumentException;
use PDO;
use RuntimeException;
use Throwable;

/**
 * Processes isolated experimental journals, not production encounters.
 */
final class LiveBattleJournalWorker
{
    public const MAX_BATCH = 100;

    public function __construct(private PDO $db)
    {
    }

    /**
     * The result describes a point-in-time backlog, including rows locked by other workers.
     * Every completed tick commits separately; a later failure does not undo earlier ticks.
     *
     * @return array{processed: int, due_journals: int, oldest_due_at: string|null}
     */
    public function runBatch(int $limit): array
    {
        if ($limit < 1 || $limit > self::MAX_BATCH) {
            throw new InvalidArgumentException('Batch limit must be between 1 and 100.');
        }
        $this->requireIdleConnection();
        $journal = new LiveBattleJournal($this->db);
        $processed = 0;
        while ($processed < $limit) {
            $id = null;
            $this->db->beginTransaction();
            try {
                $journal->requireTransactionalStorage();
                $row = $this->db->query(
                    "SELECT id,tick FROM live_battle_journals
                     WHERE status='active' AND next_tick_at <= UTC_TIMESTAMP(6)
                     ORDER BY next_tick_at,id LIMIT 1 FOR UPDATE SKIP LOCKED"
                )->fetch(PDO::FETCH_ASSOC);
                if (!$row) {
                    $this->db->commit();
                    break;
                }
                $id = (int)$row['id'];
                $journal->advance($id, (int)$row['tick']);
                $this->db->commit();
                $processed++;
            } catch (Throwable $error) {
                throw new RuntimeException(
                    'Live battle worker failed' . ($id === null ? '' : ' for journal ' . $id)
                    . ' after committing ' . $processed . ' ticks.',
                    0,
                    $error
                );
            } finally {
                if ($this->db->inTransaction()) {
                    $this->db->rollBack();
                }
            }
        }
        $backlog = $this->db->query(
            "SELECT COUNT(*) AS due_journals, MIN(next_tick_at) AS oldest_due_at
             FROM live_battle_journals WHERE status='active' AND next_tick_at <= UTC_TIMESTAMP(6)"
        )->fetch(PDO::FETCH_ASSOC);
        return [
            'processed' => $processed,
            'due_journals' => (int)$backlog['due_journals'],
            'oldest_due_at' => $backlog['oldest_due_at'],
        ];
    }

    private function requireIdleConnection(): void
    {
        if ($this->db->inTransaction()) {
            throw new RuntimeException(
                'Live battle worker requires a dedicated connection without an active transaction.'
            );
        }
    }
}
