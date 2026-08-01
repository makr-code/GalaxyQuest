<?php
/**
 * NPC Agent Manager - Load and manage YAML-based agent configurations
 * Handles personality, context rules, and response constraints
 */

require_once __DIR__ . '/../../lib/MiniYamlParser.php';

class NpcAgentManager
{
    private array $agents = [];
    private array $caching_config = [];
    private array $sessions_config = [];
    private string $config_file;

    public function __construct(string $config_file = null)
    {
        $this->config_file = $config_file ?? __DIR__ . '/npc_agents.yaml';
        $this->loadConfig();
    }

    private function loadConfig(): void
    {
        if (!file_exists($this->config_file)) {
            error_log("NPC agents config not found: {$this->config_file}");
            return;
        }

        try {
            $yaml = file_get_contents($this->config_file);
            $parser = new MiniYamlParser();
            $config = $parser->parse($yaml);

            if (is_array($config)) {
                $this->agents = $config['agents'] ?? [];
                $this->caching_config = $config['caching'] ?? [];
                $this->sessions_config = $config['sessions'] ?? [];
            }
        } catch (Exception $e) {
            error_log("Failed to parse NPC agents config: " . $e->getMessage());
        }
    }

    /**
     * Get agent configuration by type
     * @return array|null
     */
    public function getAgent(string $agentType): ?array
    {
        return $this->agents[$agentType] ?? null;
    }

    /**
     * Get system prompt for given agent type
     */
    public function getSystemPrompt(string $agentType): string
    {
        $agent = $this->getAgent($agentType);
        if (!$agent) {
            return "You are a helpful NPC in a space strategy game.";
        }

        return trim((string) ($agent['system_prompt'] ?? ''));
    }

    /**
     * Get response constraints for agent
     */
    public function getResponseConstraints(string $agentType): array
    {
        $agent = $this->getAgent($agentType);
        if (!$agent) {
            return [
                'min_tokens' => 20,
                'max_tokens' => 150,
                'temperature' => 0.7,
            ];
        }

        $constraints = $agent['response_constraints'] ?? [];
        return [
            'min_tokens' => (int) ($constraints['min_tokens'] ?? 20),
            'max_tokens' => (int) ($constraints['max_tokens'] ?? 150),
            'temperature' => (float) ($constraints['temperature'] ?? 0.7),
        ];
    }

    /**
     * Get context rules for agent (what game state to include in prompt)
     */
    public function getContextRules(string $agentType): array
    {
        $agent = $this->getAgent($agentType);
        if (!$agent) {
            return [];
        }

        $rules = $agent['context_rules'] ?? [];
        return array_combine(
            array_keys($rules),
            array_map(fn($v) => (bool) $v, $rules)
        );
    }

    /**
     * Get all available agent types
     */
    public function getAvailableAgents(): array
    {
        return array_keys($this->agents);
    }

    /**
     * Get caching configuration
     */
    public function getCachingConfig(): array
    {
        return [
            'enabled' => (bool) ($this->caching_config['enabled'] ?? false),
            'ttl_seconds' => (int) ($this->caching_config['ttl_seconds'] ?? 3600),
            'storage' => (string) ($this->caching_config['storage'] ?? 'file'),
            'file_path' => (string) ($this->caching_config['file_path'] ?? '../cache/ai_responses'),
            'redis_host' => (string) ($this->caching_config['redis_host'] ?? 'localhost'),
            'redis_port' => (int) ($this->caching_config['redis_port'] ?? 6379),
        ];
    }

    /**
     * Get session configuration
     */
    public function getSessionConfig(): array
    {
        return [
            'enabled' => (bool) ($this->sessions_config['enabled'] ?? true),
            'ttl_seconds' => (int) ($this->sessions_config['ttl_seconds'] ?? 86400),
            'storage' => (string) ($this->sessions_config['storage'] ?? 'file'),
            'context_depth' => (int) ($this->sessions_config['context_depth'] ?? 5),
            'context_compression' => (bool) ($this->sessions_config['context_compression'] ?? true),
        ];
    }
}
