<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PDO;
use PHPUnit\Framework\TestCase;
use RuntimeException;

require_once __DIR__ . '/../../api/npc_behavior_script_executor.php';
require_once __DIR__ . '/../../api/npc_quest_contextual_trigger.php';

final class NpcContextualQuestCanonicalSchemaTest extends TestCase
{
    private PDO $db;

    protected function setUp(): void
    {
        if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
            self::markTestSkipped('PDO SQLite is required for contextual quest schema tests.');
        }

        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->db->sqliteCreateFunction('NOW', static fn (): string => date('Y-m-d H:i:s'));
        $this->db->exec(<<<'SQL'
            CREATE TABLE users (id INTEGER PRIMARY KEY, credits INTEGER NOT NULL);
            CREATE TABLE npc_factions (id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL);
            CREATE TABLE diplomacy (
                user_id INTEGER NOT NULL,
                faction_id INTEGER NOT NULL,
                standing INTEGER NOT NULL
            );
            CREATE TABLE diplomacy_history (
                user_id INTEGER NOT NULL,
                faction_id INTEGER NOT NULL,
                standing_delta INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE colonies (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                body_id INTEGER NOT NULL,
                metal NUMERIC NOT NULL,
                crystal NUMERIC NOT NULL,
                deuterium NUMERIC NOT NULL,
                rare_earth NUMERIC NOT NULL
            );
            CREATE TABLE battle_reports (
                id INTEGER PRIMARY KEY,
                attacker_id INTEGER NOT NULL,
                defender_id INTEGER NOT NULL,
                body_id INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE quest_templates (
                id INTEGER PRIMARY KEY,
                code TEXT NOT NULL,
                title_template TEXT NOT NULL,
                description_template TEXT NOT NULL,
                quest_type TEXT NOT NULL,
                requirements_template TEXT,
                reward_template TEXT,
                difficulty_modifier NUMERIC,
                default_params TEXT
            );
            CREATE TABLE faction_quests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                faction_id INTEGER NOT NULL,
                code TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                quest_type TEXT NOT NULL,
                requirements_json TEXT NOT NULL,
                template_code TEXT,
                reward_metal INTEGER NOT NULL DEFAULT 0,
                reward_crystal INTEGER NOT NULL DEFAULT 0,
                reward_deuterium INTEGER NOT NULL DEFAULT 0,
                reward_rare_earth INTEGER NOT NULL DEFAULT 0,
                reward_dark_matter INTEGER NOT NULL DEFAULT 0,
                reward_rank_points INTEGER NOT NULL DEFAULT 0,
                reward_standing INTEGER NOT NULL DEFAULT 10,
                min_standing INTEGER NOT NULL DEFAULT -100,
                difficulty TEXT NOT NULL DEFAULT 'medium',
                repeatable INTEGER NOT NULL DEFAULT 0,
                generated_by_npc INTEGER NOT NULL DEFAULT 0,
                generated_timestamp TEXT
            );
            CREATE TABLE npc_quest_generation_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                faction_id INTEGER NOT NULL,
                user_id INTEGER,
                quest_id INTEGER,
                trigger_reason TEXT,
                trigger_context_json TEXT,
                chain_parent_id INTEGER,
                chain_position INTEGER NOT NULL DEFAULT 0,
                generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            SQL);
    }

    public function testBehaviorContextUsesUserCreditsDiplomacyAndColonyStockpiles(): void
    {
        $this->db->exec("INSERT INTO users VALUES (7, 1200)");
        $this->db->exec("INSERT INTO npc_factions VALUES (3, 'guild', 'Trade Guild')");
        $this->db->exec("INSERT INTO diplomacy VALUES (7, 3, 18)");
        $this->db->exec("INSERT INTO colonies VALUES (1, 7, 100, 400, 20, 8, 2)");
        $this->db->exec("INSERT INTO colonies VALUES (2, 7, 101, 600, 30, 12, 4)");

        $context = \npc_get_behavior_context($this->db, 7, 'guild');

        self::assertSame(18, $context['standing']);
        self::assertSame(18, $context['faction_standing']);
        self::assertSame([
            'credits' => 1200,
            'metal' => 1000,
            'crystal' => 50,
            'deuterium' => 20,
            'rare_earth' => 6,
        ], $context['resources']);
    }

