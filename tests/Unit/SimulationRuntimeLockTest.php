<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\SimulationRuntimeLock;

use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use PDO;
use PDOStatement;
use RuntimeException;

final class SimulationRuntimeLockTest extends TestCase
{
    protected function setUp(): void
    {
        require_once __DIR__ . '/../../api/simulation_runtime.php';
    }

    private function database(mixed $acquired = 1, mixed $released = 1): PDO
    {
        $db = $this->createMock(PDO::class);
        $db->method('getAttribute')->with(PDO::ATTR_DRIVER_NAME)->willReturn('mysql');

        $acquire = $this->createMock(PDOStatement::class);
        $acquire->expects($this->once())->method('execute')->with([
            'gq:sim:' . substr(hash('sha256', 'global:'), 0, 48),
        ])->willReturn(true);
        $acquire->method('fetchColumn')->willReturn($acquired);

        $release = $this->createMock(PDOStatement::class);
        $release->expects((string)$acquired === '1' ? $this->once() : $this->never())
            ->method('execute')->with([
                'gq:sim:' . substr(hash('sha256', 'global:'), 0, 48),
            ])->willReturn(true);
        $release->method('fetchColumn')->willReturn($released);

        $db->method('prepare')->willReturnCallback(static fn(string $sql): PDOStatement => match ($sql) {
            'SELECT GET_LOCK(?, 0)' => $acquire,
            'SELECT RELEASE_LOCK(?)' => $release,
            default => throw new RuntimeException('Unexpected simulation lock query.'),
        });

        return $db;
    }

    public function testAcquiredLockRunsOperationAndReleasesIt(): void
    {
        $db = $this->database();
        $result = \simulation_runtime_with_scope_lock(
            $db,
            'global',
            '',
            static fn(): array => ['executed' => true]
        );

        self::assertSame(['executed' => true], $result);
    }

    /** @return iterable<string, array{mixed}> */
    public static function unavailableLocks(): iterable
    {
        yield 'held by another worker' => [0];
    }

    #[DataProvider('unavailableLocks')]
    public function testUnavailableLockSkipsOperation(mixed $acquired): void
    {
        $db = $this->database($acquired);
        $result = \simulation_runtime_with_scope_lock(
            $db,
            'global',
            '',
            static function (): array {
                self::fail('Operation must not execute without the scope lock.');
            }
        );

        self::assertSame([
            'executed' => false,
            'scope' => 'global',
            'reason' => 'lock_busy',
        ], $result);
    }

    /** @return iterable<string, array{mixed}> */
    public static function invalidLockResults(): iterable
    {
        yield 'database returned null' => [null];
        yield 'database returned unexpected integer' => [2];
        yield 'database returned unexpected string' => ['error'];
    }

    #[DataProvider('invalidLockResults')]
    public function testInvalidLockResultFailsWithoutRunningOperation(mixed $acquired): void
    {
        $db = $this->database($acquired);

        $this->expectException(RuntimeException::class);
        \simulation_runtime_with_scope_lock(
            $db,
            'global',
            '',
            static function (): array {
                self::fail('Operation must not execute when lock acquisition is indeterminate.');
            }
        );
    }

    public function testLockReleaseFailureIsReportedAfterSuccessfulOperation(): void
    {
        $db = $this->database(1, 0);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Simulation tick lock was not released.');
        \simulation_runtime_with_scope_lock($db, 'global', '', static fn(): array => ['done' => true]);
    }

    public function testOriginalOperationFailureIsNotReplacedByReleaseFailure(): void
    {
        $db = $this->database(1, 0);
        $original = new LogicException('Original simulation failure.');
        $log = tempnam(sys_get_temp_dir(), 'gq-simulation-lock-');
        if ($log === false) {
            throw new RuntimeException('Cannot create simulation lock log fixture.');
        }

        $previousLog = ini_set('error_log', $log);
        try {
            try {
                \simulation_runtime_with_scope_lock($db, 'global', '', static function () use ($original): array {
                    throw $original;
                });
                self::fail('Expected original simulation failure.');
            } catch (LogicException $error) {
                self::assertSame($original, $error);
            }

            self::assertStringContainsString(
                'lock_release_failed scope=global',
                (string)file_get_contents($log)
            );
        } finally {
            ini_set('error_log', $previousLog === false ? '' : $previousLog);
            unlink($log);
        }
    }

    public function testNonMySqlDriverFailsClosed(): void
    {
        $db = $this->createMock(PDO::class);
        $db->method('getAttribute')->with(PDO::ATTR_DRIVER_NAME)->willReturn('sqlite');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Simulation tick locking requires MySQL.');
        \simulation_runtime_with_scope_lock($db, 'global', '', static fn(): array => []);
    }

    public function testGlobalAndUserTicksAcquireTheirScopeLockBeforeTickExecution(): void
    {
        $runtime = str_replace(
            ["\r\n", "\r"],
            "\n",
            (string)file_get_contents(__DIR__ . '/../../api/simulation_runtime.php')
        );
        self::assertStringContainsString(
            "'global',\n        '',\n        static fn(): array => simulation_tick_global_locked",
            $runtime
        );
        self::assertStringContainsString(
            "'user',\n        (string)\$userId,\n        static fn(): array => simulation_tick_user_locked",
            $runtime
        );
    }
}
