<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/economy_runtime.php';

final class ColonyEconomyCalculationTest extends TestCase
{
    public function testSmallColonyGrowthRateIsFractionalAndStarvationIsNegative(): void
    {
        self::assertEqualsWithDelta(0.16, population_growth(100, 500, 100, 1.5), 1e-12);
        self::assertSame(-0.5, population_growth(100, 500, 100, 0.0));
    }

    public function testStoredFoodPreventsStarvationWithoutAWorkingFarm(): void
    {
        self::assertSame(10.0, colony_food_consumption(1000));
        $balance = colony_food_balance(50, 0, 10, 1000, 1);
        self::assertSame(['stock' => 40.0, 'consumed' => 10.0, 'coverage' => 1.0], $balance);
        $depleted = colony_food_balance(5, 0, 10, 1000, 1);
        self::assertSame(0.0, $depleted['stock']);
        self::assertSame(0.5, $depleted['coverage']);
        self::assertSame(0.0, colony_food_balance(0, 0, 10, 1000, 1)['coverage']);
    }

    public function testFoodProductionAndConsumptionUseSameIntervalAndPreserveImports(): void
    {
        $balance = colony_food_balance(0, 20, 10, 1000, 0.5);
        self::assertSame(['stock' => 5.0, 'consumed' => 5.0, 'coverage' => 2.0], $balance);
        self::assertSame(1990.0, colony_food_balance(2000, 0, 10, 1000, 1)['stock']);
        self::assertSame(2000.0, colony_food_balance(2000, 100, 10, 1000, 1)['stock']);
    }

    public function testExtractionCannotMultiplyFiniteDepositsDuringLongOfflineTime(): void
    {
        foreach ([1 / 60, 0.5, 1, 12, 72] as $hours) {
            $result = colony_extraction(20, 1200, 10000, 5.5, $hours);
            self::assertSame(25.5, $result['stock']);
            self::assertSame(5.5, $result['extracted']);
            self::assertSame(0.0, $result['remaining']);
        }
    }

    public function testExtractionHonorsStorageAndPreservesUnlimitedAndFractionalReserves(): void
    {
        self::assertSame(
            ['stock' => 100.0, 'extracted' => 1.0, 'remaining' => 9.0, 'remainder' => 0.0],
            colony_extraction(99, 100, 100, 10, 1)
        );
        self::assertSame(
            ['stock' => 200.0, 'extracted' => 0.0, 'remaining' => 10.0, 'remainder' => 0.0],
            colony_extraction(200, 100, 100, 10, 1)
        );
        self::assertSame(-1.0, colony_extraction(0, 100, 1000, -1, 1)['remaining']);
        $fraction = colony_extraction(0, 0.6, 100, 1, 1 / 60);
        self::assertSame(0.01, $fraction['extracted']);
        self::assertSame(0.99, $fraction['remaining']);
        self::assertSame(0.0, colony_extraction(0, 100, 1000, 0, 1)['extracted']);
    }

    private function row(): array
    {
        return [
            'population' => 100, 'food' => 200, 'happiness' => 70,
            'solar_plant_level' => 10, 'metal_mine_level' => 1,
            'hydroponic_farm_level' => 1, 'hospital_level' => 1,
            'deposit_metal' => 1.25, 'colony_type' => 'mining',
        ];
    }

    public function testSnapshotAppliesBonusesBeforeDepositCapAndIncludesResearch(): void
    {
        $snapshot = calculate_colony_consumption_snapshot($this->row(), [
            'research' => ['genetic_engineering' => 1],
            'event' => 'mineral_vein', 'manager' => ['skill_production' => 10],
        ]);
        self::assertSame(1.25, $snapshot['extraction']['metal']['extracted']);
        self::assertSame(1.25, $snapshot['production']['metal_per_hour']);
        self::assertSame(550, $snapshot['welfare']['population_capacity']);
        self::assertSame(21.125, $snapshot['production']['food_per_hour']);
        self::assertSame(1.0, $snapshot['consumption']['food_per_hour']);
        self::assertGreaterThan(0.0, $snapshot['welfare']['population_growth_per_hour']);
    }

    public function testBrownoutAlsoConstrainsFoodAndSnapshotDoesNotMutateInput(): void
    {
        $row = $this->row();
        $row['solar_plant_level'] = 0;
        $original = $row;
        $snapshot = calculate_colony_consumption_snapshot($row);
        self::assertSame(0.0, $snapshot['production']['food_per_hour']);
        self::assertSame(0.0, $snapshot['production']['metal_per_hour']);
        self::assertSame(1.0, $snapshot['welfare']['food_coverage']);
        self::assertSame($original, $row);
    }

    public function testEventsAndSpecialistBonusesRemainInSharedSnapshot(): void
    {
        $row = $this->row();
        $plain = calculate_colony_consumption_snapshot($row);
        $flare = calculate_colony_consumption_snapshot($row, ['event' => 'solar_flare']);
        self::assertEqualsWithDelta(
            $plain['production']['energy_per_hour'] * 0.7,
            $flare['production']['energy_per_hour'], 1e-4
        );
        $disease = calculate_colony_consumption_snapshot($row, ['event' => 'disease', 'hospital_ships' => 1]);
        self::assertSame($plain['welfare']['happiness'] - 25 + 8, $disease['welfare']['happiness']);
    }
}
