<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class GenerationQueueMonitorMethodContractTest extends TestCase
{
    public function testAdminQueueMonitorRequiresGetBeforeAuthenticationAndDatabaseAccess(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/generation_queue_monitor.php');
        self::assertIsString($source);

        $dispatchStart = strpos($source, "if (basename(__FILE__) === basename");
        $methodOffset = strpos($source, "only_method('GET');", $dispatchStart);
        $authOffset = strpos($source, 'require_admin();', $dispatchStart);
        $databaseOffset = strpos($source, '$db = get_db();', $dispatchStart);

        self::assertNotFalse($dispatchStart);
        self::assertNotFalse($methodOffset);
        self::assertNotFalse($authOffset);
        self::assertNotFalse($databaseOffset);
        self::assertLessThan($authOffset, $methodOffset);
        self::assertLessThan($databaseOffset, $authOffset);
    }
}
