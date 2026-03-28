-- GalaxyQuest - Politics model migration v1
-- Adds species, government, civics and dynamic empire modifiers foundation.
-- Safe to run multiple times.

USE galaxyquest;

CREATE TABLE IF NOT EXISTS species_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    species_key VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(96) NOT NULL,
    description TEXT NOT NULL,
    climate_preference VARCHAR(32) NOT NULL DEFAULT 'temperate',
    effects_json JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS government_forms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    government_key VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(96) NOT NULL,
    description TEXT NOT NULL,
    authority_type ENUM('democratic','oligarchic','dictatorial','imperial') NOT NULL DEFAULT 'oligarchic',
    effects_json JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS government_civics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    civic_key VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(96) NOT NULL,
    description TEXT NOT NULL,
    requires_government_key VARCHAR(64) DEFAULT NULL,
    effects_json JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_civic_requires_gov (requires_government_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_empire_profile (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    primary_species_key VARCHAR(64) NOT NULL,
    government_key VARCHAR(64) NOT NULL,
    ethic_axis_json JSON DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_empire_user (user_id),
    INDEX idx_empire_species (primary_species_key),
    INDEX idx_empire_government (government_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_empire_civics (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    civic_key VARCHAR(64) NOT NULL,
    slot_index TINYINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_empire_civic_user (user_id, civic_key),
    UNIQUE KEY uniq_empire_civic_slot (user_id, slot_index),
    INDEX idx_empire_civic (civic_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_empire_modifiers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    source_type ENUM('species','government','civic','faction_pressure','situation','policy','event','manual') NOT NULL,
    source_key VARCHAR(64) NOT NULL,
    modifier_key VARCHAR(64) NOT NULL,
    modifier_value DECIMAL(9,4) NOT NULL,
    starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_empire_mod_user_active (user_id, expires_at),
    INDEX idx_empire_mod_source (source_type, source_key),
    INDEX idx_empire_mod_key (modifier_key)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Species catalog
-- ---------------------------------------------------------------------------
INSERT INTO species_profiles (species_key, name, description, climate_preference, effects_json)
VALUES
(
    'adaptive_humans',
    'Adaptive Humans',
    'Balanced growth and logistics focus.',
    'temperate',
    JSON_OBJECT(
        'resource_output_mult', 0.04,
        'food_output_mult', 0.03,
        'pop_growth_mult', 0.05,
        'happiness_flat', 2
    )
),
(
    'lithoid_miners',
    'Lithoid Miners',
    'Extraction specialists with slower demographic expansion.',
    'dry',
    JSON_OBJECT(
        'resource_output_mult', 0.12,
        'food_output_mult', -0.08,
        'pop_growth_mult', -0.10,
        'happiness_flat', 0
    )
),
(
    'gene_crafters',
    'Gene Crafters',
    'High welfare and biology optimization, weaker heavy industry.',
    'wet',
    JSON_OBJECT(
        'resource_output_mult', -0.04,
        'food_output_mult', 0.10,
        'pop_growth_mult', 0.08,
        'public_services_flat', 5
    )
)
ON DUPLICATE KEY UPDATE
name = VALUES(name),
description = VALUES(description),
climate_preference = VALUES(climate_preference),
effects_json = VALUES(effects_json);

-- ---------------------------------------------------------------------------
-- Government catalog
-- ---------------------------------------------------------------------------
INSERT INTO government_forms (government_key, name, description, authority_type, effects_json)
VALUES
(
    'stellar_republic',
    'Stellar Republic',
    'Representative institutions prioritize welfare and consensus.',
    'democratic',
    JSON_OBJECT(
        'happiness_flat', 5,
        'public_services_flat', 4,
        'resource_output_mult', -0.03
    )
),
(
    'directorate',
    'Technocratic Directorate',
    'Central planning with strong production and research focus.',
    'oligarchic',
    JSON_OBJECT(
        'resource_output_mult', 0.08,
        'research_speed_mult', 0.10,
        'happiness_flat', -3
    )
),
(
    'martial_command',
    'Martial Command',
    'Security-first command structure with social pressure.',
    'dictatorial',
    JSON_OBJECT(
        'resource_output_mult', 0.05,
        'fleet_readiness_mult', 0.12,
        'happiness_flat', -6,
        'pop_growth_mult', -0.04
    )
)
ON DUPLICATE KEY UPDATE
name = VALUES(name),
description = VALUES(description),
authority_type = VALUES(authority_type),
effects_json = VALUES(effects_json);

-- ---------------------------------------------------------------------------
-- Civic catalog
-- ---------------------------------------------------------------------------
INSERT INTO government_civics (civic_key, name, description, requires_government_key, effects_json)
VALUES
(
    'meritocracy',
    'Meritocracy',
    'Promotion by performance, not by status.',
    NULL,
    JSON_OBJECT(
        'resource_output_mult', 0.05,
        'research_speed_mult', 0.06,
        'happiness_flat', -1
    )
),
(
    'civil_welfare_network',
    'Civil Welfare Network',
    'Public services and social infrastructure are heavily funded.',
    'stellar_republic',
    JSON_OBJECT(
        'public_services_flat', 8,
        'happiness_flat', 4,
        'resource_output_mult', -0.04
    )
),
(
    'industrial_war_machine',
    'Industrial War Machine',
    'Output and fleet logistics prioritized over civilian comfort.',
    'martial_command',
    JSON_OBJECT(
        'resource_output_mult', 0.10,
        'fleet_readiness_mult', 0.10,
        'happiness_flat', -5,
        'food_output_mult', -0.04
    )
),
(
    'adaptive_bureaucracy',
    'Adaptive Bureaucracy',
    'Flexible administration that smooths faction pressure swings.',
    NULL,
    JSON_OBJECT(
        'faction_pressure_mult', -0.20,
        'happiness_flat', 2,
        'pop_growth_mult', 0.03
    )
)
ON DUPLICATE KEY UPDATE
name = VALUES(name),
description = VALUES(description),
requires_government_key = VALUES(requires_government_key),
effects_json = VALUES(effects_json);

-- ---------------------------------------------------------------------------
-- Baseline empire profile for existing users
-- ---------------------------------------------------------------------------
INSERT INTO user_empire_profile (user_id, primary_species_key, government_key, ethic_axis_json)
SELECT u.id,
       'adaptive_humans',
       'stellar_republic',
       JSON_OBJECT('order_vs_freedom', 0, 'industry_vs_ecology', 0, 'science_vs_tradition', 0)
FROM users u
ON DUPLICATE KEY UPDATE user_id = user_id;

INSERT IGNORE INTO user_empire_civics (user_id, civic_key, slot_index)
SELECT u.id, 'meritocracy', 1
FROM users u;

INSERT IGNORE INTO user_empire_civics (user_id, civic_key, slot_index)
SELECT u.id, 'adaptive_bureaucracy', 2
FROM users u;
