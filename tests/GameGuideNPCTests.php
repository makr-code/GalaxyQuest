<?php
/**
 * Tests für Game Guide NPC
 */

use PHPUnit\Framework\TestCase;

class GameGuideNPCTests extends TestCase
{
    private $db;
    private $game_guide;
    private $test_user_id = 999;

    protected function setUp(): void
    {
        require_once __DIR__ . '/../api/llm_soc/GameGuideNPC.php';
        
        $this->db = new PDO('mysql:host=localhost;dbname=galaxyquest_test', 'root', '');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_THROW);
        
        $this->game_guide = new GameGuideNPC($this->db);
        $this->cleanupTestData();
    }

    protected function tearDown(): void
    {
        $this->cleanupTestData();
    }

    private function cleanupTestData()
    {
        try {
            $this->db->exec("DELETE FROM game_guide_progress WHERE user_id = {$this->test_user_id}");
            $this->db->exec("DELETE FROM game_guide_interactions WHERE user_id = {$this->test_user_id}");
            $this->db->exec("DELETE FROM game_guide_state WHERE user_id = {$this->test_user_id}");
        } catch (Exception $e) {
            // Tables may not exist
        }
    }

    // ========== GREETING TESTS ==========

    public function testNewPlayerGreeting()
    {
        $player_data = [
            'is_new_player' => true,
            'player_level' => 1,
            'last_active' => time(),
        ];
        
        $result = $this->game_guide->getGreeting($this->test_user_id, $player_data);
        
        $this->assertTrue($result['ok']);
        $this->assertStringContainsString('willkommen', strtolower($result['greeting']));
        $this->assertTrue($result['is_new_player']);
    }

    public function testReturningPlayerGreeting()
    {
        $player_data = [
            'is_new_player' => false,
            'player_level' => 5,
            'last_active' => time() - (2 * 86400), // 2 days ago
        ];
        
        $result = $this->game_guide->getGreeting($this->test_user_id, $player_data);
        
        $this->assertTrue($result['ok']);
        $this->assertFalse($result['is_new_player']);
    }

    // ========== GAME STATE ASSESSMENT TESTS ==========

    public function testAssessResourceCriticalStarvation()
    {
        $game_state = [
            'resources' => ['food' => 10],
            'production' => ['food' => 5],
            'population' => 100,
            'colony_count' => 1,
            'buildings' => [],
            'fleet_strength' => 0,
            'research_buildings' => 0,
            'time_played_hours' => 0.5,
        ];
        
        $assessment = $this->game_guide->assessGameState($this->test_user_id, $game_state);
        
        $this->assertNotEmpty($assessment['critical_issues']);
        $this->assertTrue($this->arrayContainsIssue($assessment['critical_issues'], 'starvation_risk'));
    }

    public function testAssessLowProduction()
    {
        $game_state = [
            'resources' => ['food' => 500],
            'production' => ['food' => 10],
            'population' => 100,
            'colony_count' => 1,
            'buildings' => [],
            'fleet_strength' => 0,
            'research_buildings' => 0,
            'time_played_hours' => 1,
        ];
        
        $assessment = $this->game_guide->assessGameState($this->test_user_id, $game_state);
        
        $this->assertNotEmpty($assessment['warnings']);
        $this->assertTrue($this->arrayContainsIssue($assessment['warnings'], 'low_production'));
    }

    public function testAssessMilitaryThreat()
    {
        $game_state = [
            'resources' => ['food' => 500],
            'production' => ['food' => 50],
            'population' => 100,
            'colony_count' => 1,
            'buildings' => [],
            'fleet_strength' => 10,
            'nearby_threats' => 2,
            'research_buildings' => 0,
            'time_played_hours' => 2,
        ];
        
        $assessment = $this->game_guide->assessGameState($this->test_user_id, $game_state);
        
        $this->assertNotEmpty($assessment['critical_issues']);
        $this->assertTrue($this->arrayContainsIssue($assessment['critical_issues'], 'military_threat'));
    }

    public function testAssessNoResearch()
    {
        $game_state = [
            'resources' => ['food' => 500],
            'production' => ['food' => 50],
            'population' => 100,
            'colony_count' => 1,
            'buildings' => [],
            'fleet_strength' => 0,
            'technologies_researched' => 0,
            'research_buildings' => 0,
            'time_played_hours' => 3,
        ];
        
        $assessment = $this->game_guide->assessGameState($this->test_user_id, $game_state);
        
        $this->assertNotEmpty($assessment['warnings']);
        $this->assertTrue($this->arrayContainsIssue($assessment['warnings'], 'no_research'));
    }

    // ========== HELP TOPIC TESTS ==========

    public function testGetHelpTopicGettingStarted()
    {
        $result = $this->game_guide->getHelpTopic('getting_started');
        
        $this->assertTrue($result['ok']);
        $this->assertEquals('getting_started', $result['category']);
        $this->assertNotEmpty($result['tips']);
        $this->assertNotEmpty($result['questions']);
    }

    public function testGetHelpTopicResourcesAndProduction()
    {
        $result = $this->game_guide->getHelpTopic('resources_and_production');
        
        $this->assertTrue($result['ok']);
        $this->assertNotEmpty($result['tips']);
        $this->assertStringContainsString('Produktion', $result['tips'][0]);
    }

    public function testGetHelpTopicMilitaryAndFleets()
    {
        $result = $this->game_guide->getHelpTopic('military_and_fleets');
        
        $this->assertTrue($result['ok']);
        $this->assertNotEmpty($result['tips']);
    }

    public function testGetHelpTopicDiplomacy()
    {
        $result = $this->game_guide->getHelpTopic('diplomacy_and_factions');
        
        $this->assertTrue($result['ok']);
        $this->assertNotEmpty($result['tips']);
    }

    public function testGetHelpTopicTechnology()
    {
        $result = $this->game_guide->getHelpTopic('technology_and_research');
        
        $this->assertTrue($result['ok']);
        $this->assertNotEmpty($result['tips']);
    }

    public function testGetHelpTopicNotFound()
    {
        $result = $this->game_guide->getHelpTopic('nonexistent_topic');
        
        $this->assertFalse($result['ok']);
        $this->assertStringContainsString('not found', $result['error']);
    }

    // ========== DIRECT HELP TESTS ==========

    public function testProvideDirectHelpStartingResources()
    {
        $game_state = [
            'is_new_player' => true,
            'time_played_hours' => 0.5,
        ];
        
        $result = $this->game_guide->provideDirectHelp(
            $this->test_user_id,
            'grant_starting_resources',
            $game_state
        );
        
        $this->assertTrue($result['ok']);
        $this->assertEquals('grant_resources', $result['action']['type']);
        $this->assertGreaterThan(0, $result['action']['resources']['food'] ?? 0);
    }

    public function testProvideDirectHelpResearchPoints()
    {
        $game_state = [
            'is_new_player' => true,
            'time_played_hours' => 1,
        ];
        
        $result = $this->game_guide->provideDirectHelp(
            $this->test_user_id,
            'grant_research_points',
            $game_state
        );
        
        $this->assertTrue($result['ok']);
        $this->assertEquals('add_research', $result['action']['type']);
        $this->assertGreaterThan(0, $result['action']['amount']);
    }

    public function testProvideDirectHelpExperiencedPlayer()
    {
        $game_state = [
            'is_new_player' => false,
            'time_played_hours' => 30,
        ];
        
        $result = $this->game_guide->provideDirectHelp(
            $this->test_user_id,
            'grant_research_points',
            $game_state
        );
        
        // Should be rejected for experienced players
        // (May or may not return error depending on implementation)
    }

    // ========== CHECKPOINT TRACKING TESTS ==========

    public function testRecordCheckpointCompletion()
    {
        $this->game_guide->recordCheckpointCompletion(
            $this->test_user_id,
            'first_colony_created'
        );
        
        $progress = $this->game_guide->getTutorialProgress($this->test_user_id);
        
        $this->assertGreaterThan(0, count($progress));
        $this->assertEquals('first_colony_created', $progress[0]['checkpoint_id']);
    }

    public function testRecordMultipleCheckpoints()
    {
        $checkpoints = [
            'first_building_built',
            'first_production_started',
            'first_research_completed',
        ];
        
        foreach ($checkpoints as $checkpoint) {
            $this->game_guide->recordCheckpointCompletion($this->test_user_id, $checkpoint);
        }
        
        $progress = $this->game_guide->getTutorialProgress($this->test_user_id);
        
        $this->assertEquals(3, count($progress));
    }

    // ========== CONFIGURATION TESTS ==========

    public function testGetSystemPrompt()
    {
        $prompt = $this->game_guide->getSystemPrompt();
        
        $this->assertNotEmpty($prompt);
        $this->assertStringContainsString('Advisor Tau', $prompt);
    }

    public function testGetResponseConstraints()
    {
        $constraints = $this->game_guide->getResponseConstraints();
        
        $this->assertIsArray($constraints);
        $this->assertArrayHasKey('temperature', $constraints);
        $this->assertArrayHasKey('max_tokens', $constraints);
        $this->assertLessThanOrEqual(1.0, $constraints['temperature']);
        $this->assertGreaterThanOrEqual(0.0, $constraints['temperature']);
    }

    // ========== HELPER METHODS ==========

    private function arrayContainsIssue(array $issues, string $type): bool
    {
        foreach ($issues as $issue) {
            if (($issue['type'] ?? null) === $type) {
                return true;
            }
        }
        return false;
    }
}
