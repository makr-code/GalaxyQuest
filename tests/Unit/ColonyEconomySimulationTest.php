<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use GalaxyQuest\Economy\ColonyEconomySimulation;

final class ColonyEconomySimulationTest extends TestCase
{
    private function state(): array
    {
        return [
            'settled_at' => 1000000, 'stock' => ['food' => 1000, 'metal' => 1000, 'rare_earth' => 100],
            'classes' => array_replace(array_fill_keys(ColonyEconomySimulation::CLASSES, 0), ['colonist' => 100]),
            'satisfaction' => 100.0, 'progress' => [], 'growth_remainder' => 0.0, 'deposits' => [],
        ];
    }

    private function context(): array
    {
        return [
            'buildings' => [], 'raw_production' => ['food' => 10],
            'energy_available' => 1000, 'population_capacity' => 1000,
            'services' => 100, 'service_levels' => 3,
            'capacity' => ['food' => 5000, 'metal' => 5000], 'methods' => [],
            'research' => ['energy_tech' => 1, 'computer_tech' => 1],
            'income_tax' => 0.15,
        ];
    }

    public function testSameClockDoesNotChangeAnything(): void
    {
        $state = $this->state();
        $result = ColonyEconomySimulation::advance($state, $this->context(), $state['settled_at']);
        unset($result['pending_seconds']);
        self::assertSame($state, $result);
    }

    public function testOptionalPopulationPeakCapturesGrowthBeforeStarvationWithoutChangingSimulation(): void
    {
        $state = $this->state();
        $state['classes']['colonist'] = 1999;
        $state['stock']['food'] = 5;
        $state['growth_remainder'] = 0.99;
        $context = $this->context();
        $context['raw_production'] = [];
        $context['population_capacity'] = 5000;
        $peak = 1999;
        $result = ColonyEconomySimulation::advance($state, $context, 1086400, false, $peak);
        self::assertGreaterThanOrEqual(2000, $peak);
        self::assertLessThan(1999, array_sum($result['classes']));
        self::assertSame(ColonyEconomySimulation::advance($state, $context, 1086400), $result);
        $partialPeak = 0;
        $partial = ColonyEconomySimulation::advance($state, $context, 1000100, true, $partialPeak);
        self::assertSame(array_sum($partial['classes']), $partialPeak);
        self::assertSame(1000100, $partial['settled_at']);
    }

    public function testRefreshFrequencyDoesNotAffectSimulation(): void
    {
        $state = $this->state();
        $once = ColonyEconomySimulation::advance($state, $this->context(), 1086400);
        $frequent = $state;
        for ($time = 1000000; $time <= 1086400; $time += 60) {
            $frequent = ColonyEconomySimulation::advance($frequent, $this->context(), $time);
        }
        self::assertEquals($once, $frequent);
    }

    public function testFractionalGrowthAccumulatesForStarterPopulation(): void
    {
        $result = ColonyEconomySimulation::advance($this->state(), $this->context(), 1086400);
        self::assertGreaterThan(100, array_sum($result['classes']));
        self::assertGreaterThanOrEqual(0, $result['growth_remainder']);
        self::assertLessThan(1, $result['growth_remainder']);
    }

    public function testOfflineWorkIsBoundedWithoutDroppingBacklog(): void
    {
        $first = ColonyEconomySimulation::advance($this->state(), $this->context(), 1259200);
        self::assertSame(1086400, $first['settled_at']);
        self::assertSame(172800, $first['pending_seconds']);
        $second = ColonyEconomySimulation::advance($first, $this->context(), 1259200);
        self::assertSame(1172800, $second['settled_at']);
        self::assertSame(86400, $second['pending_seconds']);
    }

    public function testMutationSettlesPartialStepBeforeChangingRates(): void
    {
        $state = $this->state();
        $read = ColonyEconomySimulation::advance($state, $this->context(), 1000100);
        self::assertSame(1000000, $read['settled_at']);
        $write = ColonyEconomySimulation::advance($read, $this->context(), 1000100, true);
        self::assertSame(1000100, $write['settled_at']);
        self::assertSame(0, $write['pending_seconds']);
        self::assertGreaterThan(1000, $write['stock']['food']);
    }

    public function testProductionConsumesActualPrimaryInputs(): void
    {
        $context = $this->context();
        $context['buildings'] = ['metallurgy' => 1];
        $result = ColonyEconomySimulation::advance($this->state(), $context, 1003600);
        self::assertGreaterThan(0, $result['stock']['steel_alloy']);
        self::assertEqualsWithDelta(
            $result['stock']['steel_alloy'] * 2,
            1000 - $result['stock']['metal'],
            1e-8
        );
    }

    public function testInputScarcityCannotCreateGoodsOrNegativeStock(): void
    {
        $context = $this->context();
        $context['buildings'] = ['metallurgy' => 100];
        $state = $this->state();
        $state['stock']['metal'] = 1;
        $result = ColonyEconomySimulation::advance($state, $context, 1003600);
        self::assertEqualsWithDelta(0.5, $result['stock']['steel_alloy'], 1e-8);
        self::assertGreaterThanOrEqual(0, $result['stock']['metal']);
    }

