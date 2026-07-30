<?php

declare(strict_types=1);

/**
 * Seeded Random Number Generator
 * 
 * Provides deterministic, reproducible randomness for quest generation.
 * Uses a 64-bit xorshift64* algorithm for speed and quality.
 * 
 * Purpose:
 * - Generate reproducible quests (same seed = same quest)
 * - Distribute quest variants across players fairly
 * - Enable server-side validation of client-claimed rewards
 * - Audit trail for quest generation
 */

class SeededRandom
{
    private int $state;
    private static int $default_seed = 0;

    /**
     * Construct a SeededRandom with initial seed
     * 
     * @param string|int $seed Seed value (can be hex string or int)
     */
    public function __construct($seed = 0)
    {
        if (is_string($seed)) {
            // Convert hex string to int
            $this->state = (int)hexdec($seed);
        } else {
            $this->state = (int)$seed;
        }

        if ($this->state === 0) {
            $this->state = 1;  // Never allow state to be 0
        }
    }

    /**
     * Generate next random 64-bit integer
     * Uses xorshift64* algorithm
     * 
     * @return int Random 64-bit integer
     */
    public function next64(): int
    {
        $x = $this->state;

        // xorshift64* algorithm
        $x ^= $x >> 12;
        $x ^= $x << 25;
        $x ^= $x >> 27;

        $this->state = $x;

        // Multiply by 2.685821657736338717 mod 2^64
        return (int)(($x * 2685821657736338717) & 0xFFFFFFFFFFFFFFFF);
    }

    /**
     * Generate random integer in range [min, max]
     * 
     * @param int $min Minimum value (inclusive)
     * @param int $max Maximum value (inclusive)
     * @return int Random value
     */
    public function nextInt(int $min = 0, int $max = 2147483647): int
    {
        if ($min > $max) {
            [$min, $max] = [$max, $min];
        }

        $range = $max - $min + 1;
        $randomValue = ($this->next64() & 0x7FFFFFFFFFFFFFFF) % $range;

        return $min + $randomValue;
    }

    /**
     * Generate random float in range [0, 1)
     * 
     * @return float Random value
     */
    public function nextFloat(): float
    {
        return (($this->next64() & 0x7FFFFFFFFFFFFFFF) / 9223372036854775808.0);
    }

    /**
     * Generate random float in range [min, max)
     * 
     * @param float $min Minimum value
     * @param float $max Maximum value
     * @return float Random value
     */
    public function nextFloatRange(float $min, float $max): float
    {
        return $min + ($max - $min) * $this->nextFloat();
    }

    /**
     * Generate random boolean (50% probability)
     * 
     * @param float $probability Probability of true [0, 1]
     * @return bool
     */
    public function nextBool(float $probability = 0.5): bool
    {
        return $this->nextFloat() < $probability;
    }

    /**
     * Randomly select from array of choices
     * 
     * @param array $choices Array of choices
     * @return mixed Selected choice
     */
    public function choose(array $choices): mixed
    {
        if (empty($choices)) {
            return null;
        }

        $index = $this->nextInt(0, count($choices) - 1);
        return $choices[$index];
    }

    /**
     * Randomly select with weighted probabilities
     * 
     * @param array $weighted ['option1' => 0.6, 'option2' => 0.4]
     * @return mixed Selected option
     */
    public function selectWeighted(array $weighted): mixed
    {
        if (empty($weighted)) {
            return null;
        }

        $cumulative = [];
        $sum = 0;

        foreach ($weighted as $option => $probability) {
            $sum += max(0, $probability);
            $cumulative[$option] = $sum;
        }

        if ($sum <= 0) {
            return null;
        }

        $random = $this->nextFloat() * $sum;

        foreach ($cumulative as $option => $cumulativeValue) {
            if ($random <= $cumulativeValue) {
                return $option;
            }
        }

        // Fallback to last option
        return array_key_last($weighted);
    }

    /**
     * Shuffle array using Fisher-Yates algorithm
     * 
     * @param array $array Array to shuffle
     * @return array Shuffled array
     */
    public function shuffle(array $array): array
    {
        $count = count($array);

        for ($i = $count - 1; $i > 0; $i--) {
            $j = $this->nextInt(0, $i);
            [$array[$i], $array[$j]] = [$array[$j], $array[$i]];
        }

        return $array;
    }

    /**
     * Randomly select k items from array (without replacement)
     * 
     * @param array $array Array to sample from
     * @param int $k Number of items to select
     * @return array Selected items
     */
    public function sample(array $array, int $k): array
    {
        $shuffled = $this->shuffle($array);
        return array_slice($shuffled, 0, min($k, count($shuffled)));
    }

    /**
     * Generate Gaussian/normal distributed random value
     * Uses Box-Muller transform
     * 
     * @param float $mean Mean value
     * @param float $stdDev Standard deviation
     * @return float Random value from normal distribution
     */
    public function nextGaussian(float $mean = 0.0, float $stdDev = 1.0): float
    {
        $u1 = $this->nextFloat();
        $u2 = $this->nextFloat();

        // Box-Muller transform
        $magnitude = sqrt(-2.0 * log($u1));
        $z0 = $magnitude * cos(2.0 * M_PI * $u2);

        return $mean + ($stdDev * $z0);
    }

    /**
     * Create seed from user+faction+timestamp for reproducible quests
     * 
     * @param int $userId User ID
     * @param string $faction Faction code
     * @param int $timestamp Unix timestamp
     * @return string Hex seed for SeededRandom
     */
    public static function createQuestSeed(int $userId, string $faction, int $timestamp): string
    {
        // Hash: userId + faction + date (daily seed)
        $daily = (int)($timestamp / 86400);  // Seconds per day
        $combined = "{$userId}:{$faction}:{$daily}";
        $hash = crc32($combined);

        return str_pad(dechex($hash), 8, '0', STR_PAD_LEFT);
    }

    /**
     * Get current state as hex string (for logging/audit)
     * 
     * @return string Hex representation of state
     */
    public function getStateSeed(): string
    {
        return str_pad(dechex($this->state), 16, '0', STR_PAD_LEFT);
    }

    /**
     * Reset to initial state
     * 
     * @return void
     */
    public function reset(): void
    {
        $this->state = self::$default_seed ?: 1;
    }
}
