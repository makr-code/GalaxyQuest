-- Unified Bodies Model v2 (Hard Cut)
-- Switch runtime identity from planet_id to body_id.

START TRANSACTION;

-- colonies.body_id must exist and be fully populated
SET @has_body_id := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'colonies'
      AND COLUMN_NAME = 'body_id'
);
SET @sql_add_body_id := IF(
    @has_body_id = 0,
    'ALTER TABLE colonies ADD COLUMN body_id BIGINT UNSIGNED NULL AFTER planet_id',
    'SELECT 1'
);
PREPARE stmt_add_body_id FROM @sql_add_body_id;
EXECUTE stmt_add_body_id;
DEALLOCATE PREPARE stmt_add_body_id;

-- map remaining legacy colonies to body rows
UPDATE colonies c
JOIN planets p ON p.id = c.planet_id
JOIN celestial_bodies cb ON cb.body_uid = CONCAT('legacy-p-', p.galaxy, '-', p.`system`, '-', p.position)
SET c.body_id = cb.id
WHERE c.body_id IS NULL;

SET @has_fk_body := (
    SELECT COUNT(*)
    FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'colonies'
      AND CONSTRAINT_NAME = 'fk_colonies_body_id'
);
SET @sql_drop_fk_body := IF(
    @has_fk_body = 1,
    'ALTER TABLE colonies DROP FOREIGN KEY fk_colonies_body_id',
    'SELECT 1'
);
PREPARE stmt_drop_fk_body FROM @sql_drop_fk_body;
EXECUTE stmt_drop_fk_body;
DEALLOCATE PREPARE stmt_drop_fk_body;

-- hard constraint: body_id required
ALTER TABLE colonies MODIFY COLUMN body_id BIGINT UNSIGNED NOT NULL;

SET @has_idx_body := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'colonies'
      AND INDEX_NAME = 'idx_colonies_body_id'
);
SET @sql_add_idx_body := IF(
    @has_idx_body = 0,
    'ALTER TABLE colonies ADD INDEX idx_colonies_body_id (body_id)',
    'SELECT 1'
);
PREPARE stmt_add_idx_body FROM @sql_add_idx_body;
EXECUTE stmt_add_idx_body;
DEALLOCATE PREPARE stmt_add_idx_body;

SET @has_unique_body := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'colonies'
      AND INDEX_NAME = 'unique_colony_body'
);
SET @sql_add_unique_body := IF(
    @has_unique_body = 0,
    'ALTER TABLE colonies ADD UNIQUE KEY unique_colony_body (body_id)',
    'SELECT 1'
);
PREPARE stmt_add_unique_body FROM @sql_add_unique_body;
EXECUTE stmt_add_unique_body;
DEALLOCATE PREPARE stmt_add_unique_body;

SET @has_fk_body_new := (
    SELECT COUNT(*)
    FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'colonies'
      AND CONSTRAINT_NAME = 'fk_colonies_body_id'
);
SET @sql_add_fk_body := IF(
    @has_fk_body_new = 0,
    'ALTER TABLE colonies ADD CONSTRAINT fk_colonies_body_id FOREIGN KEY (body_id) REFERENCES celestial_bodies(id) ON DELETE CASCADE',
    'SELECT 1'
);
PREPARE stmt_add_fk_body FROM @sql_add_fk_body;
EXECUTE stmt_add_fk_body;
DEALLOCATE PREPARE stmt_add_fk_body;

-- battle reports move to body_id
SET @has_battle_body := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'battle_reports'
      AND COLUMN_NAME = 'body_id'
);
SET @sql_add_battle_body := IF(
    @has_battle_body = 0,
    'ALTER TABLE battle_reports ADD COLUMN body_id BIGINT UNSIGNED NULL AFTER defender_id',
    'SELECT 1'
);
PREPARE stmt_add_battle_body FROM @sql_add_battle_body;
EXECUTE stmt_add_battle_body;
DEALLOCATE PREPARE stmt_add_battle_body;

-- historical battle_reports.planet_id often contained colony_id; map from colonies.id
UPDATE battle_reports br
JOIN colonies c ON c.id = br.planet_id
SET br.body_id = c.body_id
WHERE br.body_id IS NULL;

SET @has_idx_battle_body := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'battle_reports'
      AND INDEX_NAME = 'idx_battle_body_id'
);
SET @sql_add_idx_battle_body := IF(
    @has_idx_battle_body = 0,
    'ALTER TABLE battle_reports ADD INDEX idx_battle_body_id (body_id)',
    'SELECT 1'
);
PREPARE stmt_add_idx_battle_body FROM @sql_add_idx_battle_body;
EXECUTE stmt_add_idx_battle_body;
DEALLOCATE PREPARE stmt_add_idx_battle_body;

-- spy reports move to target_body_id
SET @has_spy_body := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'spy_reports'
      AND COLUMN_NAME = 'target_body_id'
);
SET @sql_add_spy_body := IF(
    @has_spy_body = 0,
    'ALTER TABLE spy_reports ADD COLUMN target_body_id BIGINT UNSIGNED NULL AFTER target_planet_id',
    'SELECT 1'
);
PREPARE stmt_add_spy_body FROM @sql_add_spy_body;
EXECUTE stmt_add_spy_body;
DEALLOCATE PREPARE stmt_add_spy_body;

-- target_planet_id points to colonies.id in legacy fleet path
UPDATE spy_reports sr
JOIN colonies c ON c.id = sr.target_planet_id
SET sr.target_body_id = c.body_id
WHERE sr.target_body_id IS NULL;

SET @has_idx_spy_body := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'spy_reports'
      AND INDEX_NAME = 'idx_spy_target_body'
);
SET @sql_add_idx_spy_body := IF(
    @has_idx_spy_body = 0,
    'ALTER TABLE spy_reports ADD INDEX idx_spy_target_body (target_body_id)',
    'SELECT 1'
);
PREPARE stmt_add_idx_spy_body FROM @sql_add_idx_spy_body;
EXECUTE stmt_add_idx_spy_body;
DEALLOCATE PREPARE stmt_add_idx_spy_body;

COMMIT;
