-- Align daily NPC quest generation with the canonical faction quest model.
-- Safe to apply after either the base schema or the legacy v2 migration.

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'faction_quests'
       AND COLUMN_NAME = 'active') = 0,
    'ALTER TABLE faction_quests ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'faction_quests'
       AND COLUMN_NAME = 'template_code') = 0,
    'ALTER TABLE faction_quests ADD COLUMN template_code VARCHAR(64) DEFAULT NULL',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'faction_quests'
       AND COLUMN_NAME = 'generated_by_npc') = 0,
    'ALTER TABLE faction_quests ADD COLUMN generated_by_npc TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'faction_quests'
       AND COLUMN_NAME = 'generated_timestamp') = 0,
    'ALTER TABLE faction_quests ADD COLUMN generated_timestamp DATETIME DEFAULT NULL',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

CREATE TABLE IF NOT EXISTS quest_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    title_template VARCHAR(255) NOT NULL,
    description_template TEXT NOT NULL,
    quest_type VARCHAR(32) NOT NULL,
    requirements_template JSON DEFAULT NULL,
    reward_template JSON DEFAULT NULL,
    difficulty_modifier FLOAT DEFAULT 1.0,
    faction_types_json VARCHAR(255) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO quest_templates
    (code, title_template, description_template, quest_type, requirements_template, reward_template, difficulty_modifier, faction_types_json)
VALUES
    ('resource_delivery', 'Deliver {amount} {resource} to {faction_name}',
     'The {faction_name} requires {amount} units of {resource}. Transport it to {location}.',
     'deliver', '{"resource":"{resource}","amount":"{amount}"}',
     '{"base_metal":500,"base_standing":5}', 1.0, 'trade,science,military,envoy'),
    ('exploration_mission', 'Explore {location} and report findings',
     'Map {location} and submit a full exploration report to {faction_name}.',
     'explore', '{"spy_reports":1}',
     '{"base_crystal":600,"base_standing":6}', 1.1, 'science,ancient,envoy'),
    ('combat_patrol', 'Eliminate {enemy_count} {enemy_type} in {location}',
     'Destroy {enemy_count} {enemy_type} in {location} for {faction_name}.',
     'kill', '{"count":"{enemy_count}"}',
     '{"base_metal":800,"base_deuterium":400,"base_standing":8}', 1.2, 'military,pirate,envoy'),
    ('research_collaboration', 'Research with {faction_name}',
     '{faction_name} requests your help advancing research.',
     'research', '{"research_level":1}',
     '{"base_rare_earth":700,"base_standing":7}', 1.0, 'science,trade,envoy');

CREATE TABLE IF NOT EXISTS npc_quest_generation_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    faction_id INT NOT NULL,
    user_id INT DEFAULT NULL,
    quest_id INT DEFAULT NULL,
    trigger_reason VARCHAR(255) DEFAULT NULL,
    trigger_context_json TEXT DEFAULT NULL,
    chain_parent_id INT DEFAULT NULL,
    chain_position INT DEFAULT 0,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_daily_quest_log_faction
        FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
    CONSTRAINT fk_daily_quest_log_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_daily_quest_log_quest
        FOREIGN KEY (quest_id) REFERENCES faction_quests(id) ON DELETE SET NULL,
    INDEX idx_daily_quest_log_faction_user_time (faction_id, user_id, generated_at),
    INDEX idx_daily_quest_log_trigger (trigger_reason)
) ENGINE=InnoDB;

ALTER TABLE npc_quest_generation_log
    MODIFY COLUMN user_id INT DEFAULT NULL;
