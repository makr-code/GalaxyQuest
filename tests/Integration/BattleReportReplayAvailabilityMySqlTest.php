<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration\BattleReportReplayAvailability;

use PDO;
use PHPUnit\Framework\TestCase;
use RuntimeException;

const BATTLE_ENCOUNTERS_ENABLED = 1;

final class JsonResponse extends RuntimeException
{
    public function __construct(public array $payload, int $status = 200)
    {
        parent::__construct('', $status);
    }
}

function get_db(): PDO
{
    $db = BattleReportReplayAvailabilityMySqlTest::$db;
    if ($db === null) {
        throw new RuntimeException('Reports test database is not initialized.');
    }
    return $db;
}

function only_method(string ...$methods): void
{
    if (!in_array($_SERVER['REQUEST_METHOD'] ?? '', $methods, true)) {
        throw new RuntimeException('Unexpected HTTP method in reports test.');
    }
}

function json_ok(array $payload = []): never
{
    throw new JsonResponse(array_merge(['success' => true], $payload));
}

function json_error(string $message, int $status = 400): never
{
    throw new JsonResponse(['success' => false, 'error' => $message], $status);
}

final class BattleReportReplayAvailabilityMySqlTest extends TestCase
{
    public static ?PDO $db = null;
    private ?PDO $connection = null;
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
        eval('namespace ' . __NAMESPACE__ . '; use \PDO; ' . substr($source, $start, $end - $start));

        foreach ([
            'action_battle_reports',
            'build_battle_simulation_context',
            'normalize_battle_report_meta',
            'hydrate_battle_report_payload',
            'build_modifier_breakdown_from_totals',
            'battle_reports_has_combat_meta_columns',
        ] as $functionName) {
            $start = strpos($source, 'function ' . $functionName . '(');
            if ($start === false) {
                throw new RuntimeException('Missing report API function: ' . $functionName);
            }
            $end = strpos($source, "\nfunction ", $start + 1);
            eval(
                'namespace ' . __NAMESPACE__ . '; use \PDO; '
                . substr($source, $start, ($end === false ? strlen($source) : $end) - $start)
            );
        }
    }

    protected function setUp(): void
    {
        $dsn = getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
        if (!$dsn) {
            self::markTestSkipped('Set GQ_RESOURCE_LEDGER_TEST_DSN to run isolated MySQL report tests.');
        }
        $this->connection = new PDO(
            $dsn,
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]
        );
        self::assertSame('mysql', $this->connection->getAttribute(PDO::ATTR_DRIVER_NAME));
        $this->database = 'gq_report_replay_test_' . bin2hex(random_bytes(8));
        $this->connection->exec('CREATE DATABASE `' . $this->database . '`');
        $this->connection->exec('USE `' . $this->database . '`');
        self::$db = $this->connection;
        $this->createSchema();
    }

    protected function tearDown(): void
    {
        if ($this->connection !== null && $this->database !== '') {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }
            $this->connection->exec('DROP DATABASE `' . $this->database . '`');
        }
        self::$db = null;
        $this->connection = null;
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

        $availability = battle_report_replay_availability_sql($this->connection, true);
        $rows = $this->connection->query(
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
        self::assertSame('0', battle_report_replay_availability_sql($this->connection, false));
    }

    public function testMissingJournalTableDisablesReplayAvailability(): void
    {
        $this->connection->exec('DROP TABLE battle_encounter_events');

        self::assertSame('0', battle_report_replay_availability_sql($this->connection, true));
    }

    public function testNonTransactionalJournalTableDisablesReplayAvailability(): void
    {
        $this->connection->exec('ALTER TABLE battle_encounter_events ENGINE=MyISAM');

        self::assertSame('0', battle_report_replay_availability_sql($this->connection, true));
    }

    public function testReportsApiReturnsReplayAvailabilityForEachParticipantReport(): void
    {
        $this->insertReport(11, 10, 20);
        $this->insertReport(12, 10, 20);
        $this->insertReport(13, 20, 10);
        $this->insertReport(14, 30, 40);
        $this->insertEncounter(111, 11, 'resolved', 2);
        $this->insertEncounter(113, 13, 'resolved', 2);
        $this->insertParticipants(111, 10, 20);
        $this->insertParticipants(113, 20, 10);
        $_SERVER['REQUEST_METHOD'] = 'GET';

        try {
            action_battle_reports(10);
            self::fail('The reports API should return its JSON response.');
        } catch (JsonResponse $response) {
            self::assertTrue($response->payload['success']);
            self::assertSame([
                ['id' => 13, 'role' => 'defender', 'replay_available' => true],
                ['id' => 12, 'role' => 'attacker', 'replay_available' => false],
                ['id' => 11, 'role' => 'attacker', 'replay_available' => true],
            ], array_map(
                static fn(array $report): array => [
                    'id' => $report['id'],
                    'role' => $report['role'],
                    'replay_available' => $report['replay_available'],
                ],
                $response->payload['battle_reports']
            ));
        }
    }

    private function createSchema(): void
    {
        $this->connection->exec(<<<'SQL'
            CREATE TABLE battle_reports (
                id INT PRIMARY KEY,
                attacker_id INT NOT NULL,
                defender_id INT NOT NULL,
                body_id INT NULL,
                report_json JSON NOT NULL,
                created_at DATETIME NOT NULL
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
        $this->connection->prepare(
            'INSERT INTO battle_reports (id, attacker_id, defender_id, report_json, created_at)
             VALUES (?, ?, ?, ?, ?)'
        )->execute([
            $id,
            $attackerId,
            $defenderId,
            '{"attacker_wins": true, "rounds": []}',
            sprintf('2026-01-01 00:00:%02d', $id),
        ]);
    }

    private function insertEncounter(int $id, int $reportId, string $status, int $revision): void
    {
        $this->connection->prepare(
            'INSERT INTO battle_encounters (id, battle_report_id, status, revision) VALUES (?, ?, ?, ?)'
        )->execute([$id, $reportId, $status, $revision]);
    }

    private function insertParticipants(int $encounterId, int $attackerId, int $defenderId): void
    {
        $statement = $this->connection->prepare(
            'INSERT INTO battle_encounter_participants (encounter_id, side, user_id) VALUES (?, ?, ?)'
        );
        $statement->execute([$encounterId, 'attacker', $attackerId]);
        $statement->execute([$encounterId, 'defender', $defenderId]);
    }
}
