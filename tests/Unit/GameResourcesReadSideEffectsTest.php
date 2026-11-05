<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class GameResourcesReadSideEffectsTest extends TestCase
{
    public function testResourcesGetSettlesOnlyOwnedColonyOnCacheMiss(): void
    {
        $gameApi = file_get_contents(__DIR__ . '/../../api/game.php');
        $gameEngine = file_get_contents(__DIR__ . '/../../api/game_engine.php');
        self::assertIsString($gameApi);
        self::assertIsString($gameEngine);
        $gameEngine = str_replace(["\r\n", "\r"], "\n", $gameEngine);

        $start = strpos($gameApi, "case 'resources':");
        $end = strpos($gameApi, "case 'planet_intel':", $start);
        self::assertNotFalse($start);
        self::assertNotFalse($end);
        $resources = substr($gameApi, $start, $end - $start);

        $methodGuard = strpos($resources, "only_method('GET');");
        $ownershipCheck = strpos($resources, 'verify_colony_ownership($db, $cid, $uid);');
        $cacheRead = strpos($resources, 'gq_cache_get(');
        $settlement = strpos($resources, 'update_colony_resources($db, $cid);');
        self::assertNotFalse($methodGuard);
        self::assertNotFalse($ownershipCheck);
        self::assertNotFalse($cacheRead);
        self::assertNotFalse($settlement);
        self::assertLessThan($ownershipCheck, $methodGuard);
        self::assertLessThan($cacheRead, $ownershipCheck);
        self::assertLessThan($settlement, $cacheRead);
        self::assertSame(1, substr_count($resources, 'update_colony_resources('));
        self::assertMatchesRegularExpression(
            '/if \(is_array\(\$cachedResources\).*?\)\s*\{\s*json_ok\(\$cachedResources\);/s',
            $resources
        );
        self::assertStringNotContainsString('simulation_tick(', $resources);

        self::assertStringContainsString(
            'if (ON_DEMAND_ECONOMY_ENABLED) {' . "\n"
                . '        (new OnDemandEconomy($db))->settle($colonyId, null, $now);',
            $gameEngine
        );
    }
}
