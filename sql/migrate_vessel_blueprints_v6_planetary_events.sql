-- GalaxyQuest migration v6: extend colony_events for archaeological_find

CREATE TABLE IF NOT EXISTS colony_events (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    colony_id   INT NOT NULL,
    event_type  ENUM('solar_flare','mineral_vein','disease','archaeological_find') NOT NULL,
    started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    UNIQUE KEY unique_colony_event (colony_id)
) ENGINE=InnoDB;

SET @has_arch_find := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'colony_events'
      AND COLUMN_NAME = 'event_type'
      AND COLUMN_TYPE LIKE '%archaeological_find%'
);

SET @sql_arch_find := IF(
    @has_arch_find = 0,
    'ALTER TABLE colony_events MODIFY COLUMN event_type ENUM(''solar_flare'',''mineral_vein'',''disease'',''archaeological_find'') NOT NULL',
    'SELECT 1'
);

PREPARE stmt_arch_find FROM @sql_arch_find;
EXECUTE stmt_arch_find;
DEALLOCATE PREPARE stmt_arch_find;
