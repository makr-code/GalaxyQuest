<?php
/**
 * Comprehensive Test Suite for NPC Chat Integration
 * Tests: Agent Manager, Multi-tenant Sessions, Caching, Service Integration
 */

require_once __DIR__ . '/../api/llm_soc/NpcAgentManager.php';
require_once __DIR__ . '/../api/llm_soc/NpcMultiTenantSessionManager.php';
require_once __DIR__ . '/../api/llm_soc/AiResponseCache.php';
require_once __DIR__ . '/../api/llm_soc/NpcChatService.php';

class NpcChatIntegrationTests
{
    private string $test_dir;
    private int $passed = 0;
    private int $failed = 0;
    private array $test_results = [];

    public function __construct()
    {
        $this->test_dir = sys_get_temp_dir() . '/npc_chat_tests_' . time();
        @mkdir($this->test_dir, 0755, true);
    }

    public function runAllTests(): void
    {
        echo "🧪 Starting NPC Chat Integration Test Suite\n";
        echo str_repeat("=", 60) . "\n\n";

        $this->testAgentManager();
        $this->testMultiTenantSessions();
        $this->testResponseCache();
        $this->testNpcChatService();

        echo "\n" . str_repeat("=", 60) . "\n";
        echo "📊 Test Summary\n";
        echo "✅ Passed: {$this->passed}\n";
        echo "❌ Failed: {$this->failed}\n";
        echo "Total: " . ($this->passed + $this->failed) . "\n";

        // Cleanup
        $this->cleanupTestDir();
    }

    private function testAgentManager(): void
    {
        echo "🤖 Testing NPC Agent Manager\n";
        echo str_repeat("-", 40) . "\n";

        $mgr = new NpcAgentManager(__DIR__ . '/../config/npc_agents.yaml');

        // Test 1: Load agents
        $agents = $mgr->getAvailableAgents();
        $this->assert(!empty($agents), "Agents loaded", "No agents found");

        // Test 2: Get agent configuration
        if (in_array('commander', $agents)) {
            $commander = $mgr->getAgent('commander');
            $this->assert($commander !== null, "Commander agent loaded", "Commander not found");
        }

        // Test 3: Get system prompt
        $prompt = $mgr->getSystemPrompt('diplomat');
        $this->assert(!empty($prompt), "System prompt generated", "Empty system prompt");

        // Test 4: Get response constraints
        $constraints = $mgr->getResponseConstraints('merchant');
        $this->assert(isset($constraints['temperature']), "Response constraints loaded", "Missing constraints");

        // Test 5: Get context rules
        $rules = $mgr->getContextRules('commander');
        $this->assert(is_array($rules), "Context rules loaded", "Invalid context rules");

        // Test 6: Get caching config
        $cache_cfg = $mgr->getCachingConfig();
        $this->assert($cache_cfg['enabled'] !== null, "Caching config loaded", "Invalid cache config");

        // Test 7: Get session config
        $session_cfg = $mgr->getSessionConfig();
        $this->assert($session_cfg['enabled'] !== null, "Session config loaded", "Invalid session config");

        echo "\n";
    }

    private function testMultiTenantSessions(): void
    {
        echo "👥 Testing Multi-Tenant Session Manager\n";
        echo str_repeat("-", 40) . "\n";

        // Clean up old session files to ensure fresh start
        $sessions_dir = __DIR__ . '/../cache/npc_sessions';
        if (is_dir($sessions_dir)) {
            foreach (glob($sessions_dir . '/*.json') as $file) {
                @unlink($file);
            }
        }

        // Mock config
        $config = [
            'storage' => 'file',
            'ttl_seconds' => 3600,
            'context_depth' => 5,
            'context_compression' => true,
        ];

        $mgr = new NpcMultiTenantSessionManager($config);

        // Use unique user ID for each test run to avoid conflicts
        $unique_user_id = time() % 100000 + 1000;

        // Test 1: Load new session
        $session = $mgr->loadSession($unique_user_id, 'npc_commander_01', 'Federation');
        $this->assert($session['session_id'] !== null, "Session created", "No session ID");
        $this->assert($session['user_id'] === $unique_user_id, "User ID set correctly", "Wrong user ID");
        $this->assert(count($session['messages'] ?? []) === 0, "Initial session empty", "Session not empty");

        // Test 2: Add message
        $session = $mgr->addMessage($session, 'user', 'Hello!');
        $this->assert(count($session['messages'] ?? []) === 1, "Message added", "Message not added");

        // Test 3: Add assistant response
        $session = $mgr->addMessage($session, 'assistant', 'Greetings, commander!');
        $this->assert(count($session['messages'] ?? []) === 2, "Response added", "Response not added");

        // Test 4: Get context messages
        $messages = $mgr->getContextMessages($session, true, "You are a commander.");
        $this->assert(!empty($messages), "Context messages generated", "No context messages");

        // Test 5: Compress context
        $summary = $mgr->compressContext($session);
        $this->assert(is_string($summary), "Context compressed", "Invalid compression");

        // Test 6: Multiple sessions (isolation)
        $session2 = $mgr->loadSession($unique_user_id, 'npc_merchant_02', 'Neutral');
        $this->assert($session['session_id'] !== $session2['session_id'], "Sessions isolated", "Session IDs identical");

        echo "\n";
    }

