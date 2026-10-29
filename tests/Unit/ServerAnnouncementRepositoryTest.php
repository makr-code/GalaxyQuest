<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/ServerAnnouncementRepository.php';

final class ServerAnnouncementRepositoryTest extends TestCase {
    private PDO $db;
    private ServerAnnouncementRepository $repository;

    protected function setUp(): void {
        $this->db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec('CREATE TABLE server_announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, message TEXT NOT NULL,
            severity TEXT NOT NULL, published_at TEXT DEFAULT CURRENT_TIMESTAMP, withdrawn_at TEXT NULL
        )');
        $this->repository = new ServerAnnouncementRepository($this->db);
    }

    public function testPublishPersistsAndWithdrawalHidesWithoutDeleting(): void {
        self::assertSame([], $this->repository->active());
        $id = $this->repository->publish(['title' => ' Maintenance ', 'message' => 'Restart at 20:00 UTC.']);
        $saved = (new ServerAnnouncementRepository($this->db))->active();
        self::assertSame($id, $saved[0]['id']);
        self::assertSame('Maintenance', $saved[0]['title']);
        self::assertSame('important', $saved[0]['severity']);
        self::assertTrue($this->repository->withdraw($id));
        self::assertFalse($this->repository->withdraw($id));
        self::assertSame([], $this->repository->active());
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM server_announcements')->fetchColumn());
    }

    public function testMessagesAreNewestFirstAndBounded(): void {
        for ($i = 1; $i <= 55; $i++) {
            $this->repository->publish(['title' => "Notice $i", 'message' => 'Message', 'severity' => 'critical']);
        }
        $rows = $this->repository->active();
        self::assertCount(50, $rows);
        self::assertSame(55, $rows[0]['id']);
        self::assertSame(6, $rows[49]['id']);
    }

    public function testInvalidMessagesAreRejectedWithoutWriting(): void {
        foreach ([
            [], ['title' => [], 'message' => 'Text'], ['title' => 'Title', 'message' => ' '],
            ['title' => str_repeat('a', 161), 'message' => 'Text'],
            ['title' => 'Title', 'message' => str_repeat('a', 10001)],
            ['title' => 'Title', 'message' => 'Text', 'severity' => 'arbitrary'],
        ] as $body) {
            try {
                $this->repository->publish($body);
                self::fail('Invalid message was accepted');
            } catch (InvalidArgumentException $error) {
                self::assertNotSame('', $error->getMessage());
            }
        }
        self::assertSame([], $this->repository->active());
    }

    public function testInvalidWithdrawalIdIsRejected(): void {
        $this->expectException(InvalidArgumentException::class);
        $this->repository->withdraw(0);
    }
}
