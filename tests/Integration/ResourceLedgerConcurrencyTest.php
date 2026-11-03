<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration;

use PDO;
use PHPUnit\Framework\TestCase;

final class ResourceLedgerConcurrencyTest extends TestCase
{
    private ?PDO $admin = null;
    private string $database = '';

    protected function setUp(): void
    {
        $dsn = getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Set GQ_RESOURCE_LEDGER_TEST_DSN to run MySQL concurrency tests.');
        }

        $this->admin = new PDO(
            $dsn,
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        self::assertSame('mysql', $this->admin->getAttribute(PDO::ATTR_DRIVER_NAME));

        $this->database = 'gq_ledger_concurrency_' . bin2hex(random_bytes(6));
        $this->admin->exec('CREATE DATABASE `' . $this->database . '`');
        $this->admin->exec('USE `' . $this->database . '`');
        $this->admin->exec(<<<'SQL'
            CREATE TABLE users (
                id INT PRIMARY KEY
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE colonies (
                id INT PRIMARY KEY,
                user_id INT NOT NULL,
                metal DECIMAL(20,4) NOT NULL,
                CONSTRAINT colonies_metal_nonnegative CHECK (metal >= 0),
                CONSTRAINT colonies_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE resource_ledger_commits (
                worker_id VARCHAR(32) PRIMARY KEY,
                committed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec('INSERT INTO users (id) VALUES (7)');
        $this->admin->exec('INSERT INTO colonies (id, user_id, metal) VALUES (11, 7, 100), (12, 7, 100)');
        $this->admin->exec(<<<'SQL'
            CREATE TABLE active_research (
                user_id INT PRIMARY KEY,
                colony_id INT NOT NULL,
                started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
        SQL);
    }

    protected function tearDown(): void
    {
        if ($this->admin !== null && $this->database !== '') {
            $this->admin->exec('DROP DATABASE IF EXISTS `' . $this->database . '`');
        }
        $this->admin = null;
    }

    public function testConcurrentSpendsSerializeAndCommitOnlyOneCoupledMutation(): void
    {
        $workers = [];
        try {
            $workers[] = $this->startWorker('worker-a', true);
            $workers[] = $this->startWorker('worker-b', false);

            foreach ($workers as $worker) {
                self::assertSame('READY', $this->readLine($worker['pipes'][1]));
            }

            fwrite($workers[0]['pipes'][0], "GO\n");
            fflush($workers[0]['pipes'][0]);
            self::assertStringStartsWith('STARTING:', $this->readLine($workers[0]['pipes'][1]));
            self::assertSame('LOCKED', $this->readLine($workers[0]['pipes'][1]));

            fwrite($workers[1]['pipes'][0], "GO\n");
            fflush($workers[1]['pipes'][0]);
            $secondStarting = $this->readLine($workers[1]['pipes'][1]);
            self::assertStringStartsWith('STARTING:', $secondStarting);
            $this->assertWaitingOnInnoDbLock((int)substr($secondStarting, strlen('STARTING:')));

            fwrite($workers[0]['pipes'][0], "COMMIT\n");
            fflush($workers[0]['pipes'][0]);
            $firstResult = json_decode($this->readLine($workers[0]['pipes'][1]), true, flags: JSON_THROW_ON_ERROR);
            $secondResult = json_decode($this->readLine($workers[1]['pipes'][1]), true, flags: JSON_THROW_ON_ERROR);
            self::assertIsArray($firstResult);
            self::assertIsArray($secondResult);
            $results = [$firstResult, $secondResult];

            foreach ($workers as &$worker) {
                fclose($worker['pipes'][0]);
                fclose($worker['pipes'][1]);
                fclose($worker['pipes'][2]);
                $exitCode = proc_close($worker['process']);
                $worker['process_closed'] = true;
                self::assertSame(0, $exitCode);
            }
            unset($worker);

            self::assertCount(
                1,
                array_filter($results, static fn(array $result): bool => $result['status'] === 'committed')
            );
            self::assertCount(
                1,
                array_filter($results, static fn(array $result): bool => $result['status'] === 'rejected')
            );
            self::assertSame(
                [409],
                array_values(array_map(
                    static fn(array $result): int => (int)$result['code'],
                    array_filter($results, static fn(array $result): bool => $result['status'] === 'rejected')
                ))
            );
            self::assertSame('20.0000', $this->admin->query('SELECT metal FROM colonies WHERE id = 11')->fetchColumn());
            self::assertSame(
                1,
                (int)$this->admin->query('SELECT COUNT(*) FROM resource_ledger_commits')->fetchColumn()
            );
            self::assertGreaterThanOrEqual(
                0,
                (float)$this->admin->query('SELECT metal FROM colonies WHERE id = 11')->fetchColumn()
            );
        } finally {
            $this->closeWorkers($workers);
        }
    }

    public function testEmpireWideResearchReservationSerializesAcrossColonies(): void
    {
        $workers = [];
        try {
            $workers[] = $this->startWorker('research-a', true, 'research', 11);
            $workers[] = $this->startWorker('research-b', false, 'research', 12);

            foreach ($workers as $worker) {
                self::assertSame('READY', $this->readLine($worker['pipes'][1]));
            }

            fwrite($workers[0]['pipes'][0], "GO\n");
            fflush($workers[0]['pipes'][0]);
            self::assertStringStartsWith('STARTING:', $this->readLine($workers[0]['pipes'][1]));
            self::assertSame('LOCKED', $this->readLine($workers[0]['pipes'][1]));

            fwrite($workers[1]['pipes'][0], "GO\n");
            fflush($workers[1]['pipes'][0]);
            $secondStarting = $this->readLine($workers[1]['pipes'][1]);
            self::assertStringStartsWith('STARTING:', $secondStarting);
            $this->assertWaitingOnInnoDbLock((int)substr($secondStarting, strlen('STARTING:')));

            fwrite($workers[0]['pipes'][0], "COMMIT\n");
            fflush($workers[0]['pipes'][0]);
            $firstResult = json_decode($this->readLine($workers[0]['pipes'][1]), true, flags: JSON_THROW_ON_ERROR);
            $secondResult = json_decode($this->readLine($workers[1]['pipes'][1]), true, flags: JSON_THROW_ON_ERROR);
            self::assertIsArray($firstResult);
            self::assertIsArray($secondResult);
            self::assertSame('committed', $firstResult['status']);
            self::assertSame('rejected', $secondResult['status']);
            self::assertSame(409, (int)$secondResult['code']);
            self::assertSame(
                '90.0000',
                $this->admin->query('SELECT metal FROM colonies WHERE id = 11')->fetchColumn()
            );
            self::assertSame(
                '100.0000',
                $this->admin->query('SELECT metal FROM colonies WHERE id = 12')->fetchColumn()
            );
            self::assertSame(1, (int)$this->admin->query('SELECT COUNT(*) FROM active_research')->fetchColumn());
            self::assertSame(11, (int)$this->admin->query('SELECT colony_id FROM active_research')->fetchColumn());
        } finally {
            $this->closeWorkers($workers);
        }
    }

    /** @return array{process: resource, pipes: array<int, resource>, process_closed?: bool} */
    private function startWorker(
        string $workerId,
        bool $holdCallback,
        string $scenario = 'spend',
        int $colonyId = 11
    ): array {
        $process = proc_open(
            [PHP_BINARY, __DIR__ . '/resource_ledger_concurrency_worker.php'],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
            dirname(__DIR__, 2),
            array_merge((array)getenv(), [
                'GQ_RESOURCE_LEDGER_TEST_DATABASE' => $this->database,
                'GQ_RESOURCE_LEDGER_TEST_WORKER' => $workerId,
                'GQ_RESOURCE_LEDGER_TEST_HOLD_CALLBACK' => $holdCallback ? '1' : '0',
                'GQ_RESOURCE_LEDGER_TEST_SCENARIO' => $scenario,
                'GQ_RESOURCE_LEDGER_TEST_COLONY' => (string)$colonyId,
            ])
        );
        self::assertIsResource($process);
        return ['process' => $process, 'pipes' => $pipes];
    }

    /** @param list<array{process: resource, pipes: array<int, resource>, process_closed?: bool}> $workers */
    private function closeWorkers(array $workers): void
    {
        foreach ($workers as $worker) {
            if ($worker['process_closed'] ?? false) {
                continue;
            }
            foreach ($worker['pipes'] as $pipe) {
                if (is_resource($pipe)) {
                    fclose($pipe);
                }
            }
            if (is_resource($worker['process'])) {
                $status = proc_get_status($worker['process']);
                if ($status['running']) {
                    proc_terminate($worker['process']);
                }
                proc_close($worker['process']);
            }
        }
    }

    /** @param resource $stream */
    private function readLine($stream): string
    {
        $read = [$stream];
        $write = null;
        $except = null;
        self::assertSame(1, stream_select($read, $write, $except, 15));
        $line = fgets($stream);
        self::assertIsString($line);
        return trim($line);
    }

    private function assertWaitingOnInnoDbLock(int $connectionId): void
    {
        $wait = $this->admin->prepare(<<<'SQL'
            SELECT COUNT(*)
            FROM performance_schema.data_lock_waits waits
            JOIN performance_schema.threads thread
              ON thread.THREAD_ID = waits.REQUESTING_THREAD_ID
            WHERE thread.PROCESSLIST_ID = ?
        SQL);
        $deadline = hrtime(true) + 5_000_000_000;
        do {
            $wait->execute([$connectionId]);
            if ((int)$wait->fetchColumn() > 0) {
                return;
            }
            usleep(10_000);
        } while (hrtime(true) < $deadline);

        self::fail('The competing worker did not enter an InnoDB lock wait.');
    }
}
