<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\GameOverviewSimulationSideEffects;

use PHPUnit\Framework\TestCase;

final class GameOverviewSimulationSideEffectsTest extends TestCase
{
    public function testOverviewNeverRunsSimulationSideEffectsFromAGetRequest(): void
    {
        $gameApi = file_get_contents(__DIR__ . '/../../api/game.php');
        $config = file_get_contents(__DIR__ . '/../../config/config.php');
        $projection = file_get_contents(__DIR__ . '/../../api/projection.php');

        self::assertIsString($gameApi);
        self::assertIsString($config);
        self::assertIsString($projection);
        self::assertStringContainsString(
            'build_live_overview_payload($db, $uid)',
            $gameApi
        );
        self::assertStringNotContainsString('$runSimulationSideEffects', $projection);
        self::assertStringNotContainsString('npc_ai_tick(', $projection);
        self::assertStringNotContainsString('process_economy_production_tick(', $projection);
        self::assertStringNotContainsString('apply_faction_pressure_situations(', $projection);
        self::assertStringNotContainsString('SIMULATION_TICK_ON_READ_ENABLED', $gameApi);
        self::assertStringNotContainsString('SIMULATION_TICK_ON_READ_ENABLED', $config);
    }

    public function testOverviewGetDoesNotWriteTheDurableProjection(): void
    {
        $gameApi = file_get_contents(__DIR__ . '/../../api/game.php');
        $projector = file_get_contents(__DIR__ . '/../../scripts/project_user_overview.php');
        self::assertIsString($gameApi);
        self::assertIsString($projector);
        self::assertStringContainsString('read_user_overview_projection($db, $uid)', $gameApi);
        self::assertStringNotContainsString('write_user_overview_projection(', $gameApi);
        self::assertStringContainsString(
            'write_user_overview_projection($connection, $userId, $payload, true)',
            $projector
        );
    }

    public function testOverviewLiveFallbackSettlesColonyEconomyWithoutRunningSimulationTicks(): void
    {
        $gameApi = file_get_contents(__DIR__ . '/../../api/game.php');
        $projection = file_get_contents(__DIR__ . '/../../api/projection.php');
        self::assertIsString($gameApi);
        self::assertIsString($projection);

        $overviewStart = strpos($gameApi, "case 'overview':");
        $resourcesStart = strpos($gameApi, "case 'resources':", $overviewStart);
        self::assertNotFalse($overviewStart);
        self::assertNotFalse($resourcesStart);
        $overview = substr($gameApi, $overviewStart, $resourcesStart - $overviewStart);
        self::assertStringContainsString("only_method('GET');", $overview);
        self::assertStringContainsString('build_live_overview_payload($db, $uid)', $overview);

        $builderStart = strpos($projection, 'function build_live_overview_payload(');
        $settlementOffset = strpos($projection, 'update_all_colonies($db, $uid);', $builderStart);
        self::assertNotFalse($builderStart);
        self::assertNotFalse($settlementOffset);
        self::assertStringNotContainsString('if ($runSimulationSideEffects)', $projection);
        self::assertStringContainsString("'pressure_events' => default_faction_pressure_events()", $projection);
    }

    public function testSimulationTickHttpEndpointRequiresPostAndCsrf(): void
    {
        $tickApi = file_get_contents(__DIR__ . '/../../api/simulation_tick.php');
        $npcControllerApi = file_get_contents(__DIR__ . '/../../api/npc_controller.php');
        self::assertIsString($tickApi);
        self::assertIsString($npcControllerApi);
        self::assertStringContainsString("only_method('POST')", $tickApi);
        self::assertStringContainsString('verify_csrf()', $tickApi);
        self::assertStringContainsString("case 'run_once':", $npcControllerApi);
        $runOnceStart = strpos($npcControllerApi, "case 'run_once':");
        $defaultStart = strpos($npcControllerApi, 'default:', $runOnceStart);
        self::assertNotFalse($runOnceStart);
        self::assertNotFalse($defaultStart);
        $runOnceHandler = substr($npcControllerApi, $runOnceStart, $defaultStart - $runOnceStart);
        self::assertStringContainsString("only_method('POST')", $runOnceHandler);
        self::assertStringContainsString('verify_csrf()', $runOnceHandler);
    }
}
