<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\AdminReadHandlers;

use PDO;
use PDOStatement;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class JsonResponse extends RuntimeException
{
    public function __construct(public array $payload)
    {
        parent::__construct('');
    }
}

function json_ok(array $payload): never
{
    throw new JsonResponse($payload);
}

function getDatabase(): PDO
{
    return AdminReadHandlersTest::$db;
}

final class AdminReadHandlersTest extends TestCase
{
    public static PDO $db;
    private array $previousGet;

    public static function setUpBeforeClass(): void
    {
        foreach ([
            'admin_users.php' => ['function admin_users_handle_list(', 'function handle_get('],
            'admin_endpoints.php' => ['function trellis_admin_get_stats(', 'function getQueue('],
        ] as $file => [$begin, $end]) {
            $source = file_get_contents(__DIR__ . '/../../api/' . $file);
            if ($source === false) {
                throw new RuntimeException('Cannot read admin endpoint.');
            }
            $start = strpos($source, $begin);
            $finish = strpos($source, $end);
            if ($start === false || $finish === false) {
                throw new RuntimeException('Cannot locate admin read handlers.');
            }
            eval('namespace ' . __NAMESPACE__ . '; use \PDO; use \Exception; '
                . substr($source, $start, $finish - $start));
        }
    }

    protected function setUp(): void
    {
        $this->previousGet = $_GET;
        $_GET = [];
        self::$db = new PDO('sqlite::memory:', options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::$db->exec(
            "CREATE TABLE users (
                id INTEGER PRIMARY KEY, username TEXT, email TEXT, is_admin INTEGER,
                control_type TEXT, auth_enabled INTEGER, dark_matter INTEGER, rank_points INTEGER,
                created_at TEXT, last_login TEXT, deleted_at TEXT);
             CREATE TABLE colonies (id INTEGER PRIMARY KEY, user_id INTEGER);
             INSERT INTO users VALUES
                (1, 'Alpha', 'alpha@example.test', 1, 'human', 1, 10, 20, '2026-01-01', NULL, NULL),
                (2, 'Beta', 'beta@example.test', 0, 'human', 1, 30, 40, '2026-01-01', NULL, NULL),
                (3, 'Ghost', 'ghost@example.test', 0, 'npc_engine', 0, 0, 0, '2026-01-01', NULL, '2026-02-01');
             INSERT INTO colonies VALUES (1, 1), (2, 1);"
        );
    }

    protected function tearDown(): void
    {
        $_GET = $this->previousGet;
    }

    private function listUsers(): array
    {
        try {
            admin_users_handle_list(self::$db);
        } catch (JsonResponse $response) {
            return $response->payload;
        }
        throw new RuntimeException('User list did not produce a response.');
    }

    public function testUserListExcludesDeletedAndPreservesNumericFields(): void
    {
        $payload = $this->listUsers();
        $this->assertSame([2, 1], array_column($payload['users'], 'id'));
        $this->assertSame(2, $payload['total']);
        $this->assertSame(50, $payload['limit']);
        $this->assertSame(1, $payload['pages']);
        $this->assertSame(2, $payload['users'][1]['colony_count']);
        $this->assertSame(10, $payload['users'][1]['dark_matter']);
    }

    public function testSearchPaginationAndDeletedToggleRemainAvailable(): void
    {
        $_GET = ['q' => 'alpha@'];
        $this->assertSame([1], array_column($this->listUsers()['users'], 'id'));
        $_GET = ['show_deleted' => '1', 'limit' => '1', 'page' => '2'];
        $payload = $this->listUsers();
        $this->assertSame([2], array_column($payload['users'], 'id'));
        $this->assertSame(3, $payload['total']);
        $this->assertSame(3, $payload['pages']);
        $this->assertSame(2, $payload['page']);
    }

    public function testStatsPayloadRetainsCalculations(): void
    {
        $rows = [
            ['count' => 2], ['count' => 3], ['count' => 4],
            ['total' => 2 * 1024 * 1024 * 1024],
            ['hits' => 1, 'total' => 4], ['avg_ms' => 12500],
            ['complete' => 3, 'total' => 4],
        ];
        $statements = [];
        foreach ($rows as $row) {
            $statement = $this->createMock(PDOStatement::class);
            $statement->expects($this->once())->method('fetch')->with(PDO::FETCH_ASSOC)->willReturn($row);
            $statements[] = $statement;
        }
        self::$db = $this->createMock(PDO::class);
        self::$db->expects($this->exactly(7))->method('query')->willReturnOnConsecutiveCalls(...$statements);
        ob_start();
        try {
            trellis_admin_get_stats();
            $output = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        $this->assertSame([
            'active_jobs' => 2, 'queued_jobs' => 3, 'today_completed' => 4,
            'storage_used_gb' => 2, 'cache_hit_ratio' => 25,
            'avg_process_time' => 12.5, 'success_rate' => 75,
        ], json_decode($output, true, flags: JSON_THROW_ON_ERROR));
    }

    public function testRoutesUseUniqueHandlerNames(): void
    {
        $users = file_get_contents(__DIR__ . '/../../api/admin_users.php');
        $stats = file_get_contents(__DIR__ . '/../../api/admin_endpoints.php');
        $this->assertStringContainsString('admin_users_handle_list($db);', $users);
        $this->assertStringNotContainsString('function handle_list(', $users);
        $this->assertStringContainsString('trellis_admin_get_stats();', $stats);
        $this->assertStringNotContainsString('function getStats(', $stats);
    }
}
