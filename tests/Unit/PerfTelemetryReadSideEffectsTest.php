<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class PerfTelemetryReadSideEffectsTest extends TestCase
{
    public function testTelemetryReadsDoNotPruneFiles(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/perf_telemetry.php');
        self::assertIsString($source);

        self::assertSame(1, substr_count($source, 'telemetry_prune_old_files($retentionDays)'));
        self::assertLessThan(
            strpos($source, 'telemetry_prune_old_files($retentionDays)'),
            strpos($source, 'file_put_contents($file, $line . PHP_EOL, FILE_APPEND | LOCK_EX)')
        );
    }

    public function testTelemetryPruningRemainsOnTheIngestionWritePath(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/perf_telemetry.php');
        self::assertIsString($source);

        $ingestStart = strpos($source, "if (\$action === 'ingest')");
        $pruneCall = strpos($source, 'telemetry_prune_old_files($retentionDays)', $ingestStart);
        $response = strpos($source, "'action' => 'ingest'", $ingestStart);
        self::assertNotFalse($ingestStart);
        self::assertNotFalse($pruneCall);
        self::assertNotFalse($response);
        self::assertLessThan($response, $pruneCall);
    }
}
