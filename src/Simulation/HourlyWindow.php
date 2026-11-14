<?php

declare(strict_types=1);

namespace GalaxyQuest\Simulation;

use InvalidArgumentException;

/**
 * Hour-aligned world-tick window. Decisions are keyed by the window id so a
 * repeated run inside the same hour reproduces them; missed hours are skipped.
 */
final class HourlyWindow
{
    public const SECONDS = 3600;

    public static function id(int $unix): int
    {
        if ($unix < 0) {
            throw new InvalidArgumentException('Unix time must not be negative.');
        }
        return intdiv($unix, self::SECONDS);
    }

    public static function start(int $windowId): int
    {
        return $windowId * self::SECONDS;
    }

    public static function end(int $windowId): int
    {
        return ($windowId + 1) * self::SECONDS;
    }

    public static function random(
        int $windowId,
        string $actorType,
        int|string $actorId,
        string $decision,
    ): DeterministicRandom {
        return new DeterministicRandom($windowId . '|' . $actorType . '|' . $actorId . '|' . $decision);
    }
}
