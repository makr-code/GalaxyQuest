-- GalaxyQuest - Vessel blueprint runtime migration v3
-- Adds faction_tech_affinities table and seeds NPC-faction entries for key fractions/*.
-- Safe to run multiple times; all inserts use INSERT IGNORE / ON DUPLICATE KEY.

USE galaxyquest;

-- ── 1. faction_tech_affinities table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS faction_tech_affinities (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    faction_code   VARCHAR(64)   NOT NULL COMMENT 'References npc_factions.code',
    module_group_code VARCHAR(64) NOT NULL COMMENT 'References module_groups.code',
    bonus_type     ENUM('cost_pct','build_time_pct','stat_mult','unlock_tier') NOT NULL,
    bonus_value    DECIMAL(10,4) NOT NULL DEFAULT 0 COMMENT 'cost_pct/-15 = -15%; stat_mult/0.08 = +8%',
    min_standing   SMALLINT      NOT NULL DEFAULT 0 COMMENT 'Min diplomacy standing required to receive the bonus',
    UNIQUE KEY uq_fta (faction_code, module_group_code, bonus_type),
    KEY idx_fta_faction (faction_code),
    KEY idx_fta_group   (module_group_code)
) ENGINE=InnoDB COMMENT='Per-faction module-group tech affinities. Derived from fractions/* spec data.';


-- ── 2. Ensure fractions/** factions exist in npc_factions ────────────────────
-- iron_fleet: human military, weapon-focused
INSERT IGNORE INTO npc_factions (code, name, description, faction_type, aggression, trade_willingness, base_diplomacy, power_level, home_galaxy_min, home_galaxy_max, color, icon)
VALUES ('iron_fleet', 'Eisenflotte', 'Menschliche Militärdiktatur. Aggressiv, zahlreich.', 'military', 85, 20, -10, 1400, 1, 5, '#c0392b', '⚔');

-- aereth: energy beings, scientific, energy/shield-focused
INSERT IGNORE INTO npc_factions (code, name, description, faction_type, aggression, trade_willingness, base_diplomacy, power_level, home_galaxy_min, home_galaxy_max, color, icon)
VALUES ('aereth', 'Aereth', 'Humanoide Energiewesen. Wissenschaftlich, Energie ist heilig.', 'science', 25, 65, 5, 1200, 2, 7, '#e6f3ff', '✦');

-- omniscienta: AI collective, utility/propulsion-focused
INSERT IGNORE INTO npc_factions (code, name, description, faction_type, aggression, trade_willingness, base_diplomacy, power_level, home_galaxy_min, home_galaxy_max, color, icon)
VALUES ('omniscienta', 'Omniscienta', 'Post-organisches Maschinenkollektiv. Unberechenbar.', 'science', 60, 40, 0, 1600, 3, 9, '#7f8c8d', '🤖');

-- vor_tak: ancient predator, weapon/hull focused
INSERT IGNORE INTO npc_factions (code, name, description, faction_type, aggression, trade_willingness, base_diplomacy, power_level, home_galaxy_min, home_galaxy_max, color, icon)
VALUES ('vor_tak', 'Vor''tak', 'Ältestes Raubtier. Brutalität als Philosophie.', 'military', 95, 10, -30, 1800, 4, 9, '#6c3483', '◈');

-- syl_nar: traders, utility/propulsion focused
INSERT IGNORE INTO npc_factions (code, name, description, faction_type, aggression, trade_willingness, base_diplomacy, power_level, home_galaxy_min, home_galaxy_max, color, icon)
VALUES ('syl_nar', 'Syl''Nar', 'Händlernomaden. Neutrale Universumsklempner.', 'trade', 15, 90, 15, 900, 1, 9, '#f39c12', '⬟');

-- zhareen: crystalline, shield/hull focused
INSERT IGNORE INTO npc_factions (code, name, description, faction_type, aggression, trade_willingness, base_diplomacy, power_level, home_galaxy_min, home_galaxy_max, color, icon)
VALUES ('zhareen', 'Zhareen', 'Kristalline Mineralwesen. Geduldig wie Gestein.', 'ancient', 20, 50, 10, 1100, 2, 8, '#1abc9c', '◆');


-- ── 3. Seed affinities (derived from fractions/* spec.json character) ────────

-- guild (existing npc_faction, weapon licensing/trade): weapon cost/time bonus
INSERT INTO faction_tech_affinities (faction_code, module_group_code, bonus_type, bonus_value, min_standing)
VALUES
    ('guild', 'weapon',     'cost_pct',       -10.0, 10),
    ('guild', 'weapon',     'build_time_pct', -15.0, 15),
    ('guild', 'shield',     'cost_pct',       -5.0,  10),
    ('guild', 'utility',    'cost_pct',       -5.0,  20)
ON DUPLICATE KEY UPDATE bonus_value = VALUES(bonus_value), min_standing = VALUES(min_standing);

-- science (existing npc_faction): research/utility/shield bonus
INSERT INTO faction_tech_affinities (faction_code, module_group_code, bonus_type, bonus_value, min_standing)
VALUES
    ('science', 'utility', 'cost_pct',       -15.0, 5),
    ('science', 'shield',  'stat_mult',       0.05,  10),
    ('science', 'weapon',  'build_time_pct', -8.0,  15)
ON DUPLICATE KEY UPDATE bonus_value = VALUES(bonus_value), min_standing = VALUES(min_standing);

-- empire (existing npc_faction, military): weapon stat bonus, propulsion time
INSERT INTO faction_tech_affinities (faction_code, module_group_code, bonus_type, bonus_value, min_standing)
VALUES
    ('empire', 'weapon',     'stat_mult',       0.08,  10),
    ('empire', 'propulsion', 'build_time_pct', -10.0,  5)
ON DUPLICATE KEY UPDATE bonus_value = VALUES(bonus_value), min_standing = VALUES(min_standing);

-- iron_fleet (fractions spec – human military, kinetic weapons, mass fleets)
INSERT INTO faction_tech_affinities (faction_code, module_group_code, bonus_type, bonus_value, min_standing)
VALUES
    ('iron_fleet', 'weapon',     'stat_mult',       0.10, 10),
    ('iron_fleet', 'weapon',     'build_time_pct', -12.0, 15),
    ('iron_fleet', 'propulsion', 'cost_pct',        -8.0,  5)
ON DUPLICATE KEY UPDATE bonus_value = VALUES(bonus_value), min_standing = VALUES(min_standing);

-- aereth (fractions spec – energy beings, dimension research, energy manipulation, shield/weapon via energy)
INSERT INTO faction_tech_affinities (faction_code, module_group_code, bonus_type, bonus_value, min_standing)
VALUES
    ('aereth', 'shield',  'stat_mult',  0.08, 5),
    ('aereth', 'shield',  'cost_pct',  -10.0, 10),
    ('aereth', 'weapon',  'cost_pct',   -8.0, 15)
ON DUPLICATE KEY UPDATE bonus_value = VALUES(bonus_value), min_standing = VALUES(min_standing);

-- omniscienta (fractions spec – self-optimizing nanites, adaptive constructs)
INSERT INTO faction_tech_affinities (faction_code, module_group_code, bonus_type, bonus_value, min_standing)
VALUES
    ('omniscienta', 'utility',    'cost_pct',       -20.0, 5),
    ('omniscienta', 'utility',    'build_time_pct', -15.0, 10),
    ('omniscienta', 'propulsion', 'stat_mult',        0.06, 10)
ON DUPLICATE KEY UPDATE bonus_value = VALUES(bonus_value), min_standing = VALUES(min_standing);

-- vor_tak (fractions spec – brute force, ancient predator)
INSERT INTO faction_tech_affinities (faction_code, module_group_code, bonus_type, bonus_value, min_standing)
VALUES
    ('vor_tak', 'weapon', 'stat_mult',  0.12, 10),
    ('vor_tak', 'hull',   'stat_mult',  0.10,  5)
ON DUPLICATE KEY UPDATE bonus_value = VALUES(bonus_value), min_standing = VALUES(min_standing);

-- syl_nar (fractions spec – traders/nomads, logistics/speed focus)
INSERT INTO faction_tech_affinities (faction_code, module_group_code, bonus_type, bonus_value, min_standing)
VALUES
    ('syl_nar', 'propulsion', 'stat_mult',        0.08, 5),
    ('syl_nar', 'utility',    'build_time_pct',  -18.0, 10),
    ('syl_nar', 'propulsion', 'cost_pct',        -10.0, 15)
ON DUPLICATE KEY UPDATE bonus_value = VALUES(bonus_value), min_standing = VALUES(min_standing);

-- zhareen (fractions spec – crystalline mineral beings, defensive/structural mastery)
INSERT INTO faction_tech_affinities (faction_code, module_group_code, bonus_type, bonus_value, min_standing)
VALUES
    ('zhareen', 'shield', 'stat_mult',        0.10,  5),
    ('zhareen', 'shield', 'cost_pct',        -12.0, 10),
    ('zhareen', 'hull',   'stat_mult',         0.08, 10),
    ('zhareen', 'hull',   'build_time_pct',  -10.0, 15)
ON DUPLICATE KEY UPDATE bonus_value = VALUES(bonus_value), min_standing = VALUES(min_standing);
