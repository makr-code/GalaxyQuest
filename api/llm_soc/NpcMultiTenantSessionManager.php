<?php
/**
 * Multi-tenant NPC Chat Session Manager
 * Handles separate conversation contexts for each player-NPC pair
 * Supports both file-based and database storage
 */

class NpcMultiTenantSessionManager
{
    private string $storage_type;
    private string $sessions_dir;
    private ?\PDO $db;
    private int $context_depth;
    private bool $context_compression;

    public function __construct(array $config, ?\PDO $db = null)
    {
        $this->storage_type = $config['storage'] ?? 'file';
        $this->sessions_dir = __DIR__ . '/../../cache/npc_sessions';
        $this->db = $db;
        $this->context_depth = (int) ($config['context_depth'] ?? 5);
        $this->context_compression = (bool) ($config['context_compression'] ?? true);

        if ($this->storage_type === 'file' && !is_dir($this->sessions_dir)) {
            @mkdir($this->sessions_dir, 0755, true);
        }
    }

    /**
     * Create unique session ID for player-NPC pair
     * Format: user_{uid}_npc_{npc_id}_faction_{faction}
     */
    private function generateSessionId(int $userId, string $npcId, string $faction): string
    {
        return 'user_' . $userId . '_npc_' . md5($npcId) . '_faction_' . md5($faction);
    }

    /**
     * Load or create chat session for player-NPC interaction
     */
    public function loadSession(int $userId, string $npcId, string $faction): array
    {
        $sessionId = $this->generateSessionId($userId, $npcId, $faction);

        if ($this->storage_type === 'file') {
            return $this->loadFileSession($sessionId, $userId, $npcId, $faction);
        } else {
            return $this->loadDbSession($sessionId, $userId, $npcId, $faction);
        }
    }

    private function loadFileSession(string $sessionId, int $userId, string $npcId, string $faction): array
    {
        $sessionFile = $this->sessions_dir . '/' . $sessionId . '.json';

        if (file_exists($sessionFile)) {
            $data = json_decode(file_get_contents($sessionFile), true);
            if (is_array($data)) {
                return $data;
            }
        }

        // Create new session
        return [
            'session_id' => $sessionId,
            'user_id' => $userId,
            'npc_id' => $npcId,
            'faction' => $faction,
            'created_at' => time(),
            'updated_at' => time(),
            'messages' => [],
            'summary' => null, // Compressed context summary
        ];
    }

    private function loadDbSession(string $sessionId, int $userId, string $npcId, string $faction): array
    {
        if (!$this->db) {
            return [];
        }

        try {
            $stmt = $this->db->prepare(
                'SELECT * FROM npc_chat_sessions WHERE session_id = ? AND user_id = ?'
            );
            $stmt->execute([$sessionId, $userId]);
            $row = $stmt->fetch(\PDO::FETCH_ASSOC);

            if ($row) {
                $messages = json_decode((string) ($row['messages_json'] ?? '[]'), true) ?: [];
                return [
                    'session_id' => $sessionId,
                    'user_id' => $userId,
                    'npc_id' => $npcId,
                    'faction' => $faction,
                    'created_at' => strtotime((string) ($row['created_at'] ?? 'now')),
                    'updated_at' => strtotime((string) ($row['updated_at'] ?? 'now')),
                    'messages' => $messages,
                    'summary' => (string) ($row['context_summary'] ?? ''),
                ];
            }
        } catch (\PDOException $e) {
            error_log("Failed to load NPC session from DB: " . $e->getMessage());
        }

        // Create new session
        return [
            'session_id' => $sessionId,
            'user_id' => $userId,
            'npc_id' => $npcId,
            'faction' => $faction,
            'created_at' => time(),
            'updated_at' => time(),
            'messages' => [],
            'summary' => null,
        ];
    }

    /**
     * Save chat message to session
     */
    public function addMessage(array $session, string $role, string $content): array
    {
        if (!isset($session['messages']) || !is_array($session['messages'])) {
            $session['messages'] = [];
        }
        
        $session['messages'][] = [
            'role' => $role,
            'content' => $content,
            'timestamp' => time(),
        ];
        $session['updated_at'] = time();

        if ($this->storage_type === 'file') {
            $this->saveFileSession($session);
        } else {
            $this->saveDbSession($session);
        }

        return $session;
    }

