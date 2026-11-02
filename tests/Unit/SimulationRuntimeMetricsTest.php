<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\SimulationRuntimeMetrics;

use PHPUnit\Framework\TestCase;
use RuntimeException;

require_once __DIR__ . '/../../api/simulation_runtime.php';

final class SimulationRuntimeMetricsTest extends TestCase
{
    public function testSuccessfulSubsystemReportsDurationLagAndZeroErrors(): void
    {
        $result = \simulation_runtime_measure_subsystem(
            static fn(): array => ['processed' => true],
            800,
            1000
        );

        self::assertTrue($result['ok']);
        self::assertSame(0, $result['error_count']);
        self::assertSame(200, $result['lag_seconds']);
        self::assertIsInt($result['duration_ms']);
        self::assertTrue($result['processed']);
    }

    public function testFirstSubsystemRunHasUnknownLag(): void
    {
        $result = \simulation_runtime_measure_subsystem(
            static fn(): array => [],
            null,
            1000
        );

        self::assertNull($result['lag_seconds']);
        self::assertSame(0, $result['error_count']);
    }

    public function testSubsystemExceptionIsReportedWithoutEscapingTheMetricRunner(): void
    {
        $result = \simulation_runtime_measure_subsystem(
            static function (): never {
                throw new RuntimeException('tick failed');
            },
            900,
            1000
        );

        self::assertFalse($result['ok']);
        self::assertSame(1, $result['error_count']);
        self::assertSame(100, $result['lag_seconds']);
        self::assertSame(RuntimeException::class, $result['error_class']);
        self::assertSame('tick failed', $result['error']);
    }

    public function testExplicitSubsystemFailureIsCounted(): void
    {
        $result = \simulation_runtime_measure_subsystem(
            static fn(): array => ['ok' => false, 'error' => 'failed'],
            900,
            1000
        );

        self::assertFalse($result['ok']);
        self::assertSame(1, $result['error_count']);
    }
}
