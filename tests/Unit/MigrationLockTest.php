<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class MigrationLockTest extends TestCase
{
    private function runner(PDO $db): MigrationRunner
    {
        $runner = (new ReflectionClass(MigrationRunner::class))->newInstanceWithoutConstructor();
        (new ReflectionProperty(MigrationRunner::class, 'db'))->setValue($runner, $db);
        return $runner;
    }

    private function invoke(MigrationRunner $runner, callable $operation): mixed
    {
        return (new ReflectionMethod(MigrationRunner::class, 'withMigrationLock'))->invoke($runner, $operation);
    }

    private function mysqlDb(mixed $acquired = 1, mixed $released = 1): PDO
    {
        $db = $this->createMock(PDO::class);
        $db->method('getAttribute')->with(PDO::ATTR_DRIVER_NAME)->willReturn('mysql');
        $db->method('inTransaction')->willReturn(false);
        $database = $this->createMock(PDOStatement::class);
        $database->method('fetchColumn')->willReturn('fixture');
        $db->method('query')->with('SELECT DATABASE()')->willReturn($database);
        $name = 'gq:migrations:' . substr(hash('sha256', 'fixture'), 0, 48);
        $acquire = $this->createMock(PDOStatement::class);
        $acquire->expects($this->once())->method('execute')->with([$name])->willReturn(true);
        $acquire->method('fetchColumn')->willReturn($acquired);
        $release = $this->createMock(PDOStatement::class);
        $release->expects((string)$acquired === '1' ? $this->once() : $this->never())
            ->method('execute')->with([$name])->willReturn(true);
        $release->method('fetchColumn')->willReturn($released);
        $db->method('prepare')->willReturnCallback(static fn(string $sql): PDOStatement => match ($sql) {
            'SELECT GET_LOCK(?, 0)' => $acquire,
            'SELECT RELEASE_LOCK(?)' => $release,
            default => throw new RuntimeException('Unexpected lock query.'),
        });
        return $db;
    }

    /** @return iterable<array{mixed}> */
    public static function failedAcquisitions(): iterable
    {
        yield 'busy' => [0];
        yield 'null' => [null];
        yield 'false' => [false];
    }

    #[DataProvider('failedAcquisitions')]
    public function testFailedAcquisitionNeverRunsMutation(mixed $result): void
    {
        $runner = $this->runner($this->mysqlDb($result));
        $this->expectException(RuntimeException::class);
        $this->invoke($runner, static function (): void {
            throw new LogicException('Mutation must not run.');
        });
    }

    public function testSuccessfulOperationReturnsValueAndReleasesLock(): void
    {
        $runner = $this->runner($this->mysqlDb());
        $this->assertSame(['done'], $this->invoke($runner, static fn(): array => ['done']));
    }

    public function testNestedBootstrapUsesOneLockWithoutReacquiring(): void
    {
        $runner = $this->runner($this->mysqlDb());
        $this->assertSame(42, $this->invoke($runner, fn(): int => $this->invoke($runner, static fn(): int => 42)));
    }

    public function testReleaseFailureAfterSuccessIsNotSilenced(): void
    {
        $runner = $this->runner($this->mysqlDb(1, 0));
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not released');
        $this->invoke($runner, static fn(): bool => true);
    }

    public function testReleaseFailureLogsWithoutReplacingOriginalError(): void
    {
        $runner = $this->runner($this->mysqlDb(1, null));
        $original = new LogicException('Original migration failure.');
        $path = tempnam(sys_get_temp_dir(), 'gq-lock-log-');
        if ($path === false) {
            throw new RuntimeException('Cannot create lock log fixture.');
        }
        $previous = ini_set('error_log', $path);
        try {
            try {
                $this->invoke($runner, static function () use ($original): never {
                    throw $original;
                });
                $this->fail('Expected original error.');
            } catch (LogicException $error) {
                $this->assertSame($original, $error);
            }
            $this->assertStringContainsString('migration_lock_release_failed', (string)file_get_contents($path));
        } finally {
            ini_set('error_log', $previous === false ? '' : $previous);
            unlink($path);
        }
    }

    public function testUnsupportedDriverFailsInsteadOfSkippingLock(): void
    {
        $db = $this->createMock(PDO::class);
        $db->method('getAttribute')->willReturn('pgsql');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('requires MySQL');
        $this->invoke($this->runner($db), static fn(): bool => true);
    }
}
