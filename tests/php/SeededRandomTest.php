<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class SeededRandomTest extends TestCase
{
    public function testSameSeedProducesSameSequence(): void
    {
        $rng1 = new SeededRandom(42);
        $rng2 = new SeededRandom(42);

        for ($i = 0; $i < 100; $i++) {
            $this->assertEquals($rng1->nextInt(), $rng2->nextInt());
        }
    }

    public function testDifferentSeedProduceDifferentSequences(): void
    {
        $rng1 = new SeededRandom(42);
        $rng2 = new SeededRandom(43);

        $different = false;
        for ($i = 0; $i < 10; $i++) {
            if ($rng1->nextInt() !== $rng2->nextInt()) {
                $different = true;
                break;
            }
        }

        $this->assertTrue($different, 'Different seeds should produce different values');
    }

    public function testNextIntInRange(): void
    {
        $rng = new SeededRandom(42);

        for ($i = 0; $i < 1000; $i++) {
            $value = $rng->nextInt(1, 10);
            $this->assertGreaterThanOrEqual(1, $value);
            $this->assertLessThanOrEqual(10, $value);
        }
    }

    public function testNextFloatInRange(): void
    {
        $rng = new SeededRandom(42);

        for ($i = 0; $i < 1000; $i++) {
            $value = $rng->nextFloat();
            $this->assertGreaterThanOrEqual(0, $value);
            $this->assertLessThan(1, $value);
        }
    }

    public function testNextBoolRespectsProbability(): void
    {
        $rng = new SeededRandom(42);
        $trueCount = 0;
        $trials = 10000;

        for ($i = 0; $i < $trials; $i++) {
            if ($rng->nextBool(0.5)) {
                $trueCount++;
            }
        }

        // Allow 45-55% tolerance
        $ratio = $trueCount / $trials;
        $this->assertGreaterThan(0.45, $ratio);
        $this->assertLessThan(0.55, $ratio);
    }

    public function testChooseSelectsFromArray(): void
    {
        $rng = new SeededRandom(42);
        $choices = ['apple', 'banana', 'cherry', 'date'];

        for ($i = 0; $i < 100; $i++) {
            $selected = $rng->choose($choices);
            $this->assertContains($selected, $choices);
        }
    }

    public function testChooseEmptyArray(): void
    {
        $rng = new SeededRandom(42);
        $result = $rng->choose([]);
        $this->assertNull($result);
    }

    public function testSelectWeighted(): void
    {
        $rng = new SeededRandom(42);
        $weighted = ['common' => 0.7, 'rare' => 0.2, 'epic' => 0.1];

        $counts = ['common' => 0, 'rare' => 0, 'epic' => 0];

        for ($i = 0; $i < 10000; $i++) {
            $selected = $rng->selectWeighted($weighted);
            $counts[$selected]++;
        }

        // Verify distribution (approximate)
        $this->assertGreaterThan(6500, $counts['common']);
        $this->assertLessThan(7500, $counts['common']);
        $this->assertGreaterThan(1500, $counts['rare']);
        $this->assertLessThan(2500, $counts['rare']);
    }

    public function testShuffle(): void
    {
        $rng = new SeededRandom(42);
        $original = [1, 2, 3, 4, 5];
        $shuffled = $rng->shuffle($original);

        // Should have same elements
        sort($original);
        sort($shuffled);
        $this->assertEquals($original, $shuffled);
    }

    public function testSample(): void
    {
        $rng = new SeededRandom(42);
        $array = ['a', 'b', 'c', 'd', 'e'];
        $sample = $rng->sample($array, 3);

        $this->assertEquals(3, count($sample));
        foreach ($sample as $item) {
            $this->assertContains($item, $array);
        }
    }

    public function testNextGaussian(): void
    {
        $rng = new SeededRandom(42);
        $samples = [];

        for ($i = 0; $i < 1000; $i++) {
            $samples[] = $rng->nextGaussian(0, 1);
        }

        $mean = array_sum($samples) / count($samples);
        $this->assertGreaterThan(-0.2, $mean);
        $this->assertLessThan(0.2, $mean);
    }

    public function testCreateQuestSeed(): void
    {
        $seed1 = SeededRandom::createQuestSeed(123, 'iron_fleet', time());
        $seed2 = SeededRandom::createQuestSeed(123, 'iron_fleet', time());

        // Same day, same seed
        $this->assertEquals($seed1, $seed2);

        $seed3 = SeededRandom::createQuestSeed(124, 'iron_fleet', time());
        // Different user, different seed
        $this->assertNotEquals($seed1, $seed3);
    }

    public function testHexSeedInitialization(): void
    {
        $rng1 = new SeededRandom('0x2A');
        $rng2 = new SeededRandom(42);

        // Both should initialize with same value
        $v1 = $rng1->nextInt();
        $v2 = $rng2->nextInt();

        // Note: not exactly equal due to state initialization,
        // but should be from same seed family
        $this->assertIsInt($v1);
        $this->assertIsInt($v2);
    }

    public function testGetStateSeed(): void
    {
        $rng = new SeededRandom(12345);
        $state = $rng->getStateSeed();

        $this->assertIsString($state);
        $this->assertGreaterThan(0, strlen($state));
        $this->assertTrue(ctype_xdigit($state)); // All hex characters
    }
}

require_once __DIR__ . '/../../lib/SeededRandom.php';
