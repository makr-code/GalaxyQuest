<?php

declare(strict_types=1);

use GalaxyQuest\Simulation\DeterministicRandom;
use GalaxyQuest\Simulation\ElapsedTime;
use GalaxyQuest\Simulation\HourlyWindow;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/simulation_runtime.php';

final class HourlyWorldTickTest extends TestCase
{
    public function testWindowIdAndBoundsAreAlignedToTheHour(): void
    {
        self::assertSame(0, HourlyWindow::id(3599));
        self::assertSame(1, HourlyWindow::id(3600));
        self::assertSame(7200, HourlyWindow::start(2));
        self::assertSame(10800, HourlyWindow::end(2));
    }

    public function testSeededRandomIsReproduciblePerWindowAndDecision(): void
    {
        $draw = static function (DeterministicRandom $rng): array {
            return [$rng->float(), $rng->int(1, 6), $rng->pick(['a', 'b', 'c']), $rng->chance(0.5)];
        };
        $first = $draw(HourlyWindow::random(500, 'colony', 7, 'colony_event'));
        self::assertSame($first, $draw(HourlyWindow::random(500, 'colony', 7, 'colony_event')));
        self::assertNotSame($first, $draw(HourlyWindow::random(501, 'colony', 7, 'colony_event')));
        self::assertNotSame($first, $draw(HourlyWindow::random(500, 'colony', 8, 'colony_event')));

        $rng = HourlyWindow::random(1, 'world', 'global', 'bounds');
        for ($i = 0; $i < 200; $i++) {
            $value = $rng->float();
            self::assertGreaterThanOrEqual(0.0, $value);
            self::assertLessThan(1.0, $value);
        }
    }

    public function testElapsedProbabilityMatchesRepeatedPerPeriodRollsAndIsCapped(): void
    {
        self::assertEqualsWithDelta(0.1, ElapsedTime::probability(0.1, 900, 900, 7200), 1e-12);
        // Four 15-min periods inside one hourly tick == four legacy per-tick rolls.
        self::assertEqualsWithDelta(1 - 0.9 ** 4, ElapsedTime::probability(0.1, 900, 3600, 7200), 1e-12);
        self::assertSame(
            ElapsedTime::probability(0.1, 900, 7200, 7200),
            ElapsedTime::probability(0.1, 900, 86400, 7200)
        );
        self::assertSame(0.0, ElapsedTime::probability(0.2, 900, -5, 7200));
    }

    public function testElapsedAmountAndRoundsAreRateTimesCappedElapsed(): void
    {
        self::assertSame(12.0, ElapsedTime::amount(2.0, 600, 3600, 86400));
        self::assertSame(288.0, ElapsedTime::amount(2.0, 600, 999999, 86400));
        self::assertSame(4, ElapsedTime::rounds(900, 3600, 4));
        self::assertSame(4, ElapsedTime::rounds(900, 36000, 4));
        self::assertSame(0, ElapsedTime::rounds(900, 899, 4));
    }

    public function testGlobalTickIsDueOncePerAlignedWindow(): void
    {
        self::assertTrue(simulation_runtime_global_tick_due(7200, 0, 3600));
        self::assertFalse(simulation_runtime_global_tick_due(7200 + 3599, 7200 + 10, 3600));
        self::assertTrue(simulation_runtime_global_tick_due(10800, 7200 + 3599, 3600));
    }

    public function testMailBackoffDoublesAndIsBounded(): void
    {
        self::assertSame(300, mail_outbox_backoff_seconds(1));
        self::assertSame(600, mail_outbox_backoff_seconds(2));
        self::assertSame(2400, mail_outbox_backoff_seconds(4));
        self::assertSame(21600, mail_outbox_backoff_seconds(20));
    }
}
