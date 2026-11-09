-- Preparation only: no automatic wreck generation or salvage mission is enabled.
USE galaxyquest;

CREATE TABLE IF NOT EXISTS ship_wreck_fields (
    encounter_id BIGINT UNSIGNED NOT NULL,
    event_sequence INT UNSIGNED NOT NULL,
    manifest_json JSON NOT NULL,
    manifest_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (encounter_id, event_sequence),
    CONSTRAINT fk_ship_wreck_loss_event FOREIGN KEY (encounter_id, event_sequence)
        REFERENCES battle_encounter_events (encounter_id, sequence)
) ENGINE=InnoDB;
