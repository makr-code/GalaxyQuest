-- GalaxyQuest - Gameplay model smoke checks
-- Purpose: validate seeded generic data and key invariants.

USE galaxyquest;

SET @gq_test_user_id := (
    SELECT id
    FROM users
    WHERE username = 'gq_model_test_user'
    LIMIT 1
);

SELECT
    'TEST_USER_EXISTS' AS check_name,
    CASE WHEN @gq_test_user_id IS NOT NULL THEN 'OK' ELSE 'FAIL' END AS status,
    @gq_test_user_id AS value_ref;

SELECT
    'USER_FACTIONS_MIN_4' AS check_name,
    CASE WHEN COUNT(*) >= 4 THEN 'OK' ELSE 'FAIL' END AS status,
    COUNT(*) AS value_ref
FROM user_faction_state
WHERE user_id = @gq_test_user_id;

SELECT
    'ACTIVE_SITUATION_EXISTS' AS check_name,
    CASE WHEN COUNT(*) >= 1 THEN 'OK' ELSE 'FAIL' END AS status,
    COUNT(*) AS value_ref
FROM situation_states
WHERE user_id = @gq_test_user_id
  AND status = 'active';

SELECT
    'RESOLVED_SITUATION_EXISTS' AS check_name,
    CASE WHEN COUNT(*) >= 1 THEN 'OK' ELSE 'FAIL' END AS status,
    COUNT(*) AS value_ref
FROM situation_states
WHERE user_id = @gq_test_user_id
  AND status = 'resolved';

SELECT
    'STAGE_MATCH_RULE' AS check_name,
    CASE
      WHEN COUNT(*) = 0 THEN 'FAIL'
      WHEN SUM(
        CASE
          WHEN progress >= 80 AND stage = 4 THEN 1
          WHEN progress >= 50 AND progress < 80 AND stage = 3 THEN 1
          WHEN progress >= 25 AND progress < 50 AND stage = 2 THEN 1
          WHEN progress < 25 AND stage = 1 THEN 1
          ELSE 0
        END
      ) = COUNT(*) THEN 'OK'
      ELSE 'FAIL'
    END AS status,
    COUNT(*) AS value_ref
FROM situation_states
WHERE user_id = @gq_test_user_id;

SELECT
    'LOCK_ACTIVE_STAGE_3PLUS' AS check_name,
    CASE
      WHEN COUNT(*) = 0 THEN 'OK'
      WHEN SUM(CASE WHEN approach_locked = 1 THEN 1 ELSE 0 END) = COUNT(*) THEN 'OK'
      ELSE 'FAIL'
    END AS status,
    COUNT(*) AS value_ref
FROM situation_states
WHERE user_id = @gq_test_user_id
  AND status = 'active'
  AND stage >= 3;

SELECT
    'STAGE_LOG_LINKS_VALID' AS check_name,
    CASE
      WHEN COUNT(*) = 0 THEN 'FAIL'
      WHEN SUM(CASE WHEN ss.id IS NOT NULL THEN 1 ELSE 0 END) = COUNT(*) THEN 'OK'
      ELSE 'FAIL'
    END AS status,
    COUNT(*) AS value_ref
FROM situation_stage_log sl
LEFT JOIN situation_states ss ON ss.id = sl.situation_id
WHERE sl.user_id = @gq_test_user_id;

SELECT
    'FACTION_APPROVAL_IN_RANGE' AS check_name,
    CASE
      WHEN COUNT(*) = 0 THEN 'FAIL'
      WHEN SUM(CASE WHEN approval BETWEEN 0 AND 100 THEN 1 ELSE 0 END) = COUNT(*) THEN 'OK'
      ELSE 'FAIL'
    END AS status,
    COUNT(*) AS value_ref
FROM user_faction_state
WHERE user_id = @gq_test_user_id;

SELECT
    'HISTORY_ROWS_EXIST' AS check_name,
    CASE WHEN COUNT(*) >= 1 THEN 'OK' ELSE 'FAIL' END AS status,
    COUNT(*) AS value_ref
FROM faction_approval_history
WHERE user_id = @gq_test_user_id;

-- Detailed output for manual inspection
SELECT
    id, situation_type, status, progress, stage, approach_key, approach_locked,
    started_at, last_tick_at, ended_at
FROM situation_states
WHERE user_id = @gq_test_user_id
ORDER BY id DESC;

SELECT
    faction_key, approval, support, issues_json, last_updated_at
FROM user_faction_state
WHERE user_id = @gq_test_user_id
ORDER BY faction_key ASC;
