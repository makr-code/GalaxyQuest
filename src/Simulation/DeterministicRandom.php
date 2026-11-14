<?php

declare(strict_types=1);

namespace GalaxyQuest\Simulation;

use InvalidArgumentException;

/**
 * Seeded SHA-256 counter stream, independent of mt_rand/random_int state.
 */
final class DeterministicRandom
{
    private const SCALE = 281474976710656; // 2^48

    private string $seed;
    private int $counter = 0;

    public function __construct(string $seedMaterial)
    {
        $this->seed = hash('sha256', $seedMaterial, true);
    }

    /** Uniform float in [0, 1). */
    public function float(): float
    {
        $block = hash('sha256', $this->seed . pack('J', $this->counter++));
        return hexdec(substr($block, 0, 12)) / self::SCALE;
    }

    public function int(int $min, int $max): int
    {
        if ($max < $min) {
            throw new InvalidArgumentException('Random range is empty.');
        }
        return $min + (int)floor($this->float() * ($max - $min + 1));
    }

    public function between(float $min, float $max): float
    {
        return $min + ($max - $min) * $this->float();
    }

    public function chance(float $probability): bool
    {
        return $this->float() < max(0.0, min(1.0, $probability));
    }

    /**
     * @template T
     * @param list<T> $items
     * @return T
     */
    public function pick(array $items): mixed
    {
        if ($items === []) {
            throw new InvalidArgumentException('Cannot pick from an empty list.');
        }
        return $items[$this->int(0, count($items) - 1)];
    }
}
