<?php
/**
 * Unified NPC Chat Service
 * Orchestrates YAML agent configuration, multi-tenant sessions, and response caching
 */

require_once __DIR__ . '/NpcAgentManager.php';
require_once __DIR__ . '/NpcMultiTenantSessionManager.php';
require_once __DIR__ . '/AiResponseCache.php';
require_once __DIR__ . '/../ollama_client.php';

class NpcChatService
{
    private NpcAgentManager $agent_manager;
    private NpcMultiTenantSessionManager $session_manager;
    private AiResponseCache $cache;
    private \PDO $db;

    public function __construct(\PDO $db, string $config_file = null)
    {
        $this->db = $db;
        $this->agent_manager = new NpcAgentManager($config_file);

        // Initialize session manager
        $session_config = $this->agent_manager->getSessionConfig();
        $this->session_manager = new NpcMultiTenantSessionManager($session_config, $db);

        // Initialize cache
        $cache_config = $this->agent_manager->getCachingConfig();
        $this->cache = new AiResponseCache($cache_config);
    }

    /**
     * Generate NPC response to player message
     * Handles caching, sessions, and agent personality
     */
    public function generateNpcResponse(
        int $userId,
        string $npcId,
        string $npcName,
        string $faction,
        string $agentType,
        string $playerMessage,
        array $gameContext = []
    ): array {
        // Load session
        $session = $this->session_manager->loadSession($userId, $npcId, $faction);

        // Get agent configuration
        $agent = $this->agent_manager->getAgent($agentType);
        if (!$agent) {
            return [
                'ok' => false,
                'error' => 'Unknown agent type: ' . $agentType,
                'status' => 400,
            ];
        }

        // Get system prompt with game context
        $system_prompt = $this->buildSystemPrompt(
            $agentType,
            $npcName,
            $faction,
            $gameContext
        );

        // Build message history
        $context_messages = $this->session_manager->getContextMessages(
            $session,
            true,
            $system_prompt
        );
        $context_messages[] = ['role' => 'user', 'content' => $playerMessage];

        // Check cache
        $constraints = $this->agent_manager->getResponseConstraints($agentType);
        $cache_key_options = [
            'temperature' => $constraints['temperature'],
            'agent_type' => $agentType,
        ];

        $cached = $this->cache->get('mistral', $context_messages, $cache_key_options);
        if ($cached !== null) {
            // Add to session and return
            $this->session_manager->addMessage($session, 'user', $playerMessage);
            $this->session_manager->addMessage($session, 'assistant', $cached['text'] ?? '');

            return [
                'ok' => true,
                'text' => $cached['text'] ?? '',
                'model' => 'mistral',
                'from_cache' => true,
                'session_id' => $session['session_id'],
            ];
        }

        // Call Ollama API
        $start = microtime(true);
        $result = ollama_chat($context_messages, [
            'model' => 'mistral',
            'temperature' => $constraints['temperature'],
            'timeout' => 30,
        ]);
        $latency_ms = (int) round((microtime(true) - $start) * 1000);

        if (!($result['ok'] ?? false)) {
            return [
                'ok' => false,
                'error' => $result['error'] ?? 'Ollama API error',
                'status' => $result['status'] ?? 503,
            ];
        }

        $npc_response = $result['text'] ?? '';

        // Cache the response
        $this->cache->set('mistral', $context_messages, $result, $cache_key_options);

        // Save to session
        $session = $this->session_manager->addMessage($session, 'user', $playerMessage);
        $session = $this->session_manager->addMessage($session, 'assistant', $npc_response);

        // Compress context if session is getting long
        if (count($session['messages'] ?? []) > $this->agent_manager->getSessionConfig()['context_depth'] * 4) {
            $session['summary'] = $this->session_manager->compressContext($session);
        }

        return [
            'ok' => true,
            'text' => $npc_response,
            'model' => $result['model'] ?? 'mistral',
            'from_cache' => false,
            'latency_ms' => $latency_ms,
            'session_id' => $session['session_id'],
            'session_messages_count' => count($session['messages'] ?? []),
        ];
    }

    /**
     * Build dynamic system prompt with game context
     */
    private function buildSystemPrompt(
        string $agentType,
        string $npcName,
        string $faction,
        array $gameContext = []
    ): string {
        $base_prompt = $this->agent_manager->getSystemPrompt($agentType);
        $context_rules = $this->agent_manager->getContextRules($agentType);

        $prompt = $base_prompt . "\n\n";
        $prompt .= "Name: {$npcName}\nFaction: {$faction}\n";

        // Add game context based on rules
        if ($context_rules['include_faction_relations'] ?? false) {
            if (!empty($gameContext['faction_relations'])) {
                $prompt .= "\nFaction Relations: " . $gameContext['faction_relations'] . "\n";
            }
        }

        if ($context_rules['include_recent_conflicts'] ?? false) {
            if (!empty($gameContext['recent_conflicts'])) {
                $prompt .= "Recent Conflicts: " . $gameContext['recent_conflicts'] . "\n";
            }
        }

        if ($context_rules['include_tech_level'] ?? false) {
            if (!empty($gameContext['tech_level'])) {
                $prompt .= "Technology Level: " . $gameContext['tech_level'] . "\n";
            }
        }

        if ($context_rules['include_trade_routes'] ?? false) {
            if (!empty($gameContext['trade_routes'])) {
                $prompt .= "Trade Routes: " . $gameContext['trade_routes'] . "\n";
            }
        }

        if ($context_rules['include_market_prices'] ?? false) {
            if (!empty($gameContext['market_prices'])) {
                $prompt .= "Market Info: " . $gameContext['market_prices'] . "\n";
            }
        }

        return trim($prompt);
    }

    /**
     * Get session history for a player-NPC pair
     */
    public function getSessionHistory(int $userId, string $npcId, string $faction): ?array
    {
        return $this->session_manager->loadSession($userId, $npcId, $faction);
    }

    /**
     * Clear session for player-NPC pair
     */
    public function clearSession(int $userId, string $npcId, string $faction): bool
    {
        // For now, just clear the file/DB entry
        $sessionId = 'user_' . $userId . '_npc_' . md5($npcId) . '_faction_' . md5($faction);
        $sessionFile = __DIR__ . '/../../cache/npc_sessions/' . $sessionId . '.json';
        return @unlink($sessionFile);
    }

    /**
     * Get cache statistics
     */
    public function getCacheStats(): array
    {
        return $this->cache->getStats();
    }

    /**
     * Clear all cached responses
     */
    public function clearCache(): int
    {
        return $this->cache->clearAll();
    }

    /**
     * Cleanup expired sessions
     */
    public function cleanupExpiredSessions(): int
    {
        $ttl = $this->agent_manager->getSessionConfig()['ttl_seconds'] ?? 86400;
        return $this->session_manager->cleanupExpiredSessions($ttl);
    }

    /**
     * Get available agent types
     */
    public function getAvailableAgents(): array
    {
        return $this->agent_manager->getAvailableAgents();
    }

    /**
     * Get agent details
     */
    public function getAgentInfo(string $agentType): ?array
    {
        $agent = $this->agent_manager->getAgent($agentType);
        if (!$agent) {
            return null;
        }

        return [
            'type' => $agentType,
            'name' => $agent['name'] ?? $agentType,
            'factions' => $agent['factions'] ?? [],
            'constraints' => $this->agent_manager->getResponseConstraints($agentType),
        ];
    }
}
