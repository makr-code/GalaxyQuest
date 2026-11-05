<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class FleetReadSideEffectsTest extends TestCase
{
    public function testAcceptedDispatchInvalidatesInventoryAndOverviewBeforeAcknowledging(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/fleet.php');
        self::assertIsString($source);
        $start = strpos($source, 'function send_fleet(');
        $end = strpos($source, 'function list_wormholes(', $start);
        self::assertNotFalse($start);
        self::assertNotFalse($end);
        $dispatch = substr($source, $start, $end - $start);
        $inventory = strpos($dispatch, "gq_cache_delete('shipyard_list', ['uid' => \$uid, 'cid' => \$originCid])");
        $overview = strpos($dispatch, "gq_cache_delete('game_overview', ['uid' => \$uid])");
        $error = strpos($dispatch, '} catch (DomainException $error)');
        $ack = strpos($dispatch, "json_ok(['fleet_id'");
        self::assertNotFalse($inventory);
        self::assertNotFalse($overview);
        self::assertNotFalse($error);
        self::assertNotFalse($ack);
        self::assertGreaterThan($error, $inventory);
        self::assertGreaterThan($inventory, $ack);
        self::assertGreaterThan($overview, $ack);
    }

    public function testFleetListIsReadOnlyAndArrivalProcessingRequiresPostAndCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/fleet.php');
        self::assertIsString($source);

        $listStart = strpos($source, "case 'list':");
        $listEnd = strpos($source, "case 'rename_fleet':", $listStart);
        $checkStart = strpos($source, "case 'check':");
        $checkEnd = strpos($source, "case 'simulate_battle':", $checkStart);

        self::assertNotFalse($listStart);
        self::assertNotFalse($listEnd);
        self::assertNotFalse($checkStart);
        self::assertNotFalse($checkEnd);

        $listHandler = substr($source, $listStart, $listEnd - $listStart);
        $checkHandler = substr($source, $checkStart, $checkEnd - $checkStart);

        self::assertStringNotContainsString('process_fleet_arrivals(', $listHandler);
        self::assertStringContainsString("only_method('POST')", $checkHandler);
        self::assertStringContainsString('verify_csrf()', $checkHandler);
        self::assertStringContainsString('process_fleet_arrivals(get_db())', $checkHandler);
    }

    public function testFtlReadActionsAndHelpersDoNotMutateFleetOrTravelState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/fleet.php');
        $gameEngine = file_get_contents(__DIR__ . '/../../api/game_engine.php');
        self::assertIsString($source);
        self::assertIsString($gameEngine);

        foreach ([
            ['wormholes', 'list_wormholes'],
            ['ftl_status', 'list_ftl_status'],
            ['ftl_map', 'list_ftl_map'],
        ] as [$action, $function]) {
            $caseStart = strpos($source, "case '" . $action . "':");
            $nextCase = strpos($source, "\n    case '", $caseStart + 1);
            self::assertNotFalse($caseStart, $action . ' action must exist.');
            self::assertNotFalse($nextCase, $action . ' action must be bounded.');
            $handler = substr($source, $caseStart, $nextCase - $caseStart);
            self::assertStringContainsString("only_method('GET');", $handler, $action);

            $readHelper = $this->functionBody($source, $function);
            self::assertDoesNotMatchRegularExpression(
                '/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i',
                $readHelper,
                $function
            );
        }

        $coordinateHelper = $this->functionBody($gameEngine, 'get_system_3d_coords');
        self::assertDoesNotMatchRegularExpression(
            '/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i',
            $coordinateHelper
        );
        self::assertStringContainsString('SELECT x_ly, y_ly, z_ly FROM star_systems', $coordinateHelper);
    }

    private function functionBody(string $source, string $function): string
    {
        $start = strpos($source, 'function ' . $function . '(');
        self::assertNotFalse($start, $function . ' function must exist.');
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        $end = $nextFunction === false ? strlen($source) : $nextFunction;
        return substr($source, $start, $end - $start);
    }
}
