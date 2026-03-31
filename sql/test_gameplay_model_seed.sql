-- GalaxyQuest - Gameplay model test seed
-- Purpose: create deterministic generic test data for the gameplay model tables.
-- Prerequisite: run sql/migrate_gameplay_model_v1.sql first.

USE galaxyquest;

-- ---------------------------------------------------------------------------
-- Stable test identity and world anchor
-- ---------------------------------------------------------------------------
INSERT INTO users (username, email, password_hash, is_admin, is_npc)
VALUES (
    'gq_model_test_user',
    'gq_model_test_user@example.local',
    '$2y$10$7Q9QBtX4a7rQ6epLqGh2NO9okmD1mJkQG1tQfFQbAkM6M8Xk6r9b2',
    0,
    0
)
ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);
SET @gq_test_user_id := LAST_INSERT_ID();

INSERT INTO star_systems (
    galaxy_index, system_index,
    x_ly, y_ly, z_ly,
    spectral_class, subtype,
    mass_solar, radius_solar, temperature_k, luminosity_solar,
    hz_inner_au, hz_outer_au, frost_line_au,
    name, catalog_name, planet_count
)
VALUES (
    1, 24999,
    14.0, 9.0, -4.0,
    'G', 2,
    1.0, 1.0, 5778, 1.0,
    0.95, 1.67, 2.68,
    'TEST-24999', 'GQ-T-24999', 1
)
ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);
SET @gq_test_system_id := LAST_INSERT_ID();

INSERT INTO planets (
    system_id, galaxy, `system`, position,
    type, planet_class,
    diameter, temp_min, temp_max,
    semi_major_axis_au, orbital_period_days, orbital_eccentricity,
    surface_gravity_g, in_habitable_zone, atmosphere_type,
    composition_family, dominant_surface_material, surface_pressure_bar,
    water_state, methane_state, ammonia_state, dominant_surface_liquid,
    radiation_level, habitability_score, life_friendliness,
    richness_metal, richness_crystal, richness_deuterium, richness_rare_earth,
    deposit_metal, deposit_crystal, deposit_deuterium, deposit_rare_earth
)
VALUES (
    @gq_test_system_id, 1, 24999, 1,
    'terrestrial', 'rocky',
    12340, -15, 36,
    1.02, 388.2, 0.021,
    1.02, 1, 'nitrogen_oxygen',
    'silicate_metal', 'basaltic_regolith', 1.02,
    'liquid', 'gas', 'gas', 'water',
    'moderate', 82, 'life_friendly',
    1.2, 1.1, 1.0, 0.7,
    7000000, 2300000, 1100000, 280000
)
ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);
SET @gq_test_planet_id := LAST_INSERT_ID();

INSERT INTO celestial_bodies (
    body_uid, galaxy_index, system_index, position,
    body_type, parent_body_type, name, planet_class,
    can_colonize, payload_json
)
VALUES (
    CONCAT('legacy-p-', 1, '-', 24999, '-', 1),
    1, 24999, 1,
    'planet', 'star', 'Model Test Prime', 'terrestrial',
    1, JSON_OBJECT('legacy_planet_id', @gq_test_planet_id)
)
ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);
SET @gq_test_body_id := LAST_INSERT_ID();

INSERT INTO colonies (
    planet_id, body_id, user_id, name, colony_type,
    metal, crystal, deuterium, rare_earth, food,
    energy, population, max_population,
    happiness, public_services, is_homeworld
)
VALUES (
    @gq_test_planet_id, @gq_test_body_id, @gq_test_user_id, 'Model Test Prime', 'balanced',
    2000, 1500, 900, 120, 800,
    220, 1200, 3600,
    72, 64, 0
)
ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);
SET @gq_test_colony_id := LAST_INSERT_ID();

