<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\AllianceWriteActions;

use PDO;
use PDOStatement;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class JsonResponse extends RuntimeException
{
    public function __construct(public array $payload, int $status)
    {
        parent::__construct((string)($payload['error'] ?? ''), $status);
    }
}

function get_json_body(): array
{
    return AllianceWriteActionsTest::$body;
}

function json_ok(array $payload): never
{
    throw new JsonResponse($payload, 200);
}

function json_error(string $message, int $code = 400): never
{
    throw new JsonResponse(['error' => $message], $code);
}

final class AllianceWriteActionsTest extends TestCase
{
    public static array $body = [];
    private PDO $db;

    public static function setUpBeforeClass(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/alliances.php');
        if ($source === false) {
            throw new RuntimeException('Cannot read alliance handlers.');
        }
        $offset = strpos($source, 'function ensure_alliance_schema(');
        if ($offset === false) {
            throw new RuntimeException('Cannot locate alliance handlers.');
        }
        // Load the actual handlers in isolation, without HTTP auth/dispatch or schema DDL.
        eval('namespace ' . __NAMESPACE__ . '; use \PDO; ' . substr($source, $offset));
    }

    protected function setUp(): void
    {
        self::$body = [];
        $this->db = new PDO('sqlite::memory:', options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec(
            'CREATE TABLE alliances (id INTEGER PRIMARY KEY, name TEXT, tag TEXT, leader_user_id INTEGER, description TEXT);
             CREATE TABLE alliance_members (id INTEGER PRIMARY KEY, alliance_id INTEGER, user_id INTEGER, role TEXT);
             CREATE TABLE alliance_messages (id INTEGER PRIMARY KEY, alliance_id INTEGER, author_id INTEGER, message_text TEXT);'
        );
    }

    protected function tearDown(): void
    {
        self::$body = [];
    }

    private function dispatch(string $action, ?PDO $db = null): JsonResponse
    {
        $handler = __NAMESPACE__ . '\\' . $action;
        try {
            $handler($db ?? $this->db, 42);
        } catch (JsonResponse $response) {
            return $response;
        }
        throw new RuntimeException('Handler did not produce a response.');
    }

    public function testCreateTrimsInputAndAddsLeaderMembership(): void
    {
        self::$body = ['name' => '  Star Fleet  ', 'tag' => ' SF ', 'description' => '  Allies  '];
        $response = $this->dispatch('action_create');
        $this->assertSame(200, $response->getCode());
        $this->assertSame(['alliance_id' => 1, 'name' => 'Star Fleet', 'tag' => 'SF'], $response->payload);
        $this->assertSame('Allies', $this->db->query('SELECT description FROM alliances')->fetchColumn());
        $this->assertSame('leader', $this->db->query('SELECT role FROM alliance_members WHERE user_id = 42')->fetchColumn());
    }

    public function testSetRoleNormalizesCaseAndUpdatesMember(): void
    {
        $this->db->exec("INSERT INTO alliance_members VALUES (1, 1, 42, 'leader'), (2, 1, 43, 'member')");
        self::$body = ['alliance_id' => 1, 'user_id' => 43, 'role' => 'DIPLOMAT'];
        $this->assertSame(200, $this->dispatch('action_set_role')->getCode());
        $this->assertSame('diplomat', $this->db->query('SELECT role FROM alliance_members WHERE user_id = 43')->fetchColumn());
    }

    public function testSendMessageTrimsAndPersistsText(): void
    {
        $this->db->exec("INSERT INTO alliance_members VALUES (1, 1, 42, 'member')");
        self::$body = ['alliance_id' => 1, 'message' => '  Hello fleet  '];
        $this->assertSame(200, $this->dispatch('action_send_message')->getCode());
        $this->assertSame('Hello fleet', $this->db->query('SELECT message_text FROM alliance_messages')->fetchColumn());
    }

    public function testSetRelationPassesValidatedTypeToDatabase(): void
    {
        $lookup = $this->createMock(PDOStatement::class);
        $lookup->expects($this->once())->method('execute')->with([1, 42])->willReturn(true);
        $lookup->method('fetchColumn')->willReturn(1);
        $write = $this->createMock(PDOStatement::class);
        $write->expects($this->once())->method('execute')->with([1, 2, 'nap', 42])->willReturn(true);
        $db = $this->createMock(PDO::class);
        $db->expects($this->exactly(2))->method('prepare')->willReturnOnConsecutiveCalls($lookup, $write);
        self::$body = ['alliance_id' => 1, 'other_alliance_id' => 2, 'relation_type' => 'nap'];
        $response = $this->dispatch('action_set_relation', $db);
        $this->assertSame(200, $response->getCode());
        $this->assertSame(['relation_set' => true, 'relation_type' => 'nap'], $response->payload);
    }

    /** @return iterable<string, array{string, string, string|null}> */
    public static function invalidTextValues(): iterable
    {
        yield 'short-name' => ['action_create', 'name', 'ab'];
        yield 'long-name' => ['action_create', 'name', str_repeat('a', 65)];
        yield 'short-tag' => ['action_create', 'tag', 'a'];
        yield 'long-tag' => ['action_create', 'tag', 'abcde'];
        yield 'empty-message' => ['action_send_message', 'message', '  '];
        yield 'long-message' => ['action_send_message', 'message', str_repeat('a', 1001)];
        yield 'unknown-role' => ['action_set_role', 'role', 'admin'];
        yield 'case-sensitive-relation' => ['action_set_relation', 'relation_type', 'NAP'];
        foreach ([
            'name' => 'action_create', 'tag' => 'action_create', 'role' => 'action_set_role',
            'relation_type' => 'action_set_relation', 'message' => 'action_send_message',
        ] as $field => $action) {
            yield 'null-' . $field => [$action, $field, null];
        }
    }

    #[DataProvider('invalidTextValues')]
    public function testExistingLengthAndEnumRulesArePreserved(string $action, string $field, ?string $value): void
    {
        self::$body = ['name' => 'Fleet', 'tag' => 'SF', 'alliance_id' => 1, 'user_id' => 43, $field => $value];
        $db = $this->createMock(PDO::class);
        $db->expects($this->never())->method('prepare');
        $this->assertSame(400, $this->dispatch($action, $db)->getCode());
    }

    public function testOmittedOptionalDescriptionRemainsEmpty(): void
    {
        self::$body = ['name' => 'Fleet', 'tag' => 'SF'];
        $this->assertSame(200, $this->dispatch('action_create')->getCode());
        $this->assertSame('', $this->db->query('SELECT description FROM alliances')->fetchColumn());
    }

    public function testNonLeaderCannotSetRole(): void
    {
        $this->db->exec("INSERT INTO alliance_members VALUES (1, 1, 42, 'member'), (2, 1, 43, 'member')");
        self::$body = ['alliance_id' => 1, 'user_id' => 43, 'role' => 'officer'];
        $this->assertSame(403, $this->dispatch('action_set_role')->getCode());
        $this->assertSame('member', $this->db->query('SELECT role FROM alliance_members WHERE user_id = 43')->fetchColumn());
    }

    public function testNonMemberCannotSendMessage(): void
    {
        self::$body = ['alliance_id' => 1, 'message' => 'Hello'];
        $this->assertSame(403, $this->dispatch('action_send_message')->getCode());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM alliance_messages')->fetchColumn());
    }

    /** @return iterable<string, array{string, string, mixed}> */
    public static function invalidTextInputs(): iterable
    {
        foreach ([
            'name' => 'action_create', 'tag' => 'action_create', 'description' => 'action_create',
            'role' => 'action_set_role', 'relation_type' => 'action_set_relation', 'message' => 'action_send_message',
        ] as $field => $action) {
            foreach ([123, 1.5, true, [], ['nested' => 'text']] as $index => $value) {
                yield $field . '-' . $index => [$action, $field, $value];
            }
        }
    }

    #[DataProvider('invalidTextInputs')]
    public function testNonStringTextIsRejectedBeforeDatabaseAccess(string $action, string $field, mixed $value): void
    {
        self::$body = ['name' => 'Fleet', 'tag' => 'SF', 'alliance_id' => 1, 'user_id' => 43, $field => $value];
        $db = $this->createMock(PDO::class);
        $db->expects($this->never())->method('prepare');
        $response = $this->dispatch($action, $db);
        $this->assertSame(400, $response->getCode());
        $this->assertStringContainsString('must be a string', $response->getMessage());
    }
}
