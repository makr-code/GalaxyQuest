<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class FleetReadSideEffectsTest extends TestCase
{
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
