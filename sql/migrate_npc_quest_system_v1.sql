-- GalaxyQuest migration: NPC Quest Generation System v1
--
-- Adds infrastructure for:
-- 1. Quest chain/parent relationships
-- 2. Quest template catalog
-- 3. NPC quest generation logging
--
-- Safe to run multiple times (all statements use ALTER IGNORE / INSERT IGNORE).

-- ── 1. Extend faction_quests table for chain support ───────────────────────

ALTER TABLE faction_quests ADD COLUMN IF NOT EXISTS quest_chain_parent_id INT DEFAULT NULL;
ALTER TABLE faction_quests ADD COLUMN IF NOT EXISTS quest_chain_position INT DEFAULT 0;
ALTER TABLE faction_quests ADD COLUMN IF NOT EXISTS generated_by_npc TINYINT DEFAULT 0;
ALTER TABLE faction_quests ADD COLUMN IF NOT EXISTS generated_timestamp DATETIME DEFAULT NULL;
ALTER TABLE faction_quests ADD COLUMN IF NOT EXISTS llm_prompt_context TEXT DEFAULT NULL;
ALTER TABLE faction_quests ADD COLUMN IF NOT EXISTS quest_reward_seed VARCHAR(64) DEFAULT NULL;
ALTER TABLE faction_quests ADD COLUMN IF NOT EXISTS description_source ENUM('static','llm','hybrid') DEFAULT 'static';

CREATE INDEX IF NOT EXISTS idx_quest_chain_parent ON faction_quests(quest_chain_parent_id);
CREATE INDEX IF NOT EXISTS idx_generated_timestamp ON faction_quests(generated_timestamp);

-- ── 2. Quest template catalog ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quest_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE COMMENT 'Unique template identifier (e.g., "resource_delivery")',
    title_template VARCHAR(255) NOT NULL COMMENT 'Title template with {placeholders}',
    description_template TEXT NOT NULL COMMENT 'Description template with {placeholders}',
    quest_type VARCHAR(32) NOT NULL COMMENT 'Type: explore, deliver, spy, research, combat, diplomacy, etc.',
    requirements_template JSON COMMENT 'JSON template: {"key": "{placeholder}"}',
    reward_template JSON COMMENT 'JSON template: {"metal": "{amount}", "standing": "{delta}"}',
    difficulty_modifier FLOAT DEFAULT 1.0 COMMENT 'Multiplier for reward scaling',
    faction_types_json VARCHAR(255) COMMENT 'Comma-sep list of applicable faction types',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ── 3. NPC Quest Generation Log ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS npc_quest_generation_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    faction_id INT NOT NULL,
    user_id INT NOT NULL,
    quest_id INT,
    trigger_reason VARCHAR(255) COMMENT 'e.g., "daily_generator", "contextual_trigger", "scenario_event"',
    trigger_context_json TEXT COMMENT 'JSON context for debugging',
    chain_parent_id INT DEFAULT NULL COMMENT 'If part of a chain, parent quest_id',
    chain_position INT DEFAULT 0,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (quest_id) REFERENCES faction_quests(id) ON DELETE SET NULL,
    INDEX idx_faction_user_time (faction_id, user_id, generated_at),
    INDEX idx_trigger_reason (trigger_reason)
) ENGINE=InnoDB;

-- ── 4. Quest chain validation table (for DAG management) ────────────────────

CREATE TABLE IF NOT EXISTS quest_chain_specs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE COMMENT 'Chain identifier (e.g., "iron_fleet_protection_arc")',
    title VARCHAR(255) NOT NULL,
    description TEXT,
    faction_id INT,
    quest_ids_ordered JSON COMMENT 'Array of quest_ids in sequence',
    is_sequential TINYINT DEFAULT 1 COMMENT '1=sequential (must complete in order), 0=parallel',
    min_standing_threshold INT DEFAULT 0,
    reward_escalation FLOAT DEFAULT 1.2 COMMENT 'Multiplier for each subsequent quest',
    active TINYINT DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── 5. Seed data: 6 base quest templates ──────────────────────────────────

INSERT IGNORE INTO quest_templates
    (code, title_template, description_template, quest_type, requirements_template, reward_template, difficulty_modifier, faction_types_json)
VALUES
(
    'resource_delivery',
    'Deliver {amount} {resource} to {faction_name}',
    'The {faction_name} requires {amount} units of {resource} for their operations. Transport it to {location}.',
    'deliver',
    '{"resource": "{resource}", "amount": "{amount}", "location": "{location}"}',
    '{"metal": "{base_reward * 0.5}", "standing": "{standing_delta}"}',
    1.0,
    'trade,science,military,envoy'
),
(
    'exploration_mission',
    'Explore {location} and report findings',
    'We need detailed information about {location}. Send a full exploration report and map the area.',
    'explore',
    '{"location": "{location}", "report_type": "full_scan"}',
    '{"crystal": "{base_reward * 0.6}", "standing": "{standing_delta}"}',
    1.1,
    'science,ancient,envoy'
),
(
    'combat_patrol',
    'Eliminate {enemy_count} {enemy_type} in {location}',
    'The {enemy_type} have been terrorizing {location}. Destroy {enemy_count} of them and eliminate the threat.',
    'combat',
    '{"enemy_type": "{enemy_type}", "enemy_count": "{enemy_count}", "location": "{location}"}',
    '{"metal": "{base_reward * 0.8}", "deuterium": "{base_reward * 0.4}", "standing": "{standing_delta}"}',
    1.2,
    'military,pirate,envoy'
),
(
    'research_collaboration',
    'Research {tech_name} with {faction_name}',
    '{faction_name} offers to collaborate on {tech_name} research. Complete the research together and unlock shared benefits.',
    'research',
    '{"tech_name": "{tech_name}"}',
    '{"rare_earth": "{base_reward * 0.7}", "standing": "{standing_delta + 3}"}',
    1.0,
    'science,trade,envoy'
),
(
    'diplomacy_mission',
    'Visit {location} and negotiate with {contact_faction}',
    'Travel to {location} and establish diplomatic relations with {contact_faction}. Bring gifts (resources) to show goodwill.',
    'diplomacy',
    '{"location": "{location}", "contact_faction": "{contact_faction}", "gift_resource": "{gift_resource}", "gift_amount": "{gift_amount}"}',
    '{"standing": "{standing_delta + 5}"}',
    0.8,
    'trade,science,envoy'
),
(
    'trading_chain',
    'Execute trade route: {from_location} → {to_location}',
    'Establish a profitable trade route from {from_location} to {to_location}. Execute at least {num_trades} trades to complete the mission.',
    'deliver',
    '{"from": "{from_location}", "to": "{to_location}", "num_trades": "{num_trades}"}',
    '{"metal": "{profit * 0.3}", "crystal": "{profit * 0.3}", "standing": "{standing_delta + 2}"}',
    1.3,
    'trade,envoy'
);

-- ── 6. Initial Quest Chain Spec (optional example) ────────────────────────

INSERT IGNORE INTO quest_chain_specs
    (code, title, description, faction_id, is_sequential, reward_escalation, active)
VALUES
(
    'iron_fleet_protection_arc',
    'Rise of the Iron Fleet',
    'A 5-quest narrative arc where the player proves loyalty to the Iron Fleet.',
    (SELECT id FROM npc_factions WHERE code='iron_fleet' LIMIT 1),
    1,
    1.3,
    1
);
