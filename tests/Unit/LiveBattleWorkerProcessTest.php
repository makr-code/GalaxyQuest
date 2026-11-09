<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;
use RuntimeException;

final class LiveBattleWorkerProcessTest extends TestCase
{
    public function testTerminationWaitsForInFlightBatch(): void
    {
        if (PHP_OS_FAMILY === 'Windows') {
            self::markTestSkipped('Continuous worker requires Bash and POSIX process signals.');
        }
        $directory = sys_get_temp_dir() . '/gq_worker_test_' . bin2hex(random_bytes(8));
        if (!mkdir($directory, 0700)) {
            throw new RuntimeException('Cannot create worker test directory.');
        }
        $binary = $directory . '/php';
        $marker = $directory . '/started';
        $script = "#!/bin/sh\nprintf started > \"\$GQ_TEST_MARKER\"\nsleep 2\nprintf 'batch-completed\\n'\n";
        $process = null;
        $pipes = [];
        try {
            if (file_put_contents($binary, $script) === false || !chmod($binary, 0700)) {
                throw new RuntimeException('Cannot create worker test executable.');
            }
            $env = getenv();
            $env['PATH'] = $directory . PATH_SEPARATOR . ($env['PATH'] ?? '');
            $env['GQ_TEST_MARKER'] = $marker;
            $process = proc_open(
                ['bash', __DIR__ . '/../../scripts/run_live_battle_journal_worker.sh', '--limit=1'],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                null,
                $env
            );
            if (!is_resource($process)) {
                throw new RuntimeException('Cannot start worker test process.');
            }
            fclose($pipes[0]);
            unset($pipes[0]);
            $deadline = microtime(true) + 10;
            while (!is_file($marker) && microtime(true) < $deadline) {
                usleep(50_000);
            }
            self::assertFileExists($marker);
            self::assertTrue(proc_terminate($process, 15));
            do {
                $status = proc_get_status($process);
                if (!$status['running']) {
                    break;
                }
                usleep(50_000);
            } while (microtime(true) < $deadline);
            self::assertFalse($status['running'], 'Worker did not finish its in-flight batch.');
            self::assertSame(0, $status['exitcode']);
            self::assertSame("batch-completed\n", stream_get_contents($pipes[1]));
            self::assertSame('', stream_get_contents($pipes[2]));
        } finally {
            if (is_resource($process)) {
                if (proc_get_status($process)['running']) {
                    proc_terminate($process, 9);
                }
                foreach ($pipes as $pipe) {
                    fclose($pipe);
                }
                proc_close($process);
            }
            if (is_file($marker)) {
                unlink($marker);
            }
            if (is_file($binary)) {
                unlink($binary);
            }
            rmdir($directory);
        }
    }
}
