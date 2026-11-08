<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class EspionageRuntimeGateTest extends TestCase
{
    /** @return iterable<string,array{string,string,string,bool,bool,int}> */
    public static function requests(): iterable
    {
        foreach (['hire_agent', 'assign_mission', 'mission_result', 'get_active_missions'] as $action) {
            $method = $action === 'get_active_missions' ? 'GET' : 'POST';
            yield $action => ['espionage', $action, $method, true, true, 503];
            yield $action . ' unauthenticated' => ['espionage', $action, $method, false, true, 401];
            yield $action . ' wrong method' => [
                'espionage', $action, $method === 'GET' ? 'POST' : 'GET', true, true, 405,
            ];
            if ($method === 'POST') {
                yield $action . ' CSRF' => ['espionage', $action, $method, true, false, 403];
            }
        }
        yield 'empire espionage' => ['empire', 'get_espionage_status', 'GET', true, true, 503];
        yield 'empire authentication' => ['empire', 'get_espionage_status', 'GET', false, true, 401];
        yield 'empire method' => ['empire', 'get_espionage_status', 'POST', true, true, 405];
        yield 'unknown action' => ['espionage', 'unknown', 'GET', true, true, 400];
    }

    #[DataProvider('requests')]
    public function testGateRejectsBeforeDatabaseAccess(
        string $endpoint,
        string $action,
        string $method,
        bool $authenticated,
        bool $csrf,
        int $expected
    ): void {
        $root = sys_get_temp_dir() . '/gq-espionage-gate-' . bin2hex(random_bytes(8));
        mkdir($root);
        mkdir($root . '/api');
        mkdir($root . '/scripts');
        mkdir($root . '/lib');
        try {
            foreach (['espionage', 'empire', 'espionage_runtime'] as $file) {
                copy(dirname(__DIR__, 2) . '/api/' . $file . '.php', $root . '/api/' . $file . '.php');
            }
            file_put_contents($root . '/scripts/project_user_overview.php',
                '<?php throw new RuntimeException("Forbidden CLI worker import");');
            copy(dirname(__DIR__, 2) . '/lib/empire_scores.php', $root . '/lib/empire_scores.php');
            file_put_contents($root . '/api/helpers.php', <<<'PHP'
<?php
function json_error(string $message, int $status): never {
    echo json_encode(['success' => false, 'error' => $message, 'status' => $status], JSON_THROW_ON_ERROR);
    exit;
}
function require_auth(): int {
    if (getenv('GQ_TEST_AUTH') !== '1') json_error('Authentication required', 401);
    return 7;
}
function only_method(string $method): void {
    if (getenv('GQ_TEST_METHOD') !== $method) json_error('Method not allowed', 405);
}
function verify_csrf(): void {
    if (getenv('GQ_TEST_CSRF') !== '1') json_error('Invalid CSRF', 403);
}
function get_db(): PDO { throw new RuntimeException('Forbidden database access'); }
PHP);
            file_put_contents($root . '/request.php', '<?php $_GET["action"] = getenv("GQ_TEST_ACTION"); require '
                . var_export($root . '/api/' . $endpoint . '.php', true) . ';');
            $process = proc_open(
                [PHP_BINARY, $root . '/request.php'],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                $root,
                ['GQ_TEST_ACTION' => $action, 'GQ_TEST_METHOD' => $method,
                    'GQ_TEST_AUTH' => $authenticated ? '1' : '0', 'GQ_TEST_CSRF' => $csrf ? '1' : '0']
            );
            if ($process === false) {
                throw new RuntimeException('Cannot start gate fixture.');
            }
            fclose($pipes[0]);
            $output = stream_get_contents($pipes[1]);
            $errors = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $this->assertSame(0, proc_close($process), $errors);
            $result = json_decode($output, true, 512, JSON_THROW_ON_ERROR);
            $this->assertSame($expected, $result['status']);
            $this->assertFalse($result['success']);
            if ($expected === 503) {
                $this->assertStringContainsString('mission lifecycle', $result['error']);
            }
        } finally {
            foreach (['api', 'scripts', 'lib'] as $directory) {
                foreach (glob($root . '/' . $directory . '/*.php') as $file) {
                    unlink($file);
                }
                rmdir($root . '/' . $directory);
            }
            if (is_file($root . '/request.php')) {
                unlink($root . '/request.php');
            }
            rmdir($root);
        }
    }
}
