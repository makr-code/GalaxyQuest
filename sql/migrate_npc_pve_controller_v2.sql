-- GalaxyQuest - NPC/PvE LLM controller migration v2
-- Adds observability-focused indexes for summary analytics queries.

USE galaxyquest;

SET @has_table := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'npc_llm_decision_log'
);

-- user_id + action_key + created_at
SET @idx1_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'npc_llm_decision_log'
    AND index_name = 'idx_npc_llm_user_action_time'
);
SET @sql1 := IF(@has_table = 1 AND @idx1_exists = 0,
  'ALTER TABLE npc_llm_decision_log ADD INDEX idx_npc_llm_user_action_time (user_id, action_key, created_at)',
  'SELECT 1'
);
PREPARE stmt1 FROM @sql1;
EXECUTE stmt1;
DEALLOCATE PREPARE stmt1;

-- user_id + status + created_at
SET @idx2_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'npc_llm_decision_log'
    AND index_name = 'idx_npc_llm_user_status_time'
);
SET @sql2 := IF(@has_table = 1 AND @idx2_exists = 0,
  'ALTER TABLE npc_llm_decision_log ADD INDEX idx_npc_llm_user_status_time (user_id, status, created_at)',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- user_id + faction_id + status + created_at
SET @idx3_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'npc_llm_decision_log'
    AND index_name = 'idx_npc_llm_user_faction_status_time'
);
SET @sql3 := IF(@has_table = 1 AND @idx3_exists = 0,
  'ALTER TABLE npc_llm_decision_log ADD INDEX idx_npc_llm_user_faction_status_time (user_id, faction_id, status, created_at)',
  'SELECT 1'
);
PREPARE stmt3 FROM @sql3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;
