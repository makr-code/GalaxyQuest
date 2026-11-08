<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration\BattleReportReplayAvailability;

use PDO;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class BattleReportReplayAvailabilityMySqlTest extends TestCase
{
    private ?PDO $db = null;
    private string $database = '';

    public static function setUpBeforeClass(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/reports.php');
        if ($source === false) {
            throw new RuntimeException('Cannot read battle reports API source.');
        }
        $start = strpos($source, 'function battle_report_replay_availability_sql(');
        if ($start === false) {
            throw new RuntimeException('Missing battle report replay availability helper.');
        }
        $end = strpos($source, "\nfunction ", $start + 1);
        if ($end === false) {
            throw new RuntimeException('Cannot isolate battle report replay availability helper.');
        }
        eval(substr($source, $start, $end - $start));
    }

    protected function setUp(): void
    {
        $dsn = getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
        if (!$dsn) {
            self::markTestSkipped('Set GQ_RESOURCE_LEDGER_TEST_DSN to run isolated MySQL report tests.');
        }
        $this->db = new PDO(
            $dsn,
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]
        );
        self::assertSame('mysql', $this->db->getAttribute(PDO::ATTR_DRIVER_NAME));
        $this->database = 'gq_report_replay_test_' . bin2hex(random_bytes(8));
        $this->db->exec('CREATE DATABASE `' . $this->database . '`');
        $this->db->exec('USE `' . $this->database . '`');
        $this->createSchema();
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

    public function testOnlyResolvedJournalsWithBothMatchingParticipantsAreReplayable(): void
    {
        $this->insertReport(1, 10, 20);
        $this->insertReport(2, 10, 20);
        $this->insertReport(3, 10, 20);
        $this->insertReport(4, 10, 20);
        $this->insertEncounter(101, 1, 'resolved', 2);
        $this->insertEncounter(102, 2, 'resolving', 1);
        $this->insertEncounter(103, 3, 'resolved', 2);
        $this->insertParticipants(101, 10, 20);
        $this->insertParticipants(102, 10, 20);
        $this->insertParticipants(103, 99, 20);

        $availability = battle_report_replay_availability_sql($this->db, true);
        $rows = $this->db->query(
            'SELECT br.id, ' . $availability . ' AS replay_available
             FROM battle_reports br ORDER BY br.id'
        )->fetchAll();
        $rows = array_map(
            static fn(array $row): array => [
                'id' => (int)$row['id'],
                'replay_available' => (int)$row['replay_available'],
            ],
            $rows
        );

        self::assertSame([
            ['id' => 1, 'replay_available' => 1],
            ['id' => 2, 'replay_available' => 0],
            ['id' => 3, 'replay_available' => 0],
            ['id' => 4, 'replay_available' => 0],
        ], $rows);
        self::assertSame('0', battle_report_replay_availability_sql($this->db, false));
    }

    public function testMissingJournalTableDisablesReplayAvailability(): void
    {
        $this->db->exec('DROP TABLE battle_encounter_events');

        self::assertSame('0', battle_report_replay_availability_sql($this->db, true));
    }

    public function testNonTransactionalJournalTableDisablesReplayAvailability(): void
    {
        $this->db->exec('ALTER TABLE battle_encounter_events ENGINE=MyISAM');

        self::assertSame('0', battle_report_replay_availability_sql($this->db, true));
    }

    private function createSchema(): void
    {
        $this->db->exec(<<<'SQL'
            CREATE TABLE battle_reports (
                id INT PRIMARY KEY,
                attacker_id INT NOT NULL,
                defender_id INT NOT NULL
            ) ENGINE=InnoDB;
            CREATE TABLE battle_encounters (
                id BIGINT PRIMARY KEY,
                battle_report_id INT NULL,
                status VARCHAR(16) NOT NULL,
                revision INT NOT NULL
            ) ENGINE=InnoDB;
            CREATE TABLE battle_encounter_participants (
                encounter_id BIGINT NOT NULL,
                side VARCHAR(16) NOT NULL,
                user_id INT NOT NULL,
                PRIMARY KEY (encounter_id, side)
            ) ENGINE=InnoDB;
            CREATE TABLE battle_encounter_events (
                encounter_id BIGINT NOT NULL
            ) ENGINE=InnoDB
            SQL);
    }

    private function insertReport(int $id, int $attackerId, int $defenderId): void
    {
        $this->db->prepare(
            'INSERT INTO battle_reports (id, attacker_id, defender_id) VALUES (?, ?, ?)'
        )->execute([$id, $attackerId, $defenderId]);
    }

    private function insertEncounter(int $id, int $reportId, string $status, int $revision): void
    {
        $this->db->prepare(
            'INSERT INTO battle_encounters (id, battle_report_id, status, revision) VALUES (?, ?, ?, ?)'
        )->execute([$id, $reportId, $status, $revision]);
    }

    private function insertParticipants(int $encounterId, int $attackerId, int $defenderId): void
    {
        $statement = $this->db->prepare(
            'INSERT INTO battle_encounter_participants (encounter_id, side, user_id) VALUES (?, ?, ?)'
        );
        $statement->execute([$encounterId, 'attacker', $attackerId]);
        $statement->execute([$encounterId, 'defender', $defenderId]);
    }
}
