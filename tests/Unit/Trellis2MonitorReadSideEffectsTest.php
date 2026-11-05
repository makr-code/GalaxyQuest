<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class Trellis2MonitorReadSideEffectsTest extends TestCase
{
    public function testMonitorRequiresAdminGetBeforeNetworkOrDatabaseWork(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trellis2_monitor.php');
        self::assertIsString($source);

        $helperLoad = strpos($source, "require_once __DIR__ . '/helpers.php';");
        $methodGuard = strpos($source, "only_method('GET');");
        $adminGuard = strpos($source, 'require_admin();');
        $serviceProbe = strpos($source, '$response = @file_get_contents($trellis2_url');
        $databaseLoad = strpos($source, '$db = get_db();');

        self::assertNotFalse($helperLoad);
        self::assertNotFalse($methodGuard);
        self::assertNotFalse($adminGuard);
        self::assertNotFalse($serviceProbe);
        self::assertNotFalse($databaseLoad);
        self::assertLessThan($methodGuard, $helperLoad);
        self::assertLessThan($adminGuard, $methodGuard);
        self::assertLessThan($serviceProbe, $adminGuard);
        self::assertLessThan($databaseLoad, $adminGuard);
    }

    public function testMonitorReadsQueueAndDoesNotMutatePersistentState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trellis2_monitor.php');
        self::assertIsString($source);

        self::assertStringContainsString('FROM generation_queue', $source);
        self::assertStringContainsString('GROUP BY status', $source);
        self::assertStringContainsString('ORDER BY updated_at DESC', $source);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO|file_put_contents|unlink|rename|mkdir)\\b/i',
            $source
        );
    }
}
