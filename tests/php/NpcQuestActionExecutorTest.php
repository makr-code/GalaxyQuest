<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

// Mock database for testing
class MockPDO {
    public $lastInsertId = 0;
    private $questData = [];

    public function prepare($query) {
        return new MockPDOStatement($this);
    }

    public function lastInsertId() {
        return ++$this->lastInsertId;
    }
}

class MockPDOStatement {
    private $db;

    public function __construct(MockPDO $db) {
        $this->db = $db;
    }

    public function execute($params = []) {
        return true;
    }

    public function fetch($mode = null) {
        return [];
    }

    public function fetchColumn() {
        return null;
    }

    public function rowCount() {
        return 0;
    }
}

final class NpcQuestActionExecutorTest extends TestCase
{
    // These tests verify the quest action executor logic
    // Full integration tests would require a real database

    public function testSubstitutePlaceholders(): void
    {
        // Test placeholder substitution
        $template = "The {faction_name} requires {amount} units of {resource}";
        $params = [
            'faction_name' => 'Iron Fleet',
            'amount' => 1000,
            'resource' => 'metal'
        ];

        $result = npc_substitute_placeholders($template, $params);
        $this->assertStringContainsString('Iron Fleet', $result);
        $this->assertStringContainsString('1000', $result);
        $this->assertStringContainsString('metal', $result);
    }

    public function testCalculateQuestDifficulty(): void
    {
        $easyTemplate = ['difficulty_modifier' => 0.8];
        $mediumTemplate = ['difficulty_modifier' => 1.0];
        $hardTemplate = ['difficulty_modifier' => 1.2];

        $this->assertEquals('easy', npc_calculate_quest_difficulty($easyTemplate, []));
        $this->assertEquals('medium', npc_calculate_quest_difficulty($mediumTemplate, []));
        $this->assertEquals('hard', npc_calculate_quest_difficulty($hardTemplate, []));
    }

    public function testCalculateQuestRewards(): void
    {
        $rewardTemplate = [
            'base_metal' => 500,
            'base_standing' => 5,
            'multipliers' => [
                'by_amount' => 0.001
            ]
        ];

        $params = ['amount' => 2000];

        $rewards = npc_calculate_quest_rewards($rewardTemplate, $params);

        $this->assertArrayHasKey('metal', $rewards);
        // base_metal (500) + (amount * by_amount) = 500 + 2 = 502
        $this->assertEquals(502, $rewards['metal']);
        $this->assertEquals(5, $rewards['standing']);
    }

    public function testSubstitutePlaceholdersJson(): void
    {
        $data = [
            'location' => '{faction_name}_headquarters',
            'amount' => 1000,
            'nested' => [
                'resource' => '{resource}'
            ]
        ];

        $params = [
            'faction_name' => 'Iron Fleet',
            'resource' => 'metal'
        ];

        $result = npc_substitute_placeholders_json($data, $params);

        $this->assertStringContainsString('Iron Fleet', $result['location']);
        $this->assertEquals('metal', $result['nested']['resource']);
        $this->assertEquals(1000, $result['amount']);
    }
}

// These need to be included from the actual files
require_once __DIR__ . '/../../api/npc_quest_action_executor.php';
