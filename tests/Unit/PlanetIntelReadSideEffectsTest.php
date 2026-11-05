<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class PlanetIntelReadSideEffectsTest extends TestCase
{
    public function testPlanetIntelGetDoesNotBackfillDiplomacyRows(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/game.php');
        self::assertIsString($source);

        $start = strpos($source, "case 'planet_intel':");
        $end = strpos($source, "case 'health':", $start);
        self::assertNotFalse($start);
        self::assertNotFalse($end);
        $route = substr($source, $start, $end - $start);
        self::assertStringContainsString("only_method('GET');", $route);
        self::assertStringContainsString('territory_factions_for_galaxy($db, $uid, $g)', $route);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
            $route
        );

        $helperStart = strpos($source, 'function territory_factions_for_galaxy(');
        $helperEnd = strpos($source, "\nfunction summarize_scan_payload(", $helperStart);
        self::assertNotFalse($helperStart);
        self::assertNotFalse($helperEnd);
        $helper = substr($source, $helperStart, $helperEnd - $helperStart);
        self::assertStringContainsString('COALESCE(d.standing, f.base_diplomacy) AS standing', $helper);
        self::assertStringContainsString('LEFT JOIN diplomacy d', $helper);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
            $helper
        );
    }

    public function testRemainingGameReadActionsAreReadOnlyExceptLazyResourceSettlement(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/game.php');
        self::assertIsString($source);

        foreach ([
            ['health', 'rename_colony'],
            ['leaderboard', 'set_ftl_drive'],
        ] as [$action, $nextAction]) {
            $start = strpos($source, "case '" . $action . "':");
            $end = strpos($source, "case '" . $nextAction . "':", $start);
            self::assertNotFalse($start);
            self::assertNotFalse($end);
            $route = substr($source, $start, $end - $start);
            self::assertStringContainsString("only_method('GET');", $route);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
                $route
            );
        }

        $resourcesStart = strpos($source, "case 'resources':");
        $intelStart = strpos($source, "case 'planet_intel':", $resourcesStart);
        self::assertNotFalse($resourcesStart);
        self::assertNotFalse($intelStart);
        $resources = substr($source, $resourcesStart, $intelStart - $resourcesStart);
        self::assertStringContainsString("only_method('GET');", $resources);
        self::assertStringContainsString('verify_colony_ownership($db, $cid, $uid);', $resources);
        self::assertStringContainsString('update_colony_resources($db, $cid);', $resources);
    }
}
