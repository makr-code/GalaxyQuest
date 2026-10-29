<?php
declare(strict_types=1);

final class ServerAnnouncementRepository {
    public function __construct(private PDO $db) {}

    public function active(): array {
        $rows = $this->db->query(
            'SELECT id, title, message, severity, published_at
             FROM server_announcements WHERE withdrawn_at IS NULL
             ORDER BY id DESC LIMIT 50'
        )->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$row) {
            $row['id'] = (int)$row['id'];
        }
        unset($row);
        return $rows;
    }

    public function publish(array $body): int {
        $title = $body['title'] ?? null;
        $message = $body['message'] ?? null;
        $severity = $body['severity'] ?? 'important';
        if (!is_string($title) || trim($title) === '' || strlen($title) > 160
            || !is_string($message) || trim($message) === '' || strlen($message) > 10000
            || !in_array($severity, ['important', 'maintenance', 'critical'], true)) {
            throw new InvalidArgumentException('Title (1-160 bytes), message (1-10000 bytes) and valid severity are required.');
        }
        $stmt = $this->db->prepare('INSERT INTO server_announcements (title, message, severity) VALUES (?, ?, ?)');
        $stmt->execute([trim($title), trim($message), $severity]);
        return (int)$this->db->lastInsertId();
    }

    public function withdraw(int $id): bool {
        if ($id < 1) {
            throw new InvalidArgumentException('A positive announcement id is required.');
        }
        $stmt = $this->db->prepare('UPDATE server_announcements SET withdrawn_at = CURRENT_TIMESTAMP WHERE id = ? AND withdrawn_at IS NULL');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }
}
