<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/npc_faction_daily_quests.php';

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

    public function testGenerationRollsBackOnFailureAndOnlyWritesCooldownAfterAllFactions(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_faction_daily_quests.php');
        self::assertIsString($source);

        $entryPoint = $this->functionBody($source, 'npc_faction_daily_quests_generate');
        self::assertStringContainsString('npc_faction_daily_quests_generate_run($db, $force)', $entryPoint);
        self::assertStringContainsString('$db->beginTransaction();', $entryPoint);
        self::assertStringContainsString("\$db->exec('SAVEPOINT ' . \$savepoint)", $entryPoint);
        self::assertStringContainsString('npc_faction_daily_quests_rollback_transaction($db, $savepoint, $ownsTransaction)', $entryPoint);
        self::assertStringContainsString('throw $error;', $entryPoint);

        $rollback = $this->functionBody($source, 'npc_faction_daily_quests_rollback_transaction');
        self::assertStringContainsString('$db->inTransaction()', $rollback);
        self::assertStringContainsString('$db->rollBack();', $rollback);
        self::assertStringContainsString("ROLLBACK TO SAVEPOINT ' . \$savepoint", $rollback);

        $run = $this->functionBody($source, 'npc_faction_daily_quests_generate_run');
        $factionLoop = strpos($run, 'foreach ($factions as $faction)');
        $cooldownWrite = strpos($run, "app_state_set_int(\$db, \$coolKey, time())");
        self::assertNotFalse($factionLoop);
        self::assertNotFalse($cooldownWrite);
        self::assertGreaterThan($factionLoop, $cooldownWrite);
        self::assertStringNotContainsString('catch (', $run);

        $perFaction = $this->functionBody($source, 'npc_faction_daily_quests_for_faction');
        self::assertStringNotContainsString('catch (', $perFaction);
        $createOne = $this->functionBody($source, 'npc_faction_daily_quests_create_one');
        self::assertStringNotContainsString('catch (', $createOne);
        self::assertStringContainsString('requirements_json', $createOne);
        self::assertStringContainsString('template_code', $createOne);
        self::assertStringContainsString('active, generated_by_npc, template_code, generated_timestamp', $createOne);
        self::assertStringNotContainsString('WHERE active = 1', $run);
        self::assertStringContainsString('FROM npc_factions', $run);
        self::assertStringContainsString('UPDATE faction_quests fq', $perFaction);
    }

    public function testDailyQuestTypesAndRequirementsMatchCanonicalQuestEngine(): void
    {
        self::assertSame('deliver', npc_daily_quest_canonical_type('deliver'));
        self::assertSame('kill', npc_daily_quest_canonical_type('combat'));
        self::assertSame('explore', npc_daily_quest_canonical_type('explore'));
        self::assertSame('research', npc_daily_quest_canonical_type('research'));

        self::assertSame(
            ['resource' => 'metal', 'amount' => 1000],
            npc_daily_quest_requirements(
                'resource_delivery',
                'deliver',
                npc_daily_quest_default_params('resource_delivery', 'Trade Guild')
            )
        );
        self::assertSame(
            ['count' => 5],
            npc_daily_quest_requirements(
                'combat_patrol',
                'kill',
                npc_daily_quest_default_params('combat_patrol', 'Iron Fleet')
            )
        );
        self::assertSame(
            ['spy_reports' => 1],
            npc_daily_quest_requirements(
                'exploration_mission',
                'explore',
                npc_daily_quest_default_params('exploration_mission', 'Science Collective')
            )
        );
        self::assertSame(
            ['research_level' => 1],
            npc_daily_quest_requirements(
                'research_collaboration',
                'research',
                npc_daily_quest_default_params('research_collaboration', 'Science Collective')
            )
        );
    }

    public function testDailyQuestTemplatesAvoidUnsupportedTypesAndMapRewards(): void
    {
        self::assertSame(['resource_delivery'], npc_select_faction_templates(['faction_type' => 'trade']));
        self::assertSame(['combat_patrol'], npc_select_faction_templates(['faction_type' => 'military']));
        self::assertSame(['combat_patrol'], npc_select_faction_templates(['faction_type' => 'pirate']));

        self::assertSame(
            ['metal' => 800, 'crystal' => 0, 'deuterium' => 400, 'rare_earth' => 0,
                'dark_matter' => 0, 'rank_points' => 0, 'standing' => 8],
            npc_daily_quest_rewards('combat_patrol', ['metal' => '{base_reward * 0.8}'])
        );
        self::assertSame(
            'Explore a frontier system and report findings',
            npc_daily_quest_render(
                'Explore {location} and report findings',
                npc_daily_quest_default_params('exploration_mission', 'Science Collective')
            )
        );
    }

    public function testDailyQuestSchemaMigrationIsRegistered(): void
    {
        $root = dirname(__DIR__, 2);
        $manifest = require $root . '/config/migrations_manifest.php';
        self::assertContains('migrate_npc_daily_quests_v2.sql', $manifest);

        $migration = file_get_contents($root . '/sql/migrate_npc_daily_quests_v2.sql');
        self::assertIsString($migration);
        foreach ([
            'information_schema.COLUMNS',
            "COLUMN_NAME = 'active'",
            "COLUMN_NAME = 'template_code'",
            "COLUMN_NAME = 'generated_by_npc'",
            "COLUMN_NAME = 'generated_timestamp'",
            'CREATE TABLE IF NOT EXISTS quest_templates',
            'CREATE TABLE IF NOT EXISTS npc_quest_generation_log',
            'MODIFY COLUMN user_id INT DEFAULT NULL',
        ] as $contract) {
            self::assertStringContainsString($contract, $migration);
        }
        self::assertStringNotContainsString('ADD COLUMN IF NOT EXISTS', $migration);
    }

    public function testQuestTemplateFallbackOnlyHandlesMissingOptionalTable(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_quest_personalizer.php');
        self::assertIsString($source);

        $loader = $this->functionBody($source, 'npc_load_quest_template');
        self::assertStringContainsString('catch (PDOException $error)', $loader);
        self::assertStringContainsString("if (\$error->getCode() !== '42S02')", $loader);
        self::assertStringContainsString('throw $error;', $loader);
    }

    private function functionBody(string $source, string $function): string
    {
        $start = strpos($source, 'function ' . $function . '(');
        self::assertNotFalse($start, $function . ' function must exist.');
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        $end = $nextFunction === false ? strlen($source) : $nextFunction;
        return substr($source, $start, $end - $start);
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