    public function testProductionRequiresEnergyAndResearch(): void
    {
        $context = $this->context();
        $context['buildings'] = ['metallurgy' => 1];
        $context['energy_available'] = 0;
        $result = ColonyEconomySimulation::advance($this->state(), $context, 1003600);
        self::assertSame(0.0, $result['stock']['steel_alloy']);
        $context['energy_available'] = 100;
        $context['research'] = [];
        $result = ColonyEconomySimulation::advance($this->state(), $context, 1003600);
        self::assertArrayNotHasKey('steel_alloy', $result['stock']);
    }

    public function testStoredFoodProtectsPopulationWithoutFarms(): void
    {
        $context = $this->context();
        $context['raw_production'] = [];
        $result = ColonyEconomySimulation::advance($this->state(), $context, 1086400);
        self::assertGreaterThanOrEqual(100, array_sum($result['classes']));
        self::assertArrayNotHasKey('food', $result['shortages']);
    }

    public function testStarvationReducesPopulationButDoesNotEraseColony(): void
    {
        $context = $this->context();
        $context['raw_production'] = [];
        $state = $this->state();
        $state['stock']['food'] = 0;
        $result = ColonyEconomySimulation::advance($state, $context, 1086400);
        self::assertLessThan(100, array_sum($result['classes']));
        self::assertGreaterThanOrEqual(1, array_sum($result['classes']));
        self::assertArrayHasKey('food', $result['shortages']);
    }

    public function testSuppliedPopsAdvanceAndKeepTotalPopulation(): void
    {
        $state = $this->state();
        $state['stock']['consumer_goods'] = 100;
        $context = $this->context();
        $context['population_capacity'] = 100;
        $result = ColonyEconomySimulation::advance($state, $context, 1086400);
        self::assertGreaterThan(0, $result['classes']['citizen']);
        self::assertSame(100, array_sum($result['classes']));
    }

    public function testAdvancedClassesDescendWhenNeedsAreMissing(): void
    {
        $state = $this->state();
        $state['classes']['colonist'] = 90;
        $state['classes']['specialist'] = 10;
        $result = ColonyEconomySimulation::advance($state, $this->context(), 1086400);
        self::assertLessThan(10, $result['classes']['specialist']);
        self::assertGreaterThan(0, $result['classes']['citizen']);
    }

    public function testDepositsCannotBeOverdrawn(): void
    {
        $state = $this->state();
        $state['deposits']['metal'] = 0.25;
        $context = $this->context();
        $context['raw_production']['metal'] = 100;
        $result = ColonyEconomySimulation::advance($state, $context, 1003600);
        self::assertSame(0.0, $result['deposits']['metal']);
        self::assertEqualsWithDelta(1000.25, $result['stock']['metal'], 1e-8);
    }

    public function testStorageCapsStopProductionBeforeConsumingInputs(): void
    {
        $state = $this->state();
        $state['stock']['steel_alloy'] = 5000;
        $context = $this->context();
        $context['buildings'] = ['metallurgy' => 1];
        $result = ColonyEconomySimulation::advance($state, $context, 1003600);
        self::assertSame(5000.0, $result['stock']['steel_alloy']);
        self::assertSame(1000.0, $result['stock']['metal']);
    }

    public function testClockCannotMoveBackwards(): void
    {
        $this->expectException(InvalidArgumentException::class);
        ColonyEconomySimulation::advance($this->state(), $this->context(), 1);
    }

    public function testFullStorageDoesNotWasteFiniteDeposits(): void
    {
        $state = $this->state();
        $state['stock']['metal'] = 5000;
        $state['deposits']['metal'] = 100;
        $context = $this->context();
        $context['raw_production']['metal'] = 100;
        $result = ColonyEconomySimulation::advance($state, $context, 1003600);
        self::assertSame(100.0, $result['deposits']['metal']);
    }

    public function testProductionTaxDebitsOutputAndCreditsItsBaseValue(): void
    {
        $context = $this->context();
        $context['raw_production'] = ['metal' => 100];
        $context['production_tax'] = 0.2;
        $context['income_tax'] = 0;
        $state = $this->state();
        $result = ColonyEconomySimulation::advance($state, $context, 1000300);
        $net = $result['stock']['metal'] - 1000;
        self::assertEqualsWithDelta($net / 0.8 * 0.2 * 10, $result['credit_delta'], 1e-8);
    }

    public function testStarvationAtSurvivalFloorDoesNotCreateFutureGrowthDebt(): void
    {
        $state = $this->state();
        $state['classes']['colonist'] = 1;
        $state['stock']['food'] = 0;
        $context = $this->context();
        $context['raw_production'] = [];
        $result = ColonyEconomySimulation::advance($state, $context, 1086400);
        self::assertSame(1, array_sum($result['classes']));
        self::assertSame(0.0, $result['growth_remainder']);
    }

    public function testIndustrialShortagesCreateInputDemandWithoutDebitingMissingStock(): void
    {
        $state = $this->state();
        $state['stock']['metal'] = 0;
        $context = $this->context();
        $context['buildings'] = ['metallurgy' => 1];
        $result = ColonyEconomySimulation::advance($state, $context, 1000300);
        self::assertGreaterThan(0, $result['consumption']['metal']);
        self::assertSame(0.0, $result['stock']['metal']);
    }
}
