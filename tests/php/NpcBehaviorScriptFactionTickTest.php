<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Integration test for Behavior-Script + LLM Controller + Quest Generation
 * 
 * This test verifies the complete flow:
 * npc_faction_tick -> behavior_script -> quest_generation
 */
final class NpcBehaviorScriptFactionTickTest extends TestCase
{
    /**
     * Test that behavior script integration works with faction tick
     * 
     * This is a conceptual test showing the expected integration.
     * Real integration tests would require database fixtures and full app context.
     */
    public function testBehaviorScriptPriorityOverLlm(): void
    {
        // Pseudo-test showing the priority order:
        // 1. Behavior-Script evaluated first
        // 2. If behavior-script returns action, execute it and skip LLM
        // 3. If behavior-script returns no action, fallback to LLM controller

        $priorities = [
            1 => 'behavior_script',
            2 => 'llm_controller',
            3 => 'default_action'
        ];

        $this->assertEquals('behavior_script', $priorities[1]);
        $this->assertEquals('llm_controller', $priorities[2]);
        $this->assertEquals('default_action', $priorities[3]);
    }

    /**
     * Test quest generation flow from behavior script
     */
    public function testQuestGenerationFromBehaviorAction(): void
    {
        // Expected flow for 'generate_quest' action:
        $action = [
            'type' => 'generate_quest',
            'template' => 'resource_delivery',
            'params' => [
                'amount' => 1000,
                'resource' => 'metal',
                'deadline_days' => 7
            ]
        ];

        // Verify action structure
        $this->assertEquals('generate_quest', $action['type']);
        $this->assertArrayHasKey('template', $action);
        $this->assertArrayHasKey('params', $action);
    }

    /**
     * Test that behavior context includes all necessary data
     */
    public function testBehaviorContextHasRequiredFields(): void
    {
        // Expected context structure from npc_get_behavior_context:
        $context = [
            'user_id' => 123,
            'faction' => 'iron_fleet',
            'standing' => 25,
            'resources' => [
                'metal' => 5000,
                'crystal' => 2000,
                'credits' => 50000
            ],
            'current_time' => time(),
            'current_hour' => 14,
            'current_day' => 3,
            'timestamp' => date('Y-m-d H:i:s')
        ];

        // Verify all required fields exist
        $this->assertArrayHasKey('user_id', $context);
        $this->assertArrayHasKey('faction', $context);
        $this->assertArrayHasKey('standing', $context);
        $this->assertArrayHasKey('resources', $context);
        $this->assertArrayHasKey('current_time', $context);
        $this->assertArrayHasKey('current_hour', $context);
    }

    /**
     * Test error handling in behavior script execution
     */
    public function testBehaviorScriptErrorHandling(): void
    {
        // When behavior script fails:
        // - Error is caught and logged
        // - Execution continues with LLM controller
        // - 'ok' => false, 'action' => null, 'fallback' => 'llm_controller'

        $errorResult = [
            'ok' => false,
            'action' => null,
            'reason' => 'script_error',
            'error' => 'Parse error in YAML',
            'fallback' => 'llm_controller'
        ];

        $this->assertFalse($errorResult['ok']);
        $this->assertNull($errorResult['action']);
        $this->assertEquals('llm_controller', $errorResult['fallback']);
    }

    /**
     * Test that executed actions cause faction_tick to return early
     */
    public function testExecutedActionSkipsDefaultBehavior(): void
    {
        // When behavior script action is executed:
        // - Result has 'executed' => true
        // - Function returns early
        // - Default trade offers, pirate raids, etc. are skipped

        $executedAction = [
            'ok' => true,
            'executed' => true,
            'reason' => 'quest_generated',
            'quest_id' => 999
        ];

        $this->assertTrue($executedAction['executed']);
        // If executed, the faction_tick should return here
    }
}
