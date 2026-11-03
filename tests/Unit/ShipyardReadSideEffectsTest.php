<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class ShipyardReadSideEffectsTest extends TestCase
{
    public function testShipyardReadsDoNotCompleteBuildsAndFinishRequiresPostWithCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/shipyard.php');
        self::assertIsString($source);
        $listStart = strpos($source, 'function action_shipyard_list(');
        $listEnd = strpos($source, 'function action_list_blueprints(', $listStart);
        self::assertNotFalse($listStart);
        self::assertNotFalse($listEnd);
        self::assertStringNotContainsString('complete_ship_build_queue(', substr($source, $listStart, $listEnd - $listStart));
        $finishStart = strpos($source, "case 'finish':");
        $finishEnd = strpos($source, "case 'list_hulls':", $finishStart);
        self::assertNotFalse($finishStart);
        self::assertNotFalse($finishEnd);
        $handler = substr($source, $finishStart, $finishEnd - $finishStart);
        self::assertStringContainsString("only_method('POST')", $handler);
        self::assertStringContainsString('verify_csrf()', $handler);
        self::assertStringContainsString('verify_colony_ownership(', $handler);
    }

    public function testBuildInvalidatesResourceOverviewBeforeAcknowledging(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/shipyard.php');
        self::assertIsString($source);
        $start = strpos($source, "case 'build':");
        $end = strpos($source, 'default:', $start);
        self::assertNotFalse($start);
        self::assertNotFalse($end);
        $build = substr($source, $start, $end - $start);
        $invalidate = strpos($build, "gq_cache_delete('game_overview', ['uid' => \$uid])");
        $ack = strpos($build, 'json_ok([');
        self::assertNotFalse($invalidate);
        self::assertNotFalse($ack);
        self::assertGreaterThan($invalidate, $ack);
    }
}
