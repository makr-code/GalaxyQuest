-- migrate_fleet_labels_v1.sql
-- Adds an optional player-defined label to each fleet row.
-- Max 48 characters; NULL = unnamed (display auto-generated label in the UI).

ALTER TABLE fleets
    ADD COLUMN IF NOT EXISTS fleet_label VARCHAR(48) DEFAULT NULL
        COMMENT 'Optional player-set fleet name / label';
