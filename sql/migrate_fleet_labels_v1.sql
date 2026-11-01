-- migrate_fleet_labels_v1.sql
-- Adds an optional player-defined label to each fleet row.
-- Max 48 characters; NULL = unnamed (display auto-generated label in the UI).

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
       AND COLUMN_NAME = 'fleet_label') = 0,
    'ALTER TABLE fleets ADD COLUMN fleet_label VARCHAR(48) DEFAULT NULL
        COMMENT ''Optional player-set fleet name / label''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
