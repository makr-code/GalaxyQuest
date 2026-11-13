<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class UpdateStatusSecurityTest extends TestCase
{
    public static function deniedRequests(): iterable
    {
        yield 'anonymous' => ['GET', 'anonymous', 401, 'Not authenticated'];
        yield 'non-admin' => ['GET', 'user', 403, 'Admin access required'];
        yield 'wrong method' => ['POST', 'admin', 405, 'Method not allowed'];
    }

    #[DataProvider('deniedRequests')]
    public function testDeniedRequestsNeverConstructUpdateManager(
        string $method,
        string $identity,
        int $expectedStatus,
        string $expectedError
    ): void {
        [$status, $payload, $errors] = $this->request($method, $identity);
        self::assertSame($expectedStatus, $status);
        self::assertSame($expectedError, $payload['error']);
        self::assertStringNotContainsString('MANAGER_CONSTRUCTED', $errors);
        if ($identity === 'anonymous' || $method !== 'GET') {
            self::assertStringNotContainsString('DB_ACCESSED', $errors);
        }
    }

    public function testAdminCanReadStatusFromRepositoryRoot(): void
    {
        [$status, $payload, $errors] = $this->request('GET', 'admin');
        self::assertSame(200, $status);
        self::assertTrue($payload['success']);
        self::assertSame('1.2.3', $payload['status']['current_version']);
        self::assertSame([], $payload['history']);
        self::assertStringContainsString('MANAGER_CONSTRUCTED', $errors);
    }

    public function testDatabaseErrorsAreLoggedWithoutExposingDetails(): void
    {
        [$status, $payload, $errors] = $this->request('GET', 'admin', true);
        self::assertSame(500, $status);
        self::assertSame('Unable to read update status', $payload['error']);
        self::assertStringNotContainsString('fixture-sensitive-detail', json_encode($payload));
        self::assertStringContainsString('fixture-sensitive-detail', $errors);
    }

    /** @return array{int, array<string, mixed>, string} */
    private function request(string $method, string $identity, bool $failDatabase = false): array
    {
        $root = sys_get_temp_dir() . '/gq-update-status-' . bin2hex(random_bytes(8));
        foreach (['', '/api', '/api/v1', '/api/v1/admin', '/lib'] as $directory) {
            if (!mkdir($root . $directory)) {
                throw new RuntimeException('Cannot create update status fixture.');
            }
        }
        try {
            $repository = dirname(__DIR__, 2);
            $helpers = file_get_contents($repository . '/api/helpers.php');
            if ($helpers === false) {
                throw new RuntimeException('Cannot read shared API helpers.');
            }
            $guards = $this->between($helpers, 'function require_auth(): int', 'function send_security_headers(): void');
            $methods = $this->between($helpers, 'function only_method(', 'function positive_int(');
            $fixtureHelpers = <<<'PHP'
<?php
function current_user_id(): ?int {
    return match (getenv('TEST_IDENTITY')) { 'admin' => 1, 'user' => 2, default => null };
}
function is_admin_user(PDO $db, int $uid): bool { return $uid === 1; }
function json_error(string $message, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}
function get_db(): PDO {
    error_log('DB_ACCESSED');
    if (getenv('TEST_FAIL_DB') === '1') throw new RuntimeException('fixture-sensitive-detail');
    $db = new PDO('sqlite::memory:');
    $db->exec('CREATE TABLE update_history (operation_type TEXT, from_version TEXT, to_version TEXT,
        status TEXT, started_at TEXT, error_message TEXT)');
    return $db;
}
PHP;
            $fixtureManager = <<<'PHP'
<?php
class UpdateManager {
    public function __construct(PDO $db, string $root, string $version) { error_log('MANAGER_CONSTRUCTED'); }
    public function getStatus(): array { return ['current_version' => '1.2.3']; }
}
PHP;
            if (!copy($repository . '/api/v1/admin/update-status.php', $root . '/api/v1/admin/update-status.php')
                || file_put_contents($root . '/api/helpers.php', $fixtureHelpers . "\n" . $guards . "\n" . $methods) === false
                || file_put_contents($root . '/lib/app_version.php', "<?php function gq_read_app_version(string \$root): string { return '1.2.3'; }") === false
                || file_put_contents($root . '/lib/GithubReleaseChecker.php', '<?php') === false
                || file_put_contents($root . '/lib/UpdateManager.php', $fixtureManager) === false) {
                throw new RuntimeException('Cannot create update status fixture files.');
            }

            $script = '$_SERVER["REQUEST_METHOD"] = ' . var_export($method, true) . '; http_response_code(200); '
                . 'register_shutdown_function(function (): void { fwrite(STDERR, "STATUS:" . http_response_code()); }); '
                . 'require ' . var_export($root . '/api/v1/admin/update-status.php', true) . ';';
            $process = proc_open(
                [PHP_BINARY, '-d', 'display_errors=stderr', '-r', $script],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                $root,
                array_merge(getenv(), [
                    'XDEBUG_MODE' => 'off',
                    'TEST_IDENTITY' => $identity,
                    'TEST_FAIL_DB' => $failDatabase ? '1' : '0',
                ])
            );
            if ($process === false) {
                throw new RuntimeException('Cannot start update status fixture.');
            }
            fclose($pipes[0]);
            $output = stream_get_contents($pipes[1]);
            $errors = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            self::assertSame(0, proc_close($process), (string)$errors);
            self::assertMatchesRegularExpression('/STATUS:(\d{3})$/', (string)$errors);
            preg_match('/STATUS:(\d{3})$/', (string)$errors, $matches);
            return [(int)$matches[1], json_decode((string)$output, true, flags: JSON_THROW_ON_ERROR), (string)$errors];
        } finally {
            foreach ([
                '/api/v1/admin/update-status.php', '/api/helpers.php', '/lib/app_version.php',
                '/lib/GithubReleaseChecker.php', '/lib/UpdateManager.php',
            ] as $file) {
                if (is_file($root . $file)) {
                    unlink($root . $file);
                }
            }
            foreach (['/api/v1/admin', '/api/v1', '/api', '/lib', ''] as $directory) {
                rmdir($root . $directory);
            }
        }
    }

    private function between(string $source, string $startMarker, string $endMarker): string
    {
        $start = strpos($source, $startMarker);
        $end = $start === false ? false : strpos($source, $endMarker, $start);
        if ($start === false || $end === false) {
            throw new RuntimeException('Cannot locate shared API guard.');
        }
        return substr($source, $start, $end - $start);
    }
}
