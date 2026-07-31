<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/NpcBehaviorScript.php';

final class NpcBehaviorScriptTest extends TestCase
{
    private NpcBehaviorScript $script;

    protected function setUp(): void
    {
        $this->script = new NpcBehaviorScript();
    }

    public function testParseSimpleYaml(): void
    {
        $yaml = <<<'YAML'
behavior: "test_behavior"
personality_key: "aggressive"
conditions:
  - type: "faction_standing_threshold"
    operator: ">="
    value: 10
actions:
  - type: "trade_offer"
    probability: 0.8
fallback: "none"
YAML;

        $this->script->parse($yaml);
        
        $this->assertEquals('test_behavior', $this->script->getBehavior());
        $this->assertEquals('aggressive', $this->script->getPersonalityKey());
        $this->assertEquals('none', $this->script->getFallback());
    }

    public function testParseWithQuestAction(): void
    {
        $yaml = <<<'YAML'
behavior: "daily_strategy"
conditions: []
actions:
  - type: "generate_quest"
    quest_template: "resource_delivery"
    target_resource: "metal"
    amount: 1000
    probability: 0.7
fallback: "llm"
YAML;

        $this->script->parse($yaml);
        $actions = $this->script->getActions();
        
        $this->assertCount(1, $actions);
        $this->assertEquals('generate_quest', $actions[0]['type']);
        $this->assertEquals('resource_delivery', $actions[0]['quest_template']);
        $this->assertEquals(0.7, $actions[0]['probability']);
    }

    public function testEvaluateConditionsAllPass(): void
    {
        $yaml = <<<'YAML'
behavior: "test"
conditions:
  - type: "faction_standing_threshold"
    operator: ">="
    value: 10
  - type: "resource_available"
    resource: "credits"
    min_value: 100
actions: []
fallback: "none"
YAML;

        $this->script->parse($yaml);
        
        $context = [
            'faction_standing' => 15,
            'resources' => ['credits' => 500],
        ];
        
        $this->assertTrue($this->script->evaluateConditions($context));
    }

    public function testEvaluateConditionsFail(): void
    {
        $yaml = <<<'YAML'
behavior: "test"
conditions:
  - type: "faction_standing_threshold"
    operator: ">="
    value: 100
actions: []
fallback: "none"
YAML;

        $this->script->parse($yaml);
        
        $context = ['faction_standing' => 50];
        
        $this->assertFalse($this->script->evaluateConditions($context));
    }

    public function testSelectActionWithProbability(): void
    {
        $yaml = <<<'YAML'
behavior: "test"
conditions: []
actions:
  - type: "trade_offer"
    probability: 1.0
  - type: "raid"
    probability: 0.0
fallback: "none"
YAML;

        $this->script->parse($yaml);
        
        $action = $this->script->selectAction([]);
        
        // With probability 1.0 on first, 0.0 on second, first should be selected
        $this->assertNotNull($action);
        $this->assertEquals('trade_offer', $action['type']);
    }

    public function testSelectActionReturnsNull(): void
    {
        $yaml = <<<'YAML'
behavior: "test"
conditions: []
actions: []
fallback: "none"
YAML;

        $this->script->parse($yaml);
        
        $action = $this->script->selectAction([]);
        
        $this->assertNull($action);
    }

    public function testApplyPersonalityModifiers(): void
    {
        $yaml = <<<'YAML'
behavior: "test"
conditions: []
actions:
  - type: "raid"
    probability: 0.5
    intensity: 1.0
    personality_modifier: "aggression_boost"
fallback: "none"
YAML;

        $this->script->parse($yaml);
        
        $action = $this->script->getActions()[0];
        $personality = ['aggression' => 1.5];
        
        $modified = $this->script->applyPersonalityModifiers($action, $personality);
        
        $this->assertArrayHasKey('personality_applied', $modified);
        $this->assertEquals('aggression_boost', $modified['personality_applied']);
        // Probability should be boosted: 0.5 * 1.5 = 0.75
        $this->assertEqualsWithDelta(0.75, $modified['probability'], 0.01);
    }

    public function testStandingThresholdOperators(): void
    {
        $testCases = [
            ['operator' => '>=', 'standing' => 10, 'threshold' => 10, 'expected' => true],
            ['operator' => '>', 'standing' => 10, 'threshold' => 10, 'expected' => false],
            ['operator' => '<=', 'standing' => 10, 'threshold' => 10, 'expected' => true],
            ['operator' => '<', 'standing' => 10, 'threshold' => 10, 'expected' => false],
            ['operator' => '==', 'standing' => 10, 'threshold' => 10, 'expected' => true],
        ];

        foreach ($testCases as $case) {
            $yaml = <<<YAML
behavior: "test"
conditions:
  - type: "faction_standing_threshold"
    operator: "{$case['operator']}"
    value: {$case['threshold']}
actions: []
fallback: "none"
YAML;

            $this->script->parse($yaml);
            $result = $this->script->evaluateConditions(['faction_standing' => $case['standing']]);
            
            $this->assertEquals(
                $case['expected'],
                $result,
                "Operator {$case['operator']} failed: standing={$case['standing']}, threshold={$case['threshold']}"
            );
        }
    }

    public function testThrowsOnMissingBehavior(): void
    {
        $this->expectException(\RuntimeException::class);
        
        $yaml = "conditions: []\nactions: []";
        $this->script->parse($yaml);
    }

    public function testEmptyConditionsPass(): void
    {
        $yaml = <<<'YAML'
behavior: "test"
conditions: []
actions: []
fallback: "none"
YAML;

        $this->script->parse($yaml);
        
        $this->assertTrue($this->script->evaluateConditions([]));
    }
}
