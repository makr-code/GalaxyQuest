<?php

declare(strict_types=1);

/**
 * Manages per-session NPC conversation history.
 *
 * Each "session" is one individual conversation (a sitting with an NPC).
 * The DB table `npc_chat_sessions` holds one row per session with:
 *   - a timestamped chat_file path pointing to the JSON message log on disk
 *   - an optional LLM-generated summary (set when the session is closed)
 *
 * File layout:
 *   generated/npc_chats/u_{userId}/{faction_code}/{npc_slug}/session_{id}.json
 *
 * Message format inside the JSON file:
 *   [{"role":"user","content":"...","ts":"2026-04-07T10:00:00"}, ...]
 */
final class NpcChatSessionRepository {
    private string $projectRoot;

    public function __construct(?string $projectRoot = null) {
        $this->projectRoot = $projectRoot ?? realpath(__DIR__ . '/../../') ?: '';
    }

    // ── Session management ────────────────────────────────────────────────────

    /**
     * Creates a new session row in DB and its empty JSON file.
     * Returns the session id and relative file path.
     *
     * @return array{id:int, chat_file:string}
     */
    public function createSession(PDO $db, int $userId, string $factionCode, string $npcName): array {
        $db->prepare(
            'INSERT INTO npc_chat_sessions (user_id, faction_code, npc_name, chat_file)
             VALUES (?, ?, ?, "")'
        )->execute([$userId, $factionCode, $npcName]);

        $sessionId = (int) $db->lastInsertId();
        $relPath = $this->buildRelativePath($userId, $factionCode, $npcName, $sessionId);

        $db->prepare(
            'UPDATE npc_chat_sessions SET chat_file = ? WHERE id = ?'
        )->execute([$relPath, $sessionId]);

        $this->ensureFileExists($relPath);

        return ['id' => $sessionId, 'chat_file' => $relPath];
    }

    /**
     * Loads a session row by id and user (guards against cross-user access).
     *
     * @return array<string, mixed>|null
     */
    public function loadSession(PDO $db, int $sessionId, int $userId): ?array {
        $stmt = $db->prepare(
            'SELECT id, user_id, faction_code, npc_name, chat_file, summary, started_at, updated_at
             FROM npc_chat_sessions
             WHERE id = ? AND user_id = ?
             LIMIT 1'
        );
        $stmt->execute([$sessionId, $userId]);
        $row = $stmt->fetch();
        return is_array($row) ? $row : null;
    }

    /**
     * Returns LLM-generated summaries of all closed (summarized) sessions
     * for a given user + faction + npc, ordered oldest first.
     *
     * @return array<int, array{id:int, summary:string, started_at:string}>
     */
    public function loadPreviousSummaries(PDO $db, int $userId, string $factionCode, string $npcName): array {
        $stmt = $db->prepare(
            'SELECT id, summary, started_at
             FROM npc_chat_sessions
             WHERE user_id = ? AND faction_code = ? AND npc_name = ?
               AND summary IS NOT NULL AND summary != ""
             ORDER BY started_at ASC'
        );
        $stmt->execute([$userId, $factionCode, $npcName]);
        return array_values((array) $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    /**
     * Saves an LLM-generated summary string to a session row.
     */
    public function saveSessionSummary(PDO $db, int $sessionId, string $summary): void {
        $db->prepare(
            'UPDATE npc_chat_sessions SET summary = ?, updated_at = NOW() WHERE id = ?'
        )->execute([trim($summary), $sessionId]);
    }

    // ── Message file I/O ──────────────────────────────────────────────────────

    /**
     * Loads messages from a session's JSON file.
     * Returns an empty array when the file does not exist yet.
     *
     * @return array<int, array{role:string, content:string, ts:string}>
     */
    public function loadMessages(string $relPath): array {
        $absPath = $this->absPath($relPath);
        if (!is_file($absPath)) {
            return [];
        }
        $raw = file_get_contents($absPath);
        if ($raw === false || trim($raw) === '' || trim($raw) === '[]') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Appends new messages to a session's JSON file and touches updated_at.
     *
     * @param array<int, array{role:string, content:string}> $newMessages
     */
    public function appendMessages(PDO $db, int $sessionId, string $relPath, array $newMessages): void {
        $absPath = $this->absPath($relPath);
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

        $db->prepare(
            'UPDATE npc_chat_sessions SET updated_at = NOW() WHERE id = ?'
        )->execute([$sessionId]);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Builds the relative file path for a specific session.
     */
    public function buildRelativePath(int $userId, string $factionCode, string $npcName, int $sessionId): string {
        $slug = $this->slugify($npcName);
        return 'generated/npc_chats/u_' . $userId . '/' . $factionCode . '/' . $slug . '/session_' . $sessionId . '.json';
    }

    /**
     * Slugifies an NPC name for safe use in file paths.
     */
    public function slugify(string $name): string {
        $slug = preg_replace('/[^a-z0-9_]+/', '_', mb_strtolower($name));
        $slug = trim((string) $slug, '_');
        return $slug !== '' ? $slug : 'npc';
    }

    private function absPath(string $relPath): string {
        return $this->projectRoot . '/' . ltrim($relPath, '/');
    }

    private function ensureFileExists(string $relPath): void {
        $absPath = $this->absPath($relPath);
        $dir = dirname($absPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        if (!is_file($absPath)) {
            file_put_contents($absPath, '[]');
        }
    }
}
