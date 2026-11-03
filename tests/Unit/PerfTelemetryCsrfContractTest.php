<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class PerfTelemetryCsrfContractTest extends TestCase
{
    public function testIngestRequiresCsrfBeforeReadingOrPersistingTelemetry(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/perf_telemetry.php');
        self::assertIsString($source);

        $ingestStart = strpos($source, "if (\$action === 'ingest')");
        $ingestEnd = strpos($source, "json_error('Unknown action'", $ingestStart);
        self::assertNotFalse($ingestStart);
        self::assertNotFalse($ingestEnd);
        $handler = substr($source, $ingestStart, $ingestEnd - $ingestStart);

        $postGuardOffset = strpos($handler, "only_method('POST');");
        $csrfGuardOffset = strpos($handler, 'verify_csrf();');
        $bodyReadOffset = strpos($handler, 'get_json_body()');
        $persistOffset = strpos($handler, 'file_put_contents(');
        self::assertNotFalse($postGuardOffset);
        self::assertNotFalse($csrfGuardOffset);
        self::assertNotFalse($bodyReadOffset);
        self::assertNotFalse($persistOffset);
        self::assertLessThan($csrfGuardOffset, $postGuardOffset);
        self::assertLessThan($bodyReadOffset, $csrfGuardOffset);
        self::assertLessThan($persistOffset, $csrfGuardOffset);
    }
}
