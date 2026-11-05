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

    public function testAdminQueueMonitorDoesNotExposeInfrastructureErrors(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/generation_queue_monitor.php');
        self::assertIsString($source);

        $dispatchStart = strpos($source, "if (basename(__FILE__) === basename");
        $firstReadHandler = strpos($source, 'function listAllJobs(', $dispatchStart);
        self::assertNotFalse($dispatchStart);
        self::assertNotFalse($firstReadHandler);
        $dispatch = substr($source, $dispatchStart, $firstReadHandler - $dispatchStart);

        self::assertStringContainsString('error_log("Generation Queue Monitor error: " . $e->getMessage());', $dispatch);
        self::assertStringContainsString(
            "json_error('Unable to read generation queue monitor data', 500);",
            $dispatch
        );
        self::assertStringNotContainsString('json_error($e->getMessage(), 500);', $dispatch);
    }
}
