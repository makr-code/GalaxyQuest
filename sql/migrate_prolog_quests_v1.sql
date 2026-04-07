-- GalaxyQuest migration: prolog herald factions + initial quests
--
-- Adds the six narrative prolog factions as NPC factions with faction_type='envoy'
-- and seeds one starter quest per faction that is auto-started for new players
-- when they complete the registration prolog.
--
-- Safe to run multiple times (all statements use INSERT IGNORE / ALTER IGNORE).

-- 1. Extend faction_type ENUM to include 'envoy' ──────────────────────────────

SET @col_type := (
    SELECT COLUMN_TYPE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'npc_factions'
      AND COLUMN_NAME  = 'faction_type'
);

SET @needs_envoy := IF(@col_type NOT LIKE '%envoy%', 1, 0);

SET @sql_envoy := IF(
    @needs_envoy = 1,
    "ALTER TABLE npc_factions MODIFY COLUMN faction_type ENUM('military','trade','science','pirate','ancient','envoy') NOT NULL",
    'SELECT 1'
);

PREPARE stmt_envoy FROM @sql_envoy;
EXECUTE stmt_envoy;
DEALLOCATE PREPARE stmt_envoy;

-- 2. Seed the six herald (prolog) factions ────────────────────────────────────

INSERT IGNORE INTO npc_factions
    (code, name, description, faction_type, aggression, trade_willingness,
     base_diplomacy, power_level, home_galaxy_min, home_galaxy_max, color, icon)
VALUES
('vor_tak',
 "Vor'Tak – Der Schildkreis",
 'A militaristic shield-ring faction that offers protection in exchange for strategic access.',
 'envoy', 60, 20, 0, 800, 1, 9, '#c0392b', '🦎'),
('syl_nar',
 "Syl'Nar – Der Lichtbund",
 'A humanitarian covenant that trades food and goodwill to build long-term trust.',
 'envoy', 10, 80, 10, 600, 1, 9, '#e67e22', '🐙'),
('aereth',
 'Aereth – Der Kernrat',
 'An energy-science collective that offers advanced technology in return for research access.',
 'envoy', 20, 60, 5, 700, 1, 9, '#2980b9', '🔥'),
('kryl_tha',
 "Kryl'Tha – Die Schwarmkommandantur",
 'A swarm security force that eliminates threats in exchange for territorial concessions.',
 'envoy', 50, 30, 0, 900, 1, 9, '#27ae60', '🦗'),
('zhareen',
 'Zhareen – Der Archivrat',
 'An ancient archive council that shares knowledge of the cosmos for access to anomalies.',
 'envoy', 15, 50, 5, 1200, 1, 9, '#8e44ad', '💎'),
('vel_ar',
 "Vel'Ar – Der Schattenkreis",
 'A covert intelligence network that reveals hidden truths in exchange for network access.',
 'envoy', 30, 40, 0, 750, 1, 9, '#546e7a', '🌫️');

-- 3. Seed one initial quest per herald faction ─────────────────────────────────

INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id,
    'vor_tak_first_patrol',
    'Patrouillenkorvetten inspizieren',
    'Inspiziere die Patrouillenkorvetten in deinem Orbit und melde Sharr''Keth den Zustand ihrer Waffensysteme. Sende einen Aufklärungsbericht.',
    'explore', '{"spy_reports":1}',
    5000, 2000, 1000, 0, 0, 25, 10, -100, 'easy', 0
FROM npc_factions f WHERE f.code='vor_tak';

INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id,
    'syl_nar_food_check',
    'Nahrungsversorgung prüfen',
    'Prüfe die Nahrungsmittelversorgung deiner Kolonie und stelle sicher, dass mindestens 2 000 Einheiten Nahrung vorhanden sind.',
    'deliver', '{"resource":"food","amount":2000}',
    3000, 0, 1000, 0, 0, 25, 10, -100, 'easy', 0
FROM npc_factions f WHERE f.code='syl_nar';

INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id,
    'aereth_mineral_survey',
    'Mineralförderrate bestimmen',
    'Öffne die Bergbau-Übersicht und fördere die ersten Einheiten des unbekannten Minerals (Seltene Erden).',
    'deliver', '{"resource":"rare_earth","amount":50}',
    0, 5000, 2000, 0, 0, 25, 10, -100, 'easy', 0
FROM npc_factions f WHERE f.code='aereth';

INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id,
    'kryl_tha_security_sweep',
    'Sicherheitsprotokolle auswerten',
    'Rufe die Sicherheitsprotokolle deiner Außenposten auf und bewerte die aktuelle Bedrohungslage. Entsende einen Aufklärungsbericht.',
    'spy', '{"count":1}',
    3000, 3000, 0, 0, 0, 25, 10, -100, 'easy', 0
FROM npc_factions f WHERE f.code='kryl_tha';

INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id,
    'zhareen_first_research',
    'Archivdatenbank freischalten',
    'Starte deine erste Forschung, um das Archivdatenbank-Terminal im Gouverneursgebäude freizuschalten und ältere Karten abrufen zu können.',
    'research', '{"research_level":1}',
    0, 3000, 0, 200, 0, 25, 10, -100, 'easy', 0
FROM npc_factions f WHERE f.code='zhareen';

INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id,
    'vel_ar_data_intel',
    "Nira'Vels Datentafel analysieren",
    "Öffne Nira'Vels Datentafel und analysiere die gesammelten Informationen über die anderen Gesandten. Sende einen Spionagebericht.",
    'spy', '{"count":1}',
    0, 2000, 0, 0, 50, 25, 10, -100, 'easy', 0
FROM npc_factions f WHERE f.code='vel_ar';
