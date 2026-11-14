<?php

declare(strict_types=1);

use GalaxyQuest\Economy\WorldEvents;
use GalaxyQuest\Simulation\HourlyWindow;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/world_tick.php';

final class WorldEventsTickTest extends TestCase
{
    private PDO $db;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->db->exec(<<<'SQL'
            CREATE TABLE users (
                id INTEGER PRIMARY KEY, email TEXT, control_type TEXT, auth_enabled INTEGER DEFAULT 1,
                deleted_at TEXT, email_notifications INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE celestial_bodies (id INTEGER PRIMARY KEY, galaxy_index INTEGER, system_index INTEGER);
            CREATE TABLE colonies (id INTEGER PRIMARY KEY, user_id INTEGER, body_id INTEGER);
            CREATE TABLE economy_colony_market (
                colony_id INTEGER, good_type TEXT, galaxy_index INTEGER, system_index INTEGER,
                PRIMARY KEY(colony_id, good_type)
            );
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER,
                subject TEXT, body TEXT, is_read INTEGER DEFAULT 0, sent_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE world_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, window_id INTEGER, event_type TEXT, scope_type TEXT,
                scope_id INTEGER, galaxy_index INTEGER, system_index INTEGER DEFAULT 0,
                good_key TEXT NOT NULL DEFAULT '', modifier_json TEXT, starts_at INTEGER, ends_at INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(window_id, event_type, scope_type, scope_id, good_key)
            );
            CREATE TABLE mail_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL,
                dedupe_key TEXT NOT NULL UNIQUE, subject TEXT NOT NULL, body_text TEXT NOT NULL, body_html TEXT,
                status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at INTEGER NOT NULL, last_error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                sent_at TEXT
            );
            INSERT INTO users (id, email, control_type, email_notifications) VALUES
                (1, 'pilot@example.org', 'human', 1), (2, 'quiet@example.org', 'human', 0),
                (3, 'npc@example.org', 'npc_engine', 1);
            INSERT INTO celestial_bodies VALUES (1, 1, 1), (2, 1, 1), (3, 1, 1), (4, 2, 5);
            INSERT INTO colonies VALUES (1, 1, 1), (2, 2, 2), (3, 3, 3), (4, 1, 4);
            INSERT INTO economy_colony_market VALUES
                (1, 'metal', 1, 1), (2, 'metal', 1, 1), (3, 'metal', 1, 1), (4, 'metal', 2, 5);
            SQL);
    }

    public function testGenerationIsDeterministicPerWindowAndNeverDuplicates(): void
    {
        $now = $this->firstWindowWithEvents();
        $first = (new WorldEvents($this->db))->generate($now, 6);
        $count = $this->rows('world_events');
        self::assertGreaterThan(0, $count);

        $later = (new WorldEvents($this->db))->generate($now + 1200, 6);
        self::assertSame($first, $later);
        self::assertSame($count, $this->rows('world_events'));
        foreach ($first as $event) {
            self::assertSame(HourlyWindow::id($now), (int)$event['window_id']);
            self::assertSame($now + 300, (int)$event['starts_at']);
            self::assertGreaterThanOrEqual(6 * 3600, (int)$event['ends_at'] - (int)$event['starts_at']);
            self::assertArrayHasKey($event['event_type'], WorldEvents::CATALOG);
        }

        $this->db->exec('DELETE FROM world_events');
        self::assertSame(
            array_map(static fn (array $e): array => [$e['event_type'], $e['scope_id'], $e['good_key'], $e['modifiers']], $first),
            array_map(
                static fn (array $e): array => [$e['event_type'], $e['scope_id'], $e['good_key'], $e['modifiers']],
                (new WorldEvents($this->db))->generate($now, 6)
            )
        );
    }

    public function testActiveEventCapLimitsNewEvents(): void
    {
        $now = $this->firstWindowWithEvents();
        self::assertSame([], (new WorldEvents($this->db))->generate($now, 0));
        $this->db->prepare(
            "INSERT INTO world_events (window_id, event_type, scope_type, scope_id, galaxy_index, modifier_json, "
                . "starts_at, ends_at) VALUES (?, 'trade_disruption', 'system', 1, 1, '{}', ?, ?)"
        )->execute([HourlyWindow::id($now) - 1, $now - 3600, $now + 3600]);
        self::assertSame([], (new WorldEvents($this->db))->generate($now, 1));
    }

    public function testDigestIsQueuedOncePerUserAndWindowAndNeverForNpcs(): void
    {
        $events = [$this->event('system', 1, 1, 'metal'), $this->event('galaxy', 2, 0, '')];
        self::assertSame(2, world_events_enqueue_digests($this->db, 400, $events, 1440000));
        self::assertSame(0, world_events_enqueue_digests($this->db, 400, $events, 1440100));

        $outbox = $this->db->query('SELECT user_id, status, dedupe_key, body_text FROM mail_outbox ORDER BY user_id')->fetchAll();
        self::assertSame([1, 2], array_map('intval', array_column($outbox, 'user_id')));
        self::assertSame(['pending', 'skipped'], array_column($outbox, 'status'));
        self::assertSame('digest:400:1', $outbox[0]['dedupe_key']);
        self::assertStringContainsString('System 1:1', $outbox[0]['body_text']);
        self::assertStringContainsString('Galaxie 2', $outbox[0]['body_text']);
        self::assertStringContainsString('E-Mail-Benachrichtigungen umschalten', $outbox[0]['body_text']);
        self::assertSame([1, 2], array_map('intval', $this->db->query(
            'SELECT receiver_id FROM messages ORDER BY receiver_id'
        )->fetchAll(PDO::FETCH_COLUMN)));
        self::assertSame(2, world_events_enqueue_digests($this->db, 401, $events, 1443600));
    }

    public function testFlushSkipsWithoutTransportAndBacksOffUntilFailure(): void
    {
        mail_outbox_enqueue($this->db, 1, 'test', 'a', 'Betreff', 'Text', 1000);
        $stats = mail_outbox_flush($this->db, 1000, 10, 3, null);
        self::assertSame(1, $stats['skipped']);
        self::assertSame(['skipped', 'mail_transport_not_configured'], $this->row('a'));

        mail_outbox_enqueue($this->db, 1, 'test', 'b', 'Betreff', 'Text', 1000);
        $failing = static fn (string $to, string $subject, string $body): string => 'smtp_down';
        self::assertSame(1, mail_outbox_flush($this->db, 1000, 10, 3, $failing)['retried']);
        self::assertSame(1300, (int)$this->db->query("SELECT next_attempt_at FROM mail_outbox WHERE dedupe_key='b'")->fetchColumn());
        self::assertSame(0, mail_outbox_flush($this->db, 1299, 10, 3, $failing)['retried']);
        self::assertSame(1, mail_outbox_flush($this->db, 1300, 10, 3, $failing)['retried']);
        self::assertSame(1, mail_outbox_flush($this->db, 1900, 10, 3, $failing)['failed']);
        self::assertSame(['failed', 'smtp_down'], $this->row('b'));
    }

    public function testFlushSendsEligibleMailAndRechecksOptOut(): void
    {
        mail_outbox_enqueue($this->db, 1, 'test', 'c', 'Betreff', 'Text', 1000);
        mail_outbox_enqueue($this->db, 1, 'test', 'd', 'Betreff', 'Text', 2000);
        self::assertFalse(mail_outbox_enqueue($this->db, 3, 'test', 'npc', 'Betreff', 'Text', 1000));
        $sent = [];
        $transport = static function (string $to, string $subject, string $body) use (&$sent): ?string {
            $sent[] = $to;
            return null;
        };
        self::assertSame(1, mail_outbox_flush($this->db, 1000, 10, 3, $transport)['sent']);
        self::assertSame(['pilot@example.org'], $sent);
        self::assertSame(['sent', null], $this->row('c'));

        $this->db->exec('UPDATE users SET email_notifications = 0 WHERE id = 1');
        self::assertSame(1, mail_outbox_flush($this->db, 2000, 10, 3, $transport)['skipped']);
        self::assertCount(1, $sent);
    }

    private function firstWindowWithEvents(): int
    {
        for ($window = 400000; $window < 400200; $window++) {
            $now = HourlyWindow::start($window) + 60;
            if ((new WorldEvents($this->db))->generate($now, 6) !== []) {
                $this->db->exec('DELETE FROM world_events');
                return $now;
            }
        }
        self::fail('No window with world events found.');
    }

    /** @return array<string, mixed> */
    private function event(string $scope, int $galaxy, int $system, string $good): array
    {
        return [
            'id' => $galaxy, 'event_type' => 'supply_shock', 'scope_type' => $scope, 'galaxy_index' => $galaxy,
            'system_index' => $system, 'good_key' => $good, 'modifiers' => ['production' => 0.6, 'price' => 1.2],
            'starts_at' => 1440300, 'ends_at' => 1462000,
        ];
    }

    private function rows(string $table): int
    {
        return (int)$this->db->query("SELECT COUNT(*) FROM $table")->fetchColumn();
    }

    /** @return array{0: string, 1: ?string} */
    private function row(string $key): array
    {
        $row = $this->db->query("SELECT status, last_error FROM mail_outbox WHERE dedupe_key = '$key'")->fetch();
        return [$row['status'], $row['last_error']];
    }
}
