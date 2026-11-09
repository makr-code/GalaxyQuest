<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration;

use DomainException;
use GalaxyQuest\Combat\LiveBattleJournal;
use GalaxyQuest\Combat\LiveBattleRules;
use GalaxyQuest\Combat\LiveBattleJournalWorker;
use GalaxyQuest\Combat\LiveBattleJournalRead;
use GalaxyQuest\Combat\LiveBattleLossProjection;
use GalaxyQuest\Combat\LiveBattleLossProjectionReader;
use PDO;
use PDOException;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class LiveBattleJournalMySqlTest extends TestCase
{
    private ?PDO $db = null;
    private string $database = '';

    protected function setUp(): void
    {
        $dsn = getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
        if (!$dsn) {
            self::markTestSkipped('Set GQ_RESOURCE_LEDGER_TEST_DSN for isolated MySQL tests.');
        }
        $this->db = new PDO(
            $dsn,
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        self::assertSame('mysql', $this->db->getAttribute(PDO::ATTR_DRIVER_NAME));
        $this->database = 'gq_live_journal_' . bin2hex(random_bytes(8));
        $this->db->exec('CREATE DATABASE `' . $this->database . '`');
        $this->db->exec('USE `' . $this->database . '`');
        $sql = file_get_contents(__DIR__ . '/../../sql/migrate_live_battle_journal_v1.sql');
        if ($sql === false) {
            throw new RuntimeException('Cannot read live battle journal migration.');
        }
        $sql = preg_replace('/^USE galaxyquest;\s*$/m', '', $sql);
        if ($sql === null) {
            throw new RuntimeException('Cannot prepare live battle journal migration.');
        }
        $this->db->exec($sql);
        $this->db->exec($sql);
        $participants = file_get_contents(__DIR__ . '/../../sql/migrate_live_battle_journal_participants_v1.sql');
        if ($participants === false) {
            throw new RuntimeException('Cannot read live battle participant migration.');
        }
        $participants = preg_replace('/^USE galaxyquest;\s*$/m', '', $participants);
        if ($participants === null) {
            throw new RuntimeException('Cannot prepare live battle participant migration.');
        }
        $this->db->exec($participants);
        $this->db->exec($participants);
    }

    protected function tearDown(): void
    {
        if ($this->db !== null && $this->database !== '') {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            $this->db->exec('DROP DATABASE `' . $this->database . '`');
        }
        $this->db = null;
    }

    private function begin(float $attack = 0.0): int
    {
        $group = ['count' => 1, 'attack' => $attack, 'shield' => 0, 'hull' => 10];
        $this->db->beginTransaction();
        $id = (new LiveBattleJournal($this->db))->begin(
            ['attacker' => ['a' => $group], 'defender' => ['b' => $group]],
            ['attacker' => 10, 'defender' => 20]
        );
        $this->db->commit();
        return $id;
    }

    private function makeDue(int $id, int $seconds = 1): void
    {
        $this->db->prepare(
            'UPDATE live_battle_journals SET next_tick_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? SECOND) WHERE id=?'
        )->execute([$seconds, $id]);
    }

    public function testClockRollbackStaleRevisionAndTerminalState(): void
    {
        $id = $this->begin(300.0);
        $journal = new LiveBattleJournal($this->db);
        $this->db->exec('UPDATE live_battle_journals SET next_tick_at=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 60 SECOND)');
        $this->db->beginTransaction();
        try {
            $journal->advance($id, 0);
            self::fail('A future tick must not advance.');
        } catch (DomainException $error) {
            self::assertSame('Live battle tick is not due.', $error->getMessage());
        }

        $this->db->rollBack();
        $this->makeDue($id);
        $this->db->beginTransaction();
        $result = $journal->advance($id, 0);
        self::assertSame('mutual_destruction', $result['state']['outcome']);
        self::assertCount(2, $result['events']);
        $this->db->rollBack();
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
        $this->db->beginTransaction();
        self::assertEquals($result, $journal->advance($id, 0));
        $this->db->commit();
        $row = $this->db->query('SELECT tick,status,next_tick_at FROM live_battle_journals')->fetch(PDO::FETCH_ASSOC);
        self::assertSame(1, (int)$row['tick']);
        self::assertSame('resolved', $row['status']);
        self::assertNull($row['next_tick_at']);
        $this->db->beginTransaction();
        try {
            $journal->advance($id, 0);
            self::fail('A stale retry cannot repeat a tick.');
        } catch (DomainException $error) {
            self::assertSame(409, $error->getCode());
        }
        $this->db->rollBack();
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
        $initial = json_decode(
            $this->db->query('SELECT initial_state_json FROM live_battle_journals')->fetchColumn(),
            true,
            512,
            JSON_THROW_ON_ERROR
        );
        self::assertSame(0, $initial['tick']);
        self::assertSame(1, $initial['groups']['attacker']['a']['count']);
    }

    public function testParticipantLossReadRequiresAuthorizationAndStableCommittedMembership(): void
    {
        $id = $this->begin(300.0);
        $reader = new LiveBattleLossProjectionReader($this->db);
        try {
            $reader->readForParticipant(10, $id);
            self::fail('A transaction is required.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('transaction', $error->getMessage());
        }
        $this->db->beginTransaction();
        try {
            foreach ([[99, $id], [10, $id + 1]] as [$user, $journal]) {
                try {
                    $reader->readForParticipant($user, $journal);
                    self::fail('Unauthorized and missing journals must be rejected.');
                } catch (DomainException $error) {
                    self::assertSame(404, $error->getCode());
                    self::assertSame('Live battle journal not found.', $error->getMessage());
                }
            }
            try {
                $reader->readForParticipant(10, $id);
                self::fail('An active journal must not produce a projection.');
            } catch (DomainException $error) {
                self::assertSame(409, $error->getCode());
            }
        } finally {
            $this->db->rollBack();
        }
        $this->makeDue($id);
        (new LiveBattleJournalWorker($this->db))->runBatch(1);
        $other = new PDO(
            (string)getenv('GQ_RESOURCE_LEDGER_TEST_DSN'),
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $other->exec('USE `' . $this->database . '`');
        $other->exec('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
        $this->db->exec('SET SESSION innodb_lock_wait_timeout=1');
        $other->beginTransaction();
        try {
            $scoped = new LiveBattleLossProjectionReader($other);
            $projection = $scoped->readForParticipant(10, $id);
            self::assertSame('mutual_destruction', $projection['outcome']);
            self::assertSame($projection, $scoped->readForParticipant(20, $id));
            foreach (
                [
                    "UPDATE live_battle_journal_participants SET user_id=99 WHERE journal_id=$id AND side='attacker'",
                    "DELETE FROM live_battle_journal_participants WHERE journal_id=$id AND side='defender'",
                ] as $sql
            ) {
                try {
                    $this->db->exec($sql);
                    self::fail('A competing participant mutation must wait.');
                } catch (PDOException $error) {
                    self::assertSame(1205, $error->errorInfo[1]);
                }
            }
        } finally {
            $other->rollBack();
        }
        $other->exec('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $other->beginTransaction();
        self::assertSame(
            10,
            (int)$other->query("SELECT user_id FROM live_battle_journal_participants
                 WHERE journal_id=$id AND side='attacker'")->fetchColumn()
        );
        $this->db->exec(
            "UPDATE live_battle_journal_participants SET user_id=99 WHERE journal_id=$id AND side='attacker'"
        );
        try {
            try {
                (new LiveBattleLossProjectionReader($other))->readForParticipant(10, $id);
                self::fail('Revoked membership must be rejected.');
            } catch (DomainException $error) {
                self::assertSame(404, $error->getCode());
            }
            self::assertSame('mutual_destruction', (new LiveBattleLossProjectionReader($other))
                ->readForParticipant(99, $id)['outcome']);
        } finally {
            $other->rollBack();
        }
        $this->db->exec("DELETE FROM live_battle_journal_participants WHERE journal_id=$id AND side='defender'");
        $other->exec('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
        $other->beginTransaction();
        try {
            (new LiveBattleLossProjectionReader($other))->readForParticipant(99, $id);
            try {
                $this->db->exec(
                    "INSERT INTO live_battle_journal_participants (journal_id,side,user_id)
                     VALUES ($id,'defender',20)"
                );
                self::fail('A competing participant insert must wait under read committed.');
            } catch (PDOException $error) {
                self::assertSame(1205, $error->errorInfo[1]);
            }
        } finally {
            $other->rollBack();
        }
    }

    public function testParticipantLossReadRequiresSafeParticipantStorage(): void
    {
        $id = $this->begin(300.0);
        $this->makeDue($id);
        (new LiveBattleJournalWorker($this->db))->runBatch(1);
        $this->db->exec(
            'ALTER TABLE live_battle_journal_participants DROP FOREIGN KEY fk_live_journal_participant'
        );
        $reader = new LiveBattleLossProjectionReader($this->db);
        $this->db->beginTransaction();
        try {
            $reader->readForParticipant(10, $id);
            self::fail('Participant foreign key must be required.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('foreign key', $error->getMessage());
        } finally {
            $this->db->rollBack();
        }
        $this->db->exec('ALTER TABLE live_battle_journal_participants ENGINE=MyISAM');
        $this->db->beginTransaction();
        try {
            $reader->readForParticipant(10, $id);
            self::fail('Participant storage must be transactional.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('InnoDB', $error->getMessage());
        } finally {
            $this->db->rollBack();
        }
    }

    public function testLockedLossReaderValidatesTransactionAndTerminalJournal(): void
    {
        $id = $this->begin(300.0);
        $reader = new LiveBattleLossProjectionReader($this->db);
        try {
            $reader->read($id);
            self::fail('Caller transaction must be required.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('transaction', $error->getMessage());
        }
        $this->db->beginTransaction();
        try {
            $reader->read($id);
            self::fail('An active journal cannot produce a terminal projection.');
        } catch (DomainException $error) {
            self::assertSame(409, $error->getCode());
        } finally {
            $this->db->rollBack();
        }
        $this->makeDue($id);
        self::assertSame(1, (new LiveBattleJournalWorker($this->db))->runBatch(1)['processed']);
        $this->db->beginTransaction();
        try {
            $result = $reader->read($id);
            self::assertSame('mutual_destruction', $result['outcome']);
            self::assertSame([0, 1], array_column($result['losses'], 'event_index'));
            self::assertSame([1, 1], array_column($result['losses'], 'ships_lost'));
            self::assertSame($result, $reader->read($id));
            self::assertTrue($this->db->inTransaction());
            try {
                $reader->read($id + 1);
                self::fail('Missing journal must be rejected.');
            } catch (DomainException $error) {
                self::assertSame(404, $error->getCode());
            }
        } finally {
            $this->db->rollBack();
        }
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
    }

    public function testLockedLossReaderRejectsMissingExtraAndChangedHistory(): void
    {
        $id = $this->begin(300.0);
        $this->makeDue($id);
        (new LiveBattleJournalWorker($this->db))->runBatch(1);
        $original = $this->db->query('SELECT events_json FROM live_battle_journal_ticks')->fetchColumn();
        $reader = new LiveBattleLossProjectionReader($this->db);
        $this->db->exec('UPDATE live_battle_journal_ticks SET events_json=JSON_ARRAY()');
        $this->db->beginTransaction();
        try {
            $reader->read($id);
            self::fail('Changed events must be rejected.');
        } catch (\InvalidArgumentException $error) {
            self::assertStringContainsString('does not match', $error->getMessage());
        } finally {
            $this->db->rollBack();
        }
        $this->db->prepare('UPDATE live_battle_journal_ticks SET events_json=?')->execute([$original]);
        $this->db->exec(
            "INSERT INTO live_battle_journal_ticks (journal_id,tick,state_json,events_json)
             SELECT journal_id,2,state_json,events_json FROM live_battle_journal_ticks WHERE tick=1"
        );
        $this->db->beginTransaction();
        try {
            $reader->read($id);
            self::fail('Extra history must be rejected.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('history', $error->getMessage());
        } finally {
            $this->db->rollBack();
        }
        $this->db->exec('DELETE FROM live_battle_journal_ticks');
        $this->db->beginTransaction();
        try {
            $reader->read($id);
            self::fail('Missing history must be rejected.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('history', $error->getMessage());
        } finally {
            $this->db->rollBack();
        }
    }

    public function testLockedLossReaderUsesCurrentCommittedRowsAndBlocksCompetingWrites(): void
    {
        $id = $this->begin(300.0);
        $this->makeDue($id);
        $other = new PDO(
            (string)getenv('GQ_RESOURCE_LEDGER_TEST_DSN'),
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $other->exec('USE `' . $this->database . '`');
        $other->exec('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $other->exec('SET SESSION innodb_lock_wait_timeout=1');
        $other->beginTransaction();
        self::assertSame('active', $other->query('SELECT status FROM live_battle_journals')->fetchColumn());
        self::assertSame(1, (new LiveBattleJournalWorker($this->db))->runBatch(1)['processed']);
        try {
            $result = (new LiveBattleLossProjectionReader($other))->read($id);
            self::assertSame('mutual_destruction', $result['outcome']);
            $this->db->exec('SET SESSION innodb_lock_wait_timeout=1');
            foreach (
                [
                    'UPDATE live_battle_journals SET state_json=state_json WHERE id=' . $id,
                    'DELETE FROM live_battle_journal_ticks WHERE journal_id=' . $id,
                    "INSERT INTO live_battle_journal_ticks (journal_id,tick,state_json,events_json)
                     VALUES ($id,2,JSON_OBJECT(),JSON_ARRAY())",
                ] as $statement
            ) {
                try {
                    $this->db->exec($statement);
                    self::fail('A competing write must not pass the locked read.');
                } catch (PDOException $error) {
                    self::assertSame(1205, $error->errorInfo[1]);
                }
            }
        } finally {
            $other->rollBack();
        }
        $other->exec('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
        $other->beginTransaction();
        try {
            self::assertSame('mutual_destruction', (new LiveBattleLossProjectionReader($other))->read($id)['outcome']);
            try {
                $this->db->exec(
                    "INSERT INTO live_battle_journal_ticks (journal_id,tick,state_json,events_json)
                     VALUES ($id,2,JSON_OBJECT(),JSON_ARRAY())"
                );
                self::fail('The foreign key must block concurrent history inserts under read committed.');
            } catch (PDOException $error) {
                self::assertSame(1205, $error->errorInfo[1]);
            }
        } finally {
            $other->rollBack();
        }
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
    }

    public function testLockedLossReaderRequiresForeignKeyAndTransactionalStorage(): void
    {
        $id = $this->begin(300.0);
        $this->makeDue($id);
        (new LiveBattleJournalWorker($this->db))->runBatch(1);
        $this->db->exec('ALTER TABLE live_battle_journal_ticks DROP FOREIGN KEY fk_live_battle_journal_tick');
        $reader = new LiveBattleLossProjectionReader($this->db);
        $this->db->beginTransaction();
        try {
            $reader->read($id);
            self::fail('History must retain its foreign key.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('foreign key', $error->getMessage());
        } finally {
            $this->db->rollBack();
        }
        $this->db->exec('ALTER TABLE live_battle_journal_ticks ENGINE=MyISAM');
        $this->db->beginTransaction();
        try {
            $reader->read($id);
            self::fail('History must be transactional.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('InnoDB', $error->getMessage());
        } finally {
            $this->db->rollBack();
        }
    }

    public function testLossProjectionMatchesCommittedJournalAndRejectsTamperedHistory(): void
    {
        $id = $this->begin(300.0);
        $this->makeDue($id);
        self::assertSame(1, (new LiveBattleJournalWorker($this->db))->runBatch(1)['processed']);
        $row = $this->db->query('SELECT initial_state_json,state_json FROM live_battle_journals')
            ->fetch(PDO::FETCH_ASSOC);
        $initial = json_decode($row['initial_state_json'], true, 512, JSON_THROW_ON_ERROR);
        $current = json_decode($row['state_json'], true, 512, JSON_THROW_ON_ERROR);
        $records = $this->db->query('SELECT tick,state_json,events_json FROM live_battle_journal_ticks ORDER BY tick')
            ->fetchAll(PDO::FETCH_ASSOC);
        $ticks = array_map(static fn(array $record): array => [
            'tick' => (int)$record['tick'],
            'state' => json_decode($record['state_json'], true, 512, JSON_THROW_ON_ERROR),
            'events' => json_decode($record['events_json'], true, 512, JSON_THROW_ON_ERROR),
        ], $records);
        $projection = LiveBattleLossProjection::project($id, $initial, $ticks, $current);
        self::assertSame('mutual_destruction', $projection['outcome']);
        self::assertSame([0, 1], array_column($projection['losses'], 'event_index'));
        self::assertSame([1, 1], array_column($projection['losses'], 'ships_lost'));
        $ticks[0]['events'][0]['ships_lost'] = 0;
        $this->expectException(\InvalidArgumentException::class);
        LiveBattleLossProjection::project($id, $initial, $ticks, $current);
    }

    public function testCatchUpPreservesDeadlinesAndStopsAtExactly300(): void
    {
        $id = $this->begin();
        $this->makeDue($id, 305);
        $firstDue = $this->db->query('SELECT next_tick_at FROM live_battle_journals')->fetchColumn();
        $journal = new LiveBattleJournal($this->db);
        for ($tick = 0; $tick < LiveBattleRules::MAX_TICKS; $tick++) {
            $this->db->beginTransaction();
            $result = $journal->advance($id, $tick);
            $this->db->commit();
            self::assertSame($tick + 1, $result['state']['tick']);
            if ($tick === 0) {
                $due = $this->db->query('SELECT next_tick_at FROM live_battle_journals')->fetchColumn();
                self::assertSame(
                    1000000,
                    (int)$this->db->query(
                        'SELECT TIMESTAMPDIFF(MICROSECOND, ' . $this->db->quote($firstDue) . ', '
                        . $this->db->quote($due) . ')'
                    )->fetchColumn()
                );
            }
        }
        self::assertSame('stalemate', $result['state']['outcome']);
        self::assertSame(300, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
        self::assertNull($this->db->query('SELECT next_tick_at FROM live_battle_journals')->fetchColumn());
    }

    public function testCompetingWriterCannotAdvanceSameTick(): void
    {
        $id = $this->begin();
        $this->makeDue($id, 5);
        $other = new PDO(
            (string)getenv('GQ_RESOURCE_LEDGER_TEST_DSN'),
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $other->exec('USE `' . $this->database . '`');
        $other->exec('SET SESSION innodb_lock_wait_timeout=1');
        $this->db->beginTransaction();
        (new LiveBattleJournal($this->db))->advance($id, 0);
        $other->beginTransaction();
        try {
            (new LiveBattleJournal($other))->advance($id, 0);
            self::fail('The second writer must wait for the journal lock.');
        } catch (PDOException $error) {
            self::assertSame(1205, $error->errorInfo[1]);
        } finally {
            $other->rollBack();
        }
        $this->db->commit();
        $other->beginTransaction();
        try {
            (new LiveBattleJournal($other))->advance($id, 0);
            self::fail('The stale writer must not advance another tick.');
        } catch (DomainException $error) {
            self::assertSame(409, $error->getCode());
        } finally {
            $other->rollBack();
        }
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
    }

    public function testStorageAndStateMustBeValid(): void
    {
        $id = $this->begin();
        $journal = new LiveBattleJournal($this->db);
        try {
            $journal->advance($id, 0);
            self::fail('A transaction is mandatory.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('transaction', $error->getMessage());
        }
        $this->makeDue($id);
        $this->db->exec("UPDATE live_battle_journals SET state_json=JSON_SET(state_json,'$.tick',99)");
        $this->db->beginTransaction();
        try {
            $journal->advance($id, 0);
            self::fail('Corrupt state must be rejected.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('does not match', $error->getMessage());
        } finally {
            $this->db->rollBack();
        }
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
    }

    public function testTickWriteFailureRollsBackSnapshotAndEvent(): void
    {
        $id = $this->begin();
        $this->makeDue($id);
        $this->db->exec(
            "CREATE TRIGGER reject_journal_update BEFORE UPDATE ON live_battle_journals
             FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected failure'"
        );
        $this->db->beginTransaction();
        try {
            (new LiveBattleJournal($this->db))->advance($id, 0);
            self::fail('The injected write error must propagate.');
        } catch (PDOException $error) {
            self::assertSame('45000', $error->getCode());
        } finally {
            $this->db->rollBack();
        }
        self::assertSame(0, (int)$this->db->query('SELECT tick FROM live_battle_journals')->fetchColumn());
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
    }

    public function testRejectsNonTransactionalStorage(): void
    {
        $id = $this->begin();
        $this->db->exec('ALTER TABLE live_battle_journal_ticks DROP FOREIGN KEY fk_live_battle_journal_tick');
        $this->db->exec('ALTER TABLE live_battle_journal_ticks ENGINE=MyISAM');
        $this->db->beginTransaction();
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('InnoDB');
        (new LiveBattleJournal($this->db))->advance($id, 0);
    }

    public function testWorkerBoundsCatchUpAndKeepsBacklogVisibleAcrossRuns(): void
    {
        $older = $this->begin();
        $newer = $this->begin();
        $this->makeDue($older, 10);
        $this->makeDue($newer, 8);
        $worker = new LiveBattleJournalWorker($this->db);
        $result = $worker->runBatch(3);
        self::assertSame(3, $result['processed']);
        self::assertSame(2, $result['due_journals']);
        self::assertNotNull($result['oldest_due_at']);
        $ticks = $this->db->query('SELECT id,tick FROM live_battle_journals ORDER BY id')
            ->fetchAll(PDO::FETCH_KEY_PAIR);
        self::assertSame(3, (int)$ticks[$older]);
        self::assertSame(0, (int)$ticks[$newer]);
        $result = (new LiveBattleJournalWorker($this->db))->runBatch(2);
        self::assertSame(2, $result['processed']);
        $ticks = $this->db->query('SELECT id,tick FROM live_battle_journals ORDER BY id')
            ->fetchAll(PDO::FETCH_KEY_PAIR);
        self::assertSame(1, (int)$ticks[$newer]);
        self::assertSame(5, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
    }

    public function testWorkerSkipsLockedJournalsAndProcessesOtherWork(): void
    {
        $locked = $this->begin();
        $free = $this->begin();
        $this->makeDue($locked, 20);
        $this->makeDue($free, 10);
        $other = new PDO(
            (string)getenv('GQ_RESOURCE_LEDGER_TEST_DSN'),
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $other->exec('USE `' . $this->database . '`');
        $other->exec('SET SESSION innodb_lock_wait_timeout=1');
        $this->db->beginTransaction();
        $statement = $this->db->prepare('SELECT id FROM live_battle_journals WHERE id=? FOR UPDATE');
        $statement->execute([$locked]);
        try {
            $result = (new LiveBattleJournalWorker($other))->runBatch(1);
            self::assertSame(1, $result['processed']);
            self::assertSame(2, $result['due_journals']);
            self::assertSame(
                $free,
                (int)$other->query('SELECT journal_id FROM live_battle_journal_ticks')->fetchColumn()
            );
            $other->exec(
                'UPDATE live_battle_journals SET next_tick_at=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 60 SECOND)
                 WHERE id=' . $free
            );
            $waiting = (new LiveBattleJournalWorker($other))->runBatch(1);
            self::assertSame(0, $waiting['processed']);
            self::assertSame(1, $waiting['due_journals']);
        } finally {
            $this->db->rollBack();
        }
        self::assertSame(1, (new LiveBattleJournalWorker($other))->runBatch(1)['processed']);
        self::assertSame(2, (int)$other->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
    }

    public function testWorkerReportsFailureWithoutLosingPreviouslyCommittedTicks(): void
    {
        $good = $this->begin();
        $bad = $this->begin();
        $this->makeDue($good, 20);
        $this->makeDue($bad, 10);
        $this->db->exec("UPDATE live_battle_journals SET state_json=JSON_SET(state_json,'$.tick',99) WHERE id=$bad");
        try {
            (new LiveBattleJournalWorker($this->db))->runBatch(20);
            self::fail('Corrupt state must fail the batch.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('journal ' . $bad . ' after committing 11 ticks', $error->getMessage());
            self::assertStringContainsString('does not match', $error->getPrevious()->getMessage());
        }
        self::assertFalse($this->db->inTransaction());
        self::assertSame(11, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
        self::assertSame(
            0,
            (int)$this->db->query("SELECT tick FROM live_battle_journals WHERE id=$bad")->fetchColumn()
        );
    }

    public function testWorkerRejectsInvalidLimitsAndActiveTransactions(): void
    {
        $worker = new LiveBattleJournalWorker($this->db);
        foreach ([0, 101] as $limit) {
            try {
                $worker->runBatch($limit);
                self::fail('Invalid limit must fail.');
            } catch (\InvalidArgumentException $error) {
                self::assertStringContainsString('Batch limit', $error->getMessage());
            }
        }
        $this->db->beginTransaction();
        try {
            $worker->runBatch(1);
            self::fail('A caller transaction must not be used by the worker.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('dedicated connection', $error->getMessage());
            self::assertTrue($this->db->inTransaction());
        }
        $this->db->rollBack();
        self::assertSame(
            ['processed' => 0, 'due_journals' => 0, 'oldest_due_at' => null],
            $worker->runBatch(1)
        );
    }

    public function testWorkerCliIsOptInAndProcessesIsolatedDatabase(): void
    {
        $id = $this->begin();
        $this->makeDue($id, 5);
        $dsn = (string)getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
        parse_str(str_replace(';', '&', substr($dsn, strlen('mysql:'))), $parts);
        if (!isset($parts['host'])) {
            self::markTestSkipped('CLI integration requires a TCP MySQL test DSN.');
        }
        $env = getenv();
        $env['DB_HOST'] = $parts['host'];
        $env['DB_PORT'] = $parts['port'] ?? '3306';
        $env['DB_NAME'] = $this->database;
        $env['DB_USER'] = getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root';
        $env['DB_PASS'] = getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '';
        $env['XDEBUG_MODE'] = 'off';
        $script = __DIR__ . '/../../scripts/process_live_battle_journals.php';

        $run = static function (array $arguments, array $environment) use ($script): array {
            $process = proc_open(
                array_merge([PHP_BINARY, $script], $arguments),
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                null,
                $environment
            );
            if (!is_resource($process)) {
                throw new RuntimeException('Failed to launch the journal worker CLI.');
            }
            fclose($pipes[0]);
            $stdout = stream_get_contents($pipes[1]);
            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            return [proc_close($process), $stdout, $stderr];
        };
        $env['LIVE_BATTLE_JOURNAL_WORKER_ENABLED'] = '0';
        [$exit, $stdout, $stderr] = $run([], $env);
        self::assertSame(1, $exit);
        self::assertSame('', $stdout);
        self::assertStringContainsString('disabled', $stderr);
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
        $env['LIVE_BATTLE_JOURNAL_WORKER_ENABLED'] = '1';
        [$exit, $stdout, $stderr] = $run(['--limit=101'], $env);
        self::assertSame(1, $exit);
        self::assertSame('', $stdout);
        self::assertStringContainsString('Batch limit', $stderr);
        [$exit, $stdout, $stderr] = $run(['--limit=1'], $env);
        self::assertSame(0, $exit, $stderr);
        $result = json_decode($stdout, true, 512, JSON_THROW_ON_ERROR);
        self::assertSame(1, $result['processed']);
        self::assertSame(1, $result['due_journals']);
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
    }

    public function testContinuousWorkerAdvancesStopsRestartsAndSurfacesFailure(): void
    {
        if (PHP_OS_FAMILY === 'Windows') {
            self::markTestSkipped('Continuous worker requires Bash and POSIX process signals.');
        }
        $dsn = (string)getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
        parse_str(str_replace(';', '&', substr($dsn, strlen('mysql:'))), $parts);
        if (!isset($parts['host'])) {
            self::markTestSkipped('Continuous worker requires a TCP MySQL test DSN.');
        }
        $env = getenv();
        $env['DB_HOST'] = $parts['host'];
        $env['DB_PORT'] = $parts['port'] ?? '3306';
        $env['DB_NAME'] = $this->database;
        $env['DB_USER'] = getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root';
        $env['DB_PASS'] = getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '';
        $env['XDEBUG_MODE'] = 'off';
        $env['LIVE_BATTLE_JOURNAL_WORKER_ENABLED'] = '1';
        $script = __DIR__ . '/../../scripts/run_live_battle_journal_worker.sh';
        $start = static function (bool $enabled = true) use ($script, $env): array {
            $env['LIVE_BATTLE_JOURNAL_WORKER_ENABLED'] = $enabled ? '1' : '0';
            $process = proc_open(
                ['bash', $script, '--limit=1'],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                null,
                $env
            );
            if (!is_resource($process)) {
                throw new RuntimeException('Cannot start continuous journal worker.');
            }
            fclose($pipes[0]);
            return [$process, $pipes];
        };
        $waitForTick = function (int $minimum): void {
            $deadline = microtime(true) + 20;
            do {
                $tick = (int)$this->db->query('SELECT tick FROM live_battle_journals')->fetchColumn();
                if ($tick >= $minimum) {
                    return;
                }
                usleep(100_000);
            } while (microtime(true) < $deadline);
            self::fail('Continuous worker did not advance to tick ' . $minimum);
        };
        $finish = static function ($process, array $pipes, bool $terminate): array {
            if ($terminate) {
                proc_terminate($process, 15);
            }
            $deadline = microtime(true) + 10;
            do {
                $status = proc_get_status($process);
                if (!$status['running']) {
                    break;
                }
                usleep(100_000);
            } while (microtime(true) < $deadline);
            if ($status['running']) {
                proc_terminate($process, 9);
                throw new RuntimeException('Continuous worker did not exit.');
            }
            $stdout = stream_get_contents($pipes[1]);
            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($process);
            return [$status['exitcode'], $stdout, $stderr];
        };

        $id = $this->begin();
        [$process, $pipes] = $start();
        $waitError = null;
        try {
            $waitForTick(2);
        } catch (\PHPUnit\Framework\AssertionFailedError $error) {
            $waitError = $error;
        } finally {
            [$exit, $stdout, $stderr] = $finish($process, $pipes, true);
        }
        if ($waitError !== null) {
            self::fail($waitError->getMessage() . "\nWorker stdout: " . $stdout . "\nWorker stderr: " . $stderr);
        }
        self::assertSame(0, $exit, $stderr);
        self::assertStringContainsString('"processed":1', $stdout);
        $stoppedTick = (int)$this->db->query('SELECT tick FROM live_battle_journals')->fetchColumn();
        usleep(1_200_000);
        self::assertSame($stoppedTick, (int)$this->db->query('SELECT tick FROM live_battle_journals')->fetchColumn());

        [$process, $pipes] = $start();
        $waitError = null;
        try {
            $waitForTick($stoppedTick + 1);
        } catch (\PHPUnit\Framework\AssertionFailedError $error) {
            $waitError = $error;
        } finally {
            [$exit, $stdout, $stderr] = $finish($process, $pipes, true);
        }
        if ($waitError !== null) {
            self::fail($waitError->getMessage() . "\nWorker stdout: " . $stdout . "\nWorker stderr: " . $stderr);
        }
        self::assertSame(0, $exit, $stderr);
        $this->db->exec("UPDATE live_battle_journals SET state_json=JSON_SET(state_json,'$.tick',999)");
        $this->makeDue($id, 1);
        [$process, $pipes] = $start();
        [$exit, , $stderr] = $finish($process, $pipes, false);
        self::assertSame(1, $exit);
        self::assertStringContainsString('does not match', $stderr);
        self::assertStringContainsString('batch exited with status 1', $stderr);
        $ticks = $this->db->query('SELECT tick FROM live_battle_journal_ticks ORDER BY tick')
            ->fetchAll(PDO::FETCH_COLUMN);
        self::assertSame(range(1, count($ticks)), array_map('intval', $ticks));
        [$process, $pipes] = $start(false);
        [$exit, , $stderr] = $finish($process, $pipes, false);
        self::assertSame(1, $exit);
        self::assertStringContainsString('disabled', $stderr);
        self::assertSame(
            count($ticks),
            (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn()
        );
    }

    public function testConcurrentWorkersSkipLockedJournalAndRecoverAfterCrash(): void
    {
        if (PHP_OS_FAMILY === 'Windows') {
            self::markTestSkipped('This crash test requires POSIX SIGKILL.');
        }
        $dsn = (string)getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
        parse_str(str_replace(';', '&', substr($dsn, strlen('mysql:'))), $parts);
        if (!isset($parts['host'])) {
            self::markTestSkipped('Worker crash test requires a TCP MySQL test DSN.');
        }
        $id = $this->begin(300.0);
        $otherId = $this->begin(300.0);
        $this->makeDue($id, 10);
        $this->makeDue($otherId, 5);
        $due = $this->db->query("SELECT next_tick_at FROM live_battle_journals WHERE id=$id")->fetchColumn();
        $lockName = 'gq_crash_' . bin2hex(random_bytes(8));
        $lock = $this->db->quote($lockName);
        self::assertSame(1, (int)$this->db->query("SELECT GET_LOCK($lock, 0)")->fetchColumn());
        $process = null;
        $pipes = [];
        $otherProcess = null;
        $otherPipes = [];
        try {
            $this->db->exec(
                "CREATE TRIGGER gq_hold_tick BEFORE UPDATE ON live_battle_journals
                 FOR EACH ROW BEGIN
                     IF OLD.id = $id THEN
                         SET @gq_crash_test_lock = GET_LOCK($lock, 30);
                     END IF;
                 END"
            );
            $env = getenv();
            $env['DB_HOST'] = $parts['host'];
            $env['DB_PORT'] = $parts['port'] ?? '3306';
            $env['DB_NAME'] = $this->database;
            $env['DB_USER'] = getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root';
            $env['DB_PASS'] = getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '';
            $env['LIVE_BATTLE_JOURNAL_WORKER_ENABLED'] = '1';
            $env['XDEBUG_MODE'] = 'off';
            $process = proc_open(
                [PHP_BINARY, __DIR__ . '/../../scripts/process_live_battle_journals.php', '--limit=1'],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                null,
                $env
            );
            if (!is_resource($process)) {
                throw new RuntimeException('Cannot start crash test worker.');
            }
            fclose($pipes[0]);
            unset($pipes[0]);
            $waiting = $this->db->prepare(
                "SELECT COUNT(*) FROM information_schema.processlist
                 WHERE db=? AND state='User lock' AND info=?"
            );
            $barrierStatement = "SET @gq_crash_test_lock = GET_LOCK($lock, 30)";
            $deadline = microtime(true) + 15;
            do {
                $waiting->execute([$this->database, $barrierStatement]);
                if ((int)$waiting->fetchColumn() === 1) {
                    break;
                }
                if (!proc_get_status($process)['running']) {
                    throw new RuntimeException('Worker exited before reaching the transaction barrier.');
                }
                usleep(50_000);
            } while (microtime(true) < $deadline);
            $waiting->execute([$this->database, $barrierStatement]);
            self::assertSame(1, (int)$waiting->fetchColumn(), 'Worker did not reach the pre-commit barrier.');

            $dirty = new PDO(
                $dsn,
                getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
                getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );
            $dirty->exec('USE `' . $this->database . '`');
            $dirty->exec('SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED');
            self::assertSame(1, (int)$dirty->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
            self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
            self::assertSame(
                0,
                (int)$this->db->query("SELECT tick FROM live_battle_journals WHERE id=$id")->fetchColumn()
            );

            $otherProcess = proc_open(
                [PHP_BINARY, __DIR__ . '/../../scripts/process_live_battle_journals.php', '--limit=1'],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $otherPipes,
                null,
                $env
            );
            if (!is_resource($otherProcess)) {
                throw new RuntimeException('Cannot start competing journal worker.');
            }
            fclose($otherPipes[0]);
            unset($otherPipes[0]);
            $deadline = microtime(true) + 15;
            do {
                $otherStatus = proc_get_status($otherProcess);
                if (!$otherStatus['running']) {
                    break;
                }
                usleep(50_000);
            } while (microtime(true) < $deadline);
            self::assertFalse($otherStatus['running'], 'Competing worker blocked on the locked journal.');
            $otherStdout = stream_get_contents($otherPipes[1]);
            $otherStderr = stream_get_contents($otherPipes[2]);
            foreach ($otherPipes as $pipe) {
                fclose($pipe);
            }
            $otherPipes = [];
            proc_close($otherProcess);
            $otherProcess = null;
            self::assertSame(0, $otherStatus['exitcode'], $otherStderr);
            $otherResult = json_decode($otherStdout, true, 512, JSON_THROW_ON_ERROR);
            self::assertSame(1, $otherResult['processed']);
            self::assertSame(1, $otherResult['due_journals']);
            self::assertSame(
                $otherId,
                (int)$this->db->query('SELECT journal_id FROM live_battle_journal_ticks')->fetchColumn()
            );
            self::assertSame(
                'resolved',
                $this->db->query("SELECT status FROM live_battle_journals WHERE id=$otherId")->fetchColumn()
            );
            self::assertTrue(proc_get_status($process)['running']);
            $otherProcess = proc_open(
                [PHP_BINARY, __DIR__ . '/../../scripts/process_live_battle_journals.php', '--limit=1'],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $otherPipes,
                null,
                $env
            );
            if (!is_resource($otherProcess)) {
                throw new RuntimeException('Cannot restart competing journal worker.');
            }
            fclose($otherPipes[0]);
            unset($otherPipes[0]);
            $deadline = microtime(true) + 15;
            do {
                $otherStatus = proc_get_status($otherProcess);
                if (!$otherStatus['running']) {
                    break;
                }
                usleep(50_000);
            } while (microtime(true) < $deadline);
            self::assertFalse($otherStatus['running'], 'Competing worker blocked on the only due journal.');
            $otherStdout = stream_get_contents($otherPipes[1]);
            $otherStderr = stream_get_contents($otherPipes[2]);
            foreach ($otherPipes as $pipe) {
                fclose($pipe);
            }
            $otherPipes = [];
            proc_close($otherProcess);
            $otherProcess = null;
            self::assertSame(0, $otherStatus['exitcode'], $otherStderr);
            $otherResult = json_decode($otherStdout, true, 512, JSON_THROW_ON_ERROR);
            self::assertSame(0, $otherResult['processed']);
            self::assertSame(1, $otherResult['due_journals']);
            self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());

            self::assertTrue(proc_terminate($process, 9));
            foreach ($pipes as $pipe) {
                fclose($pipe);
            }
            $pipes = [];
            proc_close($process);
            $process = null;
            self::assertSame(1, (int)$this->db->query("SELECT RELEASE_LOCK($lock)")->fetchColumn());
            $deadline = microtime(true) + 15;
            do {
                $waiting->execute([$this->database, $barrierStatement]);
                $connections = (int)$waiting->fetchColumn();
                if ($connections === 0) {
                    break;
                }
                usleep(50_000);
            } while (microtime(true) < $deadline);
            self::assertSame(0, $connections, 'The killed worker still holds the transaction barrier.');
            $this->db->exec('DROP TRIGGER gq_hold_tick');
            self::assertSame(
                0,
                (int)$this->db->query("SELECT COUNT(*) FROM live_battle_journal_ticks WHERE journal_id=$id")
                    ->fetchColumn()
            );
            $state = $this->db->query("SELECT tick,status,next_tick_at FROM live_battle_journals WHERE id=$id")
                ->fetch(PDO::FETCH_ASSOC);
            self::assertSame(0, (int)$state['tick']);
            self::assertSame('active', $state['status']);
            self::assertSame($due, $state['next_tick_at']);

            $process = proc_open(
                [PHP_BINARY, __DIR__ . '/../../scripts/process_live_battle_journals.php', '--limit=1'],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                null,
                $env
            );
            if (!is_resource($process)) {
                throw new RuntimeException('Cannot restart crash test worker.');
            }
            fclose($pipes[0]);
            $stdout = stream_get_contents($pipes[1]);
            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $pipes = [];
            $exit = proc_close($process);
            $process = null;
            self::assertSame(0, $exit, $stderr);
            self::assertSame(1, json_decode($stdout, true, 512, JSON_THROW_ON_ERROR)['processed']);
            $result = (new LiveBattleJournalWorker($this->db))->runBatch(1);
            self::assertSame(0, $result['processed']);
            $row = $this->db->query("SELECT tick,status,next_tick_at,state_json FROM live_battle_journals WHERE id=$id")
                ->fetch(PDO::FETCH_ASSOC);
            self::assertSame(1, (int)$row['tick']);
            self::assertSame('resolved', $row['status']);
            self::assertNull($row['next_tick_at']);
            $state = json_decode($row['state_json'], true, 512, JSON_THROW_ON_ERROR);
            self::assertSame('mutual_destruction', $state['outcome']);
            $tick = $this->db->query("SELECT tick,events_json FROM live_battle_journal_ticks WHERE journal_id=$id")
                ->fetch(PDO::FETCH_ASSOC);
            self::assertSame(1, (int)$tick['tick']);
            self::assertCount(2, json_decode($tick['events_json'], true, 512, JSON_THROW_ON_ERROR));
            self::assertSame(2, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
        } finally {
            if (is_resource($otherProcess)) {
                if (proc_get_status($otherProcess)['running']) {
                    proc_terminate($otherProcess, 9);
                }
                foreach ($otherPipes as $pipe) {
                    fclose($pipe);
                }
                proc_close($otherProcess);
            }
            if (is_resource($process)) {
                $status = proc_get_status($process);
                if ($status['running']) {
                    proc_terminate($process, 9);
                }
                foreach ($pipes as $pipe) {
                    fclose($pipe);
                }
                proc_close($process);
            }
            $this->db->query("SELECT RELEASE_LOCK($lock)");
        }
    }

    public function testParticipantReadSnapshotAndPaginatedTicks(): void
    {
        $id = $this->begin();
        $reader = new LiveBattleJournalRead($this->db);
        $initial = $reader->snapshot(10, $id);
        self::assertSame(0, $initial['tick']);
        self::assertSame($initial, $reader->snapshot(20, $id));
        self::assertSame([], $reader->ticks(10, $id, 0, 5)['ticks']);
        $this->makeDue($id, 30);
        self::assertSame(5, (new LiveBattleJournalWorker($this->db))->runBatch(5)['processed']);
        $snapshot = $reader->snapshot(10, $id);
        self::assertSame(5, $snapshot['tick']);
        self::assertSame(5, $snapshot['state']['tick']);
        $first = $reader->ticks(10, $id, 0, 2);
        self::assertSame(5, $first['latest_tick']);
        self::assertSame(2, $first['next_cursor']);
        self::assertTrue($first['has_more']);
        self::assertSame([1, 2], array_column($first['ticks'], 'tick'));
        $second = $reader->ticks(20, $id, $first['next_cursor'], 3);
        self::assertSame([3, 4, 5], array_column($second['ticks'], 'tick'));
        self::assertSame([], $second['ticks'][0]['events']);
        self::assertSame(5, $second['next_cursor']);
        self::assertFalse($second['has_more']);
        self::assertSame([], $reader->ticks(10, $id, 5, 1)['ticks']);
        try {
            $reader->ticks(10, $id, 6, 1);
            self::fail('Future cursors must be rejected.');
        } catch (DomainException $error) {
            self::assertSame(409, $error->getCode());
        }
        foreach ([99, 0] as $user) {
            try {
                $reader->snapshot($user === 0 ? 10 : $user, $user === 0 ? $id + 1000 : $id);
                self::fail('Missing or unauthorized journal must not be readable.');
            } catch (DomainException $error) {
                self::assertSame(404, $error->getCode());
                self::assertSame('Live battle journal not found.', $error->getMessage());
            }
        }
        try {
            $reader->ticks(99, $id, 0, 1);
            self::fail('Unauthorized ticks must not be readable.');
        } catch (DomainException $error) {
            self::assertSame(404, $error->getCode());
        }
        self::assertSame(5, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
    }

    public function testReaderRejectsGapsAndInvalidCursors(): void
    {
        $id = $this->begin();
        $this->makeDue($id, 20);
        (new LiveBattleJournalWorker($this->db))->runBatch(3);
        $reader = new LiveBattleJournalRead($this->db);
        foreach ([[-1, 1], [0, 0], [0, 101]] as [$cursor, $limit]) {
            try {
                $reader->ticks(10, $id, $cursor, $limit);
                self::fail('Invalid cursor or limit must be rejected.');
            } catch (\InvalidArgumentException $error) {
                self::assertStringContainsString('cursor', $error->getMessage());
            }
        }
        $this->db->exec("DELETE FROM live_battle_journal_ticks WHERE journal_id=$id AND tick=2");
        try {
            $reader->ticks(10, $id, 0, 3);
            self::fail('Missing ticks must be detected.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('gap', $error->getMessage());
        }
        $this->db->exec("DELETE FROM live_battle_journal_ticks WHERE journal_id=$id AND tick=3");
        try {
            $reader->ticks(10, $id, 1, 3);
            self::fail('A missing history tail must be detected.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('gap', $error->getMessage());
        }
    }

    public function testParticipantsAndJournalAreCreatedAtomically(): void
    {
        $group = ['count' => 1, 'attack' => 0, 'shield' => 0, 'hull' => 10];
        $fleets = ['attacker' => ['a' => $group], 'defender' => ['b' => $group]];
        $this->db->beginTransaction();
        try {
            (new LiveBattleJournal($this->db))->begin($fleets, ['attacker' => 10, 'defender' => 0]);
            self::fail('Invalid participants must be rejected.');
        } catch (\InvalidArgumentException $error) {
            self::assertStringContainsString('participant', $error->getMessage());
        }
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journals')->fetchColumn());
        (new LiveBattleJournal($this->db))->begin($fleets, ['attacker' => 10, 'defender' => 20]);
        self::assertSame(
            2,
            (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_participants')->fetchColumn()
        );
        $this->db->rollBack();
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journals')->fetchColumn());
        self::assertSame(
            0,
            (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_participants')->fetchColumn()
        );
    }

    public function testReaderNeverObservesUncommittedTick(): void
    {
        $id = $this->begin(300.0);
        $this->makeDue($id);
        $other = new PDO(
            (string)getenv('GQ_RESOURCE_LEDGER_TEST_DSN'),
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $other->exec('USE `' . $this->database . '`');
        $reader = new LiveBattleJournalRead($other);
        $this->db->beginTransaction();
        (new LiveBattleJournal($this->db))->advance($id, 0);
        self::assertSame(0, $reader->snapshot(10, $id)['tick']);
        self::assertSame([], $reader->ticks(10, $id, 0, 10)['ticks']);
        $this->db->commit();
        self::assertSame(1, $reader->snapshot(10, $id)['tick']);
        $page = $reader->ticks(10, $id, 0, 10);
        self::assertSame(1, $page['latest_tick']);
        self::assertCount(2, $page['ticks'][0]['events']);
        self::assertSame('mutual_destruction', $page['ticks'][0]['state']['outcome']);
    }

    public function testReaderRejectsTransactionsAndDirtyIsolation(): void
    {
        $id = $this->begin();
        $reader = new LiveBattleJournalRead($this->db);
        $this->db->beginTransaction();
        try {
            $reader->snapshot(10, $id);
            self::fail('An existing transaction must not provide a stale or dirty read.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('active transaction', $error->getMessage());
        } finally {
            $this->db->rollBack();
        }
        $this->db->exec('SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED');
        try {
            $reader->ticks(10, $id, 0, 1);
            self::fail('Dirty-read isolation must be rejected.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('committed transaction isolation', $error->getMessage());
        } finally {
            $this->db->exec('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        }
    }

    public function testProjectionReadOwnsTransactionAndCleansUpEveryFailure(): void
    {
        $id = $this->begin(300.0);
        $reader = new LiveBattleJournalRead($this->db);
        foreach ([[10, $id, 409], [99, $id, 404], [10, $id + 1, 404]] as [$user, $journal, $code]) {
            try {
                $reader->lossProjection($user, $journal);
                self::fail('Unavailable projections must be rejected.');
            } catch (DomainException $error) {
                self::assertSame($code, $error->getCode());
            }
            self::assertFalse($this->db->inTransaction());
        }
        $this->makeDue($id);
        (new LiveBattleJournalWorker($this->db))->runBatch(1);
        $this->db->beginTransaction();
        try {
            $reader->lossProjection(10, $id);
            self::fail('Caller transactions must not be used or completed.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('active transaction', $error->getMessage());
            self::assertTrue($this->db->inTransaction());
        } finally {
            $this->db->rollBack();
        }
        $this->db->exec('SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED');
        try {
            $reader->lossProjection(10, $id);
            self::fail('Dirty-read isolation must be rejected.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('committed transaction isolation', $error->getMessage());
            self::assertFalse($this->db->inTransaction());
        } finally {
            $this->db->exec('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        }
        foreach ([10, 20] as $user) {
            $result = $reader->lossProjection($user, $id);
            self::assertSame('mutual_destruction', $result['outcome']);
            self::assertSame([1, 1], array_column($result['losses'], 'ships_lost'));
            self::assertFalse($this->db->inTransaction());
        }
        $events = $this->db->query('SELECT events_json FROM live_battle_journal_ticks')->fetchColumn();
        $this->db->exec('UPDATE live_battle_journal_ticks SET events_json=JSON_ARRAY()');
        try {
            $reader->lossProjection(10, $id);
            self::fail('Invalid persisted history must fail without leaving locks.');
        } catch (\InvalidArgumentException $error) {
            self::assertStringContainsString('does not match', $error->getMessage());
            self::assertFalse($this->db->inTransaction());
        }
        $this->db->prepare('UPDATE live_battle_journal_ticks SET events_json=?')->execute([$events]);
        self::assertSame($result, $reader->lossProjection(10, $id));
        self::assertFalse($this->db->inTransaction());
    }

    public function testAuthenticatedHttpReadApiIsOptInAndReadOnly(): void
    {
        $id = $this->begin();
        $this->makeDue($id, 30);
        (new LiveBattleJournalWorker($this->db))->runBatch(3);
        $sessionDir = sys_get_temp_dir() . '/gq_live_api_' . bin2hex(random_bytes(8));
        if (!mkdir($sessionDir, 0700)) {
            throw new RuntimeException('Cannot create isolated HTTP test session directory.');
        }
        $sessions = [];
        foreach ([10, 20, 99] as $user) {
            $sessions[$user] = bin2hex(random_bytes(16));
            file_put_contents($sessionDir . '/sess_' . $sessions[$user], 'user_id|i:' . $user . ';');
        }
        $sessions[0] = bin2hex(random_bytes(16));
        file_put_contents($sessionDir . '/sess_' . $sessions[0], '');
        $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        self::assertIsResource($socket, $error);
        $address = stream_socket_get_name($socket, false);
        self::assertIsString($address);
        $port = (int)substr(strrchr($address, ':'), 1);
        fclose($socket);
        $parts = [];
        foreach (explode(';', substr((string)getenv('GQ_RESOURCE_LEDGER_TEST_DSN'), 6)) as $part) {
            if (str_contains($part, '=')) {
                [$key, $value] = explode('=', $part, 2);
                $parts[$key] = $value;
            }
        }
        $env = array_merge((array)getenv(), [
            'DB_HOST' => $parts['host'] ?? '127.0.0.1',
            'DB_PORT' => $parts['port'] ?? '3306',
            'DB_NAME' => $this->database,
            'DB_USER' => getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            'DB_PASS' => getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            'API_ALLOW_LEGACY' => '0',
            'APP_ENV' => 'production',
            'XDEBUG_MODE' => 'off',
        ]);
        $server = null;
        $pipes = [];
        $start = static function (bool $enabled) use (&$server, &$pipes, $env, $sessionDir, $port): void {
            $env['LIVE_BATTLE_JOURNAL_READ_ENABLED'] = $enabled ? '1' : '0';
            $server = proc_open(
                [
                    PHP_BINARY, '-d', 'session.save_path=' . $sessionDir, '-S', '127.0.0.1:' . $port,
                    __DIR__ . '/live_journal_api_router.php',
                ],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                dirname(__DIR__, 2),
                $env
            );
            self::assertIsResource($server);
            $deadline = hrtime(true) + 10_000_000_000;
            do {
                $probe = @stream_socket_client('tcp://127.0.0.1:' . $port, $errno, $error, 0.1);
                if (is_resource($probe)) {
                    fclose($probe);
                    return;
                }
                self::assertTrue(proc_get_status($server)['running'], 'Test server exited.');
                usleep(20_000);
            } while (hrtime(true) < $deadline);
            self::fail('Test server did not start.');
        };
        $stop = static function () use (&$server, &$pipes): void {
            if (is_resource($server)) {
                proc_terminate($server);
                foreach ($pipes as $pipe) {
                    fclose($pipe);
                }
                proc_close($server);
                $server = null;
            }
        };
        $request = static function (string $query, ?string $session = null, string $method = 'GET') use ($port): array {
            $context = stream_context_create(['http' => [
                'method' => $method,
                'ignore_errors' => true,
                'timeout' => 5,
                'header' => $session === null ? '' : 'Cookie: PHPSESSID=' . $session . "\r\n",
            ]]);
            $body = file_get_contents(
                'http://127.0.0.1:' . $port . '/api/v1/live_battle_journal.php?' . $query,
                false,
                $context
            );
            if ($body === false) {
                throw new RuntimeException('HTTP test request failed.');
            }
            return [
                (int)substr($http_response_header[0], 9, 3),
                json_decode($body, true, 512, JSON_THROW_ON_ERROR),
                $http_response_header,
            ];
        };
        try {
            $start(false);
            [$status, , $headers] = $request('action=snapshot&journal_id=' . $id, $sessions[10]);
            self::assertSame(404, $status);
            self::assertContains('Cache-Control: private, no-store', $headers);
            [$status, , $headers] = $request('action=loss_projection&journal_id=' . $id, $sessions[10]);
            self::assertSame(404, $status);
            self::assertContains('Cache-Control: private, no-store', $headers);
            $stop();
            $start(true);
            [$status, , $headers] = $request('action=snapshot&journal_id=' . $id, $sessions[0]);
            self::assertSame(401, $status);
            self::assertContains('Cache-Control: private, no-store', $headers);
            [$status, , $headers] = $request('action=loss_projection&journal_id=' . $id, $sessions[0]);
            self::assertSame(401, $status);
            self::assertContains('Cache-Control: private, no-store', $headers);
            [$status] = $request('action=snapshot&journal_id=' . $id, $sessions[10], 'POST');
            self::assertSame(405, $status);
            [$status] = $request('action=loss_projection&journal_id=' . $id, $sessions[10], 'POST');
            self::assertSame(405, $status);
            [$status, $body] = $request('action=loss_projection&journal_id=' . $id, $sessions[10]);
            self::assertSame(409, $status);
            self::assertSame('Live battle journal is not resolved.', $body['error']);
            foreach ([10, 20] as $user) {
                [$status, $body, $headers] = $request('action=snapshot&journal_id=' . $id, $sessions[$user]);
                self::assertSame(200, $status);
                self::assertSame(3, $body['snapshot']['tick']);
                self::assertContains('Cache-Control: private, no-store', $headers);
            }
            [$status, $page] = $request('action=ticks&journal_id=' . $id . '&after_tick=0&limit=2', $sessions[10]);
            self::assertSame(200, $status);
            self::assertSame([1, 2], array_column($page['page']['ticks'], 'tick'));
            self::assertTrue($page['page']['has_more']);
            [$status, $page] = $request('action=ticks&journal_id=' . $id . '&after_tick=2&limit=2', $sessions[20]);
            self::assertSame(200, $status);
            self::assertSame([3], array_column($page['page']['ticks'], 'tick'));
            foreach ([$sessions[99], $sessions[10]] as $index => $session) {
                $lookup = $index === 0 ? $id : $id + 1000;
                [$status, $body] = $request('action=snapshot&journal_id=' . $lookup, $session);
                self::assertSame(404, $status);
                self::assertSame('Live battle journal not found.', $body['error']);
                [$status, $body] = $request('action=loss_projection&journal_id=' . $lookup, $session);
                self::assertSame(404, $status);
                self::assertSame('Live battle journal not found.', $body['error']);
            }
            foreach (
                ['action=ticks&journal_id=' . $id . '&after_tick=-1',
                 'action=ticks&journal_id=' . $id . '&after_tick=0&limit=101',
                 'action=snapshot&journal_id[]=1', 'action=snapshot&journal_id=01',
                 'action=snapshot&journal_id=' . $id . '&user_id=20',
                 'action=loss_projection&journal_id=' . $id . '&user_id=20',
                 'action=loss_projection&journal_id=' . $id . '&after_tick=0',
                 'action=loss_projection&journal_id[]=1'] as $query
            ) {
                [$status] = $request($query, $sessions[10]);
                self::assertSame(400, $status);
            }
            [$status] = $request('action=ticks&journal_id=' . $id . '&after_tick=4', $sessions[10]);
            self::assertSame(409, $status);
            [$status] = $request('action=ticks&journal_id=' . $id . '&after_tick=0', $sessions[99]);
            self::assertSame(404, $status);
            self::assertSame(3, (int)$this->db->query('SELECT tick FROM live_battle_journals')->fetchColumn());
            self::assertSame(3, (int)$this->db->query('SELECT COUNT(*) FROM live_battle_journal_ticks')->fetchColumn());
            $terminalId = $this->begin(300.0);
            $this->makeDue($terminalId, 60);
            self::assertSame(1, (new LiveBattleJournalWorker($this->db))->runBatch(1)['processed']);
            $journals = $this->db->query('SELECT * FROM live_battle_journals ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            $ticks = $this->db->query(
                'SELECT * FROM live_battle_journal_ticks ORDER BY journal_id,tick'
            )->fetchAll(PDO::FETCH_ASSOC);
            $expected = (new LiveBattleJournalRead($this->db))->lossProjection(10, $terminalId);
            foreach ([10, 20] as $user) {
                [$status, $body, $headers] = $request(
                    'action=loss_projection&journal_id=' . $terminalId,
                    $sessions[$user]
                );
                self::assertSame(200, $status);
                self::assertTrue($body['success']);
                self::assertSame($expected, $body['projection']);
                self::assertContains('Cache-Control: private, no-store', $headers);
            }
            self::assertSame(
                $journals,
                $this->db->query('SELECT * FROM live_battle_journals ORDER BY id')->fetchAll(PDO::FETCH_ASSOC)
            );
            self::assertSame($ticks, $this->db->query(
                'SELECT * FROM live_battle_journal_ticks ORDER BY journal_id,tick'
            )->fetchAll(PDO::FETCH_ASSOC));
            $this->db->exec(
                "UPDATE live_battle_journal_ticks SET events_json=JSON_ARRAY() WHERE journal_id=$terminalId"
            );
            [$status, $body, $headers] = $request(
                'action=loss_projection&journal_id=' . $terminalId,
                $sessions[10]
            );
            self::assertSame(500, $status);
            self::assertSame('Internal server error', $body['error']);
            self::assertArrayNotHasKey('projection', $body);
            self::assertContains('Cache-Control: private, no-store', $headers);
            $this->db->exec("DELETE FROM live_battle_journal_ticks WHERE journal_id=$id AND tick=2");
            [$status, $body] = $request('action=ticks&journal_id=' . $id . '&after_tick=0', $sessions[10]);
            self::assertSame(500, $status);
            self::assertSame('Internal server error', $body['error']);
        } finally {
            $stop();
            foreach ($sessions as $session) {
                unlink($sessionDir . '/sess_' . $session);
            }
            rmdir($sessionDir);
        }
    }
}
