<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PDO;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class DesignEndpointAccessTest extends TestCase
{
    private string $database;
    private PDO $db;

    protected function setUp(): void
    {
        $database = tempnam(sys_get_temp_dir(), 'gq-design-');
        if ($database === false) {
            throw new RuntimeException('Cannot create isolated design database.');
        }
        $this->database = $database;
        $this->db = new PDO('sqlite:' . $database);
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->db->exec("CREATE TABLE vessel_designs (
            design_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, design_name TEXT,
            description TEXT, geometry_data TEXT, wireframe_source TEXT, customizations TEXT,
            faction_code TEXT, created_at TEXT, updated_at TEXT
        )");
        $this->db->exec("CREATE TABLE generation_queue (
            queue_id TEXT PRIMARY KEY, design_id TEXT, user_id INTEGER, prompt_text TEXT,
            status TEXT, priority INTEGER, generation_id TEXT
        )");
        $this->db->exec("INSERT INTO vessel_designs (design_id, user_id, design_name, customizations)
            VALUES ('abcd1234', 1, 'Owner design', '{}'), ('abcd5678', 2, 'Other design', '{}')");
    }

    protected function tearDown(): void
    {
        unset($this->db);
        if (!unlink($this->database)) {
            throw new RuntimeException('Cannot remove isolated design database.');
        }
    }

    public function testAnonymousAndForgedDemoIdentityCannotReachEitherEndpoint(): void
    {
        foreach ([
            ['wireframe_designs.php', 'GET', '/api/wireframe_designs/abcd1234', []],
            ['wireframe_designs.php', 'POST', '/api/wireframe_designs', []],
            ['vessel_designs.php', 'POST', '/api/vessel_designs', []],
            ['vessel_designs.php', 'POST', '/api/vessel_designs.php?wireframe=1', ['wireframe' => '1']],
            ['vessel_designs.php', 'GET', '/api/vessel_designs/abcd1234', []],
            ['vessel_designs.php', 'POST', '/api/vessel_designs/abcd1234/generate', []],
        ] as [$file, $method, $uri, $query]) {
            [$status, $payload] = $this->request($file, $method, $uri, null, false, $query);
            self::assertSame(401, $status, $uri);
            self::assertSame('Not authenticated', $payload['error']);
        }
        self::assertSame(2, (int)$this->db->query('SELECT COUNT(*) FROM vessel_designs')->fetchColumn());
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM generation_queue')->fetchColumn());
    }

    public function testWritesRequireCsrfAndEnforceDesignOwnership(): void
    {
        $body = ['name' => 'Updated', 'design_id' => 'abcd5678'];
        foreach ([
            ['wireframe_designs.php', 'POST', '/api/wireframe_designs'],
            ['wireframe_designs.php', 'DELETE', '/api/wireframe_designs/abcd1234'],
            ['vessel_designs.php', 'POST', '/api/vessel_designs'],
            ['vessel_designs.php', 'POST', '/api/vessel_designs.php?wireframe=1'],
            ['vessel_designs.php', 'POST', '/api/vessel_designs/abcd1234/generate'],
        ] as [$file, $method, $uri]) {
            $query = str_contains($uri, 'wireframe=1') ? ['wireframe' => '1'] : [];
            [$status] = $this->request($file, $method, $uri, 1, false, $query, $body);
            self::assertSame(403, $status, $uri);
        }
        [$status] = $this->request('wireframe_designs.php', 'POST', '/api/wireframe_designs', 1, true, [], $body);
        self::assertSame(404, $status);
        [$status] = $this->request('wireframe_designs.php', 'DELETE', '/api/wireframe_designs/abcd5678', 1, true);
        self::assertSame(404, $status);
        [$status] = $this->request('vessel_designs.php', 'POST', '/api/vessel_designs/abcd5678/generate', 1, true);
        self::assertSame(404, $status);
        self::assertSame('Other design', $this->db->query(
            "SELECT design_name FROM vessel_designs WHERE design_id = 'abcd5678'"
        )->fetchColumn());
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM generation_queue')->fetchColumn());

        [$status] = $this->request('wireframe_designs.php', 'POST', '/api/wireframe_designs', 1, true, [], [
            'name' => 'Updated', 'design_id' => 'abcd1234',
        ]);
        self::assertSame(201, $status);
        self::assertSame('Updated', $this->db->query(
            "SELECT design_name FROM vessel_designs WHERE design_id = 'abcd1234'"
        )->fetchColumn());
        [$status] = $this->request('vessel_designs.php', 'POST', '/api/vessel_designs/abcd1234/generate', 1, true);
        self::assertSame(200, $status);
        self::assertSame(1, (int)$this->db->query(
            "SELECT COUNT(*) FROM generation_queue WHERE design_id = 'abcd1234' AND user_id = 1"
        )->fetchColumn());
        [$status] = $this->request('wireframe_designs.php', 'GET', '/api/wireframe_designs/abcd1234', 1, false);
        self::assertSame(200, $status);
        [$status] = $this->request('wireframe_designs.php', 'GET', '/api/wireframe_designs/abcd5678', 1, false);
        self::assertSame(404, $status);
        [$status, $created] = $this->request('wireframe_designs.php', 'POST', '/api/wireframe_designs', 1, true, [], [
            'name' => 'New design',
        ]);
        self::assertSame(201, $status);
        self::assertMatchesRegularExpression('/^wd_[a-f0-9]{12}$/', $created['id']);
        [$status] = $this->request('wireframe_designs.php', 'DELETE', '/api/wireframe_designs/' . $created['id'], 1, true);
        self::assertSame(200, $status);
        [$status, $vessel] = $this->request('vessel_designs.php', 'POST', '/api/vessel_designs', 1, true, [], [
            'design_name' => 'Vessel', 'species_code' => 'test',
        ]);
        self::assertSame(200, $status);
        [$status, $read] = $this->request(
            'vessel_designs.php', 'GET', '/api/vessel_designs/' . $vessel['id'], 1, false
        );
        self::assertSame(200, $status);
        self::assertSame('Vessel', $read['design_name']);
        [$status] = $this->request(
            'vessel_designs.php', 'GET', '/api/vessel_designs/' . $vessel['id'], 2, false
        );
        self::assertSame(404, $status);
        [$status, $wireframe] = $this->request(
            'vessel_designs.php', 'POST', '/api/vessel_designs.php?wireframe=1', 1, true,
            ['wireframe' => '1'], ['name' => 'Wireframe']
        );
        self::assertSame(200, $status);
        self::assertMatchesRegularExpression('/^wd_[a-f0-9]{12}$/', $wireframe['id']);
    }

    /** @param array<string, string> $query
     *  @param array<string, mixed> $body
     *  @return array{int, array<string, mixed>}
     */
    private function request(
        string $file,
        string $method,
        string $uri,
        ?int $user,
        bool $csrf,
        array $query = [],
        array $body = []
    ): array {
        $source = file_get_contents(dirname(__DIR__, 2) . '/api/' . $file);
        $helpers = file_get_contents(dirname(__DIR__, 2) . '/api/helpers.php');
        if ($source === false || $helpers === false) {
            throw new RuntimeException('Cannot read design endpoint.');
        }
        $guards = $this->between($helpers, 'function require_auth(', 'function require_admin(');
        $csrfGuard = $this->between($helpers, 'function verify_csrf(', 'function get_json_body(');
        $source = str_replace("require_once __DIR__ . '/helpers.php';", '', $source);
        $source = str_replace("require_once \$root_dir . '/api/helpers.php';", '', $source);
        $source = str_replace(
            "if (basename(__FILE__) === basename(\$_SERVER['SCRIPT_FILENAME'] ?? '')) {",
            'if (true) {',
            $source
        );
        $source = str_replace("file_get_contents('php://input')", 'request_body()', $source);
        $source = preg_replace('/^<\?php\s*/', '', $source);
        $source = str_replace('declare(strict_types=1);', '', $source);
        $source = preg_replace('/\?>\s*$/', '', $source);
        $script = 'namespace DesignEndpointTest; use PDO; '
            . '$_SERVER = ' . var_export([
                'REQUEST_METHOD' => $method, 'REQUEST_URI' => $uri, 'HTTP_X_DEMO_USER' => '2',
                'HTTP_X_CSRF_TOKEN' => $csrf ? 'valid' : 'invalid',
            ], true) . '; $_GET = ' . var_export($query, true) . '; $_POST = []; '
            . '$user = ' . var_export($user, true) . '; $database = ' . var_export($this->database, true) . '; '
            . '$body = ' . var_export(json_encode($body, JSON_THROW_ON_ERROR), true) . '; '
            . 'http_response_code(200); register_shutdown_function(function () { fwrite(STDERR, "STATUS:" . http_response_code()); }); '
            . $guards . $csrfGuard . <<<'PHP'
function json_error(string $message, int $code = 400): never {
    http_response_code($code); echo json_encode(['success' => false, 'error' => $message]); exit;
}
function json_ok(array $payload = []): never { echo json_encode(['success' => true] + $payload); exit; }
function current_user_id(): ?int { return $GLOBALS['user']; }
function csrf_token(): string { return 'valid'; }
function only_method(string ...$methods): void {}
function request_body(): string { return $GLOBALS['body']; }
function get_db(): PDO {
    $db = new PDO('sqlite:' . $GLOBALS['database']);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->sqliteCreateFunction('NOW', static fn () => '2026-01-01');
    return $db;
}
PHP
            . 'eval(' . var_export('namespace DesignEndpointTest; use PDO; ' . $source, true) . ');';
        $process = proc_open([PHP_BINARY, '-d', 'display_errors=stderr', '-r', $script], [
            0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w'],
        ], $pipes);
        if ($process === false) {
            throw new RuntimeException('Cannot start design endpoint process.');
        }
        fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]);
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        self::assertSame(0, proc_close($process), $errors);
        self::assertMatchesRegularExpression('/STATUS:\d{3}$/', $errors);
        preg_match('/STATUS:(\d{3})$/', $errors, $matches);
        return [(int)$matches[1], json_decode($output, true, flags: JSON_THROW_ON_ERROR)];
    }

    private function between(string $source, string $startMarker, string $endMarker): string
    {
        $start = strpos($source, $startMarker);
        $end = $start === false ? false : strpos($source, $endMarker, $start);
        if ($start === false || $end === false) {
            throw new RuntimeException('Cannot locate design endpoint test helpers.');
        }
        return substr($source, $start, $end - $start);
    }
}
