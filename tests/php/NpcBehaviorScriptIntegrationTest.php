<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class NpcBehaviorScriptIntegrationTest extends TestCase
{
    private NpcBehaviorScript $script;

    protected function setUp(): void
    {
        $this->script = new NpcBehaviorScript();
    }

    public function testCompleteWorkflowWithQuestGeneration(): void
    {
        $yaml = <<<'YAML'
behavior: "daily_quest_generator"
personality_key: "iron_fleet_trader"

conditions:
  - type: "standing_threshold"
    comparison: ">="
    value: 5
  - type: "time_window"
    start_hour: 6
    end_hour: 22

actions:
  - type: "generate_quest"
    template: "resource_delivery"
    probability: 0.7
    params:
      amount: 500
      resource: "metal"
      deadline_days: 7

fallback: "none"
YAML;

        $this->script->parse($yaml);
        $this->assertTrue($this->script->isParsed());

        $context = [
            'faction_standing' => 10,
            'user_credits' => 5000,
            'current_hour' => 14,
            'user_id' => 123,
            'faction' => 'iron_fleet'
        ];

        $conditions = $this->script->getConditions();
        $this->assertNotEmpty($conditions);
        $this->assertTrue($this->script->evaluateConditions($context));

        $action = $this->script->selectAction($context);
        $this->assertNotNull($action);
        $this->assertEquals('generate_quest', $action['type']);
    }

    public function testPersonalityModifiersAffectQuestParameters(): void
    {
        $yaml = <<<'YAML'
behavior: "aggressive_expansion"
personality_key: "militaristic"

conditions:
  - type: "faction_count_threshold"
    comparison: ">"
    value: 100

actions:
  - type: "generate_quest"
    template: "combat_patrol"
    probability: 0.5
    params:
      difficulty_scale: 1.0
      reward_standing: 10
    personality_modifier: "aggression_x1_5"

fallback: "random"
YAML;

        $this->script->parse($yaml);
        $context = ['faction_count' => 150];

        $this->assertTrue($this->script->evaluateConditions($context));

        $action = $this->script->selectAction($context);
        $this->assertNotNull($action);

        // Personality modifier should be present
        $this->assertArrayHasKey('personality_modifier', $action);
        $this->assertEquals('aggression_x1_5', $action['personality_modifier']);
    }

    public function testMultipleActionsWithProbabilityWeighting(): void
    {
        $yaml = <<<'YAML'
behavior: "mixed_response"

conditions:
  - type: "always_true"

actions:
  - type: "generate_quest"
    probability: 0.4
    template: "trading_chain"
  - type: "send_message"
    probability: 0.3
    subject: "Greeting"
  - type: "raid"
    probability: 0.3
    target_faction: "rivals"

fallback: "none"
YAML;

        $this->script->parse($yaml);
        $actions = $this->script->getActions();
        $this->assertEquals(3, count($actions));

        // With seeded RNG, verify action selection is deterministic
        $seed = 42;
        mt_srand($seed);
        $action1 = $this->script->selectAction(['always' => true]);

        mt_srand($seed);
        $action2 = $this->script->selectAction(['always' => true]);

        $this->assertEquals($action1['type'] ?? null, $action2['type'] ?? null);
    }

    public function testFallbackBehavior(): void
    {
        $yaml = <<<'YAML'
behavior: "strict_conditions"

conditions:
  - type: "faction_standing_threshold"
    comparison: ">"
    value: 100

actions:
  - type: "generate_quest"
    probability: 1.0

fallback: "random"
YAML;

        $this->script->parse($yaml);

        // Conditions not met
        $context = ['faction_standing' => 50];
        $this->assertFalse($this->script->evaluateConditions($context));

        $fallback = $this->script->getFallback();
        $this->assertEquals('random', $fallback);
    }

    public function testEmptyActionsHandling(): void
    {
        $yaml = <<<'YAML'
behavior: "no_actions"

conditions:
  - type: "always_true"

actions: []

fallback: "none"
YAML;

        $this->script->parse($yaml);
        $this->assertTrue($this->script->evaluateConditions(['x' => 1]));

        $action = $this->script->selectAction(['x' => 1]);
        $this->assertNull($action);
    }
}

require_once __DIR__ . '/../../lib/NpcBehaviorScript.php';
