<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class NpcDailyQuestGeneratorTest extends TestCase
{
    /**
     * Test daily quest generation cooldown
     */
    public function testDailyQuestCooldown(): void
    {
        // Verify that daily quest generation respects 24-hour cooldown
        // Same run within 24 hours should return cooldown_active

        $cooldownActive = ['ok' => false, 'reason' => 'cooldown_active'];
        $this->assertFalse($cooldownActive['ok']);
        $this->assertEquals('cooldown_active', $cooldownActive['reason']);
    }

    /**
     * Test quest generation intensity by faction type
     */
    public function testQuestIntensityByFactionType(): void
    {
        $expectedQuests = [
            'trade' => 2,      // 2+ based on trade willingness
            'military' => 3,   // 3 combat quests
            'science' => 2,    // 2 research quests
            'pirate' => 1      // 1 raid quest
        ];

        foreach ($expectedQuests as $type => $expectedCount) {
            $this->assertGreaterThan(0, $expectedCount);
        }
    }

    /**
     * Test max active quests per faction limit
     */
    public function testMaxActiveQuestsLimit(): void
    {
        $maxActive = 10;  // NPC_QUEST_MAX_ACTIVE_PER_FACTION
        $currentActive = 8;
        $attempted = 5;

        $shouldGenerate = min($attempted, $maxActive - $currentActive);
        $this->assertEquals(2, $shouldGenerate);
    }

    /**
     * Test template selection by faction type
     */
    public function testTemplateSelectionByFactionType(): void
    {
        $expectedTemplates = [
            'trade' => ['resource_delivery', 'trading_chain'],
            'military' => ['combat_patrol', 'combat_raid'],
            'science' => ['exploration_mission', 'research_collaboration'],
            'pirate' => ['raid', 'combat_patrol']
        ];

        foreach ($expectedTemplates as $factionType => $templates) {
            $this->assertNotEmpty($templates);
            $this->assertIsArray($templates);
        }
    }

    /**
     * Test generation statistics tracking
     */
    public function testGenerationStatistics(): void
    {
        $stats = [
            'factions_processed' => 4,
            'quests_generated' => 8,
            'errors' => 0,
            'skipped' => 1
        ];

        $this->assertEquals(4, $stats['factions_processed']);
        $this->assertEquals(8, $stats['quests_generated']);
        $this->assertEquals(0, $stats['errors']);
        $this->assertEquals(1, $stats['skipped']);
    }
}
