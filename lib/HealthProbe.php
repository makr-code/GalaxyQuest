<?php

declare(strict_types=1);

namespace GalaxyQuest\Health;

use InvalidArgumentException;
use MigrationRunner;
use PDO;
use PDOException;
use RuntimeException;

final class HealthProbe
{
    public static function assertReadyWithinDeadline(string $root, float $seconds = 3.0): void
    {
        if (!is_finite($seconds) || $seconds <= 0) {
            throw new InvalidArgumentException('Readiness deadline must be positive and finite.');
        }
        $process = proc_open(
            [PHP_BINDIR . '/php' . (PHP_OS_FAMILY === 'Windows' ? '.exe' : ''), $root . '/scripts/check_health.php'],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
            $root
        );
        if ($process === false) {
            throw new RuntimeException('Cannot start readiness check.');
        }
        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        $deadline = hrtime(true) + (int) ($seconds * 1_000_000_000);
        $exitCode = -1;
        $timedOut = false;
        try {
            do {
                // Drain both pipes so subprocess diagnostics cannot stall the deadline.
                stream_get_contents($pipes[1], 8192);
                stream_get_contents($pipes[2], 8192);
                $state = proc_get_status($process);
                if (!$state['running']) {
                    $exitCode = $state['exitcode'];
                    break;
                }
                if (hrtime(true) >= $deadline) {
                    $timedOut = true;
                    proc_terminate($process, 9);
                    break;
                }
                usleep(10_000);
            } while (true);
        } finally {
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($process);
        }
        if ($timedOut) {
            error_log('{"event":"health_readiness_deadline_exceeded"}');
            throw new RuntimeException('Readiness deadline exceeded.');
        }
        if ($exitCode !== 0) {
            error_log(json_encode([
                'event' => 'health_readiness_process_failed',
                'exit_code' => $exitCode,
            ], JSON_THROW_ON_ERROR));
            throw new RuntimeException('Readiness check failed.');
        }
    }

    public static function connect(): PDO
    {
        // A separate short-lived connection keeps probe deadlines out of gameplay connections.
        ini_set('mysqlnd.net_read_timeout', '2');
        return new PDO(
            'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET,
            DB_USER,
            DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_TIMEOUT => 2,
            ]
        );
    }

    public static function assertReady(PDO $db, string $sqlDir, string $manifestFile = ''): void
    {
        $statement = $db->query('SELECT 1');
        if ($statement === false) {
            throw new RuntimeException('Database probe failed.');
        }
        try {
            if ((int) $statement->fetchColumn() !== 1) {
                throw new RuntimeException('Database probe returned an invalid result.');
            }
        } finally {
            $statement->closeCursor();
        }
        $runner = new MigrationRunner($db, $sqlDir, 'HEALTH', $manifestFile);
        foreach ($runner->getStatus() as $migration) {
            if ($migration['status'] !== 'applied') {
                throw new RuntimeException('Pending migrations.');
            }
        }
    }

    /**
     * @param callable(): void $readiness
     * @return array{code: int, status: string}
     */
    public static function response(string $path, string $method, callable $readiness): array
    {
        if (!in_array($path, ['/health/live', '/health/ready'], true)) {
            return ['code' => 404, 'status' => 'not_found'];
        }
        if (!in_array($method, ['GET', 'HEAD'], true)) {
            return ['code' => 405, 'status' => 'method_not_allowed'];
        }
        if ($path === '/health/live') {
            return ['code' => 200, 'status' => 'alive'];
        }
        try {
            $readiness();
            return ['code' => 200, 'status' => 'ready'];
        } catch (PDOException $error) {
            error_log(json_encode([
                'event' => 'health_readiness_failed',
                'category' => 'database',
                'sqlstate' => (string) $error->getCode(),
            ], JSON_THROW_ON_ERROR));
        } catch (RuntimeException | InvalidArgumentException $error) {
            error_log(json_encode([
                'event' => 'health_readiness_failed',
                'category' => 'readiness',
            ], JSON_THROW_ON_ERROR));
        }
        return ['code' => 503, 'status' => 'unavailable'];
    }
}