    public function testContextualTriggersUsePersistedCanonicalEvents(): void
    {
        $this->db->exec("INSERT INTO users VALUES (7, 1200)");
        $this->db->exec("INSERT INTO npc_factions VALUES (3, 'guild', 'Trade Guild')");
        $this->db->exec("INSERT INTO colonies VALUES (1, 7, 100, 400, 20, 8, 2)");
        $this->db->exec("INSERT INTO diplomacy_history VALUES (7, 3, 11, '" . date('Y-m-d H:i:s') . "')");
        $this->db->exec("INSERT INTO battle_reports VALUES (1, 9, 7, 100, '" . date('Y-m-d H:i:s') . "')");

        self::assertTrue(\npc_check_low_resources($this->db, 7));
        self::assertTrue(\npc_check_standing_shift($this->db, 7, 'guild'));
        self::assertTrue(\npc_check_colony_threat($this->db, 7));
        self::assertFalse(\npc_check_trade_route_disruption($this->db, 7));

        $this->db->exec('UPDATE colonies SET metal = 600 WHERE id = 1');
        self::assertFalse(\npc_check_low_resources($this->db, 7));
    }

    public function testContextualQuestWritesCanonicalQuestAndGenerationLogAtomically(): void
    {
        $this->seedFactionAndTemplates();

        $questId = \npc_quest_contextual_trigger_create($this->db, 7, 'guild', 'low_resources');
        $quest = $this->db->query('SELECT * FROM faction_quests WHERE id = ' . $questId)->fetch(PDO::FETCH_ASSOC);
        $log = $this->db->query('SELECT * FROM npc_quest_generation_log WHERE quest_id = ' . $questId)->fetch(PDO::FETCH_ASSOC);

        self::assertSame('deliver', $quest['quest_type']);
        self::assertSame('resource_delivery', $quest['template_code']);
        self::assertSame(['resource' => 'metal', 'amount' => 500], json_decode($quest['requirements_json'], true));
        self::assertSame(500, (int) $quest['reward_metal']);
        self::assertSame('contextual_trigger:low_resources', $log['trigger_reason']);
        self::assertSame($questId, (int) $log['quest_id']);
        self::assertNull(\npc_quest_contextual_trigger_create($this->db, 7, 'guild', 'trade_route'));
        self::assertNull(\npc_quest_contextual_trigger_create($this->db, 7, 'guild', 'standing_shift'));
    }

    public function testColonyThreatUsesTheCanonicalCombatQuestType(): void
    {
        $this->seedFactionAndTemplates();

        $questId = \npc_quest_contextual_trigger_create($this->db, 7, 'guild', 'colony_threat');
        $quest = $this->db->query('SELECT * FROM faction_quests WHERE id = ' . $questId)->fetch(PDO::FETCH_ASSOC);

        self::assertSame('kill', $quest['quest_type']);
        self::assertSame('combat_patrol', $quest['template_code']);
        self::assertSame(['count' => 1], json_decode($quest['requirements_json'], true));
    }

    public function testQuestAndAuditLogRollbackTogetherWhenLogWriteFails(): void
    {
        $this->seedFactionAndTemplates();
        $this->db->exec('DROP TABLE npc_quest_generation_log');
        $this->db->beginTransaction();

        try {
            \npc_quest_contextual_trigger_create($this->db, 7, 'guild', 'low_resources');
            self::fail('Contextual generation must report an audit-log write failure.');
        } catch (RuntimeException) {
            self::assertTrue($this->db->inTransaction());
            self::assertSame(0, (int) $this->db->query('SELECT COUNT(*) FROM faction_quests')->fetchColumn());
        } finally {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
        }
    }

    private function seedFactionAndTemplates(): void
    {
        $this->db->exec("INSERT INTO npc_factions VALUES (3, 'guild', 'Trade Guild')");
        $this->db->exec(<<<'SQL'
            INSERT INTO quest_templates
                (id, code, title_template, description_template, quest_type, requirements_template, reward_template, difficulty_modifier, default_params)
            VALUES
                (1, 'resource_delivery', 'Deliver {amount} {resource} to {faction_name}',
                 'Deliver the shipment to {location}.', 'deliver',
                 '{"resource":"{resource}","amount":"{amount}"}',
                 '{"base_metal":500,"base_standing":5}', 1.0, '{}'),
                (2, 'combat_patrol', 'Eliminate {enemy_count} {enemy_type}',
                 'Protect {location}; threat: {threat_level}.', 'combat',
                 '{"count":"{enemy_count}"}',
                 '{"base_deuterium":400,"base_standing":8}', 1.2, '{}')
            SQL);
    }
}