    private function testResponseCache(): void
    {
        echo "💾 Testing Response Cache\n";
        echo str_repeat("-", 40) . "\n";

        $config = [
            'storage' => 'file',
            'file_path' => $this->test_dir . '/cache',
            'ttl_seconds' => 3600,
        ];

        $cache = new AiResponseCache($config);

        // Test 1: Cache miss
        $messages = [['role' => 'user', 'content' => 'Hello']];
        $cached = $cache->get('mistral', $messages);
        $this->assert($cached === null, "Cache miss on empty cache", "Unexpected cache hit");

        // Test 2: Cache set
        $response = ['text' => 'Hello there!', 'model' => 'mistral'];
        $set_ok = $cache->set('mistral', $messages, $response);
        $this->assert($set_ok, "Response cached", "Failed to cache");

        // Test 3: Cache hit
        $cached = $cache->get('mistral', $messages);
        $this->assert($cached !== null, "Cache hit", "Cache retrieval failed");
        $this->assert($cached['text'] === 'Hello there!', "Cached response matches", "Response mismatch");

        // Test 4: Cache invalidation
        $invalidated = $cache->invalidate('mistral', $messages);
        $this->assert($invalidated, "Cache invalidated", "Invalidation failed");
        $cached = $cache->get('mistral', $messages);
        $this->assert($cached === null, "Cache miss after invalidate", "Invalidation failed");

        // Test 5: Cache stats
        $cache->set('mistral', $messages, $response);
        $stats = $cache->getStats();
        $this->assert($stats['entries'] > 0, "Cache stats generated", "No cache entries");

        // Test 6: Clear all
        $cleared = $cache->clearAll();
        $this->assert($cleared > 0, "Cache cleared", "Nothing to clear");

        echo "\n";
    }

    private function testNpcChatService(): void
    {
        echo "🗣️  Testing NPC Chat Service\n";
        echo str_repeat("-", 40) . "\n";

        // Note: Full service test requires DB and Ollama
        // We'll test basic initialization and configuration

        // Test 1: Service instantiation (with mock DB)
        $mock_db = $this->getMockDatabase();
        
        try {
            $service = new NpcChatService($mock_db, __DIR__ . '/../config/npc_agents.yaml');
            $this->assert(true, "Service initialized", "Failed to create service");
        } catch (Exception $e) {
            $this->assert(false, "Service initialization", $e->getMessage());
            return;
        }

        // Test 2: Get available agents
        $agents = $service->getAvailableAgents();
        $this->assert(!empty($agents), "Agents retrieved", "No agents found");

        // Test 3: Get agent info
        if (!empty($agents)) {
            $info = $service->getAgentInfo($agents[0]);
            $this->assert($info !== null, "Agent info retrieved", "Failed to get info");
            $this->assert(isset($info['type']), "Agent type in info", "Missing agent type");
        }

        // Test 4: Get cache stats
        $stats = $service->getCacheStats();
        $this->assert(is_array($stats), "Cache stats retrieved", "Invalid cache stats");

        // Test 5: Clear cache (should not throw)
        try {
            $cleared = $service->clearCache();
            $this->assert(true, "Cache cleared", "Clear failed");
        } catch (Exception $e) {
            $this->assert(false, "Cache clear", $e->getMessage());
        }

        echo "\n";
    }

    private function getMockDatabase(): \PDO
    {
        $db = new \PDO('sqlite::memory:');
        $db->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);

        // Create mock table
        $db->exec('
            CREATE TABLE npc_chat_sessions (
                id INTEGER PRIMARY KEY,
                session_id TEXT UNIQUE,
                user_id INTEGER,
                npc_id TEXT,
                faction TEXT,
                messages_json TEXT,
                context_summary TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ');

        return $db;
    }

    private function assert(bool $condition, string $test_name, string $error_msg = ''): void
    {
        if ($condition) {
            echo "  ✅ $test_name\n";
            $this->passed++;
        } else {
            echo "  ❌ $test_name";
            if ($error_msg) {
                echo " - $error_msg";
            }
            echo "\n";
            $this->failed++;
        }
    }

    private function cleanupTestDir(): void
    {
        $this->removeDir($this->test_dir);
    }

    private function removeDir(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir . '/' . $item;
            if (is_dir($path)) {
                $this->removeDir($path);
            } else {
                @unlink($path);
            }
        }
        @rmdir($dir);
    }
}

// Run tests
if (php_sapi_name() === 'cli') {
    $tests = new NpcChatIntegrationTests();
    $tests->runAllTests();
}
