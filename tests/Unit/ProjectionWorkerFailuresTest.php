<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ProjectionWorkerFailuresTest extends TestCase
{
    public function testBatchDefaultDoesNotOverrideExplicitFifty(): void
    {
        $this->assertSame(200, parse_worker_args(['worker'], 200)['batch']);
        $this->assertSame(50, parse_worker_args(['worker', '--batch=50'], 200)['batch']);
    }

    public static function writers(): iterable
    {
        yield 'user' => ['write_user_overview_projection', [7]];
        yield 'system' => ['write_system_snapshot', [1, 120]];
    }

    #[DataProvider('writers')]
    public function testStrictWriterPropagatesDatabaseFailure(string $writer, array $key): void
    {
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willThrowException(new PDOException('denied write'));
        $this->expectException(PDOException::class);
        $writer($db, ...[...$key, ['retained' => true], true]);
    }

    #[DataProvider('writers')]
    public function testStrictWriterRejectsUnencodablePayloadBeforeDatabase(string $writer, array $key): void
    {
        $db = $this->createMock(PDO::class);
        $db->expects(self::never())->method('prepare');
        $this->expectException(JsonException::class);
        $writer($db, ...[...$key, ['invalid' => NAN], true]);
    }

    public function testStrictSnapshotReadDoesNotTreatDatabaseFailureAsMissingStar(): void
    {
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willThrowException(new PDOException('missing source'));
        $this->expectException(PDOException::class);
        build_system_snapshot_payload($db, 1, 120, true);
    }

    public static function failureAttempts(): iterable
    {
        yield 'retry' => [1];
        yield 'dead letter' => [defined('PROJECTION_MAX_ATTEMPTS') ? (int)PROJECTION_MAX_ATTEMPTS : 10];
    }

    #[DataProvider('failureAttempts')]
    public function testFailureTransitionChecksAffectedRows(int $attempt): void
    {
        $statement = $this->createMock(PDOStatement::class);
        $statement->expects(self::once())->method('execute');
        $statement->expects(self::once())->method('rowCount')->willReturn(0);
        $db = $this->createMock(PDO::class);
        $db->expects(self::once())->method('prepare')
            ->with(self::stringContains("AND status = 'processing'"))
            ->willReturn($statement);
        mark_failed($db, 7, $attempt, 'superseded', 30, str_repeat('a', 64));
    }

    public function testFailureTransitionDoesNotHideDatabaseErrors(): void
    {
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willThrowException(new PDOException('retry denied'));
        $this->expectException(PDOException::class);
        mark_failed($db, 7, 1, 'error', 30, str_repeat('a', 64));
    }

    public function testInvalidClaimTokenFailsBeforeQueueWrite(): void
    {
        $db = $this->createMock(PDO::class);
        $db->expects(self::never())->method('prepare');
        $this->expectException(InvalidArgumentException::class);
        mark_done($db, 7, '');
    }

    public function testInvalidFailureTokenFailsBeforeQueueWrite(): void
    {
        $db = $this->createMock(PDO::class);
        $db->expects(self::never())->method('prepare');
        $this->expectException(InvalidArgumentException::class);
        mark_failed($db, 7, 1, 'error', 30, str_repeat('A', 64));
    }

    public function testDoneWithObsoleteClaimChecksAffectedRows(): void
    {
        $db = $this->createMock(PDO::class);
        $statement = $this->createMock(PDOStatement::class);
        $db->expects(self::once())->method('prepare')
            ->with(self::stringContains('claim_token = ?'))->willReturn($statement);
        $statement->expects(self::once())->method('execute')->with([7, str_repeat('a', 64)])->willReturn(true);
        $statement->expects(self::once())->method('rowCount')->willReturn(0);
        mark_done($db, 7, str_repeat('a', 64));
    }

    public function testAtomicCompletionRejectsCallerTransaction(): void
    {
        $db = $this->createMock(PDO::class);
        $db->method('inTransaction')->willReturn(true);
        $db->expects(self::never())->method('beginTransaction');
        $db->expects(self::never())->method('rollBack');
        $this->expectException(RuntimeException::class);
        complete_projection_claim($db, 7, str_repeat('a', 64), static function (PDO $connection): void {
            self::fail('Writer must not run.');
        });
    }

    public function testAtomicCompletionSkipsWriterForLostClaim(): void
    {
        $db = $this->createMock(PDO::class);
        $db->method('inTransaction')->willReturn(false);
        $db->expects(self::once())->method('beginTransaction')->willReturn(true);
        $db->expects(self::once())->method('rollBack')->willReturn(true);
        $db->expects(self::never())->method('commit');
        $statement = $this->createMock(PDOStatement::class);
        $statement->expects(self::once())->method('execute')->with([7, str_repeat('a', 64)])->willReturn(true);
        $statement->method('fetchColumn')->willReturn(false);
        $statement->expects(self::once())->method('closeCursor');
        $db->expects(self::once())->method('prepare')->with(self::stringContains('FOR UPDATE'))->willReturn($statement);
        $this->assertFalse(complete_projection_claim(
            $db, 7, str_repeat('a', 64), static function (PDO $connection): void {
                self::fail('Superseded writer must not run.');
            },
        ));
    }

    public static function completionFailures(): iterable
    {
        yield 'write' => ['write'];
        yield 'ack error' => ['ack'];
        yield 'ack no-op' => ['no-op'];
        yield 'commit' => ['commit'];
        yield 'rollback error preserves write error' => ['rollback'];
    }

    #[DataProvider('completionFailures')]
    public function testAtomicCompletionRollsBackAndPropagatesFailure(string $phase): void
    {
        $db = $this->createMock(PDO::class);
        $db->method('inTransaction')->willReturnOnConsecutiveCalls(false, true);
        $db->expects(self::once())->method('beginTransaction')->willReturn(true);
        if ($phase === 'rollback') {
            $db->expects(self::once())->method('rollBack')->willThrowException(new PDOException('cleanup failed'));
        } else {
            $db->expects(self::once())->method('rollBack')->willReturn(true);
        }
        if ($phase === 'commit') {
            $db->expects(self::once())->method('commit')->willThrowException(new PDOException('commit failed'));
        } else {
            $db->expects(self::never())->method('commit');
        }
        $lock = $this->createMock(PDOStatement::class);
        $lock->method('execute')->willReturn(true);
        $lock->method('fetchColumn')->willReturn('7');
        $lock->expects(self::once())->method('closeCursor');
        $ack = $this->createMock(PDOStatement::class);
        if ($phase === 'ack') {
            $ack->method('execute')->willThrowException(new PDOException('ack failed'));
        } else {
            $ack->method('execute')->willReturn(true);
            $ack->method('rowCount')->willReturn($phase === 'no-op' ? 0 : 1);
        }
        $db->method('prepare')->willReturnCallback(static fn(string $sql): PDOStatement =>
            str_contains($sql, 'FOR UPDATE') ? $lock : $ack);
        $this->expectException($phase === 'no-op' ? RuntimeException::class : PDOException::class);
        $this->expectExceptionMessage(match ($phase) {
            'write', 'rollback' => 'write failed',
            'ack' => 'ack failed',
            'commit' => 'commit failed',
            default => 'changed during locked completion',
        });
        complete_projection_claim($db, 7, str_repeat('a', 64), static function (PDO $connection) use ($phase): void {
            if ($phase === 'write' || $phase === 'rollback') {
                throw new PDOException('write failed');
            }
        });
    }
}
