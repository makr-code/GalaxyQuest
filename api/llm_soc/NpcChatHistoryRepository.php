<?php

declare(strict_types=1);

/**
 * Manages NPC conversation history stored as JSON files on disk.
 *
 * One row per conversation (user + faction + npc) in the npc_chat_history
 * table holds only the relative path to the JSON file. The messages
 * themselves live in generated/npc_chats/u_{userId}/{faction_code}/{slug}.json
 * to keep the database small.
 *
 * Message format inside the JSON file:
 *   [{"role":"user","content":"...","ts":"2026-04-07T07:00:00"},...]
 */
final class NpcChatHistoryRepository {
    private string $projectRoot;

    public function __construct(?string $projectRoot = null) {
        $this->projectRoot = $projectRoot ?? realpath(__DIR__ . '/../../') ?: '';
    }

    /**
     * Returns (or registers) the relative chat file path for a conversation.
     * Inserts a new row into npc_chat_history if none exists yet.
     */
    public function ensureRegistered(PDO $db, int $userId, string $factionCode, string $npcName): string {
        $stmt = $db->prepare(
            'SELECT chat_file FROM npc_chat_history
             WHERE user_id = ? AND faction_code = ? AND npc_name = ?
             LIMIT 1'
        );
        $stmt->execute([$userId, $factionCode, $npcName]);
        $row = $stmt->fetch();

        if ($row && !empty($row['chat_file'])) {
            return (string) $row['chat_file'];
        }

        $relPath = $this->buildRelativePath($userId, $factionCode, $npcName);
        $db->prepare(
            'INSERT INTO npc_chat_history (user_id, faction_code, npc_name, chat_file)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE chat_file = VALUES(chat_file)'
        )->execute([$userId, $factionCode, $npcName, $relPath]);

        return $relPath;
    }

    /**
     * Loads messages from the chat file.
     * Returns an empty array if the file does not exist yet.
     *
     * @return array<int, array{role:string, content:string, ts:string}>
     */
    public function loadMessages(string $relPath): array {
        $absPath = $this->projectRoot . '/' . ltrim($relPath, '/');
        if (!is_file($absPath)) {
            return [];
        }
        $raw = file_get_contents($absPath);
        if ($raw === false || $raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Appends new messages to the chat file, creating it if necessary.
     *
     * @param array<int, array{role:string, content:string}> $newMessages
     */
    public function appendMessages(PDO $db, string $relPath, array $newMessages): void {
        $absPath = $this->projectRoot . '/' . ltrim($relPath, '/');
        $dir = dirname($absPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $existing = $this->loadMessages($relPath);
        $ts = (new \DateTimeImmutable())->format('Y-m-d\TH:i:s');
        foreach ($newMessages as $msg) {
            $existing[] = [
                'role' => (string) ($msg['role'] ?? 'user'),
                'content' => (string) ($msg['content'] ?? ''),
                'ts' => $ts,
            ];
        }

        file_put_contents($absPath, json_encode($existing, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

        // Touch updated_at in DB.
        $db->prepare(
            'UPDATE npc_chat_history SET updated_at = NOW()
             WHERE chat_file = ?'
        )->execute([$relPath]);
    }

    /**
     * Builds the relative file path for a conversation.
     * Stored in DB and also used to construct the absolute path.
     */
    public function buildRelativePath(int $userId, string $factionCode, string $npcName): string {
        $slug = preg_replace('/[^a-z0-9_]+/', '_', mb_strtolower($npcName));
        $slug = trim((string) $slug, '_');
        if ($slug === '') {
            $slug = 'npc';
        }
        return 'generated/npc_chats/u_' . $userId . '/' . $factionCode . '/' . $slug . '.json';
    }
}
