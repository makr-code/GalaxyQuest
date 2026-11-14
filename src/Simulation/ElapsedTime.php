<?php

declare(strict_types=1);

namespace GalaxyQuest\Simulation;

use InvalidArgumentException;

/**
 * Converts per-call behavior into rates over elapsed wall time so subsystem
 * outcomes do not depend on how often the global tick is invoked.
 */
final class ElapsedTime
{
    /** Probability that a per-period event with chance $p occurs at least once in the capped elapsed span. */
    public static function probability(
        float $perPeriod,
        int $periodSeconds,
        int $elapsedSeconds,
        int $capSeconds,
    ): float {
        self::assertPeriod($periodSeconds, $capSeconds);
        $p = max(0.0, min(1.0, $perPeriod));
        $elapsed = max(0, min($elapsedSeconds, $capSeconds));
        return 1.0 - (1.0 - $p) ** ($elapsed / $periodSeconds);
    }

    /** Linear accumulation (rate × elapsed) with an elapsed cap. */
    public static function amount(float $perPeriod, int $periodSeconds, int $elapsedSeconds, int $capSeconds): float
    {
        self::assertPeriod($periodSeconds, $capSeconds);
        return $perPeriod * max(0, min($elapsedSeconds, $capSeconds)) / $periodSeconds;
    }

    /** Whole decision rounds owed for the capped elapsed span (at most $maxRounds). */
    public static function rounds(int $periodSeconds, int $elapsedSeconds, int $maxRounds): int
    {
        self::assertPeriod($periodSeconds, $periodSeconds);
        return max(0, min($maxRounds, intdiv(max(0, $elapsedSeconds), $periodSeconds)));
    }

    private static function assertPeriod(int $periodSeconds, int $capSeconds): void
    {
        if ($periodSeconds <= 0 || $capSeconds < 0) {
            throw new InvalidArgumentException('Elapsed-time period must be positive and cap non-negative.');
        }
    }
}
