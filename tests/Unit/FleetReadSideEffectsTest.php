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
}
