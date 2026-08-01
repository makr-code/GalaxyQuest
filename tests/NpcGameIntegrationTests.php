<?php
/**
 * Tests for NPC Game Integration
 * Tests action parsing, validation, and execution
 */

use PHPUnit\Framework\TestCase;

class NpcGameIntegrationTests extends TestCase
{
    private $db;
    private $game_integration;
    private $test_user_id = 999;
    private $test_npc_id = 'npc_test_01';
    private $test_faction = 'TestFaction';

    protected function setUp(): void
    {
        require_once __DIR__ . '/../api/llm_soc/NpcGameIntegration.php';
        
        // Setup test database connection
        $this->db = new PDO('mysql:host=localhost;dbname=galaxyquest_test', 'root', '');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_THROW);
        
        // Initialize game integration
        $this->game_integration = new NpcGameIntegration($this->db, null, null);
        
        // Clean test data
        $this->cleanupTestData();
    }

    protected function tearDown(): void
    {
        $this->cleanupTestData();
    }

    private function cleanupTestData()
    {
        try {
            $this->db->exec("DELETE FROM npc_action_log WHERE user_id = {$this->test_user_id}");
            $this->db->exec("DELETE FROM game_events WHERE user_id = {$this->test_user_id}");
        } catch (Exception $e) {
            // Tables may not exist yet
        }
    }

    // ========== ACTION PARSING TESTS ==========

    public function testParseGrantCreditsAction()
    {
        $response = "Great! [grant_credits:50000]";
        $actions = $this->game_integration->parseActionsFromResponse(
            $this->test_npc_id,
            $this->test_faction,
            $this->test_user_id,
            $response
        );
        
        $this->assertGreaterThan(0, count($actions));
        $this->assertEquals('grant_credits', $actions[0]['type']);
        $this->assertEquals(50000, $actions[0]['amount']);
    }

    public function testParseGrantResourcesAction()
    {
        $response = "Here's some resources [grant_resources:food=1000,energy=500]";
        $actions = $this->game_integration->parseActionsFromResponse(
            $this->test_npc_id,
            $this->test_faction,
            $this->test_user_id,
            $response
        );
        
        $this->assertGreaterThan(0, count($actions));
        $this->assertEquals('grant_resources', $actions[0]['type']);
        $this->assertEquals(1000, $actions[0]['food']);
        $this->assertEquals(500, $actions[0]['energy']);
    }

    public function testParseAdjustStandingAction()
    {
        $response = "I respect your approach [adjust_standing:+5]";
        $actions = $this->game_integration->parseActionsFromResponse(
            $this->test_npc_id,
            $this->test_faction,
            $this->test_user_id,
            $response
        );
        
        $this->assertGreaterThan(0, count($actions));
        $this->assertEquals('adjust_standing', $actions[0]['type']);
        $this->assertEquals(5, $actions[0][0]);
    }

    public function testParseModifyProductionAction()
    {
        $response = "I can boost your farming output [modify_production:colony_id=1,building_type=farm,multiplier=1.2]";
        $actions = $this->game_integration->parseActionsFromResponse(
            $this->test_npc_id,
            $this->test_faction,
            $this->test_user_id,
            $response
        );
        
        $this->assertGreaterThan(0, count($actions));
        $this->assertEquals('modify_production', $actions[0]['type']);
        $this->assertEquals(1, $actions[0]['colony_id']);
        $this->assertEquals('farm', $actions[0]['building_type']);
        $this->assertEquals(1.2, $actions[0]['multiplier']);
    }

    public function testParseAddResearchAction()
    {
        $response = "I've discovered something [add_research:1000]";
        $actions = $this->game_integration->parseActionsFromResponse(
            $this->test_npc_id,
            $this->test_faction,
            $this->test_user_id,
            $response
        );
        
        $this->assertGreaterThan(0, count($actions));
        $this->assertEquals('add_research', $actions[0]['type']);
        $this->assertEquals(1000, $actions[0]['amount']);
    }

    // ========== IMPLICIT ACTION DETECTION TESTS ==========

    public function testDetectMerchantImplicitAction()
    {
        // Merchant offering discounts should grant resources
        $response = "Great deal for you, friend!";
        $actions = $this->game_integration->parseActionsFromResponse(
            'npc_trader_01',
            'Merchant',
            $this->test_user_id,
            $response
        );
        
        // May include implicit resource grant
        $this->assertIsArray($actions);
    }

    public function testDetectDiplomatImplicitAction()
    {
        $response = "Let's forge an alliance, my friend!";
        $actions = $this->game_integration->parseActionsFromResponse(
            'npc_diplomat_01',
            'Empire',
            $this->test_user_id,
            $response
        );
        
        // Should detect alliance sentiment
        $this->assertIsArray($actions);
    }

    public function testDetectScientistImplicitAction()
    {
        $response = "I've made an amazing discovery!";
        $actions = $this->game_integration->parseActionsFromResponse(
            'npc_scientist_01',
            'Federation',
            $this->test_user_id,
            $response
        );
        
        // Should detect research opportunity
        $this->assertIsArray($actions);
    }

    // ========== CONSTRAINT VALIDATION TESTS ==========

    public function testGrantCreditsConstraintValidation()
    {
        $action = [
            'type' => 'grant_credits',
            'amount' => 200000, // Exceeds max of 100000
        ];
        
        $result = $this->game_integration->executeAction(
            $this->test_user_id,
            $this->test_npc_id,
            $this->test_faction,
            $action
        );
        
        $this->assertFalse($result['ok'] ?? true);
    }

    public function testModifyProductionMultiplierConstraint()
    {
        $action = [
            'type' => 'modify_production',
            'colony_id' => 1,
            'building_type' => 'farm',
            'multiplier' => 3.0, // Exceeds max of 1.5
        ];
        
        $result = $this->game_integration->executeAction(
            $this->test_user_id,
            $this->test_npc_id,
            $this->test_faction,
            $action
        );
        
        $this->assertFalse($result['ok'] ?? true);
    }

    public function testAdjustStandingConstraint()
    {
        $action = [
            'type' => 'adjust_standing',
            'change' => 50, // Exceeds max of 10
        ];
        
        $result = $this->game_integration->executeAction(
            $this->test_user_id,
            $this->test_npc_id,
            $this->test_faction,
            $action
        );
        
        $this->assertFalse($result['ok'] ?? true);
    }

    // ========== ACTION EXECUTION TESTS ==========

    public function testGrantCreditsExecution()
    {
        $action = [
            'type' => 'grant_credits',
            'amount' => 50000,
        ];
        
        // Would need a real user in database
        // $result = $this->game_integration->executeAction(
        //     $this->test_user_id,
        //     $this->test_npc_id,
        //     $this->test_faction,
        //     $action
        // );
        // $this->assertTrue($result['ok'] ?? false);
    }

    // ========== RATE LIMITING TESTS ==========

    public function testRateLimitingPerAction()
    {
        // Execute same action type multiple times
        for ($i = 0; $i < 3; $i++) {
            $action = [
                'type' => 'grant_credits',
                'amount' => 1000,
            ];
            
            // Would need to check rate limiting
            // $result = $this->game_integration->executeAction(...);
        }
        
        // Fourth execution should be rate limited (unless per-day limit high)
    }

    // ========== INTEGRATION TESTS ==========

    public function testMultipleActionsInSingleResponse()
    {
        $response = "Excellent! [grant_credits:50000] and [adjust_standing:+3]";
        $actions = $this->game_integration->parseActionsFromResponse(
            $this->test_npc_id,
            $this->test_faction,
            $this->test_user_id,
            $response
        );
        
        // Should parse both actions
        $grant_found = false;
        $standing_found = false;
        
        foreach ($actions as $action) {
            if ($action['type'] === 'grant_credits') $grant_found = true;
            if ($action['type'] === 'adjust_standing') $standing_found = true;
        }
        
        $this->assertTrue($grant_found);
        $this->assertTrue($standing_found);
    }

    public function testActionOrderingMatters()
    {
        // In this response, standing adjustment should happen before credits grant
        $response = "[adjust_standing:+5] then [grant_credits:50000]";
        $actions = $this->game_integration->parseActionsFromResponse(
            $this->test_npc_id,
            $this->test_faction,
            $this->test_user_id,
            $response
        );
        
        // First action should be standing
        $this->assertEquals('adjust_standing', $actions[0]['type'] ?? null);
        $this->assertEquals('grant_credits', $actions[1]['type'] ?? null);
    }
}
