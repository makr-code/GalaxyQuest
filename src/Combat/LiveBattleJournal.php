<?php

declare(strict_types=1);

namespace GalaxyQuest\Combat;

use DomainException;
use InvalidArgumentException;
use PDO;
use RuntimeException;

/**
 * Isolated rules journal. The caller owns the transaction and must roll it back on errors.
 */
final class LiveBattleJournal
{
    public function __construct(private PDO $db)
    {
    }

    /**
     * The caller supplies trusted server-side fleet specifications and participant identities.
     *
     * @param array<array-key, mixed> $fleets
     * @param array<array-key, mixed> $participants
     */
    public function begin(array $fleets, array $participants): int
    {
        $this->requireTransactionalStorage();
        if (
            count($participants) !== 2 || !isset($participants['attacker'], $participants['defender'])
            || !is_int($participants['attacker']) || $participants['attacker'] <= 0
            || !is_int($participants['defender']) || $participants['defender'] <= 0
        ) {
            throw new InvalidArgumentException('A live battle requires two valid participant identities.');
        }
        $engine = $this->db->query(
            "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
             AND TABLE_NAME='live_battle_journal_participants'"
        )->fetchColumn();
        if ($engine !== 'InnoDB') {
            throw new RuntimeException('Live battle participants require InnoDB storage.');
        }
        $state = LiveBattleRules::begin($fleets);
        $this->db->prepare(
            "INSERT INTO live_battle_journals (rule_version,tick,status,initial_state_json,state_json,next_tick_at)
             VALUES (?,0,'active',?,?,DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 SECOND))"
        )->execute([
            LiveBattleRules::RULE_VERSION,
            json_encode($state, JSON_THROW_ON_ERROR),
            json_encode($state, JSON_THROW_ON_ERROR),
        ]);
        $id = (int)$this->db->lastInsertId();
        $insert = $this->db->prepare(
            'INSERT INTO live_battle_journal_participants (journal_id,side,user_id) VALUES (?,?,?)'
        );
        foreach (['attacker', 'defender'] as $side) {
            $insert->execute([$id, $side, $participants[$side]]);
        }
        return $id;
    }

    /**
     * Advance exactly one due tick. Stale callers must reload rather than replay effects.
     *
     * @return array{state: array<string, mixed>, events: list<array<string, mixed>>}
     */
    public function advance(int $id, int $expectedTick): array
    {
        if ($id <= 0 || $expectedTick < 0) {
            throw new InvalidArgumentException('Invalid live battle journal identity or tick.');
        }
        $this->requireTransactionalStorage();
        $query = $this->db->prepare(
            'SELECT rule_version,tick,status,state_json,next_tick_at <= UTC_TIMESTAMP(6) AS due
             FROM live_battle_journals WHERE id=? FOR UPDATE'
        );
        $query->execute([$id]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new DomainException('Live battle journal not found.', 404);
        }
        if ($row['rule_version'] !== LiveBattleRules::RULE_VERSION) {
            throw new RuntimeException('Unsupported live battle rule version.');
        }
        if ((int)$row['tick'] !== $expectedTick || $row['status'] !== 'active') {
            throw new DomainException('Live battle journal revision is stale or resolved.', 409);
        }
        if ((int)$row['due'] !== 1) {
            throw new DomainException('Live battle tick is not due.', 409);
        }
        $state = json_decode($row['state_json'], true, 512, JSON_THROW_ON_ERROR);
        if (
            !is_array($state) || ($state['rule_version'] ?? null) !== $row['rule_version']
            || ($state['tick'] ?? null) !== (int)$row['tick'] || ($state['status'] ?? null) !== $row['status']
        ) {
            throw new RuntimeException('Live battle journal state does not match its revision.');
        }
        $result = LiveBattleRules::advance($state);
        $next = $result['state'];
        $stateJson = json_encode($next, JSON_THROW_ON_ERROR);
        $eventsJson = json_encode($result['events'], JSON_THROW_ON_ERROR);
        $this->db->prepare(
            'INSERT INTO live_battle_journal_ticks (journal_id,tick,state_json,events_json) VALUES (?,?,?,?)'
        )->execute([$id, $next['tick'], $stateJson, $eventsJson]);
        $update = $this->db->prepare(
            "UPDATE live_battle_journals SET tick=?,status=?,state_json=?,
             next_tick_at=IF(?='active',DATE_ADD(next_tick_at, INTERVAL 1 SECOND),NULL)
             WHERE id=? AND tick=? AND status='active'"
        );
        $update->execute([$next['tick'], $next['status'], $stateJson, $next['status'], $id, $expectedTick]);
        if ($update->rowCount() !== 1) {
            throw new RuntimeException('Live battle journal update lost its locked revision.');
        }
        return $result;
    }

    public function requireTransactionalStorage(): void
    {
        if (!$this->db->inTransaction()) {
            throw new RuntimeException('Live battle journal requires a caller-owned transaction.');
        }
        $tables = $this->db->query(
            "SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
             ('live_battle_journals','live_battle_journal_ticks')"
        )->fetchAll(PDO::FETCH_KEY_PAIR);
        if (count($tables) !== 2 || array_unique(array_values($tables)) !== ['InnoDB']) {
            throw new RuntimeException('Live battle journal requires both InnoDB tables.');
        }
    }
}
