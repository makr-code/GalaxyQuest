-- GalaxyQuest - Politics model smoke checks

USE galaxyquest;

SET @gq_test_user_id := (
    SELECT id FROM users WHERE username = 'gq_model_test_user' LIMIT 1
);

SELECT
    'POL_TEST_USER_EXISTS' AS check_name,
    CASE WHEN @gq_test_user_id IS NOT NULL THEN 'OK' ELSE 'FAIL' END AS status,
    @gq_test_user_id AS value_ref;

SELECT
    'POL_PROFILE_EXISTS' AS check_name,
    CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'FAIL' END AS status,
    COUNT(*) AS value_ref
FROM user_empire_profile
WHERE user_id = @gq_test_user_id;

SELECT
    'POL_SPECIES_VALID' AS check_name,
    CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'FAIL' END AS status,
    COUNT(*) AS value_ref
FROM user_empire_profile ep
JOIN species_profiles sp ON sp.species_key = ep.primary_species_key
WHERE ep.user_id = @gq_test_user_id;

SELECT
    'POL_GOVERNMENT_VALID' AS check_name,
    CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'FAIL' END AS status,
    COUNT(*) AS value_ref
FROM user_empire_profile ep
JOIN government_forms gf ON gf.government_key = ep.government_key
WHERE ep.user_id = @gq_test_user_id;

SELECT
    'POL_CIVIC_SLOTS_MAX2' AS check_name,
    CASE WHEN COUNT(*) <= 2 THEN 'OK' ELSE 'FAIL' END AS status,
    COUNT(*) AS value_ref
FROM user_empire_civics
WHERE user_id = @gq_test_user_id;

SELECT
    'POL_CIVICS_VALID' AS check_name,
    CASE
      WHEN COUNT(*) = 0 THEN 'FAIL'
      WHEN SUM(CASE WHEN gc.civic_key IS NOT NULL THEN 1 ELSE 0 END) = COUNT(*) THEN 'OK'
      ELSE 'FAIL'
    END AS status,
    COUNT(*) AS value_ref
FROM user_empire_civics uc
LEFT JOIN government_civics gc ON gc.civic_key = uc.civic_key
WHERE uc.user_id = @gq_test_user_id;

SELECT
    'POL_CIVIC_GOV_COMPAT' AS check_name,
    CASE
      WHEN COUNT(*) = 0 THEN 'OK'
      WHEN SUM(CASE WHEN gc.requires_government_key IS NULL OR gc.requires_government_key = ep.government_key THEN 1 ELSE 0 END) = COUNT(*) THEN 'OK'
      ELSE 'FAIL'
    END AS status,
    COUNT(*) AS value_ref
FROM user_empire_civics uc
JOIN user_empire_profile ep ON ep.user_id = uc.user_id
JOIN government_civics gc ON gc.civic_key = uc.civic_key
WHERE uc.user_id = @gq_test_user_id;

SELECT
    'POL_FACTION_ROWS_MIN4' AS check_name,
    CASE WHEN COUNT(*) >= 4 THEN 'OK' ELSE 'FAIL' END AS status,
    COUNT(*) AS value_ref
FROM user_faction_state
WHERE user_id = @gq_test_user_id;

SELECT
        'POL_ACTIVE_UNREST_EXISTS' AS check_name,
        CASE WHEN COUNT(*) >= 1 THEN 'OK' ELSE 'FAIL' END AS status,
        COUNT(*) AS value_ref
FROM situation_states
WHERE user_id = @gq_test_user_id
    AND situation_type = 'faction_unrest'
    AND status = 'active';

SELECT
        'POL_ACTIVE_UNREST_STAGE3PLUS' AS check_name,
        CASE
            WHEN COUNT(*) = 0 THEN 'FAIL'
            WHEN SUM(CASE WHEN stage >= 3 THEN 1 ELSE 0 END) = COUNT(*) THEN 'OK'
            ELSE 'FAIL'
        END AS status,
        COUNT(*) AS value_ref
FROM situation_states
WHERE user_id = @gq_test_user_id
    AND situation_type = 'faction_unrest'
    AND status = 'active';

-- Reference output for model state
SELECT
    ep.user_id,
    ep.primary_species_key,
    ep.government_key,
    ep.ethic_axis_json,
    ep.updated_at
FROM user_empire_profile ep
WHERE ep.user_id = @gq_test_user_id;

SELECT
    uc.slot_index,
    uc.civic_key,
    gc.requires_government_key,
    gc.effects_json
FROM user_empire_civics uc
JOIN government_civics gc ON gc.civic_key = uc.civic_key
WHERE uc.user_id = @gq_test_user_id
ORDER BY uc.slot_index ASC;

SELECT
        id, situation_type, status, progress, stage, approach_key, approach_locked,
        started_at, last_tick_at, ended_at
FROM situation_states
WHERE user_id = @gq_test_user_id
    AND situation_type = 'faction_unrest'
ORDER BY id DESC;
