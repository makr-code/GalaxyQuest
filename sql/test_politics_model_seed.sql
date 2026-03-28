-- GalaxyQuest - Politics model generic test seed
-- Prerequisite: sql/migrate_politics_model_v1.sql and sql/migrate_gameplay_model_v1.sql

USE galaxyquest;

SET @gq_test_user_id := (
    SELECT id FROM users WHERE username = 'gq_model_test_user' LIMIT 1
);

-- Fallback user creation when gameplay-model seed has not been run yet.
INSERT INTO users (username, email, password_hash, is_admin, is_npc)
SELECT
    'gq_model_test_user',
    'gq_model_test_user@example.local',
    '$2y$10$7Q9QBtX4a7rQ6epLqGh2NO9okmD1mJkQG1tQfFQbAkM6M8Xk6r9b2',
    0,
    0
FROM DUAL
WHERE @gq_test_user_id IS NULL;

SET @gq_test_user_id := (
    SELECT id FROM users WHERE username = 'gq_model_test_user' LIMIT 1
);

INSERT INTO user_empire_profile (user_id, primary_species_key, government_key, ethic_axis_json)
VALUES (
    @gq_test_user_id,
    'lithoid_miners',
    'directorate',
    JSON_OBJECT('order_vs_freedom', 35, 'industry_vs_ecology', 62, 'science_vs_tradition', 48)
)
ON DUPLICATE KEY UPDATE
primary_species_key = VALUES(primary_species_key),
government_key = VALUES(government_key),
ethic_axis_json = VALUES(ethic_axis_json),
updated_at = NOW();

DELETE FROM user_empire_civics WHERE user_id = @gq_test_user_id;

INSERT INTO user_empire_civics (user_id, civic_key, slot_index)
VALUES
(@gq_test_user_id, 'meritocracy', 1),
(@gq_test_user_id, 'adaptive_bureaucracy', 2)
ON DUPLICATE KEY UPDATE civic_key = VALUES(civic_key);

INSERT INTO user_faction_state (user_id, faction_key, approval, support, issues_json)
VALUES
(@gq_test_user_id, 'industrialists', 67.00, 32.00, JSON_ARRAY('alloy_output','market_access')),
(@gq_test_user_id, 'scientists',     71.00, 26.00, JSON_ARRAY('research_funding','anomalies')),
(@gq_test_user_id, 'security_bloc',  43.00, 29.00, JSON_ARRAY('fleet_readiness','border_control')),
(@gq_test_user_id, 'civic_union',    46.00, 18.00, JSON_ARRAY('amenities','housing'))
ON DUPLICATE KEY UPDATE
approval = VALUES(approval),
support = VALUES(support),
issues_json = VALUES(issues_json),
last_updated_at = NOW();

INSERT INTO situation_states (
    user_id, colony_id, target_type, target_id, situation_type, status,
    progress, stage, approach_key, approach_locked,
    payload_json, monthly_deltas_json,
    started_at, last_tick_at, ended_at
)
SELECT
    @gq_test_user_id,
    NULL,
    'empire',
    NULL,
    'faction_unrest',
    'active',
    68.00,
    3,
    'conciliation',
    1,
    JSON_OBJECT('origin','test_seed','note','active politics runtime malus sample'),
    JSON_OBJECT('progress_per_hour', 1.0, 'approach_multipliers', JSON_OBJECT('conciliation',0.8,'repression',1.3,'reforms',0.6)),
    NOW() - INTERVAL 18 HOUR,
    NOW() - INTERVAL 25 MINUTE,
    NULL
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1
    FROM situation_states
    WHERE user_id = @gq_test_user_id
      AND situation_type = 'faction_unrest'
      AND status = 'active'
);

SELECT @gq_test_user_id AS test_user_id;
