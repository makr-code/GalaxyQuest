<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class SetupWebGuardTest extends TestCase
{
    public function testWebRequestIsRejectedBeforeLoadingDependencies(): void
    {
        $directory = sys_get_temp_dir() . '/gq-setup-guard-' . bin2hex(random_bytes(8));
        self::assertTrue(mkdir($directory, 0700));
        self::assertTrue(copy(dirname(__DIR__, 2) . '/setup.php', $directory . '/setup.php'));
        $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        self::assertIsResource($socket, $error);
        $address = stream_socket_get_name($socket, false);
        self::assertIsString($address);
        fclose($socket);
        $stdout = tmpfile();
        $stderr = tmpfile();
        self::assertIsResource($stdout);
        self::assertIsResource($stderr);
        $process = proc_open([PHP_BINARY, '-S', $address, '-t', $directory], [
            0 => ['pipe', 'r'], 1 => $stdout, 2 => $stderr,
        ], $pipes);
        self::assertIsResource($process);
        fclose($pipes[0]);
        try {
            $connected = false;
            for ($attempt = 0; $attempt < 50; $attempt++) {
                $connection = @stream_socket_client('tcp://' . $address, $errno, $error, 0.1);
                if ($connection !== false) {
                    fclose($connection);
                    $connected = true;
                    break;
                }
                usleep(100000);
            }
            self::assertTrue($connected, 'Isolated PHP server did not start.');
            $context = stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 3]]);
            $response = file_get_contents('http://' . $address . '/setup.php', false, $context);
            self::assertSame('setup.php must be run from CLI.', $response);
            self::assertStringContainsString(' 403 ', $http_response_header[0] ?? '');
        } finally {
            proc_terminate($process);
            proc_close($process);
            fclose($stdout);
            fclose($stderr);
            self::assertTrue(unlink($directory . '/setup.php'));
            self::assertTrue(rmdir($directory));
        }
    }

    public function testCliHelpRemainsAvailable(): void
    {
        $process = proc_open([PHP_BINARY, dirname(__DIR__, 2) . '/setup.php', '--help'], [
            0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w'],
        ], $pipes);
        self::assertIsResource($process);
        fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]);
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        self::assertSame(0, proc_close($process), $errors);
        self::assertStringContainsString('GalaxyQuest setup', $output);
        self::assertStringContainsString('--dry-run', $output);
    }
}
