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
        $library = file_get_contents(__DIR__ . '/../../lib/fleet_launch.php');
        self::assertIsString($library);
        $shared = $this->functionBody($library, 'launch_fleet_dispatch');
        $inventory = strpos($shared, "gq_cache_delete('shipyard_list', ['uid' => \$uid, 'cid' => \$originCid])");
        $overview = strpos($shared, "gq_cache_delete('game_overview', ['uid' => \$uid])");
        $transaction = strpos($shared, 'transactionWithColony(');
        $ack = strrpos($shared, 'return $result;');
        self::assertNotFalse($inventory);
        self::assertNotFalse($overview);
        self::assertNotFalse($transaction);
        self::assertNotFalse($ack);
        self::assertGreaterThan($transaction, $inventory);
        self::assertGreaterThan($inventory, $ack);
        self::assertGreaterThan($overview, $ack);
        self::assertStringContainsString('launch_fleet_dispatch($db, $uid, $body)', $dispatch);
        self::assertStringContainsString('json_ok($result)', $dispatch);
        $locked = $this->functionBody($library, 'launch_fleet_dispatch_locked');
        self::assertStringContainsString("enqueue_dirty_user(\$db, \$uid, 'fleet_sent')", $locked);
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
        self::assertStringContainsString("require_once __DIR__ . '/simulation_runtime.php';", $source);
        self::assertStringContainsString('simulation_runtime_with_scope_lock(', $checkHandler);
        self::assertStringContainsString("'fleet_arrivals',", $checkHandler);
        self::assertStringContainsString('process_fleet_arrivals($db)', $checkHandler);
        self::assertStringContainsString("return ['executed' => true]", $checkHandler);
        self::assertStringContainsString('json_ok($result)', $checkHandler);
    }

    public function testEncounterReadActionIsGatedAuthenticatedAndDoesNotSimulate(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/fleet.php');
        self::assertIsString($source);
        $start = strpos($source, "case 'battle_encounter':");
        $end = strpos($source, "case 'list':", $start);
        self::assertNotFalse($start);
        self::assertNotFalse($end);
        $handler = substr($source, $start, $end - $start);
        self::assertStringContainsString("only_method('GET')", $handler);
        self::assertStringContainsString('if (!BATTLE_ENCOUNTERS_ENABLED)', $handler);
        self::assertStringContainsString('->read($uid, $encounterId)', $handler);
        self::assertStringNotContainsString('process_fleet_arrivals(', $handler);
        self::assertStringNotContainsString('simulation_runtime_', $handler);
        $authentication = strpos($source, '$uid    = require_auth();');
        self::assertNotFalse($authentication);
        self::assertLessThan($start, $authentication);
    }

    public function testCombatPreviewsProjectDueShipBuildsWithoutCompletingTheQueue(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/fleet.php');
        self::assertIsString($source);

        $preview = $this->functionBody($source, 'simulate_battle_preview');
        $defenderStats = $this->functionBody($source, 'compute_preview_defender_stats');
        self::assertStringNotContainsString('complete_ship_build_queue(', $preview);
        self::assertStringNotContainsString('complete_ship_build_queue(', $defenderStats);
        self::assertStringContainsString('project_colony_ship_counts($db', $preview . $defenderStats);

        $projection = $this->functionBody($source, 'project_colony_ship_counts');
        self::assertStringContainsString('FROM ships WHERE colony_id', $projection);
        self::assertStringContainsString('FROM ship_build_queue', $projection);
        self::assertStringContainsString("status = \\'running\\'", $projection);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
            $projection
        );
    }

    public function testFleetRecallAndArrivalClaimTheSameRowTransactionally(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/fleet.php');
        self::assertIsString($source);

        $recall = $this->functionBody($source, 'recall_fleet');
        self::assertStringContainsString('$db->beginTransaction();', $recall);
        self::assertStringContainsString('`returning` = 0 FOR UPDATE', $recall);
        self::assertStringContainsString('arrival_time', $recall);
        self::assertStringContainsString('WHERE id = ? AND `returning` = 0', $recall);
        self::assertStringContainsString('$db->commit();', $recall);
        self::assertStringContainsString('$db->rollBack();', $recall);

        $arrival = $this->functionBody($source, 'process_fleet_arrival_locked');
        self::assertStringContainsString('arrival_time <= NOW() FOR UPDATE', $arrival);
        self::assertStringContainsString('handle_fleet_arrival($db, $current)', $arrival);

        $sweep = $this->functionBody($source, 'process_fleet_arrivals');
        self::assertStringContainsString('process_fleet_arrival_locked($db', $sweep);
        self::assertStringContainsString('$economy->transaction(', $sweep);
        self::assertStringContainsString('$economy->settle($recipient)', $sweep);
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
