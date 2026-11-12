<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;
use RuntimeException;

final class FactionValidationReadSideEffectsTest extends TestCase
{
    public function testDebugReportsRequireGetAndOnlyReadTheYamlFile(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/faction_validation.php');
        self::assertIsString($source);

        $entrypoint = strpos($source, "if (basename(__FILE__) === basename(\$_SERVER['SCRIPT_FILENAME'] ?? '')) {");
        $getGuard = strpos($source, "only_method('GET');", $entrypoint);
        $adminGuard = strpos($source, 'require_admin();', $entrypoint);
        $actionRead = strpos($source, "\$action = strtolower", $entrypoint);
        self::assertNotFalse($entrypoint);
        self::assertNotFalse($getGuard);
        self::assertNotFalse($adminGuard);
        self::assertNotFalse($actionRead);
        self::assertLessThan($adminGuard, $getGuard);
        self::assertLessThan($actionRead, $adminGuard);
        self::assertStringContainsString("case 'verify':", $source);
        self::assertStringContainsString("case 'standing_matrix':", $source);
        self::assertStringContainsString("case 'endgame_check':", $source);
        self::assertStringContainsString("file_get_contents(\$yaml_path)", $source);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:file_put_contents|fwrite|unlink|rename|copy)\\s*\\(/i',
            $source
        );
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+)\\b/i',
            $source
        );
    }

    public function testDiagnosticActionsEnforceAdminBeforeReading(): void
    {
        foreach (['verify', 'standing_matrix', 'endgame_check'] as $action) {
            foreach (['anonymous' => 401, 'user' => 403, 'admin' => 200] as $role => $expected) {
                [$status, $payload] = $this->request($action, $role);
                self::assertSame($expected, $status, "$role: $action");
                if ($role !== 'admin') {
                    self::assertSame(
                        ['success' => false, 'error' => $role === 'anonymous' ? 'Not authenticated' : 'Admin access required'],
                        $payload
                    );
                } else {
                    self::assertArrayNotHasKey('success', $payload);
                    if ($action === 'verify' && ($payload['standing_range'] ?? null) === [null, null]) {
                        self::assertSame('warning', $payload['status']);
                        self::assertContains('No standing values found', $payload['issues']);
                    }
                }
            }
        }
    }

    public function testMissingYamlIsReportedWithoutCrashing(): void
    {
        [$status, $verify] = $this->request('verify', 'admin', true);
        self::assertSame(200, $status);
        self::assertSame('error', $verify['status']);
        self::assertSame('FACTION_RELATIONS.yaml not found', $verify['message']);
        [$status, $endgame] = $this->request('endgame_check', 'admin', true);
        self::assertSame(200, $status);
        self::assertSame(0, $endgame['endgame_scenarios_found']);
        self::assertSame('', $endgame['preview']);
    }

    /** @return array{int, array<string, mixed>} */
    private function request(string $action, string $role, bool $missingFile = false): array
    {
        $apiDir = dirname(__DIR__, 2) . '/api';
        $source = file_get_contents($apiDir . '/faction_validation.php');
        $helpers = file_get_contents($apiDir . '/helpers.php');
        if ($source === false || $helpers === false) {
            throw new RuntimeException('Cannot load faction validation endpoint.');
        }
        $adminCheck = $this->between($helpers, 'function is_admin_user(', 'function is_https_request(');
        $authGuards = $this->between($helpers, 'function require_auth(', 'function send_security_headers(');
        $responses = $this->between($helpers, 'function json_response(', 'function csrf_token(');
        $source = str_replace("require_once __DIR__ . '/helpers.php';", '', $source);
        $source = str_replace('__DIR__', var_export($apiDir, true), $source);
        $source = str_replace(
            "if (basename(__FILE__) === basename(\$_SERVER['SCRIPT_FILENAME'] ?? '')) {",
            'if (true) {',
            $source
        );
        $script = 'namespace FactionValidationRequest; use PDO; '
            . '$role = ' . var_export($role, true) . '; '
            . '$missingFile = ' . var_export($missingFile, true) . '; '
            . '$_GET = ["action" => ' . var_export($action, true) . ']; '
            . 'http_response_code(200); '
            . 'register_shutdown_function(function () { fwrite(STDERR, "STATUS:" . http_response_code()); }); '
            . $adminCheck . $authGuards . $responses . <<<'PHP'
function only_method(string ...$methods): void {}
function send_security_headers(): void {}
function file_exists(string $path): bool {
    return !$GLOBALS['missingFile'] && \file_exists($path);
}
function current_user_id(): ?int {
    return $GLOBALS['role'] === 'anonymous' ? null : 42;
}
function get_db(): PDO {
    $db = new PDO('sqlite::memory:');
    $db->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, is_admin INTEGER NOT NULL)');
    $db->exec('INSERT INTO users VALUES (42, ' . ($GLOBALS['role'] === 'admin' ? '1' : '0') . ')');
    return $db;
}
PHP
            . 'eval(' . var_export('namespace FactionValidationRequest; ' . substr($source, 5), true) . ');';
        $process = proc_open(
            [PHP_BINARY, '-d', 'display_errors=stderr', '-r', $script],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes
        );
        if ($process === false) {
            throw new RuntimeException('Cannot start faction validation test process.');
        }
        fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]);
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        self::assertSame(0, proc_close($process), $errors);
        self::assertMatchesRegularExpression('/STATUS:\d{3}$/', $errors);
        preg_match('/STATUS:(\d{3})$/', $errors, $match);
        return [(int)$match[1], json_decode($output, true, flags: JSON_THROW_ON_ERROR)];
    }

    private function between(string $source, string $startMarker, string $endMarker): string
    {
        $start = strpos($source, $startMarker);
        $end = $start === false ? false : strpos($source, $endMarker, $start);
        if ($start === false || $end === false) {
            throw new RuntimeException('Cannot locate faction validation test helpers.');
        }
        return substr($source, $start, $end - $start);
    }
}
