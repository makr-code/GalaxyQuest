<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/DraftWorldSimulation.php';

final class DraftWorldSimulationTest extends TestCase {
    private function draft(): array {
        $config = json_decode(file_get_contents(__DIR__ . '/../../config/galaxy_config.json'), true, 512, JSON_THROW_ON_ERROR);
        return [
            'starter' => $config['starter_homeworld'], 'position' => ['galaxy' => 1, 'system' => 1, 'position' => 3],
            'planets' => [['position' => 3], ['position' => 4]],
        ];
    }

    public function testBuildingCostAndCompletionUseServerTimeAndSharedRules(): void {
        $draft = $this->draft();
        $state = DraftWorldSimulation::create($draft, 1000);
        $before = $state['economy']['stock']['metal'];
        $cost = building_cost('metal_mine', 3);
        $state = DraftWorldSimulation::command($state, $draft, ['kind' => 'building', 'type' => 'metal_mine'], 1000);
        self::assertEquals($before - $cost['metal'], $state['economy']['stock']['metal']);
        $end = $state['queues']['building']['end'];
        self::assertSame(1000 + building_build_time($cost, 1, 0), $end);
        self::assertSame(2, DraftWorldSimulation::advance($state, $draft, $end - 1)['buildings']['metal_mine']);
        $state = DraftWorldSimulation::advance($state, $draft, $end);
        self::assertSame(3, $state['buildings']['metal_mine']);
        self::assertArrayNotHasKey('building', $state['queues']);
        self::assertSame($end, $state['economy']['settled_at']);
    }

    public function testLongOfflineProgressIsBoundedAndCanCatchUpWithoutATickEngine(): void {
        $draft = $this->draft();
        $state = DraftWorldSimulation::advance(DraftWorldSimulation::create($draft, 1000), $draft, 1000 + 172800);
        self::assertSame(86400, $state['economy']['pending_seconds']);
        self::assertSame(87400, $state['economy']['settled_at']);
        $state = DraftWorldSimulation::advance($state, $draft, 173800);
        self::assertSame(0, $state['economy']['pending_seconds']);
        self::assertGreaterThanOrEqual(0, $state['economy']['stock']['food']);
    }

    public function testSurveyCanOnlyVisitThePrivateSystemAndCompletesOnce(): void {
        $draft = $this->draft();
        $state = DraftWorldSimulation::create($draft, 1000);
        $state = DraftWorldSimulation::command($state, $draft, ['kind' => 'fleet', 'position' => 4], 1000);
        self::assertSame(790, $state['economy']['stock']['deuterium']);
        $end = $state['queues']['fleet']['end'];
        $state = DraftWorldSimulation::advance($state, $draft, $end);
        self::assertSame([4], $state['surveyed']);
        self::assertSame(2, $state['ships']['espionage_probe']);
        self::assertSame([4], DraftWorldSimulation::advance($state, $draft, $end)['surveyed']);
        $this->expectException(InvalidArgumentException::class);
        DraftWorldSimulation::command($state, $draft, ['kind' => 'fleet', 'position' => 99], $end);
    }

    public function testResearchCannotBypassPrerequisites(): void {
        $this->expectException(InvalidArgumentException::class);
        $draft = $this->draft();
        DraftWorldSimulation::command(DraftWorldSimulation::create($draft, 1000), $draft, ['kind' => 'research', 'type' => 'laser_tech'], 1000);
    }

    public function testUnknownOrdersCannotSpendResources(): void {
        $this->expectException(InvalidArgumentException::class);
        $draft = $this->draft();
        DraftWorldSimulation::command(DraftWorldSimulation::create($draft, 1000), $draft, ['kind' => 'attack', 'type' => 'metal_mine'], 1000);
    }
}
