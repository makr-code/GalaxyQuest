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

        self::assertIsString($gameApi);
        self::assertIsString($config);
        self::assertStringContainsString(
            'build_live_overview_payload($db, $uid, false)',
            $gameApi
        );
        self::assertStringNotContainsString('SIMULATION_TICK_ON_READ_ENABLED', $gameApi);
        self::assertStringNotContainsString('SIMULATION_TICK_ON_READ_ENABLED', $config);
    }
}
