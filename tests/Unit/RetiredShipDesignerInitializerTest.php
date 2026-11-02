<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class RetiredShipDesignerInitializerTest extends TestCase
{
    public function testLegacyPhpInitializerFailsBeforeLoadingDatabaseHelpers(): void
    {
        $process = proc_open(
            [PHP_BINARY, dirname(__DIR__, 2) . '/api/_init_tables.php'],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );
        self::assertIsResource($process);
        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[2]);
        $exit = proc_close($process);

        self::assertSame('', $stdout);
        self::assertSame(1, $exit);
        self::assertStringContainsString('No database was accessed', $stderr);
        self::assertStringContainsString('reviewed canonical migration', $stderr);
    }

    public function testStandaloneSqlInitializerIsAnExplicitFailClosedSignal(): void
    {
        $sql = file_get_contents(dirname(__DIR__, 2) . '/sql/init_ship_designer.sql');
        self::assertIsString($sql);
        self::assertStringContainsString("SIGNAL SQLSTATE '45000'", $sql);
        self::assertStringNotContainsString('DROP TABLE', strtoupper($sql));
        self::assertStringNotContainsString('CREATE TABLE', strtoupper($sql));
    }
}