-- ---------------------------------------------------------------------------
-- Baseline internal politics rows (idempotent)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO user_faction_state (user_id, faction_key, approval, support, issues_json)
VALUES
(@gq_test_user_id, 'industrialists', 57.00, 28.00, JSON_ARRAY('tax_relief','alloy_output')),
(@gq_test_user_id, 'scientists',     63.00, 24.00, JSON_ARRAY('research_funding','anomalies')),
(@gq_test_user_id, 'security_bloc',  48.00, 31.00, JSON_ARRAY('fleet_readiness','border_control')),
(@gq_test_user_id, 'civic_union',    54.00, 17.00, JSON_ARRAY('amenities','housing'));

-- ---------------------------------------------------------------------------
-- Situation samples across lifecycle states
-- ---------------------------------------------------------------------------
INSERT INTO situation_states (
    user_id, colony_id, target_type, target_id, situation_type, status,
    progress, stage, approach_key, approach_locked,
    payload_json, monthly_deltas_json,
    started_at, last_tick_at, ended_at
)
SELECT
    @gq_test_user_id,
    @gq_test_colony_id,
    'colony',
    @gq_test_colony_id,
    'energy_shortage',
    'active',
    34.50,
    2,
    'rationing',
    0,
    JSON_OBJECT('severity','medium','origin','test_seed'),
    JSON_OBJECT('progress_per_hour',1.15,'approach_multipliers',JSON_OBJECT('rationing',0.8,'emergency_import',1.4)),
    NOW() - INTERVAL 6 HOUR,
    NOW() - INTERVAL 40 MINUTE,
    NULL
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1
    FROM situation_states
    WHERE user_id = @gq_test_user_id
      AND colony_id = @gq_test_colony_id
      AND situation_type = 'energy_shortage'
      AND status = 'active'
);

INSERT INTO situation_states (
    user_id, colony_id, target_type, target_id, situation_type, status,
    progress, stage, approach_key, approach_locked,
    payload_json, monthly_deltas_json,
    started_at, last_tick_at, ended_at
)
SELECT
    @gq_test_user_id,
    @gq_test_colony_id,
    'colony',
    @gq_test_colony_id,
    'labor_unrest',
    'resolved',
    100.00,
    4,
    'public_services',
    1,
    JSON_OBJECT('severity','high','origin','test_seed','resolution_note','resolved during seed setup'),
    JSON_OBJECT('progress_per_hour',0.7),
    NOW() - INTERVAL 3 DAY,
    NOW() - INTERVAL 2 DAY,
    NOW() - INTERVAL 2 DAY
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1
    FROM situation_states
    WHERE user_id = @gq_test_user_id
      AND colony_id = @gq_test_colony_id
      AND situation_type = 'labor_unrest'
      AND status = 'resolved'
);

-- ---------------------------------------------------------------------------
-- Stage log and faction history samples
-- ---------------------------------------------------------------------------
SET @gq_active_situation_id := (
    SELECT id
    FROM situation_states
    WHERE user_id = @gq_test_user_id
      AND colony_id = @gq_test_colony_id
      AND situation_type = 'energy_shortage'
      AND status = 'active'
    ORDER BY id DESC
    LIMIT 1
);

INSERT INTO situation_stage_log (situation_id, user_id, old_stage, new_stage, reason)
SELECT @gq_active_situation_id, @gq_test_user_id, 1, 2, 'seed_progression'
FROM DUAL
WHERE @gq_active_situation_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM situation_stage_log
      WHERE situation_id = @gq_active_situation_id
        AND old_stage = 1
        AND new_stage = 2
        AND reason = 'seed_progression'
  );

INSERT INTO faction_approval_history (
    user_id, faction_key,
    approval_before, approval_after,
    support_before, support_after,
    delta_reason, source_type, source_id
)
SELECT
    @gq_test_user_id,
    'scientists',
    58.00, 63.00,
    21.00, 24.00,
    'research_budget_boost',
    'policy',
    NULL
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1
    FROM faction_approval_history
    WHERE user_id = @gq_test_user_id
      AND faction_key = 'scientists'
      AND delta_reason = 'research_budget_boost'
);

SELECT
    @gq_test_user_id AS test_user_id,
    @gq_test_system_id AS test_system_id,
    @gq_test_planet_id AS test_planet_id,
    @gq_test_colony_id AS test_colony_id;