    private function saveFileSession(array $session): bool
    {
        $sessionFile = $this->sessions_dir . '/' . $session['session_id'] . '.json';
        $json = json_encode($session, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        return (bool) file_put_contents($sessionFile, $json);
    }

    private function saveDbSession(array $session): bool
    {
        if (!$this->db) {
            return false;
        }

        try {
            $messagesJson = json_encode($session['messages'] ?? [], JSON_UNESCAPED_UNICODE);

            $stmt = $this->db->prepare(
                'INSERT INTO npc_chat_sessions 
                (session_id, user_id, npc_id, faction, messages_json, context_summary, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE 
                messages_json = VALUES(messages_json), updated_at = NOW()'
            );

            return $stmt->execute([
                $session['session_id'],
                $session['user_id'],
                $session['npc_id'],
                $session['faction'],
                $messagesJson,
                $session['summary'] ?? null,
            ]);
        } catch (\PDOException $e) {
            error_log("Failed to save NPC session to DB: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Get conversation history with context depth limit
     */
    public function getContextMessages(array $session, bool $includeSystemPrompt = true, string $systemPrompt = ''): array
    {
        $messages = $session['messages'] ?? [];

        // Apply context depth (limit conversation history)
        if (count($messages) > $this->context_depth * 2) {
            if ($this->context_compression && $session['summary']) {
                // Use compressed summary of old exchanges
                $messages = [
                    ['role' => 'system', 'content' => 'Previous conversation summary: ' . $session['summary']],
                    ...array_slice($messages, -($this->context_depth * 2))
                ];
            } else {
                // Just keep recent messages
                $messages = array_slice($messages, -($this->context_depth * 2));
            }
        }

        if ($includeSystemPrompt && $systemPrompt !== '') {
            array_unshift($messages, ['role' => 'system', 'content' => $systemPrompt]);
        }

        return $messages;
    }

    /**
     * Compress conversation summary for long sessions
     */
    public function compressContext(array $session): string
    {
        $messages = $session['messages'] ?? [];
        if (empty($messages)) {
            return '';
        }

        // Simple summary: extract key topics from recent exchanges
        $summary_parts = [];
        $user_messages = array_filter($messages, fn($m) => $m['role'] === 'user');

        // Keep last 2-3 user message topics
        foreach (array_slice($user_messages, -3) as $msg) {
            $text = (string) ($msg['content'] ?? '');
            // Extract first 60 chars as topic
            $topic = substr($text, 0, 60);
            if (strlen($text) > 60) {
                $topic .= '...';
            }
            $summary_parts[] = $topic;
        }

        return 'Previously discussed: ' . implode(', ', $summary_parts);
    }

    /**
     * Clean up old sessions (for maintenance)
     */
    public function cleanupExpiredSessions(int $ttl_seconds = 86400): int
    {
        if ($this->storage_type === 'file') {
            return $this->cleanupFileSessions($ttl_seconds);
        } else {
            return $this->cleanupDbSessions($ttl_seconds);
        }
    }

    private function cleanupFileSessions(int $ttl_seconds): int
    {
        $cutoff_time = time() - $ttl_seconds;
        $deleted = 0;

        if (!is_dir($this->sessions_dir)) {
            return 0;
        }

        foreach (glob($this->sessions_dir . '/*.json') as $file) {
            if (filemtime($file) < $cutoff_time) {
                if (unlink($file)) {
                    $deleted++;
                }
            }
        }

        return $deleted;
    }

    private function cleanupDbSessions(int $ttl_seconds): int
    {
        if (!$this->db) {
            return 0;
        }

        try {
            $stmt = $this->db->prepare(
                'DELETE FROM npc_chat_sessions WHERE updated_at < DATE_SUB(NOW(), INTERVAL ? SECOND)'
            );
            $stmt->execute([$ttl_seconds]);
            return (int) $this->db->query('SELECT ROW_COUNT()')->fetch()[0];
        } catch (\PDOException $e) {
            error_log("Failed to cleanup NPC sessions: " . $e->getMessage());
            return 0;
        }
    }
}
