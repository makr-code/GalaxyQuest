-- GalaxyQuest - Vessel blueprint runtime migration v1
-- Adds additive data structures for hulls, modules, compat tables and player blueprints.
-- Safe to run multiple times.

USE galaxyquest;

CREATE TABLE IF NOT EXISTS vessel_hulls (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL,
    label VARCHAR(128) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'combat',
    tier SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    base_mass DECIMAL(12,2) NOT NULL DEFAULT 0,
    base_attack DECIMAL(12,2) NOT NULL DEFAULT 0,
    base_shield DECIMAL(12,2) NOT NULL DEFAULT 0,
    base_hull DECIMAL(12,2) NOT NULL DEFAULT 0,
    base_cargo DECIMAL(12,2) NOT NULL DEFAULT 0,
    base_speed DECIMAL(12,2) NOT NULL DEFAULT 1000,
    slot_profile_json JSON DEFAULT NULL,
    research_req_json JSON DEFAULT NULL,
    build_req_json JSON DEFAULT NULL,
    build_cost_json JSON DEFAULT NULL,
    build_time_secs INT UNSIGNED NOT NULL DEFAULT 60,
    faction_tag VARCHAR(64) DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vessel_hulls_code (code),
    KEY idx_vessel_hulls_active (is_active, tier)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS module_groups (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL,
    label VARCHAR(128) NOT NULL,
    max_per_hull_default SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    is_required TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_module_groups_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS modules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL,
    group_id BIGINT NOT NULL,
    label VARCHAR(128) NOT NULL,
    tier SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    rarity VARCHAR(32) NOT NULL DEFAULT 'common',
    stats_delta_json JSON DEFAULT NULL,
    power_draw DECIMAL(12,2) NOT NULL DEFAULT 0,
    mass_delta DECIMAL(12,2) NOT NULL DEFAULT 0,
    build_cost_json JSON DEFAULT NULL,
    build_time_secs INT UNSIGNED NOT NULL DEFAULT 30,
    research_req_json JSON DEFAULT NULL,
    shipyard_req_json JSON DEFAULT NULL,
    faction_tag VARCHAR(64) DEFAULT NULL,
    species_affinity_json JSON DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_modules_code (code),
    KEY idx_modules_group_active (group_id, is_active, tier),
    CONSTRAINT fk_modules_group FOREIGN KEY (group_id) REFERENCES module_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hull_module_compatibility (
    hull_id BIGINT NOT NULL,
    group_id BIGINT NOT NULL,
    slot_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    allowed_module_tags_json JSON DEFAULT NULL,
    max_module_tier SMALLINT UNSIGNED NOT NULL DEFAULT 99,
    PRIMARY KEY (hull_id, group_id),
    KEY idx_hmc_group (group_id),
    CONSTRAINT fk_hmc_hull FOREIGN KEY (hull_id) REFERENCES vessel_hulls(id) ON DELETE CASCADE,
    CONSTRAINT fk_hmc_group FOREIGN KEY (group_id) REFERENCES module_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vessel_blueprints (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    hull_id BIGINT NOT NULL,
    doctrine_tag VARCHAR(64) NOT NULL DEFAULT 'custom',
    source_type VARCHAR(32) NOT NULL DEFAULT 'player',
    is_public TINYINT(1) NOT NULL DEFAULT 0,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    compiled_stats_json JSON DEFAULT NULL,
    compiled_cost_json JSON DEFAULT NULL,
    compiled_time_secs INT UNSIGNED NOT NULL DEFAULT 60,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_blueprints_user_code (user_id, code),
    KEY idx_blueprints_owner (user_id, updated_at),
    KEY idx_blueprints_hull (hull_id),
    CONSTRAINT fk_blueprints_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_blueprints_hull FOREIGN KEY (hull_id) REFERENCES vessel_hulls(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vessel_blueprint_modules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    blueprint_id BIGINT NOT NULL,
    module_id BIGINT NOT NULL,
    slot_index SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    UNIQUE KEY uq_blueprint_slot (blueprint_id, slot_index),
    KEY idx_vbm_module (module_id),
    CONSTRAINT fk_vbm_blueprint FOREIGN KEY (blueprint_id) REFERENCES vessel_blueprints(id) ON DELETE CASCADE,
    CONSTRAINT fk_vbm_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
