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

    public function testVesselListPropagatesDatabaseFailuresInsteadOfReturningAnEmptySuccess(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/shipyard.php');
        self::assertIsString($source);

        $list = $this->functionBody($source, 'action_list_vessels');
        self::assertStringContainsString('ensure_built_vessels_table($db);', $list);
        self::assertDoesNotMatchRegularExpression('/catch\s*\(\s*PDOException\b/', $list);
        self::assertStringNotContainsString("json_ok(['vessels' => []]);", $list);
    }

    public function testFactionAffinityReadersOnlyIgnoreAMissingMigrationTable(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/shipyard.php');
        self::assertIsString($source);

        foreach ([
            'load_faction_tech_affinities_for_user',
            'load_faction_tech_affinities_display',
        ] as $functionName) {
            $body = $this->functionBody($source, $functionName);
            self::assertStringContainsString("if (\$e->getCode() !== '42S02')", $body);
            self::assertStringContainsString('throw $e;', $body);
        }
    }

    private function functionBody(string $source, string $functionName): string
    {
        $start = strpos($source, 'function ' . $functionName . '(');
        self::assertNotFalse($start, $functionName . ' must exist.');
        $next = preg_match('/^[ \t]*function\s+/m', $source, $matches, PREG_OFFSET_CAPTURE, $start + 1)
            ? $matches[0][1]
            : strlen($source);
        return substr($source, $start, $next - $start);
    }
}
