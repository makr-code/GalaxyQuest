<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/app_version.php';

final class PrepareReleaseTest extends TestCase
{
    public function testRejectsRequestedVersionThatDoesNotMatchVersionFile(): void
    {
        $root = dirname(__DIR__, 2);
        $requestedVersion = gq_read_app_version($root) . '-unverified';
        $process = proc_open(
            [PHP_BINARY, $root . '/scripts/prepare_release.php', $requestedVersion],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
            $root
        );

        self::assertIsResource($process);
        fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        $errorOutput = stream_get_contents($pipes[2]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);

        self::assertSame('', $output);
        self::assertSame(1, $exitCode);
        self::assertStringContainsString('Requested version must match VERSION.txt.', (string)$errorOutput);
    }
}
